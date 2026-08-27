'use client';

import React, { useEffect } from 'react';
import { Clock } from 'lucide-react';
import type { WidgetProps } from '@/frontend/lib/dashboard/types';
import { useWidgetData, inr } from '@/frontend/lib/dashboard/useWidgetData';
import { Metric, WidgetSetup, WidgetSkeleton } from './WidgetShell';

/**
 * Electricity bills — early-payment discount at risk.
 *
 * Story: "Which bills are about to cost us money by sitting still?"
 *
 * Most boards on this portfolio discount an early payment and penalise a late one. Over the
 * seven months on file the discount was worth ~Rs 1.7 lakh, of which only Rs 16,497 can be
 * proven captured and Rs 48,150 was demonstrably paid late. Nobody can track 15 accounts x
 * 12 months of dates by hand — this is the single clearest case on the board for a tile that
 * taps you on the shoulder.
 *
 * Money at risk is the headline rather than bill count, because two overdue bills worth
 * Rs 400 and Rs 4 lakh are not the same problem and a count cannot tell them apart.
 */

interface OpenBill {
    id: string;
    site_label: string;
    provider: string;
    consumer_ref: string | null;
    billing_month: string;
    due_date: string | null;
    early_payment_date: string | null;
    total_amount: number | null;
    days_to_early_payment: number | null;
    days_to_due: number | null;
    discount_at_risk: number | null;
    penalty_exposure: number | null;
    urgency: 'overdue' | 'due_soon' | 'discount_expiring' | 'discount_missed' | 'ok' | 'settled';
}

interface Payload {
    provisioned: boolean;
    severity: 'ok' | 'info' | 'warn' | 'critical';
    headline: string;
    totals: {
        open: number; overdue: number; due_soon: number; discount_expiring: number;
        open_value: number; discount_at_risk: number; penalty_exposure: number;
    };
    history: {
        discount_available: number; discount_captured: number;
        discount_missed: number; discount_unverifiable: number;
        capture_rate_pct: number | null;
    };
    open: OpenBill[];
}

const URGENCY_STYLE: Record<OpenBill['urgency'], { label: string; color: string; bg: string }> = {
    overdue: { label: 'Overdue', color: 'var(--error)', bg: 'rgba(239,68,68,0.10)' },
    due_soon: { label: 'Due soon', color: 'var(--warning)', bg: 'rgba(245,158,11,0.12)' },
    discount_expiring: { label: 'Discount ends', color: 'var(--warning)', bg: 'rgba(245,158,11,0.12)' },
    discount_missed: { label: 'Discount gone', color: 'var(--text-tertiary)', bg: 'var(--muted)' },
    ok: { label: 'Open', color: 'var(--info)', bg: 'rgba(59,130,246,0.10)' },
    settled: { label: 'Paid', color: 'var(--success)', bg: 'rgba(16,185,129,0.12)' },
};

