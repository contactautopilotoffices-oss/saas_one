import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';
import {
    AGENT_RUNTIME_MIGRATION,
    isNotProvisionedError,
    type AgentModelConfig,
    type AgentRuntimeConfig,
} from '@/frontend/types/agentRuntime';
import { COUNCIL_MODEL_CHOICES, priceOf } from '@/backend/lib/council/llm';

/**
 * AGENT COST — what this agent actually spent, what it will spend, and on what.
 * =============================================================================
 * GET /api/agents/cost?orgId=&agentKey=
 *   -> { ok, provisioned, agent, spent, estimate, models, errors }
 *
 * READ-ONLY. This route reads oem_agents and oem_agent_runs (+ the step trace,
 * for one count) and writes nothing. It does not talk to a model, does not
 * decide anything, and does not change agent behaviour — so it carries NO Agent
 * Spec Block (docs/AGENT_DOCTRINE.md §3), stated here rather than omitted
 * silently, which is the one thing the doctrine forbids outright (CLAUDE.md).
 * It serves L5's "agent efficiency" axis — steps taken, tokens burned, money
 * spent `[BAA pp.118-119]` — by reporting numbers the runtime already records.
 *
 * THREE SECTIONS, THREE DIFFERENT EPISTEMIC STATUSES, AND THEY ARE LABELLED.
 *
 *   spent     MEASURED. Every figure is a sum over oem_agent_runs rows in the
 *             window. Nothing here is modelled.
 *   estimate  ESTIMATED. Derived from the agent's own configuration
 *             (system_prompt length, model_config.max_tokens, runtime.
 *             schedule_cron). Every field carries how it was derived.
 *   models    MEASURED where it replays real tokens, ABSENT where there are
 *             none. It never prices a hypothetical against invented usage.
 *
 * THE STATE THAT MATTERS MOST HERE IS THE THIRD ONE.
 *
 * A run row's cost_usd / tokens_in are NULLABLE, and in this database they are
 * overwhelmingly null: an agent can execute 362 times and record what it did
 * without any step ever recording what it spent. That gives three distinct
 * answers to "what did this agent cost today", not two:
 *
 *   runs = 0                      -> "no runs recorded yet"
 *   runs > 0, runs_with_cost = 0  -> "12 runs, none recorded a cost"
 *   runs > 0, runs_with_cost > 0  -> the sum, over that many runs
 *
 * The middle one is the trap. Summing nulls gives 0, and "₹0.00" printed under
 * "12 runs today" reads as "this agent is free" when the truth is "nobody
 * measured it". So every window carries `runs_with_cost` beside its totals and
 * `cost_measured`, and a renderer must show the unmeasured case as unmeasured.
 * That is the same rule /api/agents/runs applies to null `totals` and
 * /api/agents/profile applies to `measured: false`.
 *
 * BY TRIGGER, BECAUSE A SHADOW RUN IS A REHEARSAL. It burns real tokens against
 * a real bill, so it belongs in the spend, but an operator deciding whether the
 * agent earns its keep needs the cron/manual spend separated from the money
 * spent watching it practise. Same split, same reason, as the success-rate
 * exclusion in /api/agents/runs.
 *
 * TENANCY. The RLS-scoped browser client only — there is no CRON_SECRET path,
 * because nothing schedules a cost report. `oem_select_org_member`
 * (20260830000001) is what actually holds the line: a signed-in non-member sees
 * zero rows rather than another org's spend. Unauthenticated is 401.
 *
 * NOT PROVISIONED. 20260830000001_agent_runtime.sql may not be applied. That
 * degrades to HTTP 200 { provisioned: false } so the panel renders "run the
 * migration" instead of an error boundary, as every sibling route does.
 */

export const dynamic = 'force-dynamic';

/* ---------------------------------------------------------------------------
 * Constants
 * ------------------------------------------------------------------------- */

/** PostgREST silently truncates an unbounded select at 1000 rows. Be explicit. */
const RUN_ROW_CEILING = 20000;
/** Same ceiling for the step trace: 362 runs x ~3 steps is well inside it. */
const STEP_ROW_CEILING = 20000;

/** The longest window we report, and the sample window for every derivation. */
const WINDOW_DAYS = 30;

