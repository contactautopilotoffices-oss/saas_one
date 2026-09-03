import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/frontend/utils/supabase/server';
import {
    composeAgent,
    foldGuidance,
    type ComposeTableHint,
    type PendingGuidance,
} from '@/backend/lib/agents/compose';
import {
    RUNTIME_MIGRATION,
    discoverOrgTables,
    isDeniedTable,
    isMissingSchema,
    isUuid,
    orgIdFrom,
    type DiscoveredTable,
} from '../_shared';

/**
 * POST /api/agents/compose?orgId=   body { description, agentKey? }
 *
 * "DESCRIBE IT → Build flow", for agents.
 *
 * An operator types one sentence. This route grounds it in the tables the
 * organization ACTUALLY has (reference A's "build from real config" — the whole
 * point is that the draft is never invented out of thin air), hands both to
 * composeAgent(), and returns the proposal.
 *
 * IT NEVER SAVES. The response is a PROPOSAL the human reviews as a diff and
 * then accepts by calling:
 *      POST /api/agents/registry  { action:'upsert' }      → identity + runtime
 *      POST /api/agents/registry  { action:'save_prompt' } → versioned prompt
 *      POST /api/agents/bundles   { agentKey, tables }     → versioned bundle
 * Auto-applying an LLM's idea of what an agent may read is exactly the failure
 * mode the bundle system exists to prevent, so the accept step stays human.
 *
 * ---------------------------------------------------------------------------
 * POST /api/agents/compose?orgId=   body { mode:'fold', agent_key, feedback_ids? }
 *
 * THE SECOND MODE: fold the operator's pending corrections into the next prompt
 * version. Prompt evolution used to be a markdown append running in the browser;
 * it is now foldGuidance() in backend/lib/agents/compose.ts, so the logic that
 * decides how a correction becomes a standing rule is versioned, testable and
 * identical to what a nightly job would run.
 *
 * THIS MODE NEVER SAVES EITHER. It proposes next_prompt; the operator reviews the
 * diff and commits through the existing registry `save_prompt` + `absorb_feedback`
 * calls. Stamping applied_to_prompt_version here would mark corrections absorbed
 * by a prompt version that may never be written.
 */

export const dynamic = 'force-dynamic';
/** Composition is one model round-trip plus a table probe sweep. */
export const maxDuration = 60;

const FoldSchema = z.object({
    mode: z.literal('fold'),
    agent_key: z.string().trim().toLowerCase().min(1).max(63),
    /** Narrow the fold to specific corrections. Omitted = every pending one. */
    feedback_ids: z.array(z.string().uuid()).max(200).optional(),
});

const ComposeSchema = z.object({
    description: z.string().trim().min(12, 'Describe the agent in a sentence or two.').max(4_000),
    agentKey: z
        .string()
        .trim()
        .toLowerCase()
        .max(63)
        .optional(),
    /** Skip the row-count sweep when the caller only needs a fast draft. */
    counts: z.boolean().optional(),
});

