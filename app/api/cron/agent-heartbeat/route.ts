import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import {
    beat,
    reapStaleRuns,
    ABANDONED_ERROR_CLASS,
    DEFAULT_ABANDON_AFTER_SEC,
} from '@/backend/lib/agents/runtime';
import { LLM_RUNTIME_ENV_NAME, readAgentSecret } from '@/app/api/agents/credentials/secretStore';
import { isBolnaConfigured } from '@/backend/services/bolnaService';
import { isMockLlm } from '@/backend/lib/council/llm';
import {
    AGENT_RUNTIME_MIGRATION,
    isNotProvisionedError,
    type AgentHeartbeatReason,
    type AgentHeartbeatState,
    type AgentQuietHours,
    type AgentRuntimeConfig,
} from '@/frontend/types/agentRuntime';

/**
 * GET /api/cron/agent-heartbeat  —  every 10 minutes (vercel.json).
 *
 * THE UPTIME PRODUCER. oem_agent_profile.uptime_pct is computed from
 * oem_agent_heartbeats; without this cron that view is NULL forever and the
 * console shows an agent roster with no pulse.
 *
 * Every beat is DERIVED, never assumed. A heartbeat that always says 'up' is a
 * decoration, so each state here traces to something checkable:
 *
 *   down     'cost_cap_exceeded'    24h spend >= runtime.max_cost_inr_per_day
 *            'llm_key_missing'      no key can be OBTAINED for the LLM path
 *            'no_active_bundle'     no oem_agent_bundles row with is_active
 *            'no_goals_bound'       no active agent-level oem_goals row
 *            'bolna_not_configured' the agent has a voice/telephony credential
 *                                   but BOLNA_API_KEY/BOLNA_AGENT_ID are unset
 *   degraded 'mock_llm'             COUNCIL_MOCK_LLM=1 — it would answer canned
 *            'quiet_hours'          inside runtime.quiet_hours right now
 *            'cost_cap_near'        24h spend >= 80% of the daily cap
 *   up       'ok'                   none of the above
 *
 * Every failing condition (not just the winning one) goes into the beat's
 * `detail`, so the console can show the whole picture rather than one label.
 *
 * ---------------------------------------------------------------------------
 * WHAT 'llm_key_missing' IS DERIVED FROM — read this before changing it.
 *
 * It is NOT "an 'llm' credential row exists". A row is not a key. This cron
 * previously suppressed the blocker on row presence alone, which meant an agent
 * whose stored credential could not be resolved was reported 'up'. That is the
 * worst failure mode a health check has: confidently wrong in the safe
 * direction.
 *
 * A key can ACTUALLY be obtained when either
 *
 *   (1) process.env[LLM_RUNTIME_ENV_NAME] is set — that variable is the ONE
 *       thing councilChat() reads (backend/lib/council/llm.ts:172), and it
 *       takes no per-agent key; or
 *   (2) the agent's 'llm' credential RESOLVES through readAgentSecret() — an
 *       actual resolution, executed here, not inferred — AND names that same
 *       variable, because a resolvable GROQ_API_KEY cannot help a caller that
 *       only ever reads OPENAI_API_KEY.
 *
 * The resolved value is discarded immediately; only the boolean survives, and
 * neither the response nor the beat detail carries any part of it.
 *
 * Condition (2) implies (1) on today's execution path, so the probe cannot flip
 * a verdict — it is here so the claim is CHECKED rather than assumed, and so
 * the `checked` detail reports the true resolution state of the credential an
 * operator can see in the console. If councilChat() ever accepts a key
 * argument, (2) becomes load-bearing on its own and this comment is the place
 * that says so.
 * ---------------------------------------------------------------------------
 * TRUNCATION. Every list read here is PAGED to exhaustion, not capped at
 * PostgREST's default window. It matters more than it looks: a bundles page cut
 * at 1,000 rows would report 'no_active_bundle' — a DOWN state — for every
 * agent past the cut. When a sweep does stop early (the page budget below), the
 * response and the logs say which source was partial, and the affected facts
 * are reported as UNKNOWN rather than false. See `sweep_complete` / `truncated`.
 *
 * ---------------------------------------------------------------------------
 * SECOND JOB: THE REAPER. After the beats are written, this cron settles runs
 * that died without reporting — status 'timeout', error_class 'abandoned'.
 * See reapStaleRuns() in backend/lib/agents/runtime.ts for the full rationale:
 * what it refuses to write ('succeeded'/'failed' — it does not know which), and
 * what a reap does NOT fix (the run_key stays deduped for the retry).
 * It lives here because this is the sweep that already runs every 10 minutes
 * and already holds every agent's runtime config (which carries timeout_sec).
 * It runs LAST so a reaper failure can never cost the sweep its heartbeats, and
 * it is reported separately in `reaped` — never folded into `recorded`.
 * ---------------------------------------------------------------------------
 * Cost: 5 paged sweeps plus one credential resolution per agent that has an
 * 'llm' credential row (capped by MAX_LLM_PROBES), plus one bounded reaper scan
 * and one conditional update per run it settles (normally zero).
 *
 * Degrades silently before supabase/migrations/20260830000001_agent_runtime.sql
 * is applied: HTTP 200 with provisioned:false and no beats. A beat that fails
 * for a NON-schema reason is reported as beats_failed, NOT as provisioned:false
 * — telling an operator to run a migration they already ran sends them down the
 * wrong path.
 */

