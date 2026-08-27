'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, CheckCircle2, Flag, Loader2, RefreshCw, RotateCw, X } from 'lucide-react';
import {
    inr, monthLabel,
    type ValidationQueueRow, type ValidationsPayload, type ValidationRun,
} from '@/frontend/lib/electricity/trackerTypes';

/**
 * Phase 2 — the checker's review queue. Every bill in 'validated' or 'chasing' with its
 * latest validation run: billed kWh from the board vs kWh the MSTs actually logged, the
 * variance between them, and the reading dates still missing.
 *
 * Sign-off (PATCH) is checker-only — the API enforces it and reports `can_check`; the
 * Approve button is hidden for everyone else. Re-run (POST) and Flag dispute (POST
 * /api/electricity/disputes) follow the same server-side gates.
 */

interface Props {
    orgId: string;
}

const RESULT_META: Record<ValidationRun['result'], { label: string; color: string }> = {
    pass: { label: 'Pass', color: 'var(--success)' },
    variance: { label: 'Variance', color: 'var(--error)' },
    incomplete_data: { label: 'Incomplete data', color: 'var(--warning)' },
    no_meter_link: { label: 'No meter link', color: 'var(--text-tertiary)' },
};

const dfmt = (d: string | null) =>
    d ? new Date(`${d.slice(0, 10)}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : null;

export default function ElectricityValidationQueue({ orgId }: Props) {
    const [data, setData] = useState<ValidationsPayload | null>(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [busyId, setBusyId] = useState<string | null>(null);
    const [actionError, setActionError] = useState<string | null>(null);
    const [disputing, setDisputing] = useState<ValidationQueueRow | null>(null);

    const load = useCallback(async (quiet = false) => {
        if (quiet) setRefreshing(true); else setLoading(true);
        setError(null);
        try {
            const res = await fetch(`/api/electricity/validations?org_id=${orgId}`);
            const payload = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(payload?.error || 'Could not load the validation queue');
            setData(payload as ValidationsPayload);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not load the validation queue');
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, [orgId]);

    useEffect(() => { void load(); }, [load]);

    const act = useCallback(async (billId: string, fn: () => Promise<Response>, fallback: string) => {
        setBusyId(billId);
        setActionError(null);
        try {
            const res = await fn();
            const payload = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(payload?.error || fallback);
            await load(true);
        } catch (e) {
            setActionError(e instanceof Error ? e.message : fallback);
        } finally {
            setBusyId(null);
        }
    }, [load]);

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
                <p className="text-sm font-bold text-text-primary">Validation is not set up yet</p>
                <p className="text-xs font-semibold text-text-tertiary mt-2 max-w-md mx-auto">
                    Apply supabase/migrations/20260804000002_electricity_validation_and_ops_role.sql to enable
                    the validation engine.
                </p>
            </div>
        );
    }

    const queue = data.queue;
    const canCheck = data.can_check;

    return (
        <div className="space-y-3">
            {actionError && (
                <div className="flex items-center justify-between gap-3 px-3 py-2 rounded-xl border text-[11px] font-bold"
                    style={{ color: 'var(--error)', borderColor: 'var(--error)', background: 'rgba(239,68,68,0.06)' }}>
                    {actionError}
                    <button onClick={() => setActionError(null)} className="font-black">Dismiss</button>
                </div>
            )}

            <div className="flex items-center justify-between gap-3">
                <p className="text-[11px] font-semibold text-text-tertiary">
                    {queue.length === 0
                        ? 'No bills awaiting review.'
                        : `${queue.length} bill${queue.length === 1 ? '' : 's'} awaiting review · billed units vs meter-logged units, latest run wins.`}
                    {!canCheck && ' Sign-off is reserved for checkers (ops super admin).'}
                </p>
                <button
                    onClick={() => void load(true)}
                    className="p-2 rounded-xl border border-border text-text-secondary hover:text-text-primary hover:bg-muted transition-colors"
                    aria-label="Refresh"
                >
                    <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
                </button>
            </div>

            {queue.length === 0 ? (
                <div className="rounded-2xl border border-border bg-surface p-12 text-center">
                    <CheckCircle2 className="w-8 h-8 mx-auto mb-3" style={{ color: 'var(--success)' }} />
                    <p className="text-sm font-bold text-text-primary">Queue clear</p>
                </div>
            ) : (
                <div className="space-y-3">
                    {queue.map(b => (
                        <QueueCard
                            key={b.id}
                            bill={b}
                            busy={busyId === b.id}
                            canCheck={canCheck}
                            onApprove={() => act(b.id, () => fetch('/api/electricity/validations', {
                                method: 'PATCH',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ billId: b.id }),
                            }), 'Sign-off failed')}
                            onRerun={() => act(b.id, () => fetch('/api/electricity/validations', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ billId: b.id }),
                            }), 'Validation re-run failed')}
                            onDispute={() => setDisputing(b)}
                        />
                    ))}
                </div>
            )}

            {disputing && (
                <DisputeModal
                    bill={disputing}
                    onClose={() => setDisputing(null)}
                    onDone={() => { setDisputing(null); void load(true); }}
                />
            )}
        </div>
    );
}

function QueueCard({ bill, busy, canCheck, onApprove, onRerun, onDispute }: {
    bill: ValidationQueueRow;
    busy: boolean;
    canCheck: boolean;
    onApprove: () => void;
    onRerun: () => void;
    onDispute: () => void;
}) {
    const v = bill.latest_validation;
    const meta = v ? RESULT_META[v.result] : null;
    const billed = v?.billed_units ?? bill.billed_units;
    const unit = bill.billed_units_unit || 'kWh';

    return (
        <div className="rounded-2xl border border-border bg-surface p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                    <p className="text-sm font-bold text-text-primary truncate">
                        {bill.electricity_billing_accounts?.site_label || 'Unknown account'}
                        <span className="ml-2 text-[11px] font-semibold text-text-tertiary">
                            {bill.electricity_billing_accounts?.provider}
                            {bill.electricity_billing_accounts?.consumer_ref ? ` #${bill.electricity_billing_accounts.consumer_ref}` : ''}
                            {' · '}{monthLabel(bill.billing_month)}
                        </span>
                    </p>
                    <p className="text-[11px] font-semibold text-text-tertiary mt-0.5">
                        {inr(bill.total_amount)} · due {dfmt(bill.due_date) || '—'} · {bill.workflow_status}
                    </p>
                </div>

                <div className="flex items-center gap-2">
                    {meta && (
                        <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg text-[10px] font-bold"
                            style={{ color: meta.color, background: 'var(--muted)' }}>
                            <span className="w-1.5 h-1.5 rounded-full" style={{ background: meta.color }} />
                            {meta.label}
                        </span>
                    )}
                    {v?.variance_pct !== null && v?.variance_pct !== undefined && (
                        <span className="px-2 py-1 rounded-lg text-[10px] font-black"
                            style={{
                                color: Math.abs(v.variance_pct) > v.tolerance_pct ? 'var(--error)' : 'var(--success)',
                                background: Math.abs(v.variance_pct) > v.tolerance_pct ? 'rgba(239,68,68,0.10)' : 'rgba(34,197,94,0.10)',
                            }}>
                            {v.variance_pct > 0 ? '+' : ''}{v.variance_pct}%
                        </span>
                    )}
                </div>
            </div>

            {/* Billed vs logged, side by side */}
            <div className="grid grid-cols-2 gap-3 mt-3">
                <div className="rounded-xl bg-surface-elevated p-3">
                    <p className="text-[10px] font-black uppercase tracking-[0.08em] text-text-tertiary">Billed (board)</p>
                    <p className="text-lg font-extrabold text-text-primary tabular-nums mt-0.5">
                        {billed === null || billed === undefined ? '—' : Number(billed).toLocaleString('en-IN')}
                        <span className="ml-1 text-[10px] font-bold text-text-tertiary">{unit}</span>
                    </p>
                </div>
                <div className="rounded-xl bg-surface-elevated p-3">
                    <p className="text-[10px] font-black uppercase tracking-[0.08em] text-text-tertiary">Logged (meters)</p>
                    <p className="text-lg font-extrabold text-text-primary tabular-nums mt-0.5">
                        {v?.logged_units === null || v?.logged_units === undefined ? '—' : Number(v.logged_units).toLocaleString('en-IN')}
                        <span className="ml-1 text-[10px] font-bold text-text-tertiary">
                            {v ? `${v.readings_counted ?? 0} readings` : ''}
                        </span>
                    </p>
                </div>
            </div>

            {/* Missing reading dates */}
            {v?.missing_dates && v.missing_dates.length > 0 && (
                <div className="mt-3">
                    <p className="text-[10px] font-black uppercase tracking-[0.08em] text-text-tertiary mb-1.5">
                        Missing readings ({v.missing_dates.length})
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                        {v.missing_dates.slice(0, 14).map(d => (
                            <span key={d} className="px-2 py-0.5 rounded-lg text-[10px] font-bold"
                                style={{ color: 'var(--warning)', background: 'rgba(245,158,11,0.10)' }}>
                                {dfmt(d)}
                            </span>
                        ))}
                        {v.missing_dates.length > 14 && (
                            <span className="px-2 py-0.5 text-[10px] font-bold text-text-tertiary">+{v.missing_dates.length - 14} more</span>
                        )}
                    </div>
                </div>
            )}

            <div className="flex flex-wrap items-center justify-end gap-2 mt-3 pt-3 border-t border-border-subtle">
                <button
                    onClick={onRerun}
                    disabled={busy}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-border rounded-lg text-[11px] font-bold text-text-secondary hover:bg-muted disabled:opacity-50"
                >
                    <RotateCw className="w-3.5 h-3.5" /> Re-run
                </button>
                <button
                    onClick={onDispute}
                    disabled={busy}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 border rounded-lg text-[11px] font-bold disabled:opacity-50"
                    style={{ color: 'var(--error)', borderColor: 'var(--error)' }}
                >
                    <Flag className="w-3.5 h-3.5" /> Flag dispute
                </button>
                {canCheck && (
                    <button
                        onClick={onApprove}
                        disabled={busy}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-primary text-white rounded-lg text-[11px] font-bold hover:bg-primary/90 disabled:opacity-50"
                    >
                        {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                        Approve &amp; verify
                    </button>
                )}
            </div>
        </div>
    );
}