/**
 * Mirrors backend/lib/agents/runtime.ts:88 EXACTLY — same env var, same 88
 * fallback. The runtime uses it to fill cost_inr from cost_usd when a caller
 * supplies only dollars; this route uses it the other way, to put a rupee
 * figure on a projection that priceOf() gives in dollars. Two different rates
 * would mean the projected ₹ and the measured ₹ on the same screen were
 * computed against different currencies, which is worse than showing neither.
 */
const USD_INR = Number(process.env.AGENT_USD_INR || 88);

/**
 * chars / 4. The industry rule of thumb, not a tokenizer. It is stated in the
 * payload (`estimate.basis`) and must be stated in the UI, because a number
 * derived this way can be 20-30% out on a prompt heavy in punctuation, table
 * names or non-English text — all three of which our system prompts contain.
 */
const CHARS_PER_TOKEN = 4;

/**
 * priceOf() answers for EVERY model: an id it has no rate for gets the
 * pessimistic UNPRICED_MODEL fallback (llm.ts:159) rather than null. That is
 * right for a cost warning and wrong for a report — it would render a confident
 * $/1M figure that was never billed by anyone. There is no exported predicate,
 * so the sentinel is compared directly. If llm.ts changes those two numbers,
 * this goes stale in the safe direction: a real model priced at exactly
 * 2.50/10.00 would be flagged unpriced, which understates our confidence rather
 * than overstating it.
 */
const UNPRICED_SENTINEL = { input: 2.50, output: 10.00 };

function isPriced(model: string): boolean {
    const p = priceOf(model);
    return p.input !== UNPRICED_SENTINEL.input || p.output !== UNPRICED_SENTINEL.output;
}

/** The one sentence a renderer of the spend figures should be able to quote. */
const SPEND_BASIS =
    'Summed from oem_agent_runs.cost_inr / cost_usd / tokens_* over the window. '
    + 'Runs whose cost columns are null contribute nothing and are counted separately '
    + 'as runs_with_cost, so an unmeasured run can never read as a free one.';

/* ---------------------------------------------------------------------------
 * The failure envelope shared across /api/agents (pulse, runs, profile).
 * Its presence is what tells a renderer that a null beside it means "could not
 * read", not "there is none".
 * ------------------------------------------------------------------------- */

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

const num = (v: unknown): number | null => {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
};

const round = (n: number, dp: number) => Number(n.toFixed(dp));

/* ---------------------------------------------------------------------------
 * CRON — how often the schedule fires, which is the multiplier on every
 * forward projection.
 *
 * AgentActivity.tsx carries a sibling parser, and this is deliberately not it:
 * that one answers "when does it next fire" (a forward search that stops at the
 * first hit), this one answers "how many times in 30 days" (a count). Sharing
 * would mean exporting a next-fire iterator from a 'use client' component and
 * calling it 43,200 times; a minute sweep over the same field sets is smaller
 * than the wrapper that would avoid it. Standard five fields; a leading seconds
 * field is tolerated and ignored, matching the sibling.
 * ------------------------------------------------------------------------- */

