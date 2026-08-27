'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, CheckCircle2, IndianRupee, Loader2, RefreshCw, X } from 'lucide-react';
import {
    inr, monthLabel,
    type PaymentQueueBill, type PaymentRun, type PaymentRunQueuePayload, type PaymentRunsPayload,
} from '@/frontend/lib/electricity/trackerTypes';

/**
 * The Accounts-side queue for electricity payment runs (Phase 6). Submitted runs arrive
 * here; each bill carries the scenario the org super admin picked and its pay-by date.
 * "Mark paid" follows the MarkPaidModal pattern (portal modal, confirm → PATCH) and
 * completes the loop: payment_status='paid', the amount folds into AOP actuals.
 */

interface Props {
    orgId?: string;
    /** Mirrors caps.canComplete in AccountsDashboard — only disbursers mark bills paid. */
    canMarkPaid: boolean;
}

interface RunWithBills {
    run: PaymentRun;
    bills: PaymentQueueBill[];
}

const SCENARIO_LABEL = { early: 'Early', due: 'On due', late: 'Late' } as const;

const dfmt = (d: string | null | undefined) =>
    d ? new Date(`${d.slice(0, 10)}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

export default function ElectricityPaymentQueue({ orgId, canMarkPaid }: Props) {
    const [runs, setRuns] = useState<RunWithBills[] | null>(null);
    const [unprovisioned, setUnprovisioned] = useState(false);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [paying, setPaying] = useState<{ run: PaymentRun; bill: PaymentQueueBill } | null>(null);

    const load = useCallback(async (quiet = false) => {
        if (quiet) setRefreshing(true); else setLoading(true);
        setError(null);
        try {
            const p = new URLSearchParams();
            if (orgId) p.set('org_id', orgId);
            const res = await fetch(`/api/electricity/payment-runs?${p}`);
            const payload = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(payload?.error || 'Could not load electricity payment runs');
            const list = payload as PaymentRunsPayload;
            if (!list.provisioned) { setUnprovisioned(true); setRuns([]); return; }
            setUnprovisioned(false);

            // Drafts are still with the org super admin — the queue starts at 'submitted'.
            const active = (list.runs || []).filter(r => r.status !== 'draft');
            const withBills = await Promise.all(active.map(async run => {
                const r = await fetch(`/api/electricity/payment-runs?run_id=${run.id}${orgId ? `&org_id=${orgId}` : ''}`);
                const q = await r.json().catch(() => ({}));
                if (!r.ok) throw new Error(q?.error || 'Could not load a payment run');
                return { run, bills: (q as PaymentRunQueuePayload).bills || [] };
            }));
            setRuns(withBills);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not load electricity payment runs');
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, [orgId]);

    useEffect(() => { void load(); }, [load]);

    if (loading) {
        return (
            <div className="flex items-center justify-center py-24 text-text-tertiary">
                <Loader2 className="w-6 h-6 animate-spin" />
            </div>
        );
    }

    if (error) {
        return (
            <div className="rounded-2xl border border-border bg-surface p-8 text-center">
                <AlertTriangle className="w-6 h-6 mx-auto mb-3" style={{ color: 'var(--warning)' }} />
                <p className="text-sm font-bold text-text-primary">{error}</p>
                <button onClick={() => void load()} className="mt-3 text-xs font-bold text-primary">Try again</button>
            </div>
        );
    }

    if (unprovisioned) {
        return (
            <div className="rounded-2xl border border-border bg-surface p-10 text-center">
                <AlertTriangle className="w-6 h-6 mx-auto mb-3" style={{ color: 'var(--warning)' }} />
                <p className="text-sm font-bold text-text-primary">Electricity payment runs are not set up yet</p>
                <p className="text-xs font-semibold text-text-tertiary mt-2 max-w-md mx-auto">
                    Apply supabase/migrations/20260804000005_electricity_payment_runs.sql to enable the
                    electricity payment workflow.
                </p>
            </div>
        );
    }

    const open = (runs || []).filter(r => r.run.status !== 'completed');
    const done = (runs || []).filter(r => r.run.status === 'completed');

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between gap-3">
                <p className="text-[11px] font-semibold text-text-tertiary">
                    {open.length > 0
                        ? `${open.length} run${open.length === 1 ? '' : 's'} awaiting payment${done.length > 0 ? ` · ${done.length} completed` : ''}.`
                        : 'No electricity runs awaiting payment.'}
                </p>
                <button
                    onClick={() => void load(true)}
                    className="p-2 rounded-xl border border-border text-text-secondary hover:text-text-primary hover:bg-muted transition-colors"
                    aria-label="Refresh"
                >
                    <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
                </button>
            </div>

            {(runs || []).length === 0 ? (
                <div className="rounded-2xl border border-border bg-surface p-12 text-center">
                    <IndianRupee className="w-8 h-8 mx-auto mb-3 text-text-tertiary" />
                    <p className="text-sm font-bold text-text-primary">Nothing submitted yet</p>
                    <p className="text-xs font-semibold text-text-tertiary mt-1">
                        Runs land here when the org super admin submits the month&rsquo;s scenario form.
                    </p>
                </div>
            ) : (
                [...open, ...done].map(({ run, bills }) => (
                    <div key={run.id} className="rounded-2xl border border-border bg-surface overflow-hidden">
                        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-border bg-surface-elevated">
                            <p className="text-sm font-bold text-text-primary">
                                {monthLabel(run.period_month)} run
                                <span className="ml-2 text-[11px] font-semibold text-text-tertiary">
                                    {inr(bills.reduce((s, b) => s + (Number(b.scenario_amount) || 0), 0))} · {bills.length} bill{bills.length === 1 ? '' : 's'}
                                </span>
                            </p>
                            <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg text-[10px] font-bold"
                                style={run.status === 'completed'
                                    ? { color: 'var(--success)', background: 'rgba(34,197,94,0.10)' }
                                    : { color: 'var(--warning)', background: 'rgba(245,158,11,0.10)' }}>
                                <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'currentColor' }} />
                                {run.status === 'completed' ? 'Completed' : 'Awaiting payment'}
                            </span>
                        </div>

                        <table className="w-full border-collapse">
                            <thead>
                                <tr className="border-b border-border">
                                    <th className="px-4 py-2 text-left text-[10px] font-black uppercase tracking-[0.08em] text-text-tertiary">Account</th>
                                    <th className="px-4 py-2 text-left text-[10px] font-black uppercase tracking-[0.08em] text-text-tertiary">Month</th>
                                    <th className="px-4 py-2 text-left text-[10px] font-black uppercase tracking-[0.08em] text-text-tertiary">Scenario</th>
                                    <th className="px-4 py-2 text-right text-[10px] font-black uppercase tracking-[0.08em] text-text-tertiary">Amount</th>
                                    <th className="px-4 py-2 text-right text-[10px] font-black uppercase tracking-[0.08em] text-text-tertiary">Pay by</th>
                                    <th className="px-4 py-2 text-left text-[10px] font-black uppercase tracking-[0.08em] text-text-tertiary">Status</th>
                                    <th className="px-4 py-2 text-right text-[10px] font-black uppercase tracking-[0.08em] text-text-tertiary" />
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border-subtle">
                                {bills.map(b => {
                                    const paid = b.bill?.payment_status === 'paid';
                                    return (
                                        <tr key={b.id} className="hover:bg-muted/60 transition-colors">
                                            <td className="px-4 py-[7px] text-[11px] font-bold text-text-primary">
                                                <span className="truncate block max-w-[200px]">{b.bill?.account?.site_label || '—'}</span>
                                                <span className="block text-[10px] font-semibold text-text-tertiary">
                                                    {b.bill?.account?.provider}{b.bill?.account?.consumer_ref ? ` #${b.bill.account.consumer_ref}` : ''}
                                                </span>
                                            </td>
                                            <td className="px-4 py-[7px] text-[11px] font-semibold text-text-secondary whitespace-nowrap">
                                                {monthLabel(b.bill?.billing_month)}
                                            </td>
                                            <td className="px-4 py-[7px] text-[11px] font-semibold text-text-secondary">
                                                {SCENARIO_LABEL[b.scenario]}
                                            </td>
                                            <td className="px-4 py-[7px] text-[11px] text-right tabular-nums font-extrabold text-text-primary">
                                                {inr(b.scenario_amount)}
                                            </td>
                                            <td className="px-4 py-[7px] text-[11px] text-right tabular-nums font-semibold text-text-secondary whitespace-nowrap">
                                                {dfmt(b.pay_by_date)}
                                            </td>
                                            <td className="px-4 py-[7px]">
                                                {paid ? (
                                                    <span className="inline-flex items-center gap-1.5 text-[10px] font-bold" style={{ color: 'var(--success)' }}>
                                                        <CheckCircle2 className="w-3.5 h-3.5" /> Paid {dfmt(b.bill?.payment_date)}
                                                    </span>
                                                ) : (
                                                    <span className="text-[10px] font-bold" style={{ color: 'var(--warning)' }}>Unpaid</span>
                                                )}
                                            </td>
                                            <td className="px-4 py-[7px] text-right">
                                                {canMarkPaid && !paid && run.status !== 'completed' && (
                                                    <button
                                                        onClick={() => setPaying({ run, bill: b })}
                                                        className="px-3 py-1.5 bg-primary text-white rounded-lg text-xs font-bold hover:bg-primary/90"
                                                    >
                                                        Mark paid ▸
                                                    </button>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })}
                                {bills.length === 0 && (
                                    <tr>
                                        <td colSpan={7} className="px-4 py-8 text-center text-xs font-semibold text-text-tertiary">
                                            No bills in this run.
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                ))
            )}

            {paying && (
                <ElectricityMarkPaidModal
                    run={paying.run}
                    bill={paying.bill}
                    onClose={() => setPaying(null)}
                    onDone={() => { setPaying(null); void load(true); }}
                />
            )}
        </div>
    );
}

