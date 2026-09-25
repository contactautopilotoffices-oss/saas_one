'use client';

import { useCallback, useEffect, useState } from 'react';
import { Plus, Trash2, Loader2, Lock } from 'lucide-react';

interface Category {
    id: string; organization_id: string | null; name: string; code: string; color: string | null;
    default_lifecycle_years: number | null; amc_required_by_default: boolean; sort_order: number;
}

const SWATCHES = ['#708F96', '#0EA5E9', '#F59E0B', '#EF4444', '#7C3AED', '#2563EB', '#10B981', '#6366F1', '#A16207', '#EA580C'];

export default function AssetCategoriesPanel({ organizationId, canManage }: { organizationId: string; canManage: boolean }) {
    const [categories, setCategories] = useState<Category[]>([]);
    const [loading, setLoading] = useState(true);
    const [showAdd, setShowAdd] = useState(false);
    const [saving, setSaving] = useState(false);
    const [name, setName] = useState('');
    const [code, setCode] = useState('');
    const [color, setColor] = useState(SWATCHES[0]);
    const [lifecycle, setLifecycle] = useState('5');
    const [amcDefault, setAmcDefault] = useState(false);
    const [error, setError] = useState('');

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const res = await fetch(`/api/assets/categories?organization_id=${organizationId}`);
            if (res.ok) { const data = await res.json(); setCategories(data.categories || []); }
        } finally {
            setLoading(false);
        }
    }, [organizationId]);

    useEffect(() => { load(); }, [load]);

    const handleAdd = async () => {
        if (!name.trim() || !code.trim()) { setError('Name and code are required'); return; }
        setSaving(true);
        setError('');
        try {
            const res = await fetch('/api/assets/categories', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ organization_id: organizationId, name: name.trim(), code: code.trim(), color, default_lifecycle_years: Number(lifecycle) || 5, amc_required_by_default: amcDefault }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to add category');
            setName(''); setCode(''); setLifecycle('5'); setAmcDefault(false); setShowAdd(false);
            load();
        } catch (err: any) {
            setError(err.message || 'Failed to add category');
        } finally {
            setSaving(false);
        }
    };

    const handleRemove = async (id: string) => {
        if (!confirm('Remove this category? Existing assets keep it until reassigned.')) return;
        const res = await fetch(`/api/assets/categories?id=${id}`, { method: 'DELETE' });
        if (res.ok) load();
    };

    return (
        <div className="space-y-4 max-w-2xl">
            <p className="text-sm text-slate-500">
                Categories drive the QR label, the import template, and floor/usage filters — HVAC, IT, laptops, whatever this org tags.
            </p>

            {loading ? (
                <div className="flex justify-center py-10"><Loader2 className="animate-spin text-primary" /></div>
            ) : (
                <div className="rounded-2xl border border-slate-100 divide-y divide-slate-50">
                    {categories.map((c) => (
                        <div key={c.id} className="flex items-center gap-3 p-3.5">
                            <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: c.color || '#708F96' }} />
                            <div className="flex-1 min-w-0">
                                <p className="text-sm font-bold text-slate-800">{c.name}</p>
                                <p className="text-xs text-slate-400">{c.code} · {c.default_lifecycle_years || 5}-year default lifecycle{c.amc_required_by_default ? ' · AMC by default' : ''}</p>
                            </div>
                            {c.organization_id === null ? (
                                <span title="Platform default — cannot be removed" className="p-1.5 text-slate-300"><Lock size={15} /></span>
                            ) : canManage && (
                                <button onClick={() => handleRemove(c.id)} className="p-1.5 hover:bg-rose-50 rounded-lg text-rose-400"><Trash2 size={15} /></button>
                            )}
                        </div>
                    ))}
                </div>
            )}

            {canManage && (
                showAdd ? (
                    <div className="rounded-2xl border border-slate-100 p-4 space-y-3">
                        <div className="grid grid-cols-2 gap-3">
                            <input placeholder="Name (e.g. Laptops)" value={name} onChange={(e) => setName(e.target.value)} className="px-3 py-2 rounded-xl border border-slate-200 text-sm" />
                            <input placeholder="Code (e.g. IT)" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} className="px-3 py-2 rounded-xl border border-slate-200 text-sm" />
                            <input type="number" min={1} placeholder="Default lifecycle (years)" value={lifecycle} onChange={(e) => setLifecycle(e.target.value)} className="px-3 py-2 rounded-xl border border-slate-200 text-sm" />
                            <div className="flex items-center gap-2 px-1">
                                <input id="cat-amc" type="checkbox" checked={amcDefault} onChange={(e) => setAmcDefault(e.target.checked)} className="rounded border-slate-300" />
                                <label htmlFor="cat-amc" className="text-xs font-semibold text-slate-600">AMC required by default</label>
                            </div>
                        </div>
                        <div className="flex gap-2">
                            {SWATCHES.map((s) => (
                                <button key={s} onClick={() => setColor(s)} className={`w-6 h-6 rounded-full ${color === s ? 'ring-2 ring-offset-2 ring-slate-400' : ''}`} style={{ backgroundColor: s }} />
                            ))}
                        </div>
                        {error && <p className="text-xs text-red-600 font-semibold">{error}</p>}
                        <div className="flex gap-2">
                            <button onClick={() => setShowAdd(false)} className="px-4 py-2 bg-slate-100 text-slate-600 rounded-xl text-xs font-bold">Cancel</button>
                            <button onClick={handleAdd} disabled={saving} className="px-4 py-2 bg-primary text-white rounded-xl text-xs font-black uppercase tracking-wide disabled:opacity-40">
                                {saving ? 'Saving...' : 'Add Category'}
                            </button>
                        </div>
                    </div>
                ) : (
                    <button onClick={() => setShowAdd(true)} className="flex items-center gap-1.5 text-sm font-bold text-primary">
                        <Plus size={16} /> Add category
                    </button>
                )
            )}
        </div>
    );
}
