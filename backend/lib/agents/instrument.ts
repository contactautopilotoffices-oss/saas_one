/**
 * AGENT INSTRUMENTATION — the producer side of the runtime recorder.
 * -----------------------------------------------------------------------------
 * backend/lib/agents/runtime.ts is the WRITER. This file is the thing jobs
 * actually call, so instrumenting a cron or a route is three lines:
 *
 *     return withAgentRun(
 *         { orgId, agentKey: 'ira', module: 'procurement', trigger: 'cron',
 *           runKey: dailyRunKey('ira-daily-digest') },
 *         async (step) => {
 *             const s = await step('Reading open requisitions', 'fetch');
 *             const tasks = await getDailyTasks();
 *             await s.ok({ detail: { rows: tasks.length } });
 *             return { outcome: `${tasks.length} open tasks`, result: tasks };
 *         },
 *     );
 *
 * ── THE ONE RULE ────────────────────────────────────────────────────────────
 * INSTRUMENTATION MUST NEVER CHANGE A JOB'S OUTCOME.
 *
 * Everything here is wrapped so a recorder failure — missing tables before the
 * migration lands, a network blip, a constraint trip — is swallowed, logged
 * once per scope, and the job proceeds exactly as if it had never been
 * instrumented. A telemetry layer that can break a cron is worse than no
 * telemetry at all.
 *
 * The single deliberate exception: if the JOB ITSELF throws, we record the
 * failure and RE-THROW. Swallowing the job's own error would change its
 * outcome — the caller's catch block must still see what it always saw.
 *
 * Schema: supabase/migrations/20260830000001_agent_runtime.sql (not yet applied)
 */

import {
    classifyError,
    failRun,
    finishRun,
    startRun,
    type StartedRun,
    type StepFn,
    type StepHandle,
    type StepPatch,
} from '@/backend/lib/agents/runtime';
import {
    normalizeModule,
    type AgentRunStatus,
    type AgentRunTrigger,
    type AgentStepStatus,
    type AgentStepType,
} from '@/frontend/types/agentRuntime';

/* ---------------------------------------------------------------------------
 * Failure containment. Loud once, then silent; never propagates.
 * ------------------------------------------------------------------------- */

const warnedScopes = new Set<string>();

async function safely<R>(scope: string, fallback: R, fn: () => Promise<R>): Promise<R> {
    try {
        return await fn();
    } catch (error) {
        if (!warnedScopes.has(scope)) {
            warnedScopes.add(scope);
            const message = (error as { message?: string })?.message ?? String(error);
            console.warn(
                `[agent instrument] ${scope} failed — telemetry only, the job is unaffected: ${message}`,
            );
        }
        return fallback;
    }
}

/** A handle that records nothing. Returned whenever the recorder is unavailable. */
const DEAD_HANDLE: StepHandle = {
    id: null,
    seq: 0,
    async end() { /* not recording */ },
    async ok() { /* not recording */ },
    async fail() { /* not recording */ },
};

/**
 * Wrap the recorder's step function so neither step() nor any method on the
 * handle it returns can throw into the job. runtime.ts already absorbs its own
 * database errors; this guards the layer above that — a serialisation failure
 * on `detail`, a handle used after the process moved on, anything unforeseen.
 */
function guardStep(step: StepFn): StepFn {
    return async (label: string, type?: AgentStepType, detail?: Record<string, unknown>) => {
        const handle = await safely('step', DEAD_HANDLE, () => step(label, type, detail));
        return {
            id: handle.id,
            seq: handle.seq,
            end: (status?: AgentStepStatus, patch?: StepPatch) =>
                safely('step:end', undefined, () => handle.end(status, patch)),
            ok: (patch?: StepPatch) => safely('step:ok', undefined, () => handle.ok(patch)),
            fail: (error: unknown, patch?: StepPatch) =>
                safely('step:fail', undefined, () => handle.fail(error, patch)),
        };
    };
}

/* ---------------------------------------------------------------------------
 * Public surface
 * ------------------------------------------------------------------------- */

