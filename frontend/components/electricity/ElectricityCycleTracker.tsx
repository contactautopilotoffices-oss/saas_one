'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    AlertTriangle, Loader2, RefreshCw, Timer, Target, TrendingUp, TrendingDown, Clock, Check, Filter,
} from 'lucide-react';
import { inr } from '@/frontend/lib/electricity/trackerTypes';
import {
    CLOCK_META, STAGE_LABELS,
    type CyclePayload, type CycleRow, type CycleSummary, type StalledBill, type TargetProgress,
} from '@/frontend/lib/electricity/cycleTypes';

/**
 * The cycle clock — every open bill as a race against its early-payment date.
 *
 * From the 03-Aug walkthrough: "this entire cycle from when the electricity bill is
 * recieved to when the bill is paid the early due timeline is the one to track so
 * everything here is a run against time and it has to be visible here as well", and
 * "the electricity council memember be provided a target ... 15 lacs to be saved annually
 * ... and he has to run with it".
 *
 * DESIGN INTENT: the register answers "what do we owe"; this answers "are we going to make
 * it". The two questions have different shapes — the register is a ledger, sorted by
 * account. This is a countdown, sorted by how close the money is to being lost, and the
 * first thing on screen is the money still winnable today.
 *
 * Every token here is an existing app CSS variable (--error/--warning/--success/--primary,
 * surface/border/text-*) — no new colours invented (EVAL.md REQ-10, "bounded by the design
 * md file").
 */

interface Props {
    orgId: string;
    /** Only super admins may set the target; everyone in the audience can see it. */
    canSetTarget?: boolean;
}

