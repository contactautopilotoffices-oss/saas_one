import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';
import {
    resolveCommandCenterAccess, isCommandCenterAccessError, readOrgId,
} from '@/backend/lib/commandCenter/access';
import { getISTDateBounds } from '@/backend/utils/timezone';
import {
    AGENT_MODULE_LABELS,
    AGENT_RUNTIME_MIGRATION,
    isAgentModule,
    isNotProvisionedError,
    type AgentHealthState,
} from '@/frontend/types/agentRuntime';

/**
 * GET /api/agents/summary?org_id=… — what each agentic employee actually did today.
 *
 * WHY THIS FILE WAS REWRITTEN
 * =============================================================================
 * It used to return `getDailyTasks()` from backend/lib/ira/tasks.ts — a HARDCODED 26-row
 * seed, identical for every organization — under an agent named Ira marked `configured:
 * true`. The Command Center then rendered those figures with a green "Live" provenance
 * tag on the org head's dashboard. That is the worst class of defect in a reporting
 * surface: not a missing number, but a fabricated one wearing the badge that says it is
 * real, on the screen where decisions get made.
 *
 * Every figure below now comes from two tables and nowhere else:
 *
 *   oem_agents      the registry — who exists, what state they are in, are they beating
 *   oem_agent_runs  the execution log — what actually ran, what it cost, did it work
 *
 * There is no seed, no fallback and no demo path. If the tables are empty the response
 * says so with zeros against a real registry, and if the migration is not applied it says
 * that instead.
 *
 * SCOPING. Rows are scoped to `access.organizationId` — the org the caller is actually
 * allowed to read, resolved by the same guard the rest of the Command Center uses. The
 * previous seed was org-independent, so two different organizations saw the same 26 rows.
 *
 * `configured` IS STILL THE DISCRIMINATOR, and still for the original reason: an agent
 * with no runtime and no history has no zero to report. Zero done / zero pending reads as
 * "it finished its day", which is a different claim and a false one. Such an agent comes
 * back with `configured: false`, a reason, and no counts at all — the union makes the
 * wrong render unrepresentable rather than merely discouraged.
 *
 * TODAY is the IST calendar day, matching /api/agents/pulse — an operator in Mumbai
 * reading "12 runs today" means since they woke up, not since UTC midnight.
 *
 * Degrades to HTTP 200 { provisioned: false } until 20260830000001_agent_runtime is
 * applied, so the console renders a calm setup state instead of an error boundary.
 *
 * THREE STATES, NEVER TWO. This endpoint answers a question about work that either
 * happened or did not, so an UNKNOWN must never be printed as a zero:
 *
 *   (i)   the migration is not applied  -> HTTP 200 { ok: true, provisioned: false }.
 *         A known state, honestly reported: the tables are not there, nothing has run.
 *   (ii)  a GENUINE query error         -> ok: false, a scoped *_error, and NULL metrics.
 *         The tables ARE there and the read still failed (permission, timeout, bad
 *         filter, connection). Nothing is known, so nothing is asserted — no counts,
 *         no totals, and explicitly no zeros.
 *   (iii) the query succeeded and found nothing -> real zeros. That IS an answer.
 *
 * WHICH QUERY FAILED DECIDES HOW MUCH IS LOST, and therefore the status code — the
 * same split /api/agents/pulse and /api/agents/runs already use:
 *   - the REGISTRY is the primary read; without it there is no answer at all, so that
 *     is HTTP 500 with every field null, exactly as pulse does.
 *   - the RUN LOG is a second query and costs only the run-derived HALF of the payload.
 *     The registry half is still true, so the response stays HTTP 200, carries the real
 *     agents, sets `runs_error`, and nulls every run-derived field — the same
 *     partial-failure contract /api/agents/runs uses for its `totals` / `totals_error`.
 *
 * THE BUG THIS REPLACED. `runsRes.error` was tested for the missing-table codes and then
 * dropped on the floor; `runsRes.data ?? []` turned a failed read into an empty run
 * history, and every agent came back configured:true, source:'oem_agent_runs',
 * counts { today: 0, succeeded: 0, failed: 0 } with zeroed totals. A database error was
 * rendered as a confident "the workforce did nothing today".
 */

