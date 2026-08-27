'use client';

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useParams, usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
    AlertCircle, AlertTriangle, ArrowRight, Building2, CalendarDays, CheckCircle2, ClipboardList,
    Inbox, LayoutGrid, RefreshCw, Timer, TrendingUp,
} from 'lucide-react';
import { useAuth } from '@/frontend/context/AuthContext';
import { createClient } from '@/frontend/utils/supabase/client';
import { accountsCaps, PAY_STATUS_META, CRITICAL_META, statusPillStyle, inr } from '@/frontend/lib/accounts/roles';

// Same period vocabulary the ticket dashboards use (today | month | all — see
// frontend/components/dashboard/PropertyAdminDashboard.tsx:1090), plus 'custom'.
type Period = 'today' | 'month' | 'all' | 'custom';
type TrackerTab = 'to_align' | 'aligned' | 'completed';

const PERIODS: { value: Period; label: string }[] = [
    { value: 'today', label: 'TODAY' },
    { value: 'month', label: 'THIS MONTH' },
    { value: 'all', label: 'ALL TIME' },
    { value: 'custom', label: 'CUSTOM' },
];

interface Bucket { count: number; value: number; }

interface AlignItem {
    id: string; po_number: string; vendor_name: string | null; department: string | null;
    project_name: string | null; po_amount: number; pending_amount: number;
    po_date: string | null; age_days: number | null; is_critical: boolean;
}

interface CompleteItem {
    id: string; po_id: string; po_number: string | null; vendor_name: string | null;
    tranche_no: number; requested_amount: number; gst_hold: number; payment_term: string | null;
    aligned_at: string | null; aligned_by_name: string | null; age_days: number | null;
    is_critical: boolean;
}

interface TopRow { name: string; po_count: number; po_value: number; pending_value: number; }

interface Summary {
    period: Period;
    window: { from: string | null; to: string | null };
    can: { align: boolean; complete: boolean };
    totals: { po_count: number; po_value: number };
    buckets: { to_align: Bucket; aligned: Bucket; completed: Bucket };
    queue: {
        align: { total_count: number; total_value: number; critical_count: number; items: AlignItem[] };
        complete: { total_count: number; total_value: number; items: CompleteItem[] };
    };
    top_vendors: TopRow[];
    top_departments: TopRow[];
    scanned: { pos: number; payments: number };
    generated_at: string;
}

const nf = new Intl.NumberFormat('en-IN');