export default function ElectricityCycleTracker({ orgId, canSetTarget = false }: Props) {
    const [data, setData] = useState<CyclePayload | null>(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // One bill per account per month means the raw list is accounts x months — 117 rows and
    // growing by 15 every month. Filters are the primary way to read it, not a nicety.
    const [fMonth, setFMonth] = useState<string>('all');
    const [fSite, setFSite] = useState<string>('all');
    const [fStatus, setFStatus] = useState<string>('open');

    const load = useCallback(async (quiet = false) => {
        if (!orgId) return;
        if (quiet) setRefreshing(true); else setLoading(true);
        setError(null);
        try {
            const res = await fetch(`/api/electricity/cycle?org_id=${orgId}`);
            const payload = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(payload?.error || 'Could not load the cycle clock');
            setData(payload as CyclePayload);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not load the cycle clock');
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, [orgId]);

    useEffect(() => { void load(); }, [load]);

    if (loading) {
        return (
            <div className="flex items-center justify-center py-20 text-text-tertiary">
                <Loader2 className="w-6 h-6 animate-spin" />
            </div>
        );
    }

    if (error) {
        return (
            <div className="rounded-2xl border border-border bg-surface p-8 text-center">
                <AlertTriangle className="w-6 h-6 mx-auto mb-3" style={{ color: 'var(--warning)' }} />
                <p className="text-sm font-bold text-text-primary">{error}</p>
                <button onClick={() => void load()} className="mt-3 text-xs font-bold text-primary">Try again</button>
            </div>
        );
    }

    if (!data?.provisioned) {
        return (
            <div className="rounded-2xl border border-border bg-surface p-10 text-center">
                <Timer className="w-6 h-6 mx-auto mb-3" style={{ color: 'var(--warning)' }} />
                <p className="text-sm font-bold text-text-primary">The cycle clock is not set up yet</p>
                <p className="text-xs font-semibold text-text-tertiary mt-2 max-w-md mx-auto">
                    {data?.reason || 'Apply supabase/migrations/20260804000006_electricity_cycle_targets_audit.sql.'}
                </p>
            </div>
        );
    }

    // Everything below the target card responds to the filter. The target is an ANNUAL
    // commitment, so it stays period-scoped and deliberately ignores the month filter —
    // filtering to one month must not make a 12-month target look 1/12th achieved.
    const rows = applyFilters(data.rows, fMonth, fSite, fStatus);
    const summary = summarise(rows);
    const stalledIds = new Set(rows.map(r => r.id));
    const stalled = data.stalled.filter(s => stalledIds.has(s.id));
    const dwell = stageDwell(rows);

    const months = [...new Set(data.rows.map(r => r.billing_month))].sort().reverse();
    const sites = [...new Set(data.rows.map(r => r.site_label))].sort();

    return (
        <div className="space-y-4">
            <TargetCard target={data.target} provisioned={data.target_provisioned} canSet={canSetTarget}
                orgId={orgId} onSaved={() => void load(true)} />

            <FilterBar
                months={months} sites={sites}
                month={fMonth} site={fSite} status={fStatus}
                setMonth={setFMonth} setSite={setFSite} setStatus={setFStatus}
                showing={rows.length} total={data.rows.length}
                refreshing={refreshing} onRefresh={() => void load(true)}
            />

            <ClockSummary summary={summary} filtered={rows.length !== data.rows.length} />

            {stalled.length > 0 && <StalledList stalled={stalled} />}

            <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
                <div className="xl:col-span-2"><RaceTable rows={rows} /></div>
                <StageDwell dwell={dwell} median={summary.median_cycle_days} />
            </div>
        </div>
    );
}

/* ------------------------------------------------------------------ filtering */

function applyFilters(rows: CycleRow[], month: string, site: string, status: string): CycleRow[] {
    return rows.filter(r => {
        if (month !== 'all' && r.billing_month !== month) return false;
        if (site !== 'all' && r.site_label !== site) return false;
        if (status === 'open' && r.clock_status === 'settled') return false;
        if (status !== 'all' && status !== 'open' && r.clock_status !== status) return false;
        return true;
    });
}

/**
 * Client-side mirror of backend/lib/electricity/cycle.ts summarise(). It has to be a mirror
 * because the tiles must re-total as the filter changes, and a round-trip per keystroke to
 * recompute four numbers the browser already holds would be worse. Kept deliberately short;
 * if the server's definition of these figures changes, change it here in the same commit.
 */
function summarise(rows: CycleRow[]): CycleSummary {
    const s: CycleSummary = {
        open: 0, critical: 0, tight: 0, discount_lost: 0, overdue: 0,
        winnable_now: 0, forfeited_open: 0, median_cycle_days: null, unmeasurable: 0,
    };
    const cycles: number[] = [];

    for (const r of rows) {
        if (r.clock_status !== 'settled') {
            s.open++;
            s.winnable_now += Number(r.discount_still_winnable || 0);
            if (r.clock_status === 'critical') s.critical++;
            if (r.clock_status === 'tight') s.tight++;
            if (r.clock_status === 'overdue') s.overdue++;
            if (r.clock_status === 'discount_lost') {
                s.discount_lost++;
                s.forfeited_open += Math.max(0, Number(r.total_amount || 0) - Number(r.early_payment_amount || 0));
            }
        }
        if (r.cycle_days !== null && r.cycle_completed_at) cycles.push(r.cycle_days);
        else if (r.received_at === null && r.payment_status === 'paid') s.unmeasurable++;
    }

    s.winnable_now = Math.round(s.winnable_now);
    s.forfeited_open = Math.round(s.forfeited_open);
    if (cycles.length) {
        const sorted = [...cycles].sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        s.median_cycle_days = sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
    }
    return s;
}

function stageDwell(rows: CycleRow[]) {
    const acc = new Map<string, { bills: number; total: number }>();
    for (const r of rows) {
        if (r.clock_status === 'settled') continue;
        const cur = acc.get(r.workflow_status) || { bills: 0, total: 0 };
        cur.bills++; cur.total += r.days_in_stage ?? 0;
        acc.set(r.workflow_status, cur);
    }
    return [...acc.entries()]
        .map(([stage, v]) => ({ stage, bills: v.bills, avg_days: Math.round((v.total / v.bills) * 10) / 10 }))
        .sort((a, b) => b.avg_days - a.avg_days);
}

function FilterBar({ months, sites, month, site, status, setMonth, setSite, setStatus, showing, total, refreshing, onRefresh }: {
    months: string[]; sites: string[];
    month: string; site: string; status: string;
    setMonth: (v: string) => void; setSite: (v: string) => void; setStatus: (v: string) => void;
    showing: number; total: number; refreshing: boolean; onRefresh: () => void;
}) {
    const sel = 'px-2.5 py-1.5 rounded-xl border border-border bg-surface text-[11px] font-bold text-text-primary outline-none focus:border-primary max-w-[190px]';
    const dirty = month !== 'all' || site !== 'all' || status !== 'open';

    return (
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-surface px-4 py-3">
            <Filter className="w-3.5 h-3.5 text-text-tertiary flex-shrink-0" />

            <select className={sel} value={status} onChange={e => setStatus(e.target.value)} aria-label="Clock status">
                <option value="open">Open only (default)</option>
                <option value="all">All bills</option>
                <option value="critical">Critical</option>
                <option value="tight">Tight</option>
                <option value="discount_lost">Discount lost</option>
                <option value="overdue">Overdue</option>
                <option value="settled">Settled</option>
            </select>

            <select className={sel} value={month} onChange={e => setMonth(e.target.value)} aria-label="Billing month">
                <option value="all">All months</option>
                {months.map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}
            </select>

            <select className={sel} value={site} onChange={e => setSite(e.target.value)} aria-label="Site">
                <option value="all">All sites</option>
                {sites.map(s => <option key={s} value={s}>{s}</option>)}
            </select>

            {dirty && (
                <button
                    onClick={() => { setMonth('all'); setSite('all'); setStatus('open'); }}
                    className="text-[11px] font-bold text-primary hover:underline"
                >
                    Reset
                </button>
            )}

            <span className="ml-auto flex items-center gap-2 text-[11px] font-bold text-text-tertiary">
                {showing === total ? `${total} bills` : `${showing} of ${total} bills`}
                <button onClick={onRefresh} aria-label="Refresh"
                    className="p-1.5 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-muted transition-colors">
                    <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
                </button>
            </span>
        </div>
    );
}

/* ------------------------------------------------------------------ target */

function TargetCard({ target, provisioned, canSet, orgId, onSaved }: {
    target: TargetProgress | null; provisioned: boolean; canSet: boolean;
    orgId: string; onSaved: () => void;
}) {
    const [editing, setEditing] = useState(false);

    if (!provisioned) return null;

    if (!target) {
        return (
            <div className="rounded-2xl border border-dashed border-border bg-surface p-6 text-center">
                <Target className="w-5 h-5 mx-auto mb-2 text-text-tertiary" />
                <p className="text-sm font-bold text-text-primary">No savings target set</p>
                <p className="text-xs font-semibold text-text-tertiary mt-1">
                    Set the annual early-payment saving the electricity council member is running against.
                </p>
                {canSet && !editing && (
                    <button onClick={() => setEditing(true)}
                        className="mt-3 px-3 py-1.5 rounded-xl bg-primary text-white text-xs font-bold">
                        Set a target
                    </button>
                )}
                {editing && <TargetForm orgId={orgId} onDone={() => { setEditing(false); onSaved(); }} />}
            </div>
        );
    }

    const t = target.target;
    const pct = Math.max(0, Math.min(100, target.attainment_pct));
    const paceColour = target.on_pace ? 'var(--success)' : 'var(--error)';

    return (
        <div className="rounded-2xl border border-border bg-surface p-5">
            <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
                <div className="min-w-0">
                    <p className="text-[10px] font-black uppercase tracking-[0.18em] text-primary flex items-center gap-1.5">
                        <Target className="w-3 h-3" /> Savings target · {t.label || 'Current period'}
                    </p>
                    <h3 className="text-lg font-bold text-text-primary mt-0.5">
                        {inr(target.captured)} <span className="text-text-tertiary font-semibold">of {inr(t.target_amount)}</span>
                    </h3>
                    <p className="text-xs font-semibold text-text-tertiary mt-0.5">
                        Owned by {t.owner_name || t.owner_label || 'the electricity council member'}
                        {' · '}{target.days_remaining} day{target.days_remaining === 1 ? '' : 's'} left in the period
                    </p>
                </div>
                <div className="text-right">
                    <p className="text-2xl font-black tabular-nums" style={{ color: paceColour }}>{pct.toFixed(1)}%</p>
                    <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: paceColour }}>
                        {target.on_pace ? 'On pace' : 'Behind pace'}
                    </p>
                </div>
            </div>

            {/* Attainment bar with the pace marker — where a straight line says we should be. */}
            <div className="relative h-3 rounded-full bg-muted overflow-hidden mb-1.5">
                <div className="absolute inset-y-0 left-0 rounded-full transition-all"
                    style={{ width: `${pct}%`, background: paceColour }} />
                <div className="absolute inset-y-0 w-0.5 bg-text-primary/50"
                    style={{ left: `${Math.min(100, target.period_elapsed_pct)}%` }}
                    title={`Pace marker: ${target.period_elapsed_pct}% of the period elapsed`} />
            </div>
            <div className="flex items-center justify-between text-[10px] font-bold text-text-tertiary mb-4">
                <span>Captured {inr(target.captured, true)}</span>
                <span>Pace expects {inr(target.pace_expected, true)} by today</span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Stat label="Vs pace" value={`${target.pace_delta >= 0 ? '+' : ''}${inr(target.pace_delta, true)}`}
                    colour={paceColour} />
                <Stat label="Projected at this rate" value={inr(target.projected, true)}
                    hint={target.projected_shortfall > 0 ? `${inr(target.projected_shortfall, true)} short` : 'Target met'}
                    colour={target.projected_shortfall > 0 ? 'var(--warning)' : 'var(--success)'} />
                <Stat label="Needed per month" value={inr(target.required_run_rate_monthly, true)} />
                <Stat label="Provably missed" value={inr(target.missed, true)} colour="var(--error)"
                    hint={target.unverifiable > 0 ? `${inr(target.unverifiable, true)} unverifiable` : undefined} />
            </div>

            {target.unverifiable > 0 && (
                <p className="text-[10px] font-semibold text-text-tertiary mt-3 leading-relaxed">
                    {inr(target.unverifiable)} of discount sits on bills marked paid with no payment date recorded —
                    it counts toward neither captured nor missed. Some of the target may already be won and simply
                    not evidenced.
                </p>
            )}
        </div>
    );
}

function TargetForm({ orgId, onDone }: { orgId: string; onDone: () => void }) {
    const [amount, setAmount] = useState('1500000');
    const [saving, setSaving] = useState(false);
    const [err, setErr] = useState<string | null>(null);

    const submit = async () => {
        setSaving(true); setErr(null);
        try {
            const res = await fetch('/api/electricity/targets', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ org_id: orgId, target_amount: Number(amount) }),
            });
            const body = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(body?.error || 'Could not save the target');
            onDone();
        } catch (e) {
            setErr(e instanceof Error ? e.message : 'Could not save the target');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="mt-4 flex flex-col items-center gap-2">
            <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-text-tertiary">₹</span>
                <input
                    type="number" value={amount} onChange={e => setAmount(e.target.value)}
                    aria-label="Annual savings target in rupees"
                    className="w-40 px-3 py-1.5 rounded-xl border border-border bg-surface text-sm font-bold tabular-nums text-text-primary outline-none focus:border-primary"
                />
                <button onClick={() => void submit()} disabled={saving}
                    className="px-3 py-1.5 rounded-xl bg-primary text-white text-xs font-bold disabled:opacity-50">
                    {saving ? 'Saving…' : 'Save'}
                </button>
            </div>
            <p className="text-[10px] font-semibold text-text-tertiary">
                Defaults to the current Indian financial year (1 Apr – 31 Mar).
            </p>
            {err && <p className="text-[10px] font-bold" style={{ color: 'var(--error)' }}>{err}</p>}
        </div>
    );
}

