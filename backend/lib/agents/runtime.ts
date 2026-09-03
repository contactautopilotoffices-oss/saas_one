/**
 * AGENT RUNTIME RECORDER — the spine.
 * -----------------------------------------------------------------------------
 * Every agent job calls into this file. It is the ONLY writer of
 * oem_agent_runs / oem_agent_run_steps / oem_agent_heartbeats /
 * oem_agent_coin_ledger, and it is what makes an agent legible:
 *
 *     startRun()   -> a row exists the instant work begins
 *     step()       -> the live trace the console renders line by line
 *     finishRun()  -> outcome, tokens, cost, grounding, confidence
 *     beat()       -> "when it went down, and why"
 *     awardCoins() -> reinforcement, as an auditable ledger
 *
 * Schema: supabase/migrations/20260830000001_agent_runtime.sql
 * Types:  frontend/types/agentRuntime.ts
 *
 * ── TWO RULES THIS FILE NEVER BREAKS ────────────────────────────────────────
 *
 * 1. A RECORDER MUST NEVER BREAK THE JOB IT OBSERVES.
 *    Every function here swallows its own failures and returns a null-ish
 *    result. If the migration has not been applied, if the network blips, if a
 *    constraint trips — the cron job that was writing purchase orders keeps
 *    writing purchase orders. Telemetry is not allowed to become an outage.
 *    Not-provisioned errors are logged ONCE per scope (they are expected before
 *    the migration runs); every other error is logged in full (it is a bug).
 *
 * 2. THE DATABASE OWNS DERIVED VALUES.
 *    duration_ms is filled by trg_oem_runs_duration / trg_oem_run_steps_duration
 *    from (ended_at - started_at). health_state / last_heartbeat_at are pushed
 *    onto oem_agents by trg_oem_heartbeat_apply. coins_balance is pushed by
 *    trg_oem_coin_ledger_apply. We do not second-guess them from JS clocks,
 *    which drift relative to the database's now().
 *
 * Service role, deliberately: these are cron/worker writes with no browser
 * session behind them. RLS on the oem_* runtime tables is written for the
 * console's read path, not for this one.
 */

import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import {
    AGENT_RUNTIME_MIGRATION,
    isNotProvisionedError,
    type AgentHeartbeatReason,
    type AgentHeartbeatState,
    type AgentModelConfig,
    type AgentRunStatus,
    type AgentRunTrigger,
    type AgentStepStatus,
    type AgentStepType,
} from '@/frontend/types/agentRuntime';

/* ---------------------------------------------------------------------------
 * Failure handling. Loud for real bugs, quiet-after-once for "not migrated yet".
 * ------------------------------------------------------------------------- */

const warnedScopes = new Set<string>();

/** True when the write could not land. Never throws, never returns undefined. */
function absorb(scope: string, error: unknown): boolean {
    if (!error) return false;
    if (isNotProvisionedError(error)) {
        if (!warnedScopes.has(scope)) {
            warnedScopes.add(scope);
            console.warn(
                `[agent runtime] ${scope}: agent runtime tables are not provisioned yet — `
                + `run migration ${AGENT_RUNTIME_MIGRATION}. Telemetry is being dropped; `
                + `the job itself is unaffected. (This is logged once per process.)`,
            );
        }
        return true;
    }
    console.error(`[agent runtime] ${scope} failed:`, (error as { message?: string })?.message ?? error);
    return true;
}

/**
 * Which KIND of failure this was. A missing table (the migration has not run)
 * and a query that genuinely failed are different facts, and a caller that
 * flattens them tells an operator to run a migration they already ran.
 */
export type RuntimeFailure = 'not_provisioned' | 'error';

function failureClass(error: unknown): RuntimeFailure {
    return isNotProvisionedError(error) ? 'not_provisioned' : 'error';
}

/** Exchange rate used only to fill cost_inr when a caller supplies cost_usd alone. */
const USD_INR = Number(process.env.AGENT_USD_INR || 88);

function inrFromUsd(usd: number | null | undefined): number | null {
    if (usd == null || !Number.isFinite(usd)) return null;
    return Math.round(usd * USD_INR * 1e4) / 1e4;
}

/* ---------------------------------------------------------------------------
 * 1. STEPS — the live trace.
 * ------------------------------------------------------------------------- */

export interface StepPatch {
    detail?: Record<string, unknown>;
    tokens_in?: number | null;
    tokens_out?: number | null;
}

/**
 * A handle on one open step. Callers may ignore it entirely: the next step()
 * call closes the previous step, and finishRun() sweeps whatever is left open.
 * Take the handle when you want to attach the RESULT of the step (row counts,
 * token usage, the model's first line) rather than only its intent.
 */
export interface StepHandle {
    /** null when telemetry is not being recorded. Every method is then a no-op. */
    id: string | null;
    seq: number;
    end(status?: AgentStepStatus, patch?: StepPatch): Promise<void>;
    ok(patch?: StepPatch): Promise<void>;
    fail(error: unknown, patch?: StepPatch): Promise<void>;
}

/**
 * Append a step to the trace. `label` is operator-facing prose
 * ('Fetching open requisitions'), `type` shapes its icon in the feed.
 */
export type StepFn = (
    label: string,
    type?: AgentStepType,
    detail?: Record<string, unknown>,
) => Promise<StepHandle>;

const NOOP_STEP_HANDLE: StepHandle = {
    id: null,
    seq: 0,
    async end() { /* telemetry disabled */ },
    async ok() { /* telemetry disabled */ },
    async fail() { /* telemetry disabled */ },
};

