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
 * AGENT RUNS — the ball-by-ball execution log.
 *
 * GET  /api/agents/runs?orgId=&agentKey=&module=&status=&from=&to=&limit=&offset=
 *      -> { provisioned, runs: [...], totals: {...} }
 *
 *      The row shape is deliberately FLAT and short. The operator's runs table answers six
 *      questions and nothing else: when, who, which module, what it did, did it work, what
 *      it cost. Everything richer — the plan, the tool calls, the model round trip — lives
 *      in the step trace behind GET /api/agents/runs/[runId]. A table that tries to show the
 *      trace inline stops being scannable, and a runs table you cannot scan is a log file
 *      with borders.
 *
 * SUCCESS RATE — ONE DEFINITION, USED EVERYWHERE.
 *
 *      success_rate = 100 * succeeded / (succeeded + failed + timeout),
 *                     counting only runs whose trigger is not 'shadow';
 *                     NULL when that denominator is 0.
 *
 *      Three things this rules out. A run still 'running' is neither a success nor a
 *      failure, so it must not sit in the denominator and drag the rate down every time
 *      the console refreshes mid-run. A 'skipped' run did not attempt the work, so scoring
 *      it as a failure punishes an agent for correctly deciding there was nothing to do. A
 *      'shadow' run is a rehearsal — it exists to be watched, never to score the agent.
 *      And with no settled runs the answer is "—", not "0%": a freshly registered agent
 *      must not read as failing.
 *
 *      The SQL view oem_agent_profile.success_rate (20260830000001, section 9) computes the
 *      identical expression, because the Activity header and the Profile radar render the
 *      same rows side by side and two numbers that disagree make both untrustworthy.
 *
 * POST /api/agents/runs?orgId=   body: { ...run, steps?: [...] }
 *      -> 201 { provisioned, run, steps, deduped: false }
 *      -> 200 { provisioned, run, deduped: true }   when run_key was already recorded
 *
 *      Written by cron jobs (Bearer CRON_SECRET) and by the sandbox dry-run (browser
 *      session). `run_key` is the idempotency key: a cron that retries after a network blip
 *      must not double-log the same work, because the runs table is what the cost and
 *      reliability numbers are computed from.
 *
 * TENANCY. Reads and browser writes go through the RLS-scoped client, so
 * `oem_select_org_member` / `oem_insert_org_member` (20260830000001) are what actually hold
 * the line — a non-member sees zero rows rather than someone else's agents. Only the
 * CRON_SECRET path uses the service role, because a scheduler has no session.
 *
 * NOT PROVISIONED. 20260830000001_agent_runtime.sql may not be applied yet. Every read
 * degrades to { provisioned: false, runs: [] } with HTTP 200 so the console renders a calm
 * "run the migration" state instead of an error boundary.
 *
 * TOTALS ARE NULLABLE, AND THAT IS THE POINT.
 *      The page and the aggregate are two separate queries. The page can succeed while the
 *      aggregate fails, and a zeroed total printed above a table that visibly has runs in it
 *      ("0 tokens, ₹0.00") is a lie the operator has no way to detect. So when the
 *      aggregate query errors the response carries `totals: null` plus `totals_error`, never
 *      a zeroed object, and `ok: false` marks the payload as partially unknown. Renderers
 *      must show null totals as "—". The same rule already governs `steps_count`.
 */

export const dynamic = 'force-dynamic';

type Db = Awaited<ReturnType<typeof createClient>>;

/** One definition of "the schema is not there yet", shared with the recorder and the
 *  console: frontend/types/agentRuntime.ts. It covers missing COLUMNS (42703 / PGRST204)
 *  as well as missing tables, which is the shape you get when oem_agents exists but the
 *  20260830000001 columns do not. */
const isUnprovisioned = isNotProvisionedError;

const NOT_PROVISIONED_REASON =
    `Agent runtime is not set up yet — apply supabase/migrations/${AGENT_RUNTIME_MIGRATION}.sql.`;

