'use client';

import React, { useMemo, useState } from 'react';
import { format } from 'date-fns';
import { Search, X, Loader2, Paperclip } from 'lucide-react';
import ElectricityExplainButton from './ElectricityExplainButton';
import {
    inr, monthLabel, URGENCY_META, STATUS_META, electricityDocUrl,
    type AccountLite, type BillRow, type PaymentStatus,
} from '@/frontend/lib/electricity/trackerTypes';

/**
 * The Excel replacement. Dense table, sticky header, month + account filters, inline
 * payment-status edit — Binance row geometry (12px row padding, hairline dividers,
 * semantic colour on text rather than as a card fill: docs/design-references/
 * awesome-design-md/binance/DESIGN.md).
 *
 * Filtering runs client-side against the already-fetched register rows rather than
 * round-tripping to the API on every keystroke: the API route (GET /api/electricity/
 * tracker?month=&account_id=&status=&urgency=) does support server-side filtering for
 * other consumers (a future export, a saved-view link), but a typical portfolio's yearly
 * bill count is in the low hundreds, so filtering what is already on the client is both
 * instant and simpler than keeping a second fetch cycle in sync with this one.
 */

interface Props {
    orgId: string;
    rows: BillRow[];
    accounts: AccountLite[];
    months: string[];
    /** Fired after a PATCH commits, so the parent can quietly refresh deadlines/discount
     *  performance/reconciliation — all three depend on payment_status and payment_date. */
    onCommitted: () => void;
}

const dfmt = (d: string | null) => (d ? format(new Date(`${d}T00:00:00`), 'dd/MM/yyyy') : '—');

const STATUSES: PaymentStatus[] = ['pending', 'paid', 'disputed'];

const th = 'px-3 py-2 text-left text-[10px] font-black uppercase tracking-[0.08em] text-text-tertiary whitespace-nowrap';
const tdBase = 'px-3 py-[7px] text-[11px] whitespace-nowrap'; // ~12px row rhythm incl. line-height

