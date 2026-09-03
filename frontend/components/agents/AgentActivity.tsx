'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, Clock, Database, Inbox, Loader2, RefreshCw } from 'lucide-react';
import {
    AGENT_MODULE_LABELS,
    AGENT_RUNTIME_MIGRATION,
    isAgentModule,
    type AgentRuntimeConfig,
} from '@/frontend/types/agentRuntime';
import AgentRunTrace from './AgentRunTrace';

/**
 * AGENT ACTIVITY — what this agent did today, and what it did before today.
 * =============================================================================
 * A deliberately BORING table. Seven columns, one line per run, no nested cards
 * and no charts inside cells: when, which module, what it did, did it work, how
 * long, how many tokens, what it cost. That is the whole row.
 *
 * The restraint is the design. A runs table is an index — the operator scans it
 * for the row that looks wrong, then opens that row. Everything richer (the
 * plan, the tool calls, the model round trip, the exact configuration) lives in
 * AgentRunTrace, in a drawer, one click away. A table that tries to carry the
 * trace inline stops being scannable, and a runs log you cannot scan is a log
 * file with borders.
 *
 * Above the table sit the two controls that actually change the question being
 * asked — a time range and a module filter — and four stat tiles that answer
 * "is this agent healthy" before the operator reads a single row. The tiles are
 * computed by the API over the WHOLE filtered window, not over the page of rows
 * on screen, so "cost this week" means cost this week.
 *
 * Contract: GET /api/agents/runs?orgId=&agentKey=&module=&from=&limit=
 *           -> { provisioned, runs, totals }
 *           GET /api/agents/profile?orgId=&agentKey=  (for the schedule only)
 *
 * The runtime tables may not exist yet. `provisioned: false` renders a calm
 * "run the migration" panel — never an error boundary.
 */

export interface AgentActivityProps {
    orgId: string;
    agentKey: string;
}

/* The flat row the runs API returns, plus its two joins. */
interface RunRow {
    id: string;
    started_at: string;
    ended_at: string | null;
    agent_key: string;
    agent_name?: string | null;
    module: string | null;
    trigger: string | null;
    status: string;
    outcome_summary: string | null;
    duration_ms: number | null;
    tokens_in: number | null;
    tokens_out: number | null;
    cached_tokens: number | null;
    cost_inr: number | null;
    cost_usd: number | null;
    error: string | null;
    error_class: string | null;
    steps_count?: number;
}

interface Totals {
    runs: number;
    succeeded: number;
    failed: number;
    running: number;
    skipped: number;
    timeout: number;
    tokens_in: number;
    tokens_out: number;
    cached_tokens: number;
    cost_inr: number;
    cost_usd: number;
    p50_ms: number | null;
    p95_ms: number | null;
    success_rate: number | null;
}

type RangeKey = 'today' | '7d' | '30d';

const RANGES: Array<{ key: RangeKey; label: string; suffix: string }> = [
    { key: 'today', label: 'Today', suffix: 'today' },
    { key: '7d', label: '7 days', suffix: '· 7 days' },
    { key: '30d', label: '30 days', suffix: '· 30 days' },
];

const PAGE_SIZE = 100;
/** Only while something is in flight — a table with a live row should move. */
const LIVE_REFRESH_MS = 10_000;

const EMPTY_TOTALS: Totals = {
    runs: 0, succeeded: 0, failed: 0, running: 0, skipped: 0, timeout: 0,
    tokens_in: 0, tokens_out: 0, cached_tokens: 0, cost_inr: 0, cost_usd: 0,
    p50_ms: null, p95_ms: null, success_rate: null,
};

/* --------------------------------------------------------------------------
 * Formatting.
 * ------------------------------------------------------------------------ */

function rangeStart(range: RangeKey): Date {
    const now = new Date();
    if (range === 'today') return new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const days = range === '7d' ? 7 : 30;
    return new Date(now.getTime() - days * 86_400_000);
}

