/**
 * POST /api/agents/setup?orgId=   body { description, agentKey? }
 *
 * ONE CALL, THE WHOLE AGENT. Identity, system prompt, table bundle, runtime
 * envelope, workflow plan and a preflight — from one sentence.
 *
 * It replaces four separate actions the operator previously had to run in the
 * right order (Build, Plan workflow, Configure, Delivery) and then reconcile by
 * hand. They are the same inputs; there was never a reason to ask four times.
 *
 * NOTHING IS SAVED. This returns a proposal with the evidence for each derived
 * field, and the operator accepts or edits. That is deliberate and matches the
 * rest of the console: propose, show the delta, require confirmation.
 *
 * The four halves run CONCURRENTLY and independently — one failing degrades that
 * section rather than the response. A plan without an envelope is still useful;
 * an error page is not.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';
import { AGENT_TABLE_CATALOG, AGENT_MODULE_DESCRIPTORS } from '@/app/api/agents/_shared';
import { AGENT_MODULES } from '@/frontend/types/agentRuntime';
import { composeAgent } from '@/backend/lib/agents/compose';
import { composePlanWithModel } from '@/backend/lib/agents/planModel';
import { configureFromPrompt } from '@/backend/lib/agents/configureAll';
import { bindTools } from '@/backend/lib/agents/plan';
import { preflight } from '@/backend/lib/agents/preflight';

/** Three model round-trips, run in parallel. */
export const maxDuration = 120;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const orgId = new URL(request.url).searchParams.get('orgId') ?? '';
    if (!UUID_RE.test(orgId)) {
        return NextResponse.json({ error: 'orgId (uuid) required' }, { status: 400 });
    }

    const body = (await request.json().catch(() => ({}))) as { description?: string; agentKey?: string };
    const description = (body.description ?? '').trim();
    if (description.length < 12) {
        return NextResponse.json({ error: 'Describe the job in a sentence first.' }, { status: 400 });
    }

    const tables = AGENT_TABLE_CATALOG.map((t) => ({ name: t.name, domain: t.domain, purpose: t.purpose }));
    const toolSlugs = bindTools(['db_read', 'db_write', 'web_search', 'email', 'whatsapp', 'push', 'llm', 'zoho_books'])
        .map((t) => t.slug);

    // Independent by design: a failure in one section must not cost the others.
    const [identity, plan, envelope, checks] = await Promise.allSettled([
        composeAgent({
            orgId,
            description,
            agentKey: body.agentKey,
            availableTables: AGENT_TABLE_CATALOG.map((t) => ({ name: t.name, note: t.purpose })),
            departments: AGENT_MODULE_DESCRIPTORS.map((m) => m.label),
        }),
        composePlanWithModel({ description, tables, modules: [...AGENT_MODULES], toolSlugs }),
        configureFromPrompt(description),
        body.agentKey ? preflight(orgId, body.agentKey) : Promise.resolve(null),
    ]);

    const val = <T,>(r: PromiseSettledResult<T>) => (r.status === 'fulfilled' ? r.value : null);
    const err = (r: PromiseSettledResult<unknown>) =>
        r.status === 'rejected' ? String((r.reason as Error)?.message ?? r.reason) : null;

    const errors = [
        ['identity', err(identity)], ['plan', err(plan)],
        ['envelope', err(envelope)], ['preflight', err(checks)],
    ].filter(([, e]) => e).map(([k, e]) => `${k}: ${e}`);

    return NextResponse.json({
        ok: true,
        description,
        // Each section stands alone so the UI can render what worked.
        identity: val(identity),
        plan: val(plan),
        envelope: val(envelope),
        preflight: val(checks),
        errors,
        // Nothing above has been written. Saying so in the payload keeps any
        // future caller from assuming otherwise.
        saved: false,
    });
}
