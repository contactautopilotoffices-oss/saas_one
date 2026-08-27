'use client';

import React, { useEffect } from 'react';
import { AlertTriangle } from 'lucide-react';
import type { WidgetProps } from '@/frontend/lib/dashboard/types';
import { useWidgetData, inr } from '@/frontend/lib/dashboard/useWidgetData';
import { Metric, RankRow, WidgetEmpty, WidgetSkeleton } from './WidgetShell';

/**
 * Purchase orders — "how much PO value is stuck waiting to be aligned".
 *
 * The headline is the VALUE in the align queue, not the count. Sixty small POs and one
 * eight-crore PO are the same number and completely different mornings; the count is
 * demoted to the subtitle where it belongs.
 *
 * STATUS COLOURS are fixed by the Payment Tracker and repeated here verbatim so the two
 * screens cannot drift: To Align = orange (--warning), Aligned = yellow (--secondary),
 * Completed = green (--success). Nothing new is introduced.
 *
 * COST. /api/accounts/summary pages through every purchase order in the org (5,265 today)
 * plus every payment tranche, so this passes a 5-minute ttl. The shared cache means a board
 * carrying both this card and the finance page's own fetch pays for one of them.
 */

interface QueueItem {
    id: string;
    po_number: string;
    vendor_name: string | null;
    po_amount: number;
    pending_amount: number;
    age_days: number | null;
    is_critical: boolean;
}

interface CompleteItem {
    id: string;
    po_number: string | null;
    vendor_name: string | null;
    requested_amount: number;
    age_days: number | null;
}

interface Bucket { count: number; value: number }

interface Payload {
    totals: { po_count: number; po_value: number };
    buckets: { to_align: Bucket; aligned: Bucket; completed: Bucket };
    queue: {
        align: { total_count: number; total_value: number; critical_count: number; items: QueueItem[] };
        complete: { total_count: number; total_value: number; items: CompleteItem[] };
    };
    top_vendors: Array<{ name: string; po_count: number; po_value: number; pending_value: number }>;
    can: { align: boolean; complete: boolean };
    generated_at: string;
}

const BUCKET = [
    { key: 'to_align', label: 'To align', colour: 'var(--warning)' },
    { key: 'aligned', label: 'Aligned', colour: 'var(--secondary)' },
    { key: 'completed', label: 'Completed', colour: 'var(--success)' },
] as const;

