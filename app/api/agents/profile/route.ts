import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';
import {
    AGENT_RUNTIME_MIGRATION,
    isNotProvisionedError,
    type AgentModelConfig,
    type AgentRuntimeConfig,
    type OemAgentProfile,
} from '@/frontend/types/agentRuntime';
import {
    RELIABILITY_WINDOW_DAYS,
    type ReliabilityStats,
    computeReliability,
    reliabilityBasis,
    reliabilityAxes,
    radarCoverage,
    costPerSuccessInr,
    efficiencyBasis,
} from '@/backend/lib/agents/reliability';

/**
 * THE AGENT PROFILE — an employee record for something that is not a person.
 * =============================================================================
 * GET /api/agents/profile?orgId=&agentKey=
 *
 * A human employee's file holds what they did, how reliable they were, and what
 * they cost. This is the same file for an agent, and it deliberately shows the
 * real machine underneath rather than a friendly abstraction of it: tokens in,
 * tokens out, cache hits, temperature, top_p, context window, p50/p95 latency.
 * An operator who can see that temperature is 0.9 on a compliance agent can fix
 * it. An operator shown only a green tick cannot.
 *
 * Three sources are fused here:
 *
 *   oem_agent_profile   the 30-day rollup view (throughput, tokens, cost,
 *                       latency, uptime, coins, ROI flags, reliability score).
 *                       Source of truth for everything it computes.
 *   oem_agents          model_config + runtime — the CONFIGURATION that produced
 *                       those outcomes, shown beside them so cause and effect
 *                       sit on one screen.
 *   oem_agent_runs      the two dimensions the view does not carry: grounding
 *                       (share of runs whose claims traced back to bundle rows)
 *                       and efficiency (cost per successful run).
 *
 * THE PENTAGON. `radar` is five normalised 0-100 dimensions in a fixed draw
 * order, each carrying its own label, description and `measured` flag. Five,
 * because the OEM model is already five levels deep and the shape should rhyme
 * with it. Every axis is self-describing in the payload — a chart component
 * should never need to hardcode what "Grounding" means:
 *
 *   Completion     success_rate            did the work finish
 *   Availability   uptime_pct              was it even alive
 *   ROI alignment  100 - roi_flag_rate     was the work worth doing
 *   Grounding      grounded runs / runs    were the claims traceable
 *   Efficiency     cost per success        was it worth what it cost
 *
 * `measured: false` means NO DATA, not zero. An agent registered this morning
 * has not earned a bad score; it has not earned any score. The UI should dim
 * an unmeasured axis rather than draw it collapsed to the centre.
 *
 * AND "UNMEASURED" IS NOT "UNREADABLE". Those are three states, not two, and the
 * radar is computed from them, so each one is reported separately:
 *
 *   (i)   the migration is not applied            -> HTTP 200 { ok:true,
 *         provisioned:false }. A known state: the view is not there.
 *   (ii)  a GENUINE query error — the table IS there and the read still failed
 *         (permission, timeout, bad filter, connection). Whatever that read fed
 *         becomes null and is marked `unreadable`; nothing is asserted about it.
 *         The profile view is the PRIMARY read, so losing it loses the answer
 *         (HTTP 500, as /api/agents/pulse does). The runs and config reads are
 *         SECONDARY — they cost part of the payload, not all of it, so those stay
 *         HTTP 200 with `runs_error` / `config_error` set, which is the same
 *         partial-failure contract /api/agents/runs uses for its totals.
 *   (iii) the read worked and found nothing       -> `measured: false`. Genuinely
 *         no data yet, which is the sentence above.
 *
 * The bug this replaced: `isNotProvisionedError(runsRes.error) ? [] : data ?? []`
 * swallowed every OTHER run-query error into an empty array, so a failed read
 * became "Grounding: not measured yet" — the reassuring answer — on a pentagon
 * the operator reads as an employee's record.
 *
 * Degrades to HTTP 200 { provisioned: false } when 20260830000001_agent_runtime
 * has not been applied.
 */

export const dynamic = 'force-dynamic';

/* ---------------------------------------------------------------------------
 * The efficiency band, the reliability weights and the pentagon maths all live
 * in backend/lib/agents/reliability.ts. This route used to carry a line-for-line
 * copy of every one of them; two definitions of one score is how a dashboard
 * starts lying, so the copies are gone and the imports above are the only source.
 * ------------------------------------------------------------------------- */

/** PostgREST silently truncates an unbounded select at 1000 rows. Be explicit. */
const RUN_ROW_CEILING = 20000;

/**
 * Radar axes computed from oem_agent_runs rather than from the profile view.
 * Grounding is the only one: completion, availability and ROI alignment are the
 * view's own rates, and efficiency is the view's cost divided by the view's
 * success count. When the run read fails, exactly these go unreadable.
 */