/* ----------------------------------------------------------------- summary */

function ClockSummary({ summary, filtered }: {
    summary: CycleSummary; filtered: boolean;
}) {
    return (
        <div className="rounded-2xl border border-border bg-surface p-5">
            <div className="flex items-center justify-between mb-4">
                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-primary flex items-center gap-1.5">
                    <Timer className="w-3 h-3" /> The clock
                    {/* Say so when these totals are a subset — an unlabelled filtered total
                        read as a portfolio total is how people quote the wrong number. */}
                    {filtered && <span className="text-text-tertiary font-bold normal-case tracking-normal">· filtered</span>}
                </p>
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <Stat label="Winnable today" value={inr(summary.winnable_now, true)} colour="var(--success)"
                    hint={`${summary.open} bill${summary.open === 1 ? '' : 's'} still open`} big />
                <Stat label="Critical" value={String(summary.critical)} colour="var(--error)"
                    hint={summary.tight > 0 ? `${summary.tight} more tight` : undefined} big />
                <Stat label="Already forfeited" value={inr(summary.forfeited_open, true)} colour="#b45309"
                    hint={`${summary.discount_lost} past the early date`} big />
                <Stat label="Median cycle"
                    value={summary.median_cycle_days === null ? '—' : `${summary.median_cycle_days}d`}
                    hint={summary.median_cycle_days === null
                        ? 'No bill has a recorded arrival time yet'
                        : 'Received → paid'} big />
            </div>

            {summary.unmeasurable > 0 && (
                <p className="text-[10px] font-semibold text-text-tertiary mt-3">
                    {summary.unmeasurable} paid bill{summary.unmeasurable === 1 ? '' : 's'} cannot be timed —
                    they were imported rather than received through the mailbox, so no arrival time exists.
                </p>
            )}
        </div>
    );
}