/** A step function that records nothing — returned when the run could not open. */
export const noopStep: StepFn = async () => NOOP_STEP_HANDLE;

/* ---------------------------------------------------------------------------
 * 2. startRun
 * ------------------------------------------------------------------------- */

export interface StartRunOptions {
    orgId: string;
    agentKey: string;
    /**
     * Idempotency key, UNIQUE with (organization_id, agent_key). Give a cron
     * run a stable key ('daily-digest-2026-08-30') so a retry does not
     * double-log. The retry does NOT re-open, reset or renumber that row: it
     * gets the existing run's id back with `deduped: true` and a no-op step
     * recorder, and must not finish or mutate it. See the INSERT-OR-RETURN-
     * EXISTING section on startRun below. Omit for ad-hoc runs.
     */
    runKey?: string | null;
    trigger?: AgentRunTrigger;
    /** AgentModule slug — this is what gives each module its own agent pulse. */
    module?: string | null;

    // ---- LLM surface. Omit to inherit oem_agents.model_config.
    provider?: string | null;
    model?: string | null;
    temperature?: number | null;
    top_p?: number | null;
    max_tokens?: number | null;
    context_window?: number | null;

    // ---- Provenance. Omit to inherit from the registry + active bundle.
    prompt_version?: number | null;
    bundle_version?: number | null;

    /**
     * Default true. Reads the agent's registry row and active bundle version so
     * a run stays explainable after the configuration changes underneath it.
     * Costs two indexed selects; pass false in a tight loop and supply the
     * values yourself.
     */
    inheritAgentConfig?: boolean;
}

export interface StartedRun {
    /** null when the run could not be recorded. Safe to pass to finishRun(). */
    runId: string | null;
    step: StepFn;
    /** false when the runtime tables are missing, the insert failed, OR this is a dedupe hit. */
    recording: boolean;
    /**
     * True when `runKey` matched a run that ALREADY EXISTED. `runId` then points
     * at that pre-existing row, which THIS CALL DOES NOT OWN: `step` is a no-op
     * and the row must not be finished, failed or otherwise mutated here. It is
     * somebody else's record — a completed one from earlier today, or one still
     * in flight in another worker.
     */
    deduped: boolean;
}

/** Pull model_config / prompt version / bundle version off the registry. */
async function inheritConfig(
    orgId: string,
    agentKey: string,
): Promise<{ model: AgentModelConfig; promptVersion: number | null; bundleVersion: number | null }> {
    const empty = { model: {} as AgentModelConfig, promptVersion: null, bundleVersion: null };
    try {
        const [agentRes, bundleRes] = await Promise.all([
            supabaseAdmin
                .from('oem_agents')
                .select('system_prompt_version, model_config')
                .eq('organization_id', orgId)
                .eq('agent_key', agentKey)
                .maybeSingle(),
            supabaseAdmin
                .from('oem_agent_bundles')
                .select('version')
                .eq('organization_id', orgId)
                .eq('agent_key', agentKey)
                .eq('is_active', true)
                .order('version', { ascending: false })
                .limit(1)
                .maybeSingle(),
        ]);
        if (agentRes.error) {
            absorb('startRun:inherit', agentRes.error);
            return empty;
        }
        return {
            model: (agentRes.data?.model_config ?? {}) as AgentModelConfig,
            promptVersion: agentRes.data?.system_prompt_version ?? null,
            bundleVersion: bundleRes.data?.version ?? null,
        };
    } catch (error) {
        absorb('startRun:inherit', error);
        return empty;
    }
}

/**
 * Open a run and hand back the step recorder.
 *
 *     const { runId, step } = await startRun({ orgId, agentKey: 'po_drafter',
 *                                              module: 'procurement', trigger: 'cron',
 *                                              runKey: `po-draft-${today}` });
 *     await step('Fetching open requisitions', 'fetch');
 *     const llm = await step('Calling model', 'llm');
 *     await llm.ok({ tokens_in: 4200, tokens_out: 610 });
 *     await finishRun(runId, { status: 'succeeded', outcome_summary: '3 POs drafted' });
 *
 * Never throws. If the tables are missing you still get a working `step`
 * function that records nothing, so the calling job needs no branching.
 *
 * ── runKey SEMANTICS: INSERT-OR-RETURN-EXISTING ─────────────────────────────
 * A run_key is an idempotency key, so the second call with the same
 * (organization_id, agent_key, run_key) MUST NOT re-run the bookkeeping of the
 * first. It does not re-open, reset, or extend the matched run: it returns that
 * run's id with `deduped: true`, `recording: false` and a no-op step function.
 *
 * The rule is the same whether the existing run finished or is still in flight,
 * because the reason is the same in both cases — WE DID NOT OPEN THAT ROW.
 * A finished run is a historical record. An unfinished one belongs to the
 * worker that is still writing it, and its seq counter is that worker's.
 * Either way the honest answer is "already recorded", not a second trace
 * welded onto someone else's.
 *
 * Cost of that honesty: if a job dies mid-run, the retry inside the same key
 * window is not traced. Losing telemetry for one retry is strictly better than
 * corrupting the record of what already happened.
 *
 * The dead run itself no longer stays 'running' forever: reapStaleRuns() below
 * settles it as 'timeout' / error_class 'abandoned' on the agent-heartbeat
 * sweep. Read that function's header for what a reap does and does NOT fix —
 * in particular, a reaped run_key STAYS deduped, so the retry that actually
 * succeeded is still not traced. Reaping is about not lying about the dead run;
 * it does not resurrect the lost trace.
 */
