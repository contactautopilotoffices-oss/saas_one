import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/frontend/utils/supabase/admin';
import { createClient } from '@/frontend/utils/supabase/server';
import { sendAsAgent } from '@/backend/lib/council/mailer';

/**
 * Agent Council inbox — one virtual mailbox per council agent.
 *
 *   GET  /api/council/inbox?agent=ops   that agent's messages, newest first
 *   POST /api/council/inbox             { agent_key, to, subject, html, send }
 *                                       send:true  → send via the council mailer, row
 *                                                    recorded 'sent' (or 'draft' when
 *                                                    SMTP fails — degrade, don't lose)
 *                                       send:false → record a 'draft' row only
 *
 * Master-admin only, guard copied from app/api/master-admin-chatbot/route.ts
 * (session getUser → users.is_master_admin → 403; service client for data).
 * Data lives in council_inbox / council_agents — see docs/COUNCIL_SPEC.md.
 */

export const dynamic = 'force-dynamic';

// The council is seeded for this org; a master admin without an org membership row
// still resolves here so the playground works for every master admin.
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

    // Org from the session user's active membership, defaulting to the seeded council org.
    const { data: memberships } = await adminClient
        .from('organization_memberships')
        .select('organization_id')
        .eq('user_id', user.id)
        .eq('is_active', true)
        .limit(1);

    return { ok: true, adminClient, organizationId: memberships?.[0]?.organization_id || DEFAULT_ORG_ID };
}

export async function GET(request: NextRequest) {
    const guard = await requireMasterAdmin();
    if (!guard.ok) return guard.response;
    const { adminClient, organizationId } = guard;

    const agentKey = new URL(request.url).searchParams.get('agent');
    if (!agentKey) {
        return NextResponse.json({ error: 'agent is required' }, { status: 400 });
    }

    const { data, error } = await adminClient
        .from('council_inbox')
        .select('id, org_id, agent_key, direction, from_addr, to_addr, subject, body_html, status, session_id, created_at')
        .eq('org_id', organizationId)
        .eq('agent_key', agentKey)
        .order('created_at', { ascending: false })
        .limit(200);

    if (error) {
        if (isMissingRelation(error)) {
            return NextResponse.json({ error: MIGRATION_ERROR }, { status: 500 });
        }
        console.error('[council inbox] list:', error.message);
        return NextResponse.json({ error: 'Could not load the inbox' }, { status: 500 });
    }

    return NextResponse.json({ agent: agentKey, messages: data || [] });
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

    const { agent_key, to, subject, html, send } = body || {};
    if (!agent_key || !to || !subject || !html) {
        return NextResponse.json({ error: 'agent_key, to, subject and html are required' }, { status: 400 });
    }

    // The sender must be one of the seeded council agents — the from/reply-to identity
    // is taken from its row, never from the request body.
    const { data: agent, error: agentError } = await adminClient
        .from('council_agents')
        .select('key, name, title, email')
        .eq('org_id', organizationId)
        .eq('key', agent_key)
        .maybeSingle();

    if (agentError) {
        if (isMissingRelation(agentError)) {
            return NextResponse.json({ error: MIGRATION_ERROR }, { status: 500 });
        }
        console.error('[council inbox] agent lookup:', agentError.message);
        return NextResponse.json({ error: 'Could not load the agent' }, { status: 500 });
    }
    if (!agent) {
        return NextResponse.json({ error: `Unknown council agent: ${agent_key}` }, { status: 404 });
    }

    let status: 'sent' | 'draft' = 'draft';
    let sendError: string | undefined;
    if (send === true) {
        const result = await sendAsAgent({ agent, to, subject, html });
        if (result.sent) {
            status = 'sent';
        } else {
            // Degrade to a draft: the message is preserved and can be resent later.
            sendError = result.error;
        }
    }

    const { data: message, error: insertError } = await adminClient
        .from('council_inbox')
        .insert({
            org_id: organizationId,
            agent_key,
            direction: 'out',
            from_addr: agent.email,
            to_addr: to,
            subject,
            body_html: html,
            status,
        })
        .select()
        .single();

    if (insertError) {
        if (isMissingRelation(insertError)) {
            return NextResponse.json({ error: MIGRATION_ERROR }, { status: 500 });
        }
        console.error('[council inbox] record:', insertError.message);
        return NextResponse.json({ error: 'Could not record the message' }, { status: 500 });
    }

    return NextResponse.json({
        message,
        sent: status === 'sent',
        ...(sendError ? { send_error: sendError } : {}),
    });
}
