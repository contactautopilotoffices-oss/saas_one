'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { AlertCircle, Calculator, Database, Inbox, Loader2, RefreshCw, Scale } from 'lucide-react';
import { AGENT_RUNTIME_MIGRATION } from '@/frontend/types/agentRuntime';

/**
 * AGENT COST — what it spent, what it will spend, and what it could spend.
 * =============================================================================
 * Three blocks, in that order, because that is the order the question is asked
 * in: what has this thing cost me, what is it about to cost me, and could it
 * cost me less. Nothing else goes in this panel.
 *
 * READ-ONLY. It renders GET /api/agents/cost and mounts nothing that writes.
 * It does not change agent behaviour, so it carries NO Agent Spec Block
 * (docs/AGENT_DOCTRINE.md §3) — stated, not silently omitted, because silent
 * deviation is the one thing the doctrine forbids (CLAUDE.md).
 *
 * THE RULE THIS WHOLE COMPONENT IS BUILT AROUND: A NUMBER YOU CANNOT TRACE IS
 * WORSE THAN NO NUMBER.
 *
 * That produces three separate empty-ish states, and conflating any two of them
 * is a lie the operator has no way to detect:
 *
 *   no runs                 "No runs recorded yet"       nothing happened
 *   runs, no cost recorded  "12 runs · cost not recorded" it happened, unmeasured
 *   read failed             "Could not read"             we do not know
 *
 * None of them is ever drawn as ₹0.00. ₹0.00 is reserved for a window where
 * runs genuinely recorded zero spend, which in practice never happens.
 *
 * And every projected figure is stamped ESTIMATE with its derivation reachable
 * from the panel — the chars÷4 assumption, the max_tokens ceiling, the cadence.
 * An estimate that looks like a measurement is the failure this panel is here
 * to prevent.
 *
 * Contract: GET /api/agents/cost?orgId=&agentKey=
 *           -> { ok, provisioned, agent, spent, estimate, models, errors }
 *
 * Visual idiom deliberately matches AgentActivity: one bordered card, a range
 * pill group, a row of tiles, then the detail. Two panels on the same screen
 * that look like different products make both harder to read.
 */

export interface AgentCostProps {
    orgId: string;
    agentKey: string;
}

/* --------------------------------------------------------------------------
 * The payload, typed to what the route promises.
 * ------------------------------------------------------------------------ */

interface Spend {
    runs: number;
    runs_with_cost: number;
    cost_inr: number;
    cost_usd: number;
    tokens_in: number;
    tokens_out: number;
    cached_tokens: number;
    cost_measured: boolean;
    cost_per_run_inr: number | null;
    cost_per_run_usd: number | null;
}

type WindowKey = 'today' | '7d' | '30d';

interface SpendWindow extends Spend {
    key: WindowKey;
    from: string;
    by_trigger: Array<Spend & { trigger: string }>;
}

interface Projection {
    per_day_usd: number; per_day_inr: number;
    per_week_usd: number; per_week_inr: number;
    per_month_usd: number; per_month_inr: number;
}

interface CostPayload {
    ok?: boolean;
    provisioned?: boolean;
    migration?: string;
    reason?: string;
    error?: string;
    agent?: {
        agent_key: string; display_name: string; status: string;
        schedule_cron: string | null; timezone: string | null;
    } | null;
    spent?: {
        windows: SpendWindow[];
        timezone: string;
        truncated: boolean;
        basis: string;
        shadow_note: string;
    } | null;
    estimate?: {
        model: string | null;
        model_source: 'model_config' | 'observed_runs' | 'none';
        model_priced: boolean;
        prompt_chars: number | null;
        input_tokens_per_call: number | null;
        output_tokens_per_call: number | null;
        output_is_ceiling: boolean;
        calls_per_run: { value: number | null; measured: boolean; basis: string };
        per_run_usd: number | null;
        per_run_inr: number | null;
        schedule_cron: string | null;
        timezone: string | null;
        scheduled_runs_per_day: number | null;
        observed_runs_per_day: number | null;
        observed_span_days: number | null;
        at_schedule: Projection | null;
        at_observed_rate: Projection | null;
        usd_inr: number;
        basis: string;
        missing: string[];
    } | null;
    models?: {
        configured: string | null;
        configured_source: string;
        catalog: Array<{
            model: string;
            input_per_1m_usd: number;
            output_per_1m_usd: number;
            priced: boolean;
            is_configured: boolean;
            replay_30d_usd: number | null;
            replay_30d_inr: number | null;
        }>;
        replay_possible: boolean;
        replay_basis: string;
        max_observed_output_tokens: number | null;
        output_budget_note: string;
        trade_off: string;
    } | null;
    errors?: {
        config: { reason: string } | null;
        runs: { reason: string } | null;
        steps: { reason: string } | null;
    } | null;
}