export async function startRun(opts: StartRunOptions): Promise<StartedRun> {
    const { orgId, agentKey } = opts;

    let model: AgentModelConfig = {};
    let promptVersion: number | null = opts.prompt_version ?? null;
    let bundleVersion: number | null = opts.bundle_version ?? null;

    if (opts.inheritAgentConfig !== false) {
        const inherited = await inheritConfig(orgId, agentKey);
        model = inherited.model ?? {};
        promptVersion = promptVersion ?? inherited.promptVersion;
        bundleVersion = bundleVersion ?? inherited.bundleVersion;
    }

    const row = {
        organization_id: orgId,
        agent_key: agentKey,
        run_key: opts.runKey ?? null,
        trigger: opts.trigger ?? 'manual',
        module: opts.module ?? null,
        status: 'running' as AgentRunStatus,
        started_at: new Date().toISOString(),
        ended_at: null,
        duration_ms: null,
        error: null,
        error_class: null,
        provider: opts.provider ?? model.provider ?? null,
        model: opts.model ?? model.model ?? null,
        temperature: opts.temperature ?? model.temperature ?? null,
        top_p: opts.top_p ?? model.top_p ?? null,
        max_tokens: opts.max_tokens ?? model.max_tokens ?? null,
        context_window: opts.context_window ?? model.context_window ?? null,
        prompt_version: promptVersion,
        bundle_version: bundleVersion,
    };

    let runId: string | null = null;
    try {
        // ALWAYS a plain INSERT — never an upsert, with or without a run_key.
        //
        // An upsert on (organization_id, agent_key, run_key) was idempotency
        // turned inside out: it RE-OPENED the matched row, resetting status to
        // 'running' and started_at to now while the previous execution's
        // outcome, tokens and cost stayed on it. Every repeat call reset a
        // finished run and appended a fresh trace to it. A completed run is a
        // historical record; it is immutable.
        //
        // So: insert, and let the unique index arbitrate. The winner owns the
        // run. Anyone who collides gets the existing row back, read-only.
        const { data, error } = await supabaseAdmin
            .from('oem_agent_runs')
            .insert(row)
            .select('id')
            .single();

        if (!error) {
            runId = (data as { id: string }).id;
        } else if (opts.runKey && (error as { code?: string }).code === '23505') {
            // 23505 on the run_key index: this key was already claimed today.
            const existing = await findRunByKey(orgId, agentKey, opts.runKey);
            if (existing) {
                if (existing.status === 'running' && !warnedScopes.has('startRun:concurrent')) {
                    warnedScopes.add('startRun:concurrent');
                    console.warn(
                        `[agent runtime] startRun: run_key '${opts.runKey}' is held by run `
                        + `${existing.id}, which is still running. Not recording this execution — `
                        + 'the seq counter belongs to the worker that opened it. '
                        + '(Logged once per process.)',
                    );
                }
                // Untouched. Not our row: no status reset, no steps, and
                // withAgentRun must not finish it either.
                return { runId: existing.id, step: noopStep, recording: false, deduped: true };
            }
            // Constraint tripped but the row is unreadable — record nothing
            // rather than guess which row we collided with.
            absorb('startRun', error);
        } else {
            absorb('startRun', error);
        }
    } catch (error) {
        absorb('startRun', error);
    }

    if (!runId) return { runId: null, step: noopStep, recording: false, deduped: false };

    // makeStepRecorder is reachable ONLY here, on the row this call just
    // inserted. That is the structural half of "never append to a trace you did
    // not open"; the seq latch inside the recorder is the other half.
    return { runId, step: makeStepRecorder(orgId, runId), recording: true, deduped: false };
}

/** The existing run behind a run_key collision. Read-only; never mutated by us. */
async function findRunByKey(
    orgId: string,
    agentKey: string,
    runKey: string,
): Promise<{ id: string; status: AgentRunStatus } | null> {
    try {
        const { data, error } = await supabaseAdmin
            .from('oem_agent_runs')
            .select('id, status')
            .eq('organization_id', orgId)
            .eq('agent_key', agentKey)
            .eq('run_key', runKey)
            .maybeSingle();
        if (error) {
            absorb('startRun:dedupe', error);
            return null;
        }
        return (data as { id: string; status: AgentRunStatus } | null) ?? null;
    } catch (error) {
        absorb('startRun:dedupe', error);
        return null;
    }
}

/**
 * The step closure. Holds the seq counter and the currently-open step, so the
 * caller never has to think about either.
 *
 * seq is assigned in-process, starting at 1, because the trace is written by
 * exactly ONE worker: startRun only builds a recorder for a row it just
 * inserted, so seq 1 is always free and the counter is always the truth.
 *
 * ── IT REFUSES TO RENUMBER ──────────────────────────────────────────────────
 * This used to catch the unique violation on (run_id, seq), re-sync off
 * max(seq) and retry — which meant that whenever a recorder was pointed at a
 * run somebody else had written, it quietly appended its steps to the end of
 * that stranger's trace. Combined with the re-opening upsert in startRun, one
 * run row grew three more steps on every request, forever.
 *
 * A collision on (run_id, seq) now means exactly one thing: rows exist under a
 * seq we never wrote, so THIS TRACE IS NOT OURS. There is no correct place to
 * put our step, so we stop writing steps for the rest of this run and say so
 * once. A short trace is a small loss; a trace that merges two executions is a
 * lie about what the agent did.
 */