const RUN_STATUSES = ['running', 'succeeded', 'failed', 'skipped', 'timeout'] as const;
const RUN_TRIGGERS = ['cron', 'manual', 'webhook', 'shadow', 'replay'] as const;
const STEP_TYPES = ['plan', 'think', 'llm', 'tool', 'fetch', 'write', 'notify', 'decide', 'error'] as const;
const STEP_STATUSES = ['running', 'ok', 'failed', 'skipped'] as const;
const TERMINAL_STATUSES = new Set(['succeeded', 'failed', 'skipped', 'timeout']);

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
/** Totals are computed over the whole filtered window, not the returned page — otherwise
 *  "cost this week" would silently mean "cost of the 50 rows you happen to be looking at".
 *  This caps how far back that second pass reads. */
const AGGREGATE_CAP = 5000;
const MAX_STEPS_PER_RUN = 200;
/** Statuses that count in the success-rate denominator. See the header. */
const SCORED_STATUSES = new Set(['succeeded', 'failed', 'timeout']);
/** A rehearsal never scores the agent. See the header. */
const UNSCORED_TRIGGER = 'shadow';
/** Backoff between seq-collision retries. Length + 1 = attempts. */
const SEQ_RETRY_DELAYS_MS = [30, 90];
/** How many exact step-count queries to have in flight at once. */
const COUNT_CONCURRENCY = 8;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Flat, scannable columns. Order matters: this is the table's reading order. */
const RUN_COLUMNS =
    'id, started_at, ended_at, agent_key, module, trigger, status, outcome_summary, duration_ms,' +
    ' tokens_in, tokens_out, cached_tokens, cost_inr, cost_usd, provider, model, error, error_class,' +
    ' entity_ref, grounded, confidence, prompt_version, bundle_version, run_key, created_at';

function readOrgId(request: NextRequest, body?: Record<string, unknown>): string | null {
    const sp = new URL(request.url).searchParams;
    return (
        sp.get('orgId') || sp.get('org_id') || sp.get('organization_id') ||
        (typeof body?.organization_id === 'string' ? body.organization_id : null) ||
        (typeof body?.orgId === 'string' ? body.orgId : null) ||
        null
    );
}

function isCron(request: NextRequest): boolean {
    const secret = process.env.CRON_SECRET;
    return !!secret && request.headers.get('authorization') === `Bearer ${secret}`;
}

/**
 * Service role for the scheduler, RLS-scoped client for a human. The cast is safe: both are
 * @supabase/supabase-js clients over the same schema; only the key differs.
 */
async function resolveDb(
    request: NextRequest,
): Promise<{ db: Db; via: 'cron' | 'user'; userId: string | null } | NextResponse> {
    if (isCron(request)) {
        return { db: supabaseAdmin as unknown as Db, via: 'cron', userId: null };
    }
    const db = await createClient();
    const { data: { user } } = await db.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return { db, via: 'user', userId: user.id };
}

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

/** Nearest-rank percentile. Small n is the normal case here, so no interpolation games. */
function percentile(sorted: number[], p: number): number | null {
    if (!sorted.length) return null;
    const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
    return Math.round(sorted[idx]);
}

const round = (n: number, dp: number) => Number(n.toFixed(dp));