/** Same shape as accounts/MarkPaidModal: summary strip, amount + date, confirm → PATCH. */
function ElectricityMarkPaidModal({ run, bill, onClose, onDone }: {
    run: PaymentRun;
    bill: PaymentQueueBill;
    onClose: () => void;
    onDone: () => void;
}) {
    const [paidAmount, setPaidAmount] = useState(String(Math.round(Number(bill.scenario_amount) || 0)));
    const [paymentDate, setPaymentDate] = useState(new Date().toISOString().slice(0, 10));
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const submit = async () => {
        if (!paymentDate) { setError('Payment date is required'); return; }
        if (!paidAmount || Number(paidAmount) <= 0) { setError('Paid amount is required'); return; }
        setSaving(true);
        setError(null);
        try {
            const res = await fetch(`/api/electricity/payment-runs/${run.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'mark_paid',
                    bill_id: bill.bill_id,
                    payment_date: paymentDate,
                    paid_amount: Number(paidAmount),
                }),
            });
            const payload = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(payload?.error || 'Could not mark the bill paid');
            onDone();
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not mark the bill paid');
        } finally {
            setSaving(false);
        }
    };

    if (typeof document === 'undefined') return null;
    const field = 'w-full px-3 py-2 border border-border rounded-lg text-sm bg-surface text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-primary/20';
    const label = 'block text-xs font-bold text-text-secondary uppercase tracking-wide mb-1.5';

    return createPortal(
        <div className="fixed inset-0 bg-black/50 z-[80] flex items-center justify-center p-4" onClick={onClose}>
            <div onClick={e => e.stopPropagation()} className="bg-surface rounded-2xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col">
                <div className="flex items-center justify-between px-6 py-4 border-b border-border">
                    <h3 className="text-base font-bold text-text-primary">
                        Mark paid · {bill.bill?.account?.site_label || 'Electricity bill'}
                    </h3>
                    <button onClick={onClose} className="p-2 hover:bg-muted rounded-xl"><X className="w-5 h-5 text-text-secondary" /></button>
                </div>

                <div className="px-6 py-4 space-y-4">
                    <div className="bg-surface-elevated rounded-xl p-3 text-sm">
                        <div className="flex justify-between"><span className="text-text-tertiary">Scenario</span><span className="text-text-primary font-medium">{SCENARIO_LABEL[bill.scenario]}</span></div>
                        <div className="flex justify-between mt-1"><span className="text-text-tertiary">Expected</span><span className="text-text-primary font-medium">{inr(bill.scenario_amount)}</span></div>
                        <div className="flex justify-between mt-1"><span className="text-text-tertiary">Pay by</span><span className="text-text-primary font-medium">{dfmt(bill.pay_by_date)}</span></div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <div><label className={label}>Paid amount (₹) *</label><input type="number" value={paidAmount} onChange={e => setPaidAmount(e.target.value)} className={field} /></div>
                        <div><label className={label}>Payment date *</label><input type="date" value={paymentDate} onChange={e => setPaymentDate(e.target.value)} className={field} /></div>
                    </div>

                    <p className="text-[11px] text-text-tertiary">
                        On confirm the bill is marked paid and the amount folds into the AOP Electricity
                        actuals for {monthLabel(bill.bill?.billing_month)}.
                    </p>
                    {error && <p className="text-sm" style={{ color: 'var(--error)' }}>{error}</p>}
                </div>

                <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border bg-surface-elevated">
                    <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-text-secondary hover:bg-muted rounded-xl">Cancel</button>
                    <button
                        onClick={submit}
                        disabled={saving}
                        className="inline-flex items-center gap-1.5 px-5 py-2 bg-primary text-white rounded-xl text-sm font-bold hover:bg-primary/90 disabled:opacity-50"
                    >
                        {saving && <Loader2 className="w-4 h-4 animate-spin" />} Confirm payment
                    </button>
                </div>
            </div>
        </div>,
        document.body,
    );
}