function makeStepRecorder(orgId: string, runId: string): StepFn {
    let seq = 0;
    let open: { id: string; label: string } | null = null;
    /** Latched on a seq collision. Once set, this recorder writes nothing more. */
    let refusing = false;

    const closeStep = async (
        id: string,
        status: AgentStepStatus,
        patch?: StepPatch,
    ): Promise<void> => {
        try {
            const { error } = await supabaseAdmin
                .from('oem_agent_run_steps')
                .update({
                    status,
                    ended_at: new Date().toISOString(), // duration_ms filled by trigger
                    ...(patch?.detail ? { detail: patch.detail } : {}),
                    ...(patch?.tokens_in != null ? { tokens_in: patch.tokens_in } : {}),
                    ...(patch?.tokens_out != null ? { tokens_out: patch.tokens_out } : {}),
                })
                .eq('id', id);
            if (error) absorb('step:end', error);
        } catch (error) {
            absorb('step:end', error);
        }
        if (open?.id === id) open = null;
    };

    const insertStep = async (
        label: string,
        stepType: AgentStepType,
        detail: Record<string, unknown>,
        attemptSeq: number,
    ): Promise<{ id: string | null; seq: number }> => {
        const { data, error } = await supabaseAdmin
            .from('oem_agent_run_steps')
            .insert({
                run_id: runId,
                organization_id: orgId,
                seq: attemptSeq,
                step_type: stepType,
                label,
                detail,
                status: 'running' as AgentStepStatus,
                started_at: new Date().toISOString(),
            })
            .select('id, seq')
            .single();

        if (error) {
            // 23505 = unique_violation on (run_id, seq). Somebody else's rows are
            // in this trace. Latch off; do NOT hunt for a free seq.
            if ((error as { code?: string }).code === '23505') {
                refusing = true;
                if (!warnedScopes.has('step:foreign-trace')) {
                    warnedScopes.add('step:foreign-trace');
                    console.warn(
                        `[agent runtime] step: run ${runId} already has a step at seq ${attemptSeq} `
                        + 'that this process did not write. Refusing to append to a trace we did not '
                        + 'open — the rest of this run will not be traced. (Logged once per process.)',
                    );
                }
                return { id: null, seq: attemptSeq };
            }
            absorb('step:insert', error);
            return { id: null, seq: attemptSeq };
        }
        return { id: (data as { id: string }).id, seq: (data as { seq: number }).seq };
    };

    return async (label, stepType = 'think', detail = {}) => {
        if (refusing) return { ...NOOP_STEP_HANDLE, seq };

        // Starting a step implicitly finishes the previous one as ok.
        if (open) await closeStep(open.id, 'ok');

        let handleId: string | null = null;
        const assigned = ++seq;

        try {
            const inserted = await insertStep(label, stepType, detail ?? {}, assigned);
            handleId = inserted.id;
        } catch (error) {
            absorb('step', error);
        }

        if (!handleId) return { ...NOOP_STEP_HANDLE, seq: assigned };

        const id = handleId;
        open = { id, label };

        return {
            id,
            seq: assigned,
            end: (status: AgentStepStatus = 'ok', patch?: StepPatch) => closeStep(id, status, patch),
            ok: (patch?: StepPatch) => closeStep(id, 'ok', patch),
            fail: (error: unknown, patch?: StepPatch) => closeStep(id, 'failed', {
                ...patch,
                detail: {
                    ...(patch?.detail ?? {}),
                    error: (error as { message?: string })?.message ?? String(error),
                },
            }),
        };
    };
}

/* ---------------------------------------------------------------------------
 * 3. finishRun
 * ------------------------------------------------------------------------- */

export interface FinishRunPatch {
    /** Default 'succeeded'. */
    status?: AgentRunStatus;
    outcome_summary?: string | null;
    /** id / URL of what the run produced or touched. */
    entity_ref?: string | null;
    tokens_in?: number | null;
    tokens_out?: number | null;
    /** Subset of tokens_in served from prompt cache. */
    cached_tokens?: number | null;
    cost_usd?: number | null;
    /** Derived from cost_usd at AGENT_USD_INR when omitted. */
    cost_inr?: number | null;
    error?: string | null;
    /** Machine slug: 'llm_timeout', 'rate_limited', 'bundle_violation', 'bad_json'. */
    error_class?: string | null;
    /** True when every claim traced to a row in a bundled table. */
    grounded?: boolean | null;
    /** 0..1 self-reported. */
    confidence?: number | null;
}

/**
 * Close a run. Also sweeps any step left open — a trace that ends mid-step is a
 * trace that lies about where the work stopped. Steps still running when a run
 * fails are marked 'failed', because that is where it died.
 *
 * duration_ms is intentionally not sent: the BEFORE trigger computes it from the
 * database's own clock, which is the only clock all runs share.
 */