export const dynamic = 'force-dynamic';

/** Days of history fetched so an agent that ran yesterday is not reported as never-run. */
const WINDOW_DAYS = 7;
/** PostgREST truncates an unbounded select at 1000 rows without saying so. */
const RUN_ROW_CEILING = 2000;

interface RunCounts {
    today: number;
    succeeded: number;
    failed: number;
    running: number;
    window: number;
}

interface AgentAccumulator {
    counts: RunCounts;
    tokens_in: number;
    tokens_out: number;
    cost_inr: number;
    last_run_at: string | null;
    last_status: string | null;
    last_outcome: string | null;
    last_module: string | null;
}

function emptyAccumulator(): AgentAccumulator {
    return {
        counts: { today: 0, succeeded: 0, failed: 0, running: 0, window: 0 },
        tokens_in: 0,
        tokens_out: 0,
        cost_inr: 0,
        last_run_at: null,
        last_status: null,
        last_outcome: null,
        last_module: null,
    };
}

function num(v: unknown): number {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
}

function moduleLabel(module: string | null): string | null {
    if (!module) return null;
    return isAgentModule(module) ? AGENT_MODULE_LABELS[module] : module.replace(/_/g, ' ');
}

export async function GET(request: NextRequest) {
    const access = await resolveCommandCenterAccess(request, readOrgId(request));
    if (isCommandCenterAccessError(access)) return access;
    const orgId = access.organizationId;

    const notProvisioned = NextResponse.json({
        // A known state, honestly reported, so `ok` stays true.
        ok: true,
        provisioned: false,
        migration: AGENT_RUNTIME_MIGRATION,
        reason: `Agent runtime is not set up yet — apply ${AGENT_RUNTIME_MIGRATION}.sql.`,
        generatedAt: new Date().toISOString(),
        organizationId: orgId,
        agents: [],
        // Real zeros, not nulls. This is state (i): the tables are known not to be
        // there, so nothing has been registered and nothing has run — that IS the
        // answer, and it is the same one /api/agents/pulse and /api/agents/runs give
        // in this state. Null is reserved for state (ii), where nothing is known.
        totals: {
            agents: 0,
            live_agents: 0,
            runs_today: 0,
            succeeded_today: 0,
            failed_today: 0,
            running_now: 0,
            tokens_in_window: 0,
            tokens_out_window: 0,
            cost_inr_window: 0,
        },
        runs_error: null,
    });

    /**
     * A GENUINE failure of the PRIMARY read. The registry is what every row below is
     * built from, so losing it loses the whole answer: no agent list, no totals, and
     * explicitly no zeros. Same body and same status as /api/agents/pulse.
     */
    const registryFailed = (error: { code?: string | null; message?: string | null } | null) =>
        NextResponse.json(
            {
                ok: false,
                // The table IS there — this is not the migration state.
                provisioned: true,
                error: {
                    scope: 'registry' as const,
                    code: error?.code ?? null,
                    message: error?.message ?? 'The query failed without a message.',
                },
                reason:
                    'The agent registry could not be read, so nothing is known about this '
                    + 'organisation’s agents.',
                generatedAt: new Date().toISOString(),
                organizationId: orgId,
                // null, not []: absence of an answer, not an answer of absence.
                agents: null,
                totals: null,
                runs_error: null,
            },
            { status: 500 },
        );

    try {
        const supabase = await createClient();
        const todayStart = getISTDateBounds('today').start;
        const windowStart = new Date(Date.now() - WINDOW_DAYS * 86400000).toISOString();

        const [registryRes, runsRes] = await Promise.all([
            supabase
                .from('oem_agents')
                .select('agent_key, display_name, department, role_description, status, health_state, last_heartbeat_at, coins_balance, config, runtime')
                .eq('organization_id', orgId)
                .neq('status', 'retired')
                .order('agent_key'),
            supabase
                .from('oem_agent_runs')
                .select('agent_key, module, status, started_at, outcome_summary, error, tokens_in, tokens_out, cost_inr')
                .eq('organization_id', orgId)
                .gte('started_at', windowStart)
                .order('started_at', { ascending: false })
                .limit(RUN_ROW_CEILING),
        ]);

        // A missing registry means the whole OEM stack is absent; a missing runs table
        // means only the runtime half is. Both render the same calm setup state.
        if (isNotProvisionedError(registryRes.error) || isNotProvisionedError(runsRes.error)) {
            return notProvisioned;
        }
        if (registryRes.error) return registryFailed(registryRes.error);

        // BOTH errors are now consumed. Anything still on `runsRes.error` here is a
        // GENUINE failure of an existing table, and it makes the run-derived half of
        // this payload unknown — not empty. `runs` is left empty only so the fold below
        // has something to iterate; nothing derived from it is reported while this is
        // true. See the header.
        const runsUnreadable = !!runsRes.error;
        const runsError = runsUnreadable
            ? {
                scope: 'runs' as const,
                code: runsRes.error?.code ?? null,
                message: runsRes.error?.message ?? 'The query failed without a message.',
                reason:
                    'The agent run log could not be read, so what each agent did today is '
                    + 'UNKNOWN. This is not the same as no activity. Render every run-derived '
                    + 'figure as — , never as 0.',
            }
            : null;

        const registry = (registryRes.data ?? []) as Record<string, unknown>[];
        const runs = runsUnreadable ? [] : ((runsRes.data ?? []) as Record<string, unknown>[]);

        // One pass. Rows arrive newest-first, so the FIRST row seen for an agent is its
        // latest run — no per-agent max() and no second query.
        const acc = new Map<string, AgentAccumulator>();
        for (const r of runs) {
            const key = r.agent_key as string;
            let a = acc.get(key);
            if (!a) { a = emptyAccumulator(); acc.set(key, a); }

            const startedAt = r.started_at as string;
            const status = (r.status as string) ?? 'unknown';

            a.counts.window += 1;
            a.tokens_in += num(r.tokens_in);
            a.tokens_out += num(r.tokens_out);
            a.cost_inr += num(r.cost_inr);

            if (a.last_run_at === null) {
                a.last_run_at = startedAt;
                a.last_status = status;
                a.last_outcome = (r.outcome_summary as string) || (r.error as string) || null;
                a.last_module = (r.module as string) ?? null;
            }

            if (startedAt >= todayStart) {
                a.counts.today += 1;
                if (status === 'succeeded') a.counts.succeeded += 1;
                else if (status === 'failed' || status === 'timeout') a.counts.failed += 1;
                else if (status === 'running') a.counts.running += 1;
            }
        }

        /** Agent keys whose counts are real and therefore belong in the totals. */
        const countedKeys: string[] = [];

        const agents = registry.map((row) => {
            const key = row.agent_key as string;
            const cfg = (row.config ?? {}) as Record<string, unknown>;
            const rt = (row.runtime ?? {}) as Record<string, unknown>;
            const a = acc.get(key);
            const status = (row.status as string) ?? 'draft';
            const declared = (cfg.module ?? rt.module ?? cfg.default_module) as string | undefined;
            // With the run log unreadable there is no OBSERVED module, only a declared one.
            const module = (runsUnreadable ? null : a?.last_module ?? null)
                ?? (typeof declared === 'string' ? declared : null);

            const base = {
                key,
                name: (row.display_name as string) ?? key,
                department: (row.department as string) ?? null,
                role: (row.role_description as string) ?? (row.department as string) ?? 'Agentic employee',
                status,
                module,
                moduleLabel: moduleLabel(module),
                health_state: ((row.health_state as AgentHealthState) ?? 'unknown'),
                last_heartbeat_at: (row.last_heartbeat_at as string) ?? null,
                /** False = every field below that came from the run log is unknown. */
                runs_readable: !runsUnreadable,
            };

            // THE RUN LOG COULD NOT BE READ. Everything in `base` is registry-derived and
            // still true. Everything below would have come from the run log, so it is
            // unknown — including `configured`, because "has never executed" is itself a
            // claim about the run log and this endpoint is in no position to make it.
            if (runsUnreadable) {
                return {
                    ...base,
                    configured: 'unknown' as const,
                    reason:
                        `The run log could not be read, so what ${base.name} did is UNKNOWN. `
                        + 'That is not the same as nothing.',
                    counts: null,
                    last_run: null,
                    tokens: null,
                    cost_inr: null,
                    // Registry-derived, so still real.
                    coins_balance: num(row.coins_balance),
                };
            }

            // NO COUNTS for an agent that has never executed and has never been let out of
            // draft. See the header note: a zero here would read as a finished day.
            const everRan = (a?.counts.window ?? 0) > 0;
            const released = status === 'live' || status === 'shadow' || status === 'paused';
            if (!everRan && !released) {
                return {
                    ...base,
                    configured: false as const,
                    reason: `${base.name} is registered but has never executed and is still in ${status}. There is nothing to count yet.`,
                };
            }

            const c = a?.counts ?? { today: 0, succeeded: 0, failed: 0, running: 0, window: 0 };
            countedKeys.push(key);
            return {
                ...base,
                configured: true as const,
                source: 'oem_agent_runs',
                counts: c,
                last_run: a?.last_run_at
                    ? { at: a.last_run_at, status: a.last_status, outcome: a.last_outcome }
                    : null,
                tokens: { in: a?.tokens_in ?? 0, out: a?.tokens_out ?? 0 },
                cost_inr: Math.round((a?.cost_inr ?? 0) * 100) / 100,
                coins_balance: num(row.coins_balance),
            };
        });

        // Totals are summed straight off the accumulator rather than off the shaped
        // agents, so the "counts exist" question is asked in exactly one place.
        const sumCounted = (pick: (a: AgentAccumulator) => number) =>
            countedKeys.reduce((n, k) => {
                const a = acc.get(k);
                return n + (a ? pick(a) : 0);
            }, 0);

        const totals = {
            // Registry-derived: true whatever the run log did.
            agents: agents.length,
            live_agents: agents.filter((x) => x.status === 'live').length,
            // Run-derived: null, never 0, when the run log could not be read.
            runs_today: runsUnreadable ? null : sumCounted((a) => a.counts.today),
            succeeded_today: runsUnreadable ? null : sumCounted((a) => a.counts.succeeded),
            failed_today: runsUnreadable ? null : sumCounted((a) => a.counts.failed),
            running_now: runsUnreadable ? null : sumCounted((a) => a.counts.running),
            tokens_in_window: runsUnreadable ? null : sumCounted((a) => a.tokens_in),
            tokens_out_window: runsUnreadable ? null : sumCounted((a) => a.tokens_out),
            cost_inr_window: runsUnreadable
                ? null
                : Math.round(sumCounted((a) => a.cost_inr) * 100) / 100,
        };

        return NextResponse.json({
            // false = the run-derived half of this payload is UNKNOWN. The agents listed
            // are real; every field they mark runs_readable:false is not an answer.
            ok: !runsUnreadable,
            provisioned: true,
            generatedAt: new Date().toISOString(),
            organizationId: orgId,
            window: { since: windowStart, days: WINDOW_DAYS, today_start_ist: todayStart },
            runs_sampled: runsUnreadable ? null : runs.length,
            runs_truncated: runsUnreadable ? null : runs.length >= RUN_ROW_CEILING,
            runs_error: runsError,
            totals,
            agents,
        });
    } catch (e) {
        // Same contract as registryFailed: unknown, not empty.
        return NextResponse.json(
            {
                ok: false,
                provisioned: true,
                error: { scope: 'request' as const, code: null, message: (e as Error).message },
                reason: 'The agent summary request failed, so agent activity is UNKNOWN.',
                generatedAt: new Date().toISOString(),
                organizationId: orgId,
                agents: null,
                totals: null,
                runs_error: null,
            },
            { status: 500 },
        );
    }
}
