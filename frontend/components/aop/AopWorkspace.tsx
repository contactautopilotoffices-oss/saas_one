'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
    AlertTriangle, Check, Download, Loader2, RefreshCw,
} from 'lucide-react';
import AopMatrix from './AopMatrix';
import AopSiteDetail from './AopSiteDetail';
import AopTrendChart from './AopTrendChart';
import {
    cellKey, inr, monthLabel, monthLabelLong,
    type AopCell, type AopSummaryMatrix, type AopWarning,
} from '@/frontend/lib/aop/types';

/**
 * The AOP Budget-vs-Actual workspace — the client's Excel tracker, automated.
 *
 * The page leads with the pan-India position because that is the question the tracker
 * exists to answer, then hands over to the grid for "where". Every headline figure here is
 * the OPS roll-up: rent and revenue are shown, but on their own tiles and clearly labelled,
 * because folding rent into ops spend roughly doubles it and the business's own headline
 * excludes it.
 */

interface Props {
    orgId: string;
}

export default function AopWorkspace({ orgId }: Props) {
    const [data, setData] = useState<AopSummaryMatrix | null>(null);
    const [month, setMonth] = useState<string | null>(null);
    const [siteId, setSiteId] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [warnings, setWarnings] = useState<AopWarning[]>([]);
    const [warningsOpen, setWarningsOpen] = useState(false);

    const load = useCallback(async (targetMonth: string | null, quiet = false) => {
        if (quiet) setRefreshing(true); else setLoading(true);
        setError(null);
        try {
            const qs = new URLSearchParams({ org_id: orgId, view: 'summary' });
            if (targetMonth) qs.set('month', targetMonth.slice(0, 7));
            const res = await fetch(`/api/aop/matrix?${qs.toString()}`);
            const payload = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(payload?.error || 'Could not load the operating plan');
            const matrix = payload as AopSummaryMatrix;
            setData(matrix);
            setMonth(matrix.month);
            setWarnings(matrix.warnings || []);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not load the operating plan');
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, [orgId]);

    useEffect(() => { void load(null); }, [load]);

    // Optimistic and pessimistic writes both land here; the drawer sends the previous cell
    // back on failure, so this merge is the single point where the grid changes.
    const applyCell = useCallback((cell: AopCell) => {
        setData(prev => {
            if (!prev) return prev;
            return { ...prev, cells: { ...prev.cells, [cellKey(cell.site_id, cell.line_item_id)]: cell } };
        });
    }, []);

    // The roll-ups are computed server-side, so a confirmed correction needs one quiet
    // refetch to bring the subtotals back in step with the cell that changed. Only on
    // commit — refetching on the optimistic paint would undo the point of it.
    const refreshRollUps = useCallback(() => { void load(month, true); }, [load, month]);

    async function acknowledge(id: string) {
        setWarnings(prev => prev.filter(w => w.id !== id));
        const res = await fetch(`/api/aop/warnings/${id}/ack`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ org_id: orgId, acknowledged: true }),
        });
        if (!res.ok) void load(month, true);   // put it back if the server disagreed
    }

    if (loading) {
        return (
            <div className="flex items-center justify-center py-24 text-text-tertiary">
                <Loader2 className="w-6 h-6 animate-spin" />
            </div>
        );
    }

    if (error) {
        return (
            <div className="rounded-2xl border border-border bg-surface p-8 text-center">
                <AlertTriangle className="w-6 h-6 mx-auto mb-3" style={{ color: 'var(--warning)' }} />
                <p className="text-sm font-bold text-text-primary">{error}</p>
                <button onClick={() => void load(null)} className="mt-3 text-xs font-bold text-primary">Try again</button>
            </div>
        );
    }

    if (!data?.provisioned) {
        return (
            <SetupNotice
                title="The AOP tracker is not set up yet"
                body="Apply supabase/migrations/20260802000001_aop_tracker.sql, then run node scripts/import_aop_tracker.js --commit to load AOP-BudgetVsActual.xlsx."
            />
        );
    }

    if (!data.months.length) {
        return (
            <SetupNotice
                title="No budget data imported yet"
                body="The tables exist but hold no periods. Run node scripts/import_aop_tracker.js --commit to load the workbook."
            />
        );
    }

    const g = data.grand;
    const overspend = Math.max(0, -g.cost.saving);

    return (
        <div className="space-y-4">
            {/* ---- Header ------------------------------------------------------ */}
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                    <p className="text-[10px] font-black uppercase tracking-[0.18em] text-primary">
                        Annual Operating Plan
                    </p>
                    <h1 className="text-xl lg:text-2xl font-bold text-text-primary">Budget vs Actual</h1>
                    <p className="text-xs font-semibold text-text-tertiary mt-0.5">
                        {monthLabelLong(month)} · {g.sites_total} sites · operating cost, rent held separate
                    </p>
                </div>

                <div className="flex items-center gap-2">
                    <select
                        value={month ?? ''}
                        onChange={e => { setSiteId(null); void load(e.target.value); }}
                        className="px-3 py-2 rounded-xl border border-border bg-surface text-xs font-bold text-text-primary outline-none focus:border-primary transition-colors"
                    >
                        {data.months.map(m => (
                            <option key={m} value={m}>{monthLabel(m)}</option>
                        ))}
                    </select>

                    <button
                        onClick={() => void load(month, true)}
                        className="p-2 rounded-xl border border-border text-text-secondary hover:text-text-primary hover:bg-muted transition-colors"
                        aria-label="Refresh"
                    >
                        <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
                    </button>

                    <a
                        href={`/api/aop/export?org_id=${orgId}&month=${(month || '').slice(0, 7)}`}
                        className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-primary text-white text-xs font-bold hover:opacity-90 transition-opacity"
                    >
                        <Download className="w-4 h-4" />
                        Export
                    </a>
                </div>
            </div>

            {/* ---- Import warnings --------------------------------------------
                 Surfaced before the numbers, not after. A figure filed under the wrong
                 month looks entirely normal, so the caveat has to arrive first. */}
            {warnings.length > 0 && (
                <div
                    className="rounded-2xl border px-4 py-3"
                    style={{ borderColor: 'var(--warning)', background: 'rgba(245, 158, 11, 0.07)' }}
                >
                    <button
                        onClick={() => setWarningsOpen(v => !v)}
                        className="flex items-center gap-2 w-full text-left"
                    >
                        <AlertTriangle className="w-4 h-4 shrink-0" style={{ color: 'var(--warning)' }} />
                        <span className="text-xs font-bold text-text-primary">
                            {warnings.length} import warning{warnings.length === 1 ? '' : 's'} — some figures may be misfiled
                        </span>
                        <span className="ml-auto text-[11px] font-bold text-text-secondary">
                            {warningsOpen ? 'Hide' : 'Review'}
                        </span>
                    </button>

                    {warningsOpen && (
                        <ul className="mt-3 space-y-2">
                            {warnings.map(w => (
                                <li key={w.id} className="flex items-start gap-3 rounded-xl bg-surface border border-border px-3 py-2">
                                    <div className="min-w-0 flex-1">
                                        <p className="text-[11px] font-semibold text-text-secondary">
                                            {w.message}
                                        </p>
                                        <p className="text-[10px] font-bold text-text-tertiary mt-0.5">
                                            {[w.sheet_name, w.site_label].filter(Boolean).join(' · ')}
                                        </p>
                                    </div>
                                    <button
                                        onClick={() => void acknowledge(w.id)}
                                        className="shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-border text-[10px] font-bold text-text-secondary hover:text-text-primary hover:bg-muted transition-colors"
                                    >
                                        <Check className="w-3 h-3" />
                                        Acknowledge
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            )}

            {siteId ? (
                <AopSiteDetail orgId={orgId} siteId={siteId} onBack={() => { setSiteId(null); void load(month, true); }} />
            ) : (
                <>
                    {/* ---- Headline ------------------------------------------- */}
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                        <Tile
                            label={`Ops spend · ${monthLabel(month)}`}
                            value={inr(g.cost.actual, true)}
                            sub={`of ${inr(g.cost.budget, true)} planned`}
                            bar={g.utilisation_pct}
                        />
                        <Tile
                            label="Against plan"
                            value={overspend > 0 ? `${inr(overspend, true)} over` : `${inr(g.cost.saving, true)} under`}
                            sub={`${g.sites_over_budget} of ${g.sites_total} sites over budget`}
                            color={overspend > 0 ? 'var(--error)' : 'var(--success)'}
                        />
                        <Tile
                            label="Cost per seat"
                            value={g.cost_per_seat === null ? '—' : inr(g.cost_per_seat)}
                            sub={`${(g.seat_count ?? 0).toLocaleString('en-IN')} seats · ${g.categories_over_budget} categories over`}
                        />
                        <Tile
                            label="Rent + CAM (separate)"
                            value={inr(g.rent.actual, true)}
                            sub={`ops + rent ${inr(g.total_spend.actual, true)} · revenue ${inr(g.revenue.actual, true)}`}
                        />
                    </div>

                    <div className="rounded-2xl border border-border bg-surface p-4">
                        <AopTrendChart orgId={orgId} height={200} />
                    </div>

                    <AopMatrix
                        orgId={orgId}
                        data={data}
                        onApplyCell={applyCell}
                        onCommitted={refreshRollUps}
                        onOpenSite={setSiteId}
                    />
                </>
            )}
        </div>
    );
}

function Tile({ label, value, sub, color, bar }: {
    label: string; value: string; sub: string; color?: string; bar?: number | null;
}) {
    return (
        <div className="rounded-2xl border border-border bg-surface px-4 py-3">
            <p className="text-[10px] font-black uppercase tracking-[0.12em] text-text-tertiary truncate">{label}</p>
            <p className="text-xl lg:text-2xl font-extrabold tabular-nums mt-1" style={{ color: color || 'var(--text-primary)' }}>
                {value}
            </p>
            <p className="text-[11px] font-semibold text-text-tertiary mt-0.5 truncate">{sub}</p>
            {bar !== undefined && bar !== null && (
                <div className="mt-2 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--muted)' }}>
                    <div
                        className="h-full rounded-full transition-[width] duration-500"
                        style={{
                            width: `${Math.min(100, Math.max(0, bar))}%`,
                            background: bar >= 100 ? 'var(--error)' : bar >= 92 ? 'var(--warning)' : 'var(--success)',
                        }}
                    />
                </div>
            )}
        </div>
    );
}

function SetupNotice({ title, body }: { title: string; body: string }) {
    return (
        <div className="rounded-2xl border border-border bg-surface p-10 text-center">
            <AlertTriangle className="w-6 h-6 mx-auto mb-3" style={{ color: 'var(--warning)' }} />
            <p className="text-sm font-bold text-text-primary">{title}</p>
            <p className="text-xs font-semibold text-text-tertiary mt-2 max-w-md mx-auto">{body}</p>
        </div>
    );
}
