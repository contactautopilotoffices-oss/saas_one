import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/frontend/utils/supabase/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { isMissingSchema, isUuid, orgIdFrom, RUNTIME_MIGRATION } from '../_shared';
import { COUNCIL_MODEL, COUNCIL_MODEL_CHOICES } from '@/backend/lib/council/llm';
import {
    MAX_BAKED_CHARS,
    MAX_EXAMPLES,
    MAX_EXAMPLE_CHARS,
    MAX_EXAMPLE_CHARS_TOTAL,
    agentMessages,
    estimateContextCost,
    invalidateContextCache,
    normalizeContext,
    systemWithBakedContext,
} from '@/backend/lib/agents/context';

/**
 * /api/agents/context — the operator's few-shot examples and pinned org facts.
 *
 * GET  ?orgId=&agentKey=[&model=][&runsPerMonth=]
 *      the stored pair, the caps, the model list, the EXACT text that will be
 *      prepended to the prompt after fencing, and the estimated standing cost.
 * POST { agent_key, response_examples, baked_context }
 *      saves both and answers with the re-estimated cost.
 *
 * THREE THINGS THIS ROUTE IS RESPONSIBLE FOR
 *
 *  1. THE CAP IS ENFORCED HERE, NOT IN THE FORM. Examples are re-sent as input
 *     tokens on every call the agent ever makes; a form-only limit is a limit on
 *     nothing. Zod refuses oversized payloads and the assembler truncates again
 *     at read time (context.ts §5), so the bill is bounded on both ends.
 *
 *  2. THE SAVE IS A MERGE, NOT A REPLACE. runtime holds delivery, schedule,
 *     budget and quiet hours as well. Writing this tab's two keys as a whole
 *     `runtime` object — which is what the registry upsert does with whatever
 *     the caller sends — would drop every key this screen does not know about
 *     and silently unconfigure the agent's mailboxes. Read, spread, write.
 *
 *  3. WHAT YOU SEE IS WHAT IS SENT. The `preview` field is produced by the same
 *     `systemWithBakedContext` / `agentMessages` the run path calls, so the
 *     fencing and the section-stripping are visible to the operator instead of
 *     being a silent rewrite they never learn about.
 *
 * DEGRADE: migration 20260830000001 may not be applied. Both verbs answer 200
 * with provisioned:false rather than 500 — same contract as every sibling route.
 *
 * AUTHORIZATION: GET needs org membership. POST needs an organization admin
 * role, resolved exactly the way ../registry/route.ts resolves it — these two
 * keys go into the prompt of an autonomous agent and carry a recurring cost, so
 * they are not a member-level edit. The duplication of requireOrgAdmin follows
 * the precedent set in registry/route.ts (which copied it from credentials);
 * moving all three into ../_shared.ts is the right cleanup and is out of scope
 * here, because _shared.ts is shared with routes this change does not touch.
 */

export const dynamic = 'force-dynamic';

/** Roles that may change what goes into an agent's prompt. Same set as registry. */
const CONTEXT_WRITE_ROLES = ['org_super_admin', 'master_admin', 'org_admin'];

/** Used only when the agent has no run history to count. Stated in the response. */
const DEFAULT_RUNS_PER_MONTH = 30;

const AGENT_KEY_RE = /^[a-z0-9][a-z0-9_-]{1,62}$/;

async function requireOrgAdmin(orgId: string, userId: string): Promise<NextResponse | null> {
    const [profileRes, orgRes, propRes] = await Promise.all([
        supabaseAdmin.from('users').select('is_master_admin').eq('id', userId).maybeSingle(),
        supabaseAdmin
            .from('organization_memberships')
            .select('organization_id, role')
            .eq('user_id', userId)
            .eq('is_active', true),
        supabaseAdmin
            .from('property_memberships')
            .select('organization_id, role')
            .eq('user_id', userId)
            .eq('is_active', true),
    ]);

    const isMasterAdmin = !!profileRes.data?.is_master_admin;
    const memberships = [...(orgRes.data ?? []), ...(propRes.data ?? [])] as {
        organization_id: string | null;
        role: string | null;
    }[];
    const inOrg = memberships.filter((m) => m.organization_id === orgId);

    // Same message for "wrong org" and "no such org": do not confirm that an
    // organization id exists to someone who is not in it.
    if (!isMasterAdmin && inOrg.length === 0) {
        return NextResponse.json({ error: 'Forbidden: no access to this organization' }, { status: 403 });
    }

    const roles = [...new Set(inOrg.map((m) => m.role).filter(Boolean))] as string[];
    if (!isMasterAdmin && !roles.some((r) => CONTEXT_WRITE_ROLES.includes(r))) {
        return NextResponse.json(
            {
                error:
                    'Forbidden: editing an agent\'s examples or pinned context requires an organization admin role. '
                    + 'Both go into the prompt of an autonomous agent and are paid for on every call it makes.',
            },
            { status: 403 },
        );
    }
    return null;
}

