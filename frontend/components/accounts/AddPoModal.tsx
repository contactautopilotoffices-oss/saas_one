'use client';

import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Loader2, Upload } from 'lucide-react';
import Papa from 'papaparse';

interface Props { onClose: () => void; onDone: () => void; }

export default function AddPoModal({ onClose, onDone }: Props) {
    const [mode, setMode] = useState<'manual' | 'import'>('manual');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [result, setResult] = useState<string | null>(null);

    // manual
    const [f, setF] = useState<Record<string, string>>({ po_number: '', vendor_name: '', po_amount: '', department: '', project_name: '', category: '', po_date: '' });
    const set = (k: string, v: string) => setF(prev => ({ ...prev, [k]: v }));

    const submitManual = async () => {
        if (!f.po_number.trim()) { setError('PO number is required'); return; }
        setSaving(true); setError(null);
        try {
            const res = await fetch('/api/accounts/pos', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...f, po_amount: Number(f.po_amount) || 0 }),
            });
            if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || 'Failed to add PO'); }
            onDone();
        } catch (e) { setError(e instanceof Error ? e.message : 'Failed to add PO'); }
        finally { setSaving(false); }
    };

    const importCsv = (file: File | null) => {
        if (!file) return;
        setSaving(true); setError(null); setResult(null);
        Papa.parse<Record<string, string>>(file, {
            header: true, skipEmptyLines: true,
            complete: async (parsed) => {
                try {
                    const rows = parsed.data.filter(r => r && Object.keys(r).length);
                    if (!rows.length) throw new Error('No rows found in file');
                    const res = await fetch('/api/accounts/pos', {
                        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rows }),
                    });
                    if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || 'Import failed'); }
                    const d = await res.json();
                    setResult(`Imported ${d.imported} PO(s).`);
                    setTimeout(onDone, 900);
                } catch (e) { setError(e instanceof Error ? e.message : 'Import failed'); }
                finally { setSaving(false); }
            },
            error: () => { setError('Could not read the file'); setSaving(false); },
        });
    };

    if (typeof document === 'undefined') return null;
    const field = 'w-full px-3 py-2 border border-border rounded-lg text-sm bg-surface text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-primary/20';
    const label = 'block text-xs font-bold text-text-secondary uppercase tracking-wide mb-1.5';

    return createPortal(
        <div className="fixed inset-0 bg-black/50 z-[80] flex items-center justify-center p-4" onClick={onClose}>
            <div onClick={e => e.stopPropagation()} className="bg-surface rounded-2xl shadow-2xl w-full max-w-md max-h-[88vh] overflow-hidden flex flex-col">
                <div className="flex items-center justify-between px-6 py-4 border-b border-border">
                    <h3 className="text-base font-bold text-text-primary">Add / Import PO</h3>
                    <button onClick={onClose} className="p-2 hover:bg-muted rounded-xl"><X className="w-5 h-5 text-text-secondary" /></button>
                </div>

                <div className="flex items-center gap-1 px-6 pt-3 border-b border-border">
                    {(['manual', 'import'] as const).map(m => (
                        <button key={m} onClick={() => { setMode(m); setError(null); }}
                            className={`px-3 py-2 text-sm font-bold border-b-2 ${mode === m ? 'border-primary text-primary' : 'border-transparent text-text-secondary'}`}>
                            {m === 'manual' ? 'Add one' : 'Import CSV'}
                        </button>
                    ))}
                </div>

                <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
                    {mode === 'manual' ? (
                        <>
                            <div className="grid grid-cols-2 gap-3">
                                <div><label className={label}>PO number *</label><input value={f.po_number} onChange={e => set('po_number', e.target.value)} placeholder="PO-25/26-1234" className={field} /></div>
                                <div><label className={label}>PO amount (₹)</label><input type="number" value={f.po_amount} onChange={e => set('po_amount', e.target.value)} className={field} /></div>
                                <div className="col-span-2"><label className={label}>Vendor</label><input value={f.vendor_name} onChange={e => set('vendor_name', e.target.value)} className={field} /></div>
                                <div><label className={label}>Department</label>
                                    <select value={f.department} onChange={e => set('department', e.target.value)} className={field}><option value="">—</option><option>Capex</option><option>Opex</option></select>
                                </div>
                                <div><label className={label}>Category</label><input value={f.category} onChange={e => set('category', e.target.value)} className={field} /></div>
                                <div><label className={label}>Site / Project</label><input value={f.project_name} onChange={e => set('project_name', e.target.value)} className={field} /></div>
                                <div><label className={label}>PO date</label><input type="date" value={f.po_date} onChange={e => set('po_date', e.target.value)} className={field} /></div>
                            </div>
                            {error && <p className="text-sm text-red-600">{error}</p>}
                        </>
                    ) : (
                        <>
                            <p className="text-sm text-text-secondary">Upload a CSV. Recognised columns: <span className="font-mono text-xs">Purchase Order# / PO No, Vendor Name, Amount / PO Value, Status, Department, Project Name / Site, Category</span>. Re-imports update by PO number.</p>
                            <label className="flex items-center justify-center gap-2 px-4 py-8 border border-dashed border-border rounded-xl text-sm text-text-secondary cursor-pointer hover:border-primary/40">
                                {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Upload className="w-5 h-5" />}
                                {saving ? 'Importing…' : 'Choose CSV file'}
                                <input type="file" accept=".csv,text/csv" className="hidden" onChange={e => importCsv(e.target.files?.[0] || null)} />
                            </label>
                            {result && <p className="text-sm text-emerald-600">{result}</p>}
                            {error && <p className="text-sm text-red-600">{error}</p>}
                        </>
                    )}
                </div>

                {mode === 'manual' && (
                    <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border bg-surface-elevated">
                        <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-text-secondary hover:bg-muted rounded-xl">Cancel</button>
                        <button onClick={submitManual} disabled={saving} className="inline-flex items-center gap-1.5 px-5 py-2 bg-primary text-white rounded-xl text-sm font-bold hover:bg-primary/90 disabled:opacity-50">
                            {saving && <Loader2 className="w-4 h-4 animate-spin" />} Add PO
                        </button>
                    </div>
                )}
            </div>
        </div>,
        document.body,
    );
}