// Date-only strings must be parsed as local, not UTC — `new Date('2026-08-01')` is UTC
// midnight and renders as 31 Jul for anyone behind UTC.
const fmtDay = (d?: string | null) =>
    d ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d}T00:00:00` : d)
        .toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
      : '—';

const todayIso = () => new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date());

/**
 * Capability gate lives in the OUTER component so that an unauthorised viewer runs no
 * hooks at all. Returning null after the effects had already been declared still opened
 * the realtime channel: the websocket does not pass through /api/accounts/summary, so the
 * API's 403 did not contain it, and po_payments is REPLICA IDENTITY FULL — every insert
 * would have delivered requested_amount, paid_amount, utr_no and remarks to a
 * property_admin's browser.
 */
export default function FinanceOverview() {
    const { membership } = useAuth();
    const caps = useMemo(() => accountsCaps(membership), [membership]);
    if (!caps.canSee) return null;
    // What the caller may action comes from the API's own `can` block, which is derived
    // server-side by resolveAccountsAccess — the client caps only gate mounting.
    return <FinanceOverviewInner />;
}

function FinanceOverviewInner() {
    const params = useParams();
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const orgId = params?.orgId as string | undefined;
    const [supabase] = useState(() => createClient());

    const [period, setPeriod] = useState<Period>('month');
    const [from, setFrom] = useState(todayIso());
    const [to, setTo] = useState(todayIso());
    const [data, setData] = useState<Summary | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Period switches fire overlapping requests over a 5k-PO scan; only the newest one
    // may land, or a slow "all time" response overwrites the "today" the user asked for.
    const reqId = useRef(0);

    const fetchSummary = useCallback(async () => {
        const id = ++reqId.current;
        setError(null);
        try {
            const p = new URLSearchParams({ period });
            if (orgId) p.set('org_id', orgId);
            if (period === 'custom') { p.set('from', from); p.set('to', to); }
            const res = await fetch(`/api/accounts/summary?${p}`);
            const d = await res.json().catch(() => null);
            if (id !== reqId.current) return;
            if (!res.ok) throw new Error(d?.error || `Request failed (${res.status})`);
            setData(d as Summary);
        } catch (e: any) {
            if (id !== reqId.current) return;
            // Clear the payload too: leaving the previous window's figures on screen under
            // a newly-highlighted period pill presents stale numbers as the answer to a
            // question they do not answer.
            setData(null);
            setError(e?.message || 'Could not load the finance overview.');
        } finally {
            if (id === reqId.current) setLoading(false);
        }
    }, [period, from, to, orgId]);

    useEffect(() => { setLoading(true); fetchSummary(); }, [fetchSummary]);

    // Keep the overview honest while procurement aligns and accounts pays.
    const fetchRef = useRef(fetchSummary);
    useEffect(() => { fetchRef.current = fetchSummary; });
    useEffect(() => {
        if (!orgId) return;
        let t: ReturnType<typeof setTimeout> | null = null;
        const bump = () => { if (t) clearTimeout(t); t = setTimeout(() => fetchRef.current(), 600); };
        // Deliberately NOT subscribed to zoho_purchase_orders: the 2-hourly Zoho sync
        // rewrites all ~5k rows, and each event would re-trigger a whole-ledger rescan.
        // The refresh button covers that case; these two tables are user-paced.
        const channel = supabase
            .channel(`accounts_summary_${orgId}`)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'po_payments', filter: `organization_id=eq.${orgId}` }, bump)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'po_workflow_state', filter: `organization_id=eq.${orgId}` }, bump)
            .subscribe();
        return () => { if (t) clearTimeout(t); supabase.removeChannel(channel); };
    }, [orgId, supabase]);

    // A click-through writes a shareable ?tab=&focus= deep link, announces the intent on
    // the window for the instant case, and scrolls the tracker into view. Both channels
    // are consumed by AccountsDashboard (its useSearchParams effect handles a cold load
    // of the URL; the event handles an in-page click without a re-render round trip).
    // Existing query params are preserved rather than discarded.
    const openTab = useCallback((tab: TrackerTab, focus?: string | null) => {
        const q = new URLSearchParams(searchParams.toString());
        q.set('tab', tab);
        if (focus) q.set('focus', focus); else q.delete('focus');
        router.replace(`${pathname}?${q.toString()}`, { scroll: false });
        window.dispatchEvent(new CustomEvent('accounts:set-tab', { detail: { tab, focus: focus || null } }));
        document.getElementById('payment-tracker')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, [router, pathname, searchParams]);

    const windowLabel = !data
        ? ''
        : data.period === 'all'
        ? 'All time'
        : data.period === 'today'
        ? `Today · ${fmtDay(data.window.from)}`
        : `${fmtDay(data.window.from)} → ${fmtDay(data.window.to)}`;

    return (
        <section className="space-y-5 mb-8">
            {/* Header + period switcher */}
            <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                    <h2 className="text-2xl font-bold text-text-primary flex items-center gap-2">
                        <LayoutGrid className="w-6 h-6 text-primary" /> Finance Overview
                    </h2>
                    <p className="text-sm text-text-secondary mt-0.5">
                        Where the money stands {windowLabel ? <span className="text-text-tertiary">· {windowLabel}</span> : null}
                    </p>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                    <div className="flex items-center bg-muted rounded-full p-1 border border-border">
                        {PERIODS.map(opt => (
                            <button key={opt.value} onClick={() => setPeriod(opt.value)}
                                className={`px-3 py-1.5 text-[10px] font-black tracking-widest rounded-full transition-colors whitespace-nowrap ${
                                    period === opt.value ? 'bg-primary text-white shadow-sm' : 'text-text-secondary hover:text-text-primary'}`}>
                                {opt.label}
                            </button>
                        ))}
                    </div>
                    <button onClick={() => { setLoading(true); fetchSummary(); }} title="Refresh overview"
                        className="p-2 text-text-tertiary hover:text-text-primary rounded-lg hover:bg-surface-elevated">
                        <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                    </button>
                </div>
            </div>

            {period === 'custom' && (
                <div className="flex items-center gap-2 flex-wrap bg-surface border border-border rounded-xl px-3 py-2.5">
                    <CalendarDays className="w-4 h-4 text-text-tertiary" />
                    <label className="text-xs font-bold text-text-secondary uppercase tracking-wide">From</label>
                    <input type="date" value={from} max={to} onChange={e => setFrom(e.target.value)}
                        className="px-3 py-1.5 border border-border rounded-lg text-sm bg-surface text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary" />
                    <label className="text-xs font-bold text-text-secondary uppercase tracking-wide">To</label>
                    <input type="date" value={to} min={from} onChange={e => setTo(e.target.value)}
                        className="px-3 py-1.5 border border-border rounded-lg text-sm bg-surface text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary" />
                </div>
            )}

            {error && (
                <div className="flex items-start gap-3 bg-surface border border-border rounded-xl p-4">
                    <AlertCircle className="w-5 h-5 text-orange-500 flex-shrink-0 mt-0.5" />
                    <div className="min-w-0">
                        <p className="text-sm font-bold text-text-primary">Couldn’t load the overview</p>
                        <p className="text-xs text-text-secondary mt-0.5 break-words">{error}</p>
                        <button onClick={() => { setLoading(true); fetchSummary(); }}
                            className="mt-2 px-3 py-1.5 bg-primary text-white rounded-lg text-xs font-bold hover:bg-primary/90">
                            Try again
                        </button>
                    </div>
                </div>
            )}

            {loading && !data ? (
                <CardsSkeleton />
            ) : data ? (
                <>
                    {/* Summary cards */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                        <StatCard
                            label="To Align" caption="PO value awaiting a payment tranche"
                            color={PAY_STATUS_META.to_align.color} icon={<ClipboardList className="w-5 h-5" />}
                            count={data.buckets.to_align.count} value={data.buckets.to_align.value}
                            unit="POs" onClick={() => openTab('to_align')} />
                        {/* Flow, not stock: tranches aligned DURING this window. The
                            standing backlog awaiting a UTR is the panel below. */}
                        <StatCard
                            label="Aligned" caption="Tranches aligned in this window"
                            color={PAY_STATUS_META.aligned.color} icon={<Timer className="w-5 h-5" />}
                            count={data.buckets.aligned.count} value={data.buckets.aligned.value}
                            unit="tranches" onClick={() => openTab('aligned')} />
                        <StatCard
                            label="Completed" caption="Paid and UTR recorded"
                            color={PAY_STATUS_META.completed.color} icon={<CheckCircle2 className="w-5 h-5" />}
                            count={data.buckets.completed.count} value={data.buckets.completed.value}
                            unit="payments" onClick={() => openTab('completed')} />
                        <StatCard
                            label="POs Raised" caption="Total purchase order value in this window"
                            color="#6366F1" icon={<TrendingUp className="w-5 h-5" />}
                            count={data.totals.po_count} value={data.totals.po_value} unit="POs" />
                    </div>

                    {/* Needs your action */}
                    <ActionPanel data={data} onOpen={openTab} />

                    {/* Top vendors / departments */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                        <TopList title="Top vendors" subtitle="By PO value in this window"
                            icon={<Building2 className="w-4 h-4" />} rows={data.top_vendors} />
                        <TopList title="Top departments" subtitle="By PO value in this window"
                            icon={<LayoutGrid className="w-4 h-4" />} rows={data.top_departments} />
                    </div>

                    {/* Proof the totals are whole-ledger, not a truncated first page. */}
                    <p className="text-[11px] text-text-tertiary tabular-nums">
                        Aggregated across {nf.format(data.scanned.pos)} purchase orders and {nf.format(data.scanned.payments)} payment tranches.
                    </p>
                </>
            ) : null}
        </section>
    );
}

function StatCard({ label, caption, color, icon, count, value, unit, onClick }: {
    label: string; caption: string; color: string; icon: React.ReactNode;
    count: number; value: number; unit: string; onClick?: () => void;
}) {
    const Tag: any = onClick ? 'button' : 'div';
    return (
        <Tag onClick={onClick}
            className={`min-w-0 text-left bg-surface border border-border rounded-xl p-4 transition-colors ${
                onClick ? 'hover:bg-surface-elevated cursor-pointer' : ''}`}>
            <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full text-xs font-black uppercase tracking-wide"
                    style={{ color, backgroundColor: `${color}1A` }}>
                    {icon} {label}
                </span>
                {onClick && <ArrowRight className="w-4 h-4 text-text-tertiary flex-shrink-0" />}
            </div>
            <p className="mt-3 text-xl sm:text-2xl font-black text-text-primary tabular-nums break-words leading-tight">
                {inr(value)}
            </p>
            <p className="mt-1 text-sm font-bold text-text-secondary tabular-nums">
                {nf.format(count)} {unit}
            </p>
            <p className="mt-2 text-xs text-text-tertiary break-words">{caption}</p>
        </Tag>
    );
}

function ActionPanel({ data, onOpen }: { data: Summary; onOpen: (t: TrackerTab, focus?: string | null) => void }) {
    const showAlign = data.can.align;
    const showComplete = data.can.complete;
    if (!showAlign && !showComplete) return null;

    const nothing = (!showAlign || data.queue.align.total_count === 0)
        && (!showComplete || data.queue.complete.total_count === 0);

    return (
        <div className="bg-surface border border-border rounded-xl overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-3 border-b border-border bg-surface-elevated">
                <Inbox className="w-4 h-4 text-primary" />
                <h3 className="text-sm font-black text-text-primary uppercase tracking-wide">Needs your action</h3>
                <span className="text-xs text-text-tertiary ml-auto">Whole backlog, oldest / largest first</span>
            </div>

            {nothing ? (
                <div className="px-4 py-12 text-center">
                    <CheckCircle2 className="w-10 h-10 mx-auto mb-3 text-text-tertiary" />
                    <p className="text-sm font-bold text-text-primary">You’re all caught up</p>
                    <p className="text-xs text-text-secondary mt-1">Nothing is waiting on you right now.</p>
                </div>
            ) : (
                <div className={`grid grid-cols-1 ${showAlign && showComplete ? 'lg:grid-cols-2 lg:divide-x' : ''} divide-y lg:divide-y-0 divide-border`}>
                    {showAlign && (
                        <QueueBlock
                            title="POs awaiting alignment"
                            color={PAY_STATUS_META.to_align.color}
                            total={data.queue.align.total_count}
                            totalValue={data.queue.align.total_value}
                            shown={data.queue.align.items.length}
                            critical={data.queue.align.critical_count}
                            emptyMsg="Every PO has its payments aligned."
                            onSeeAll={() => onOpen('to_align')}>
                            {data.queue.align.items.map(po => (
                                <QueueRow key={po.id} onClick={() => onOpen('to_align', po.po_number)}
                                    title={po.po_number} critical={po.is_critical}
                                    sub={[po.vendor_name, po.project_name || po.department].filter(Boolean).join(' · ') || '—'}
                                    meta={po.po_date ? `Raised ${fmtDay(po.po_date)}` : 'No PO date'}
                                    age={po.age_days} amount={po.pending_amount} amountLabel="pending"
                                    color={PAY_STATUS_META.to_align.color} />
                            ))}
                        </QueueBlock>
                    )}
                    {showComplete && (
                        <QueueBlock
                            title="Payments awaiting UTR"
                            color={PAY_STATUS_META.aligned.color}
                            total={data.queue.complete.total_count}
                            totalValue={data.queue.complete.total_value}
                            shown={data.queue.complete.items.length}
                            emptyMsg="No aligned tranche is waiting to be paid."
                            onSeeAll={() => onOpen('aligned')}>
                            {data.queue.complete.items.map(p => (
                                <QueueRow key={p.id} onClick={() => onOpen('aligned', p.po_number)}
                                    title={`${p.po_number || '—'} · #${p.tranche_no}`} critical={p.is_critical}
                                    sub={[p.vendor_name, p.payment_term].filter(Boolean).join(' · ') || '—'}
                                    meta={p.aligned_by_name ? `Aligned by ${p.aligned_by_name}` : `Aligned ${fmtDay(p.aligned_at)}`}
                                    age={p.age_days} amount={p.requested_amount} amountLabel="to pay"
                                    color={PAY_STATUS_META.aligned.color} />
                            ))}
                        </QueueBlock>
                    )}
                </div>
            )}
        </div>
    );
}

