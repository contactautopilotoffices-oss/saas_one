'use client';

import React from 'react';
import { format } from 'date-fns';
import { AlertTriangle, Clock, TrendingDown, CheckCircle2 } from 'lucide-react';
import { inr, monthLabel, type Deadlines, type DeadlineBucketRow } from '@/frontend/lib/electricity/trackerTypes';

/**
 * "What to pay now." Money at risk is the headline, not bill count — a single Rs 40,000
 * discount expiring tomorrow matters more than five Rs 500 bills due next week, and a list
 * sorted or led by count alone would bury it.
 */

interface Props {
    deadlines: Deadlines;
}

const dfmt = (d: string | null) => (d ? format(new Date(`${d}T00:00:00`), 'dd/MM/yyyy') : '—');

export default function ElectricityBillDeadlines({ deadlines }: Props) {
    const { overdue, due_soon: dueSoon, discount_expiring: discountExpiring, upcoming, money_at_risk: risk, open_value: openValue } = deadlines;
    const totalOpen = overdue.length + dueSoon.length + discountExpiring.length + upcoming.length;

    return (
        <div className="space-y-4">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <Tile
                    label="Discount at risk"
                    value={inr(risk.discount_at_risk, true)}
                    sub="expires if not paid in time"
                    color="var(--warning)"
                />
                <Tile
                    label="Penalty exposure"
                    value={inr(risk.penalty_exposure, true)}
                    sub="extra owed once overdue"
                    color="var(--error)"
                />
                <Tile
                    label="Open bill value"
                    value={inr(openValue, true)}
                    sub={`${totalOpen} bill${totalOpen === 1 ? '' : 's'} unpaid`}
                />
                <Tile
                    label="Overdue"
                    value={String(overdue.length)}
                    sub={overdue.length ? 'act on these first' : 'nothing overdue'}
                    color={overdue.length ? 'var(--error)' : 'var(--success)'}
                />
            </div>

            {totalOpen === 0 ? (
                <div className="rounded-2xl border border-border bg-surface p-10 text-center">
                    <CheckCircle2 className="w-6 h-6 mx-auto mb-2" style={{ color: 'var(--success)' }} />
                    <p className="text-sm font-bold text-text-primary">Every bill is settled.</p>
                </div>
            ) : (
                <div className="space-y-3">
                    <Group
                        title="Overdue"
                        icon={<AlertTriangle className="w-4 h-4" style={{ color: 'var(--error)' }} />}
                        rows={overdue}
                        tone="var(--error)"
                        cutoffLabel="was due"
                    />
                    <Group
                        title="Discount expiring within 3 days"
                        icon={<TrendingDown className="w-4 h-4" style={{ color: 'var(--warning)' }} />}
                        rows={discountExpiring}
                        tone="var(--warning)"
                        cutoffLabel="pay by"
                    />
                    <Group
                        title="Due within 3 days"
                        icon={<Clock className="w-4 h-4" style={{ color: 'var(--warning)' }} />}
                        rows={dueSoon}
                        tone="var(--warning)"
                        cutoffLabel="due"
                    />
                    {upcoming.length > 0 && (
                        <Group
                            title="Open, nothing urgent yet"
                            icon={<Clock className="w-4 h-4 text-text-tertiary" />}
                            rows={upcoming}
                            tone="var(--text-tertiary)"
                            cutoffLabel="due"
                            collapsedByDefault
                        />
                    )}
                </div>
            )}
        </div>
    );
}

function Tile({ label, value, sub, color }: { label: string; value: string; sub: string; color?: string }) {
    return (
        <div className="rounded-2xl border border-border bg-surface px-4 py-3">
            <p className="text-[10px] font-black uppercase tracking-[0.12em] text-text-tertiary truncate">{label}</p>
            <p className="text-xl lg:text-2xl font-extrabold tabular-nums mt-1" style={{ color: color || 'var(--text-primary)' }}>
                {value}
            </p>
            <p className="text-[11px] font-semibold text-text-tertiary mt-0.5 truncate">{sub}</p>
        </div>
    );
}

function Group({
    title, icon, rows, tone, cutoffLabel, collapsedByDefault,
}: {
    title: string; icon: React.ReactNode; rows: DeadlineBucketRow[]; tone: string; cutoffLabel: string;
    collapsedByDefault?: boolean;
}) {
    const [open, setOpen] = React.useState(!collapsedByDefault);
    if (!rows.length) return null;

    const total = rows.reduce((s, r) => s + (r.money_at_risk || 0), 0);

    return (
        <div className="rounded-2xl border border-border bg-surface overflow-hidden">
            <button
                onClick={() => setOpen(v => !v)}
                className="w-full flex items-center gap-2.5 px-4 py-3 text-left hover:bg-muted transition-colors"
            >
                {icon}
                <p className="text-sm font-bold text-text-primary">{title}</p>
                <span className="text-[11px] font-bold text-text-tertiary">({rows.length})</span>
                {total > 0 && (
                    <span className="ml-auto text-xs font-extrabold tabular-nums" style={{ color: tone }}>
                        {inr(total, true)} at risk
                    </span>
                )}
            </button>

            {open && (
                <div className="border-t border-border divide-y divide-border-subtle">
                    {rows.map(r => (
                        <div key={r.id} className="flex items-center gap-3 px-4 py-2.5">
                            <div className="min-w-0 flex-1">
                                <p className="text-xs font-bold text-text-primary truncate">
                                    {r.site_label}
                                    <span className="text-text-tertiary font-semibold"> · {r.provider}{r.consumer_ref ? ` #${r.consumer_ref}` : ''}</span>
                                </p>
                                <p className="text-[10px] font-semibold text-text-tertiary mt-0.5">
                                    {monthLabel(r.billing_month)} · {cutoffLabel} {dfmt(r.cutoff_date)}
                                </p>
                            </div>
                            <div className="text-right shrink-0">
                                <p className="text-xs font-extrabold tabular-nums text-text-primary">{inr(r.amount_due, true)}</p>
                                {r.money_at_risk > 0 && (
                                    <p className="text-[10px] font-bold tabular-nums" style={{ color: tone }}>
                                        {inr(r.money_at_risk, true)} at risk
                                    </p>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