const RANGES: Array<{ key: WindowKey; label: string; noun: string }> = [
    { key: 'today', label: 'Today', noun: 'today' },
    { key: '7d', label: '7 days', noun: 'in the last 7 days' },
    { key: '30d', label: '30 days', noun: 'in the last 30 days' },
];

/**
 * READ A RESPONSE THAT MIGHT NOT BE JSON — the same helper, and the same
 * reason, as AgentConsole.tsx:245. A bare res.json() against an HTML error page
 * throws with the first characters of that page as the message, so the operator
 * is shown `Unexpected token '<'` and goes looking for a bug in our JSON
 * instead of at the 502 that actually happened. Take the text, parse only if it
 * parses, and otherwise describe what really came back.
 */
async function readJson<T>(res: Response): Promise<T> {
    const text = await res.text();
    try {
        return JSON.parse(text) as T;
    } catch {
        const head = text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160);
        throw new Error(
            res.status === 504 || /timeout/i.test(head)
                ? `The server took too long and was cut off (HTTP ${res.status}).`
                : `The server replied with ${res.status} and not JSON${head ? `: ${head}` : '.'}`,
        );
    }
}

/* --------------------------------------------------------------------------
 * Formatting. Every one of these returns "—" for null, and null only ever
 * arrives here meaning "not known".
 * ------------------------------------------------------------------------ */

function fmtInr(n: number | null | undefined, dp = 2): string {
    if (n === null || n === undefined || !Number.isFinite(Number(n))) return '—';
    const v = Number(n);
    // Sub-rupee spend is the normal case for a cheap model, and rounding it to
    // ₹0.00 would make a real cost look like no cost at all.
    if (v > 0 && v < 0.01) return '₹<0.01';
    return `₹${v.toLocaleString('en-IN', { minimumFractionDigits: dp, maximumFractionDigits: dp })}`;
}

function fmtUsd(n: number | null | undefined): string {
    if (n === null || n === undefined || !Number.isFinite(Number(n))) return '—';
    const v = Number(n);
    if (v > 0 && v < 0.0001) return '$<0.0001';
    return `$${v < 0.01 ? v.toFixed(4) : v.toFixed(2)}`;
}

function fmtTokens(n: number | null | undefined): string {
    if (n === null || n === undefined || !Number.isFinite(Number(n))) return '—';
    const v = Number(n);
    if (v < 1000) return String(Math.round(v));
    if (v < 1_000_000) return `${(v / 1000).toFixed(v < 10_000 ? 1 : 0)}k`;
    return `${(v / 1_000_000).toFixed(1)}M`;
}

const TRIGGER_LABEL: Record<string, string> = {
    cron: 'Scheduled',
    manual: 'Manual',
    webhook: 'Webhook',
    shadow: 'Shadow (rehearsal)',
    replay: 'Replay',
    unknown: 'Unrecorded trigger',
};

/* ==========================================================================
 * Component
 * ======================================================================== */