const DOW_NAMES: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
const MONTH_NAMES: Record<string, number> = {
    jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

function parseCronField(
    spec: string, min: number, max: number, names?: Record<string, number>,
): Set<number> | null {
    const out = new Set<number>();
    for (const part of spec.split(',')) {
        const piece = part.trim().toLowerCase();
        if (!piece) return null;
        const [rangePart, stepPart] = piece.split('/');
        const step = stepPart === undefined ? 1 : Number(stepPart);
        if (!Number.isInteger(step) || step < 1) return null;

        let lo: number;
        let hi: number;
        if (!rangePart) return null; // "/5" and friends: malformed, not a guess
        if (rangePart === '*') {
            lo = min; hi = max;
        } else if (rangePart.includes('-')) {
            const [a, b] = rangePart.split('-');
            const av = names?.[a] ?? Number(a);
            const bv = names?.[b] ?? Number(b);
            if (!Number.isFinite(av) || !Number.isFinite(bv)) return null;
            lo = av; hi = bv;
        } else {
            const v = names?.[rangePart] ?? Number(rangePart);
            if (!Number.isFinite(v)) return null;
            lo = v; hi = stepPart === undefined ? v : max;
        }
        if (lo > hi || lo < min || hi > max) return null;
        for (let v = lo; v <= hi; v += step) out.add(v);
    }
    return out.size ? out : null;
}

/**
 * Firings in the next `days` days, or null when the expression does not parse.
 * Null, never a guess: an unparseable cron means the cadence is UNKNOWN, and a
 * projection built on a guessed cadence is the exact kind of untraceable claim
 * this panel exists to avoid.
 */
function cronFiringsPerDay(expr: string, days: number): number | null {
    const raw = expr.trim().split(/\s+/);
    const parts = raw.length === 6 ? raw.slice(1) : raw;
    if (parts.length !== 5) return null;

    const minute = parseCronField(parts[0], 0, 59);
    const hour = parseCronField(parts[1], 0, 23);
    const dom = parseCronField(parts[2], 1, 31);
    const month = parseCronField(parts[3], 1, 12, MONTH_NAMES);
    const dowRaw = parseCronField(parts[4], 0, 7, DOW_NAMES);
    if (!minute || !hour || !dom || !month || !dowRaw) return null;

    // Cron allows 7 for Sunday as well as 0.
    const dow = new Set<number>();
    dowRaw.forEach((d) => dow.add(d === 7 ? 0 : d));
    // Classic cron: when BOTH dom and dow are restricted, either matching fires.
    const domRestricted = parts[2].trim() !== '*';
    const dowRestricted = parts[4].trim() !== '*';

    const perDay = hour.size * minute.size;
    let fires = 0;
    const today = new Date();
    for (let offset = 0; offset < days; offset++) {
        const day = new Date(today.getFullYear(), today.getMonth(), today.getDate() + offset);
        if (!month.has(day.getMonth() + 1)) continue;
        const domHit = dom.has(day.getDate());
        const dowHit = dow.has(day.getDay());
        const dayHit = domRestricted && dowRestricted
            ? domHit || dowHit
            : domRestricted ? domHit : dowRestricted ? dowHit : true;
        if (dayHit) fires += perDay;
    }
    return fires / days;
}

/* ---------------------------------------------------------------------------
 * Windows.
 *
 * "Today" is midnight in the AGENT's timezone, not the server's and not the
 * viewer's. The schedule is written in that frame (runtime.timezone), so a
 * "today" measured in another one would cut the day at the wrong instant and
 * report the wrong number of scheduled runs against it. Same reasoning as
 * AgentActivity.tsx's wallClockIn.
 * ------------------------------------------------------------------------- */

function startOfDayIn(tz: string | undefined, at: Date): Date {
    if (!tz) return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
    try {
        const parts = new Intl.DateTimeFormat('en-US', {
            timeZone: tz, hour12: false,
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', second: '2-digit',
        }).formatToParts(at);
        const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
        const hour = get('hour') === 24 ? 0 : get('hour');
        // How far the zone's wall clock is into its own day, subtracted from the
        // real instant. Works without needing the zone's UTC offset directly.
        const intoDay = ((hour * 60 + get('minute')) * 60 + get('second')) * 1000;
        if (!Number.isFinite(intoDay)) return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
        return new Date(at.getTime() - intoDay);
    } catch {
        // Unknown IANA zone — UTC midnight, and the payload still reports `from`
        // so the UI can say which instant the window actually started at.
        return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
    }
}

type WindowKey = 'today' | '7d' | '30d';

interface RunRow {
    started_at: string;
    trigger: string | null;
    status: string | null;
    model: string | null;
    provider: string | null;
    tokens_in: number | null;
    tokens_out: number | null;
    cached_tokens: number | null;
    cost_usd: number | null;
    cost_inr: number | null;
    duration_ms: number | null;
}

interface Spend {
    runs: number;
    /** Runs that recorded ANY cost or token figure. The denominator for per-run. */
    runs_with_cost: number;
    cost_inr: number;
    cost_usd: number;
    tokens_in: number;
    tokens_out: number;
    cached_tokens: number;
    /** false when runs > 0 but nothing recorded a cost. NOT the same as zero spend. */
    cost_measured: boolean;
    /** null when nothing was measured — never 0. */
    cost_per_run_inr: number | null;
    cost_per_run_usd: number | null;
}

function emptySpend(): Spend {
    return {
        runs: 0, runs_with_cost: 0,
        cost_inr: 0, cost_usd: 0,
        tokens_in: 0, tokens_out: 0, cached_tokens: 0,
        cost_measured: false,
        cost_per_run_inr: null, cost_per_run_usd: null,
    };
}

function accumulate(into: Spend, r: RunRow): void {
    into.runs += 1;
    const usd = num(r.cost_usd);
    const inr = num(r.cost_inr);
    const tin = num(r.tokens_in);
    const tout = num(r.tokens_out);
    // "Recorded a cost" means the run wrote at least one of the four billing
    // columns. A run that wrote tokens but no price still proves the spend was
    // measured, and still belongs in the per-run denominator.
    if (usd !== null || inr !== null || tin !== null || tout !== null) into.runs_with_cost += 1;
    into.cost_usd += usd ?? 0;
    into.cost_inr += inr ?? 0;
    into.tokens_in += tin ?? 0;
    into.tokens_out += tout ?? 0;
    into.cached_tokens += num(r.cached_tokens) ?? 0;
}

function sealSpend(s: Spend): Spend {
    s.cost_measured = s.runs_with_cost > 0;
    s.cost_inr = round(s.cost_inr, 4);
    s.cost_usd = round(s.cost_usd, 6);
    // Divided by the runs that MEASURED a cost, not by every run. Dividing by
    // all runs would spread a measured spend across unmeasured ones and quietly
    // report a cheaper agent than the billed one.
    s.cost_per_run_inr = s.runs_with_cost ? round(s.cost_inr / s.runs_with_cost, 4) : null;
    s.cost_per_run_usd = s.runs_with_cost ? round(s.cost_usd / s.runs_with_cost, 6) : null;
    return s;
}

/* ---------------------------------------------------------------------------
 * GET
 * ------------------------------------------------------------------------- */

export async function GET(request: NextRequest) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        const { searchParams } = new URL(request.url);
        const orgId = searchParams.get('orgId') || searchParams.get('org_id') || searchParams.get('organization_id');
        if (!orgId) return NextResponse.json({ error: 'orgId required' }, { status: 400 });
        const agentKey = searchParams.get('agentKey') || searchParams.get('agent_key');
        if (!agentKey) return NextResponse.json({ error: 'agentKey required' }, { status: 400 });

        const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000);

        const [configRes, runsRes] = await Promise.all([
            supabase
                .from('oem_agents')
                .select('agent_key, display_name, status, system_prompt, system_prompt_version, runtime, model_config')
                .eq('organization_id', orgId)
                .eq('agent_key', agentKey)
                .maybeSingle(),
            supabase
                .from('oem_agent_runs')
                .select('started_at, trigger, status, model, provider, tokens_in, tokens_out, cached_tokens, cost_usd, cost_inr, duration_ms')
                .eq('organization_id', orgId)
                .eq('agent_key', agentKey)
                .gte('started_at', since.toISOString())
                .order('started_at', { ascending: false })
                .range(0, RUN_ROW_CEILING - 1),
        ]);

        // The migration is not applied — a known state, not a failure.
        if (isNotProvisionedError(configRes.error) || isNotProvisionedError(runsRes.error)) {
            return NextResponse.json({
                ok: true,
                provisioned: false,
                migration: AGENT_RUNTIME_MIGRATION,
                reason: `Agent runtime is not set up yet — apply ${AGENT_RUNTIME_MIGRATION}.sql.`,
                agent: null,
                spent: null,
                estimate: null,
                models: null,
                errors: null,
            });
        }

        // The config row IS the estimate's only input. Without it there is nothing
        // to project from, so this is a primary read and losing it loses half the
        // answer — but the measured spend below is still real, so it stays 200 with
        // the failure named rather than 500 with everything discarded.
        const configError = configRes.error
            ? queryFailure(
                'config',
                configRes.error,
                'The agent registry row could not be read, so the system prompt, the model and '
                + 'the schedule are UNKNOWN. Nothing forward-looking can be projected; the '
                + 'measured spend below is unaffected.',
            )
            : null;

        const runsError = runsRes.error
            ? queryFailure(
                'runs',
                runsRes.error,
                'The agent run log could not be read, so what this agent has actually spent is '
                + 'UNKNOWN for every window. Render the spend as unreadable, never as ₹0 — an '
                + 'unread ledger and an empty one are different answers.',
            )
            : null;

        const cfg = (configRes.data ?? null) as {
            agent_key: string;
            display_name: string;
            status: string;
            system_prompt: string | null;
            system_prompt_version: number | null;
            runtime: AgentRuntimeConfig | null;
            model_config: AgentModelConfig | null;
        } | null;

        const runs = (runsRes.error ? [] : (runsRes.data ?? [])) as unknown as RunRow[];
        const truncated = runs.length >= RUN_ROW_CEILING;

        const runtime = cfg?.runtime ?? null;
        const tz = runtime?.timezone;
        const now = new Date();

        /* ---------------------------------------------------------------- 1. SPENT */

        const windowFrom: Record<WindowKey, Date> = {
            today: startOfDayIn(tz, now),
            '7d': new Date(now.getTime() - 7 * 86_400_000),
            '30d': since,
        };

        const windows = (['today', '7d', '30d'] as WindowKey[]).map((key) => {
            const fromMs = windowFrom[key].getTime();
            const rows = runs.filter((r) => new Date(r.started_at).getTime() >= fromMs);

            const total = emptySpend();
            const byTrigger = new Map<string, Spend>();
            for (const r of rows) {
                accumulate(total, r);
                // 'unknown' rather than dropping the row: trigger is nullable, and a
                // run whose trigger was never written still spent money. Silently
                // excluding it would make the breakdown fail to sum to the total.
                const t = (r.trigger ?? 'unknown') || 'unknown';
                let bucket = byTrigger.get(t);
                if (!bucket) { bucket = emptySpend(); byTrigger.set(t, bucket); }
                accumulate(bucket, r);
            }

            return {
                key,
                from: windowFrom[key].toISOString(),
                ...sealSpend(total),
                by_trigger: [...byTrigger.entries()]
                    .map(([trigger, s]) => ({ trigger, ...sealSpend(s) }))
                    .sort((a, b) => b.runs - a.runs),
            };
        });

        const spent = runsError ? null : {
            windows,
            timezone: tz ?? 'UTC',
            /** True when the 30-day read hit the ceiling: the figures are a floor. */
            truncated,
            basis: SPEND_BASIS,
            /** A rehearsal bills like any other run; it is split out, not excluded. */
            shadow_note:
                "Runs with trigger 'shadow' are rehearsals. They spend real money, so they are "
                + 'included in the totals and broken out separately — never netted off.',
        };

        /* ------------------------------------------------------ 2. ESTIMATED FORWARD */

        // Which model actually runs. model_config is the operator's declared
        // choice; the run rows are what the runtime recorded using. Config wins
        // when set (that is what the next run will use), observation is the
        // fallback, and when neither exists the answer is "not configured" — not
        // a default model picked here, which would attach a real price to a model
        // nobody chose.
        const configuredModel = (cfg?.model_config?.model ?? '').trim() || null;
        const observedModel = runs.find((r) => (r.model ?? '').trim())?.model?.trim() ?? null;
        const model = configuredModel ?? observedModel;
        const modelSource: 'model_config' | 'observed_runs' | 'none' =
            configuredModel ? 'model_config' : observedModel ? 'observed_runs' : 'none';
        const modelPriced = model ? isPriced(model) : false;

        const promptChars = cfg?.system_prompt?.length ?? null;
        const estInputTokens = promptChars === null ? null : Math.round(promptChars / CHARS_PER_TOKEN);
        // max_tokens is a CEILING the operator set, not a mean the agent hits.
        // Costing at the ceiling is the worst case and is labelled as such; the
        // alternative — inventing a "typical" fraction of it — is a number with
        // no source at all.
        const maxOutputTokens = num(cfg?.model_config?.max_tokens);

        // Model calls per run, from the trace rather than assumed. Counted only
        // over runs that HAVE a trace, because a run with no steps recorded says
        // nothing about how many calls it made and would drag the mean toward 0.
        const callsPerRun = await deriveCallsPerRun(supabase, orgId, agentKey, since);

        const cron = runtime?.schedule_cron?.trim() || null;
        const scheduledPerDay = cron ? cronFiringsPerDay(cron, WINDOW_DAYS) : null;

        // What the schedule SAYS versus what the log SHOWS. These disagree more
        // often than not (a cron edited after deploy, a second trigger nobody
        // remembers, a retry loop), and projecting only from cron would then be
        // confidently wrong. Both are reported; neither is picked for the other.
        const observedSpanDays = runs.length
            ? Math.max(
                1 / 24,
                (now.getTime() - new Date(runs[runs.length - 1].started_at).getTime()) / 86_400_000,
            )
            : null;
        const observedPerDay = observedSpanDays ? round(runs.length / observedSpanDays, 2) : null;

        const perCallUsd = model && modelPriced && estInputTokens !== null && maxOutputTokens !== null
            ? (estInputTokens * priceOf(model).input + maxOutputTokens * priceOf(model).output) / 1e6
            : null;
        const perRunUsd = perCallUsd !== null && callsPerRun.value !== null
            ? perCallUsd * callsPerRun.value
            : null;

        const project = (perDay: number | null) => {
            if (perRunUsd === null || perDay === null) return null;
            const day = perRunUsd * perDay;
            return {
                per_day_usd: round(day, 6), per_day_inr: round(day * USD_INR, 2),
                per_week_usd: round(day * 7, 6), per_week_inr: round(day * 7 * USD_INR, 2),
                per_month_usd: round(day * 30, 6), per_month_inr: round(day * 30 * USD_INR, 2),
            };
        };

        const estimate = {
            /** Every number in this object is ESTIMATED. The UI must say so. */
            is_estimate: true as const,
            model,
            model_source: modelSource,
            model_priced: modelPriced,
            prompt_chars: promptChars,
            prompt_version: cfg?.system_prompt_version ?? null,
            input_tokens_per_call: estInputTokens,
            output_tokens_per_call: maxOutputTokens,
            output_is_ceiling: maxOutputTokens !== null,
            calls_per_run: callsPerRun,
            per_call_usd: perCallUsd === null ? null : round(perCallUsd, 6),
            per_call_inr: perCallUsd === null ? null : round(perCallUsd * USD_INR, 4),
            per_run_usd: perRunUsd === null ? null : round(perRunUsd, 6),
            per_run_inr: perRunUsd === null ? null : round(perRunUsd * USD_INR, 4),
            schedule_cron: cron,
            timezone: tz ?? null,
            scheduled_runs_per_day: scheduledPerDay === null ? null : round(scheduledPerDay, 3),
            observed_runs_per_day: observedPerDay,
            observed_span_days: observedSpanDays === null ? null : round(observedSpanDays, 2),
            at_schedule: project(scheduledPerDay),
            at_observed_rate: project(observedPerDay),
            usd_inr: USD_INR,
            basis:
                `ESTIMATE, not a measurement. Input tokens = system_prompt length (${promptChars ?? '?'} chars) `
                + `÷ ${CHARS_PER_TOKEN}, the chars-per-token rule of thumb — it is a FLOOR, because the real `
                + 'prompt also carries whatever rows the agent fetches during the run, which this route '
                + 'cannot see. Output tokens = model_config.max_tokens, the operator-set CEILING, so the '
                + 'per-call figure is a worst case. Priced against MODEL_PRICING via priceOf() '
                + '(backend/lib/council/llm.ts), multiplied by the calls-per-run figure above, then by the '
                + `cadence. ₹ converted at AGENT_USD_INR = ${USD_INR}.`,
            /** Named gaps, so the UI can say which input is missing rather than "—". */
            missing: [
                promptChars === null ? 'system_prompt' : null,
                maxOutputTokens === null ? 'model_config.max_tokens' : null,
                model === null ? 'model_config.model' : null,
                model !== null && !modelPriced ? 'a published rate for this model' : null,
                cron === null ? 'runtime.schedule_cron' : null,
            ].filter((x): x is string => x !== null),
        };

        /* ------------------------------------------------------- 3. MODEL COMPARISON */

        // The catalog comes from COUNCIL_MODEL_CHOICES + priceOf(), exactly as
        // /api/agents/council/route.ts:88 builds it. MODEL_PRICING itself is not
        // exported, and this route deliberately does not widen llm.ts to export
        // it: the choices list is already defined as "the models with a published
        // rate", which is precisely the set a cost comparison may contain.
        const catalogIds = [...new Set<string>([
            ...COUNCIL_MODEL_CHOICES,
            // The model actually in force, so the comparison always contains the
            // row the operator is comparing FROM.
            ...(model ? [model] : []),
        ])];

        const thirty = windows.find((w) => w.key === '30d');
        // Replay is only possible against REAL tokens. With none recorded there is
        // nothing to re-price, and the honest output is null with the reason.
        const canReplay = !!thirty && thirty.runs_with_cost > 0 && (thirty.tokens_in + thirty.tokens_out) > 0;

        const catalog = catalogIds.map((id) => {
            const p = priceOf(id);
            const priced = isPriced(id);
            const replayUsd = canReplay && priced && thirty
                ? (thirty.tokens_in * p.input + thirty.tokens_out * p.output) / 1e6
                : null;
            return {
                model: id,
                input_per_1m_usd: p.input,
                output_per_1m_usd: p.output,
                priced,
                is_configured: id === model,
                /** MEASURED replay: this window's real tokens at this model's rate. */
                replay_30d_usd: replayUsd === null ? null : round(replayUsd, 6),
                replay_30d_inr: replayUsd === null ? null : round(replayUsd * USD_INR, 2),
            };
        }).sort(
            // Cheapest blended rate first, so the table reads as a ladder from the
            // configured model down (or up). Ties broken by name so the order is
            // stable across requests — a table that reshuffles between refreshes
            // makes the operator re-find their row every time.
            (a, b) => (a.input_per_1m_usd + a.output_per_1m_usd)
                - (b.input_per_1m_usd + b.output_per_1m_usd)
                || a.model.localeCompare(b.model),
        );

        // The largest output any run actually produced. It answers the one
        // question that makes a cheap model safe: does this agent ever write long?
        const outputs = runs.map((r) => num(r.tokens_out)).filter((n): n is number => n !== null);
        const maxObservedOutput = outputs.length ? Math.max(...outputs) : null;

        const models = {
            configured: model,
            configured_source: modelSource,
            configured_priced: modelPriced,
            catalog,
            replay_possible: canReplay,
            replay_basis: canReplay
                ? 'MEASURED: the last 30 days of real tokens_in / tokens_out, re-priced at each '
                + "model's published rate. It assumes the same token counts on a different model, "
                + 'which is itself an assumption — a different model produces different output '
                + 'lengths for the same job.'
                : 'Not computable: no run in the last 30 days recorded a token count, so there is '
                + 'nothing to re-price. What another model would have cost is unknown, not zero.',
            max_observed_output_tokens: maxObservedOutput,
            output_budget_note: maxObservedOutput === null
                ? 'No run recorded an output token count, so it is unknown whether this agent ever '
                + 'writes long enough for the output rate to matter.'
                : maxObservedOutput <= 1000
                    ? `Never exceeded ${maxObservedOutput} output tokens in ${WINDOW_DAYS} days. Output `
                    + 'rate barely moves the bill for this agent; compare on the input rate.'
                    : `Peaked at ${maxObservedOutput} output tokens. The output rate is the one that `
                    + 'matters here.',
            /**
             * ONE LINE, AND IT IS NOT "PICK THE CHEAPEST". Price is the only axis
             * this route can measure; capability is the axis that decides whether
             * a swap is safe, and nothing in oem_agent_runs records it. Doctrine
             * L10: the model tier follows the cost of a false positive
             * `[BAA p.112]`, and a PO anomaly scanner's false positive lands in
             * front of the purchase team. So this states the trade rather than
             * making the call.
             */
            trade_off:
                'Cheaper per token is not cheaper per outcome: a weaker model that misses an '
                + 'anomaly, or invents one, costs more than the rate difference in a single '
                + 'wrong correction request. Treat any move down this table as a change that '
                + 'needs an A/B on the same case set before it ships (doctrine L2), and size '
                + 'the tier to what a false positive costs, not to the rate (doctrine L10).',
        };

        return NextResponse.json({
            ok: !configError && !runsError,
            provisioned: true,
            agent: cfg ? {
                agent_key: cfg.agent_key,
                display_name: cfg.display_name,
                status: cfg.status,
                schedule_cron: cron,
                timezone: tz ?? null,
            } : null,
            spent,
            estimate: configError ? null : estimate,
            models: configError ? null : models,
            errors: {
                config: configError,
                runs: runsError,
                steps: callsPerRun.error,
            },
        });
    } catch (e) {
        return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
}

