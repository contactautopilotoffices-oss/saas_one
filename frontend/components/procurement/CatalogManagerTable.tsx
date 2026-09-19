'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    Search, Loader2, Trash2, ImageIcon, AlertTriangle, ArchiveRestore,
    Archive, Package, Check,
} from 'lucide-react';
import { compressImage } from '@/frontend/utils/image-compression';

/**
 * Manage Items — the catalog as procurement actually works with it.
 *
 * Two sections, because they mean different things:
 *   Standard — the list every property is offered on its monthly requisition.
 *   Legacy   — items predating standardisation, or dropped from a later
 *              template. Kept and editable, but not offered to anyone.
 *
 * Every template column is shown and every one is editable in place. A blank
 * value is fine and stays blank; it is never filled in with a guess.
 */

export type Lifecycle = 'standard' | 'legacy' | 'retired';

export interface CatalogManagerItem {
    id: string;
    name: string;
    description?: string | null;
    photo_url?: string | null;
    category?: string | null;
    unit?: string | null;
    brand?: string | null;
    item_code?: string | null;
    unit_price?: number | null;
    estimated_price?: number | null;
    sort_order?: number;
    lifecycle?: Lifecycle;
}

interface Props {
    organizationId: string;
    items: CatalogManagerItem[];
    isLoading: boolean;
    canManage: boolean;
    onItemUpdated: (item: CatalogManagerItem) => void;
    onItemDeleted: (id: string) => void;
}

const CATEGORIES = ['HK', 'Beverages', 'Technical', 'General'];

/** Column order mirrors the upload template, so the screen reads like the sheet. */
type EditableField = 'sort_order' | 'name' | 'category' | 'unit' | 'brand' | 'unit_price';

const priceOf = (item: CatalogManagerItem) =>
    item.unit_price ?? item.estimated_price ?? 0;

