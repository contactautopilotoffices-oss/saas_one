'use client';

import React from 'react';
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { inr, monthLabel, type DiscountPerformance } from '@/frontend/lib/electricity/trackerTypes';

/**
 * Captured vs missed vs unverifiable, over time and per account.
 *
 * Three bars, not two — see backend/lib/electricity/tracker.ts. A bill marked paid with no
 * payment date logged cannot be scored as captured or missed, and folding it into "missed"
 * would invent a loss. Naming the worst offenders is the point: seven months in, the
 * unverifiable bucket alone (Rs 1,06,176 of the workbook's Rs 1,70,823 available discount)
 * is the strongest argument in the whole module for logging payment dates at all.
 */

interface Props {
    performance: DiscountPerformance;
}

const COLORS = { captured: 'var(--success)', missed: 'var(--error)', unverifiable: 'var(--text-tertiary)' };

export default function ElectricityDiscountPerformance({ performance }: Props) {
    const { totals, by_month: byMonth, by_account: byAccount } = performance;
    const captureRate = totals.available > 0 ? Math.round((totals.captured / totals.available) * 1000) / 10 : null;

    const chartRows = [...byMonth].reverse().map(m => ({
        label: monthLabel(m.month),
        Captured: m.captured,
        Missed: m.missed,
        Unverifiable: m.unverifiable,
    }));

    const worst = byAccount.filter(a => a.missed + a.unverifiable > 0).slice(0, 5);

    return (
        <div className="space-y-4">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <Tile label="Discount available" value={inr(totals.available, true)} />
                <Tile label="Captured" value={inr(totals.captured, true)} color={COLORS.captured}
                    sub={captureRate === null ? undefined : `${captureRate}% of available`} />
                <Tile label="Missed" value={inr(totals.missed, true)} color={COLORS.missed} />
                <Tile label="Unverifiable" value={inr(totals.unverifiable, true)} color={COLORS.unverifiable}
                    sub="paid with no date logged" />
            </div>

            <div className="rounded-2xl border border-border bg-surface p-4">
                <p className="text-[10px] font-black uppercase tracking-[0.14em] text-text-tertiary mb-3">
                    Discount outcome by month
                </p>
                {chartRows.length === 0 ? (
                    <p className="text-xs font-semibold text-text-tertiary text-center py-10">No history yet.</p>
                ) : (
                    <ResponsiveContainer width="100%" height={220}>
                        <BarChart data={chartRows} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                            <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--text-tertiary)' }} axisLine={false} tickLine={false} />
                            <YAxis tick={{ fontSize: 11, fill: 'var(--text-tertiary)' }} axisLine={false} tickLine={false} width={56}
                                tickFormatter={(v: number) => inr(v, true)} />
                            <Tooltip
                                cursor={{ fill: 'var(--muted)' }}
                                contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, fontSize: 12, fontWeight: 600 }}
                                formatter={(value) => inr(Number(value ?? 0))}
                            />
                            <Legend wrapperStyle={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)' }} />
                            <Bar dataKey="Captured" stackId="d" fill={COLORS.captured} radius={[0, 0, 0, 0]} />
                            <Bar dataKey="Missed" stackId="d" fill={COLORS.missed} />
                            <Bar dataKey="Unverifiable" stackId="d" fill={COLORS.unverifiable} radius={[4, 4, 0, 0]} />
                        </BarChart>
                    </ResponsiveContainer>
                )}
            </div>

            <div className="rounded-2xl border border-border bg-surface overflow-hidden">
                <p className="text-[10px] font-black uppercase tracking-[0.14em] text-text-tertiary px-4 pt-4">
                    Worst offenders — missed + unverifiable discount
                </p>
                {worst.length === 0 ? (
                    <p className="text-xs font-semibold text-text-tertiary text-center py-8">
                        No missed or unverifiable discount on record.
                    </p>
                ) : (
                    <div className="divide-y divide-border-subtle mt-2">
                        {worst.map(a => (
                            <div key={a.account_id} className="flex items-center gap-3 px-4 py-2.5">
                                <div className="min-w-0 flex-1">
                                    <p className="text-xs font-bold text-text-primary truncate">{a.site_label}</p>
                                    <p className="text-[10px] font-semibold text-text-tertiary truncate">
                                        {a.provider}{a.consumer_ref ? ` #${a.consumer_ref}` : ''}
                                    </p>
                                </div>
                                <div className="text-right shrink-0">
                                    {a.missed > 0 && (
                                        <p className="text-[11px] font-bold tabular-nums" style={{ color: COLORS.missed }}>
                                            {inr(a.missed, true)} missed
                                        </p>
                                    )}
                                    {a.unverifiable > 0 && (
                                        <p className="text-[11px] font-bold tabular-nums" style={{ color: COLORS.unverifiable }}>
                                            {inr(a.unverifiable, true)} unverifiable
                                        </p>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}

function Tile({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
    return (
        <div className="rounded-2xl border border-border bg-surface px-4 py-3">
            <p className="text-[10px] font-black uppercase tracking-[0.12em] text-text-tertiary truncate">{label}</p>
            <p className="text-xl lg:text-2xl font-extrabold tabular-nums mt-1" style={{ color: color || 'var(--text-primary)' }}>
                {value}
            </p>
            {sub && <p className="text-[11px] font-semibold text-text-tertiary mt-0.5 truncate">{sub}</p>}
        </div>
    );
}
