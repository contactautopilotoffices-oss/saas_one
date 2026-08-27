'use client';

import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Loader2 } from 'lucide-react';
import { PurchaseOrder, PAYMENT_TERMS, inr } from '@/frontend/lib/accounts/roles';
import { TRANCHE_PRESETS } from '@/frontend/lib/accounts/trackerTypes';

interface Props { po: PurchaseOrder; onClose: () => void; onDone: () => void; }

export default function AlignPaymentModal({ po, onClose, onDone }: Props) {
    const pending = po.pending_amount ?? po.po_amount;
    const [amount, setAmount] = useState(String(Math.round(pending)));
    // The agreed share of the PO this tranche represents — some vendors take 30% upfront,
    // some 25%. `percent` and `amount` are kept in lockstep here so the two can never drift:
    // whichever field the user last touched is authoritative and recomputes the other from
    // po.po_amount. The backend rejects a mismatch, so this is the only place it can happen.
    const [percent, setPercent] = useState<number | null>(
        po.po_amount > 0 ? Math.round((pending / po.po_amount) * 10000) / 100 : null,
    );
    const [term, setTerm] = useState('');
    const [gstHold, setGstHold] = useState('');
    const [tds, setTds] = useState('');
    const [remarks, setRemarks] = useState('');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const setFromPercent = (p: number) => {
        setPercent(p);
        if (po.po_amount > 0) setAmount(String(Math.round((po.po_amount * p) / 100)));
    };
    const setFromAmount = (v: string) => {
        setAmount(v);
        const n = Number(v);
        setPercent(po.po_amount > 0 && n > 0 ? Math.round((n / po.po_amount) * 10000) / 100 : null);
    };

    const submit = async () => {
        if (!amount || Number(amount) <= 0) { setError('Enter an amount to align'); return; }
        setSaving(true); setError(null);
        try {
            const res = await fetch('/api/accounts/payments', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    po_id: po.id, requested_amount: Number(amount), payment_term: term || null,
                    gst_hold: gstHold ? Number(gstHold) : 0, tds: tds ? Number(tds) : 0, remarks: remarks || null,
                    percent_of_po: percent && percent > 0 ? percent : null,
                }),
            });
            if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || 'Failed to align'); }
            onDone();
        } catch (e) { setError(e instanceof Error ? e.message : 'Failed to align'); }
        finally { setSaving(false); }
    };

    if (typeof document === 'undefined') return null;
    const field = 'w-full px-3 py-2 border border-border rounded-lg text-sm bg-surface text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-primary/20';
    const label = 'block text-xs font-bold text-text-secondary uppercase tracking-wide mb-1.5';

    return createPortal(
        <div className="fixed inset-0 bg-black/50 z-[80] flex items-center justify-center p-4" onClick={onClose}>
            <div onClick={e => e.stopPropagation()} className="bg-surface rounded-2xl shadow-2xl w-full max-w-md max-h-[88vh] overflow-hidden flex flex-col">
                <div className="flex items-center justify-between px-6 py-4 border-b border-border">
                    <h3 className="text-base font-bold text-text-primary">Align payment · {po.po_number}</h3>
                    <button onClick={onClose} className="p-2 hover:bg-muted rounded-xl"><X className="w-5 h-5 text-text-secondary" /></button>
                </div>

                <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
                    <div className="bg-surface-elevated rounded-xl p-3 text-sm">
                        <div className="flex justify-between"><span className="text-text-tertiary">Vendor</span><span className="text-text-primary font-medium">{po.vendor_name || '—'}</span></div>
                        <div className="flex justify-between mt-1"><span className="text-text-tertiary">PO amount</span><span className="text-text-primary font-medium">{inr(po.po_amount)}</span></div>
                        <div className="flex justify-between mt-1"><span className="text-text-tertiary">Already aligned/paid</span><span className="text-text-primary font-medium">{inr((po.aligned_total || 0) + (po.completed_total || 0))}</span></div>
                        <div className="flex justify-between mt-1"><span className="text-text-tertiary">Pending</span><span className="text-amber-600 font-bold">{inr(pending)}</span></div>
                    </div>

                    {/* Tranche % — some vendors take 30% upfront, some 25%. Presets + a slider drive
                        the amount from po.po_amount; typing the amount directly recomputes the
                        percent from the same formula, so the two figures can never disagree. */}
                    <div>
                        <div className="flex items-center justify-between mb-1.5">
                            <label className={label + ' mb-0'}>Tranche of PO value</label>
                            <span className="text-xs font-bold text-primary tabular-nums">{percent != null ? `${percent}%` : '—'}</span>
                        </div>
                        <input type="range" min={1} max={100} step={1} value={percent ?? 0}
                            onChange={e => setFromPercent(Number(e.target.value))}
                            className="w-full accent-primary" />
                        <div className="flex items-center gap-1.5 mt-1.5">
                            {TRANCHE_PRESETS.map(p => (
                                <button key={p} type="button" onClick={() => setFromPercent(p)}
                                    className={`px-2.5 py-1 rounded-lg text-xs font-bold border transition-colors ${
                                        percent === p ? 'bg-primary text-white border-primary' : 'border-border text-text-secondary hover:bg-surface-elevated'}`}>
                                    {p}%
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <div><label className={label}>Request amount (₹)</label><input type="number" value={amount} onChange={e => setFromAmount(e.target.value)} className={field} /></div>
                        <div><label className={label}>Payment term</label>
                            <select value={term} onChange={e => setTerm(e.target.value)} className={field}>
                                <option value="">—</option>
                                {PAYMENT_TERMS.map(t => <option key={t} value={t}>{t}</option>)}
                            </select>
                        </div>
                        <div><label className={label}>GST hold (₹)</label><input type="number" value={gstHold} onChange={e => setGstHold(e.target.value)} placeholder="0" className={field} /></div>
                        <div><label className={label}>TDS (₹)</label><input type="number" value={tds} onChange={e => setTds(e.target.value)} placeholder="0" className={field} /></div>
                    </div>
                    <div><label className={label}>Remarks</label><input value={remarks} onChange={e => setRemarks(e.target.value)} placeholder="e.g. balance against tax invoice" className={field} /></div>
                    <p className="text-[11px] text-text-tertiary">Aligning less than the pending amount creates a split tranche; the rest stays in “To Align”.</p>
                    {error && <p className="text-sm text-red-600">{error}</p>}
                </div>

                <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border bg-surface-elevated">
                    <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-text-secondary hover:bg-muted rounded-xl">Cancel</button>
                    <button onClick={submit} disabled={saving} className="inline-flex items-center gap-1.5 px-5 py-2 bg-primary text-white rounded-xl text-sm font-bold hover:bg-primary/90 disabled:opacity-50">
                        {saving && <Loader2 className="w-4 h-4 animate-spin" />} Send to Accounts
                    </button>
                </div>
            </div>
        </div>,
        document.body,
    );
}
