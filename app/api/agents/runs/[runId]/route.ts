import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import {
    AGENT_MODULES,
    AGENT_RUNTIME_MIGRATION,
    isNotProvisionedError,
    normalizeModule,
} from '@/frontend/types/agentRuntime';

/**
 * ONE RUN, WITH ITS STEP TRACE.
 *
 * GET   /api/agents/runs/[runId][?orgId=]
 *       -> { provisioned, run, steps: [...], rollup: {...} }
 *
 *       This is the drawer behind a row of the runs table: Planning -> Fetching open
 *       requisitions -> Calling model -> Writing draft PO -> Notifying procurement, each
 *       line carrying its own duration and token count. Steps come back ordered by `seq`,
 *       and `rollup` answers the question a flat list of labels cannot: where did the time
 *       and the money actually go. `share_pct` per step and `by_type` totals mean an
 *       operator can see at a glance that 80% of a slow run was one tool call, not the LLM.
 *
 * PATCH /api/agents/runs/[runId][?orgId=]
 *       body: { status?, ended_at?, tokens_in?, ..., outcome_summary?, steps?: [...] }
 *       -> { provisioned, run, steps_appended }
 *       -> { ..., steps_appended: 0, appended: false, reason: 'seq_conflict' } when two
 *          writers raced on the same seq and the retries did not clear it. Still HTTP 200:
 *          nothing was written, nothing is half-written, resend the same batch.
 *       -> 409 { immutable: true } when the run has already reached a terminal status.
 *          A finished run cannot be patched at all — not its fields, not its trace.
 *       -> 403 when the database refuses the write. oem_agent_runs has no UPDATE policy
 *          and no UPDATE grant to `authenticated` (see section 10 of the migration): the
 *          run log is written by the runtime through the service role. That is a
 *          permission, and it is reported as one — never as a 500.
 *
 *       Two-phase runs: POST /api/agents/runs opens the run (status 'running', a run_key
 *       for idempotency), then each step appends here as it happens and a final PATCH closes
 *       it. Without this the trace could only ever be written after the fact, and a feed
 *       that only fills in once the work is over is a report, not a live feed. Appended
 *       steps continue the existing `seq` rather than restarting it. The direction is
 *       one-way: running -> terminal, once.
 *
 * TENANCY. Browser callers read through the RLS-scoped client, so oem_select_org_member
 * decides what they can see. The CRON_SECRET path uses the service role, which bypasses
 * RLS — so that path MUST pass orgId and every query is filtered by it explicitly.
 *
 * NOT PROVISIONED. Degrades to { provisioned: false, run: null, steps: [] } with HTTP 200
 * when 20260830000001_agent_runtime.sql has not been applied.
 */

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ runId: string }> };
type Db = Awaited<ReturnType<typeof createClient>>;

/** Shared with the recorder and the console: frontend/types/agentRuntime.ts. */
const isUnprovisioned = isNotProvisionedError;

const NOT_PROVISIONED_REASON =
    `Agent runtime is not set up yet — apply supabase/migrations/${AGENT_RUNTIME_MIGRATION}.sql.`;

const RUN_STATUSES = ['running', 'succeeded', 'failed', 'skipped', 'timeout'] as const;
const STEP_TYPES = ['plan', 'think', 'llm', 'tool', 'fetch', 'write', 'notify', 'decide', 'error'] as const;
const STEP_STATUSES = ['running', 'ok', 'failed', 'skipped'] as const;
const TERMINAL_STATUSES = new Set(['succeeded', 'failed', 'skipped', 'timeout']);
const MAX_STEPS_PER_CALL = 200;
/** Backoff between seq-collision retries. Length + 1 = attempts. */
const SEQ_RETRY_DELAYS_MS = [30, 90];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Fields a PATCH may close out, and only while the run is still 'running' — see the
 *  terminal-status guard in PATCH. Anything not here (agent_key, run_key, started_at,
 *  organization_id) is provenance and stays immutable — a run you can rewrite is not a log. */
const PATCHABLE = [
    'status', 'ended_at', 'duration_ms', 'module', 'provider', 'model', 'temperature', 'top_p',
    'max_tokens', 'context_window', 'tokens_in', 'tokens_out', 'cached_tokens', 'cost_usd',
    'cost_inr', 'prompt_version', 'bundle_version', 'outcome_summary', 'entity_ref', 'error',
    'error_class', 'grounded', 'confidence',
] as const;