const ExampleSchema = z.object({
    id: z.string().trim().min(1).max(64),
    input: z.string().max(MAX_EXAMPLE_CHARS),
    output: z.string().max(MAX_EXAMPLE_CHARS),
    note: z.string().trim().max(280).optional(),
});

const SaveSchema = z.object({
    agent_key: z.string().trim().toLowerCase().regex(AGENT_KEY_RE),
    response_examples: z.array(ExampleSchema).max(MAX_EXAMPLES).default([]),
    baked_context: z
        .object({
            facts: z.string().max(MAX_BAKED_CHARS),
            reviewed_at: z.string().trim().max(40).optional(),
        })
        .nullish(),
});

const NOT_PROVISIONED = NextResponse.json({
    provisioned: false,
    migration: RUNTIME_MIGRATION,
    context: { response_examples: [], baked_context: null },
    note: `oem_agents.runtime is not there yet — run migration ${RUNTIME_MIGRATION}.`,
});

/** The caps, sent to the console so the two can never disagree about the limit. */
const CAPS = {
    max_examples: MAX_EXAMPLES,
    max_example_chars: MAX_EXAMPLE_CHARS,
    max_example_chars_total: MAX_EXAMPLE_CHARS_TOTAL,
    max_baked_chars: MAX_BAKED_CHARS,
    why: 'Examples and pinned facts are re-sent as input tokens on every call this agent makes. '
        + 'An uncapped list is a standing monthly bill nobody approved.',
} as const;

/**
 * Real runs in the last 30 days, so "× N runs a month" is this agent's own
 * cadence rather than a guess. Null when the table is absent or the read fails —
 * the caller substitutes DEFAULT_RUNS_PER_MONTH and says which it used, because
 * a projected rupee figure with an invented denominator is worse than no figure.
 */
async function runsLast30d(
    supabase: Awaited<ReturnType<typeof createClient>>,
    orgId: string,
    agentKey: string,
): Promise<number | null> {
    const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const { count, error } = await supabase
        .from('oem_agent_runs')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', orgId)
        .eq('agent_key', agentKey)
        .gte('started_at', since);
    if (error) return null;
    return typeof count === 'number' ? count : null;
}

/** Model the cost is quoted against: whatever the caller asked for, else the default. */
function modelFrom(raw: string | null): string {
    const m = (raw ?? '').trim();
    return m || COUNCIL_MODEL;
}

export async function GET(request: NextRequest) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        const url = new URL(request.url);
        const orgId = orgIdFrom(request);
        if (!isUuid(orgId)) return NextResponse.json({ error: 'orgId (uuid) required' }, { status: 400 });
        const agentKey = (url.searchParams.get('agentKey') ?? '').trim().toLowerCase();
        if (!AGENT_KEY_RE.test(agentKey)) return NextResponse.json({ error: 'agentKey required' }, { status: 400 });

        // Membership is enough to READ; the row itself comes back through RLS.
        const res = await supabase
            .from('oem_agents')
            .select('runtime, model_config')
            .eq('organization_id', orgId)
            .eq('agent_key', agentKey)
            .maybeSingle();
        if (res.error && isMissingSchema(res.error)) return NOT_PROVISIONED;
        if (res.error) return NextResponse.json({ error: res.error.message }, { status: 400 });

        const runtime = (res.data?.runtime ?? {}) as Record<string, unknown>;
        const ctx = normalizeContext(runtime);

        // The agent's own configured model when it has one — quoting the council
        // default against an agent that runs on kimi-k3 understates it ~10x.
        const configured = (res.data?.model_config as { model?: string } | null)?.model ?? null;
        const model = modelFrom(url.searchParams.get('model') ?? configured);

        const measuredRuns = await runsLast30d(supabase, orgId, agentKey);
        const askedRuns = Number(url.searchParams.get('runsPerMonth'));
        const runsPerMonth = Number.isFinite(askedRuns) && askedRuns > 0
            ? Math.round(askedRuns)
            : measuredRuns ?? DEFAULT_RUNS_PER_MONTH;

        return NextResponse.json({
            provisioned: true,
            context: {
                response_examples: ctx.response_examples ?? [],
                baked_context: ctx.baked_context ?? null,
            },
            caps: CAPS,
            models: [COUNCIL_MODEL, ...COUNCIL_MODEL_CHOICES.filter((m) => m !== COUNCIL_MODEL)],
            estimate: estimateContextCost(ctx, { model, runsPerMonth }),
            runs_basis: measuredRuns == null
                ? { source: 'default', runs_per_month: runsPerMonth, note: 'no readable run history — assumed' }
                : { source: 'measured_30d', runs_per_month: runsPerMonth },
            // Exactly what will be appended to the system prompt, post-fence.
            // Empty string when nothing is pinned, which is the whole invariant.
            preview: {
                system_addition: systemWithBakedContext('', ctx),
                message_count: agentMessages('SYSTEM', 'USER', ctx).length,
                unchanged: agentMessages('SYSTEM', 'USER', ctx).length === 2
                    && systemWithBakedContext('', ctx) === '',
            },
        });
    } catch (e) {
        return NextResponse.json({ error: (e as Error).message }, { status: 400 });
    }
}

