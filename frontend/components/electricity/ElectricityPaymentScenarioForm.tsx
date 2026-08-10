'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Loader2, RefreshCw, Send } from 'lucide-react';
import { useAuth } from '@/frontend/context/AuthContext';
import {
    inr, monthLabel,
    type PaymentRunsPayload, type PaymentScenario,
} from '@/frontend/lib/electricity/trackerTypes';

/**
 * Phase 6 — the 3-scenario payment form. For the chosen month: every 'verified' bill
 * with its early / on-due / late amounts, one radio per row. Selections save immediately
 * into the month's draft run; Submit hands the run to Accounts (bills → sent_to_accounts,
 * accounts role gets pending actions). Selecting and submitting are org-super-admin-only
 * — the API enforces the accepter side of the checker/accepter split; the UI just keeps
 * the buttons out of reach for everyone else.
 */

interface Props {
    orgId: string;
    /** Month to open initially, 'YYYY-MM' — defaults to the current month. */
    initialMonth?: string;
}

const SCENARIOS: { key: PaymentScenario; label: string }[] = [
    { key: 'early', label: 'Early' },
    { key: 'due', label: 'Due' },
    { key: 'late', label: 'Late' },
];

const dfmt = (d: string | null) =>
    d ? new Date(`${d.slice(0, 10)}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '—';

export default function ElectricityPaymentScenarioForm({ orgId, initialMonth }: Props) {
    const { membership } = useAuth();
    const roles = [membership?.org_role, ...(membership?.all_org_memberships?.map(m => m.role) || [])].filter(Boolean) as string[];
    const isSuperAdmin = roles.some(r => ['org_super_admin', 'master_admin', 'owner'].includes(r));

    const [month, setMonth] = useState(initialMonth || new Date().toISOString().slice(0, 7));
    const [data, setData] = useState<PaymentRunsPayload | null>(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [busyBill, setBusyBill] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);
    const [actionError, setActionError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);

    const load = useCallback(async (quiet = false) => {
        if (quiet) setRefreshing(true); else setLoading(true);
        setError(null);
        try {
            const res = await fetch(`/api/electricity/payment-runs?org_id=${orgId}&month=${month}`);
            const payload = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(payload?.error || 'Could not load the payment form');
            setData(payload as PaymentRunsPayload);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not load the payment form');
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, [orgId, month]);

    useEffect(() => { void load(); }, [load]);

    const draft = data?.draft_run ?? null;
    const form = data?.form ?? [];

    const totals = useMemo(() => {
        const t = { early: 0, due: 0, late: 0, selected: 0 };
        for (const row of form) {
            if (row.selection) {
                t[row.selection.scenario] += Number(row.selection.scenario_amount) || 0;
                t.selected += Number(row.selection.scenario_amount) || 0;
            }
        }
        return t;
    }, [form]);

    const select = async (billId: string, scenario: PaymentScenario) => {
        if (!draft || !isSuperAdmin) return;
        setBusyBill(billId);
        setActionError(null);
        setNotice(null);
        try {
            const res = await fetch(`/api/electricity/payment-runs/${draft.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'select', bill_id: billId, scenario }),
            });
            const payload = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(payload?.error || 'Could not save the selection');
            // Local echo — a full refetch per radio click would make the form feel broken.
            setData(prev => prev && ({
                ...prev,
                form: (prev.form || []).map(r => r.bill_id === billId ? { ...r, selection: payload.selection } : r),
            }));
        } catch (e) {
            setActionError(e instanceof Error ? e.message : 'Could not save the selection');
        } finally {
            setBusyBill(null);
        }
    };

    const openRun = async () => {
        setSubmitting(true);
        setActionError(null);
        try {
            const res = await fetch('/api/electricity/payment-runs', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ period_month: month, organization_id: orgId }),
            });
            const payload = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(payload?.error || 'Could not open the payment run');
            await load(true);
        } catch (e) {
            setActionError(e instanceof Error ? e.message : 'Could not open the payment run');
        } finally {
            setSubmitting(false);
        }
    };

    const submit = async () => {
        if (!draft) return;
        setSubmitting(true);
        setActionError(null);
        setNotice(null);
        try {
            const res = await fetch(`/api/electricity/payment-runs/${draft.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'submit' }),
            });
            const payload = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(payload?.error || 'Could not submit the run');
            setNotice(`Submitted to Accounts — ${inr(totals.selected)} across ${form.filter(r => r.selection).length} bills.`);
            await load(true);
        } catch (e) {
            setActionError(e instanceof Error ? e.message : 'Could not submit the run');
        } finally {
            setSubmitting(false);
        }
    };

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

    if (!data?.provisioned) {
        return (
            <div className="rounded-2xl border border-border bg-surface p-10 text-center">
                <AlertTriangle className="w-6 h-6 mx-auto mb-3" style={{ color: 'var(--warning)' }} />
                <p className="text-sm font-bold text-text-primary">Payment runs are not set up yet</p>
                <p className="text-xs font-semibold text-text-tertiary mt-2 max-w-md mx-auto">
                    Apply supabase/migrations/20260804000005_electricity_payment_runs.sql to enable the
                    payment workflow.
                </p>
            </div>
        );
    }

    const allSelected = form.length > 0 && form.every(r => r.selection);
    const submittedRun = data.runs.find(r => r.period_month.startsWith(month) && r.status !== 'draft');

    return (
        <div className="space-y-3">
            {actionError && (
                <div className="flex items-center justify-between gap-3 px-3 py-2 rounded-xl border text-[11px] font-bold"
                    style={{ color: 'var(--error)', borderColor: 'var(--error)', background: 'rgba(239,68,68,0.06)' }}>
                    {actionError}
                    <button onClick={() => setActionError(null)} className="font-black">Dismiss</button>
                </div>
            )}
            {notice && (
                <div className="px-3 py-2 rounded-xl border border-border text-[11px] font-bold"
                    style={{ color: 'var(--success)', background: 'rgba(34,197,94,0.06)' }}>
                    {notice}
                </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
                <input
                    type="month"
                    value={month}
                    onChange={e => setMonth(e.target.value)}
                    className="px-2.5 py-1.5 rounded-xl border border-border bg-surface text-[11px] font-bold text-text-primary outline-none focus:border-primary"
                />
                {!isSuperAdmin && (
                    <span className="text-[11px] font-semibold text-text-tertiary">
                        Scenario selection is reserved for org super admins.
                    </span>
                )}
                <button
                    onClick={() => void load(true)}
                    className="ml-auto p-2 rounded-xl border border-border text-text-secondary hover:text-text-primary hover:bg-muted transition-colors"
                    aria-label="Refresh"
                >
                    <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
                </button>
            </div>

            {submittedRun && (
                <p className="text-[11px] font-semibold text-text-tertiary">
                    This month&rsquo;s run was submitted {submittedRun.submitted_at
                        ? `on ${new Date(submittedRun.submitted_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`
                        : ''} — status {submittedRun.status}. Track it in Accounts → Electricity payments.
                </p>
            )}

            {form.length === 0 ? (
                <div className="rounded-2xl border border-border bg-surface p-10 text-center">
                    <p className="text-sm font-bold text-text-primary">No verified bills for {monthLabel(`${month}-01`)}</p>
                    <p className="text-xs font-semibold text-text-tertiary mt-2 max-w-md mx-auto">
                        Bills appear here once the checker signs them off in the Validation queue.
                    </p>
                </div>
            ) : (
                <div className="rounded-2xl border border-border bg-surface overflow-hidden">
                    <div className="overflow-auto max-h-[62vh]">
                        <table className="w-full border-collapse">
                            <thead className="sticky top-0 z-10 bg-surface-elevated">
                                <tr className="border-b border-border">
                                    <th className="px-3 py-2 text-left text-[10px] font-black uppercase tracking-[0.08em] text-text-tertiary">Account</th>
                                    <th className="px-3 py-2 text-right text-[10px] font-black uppercase tracking-[0.08em] text-text-tertiary">Early (by date)</th>
                                    <th className="px-3 py-2 text-right text-[10px] font-black uppercase tracking-[0.08em] text-text-tertiary">On due date</th>
                                    <th className="px-3 py-2 text-right text-[10px] font-black uppercase tracking-[0.08em] text-text-tertiary">After due</th>
                                    <th className="px-3 py-2 text-center text-[10px] font-black uppercase tracking-[0.08em] text-text-tertiary">Scenario</th>
                                    <th className="px-3 py-2 text-right text-[10px] font-black uppercase tracking-[0.08em] text-text-tertiary">Pay by</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border-subtle">
                                {form.map(row => (
                                    <tr key={row.bill_id} className="hover:bg-muted/60 transition-colors">
                                        <td className="px-3 py-[7px] text-[11px] font-bold text-text-primary">
                                            <span className="truncate block max-w-[200px]">{row.site_label}</span>
                                            <span className="block text-[10px] font-semibold text-text-tertiary">
                                                {row.provider}{row.consumer_ref ? ` #${row.consumer_ref}` : ''}
                                            </span>
                                        </td>
                                        <td className="px-3 py-[7px] text-[11px] text-right tabular-nums font-semibold text-text-secondary">
                                            {inr(row.early_payment_amount)}
                                            <span className="block text-[10px] text-text-tertiary">{dfmt(row.early_payment_date)}</span>
                                        </td>
                                        <td className="px-3 py-[7px] text-[11px] text-right tabular-nums font-extrabold text-text-primary">
                                            {inr(row.total_amount)}
                                            <span className="block text-[10px] font-semibold text-text-tertiary">{dfmt(row.due_date)}</span>
                                        </td>
                                        <td className="px-3 py-[7px] text-[11px] text-right tabular-nums font-semibold" style={{ color: 'var(--error)' }}>
                                            {inr(row.after_due_date_amount)}
                                        </td>
                                        <td className="px-3 py-[7px]">
                                            <div className="flex items-center justify-center gap-3">
                                                {SCENARIOS.map(s => {
                                                    const amount = s.key === 'early' ? row.early_payment_amount
                                                        : s.key === 'due' ? row.total_amount
                                                        : row.after_due_date_amount;
                                                    const disabled = !isSuperAdmin || !draft || amount === null || busyBill === row.bill_id;
                                                    return (
                                                        <label key={s.key}
                                                            className={`inline-flex items-center gap-1 text-[10px] font-bold ${disabled ? 'text-text-tertiary' : 'text-text-secondary cursor-pointer'}`}
                                                            title={amount === null ? `No ${s.label} amount on this bill` : !draft ? 'Open a run first' : s.label}>
                                                            <input
                                                                type="radio"
                                                                name={`scenario-${row.bill_id}`}
                                                                checked={row.selection?.scenario === s.key}
                                                                disabled={disabled}
                                                                onChange={() => select(row.bill_id, s.key)}
                                                                className="accent-[var(--primary)]"
                                                            />
                                                            {s.label}
                                                        </label>
                                                    );
                                                })}
                                                {busyBill === row.bill_id && <Loader2 className="w-3 h-3 animate-spin text-text-tertiary" />}
                                            </div>
                                        </td>
                                        <td className="px-3 py-[7px] text-[11px] text-right tabular-nums font-semibold text-text-secondary">
                                            {row.selection?.pay_by_date ? dfmt(row.selection.pay_by_date) : '—'}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                            <tfoot>
                                <tr className="border-t border-border bg-surface-elevated">
                                    <td className="px-3 py-2 text-[11px] font-black text-text-primary">
                                        Selected total · {form.filter(r => r.selection).length}/{form.length} bills
                                    </td>
                                    <td className="px-3 py-2 text-[11px] text-right tabular-nums font-bold text-text-secondary">{inr(totals.early)}</td>
                                    <td className="px-3 py-2 text-[11px] text-right tabular-nums font-bold text-text-secondary">{inr(totals.due)}</td>
                                    <td className="px-3 py-2 text-[11px] text-right tabular-nums font-bold" style={{ color: 'var(--error)' }}>{inr(totals.late)}</td>
                                    <td className="px-3 py-2 text-center text-[11px] font-extrabold text-text-primary tabular-nums">{inr(totals.selected)}</td>
                                    <td />
                                </tr>
                            </tfoot>
                        </table>
                    </div>

                    {isSuperAdmin && !submittedRun && (
                        <div className="flex items-center justify-end gap-2 px-3 py-3 border-t border-border">
                            {!draft ? (
                                <button
                                    onClick={openRun}
                                    disabled={submitting}
                                    className="inline-flex items-center gap-1.5 px-5 py-2 bg-primary text-white rounded-xl text-sm font-bold hover:bg-primary/90 disabled:opacity-50"
                                >
                                    {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
                                    Open payment run for {monthLabel(`${month}-01`)}
                                </button>
                            ) : (
                                <button
                                    onClick={submit}
                                    disabled={submitting || !allSelected}
                                    title={allSelected ? 'Hand the run to Accounts' : 'Pick a scenario for every bill first'}
                                    className="inline-flex items-center gap-1.5 px-5 py-2 bg-primary text-white rounded-xl text-sm font-bold hover:bg-primary/90 disabled:opacity-50"
                                >
                                    {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                                    Submit to Accounts
                                </button>
                            )}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