function DisputeModal({ bill, onClose, onDone }: {
    bill: ValidationQueueRow;
    onClose: () => void;
    onDone: () => void;
}) {
    const [reason, setReason] = useState('');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const submit = async () => {
        if (!reason.trim()) { setError('A reason is required'); return; }
        setSaving(true);
        setError(null);
        try {
            const res = await fetch('/api/electricity/disputes', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    bill_id: bill.id,
                    validation_id: bill.latest_validation?.id ?? null,
                    reason: reason.trim(),
                }),
            });
            const payload = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(payload?.error || 'Could not open the dispute');
            onDone();
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not open the dispute');
        } finally {
            setSaving(false);
        }
    };

    if (typeof document === 'undefined') return null;
    return createPortal(
        <div className="fixed inset-0 bg-black/50 z-[80] flex items-center justify-center p-4" onClick={onClose}>
            <div onClick={e => e.stopPropagation()} className="bg-surface rounded-2xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col">
                <div className="flex items-center justify-between px-6 py-4 border-b border-border">
                    <h3 className="text-base font-bold text-text-primary">
                        Flag dispute · {bill.electricity_billing_accounts?.site_label} {monthLabel(bill.billing_month)}
                    </h3>
                    <button onClick={onClose} className="p-2 hover:bg-muted rounded-xl"><X className="w-5 h-5 text-text-secondary" /></button>
                </div>

                <div className="px-6 py-4 space-y-4">
                    <div>
                        <label className="block text-xs font-bold text-text-secondary uppercase tracking-wide mb-1.5">Reason *</label>
                        <textarea
                            autoFocus
                            value={reason}
                            onChange={e => setReason(e.target.value)}
                            rows={4}
                            placeholder="What is wrong with this bill — variance, wrong units, missing readings…"
                            className="w-full px-3 py-2 border border-border rounded-lg text-sm bg-surface text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-primary/20"
                        />
                    </div>
                    <p className="text-[11px] text-text-tertiary">
                        The bill moves to &lsquo;disputed&rsquo; and the property admin gets a pending action to respond.
                    </p>
                    {error && <p className="text-sm" style={{ color: 'var(--error)' }}>{error}</p>}
                </div>

                <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border bg-surface-elevated">
                    <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-text-secondary hover:bg-muted rounded-xl">Cancel</button>
                    <button
                        onClick={submit}
                        disabled={saving}
                        className="inline-flex items-center gap-1.5 px-5 py-2 text-white rounded-xl text-sm font-bold disabled:opacity-50"
                        style={{ background: 'var(--error)' }}
                    >
                        {saving && <Loader2 className="w-4 h-4 animate-spin" />} Open dispute
                    </button>
                </div>
            </div>
        </div>,
        document.body,
    );
}