export async function POST(request: NextRequest) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
        const orgId = orgIdFrom(request, body);
        if (!isUuid(orgId)) return NextResponse.json({ error: 'orgId (uuid) required' }, { status: 400 });

        const forbidden = await requireOrgAdmin(orgId, user.id);
        if (forbidden) return forbidden;

        const parsed = SaveSchema.safeParse(body);
        if (!parsed.success) {
            return NextResponse.json(
                { error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') },
                { status: 400 },
            );
        }
        const input = parsed.data;

        // Whole-list total, which the per-field max cannot see. Refused rather
        // than silently truncated: the operator must know which example was
        // dropped, and a save that quietly loses text is how a prompt drifts.
        const total = input.response_examples.reduce((n, e) => n + e.input.length + e.output.length, 0);
        if (total > MAX_EXAMPLE_CHARS_TOTAL) {
            return NextResponse.json(
                {
                    error: `Examples total ${total} characters, over the ${MAX_EXAMPLE_CHARS_TOTAL} cap. `
                        + 'Every character here is re-sent on every call this agent makes — shorten or drop one.',
                },
                { status: 400 },
            );
        }

        // MERGE, do not replace: runtime also holds mailboxes, recipients,
        // schedule and budget, and this screen knows about none of them.
        const existing = await supabase
            .from('oem_agents')
            .select('runtime, model_config')
            .eq('organization_id', orgId)
            .eq('agent_key', input.agent_key)
            .maybeSingle();
        if (existing.error && isMissingSchema(existing.error)) return NOT_PROVISIONED;
        if (existing.error) return NextResponse.json({ error: existing.error.message }, { status: 400 });
        if (!existing.data) {
            return NextResponse.json(
                { error: `No agent '${input.agent_key}' in this organization. Create it first.` },
                { status: 404 },
            );
        }

        const facts = (input.baked_context?.facts ?? '').trim();
        const runtime = {
            ...((existing.data.runtime ?? {}) as Record<string, unknown>),
            response_examples: input.response_examples,
            // Null, not an empty object: "nothing pinned" must round-trip to the
            // exact same absent state the additive-only invariant is defined on.
            baked_context: facts ? { facts, reviewed_at: input.baked_context?.reviewed_at } : null,
        };

        const write = await supabase
            .from('oem_agents')
            .update({ runtime })
            .eq('organization_id', orgId)
            .eq('agent_key', input.agent_key)
            .select('runtime, model_config')
            .single();
        if (write.error && isMissingSchema(write.error)) return NOT_PROVISIONED;
        if (write.error) return NextResponse.json({ error: write.error.message }, { status: 400 });

        // The run path caches this for five minutes; without this the operator's
        // "Saved" is followed by five minutes of the old block still going out.
        invalidateContextCache(orgId, input.agent_key);

        const ctx = normalizeContext(write.data.runtime);
        const configured = (write.data.model_config as { model?: string } | null)?.model ?? null;
        const measuredRuns = await runsLast30d(supabase, orgId, input.agent_key);

        return NextResponse.json({
            provisioned: true,
            saved: true,
            context: {
                response_examples: ctx.response_examples ?? [],
                baked_context: ctx.baked_context ?? null,
            },
            estimate: estimateContextCost(ctx, {
                model: modelFrom(configured),
                runsPerMonth: measuredRuns ?? DEFAULT_RUNS_PER_MONTH,
            }),
            preview: { system_addition: systemWithBakedContext('', ctx) },
        });
    } catch (e) {
        return NextResponse.json({ error: (e as Error).message }, { status: 400 });
    }
}