export interface AgentRunOptions {
    orgId: string;
    /** oem_agents.agent_key — 'ira', 'pratiksha'. */
    agentKey: string;
    /**
     * AgentModule slug. Passed through normalizeModule(), so 'Procurement' and
     * 'procurement' land as the same module and an unknown string lands as null
     * rather than as a module the console has no label for.
     */
    module?: string | null;
    trigger?: AgentRunTrigger;
    /**
     * Idempotency key, unique with (organization_id, agent_key). Use
     * dailyRunKey('job-name') for anything on a daily cadence.
     *
     * The FIRST call with a given key opens and owns the run. Every later call
     * with the same key is deduped: the job body still runs and still returns
     * its result, but nothing is written — no reset of the first run's status,
     * no extra steps on its trace, no second outcome over its first. See
     * startRun in runtime.ts.
     *
     * KNOW THE COST BEFORE YOU PICK A KEY. If the execution that owns the run
     * DIES before finishRun (function timeout, deploy kill, OOM), the retry that
     * actually succeeds is deduped too — its work happens, and none of it is
     * recorded. reapStaleRuns() (agent-heartbeat cron) settles the dead row as
     * 'timeout' / 'abandoned' so it stops reading as in-flight, but it does NOT
     * release the key: the retry stays untraced. The key window is the blast
     * radius, so dailyRunKey() suits a job that legitimately runs once a day,
     * and a job that should be traced on every attempt should pass no runKey.
     */
    runKey?: string | null;
    model?: string | null;
    provider?: string | null;
}

/**
 * What the job hands back. Everything except `outcome` is optional, and OMITTED
 * IS THE HONEST DEFAULT: a job that makes no LLM call must leave the token
 * fields alone. null reads as "not measured"; 0 reads as "measured, and it was
 * zero", which would be a claim we cannot make.
 */
export interface AgentRunReport<T = void> {
    /** One line an operator reads in the console. */
    outcome: string;
    /** id / URL of whatever the run produced or touched. */
    entityRef?: string | null;
    /** REAL usage off the provider's response. Omit when there was no call. */
    tokensIn?: number | null;
    tokensOut?: number | null;
    cachedTokens?: number | null;
    costUsd?: number | null;
    /** True only when every claim traced to a row in a bundled table. */
    grounded?: boolean | null;
    confidence?: number | null;
    /** 'succeeded' unless the job decided there was nothing to do ('skipped'). */
    status?: Extract<AgentRunStatus, 'succeeded' | 'skipped'>;
    /** Whatever the job produced. Handed straight back to the caller. */
    result?: T;
}

/**
 * Open a run, hand the job a step recorder, and close the run on the way out.
 *
 * Returns whatever the job put in `report.result`, or null when it returned
 * none — so a job that only needs the telemetry can ignore the return value.
 *
 * Throws only what the job itself throws (after recording the failure).
 */
export async function withAgentRun<T = void>(
    opts: AgentRunOptions,
    fn: (step: StepFn) => Promise<AgentRunReport<T>>,
): Promise<T | null> {
    const started = await safely(
        'startRun',
        {
            runId: null,
            step: (async () => DEAD_HANDLE) as StepFn,
            recording: false,
            deduped: false,
        } as StartedRun,
        () =>
            startRun({
                orgId: opts.orgId,
                agentKey: opts.agentKey,
                module: normalizeModule(opts.module),
                trigger: opts.trigger ?? 'manual',
                runKey: opts.runKey ?? null,
                model: opts.model ?? null,
                provider: opts.provider ?? null,
            }),
    );

    const step = guardStep(started.step);

    /**
     * THE ONLY run id we are allowed to write to.
     *
     * When startRun deduped, started.runId points at a run THIS CALL DID NOT
     * OPEN — an earlier execution under the same run_key. Finishing it here
     * would stamp our outcome, tokens and cost onto somebody else's record;
     * failing it would mark a run that succeeded hours ago as failed. Passing
     * null instead makes finishRun/failRun no-ops, which is the whole point of
     * a dedupe: the work still runs and the caller still gets its result, but
     * the second execution writes nothing.
     */
    const writableRunId = started.deduped ? null : started.runId;

    let report: AgentRunReport<T>;
    try {
        report = await fn(step);
    } catch (error) {
        // Record, then re-throw: the caller's error handling must be untouched.
        await safely('failRun', { ok: false }, () =>
            failRun(writableRunId, error, classifyError(
                (error as { message?: string })?.message ?? String(error),
            )),
        );
        throw error;
    }

    await safely('finishRun', { ok: false }, () =>
        finishRun(writableRunId, {
            status: report.status ?? 'succeeded',
            outcome_summary: report.outcome,
            entity_ref: report.entityRef ?? null,
            tokens_in: report.tokensIn ?? null,
            tokens_out: report.tokensOut ?? null,
            cached_tokens: report.cachedTokens ?? null,
            cost_usd: report.costUsd ?? null,
            grounded: report.grounded ?? null,
            confidence: report.confidence ?? null,
        }),
    );

    return report.result ?? null;
}

/**
 * `job-name:2026-08-30` — the idempotency key for anything on a daily cadence.
 * A Vercel retry inside the same day is deduped against the run already
 * recorded rather than writing a second one, so "runs today" stays a count of
 * days' work, not of platform retries. UTC, because that is the clock Vercel's
 * scheduler uses.
 */
export function dailyRunKey(jobName: string, when: Date = new Date()): string {
    return `${jobName}:${when.toISOString().slice(0, 10)}`;
}
