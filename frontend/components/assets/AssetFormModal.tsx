'use client';

import { useEffect, useState } from 'react';
import { X, Loader2, AlertCircle } from 'lucide-react';
import type { EnrichedAsset } from '@/backend/lib/assets/enrich';

interface CategoryOption { id: string; name: string; code: string; default_lifecycle_years: number | null }

interface Props {
    organizationId: string;
    propertyId: string;
    asset?: EnrichedAsset | null; // when set, edit mode
    categories: CategoryOption[];
    onClose: () => void;
    onSaved: () => void;
}

interface FormState {
    name: string;
    category_id: string;
    asset_code: string;
    asset_type: string;
    make: string;
    model: string;
    serial_number: string;
    floor: string;
    location: string;
    installation_date: string;
    purchase_cost: string;
    vendor_name: string;
    lifecycle_years: string;
    warranty_start: string;
    warranty_end: string;
    amc_required: boolean;
    notes: string;
}

const EMPTY: FormState = {
    name: '', category_id: '', asset_code: '', asset_type: '', make: '', model: '', serial_number: '',
    floor: '', location: '', installation_date: '', purchase_cost: '', vendor_name: '', lifecycle_years: '',
    warranty_start: '', warranty_end: '', amc_required: false, notes: '',
};

const inputCls = 'w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary';
const labelCls = 'block text-xs font-bold text-slate-500 uppercase tracking-wide mb-1.5';