export async function finishRun(
    runId: string | null,
    patch: FinishRunPatch = {},
): Promise<{ ok: boolean }> {
    if (!runId) return { ok: false };

    const status: AgentRunStatus = patch.status ?? 'succeeded';
    const endedAt = new Date().toISOString();
    const failed = status === 'failed' || status === 'timeout';

    try {
        const { error } = await supabaseAdmin
            .from('oem_agent_runs')
            .update({
                status,
                ended_at: endedAt,
                // Cleared so trg_oem_runs_duration recomputes it from THIS
                // ended_at. It is normally already null and this changes
                // nothing; it matters after a reap, where the reaper's
                // settle-time duration would otherwise survive the real
                // outcome (the trigger only fills a NULL) and the run would
                // report a length nobody measured.
                duration_ms: null,
                outcome_summary: patch.outcome_summary ?? null,
                entity_ref: patch.entity_ref ?? null,
                tokens_in: patch.tokens_in ?? null,
                tokens_out: patch.tokens_out ?? null,
                cached_tokens: patch.cached_tokens ?? null,
                cost_usd: patch.cost_usd ?? null,
                cost_inr: patch.cost_inr ?? inrFromUsd(patch.cost_usd),
                error: patch.error ?? null,
                error_class: patch.error_class ?? null,
                grounded: patch.grounded ?? null,
                confidence: patch.confidence ?? null,
            })
            .eq('id', runId);
        if (error) {
            absorb('finishRun', error);
            return { ok: false };
        }
    } catch (error) {
        absorb('finishRun', error);
        return { ok: false };
    }

    try {
        const { error } = await supabaseAdmin
            .from('oem_agent_run_steps')
            .update({ status: failed ? 'failed' : 'ok', ended_at: endedAt })
            .eq('run_id', runId)
            .eq('status', 'running');
        if (error) absorb('finishRun:sweep', error);
    } catch (error) {
        absorb('finishRun:sweep', error);
    }

    return { ok: true };
}

/**
 * Close a run from a thrown error, preserving the message and classifying it.
 * Convenience for the `catch` arm of every agent job.
 */
export async function failRun(
    runId: string | null,
    error: unknown,
    errorClass?: string,
): Promise<{ ok: boolean }> {
    const message = (error as { message?: string })?.message ?? String(error);
    const timedOut = /timed out|timeout|abort/i.test(message);
    return finishRun(runId, {
        status: timedOut ? 'timeout' : 'failed',
        error: message.slice(0, 2000),
        error_class: errorClass ?? classifyError(message),
    });
}

/** Best-effort slug so the console can group failures by cause. */
export function classifyError(message: string): string {
    const m = message.toLowerCase();
    if (/timed out|timeout|aborted/.test(m)) return 'llm_timeout';
    if (/429|rate.?limit/.test(m)) return 'rate_limited';
    if (/401|403|unauthor|api key|not configured/.test(m)) return 'auth_failed';
    if (/bundle violation/.test(m)) return 'bundle_violation';
    if (/json|parse|unexpected token/.test(m)) return 'bad_json';
    if (/does not exist|schema cache/.test(m)) return 'not_provisioned';
    return 'unknown';
}

/* ---------------------------------------------------------------------------
 * 3b. reapStaleRuns — settle runs that died without ever reporting.
 *
 * WHY IT HAS TO EXIST. startRun's dedupe is deliberately read-only: a second
 * execution under the same run_key never touches the first execution's row (see
 * the runKey semantics above), and withAgentRun passes null to finishRun/failRun
 * for it. That is correct for a run that FINISHED, and it leaves exactly one
 * hole: when the execution that OWNS the row dies before finishRun — a Vercel
 * function timeout, a deploy kill, an OOM — nothing settles it. The row stays
 * status 'running' with no ended_at forever: pulse reports last_status
 * 'running', the console's activity card stays "working", and the run sits in
 * the in-flight count and outside every settled denominator for good.
 *
 * WHAT IT WRITES, AND WHAT IT REFUSES TO WRITE. A reaped run is marked
 * 'timeout' with error_class 'abandoned'. NEVER 'succeeded' and never 'failed':
 * which one it was is not known here, and writing a guess into the permanent
 * record is the exact failure this file exists to prevent. 'abandoned' claims
 * only the one thing that is actually observed — the run never reported an end.
 *
 * THE SAFETY GUARD. Every settle is a CONDITIONAL update (.eq('status',
 * 'running')). A worker that finished a moment before the sweep therefore keeps
 * its real outcome; the reaper counts that row as `raced`, not as settled. The
 * reverse order is harmless — the worker's own finishRun overwrites the reap
 * with the truth.
 *
 * ended_at IS THE MOMENT WE DECLARED IT ABANDONED, not the moment it died,
 * which nobody observed. Two consequences, both deliberate:
 *   * duration_ms (filled by trg_oem_runs_duration from ended_at - started_at)
 *     is an UPPER BOUND on the real runtime, not a measurement, and it does
 *     enter oem_agent_profile's p50/p95 — those percentiles take every non-null
 *     duration_ms. error_class = 'abandoned' is how a consumer excludes them.
 *   * It matches what the rest of the repo already does for a terminal status
 *     that arrives with no end time (app/api/agents/runs/route.ts:488-491).
 * Leaving ended_at null would keep the percentiles pristine at the price of a
 * settled row that still looks unfinished to every ended_at-based reader, and
 * of a duration_ms the trigger can then never fill. The repo's convention wins,
 * and the distortion is named here rather than hidden.
 *
 * STEPS. A step left 'running' under a settled run is the same lie in
 * miniature — the feed would render it as still in flight. Open steps of a
 * reaped run are closed 'failed' with the same ended_at, identical to what
 * finishRun does on the timeout path.
 *
 * WHAT REAPING DOES NOT FIX. The run_key stays claimed. A later retry under the
 * same key still collides on the unique index, still gets deduped:true, and is
 * still not traced — reaping only corrects the record of the run that died, it
 * does not free the key for the retry that succeeded.
 * ------------------------------------------------------------------------- */

