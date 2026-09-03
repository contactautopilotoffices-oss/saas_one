import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';
import { getISTDateBounds } from '@/backend/utils/timezone';
import {
    AGENT_MODULE_LABELS,
    AGENT_RUNTIME_MIGRATION,
    isAgentModule,
    isNotProvisionedError,
    type AgentHealthState,
} from '@/frontend/types/agentRuntime';

/**
 * AGENT PROVIDENCE — the one endpoint every module calls to prove the agentic
 * employees are moving.
 * =============================================================================
 * GET /api/agents/pulse?orgId=&module=procurement
 *      -> that module's agents, what they did today, when they last moved.
 * GET /api/agents/pulse?orgId=
 *      -> the same, keyed by module, for every module at once, so the Command
 *         Center can light up every card from a single fetch.
 *
 * This is deliberately the cheapest route in the agent surface, because it is
 * the most called one: a procurement screen, a ticket screen, an electricity
 * screen and the Command Center may all mount it at once. It is therefore
 * exactly TWO queries, both index-covered, with a narrow projection and a hard
 * row ceiling:
 *
 *   1. oem_agents          the registry. Dozens of rows. Carries health_state,
 *                          last_heartbeat_at and coins_balance already — the
 *                          heartbeat trigger pushes them onto this row precisely
 *                          so a liveness read needs no join.
 *   2. oem_agent_runs      a 7-day window, five columns, newest first, capped.
 *                          Today's counts and the last-activity line both come
 *                          out of this one pass.
 *
 * No per-agent query, no N+1, no view. A 30-second private cache header is set
 * so a dashboard mounting six cards pays for one round trip.
 *
 * WHY A 7-DAY WINDOW AND NOT JUST TODAY. "Nothing today" and "nothing this
 * week" look identical if you only fetch today, and they mean different things:
 * the first is a quiet morning, the second is an agent that has stopped. The
 * window gives `last_run_at` a chance to be non-null on a quiet day, and the
 * response names the window so a reader knows an older agent may show null.
 *
 * TODAY is the IST calendar day (backend/utils/timezone.ts), not a rolling 24
 * hours and not UTC midnight — an operator in Mumbai reading "12 runs today"
 * means since they woke up.
 *
 * Degrades to HTTP 200 { provisioned: false } when 20260830000001_agent_runtime
 * has not been applied.
 *
 * "NOT PROVISIONED" AND "THE QUERY FAILED" ARE DIFFERENT ANSWERS.
 * An unapplied migration is a KNOWN state: the tables are not there, nothing has
 * run, and { provisioned: false } says exactly that. A query that ERRORS knows
 * nothing at all — and this endpoint is mounted on roughly ten module tabs, so
 * flattening one into the other tells the org head that every agent everywhere is
 * idle on the strength of a database error. Every response therefore carries `ok`:
 *   ok: true   this payload is a truthful answer about the organisation
 *              (including the calm provisioned:false one)
 *   ok: false  the answer is UNKNOWN. Run-derived fields are null, never 0, and
 *              `agents` is null rather than [] so a consumer that renders a list
 *              cannot read the failure as "no agents did anything".
 * The ok:false case is also HTTP 500, because a genuine database error IS a server
 * error and every consumer already distinguishes a non-ok fetch (useWidgetData
 * surfaces "HTTP 500"; AgentPulse keeps its last good payload and otherwise renders
 * nothing). The 200-degrade rule covers the missing-table codes only.
 */

export const dynamic = 'force-dynamic';

/** Days of run history fetched so `last_run_at` survives a quiet day. */
const WINDOW_DAYS = 7;

/** Hard ceiling on the run projection. PostgREST truncates silently at 1000. */
const RUN_ROW_CEILING = 2000;

/** Agents whose module is neither declared nor observable land here. */
const UNASSIGNED = 'unassigned';

/**
 * A heartbeat older than this multiple of the agent's configured interval means
 * the stored health_state is stale — the agent did not report DOWN, it stopped
 * reporting at all, which is the failure mode that looks healthiest and is the
 * most dangerous. Three intervals tolerates one missed beat plus jitter.
 */
const STALE_BEAT_MULTIPLE = 3;
const DEFAULT_HEARTBEAT_INTERVAL_SEC = 300;