const RUN_DERIVED_AXES = new Set<string>(['grounding']);

/**
 * The shared failure envelope used across /api/agents (pulse, runs, summary,
 * registry, profile). Its presence is what tells a renderer that the nulls
 * beside it mean "we could not read it", not "there is none".
 */
interface QueryFailure {
    scope: string;
    code: string | null;
    message: string;
    reason: string;
}

function queryFailure(
    scope: string,
    error: { code?: string | null; message?: string | null } | null | undefined,
    reason: string,
): QueryFailure {
    return {
        scope,
        code: error?.code ?? null,
        message: error?.message ?? 'The query failed without a message.',
        reason,
    };
}

function notProvisioned() {
    return NextResponse.json(
        {
            // A known state, honestly reported: the view is not there.
            ok: true,
            provisioned: false,
            migration: AGENT_RUNTIME_MIGRATION,
            reason: `Agent runtime is not set up yet — apply ${AGENT_RUNTIME_MIGRATION}.sql.`,
            agent: null,
            agents: [],
            runs_error: null,
            config_error: null,
        },
        { status: 200 },
    );
}

/**
 * A GENUINE failure of the PRIMARY read. Every agent row below is built from the
 * profile view, so losing it loses the whole answer. Same body and same status
 * as /api/agents/pulse.
 */
function profileFailed(error: { code?: string | null; message?: string | null } | null) {
    return NextResponse.json(
        {
            ok: false,
            // The view IS there — this is not the migration state.
            provisioned: true,
            error: {
                scope: 'profile' as const,
                code: error?.code ?? null,
                message: error?.message ?? 'The query failed without a message.',
            },
            reason:
                'The agent profile view could not be read, so no reliability, throughput, '
                + 'cost or uptime figure is known for any agent.',
            // null, not []: absence of an answer, not an answer of absence.
            agent: null,
            agents: null,
            runs_error: null,
            config_error: null,
        },
        { status: 500 },
    );
}