/** error_class stamped on a run that never reported completion. */
export const ABANDONED_ERROR_CLASS = 'abandoned';

/**
 * Threshold for an agent whose runtime config sets no timeout_sec.
 *
 * 15 minutes, chosen against two facts rather than taste: no serverless
 * execution on this platform can still be alive at 15 minutes (Vercel's
 * per-function ceiling is far below it), and the agent-heartbeat cron that
 * calls this runs every 10 minutes, so a run opened just after one sweep is
 * never eligible on the next one. A run older than this is not slow; it is gone.
 */
export const DEFAULT_ABANDON_AFTER_SEC = 15 * 60;

/**
 * Added to an agent's own runtime.timeout_sec. A run sitting exactly at its
 * configured timeout is usually a worker in the middle of writing its own
 * failure; two minutes lets it, and absorbs any clock skew between the machine
 * that stamped started_at and the machine running the sweep.
 */
const ABANDON_GRACE_SEC = 120;

/** Floor under any per-agent threshold, so a nonsense timeout_sec (5) cannot reap live work. */
const MIN_ABANDON_AFTER_SEC = 300;

/** Candidate rows read in one sweep. Bounded: a backlog drains over several sweeps. */
const REAP_SCAN_LIMIT = 500;

/** Run ids per step-closing batch, to keep the PostgREST URL a sane length. */
const REAP_STEP_BATCH = 50;

/** How old a run of this agent must be before it counts as abandoned. */
export function abandonAfterSec(timeoutSec?: number | null): number {
    if (timeoutSec == null || !Number.isFinite(timeoutSec) || timeoutSec <= 0) {
        return DEFAULT_ABANDON_AFTER_SEC;
    }
    return Math.max(Math.round(timeoutSec) + ABANDON_GRACE_SEC, MIN_ABANDON_AFTER_SEC);
}

export interface ReapOptions {
    /**
     * `${orgId}:${agentKey}` -> that agent's runtime.timeout_sec. Any run whose
     * agent is absent from the map is judged by DEFAULT_ABANDON_AFTER_SEC, so a
     * paused or retired agent's dead run is still settled.
     */
    timeoutSecByAgent?: Map<string, number | null | undefined>;
    /** Candidate ceiling for one sweep (clamped to REAP_SCAN_LIMIT). */
    limit?: number;
    /** Injectable clock, for tests. */
    now?: Date;
}

export interface ReapedRun {
    run_id: string;
    organization_id: string;
    agent_key: string;
    run_key: string | null;
    started_at: string;
    /** Age at the moment of the sweep. An upper bound on how long it actually ran. */
    age_sec: number;
    /** The threshold this run was judged against. */
    threshold_sec: number;
}

export interface ReapResult {
    /** Candidate rows read (already past the widest cutoff). */
    scanned: number;
    /** Of those, past their OWN agent's threshold. */
    stale: number;
    /** Actually settled by this sweep. */
    settled: number;
    /** Settled by their own worker between the read and the write. Not a failure. */
    raced: number;
    /** Settle attempts that errored. */
    failed: number;
    /** False when the scan hit its limit or the read failed — more may remain. */
    complete: boolean;
    /** The runs table is not there yet. NOT the same as `errored`. */
    notProvisioned: boolean;
    /** A genuine query failure — the table exists and the read/write still failed. */
    errored: boolean;
    /** What was settled, so the caller can print it rather than assert a number. */
    runs: ReapedRun[];
}

/**
 * Sweep every organization for runs that never reported completion and settle
 * them. Never throws. Returns what it did, including what it could NOT do.
 */