function QueueBlock({ title, color, total, totalValue, shown, critical, emptyMsg, onSeeAll, children }: {
    title: string; color: string; total: number; totalValue: number; shown: number;
    critical?: number; emptyMsg: string; onSeeAll: () => void; children: React.ReactNode;
}) {
    return (
        <div className="min-w-0 p-4">
            <div className="flex items-baseline justify-between gap-2 flex-wrap mb-3">
                <h4 className="text-sm font-bold text-text-primary flex items-center gap-2 min-w-0 flex-wrap">
                    <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
                    <span className="truncate">{title}</span>
                    <span className="text-xs font-black tabular-nums px-2 py-0.5 rounded-full flex-shrink-0"
                        style={{ color, backgroundColor: `${color}1A` }}>{nf.format(total)}</span>
                    {!!critical && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-black tabular-nums px-2 py-0.5 rounded-full flex-shrink-0"
                            style={statusPillStyle(CRITICAL_META)} title="Flagged critical — needs alignment ASAP">
                            <AlertTriangle className="w-3 h-3" /> {nf.format(critical)}
                        </span>
                    )}
                </h4>
                <span className="text-xs text-text-tertiary tabular-nums break-words">{inr(totalValue)}</span>
            </div>

            {total === 0 ? (
                <p className="text-sm text-text-secondary py-8 text-center">{emptyMsg}</p>
            ) : (
                <>
                    <div className="space-y-1.5">{children}</div>
                    {total > shown && (
                        <button onClick={onSeeAll}
                            className="mt-3 w-full flex items-center justify-center gap-1.5 py-2 text-xs font-bold text-primary hover:bg-surface-elevated rounded-lg">
                            See all {nf.format(total)} <ArrowRight className="w-3.5 h-3.5" />
                        </button>
                    )}
                </>
            )}
        </div>
    );
}