/* ---------------------------------------------------------------------------
 * Calls per run — measured, or honestly absent.
 *
 * A run that calls the model three times costs three times the single-call
 * estimate, and assuming one would understate the projection by 200%. The trace
 * already records step_type, so the multiplier is countable rather than
 * assumable: llm steps ÷ runs that have a trace at all.
 *
 * When the trace records no llm steps — which is the state of every agent in
 * this database, because the runtime does not yet instrument model calls
 * (doctrine §2: the tool-interaction axis is ABSENT) — the answer is
 * `measured: false` with a stated assumption of 1, not a silent 1.
 * ------------------------------------------------------------------------- */

interface CallsPerRun {
    value: number | null;
    measured: boolean;
    llm_steps: number;
    runs_with_steps: number;
    basis: string;
    error: QueryFailure | null;
}

async function deriveCallsPerRun(
    supabase: Awaited<ReturnType<typeof createClient>>,
    orgId: string,
    agentKey: string,
    since: Date,
): Promise<CallsPerRun> {
    // Joined through the run rather than fetched per run: one query, and the
    // embedded filter is what scopes it to this agent's runs in the window.
    const { data, error } = await supabase
        .from('oem_agent_run_steps')
        .select('run_id, step_type, oem_agent_runs!inner(agent_key, started_at)')
        .eq('organization_id', orgId)
        .eq('oem_agent_runs.agent_key', agentKey)
        .gte('oem_agent_runs.started_at', since.toISOString())
        .range(0, STEP_ROW_CEILING - 1);

    if (error && !isNotProvisionedError(error)) {
        return {
            value: null, measured: false, llm_steps: 0, runs_with_steps: 0,
            basis: 'Unknown: the step trace could not be read, so how many model calls a run makes '
                + 'is unknown. Nothing forward-looking is projected from a guessed multiplier.',
            error: queryFailure(
                'steps', error,
                'The step trace could not be read, so model calls per run is UNKNOWN and the '
                + 'forward projection is withheld rather than computed against an assumed 1.',
            ),
        };
    }

    const rows = (data ?? []) as unknown as Array<{ run_id: string; step_type: string }>;
    const runsWithSteps = new Set(rows.map((r) => r.run_id)).size;
    const llmSteps = rows.filter((r) => r.step_type === 'llm').length;

    if (llmSteps > 0 && runsWithSteps > 0) {
        return {
            value: round(llmSteps / runsWithSteps, 3),
            measured: true,
            llm_steps: llmSteps,
            runs_with_steps: runsWithSteps,
            basis: `MEASURED: ${llmSteps} steps of type 'llm' across ${runsWithSteps} traced runs in the `
                + `last ${WINDOW_DAYS} days.`,
            error: null,
        };
    }

    return {
        value: 1,
        measured: false,
        llm_steps: llmSteps,
        runs_with_steps: runsWithSteps,
        basis: runsWithSteps === 0
            ? `ASSUMED 1. No run in the last ${WINDOW_DAYS} days has a step trace, so the number of `
            + 'model calls per run has never been recorded.'
            : `ASSUMED 1. ${runsWithSteps} traced runs in the last ${WINDOW_DAYS} days recorded no step of `
            + "type 'llm' — the runtime does not yet instrument model calls (docs/AGENT_DOCTRINE.md §2, "
            + 'the tool-interaction gap), so a run making three calls and a run making one look identical '
            + 'in the trace. Every projection below is per ONE call.',
        error: null,
    };
}