export default function CatalogManagerTable({
    organizationId, items, isLoading, canManage, onItemUpdated, onItemDeleted,
}: Props) {
    const [section, setSection] = useState<'standard' | 'legacy'>('standard');
    const [search, setSearch] = useState('');
    const [savingCell, setSavingCell] = useState<string | null>(null);
    const [savedCell, setSavedCell] = useState<string | null>(null);
    const [rowBusy, setRowBusy] = useState<string | null>(null);
    const [error, setError] = useState<string>('');

    const photoInputRef = useRef<HTMLInputElement>(null);
    const photoTargetId = useRef<string | null>(null);

    const counts = useMemo(() => ({
        standard: items.filter(i => (i.lifecycle || 'standard') === 'standard').length,
        legacy: items.filter(i => i.lifecycle === 'legacy').length,
    }), [items]);

    const visible = useMemo(() => {
        const q = search.trim().toLowerCase();
        return items
            .filter(i => (i.lifecycle || 'standard') === section)
            .filter(i => !q
                || i.name?.toLowerCase().includes(q)
                || (i.brand || '').toLowerCase().includes(q)
                || (i.category || '').toLowerCase().includes(q));
    }, [items, section, search]);

    // ─── Persist one field ────────────────────────────────────────────────────
    const patch = useCallback(async (
        item: CatalogManagerItem,
        payload: Record<string, unknown>,
        cellKey?: string,
    ) => {
        if (cellKey) setSavingCell(cellKey);
        setError('');
        try {
            const res = await fetch('/api/procurement/catalog', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: item.id, organization_id: organizationId, ...payload }),
            });
            const data = await res.json();

            if (!res.ok) {
                setError(data.error || 'Could not save that change');
                return false;
            }
            onItemUpdated({ ...item, ...data });
            if (cellKey) {
                setSavedCell(cellKey);
                setTimeout(() => setSavedCell(prev => (prev === cellKey ? null : prev)), 1400);
            }
            return true;
        } catch {
            setError('Network error while saving');
            return false;
        } finally {
            if (cellKey) setSavingCell(null);
        }
    }, [organizationId, onItemUpdated]);

    /** Commit on blur, and only when the value actually changed. */
    const commitField = (item: CatalogManagerItem, field: EditableField, raw: string) => {
        const current = field === 'unit_price' ? String(priceOf(item))
            : field === 'sort_order' ? String(item.sort_order ?? 0)
                : String((item as unknown as Record<string, unknown>)[field] ?? '');

        if (raw === current) return;
        if (field === 'name' && !raw.trim()) return; // never blank out the identity
        void patch(item, { [field]: raw }, `${item.id}:${field}`);
    };

    const moveTo = async (item: CatalogManagerItem, lifecycle: Lifecycle) => {
        setRowBusy(item.id);
        await patch(item, { lifecycle });
        setRowBusy(null);
    };

    const remove = async (item: CatalogManagerItem) => {
        if (!confirm(`Remove "${item.name}" from the catalog?\n\nIt is deactivated, not deleted — anything already referencing it keeps working.`)) return;
        setRowBusy(item.id);
        setError('');
        try {
            const res = await fetch('/api/procurement/catalog', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: item.id, organization_id: organizationId }),
            });
            if (res.ok) onItemDeleted(item.id);
            else setError((await res.json()).error || 'Could not remove that item');
        } catch {
            setError('Network error while removing the item');
        } finally {
            setRowBusy(null);
        }
    };

    // ─── Photo replace ────────────────────────────────────────────────────────
    const pickPhoto = (id: string) => {
        photoTargetId.current = id;
        photoInputRef.current?.click();
    };

    const onPhotoChosen = async (file: File | null) => {
        const id = photoTargetId.current;
        photoTargetId.current = null;
        if (!file || !id) return;

        const item = items.find(i => i.id === id);
        if (!item) return;

        setRowBusy(id);
        try {
            // compressImage returns a File; the API wants a data URL.
            const compressed = await compressImage(file, {
                maxWidth: 400, maxHeight: 400, quality: 0.6, maxSizeKB: 100,
            });
            const dataUrl = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(String(reader.result || ''));
                reader.onerror = () => reject(new Error('read failed'));
                reader.readAsDataURL(compressed);
            });

            if (dataUrl.startsWith('data:image')) {
                await patch(item, { photo_base64: dataUrl });
            } else {
                setError('Could not read that image');
            }
        } catch {
            setError('Could not read that image');
        } finally {
            setRowBusy(null);
            if (photoInputRef.current) photoInputRef.current.value = '';
        }
    };

    // Keep the section sensible when one of them empties out.
    useEffect(() => {
        if (section === 'legacy' && counts.legacy === 0 && counts.standard > 0) setSection('standard');
    }, [counts.legacy, counts.standard, section]);

    const cellState = (id: string, field: string) => {
        const key = `${id}:${field}`;
        return { saving: savingCell === key, saved: savedCell === key };
    };

    const inputClass = (id: string, field: string, extra = '') => {
        const { saving, saved } = cellState(id, field);
        return `w-full px-2 py-1.5 rounded-lg bg-transparent text-xs font-bold text-slate-800 border transition-colors
            focus:outline-hidden focus:bg-white focus:border-violet-300
            ${saved ? 'border-emerald-300 bg-emerald-50/50' : saving ? 'border-violet-200' : 'border-transparent hover:border-slate-200'} ${extra}`;
    };

    return (
        <div className="space-y-4">
            {/* ── Sections ─────────────────────────────────────────────────── */}
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-2xl">
                    {([
                        { id: 'standard', label: 'Standard Items', count: counts.standard, hint: 'Offered to every property on the monthly requisition' },
                        { id: 'legacy', label: 'Legacy Items', count: counts.legacy, hint: 'Kept and editable, but not offered on new requisitions' },
                    ] as const).map(tab => (
                        <button
                            key={tab.id}
                            onClick={() => setSection(tab.id)}
                            title={tab.hint}
                            className={`px-4 py-2 rounded-xl text-[11px] font-black uppercase tracking-widest transition-all inline-flex items-center gap-2
                                ${section === tab.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                        >
                            {tab.label}
                            <span className={`px-1.5 py-0.5 rounded-md text-[10px] ${section === tab.id ? 'bg-slate-900 text-white' : 'bg-slate-200 text-slate-500'}`}>
                                {tab.count}
                            </span>
                        </button>
                    ))}
                </div>

                <div className="relative flex-1 min-w-[200px] max-w-sm">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-300" />
                    <input
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        placeholder="Search name, brand, category…"
                        className="w-full pl-9 pr-3 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-xs font-bold text-slate-700 focus:outline-hidden focus:border-violet-300 focus:bg-white transition-colors"
                    />
                </div>
            </div>

            <p className="text-[11px] text-slate-400 font-bold leading-relaxed">
                {section === 'standard'
                    ? 'This is exactly what every property sees on its monthly requisition. Click any cell to edit — changes save on their own.'
                    : 'These predate the standard list or were dropped from a later template. They are not offered on new requisitions; move one back to Standard to bring it back.'}
            </p>

            {error && (
                <div className="rounded-2xl bg-rose-50 border border-rose-100 p-3 flex items-start gap-2.5">
                    <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                    <p className="text-xs text-rose-600 font-bold">{error}</p>
                </div>
            )}

            {/* ── Table ────────────────────────────────────────────────────── */}
            <div className="rounded-2xl border border-slate-200 overflow-hidden bg-white">
                <div className="overflow-x-auto max-h-[62vh]">
                    <table className="w-full text-xs border-collapse">
                        <thead className="sticky top-0 z-10">
                            <tr className="bg-slate-100 text-slate-500 text-[10px] font-black uppercase tracking-widest text-left">
                                <th className="py-2.5 px-3 w-16 border-b border-slate-200">Sr. No.</th>
                                <th className="py-2.5 px-3 w-16 border-b border-slate-200">Image</th>
                                <th className="py-2.5 px-3 min-w-[220px] border-b border-slate-200">Item Description</th>
                                <th className="py-2.5 px-3 w-32 border-b border-slate-200">Category</th>
                                <th className="py-2.5 px-3 w-28 border-b border-slate-200">Unit</th>
                                <th className="py-2.5 px-3 w-32 border-b border-slate-200">Brands</th>
                                <th className="py-2.5 px-3 w-28 border-b border-slate-200">Final Rate</th>
                                {canManage && <th className="py-2.5 px-3 w-24 border-b border-slate-200 text-right">Actions</th>}
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50">
                            {isLoading && (
                                <tr><td colSpan={canManage ? 8 : 7} className="py-16 text-center">
                                    <span className="inline-flex items-center gap-2 text-slate-400 font-bold text-xs">
                                        <Loader2 className="w-4 h-4 animate-spin" /> Loading items…
                                    </span>
                                </td></tr>
                            )}

                            {!isLoading && visible.length === 0 && (
                                <tr><td colSpan={canManage ? 8 : 7} className="py-16 text-center">
                                    <Package className="w-8 h-8 text-slate-200 mx-auto mb-3" />
                                    <p className="font-black text-slate-700 text-sm">
                                        {search ? 'Nothing matches that search'
                                            : section === 'standard' ? 'No standard items yet'
                                                : 'No legacy items'}
                                    </p>
                                    {!search && section === 'standard' && (
                                        <p className="text-xs text-slate-400 font-bold mt-1">
                                            Upload the standard template, or add an item by hand.
                                        </p>
                                    )}
                                </td></tr>
                            )}

                            {!isLoading && visible.map(item => {
                                const busy = rowBusy === item.id;
                                return (
                                    <tr key={item.id} className={`hover:bg-slate-50/60 transition-colors ${busy ? 'opacity-50' : ''}`}>
                                        {/* Sr. No. */}
                                        <td className="px-2 py-1.5">
                                            <input
                                                type="number"
                                                defaultValue={item.sort_order || ''}
                                                disabled={!canManage || busy}
                                                onBlur={e => commitField(item, 'sort_order', e.target.value)}
                                                onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                                                className={inputClass(item.id, 'sort_order', 'text-center')}
                                            />
                                        </td>

                                        {/* Image */}
                                        <td className="px-2 py-1.5">
                                            <button
                                                onClick={() => canManage && pickPhoto(item.id)}
                                                disabled={!canManage || busy}
                                                title={canManage ? 'Click to replace the picture' : undefined}
                                                className="w-11 h-11 rounded-lg border border-slate-200 bg-slate-50 overflow-hidden flex items-center justify-center hover:border-violet-300 transition-colors disabled:cursor-default"
                                            >
                                                {item.photo_url
                                                    /* eslint-disable-next-line @next/next/no-img-element */
                                                    ? <img src={item.photo_url} alt={item.name} className="w-full h-full object-contain" loading="lazy" />
                                                    : <ImageIcon className="w-4 h-4 text-slate-300" />}
                                            </button>
                                        </td>

                                        {/* Item Description */}
                                        <td className="px-2 py-1.5">
                                            <input
                                                defaultValue={item.name}
                                                disabled={!canManage || busy}
                                                onBlur={e => commitField(item, 'name', e.target.value)}
                                                onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                                                className={inputClass(item.id, 'name', 'font-black')}
                                            />
                                        </td>

                                        {/* Category */}
                                        <td className="px-2 py-1.5">
                                            <select
                                                defaultValue={CATEGORIES.includes(item.category || '') ? (item.category as string) : ''}
                                                disabled={!canManage || busy}
                                                onChange={e => commitField(item, 'category', e.target.value)}
                                                className={inputClass(item.id, 'category')}
                                            >
                                                <option value="">{item.category && !CATEGORIES.includes(item.category) ? item.category : '—'}</option>
                                                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                                            </select>
                                        </td>

                                        {/* Unit */}
                                        <td className="px-2 py-1.5">
                                            <input
                                                defaultValue={item.unit || ''}
                                                disabled={!canManage || busy}
                                                placeholder="—"
                                                onBlur={e => commitField(item, 'unit', e.target.value)}
                                                onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                                                className={inputClass(item.id, 'unit')}
                                            />
                                        </td>

                                        {/* Brands */}
                                        <td className="px-2 py-1.5">
                                            <input
                                                defaultValue={item.brand || ''}
                                                disabled={!canManage || busy}
                                                placeholder="—"
                                                onBlur={e => commitField(item, 'brand', e.target.value)}
                                                onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                                                className={inputClass(item.id, 'brand')}
                                            />
                                        </td>

                                        {/* Final Rate */}
                                        <td className="px-2 py-1.5">
                                            <div className="relative">
                                                <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[10px] font-black text-slate-300">₹</span>
                                                <input
                                                    type="number"
                                                    step="0.01"
                                                    defaultValue={priceOf(item) || ''}
                                                    disabled={!canManage || busy}
                                                    placeholder="0"
                                                    onBlur={e => commitField(item, 'unit_price', e.target.value)}
                                                    onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                                                    className={inputClass(item.id, 'unit_price', 'pl-5 text-right')}
                                                />
                                            </div>
                                        </td>

                                        {/* Actions */}
                                        {canManage && (
                                            <td className="px-2 py-1.5">
                                                <div className="flex items-center justify-end gap-1">
                                                    {cellState(item.id, '__row').saving || busy ? (
                                                        <Loader2 className="w-3.5 h-3.5 animate-spin text-violet-400" />
                                                    ) : (
                                                        <>
                                                            <button
                                                                onClick={() => moveTo(item, section === 'standard' ? 'legacy' : 'standard')}
                                                                title={section === 'standard'
                                                                    ? 'Move to Legacy — stops being offered on new requisitions'
                                                                    : 'Move back to Standard — offered to every property again'}
                                                                className="p-1.5 rounded-lg text-slate-300 hover:text-amber-500 hover:bg-amber-50 transition-colors"
                                                            >
                                                                {section === 'standard'
                                                                    ? <Archive className="w-3.5 h-3.5" />
                                                                    : <ArchiveRestore className="w-3.5 h-3.5" />}
                                                            </button>
                                                            <button
                                                                onClick={() => remove(item)}
                                                                title="Remove from the catalog (deactivates, never deletes)"
                                                                className="p-1.5 rounded-lg text-slate-300 hover:text-rose-500 hover:bg-rose-50 transition-colors"
                                                            >
                                                                <Trash2 className="w-3.5 h-3.5" />
                                                            </button>
                                                        </>
                                                    )}
                                                </div>
                                            </td>
                                        )}
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>

            <div className="flex items-center justify-between text-[11px] font-bold text-slate-400">
                <span>{visible.length} of {section === 'standard' ? counts.standard : counts.legacy} shown</span>
                <span className="inline-flex items-center gap-1.5">
                    <Check className="w-3 h-3 text-emerald-500" /> Edits save automatically
                </span>
            </div>

            <input
                ref={photoInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={e => onPhotoChosen(e.target.files?.[0] || null)}
            />
        </div>
    );
}
