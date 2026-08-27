import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/frontend/utils/supabase/admin';
import { createClient } from '@/frontend/utils/supabase/server';
import { councilChat, isMockLlm } from '@/backend/lib/council/llm';

/**
 * Write TO a council agent — POST { agent_key, from, subject, text }.
 *
 * Records the incoming message (direction 'in', status 'received'), then drafts the
 * agent's reply from its persona prompt (read from its council_agents row, seeded by
 * the migration) plus the incoming text. The reply is stored as direction 'out',
 * status 'draft' — a human reviews and sends it (FP-05).
 *
 * The model call goes through backend/lib/council/llm.ts so the council has exactly
 * ONE provider path: this route previously carried its own inline Groq client, which
 * meant switching providers in llm.ts silently left agent replies on the old one.
 * llm.ts uses the 'email' purpose for the persona-voice temperature and token ceiling.
 *
 * Master-admin only, guard copied from app/api/master-admin-chatbot/route.ts.
 */

export const dynamic = 'force-dynamic';

const DEFAULT_ORG_ID = '211e1330-ad83-446d-941f-dcea48396798';

/** Table missing = migration not applied yet (same check as backend/lib/aop/access.ts). */
function isMissingRelation(error: { code?: string } | null): boolean {
    return error?.code === '42P01' || error?.code === 'PGRST205';
}

const MIGRATION_ERROR = 'Council migration not applied — run supabase/migrations/20260803000001_agent_council.sql';

type GuardResult =
    | { ok: true; adminClient: ReturnType<typeof createAdminClient>; organizationId: string }
    | { ok: false; response: NextResponse };

async function requireMasterAdmin(): Promise<GuardResult> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
        return { ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
    }

    const adminClient = createAdminClient();
    const { data: profile } = await adminClient
        .from('users')
        .select('is_master_admin')
        .eq('id', user.id)
        .single();

    if (!profile?.is_master_admin) {
        return { ok: false, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
    }

    const { data: memberships } = await adminClient
        .from('organization_memberships')
        .select('organization_id')
        .eq('user_id', user.id)
        .eq('is_active', true)
        .limit(1);

    return { ok: true, adminClient, organizationId: memberships?.[0]?.organization_id || DEFAULT_ORG_ID };
}

function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

export async function POST(request: NextRequest) {
    const guard = await requireMasterAdmin();
    if (!guard.ok) return guard.response;
    const { adminClient, organizationId } = guard;

    let body: any;
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const { agent_key, from, subject, text } = body || {};
    if (!agent_key || !from || !subject || !text) {
        return NextResponse.json({ error: 'agent_key, from, subject and text are required' }, { status: 400 });
    }

    const { data: agent, error: agentError } = await adminClient
        .from('council_agents')
        .select('key, name, title, email, persona')
        .eq('org_id', organizationId)
        .eq('key', agent_key)
        .maybeSingle();

    if (agentError) {
        if (isMissingRelation(agentError)) {
            return NextResponse.json({ error: MIGRATION_ERROR }, { status: 500 });
        }
        console.error('[council to-agent] agent lookup:', agentError.message);
        return NextResponse.json({ error: 'Could not load the agent' }, { status: 500 });
    }
    if (!agent) {
        return NextResponse.json({ error: `Unknown council agent: ${agent_key}` }, { status: 404 });
    }

    // 1. Record the incoming message. body_html is the escaped plain text with line
    //    breaks preserved — this field renders as HTML everywhere else in the inbox.
    const { data: received, error: receivedError } = await adminClient
        .from('council_inbox')
        .insert({
            org_id: organizationId,
            agent_key,
            direction: 'in',
            from_addr: from,
            to_addr: agent.email,
            subject,
            body_html: escapeHtml(String(text)).replace(/\n/g, '<br>'),
            status: 'received',
        })
        .select()
        .single();

    if (receivedError) {
        if (isMissingRelation(receivedError)) {
            return NextResponse.json({ error: MIGRATION_ERROR }, { status: 500 });
        }
        console.error('[council to-agent] record received:', receivedError.message);
        return NextResponse.json({ error: 'Could not record the message' }, { status: 500 });
    }

    // 2. Draft the agent's reply in its persona. Failure here must not lose the
    //    received message — it is already persisted, so degrade to draft:null.
    if (!process.env.OPENAI_API_KEY && !isMockLlm()) {
        return NextResponse.json({
            received,
            draft: null,
            reply_error: 'OPENAI_API_KEY is not configured',
        });
    }

    const systemPrompt = `${agent.persona}

You are ${agent.name}, ${agent.title} of the Autopilot Council, replying to an email addressed to you.
Write ONLY the reply email body as clean HTML (paragraphs and lists; no <html>/<body> wrapper, no subject line).
Stay in character, be specific and concrete, and keep it to a few short paragraphs.`;

    let replyHtml: string;
    try {
        replyHtml = await councilChat([
            { role: 'system', content: systemPrompt },
            { role: 'user', content: `From: ${from}\nSubject: ${subject}\n\n${text}` },
        ], 'email');
    } catch (error: any) {
        console.error('[council to-agent] reply generation:', error?.message || error);
        return NextResponse.json({
            received,
            draft: null,
            reply_error: 'Reply generation failed — the message was recorded',
        });
    }

    const { data: draft, error: draftError } = await adminClient
        .from('council_inbox')
        .insert({
            org_id: organizationId,
            agent_key,
            direction: 'out',
            from_addr: agent.email,
            to_addr: from,
            subject: `Re: ${subject}`,
            body_html: replyHtml,
            status: 'draft',
        })
        .select()
        .single();

    if (draftError) {
        console.error('[council to-agent] record draft:', draftError.message);
        return NextResponse.json({
            received,
            draft: null,
            reply_error: 'The reply was generated but could not be recorded',
        });
    }

    return NextResponse.json({ received, draft });
}