export default function AgentCost({ orgId, agentKey }: AgentCostProps) {
    const [data, setData] = useState<CostPayload | null>(null);
    const [range, setRange] = useState<WindowKey>('today');
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async (quiet: boolean) => {
        if (!orgId || !agentKey) return;
        if (quiet) setRefreshing(true); else setLoading(true);
        try {
            const res = await fetch(
                `/api/agents/cost?orgId=${encodeURIComponent(orgId)}&agentKey=${encodeURIComponent(agentKey)}`,
                { cache: 'no-store' },
            );
            const json = await readJson<CostPayload>(res);
            if (!res.ok) {
                setError(typeof json.error === 'string' ? json.error : `Could not load cost (${res.status})`);
                return;
            }
            setError(null);
            setData(json);
        } catch (e) {
            setError((e as Error).message || 'Network error');
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, [orgId, agentKey]);

    useEffect(() => { void load(false); }, [load]);

    const spent = data?.spent ?? null;
    const win = spent?.windows.find((w) => w.key === range) ?? null;
    const noun = RANGES.find((r) => r.key === range)?.noun ?? '';

    return (
        <section className="rounded-[20px] border border-border bg-card overflow-hidden">
            {/* -----------------------------------------------------------------
                HEADER
            ----------------------------------------------------------------- */}
            <div className="px-5 pt-4 pb-3 flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                    <h2 className="text-[15px] font-semibold text-text-primary truncate">Cost</h2>
                    <p className="mt-0.5 text-xs text-text-tertiary truncate">
                        {data?.agent?.display_name || agentKey}
                        {data?.agent?.schedule_cron && (
                            <span className="ml-2 font-mono text-[11px]">
                                {data.agent.schedule_cron}
                                {data.agent.timezone ? ` (${data.agent.timezone})` : ''}
                            </span>
                        )}
                    </p>
                </div>
                <button
                    type="button"
                    onClick={() => void load(true)}
                    disabled={loading || refreshing}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border border-border
                               text-xs text-text-secondary hover:bg-muted transition-colors disabled:opacity-50"
                >
                    <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
                    Refresh
                </button>
            </div>

            {loading ? (
                <div className="px-5 pb-8 pt-2 flex items-center justify-center gap-2 text-sm text-text-tertiary">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Reading the ledger…
                </div>
            ) : error ? (
                <Panel tone="warn" icon={<AlertCircle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />}>
                    <p className="text-sm font-medium text-text-primary">Could not load cost</p>
                    <p className="mt-0.5 text-xs text-text-secondary">{error}</p>
                </Panel>
            ) : data?.provisioned === false ? (
                <Panel tone="plain" icon={<Database className="w-4 h-4 text-text-tertiary mt-0.5 shrink-0" />}>
                    <p className="text-sm font-medium text-text-primary">Not provisioned yet</p>
                    <p className="mt-0.5 text-xs text-text-secondary">
                        Run migration <span className="font-mono">{data.migration ?? AGENT_RUNTIME_MIGRATION}</span>{' '}
                        to start recording what this agent spends.
                    </p>
                </Panel>
            ) : (
                <>
                    {/* =====================================================
                        1. ACTUALLY SPENT — measured, or honestly not.
                    ===================================================== */}
                    <div className="px-5 pb-3 flex items-center justify-between gap-3 flex-wrap">
                        <div className="inline-flex items-center gap-0.5 p-0.5 rounded-full bg-muted" role="tablist">
                            {RANGES.map((r) => (
                                <button
                                    key={r.key}
                                    type="button"
                                    role="tab"
                                    aria-selected={range === r.key}
                                    onClick={() => setRange(r.key)}
                                    className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                                        range === r.key
                                            ? 'bg-card text-text-primary shadow-sm'
                                            : 'text-text-secondary hover:text-text-primary'
                                    }`}
                                >
                                    {r.label}
                                </button>
                            ))}
                        </div>
                        <span className="text-[11px] text-text-tertiary">
                            Measured from the run log{spent ? ` · day starts in ${spent.timezone}` : ''}
                        </span>
                    </div>

                    {data?.errors?.runs ? (
                        <Panel tone="warn" icon={<AlertCircle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />}>
                            <p className="text-sm font-medium text-text-primary">Spend is unknown</p>
                            <p className="mt-0.5 text-xs text-text-secondary">{data.errors.runs.reason}</p>
                        </Panel>
                    ) : !win || win.runs === 0 ? (
                        <div className="px-5 pb-5">
                            <div className="rounded-2xl bg-card-tint border border-border px-5 py-8 text-center">
                                <span className="inline-grid place-items-center w-10 h-10 rounded-full bg-muted">
                                    <Inbox className="w-4 h-4 text-text-tertiary" />
                                </span>
                                <p className="mt-3 text-sm font-medium text-text-primary">No runs recorded yet</p>
                                <p className="mt-1.5 text-xs text-text-tertiary">
                                    Nothing ran {noun}, so there is nothing to cost — this is not ₹0.00 spend.
                                </p>
                            </div>
                        </div>
                    ) : (
                        <>
                            <div className="px-5 grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                                <Tile
                                    label={`Runs ${noun === 'today' ? 'today' : `· ${noun.replace('in the last ', '')}`}`}
                                    value={String(win.runs)}
                                    sub={
                                        win.cost_measured
                                            ? `${win.runs_with_cost} recorded a cost`
                                            : 'none recorded a cost'
                                    }
                                    tone={win.cost_measured ? 'plain' : 'warn'}
                                />
                                <Tile
                                    label="Total cost"
                                    value={win.cost_measured ? fmtInr(win.cost_inr) : 'Not recorded'}
                                    sub={win.cost_measured ? fmtUsd(win.cost_usd) : `${win.runs} runs, no cost written`}
                                    tone={win.cost_measured ? 'plain' : 'warn'}
                                />
                                <Tile
                                    label="Tokens"
                                    value={win.cost_measured ? fmtTokens(win.tokens_in + win.tokens_out) : 'Not recorded'}
                                    sub={
                                        win.cost_measured
                                            ? `${fmtTokens(win.tokens_in)} in → ${fmtTokens(win.tokens_out)} out`
                                            + (win.cached_tokens > 0 ? ` · ${fmtTokens(win.cached_tokens)} cached` : '')
                                            : 'no run wrote tokens_in / tokens_out'
                                    }
                                    tone={win.cost_measured ? 'plain' : 'warn'}
                                />
                                <Tile
                                    label="Cost per run"
                                    value={fmtInr(win.cost_per_run_inr, 4)}
                                    sub={
                                        win.cost_per_run_usd !== null
                                            ? `${fmtUsd(win.cost_per_run_usd)} · over ${win.runs_with_cost} measured runs`
                                            : 'no measured run to divide by'
                                    }
                                    tone={win.cost_per_run_inr === null ? 'warn' : 'plain'}
                                />
                            </div>

                            {/* The state that matters most. Say it in a sentence, not a dash. */}
                            {!win.cost_measured && (
                                <p className="mx-5 mt-2.5 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2
                                              text-[11px] leading-relaxed text-amber-700">
                                    {win.runs} run{win.runs === 1 ? '' : 's'} executed {noun}, and not one of them wrote a
                                    cost or token figure to <span className="font-mono">oem_agent_runs</span>. What this
                                    agent spent is <strong>unmeasured</strong>, which is not the same as free. Until the
                                    runtime records tokens and cost per run, no rupee figure here can be trusted.
                                </p>
                            )}

                            {/* BY TRIGGER — because a shadow run is a rehearsal that still bills. */}
                            <div className="px-5 pt-4">
                                <h3 className="text-[11px] uppercase tracking-wide text-text-tertiary font-medium">
                                    By trigger
                                </h3>
                                <div className="mt-2 overflow-x-auto rounded-2xl border border-border">
                                    <table className="w-full text-sm border-collapse">
                                        <thead>
                                            <tr className="text-left text-[11px] uppercase tracking-wide text-text-tertiary bg-card-tint">
                                                <th scope="col" className="font-medium px-3 py-2">Trigger</th>
                                                <th scope="col" className="font-medium px-3 py-2 text-right">Runs</th>
                                                <th scope="col" className="font-medium px-3 py-2 text-right">Costed</th>
                                                <th scope="col" className="font-medium px-3 py-2 text-right">Tokens</th>
                                                <th scope="col" className="font-medium px-3 py-2 text-right">Cost</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {win.by_trigger.map((t) => (
                                                <tr key={t.trigger} className="border-t border-border">
                                                    <td className="px-3 py-2 text-[13px] text-text-primary whitespace-nowrap">
                                                        {TRIGGER_LABEL[t.trigger] ?? t.trigger}
                                                    </td>
                                                    <td className="px-3 py-2 text-right font-mono text-[13px] text-text-secondary">
                                                        {t.runs}
                                                    </td>
                                                    <td className="px-3 py-2 text-right font-mono text-[13px] text-text-secondary">
                                                        {t.runs_with_cost}
                                                    </td>
                                                    <td className="px-3 py-2 text-right font-mono text-[13px] text-text-secondary">
                                                        {t.cost_measured ? fmtTokens(t.tokens_in + t.tokens_out) : '—'}
                                                    </td>
                                                    <td className="px-3 py-2 text-right font-mono text-[13px] text-text-secondary">
                                                        {t.cost_measured ? fmtInr(t.cost_inr, 4) : 'not recorded'}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                                {win.by_trigger.some((t) => t.trigger === 'shadow') && (
                                    <p className="mt-1.5 text-[11px] text-text-tertiary leading-relaxed">
                                        {spent?.shadow_note}
                                    </p>
                                )}
                            </div>
                        </>
                    )}

                    {/* =====================================================
                        2. ESTIMATED FORWARD COST
                    ===================================================== */}
                    {data?.errors?.config ? (
                        <div className="px-5 pt-5">
                            <SectionHead icon={<Calculator className="w-3.5 h-3.5" />} title="Estimated forward cost" estimate />
                            <p className="mt-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2
                                          text-[11px] leading-relaxed text-amber-700">
                                {data.errors.config.reason}
                            </p>
                        </div>
                    ) : data?.estimate ? (
                        <EstimateBlock est={data.estimate} />
                    ) : null}

                    {/* =====================================================
                        3. SUGGESTED MODEL
                    ===================================================== */}
                    {data?.models && <ModelsBlock models={data.models} />}

                    <p className="px-5 pt-4 pb-5 text-[11px] leading-relaxed text-text-tertiary border-t border-border mt-5">
                        {spent?.basis}
                    </p>
                </>
            )}
        </section>
    );
}

/* ==========================================================================
 * 2. Estimated forward cost.
 *
 * Every number in this block is modelled, so the block is fenced: an ESTIMATE
 * badge on the heading, the derivation printed underneath, and the named
 * missing inputs listed rather than rendered as bare dashes. An operator who
 * cannot see how a projection was built has no way to know when to stop
 * trusting it.
 * ======================================================================== */

function EstimateBlock({ est }: { est: NonNullable<CostPayload['estimate']> }) {
    const cadenceDisagrees =
        est.scheduled_runs_per_day !== null
        && est.observed_runs_per_day !== null
        // Two-fold is the threshold where "the cron is not what actually runs it"
        // stops being rounding and starts being a different agent. Below that,
        // partial-day sampling explains the gap on its own.
        && (est.observed_runs_per_day > est.scheduled_runs_per_day * 2
            || est.observed_runs_per_day * 2 < est.scheduled_runs_per_day);

    return (
        <div className="px-5 pt-6">
            <SectionHead icon={<Calculator className="w-3.5 h-3.5" />} title="Estimated forward cost" estimate />

            {est.missing.length > 0 && (
                <p className="mt-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2
                              text-[11px] leading-relaxed text-amber-700">
                    Cannot be priced: <strong>{est.missing.join(', ')}</strong>{' '}
                    {est.missing.length === 1 ? 'is' : 'are'} not set on this agent. The token estimate below is
                    still real; the rupee projection is withheld rather than computed against a model nobody chose.
                </p>
            )}

            <div className="mt-2.5 grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                <Tile
                    label="Est. input / call"
                    value={est.input_tokens_per_call === null ? '—' : fmtTokens(est.input_tokens_per_call)}
                    sub={est.prompt_chars === null ? 'no system prompt' : `${est.prompt_chars} chars ÷ 4 — a floor`}
                />
                <Tile
                    label="Est. output / call"
                    value={est.output_tokens_per_call === null ? '—' : fmtTokens(est.output_tokens_per_call)}
                    sub={est.output_is_ceiling ? 'max_tokens ceiling — worst case' : 'max_tokens not set'}
                />
                <Tile
                    label="Model calls / run"
                    value={est.calls_per_run.value === null ? '—' : String(est.calls_per_run.value)}
                    sub={est.calls_per_run.measured ? 'measured from the trace' : 'assumed — not instrumented'}
                    tone={est.calls_per_run.measured ? 'plain' : 'warn'}
                />
                <Tile
                    label="Est. cost / run"
                    value={fmtInr(est.per_run_inr, 4)}
                    sub={est.per_run_usd === null ? 'not priceable' : `${fmtUsd(est.per_run_usd)} on ${est.model}`}
                />
            </div>

            <div className="mt-2.5 grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <CadenceCard
                    title="At the configured schedule"
                    detail={
                        est.schedule_cron
                            ? `${est.schedule_cron}${est.timezone ? ` (${est.timezone})` : ''}`
                            + (est.scheduled_runs_per_day !== null ? ` · ${est.scheduled_runs_per_day} runs/day` : '')
                            : 'No schedule_cron set — this agent runs on demand.'
                    }
                    projection={est.at_schedule}
                />
                <CadenceCard
                    title="At the observed rate"
                    detail={
                        est.observed_runs_per_day !== null
                            ? `${est.observed_runs_per_day} runs/day, measured over the last `
                              + `${est.observed_span_days} days of the log`
                            : 'No runs in the log to measure a rate from.'
                    }
                    projection={est.at_observed_rate}
                />
            </div>

            {/* The single most useful thing this block can tell an operator: the
                schedule and reality are not the same agent. Both columns are shown
                above; this names the gap so it is not read as a rendering quirk. */}
            {cadenceDisagrees && (
                <p className="mt-2.5 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2
                              text-[11px] leading-relaxed text-amber-700">
                    The schedule says <strong>{est.scheduled_runs_per_day} runs/day</strong>; the log shows{' '}
                    <strong>{est.observed_runs_per_day} runs/day</strong>. Something other than{' '}
                    <span className="font-mono">{est.schedule_cron}</span> is driving this agent, so a projection
                    built on the cron alone would be off by that factor. Reconcile the two before budgeting from
                    either.
                </p>
            )}

            <p className="mt-2 text-[11px] leading-relaxed text-text-tertiary">{est.basis}</p>
            <p className="mt-1 text-[11px] leading-relaxed text-text-tertiary">{est.calls_per_run.basis}</p>
        </div>
    );
}

function CadenceCard({
    title, detail, projection,
}: {
    title: string;
    detail: string;
    projection: Projection | null;
}) {
    return (
        <div className="rounded-2xl border border-border bg-card-tint px-3.5 py-3">
            <p className="text-[11px] text-text-tertiary">{title}</p>
            <p className="mt-0.5 text-[11px] text-text-secondary leading-relaxed">{detail}</p>
            {projection ? (
                <div className="mt-2 flex items-baseline gap-4 flex-wrap">
                    <Figure label="/ run · day" inr={projection.per_day_inr} usd={projection.per_day_usd} />
                    <Figure label="/ week" inr={projection.per_week_inr} usd={projection.per_week_usd} />
                    <Figure label="/ month" inr={projection.per_month_inr} usd={projection.per_month_usd} />
                </div>
            ) : (
                <p className="mt-2 text-[13px] text-text-tertiary">Not projectable — see the missing inputs above.</p>
            )}
        </div>
    );
}

function Figure({ label, inr, usd }: { label: string; inr: number; usd: number }) {
    return (
        <span className="inline-flex flex-col">
            <span className="font-mono text-[15px] font-semibold text-text-primary leading-none">{fmtInr(inr)}</span>
            <span className="mt-1 text-[10px] text-text-tertiary">{label} · {fmtUsd(usd)}</span>
        </span>
    );
}

/* ==========================================================================
 * 3. Suggested model.
 *
 * A price ladder, and deliberately NOT a recommendation engine. Price is the
 * only axis in this data; whether a cheaper model can still do the job is the
 * axis that decides the swap, and nothing here measures it. So the table ranks
 * on rate and the trade-off sentence sits directly under it, unmissable.
 * ======================================================================== */

function ModelsBlock({ models }: { models: NonNullable<CostPayload['models']> }) {
    return (
        <div className="px-5 pt-6">
            <SectionHead icon={<Scale className="w-3.5 h-3.5" />} title="Model comparison" />
            <p className="mt-1 text-[11px] text-text-secondary">
                {models.configured
                    ? <>Configured: <span className="font-mono text-text-primary">{models.configured}</span>{' '}
                        <span className="text-text-tertiary">(from {models.configured_source.replace('_', ' ')})</span></>
                    : <span className="text-amber-700">No model is configured on this agent, so there is nothing to
                        compare from — the rates below are the catalog, not a recommendation.</span>}
            </p>

            <div className="mt-2.5 overflow-x-auto rounded-2xl border border-border">
                <table className="w-full text-sm border-collapse">
                    <thead>
                        <tr className="text-left text-[11px] uppercase tracking-wide text-text-tertiary bg-card-tint">
                            <th scope="col" className="font-medium px-3 py-2">Model</th>
                            <th scope="col" className="font-medium px-3 py-2 text-right">In / 1M</th>
                            <th scope="col" className="font-medium px-3 py-2 text-right">Out / 1M</th>
                            <th scope="col" className="font-medium px-3 py-2 text-right">Last 30d would have cost</th>
                        </tr>
                    </thead>
                    <tbody>
                        {models.catalog.map((m) => (
                            <tr
                                key={m.model}
                                className={`border-t border-border ${m.is_configured ? 'bg-primary/5' : ''}`}
                            >
                                <td className="px-3 py-2 whitespace-nowrap">
                                    <span className="font-mono text-[13px] text-text-primary">{m.model}</span>
                                    {m.is_configured && (
                                        <span className="ml-2 px-1.5 py-0.5 rounded-full border border-primary/20
                                                         bg-primary/10 text-primary text-[10px] font-medium">
                                            configured
                                        </span>
                                    )}
                                    {!m.priced && (
                                        <span className="ml-2 px-1.5 py-0.5 rounded-full border border-amber-600/20
                                                         bg-amber-600/10 text-amber-700 text-[10px] font-medium">
                                            no published rate
                                        </span>
                                    )}
                                </td>
                                <td className="px-3 py-2 text-right font-mono text-[13px] text-text-secondary">
                                    ${m.input_per_1m_usd.toFixed(3)}
                                </td>
                                <td className="px-3 py-2 text-right font-mono text-[13px] text-text-secondary">
                                    ${m.output_per_1m_usd.toFixed(3)}
                                </td>
                                <td className="px-3 py-2 text-right font-mono text-[13px] text-text-secondary">
                                    {m.replay_30d_inr === null ? '—' : fmtInr(m.replay_30d_inr, 4)}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {/* An empty replay column with no explanation reads as "all models are
                free". Say why it is empty. */}
            {!models.replay_possible && (
                <p className="mt-1.5 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2
                              text-[11px] leading-relaxed text-amber-700">
                    {models.replay_basis}
                </p>
            )}
            {models.replay_possible && (
                <p className="mt-1.5 text-[11px] leading-relaxed text-text-tertiary">{models.replay_basis}</p>
            )}

            <p className="mt-1.5 text-[11px] leading-relaxed text-text-secondary">{models.output_budget_note}</p>
            <p className="mt-1.5 text-[11px] leading-relaxed text-text-secondary">
                <strong className="text-text-primary">Trade-off.</strong> {models.trade_off}
            </p>
        </div>
    );
}

/* ==========================================================================
 * Pieces — same shapes as AgentActivity, so the two panels read as one console.
 * ======================================================================== */

function Tile({
    label, value, sub, tone = 'plain',
}: {
    label: string;
    value: string;
    sub?: string;
    tone?: 'plain' | 'good' | 'warn' | 'bad';
}) {
    const valueTone =
        tone === 'good' ? 'text-green-700'
            : tone === 'warn' ? 'text-amber-700'
                : tone === 'bad' ? 'text-red-700'
                    : 'text-text-primary';
    return (
        <div className="rounded-2xl border border-border bg-card-tint px-3.5 py-3">
            <p className="text-[11px] text-text-tertiary truncate" title={label}>{label}</p>
            <p className={`mt-1 text-[19px] font-semibold leading-none ${valueTone}`}>{value}</p>
            {sub && <p className="mt-1.5 text-[11px] text-text-tertiary truncate" title={sub}>{sub}</p>}
        </div>
    );
}

function SectionHead({
    icon, title, estimate = false,
}: {
    icon: React.ReactNode;
    title: string;
    estimate?: boolean;
}) {
    return (
        <h3 className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-text-tertiary font-medium">
            <span className="text-text-tertiary">{icon}</span>
            {title}
            {/* The badge is the point of the whole block. It is not decoration:
                without it a projection sits beside a measurement in identical
                type and is read as one. */}
            {estimate && (
                <span className="px-1.5 py-0.5 rounded-full border border-amber-600/20 bg-amber-600/10
                                 text-amber-700 text-[10px] font-semibold tracking-normal normal-case">
                    Estimate
                </span>
            )}
        </h3>
    );
}

function Panel({
    tone, icon, children,
}: {
    tone: 'plain' | 'warn';
    icon: React.ReactNode;
    children: React.ReactNode;
}) {
    return (
        <div className="px-5 pb-5">
            <div className={`rounded-2xl border p-5 flex items-start gap-3 ${
                tone === 'warn' ? 'border-amber-500/40 bg-amber-500/10' : 'border-border bg-muted/50'
            }`}>
                {icon}
                <div className="min-w-0">{children}</div>
            </div>
        </div>
    );
}