function num(value: unknown): number | null {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

function clamp100(n: number): number {
    return Math.max(0, Math.min(100, Math.round(n * 10) / 10));
}

interface RunFacts {
    grounded_true: number;
    grounded_known: number;
    confidence_sum: number;
    confidence_n: number;
    cost_inr: number;
    cost_usd: number;
    succeeded: number;
}

export async function GET(request: NextRequest) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        const { searchParams } = new URL(request.url);
        const orgId = searchParams.get('orgId') || searchParams.get('org_id') || searchParams.get('organization_id');
        if (!orgId) return NextResponse.json({ error: 'orgId required' }, { status: 400 });

        // agentKey optional: omit it to get every agent's profile in one call, which
        // is what the console's agent grid wants. Each entry carries its own radar.
        const agentKey = searchParams.get('agentKey') || searchParams.get('agent_key');

        // Same window the reliability basis reports, from the same constant — a
        // sample window that drifts from the stated one makes the basis a lie.
        const since = new Date(Date.now() - RELIABILITY_WINDOW_DAYS * 86400000).toISOString();

        let profileQ = supabase
            .from('oem_agent_profile')
            .select('*')
            .eq('organization_id', orgId)
            .order('agent_key');
        if (agentKey) profileQ = profileQ.eq('agent_key', agentKey);

        // The configuration that produced the outcomes. Kept separate from the view
        // on purpose: the view is a rollup and should not be widened every time a
        // config key is added.
        let configQ = supabase
            .from('oem_agents')
            .select('agent_key, display_name, department, role_description, status, health_state, last_heartbeat_at, coins_balance, system_prompt_version, prompt_generated_at, runtime, model_config')
            .eq('organization_id', orgId);
        if (agentKey) configQ = configQ.eq('agent_key', agentKey);

        // Narrow projection — four columns over 30 days. Grounding and cost-per-
        // success are not in the view, and adding them there would mean a schema
        // change; deriving them here keeps the migration stable.
        let runsQ = supabase
            .from('oem_agent_runs')
            .select('agent_key, status, grounded, confidence, cost_inr, cost_usd')
            .eq('organization_id', orgId)
            .gte('started_at', since)
            .range(0, RUN_ROW_CEILING - 1);
        if (agentKey) runsQ = runsQ.eq('agent_key', agentKey);

        const [profileRes, configRes, runsRes] = await Promise.all([profileQ, configQ, runsQ]);

        if (isNotProvisionedError(profileRes.error)) return notProvisioned();
        if (profileRes.error) return profileFailed(profileRes.error);

        const rows = (profileRes.data ?? []) as OemAgentProfile[];

        // The two SECONDARY reads. A missing table is the calm setup state and leaves
        // its fields genuinely unmeasured; anything else is a failure that makes those
        // fields UNKNOWN, and the two must not share a code path.
        const configUnreadable = !!configRes.error && !isNotProvisionedError(configRes.error);
        const runsUnreadable = !!runsRes.error && !isNotProvisionedError(runsRes.error);

        const configError = configUnreadable
            ? queryFailure(
                'config',
                configRes.error,
                'The agent registry row could not be read, so model_config, runtime, the role '
                + 'description and prompt_generated_at are UNKNOWN — not empty. An empty '
                + 'model_config would read as "no overrides set", which is a different claim.',
            )
            : null;

        const runsError = runsUnreadable
            ? queryFailure(
                'runs',
                runsRes.error,
                'The agent run log could not be read, so grounding and average confidence are '
                + 'UNKNOWN for every agent. That is not the same as "not measured yet": render '
                + 'the affected radar axes as unreadable, never as a dimmed zero.',
            )
            : null;

        const configByKey = new Map<string, Record<string, unknown>>();
        if (!configRes.error) {
            for (const c of (configRes.data ?? []) as Record<string, unknown>[]) {
                configByKey.set(c.agent_key as string, c);
            }
        }

        // Fold the run rows down to per-agent facts in one pass. Empty when the read
        // failed, and in that case nothing derived from `facts` is reported.
        const facts = new Map<string, RunFacts>();
        const runRows = runsRes.error ? [] : (runsRes.data ?? []);
        for (const r of runRows as Record<string, unknown>[]) {
            const key = r.agent_key as string;
            let f = facts.get(key);
            if (!f) {
                f = { grounded_true: 0, grounded_known: 0, confidence_sum: 0, confidence_n: 0, cost_inr: 0, cost_usd: 0, succeeded: 0 };
                facts.set(key, f);
            }
            // grounded is nullable: null means "not assessed", which is not "false".
            if (r.grounded === true || r.grounded === false) {
                f.grounded_known += 1;
                if (r.grounded === true) f.grounded_true += 1;
            }
            const conf = num(r.confidence);
            if (conf !== null) { f.confidence_sum += conf; f.confidence_n += 1; }
            f.cost_inr += num(r.cost_inr) ?? 0;
            f.cost_usd += num(r.cost_usd) ?? 0;
            if (r.status === 'succeeded') f.succeeded += 1;
        }

        const agents = rows.map((p) => {
            const cfg = configByKey.get(p.agent_key) ?? {};
            const f = facts.get(p.agent_key);

            const successRate = num(p.success_rate);
            const uptimePct = num(p.uptime_pct);
            const roiFlagRate = num(p.roi_flag_rate);

            const tokensIn = num(p.tokens_in_total) ?? 0;
            const tokensOut = num(p.tokens_out_total) ?? 0;
            const cachedTokens = num(p.cached_tokens_total) ?? 0;
            const costInrTotal = num(p.cost_inr_total) ?? 0;
            const costUsdTotal = num(p.cost_usd_total) ?? 0;

            // Everything the score and the pentagon are built from, in one object.
            // The rates come off the view; the counters are only used for the two
            // diagnostic axes the view does not carry.
            const stats: ReliabilityStats = {
                success_rate: successRate,
                uptime_pct: uptimePct,
                roi_flag_rate: roiFlagRate,
                runs_total: p.runs_total,
                runs_succeeded: p.runs_succeeded,
                runs_grounded: f?.grounded_true ?? null,
                runs_with_grounding: f?.grounded_known ?? null,
                cost_inr_total: costInrTotal,
                cost_usd_total: costUsdTotal,
            };

            const costPerSuccess = costPerSuccessInr(stats);

            // Only GROUNDING is fed by oem_agent_runs; the other four come off the
            // view. So only grounding turns unreadable when the run read fails, and
            // it is flagged rather than left as `measured:false` — "no data has been
            // recorded for this axis" and "we could not read it" are different
            // sentences and only one of them is true here.
            const radar = reliabilityAxes(stats).map((axis) => ({
                ...axis,
                unreadable: runsUnreadable && RUN_DERIVED_AXES.has(axis.key),
            }));
            const coverage = radarCoverage(radar);
            const unreadableAxes = radar.filter((a) => a.unreadable).map((a) => a.key);

            // The view owns the score. This module only computes one when the view
            // returned none, and the basis says which side produced the number.
            const viewScore = num(p.reliability_score);
            const score = viewScore ?? computeReliability(stats);

            return {
                agent_key: p.agent_key,
                display_name: p.display_name,
                department: p.department,
                status: p.status,
                health_state: p.health_state,
                last_heartbeat_at: p.last_heartbeat_at,
                last_run_at: p.last_run_at,

                // ---- The headline number. NULL when nothing has been measured:
                //      "not measured yet" is not the same claim as "unreliable".
                reliability_score: score,
                reliability_basis: reliabilityBasis(
                    viewScore === null && score !== null ? 'client' : 'view',
                ),

                // ---- Throughput
                runs_total: p.runs_total,
                runs_succeeded: p.runs_succeeded,
                runs_failed: p.runs_failed,
                runs_in_flight: p.runs_in_flight,
                success_rate: successRate,

                // ---- Uptime
                uptime_pct: uptimePct,
                beats_total: p.beats_total,
                beats_up: p.beats_up,
                beats_down: p.beats_down,
                beats_degraded: p.beats_degraded,
                avg_heartbeat_latency_ms: num(p.avg_latency_ms),

                // ---- The real LLM surface, not a summary of it.
                llm: {
                    tokens_in: tokensIn,
                    tokens_out: tokensOut,
                    tokens_total: tokensIn + tokensOut,
                    cached_tokens: cachedTokens,
                    // Prompt-cache hit rate. The single most actionable cost lever
                    // an operator has: same output, a fraction of the input bill.
                    cache_hit_rate_pct: tokensIn > 0 ? clamp100((cachedTokens * 100) / tokensIn) : null,
                    tokens_per_run: p.runs_total > 0
                        ? Math.round((tokensIn + tokensOut) / p.runs_total)
                        : null,
                    cost_usd: costUsdTotal,
                    cost_inr: costInrTotal,
                    cost_per_success_inr: costPerSuccess,
                    p50_duration_ms: num(p.p50_duration_ms),
                    p95_duration_ms: num(p.p95_duration_ms),
                    // null here means "no confidence was recorded" normally, and "the
                    // run log could not be read" when runs_readable is false. The flag
                    // beside it is what separates the two.
                    avg_confidence: f && f.confidence_n > 0
                        ? Math.round((f.confidence_sum / f.confidence_n) * 100) / 100
                        : null,
                },

                // ---- Reinforcement. ROI flags are a SEPARATE counter by design:
                //      "not worth doing" is a different failure from "did it wrong",
                //      and blending it into success_rate would hide the distinction
                //      that makes the signal useful.
                reinforcement: {
                    coins_balance: p.coins_balance,
                    praise_30d: p.praise_30d,
                    rejects_30d: p.rejects_30d,
                    corrections_30d: p.corrections_30d,
                    roi_flags_30d: p.roi_flags_30d,
                    roi_flag_rate: roiFlagRate,
                    // The visible loop: corrections typed but not yet absorbed.
                    pending_guidance: p.pending_guidance,
                },

                // ---- Configuration that produced all of the above. When the registry
                //      read failed these are null, not {}: an empty model_config reads
                //      as "no overrides are set", which is a claim, and a failed read
                //      is not entitled to make it.
                prompt_version: p.prompt_version,
                config_readable: !configUnreadable,
                prompt_generated_at: (cfg.prompt_generated_at as string) ?? null,
                role_description: (cfg.role_description as string) ?? null,
                model_config: configUnreadable ? null : ((cfg.model_config as AgentModelConfig) ?? {}),
                runtime: configUnreadable ? null : ((cfg.runtime as AgentRuntimeConfig) ?? {}),

                // ---- The pentagon.
                /** False = at least one axis is blank because a read failed. */
                runs_readable: !runsUnreadable,
                radar,
                radar_coverage: {
                    measured: coverage.measured,
                    of: coverage.of,
                    // Blank because nothing has been recorded yet — a real answer.
                    unmeasured: coverage.unmeasured.filter((k) => !unreadableAxes.includes(k)),
                    // Blank because the read that feeds them failed — no answer at all.
                    unreadable: unreadableAxes,
                },
                efficiency_basis: efficiencyBasis(stats),
            };
        });

        return NextResponse.json({
            // false = part of this payload is UNKNOWN. The view-derived figures are
            // real; anything an agent marks runs_readable/config_readable false is not.
            ok: !runsUnreadable && !configUnreadable,
            provisioned: true,
            window_days: RELIABILITY_WINDOW_DAYS,
            since,
            // null, not 0: "we sampled no runs" and "we could not sample" differ.
            runs_sampled: runsUnreadable ? null : runRows.length,
            runs_truncated: runsUnreadable ? null : runRows.length >= RUN_ROW_CEILING,
            runs_error: runsError,
            config_error: configError,
            agent: agentKey ? agents[0] ?? null : null,
            agents,
        });
    } catch (e) {
        // Same contract as profileFailed: unknown, not empty.
        return NextResponse.json(
            {
                ok: false,
                provisioned: true,
                error: { scope: 'request' as const, code: null, message: (e as Error).message },
                reason: 'The agent profile request failed, so every figure below is UNKNOWN.',
                agent: null,
                agents: null,
                runs_error: null,
                config_error: null,
            },
            { status: 500 },
        );
    }
}
