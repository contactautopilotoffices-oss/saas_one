/**
 * COUNCIL PERSONAS, FROM THE AGENT CONSOLE.
 * -----------------------------------------------------------------------------
 * /api/council/* is master-admin only and strips `persona` from every response.
 * The Agent Console is an org-admin surface. So this is the org-scoped door:
 *
 *   GET   ?orgId=   the org's council personas WITH their persona text, plus the
 *                   latest vetting verdicts each has issued — read by any member.
 *   PATCH ?orgId=   { key, persona, note? } — rewrite one persona. Org admins
 *                   only. Bumps persona_version, logs a prompt_change to
 *                   oem_council_log under agent_key 'council:<key>'.
 *
 * WHY THIS IS THE ONE PROMPT WORTH EDITING. council_agents.persona is the only
 * stored prompt in this system that a model actually executes at runtime —
 * loadAgents() hands it straight to councilChat() as the system message. Edit
 * it here, and the next convene, the next inbox reply and the next vetting all
 * behave differently. oem_agents.system_prompt, by contrast, is a spec a human
 * implements; see docs/AGENT_RUNBOOK.md.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/frontend/utils/supabase/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { isOrgMember } from '@/backend/lib/ira/procurement/guard';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ADMIN_ROLES = new Set(['org_admin', 'org_super_admin']);

async function gate(request: NextRequest, needAdmin: boolean) {
    const orgId = new URL(request.url).searchParams.get('orgId') ?? '';
    if (!UUID_RE.test(orgId)) return { error: NextResponse.json({ error: 'orgId (uuid) required' }, { status: 400 }) };
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
    if (!(await isOrgMember(orgId, user.id))) return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
    if (needAdmin) {
        const { data: m } = await supabaseAdmin
            .from('organization_memberships').select('role')
            .eq('organization_id', orgId).eq('user_id', user.id).maybeSingle();
        if (!m || !ADMIN_ROLES.has(String(m.role))) {
            return { error: NextResponse.json({ error: 'Org admin role required to edit a persona' }, { status: 403 }) };
        }
    }
    return { orgId, userId: user.id };
}

export async function GET(request: NextRequest) {
    const g = await gate(request, false);
    if ('error' in g) return g.error;

    const [{ data: agents, error }, { data: verdicts }] = await Promise.all([
        supabaseAdmin
            .from('council_agents')
            .select('key, name, title, email, lens, persona, color, sort, is_active, persona_version, updated_at')
            .eq('org_id', g.orgId).order('sort', { ascending: true }),
        supabaseAdmin
            .from('oem_council_log')
            .select('id, agent_key, summary, decision, details, created_at')
            .eq('organization_id', g.orgId).in('review_type', ['vetting', 'performance_review'])
            .order('created_at', { ascending: false }).limit(40),
    ]);
    if (error) return NextResponse.json({ error: error.message, provisioned: false }, { status: 200 });

    // Which runtime agents report to whom — read once, so the UI can draw lines.
    const { data: runtimeAgents } = await supabaseAdmin
        .from('oem_agents').select('agent_key, display_name, status, runtime')
        .eq('organization_id', g.orgId);
    const reports = (runtimeAgents ?? []).map((a) => ({
        agent_key: String(a.agent_key), display_name: String(a.display_name ?? a.agent_key), status: String(a.status),
        reports_to: ((a.runtime ?? {}) as { reports_to?: string | null }).reports_to ?? null,
    }));

    return NextResponse.json({
        provisioned: true,
        agents: (agents ?? []).map((a) => ({
            ...a,
            persona_chars: String(a.persona ?? '').length,
            reports: reports.filter((r) => r.reports_to === a.key),
            verdicts: (verdicts ?? [])
                .filter((v) => ((v.details ?? {}) as { reviewer?: { key?: string } }).reviewer?.key === a.key)
                .slice(0, 5),
        })),
        runtime_agents: reports,
    });
}

const PatchSchema = z.object({
    key: z.string().trim().toLowerCase().regex(/^[a-z_]{2,40}$/),
    persona: z.string().min(80).max(20_000),
    note: z.string().trim().max(300).nullish(),
});

export async function PATCH(request: NextRequest) {
    const g = await gate(request, true);
    if ('error' in g) return g.error;

    const parsed = PatchSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues.map((i) => i.message).join('; ') }, { status: 400 });
    const { key, persona, note } = parsed.data;

    const { data: cur } = await supabaseAdmin
        .from('council_agents').select('id, name, persona, persona_version')
        .eq('org_id', g.orgId).eq('key', key).maybeSingle();
    if (!cur) return NextResponse.json({ error: `No council persona "${key}" in this org` }, { status: 404 });
    if (String(cur.persona) === persona) return NextResponse.json({ ok: true, unchanged: true, version: cur.persona_version ?? 1 });

    const prev = Number(cur.persona_version ?? 1);
    const next = prev + 1;
    // Compare-and-swap on the version: two admins editing at once cannot both
    // land as the same version with different text.
    const { data: upd, error } = await supabaseAdmin
        .from('council_agents')
        .update({ persona, persona_version: next, updated_at: new Date().toISOString() })
        .eq('id', cur.id).eq('persona_version', prev)
        .select('persona_version').maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!upd) return NextResponse.json({ error: 'Someone else saved a newer version. Reload and try again.' }, { status: 409 });

    await supabaseAdmin.from('oem_council_log').insert({
        organization_id: g.orgId,
        agent_key: `council:${key}`,
        review_type: 'prompt_change',
        decision: 'approved',
        decided_by: 'human',
        summary: `${cur.name}'s persona v${prev} → v${next}${note ? ` — ${note}` : ''}.`,
        details: { key, from_version: prev, to_version: next, previous_persona: cur.persona, chars: persona.length },
        created_by: g.userId,
    });

    return NextResponse.json({ ok: true, version: next });
}