interface PulseAgent {
    agent_key: string;
    display_name: string;
    department: string | null;
    status: string;
    module: string;
    health_state: AgentHealthState;
    last_heartbeat_at: string | null;
    heartbeat_age_sec: number | null;
    /** True when the agent stopped reporting rather than reported a problem. */
    heartbeat_stale: boolean;
    last_run_at: string | null;
    last_outcome: string | null;
    last_status: string | null;
    runs_today: number;
    runs_window: number;
    failures_today: number;
    coins_balance: number;
}

function notProvisioned(module: string | null) {
    return NextResponse.json(
        {
            // A known state, honestly reported: the tables are not there, so
            // nothing has run. That is an answer, so ok stays true.
            ok: true,
            provisioned: false,
            migration: AGENT_RUNTIME_MIGRATION,
            reason: `Agent runtime is not set up yet — apply ${AGENT_RUNTIME_MIGRATION}.sql.`,
            module,
            agents: [],
            modules: {},
            runs_today: 0,
            last_activity_at: null,
        },
        { status: 200 },
    );
}

/**
 * A GENUINE query failure — the tables exist and the read still did not work
 * (permission, timeout, bad filter, connection). Nothing about this organisation's
 * agents is known, so nothing about them is asserted: no agent list, no counts, no
 * "last activity" and explicitly no zeros. `scope` names which half failed so the
 * console can say whether the registry or the run log is the broken one.
 */
function queryFailed(
    module: string | null,
    scope: 'registry' | 'runs',
    error: { code?: string | null; message?: string | null } | null,
) {
    return NextResponse.json(
        {
            ok: false,
            // The tables ARE there — this is not the migration state.
            provisioned: true,
            error: {
                scope,
                code: error?.code ?? null,
                message: error?.message ?? 'The query failed without a message.',
            },
            reason:
                scope === 'registry'
                    ? 'The agent registry could not be read, so nothing is known about this organisation\u2019s agents.'
                    : 'The agent run log could not be read, so agent activity is UNKNOWN. This is not the same as no activity.',
            module,
            // null, not [] and not 0: absence of an answer, not an answer of absence.
            agents: null,
            modules: null,
            runs_today: null,
            last_activity_at: null,
            totals: null,
        },
        { status: 500 },
    );
}

/** Later of two nullable ISO timestamps. */
function latest(a: string | null, b: string | null): string | null {
    if (!a) return b;
    if (!b) return a;
    return a > b ? a : b;
}