export async function POST(request: NextRequest) {
    try {
        const supabase = await createClient();
        const {
            data: { user },
        } = await supabase.auth.getUser();
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
        if (body.agent_key && !body.agentKey) body.agentKey = body.agent_key;

        const orgId = orgIdFrom(request, body);
        if (!isUuid(orgId)) return NextResponse.json({ error: 'orgId (uuid) required' }, { status: 400 });

        /* =================================================================
         * MODE 'fold' — compile the next prompt version from the operator's
         * pending corrections. Branches before ComposeSchema, which requires a
         * `description` a fold never has.
         * ================================================================= */
        if (body.mode === 'fold') {
            const f = FoldSchema.safeParse(body);
            if (!f.success) {
                return NextResponse.json(
                    { error: f.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ') },
                    { status: 400 },
                );
            }
            return await handleFold(supabase, orgId, f.data);
        }

        const parsed = ComposeSchema.safeParse(body);
        if (!parsed.success) {
            return NextResponse.json(
                { error: parsed.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ') },
                { status: 400 }
            );
        }
        const { description, agentKey, counts } = parsed.data;

        /* ---- 1. What does this organization actually have? ---------------- */
        let discovered: DiscoveredTable[] = [];
        try {
            discovered = await discoverOrgTables(supabase, orgId, { counts: counts !== false });
        } catch {
            discovered = [];
        }

        // Ground on populated tables when there are enough of them; otherwise
        // fall back to everything present, so a fresh tenant still gets a draft.
        const populated = discovered.filter((t) => t.has_data);
        const pool = populated.length >= 5 ? populated : discovered;

        const availableTables: ComposeTableHint[] = pool.map((t) => ({
            name: t.name,
            note: t.rows_estimate != null ? `${t.purpose} (~${t.rows_estimate} rows)` : t.purpose,
        }));

        if (availableTables.length === 0) {
            return NextResponse.json({
                provisioned: false,
                migration: RUNTIME_MIGRATION,
                proposal: null,
                discovered_tables: [],
                note:
                    'No FMS tables were reachable for this organization, so there is nothing to ground a draft in. ' +
                    'Either the schema is not provisioned or row-level security is hiding it from this account.',
            });
        }

        /* ---- 2. Which teams already exist, so the draft lands in one ------ */
        let departments: string[] | undefined;
        let existingAgent: { agent_key: string; display_name: string; status: string } | null = null;
        try {
            const { data, error } = await supabase
                .from('oem_agents')
                .select('agent_key, display_name, department, status')
                .eq('organization_id', orgId);
            if (!error && data) {
                const rows = data as Array<{ agent_key: string; display_name: string; department: string | null; status: string }>;
                const set = new Set(rows.map((r) => r.department).filter((d): d is string => !!d));
                departments = set.size ? Array.from(set).sort() : undefined;
                if (agentKey) {
                    const hit = rows.find((r) => r.agent_key === agentKey);
                    existingAgent = hit ? { agent_key: hit.agent_key, display_name: hit.display_name, status: hit.status } : null;
                }
            }
        } catch {
            departments = undefined;
        }

        /* ---- 3. Compose. Pure function; nothing is written. ---------------- */
        let proposal;
        try {
            proposal = await composeAgent({
                orgId,
                description,
                agentKey,
                availableTables,
                departments,
            });
        } catch (e) {
            const err = e as Error & { code?: string };
            if (isMissingSchema(err)) {
                return NextResponse.json({
                    provisioned: false,
                    migration: RUNTIME_MIGRATION,
                    proposal: null,
                    discovered_tables: availableTables.map((t) => (typeof t === 'string' ? t : t.name)),
                    note: `Composition needs schema that is not provisioned yet — run migration ${RUNTIME_MIGRATION}.`,
                });
            }
            // A model outage is a 502, not a 500: the request was fine.
            return NextResponse.json(
                { provisioned: true, proposal: null, error: `Composer failed: ${err.message}` },
                { status: 502 }
            );
        }

        /* ---- 4. Defence in depth on the way out --------------------------- */
        // composeAgent already refuses tables outside the list it was given, but
        // the deny list is re-applied here so a credential store can never reach
        // a client even through a composer bug or a widened catalogue.
        const allowed = new Set(pool.map((t) => t.name));
        const strippedDenied: string[] = [];
        const strippedUnknown: string[] = [];
        const safeTables = proposal.suggested_bundle.tables.filter((t) => {
            if (isDeniedTable(t.name)) {
                strippedDenied.push(t.name);
                return false;
            }
            if (!allowed.has(t.name)) {
                strippedUnknown.push(t.name);
                return false;
            }
            return true;
        });

        return NextResponse.json({
            provisioned: true,
            saved: false,
            proposal: {
                ...proposal,
                suggested_bundle: { tables: safeTables },
            },
            /** What the draft was grounded in — the UI shows this as the evidence. */
            grounded_in: {
                table_count: availableTables.length,
                populated_only: populated.length >= 5,
                tables: pool.map((t) => ({
                    name: t.name,
                    domain: t.domain,
                    rows_estimate: t.rows_estimate,
                    suggested_access: t.suggested_access,
                })),
                departments: departments ?? [],
            },
            /** Non-empty means the composer named something it was not offered. */
            stripped: { denied: strippedDenied, not_in_org: strippedUnknown },
            existing_agent: existingAgent,
            apply: {
                note: 'Nothing has been saved. Accept the diff by calling these three, in order.',
                steps: [
                    { method: 'POST', path: '/api/agents/registry', body: { action: 'upsert' } },
                    { method: 'POST', path: '/api/agents/registry', body: { action: 'save_prompt' } },
                    { method: 'POST', path: '/api/agents/bundles', body: { agentKey: proposal.agent_key } },
                ],
            },
        });
    } catch (e) {
        return NextResponse.json({ provisioned: false, proposal: null, error: (e as Error).message }, { status: 400 });
    }
}


/* ===========================================================================
 * fold
 * ======================================================================== */

type FoldBody = z.infer<typeof FoldSchema>;

/**
 * Read the agent's running prompt and its unabsorbed corrections, hand both to
 * foldGuidance(), return the proposal.
 *
 * Degrades to 200 { provisioned:false } when the agent-runtime tables are not
 * there yet — the console then says "needs migration" instead of rendering a
 * broken panel, which is the rule every route in this folder follows.
 */
async function handleFold(
    supabase: Awaited<ReturnType<typeof createClient>>,
    orgId: string,
    body: FoldBody,
): Promise<NextResponse> {
    const agentKey = body.agent_key;

    const notProvisioned = (what: string) =>
        NextResponse.json({
            provisioned: false,
            mode: 'fold' as const,
            agent_key: agentKey,
            migration: RUNTIME_MIGRATION,
            next_prompt: null,
            changelog: [],
            applied_feedback_ids: [],
            saved: false,
            note: `${what} needs schema that is not provisioned yet — run migration ${RUNTIME_MIGRATION}.`,
        });

    /* ---- 1. The prompt being edited ---------------------------------- */
    const { data: agentRow, error: agentErr } = await supabase
        .from('oem_agents')
        .select('agent_key, display_name, system_prompt, system_prompt_version')
        .eq('organization_id', orgId)
        .eq('agent_key', agentKey)
        .maybeSingle();

    if (agentErr) {
        if (isMissingSchema(agentErr)) return notProvisioned('The agent registry');
        return NextResponse.json(
            { provisioned: true, mode: 'fold', agent_key: agentKey, error: agentErr.message },
            { status: 400 },
        );
    }
    if (!agentRow) {
        return NextResponse.json(
            {
                provisioned: true,
                mode: 'fold',
                agent_key: agentKey,
                error: `No agent '${agentKey}' in this organization, so there is no prompt to fold into.`,
            },
            { status: 404 },
        );
    }

    const agent = agentRow as {
        agent_key: string;
        display_name: string | null;
        system_prompt: string | null;
        system_prompt_version: number | null;
    };
    const currentPrompt = (agent.system_prompt ?? '').trim();
    const currentVersion = agent.system_prompt_version ?? 0;

    // Folding into nothing would have the compiler INVENT a constitution from a
    // handful of corrections — the opposite of editing. Say so instead.
    if (!currentPrompt) {
        return NextResponse.json(
            {
                provisioned: true,
                mode: 'fold',
                agent_key: agentKey,
                current_version: currentVersion,
                error:
                    `'${agentKey}' has no system prompt yet, so there is nothing to fold corrections into. `
                    + 'Compose the agent first, then fold.',
            },
            { status: 409 },
        );
    }

    /* ---- 2. What is still pending ------------------------------------ */
    let query = supabase
        .from('oem_agent_feedback')
        .select('id, signal, reason, guidance, created_at')
        .eq('organization_id', orgId)
        .eq('agent_key', agentKey)
        .is('applied_to_prompt_version', null)
        .not('guidance', 'is', null)
        .order('created_at', { ascending: true })
        .limit(200);

    if (body.feedback_ids?.length) query = query.in('id', body.feedback_ids);

    const { data: fbRows, error: fbErr } = await query;
    if (fbErr) {
        if (isMissingSchema(fbErr)) return notProvisioned('Agent feedback');
        return NextResponse.json(
            { provisioned: true, mode: 'fold', agent_key: agentKey, error: fbErr.message },
            { status: 400 },
        );
    }

    const pending: PendingGuidance[] = ((fbRows ?? []) as Array<{
        id: string;
        signal: PendingGuidance['signal'];
        reason: string | null;
        guidance: string | null;
        created_at: string;
    }>)
        .filter((r) => (r.guidance ?? '').trim().length > 0)
        .map((r) => ({
            id: r.id,
            guidance: r.guidance as string,
            signal: r.signal,
            reason: r.reason,
            created_at: r.created_at,
        }));

    /* ---- 3. Compile. Pure function; nothing is written. --------------- */
    let result;
    try {
        result = await foldGuidance(orgId, agentKey, currentPrompt, pending);
    } catch (e) {
        const err = e as Error;
        if (isMissingSchema(err)) return notProvisioned('The prompt compiler');
        // A model outage is a 502, not a 500: the request itself was fine.
        return NextResponse.json(
            { provisioned: true, mode: 'fold', agent_key: agentKey, error: `Prompt compiler failed: ${err.message}` },
            { status: 502 },
        );
    }

    // Nothing pending: foldGuidance returns the prompt unchanged. Report that as
    // a fact rather than presenting an identical diff as if it were a new version.
    const unchanged = pending.length === 0;

    return NextResponse.json({
        provisioned: true,
        mode: 'fold',
        saved: false,
        agent_key: agentKey,
        display_name: agent.display_name,
        current_version: currentVersion,
        next_version: unchanged ? currentVersion : currentVersion + 1,
        next_prompt: result.next_prompt,
        changelog: result.changelog,
        applied_feedback_ids: result.applied_feedback_ids,
        pending_count: pending.length,
        mocked: result.mocked,
        note: unchanged
            ? 'No unabsorbed corrections, so the prompt is returned unchanged.'
            : 'Nothing has been saved. Commit the diff with registry save_prompt, then absorb_feedback.',
        // One call commits both the version and the absorption. `absorb_feedback:
        // true` is NOT it — the registry ignores that flag and leaves every
        // correction pending; the ids have to travel explicitly.
        apply: {
            steps: [
                {
                    method: 'POST',
                    path: '/api/agents/registry',
                    body: {
                        action: 'save_prompt',
                        agent_key: agentKey,
                        absorbed_feedback_ids: result.applied_feedback_ids,
                    },
                },
            ],
        },
    });
}
