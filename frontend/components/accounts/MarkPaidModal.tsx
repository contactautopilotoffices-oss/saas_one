'use client';

import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Loader2, Upload, FileText } from 'lucide-react';
import { PoPayment, inr } from '@/frontend/lib/accounts/roles';

interface Props { payment: PoPayment; onClose: () => void; onDone: () => void; }

export default function MarkPaidModal({ payment, onClose, onDone }: Props) {
    const [paidAmount, setPaidAmount] = useState(String(Math.round(payment.requested_amount)));
    const [paymentDate, setPaymentDate] = useState('');
    const [utr, setUtr] = useState('');
    const [proof, setProof] = useState<{ url: string; file_name: string } | null>(null);
    const [remarks, setRemarks] = useState('');
    const [uploading, setUploading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const upload = async (file: File | null) => {
        if (!file) return;
        setUploading(true);
        try {
            const fd = new FormData(); fd.append('file', file);
            const res = await fetch('/api/accounts/upload', { method: 'POST', body: fd });
            if (res.ok) { const d = await res.json(); setProof(d); }
        } finally { setUploading(false); }
    };

    const submit = async () => {
        if (!utr.trim()) { setError('UTR number is required'); return; }
        setSaving(true); setError(null);
        try {
            const res = await fetch(`/api/accounts/payments/${payment.id}`, {
                method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'complete', utr_no: utr.trim(),
                    paid_amount: paidAmount ? Number(paidAmount) : undefined,
                    payment_date: paymentDate || undefined,
                    payment_proof_url: proof?.url, remarks: remarks || undefined,
                }),
            });
            if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || 'Failed to complete'); }
            onDone();
        } catch (e) { setError(e instanceof Error ? e.message : 'Failed to complete'); }
        finally { setSaving(false); }
    };

    if (typeof document === 'undefined') return null;
    const field = 'w-full px-3 py-2 border border-border rounded-lg text-sm bg-surface text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-primary/20';
    const label = 'block text-xs font-bold text-text-secondary uppercase tracking-wide mb-1.5';

    return createPortal(
        <div className="fixed inset-0 bg-black/50 z-[80] flex items-center justify-center p-4" onClick={onClose}>
            <div onClick={e => e.stopPropagation()} className="bg-surface rounded-2xl shadow-2xl w-full max-w-md max-h-[88vh] overflow-hidden flex flex-col">
                <div className="flex items-center justify-between px-6 py-4 border-b border-border">
                    <h3 className="text-base font-bold text-text-primary">Mark payment completed · {payment.po_number}</h3>
                    <button onClick={onClose} className="p-2 hover:bg-muted rounded-xl"><X className="w-5 h-5 text-text-secondary" /></button>
                </div>

                <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
                    <div className="bg-surface-elevated rounded-xl p-3 text-sm">
                        <div className="flex justify-between"><span className="text-text-tertiary">Vendor</span><span className="text-text-primary font-medium">{payment.vendor_name || '—'}</span></div>
                        <div className="flex justify-between mt-1"><span className="text-text-tertiary">Requested</span><span className="text-text-primary font-medium">{inr(payment.requested_amount)}</span></div>
                        {payment.payment_term && <div className="flex justify-between mt-1"><span className="text-text-tertiary">Term</span><span className="text-text-primary font-medium">{payment.payment_term}</span></div>}
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <div><label className={label}>Paid amount (₹)</label><input type="number" value={paidAmount} onChange={e => setPaidAmount(e.target.value)} className={field} /></div>
                        <div><label className={label}>Payment date</label><input type="date" value={paymentDate} onChange={e => setPaymentDate(e.target.value)} className={field} /></div>
                    </div>
                    <div><label className={label}>UTR number *</label><input value={utr} onChange={e => setUtr(e.target.value)} placeholder="e.g. ICICN42025103159071701" className={field} /></div>
                    <div>
                        <label className={label}>Payment proof</label>
                        <label className="flex items-center gap-2 px-3 py-2 border border-dashed border-border rounded-lg text-sm text-text-secondary cursor-pointer hover:border-primary/40">
                            {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : proof ? <FileText className="w-4 h-4" /> : <Upload className="w-4 h-4" />}
                            {uploading ? 'Uploading…' : proof ? proof.file_name : 'Upload screenshot / voucher'}
                            <input type="file" className="hidden" onChange={e => upload(e.target.files?.[0] || null)} accept="application/pdf,image/*" />
                        </label>
                    </div>
                    <div><label className={label}>Remarks</label><input value={remarks} onChange={e => setRemarks(e.target.value)} className={field} /></div>
                    <p className="text-[11px] text-text-tertiary">On confirm, the UTR is emailed to procurement + accounts (if email is configured).</p>
                    {error && <p className="text-sm text-red-600">{error}</p>}
                </div>

                <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border bg-surface-elevated">
                    <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-text-secondary hover:bg-muted rounded-xl">Cancel</button>
                    <button onClick={submit} disabled={saving || uploading} className="inline-flex items-center gap-1.5 px-5 py-2 bg-primary text-white rounded-xl text-sm font-bold hover:bg-primary/90 disabled:opacity-50">
                        {saving && <Loader2 className="w-4 h-4 animate-spin" />} Confirm payment
                    </button>
                </div>
            </div>
        </div>,
        document.body,
    );
}
