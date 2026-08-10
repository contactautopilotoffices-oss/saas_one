'use client';

import React, { useEffect } from 'react';
import { AlertTriangle } from 'lucide-react';
import type { WidgetProps } from '@/frontend/lib/dashboard/types';
import { useWidgetData } from '@/frontend/lib/dashboard/useWidgetData';
import { Metric, Delta, ProgressBar, RankRow, WidgetEmpty, WidgetSkeleton } from './WidgetShell';

/**
 * Consumables below reorder level.
 *
 * SCOPE, HONESTLY. The brief asked for "below reorder level AND recent consumption". Only
 * the first half is real. stock_reports is written by a nightly cron that counts the
 * movements recorded *so far on the report's own day* — it runs at midnight, so it always
 * counts zero. Every total_added and total_removed in all 1,512 rows is 0 despite 319 actual
 * stock movements existing. Rendering a consumption trend from that column would be
 * inventing a number, so this card reports the stock level only and, at lg/xl, says plainly
 * that movement is not being captured. Fixing the cron is the prerequisite for the other half.
 *
 * WHY THE limit IS EXPLICIT. The endpoint defaults to limit=100 against 1,512 rows. Reports
 * come back report_date DESC, so a truncated read silently drops the OLDEST days — which is
 * exactly the baseline the comparison needs. The window and limit here are sized so every
 * property's snapshot for the whole week is present.
 *
 * report_data.items carries {name, quantity, minThreshold} per item, which is what turns
 * "99 items low" into a shopping list at xl.
 */

interface SnapshotItem {
    id?: string;
    name?: string;
    quantity?: number;
    minThreshold?: number;
}

interface Report {
    id: string;
    property_id: string;
    property_name: string;
    report_date: string;
    total_items: number;
    low_stock_count: number;
    total_added: number;
    total_removed: number;
    report_data: { items?: SnapshotItem[] } | null;
}

interface Payload {
    success: boolean;
    reports: Report[];
    total: number;
}

const WINDOW_DAYS = 7;
/** 13 properties x 8 days = 104 rows; 400 leaves headroom for new sites. */
const ROW_LIMIT = 400;

const isoDay = (offsetDays: number) =>
    new Date(Date.now() - offsetDays * 86_400_000).toISOString().slice(0, 10);