/** "11:42 · 6m ago" — the wall clock for correlating with other logs, the
 *  relative age for reading the table at a glance. Both, because neither alone
 *  answers both questions. */
function fmtWhen(iso: string): { clock: string; ago: string } {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return { clock: '—', ago: '' };
    const clock = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
    const secs = Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000));
    let ago: string;
    if (secs < 45) ago = 'just now';
    else if (secs < 3600) ago = `${Math.floor(secs / 60)}m ago`;
    else if (secs < 86_400) ago = `${Math.floor(secs / 3600)}h ago`;
    else ago = `${Math.floor(secs / 86_400)}d ago`;
    return { clock, ago };
}

function fmtDuration(ms: number | null | undefined): string {
    if (ms === null || ms === undefined || !Number.isFinite(Number(ms))) return '—';
    const n = Number(ms);
    if (n < 1000) return `${Math.round(n)}ms`;
    if (n < 60_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}s`;
    const mins = Math.floor(n / 60_000);
    const secs = Math.round((n % 60_000) / 1000);
    return secs ? `${mins}m ${secs}s` : `${mins}m`;
}

function fmtTokens(n: number | null | undefined): string {
    if (n === null || n === undefined || !Number.isFinite(Number(n))) return '—';
    const v = Number(n);
    if (v < 1000) return String(Math.round(v));
    if (v < 1_000_000) return `${(v / 1000).toFixed(v < 10_000 ? 1 : 0)}k`;
    return `${(v / 1_000_000).toFixed(1)}M`;
}

function fmtCost(inr: number | null | undefined, usd: number | null | undefined): string {
    const r = Number(inr);
    if (Number.isFinite(r) && r > 0) {
        return `₹${r < 1 ? r.toFixed(2) : r.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
    }
    const u = Number(usd);
    if (Number.isFinite(u) && u > 0) return `$${u < 0.01 ? u.toFixed(4) : u.toFixed(2)}`;
    return '—';
}

const moduleLabel = (m: string | null | undefined): string =>
    !m ? '—' : isAgentModule(m) ? AGENT_MODULE_LABELS[m] : m;

const STATUS_PILL: Record<string, { label: string; className: string }> = {
    running: { label: 'Running', className: 'bg-primary/10 text-primary border-primary/20' },
    succeeded: { label: 'Succeeded', className: 'bg-green-600/10 text-green-700 border-green-600/20' },
    failed: { label: 'Failed', className: 'bg-red-600/10 text-red-700 border-red-600/20' },
    timeout: { label: 'Timed out', className: 'bg-amber-600/10 text-amber-700 border-amber-600/20' },
    skipped: { label: 'Skipped', className: 'bg-muted text-text-tertiary border-border' },
};

/* ==========================================================================
 * CRON — so the empty state can say something useful.
 *
 * "No runs yet today" is a dead end. "No runs yet today · next run 18:30, in
 * 4h" tells the operator the agent is idle by schedule rather than broken, and
 * that is the difference between a console that looks alive and one that looks
 * abandoned. Standard five-field cron (a leading seconds field is tolerated
 * and ignored).
 * ======================================================================== */