export default function AssetFormModal({ organizationId, propertyId, asset, categories, onClose, onSaved }: Props) {
    const [form, setForm] = useState<FormState>(EMPTY);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const isEdit = !!asset;

    useEffect(() => {
        if (!asset) { setForm(EMPTY); return; }
        setForm({
            name: asset.name,
            category_id: asset.category_id || '',
            asset_code: asset.asset_code,
            asset_type: asset.asset_type || '',
            make: asset.make || '',
            model: asset.model || '',
            serial_number: asset.serial_number || '',
            floor: asset.floor || '',
            location: asset.location || '',
            installation_date: asset.installation_date || '',
            purchase_cost: asset.purchase_cost != null ? String(asset.purchase_cost) : '',
            vendor_name: asset.vendor_name || '',
            lifecycle_years: asset.lifecycle_years != null ? String(asset.lifecycle_years) : '',
            warranty_start: asset.warranty_start || '',
            warranty_end: asset.warranty_end || '',
            amc_required: !!asset.amc_required,
            notes: asset.notes || '',
        });
    }, [asset]);

    const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }));

    const handleSubmit = async () => {
        if (!form.name.trim() || !form.category_id) { setError('Asset Name and Category are required'); return; }
        setSaving(true);
        setError('');
        try {
            const payload: Record<string, unknown> = {
                organization_id: organizationId,
                property_id: propertyId,
                name: form.name.trim(),
                category_id: form.category_id,
                asset_type: form.asset_type || null,
                make: form.make || null,
                model: form.model || null,
                serial_number: form.serial_number || null,
                floor: form.floor || null,
                location: form.location || null,
                installation_date: form.installation_date || null,
                purchase_cost: form.purchase_cost ? Number(form.purchase_cost) : null,
                vendor_name: form.vendor_name || null,
                lifecycle_years: form.lifecycle_years ? Number(form.lifecycle_years) : null,
                warranty_start: form.warranty_start || null,
                warranty_end: form.warranty_end || null,
                amc_required: form.amc_required,
                notes: form.notes || null,
            };
            if (!isEdit && form.asset_code.trim()) payload.asset_code = form.asset_code.trim();

            const res = await fetch(isEdit ? `/api/assets/${asset!.id}` : '/api/assets', {
                method: isEdit ? 'PATCH' : 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to save asset');
            onSaved();
        } catch (err: any) {
            setError(err.message || 'Failed to save asset');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
            <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between p-6 border-b border-slate-100 flex-shrink-0">
                    <h2 className="text-lg font-extrabold text-slate-900">{isEdit ? 'Edit Asset' : 'Register Asset'}</h2>
                    <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-xl"><X size={20} className="text-slate-400" /></button>
                </div>

                <div className="flex-1 overflow-y-auto p-6 space-y-5">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="sm:col-span-2">
                            <label className={labelCls}>Asset Name *</label>
                            <input className={inputCls} value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Split AC — Cabin 3" />
                        </div>
                        <div>
                            <label className={labelCls}>Category *</label>
                            <select className={inputCls} value={form.category_id} onChange={(e) => set('category_id', e.target.value)}>
                                <option value="">Select category</option>
                                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className={labelCls}>Asset Code</label>
                            <input
                                className={inputCls}
                                value={form.asset_code}
                                onChange={(e) => set('asset_code', e.target.value)}
                                placeholder={isEdit ? undefined : 'Auto-generated if left blank'}
                                disabled={isEdit}
                            />
                        </div>
                        <div>
                            <label className={labelCls}>Type / Capacity</label>
                            <input className={inputCls} value={form.asset_type} onChange={(e) => set('asset_type', e.target.value)} placeholder="e.g. Split AC 1.5 TR" />
                        </div>
                        <div>
                            <label className={labelCls}>Make</label>
                            <input className={inputCls} value={form.make} onChange={(e) => set('make', e.target.value)} />
                        </div>
                        <div>
                            <label className={labelCls}>Model</label>
                            <input className={inputCls} value={form.model} onChange={(e) => set('model', e.target.value)} />
                        </div>
                        <div>
                            <label className={labelCls}>Serial Number</label>
                            <input className={inputCls} value={form.serial_number} onChange={(e) => set('serial_number', e.target.value)} />
                        </div>
                        <div>
                            <label className={labelCls}>Floor</label>
                            <input className={inputCls} value={form.floor} onChange={(e) => set('floor', e.target.value)} placeholder="e.g. 3rd Floor" />
                        </div>
                        <div className="sm:col-span-2">
                            <label className={labelCls}>Location</label>
                            <input className={inputCls} value={form.location} onChange={(e) => set('location', e.target.value)} placeholder="Room / area" />
                        </div>

                        <div>
                            <label className={labelCls}>Installation Date</label>
                            <input type="date" className={inputCls} value={form.installation_date} onChange={(e) => set('installation_date', e.target.value)} />
                        </div>
                        <div>
                            <label className={labelCls}>Lifecycle (Years)</label>
                            <input type="number" min={1} className={inputCls} value={form.lifecycle_years} onChange={(e) => set('lifecycle_years', e.target.value)} placeholder="Category default if blank" />
                        </div>
                        <div>
                            <label className={labelCls}>Purchase Cost (₹)</label>
                            <input type="number" min={0} className={inputCls} value={form.purchase_cost} onChange={(e) => set('purchase_cost', e.target.value)} />
                        </div>
                        <div>
                            <label className={labelCls}>Vendor</label>
                            <input className={inputCls} value={form.vendor_name} onChange={(e) => set('vendor_name', e.target.value)} />
                        </div>
                        <div>
                            <label className={labelCls}>Warranty Start</label>
                            <input type="date" className={inputCls} value={form.warranty_start} onChange={(e) => set('warranty_start', e.target.value)} />
                        </div>
                        <div>
                            <label className={labelCls}>Warranty End</label>
                            <input type="date" className={inputCls} value={form.warranty_end} onChange={(e) => set('warranty_end', e.target.value)} />
                        </div>

                        <div className="sm:col-span-2 flex items-center gap-2.5">
                            <input
                                id="amc-required"
                                type="checkbox"
                                checked={form.amc_required}
                                onChange={(e) => set('amc_required', e.target.checked)}
                                className="w-4 h-4 rounded border-slate-300 text-primary focus:ring-primary/30"
                            />
                            <label htmlFor="amc-required" className="text-sm font-semibold text-slate-700">This asset requires an AMC</label>
                        </div>

                        <div className="sm:col-span-2">
                            <label className={labelCls}>Notes</label>
                            <textarea rows={2} className={`${inputCls} resize-none`} value={form.notes} onChange={(e) => set('notes', e.target.value)} />
                        </div>
                    </div>

                    {error && <p className="flex items-center gap-2 text-sm text-red-600 font-semibold"><AlertCircle size={16} /> {error}</p>}
                </div>

                <div className="p-6 pt-4 border-t border-slate-100 flex gap-3 flex-shrink-0">
                    <button onClick={onClose} className="px-5 py-3 bg-slate-100 text-slate-600 rounded-2xl text-sm font-bold">Cancel</button>
                    <button
                        onClick={handleSubmit}
                        disabled={saving}
                        className="flex-1 py-3 bg-primary text-white rounded-2xl text-sm font-black uppercase tracking-widest disabled:opacity-40 flex items-center justify-center gap-2"
                    >
                        {saving && <Loader2 size={16} className="animate-spin" />}
                        {saving ? 'Saving...' : isEdit ? 'Save Changes' : 'Register Asset'}
                    </button>
                </div>
            </div>
        </div>
    );
}