export default function StockWidget({ orgId, size, onSeverity, onHeadline, onFetchedAt }: WidgetProps) {
    // Both strings are day-granular, so the URL — and therefore the cache key — is stable
    // for the whole day and a resize never refetches.
    const url = orgId
        ? `/api/organizations/${orgId}/stock/reports?startDate=${isoDay(WINDOW_DAYS)}&endDate=${isoDay(0)}&limit=${ROW_LIMIT}`
        : null;
    const { data, loading, error, fetchedAt } = useWidgetData<Payload>(url, 5 * 60_000);

    const reports = data?.reports ?? [];

    // The endpoint sorts report_date DESC, so the first row per property is its newest
    // snapshot and the last is the week-ago baseline.
    const latest = new Map<string, Report>();
    const baseline = new Map<string, Report>();
    for (const r of reports) {
        if (!latest.has(r.property_id)) latest.set(r.property_id, r);
        baseline.set(r.property_id, r);
    }

    const current = [...latest.values()];
    const stocked = current.filter(r => r.total_items > 0);

    const low = stocked.reduce((a, r) => a + r.low_stock_count, 0);
    const items = stocked.reduce((a, r) => a + r.total_items, 0);
    const prevLow = [...baseline.values()].reduce((a, r) => a + r.low_stock_count, 0);
    const deltaPct = prevLow > 0 ? ((low - prevLow) / prevLow) * 100 : null;
    const lowShare = items > 0 ? (low / items) * 100 : 0;

    const snapshotItems = stocked.flatMap(r =>
        (r.report_data?.items || []).map(i => ({
            key: `${r.property_id}:${i.id ?? i.name ?? ''}`,
            name: i.name || 'Unnamed item',
            property: r.property_name,
            quantity: Number(i.quantity ?? 0),
            threshold: Number(i.minThreshold ?? 10),
        })),
    );
    const outOfStock = snapshotItems.filter(i => i.quantity <= 0);
    const belowLevel = snapshotItems
        .filter(i => i.quantity < i.threshold)
        .sort((a, b) => a.quantity - b.quantity || b.threshold - a.threshold);

    // Every add/remove column in the window is zero — see the header. Only worth saying
    // once there is stock to move in the first place.
    const movementBlind = stocked.length > 0 && reports.every(r => r.total_added === 0 && r.total_removed === 0);


    useEffect(() => { onFetchedAt?.(fetchedAt); }, [fetchedAt, onFetchedAt]);
    useEffect(() => {
        if (!data || stocked.length === 0) { onSeverity('ok'); onHeadline?.(null); return; }

        onSeverity(
            outOfStock.length > 0 && lowShare >= 50 ? 'critical'
                : lowShare >= 25 || outOfStock.length > 0 ? 'warn'
                    : low > 0 ? 'info' : 'ok',
        );

        onHeadline?.(
            low === 0
                ? `All ${items} tracked consumables are above their reorder level.`
                : `${low} of ${items} consumables are below reorder level`
                    + (outOfStock.length > 0 ? ` — ${outOfStock.length} at zero.` : '.'),
        );
    }, [data, stocked.length, low, items, lowShare, outOfStock.length, onSeverity, onHeadline]);

    if (loading) return <WidgetSkeleton lines={3} />;
    if (error === 'forbidden') return null;
    if (error) return <WidgetEmpty>Stock figures are unavailable.</WidgetEmpty>;
    if (stocked.length === 0) {
        return <WidgetEmpty>No site is tracking consumables yet.</WidgetEmpty>;
    }

    // sm — one question: how much is about to run out?
    if (size === 'sm') {
        return (
            <div className="h-full flex flex-col justify-between">
                <Metric value={low} sub="below reorder" size="sm" />
                <ProgressBar pct={lowShare} tone={lowShare >= 50 ? 'danger' : lowShare >= 25 ? 'warn' : 'success'} />
            </div>
        );
    }

    const wide = size === 'xl';
    const byProperty = [...stocked].sort((a, b) => b.low_stock_count - a.low_stock_count);

    return (
        <div className="h-full flex flex-col min-h-0">
            <div className="flex items-end justify-between gap-2">
                <Metric value={low} sub={`of ${items} consumables below reorder`} size={size} />
                <Delta pct={deltaPct} higherIsBetter={false} suffix={` vs ${WINDOW_DAYS}d`} />
            </div>

            <div className="mt-2.5">
                <ProgressBar pct={lowShare} tone={lowShare >= 50 ? 'danger' : lowShare >= 25 ? 'warn' : 'success'} />
                <div className="flex justify-between mt-1">
                    <span className="text-[10px] font-bold text-text-tertiary tabular-nums">
                        {lowShare.toFixed(0)}% of the catalogue
                    </span>
                    {outOfStock.length > 0 && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-black tabular-nums"
                            style={{ color: 'var(--error)' }}>
                            <AlertTriangle className="w-2.5 h-2.5" />{outOfStock.length} at zero
                        </span>
                    )}
                </div>
            </div>

            {(size === 'lg' || size === 'xl') && (
                <div className={`mt-3 flex-1 min-h-0 overflow-hidden ${wide ? 'grid grid-cols-[1fr_1.4fr] gap-4' : ''}`}>
                    <div className="min-w-0 overflow-hidden">
                        <p className="text-[9px] font-black uppercase tracking-widest text-text-tertiary mb-1">
                            By site
                        </p>
                        <div className="divide-y divide-border-subtle">
                            {byProperty.slice(0, wide ? 5 : 3).map(r => {
                                const share = r.total_items > 0 ? (r.low_stock_count / r.total_items) * 100 : 0;
                                return (
                                    <RankRow
                                        key={r.property_id}
                                        label={r.property_name}
                                        hint={`of ${r.total_items}`}
                                        value={r.low_stock_count}
                                        tone={share >= 50 ? 'danger' : share >= 25 ? 'warn' : undefined}
                                    />
                                );
                            })}
                        </div>
                    </div>

                    {/* xl — the actual shopping list, lowest first. */}
                    {wide && (
                        <div className="min-w-0 overflow-hidden border-l border-border-subtle pl-4">
                            <p className="text-[9px] font-black uppercase tracking-widest text-text-tertiary mb-1">
                                Reorder first
                            </p>
                            {belowLevel.length === 0 ? (
                                <p className="text-[11px] font-semibold text-text-tertiary">Nothing below level.</p>
                            ) : (
                                <div className="divide-y divide-border-subtle">
                                    {belowLevel.slice(0, 5).map(i => (
                                        <div key={i.key} className="flex items-center gap-2 py-1 min-w-0">
                                            <div className="min-w-0 flex-1">
                                                <p className="text-[11px] font-bold text-text-primary truncate" title={i.name}>
                                                    {i.name}
                                                </p>
                                                <p className="text-[10px] font-semibold text-text-tertiary truncate">
                                                    {i.property}
                                                </p>
                                            </div>
                                            <span className="text-[11px] font-black tabular-nums flex-none"
                                                style={{ color: i.quantity <= 0 ? 'var(--error)' : 'var(--warning)' }}>
                                                {i.quantity}
                                                <span className="text-text-tertiary font-bold">/{i.threshold}</span>
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}

            {movementBlind && (size === 'lg' || size === 'xl') && (
                <p className="mt-2 pt-2 border-t border-border-subtle text-[10px] font-semibold text-[var(--warning)] line-clamp-2">
                    The nightly snapshot has logged no stock movement for {WINDOW_DAYS} days — consumption cannot be
                    reported until the report job counts the previous day.
                </p>
            )}
        </div>
    );
}