const INT_FIELDS = new Set([
    'duration_ms', 'max_tokens', 'context_window', 'tokens_in', 'tokens_out', 'cached_tokens',
    'prompt_version', 'bundle_version',
]);
const NUM_FIELDS = new Set(['temperature', 'top_p', 'cost_usd', 'cost_inr', 'confidence']);
const BOOL_FIELDS = new Set(['grounded']);
const TS_FIELDS = new Set(['ended_at']);

const toInt = (v: unknown): number | null => {
    if (v === null || v === undefined || v === '') return null;
    const n = Math.trunc(Number(v));
    return Number.isFinite(n) ? n : null;
};
const toNum = (v: unknown): number | null => {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
};
const toBool = (v: unknown): boolean | null =>
    v === true || v === 'true' ? true : v === false || v === 'false' ? false : null;
const toText = (v: unknown): string | null => {
    if (v === null || v === undefined) return null;
    const s = String(v).trim();
    return s === '' ? null : s;
};
const toIso = (v: unknown): string | null => {
    const s = toText(v);
    if (!s) return null;
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

function isCron(request: NextRequest): boolean {
    const secret = process.env.CRON_SECRET;
    return !!secret && request.headers.get('authorization') === `Bearer ${secret}`;
}

function readOrgId(request: NextRequest, body?: Record<string, unknown>): string | null {
    const sp = new URL(request.url).searchParams;
    return (
        sp.get('orgId') || sp.get('org_id') || sp.get('organization_id') ||
        (typeof body?.organization_id === 'string' ? body.organization_id : null) ||
        (typeof body?.orgId === 'string' ? body.orgId : null) ||
        null
    );
}

async function resolveDb(
    request: NextRequest,
    orgId: string | null,
): Promise<{ db: Db; via: 'cron' | 'user' } | NextResponse> {
    if (isCron(request)) {
        // The service role bypasses RLS, so without an orgId this handler would happily read
        // any tenant's run by uuid. Refuse rather than trust the uuid to be unguessable.
        if (!orgId) return NextResponse.json({ error: 'orgId is required for service-role calls' }, { status: 400 });
        return { db: supabaseAdmin as unknown as Db, via: 'cron' };
    }
    const db = await createClient();
    const { data: { user } } = await db.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return { db, via: 'user' };
}

const round = (n: number, dp: number) => Number(n.toFixed(dp));

// ---------------------------------------------------------------------------
// GET — run + ordered step trace + where-the-time-went rollup
// ---------------------------------------------------------------------------
export async function GET(request: NextRequest, { params }: Params) {
    try {
        const { runId } = await params;
        const orgId = readOrgId(request);
        const resolved = await resolveDb(request, orgId);
        if (resolved instanceof NextResponse) return resolved;
        const { db } = resolved;

        let runQuery = db.from('oem_agent_runs').select('*').eq('id', runId);
        if (orgId) runQuery = runQuery.eq('organization_id', orgId);
        const runRes = await runQuery.maybeSingle();

        if (isUnprovisioned(runRes.error)) return notProvisioned();
        if (runRes.error) return NextResponse.json({ error: runRes.error.message }, { status: 500 });
        if (!runRes.data) return NextResponse.json({ error: 'Run not found' }, { status: 404 });

        const run = runRes.data as Record<string, unknown> & {
            agent_key: string; organization_id: string; duration_ms: number | null;
        };

        const [stepsRes, agentRes] = await Promise.all([
            db.from('oem_agent_run_steps').select('*').eq('run_id', runId).order('seq', { ascending: true }),
            db.from('oem_agents')
                .select('agent_key, display_name, department, status')
                .eq('organization_id', run.organization_id)
                .eq('agent_key', run.agent_key)
                .maybeSingle(),
        ]);

        if (isUnprovisioned(stepsRes.error)) {
            return NextResponse.json({
                provisioned: false, migration: AGENT_RUNTIME_MIGRATION, reason: NOT_PROVISIONED_REASON,
                run, steps: [], rollup: emptyRollup(),
            });
        }
        if (stepsRes.error) return NextResponse.json({ error: stepsRes.error.message }, { status: 500 });

        type StepRow = Record<string, unknown> & { seq: number; step_type: string; duration_ms: number | null };
        const rawSteps = (stepsRes.data ?? []) as unknown as StepRow[];
        const agent = (agentRes.data ?? null) as { display_name?: string; department?: string | null } | null;

        const rollup = computeRollup(rawSteps, run.duration_ms);
        // Denominator is the run's own wall clock when we have it: steps that ran in parallel
        // should read as parallel, not sum to more than 100% of a run they fit inside.
        const denom = Number(run.duration_ms) > 0 ? Number(run.duration_ms) : rollup.total_step_ms;
        const steps = rawSteps.map((s) => ({
            ...s,
            share_pct: denom > 0 && Number.isFinite(Number(s.duration_ms))
                ? round((Number(s.duration_ms) / denom) * 100, 1)
                : null,
        }));

        return NextResponse.json({
            provisioned: true,
            run: {
                ...run,
                agent_name: agent?.display_name ?? run.agent_key,
                department: agent?.department ?? null,
            },
            steps,
            rollup,
        });
    } catch (e) {
        return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
}

function notProvisioned() {
    return NextResponse.json({
        provisioned: false, migration: AGENT_RUNTIME_MIGRATION, reason: NOT_PROVISIONED_REASON,
        run: null, steps: [], rollup: emptyRollup(),
    });
}

/** The run has already ended. 409, not 400: the request was well formed, the state says no. */
function terminalConflict(runId: string, status: string) {
    return NextResponse.json(
        {
            error:
                `Run is '${status}' and can no longer be modified. A finished run is an audit ` +
                `record, not a draft: its status, outcome, cost and step trace are what the ` +
                `agent actually did. Open a new run instead.`,
            run_id: runId,
            status,
            immutable: true,
        },
        { status: 409 },
    );
}

/** The database refused the write. A permission — say so, do not dress it as a server fault. */
function forbiddenWrite(runId: string) {
    return NextResponse.json(
        {
            error:
                'Not permitted to write to the run log. oem_agent_runs is written by the agent ' +
                'runtime through the service role; org members read it (see section 10 of ' +
                `supabase/migrations/${AGENT_RUNTIME_MIGRATION}.sql).`,
            run_id: runId,
        },
        { status: 403 },
    );
}

function emptyRollup() {
    return {
        steps: 0, failed_steps: 0, total_step_ms: 0, unaccounted_ms: null as number | null,
        tokens_in: 0, tokens_out: 0,
        by_type: [] as Array<{
            step_type: string; steps: number; duration_ms: number;
            tokens_in: number; tokens_out: number; share_pct: number | null;
        }>,
        slowest_step: null as { seq: number; label: string; duration_ms: number } | null,
        heaviest_step: null as { seq: number; label: string; tokens: number } | null,
    };
}

function computeRollup(
    steps: Array<Record<string, unknown> & { seq: number; step_type: string; duration_ms: number | null }>,
    runDurationMs: number | null,
) {
    const r = emptyRollup();
    r.steps = steps.length;
    const byType = new Map<string, { steps: number; duration_ms: number; tokens_in: number; tokens_out: number }>();

    for (const s of steps) {
        const d = Number(s.duration_ms) || 0;
        const ti = Number(s.tokens_in ?? 0) || 0;
        const to = Number(s.tokens_out ?? 0) || 0;
        r.total_step_ms += d;
        r.tokens_in += ti;
        r.tokens_out += to;
        if (String(s.status ?? '') === 'failed') r.failed_steps += 1;

        const key = String(s.step_type ?? 'think');
        const bucket = byType.get(key) ?? { steps: 0, duration_ms: 0, tokens_in: 0, tokens_out: 0 };
        bucket.steps += 1;
        bucket.duration_ms += d;
        bucket.tokens_in += ti;
        bucket.tokens_out += to;
        byType.set(key, bucket);

        if (d > 0 && (!r.slowest_step || d > r.slowest_step.duration_ms)) {
            r.slowest_step = { seq: s.seq, label: String(s.label ?? ''), duration_ms: d };
        }
        const tokens = ti + to;
        if (tokens > 0 && (!r.heaviest_step || tokens > r.heaviest_step.tokens)) {
            r.heaviest_step = { seq: s.seq, label: String(s.label ?? ''), tokens };
        }
    }

    const denom = Number(runDurationMs) > 0 ? Number(runDurationMs) : r.total_step_ms;
    r.by_type = [...byType.entries()]
        .map(([step_type, b]) => ({
            step_type,
            steps: b.steps,
            duration_ms: b.duration_ms,
            tokens_in: b.tokens_in,
            tokens_out: b.tokens_out,
            share_pct: denom > 0 ? round((b.duration_ms / denom) * 100, 1) : null,
        }))
        .sort((a, b) => b.duration_ms - a.duration_ms);

    // Time inside the run that no step claimed: queueing, serialisation, an unlogged wait.
    // Naming it is what turns "the trace looks fast but the run was slow" into a lead.
    r.unaccounted_ms =
        Number(runDurationMs) > 0 ? Math.max(0, Number(runDurationMs) - r.total_step_ms) : null;
    return r;
}

// ---------------------------------------------------------------------------
// PATCH — close out a run and/or append trace steps
// ---------------------------------------------------------------------------
export async function PATCH(request: NextRequest, { params }: Params) {
    try {
        const { runId } = await params;
        let body: Record<string, unknown>;
        try {
            body = (await request.json()) as Record<string, unknown>;
        } catch {
            return NextResponse.json({ error: 'Body must be JSON' }, { status: 400 });
        }

        const orgId = readOrgId(request, body);
        const resolved = await resolveDb(request, orgId);
        if (resolved instanceof NextResponse) return resolved;
        const { db } = resolved;

        let findQuery = db.from('oem_agent_runs').select('id, organization_id, status').eq('id', runId);
        if (orgId) findQuery = findQuery.eq('organization_id', orgId);
        const found = await findQuery.maybeSingle();
        if (isUnprovisioned(found.error)) return notProvisioned();
        if (found.error) return NextResponse.json({ error: found.error.message }, { status: 500 });
        if (!found.data) return NextResponse.json({ error: 'Run not found' }, { status: 404 });
        const existing = found.data as { id: string; organization_id: string; status: string };

        // ── A RUN IN A TERMINAL STATUS IS IMMUTABLE ─────────────────────────────────────
        // The status read above is not decoration; it is the gate. Once a run has ended,
        // its row is a settled audit record: success_rate, uptime, cost and every latency
        // percentile in oem_agent_profile are computed from it, and an operator has very
        // likely already read it. Re-opening it to 'running', nulling its outcome_summary
        // or ended_at, or restating its cost is not a correction, it is a rewrite of
        // history — and appending steps to its trace is the same lie makeStepRecorder in
        // backend/lib/agents/runtime.ts refuses for its own writes:
        //
        //     "A short trace is a small loss; a trace that merges two executions is a lie
        //      about what the agent did."
        //
        // The two paths therefore agree: nothing is written to a finished run, by anyone,
        // through either door. The database says the same thing a second time —
        // oem_agent_runs and oem_agent_run_steps carry no UPDATE policy and no UPDATE
        // grant to `authenticated` (section 10 of 20260830000001_agent_runtime.sql).
        if (TERMINAL_STATUSES.has(existing.status)) {
            return terminalConflict(runId, existing.status);
        }

        const patch: Record<string, unknown> = {};
        for (const field of PATCHABLE) {
            if (!(field in body)) continue;
            const v = body[field];
            if (INT_FIELDS.has(field)) patch[field] = toInt(v);
            else if (NUM_FIELDS.has(field)) patch[field] = toNum(v);
            else if (BOOL_FIELDS.has(field)) patch[field] = toBool(v);
            else if (TS_FIELDS.has(field)) patch[field] = toIso(v);
            else patch[field] = toText(v);
        }

        if (typeof patch.status === 'string' && !(RUN_STATUSES as readonly string[]).includes(patch.status)) {
            return NextResponse.json({ error: `status must be one of ${RUN_STATUSES.join(', ')}` }, { status: 400 });
        }
        // Same rule as the recorder: `module` is a slug the console groups by, not free text.
        // 'Front Desk' and 'frontdesk' must not become two cards, and an unmappable value is
        // refused rather than guessed — a wrong slug files the work under someone else's agent.
        if (typeof patch.module === 'string') {
            const normalized = normalizeModule(patch.module);
            if (!normalized) {
                return NextResponse.json(
                    { error: `module '${patch.module}' is not a known module`, allowed: AGENT_MODULES },
                    { status: 400 },
                );
            }
            patch.module = normalized;
        }
        // 'running' is not a state a PATCH can move a run INTO. The guard above has already
        // proved this run is running, so a status:'running' in the body is an identity, not a
        // transition — drop it rather than write it, so the only direction this endpoint can
        // ever move a run is running -> terminal, once.
        if (patch.status === 'running') delete patch.status;
        // Closing a run without a clock leaves it out of every latency percentile forever.
        if (typeof patch.status === 'string' && TERMINAL_STATUSES.has(patch.status) && !patch.ended_at) {
            patch.ended_at = new Date().toISOString();
        }

        let run: unknown = null;
        if (Object.keys(patch).length) {
            const updateRes = await db
                .from('oem_agent_runs')
                .update(patch)
                .eq('id', runId)
                .eq('organization_id', existing.organization_id)
                // Compare-and-set on the status read a moment ago. The guard above is the
                // check; this is the enforcement. Another writer may close the run between
                // the two statements, and honouring this patch afterwards would be exactly
                // the overwrite of a finished run the guard exists to prevent.
                .eq('status', 'running')
                .select('*')
                .maybeSingle();
            if (isUnprovisioned(updateRes.error)) return notProvisioned();
            // 42501: the table-level UPDATE grant is withdrawn from `authenticated`. A
            // permission, not a server fault, and not a missing table.
            if (updateRes.error?.code === '42501') return forbiddenWrite(runId);
            if (updateRes.error) return NextResponse.json({ error: updateRes.error.message }, { status: 500 });
            if (!updateRes.data) {
                // Zero rows matched. Either the run reached a terminal status in the gap, or
                // RLS refused the write silently (no UPDATE policy = row invisible to UPDATE).
                // Report which — an absence is never fact here.
                const recheck = await db.from('oem_agent_runs').select('status').eq('id', runId).maybeSingle();
                if (recheck.error && !isUnprovisioned(recheck.error)) {
                    return NextResponse.json({ error: recheck.error.message }, { status: 500 });
                }
                const nowStatus = (recheck.data as { status?: string } | null)?.status ?? null;
                if (nowStatus && TERMINAL_STATUSES.has(nowStatus)) return terminalConflict(runId, nowStatus);
                return forbiddenWrite(runId);
            }
            run = updateRes.data;
        }

        const incoming = Array.isArray(body.steps) ? (body.steps as Array<Record<string, unknown>>) : [];
        let appended = 0;
        let stepsProvisioned = true;
        let seqConflict = false;
        if (incoming.length) {
            // A steps-only PATCH never went through the compare-and-set above, so the run
            // could have been closed since the guard read it. Re-check before appending:
            // the close-out flow (this same request setting a terminal status and shipping
            // its last steps) is legitimate because the CAS proved the run was ours to
            // close; appending to a run someone else already finished is not.
            if (!Object.keys(patch).length) {
                const recheck = await db.from('oem_agent_runs').select('status').eq('id', runId).maybeSingle();
                if (recheck.error && !isUnprovisioned(recheck.error)) {
                    return NextResponse.json({ error: recheck.error.message }, { status: 500 });
                }
                const nowStatus = (recheck.data as { status?: string } | null)?.status ?? null;
                if (nowStatus && TERMINAL_STATUSES.has(nowStatus)) return terminalConflict(runId, nowStatus);
            }
            // insertSteps reads the current max(seq) itself, because it has to re-read it on
            // every retry anyway — a max fetched out here would be the stale number that
            // caused the collision in the first place.
            const result = await insertSteps(db, existing.organization_id, runId, incoming);
            if (result.unprovisioned) stepsProvisioned = false;
            else if (result.error) return NextResponse.json({ error: result.error }, { status: 500 });
            else {
                appended = result.steps.length;
                seqConflict = result.seqConflict;
            }
        }

        if (!run) {
            const reread = await db.from('oem_agent_runs').select('*').eq('id', runId).maybeSingle();
            run = reread.data ?? null;
        }

        return NextResponse.json({
            provisioned: true,
            run,
            steps_appended: appended,
            ...(stepsProvisioned ? {} : { steps_provisioned: false }),
            // Nothing was written and nothing is half-written: resend the same steps.
            ...(seqConflict ? { appended: false, reason: 'seq_conflict' } : {}),
        });
    } catch (e) {
        return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
}

type StepWrite = {
    steps: unknown[];
    error: string | null;
    unprovisioned: boolean;
    /** Lost the numbering race after every retry. Not an error — nothing was written. */
    seqConflict: boolean;
};

function buildStepRow(
    s: Record<string, unknown>,
    orgId: string,
    runId: string,
    seq: number,
): Record<string, unknown> {
    const stepType = toText(s.step_type ?? s.type) ?? 'think';
    const stepStatus = toText(s.status) ?? 'ok';
    const safeType = (STEP_TYPES as readonly string[]).includes(stepType) ? stepType : 'think';
    return {
        run_id: runId,
        organization_id: orgId,
        seq,
        step_type: safeType,
        // Fallback is the step's own kind, never "Step 4": position is decided by the DB's
        // current max once a retry renumbers the batch, and a label that disagrees with the
        // seq beside it is a lie the operator has no way to spot.
        label: toText(s.label) ?? safeType,
        detail: s.detail && typeof s.detail === 'object' ? s.detail : {},
        tokens_in: toInt(s.tokens_in),
        tokens_out: toInt(s.tokens_out),
        duration_ms: toInt(s.duration_ms),
        status: (STEP_STATUSES as readonly string[]).includes(stepStatus) ? stepStatus : 'ok',
        started_at: toIso(s.started_at) ?? new Date().toISOString(),
        ended_at: toIso(s.ended_at) ?? (stepStatus === 'running' ? null : new Date().toISOString()),
    };
}

/** Highest seq already recorded for this run, 0 when it has none yet. */
async function readMaxSeq(
    db: Db,
    runId: string,
): Promise<{ value: number; error: string | null; unprovisioned: boolean }> {
    const { data, error } = await db
        .from('oem_agent_run_steps')
        .select('seq')
        .eq('run_id', runId)
        .order('seq', { ascending: false })
        .limit(1)
        .maybeSingle();
    if (isUnprovisioned(error)) return { value: 0, error: null, unprovisioned: true };
    if (error) return { value: 0, error: error.message, unprovisioned: false };
    return { value: Number((data as { seq?: number } | null)?.seq ?? 0) || 0, error: null, unprovisioned: false };
}

/**
 * Append steps, continuing the existing numbering.
 *
 * SEQ IS A RACE, not an exception. This endpoint is the live feed: a cron closing one step
 * while the sandbox appends another read the same max(seq), compute the same next value, and
 * one of them hits UNIQUE (run_id, seq). Two correct callers interleaving is not a server
 * fault, so it must never surface as a 500. Each attempt re-reads the max, renumbers and
 * retries after a short backoff; after the last attempt the response is HTTP 200 with
 * `appended: false, reason: 'seq_conflict'` and nothing written — a failed multi-row insert
 * is atomic, so the caller can resend the identical batch with no risk of duplicates.
 *
 * A caller-supplied `seq` is honoured on the first attempt only; once a collision has proved
 * that numbering stale, the DB's max is the authority.
 *
 * PRECONDITION, enforced by the caller and not re-checked here: the run is still 'running'.
 * Renumbering is only legitimate on a live trace with more than one honest writer. On a run
 * that has ended it would be the very thing makeStepRecorder in backend/lib/agents/runtime.ts
 * refuses — "a trace that merges two executions is a lie about what the agent did" — so PATCH
 * answers 409 before it ever gets here.
 *
 * Local copy of the writer in ../route.ts — a Next.js route module may only export route
 * handlers, so the two cannot share it without a new file outside this assignment.
 */
async function insertSteps(
    db: Db,
    orgId: string,
    runId: string,
    steps: Array<Record<string, unknown>>,
): Promise<StepWrite> {
    if (!steps.length) return { steps: [], error: null, unprovisioned: false, seqConflict: false };
    const trimmed = steps.slice(0, MAX_STEPS_PER_CALL);

    for (let attempt = 0; attempt <= SEQ_RETRY_DELAYS_MS.length; attempt++) {
        const max = await readMaxSeq(db, runId);
        if (max.unprovisioned) return { steps: [], error: null, unprovisioned: true, seqConflict: false };
        if (max.error) return { steps: [], error: max.error, unprovisioned: false, seqConflict: false };

        const rows = trimmed.map((s, i) =>
            buildStepRow(s, orgId, runId, (attempt === 0 ? toInt(s.seq) : null) ?? max.value + i + 1),
        );

        const { data, error } = await db.from('oem_agent_run_steps').insert(rows).select('*');
        if (isUnprovisioned(error)) return { steps: [], error: null, unprovisioned: true, seqConflict: false };
        if (!error) return { steps: data ?? [], error: null, unprovisioned: false, seqConflict: false };
        if (error.code !== '23505') {
            return { steps: [], error: error.message, unprovisioned: false, seqConflict: false };
        }
        if (attempt < SEQ_RETRY_DELAYS_MS.length) await sleep(SEQ_RETRY_DELAYS_MS[attempt]);
    }

    return { steps: [], error: null, unprovisioned: false, seqConflict: true };
}
