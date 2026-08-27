'use client';

import React, { useEffect } from 'react';
import { AlertTriangle } from 'lucide-react';
import type { WidgetProps } from '@/frontend/lib/dashboard/types';
import { useWidgetData, compactNumber } from '@/frontend/lib/dashboard/useWidgetData';
import { Metric, Delta, RankRow, WidgetEmpty, WidgetSkeleton } from './WidgetShell';

/**
 * Electricity consumption pace.
 *
 * Replaces a tile that showed "0 kWh", which answered nothing. A raw month-to-date total is
 * meaningless on the 2nd of the month, so this always renders the like-for-like comparison:
 * consumption so far this month against the SAME number of days last month, restricted to
 * meters that reported in both windows.
 *
 * It also surfaces data quality, because 13 of 2,219 readings are impossible (a 1000x meter
 * multiplier plus three dropped-digit entries) and they inflate July 2026 to 717 million kWh.
 * A broken pipeline outranks any consumption number — there is no point discussing a trend
 * computed from figures nobody believes.
 */

interface Payload {
    provisioned: boolean;
    as_of: string;
    day_of_month: number;
    current: { units: number; cost: number; meters: number };
    previous: { units: number; cost: number; meters: number };
    comparable: boolean;
    comparable_meters: number;
    delta_pct: number | null;
    projected_month_units: number | null;
    severity: 'ok' | 'info' | 'warn' | 'critical';
    verdict: string | null;
    data_quality: {
        provisioned: boolean;
        excluded_readings: number;
        anomalies: Array<{ id: string; meter_name: string | null; property_name: string | null; anomaly_kind: string; times_typical: number | null }>;
    };
    properties: Array<{ property_id: string; name: string; current: number; previous: number; delta_pct: number | null }>;
}

const KIND_LABEL: Record<string, string> = {
    suspect_multiplier: 'multiplier looks wrong',
    suspected_digit_drop: 'digit missing from reading',
    meter_initialisation: 'meter reset row',
    negative_consumption: 'reading went backwards',
    outlier: 'far above typical',
};

export default function ElectricityPaceWidget({ orgId, size, onSeverity, onHeadline, onFetchedAt }: WidgetProps) {
    const { data, loading, error, fetchedAt } = useWidgetData<Payload>(
        orgId ? `/api/electricity/pace?org_id=${orgId}` : null, 5 * 60_000);

    const bad = data?.data_quality?.excluded_readings ?? 0;


    useEffect(() => { onFetchedAt?.(fetchedAt); }, [fetchedAt, onFetchedAt]);
    useEffect(() => {
        if (!data?.provisioned) { onSeverity('ok'); onHeadline?.(null); return; }
        onSeverity(data.severity);
        onHeadline?.(
            bad > 0
                ? `${bad} impossible reading${bad === 1 ? '' : 's'} excluded — fix these before trusting the trend.`
                : data.verdict,
        );
    }, [data, bad, onSeverity, onHeadline]);

    if (loading) return <WidgetSkeleton />;
    if (error === 'forbidden') return null;
    if (!data?.provisioned) return <WidgetEmpty>No electricity data available.</WidgetEmpty>;

    const { current, previous, delta_pct, comparable } = data;

    if (size === 'sm') {
        return (
            <div className="h-full flex flex-col justify-between">
                <Metric value={`${compactNumber(current.units)}`} sub="kWh this month" size="sm" />
                {comparable ? <Delta pct={delta_pct} higherIsBetter={false} />
                    : <span className="text-[10px] font-bold text-text-tertiary">too early to compare</span>}
            </div>
        );
    }

    return (
        <div className="h-full flex flex-col min-h-0">
            <div className="flex items-end justify-between gap-2">
                <Metric
                    value={`${compactNumber(current.units)}`}
                    sub={`kWh · first ${data.day_of_month} day${data.day_of_month === 1 ? '' : 's'}`}
                    size={size}
                />
                {comparable && <Delta pct={delta_pct} higherIsBetter={false} />}
            </div>

            {/* Paired bars: this period against the same window last period. Two bars on a
                shared scale is the most direct read of "more or less than before". */}
            {comparable && (
                <div className="mt-3 space-y-1.5">
                    {[
                        { label: 'This month', v: current.units, strong: true },
                        { label: 'Same days last month', v: previous.units, strong: false },
                    ].map(row => {
                        const max = Math.max(current.units, previous.units, 1);
                        return (
                            <div key={row.label} className="flex items-center gap-2">
                                <span className="text-[9px] font-bold text-text-tertiary w-[92px] flex-none truncate">
                                    {row.label}
                                </span>
                                <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                                    <div className="h-full rounded-full transition-[width] duration-500"
                                        style={{
                                            width: `${(row.v / max) * 100}%`,
                                            background: row.strong ? 'var(--energy-grid)' : 'var(--border)',
                                        }} />
                                </div>
                                <span className="text-[10px] font-black tabular-nums text-text-secondary w-12 text-right flex-none">
                                    {compactNumber(row.v)}
                                </span>
                            </div>
                        );
                    })}
                    {data.projected_month_units !== null && (
                        <p className="text-[10px] font-semibold text-text-tertiary pt-0.5">
                            On pace for ~{compactNumber(data.projected_month_units)} kWh this month.
                        </p>
                    )}
                </div>
            )}

            {/* No inline verdict here: sm returns above with its own copy, and at md and
                above the same sentence is already the card headline. Printing it twice was
                what made the first render look duplicated. */}

            {bad > 0 && (
                <div className="mt-2.5 p-2 rounded-xl bg-[var(--warning)]/10 border border-[var(--warning)]/25">
                    <div className="flex items-center gap-1.5">
                        <AlertTriangle className="w-3 h-3 text-[var(--warning)] flex-none" />
                        <span className="text-[10px] font-black text-[var(--warning)]">
                            {bad} reading{bad === 1 ? '' : 's'} excluded as impossible
                        </span>
                    </div>
                    {(size === 'lg' || size === 'xl') && data.data_quality.anomalies.slice(0, 2).map(a => (
                        <p key={a.id} className="text-[10px] font-semibold text-text-secondary mt-1 truncate">
                            {a.property_name} · {a.meter_name} — {KIND_LABEL[a.anomaly_kind] || a.anomaly_kind}
                            {a.times_typical ? ` (${compactNumber(a.times_typical)}× typical)` : ''}
                        </p>
                    ))}
                </div>
            )}

            {(size === 'lg' || size === 'xl') && data.properties.length > 0 && (
                <div className="mt-2.5 flex-1 min-h-0 overflow-hidden">
                    <p className="text-[9px] font-black uppercase tracking-widest text-text-tertiary mb-0.5">
                        Biggest movers
                    </p>
                    <div className="divide-y divide-border-subtle">
                        {data.properties.slice(0, size === 'xl' ? 4 : 2).map(p => (
                            <RankRow
                                key={p.property_id}
                                label={p.name}
                                hint={`${compactNumber(p.current)} kWh`}
                                value={p.delta_pct === null ? '—' : `${p.delta_pct > 0 ? '+' : ''}${p.delta_pct.toFixed(0)}%`}
                                tone={p.delta_pct !== null && p.delta_pct >= 12 ? 'danger' : undefined}
                            />
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