function QueueRow({ title, sub, meta, age, amount, amountLabel, color, critical, onClick }: {
    title: string; sub: string; meta: string; age: number | null;
    amount: number; amountLabel: string; color: string; critical?: boolean; onClick: () => void;
}) {
    // Anything sitting more than a fortnight is the thing finance actually needs to chase.
    const stale = age != null && age >= 14;
    return (
        <button onClick={onClick}
            className="w-full text-left flex items-start justify-between gap-3 px-3 py-2.5 rounded-lg hover:bg-surface-elevated transition-colors group"
            style={critical ? { boxShadow: `inset 3px 0 0 0 ${CRITICAL_META.color}` } : undefined}>
            <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-text-primary truncate flex items-center gap-1.5">
                    {critical && <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" style={{ color: CRITICAL_META.color }} />}
                    <span className="truncate">{title}</span>
                </p>
                <p className="text-xs text-text-secondary truncate">{sub}</p>
                <p className="text-[11px] text-text-tertiary mt-0.5 truncate">
                    {meta}
                    {age != null && (
                        <span className={`ml-1.5 font-bold ${stale ? 'text-orange-500' : 'text-text-tertiary'}`}>
                            · {nf.format(age)}d
                        </span>
                    )}
                </p>
            </div>
            <div className="text-right flex-shrink-0 max-w-[45%]">
                <p className="text-sm font-black tabular-nums break-words leading-tight" style={{ color }}>{inr(amount)}</p>
                <p className="text-[11px] text-text-tertiary">{amountLabel}</p>
            </div>
            <ArrowRight className="w-4 h-4 text-transparent group-hover:text-text-tertiary flex-shrink-0 mt-1" />
        </button>
    );
}

function TopList({ title, subtitle, icon, rows }: {
    title: string; subtitle: string; icon: React.ReactNode; rows: TopRow[];
}) {
    const max = Math.max(1, ...rows.map(r => r.po_value));
    return (
        <div className="bg-surface border border-border rounded-xl p-4 min-w-0">
            <div className="flex items-baseline justify-between gap-2 mb-3">
                <h3 className="text-sm font-bold text-text-primary flex items-center gap-2">{icon} {title}</h3>
                <span className="text-xs text-text-tertiary">{subtitle}</span>
            </div>
            {rows.length === 0 ? (
                <p className="text-sm text-text-secondary py-8 text-center">No purchase orders in this window.</p>
            ) : (
                <div className="space-y-2.5">
                    {rows.map(r => (
                        <div key={r.name} className="min-w-0">
                            <div className="flex items-baseline justify-between gap-3">
                                <span className="text-sm text-text-primary truncate">{r.name}</span>
                                <span className="text-sm font-bold text-text-primary tabular-nums break-words text-right">{inr(r.po_value)}</span>
                            </div>
                            <div className="mt-1 h-1.5 bg-muted rounded-full overflow-hidden">
                                <div className="h-full bg-primary rounded-full" style={{ width: `${(r.po_value / max) * 100}%` }} />
                            </div>
                            <p className="mt-1 text-[11px] text-text-tertiary tabular-nums">
                                {nf.format(r.po_count)} PO{r.po_count === 1 ? '' : 's'} · {inr(r.pending_value)} pending
                            </p>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

function CardsSkeleton() {
    return (
        <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                {[...Array(4)].map((_, i) => (
                    <div key={i} className="bg-surface border border-border rounded-xl p-4">
                        <div className="h-6 w-28 bg-muted rounded-full animate-pulse" />
                        <div className="h-8 w-40 bg-muted rounded mt-3 animate-pulse" />
                        <div className="h-4 w-20 bg-muted rounded mt-2 animate-pulse" />
                        <div className="h-3 w-full bg-muted rounded mt-3 animate-pulse" />
                    </div>
                ))}
            </div>
            <div className="bg-surface border border-border rounded-xl p-4">
                <div className="h-4 w-44 bg-muted rounded animate-pulse" />
                <div className="mt-4 space-y-2">
                    {[...Array(4)].map((_, i) => <div key={i} className="h-12 bg-muted rounded-lg animate-pulse" />)}
                </div>
            </div>
        </div>
    );
}
