'use client';

import React from 'react';
import { AlertTriangle, CheckCircle2, Link2 } from 'lucide-react';
import ElectricityExplainButton from './ElectricityExplainButton';
import { inr, monthLabel, type BillRow, type ReconciliationRow } from '@/frontend/lib/electricity/trackerTypes';

/**
 * Billed vs AOP-booked, per month — the module's single most valuable feature. Two
 * spreadsheets record the same spend independently and nobody has ever been able to
 * eyeball them side by side. Either side can be genuinely absent (a month not yet billed,
 * or not yet in the AOP sheet); those render as "—", never as a silently-invented zero
 * that would look like an exact match.
 */

interface Props {
    orgId: string;
    reconciliation: { rows: ReconciliationRow[]; aop_provisioned: boolean; aop_line_item_found: boolean };
    /** Register rows — used for the aop_linked closed loop below the month table. */
    bills?: BillRow[];
}

export default function ElectricityReconciliation({ orgId, reconciliation, bills }: Props) {
    const { rows, aop_provisioned: aopProvisioned, aop_line_item_found: lineItemFound } = reconciliation;
    const flaggedCount = rows.filter(r => r.flagged).length;
    // Bills that completed the whole pipeline: paid AND folded into AOP actuals.
    const aopLinked = (bills || []).filter(b => b.workflow_status === 'aop_linked');

    if (!aopProvisioned) {
        return (
            <div className="rounded-2xl border border-border bg-surface p-10 text-center">
                <AlertTriangle className="w-6 h-6 mx-auto mb-3" style={{ color: 'var(--warning)' }} />
                <p className="text-sm font-bold text-text-primary">The AOP tracker is not set up yet</p>
                <p className="text-xs font-semibold text-text-tertiary mt-2 max-w-md mx-auto">
                    Reconciliation compares this tracker&rsquo;s bill totals against the AOP Budget-vs-Actual
                    Electricity line. Apply supabase/migrations/20260802000001_aop_tracker.sql and import
                    AOP-BudgetVsActual.xlsx to enable it.
                </p>
            </div>
        );
    }

    if (!lineItemFound) {
        return (
            <div className="rounded-2xl border border-border bg-surface p-10 text-center">
                <AlertTriangle className="w-6 h-6 mx-auto mb-3" style={{ color: 'var(--warning)' }} />
                <p className="text-sm font-bold text-text-primary">No &ldquo;Electricity&rdquo; line item found in the AOP tracker for this org</p>
                <p className="text-xs font-semibold text-text-tertiary mt-2 max-w-md mx-auto">
                    Bill totals are ready to reconcile as soon as the AOP import runs for this organization.
                </p>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            {flaggedCount > 0 && (
                <div className="rounded-2xl border px-4 py-3 flex items-center gap-2.5" style={{ borderColor: 'var(--error)', background: 'rgba(239, 68, 68, 0.06)' }}>
                    <AlertTriangle className="w-4 h-4 shrink-0" style={{ color: 'var(--error)' }} />
                    <p className="text-xs font-bold text-text-primary">
                        {flaggedCount} month{flaggedCount === 1 ? '' : 's'} where the bill tracker and the AOP sheet disagree by more than 5%.
                    </p>
                </div>
            )}

            <div className="rounded-2xl border border-border bg-surface overflow-hidden">
                <table className="w-full border-collapse">
                    <thead className="bg-surface-elevated">
                        <tr className="border-b border-border">
                            <th className="px-3 py-2 text-left text-[10px] font-black uppercase tracking-[0.08em] text-text-tertiary">Month</th>
                            <th className="px-3 py-2 text-right text-[10px] font-black uppercase tracking-[0.08em] text-text-tertiary">Billed (this tracker)</th>
                            <th className="px-3 py-2 text-right text-[10px] font-black uppercase tracking-[0.08em] text-text-tertiary">AOP booked actual</th>
                            <th className="px-3 py-2 text-right text-[10px] font-black uppercase tracking-[0.08em] text-text-tertiary">Delta</th>
                            <th className="px-3 py-2 text-right text-[10px] font-black uppercase tracking-[0.08em] text-text-tertiary">Delta %</th>
                            <th className="px-3 py-2 text-left text-[10px] font-black uppercase tracking-[0.08em] text-text-tertiary" />
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-border-subtle">
                        {rows.map(r => (
                            <tr key={r.month} style={r.flagged ? { background: 'rgba(239, 68, 68, 0.045)' } : undefined}>
                                <td className="px-3 py-[7px] text-[11px] font-bold text-text-primary whitespace-nowrap">
                                    {monthLabel(r.month)}
                                </td>
                                <td className="px-3 py-[7px] text-[11px] text-right tabular-nums font-semibold text-text-secondary">
                                    {r.billed_total === null ? <span className="text-text-tertiary">not billed yet</span> : inr(r.billed_total)}
                                </td>
                                <td className="px-3 py-[7px] text-[11px] text-right tabular-nums font-semibold text-text-secondary">
                                    {r.aop_actual === null ? <span className="text-text-tertiary">not in AOP</span> : inr(r.aop_actual)}
                                </td>
                                <td className="px-3 py-[7px] text-[11px] text-right tabular-nums font-extrabold"
                                    style={{ color: r.delta === null ? 'var(--text-tertiary)' : r.flagged ? 'var(--error)' : 'var(--text-primary)' }}>
                                    {r.delta === null ? '—' : inr(Math.abs(r.delta))}
                                </td>
                                <td className="px-3 py-[7px] text-[11px] text-right tabular-nums font-bold"
                                    style={{ color: r.flagged ? 'var(--error)' : 'var(--text-tertiary)' }}>
                                    {r.delta_pct === null ? '—' : `${r.delta_pct > 0 ? '+' : ''}${r.delta_pct}%`}
                                </td>
                                <td className="px-3 py-[7px] text-right whitespace-nowrap">
                                    <div className="flex items-center justify-end gap-2">
                                        {r.flagged
                                            ? <AlertTriangle className="w-3.5 h-3.5" style={{ color: 'var(--error)' }} />
                                            : (r.billed_total !== null && r.aop_actual !== null)
                                                ? <CheckCircle2 className="w-3.5 h-3.5" style={{ color: 'var(--success)' }} />
                                                : null}
                                        {(r.billed_total !== null || r.aop_actual !== null) && (
                                            <ElectricityExplainButton orgId={orgId} reconciliationMonth={r.month.slice(0, 7)} />
                                        )}
                                    </div>
                                </td>
                            </tr>
                        ))}
                        {rows.length === 0 && (
                            <tr>
                                <td colSpan={6} className="px-3 py-10 text-center text-xs font-semibold text-text-tertiary">
                                    No months to reconcile yet.
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>

            <p className="text-[11px] font-semibold text-text-tertiary px-1">
                Delta is the AOP booked actual minus this tracker&rsquo;s billed total. A positive delta means AOP
                recorded more spend than there is a bill on file for — check for a bill missing from this
                tracker. A negative delta means the reverse — check for a duplicate bill here or an unbooked
                AOP entry. Delta % is measured against the billed total, since that is the side this tracker
                can verify bill by bill.
            </p>

            {/* ---- Closed loop: bills whose paid amount has landed in AOP actuals -------- */}
            {aopLinked.length > 0 && (
                <div className="rounded-2xl border border-border bg-surface overflow-hidden">
                    <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border bg-surface-elevated">
                        <Link2 className="w-3.5 h-3.5" style={{ color: 'var(--success)' }} />
                        <p className="text-[10px] font-black uppercase tracking-[0.08em] text-text-tertiary">
                            Closed loop — paid &amp; booked into AOP actuals ({aopLinked.length})
                        </p>
                    </div>
                    <table className="w-full border-collapse">
                        <tbody className="divide-y divide-border-subtle">
                            {aopLinked.map(b => (
                                <tr key={b.id}>
                                    <td className="px-3 py-[7px] text-[11px] font-bold text-text-primary">
                                        <span className="truncate block max-w-[220px]">{b.site_label}</span>
                                        <span className="block text-[10px] font-semibold text-text-tertiary">
                                            {b.provider}{b.consumer_ref ? ` #${b.consumer_ref}` : ''}
                                        </span>
                                    </td>
                                    <td className="px-3 py-[7px] text-[11px] font-semibold text-text-secondary whitespace-nowrap">
                                        {monthLabel(b.billing_month)}
                                    </td>
                                    <td className="px-3 py-[7px] text-[11px] text-right tabular-nums font-extrabold text-text-primary">
                                        {inr(b.total_amount)}
                                    </td>
                                    <td className="px-3 py-[7px] text-[11px] text-right font-semibold text-text-secondary whitespace-nowrap">
                                        paid {b.payment_date
                                            ? new Date(`${b.payment_date}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
                                            : '—'}
                                    </td>
                                    <td className="px-3 py-[7px] text-right">
                                        <span className="inline-flex items-center gap-1.5 text-[10px] font-bold" style={{ color: 'var(--success)' }}>
                                            <CheckCircle2 className="w-3.5 h-3.5" /> AOP linked
                                        </span>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
