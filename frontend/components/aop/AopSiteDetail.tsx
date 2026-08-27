'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ChevronDown, ChevronRight, Loader2 } from 'lucide-react';
import AopCellEditor from './AopCellEditor';
import AopTrendChart from './AopTrendChart';
import {
    AOP_GROUPS, formatByUnit, inr, monthLabel, varianceToneForKind, TONE_COLOR, TONE_TINT,
    type AopCell, type AopKind, type AopLineItem, type AopSiteMatrix,
} from '@/frontend/lib/aop/types';

/**
 * One site, every category, month over month.
 *
 * The summary grid answers "which site"; this answers "why". Because a site has only as
 * many months as have been imported, the density problem inverts — there is room to show
 * budget AND actual side by side for each month, which is exactly the source sheet's own
 * layout and the comparison the reader came for. The variance tint sits on the actual,
 * where the eye already is.
 */

interface Props {
    orgId: string;
    siteId: string;
    onBack: () => void;
}

const LABEL_W = 236;
// Height of the month header row, and therefore the sticky offset of the Budget/Actual
// row beneath it. Two constants that must agree, so there is only one.
const SUBHEAD_TOP = 30;

export default function AopSiteDetail({ orgId, siteId, onBack }: Props) {
    const [data, setData] = useState<AopSiteMatrix | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [open, setOpen] = useState<Record<string, boolean>>(
        () => Object.fromEntries(AOP_GROUPS.map(g => [g.kind, g.defaultOpen])),
    );
    const [editing, setEditing] = useState<{ lineItem: AopLineItem; month: string } | null>(null);

    const load = useCallback(async (quiet = false) => {
        if (!quiet) setLoading(true);
        setError(null);
        try {
            const res = await fetch(`/api/aop/matrix?org_id=${orgId}&view=site&site_id=${siteId}`);
            const payload = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(payload?.error || 'Could not load the site');
            setData(payload as AopSiteMatrix);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not load the site');
        } finally {
            setLoading(false);
        }
    }, [orgId, siteId]);

    useEffect(() => { void load(); }, [load]);

    // Chronological. The summary grid hands months back newest-first; a month-over-month
    // read only works left to right.
    const months = useMemo(() => [...(data?.months || [])].sort(), [data?.months]);

    const applyCell = useCallback((cell: AopCell, month: string) => {
        setData(prev => prev && ({
            ...prev,
            cells_by_month: {
                ...prev.cells_by_month,
                [month]: { ...prev.cells_by_month[month], [cell.line_item_id]: cell },
            },
        }));
    }, []);

    if (loading) {
        return (
            <div className="flex items-center justify-center py-20 text-text-tertiary">
                <Loader2 className="w-5 h-5 animate-spin" />
            </div>
        );
    }
    if (error || !data?.site) {
        return (
            <div className="rounded-2xl border border-border bg-surface p-8 text-center">
                <p className="text-sm font-bold text-text-primary">{error || 'Site not found'}</p>
                <button onClick={onBack} className="mt-3 text-xs font-bold text-primary">Back to the grid</button>
            </div>
        );
    }

    const site = data.site;
    const latest = months[months.length - 1];
    const previous = months[months.length - 2];
    const latestTotals = latest ? data.totals_by_month[latest] : undefined;
    const previousTotals = previous ? data.totals_by_month[previous] : undefined;

    const groups = AOP_GROUPS
        .map(g => ({ ...g, rows: data.line_items.filter(li => li.kind === g.kind) }))
        .filter(g => g.rows.length > 0);

    const monthDelta = latestTotals && previousTotals && previousTotals.cost.actual > 0
        ? ((latestTotals.cost.actual - previousTotals.cost.actual) / previousTotals.cost.actual) * 100
        : null;

    const stickyLeft: React.CSSProperties = {
        position: 'sticky', left: 0, zIndex: 2, width: LABEL_W, minWidth: LABEL_W, maxWidth: LABEL_W,
    };
    const cellBase = 'px-2 py-1.5 text-right text-[11px] font-bold tabular-nums whitespace-nowrap border-b border-border';

    return (
        <div className="space-y-4">
            <div className="flex items-start gap-3">
                <button
                    onClick={onBack}
                    className="mt-0.5 p-1.5 rounded-lg border border-border text-text-secondary hover:text-text-primary hover:bg-muted transition-colors"
                    aria-label="Back to the grid"
                >
                    <ArrowLeft className="w-4 h-4" />
                </button>
                <div className="min-w-0">
                    <h2 className="text-lg font-bold text-text-primary truncate">{site.name}</h2>
                    <p className="text-xs font-semibold text-text-tertiary">
                        {[site.city, latestTotals?.seat_count ? `${latestTotals.seat_count.toLocaleString('en-IN')} seats` : null,
                            latestTotals?.sqft_area ? `${latestTotals.sqft_area.toLocaleString('en-IN')} sq ft` : null]
                            .filter(Boolean).join(' · ') || '—'}
                    </p>
                </div>
            </div>

            {/* KPI strip — ops only, and it says so. */}
            {latestTotals && (
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                    <Kpi
                        label={`Ops actual · ${monthLabel(latest)}`}
                        value={inr(latestTotals.cost.actual, true)}
                        sub={`of ${inr(latestTotals.cost.budget, true)} planned`}
                    />
                    <Kpi
                        label="Against plan"
                        value={latestTotals.cost.saving < 0
                            ? `${inr(-latestTotals.cost.saving, true)} over`
                            : `${inr(latestTotals.cost.saving, true)} under`}
                        sub={latestTotals.utilisation_pct === null ? '—' : `${latestTotals.utilisation_pct.toFixed(1)}% of budget used`}
                        color={latestTotals.cost.saving < 0 ? 'var(--error)' : 'var(--success)'}
                    />
                    <Kpi
                        label="Cost per seat"
                        value={latestTotals.cost_per_seat === null ? '—' : inr(latestTotals.cost_per_seat)}
                        sub="ops spend ÷ seats"
                    />
                    <Kpi
                        label="Month on month"
                        value={monthDelta === null ? '—' : `${monthDelta > 0 ? '+' : ''}${monthDelta.toFixed(1)}%`}
                        sub={previous ? `vs ${monthLabel(previous)}` : 'no prior month'}
                        color={monthDelta === null ? undefined : monthDelta > 0 ? 'var(--error)' : 'var(--success)'}
                    />
                </div>
            )}

            <div className="rounded-2xl border border-border bg-surface p-4">
                <AopTrendChart orgId={orgId} siteId={siteId} height={200} />
            </div>

            {/* Category table — budget beside actual, one pair per month. */}
            <div className="rounded-2xl border border-border bg-surface overflow-hidden">
                <div className="overflow-auto touch-scroll" style={{ maxHeight: 'min(64vh, 640px)' }}>
                    <table className="border-separate" style={{ borderSpacing: 0, width: LABEL_W + months.length * 220, tableLayout: 'fixed' }}>
                        <thead>
                            <tr>
                                <th
                                    rowSpan={2}
                                    style={{ ...stickyLeft, zIndex: 4, top: 0, background: 'var(--surface)' }}
                                    className="sticky text-left px-3 py-2 border-b border-r border-border align-bottom"
                                >
                                    <span className="text-[10px] font-black uppercase tracking-[0.12em] text-text-tertiary">
                                        Cost category
                                    </span>
                                </th>
                                {months.map(m => (
                                    <th
                                        key={m}
                                        colSpan={2}
                                        // Height is pinned because the second header row's
                                        // sticky offset has to match it exactly.
                                        style={{ position: 'sticky', top: 0, zIndex: 3, height: SUBHEAD_TOP, background: 'var(--surface)' }}
                                        className="px-2 pt-2 pb-1 text-center border-b border-l border-border"
                                    >
                                        <span className="text-[10px] font-extrabold text-text-primary">{monthLabel(m)}</span>
                                    </th>
                                ))}
                            </tr>
                            <tr>
                                {months.map(m => (
                                    <React.Fragment key={m}>
                                        <th
                                            style={{ position: 'sticky', top: SUBHEAD_TOP, zIndex: 3, width: 110, background: 'var(--surface)' }}
                                            className="px-2 pb-2 text-right border-b border-l border-border text-[10px] font-bold text-text-tertiary"
                                        >
                                            Budget
                                        </th>
                                        <th
                                            style={{ position: 'sticky', top: SUBHEAD_TOP, zIndex: 3, width: 110, background: 'var(--surface)' }}
                                            className="px-2 pb-2 text-right border-b border-border text-[10px] font-bold text-text-tertiary"
                                        >
                                            Actual
                                        </th>
                                    </React.Fragment>
                                ))}
                            </tr>
                        </thead>

                        <tbody>
                            {groups.map(group => {
                                const expanded = open[group.kind];
                                return (
                                    <React.Fragment key={group.kind}>
                                        <tr>
                                            <td
                                                style={{ ...stickyLeft, background: 'var(--muted)' }}
                                                className="px-2 py-1.5 border-y border-r border-border"
                                            >
                                                <button
                                                    onClick={() => setOpen(o => ({ ...o, [group.kind]: !o[group.kind] }))}
                                                    className="flex items-center gap-1.5 w-full text-left"
                                                >
                                                    {expanded
                                                        ? <ChevronDown className="w-3.5 h-3.5 text-text-secondary shrink-0" />
                                                        : <ChevronRight className="w-3.5 h-3.5 text-text-secondary shrink-0" />}
                                                    <span className="text-[10px] font-black uppercase tracking-[0.1em] text-text-secondary truncate">
                                                        {group.label}
                                                    </span>
                                                </button>
                                            </td>
                                            <td
                                                colSpan={months.length * 2}
                                                className="px-3 py-1.5 border-y border-border text-[10px] font-semibold text-text-tertiary truncate"
                                                style={{ background: 'var(--muted)' }}
                                            >
                                                {group.note}
                                            </td>
                                        </tr>

                                        {expanded && group.rows.map(li => (
                                            <tr key={li.id} className="group">
                                                <td
                                                    style={stickyLeft}
                                                    className="px-3 py-1.5 border-b border-r border-border bg-surface group-hover:bg-[var(--surface-elevated)] transition-colors"
                                                >
                                                    <span className="block text-[11px] font-bold text-text-primary truncate" title={li.name}>
                                                        {li.name}
                                                    </span>
                                                </td>
                                                {months.map(m => {
                                                    const cell = data.cells_by_month[m]?.[li.id];
                                                    const tone = varianceToneForKind(li.kind, cell?.budget, cell?.actual);
                                                    return (
                                                        <React.Fragment key={m}>
                                                            <td
                                                                onClick={() => setEditing({ lineItem: li, month: m })}
                                                                className={`${cellBase} border-l cursor-pointer text-text-secondary`}
                                                            >
                                                                {formatByUnit(cell?.budget, li.unit, true)}
                                                            </td>
                                                            <td
                                                                onClick={() => setEditing({ lineItem: li, month: m })}
                                                                title={cell?.remarks || undefined}
                                                                className={`${cellBase} cursor-pointer text-text-primary group-hover:bg-[var(--surface-elevated)]`}
                                                                style={{
                                                                    boxShadow: tone === 'flat'
                                                                        ? undefined
                                                                        : `inset 0 0 0 9999px ${TONE_TINT[tone]}`,
                                                                }}
                                                            >
                                                                {formatByUnit(cell?.actual, li.unit, true)}
                                                                {cell?.remarks && (
                                                                    <span
                                                                        className="inline-block w-1 h-1 rounded-full ml-1 align-middle"
                                                                        style={{ background: 'var(--secondary)' }}
                                                                    />
                                                                )}
                                                            </td>
                                                        </React.Fragment>
                                                    );
                                                })}
                                            </tr>
                                        ))}

                                        {expanded && bucketOf(group.kind) && (
                                            <tr>
                                                <td
                                                    style={{ ...stickyLeft, background: 'var(--surface-elevated)' }}
                                                    className="px-3 py-1.5 border-b-2 border-r border-border"
                                                >
                                                    <span className="text-[11px] font-extrabold text-text-primary">
                                                        {group.label} total
                                                    </span>
                                                </td>
                                                {months.map(m => {
                                                    const bucket = bucketOf(group.kind);
                                                    const t = bucket ? data.totals_by_month[m]?.[bucket] : undefined;
                                                    const tone = varianceToneForKind(group.kind, t?.budget, t?.actual);
                                                    return (
                                                        <React.Fragment key={m}>
                                                            <td
                                                                className={`${cellBase} border-l border-b-2 text-text-secondary`}
                                                                style={{ background: 'var(--surface-elevated)', fontWeight: 800 }}
                                                            >
                                                                {inr(t?.budget ?? 0, true)}
                                                            </td>
                                                            <td
                                                                className={`${cellBase} border-b-2`}
                                                                style={{ background: 'var(--surface-elevated)', color: TONE_COLOR[tone], fontWeight: 800 }}
                                                            >
                                                                {inr(t?.actual ?? 0, true)}
                                                            </td>
                                                        </React.Fragment>
                                                    );
                                                })}
                                            </tr>
                                        )}
                                    </React.Fragment>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>

            {editing && (
                <AopCellEditor
                    orgId={orgId}
                    month={editing.month}
                    site={site}
                    lineItem={editing.lineItem}
                    cell={data.cells_by_month[editing.month]?.[editing.lineItem.id] ?? null}
                    canEdit={data.can_edit}
                    onApply={cell => applyCell(cell, editing.month)}
                    onCommitted={() => void load(true)}
                    onClose={() => setEditing(null)}
                />
            )}
        </div>
    );
}

/** Which totals bucket a group rolls into. Metrics and source roll-ups have none. */
function bucketOf(kind: AopKind): 'cost' | 'rent' | 'revenue' | null {
    if (kind === 'cost' || kind === 'rent' || kind === 'revenue') return kind;
    return null;
}

function Kpi({ label, value, sub, color }: { label: string; value: string; sub: string; color?: string }) {
    return (
        <div className="rounded-2xl border border-border bg-surface px-4 py-3">
            <p className="text-[10px] font-black uppercase tracking-[0.12em] text-text-tertiary truncate">{label}</p>
            <p className="text-xl font-extrabold tabular-nums mt-1" style={{ color: color || 'var(--text-primary)' }}>
                {value}
            </p>
            <p className="text-[11px] font-semibold text-text-tertiary mt-0.5 truncate">{sub}</p>
        </div>
    );
}
