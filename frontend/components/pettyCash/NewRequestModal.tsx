'use client';

import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, Upload, Loader2, FileText, Trash2 } from 'lucide-react';
import { PC_CATEGORIES, PC_PAYMENT_MODES, PC_DEPARTMENTS } from '@/frontend/lib/pettyCash/roles';

interface Props {
    open: boolean;
    properties: { id: string; name: string }[];
    onClose: () => void;
    onCreated: () => void;
}

interface PendingDoc { url: string; file_name: string; file_type: string; }

export default function NewRequestModal({ open, properties, onClose, onCreated }: Props) {
    const [propertyId, setPropertyId] = useState('');
    const [requestType, setRequestType] = useState<'advance' | 'reimbursement'>('advance');
    const [department, setDepartment] = useState('');
    const [category, setCategory] = useState('');
    const [amount, setAmount] = useState('');
    const [purpose, setPurpose] = useState('');
    const [paymentMode, setPaymentMode] = useState('Cash');
    const [expectedDate, setExpectedDate] = useState('');
    const [vendorName, setVendorName] = useState('');
    const [docs, setDocs] = useState<PendingDoc[]>([]);
    const [uploading, setUploading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!open) return;
        setPropertyId(properties.length === 1 ? properties[0].id : '');
        setRequestType('advance'); setDepartment(''); setCategory(''); setAmount('');
        setPurpose(''); setPaymentMode('Cash'); setExpectedDate(''); setVendorName('');
        setDocs([]); setError(null);
    }, [open, properties]);

    const handleUpload = async (files: FileList | null) => {
        if (!files?.length) return;
        setUploading(true);
        try {
            for (const file of Array.from(files)) {
                const fd = new FormData();
                fd.append('file', file);
                const res = await fetch('/api/petty-cash/upload', { method: 'POST', body: fd });
                if (res.ok) { const d = await res.json(); setDocs(prev => [...prev, d]); }
            }
        } finally { setUploading(false); }
    };

    const handleSubmit = async () => {
        if (!propertyId) { setError('Choose a property'); return; }
        if (!amount || Number(amount) <= 0) { setError('Enter a valid amount'); return; }
        if (!purpose.trim()) { setError('Describe the purpose'); return; }
        setSaving(true); setError(null);
        try {
            const res = await fetch('/api/petty-cash', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    property_id: propertyId, request_type: requestType, department, category,
                    amount_requested: Number(amount), purpose: purpose.trim(), payment_mode: paymentMode,
                    expected_date: expectedDate || null, vendor_name: vendorName || null, documents: docs,
                }),
            });
            if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || 'Failed to create request'); }
            onCreated();
        } catch (e) { setError(e instanceof Error ? e.message : 'Failed to create request'); }
        finally { setSaving(false); }
    };

    if (!open || typeof document === 'undefined') return null;

    const field = 'w-full px-3 py-2 border border-border rounded-lg text-sm bg-surface text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary';
    const label = 'block text-xs font-bold text-text-secondary uppercase tracking-wide mb-1.5';

    return createPortal(
        <div className="fixed inset-0 bg-black/50 z-[80] flex items-center justify-center p-4" onClick={onClose}>
            <div onClick={e => e.stopPropagation()} className="bg-surface rounded-2xl shadow-2xl w-full max-w-lg max-h-[88vh] overflow-hidden flex flex-col">
                <div className="flex items-center justify-between px-6 py-4 border-b border-border">
                    <h3 className="text-base font-bold text-text-primary">New petty cash request</h3>
                    <button onClick={onClose} className="p-2 hover:bg-muted rounded-xl"><X className="w-5 h-5 text-text-secondary" /></button>
                </div>

                <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className={label}>Property</label>
                            <select value={propertyId} onChange={e => setPropertyId(e.target.value)} className={field}>
                                <option value="">Select…</option>
                                {properties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className={label}>Type</label>
                            <select value={requestType} onChange={e => setRequestType(e.target.value as 'advance' | 'reimbursement')} className={field}>
                                <option value="advance">Advance</option>
                                <option value="reimbursement">Reimbursement</option>
                            </select>
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className={label}>Amount (₹)</label>
                            <input type="number" min="0" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0" className={field} />
                        </div>
                        <div>
                            <label className={label}>Payment mode</label>
                            <select value={paymentMode} onChange={e => setPaymentMode(e.target.value)} className={field}>
                                {PC_PAYMENT_MODES.map(m => <option key={m} value={m}>{m}</option>)}
                            </select>
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className={label}>Department</label>
                            <select value={department} onChange={e => setDepartment(e.target.value)} className={field}>
                                <option value="">—</option>
                                {PC_DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className={label}>Category</label>
                            <select value={category} onChange={e => setCategory(e.target.value)} className={field}>
                                <option value="">—</option>
                                {PC_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                            </select>
                        </div>
                    </div>

                    <div>
                        <label className={label}>Purpose</label>
                        <textarea value={purpose} onChange={e => setPurpose(e.target.value)} rows={2} placeholder="What is this for?" className={`${field} resize-none`} />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className={label}>Expected date</label>
                            <input type="date" value={expectedDate} onChange={e => setExpectedDate(e.target.value)} className={field} />
                        </div>
                        <div>
                            <label className={label}>Vendor (optional)</label>
                            <input value={vendorName} onChange={e => setVendorName(e.target.value)} placeholder="Vendor name" className={field} />
                        </div>
                    </div>

                    {/* Documents */}
                    <div>
                        <label className={label}>Supporting documents</label>
                        <label className="flex items-center gap-2 px-3 py-2 border border-dashed border-border rounded-lg text-sm text-text-secondary cursor-pointer hover:border-primary/40">
                            {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                            {uploading ? 'Uploading…' : 'Upload bills / quotes (PDF, image)'}
                            <input type="file" multiple className="hidden" onChange={e => handleUpload(e.target.files)}
                                accept="application/pdf,image/*,.csv,.xls,.xlsx" />
                        </label>
                        {docs.length > 0 && (
                            <div className="mt-2 space-y-1">
                                {docs.map((d, i) => (
                                    <div key={i} className="flex items-center gap-2 text-xs text-text-secondary bg-surface-elevated rounded-lg px-2.5 py-1.5">
                                        <FileText className="w-3.5 h-3.5" /> <span className="flex-1 truncate">{d.file_name}</span>
                                        <button onClick={() => setDocs(prev => prev.filter((_, j) => j !== i))}><Trash2 className="w-3.5 h-3.5 hover:text-red-500" /></button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {error && <p className="text-sm text-red-600">{error}</p>}
                </div>

                <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border bg-surface-elevated">
                    <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-text-secondary hover:bg-muted rounded-xl">Cancel</button>
                    <button onClick={handleSubmit} disabled={saving || uploading}
                        className="inline-flex items-center gap-1.5 px-5 py-2 bg-primary text-white rounded-xl text-sm font-bold hover:bg-primary/90 disabled:opacity-50">
                        {saving && <Loader2 className="w-4 h-4 animate-spin" />} Submit request
                    </button>
                </div>
            </div>
        </div>,
        document.body,
    );
}