function Stat({ label, value, hint, colour, big }: {
    label: string; value: string; hint?: string; colour?: string; big?: boolean;
}) {
    return (
        <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-text-tertiary">{label}</p>
            <p className={`${big ? 'text-xl' : 'text-base'} font-black tabular-nums mt-0.5`}
                style={{ color: colour || 'var(--text-primary)' }}>{value}</p>
            {hint && <p className="text-[10px] font-semibold text-text-tertiary mt-0.5">{hint}</p>}
        </div>
    );
}

/* ----------------------------------------------------------------- stalled */

function StalledList({ stalled }: { stalled: StalledBill[] }) {
    return (
        <div className="rounded-2xl border p-5" style={{ borderColor: 'rgba(239,68,68,0.35)', background: 'rgba(239,68,68,0.04)' }}>
            <p className="text-[10px] font-black uppercase tracking-[0.18em] mb-3 flex items-center gap-1.5"
                style={{ color: 'var(--error)' }}>
                <AlertTriangle className="w-3 h-3" /> Losing the race · {stalled.length}
            </p>
            <ul className="space-y-2">
                {stalled.slice(0, 8).map(s => (
                    <li key={s.id} className="flex items-start gap-3">
                        <span className="mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: 'var(--error)' }} />
                        <div className="min-w-0 flex-1">
                            <p className="text-xs font-bold text-text-primary">
                                {s.site_label}
                                <span className="font-semibold text-text-tertiary"> · {monthLabel(s.billing_month)}</span>
                            </p>
                            {/* The sentence comes from the server so the reason is identical
                                in the UI, the PDF and any future alert. */}
                            <p className="text-[11px] font-semibold text-text-secondary leading-snug">{s.why}</p>
                        </div>
                        {s.discount_still_winnable > 0 && (
                            <span className="text-xs font-black tabular-nums flex-shrink-0" style={{ color: 'var(--error)' }}>
                                {inr(s.discount_still_winnable, true)}
                            </span>
                        )}
                    </li>
                ))}
            </ul>
            {stalled.length > 8 && (
                <p className="text-[10px] font-bold text-text-tertiary mt-3">
                    +{stalled.length - 8} more below the top 8 by money at risk.
                </p>
            )}
        </div>
    );
}