export async function reapStaleRuns(opts: ReapOptions = {}): Promise<ReapResult> {
    const now = opts.now ?? new Date();
    const limit = Math.max(1, Math.min(opts.limit ?? REAP_SCAN_LIMIT, REAP_SCAN_LIMIT));
    const perAgent = opts.timeoutSecByAgent ?? new Map<string, number | null | undefined>();

    const out: ReapResult = {
        scanned: 0, stale: 0, settled: 0, raced: 0, failed: 0,
        complete: true, notProvisioned: false, errored: false, runs: [],
    };

    // The widest cutoff any agent could ask for. A run newer than this cannot be
    // stale under ANY threshold, so the database never hands it over.
    let minThreshold = DEFAULT_ABANDON_AFTER_SEC;
    for (const t of perAgent.values()) minThreshold = Math.min(minThreshold, abandonAfterSec(t));
    const cutoff = new Date(now.getTime() - minThreshold * 1000).toISOString();

    interface Candidate {
        id: string;
        organization_id: string;
        agent_key: string;
        run_key: string | null;
        started_at: string;
    }

    let candidates: Candidate[] = [];
    try {
        const { data, error } = await supabaseAdmin
            .from('oem_agent_runs')
            .select('id, organization_id, agent_key, run_key, started_at')
            .eq('status', 'running')
            .lt('started_at', cutoff)
            // Oldest first: the most certainly dead, and a backlog drains in order.
            .order('started_at', { ascending: true })
            .limit(limit);
        if (error) {
            absorb('reapStaleRuns', error);
            out.complete = false;
            if (failureClass(error) === 'not_provisioned') out.notProvisioned = true;
            else out.errored = true;
            return out;
        }
        candidates = (data ?? []) as Candidate[];
    } catch (error) {
        absorb('reapStaleRuns', error);
        out.complete = false;
        out.errored = true;
        return out;
    }

    out.scanned = candidates.length;
    // A full page means there may be more behind it. The next sweep gets them.
    if (candidates.length >= limit) out.complete = false;

    const settledAt = now.toISOString();
    const settledIds: string[] = [];

    for (const row of candidates) {
        const thresholdSec = abandonAfterSec(
            perAgent.get(`${row.organization_id}:${row.agent_key}`),
        );
        const startedMs = Date.parse(row.started_at);
        if (!Number.isFinite(startedMs)) continue;
        const ageSec = Math.round((now.getTime() - startedMs) / 1000);
        if (ageSec < thresholdSec) continue;
        out.stale++;

        try {
            const { data, error } = await supabaseAdmin
                .from('oem_agent_runs')
                .update({
                    status: 'timeout' as AgentRunStatus,
                    ended_at: settledAt,
                    error:
                        `No completion was ever reported. This run was opened ${ageSec}s ago and is `
                        + `past its ${thresholdSec}s threshold, so the agent-heartbeat reaper settled it. `
                        + `Whether the work itself finished is NOT known, and ended_at is the time of `
                        + `this reap, not the time the execution stopped — that moment was never observed.`,
                    error_class: ABANDONED_ERROR_CLASS,
                    outcome_summary:
                        'Abandoned — the run never reported completion and was settled by the reaper. '
                        + 'The outcome is unknown: not a recorded success and not a recorded failure.',
                })
                .eq('id', row.id)
                // STILL unsettled. Without this, a worker that finished a second
                // ago would have its real outcome overwritten with 'timeout'.
                .eq('status', 'running')
                .select('id');

            if (error) {
                absorb('reapStaleRuns:settle', error);
                out.failed++;
                continue;
            }
            if (!data || (data as unknown[]).length === 0) {
                // It settled itself between the read and the write. Correct outcome, ours discarded.
                out.raced++;
                continue;
            }
            out.settled++;
            settledIds.push(row.id);
            out.runs.push({
                run_id: row.id,
                organization_id: row.organization_id,
                agent_key: row.agent_key,
                run_key: row.run_key ?? null,
                started_at: row.started_at,
                age_sec: ageSec,
                threshold_sec: thresholdSec,
            });
        } catch (error) {
            absorb('reapStaleRuns:settle', error);
            out.failed++;
        }
    }

    // Close the steps those runs left open, in batches. Same status finishRun
    // writes on the timeout path: 'failed' here means "never reported an end".
    for (let i = 0; i < settledIds.length; i += REAP_STEP_BATCH) {
        const batch = settledIds.slice(i, i + REAP_STEP_BATCH);
        try {
            const { error } = await supabaseAdmin
                .from('oem_agent_run_steps')
                .update({ status: 'failed' as AgentStepStatus, ended_at: settledAt })
                .in('run_id', batch)
                .eq('status', 'running');
            if (error) absorb('reapStaleRuns:steps', error);
        } catch (error) {
            absorb('reapStaleRuns:steps', error);
        }
    }

    if (out.settled > 0) {
        console.warn(
            `[agent runtime] reapStaleRuns: settled ${out.settled} run(s) as `
            + `'timeout'/'${ABANDONED_ERROR_CLASS}' — they never reported completion. `
            + `Their ended_at is this sweep's clock, so duration_ms on those rows is an upper bound.`,
        );
    }

    return out;
}

/* ---------------------------------------------------------------------------
 * 4. beat — heartbeat / uptime
 * ------------------------------------------------------------------------- */

export interface BeatResult {
    recorded: boolean;
    beatAt: string;
    /**
     * null when the beat landed. Otherwise WHY it did not: 'not_provisioned'
     * means the heartbeats table is not there yet, 'error' means the table
     * resolved and the write failed anyway. A caller that collapses these two
     * tells an operator to run a migration that is already applied.
     */
    failure: RuntimeFailure | null;
}

/**
 * One heartbeat. `reason` is a MACHINE SLUG, never prose — the console groups
 * outages by it ('llm_key_missing', 'bolna_401', 'rate_limited', 'quiet_hours').
 *
 * The insert alone is enough in a correctly migrated database:
 * trg_oem_heartbeat_apply pushes state + beat_at onto oem_agents. The explicit
 * UPDATE that follows is belt-and-braces for an environment where that trigger
 * was dropped or the table was created by hand. It is idempotent — it writes the
 * values the trigger just wrote — and it carries the same monotonic guard, so a
 * late beat can never overwrite a newer one.
 */
export async function beat(
    orgId: string,
    agentKey: string,
    state: AgentHeartbeatState,
    reason?: AgentHeartbeatReason | null,
    latencyMs?: number | null,
    detail?: Record<string, unknown>,
): Promise<BeatResult> {
    const beatAt = new Date().toISOString();

    try {
        const { error } = await supabaseAdmin.from('oem_agent_heartbeats').insert({
            organization_id: orgId,
            agent_key: agentKey,
            beat_at: beatAt,
            state,
            reason: reason ?? (state === 'up' ? 'ok' : null),
            latency_ms: latencyMs ?? null,
            detail: detail ?? {},
        });
        if (error) {
            absorb('beat', error);
            return { recorded: false, beatAt, failure: failureClass(error) };
        }
    } catch (error) {
        absorb('beat', error);
        return { recorded: false, beatAt, failure: failureClass(error) };
    }

    try {
        const { error } = await supabaseAdmin
            .from('oem_agents')
            .update({ health_state: state, last_heartbeat_at: beatAt })
            .eq('organization_id', orgId)
            .eq('agent_key', agentKey)
            // Mirrors the trigger's guard exactly, NULL included: an out-of-order
            // beat must never roll the registry back to an older state.
            .or(`last_heartbeat_at.is.null,last_heartbeat_at.lte.${beatAt}`);
        if (error) absorb('beat:apply', error);
    } catch (error) {
        absorb('beat:apply', error);
    }

    return { recorded: true, beatAt, failure: null };
}