// ---------------------------------------------------------------------------
// GET — the runs table
// ---------------------------------------------------------------------------
export async function GET(request: NextRequest) {
    try {
        const resolved = await resolveDb(request);
        if (resolved instanceof NextResponse) return resolved;
        const { db } = resolved;

        const orgId = readOrgId(request);
        if (!orgId) return NextResponse.json({ error: 'orgId is required' }, { status: 400 });

        const sp = new URL(request.url).searchParams;
        const agentKey = sp.get('agentKey') || sp.get('agent_key');
        const moduleName = sp.get('module');
        const from = toIso(sp.get('from'));
        const to = toIso(sp.get('to'));
        const limit = Math.min(MAX_LIMIT, Math.max(1, toInt(sp.get('limit')) ?? DEFAULT_LIMIT));
        const offset = Math.max(0, toInt(sp.get('offset')) ?? 0);

        const statuses = (sp.get('status') ?? '')
            .split(',')
            .map((s) => s.trim())
            .filter((s) => (RUN_STATUSES as readonly string[]).includes(s));

        const build = (select: string) => {
            let q = db.from('oem_agent_runs').select(select).eq('organization_id', orgId);
            if (agentKey) q = q.eq('agent_key', agentKey);
            if (moduleName) q = q.eq('module', moduleName);
            if (statuses.length === 1) q = q.eq('status', statuses[0]);
            else if (statuses.length > 1) q = q.in('status', statuses);
            if (from) q = q.gte('started_at', from);
            if (to) q = q.lte('started_at', to);
            return q.order('started_at', { ascending: false });
        };

        const [pageRes, aggRes] = await Promise.all([
            build(RUN_COLUMNS).range(offset, offset + limit - 1),
            build('status, trigger, duration_ms, tokens_in, tokens_out, cached_tokens, cost_inr, cost_usd')
                .limit(AGGREGATE_CAP),
        ]);

        if (isUnprovisioned(pageRes.error) || isUnprovisioned(aggRes.error)) {
            return NextResponse.json({
                // A known state, honestly reported.
                ok: true,
                provisioned: false,
                migration: AGENT_RUNTIME_MIGRATION,
                reason: NOT_PROVISIONED_REASON,
                runs: [],
                steps_count_exact: true,
                totals: emptyTotals(),
                limit,
                offset,
                returned: 0,
                has_more: false,
            });
        }
        if (pageRes.error) return NextResponse.json({ error: pageRes.error.message }, { status: 500 });

        type RunRow = Record<string, unknown> & { id: string; agent_key: string };
        const rows = (pageRes.data ?? []) as unknown as RunRow[];

        // Two cheap enrichments the table needs and the UI should not have to fetch itself:
        // the agent's human name, and how many steps the trace drawer will have to show.
        const [nameMap, stepCounts] = await Promise.all([
            loadAgentNames(db, orgId),
            loadStepCounts(db, orgId, rows.map((r) => r.id)),
        ]);

        const runs = rows.map((r) => ({
            ...r,
            agent_name: nameMap.get(r.agent_key)?.display_name ?? r.agent_key,
            department: nameMap.get(r.agent_key)?.department ?? null,
            // null, not 0, when the count could not be read: "unknown" and "no steps" are
            // different answers and the drawer badge must not invent the reassuring one.
            steps_count: stepCounts.available ? stepCounts.counts.get(r.id) ?? 0 : null,
        }));

        // The aggregate is a SECOND query and can fail on its own. `aggRes.data ?? []`
        // used to swallow that: computeTotals([]) returns a fully-populated zero object,
        // so the header printed "0 runs / 0 tokens / ₹0.00" directly above a page of
        // real runs. Unknown totals are null, and only null.
        const aggFailed = !!aggRes.error;
        const aggRows = (aggRes.data ?? []) as unknown as Array<Record<string, unknown>>;
        return NextResponse.json({
            ok: !aggFailed,
            provisioned: true,
            runs,
            steps_count_exact: stepCounts.available && stepCounts.exact,
            totals: aggFailed ? null : computeTotals(aggRows),
            totals_error: aggFailed
                ? {
                    code: aggRes.error?.code ?? null,
                    message: aggRes.error?.message ?? 'The query failed without a message.',
                    reason:
                        'The totals query failed, so runs, tokens, cost and success rate are UNKNOWN for '
                        + 'this window. The rows below are real; render every total as \u2014, not 0.',
                }
                : null,
            filters: {
                agent_key: agentKey,
                module: moduleName,
                status: statuses.length ? statuses : null,
                from,
                to,
            },
            limit,
            offset,
            returned: runs.length,
            has_more: runs.length === limit,
        });
    } catch (e) {
        return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
}

/** The one sentence every renderer of this number should be able to quote. */
const SUCCESS_RATE_BASIS =
    "succeeded / (succeeded + failed + timeout), excluding trigger 'shadow'; null when that denominator is 0";

function emptyTotals() {
    return {
        runs: 0, succeeded: 0, failed: 0, running: 0, skipped: 0, timeout: 0,
        // Rehearsals. Counted, shown, never scored.
        shadow: 0,
        // The success-rate fraction, exposed so the console can show its working
        // ("19/20 settled") instead of a percentage with no provenance.
        scored_runs: 0, scored_succeeded: 0,
        tokens_in: 0, tokens_out: 0, cached_tokens: 0,
        cost_inr: 0, cost_usd: 0,
        p50_ms: null as number | null, p95_ms: null as number | null,
        success_rate: null as number | null,
        success_rate_basis: SUCCESS_RATE_BASIS,
        sampled: 0, truncated: false,
    };
}

function computeTotals(rows: Array<Record<string, unknown>>) {
    const t = emptyTotals();
    t.sampled = rows.length;
    t.truncated = rows.length >= AGGREGATE_CAP;
    const durations: number[] = [];
    for (const r of rows) {
        t.runs += 1;
        const st = String(r.status ?? '');
        if (st === 'succeeded') t.succeeded += 1;
        else if (st === 'failed') t.failed += 1;
        else if (st === 'running') t.running += 1;
        else if (st === 'skipped') t.skipped += 1;
        else if (st === 'timeout') t.timeout += 1;

        // Costs and latencies count every run — a rehearsal still burns tokens and still
        // tells you how slow the agent is. Only the SCORE excludes it.
        const isShadow = String(r.trigger ?? '') === UNSCORED_TRIGGER;
        if (isShadow) t.shadow += 1;
        else if (SCORED_STATUSES.has(st)) {
            t.scored_runs += 1;
            if (st === 'succeeded') t.scored_succeeded += 1;
        }

        t.tokens_in += Number(r.tokens_in ?? 0) || 0;
        t.tokens_out += Number(r.tokens_out ?? 0) || 0;
        t.cached_tokens += Number(r.cached_tokens ?? 0) || 0;
        t.cost_inr += Number(r.cost_inr ?? 0) || 0;
        t.cost_usd += Number(r.cost_usd ?? 0) || 0;
        const d = Number(r.duration_ms);
        if (Number.isFinite(d)) durations.push(d);
    }
    durations.sort((a, b) => a - b);
    t.p50_ms = percentile(durations, 0.5);
    t.p95_ms = percentile(durations, 0.95);
    t.cost_inr = round(t.cost_inr, 2);
    t.cost_usd = round(t.cost_usd, 4);
    // THE definition (see the header): settled, non-shadow runs only, null when there are
    // none. Mirrored verbatim by oem_agent_profile.success_rate in the migration.
    t.success_rate = t.scored_runs
        ? round((t.scored_succeeded / t.scored_runs) * 100, 1)
        : null;
    return t;
}

async function loadAgentNames(
    db: Db,
    orgId: string,
): Promise<Map<string, { display_name: string; department: string | null }>> {
    const map = new Map<string, { display_name: string; department: string | null }>();
    const { data, error } = await db
        .from('oem_agents')
        .select('agent_key, display_name, department')
        .eq('organization_id', orgId);
    if (error) return map; // registry missing or unreadable — the table falls back to agent_key
    for (const a of (data ?? []) as Array<{ agent_key: string; display_name: string; department: string | null }>) {
        map.set(a.agent_key, { display_name: a.display_name, department: a.department });
    }
    return map;
}

type StepCounts = {
    counts: Map<string, number>;
    /** False when the count could not be read at all — render "—", not 0. */
    available: boolean;
    /** False when the numbers are a floor rather than a total. */
    exact: boolean;
};

/**
 * Step counts for the visible page.
 *
 * Tallying returned rows is cheap but truncatable: PostgREST enforces its own db-max-rows
 * ceiling regardless of what we ask for, so a page of chatty runs would come back short and
 * every steps_count would silently read low — a badge saying "12 steps" on a 200-step run.
 * `count: 'exact'` gives us the true total in the same round trip, which is what makes the
 * truncation DETECTABLE; when it fires we pay for per-run COUNT queries (indexed on
 * (run_id, seq)) rather than publish a number we know is wrong.
 */
async function loadStepCounts(db: Db, orgId: string, runIds: string[]): Promise<StepCounts> {
    const counts = new Map<string, number>();
    if (!runIds.length) return { counts, available: true, exact: true };

    const cap = runIds.length * MAX_STEPS_PER_RUN;
    const { data, error, count } = await db
        .from('oem_agent_run_steps')
        .select('run_id', { count: 'exact' })
        .eq('organization_id', orgId)
        .in('run_id', runIds)
        .range(0, cap - 1);
    if (error) return { counts, available: false, exact: false };

    const rows = (data ?? []) as unknown as Array<{ run_id: string }>;
    if (typeof count === 'number' && rows.length < count) {
        return exactStepCounts(db, orgId, runIds);
    }
    for (const s of rows) counts.set(s.run_id, (counts.get(s.run_id) ?? 0) + 1);
    return { counts, available: true, exact: true };
}

/** One head-only COUNT per run, in small waves so a 200-row page cannot open 200 sockets. */
async function exactStepCounts(db: Db, orgId: string, runIds: string[]): Promise<StepCounts> {
    const counts = new Map<string, number>();
    let exact = true;
    for (let i = 0; i < runIds.length; i += COUNT_CONCURRENCY) {
        const wave = await Promise.all(
            runIds.slice(i, i + COUNT_CONCURRENCY).map(async (id) => {
                const res = await db
                    .from('oem_agent_run_steps')
                    .select('id', { count: 'exact', head: true })
                    .eq('organization_id', orgId)
                    .eq('run_id', id);
                return { id, count: res.count, error: res.error };
            }),
        );
        for (const r of wave) {
            if (r.error || typeof r.count !== 'number') { exact = false; continue; }
            counts.set(r.id, r.count);
        }
    }
    return { counts, available: true, exact };
}

// ---------------------------------------------------------------------------
// POST — record a run (+ its steps)
// ---------------------------------------------------------------------------
export async function POST(request: NextRequest) {
    try {
        let body: Record<string, unknown>;
        try {
            body = (await request.json()) as Record<string, unknown>;
        } catch {
            return NextResponse.json({ error: 'Body must be JSON' }, { status: 400 });
        }

        const resolved = await resolveDb(request);
        if (resolved instanceof NextResponse) return resolved;
        const { db, via } = resolved;

        const orgId = readOrgId(request, body);
        if (!orgId) return NextResponse.json({ error: 'orgId is required' }, { status: 400 });

        const agentKey = toText(body.agent_key ?? body.agentKey);
        if (!agentKey) return NextResponse.json({ error: 'agent_key is required' }, { status: 400 });

        const status = toText(body.status) ?? 'running';
        if (!(RUN_STATUSES as readonly string[]).includes(status)) {
            return NextResponse.json({ error: `status must be one of ${RUN_STATUSES.join(', ')}` }, { status: 400 });
        }
        const trigger = toText(body.trigger) ?? (via === 'cron' ? 'cron' : 'manual');
        if (!(RUN_TRIGGERS as readonly string[]).includes(trigger)) {
            return NextResponse.json({ error: `trigger must be one of ${RUN_TRIGGERS.join(', ')}` }, { status: 400 });
        }

        // `module` is what the console groups activity by. Accepting free text means one
        // agent writing 'Front Desk' and another writing 'frontdesk' land on two different
        // cards, so normalise on the way in and refuse what maps to nothing — a wrong slug
        // puts an agent's work on someone else's card, which is worse than no slug at all.
        const rawModule = toText(body.module);
        let moduleKey: string | null = null;
        if (rawModule !== null) {
            moduleKey = normalizeModule(rawModule);
            if (!moduleKey) {
                return NextResponse.json(
                    {
                        error: `module '${rawModule}' is not a known module`,
                        allowed: AGENT_MODULES,
                    },
                    { status: 400 },
                );
            }
        }

        const runKey = toText(body.run_key ?? body.runKey);
        const startedAt = toIso(body.started_at) ?? new Date().toISOString();
        // A terminal run with no ended_at would leave duration_ms null forever (the
        // trg_oem_runs_duration trigger only fires when ended_at is set), and a run with no
        // duration is invisible to p50/p95. Close it here rather than lose the latency.
        const endedAt = toIso(body.ended_at) ?? (TERMINAL_STATUSES.has(status) ? new Date().toISOString() : null);

        const runRow = {
            organization_id: orgId,
            agent_key: agentKey,
            run_key: runKey,
            trigger,
            module: moduleKey,
            status,
            started_at: startedAt,
            ended_at: endedAt,
            duration_ms: toInt(body.duration_ms),
            provider: toText(body.provider),
            model: toText(body.model),
            temperature: toNum(body.temperature),
            top_p: toNum(body.top_p),
            max_tokens: toInt(body.max_tokens),
            context_window: toInt(body.context_window),
            tokens_in: toInt(body.tokens_in),
            tokens_out: toInt(body.tokens_out),
            cached_tokens: toInt(body.cached_tokens),
            cost_usd: toNum(body.cost_usd),
            cost_inr: toNum(body.cost_inr),
            prompt_version: toInt(body.prompt_version),
            bundle_version: toInt(body.bundle_version),
            outcome_summary: toText(body.outcome_summary),
            entity_ref: toText(body.entity_ref),
            error: toText(body.error),
            error_class: toText(body.error_class),
            grounded: toBool(body.grounded),
            confidence: toNum(body.confidence),
        };

        // Idempotency, first pass: a retry that already landed returns the original row.
        if (runKey) {
            const existing = await findByRunKey(db, orgId, agentKey, runKey);
            if (existing.unprovisioned) return unprovisionedWrite();
            if (existing.run) {
                return NextResponse.json({ provisioned: true, deduped: true, run: existing.run, steps_inserted: 0 });
            }
        }

        const insertRes = await db.from('oem_agent_runs').insert(runRow).select(RUN_COLUMNS).single();

        if (isUnprovisioned(insertRes.error)) return unprovisionedWrite();
        // RLS refused the insert: not a member of this org. A permission, not a server fault.
        if (insertRes.error?.code === '42501') {
            return NextResponse.json({ error: 'Forbidden: not a member of this organization' }, { status: 403 });
        }
        if (insertRes.error) {
            // Second pass: two schedulers raced on the same run_key and the UNIQUE
            // (organization_id, agent_key, run_key) constraint caught it. That is the
            // constraint doing its job, not a failure to report.
            if (insertRes.error.code === '23505' && runKey) {
                const existing = await findByRunKey(db, orgId, agentKey, runKey);
                if (existing.run) {
                    return NextResponse.json({ provisioned: true, deduped: true, run: existing.run, steps_inserted: 0 });
                }
            }
            return NextResponse.json({ error: insertRes.error.message }, { status: 500 });
        }

        const run = insertRes.data as unknown as { id: string };
        const stepsIn = Array.isArray(body.steps) ? (body.steps as Array<Record<string, unknown>>) : [];
        // seq 0: a brand-new run has no steps yet, so the first attempt needs no probe query.
        const stepResult = await insertSteps(db, orgId, run.id, stepsIn, 0);

        if (stepResult.error && !stepResult.unprovisioned) {
            const unwind = await unwindPartialRun(db, run.id, orgId, stepResult.error);
            return NextResponse.json(
                { error: `steps insert failed: ${stepResult.error}`, ...unwind },
                { status: 500 },
            );
        }

        return NextResponse.json(
            {
                provisioned: true,
                deduped: false,
                run: insertRes.data,
                steps: stepResult.steps,
                steps_inserted: stepResult.steps.length,
                ...(stepResult.unprovisioned ? { steps_provisioned: false } : {}),
                // The run landed; only its trace lost a numbering race. The caller retries the
                // steps against PATCH /api/agents/runs/[runId] — it does not retry the run.
                ...(stepResult.seqConflict ? { appended: false, reason: 'seq_conflict' } : {}),
            },
            { status: 201 },
        );
    } catch (e) {
        return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
}

function unprovisionedWrite() {
    // A write that cannot land is still not a 500: the cron log stays readable and the sandbox
    // shows "run the migration" rather than a stack trace.
    return NextResponse.json({
        provisioned: false, migration: AGENT_RUNTIME_MIGRATION, reason: NOT_PROVISIONED_REASON,
        run: null, steps: [],
    });
}

async function findByRunKey(
    db: Db,
    orgId: string,
    agentKey: string,
    runKey: string,
): Promise<{ run: unknown | null; unprovisioned: boolean }> {
    const { data, error } = await db
        .from('oem_agent_runs')
        .select(RUN_COLUMNS)
        .eq('organization_id', orgId)
        .eq('agent_key', agentKey)
        .eq('run_key', runKey)
        .maybeSingle();
    if (isUnprovisioned(error)) return { run: null, unprovisioned: true };
    return { run: data ?? null, unprovisioned: false };
}

/**
 * A run row that landed with no trace behind it.
 *
 * PostgREST gives us no cross-table transaction, so a failed steps insert leaves a run the
 * caller believes is complete. The old code "rolled back" with a DELETE through the
 * RLS-scoped client — but oem_agent_runs has SELECT / INSERT / UPDATE policies for org
 * members and deliberately NO DELETE policy, so that statement removed nothing, returned no
 * error, and the response claimed a rollback that never happened.
 *
 * Three outcomes now, and the response says which one actually occurred:
 *
 *   deleted       the service role removed the run (steps cascade). run_key is free again,
 *                 so the caller's retry is a clean insert rather than a dedupe onto a
 *                 traceless run.
 *   marked_failed no service-role key, or the delete matched no row. The run STAYS, flagged
 *                 status='failed' / error_class='partial_write' — a broken run that reads as
 *                 broken beats a successful-looking run with a missing trace.
 *   orphaned      even the update failed. Nothing was cleaned up. Say so.
 */
type PartialRunUnwind = {
    rolled_back: boolean;
    run_state: 'deleted' | 'marked_failed' | 'orphaned';
};

async function unwindPartialRun(
    db: Db,
    runId: string,
    orgId: string,
    reason: string,
): Promise<PartialRunUnwind> {
    if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
        const del = await supabaseAdmin
            .from('oem_agent_runs')
            .delete()
            .eq('id', runId)
            .eq('organization_id', orgId)
            .select('id');
        // Verify it affected a row. A delete that matched nothing is not a rollback.
        if (!del.error && (del.data?.length ?? 0) > 0) {
            return { rolled_back: true, run_state: 'deleted' };
        }
    }

    const marked = await db
        .from('oem_agent_runs')
        .update({
            status: 'failed',
            ended_at: new Date().toISOString(),
            error_class: 'partial_write',
            error: `steps insert failed: ${reason}`.slice(0, 1000),
        })
        .eq('id', runId)
        .eq('organization_id', orgId)
        .select('id');
    if (!marked.error && (marked.data?.length ?? 0) > 0) {
        return { rolled_back: false, run_state: 'marked_failed' };
    }
    return { rolled_back: false, run_state: 'orphaned' };
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
        // Fallback is the step's own kind, never "Step 4": position is the DB's to decide
        // once a retry has renumbered the batch, and a label that disagrees with seq is a lie.
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

/** Highest seq already recorded for a run, 0 when it has no steps. */
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
 * Steps carry `seq` so the trace renders in execution order regardless of insert order.
 *
 * SEQ IS A RACE, not an exception. Two appends to the same run — a cron closing a step while
 * the sandbox writes another — read the same max(seq), compute the same next value and one of
 * them hits UNIQUE (run_id, seq). That is an ordinary interleaving of correct callers, so it
 * gets a retry (re-read the max, renumber, brief backoff), not a 500. After the last attempt
 * we report `seq_conflict` with HTTP 200 and nothing written: the caller can safely resend,
 * because a failed multi-row insert is atomic — there are no half-appended traces.
 *
 * A caller-supplied `seq` is honoured on the first attempt only. Once a collision has proved
 * that numbering stale, the DB's max is the authority and the batch is renumbered from it.
 *
 * Not exported: a Next.js route module may only export route handlers, so the sibling
 * [runId] route carries its own copy rather than importing this one.
 */
async function insertSteps(
    db: Db,
    orgId: string,
    runId: string,
    steps: Array<Record<string, unknown>>,
    seqOffset: number | null,
): Promise<StepWrite> {
    if (!steps.length) return { steps: [], error: null, unprovisioned: false, seqConflict: false };
    const trimmed = steps.slice(0, MAX_STEPS_PER_RUN);

    for (let attempt = 0; attempt <= SEQ_RETRY_DELAYS_MS.length; attempt++) {
        let base: number;
        if (attempt > 0 || seqOffset === null) {
            const max = await readMaxSeq(db, runId);
            if (max.unprovisioned) return { steps: [], error: null, unprovisioned: true, seqConflict: false };
            if (max.error) return { steps: [], error: max.error, unprovisioned: false, seqConflict: false };
            base = max.value;
        } else {
            base = seqOffset;
        }

        const rows = trimmed.map((s, i) =>
            buildStepRow(s, orgId, runId, (attempt === 0 ? toInt(s.seq) : null) ?? base + i + 1),
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
