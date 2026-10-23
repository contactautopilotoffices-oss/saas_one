'use client';

import React, { useEffect, useState } from 'react';
import { inr } from '@/frontend/lib/accounts/roles';

interface Line { id: string; name: string | null; description: string | null; hsn_or_sac: string | null; unit: string | null; quantity: number | null; rate: number | null; tax_percentage: number | null; item_total: number | null }
interface Data { lines: Line[]; terms: string | null; notes: string | null; delivery_date: string | null; reference: string | null }

const qty = (n: number | null) => (n == null ? '—' : n.toLocaleString('en-IN', { maximumFractionDigits: 3 }));

/** What the PO orders, as Zoho has it: each line, then the terms and notes. */
export default function PoOrderedItems({ orgId, poId }: { orgId: string; poId: string }) {
    const [d, setD] = useState<Data | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [showTerms, setShowTerms] = useState(false);

    useEffect(() => {
        let alive = true;
        fetch(`/api/accounts/po/${poId}/lines?org_id=${encodeURIComponent(orgId)}`)
            .then(async (r) => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`); return j as Data; })
            .then((j) => { if (alive) setD(j); })
            .catch((e: Error) => { if (alive) setError(e.message); });
        return () => { alive = false; };
    }, [orgId, poId]);

    const basic = (d?.lines ?? []).reduce((s, l) => s + (l.item_total ?? 0), 0);

    return (
        <div className="bg-surface rounded-xl border border-border lg:col-span-2 overflow-hidden">
            <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-3 flex-wrap">
                <h3 className="text-xs font-bold text-text-secondary uppercase tracking-wide">What was ordered</h3>
                {d && d.lines.length > 0 && <span className="text-xs text-text-tertiary">{d.lines.length} line{d.lines.length > 1 ? 's' : ''} · {inr(basic)} before GST</span>}
            </div>
            {error && <p className="px-4 py-3 text-xs text-error">Could not load the PO lines: {error}</p>}
            {!d && !error && <p className="px-4 py-6 text-sm text-text-tertiary">Loading…</p>}
            {d && d.lines.length === 0 && <p className="px-4 py-6 text-sm text-text-tertiary">No line items are synced for this PO.</p>}
            {d && d.lines.length > 0 && (
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="bg-surface-elevated text-left text-[11px] font-bold text-text-secondary uppercase tracking-wide">
                                <th className="px-4 py-2">Item</th>
                                <th className="px-3 py-2 text-right">Qty</th>
                                <th className="px-3 py-2 text-right">Rate</th>
                                <th className="px-3 py-2 text-right">GST</th>
                                <th className="px-4 py-2 text-right">Amount</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                            {d.lines.map((l) => (
                                <tr key={l.id} className="align-top">
                                    <td className="px-4 py-2.5 min-w-[220px]">
                                        <div className="font-medium text-text-primary">{l.name || '—'}</div>
                                        {l.description && l.description !== l.name && <div className="text-xs text-text-tertiary mt-0.5 whitespace-pre-line line-clamp-3">{l.description}</div>}
                                        {l.hsn_or_sac && <div className="text-[11px] text-text-tertiary mt-0.5">HSN/SAC {l.hsn_or_sac}</div>}
                                    </td>
                                    <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap text-text-primary">{qty(l.quantity)}{l.unit ? ` ${l.unit}` : ''}</td>
                                    <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap text-text-primary">{l.rate == null ? '—' : inr(l.rate)}</td>
                                    <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap text-text-secondary">{l.tax_percentage == null ? '—' : `${l.tax_percentage}%`}</td>
                                    <td className="px-4 py-2.5 text-right tabular-nums whitespace-nowrap font-bold text-text-primary">{l.item_total == null ? '—' : inr(l.item_total)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
            {d && (d.terms || d.notes || d.delivery_date || d.reference) && (
                <div className="px-4 py-3 border-t border-border text-sm space-y-1.5">
                    {(d.delivery_date || d.reference) && (
                        <p className="text-xs text-text-secondary">{[d.delivery_date && `Delivery by ${new Date(d.delivery_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}`, d.reference && `Reference ${d.reference}`].filter(Boolean).join(' · ')}</p>
                    )}
                    {(d.terms || d.notes) && (
                        <>
                            <button type="button" onClick={() => setShowTerms((v) => !v)} className="text-xs font-bold text-primary hover:underline" aria-expanded={showTerms}>
                                {showTerms ? 'Hide terms and notes' : 'Show terms and notes'}
                            </button>
                            {showTerms && <div className="text-xs text-text-primary whitespace-pre-line leading-relaxed">{[d.terms, d.notes].filter(Boolean).join('\n\n')}</div>}
                        </>
                    )}
                </div>
            )}
        </div>
    );
}
