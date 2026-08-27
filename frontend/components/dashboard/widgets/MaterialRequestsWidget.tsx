'use client';

import React, { useEffect } from 'react';
import { Clock } from 'lucide-react';
import type { WidgetProps } from '@/frontend/lib/dashboard/types';
import { useWidgetData } from '@/frontend/lib/dashboard/useWidgetData';
import { Metric, RankRow, WidgetEmpty, WidgetSkeleton } from './WidgetShell';

/**
 * Material requests — "how many site requests are stuck, and for how long".
 *
 * NO MONEY IS SHOWN, ON PURPOSE. Every material_requests.total_amount and every line item's
 * total_price in this database is zero: pricing happens later, in the comparative quotes.
 * A "Rs 0 pending" tile would be a confident lie, so the story is entirely count-and-age.
 *
 * The endpoint is a purpose-built aggregate — GET /api/procurement/requests returns raw rows
 * with five nested joins and an await-per-row permission check, which is fine for the
 * procurement worklist and unusable for a dashboard card.
 *
 * The two open states are separated because they need different people: `needs_quote` is
 * procurement's to price, `needs_decision` is an approver's to sign. Lumping them into
 * "pending" hides which queue is actually blocked.
 */

interface OldestRow {
    id: string;
    status: string | null;
    bucket: string;
    age_days: number;
    property_name: string;
    ticket_number: string | null;
    ticket_title: string | null;
    assignee_name: string | null;
    item_count: number;
}

interface Payload {
    provisioned: boolean;
    totals: {
        requests: number; open: number; needs_quote: number; needs_decision: number;
        in_flight: number; closed: number; oldest_days: number; median_wait_days: number;
    } | null;
    by_status: Array<{ status: string; count: number; bucket: string }>;
    by_property: Array<{ property_id: string; property_name: string; open: number; oldest_days: number }>;
    oldest: OldestRow[];
}

const BUCKET = {
    needs_quote: { label: 'Needs a quote', colour: 'var(--warning)' },
    needs_decision: { label: 'Needs a decision', colour: 'var(--info)' },
    in_flight: { label: 'Ordered', colour: 'var(--secondary)' },
} as const;

type BucketKey = keyof typeof BUCKET;

const STATUS_LABEL: Record<string, string> = {
    pending_quotation: 'Awaiting quotation',
    pending_approval: 'Awaiting approval',
    quoted: 'Quoted, undecided',
    negotiating: 'Negotiating',
    approved: 'Approved',
    ordered: 'Ordered',
};