export default function PurchaseOrdersWidget({ orgId, size, onSeverity, onHeadline, onFetchedAt }: WidgetProps) {
    const { data, loading, error, fetchedAt } = useWidgetData<Payload>(
        orgId ? `/api/accounts/summary?org_id=${orgId}&period=month` : null, 5 * 60_000);

    const align = data?.queue?.align ?? null;


    useEffect(() => { onFetchedAt?.(fetchedAt); }, [fetchedAt, onFetchedAt]);
    useEffect(() => {
        if (!data || !align) { onSeverity('ok'); onHeadline?.(null); return; }

        onSeverity(
            align.critical_count > 0 ? 'critical'
                : align.total_count > 20 ? 'warn'
                    : align.total_count > 0 ? 'info' : 'ok',
        );

        onHeadline?.(
            align.total_count === 0
                ? 'Every purchase order is aligned to a payment.'
                : `${inr(align.total_value, { compact: true })} across ${align.total_count} PO${align.total_count === 1 ? '' : 's'} still needs a payment tranche`
                    + (align.critical_count > 0 ? ` — ${align.critical_count} flagged critical.` : '.'),
        );
    }, [data, align, onSeverity, onHeadline]);

    if (loading) return <WidgetSkeleton lines={3} />;
    if (error === 'forbidden') return null;
    // The Payment Tracker's queue view ships in 20260801000004. Until it is applied the
    // route 503s, which is a deployment step, not a fault — say so rather than "HTTP 503".
    if (error === 'HTTP 503') {
        return <WidgetEmpty>Payment Tracker is waiting on a database migration (20260801000004).</WidgetEmpty>;
    }
    if (error || !data || !align) return <WidgetEmpty>Purchase order figures are unavailable.</WidgetEmpty>;

    const b = data.buckets;
    const scale = Math.max(1, b.to_align.value + b.aligned.value + b.completed.value);

    // sm — one question: how much money is stuck?
    if (size === 'sm') {
        return (
            <div className="h-full flex flex-col justify-between">
                <Metric
                    value={inr(align.total_value, { compact: true })}
                    sub={`${align.total_count} PO${align.total_count === 1 ? '' : 's'} to align`}
                    size="sm"
                />
                {align.critical_count > 0 && (
                    <span className="inline-flex items-center gap-1 text-[10px] font-black tabular-nums"
                        style={{ color: 'var(--error)' }}>
                        <AlertTriangle className="w-2.5 h-2.5" />{align.critical_count} critical
                    </span>
                )}
            </div>
        );
    }

    const wide = size === 'xl';

    return (
        <div className="h-full flex flex-col min-h-0">
            <div className="flex items-end justify-between gap-2">
                <Metric
                    value={inr(align.total_value, { compact: true })}
                    sub={`waiting to be aligned · ${align.total_count} PO${align.total_count === 1 ? '' : 's'}`}
                    size={size}
                />
                {align.critical_count > 0 && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg flex-none text-[10px] font-black tabular-nums"
                        style={{ color: 'var(--error)', background: 'rgba(239, 68, 68, 0.10)' }}>
                        <AlertTriangle className="w-2.5 h-2.5" />{align.critical_count} critical
                    </span>
                )}
            </div>

            {/* Three-stage split bar on one scale: the pipeline, in the tracker's own colours. */}
            <div className="mt-2.5">
                <div className="h-2 w-full rounded-full bg-muted overflow-hidden flex" role="presentation">
                    {BUCKET.map(seg => (
                        <div key={seg.key} className="h-full transition-[width] duration-500"
                            style={{ width: `${(b[seg.key].value / scale) * 100}%`, background: seg.colour }} />
                    ))}
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5">
                    {BUCKET.map(seg => (
                        <span key={seg.key} className="inline-flex items-center gap-1.5 text-[10px] font-bold text-text-secondary">
                            <span className="w-1.5 h-1.5 rounded-full flex-none" style={{ background: seg.colour }} />
                            {seg.label}
                            <span className="tabular-nums text-text-tertiary">
                                {/* md gets counts only — three rupee figures wrap onto a
                                    second line the 104px row has no room for. */}
                                {size === 'md' ? b[seg.key].count : `${inr(b[seg.key].value, { compact: true })} · ${b[seg.key].count}`}
                            </span>
                        </span>
                    ))}
                </div>
            </div>

            {(size === 'lg' || size === 'xl') && (
                <div className={`mt-3 flex-1 min-h-0 overflow-hidden ${wide ? 'grid grid-cols-[1.5fr_1fr] gap-4' : ''}`}>
                    <div className="min-w-0 overflow-hidden">
                        <p className="text-[9px] font-black uppercase tracking-widest text-text-tertiary mb-1">
                            Biggest unaligned
                        </p>
                        {!data.can.align ? (
                            <p className="text-[11px] font-semibold text-text-tertiary">
                                You can view the totals but not the align queue.
                            </p>
                        ) : align.items.length === 0 ? (
                            <p className="text-[11px] font-semibold text-text-tertiary">Nothing waiting to be aligned.</p>
                        ) : (
                            <div className="divide-y divide-border-subtle">
                                {align.items.slice(0, wide ? 5 : 3).map(po => (
                                    <div key={po.id} className="flex items-center gap-2 py-1.5 min-w-0">
                                        {po.is_critical && (
                                            <span className="w-1.5 h-1.5 rounded-full flex-none"
                                                style={{ background: 'var(--error)' }} title="Flagged critical" />
                                        )}
                                        <div className="min-w-0 flex-1">
                                            <p className="text-[11px] font-bold text-text-primary truncate"
                                                title={po.vendor_name || undefined}>
                                                {po.vendor_name || 'Unnamed vendor'}
                                            </p>
                                            <p className="text-[10px] font-semibold text-text-tertiary truncate tabular-nums">
                                                {po.po_number}{po.age_days !== null ? ` · ${po.age_days}d old` : ''}
                                            </p>
                                        </div>
                                        <span className="text-[11px] font-black tabular-nums flex-none"
                                            style={{ color: po.is_critical ? 'var(--error)' : 'var(--warning)' }}>
                                            {inr(po.pending_amount, { compact: true })}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* xl — the second half of the pipeline plus who the money goes to. */}
                    {wide && (
                        <div className="min-w-0 overflow-hidden border-l border-border-subtle pl-4 flex flex-col">
                            <p className="text-[9px] font-black uppercase tracking-widest text-text-tertiary mb-1">
                                Awaiting UTR
                            </p>
                            <p className="text-[11px] font-black text-text-primary tabular-nums">
                                {inr(data.queue.complete.total_value, { compact: true })}
                                <span className="font-bold text-text-tertiary"> · {data.queue.complete.total_count} tranche{data.queue.complete.total_count === 1 ? '' : 's'}</span>
                            </p>

                            <p className="text-[9px] font-black uppercase tracking-widest text-text-tertiary mt-2.5 mb-1">
                                Top vendors
                            </p>
                            <div className="divide-y divide-border-subtle min-h-0 overflow-hidden">
                                {data.top_vendors.slice(0, 3).map(v => (
                                    <RankRow
                                        key={v.name}
                                        label={v.name}
                                        hint={`${v.po_count} PO${v.po_count === 1 ? '' : 's'}`}
                                        value={inr(v.po_value, { compact: true })}
                                    />
                                ))}
                                {data.top_vendors.length === 0 && (
                                    <p className="text-[11px] font-semibold text-text-tertiary">No POs dated this month.</p>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
