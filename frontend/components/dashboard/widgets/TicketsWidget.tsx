'use client';

import React, { useEffect } from 'react';
import { AlertTriangle } from 'lucide-react';
import type { WidgetProps } from '@/frontend/lib/dashboard/types';
import { useWidgetData, compactNumber } from '@/frontend/lib/dashboard/useWidgetData';
import { Metric, Delta, ProgressBar, RankRow, WidgetEmpty, WidgetSkeleton } from './WidgetShell';

/**
 * Ticket backlog and SLA risk.
 *
 * WHY period=all AND NOT period=month. Every count this route returns is scoped to a
 * created_at cohort, so `month` answers "of the tickets raised since the 1st, how many are
 * still open" — which today is zero, while 274 tickets raised earlier are still sitting
 * open and 118 have blown their SLA. A card that reads "0 open" next to a real backlog of
 * 274 is worse than no card. `all` makes the cohort the whole history, which for
 * still-active statuses is exactly the live backlog.
 *
 * WHAT IS DELIBERATELY MISSING: avg_resolution_hours. The route hardcodes it to 0 — it is
 * a placeholder, not a measurement — so it is not rendered anywhere here.
 *
 * COST. The route issues roughly 10 + 7 per property count queries; at 13 properties that
 * is ~100 round trips, hence the 5-minute ttl.
 */

interface PropertyRow {
    property_id: string;
    property_name: string;
    property_code: string | null;
    total: number;
    open: number;
    waitlist: number;
    in_progress: number;
    resolved: number;
    pending_validation: number;
    urgent_open: number;
}

interface Payload {
    organization_id: string;
    period: string;
    total_tickets: number;
    open_tickets: number;
    waitlist: number;
    in_progress: number;
    resolved: number;
    pending_validation: number;
    sla_breached: number;
    urgent_open: number;
    properties: PropertyRow[];
    trends: { total: number[]; resolved: number[]; active: number[]; pending: number[] };
}

const sum = (xs: number[] | undefined) => (xs || []).reduce((a, b) => a + b, 0);