export default function ElectricityBillsWidget({ orgId, size, onSeverity, onHeadline, onFetchedAt }: WidgetProps) {
    const { data, loading, error, fetchedAt } = useWidgetData<Payload>(
        orgId ? `/api/electricity/bills?org_id=${orgId}` : null, 5 * 60_000);


    useEffect(() => { onFetchedAt?.(fetchedAt); }, [fetchedAt, onFetchedAt]);
    useEffect(() => {
        if (!data?.provisioned) { onSeverity('ok'); onHeadline?.(null); return; }
        onSeverity(data.severity);
        onHeadline?.(data.headline);
    }, [data, onSeverity, onHeadline]);

    if (loading) return <WidgetSkeleton />;
    if (error === 'forbidden') return null;
    if (!data?.provisioned) {
        return <WidgetSetup label="Not connected yet" hint="Apply the bills migration, then run the import." />;
    }

    const t = data.totals;
    const atRisk = t.discount_at_risk + t.penalty_exposure;

    if (size === 'sm') {
        return (
            <div className="h-full flex flex-col justify-between">
                <Metric
                    value={atRisk > 0 ? inr(atRisk, { compact: true }) : String(t.open)}
                    sub={atRisk > 0 ? 'at risk' : 'bills open'}
                    size="sm"
                />
                {t.overdue > 0 && (
                    <span className="text-[10px] font-black" style={{ color: 'var(--error)' }}>
                        {t.overdue} overdue
                    </span>
                )}
            </div>
        );
    }

    return (
        <div className="h-full flex flex-col min-h-0">
            <div className="flex items-end justify-between gap-2">
                <Metric
                    value={atRisk > 0 ? inr(atRisk, { compact: true }) : inr(t.open_value, { compact: true })}
                    sub={atRisk > 0 ? `at risk across ${t.open} open bill${t.open === 1 ? '' : 's'}` : `${t.open} bills open`}
                    size={size}
                />
            </div>

            <div className="mt-2.5 flex flex-wrap gap-1.5">
                {t.overdue > 0 && (
                    <span className="px-2 py-0.5 rounded-lg text-[10px] font-black"
                        style={{ color: 'var(--error)', background: 'rgba(239,68,68,0.10)' }}>
                        {t.overdue} overdue
                    </span>
                )}
                {t.discount_expiring > 0 && (
                    <span className="px-2 py-0.5 rounded-lg text-[10px] font-black"
                        style={{ color: 'var(--warning)', background: 'rgba(245,158,11,0.12)' }}>
                        {t.discount_expiring} discount ending
                    </span>
                )}
                {t.due_soon > 0 && (
                    <span className="px-2 py-0.5 rounded-lg text-[10px] font-black"
                        style={{ color: 'var(--warning)', background: 'rgba(245,158,11,0.12)' }}>
                        {t.due_soon} due soon
                    </span>
                )}
                {t.overdue === 0 && t.discount_expiring === 0 && t.due_soon === 0 && (
                    <span className="px-2 py-0.5 rounded-lg text-[10px] font-black"
                        style={{ color: 'var(--success)', background: 'rgba(16,185,129,0.12)' }}>
                        nothing urgent
                    </span>
                )}
            </div>

            {(size === 'lg' || size === 'xl') && (
                <div className="mt-3 flex-1 min-h-0 overflow-hidden">
                    <p className="text-[9px] font-black uppercase tracking-widest text-text-tertiary mb-1">
                        Act on these first
                    </p>
                    {data.open.length === 0 ? (
                        <p className="text-[11px] font-semibold text-text-tertiary">Every bill is settled.</p>
                    ) : (
                        <div className="space-y-1">
                            {data.open.slice(0, size === 'xl' ? 5 : 3).map(b => {
                                const s = URGENCY_STYLE[b.urgency];
                                const days = b.urgency === 'overdue' ? b.days_to_due : b.days_to_early_payment;
                                const risk = (b.discount_at_risk || 0) + (b.penalty_exposure || 0);
                                return (
                                    <div key={b.id} className="flex items-center gap-2 min-w-0">
                                        <span className="w-1.5 h-1.5 rounded-full flex-none"
                                            style={{ background: s.color }} />
                                        <span className="text-[11px] font-bold text-text-primary truncate flex-1 min-w-0">
                                            {b.site_label}
                                            {b.consumer_ref && (
                                                <span className="text-text-tertiary font-semibold"> #{b.consumer_ref}</span>
                                            )}
                                        </span>
                                        {days !== null && (
                                            <span className="text-[10px] font-bold flex-none tabular-nums"
                                                style={{ color: s.color }}>
                                                {days < 0 ? `${Math.abs(days)}d late` : `${days}d`}
                                            </span>
                                        )}
                                        <span className="text-[11px] font-black text-text-primary tabular-nums flex-none w-14 text-right">
                                            {risk > 0 ? inr(risk, { compact: true }) : inr(b.total_amount, { compact: true })}
                                        </span>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            )}

            {size === 'xl' && data.history.discount_available > 0 && (
                <div className="mt-2 pt-2 border-t border-border-subtle">
                    <div className="flex items-center gap-1.5 mb-1">
                        <Clock className="w-3 h-3 text-text-tertiary" />
                        <span className="text-[9px] font-black uppercase tracking-widest text-text-tertiary">
                            Discount history
                        </span>
                    </div>
                    {/* Three buckets, not two. A bill paid with no date recorded cannot be
                        scored either way, and calling that "missed" would invent a loss. */}
                    <div className="flex h-2 rounded-full overflow-hidden bg-muted">
                        {([
                            ['captured', data.history.discount_captured, 'var(--success)'],
                            ['missed', data.history.discount_missed, 'var(--error)'],
                            ['unverified', data.history.discount_unverifiable, 'var(--border)'],
                        ] as const).map(([k, v, c]) => (
                            <div key={k} style={{
                                width: `${(v / data.history.discount_available) * 100}%`,
                                background: c,
                            }} />
                        ))}
                    </div>
                    <div className="flex justify-between mt-1 text-[10px] font-bold">
                        <span style={{ color: 'var(--success)' }}>
                            {inr(data.history.discount_captured, { compact: true })} captured
                        </span>
                        <span style={{ color: 'var(--error)' }}>
                            {inr(data.history.discount_missed, { compact: true })} missed
                        </span>
                        <span className="text-text-tertiary">
                            {inr(data.history.discount_unverifiable, { compact: true })} unlogged
                        </span>
                    </div>
                </div>
            )}
        </div>
    );
}