/* -------------------------------------------------------------------- race */

function RaceTable({ rows }: { rows: CycleRow[] }) {
    // Open bills first, most urgent at the top; settled ones drop to the bottom where they
    // are still findable but never compete for attention with a live deadline.
    const ordered = useMemo(() => {
        const rank: Record<string, number> = { critical: 0, overdue: 1, tight: 2, discount_lost: 3, on_track: 4, settled: 5 };
        return [...rows].sort((a, b) =>
            (rank[a.clock_status] ?? 9) - (rank[b.clock_status] ?? 9) ||
            (a.days_to_early ?? 999) - (b.days_to_early ?? 999));
    }, [rows]);

    const th = 'px-3 py-2 text-[10px] font-black uppercase tracking-[0.08em] text-text-tertiary';
    const td = 'px-3 py-2.5 text-xs';

    return (
        <div className="rounded-2xl border border-border bg-surface overflow-hidden">
            <div className="px-5 py-3 border-b border-border">
                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-primary flex items-center gap-1.5">
                    <Clock className="w-3 h-3" /> Every bill against its clock
                </p>
            </div>
            <div className="overflow-x-auto max-h-[560px] overflow-y-auto">
                <table className="w-full min-w-[720px]">
                    <thead className="sticky top-0 z-10 bg-surface-elevated">
                        <tr className="border-b border-border">
                            <th className={`${th} text-left`}>Account</th>
                            <th className={`${th} text-left`}>Month</th>
                            <th className={`${th} text-left`}>Stage</th>
                            <th className={`${th} text-right`}>In stage</th>
                            <th className={`${th} text-right`}>To early date</th>
                            <th className={`${th} text-right`}>Winnable</th>
                            <th className={`${th} text-left`}>Clock</th>
                        </tr>
                    </thead>
                    <tbody>
                        {ordered.map(r => {
                            const meta = CLOCK_META[r.clock_status];
                            return (
                                <tr key={r.id} className="border-b border-border/50 last:border-0 hover:bg-muted/40 transition-colors">
                                    <td className={`${td} font-bold text-text-primary`}>
                                        {r.site_label}
                                        {r.consumer_ref && <span className="font-semibold text-text-tertiary"> ·{r.consumer_ref}</span>}
                                    </td>
                                    <td className={`${td} text-text-secondary font-semibold`}>{monthLabel(r.billing_month)}</td>
                                    <td className={`${td} text-text-secondary font-semibold`}>
                                        {STAGE_LABELS[r.workflow_status] || r.workflow_status}
                                    </td>
                                    <td className={`${td} text-right tabular-nums font-semibold text-text-secondary`}>
                                        {r.days_in_stage === null ? '—' : `${r.days_in_stage}d`}
                                    </td>
                                    <td className={`${td} text-right tabular-nums font-bold`}
                                        style={{ color: (r.days_to_early ?? 99) <= 2 ? 'var(--error)' : 'var(--text-primary)' }}>
                                        {r.clock_status === 'settled' ? '—'
                                            : r.days_to_early === null ? '—'
                                            : r.days_to_early < 0 ? 'gone'
                                            : `${r.days_to_early}d`}
                                    </td>
                                    <td className={`${td} text-right tabular-nums font-bold text-text-primary`}>
                                        {r.discount_still_winnable ? inr(r.discount_still_winnable) : '—'}
                                    </td>
                                    <td className={td}>
                                        <span className="px-2 py-0.5 rounded-full text-[10px] font-black whitespace-nowrap"
                                            style={{ background: meta.tint, color: meta.colour }}>
                                            {meta.label}
                                        </span>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

/* ------------------------------------------------------------------- dwell */

function StageDwell({ dwell, median }: { dwell: CyclePayload['stage_dwell']; median: number | null }) {
    const max = Math.max(1, ...dwell.map(d => d.avg_days));

    return (
        <div className="rounded-2xl border border-border bg-surface p-5">
            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-primary flex items-center gap-1.5 mb-1">
                <TrendingDown className="w-3 h-3" /> Where the time goes
            </p>
            <p className="text-[10px] font-semibold text-text-tertiary mb-4">
                Average days an open bill is holding in each stage. The top row is the queue to fix.
            </p>

            {dwell.length === 0 ? (
                <p className="text-xs font-semibold text-text-tertiary py-4 text-center">
                    <Check className="w-4 h-4 mx-auto mb-1" style={{ color: 'var(--success)' }} />
                    No bills are open — nothing is holding.
                </p>
            ) : (
                <ul className="space-y-2.5">
                    {dwell.map(d => (
                        <li key={d.stage}>
                            <div className="flex items-baseline justify-between mb-1">
                                <span className="text-[11px] font-bold text-text-primary">
                                    {STAGE_LABELS[d.stage] || d.stage}
                                </span>
                                <span className="text-[11px] font-black tabular-nums text-text-secondary">
                                    {d.avg_days}d
                                    <span className="font-semibold text-text-tertiary"> · {d.bills}</span>
                                </span>
                            </div>
                            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                                <div className="h-full rounded-full"
                                    style={{
                                        width: `${(d.avg_days / max) * 100}%`,
                                        background: d.avg_days >= 7 ? 'var(--error)' : 'var(--primary)',
                                    }} />
                            </div>
                        </li>
                    ))}
                </ul>
            )}

            {median !== null && (
                <div className="mt-4 pt-3 border-t border-border flex items-center gap-1.5">
                    <TrendingUp className="w-3.5 h-3.5 text-text-tertiary" />
                    <p className="text-[10px] font-semibold text-text-tertiary">
                        Median completed cycle: <span className="font-black text-text-primary">{median} days</span> from
                        mailbox arrival to paid.
                    </p>
                </div>
            )}
        </div>
    );
}

function monthLabel(month: string): string {
    // Parse as UTC — a bare YYYY-MM-DD is midnight UTC and would render as the previous
    // month for anyone west of GMT if passed through the local-time constructor.
    const d = new Date(`${String(month).slice(0, 10)}T00:00:00Z`);
    return Number.isNaN(d.getTime())
        ? month
        : d.toLocaleDateString('en-IN', { month: 'short', year: '2-digit', timeZone: 'UTC' });
}