export default function ElectricityBillRegister({ orgId, rows, accounts, months, onCommitted }: Props) {
    const [monthFilter, setMonthFilter] = useState('all');
    const [accountFilter, setAccountFilter] = useState('all');
    const [statusFilter, setStatusFilter] = useState('all');
    const [query, setQuery] = useState('');
    const [savingId, setSavingId] = useState<string | null>(null);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [saveError, setSaveError] = useState<string | null>(null);

    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        return rows.filter(r =>
            (monthFilter === 'all' || r.billing_month.startsWith(monthFilter)) &&
            (accountFilter === 'all' || r.account_id === accountFilter) &&
            (statusFilter === 'all' || r.payment_status === statusFilter) &&
            (!q || r.site_label.toLowerCase().includes(q) || r.provider.toLowerCase().includes(q)),
        );
    }, [rows, monthFilter, accountFilter, statusFilter, query]);

    async function updateBill(billId: string, patch: { payment_status?: PaymentStatus; payment_date?: string | null }) {
        setSavingId(billId);
        setSaveError(null);
        try {
            const res = await fetch('/api/electricity/tracker', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ org_id: orgId, bill_id: billId, ...patch }),
            });
            if (!res.ok) {
                const payload = await res.json().catch(() => ({}));
                throw new Error(payload?.error || 'Could not save the change');
            }
            onCommitted();
        } catch (e) {
            setSaveError(e instanceof Error ? e.message : 'Could not save the change');
        } finally {
            setSavingId(null);
            setEditingId(null);
        }
    }

    return (
        <div className="rounded-2xl border border-border bg-surface overflow-hidden">
            {saveError && (
                <div className="flex items-center justify-between gap-3 px-3 py-2 border-b border-border text-[11px] font-bold" style={{ color: 'var(--error)', background: 'rgba(239,68,68,0.06)' }}>
                    {saveError}
                    <button onClick={() => setSaveError(null)} className="font-black">Dismiss</button>
                </div>
            )}

            {/* ---- Filters ------------------------------------------------------------ */}
            <div className="flex flex-wrap items-center gap-2 px-3 py-2.5 border-b border-border">
                <select
                    value={monthFilter}
                    onChange={e => setMonthFilter(e.target.value)}
                    className="px-2.5 py-1.5 rounded-xl border border-border bg-surface text-[11px] font-bold text-text-primary outline-none focus:border-primary"
                >
                    <option value="all">All months</option>
                    {months.map(m => <option key={m} value={m.slice(0, 7)}>{monthLabel(m)}</option>)}
                </select>

                <select
                    value={accountFilter}
                    onChange={e => setAccountFilter(e.target.value)}
                    className="px-2.5 py-1.5 rounded-xl border border-border bg-surface text-[11px] font-bold text-text-primary outline-none focus:border-primary max-w-[220px]"
                >
                    <option value="all">All accounts</option>
                    {accounts.map(a => (
                        <option key={a.id} value={a.id}>
                            {a.site_label}{a.consumer_ref ? ` #${a.consumer_ref}` : ''}
                        </option>
                    ))}
                </select>

                <select
                    value={statusFilter}
                    onChange={e => setStatusFilter(e.target.value)}
                    className="px-2.5 py-1.5 rounded-xl border border-border bg-surface text-[11px] font-bold text-text-primary outline-none focus:border-primary"
                >
                    <option value="all">Any status</option>
                    {STATUSES.map(s => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
                </select>

                <div className="relative ml-auto">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-tertiary" />
                    <input
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                        placeholder="Search site or board"
                        className="w-48 pl-8 pr-7 py-1.5 rounded-xl border border-border bg-surface text-[11px] font-semibold text-text-primary outline-none focus:border-primary"
                    />
                    {query && (
                        <button onClick={() => setQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-text-tertiary hover:text-text-primary" aria-label="Clear search">
                            <X className="w-3 h-3" />
                        </button>
                    )}
                </div>

                <span className="text-[11px] font-bold text-text-tertiary">{filtered.length} of {rows.length}</span>
            </div>

            {/* ---- Table ---------------------------------------------------------------- */}
            <div className="overflow-auto max-h-[62vh]">
                <table className="w-full border-collapse">
                    <thead className="sticky top-0 z-10 bg-surface-elevated">
                        <tr className="border-b border-border">
                            <th className={th}>Account</th>
                            <th className={th}>Month</th>
                            <th className={`${th} text-right`}>Bill date</th>
                            <th className={`${th} text-right`}>Due date</th>
                            {/* L1 FIRST: lowest amount leftmost (early → due → late), per the
                                standing preference and SPEC-ELECTRICITY.md REQ-E-12. Reading
                                left to right is then reading cheapest to dearest. */}
                            <th className={`${th} text-right`}>Early pay by</th>
                            <th className={`${th} text-right`}>Early pay amt</th>
                            <th className={`${th} text-right`}>On due date</th>
                            <th className={`${th} text-right`}>After due amt</th>
                            <th className={th}>Status</th>
                            <th className={`${th} text-right`}>Paid on</th>
                            <th className={th} />
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-border-subtle">
                        {filtered.map(r => {
                            const status = STATUS_META[r.payment_status];
                            const urgency = URGENCY_META[r.urgency];
                            const isEditing = editingId === r.id;
                            const isSaving = savingId === r.id;
                            return (
                                <tr key={r.id} className="hover:bg-muted/60 transition-colors">
                                    <td className={`${tdBase} font-bold text-text-primary`}>
                                        <span className="truncate block max-w-[180px]">{r.site_label}</span>
                                        <span className="block text-[10px] font-semibold text-text-tertiary truncate max-w-[180px]">
                                            {r.provider}{r.consumer_ref ? ` #${r.consumer_ref}` : ''}
                                        </span>
                                    </td>
                                    <td className={`${tdBase} font-semibold text-text-secondary`}>{monthLabel(r.billing_month)}</td>
                                    <td className={`${tdBase} text-right tabular-nums text-text-secondary`}>{dfmt(r.bill_date)}</td>
                                    <td className={`${tdBase} text-right tabular-nums text-text-secondary`}>{dfmt(r.due_date)}</td>
                                    {/* Order matches the header: early → due → late. */}
                                    <td className={`${tdBase} text-right tabular-nums text-text-secondary`}>{dfmt(r.early_payment_date)}</td>
                                    <td className={`${tdBase} text-right tabular-nums text-text-secondary`}>{inr(r.early_payment_amount)}</td>
                                    <td className={`${tdBase} text-right tabular-nums font-extrabold text-text-primary`}>{inr(r.total_amount)}</td>
                                    <td className={`${tdBase} text-right tabular-nums text-text-secondary`}>{inr(r.after_due_date_amount)}</td>
                                    <td className={tdBase}>
                                        {isEditing ? (
                                            <div className="flex items-center gap-1">
                                                <select
                                                    autoFocus
                                                    defaultValue={r.payment_status}
                                                    disabled={isSaving}
                                                    onChange={e => updateBill(r.id, { payment_status: e.target.value as PaymentStatus })}
                                                    onBlur={() => setEditingId(null)}
                                                    className="px-1.5 py-1 rounded-lg border border-primary bg-surface text-[11px] font-bold text-text-primary outline-none"
                                                >
                                                    {STATUSES.map(s => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
                                                </select>
                                                {isSaving && <Loader2 className="w-3 h-3 animate-spin text-text-tertiary" />}
                                            </div>
                                        ) : (
                                            <button
                                                onClick={() => setEditingId(r.id)}
                                                className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg text-[10px] font-bold hover:opacity-80 transition-opacity"
                                                style={{ color: status.color, background: 'transparent' }}
                                                title="Click to change"
                                            >
                                                <span className="w-1.5 h-1.5 rounded-full" style={{ background: status.color }} />
                                                {status.label}
                                                {r.payment_status === 'pending' && r.urgency !== 'ok' && (
                                                    <span className="ml-1 font-semibold" style={{ color: urgency.color }}>· {urgency.label}</span>
                                                )}
                                            </button>
                                        )}
                                    </td>
                                    <td className={`${tdBase} text-right`}>
                                        {r.payment_status === 'paid' ? (
                                            <input
                                                type="date"
                                                defaultValue={r.payment_date ?? ''}
                                                disabled={isSaving}
                                                onBlur={e => {
                                                    const v = e.target.value || null;
                                                    if (v !== r.payment_date) updateBill(r.id, { payment_date: v });
                                                }}
                                                className="w-[126px] px-1.5 py-1 rounded-lg border border-border bg-surface text-[11px] font-semibold text-text-primary outline-none focus:border-primary tabular-nums"
                                            />
                                        ) : (
                                            <span className="text-text-tertiary">—</span>
                                        )}
                                    </td>
                                    <td className={tdBase}>
                                        <div className="flex items-center gap-1.5">
                                            {r.document_id && (
                                                <a
                                                    href={electricityDocUrl(r.document_id)}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    title="View the source bill PDF"
                                                    className="p-1 rounded-lg text-text-tertiary hover:text-primary hover:bg-muted transition-colors"
                                                >
                                                    <Paperclip className="w-3.5 h-3.5" />
                                                </a>
                                            )}
                                            <ElectricityExplainButton orgId={orgId} billId={r.id} label="" />
                                        </div>
                                    </td>
                                </tr>
                            );
                        })}
                        {filtered.length === 0 && (
                            <tr>
                                <td colSpan={11} className="px-3 py-10 text-center text-xs font-semibold text-text-tertiary">
                                    No bills match this filter.
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