export default function TicketsWidget({ orgId, size, onSeverity, onHeadline, onFetchedAt }: WidgetProps) {
    const { data, loading, error, fetchedAt } = useWidgetData<Payload>(
        orgId ? `/api/organizations/${orgId}/tickets-summary?period=all` : null, 5 * 60_000);

    // "Active" is every state a ticket can sit in without being finished. Pending
    // validation counts: the work may be done, but the ticket is not, and somebody still
    // owes it a decision.
    const active = data ? data.open_tickets + data.in_progress + data.pending_validation : 0;
    const breached = data?.sla_breached ?? 0;


    useEffect(() => { onFetchedAt?.(fetchedAt); }, [fetchedAt, onFetchedAt]);
    useEffect(() => {
        if (!data) { onSeverity('ok'); onHeadline?.(null); return; }

        const share = active > 0 ? breached / active : 0;
        onSeverity(
            breached >= 20 || share >= 0.25 ? 'critical'
                : breached > 0 || data.urgent_open >= 5 ? 'warn'
                    : active > 0 ? 'info' : 'ok',
        );

        onHeadline?.(
            active === 0
                ? 'No open tickets anywhere in the estate.'
                : breached > 0
                    ? `${breached} of ${active} open tickets are past their SLA deadline.`
                    : `${active} tickets open, none past SLA.`,
        );
    }, [data, active, breached, onSeverity, onHeadline]);

    if (loading) return <WidgetSkeleton lines={3} />;
    if (error === 'forbidden') return null;
    if (error || !data) return <WidgetEmpty>Ticket figures are unavailable.</WidgetEmpty>;

    const raised30 = sum(data.trends?.total);
    const closed30 = sum(data.trends?.resolved);
    // Positive = closing faster than tickets arrive. Higher is better, so the chip is
    // told as much — otherwise "+18%" would render red for good news.
    const clearance = raised30 > 0 ? ((closed30 - raised30) / raised30) * 100 : null;
    const breachShare = active > 0 ? (breached / active) * 100 : 0;

    // sm — one question: how big is the backlog?
    if (size === 'sm') {
        return (
            <div className="h-full flex flex-col justify-between">
                <Metric value={compactNumber(active)} sub="tickets open" size="sm" />
                {breached > 0 && (
                    <span className="inline-flex items-center gap-1 text-[10px] font-black tabular-nums"
                        style={{ color: 'var(--error)' }}>
                        <AlertTriangle className="w-2.5 h-2.5" />{breached} past SLA
                    </span>
                )}
            </div>
        );
    }

    const wide = size === 'xl';
    const byActive = [...data.properties]
        .map(p => ({ ...p, active: p.open + p.in_progress + p.pending_validation }))
        .sort((a, b) => b.active - a.active || b.urgent_open - a.urgent_open);

    return (
        <div className="h-full flex flex-col min-h-0">
            <div className="flex items-end justify-between gap-2">
                <Metric
                    value={compactNumber(active)}
                    sub={breached > 0 ? `open · ${breached} past SLA` : 'tickets open'}
                    size={size}
                />
                <Delta pct={clearance} higherIsBetter />
            </div>

            {/* Are we keeping up? Two bars on a shared scale beat any trend line for the
                one comparison that matters: arrivals against departures. */}
            <div className="mt-2.5 space-y-1.5">
                {[
                    { label: 'Raised · 30d', v: raised30, colour: 'var(--info)' },
                    { label: 'Closed · 30d', v: closed30, colour: 'var(--success)' },
                ].map(row => {
                    const max = Math.max(raised30, closed30, 1);
                    return (
                        <div key={row.label} className="flex items-center gap-2">
                            <span className="text-[9px] font-bold text-text-tertiary w-[76px] flex-none truncate">
                                {row.label}
                            </span>
                            <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                                <div className="h-full rounded-full transition-[width] duration-500"
                                    style={{ width: `${(row.v / max) * 100}%`, background: row.colour }} />
                            </div>
                            <span className="text-[10px] font-black tabular-nums text-text-secondary w-9 text-right flex-none">
                                {compactNumber(row.v)}
                            </span>
                        </div>
                    );
                })}
            </div>

            {/* md has ~52px of body once the headline is drawn, and the SLA share is
                already in the subtitle there — so the bar is an lg/xl elaboration. */}
            {breached > 0 && size !== 'md' && (
                <div className="mt-2.5">
                    <ProgressBar pct={breachShare} tone={breachShare >= 25 ? 'danger' : 'warn'} />
                    <p className="text-[10px] font-bold text-text-tertiary mt-1 tabular-nums">
                        {breachShare.toFixed(0)}% of the open backlog has already breached SLA
                    </p>
                </div>
            )}

            {(size === 'lg' || size === 'xl') && (
                <div className={`mt-3 flex-1 min-h-0 overflow-hidden ${wide ? 'grid grid-cols-[1.5fr_1fr] gap-4' : ''}`}>
                    <div className="min-w-0 overflow-hidden">
                        <p className="text-[9px] font-black uppercase tracking-widest text-text-tertiary mb-1">
                            Where the backlog sits
                        </p>
                        {byActive.length === 0 || byActive[0].active === 0 ? (
                            <p className="text-[11px] font-semibold text-text-tertiary">Every site is clear.</p>
                        ) : (
                            <div className="divide-y divide-border-subtle">
                                {byActive.filter(p => p.active > 0).slice(0, wide ? 5 : 3).map(p => (
                                    <RankRow
                                        key={p.property_id}
                                        label={p.property_name}
                                        hint={p.urgent_open > 0 ? `${p.urgent_open} urgent` : undefined}
                                        value={p.active}
                                        tone={p.urgent_open > 0 ? 'warn' : undefined}
                                    />
                                ))}
                            </div>
                        )}
                    </div>

                    {/* xl — what the backlog is actually made of, so it can be routed. */}
                    {wide && (
                        <div className="min-w-0 overflow-hidden border-l border-border-subtle pl-4">
                            <p className="text-[9px] font-black uppercase tracking-widest text-text-tertiary mb-1">
                                Breakdown
                            </p>
                            <div className="divide-y divide-border-subtle">
                                <RankRow label="Unassigned / blocked" value={data.open_tickets} />
                                <RankRow label="Being worked" value={data.in_progress} />
                                <RankRow
                                    label="Awaiting validation"
                                    value={data.pending_validation}
                                    tone={data.pending_validation > 0 ? 'warn' : undefined}
                                />
                                <RankRow label="On waitlist" value={data.waitlist} />
                                <RankRow
                                    label="Urgent, still open"
                                    value={data.urgent_open}
                                    tone={data.urgent_open > 0 ? 'danger' : undefined}
                                />
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