export async function GET(request: NextRequest) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        const { searchParams } = new URL(request.url);
        const orgId = searchParams.get('orgId') || searchParams.get('org_id') || searchParams.get('organization_id');
        if (!orgId) return NextResponse.json({ error: 'orgId required' }, { status: 400 });

        const moduleFilter = searchParams.get('module');

        const todayStart = getISTDateBounds('today').start;
        const windowStart = new Date(Date.now() - WINDOW_DAYS * 86400000).toISOString();
        const nowMs = Date.now();

        // ---- Query 1: the registry. Small, and already carries liveness.
        const registryQ = supabase
            .from('oem_agents')
            .select('agent_key, display_name, department, status, health_state, last_heartbeat_at, coins_balance, config, runtime')
            .eq('organization_id', orgId)
            .neq('status', 'retired')
            .order('agent_key');

        // ---- Query 2: the run window. Five columns, newest first, capped.
        let runsQ = supabase
            .from('oem_agent_runs')
            .select('agent_key, module, status, started_at, outcome_summary, error')
            .eq('organization_id', orgId)
            .gte('started_at', windowStart)
            .order('started_at', { ascending: false })
            .limit(RUN_ROW_CEILING);
        if (moduleFilter) runsQ = runsQ.eq('module', moduleFilter);

        const [registryRes, runsRes] = await Promise.all([registryQ, runsQ]);

        // The registry predates this migration, so a missing REGISTRY means the
        // whole OEM stack is absent; a missing RUNS table means only the runtime
        // half is. Both render the same calm unprovisioned state.
        if (isNotProvisionedError(registryRes.error) || isNotProvisionedError(runsRes.error)) {
            return notProvisioned(moduleFilter);
        }
        // Both errors are checked. The run query's error used to be dropped here,
        // and `runsRes.data ?? []` then turned it into an empty run history — every
        // agent reported as having done nothing today, on every module tab, because
        // one query failed.
        if (registryRes.error) return queryFailed(moduleFilter, 'registry', registryRes.error);
        if (runsRes.error) return queryFailed(moduleFilter, 'runs', runsRes.error);

        const registry = (registryRes.data ?? []) as Record<string, unknown>[];
        const runs = (runsRes.data ?? []) as Record<string, unknown>[];

        // Registry lookup, plus each agent's DECLARED module — the fallback that
        // lets a freshly registered agent appear on its module's card before it
        // has ever run. Without it a new agent is invisible until first execution,
        // which is exactly the moment an operator is looking for it.
        const byKey = new Map<string, Record<string, unknown>>();
        const declaredModule = new Map<string, string>();
        for (const a of registry) {
            const key = a.agent_key as string;
            byKey.set(key, a);
            const cfg = (a.config ?? {}) as Record<string, unknown>;
            const rt = (a.runtime ?? {}) as Record<string, unknown>;
            const declared = (cfg.module ?? rt.module ?? cfg.default_module) as string | undefined;
            if (typeof declared === 'string' && declared) declaredModule.set(key, declared);
        }

        // ---- One pass over the runs. Bucket by (module, agent_key). Because the
        //      rows arrive newest-first, the FIRST row seen for a bucket is that
        //      bucket's latest run — no sorting, no max() per agent.
        const buckets = new Map<string, PulseAgent>();
        // Module slugs and agent keys are lowercase identifiers, so "::" cannot collide.
        const bucketKey = (m: string, k: string) => `${m}::${k}`;

        function ensureBucket(moduleSlug: string, key: string): PulseAgent {
            const id = bucketKey(moduleSlug, key);
            let b = buckets.get(id);
            if (b) return b;

            const reg = byKey.get(key);
            const rt = (reg?.runtime ?? {}) as Record<string, unknown>;
            const lastBeat = (reg?.last_heartbeat_at as string) ?? null;
            const intervalSec = Number(rt.heartbeat_interval_sec) > 0
                ? Number(rt.heartbeat_interval_sec)
                : DEFAULT_HEARTBEAT_INTERVAL_SEC;
            const ageSec = lastBeat
                ? Math.max(0, Math.round((nowMs - new Date(lastBeat).getTime()) / 1000))
                : null;

            b = {
                agent_key: key,
                display_name: (reg?.display_name as string) ?? key,
                department: (reg?.department as string) ?? null,
                status: (reg?.status as string) ?? 'unknown',
                module: moduleSlug,
                health_state: (reg?.health_state as AgentHealthState) ?? 'unknown',
                last_heartbeat_at: lastBeat,
                heartbeat_age_sec: ageSec,
                heartbeat_stale: ageSec !== null && ageSec > intervalSec * STALE_BEAT_MULTIPLE,
                last_run_at: null,
                last_outcome: null,
                last_status: null,
                runs_today: 0,
                runs_window: 0,
                failures_today: 0,
                coins_balance: Number(reg?.coins_balance ?? 0),
            };
            buckets.set(id, b);
            return b;
        }

        for (const r of runs) {
            const key = r.agent_key as string;
            const slug = (r.module as string) || declaredModule.get(key) || UNASSIGNED;
            const b = ensureBucket(slug, key);
            const startedAt = r.started_at as string;

            b.runs_window += 1;
            if (b.last_run_at === null) {
                // Newest-first ordering: this is the latest run for the bucket.
                b.last_run_at = startedAt;
                b.last_status = (r.status as string) ?? null;
                b.last_outcome = (r.outcome_summary as string) || (r.error as string) || null;
            }
            if (startedAt >= todayStart) {
                b.runs_today += 1;
                if (r.status === 'failed' || r.status === 'timeout') b.failures_today += 1;
            }
        }

        // Registered agents that did not run in the window still belong on their
        // module's card — showing zero is information; showing nothing is not.
        for (const a of registry) {
            const key = a.agent_key as string;
            const declared = declaredModule.get(key);
            if (moduleFilter) {
                if (declared === moduleFilter) ensureBucket(moduleFilter, key);
                continue;
            }
            const alreadyPlaced = [...buckets.values()].some((b) => b.agent_key === key);
            if (!alreadyPlaced) ensureBucket(declared || UNASSIGNED, key);
        }

        // ---- Roll up by module.
        const modules: Record<string, {
            module: string;
            label: string;
            agents: PulseAgent[];
            agent_count: number;
            runs_today: number;
            runs_window: number;
            failures_today: number;
            last_activity_at: string | null;
            /** True when any agent on this module is down or has gone quiet. */
            needs_attention: boolean;
        }> = {};

        for (const b of buckets.values()) {
            let m = modules[b.module];
            if (!m) {
                m = modules[b.module] = {
                    module: b.module,
                    label: isAgentModule(b.module)
                        ? AGENT_MODULE_LABELS[b.module]
                        : b.module === UNASSIGNED ? 'Unassigned' : b.module,
                    agents: [],
                    agent_count: 0,
                    runs_today: 0,
                    runs_window: 0,
                    failures_today: 0,
                    last_activity_at: null,
                    needs_attention: false,
                };
            }
            m.agents.push(b);
            m.agent_count += 1;
            m.runs_today += b.runs_today;
            m.runs_window += b.runs_window;
            m.failures_today += b.failures_today;
            m.last_activity_at = latest(m.last_activity_at, b.last_run_at);
            if (b.health_state === 'down' || b.heartbeat_stale || b.failures_today > 0) {
                m.needs_attention = true;
            }
        }

        for (const m of Object.values(modules)) {
            // Loudest first: most recent movement at the top of each card.
            m.agents.sort((x, y) => (y.last_run_at ?? '').localeCompare(x.last_run_at ?? ''));
        }

        const allAgents = [...buckets.values()];
        const totalsRunsToday = allAgents.reduce((n, a) => n + a.runs_today, 0);
        const lastActivityAt = allAgents.reduce<string | null>((acc, a) => latest(acc, a.last_run_at), null);

        // When ?module= is given the flat fields ARE the answer; `modules` still
        // comes back (with one key) so a single client renderer handles both calls.
        const scoped = moduleFilter ? modules[moduleFilter] : null;

        const response = NextResponse.json({
            ok: true,
            provisioned: true,
            as_of: new Date().toISOString(),
            window: { since: windowStart, days: WINDOW_DAYS, today_start_ist: todayStart },
            runs_sampled: runs.length,
            runs_truncated: runs.length >= RUN_ROW_CEILING,

            module: moduleFilter,
            agents: moduleFilter ? (scoped?.agents ?? []) : allAgents,
            runs_today: moduleFilter ? (scoped?.runs_today ?? 0) : totalsRunsToday,
            last_activity_at: moduleFilter ? (scoped?.last_activity_at ?? null) : lastActivityAt,

            modules,
            // Totals honour the ?module= filter: with a module set they describe that
            // module, not the org. `scope` says which, so a card cannot accidentally
            // present one module's numbers as the portfolio's.
            totals_scope: moduleFilter ?? 'organization',
            totals: {
                agents: allAgents.length,
                live_agents: allAgents.filter((a) => a.status === 'live').length,
                runs_today: totalsRunsToday,
                failures_today: allAgents.reduce((n, a) => n + a.failures_today, 0),
                modules_with_movement: Object.values(modules).filter((m) => m.runs_today > 0).length,
                needs_attention: Object.values(modules).filter((m) => m.needs_attention).map((m) => m.module),
                last_activity_at: lastActivityAt,
            },
        });

        // Called from many surfaces at once. Private because it is session-scoped;
        // 30s because agent movement is interesting at that resolution, not faster.
        response.headers.set('Cache-Control', 'private, max-age=30, stale-while-revalidate=60');
        return response;
    } catch (e) {
        // Same contract as queryFailed: unknown, not empty.
        return NextResponse.json(
            {
                ok: false,
                provisioned: true,
                error: { scope: 'request', code: null, message: (e as Error).message },
                reason: 'The agent pulse request failed, so agent activity is UNKNOWN.',
                agents: null,
                modules: null,
                runs_today: null,
                last_activity_at: null,
                totals: null,
            },
            { status: 500 },
        );
    }
}