const DOW_NAMES: Record<string, number> = {
    sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
};
const MONTH_NAMES: Record<string, number> = {
    jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
    jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

interface CronFields {
    minute: Set<number>;
    hour: Set<number>;
    dom: Set<number>;
    month: Set<number>;
    dow: Set<number>;
    /** Classic cron: when BOTH dom and dow are restricted, either matching is a match. */
    domRestricted: boolean;
    dowRestricted: boolean;
}

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

function parseCron(expr: string): CronFields | null {
    const raw = expr.trim().split(/\s+/);
    // A six-field expression carries seconds first; the console shows minutes.
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

    return {
        minute, hour, dom, month, dow,
        domRestricted: parts[2].trim() !== '*',
        dowRestricted: parts[4].trim() !== '*',
    };
}

function dayMatches(f: CronFields, day: Date): boolean {
    if (!f.month.has(day.getMonth() + 1)) return false;
    const domHit = f.dom.has(day.getDate());
    const dowHit = f.dow.has(day.getDay());
    if (f.domRestricted && f.dowRestricted) return domHit || dowHit;
    if (f.domRestricted) return domHit;
    if (f.dowRestricted) return dowHit;
    return true;
}

/** First firing strictly after `from`, or null if nothing fires within a year. */
function nextCronRun(expr: string, from: Date): Date | null {
    const f = parseCron(expr);
    if (!f) return null;

    const cursor = new Date(from.getTime());
    cursor.setSeconds(0, 0);
    cursor.setMinutes(cursor.getMinutes() + 1);

    for (let offset = 0; offset < 400; offset++) {
        const day = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + offset);
        if (!dayMatches(f, day)) continue;
        const startHour = offset === 0 ? cursor.getHours() : 0;
        for (let h = startHour; h < 24; h++) {
            if (!f.hour.has(h)) continue;
            const startMin = offset === 0 && h === cursor.getHours() ? cursor.getMinutes() : 0;
            for (let m = startMin; m < 60; m++) {
                if (!f.minute.has(m)) continue;
                return new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m, 0, 0);
            }
        }
    }
    return null;
}

/**
 * The same instant, re-expressed as the wall clock in `tz`, as a local Date.
 *
 * A cron expression is written in the AGENT's timezone, so the search has to
 * run in that frame — otherwise an operator in another zone is shown a firing
 * time that is simply wrong. Both "now" and the result live in that wall-clock
 * frame, which keeps the countdown correct too. (DST transitions can shift the
 * result by an hour; the deployment timezone, Asia/Kolkata, has none.)
 */
function wallClockIn(tz: string | undefined, at: Date): Date {
    if (!tz) return at;
    try {
        const parts = new Intl.DateTimeFormat('en-US', {
            timeZone: tz, hour12: false,
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', second: '2-digit',
        }).formatToParts(at);
        const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
        const hour = get('hour') === 24 ? 0 : get('hour');
        const d = new Date(get('year'), get('month') - 1, get('day'), hour, get('minute'), get('second'));
        return Number.isNaN(d.getTime()) ? at : d;
    } catch {
        return at; // Unknown IANA zone — fall back to the viewer's clock.
    }
}

function describeNextRun(runtime: AgentRuntimeConfig | null): string | null {
    const cron = runtime?.schedule_cron?.trim();
    if (!cron) return null;
    const tz = runtime?.timezone;
    const now = wallClockIn(tz, new Date());
    const next = nextCronRun(cron, now);
    if (!next) return `Scheduled: ${cron}`;

    const when = next.toLocaleString([], {
        weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
    });
    const deltaMin = Math.max(0, Math.round((next.getTime() - now.getTime()) / 60_000));
    const inText = deltaMin < 60
        ? `in ${deltaMin}m`
        : deltaMin < 1440
            ? `in ${Math.floor(deltaMin / 60)}h`
            : `in ${Math.floor(deltaMin / 1440)}d`;
    return `Next run ${when} ${inText}${tz ? ` (${tz})` : ''}`;
}

/* ==========================================================================
 * Component
 * ======================================================================== */