export const dynamic = 'force-dynamic';

/** Live agents only. 'draft', 'paused' and 'retired' are not expected to have a pulse. */
const BEATING_STATUSES = ['live', 'shadow'] as const;

/**
 * Timezone assumed when an agent's runtime config sets quiet hours but no
 * timezone. Every site this platform runs is in India. The assumption is
 * reported in the beat detail as timezone_assumed so it is never invisible.
 */
const FALLBACK_TZ = 'Asia/Kolkata';

/** Spend window for the daily cap. A rolling 24h, so no timezone can lie about it. */
const COST_WINDOW_HOURS = 24;

/** Below this fraction of the cap we are fine; at or above it, degraded. */
const COST_NEAR_FRACTION = 0.8;

/**
 * Used only for runs that recorded cost_usd and no cost_inr. Mirrors
 * backend/lib/agents/runtime.ts, which fills cost_inr from cost_usd at the same
 * rate when a producer reports only USD. Kept in sync by name, not by import,
 * because runtime.ts does not export it.
 */
const USD_INR = Number(process.env.AGENT_USD_INR || 88);

/** Rows per page, and the hard stop that keeps a runaway table from hanging the cron. */
const PAGE_SIZE = 1000;
const MAX_PAGES = 25;

/** Ceiling on credential resolutions per invocation. See MAX_LLM_PROBES use below. */
const MAX_LLM_PROBES = 200;

interface AgentRow {
    organization_id: string;
    agent_key: string;
    display_name: string | null;
    status: string;
    runtime: AgentRuntimeConfig | null;
}

const key = (orgId: string, agentKey: string) => `${orgId}:${agentKey}`;

/* ---------------------------------------------------------------------------
 * PAGED READ
 *
 * `complete` is the whole point of this helper. A caller that ignores it is
 * back to reporting a partial sweep as a full one.
 * ------------------------------------------------------------------------- */
interface Sweep<T> {
    rows: T[];
    complete: boolean;
    error: unknown;
}