/* ---------------------------------------------------------------------------
 * 5. awardCoins — reinforcement
 * ------------------------------------------------------------------------- */

export interface AwardCoinsContext {
    runId?: string | null;
    feedbackId?: string | null;
    /** users.id of the operator who gave the signal; null for automatic awards. */
    userId?: string | null;
}

export interface AwardCoinsResult {
    /** New balance, or null when nothing was recorded. */
    balance: number | null;
    recorded: boolean;
    /**
     * True when the ledger row was written by oem_award_coins(), which holds a
     * FOR UPDATE lock on the registry row across the read and the insert.
     * False means the JS fallback below ran and the balance may be stale.
     */
    atomic: boolean;
}

/**
 * Post a coin delta.
 *
 * CONCURRENCY — this is a read-then-write, and it matters. Two operators
 * praising the same run in the same second must not both read balance 40 and
 * both write 45.
 *
 * The primary path is the SQL function oem_award_coins(), which does
 * `SELECT coins_balance ... FOR UPDATE` and the INSERT inside one statement, so
 * the second caller blocks until the first commits and reads 45, not 40. Use it.
 *
 * The fallback runs only when that function is missing (a database migrated by
 * hand, or an older copy of the migration). It computes the balance from
 * SUM(delta) over the ledger and is HONESTLY RACY: two concurrent callers can
 * read the same sum and write the same balance_after. The deltas are still all
 * recorded, so the ledger's SUM stays correct and a later award self-heals the
 * cached balance — only the intermediate balance_after values can be wrong.
 * That is the deliberate trade: never lose a signal, tolerate a bad snapshot.
 */
export async function awardCoins(
    orgId: string,
    agentKey: string,
    delta: number,
    reason: string,
    ctx: AwardCoinsContext = {},
): Promise<AwardCoinsResult> {
    if (!Number.isFinite(delta) || delta === 0) {
        return { balance: null, recorded: false, atomic: false };
    }
    const rounded = Math.trunc(delta);

    try {
        const { data, error } = await supabaseAdmin.rpc('oem_award_coins', {
            p_org: orgId,
            p_agent_key: agentKey,
            p_delta: rounded,
            p_reason: reason,
            p_feedback: ctx.feedbackId ?? null,
            p_run: ctx.runId ?? null,
            p_created_by: ctx.userId ?? null,
        });
        if (!error) {
            return { balance: typeof data === 'number' ? data : null, recorded: true, atomic: true };
        }
        // PGRST202 / 42883 = the helper function is not there. Anything else is real.
        const code = (error as { code?: string }).code;
        if (code !== 'PGRST202' && code !== '42883') {
            absorb('awardCoins:rpc', error);
            return { balance: null, recorded: false, atomic: false };
        }
        console.warn(
            '[agent runtime] oem_award_coins() is missing — falling back to a racy '
            + `read-then-write. Re-run migration ${AGENT_RUNTIME_MIGRATION}.`,
        );
    } catch (error) {
        if (!isNotProvisionedError(error)) {
            absorb('awardCoins:rpc', error);
            return { balance: null, recorded: false, atomic: false };
        }
    }

    // ---- Racy fallback. See the doc comment above.
    try {
        const { data: rows, error: sumError } = await supabaseAdmin
            .from('oem_agent_coin_ledger')
            .select('delta')
            .eq('organization_id', orgId)
            .eq('agent_key', agentKey);
        if (sumError) {
            absorb('awardCoins:sum', sumError);
            return { balance: null, recorded: false, atomic: false };
        }

        const current = (rows ?? []).reduce(
            (acc: number, r: { delta: number | null }) => acc + (r.delta ?? 0),
            0,
        );
        const balanceAfter = current + rounded;

        const { error: insertError } = await supabaseAdmin.from('oem_agent_coin_ledger').insert({
            organization_id: orgId,
            agent_key: agentKey,
            delta: rounded,
            balance_after: balanceAfter,
            reason,
            feedback_id: ctx.feedbackId ?? null,
            run_id: ctx.runId ?? null,
            created_by: ctx.userId ?? null,
        });
        if (insertError) {
            absorb('awardCoins:insert', insertError);
            return { balance: null, recorded: false, atomic: false };
        }

        // trg_oem_coin_ledger_apply normally mirrors this onto the registry; do it
        // here too so the fallback path leaves the cache no worse than it found it.
        const { error: cacheError } = await supabaseAdmin
            .from('oem_agents')
            .update({ coins_balance: balanceAfter })
            .eq('organization_id', orgId)
            .eq('agent_key', agentKey);
        if (cacheError) absorb('awardCoins:cache', cacheError);

        return { balance: balanceAfter, recorded: true, atomic: false };
    } catch (error) {
        absorb('awardCoins', error);
        return { balance: null, recorded: false, atomic: false };
    }
}
