'use client';

import { useMemo, useState } from 'react';
import { X, Save, Loader2, Search, ClipboardList } from 'lucide-react';

export interface CurrentStockItem {
    id: string;
    name: string;
    category?: string | null;
    unit?: string | null;
    quantity: number;
}

interface Props {
    propertyId: string;
    items: CurrentStockItem[];
    onClose: () => void;
    onSaved: (updated: number) => void;
}

/**
 * Update Current Stock: every item on one screen, grouped by category, one box
 * per item for today's count, one Save. Only the items whose number changed are
 * sent, and each gets a history line on the server.
 */
export default function CurrentStockModal({ propertyId, items, onClose, onSaved }: Props) {
    const [counts, setCounts] = useState<Record<string, string>>(
        () => Object.fromEntries(items.map(i => [i.id, String(Number(i.quantity) || 0)]))
    );
    const [search, setSearch] = useState('');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const groups = useMemo(() => {
        const q = search.trim().toLowerCase();
        const byCategory = new Map<string, CurrentStockItem[]>();
        for (const item of items) {
            if (q && !item.name.toLowerCase().includes(q)) continue;
            const key = item.category || 'General';
            if (!byCategory.has(key)) byCategory.set(key, []);
            byCategory.get(key)!.push(item);
        }
        return [...byCategory.entries()];
    }, [items, search]);

    const changed = useMemo(
        () => items.filter(i => counts[i.id] !== '' && Number(counts[i.id]) !== Number(i.quantity)),
        [items, counts]
    );
    const invalid = items.some(i => counts[i.id] !== '' && (!Number.isFinite(Number(counts[i.id])) || Number(counts[i.id]) < 0));

    const handleSave = async () => {
        if (changed.length === 0 || invalid) return;
        setSaving(true);
        setError(null);
        try {
            const res = await fetch(`/api/properties/${propertyId}/stock/current`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ counts: changed.map(i => ({ itemId: i.id, quantity: Number(counts[i.id]) })) }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Could not save the stock count');
            onSaved(data.updated || 0);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not save the stock count');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-2 sm:p-4" onClick={onClose}>
            <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl max-h-[92vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between p-5 border-b border-slate-100">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-primary/10 rounded-2xl flex items-center justify-center">
                            <ClipboardList size={20} className="text-primary" />
                        </div>
                        <div>
                            <h2 className="text-lg font-extrabold text-slate-900">Update Current Stock</h2>
                            <p className="text-xs text-slate-500">Type what is in the store right now</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-xl" aria-label="Close">
                        <X size={20} className="text-slate-400" />
                    </button>
                </div>

                <div className="px-5 pt-4">
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={15} />
                        <input
                            type="text"
                            placeholder="Search item..."
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-blue-400"
                        />
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
                    {groups.length === 0 && (
                        <p className="text-center text-sm text-slate-400 py-10">No items match.</p>
                    )}
                    {groups.map(([category, rows]) => (
                        <div key={category}>
                            <h3 className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-2">{category}</h3>
                            <div className="divide-y divide-slate-100 border border-slate-100 rounded-2xl">
                                {rows.map(item => {
                                    const value = counts[item.id] ?? '';
                                    const isChanged = value !== '' && Number(value) !== Number(item.quantity);
                                    return (
                                        <label key={item.id} className={`flex items-center gap-3 px-3 py-2 ${isChanged ? 'bg-blue-50/60' : ''}`}>
                                            <span className="flex-1 min-w-0">
                                                <span className="block text-sm font-medium text-slate-900 truncate">{item.name}</span>
                                                <span className="block text-[11px] text-slate-400">Was {Number(item.quantity) || 0} {item.unit || ''}</span>
                                            </span>
                                            <input
                                                type="number"
                                                inputMode="decimal"
                                                min={0}
                                                step="any"
                                                value={value}
                                                onChange={(e) => setCounts(prev => ({ ...prev, [item.id]: e.target.value }))}
                                                onWheel={(e) => (e.target as HTMLInputElement).blur()}
                                                className="w-24 px-2 py-1.5 text-right bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-blue-400"
                                                aria-label={`Current stock of ${item.name}`}
                                            />
                                            <span className="w-12 text-[11px] text-slate-400 truncate">{item.unit || ''}</span>
                                        </label>
                                    );
                                })}
                            </div>
                        </div>
                    ))}
                </div>

                <div className="p-5 border-t border-slate-100 space-y-2">
                    {error && <p className="text-sm text-red-600">{error}</p>}
                    {invalid && <p className="text-sm text-red-600">Quantities must be 0 or more.</p>}
                    <button
                        onClick={handleSave}
                        disabled={saving || changed.length === 0 || invalid}
                        className="w-full py-3 bg-primary text-white rounded-2xl text-sm font-black uppercase tracking-widest disabled:opacity-40 flex items-center justify-center gap-2"
                    >
                        {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                        {saving ? 'Saving' : changed.length === 0 ? 'No changes' : `Save ${changed.length} item${changed.length === 1 ? '' : 's'}`}
                    </button>
                </div>
            </div>
        </div>
    );
}