async function sweep<T>(
    label: string,
    page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<Sweep<T>> {
    const rows: T[] = [];
    for (let p = 0; p < MAX_PAGES; p++) {
        const from = p * PAGE_SIZE;
        const { data, error } = await page(from, from + PAGE_SIZE - 1);
        // An error mid-sweep leaves rows PARTIAL. Never report those as whole.
        if (error) return { rows, complete: false, error };
        const batch = data ?? [];
        rows.push(...batch);
        if (batch.length < PAGE_SIZE) return { rows, complete: true, error: null };
    }
    console.error(
        `[agent-heartbeat] ${label}: stopped at the ${MAX_PAGES * PAGE_SIZE}-row page budget. This sweep is PARTIAL; the response reports it as truncated.`,
    );
    return { rows, complete: false, error: null };
}

/** 'HH:MM' → minutes since midnight, or null when unparseable. */
function toMinutes(hhmm: string | undefined): number | null {
    if (!hhmm) return null;
    const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
    if (!m) return null;
    const h = Number(m[1]);
    const min = Number(m[2]);
    if (h > 23 || min > 59) return null;
    return h * 60 + min;
}

/** Local wall-clock minutes in `tz` right now; null when the tz is not valid. */
function nowMinutesIn(tz: string): number | null {
    try {
        const formatted = new Intl.DateTimeFormat('en-GB', {
            timeZone: tz,
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
        }).format(new Date());
        return toMinutes(formatted);
    } catch {
        return null;
    }
}

/** True/false when it can be decided, null when quiet hours are not configured or unreadable. */
function inQuietHours(quiet: AgentQuietHours | undefined, tz: string): boolean | null {
    const from = toMinutes(quiet?.from);
    const to = toMinutes(quiet?.to);
    if (from === null || to === null || from === to) return null;
    const now = nowMinutesIn(tz);
    if (now === null) return null;
    // Wraps past midnight when from > to ('22:00' → '06:00').
    return from < to ? now >= from && now < to : now >= from || now < to;
}

export async function GET(request: NextRequest) {
    try {
        // AUTH. The majority of this repo's crons (21 of 28 under app/api/cron/)
        // compare the header against `Bearer ${process.env.CRON_SECRET}`; five
        // guard only when the variable is set. This route keeps the majority's
        // INTENT — a deployment with no CRON_SECRET refuses everyone — but not
        // the majority's expression, because that expression has a hole:
        //
        //   `Bearer ${undefined}`  ===  'Bearer undefined'
        //
        // With CRON_SECRET unset, a request whose header is literally
        // `Authorization: Bearer undefined` passes. A missing secret must never
        // become a known password, so the variable is read ONCE, checked for
        // presence FIRST, and no comparison string is ever built out of it while
        // it is undefined.
        //
        // The 401 body is identical either way: an unauthenticated caller is not
        // told whether the deployment is misconfigured. The operator learns it
        // from the server log.
        const cronSecret = process.env.CRON_SECRET;
        if (!cronSecret) {
            console.error(
                '[agent-heartbeat] CRON_SECRET is not set on this deployment. Refusing every '
                + 'request, including Vercel\'s own scheduler: no heartbeat is being recorded '
                + 'and no stale run is being reaped until the variable is configured.',
            );
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
        const authHeader = request.headers.get('authorization');
        if (authHeader !== `Bearer ${cronSecret}`) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // ---- 1. Who should be beating.
        const agentSweep = await sweep<AgentRow>('agents', (from, to) =>
            supabaseAdmin
                .from('oem_agents')
                .select('organization_id, agent_key, display_name, status, runtime')
                .in('status', BEATING_STATUSES as unknown as string[])
                // Paging needs a stable order. (organization_id, agent_key) is
                // unique per live agent, so no row can straddle a page boundary.
                .order('organization_id')
                .order('agent_key')
                .range(from, to));

        if (agentSweep.error) {
            if (isNotProvisionedError(agentSweep.error)) {
                return NextResponse.json({
                    provisioned: false,
                    migration: AGENT_RUNTIME_MIGRATION,
                    agents: 0,
                    recorded: 0,
                    beats: [],
                });
            }
            throw agentSweep.error;
        }

        const agents = agentSweep.rows;
        if (agents.length === 0) {
            // Still reap. A run can outlive the agent that opened it — retire or
            // pause the agent after its job died and the stuck row would
            // otherwise be unreachable forever. No agent config to read here, so
            // every candidate is judged by the documented default threshold.
            const orphanReap = await reapStaleRuns();
            return NextResponse.json({
                provisioned: true,
                agents: 0,
                recorded: 0,
                beats: [],
                note: 'No oem_agents row is live or shadow, so there is nothing to beat for.',
                reaped: {
                    settled: orphanReap.settled,
                    scanned: orphanReap.scanned,
                    stale: orphanReap.stale,
                    raced: orphanReap.raced,
                    failed: orphanReap.failed,
                    complete: orphanReap.complete,
                    provisioned: !orphanReap.notProvisioned,
                    errored: orphanReap.errored,
                    default_threshold_sec: DEFAULT_ABANDON_AFTER_SEC,
                    error_class: ABANDONED_ERROR_CLASS,
                },
            });
        }

        const orgIds = [...new Set(agents.map((a) => a.organization_id))];
        const since = new Date(Date.now() - COST_WINDOW_HOURS * 3600_000).toISOString();

        // ---- 2..5. Everything the derivation needs. Each one paged to exhaustion.
        const [bundleSweep, goalSweep, credSweep, runSweep] = await Promise.all([
            sweep<{ organization_id: string; agent_key: string }>('bundles', (from, to) =>
                supabaseAdmin
                    .from('oem_agent_bundles')
                    .select('organization_id, agent_key')
                    .eq('is_active', true)
                    .in('organization_id', orgIds)
                    .order('organization_id').order('agent_key')
                    .range(from, to)),
            sweep<{ organization_id: string; agent_key: string | null }>('goals', (from, to) =>
                supabaseAdmin
                    .from('oem_goals')
                    .select('organization_id, agent_key')
                    .eq('status', 'active')
                    .not('agent_key', 'is', null)
                    .in('organization_id', orgIds)
                    .order('organization_id').order('agent_key')
                    .range(from, to)),
            sweep<{ organization_id: string; agent_key: string; purpose: string; secret_ref: string | null }>(
                'credentials', (from, to) =>
                supabaseAdmin
                    .from('oem_agent_credentials')
                    // secret_ref is the NAME of an env var, never a value. It is
                    // read here only to decide whether a credential could supply
                    // the variable the LLM path reads; it is not returned.
                    .select('organization_id, agent_key, purpose, secret_ref')
                    .in('organization_id', orgIds)
                    .order('organization_id').order('agent_key').order('purpose')
                    .range(from, to)),
            sweep<{ organization_id: string; agent_key: string; cost_inr: number | string | null; cost_usd: number | string | null }>(
                'runs', (from, to) =>
                supabaseAdmin
                    .from('oem_agent_runs')
                    .select('organization_id, agent_key, cost_inr, cost_usd')
                    .gte('started_at', since)
                    .in('organization_id', orgIds)
                    // Ordered so every run for one agent is adjacent: a tie at a
                    // page boundary can only reorder within an agent, never move
                    // a row into another agent's total. Ascending on started_at
                    // also means rows inserted DURING the sweep land after the
                    // cursor rather than shifting pages already read.
                    .order('organization_id').order('agent_key').order('started_at')
                    .range(from, to)),
        ]);

        // A source that is not provisioned yet, errored, or came back truncated
        // is UNKNOWN — not false. Reporting 'no_goals_bound' because the goals
        // table is missing, or because its last page was cut, would be a lie.
        const bundles = bundleSweep.error || !bundleSweep.complete ? null : new Set(
            bundleSweep.rows.map((b) => key(b.organization_id, b.agent_key)),
        );
        const goals = goalSweep.error || !goalSweep.complete ? null : new Set(
            goalSweep.rows.map((g) => key(g.organization_id, g.agent_key as string)),
        );

        // agent → purpose → secret_ref. Truncation here is also UNKNOWN: a
        // missing voice credential would otherwise silently drop a blocker.
        let credentials: Map<string, Map<string, string | null>> | null = null;
        if (!credSweep.error && credSweep.complete) {
            credentials = new Map();
            for (const c of credSweep.rows) {
                const k = key(c.organization_id, c.agent_key);
                const slots = credentials.get(k) ?? new Map<string, string | null>();
                slots.set(c.purpose, c.secret_ref ?? null);
                credentials.set(k, slots);
            }
        }

        // SPEND. Summed from real rows: cost_inr when the producer recorded it,
        // otherwise cost_usd converted at the same rate finishRun() uses. A
        // truncated sweep still yields a usable LOWER BOUND — costs are
        // non-negative, so a partial sum that already meets the cap proves the
        // full one does. The reverse does not hold, which is why
        // cost_window_complete travels with the number.
        let spend: Map<string, number> | null = null;
        if (!runSweep.error) {
            spend = new Map();
            for (const r of runSweep.rows) {
                const inr = Number(r.cost_inr ?? NaN);
                const usd = Number(r.cost_usd ?? NaN);
                const amount = Number.isFinite(inr) ? inr : Number.isFinite(usd) ? usd * USD_INR : 0;
                const k = key(r.organization_id, r.agent_key);
                spend.set(k, (spend.get(k) ?? 0) + amount);
            }
        }
        const spendComplete = !runSweep.error && runSweep.complete;

        for (const [label, s] of [
            ['bundles', bundleSweep], ['goals', goalSweep],
            ['credentials', credSweep], ['runs', runSweep],
        ] as const) {
            if (s.error && !isNotProvisionedError(s.error)) {
                console.error(`[agent-heartbeat] ${label} query failed:`, s.error);
            }
        }

        // ---- Derive one beat per agent, then write them together.
        const envLlmKey = !!process.env[LLM_RUNTIME_ENV_NAME];
        const bolnaReady = isBolnaConfigured();
        const mockLlm = isMockLlm();

        let probesUsed = 0;
        let probesCapped = false;

        const decided: Array<{
            agent: AgentRow;
            state: AgentHeartbeatState;
            reason: AgentHeartbeatReason;
            detail: {
                blockers: AgentHeartbeatReason[];
                impairments: AgentHeartbeatReason[];
                checked: Record<string, unknown>;
                source: string;
            };
        }> = [];

        for (const agent of agents) {
            const k = key(agent.organization_id, agent.agent_key);
            const runtime = agent.runtime ?? {};
            const tz = runtime.timezone || FALLBACK_TZ;

            const hasBundle = bundles ? bundles.has(k) : null;
            const hasGoal = goals ? goals.has(k) : null;
            const slots = credentials?.get(k) ?? null;
            const hasLlmRow = credentials ? !!slots?.has('llm') : null;
            const llmRef = slots?.get('llm') ?? null;
            const needsVoice = credentials
                ? !!(slots?.has('voice') || slots?.has('telephony'))
                : null;

            // ACTUALLY RESOLVE the credential rather than trusting the row.
            // readAgentSecret() returns the value or null with a logged reason;
            // the value is used for nothing but this boolean and then dropped.
            let llmResolves: boolean | null = null;
            if (hasLlmRow === true) {
                if (probesUsed < MAX_LLM_PROBES) {
                    probesUsed++;
                    llmResolves = (await readAgentSecret(
                        agent.organization_id, agent.agent_key, 'llm',
                    )) !== null;
                } else {
                    probesCapped = true;
                }
            }

            // A key can be obtained iff the runtime's own variable is set, or the
            // agent's credential resolves AND names that variable. See the header.
            const llmKeyObtainable = envLlmKey
                || (llmRef === LLM_RUNTIME_ENV_NAME && llmResolves === true);
            const llmMissing = !llmKeyObtainable;

            const cap = runtime.max_cost_inr_per_day ?? null;
            // A successful sweep with no rows for this agent means ZERO spend,
            // not unknown spend. Only a failed runs read is unknown.
            const spent = spend ? (spend.get(k) ?? 0) : null;
            const capExceeded = cap != null && spent != null && spent >= cap;
            const capNear = cap != null && spent != null && !capExceeded
                && spent >= cap * COST_NEAR_FRACTION;

            const quiet = inQuietHours(runtime.quiet_hours, tz);

            const blockers: AgentHeartbeatReason[] = [];
            if (capExceeded) blockers.push('cost_cap_exceeded');
            if (llmMissing) blockers.push('llm_key_missing');
            if (hasBundle === false) blockers.push('no_active_bundle');
            if (hasGoal === false) blockers.push('no_goals_bound');
            if (needsVoice === true && !bolnaReady) blockers.push('bolna_not_configured');

            const impairments: AgentHeartbeatReason[] = [];
            if (mockLlm) impairments.push('mock_llm');
            if (quiet === true) impairments.push('quiet_hours');
            if (capNear) impairments.push('cost_cap_near');

            const state: AgentHeartbeatState = blockers.length
                ? 'down'
                : impairments.length ? 'degraded' : 'up';
            const reason: AgentHeartbeatReason = blockers[0] ?? impairments[0] ?? 'ok';

            decided.push({
                agent,
                state,
                reason,
                detail: {
                    blockers,
                    impairments,
                    // Everything the reason was derived from, so an operator can
                    // check the verdict instead of trusting it.
                    checked: {
                        active_bundle: hasBundle,
                        goals_bound: hasGoal,
                        llm_key_in_env: envLlmKey,
                        llm_runtime_env_name: LLM_RUNTIME_ENV_NAME,
                        // The row exists / the row resolves / the row names the
                        // variable the runtime reads. Three separate facts,
                        // because collapsing them is what made this check lie.
                        llm_credential_row: hasLlmRow,
                        llm_credential_ref: llmRef,
                        llm_credential_resolves: llmResolves,
                        llm_credential_usable_by_runtime:
                            llmRef === null ? null : llmRef === LLM_RUNTIME_ENV_NAME && llmResolves === true,
                        llm_key_obtainable: llmKeyObtainable,
                        needs_voice_channel: needsVoice,
                        bolna_configured: bolnaReady,
                        mock_llm: mockLlm,
                        quiet_hours: quiet,
                        timezone: tz,
                        timezone_assumed: !runtime.timezone,
                        cost_inr_window: spent,
                        cost_inr_cap: cap,
                        cost_window_hours: COST_WINDOW_HOURS,
                        // false → cost_inr_window is a LOWER BOUND, so
                        // cost_cap_exceeded being absent is not proof of headroom.
                        cost_window_complete: spendComplete,
                    },
                    source: 'cron:agent-heartbeat',
                },
            });
        }

        const results = await Promise.all(
            decided.map((d) =>
                // latency is left null: this cron measures configuration, not
                // response time, and an invented number would be worse than none.
                beat(d.agent.organization_id, d.agent.agent_key, d.state, d.reason, null, d.detail),
            ),
        );

        const recorded = results.filter((r) => r.recorded).length;

        // WHY a beat did not land. 'not_provisioned' is a missing table — the
        // migration has not run. 'error' means PostgREST resolved the table and
        // the write still failed, which is a BUG, not a missing migration.
        // Collapsing the two is how an operator gets sent to re-run a migration
        // that is already applied.
        const beatsNotProvisioned = results.filter((r) => r.failure === 'not_provisioned').length;
        const beatsErrored = results.filter((r) => r.failure === 'error').length;
        const heartbeatTableMissing = recorded === 0 && beatsNotProvisioned > 0 && beatsErrored === 0;

        // ---- THE REAPER. Runs last: the beats are already written, so nothing
        // here can cost this sweep its heartbeats. timeout_sec comes off each
        // agent's runtime config; runs belonging to an agent this sweep did not
        // read (paused, retired, or in an org with no live agent) are judged by
        // the documented default instead of being left to rot.
        const timeoutSecByAgent = new Map<string, number | null | undefined>(
            agents.map((a) => [key(a.organization_id, a.agent_key), a.runtime?.timeout_sec]),
        );
        const reaped = await reapStaleRuns({ timeoutSecByAgent });

        // What was PARTIAL. Reported in the body and in the log, because a cron
        // that swept half a table and answered 200 teaches an operator to trust
        // a number that is not true.
        const sweepComplete: Record<string, boolean> = {
            agents: agentSweep.complete,
            bundles: bundleSweep.complete,
            goals: goalSweep.complete,
            credentials: credSweep.complete,
            runs: runSweep.complete,
        };
        const truncated = Object.entries(sweepComplete)
            .filter(([, complete]) => !complete)
            .map(([name]) => name);
        if (truncated.length) {
            console.error(
                `[agent-heartbeat] PARTIAL SWEEP: ${truncated.join(', ')} did not read to the end. Facts derived from those sources are reported as unknown, and spend is a lower bound.`,
            );
        }

        return NextResponse.json({
            // provisioned answers ONE question: is the heartbeats table there?
            // It is false only when every beat failed AND every one of those
            // failures was a missing-table error. Beats that failed for a real
            // reason prove the opposite — PostgREST resolved the table — so they
            // are reported as beats_failed and leave provisioned true.
            provisioned: !heartbeatTableMissing,
            ...(heartbeatTableMissing ? { migration: AGENT_RUNTIME_MIGRATION } : {}),
            agents: agents.length,
            recorded,
            ...(beatsErrored
                ? {
                    beats_failed: beatsErrored,
                    beat_failure_note: `${beatsErrored} of ${agents.length} beats could not be written, and the failure was NOT a missing table (a missing table returns 42P01 / PGRST205). The runtime tables are present; these writes failed for another reason. Read the '[agent runtime] beat failed' lines in the server log — do NOT re-run ${AGENT_RUNTIME_MIGRATION} on the strength of this response.`,
                }
                : {}),
            ...(beatsNotProvisioned && !heartbeatTableMissing
                ? { beats_not_provisioned: beatsNotProvisioned }
                : {}),
            // The sweep is only complete when every source read to the end.
            complete: truncated.length === 0,
            sweep_complete: sweepComplete,
            truncated,
            ...(truncated.length
                ? {
                    truncation_note: `These sources were read only in part: ${truncated.join(', ')}. Agents beyond an 'agents' cut got NO beat this run; facts from other truncated sources are reported as unknown rather than false; spend is a lower bound. Do not read this run as a full sweep.`,
                }
                : {}),
            // Credential resolutions actually performed this run.
            llm_credential_probes: probesUsed,
            ...(probesCapped
                ? {
                    llm_probe_note: `Stopped at the ${MAX_LLM_PROBES}-probe ceiling; agents past it report llm_credential_resolves: null. The llm_key_missing verdict is unaffected — a credential can only satisfy it by naming ${LLM_RUNTIME_ENV_NAME}, which is checked directly from the environment.`,
                }
                : {}),
            // What the reaper did. Separate from `recorded` on purpose: settling
            // a dead run is not a heartbeat, and a caller must be able to tell
            // "nothing was stale" from "the reaper could not run".
            reaped: {
                settled: reaped.settled,
                scanned: reaped.scanned,
                stale: reaped.stale,
                // Settled by their own worker between our read and our write.
                // Not failures — the real outcome won, which is correct.
                raced: reaped.raced,
                failed: reaped.failed,
                // false → the scan hit its bound or the read failed; more stale
                // runs may remain and the next sweep will take them.
                complete: reaped.complete,
                provisioned: !reaped.notProvisioned,
                errored: reaped.errored,
                default_threshold_sec: DEFAULT_ABANDON_AFTER_SEC,
                error_class: ABANDONED_ERROR_CLASS,
                ...(reaped.errored
                    ? {
                        note: 'The reaper read or write failed for a NON-schema reason. The runs table exists; this is a bug, not a missing migration. See the [agent runtime] reapStaleRuns log lines.',
                    }
                    : {}),
                ...(reaped.notProvisioned
                    ? { note: `oem_agent_runs is not there yet — run ${AGENT_RUNTIME_MIGRATION}. Nothing was reaped.` }
                    : {}),
                // Capped: the sweep is bounded, the response should be too.
                runs: reaped.runs.slice(0, 20).map((r) => ({
                    organization_id: r.organization_id,
                    agent_key: r.agent_key,
                    run_id: r.run_id,
                    run_key: r.run_key,
                    started_at: r.started_at,
                    // Age when it was settled — an UPPER BOUND on how long it
                    // actually ran, never a measured duration.
                    age_sec: r.age_sec,
                    threshold_sec: r.threshold_sec,
                })),
                ...(reaped.runs.length > 20 ? { runs_omitted: reaped.runs.length - 20 } : {}),
            },
            summary: {
                up: decided.filter((d) => d.state === 'up').length,
                degraded: decided.filter((d) => d.state === 'degraded').length,
                down: decided.filter((d) => d.state === 'down').length,
            },
            beats: decided.map((d) => ({
                organization_id: d.agent.organization_id,
                agent_key: d.agent.agent_key,
                state: d.state,
                reason: d.reason,
                blockers: d.detail.blockers,
                impairments: d.detail.impairments,
            })),
        });
    } catch (error) {
        console.error('[agent-heartbeat] Error:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