export default function AgentActivity({ orgId, agentKey }: AgentActivityProps) {
    const [range, setRange] = useState<RangeKey>('today');
    const [moduleFilter, setModuleFilter] = useState<string>('all');

    const [runs, setRuns] = useState<RunRow[]>([]);
    /**
     * null means UNKNOWN, and only that. /api/agents/runs answers 200 with real
     * `runs` but `totals: null` + `totals_error` when the aggregate query alone
     * fails, precisely so this header cannot print "0 runs / 0 tokens / ₹0.00"
     * above a page of real executions. Spreading the payload over EMPTY_TOTALS
     * used to re-manufacture exactly those zeros on the client. Every tile below
     * renders "—" while this is null.
     */
    const [totals, setTotals] = useState<Totals | null>(EMPTY_TOTALS);
    const [totalsError, setTotalsError] = useState<string | null>(null);
    const [provisioned, setProvisioned] = useState(true);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [runtime, setRuntime] = useState<AgentRuntimeConfig | null>(null);
    const [displayName, setDisplayName] = useState<string | null>(null);
    const [selectedRunId, setSelectedRunId] = useState<string | null>(null);

    /**
     * Module options survive a filtered fetch. Filtering by module narrows the
     * response to that module, so recomputing options from the response would
     * collapse the dropdown to the option already chosen — and strand the
     * operator there. Options refresh only on an unfiltered read.
     */
    const [moduleOptions, setModuleOptions] = useState<string[]>([]);
    const seenModules = useRef<Set<string>>(new Set());

    const load = useCallback(async (quiet: boolean) => {
        if (!orgId || !agentKey) return;
        if (quiet) setRefreshing(true); else setLoading(true);
        try {
            const params = new URLSearchParams({
                orgId,
                agentKey,
                from: rangeStart(range).toISOString(),
                limit: String(PAGE_SIZE),
            });
            const unfiltered = moduleFilter === 'all';
            if (!unfiltered) params.set('module', moduleFilter);

            const res = await fetch(`/api/agents/runs?${params.toString()}`, { cache: 'no-store' });
            const json = await res.json().catch(() => ({}));

            if (!res.ok) {
                setError(typeof json?.error === 'string' ? json.error : `Could not load runs (${res.status})`);
                return;
            }

            setError(null);
            setProvisioned(json?.provisioned !== false);
            const rows: RunRow[] = Array.isArray(json?.runs) ? json.runs : [];
            setRuns(rows);
            // `totals: null` is the API saying it does not know — not that the answer
            // is zero. Keep it null and let the tiles say so.
            const rawTotals = json?.totals;
            setTotals(rawTotals ? { ...EMPTY_TOTALS, ...rawTotals } : null);
            setTotalsError(
                rawTotals
                    ? null
                    : (typeof json?.totals_error?.reason === 'string'
                        ? json.totals_error.reason
                        : 'The totals query failed, so runs, tokens, cost and success rate are unknown for this window. The rows below are real.'),
            );

            if (unfiltered) {
                for (const r of rows) if (r.module) seenModules.current.add(r.module);
                setModuleOptions([...seenModules.current].sort());
            }
        } catch (e) {
            setError((e as Error).message || 'Network error');
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, [orgId, agentKey, range, moduleFilter]);

    useEffect(() => { void load(false); }, [load]);

    /* The schedule, read once — it is what turns an empty table into an
       explanation. Best-effort: an agent with no profile row still gets a table. */
    useEffect(() => {
        if (!orgId || !agentKey) return;
        let cancelled = false;
        (async () => {
            try {
                const res = await fetch(
                    `/api/agents/profile?orgId=${encodeURIComponent(orgId)}&agentKey=${encodeURIComponent(agentKey)}`,
                    { cache: 'no-store' },
                );
                if (!res.ok) return;
                const json = await res.json().catch(() => ({}));
                if (cancelled) return;
                const agent = json?.agent ?? (Array.isArray(json?.agents) ? json.agents[0] : null);
                if (agent) {
                    setRuntime((agent.runtime ?? null) as AgentRuntimeConfig | null);
                    if (typeof agent.display_name === 'string') setDisplayName(agent.display_name);
                }
            } catch {
                /* The schedule is a nicety; its absence must never break the table. */
            }
        })();
        return () => { cancelled = true; };
    }, [orgId, agentKey]);

    /* A run in flight means the table is out of date the moment it renders. */
    useEffect(() => {
        // Unknown totals (null) also mean "no known in-flight run" — poll on the
        // rows instead so a failed aggregate does not start a permanent timer.
        const inFlight = totals?.running ?? runs.filter((r) => r.status === 'running').length;
        if (inFlight <= 0) return;
        const timer = setInterval(() => { void load(true); }, LIVE_REFRESH_MS);
        return () => clearInterval(timer);
    }, [totals?.running, runs, load]);

    const suffix = RANGES.find((r) => r.key === range)?.suffix ?? '';
    // Computed per render, not memoised: a cached "in 4h" would still say "in 4h"
    // an hour later. The search is a bounded loop over at most a year of days.
    const nextRunText = describeNextRun(runtime);
    // Every derived number is only defined when the totals themselves are. `null`
    // propagates to "—"; it must never collapse into 0.
    const settled = totals ? totals.succeeded + totals.failed + totals.timeout : null;
    const tokensTotal = totals ? totals.tokens_in + totals.tokens_out : null;
    const avgCost = totals && totals.runs > 0 ? totals.cost_inr / totals.runs : null;
    const running = totals?.running ?? 0;
    const title = displayName || runs[0]?.agent_name || agentKey;

    return (
        <section className="rounded-[20px] border border-border bg-card overflow-hidden">
            {/* -----------------------------------------------------------------
                HEADER
            ----------------------------------------------------------------- */}
            <div className="px-5 pt-4 pb-3 flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                    <h2 className="text-[15px] font-semibold text-text-primary truncate">Activity</h2>
                    <p className="mt-0.5 text-xs text-text-tertiary truncate">
                        {title}
                        {running > 0 && (
                            <span className="ml-2 inline-flex items-center gap-1.5 text-primary">
                                <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                                {running} running
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

            {/* -----------------------------------------------------------------
                FOUR TILES — health before detail. Computed by the API over the
                whole filtered window, not over the rows on screen.
            ----------------------------------------------------------------- */}
            <div className="px-5 grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                <Tile
                    label={`Runs ${suffix === 'today' ? 'today' : suffix}`}
                    value={totals ? String(totals.runs) : '—'}
                    sub={
                        !totals ? 'not counted'
                            : totals.failed > 0 ? `${totals.failed} failed`
                                : totals.running > 0 ? `${totals.running} in flight`
                                    : totals.runs > 0 ? 'all clear' : '—'
                    }
                    tone={totals && totals.failed > 0 ? 'bad' : 'plain'}
                />
                <Tile
                    label="Success rate"
                    value={totals?.success_rate == null ? '—' : `${totals.success_rate}%`}
                    sub={
                        !totals ? 'not counted'
                            : settled && settled > 0 ? `${totals.succeeded} of ${settled} settled`
                                : 'nothing settled yet'
                    }
                    tone={
                        totals?.success_rate == null ? 'plain'
                            : totals.success_rate >= 95 ? 'good'
                                : totals.success_rate >= 80 ? 'warn' : 'bad'
                    }
                />
                <Tile
                    label="Tokens"
                    value={tokensTotal === null ? '—' : fmtTokens(tokensTotal)}
                    sub={
                        totals
                            ? `${fmtTokens(totals.tokens_in)} in → ${fmtTokens(totals.tokens_out)} out`
                            : 'not counted'
                    }
                />
                <Tile
                    label="Cost"
                    value={totals ? fmtCost(totals.cost_inr, totals.cost_usd) : '—'}
                    sub={avgCost !== null && avgCost > 0 ? `${fmtCost(avgCost, null)} avg / run` : '—'}
                />
            </div>

            {/* Four dashes with no explanation read as "nothing happened". Say which
                query failed, and that the rows below are still real. */}
            {totalsError && (
                <p className="mx-5 mt-2.5 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2
                              text-[11px] leading-relaxed text-amber-700">
                    {totalsError}
                </p>
            )}

            {/* -----------------------------------------------------------------
                CONTROLS — the two things that change the question being asked.
            ----------------------------------------------------------------- */}
            <div className="px-5 pt-4 pb-3 flex items-center justify-between gap-3 flex-wrap">
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

                <label className="inline-flex items-center gap-2 text-xs text-text-tertiary">
                    <span className="sr-only">Filter by module</span>
                    <select
                        value={moduleFilter}
                        onChange={(e) => setModuleFilter(e.target.value)}
                        className="px-2.5 py-1.5 rounded-xl border border-border bg-card text-xs text-text-primary
                                   focus:outline-none focus:ring-2 focus:ring-primary/25"
                    >
                        <option value="all">All modules</option>
                        {moduleOptions.map((m) => (
                            <option key={m} value={m}>{moduleLabel(m)}</option>
                        ))}
                    </select>
                </label>
            </div>

            {/* -----------------------------------------------------------------
                THE TABLE
            ----------------------------------------------------------------- */}
            {!provisioned ? (
                <div className="px-5 pb-5">
                    <div className="rounded-2xl border border-border bg-muted/50 p-6 text-center">
                        <Database className="w-5 h-5 mx-auto text-text-tertiary" />
                        <p className="mt-2 text-sm font-medium text-text-primary">Not provisioned yet</p>
                        <p className="mt-1 text-xs text-text-secondary">
                            Run migration <span className="font-mono">{AGENT_RUNTIME_MIGRATION}</span> to start
                            recording what this agent does.
                        </p>
                    </div>
                </div>
            ) : error ? (
                <div className="px-5 pb-5">
                    <div className="rounded-2xl border border-border bg-muted/50 p-5 flex items-start gap-3">
                        <AlertCircle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
                        <div>
                            <p className="text-sm font-medium text-text-primary">Could not load activity</p>
                            <p className="mt-0.5 text-xs text-text-secondary">{error}</p>
                        </div>
                    </div>
                </div>
            ) : loading ? (
                <div className="px-5 pb-8 pt-4 flex items-center justify-center gap-2 text-sm text-text-tertiary">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Loading runs…
                </div>
            ) : runs.length === 0 ? (
                <EmptyState range={range} nextRunText={nextRunText} filtered={moduleFilter !== 'all'} />
            ) : (
                <div className="overflow-x-auto border-t border-border">
                    <table className="w-full text-sm border-collapse">
                        <thead>
                            <tr className="text-left text-[11px] uppercase tracking-wide text-text-tertiary">
                                <th scope="col" className="font-medium px-5 py-2.5 whitespace-nowrap">Time</th>
                                <th scope="col" className="font-medium px-3 py-2.5 whitespace-nowrap">Module</th>
                                <th scope="col" className="font-medium px-3 py-2.5">What it did</th>
                                <th scope="col" className="font-medium px-3 py-2.5 whitespace-nowrap">Status</th>
                                <th scope="col" className="font-medium px-3 py-2.5 text-right whitespace-nowrap">Duration</th>
                                <th scope="col" className="font-medium px-3 py-2.5 text-right whitespace-nowrap">Tokens</th>
                                <th scope="col" className="font-medium px-5 py-2.5 text-right whitespace-nowrap">Cost</th>
                            </tr>
                        </thead>
                        <tbody>
                            {runs.map((run) => {
                                const when = fmtWhen(run.started_at);
                                const pill = STATUS_PILL[run.status] ?? STATUS_PILL.skipped;
                                // A failed run's error IS what it did; falling back to it keeps
                                // the most important rows from being the blankest ones.
                                const what = run.outcome_summary || run.error || '—';
                                return (
                                    <tr
                                        key={run.id}
                                        tabIndex={0}
                                        role="button"
                                        aria-label={`Open trace for run at ${when.clock}`}
                                        onClick={() => setSelectedRunId(run.id)}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter' || e.key === ' ') {
                                                e.preventDefault();
                                                setSelectedRunId(run.id);
                                            }
                                        }}
                                        className="border-t border-border cursor-pointer hover:bg-muted/60
                                                   focus:outline-none focus:bg-muted/60 transition-colors"
                                    >
                                        <td className="px-5 py-2.5 whitespace-nowrap align-top">
                                            <span className="font-mono text-[13px] text-text-primary">{when.clock}</span>
                                            <span className="text-text-tertiary text-xs"> · {when.ago}</span>
                                        </td>
                                        <td className="px-3 py-2.5 whitespace-nowrap align-top text-[13px] text-text-secondary">
                                            {moduleLabel(run.module)}
                                        </td>
                                        <td className="px-3 py-2.5 align-top w-full max-w-0">
                                            <div
                                                className={`truncate text-[13px] ${
                                                    run.outcome_summary ? 'text-text-primary' : 'text-text-tertiary'
                                                }`}
                                                title={what}
                                            >
                                                {what}
                                            </div>
                                        </td>
                                        <td className="px-3 py-2.5 whitespace-nowrap align-top">
                                            <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full
                                                              border text-[11px] font-medium ${pill.className}`}>
                                                {run.status === 'running' && (
                                                    <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                                                )}
                                                {pill.label}
                                            </span>
                                        </td>
                                        <td className="px-3 py-2.5 text-right whitespace-nowrap align-top
                                                       font-mono text-[13px] text-text-secondary">
                                            {run.status === 'running' ? '…' : fmtDuration(run.duration_ms)}
                                        </td>
                                        <td className="px-3 py-2.5 text-right whitespace-nowrap align-top
                                                       font-mono text-[13px] text-text-secondary">
                                            {run.tokens_in === null && run.tokens_out === null
                                                ? '—'
                                                : `${fmtTokens(run.tokens_in)}→${fmtTokens(run.tokens_out)}`}
                                        </td>
                                        <td className="px-5 py-2.5 text-right whitespace-nowrap align-top
                                                       font-mono text-[13px] text-text-secondary">
                                            {fmtCost(run.cost_inr, run.cost_usd)}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>

                    {runs.length >= PAGE_SIZE && (
                        <p className="px-5 py-2.5 text-[11px] text-text-tertiary border-t border-border">
                            Showing the {PAGE_SIZE} most recent runs. Narrow the range or the module to see further back.
                        </p>
                    )}
                </div>
            )}

            {/* The row is the index; the trace is the detail. */}
            <AgentRunTrace
                orgId={orgId}
                agentKey={agentKey}
                runId={selectedRunId}
                onClose={() => setSelectedRunId(null)}
            />
        </section>
    );
}

/* ==========================================================================
 * Pieces
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
            <p className="text-[11px] text-text-tertiary truncate">{label}</p>
            <p className={`mt-1 text-[19px] font-semibold leading-none ${valueTone}`}>{value}</p>
            {sub && <p className="mt-1.5 text-[11px] text-text-tertiary truncate" title={sub}>{sub}</p>}
        </div>
    );
}

/**
 * An empty table is where a console either reassures or looks abandoned. It
 * says what is missing, and — when a schedule exists — when that will change.
 */
function EmptyState({
    range, nextRunText, filtered,
}: {
    range: RangeKey;
    nextRunText: string | null;
    filtered: boolean;
}) {
    const headline = filtered
        ? 'No runs in this module'
        : range === 'today'
            ? 'No runs yet today'
            : `No runs in the last ${range === '7d' ? '7' : '30'} days`;

    return (
        <div className="px-5 pb-6 pt-2 border-t border-border">
            <div className="rounded-2xl bg-card-tint border border-border px-5 py-8 text-center">
                <span className="inline-grid place-items-center w-10 h-10 rounded-full bg-muted">
                    <Inbox className="w-4 h-4 text-text-tertiary" />
                </span>
                <p className="mt-3 text-sm font-medium text-text-primary">{headline}</p>
                {nextRunText ? (
                    <p className="mt-1.5 inline-flex items-center gap-1.5 text-xs text-text-secondary">
                        <Clock className="w-3.5 h-3.5 text-primary" />
                        {nextRunText}
                    </p>
                ) : (
                    <p className="mt-1.5 text-xs text-text-tertiary">
                        {filtered
                            ? 'Try another module or a wider range.'
                            : 'No schedule set — this agent runs on demand.'}
                    </p>
                )}
            </div>
        </div>
    );
}
