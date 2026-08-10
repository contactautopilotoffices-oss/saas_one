'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
    ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
    ResponsiveContainer, Cell,
} from 'recharts';
import { inr, monthLabel, type AopTrend, type AopTrendPoint } from '@/frontend/lib/aop/types';

/**
 * Budget vs actual over the months on record, for whatever slice was drilled into.
 *
 * Actual is a bar and budget a line, not two bars. Two bars invite the eye to compare
 * bar-to-bar within a month and lose the far more important comparison — the trajectory
 * across months. A line reads as "the plan", a bar as "what happened against it", and the
 * bar crossing above the line is the whole story in one glance.
 *
 * Bars are tinted only where the month went over plan. On a three-point series a full
 * colour scale would be decoration, not information.
 */

interface Props {
    orgId: string;
    siteId?: string | null;
    lineItemCode?: string | null;
    height?: number;
    /** Suppresses the internal heading when the parent already names the slice. */
    bare?: boolean;
}

interface ChartRow extends AopTrendPoint {
    label: string;
    over: boolean;
}

export default function AopTrendChart({ orgId, siteId, lineItemCode, height = 220, bare }: Props) {
    const [data, setData] = useState<AopTrend | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Same shape as AopSiteDetail/AopWorkspace: the fetch owns its own loading state so
    // the effect stays a plain trigger.
    const load = useCallback(async () => {
        if (!orgId) return;
        setLoading(true);
        setError(null);
        try {
            const qs = new URLSearchParams({ org_id: orgId });
            if (siteId) qs.set('site_id', siteId);
            if (lineItemCode) qs.set('line_item_code', lineItemCode);

            const res = await fetch(`/api/aop/trend?${qs.toString()}`);
            const payload = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(payload?.error || 'Could not load the trend');
            setData(payload as AopTrend);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not load the trend');
        } finally {
            setLoading(false);
        }
    }, [orgId, siteId, lineItemCode]);

    useEffect(() => { void load(); }, [load]);

    if (loading) {
        return <div className="animate-pulse rounded-xl bg-muted" style={{ height }} />;
    }
    if (error) {
        return <p className="text-xs font-semibold text-text-tertiary py-6 text-center">{error}</p>;
    }
    if (!data?.points?.length) {
        return <p className="text-xs font-semibold text-text-tertiary py-6 text-center">No history for this selection yet.</p>;
    }

    const rows: ChartRow[] = data.points.map(p => ({
        ...p,
        label: monthLabel(p.month),
        over: p.saving < 0,
    }));

    const latest = rows[rows.length - 1];

    return (
        <div>
            {!bare && (
                <div className="flex items-baseline justify-between gap-3 mb-2">
                    <p className="text-[10px] font-black uppercase tracking-[0.14em] text-text-tertiary">
                        {data.scope?.label || 'Trend'}
                    </p>
                    <p
                        className="text-[11px] font-bold tabular-nums"
                        style={{ color: latest.saving < 0 ? 'var(--error)' : 'var(--success)' }}
                    >
                        {latest.saving < 0
                            ? `${inr(-latest.saving, true)} over plan`
                            : `${inr(latest.saving, true)} under plan`}
                    </p>
                </div>
            )}

            <ResponsiveContainer width="100%" height={height}>
                <ComposedChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                    <XAxis
                        dataKey="label"
                        tick={{ fontSize: 11, fill: 'var(--text-tertiary)' }}
                        axisLine={false}
                        tickLine={false}
                    />
                    <YAxis
                        tick={{ fontSize: 11, fill: 'var(--text-tertiary)' }}
                        axisLine={false}
                        tickLine={false}
                        width={56}
                        tickFormatter={(v: number) => inr(v, true)}
                    />
                    <Tooltip
                        cursor={{ fill: 'var(--muted)' }}
                        contentStyle={{
                            background: 'var(--surface)',
                            border: '1px solid var(--border)',
                            borderRadius: 12,
                            fontSize: 12,
                            fontWeight: 600,
                            color: 'var(--text-primary)',
                        }}
                        labelStyle={{ color: 'var(--text-secondary)', fontWeight: 800 }}
                        formatter={(value, name) => [inr(Number(value ?? 0)), String(name ?? '')]}
                    />
                    <Legend
                        wrapperStyle={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)' }}
                        iconType="plainline"
                    />
                    <Bar dataKey="actual" name="Actual" radius={[4, 4, 0, 0]} maxBarSize={44}>
                        {rows.map(r => (
                            <Cell
                                key={r.month}
                                fill={r.over ? 'var(--error)' : 'var(--primary)'}
                                fillOpacity={r.over ? 0.75 : 0.55}
                            />
                        ))}
                    </Bar>
                    <Line
                        type="monotone"
                        dataKey="budget"
                        name="Budget"
                        stroke="var(--secondary)"
                        strokeWidth={2}
                        strokeDasharray="5 4"
                        dot={{ r: 3, fill: 'var(--secondary)' }}
                    />
                </ComposedChart>
            </ResponsiveContainer>
        </div>
    );
}