export default function MaterialRequestsWidget({ orgId, size, onSeverity, onHeadline, onFetchedAt }: WidgetProps) {
    const { data, loading, error, fetchedAt } = useWidgetData<Payload>(
        orgId ? `/api/organizations/${orgId}/material-requests-summary` : null, 2 * 60_000);

    const t = data?.totals ?? null;


    useEffect(() => { onFetchedAt?.(fetchedAt); }, [fetchedAt, onFetchedAt]);
    useEffect(() => {
        if (!data?.provisioned || !t) { onSeverity('ok'); onHeadline?.(null); return; }

        // A month-old material request means a site has been waiting a month for a part.
        onSeverity(
            t.oldest_days >= 30 ? 'critical'
                : t.oldest_days >= 14 ? 'warn'
                    : t.open > 0 ? 'info' : 'ok',
        );

        onHeadline?.(
            t.open === 0
                ? 'No material requests are waiting on anyone.'
                : `${t.open} request${t.open === 1 ? '' : 's'} open — oldest ${t.oldest_days}d, typical wait ${t.median_wait_days}d.`,
        );
    }, [data, t, onSeverity, onHeadline]);

    if (loading) return <WidgetSkeleton lines={3} />;
    if (error === 'forbidden') return null;
    if (!data?.provisioned || !t) return <WidgetEmpty>Material requests are not set up here.</WidgetEmpty>;

    const scale = Math.max(1, t.needs_quote + t.needs_decision + t.in_flight);

    // sm — one question: is anything waiting?
    if (size === 'sm') {
        return (
            <div className="h-full flex flex-col justify-between">
                <Metric value={t.open} sub="requests open" size="sm" />
                {t.oldest_days > 0 && (
                    <span className="inline-flex items-center gap-1 text-[10px] font-bold tabular-nums"
                        style={{ color: t.oldest_days >= 14 ? 'var(--error)' : 'var(--text-tertiary)' }}>
                        <Clock className="w-2.5 h-2.5" />oldest {t.oldest_days}d
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
                    value={t.open}
                    sub={`open of ${t.requests} raised · typical wait ${t.median_wait_days}d`}
                    size={size}
                />
                {t.oldest_days > 0 && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg flex-none text-[10px] font-black tabular-nums"
                        style={t.oldest_days >= 14
                            ? { color: 'var(--error)', background: 'rgba(239, 68, 68, 0.10)' }
                            : { color: 'var(--text-tertiary)', background: 'var(--muted)' }}>
                        <Clock className="w-2.5 h-2.5" />oldest {t.oldest_days}d
                    </span>
                )}
            </div>

            {/* Who is holding each request up, on one shared scale. */}
            <div className="mt-2.5">
                <div className="h-2 w-full rounded-full bg-muted overflow-hidden flex" role="presentation">
                    {(Object.keys(BUCKET) as BucketKey[]).map(k => (
                        <div key={k} className="h-full transition-[width] duration-500"
                            style={{ width: `${(t[k] / scale) * 100}%`, background: BUCKET[k].colour }} />
                    ))}
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5">
                    {(Object.keys(BUCKET) as BucketKey[]).filter(k => t[k] > 0).map(k => (
                        <span key={k} className="inline-flex items-center gap-1.5 text-[10px] font-bold text-text-secondary">
                            <span className="w-1.5 h-1.5 rounded-full flex-none" style={{ background: BUCKET[k].colour }} />
                            <span className="tabular-nums">{t[k]}</span> {BUCKET[k].label.toLowerCase()}
                        </span>
                    ))}
                    {t.open === 0 && (
                        <span className="text-[10px] font-bold text-text-tertiary">Nothing outstanding.</span>
                    )}
                </div>
            </div>

            {(size === 'lg' || size === 'xl') && (
                <div className={`mt-3 flex-1 min-h-0 overflow-hidden ${wide ? 'grid grid-cols-[1.6fr_1fr] gap-4' : ''}`}>
                    <div className="min-w-0 overflow-hidden">
                        <p className="text-[9px] font-black uppercase tracking-widest text-text-tertiary mb-1">
                            Waiting longest
                        </p>
                        {data.oldest.length === 0 ? (
                            <p className="text-[11px] font-semibold text-text-tertiary">Nothing outstanding.</p>
                        ) : (
                            <div className="divide-y divide-border-subtle">
                                {data.oldest.slice(0, wide ? 5 : 3).map(r => {
                                    const bucket = BUCKET[r.bucket as BucketKey];
                                    return (
                                        <div key={r.id} className="flex items-start gap-2 py-1.5 min-w-0">
                                            <span className="w-1.5 h-1.5 rounded-full flex-none mt-1.5"
                                                style={{ background: bucket?.colour || 'var(--border)' }}
                                                title={bucket?.label} />
                                            <div className="min-w-0 flex-1">
                                                <p className="text-[11px] font-bold text-text-primary truncate"
                                                    title={r.ticket_title || undefined}>
                                                    {r.ticket_title || r.ticket_number || 'Material request'}
                                                </p>
                                                <p className="text-[10px] font-semibold text-text-tertiary truncate">
                                                    {r.property_name}
                                                    {r.status ? ` · ${STATUS_LABEL[r.status] || r.status}` : ''}
                                                    {r.assignee_name ? ` · ${r.assignee_name}` : ''}
                                                </p>
                                            </div>
                                            <span className="text-[10px] font-black tabular-nums flex-none pt-0.5"
                                                style={{ color: r.age_days >= 30 ? 'var(--error)' : r.age_days >= 14 ? 'var(--warning)' : 'var(--text-tertiary)' }}>
                                                {r.age_days}d
                                            </span>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>

                    {/* xl — which site is waiting, and on which stage. */}
                    {wide && (
                        <div className="min-w-0 overflow-hidden border-l border-border-subtle pl-4">
                            <p className="text-[9px] font-black uppercase tracking-widest text-text-tertiary mb-1">
                                By site
                            </p>
                            <div className="divide-y divide-border-subtle">
                                {data.by_property.slice(0, 3).map(p => (
                                    <RankRow
                                        key={p.property_id}
                                        label={p.property_name}
                                        hint={`${p.oldest_days}d`}
                                        value={p.open}
                                        tone={p.oldest_days >= 30 ? 'danger' : p.oldest_days >= 14 ? 'warn' : undefined}
                                    />
                                ))}
                                {data.by_property.length === 0 && (
                                    <p className="text-[11px] font-semibold text-text-tertiary">No open requests.</p>
                                )}
                            </div>

                            {data.by_status.length > 0 && (
                                <>
                                    <p className="text-[9px] font-black uppercase tracking-widest text-text-tertiary mt-2.5 mb-1">
                                        By stage
                                    </p>
                                    <div className="flex flex-wrap gap-1.5">
                                        {data.by_status.slice(0, 4).map(s => (
                                            <span key={s.status}
                                                className="px-2 py-0.5 rounded-lg text-[10px] font-bold tabular-nums"
                                                style={{
                                                    color: BUCKET[s.bucket as BucketKey]?.colour || 'var(--text-tertiary)',
                                                    background: 'var(--muted)',
                                                }}>
                                                {STATUS_LABEL[s.status] || s.status} {s.count}
                                            </span>
                                        ))}
                                    </div>
                                </>
                            )}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
