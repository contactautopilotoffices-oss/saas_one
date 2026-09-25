'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    Search, Loader2, Trash2, ImageIcon, AlertTriangle, ArchiveRestore,
    Archive, Package, Check, Building2, Globe, SlidersHorizontal, X,
    CheckSquare, Square
} from 'lucide-react';
import { createClient } from '@/frontend/utils/supabase/client';
import { compressImage } from '@/frontend/utils/image-compression';

export type Lifecycle = 'standard' | 'legacy' | 'retired';

export interface PropertyOption {
    id: string;
    name: string;
    location?: string | null;
}

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
    assigned_property_ids?: string[] | null;
}

interface Props {
    organizationId: string;
    items: CatalogManagerItem[];
    isLoading: boolean;
    canManage: boolean;
    onItemUpdated: (item: CatalogManagerItem) => void;
    onItemDeleted: (id: string) => void;
    properties?: PropertyOption[];
}

const CATEGORIES = ['HK', 'Beverages', 'Technical', 'General'];

type EditableField = 'sort_order' | 'name' | 'category' | 'unit' | 'brand' | 'unit_price';

const priceOf = (item: CatalogManagerItem) =>
    item.unit_price ?? item.estimated_price ?? 0;

export default function CatalogManagerTable({
    organizationId, items, isLoading, canManage, onItemUpdated, onItemDeleted, properties: propsProperties,
}: Props) {
    const [section, setSection] = useState<'standard' | 'legacy'>('standard');
    const [search, setSearch] = useState('');
    const [savingCell, setSavingCell] = useState<string | null>(null);
    const [savedCell, setSavedCell] = useState<string | null>(null);
    const [rowBusy, setRowBusy] = useState<string | null>(null);
    const [error, setError] = useState<string>('');

    // Properties state
    const [availableProperties, setAvailableProperties] = useState<PropertyOption[]>(propsProperties || []);
    const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());

    // Property Assignment Modal State
    const [propertyModalState, setPropertyModalState] = useState<{
        isOpen: boolean;
        targetItemIds: string[];
        initialPropIds: string[];
    } | null>(null);
    const [isSavingProp, setIsSavingProp] = useState(false);

    const photoInputRef = useRef<HTMLInputElement>(null);
    const photoTargetId = useRef<string | null>(null);

    // Fetch properties if not passed in props
    useEffect(() => {
        if (propsProperties && propsProperties.length > 0) {
            setAvailableProperties(propsProperties);
            return;
        }
        if (!organizationId) return;

        const fetchProperties = async () => {
            try {
                const res = await fetch(`/api/properties?organizationId=${organizationId}`);
                if (res.ok) {
                    const data = await res.json();
                    if (Array.isArray(data)) {
                        setAvailableProperties(data.map((p: any) => ({
                            id: p.id,
                            name: p.name,
                            location: p.location || p.address || p.city || null
                        })));
                    }
                }
            } catch (err) {
                console.error('Failed to fetch properties for catalog manager:', err);
            }
        };

        fetchProperties();
    }, [organizationId, propsProperties]);

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

    // Selection helpers
    const isAllVisibleSelected = visible.length > 0 && visible.every(i => selectedItemIds.has(i.id));

    const toggleSelectAll = () => {
        if (isAllVisibleSelected) {
            setSelectedItemIds(prev => {
                const next = new Set(prev);
                visible.forEach(i => next.delete(i.id));
                return next;
            });
        } else {
            setSelectedItemIds(prev => {
                const next = new Set(prev);
                visible.forEach(i => next.add(i.id));
                return next;
            });
        }
    };

    const toggleSelectItem = (id: string) => {
        setSelectedItemIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

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
        if (field === 'name' && !raw.trim()) return; // never blank out identity
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

    // ─── Save Property Assignments (Single / Bulk) ───────────────────────────
    const handleSavePropertyAssignments = async (assignedPropertyIds: string[]) => {
        if (!propertyModalState) return;
        const { targetItemIds } = propertyModalState;
        if (targetItemIds.length === 0) return;

        setIsSavingProp(true);
        setError('');
        try {
            const isBulk = targetItemIds.length > 1;
            const payload = isBulk
                ? { item_ids: targetItemIds, organization_id: organizationId, assigned_property_ids: assignedPropertyIds }
                : { id: targetItemIds[0], organization_id: organizationId, assigned_property_ids: assignedPropertyIds };

            const res = await fetch('/api/procurement/catalog', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            const data = await res.json();

            if (!res.ok) {
                setError(data.error || 'Failed to update property assignment');
                return;
            }

            // Update local state for all target items
            items.forEach(i => {
                if (targetItemIds.includes(i.id)) {
                    onItemUpdated({ ...i, assigned_property_ids: assignedPropertyIds });
                }
            });

            setSelectedItemIds(new Set());
            setPropertyModalState(null);
        } catch {
            setError('Network error while saving property assignments');
        } finally {
            setIsSavingProp(false);
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
            focus:outline-hidden focus:bg-white focus:border-slate-400
            ${saved ? 'border-emerald-300 bg-emerald-50/50' : saving ? 'border-slate-300' : 'border-transparent hover:border-slate-200'} ${extra}`;
    };

    // Render property badge for table row
    const renderPropertyBadge = (item: CatalogManagerItem) => {
        const assigned = item.assigned_property_ids || [];
        const isAll = assigned.length === 0 || assigned.includes('ALL');

        if (isAll) {
            return (
                <button
                    onClick={() => canManage && setPropertyModalState({
                        isOpen: true,
                        targetItemIds: [item.id],
                        initialPropIds: assigned
                    })}
                    disabled={!canManage}
                    title={canManage ? 'Click to assign specific properties' : undefined}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-[11px] transition-colors border border-slate-200"
                >
                    <Globe className="w-3 h-3 text-emerald-600" />
                    <span>All Properties</span>
                </button>
            );
        }

        if (assigned.length === 1) {
            const propName = availableProperties.find(p => p.id === assigned[0])?.name || '1 Property';
            return (
                <button
                    onClick={() => canManage && setPropertyModalState({
                        isOpen: true,
                        targetItemIds: [item.id],
                        initialPropIds: assigned
                    })}
                    disabled={!canManage}
                    title={canManage ? 'Click to change property assignment' : undefined}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-900 font-bold text-[11px] transition-colors border border-slate-300 max-w-[150px] truncate"
                >
                    <Building2 className="w-3 h-3 text-slate-700 shrink-0" />
                    <span className="truncate">{propName}</span>
                </button>
            );
        }

        return (
            <button
                onClick={() => canManage && setPropertyModalState({
                    isOpen: true,
                    targetItemIds: [item.id],
                    initialPropIds: assigned
                })}
                disabled={!canManage}
                title={canManage ? `Assigned to ${assigned.length} properties. Click to edit.` : undefined}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-900 font-bold text-[11px] transition-colors border border-slate-300"
            >
                <Building2 className="w-3 h-3 text-slate-700 shrink-0" />
                <span>{assigned.length} Properties</span>
            </button>
        );
    };

    return (
        <div className="space-y-4">
            {/* ── Sections & Search ─────────────────────────────────────────────────── */}
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-2xl">
                    {([
                        { id: 'standard', label: 'Standard Items', count: counts.standard, hint: 'Offered to properties on the monthly requisition' },
                        { id: 'legacy', label: 'Legacy Items', count: counts.legacy, hint: 'Kept and editable, but not offered on new requisitions' },
                    ] as const).map(tab => (
                        <button
                            key={tab.id}
                            onClick={() => {
                                setSection(tab.id);
                                setSelectedItemIds(new Set());
                            }}
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
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        placeholder="Search name, brand, category…"
                        className="w-full pl-9 pr-3 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-xs font-bold text-slate-700 focus:outline-hidden focus:border-slate-400 focus:bg-white transition-colors"
                    />
                </div>
            </div>

            {/* ── Bulk Action Bar ────────────────────────────────────────────── */}
            {canManage && selectedItemIds.size > 0 && (
                <div className="rounded-2xl bg-slate-950 p-3 text-white shadow-xl flex items-center justify-between gap-4 animate-in fade-in slide-in-from-top-2 duration-200">
                    <div className="flex items-center gap-2 pl-2">
                        <CheckSquare className="w-5 h-5 text-white" />
                        <span className="text-xs font-black tracking-wide">
                            {selectedItemIds.size} item{selectedItemIds.size > 1 ? 's' : ''} selected
                        </span>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => {
                                const selectedArr = Array.from(selectedItemIds);
                                const firstItem = items.find(i => i.id === selectedArr[0]);
                                setPropertyModalState({
                                    isOpen: true,
                                    targetItemIds: selectedArr,
                                    initialPropIds: selectedArr.length === 1 ? (firstItem?.assigned_property_ids || []) : []
                                });
                            }}
                            className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-black uppercase tracking-wider transition-all shadow-md flex items-center gap-2 border border-slate-700"
                        >
                            <Building2 className="w-4 h-4 text-emerald-400" />
                            Assign Properties
                        </button>
                        <button
                            onClick={() => setSelectedItemIds(new Set())}
                            className="px-3 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white/80 text-xs font-bold transition-all"
                        >
                            Deselect All
                        </button>
                    </div>
                </div>
            )}

            <p className="text-[11px] text-slate-400 font-bold leading-relaxed">
                {section === 'standard'
                    ? 'Manage standard items for monthly requisitions. Select multiple items to assign properties at once, or edit cell values directly.'
                    : 'These predate the standard list or were dropped from a template. They are not offered on requisitions unless moved back to Standard.'}
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
                                {canManage && (
                                    <th className="py-2.5 px-3 w-10 border-b border-slate-200 text-center">
                                        <button
                                            onClick={toggleSelectAll}
                                            title={isAllVisibleSelected ? 'Deselect all visible' : 'Select all visible'}
                                            className="text-slate-400 hover:text-slate-900 transition-colors inline-flex items-center justify-center"
                                        >
                                            {isAllVisibleSelected ? <CheckSquare className="w-4 h-4 text-slate-900" /> : <Square className="w-4 h-4" />}
                                        </button>
                                    </th>
                                )}
                                <th className="py-2.5 px-3 w-16 border-b border-slate-200">Sr. No.</th>
                                <th className="py-2.5 px-3 w-16 border-b border-slate-200">Image</th>
                                <th className="py-2.5 px-3 min-w-[200px] border-b border-slate-200">Item Description</th>
                                <th className="py-2.5 px-3 w-32 border-b border-slate-200">Category</th>
                                <th className="py-2.5 px-3 w-28 border-b border-slate-200">Unit</th>
                                <th className="py-2.5 px-3 w-32 border-b border-slate-200">Brands</th>
                                <th className="py-2.5 px-3 w-28 border-b border-slate-200">Final Rate</th>
                                <th className="py-2.5 px-3 min-w-[140px] border-b border-slate-200">Assigned Properties</th>
                                {canManage && <th className="py-2.5 px-3 w-24 border-b border-slate-200 text-right">Actions</th>}
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50">
                            {isLoading && (
                                <tr><td colSpan={canManage ? 10 : 8} className="py-16 text-center">
                                    <span className="inline-flex items-center gap-2 text-slate-400 font-bold text-xs">
                                        <Loader2 className="w-4 h-4 animate-spin text-slate-500" /> Loading items…
                                    </span>
                                </td></tr>
                            )}

                            {!isLoading && visible.length === 0 && (
                                <tr><td colSpan={canManage ? 10 : 8} className="py-16 text-center">
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
                                const isSelected = selectedItemIds.has(item.id);
                                return (
                                    <tr key={item.id} className={`hover:bg-slate-50 transition-colors ${isSelected ? 'bg-slate-100/60' : ''} ${busy ? 'opacity-50' : ''}`}>
                                        {/* Selection Checkbox */}
                                        {canManage && (
                                            <td className="px-3 py-1.5 text-center">
                                                <button
                                                    onClick={() => toggleSelectItem(item.id)}
                                                    className="text-slate-400 hover:text-slate-900 transition-colors inline-flex items-center justify-center"
                                                >
                                                    {isSelected ? <CheckSquare className="w-4 h-4 text-slate-900" /> : <Square className="w-4 h-4" />}
                                                </button>
                                            </td>
                                        )}

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
                                                className="w-11 h-11 rounded-lg border border-slate-200 bg-slate-50 overflow-hidden flex items-center justify-center hover:border-slate-400 transition-colors disabled:cursor-default"
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

                                        {/* Assigned Properties */}
                                        <td className="px-3 py-1.5">
                                            {renderPropertyBadge(item)}
                                        </td>

                                        {/* Actions */}
                                        {canManage && (
                                            <td className="px-2 py-1.5">
                                                <div className="flex items-center justify-end gap-1">
                                                    {cellState(item.id, '__row').saving || busy ? (
                                                        <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-400" />
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

            {/* ── Property Assignment Modal ────────────────────────────────────── */}
            {propertyModalState?.isOpen && (
                <PropertyAssignmentModal
                    isOpen={propertyModalState.isOpen}
                    targetItemCount={propertyModalState.targetItemIds.length}
                    sampleItemName={
                        propertyModalState.targetItemIds.length === 1
                            ? items.find(i => i.id === propertyModalState.targetItemIds[0])?.name
                            : undefined
                    }
                    initialAssignedIds={propertyModalState.initialPropIds}
                    availableProperties={availableProperties}
                    isSaving={isSavingProp}
                    onClose={() => setPropertyModalState(null)}
                    onSave={handleSavePropertyAssignments}
                />
            )}
        </div>
    );
}

// ─── Property Assignment Modal Component ─────────────────────────────────────
interface PropertyAssignmentModalProps {
    isOpen: boolean;
    targetItemCount: number;
    sampleItemName?: string;
    initialAssignedIds: string[];
    availableProperties: PropertyOption[];
    isSaving: boolean;
    onClose: () => void;
    onSave: (assignedPropertyIds: string[]) => void;
}

function PropertyAssignmentModal({
    isOpen,
    targetItemCount,
    sampleItemName,
    initialAssignedIds,
    availableProperties,
    isSaving,
    onClose,
    onSave,
}: PropertyAssignmentModalProps) {
    const isInitialAll = initialAssignedIds.length === 0 || initialAssignedIds.includes('ALL');
    const [mode, setMode] = useState<'all' | 'specific'>(isInitialAll ? 'all' : 'specific');
    const [selectedPropIds, setSelectedPropIds] = useState<Set<string>>(
        new Set(isInitialAll ? [] : initialAssignedIds)
    );
    const [propSearch, setPropSearch] = useState('');

    if (!isOpen) return null;

    const filteredProps = availableProperties.filter(p =>
        p.name.toLowerCase().includes(propSearch.toLowerCase()) ||
        (p.location || '').toLowerCase().includes(propSearch.toLowerCase())
    );

    const toggleProp = (id: string) => {
        setSelectedPropIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const handleSelectAllProps = () => {
        setSelectedPropIds(new Set(availableProperties.map(p => p.id)));
    };

    const handleClearProps = () => {
        setSelectedPropIds(new Set());
    };

    const handleSave = () => {
        if (mode === 'all') {
            onSave([]);
        } else {
            onSave(Array.from(selectedPropIds));
        }
    };

    return (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs animate-in fade-in duration-200">
            <div className="bg-white rounded-3xl max-w-xl w-full overflow-hidden shadow-2xl border border-slate-200 flex flex-col max-h-[85vh]">
                {/* Header: Dark sleek Slate-950 */}
                <div className="p-6 bg-slate-950 text-white flex items-start justify-between relative overflow-hidden">
                    <div className="relative z-10 space-y-1.5">
                        <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-lg bg-white/10 text-white text-[11px] font-extrabold uppercase tracking-wider">
                            <Building2 className="w-3.5 h-3.5 text-emerald-400" />
                            <span>Property Visibility</span>
                        </div>
                        <h3 className="text-lg font-black text-white tracking-tight leading-snug">
                            {targetItemCount === 1
                                ? `Assign Properties for "${sampleItemName || 'Item'}"`
                                : `Assign Properties for ${targetItemCount} Selected Items`}
                        </h3>
                        <p className="text-xs text-slate-300 font-medium">
                            Select which properties will see this item on their monthly requisition sheet.
                        </p>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-white/10 transition-all relative z-10"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Body */}
                <div className="p-6 space-y-5 overflow-y-auto flex-1 custom-scrollbar">
                    {/* Mode Selector */}
                    <div className="grid grid-cols-2 gap-2 p-1.5 bg-slate-100 rounded-2xl border border-slate-200/60">
                        <button
                            type="button"
                            onClick={() => setMode('all')}
                            className={`py-2.5 px-4 rounded-xl text-xs transition-all flex items-center justify-center gap-2 ${
                                mode === 'all'
                                    ? 'bg-slate-900 text-white shadow-sm font-black'
                                    : 'text-slate-500 hover:text-slate-800 font-bold'
                            }`}
                        >
                            <Globe className={`w-4 h-4 ${mode === 'all' ? 'text-emerald-400' : 'text-slate-400'}`} />
                            All Properties
                        </button>
                        <button
                            type="button"
                            onClick={() => setMode('specific')}
                            className={`py-2.5 px-4 rounded-xl text-xs transition-all flex items-center justify-center gap-2 ${
                                mode === 'specific'
                                    ? 'bg-slate-900 text-white shadow-sm font-black'
                                    : 'text-slate-500 hover:text-slate-800 font-bold'
                            }`}
                        >
                            <Building2 className={`w-4 h-4 ${mode === 'specific' ? 'text-emerald-400' : 'text-slate-400'}`} />
                            Selected Properties
                        </button>
                    </div>

                    {mode === 'all' ? (
                        <div className="p-5 rounded-2xl bg-slate-50 border border-slate-200 text-slate-900 space-y-1.5">
                            <p className="text-xs font-black flex items-center gap-2 text-slate-900">
                                <Globe className="w-4 h-4 text-emerald-600" />
                                Visible across all organization properties
                            </p>
                            <p className="text-xs text-slate-600 font-medium leading-relaxed pl-6">
                                This item will be automatically offered on monthly requisitions for all existing and future properties in your organization.
                            </p>
                        </div>
                    ) : (
                        <div className="space-y-3.5">
                            {/* Search & Bulk Select */}
                            <div className="flex items-center justify-between gap-3">
                                <div className="relative flex-1">
                                    <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                                    <input
                                        type="text"
                                        placeholder="Search properties by name..."
                                        value={propSearch}
                                        onChange={e => setPropSearch(e.target.value)}
                                        className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-xs font-semibold text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-slate-400 focus:bg-white transition-colors"
                                    />
                                </div>
                                <div className="flex items-center gap-1.5 shrink-0">
                                    <button
                                        type="button"
                                        onClick={handleSelectAllProps}
                                        className="px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold transition-colors"
                                    >
                                        Select All
                                    </button>
                                    <button
                                        type="button"
                                        onClick={handleClearProps}
                                        className="px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs font-bold transition-colors"
                                    >
                                        Clear
                                    </button>
                                </div>
                            </div>

                            {/* Property List with Clickable Checkbox Row */}
                            <div className="border border-slate-200 rounded-2xl max-h-64 overflow-y-auto divide-y divide-slate-100 bg-white custom-scrollbar">
                                {availableProperties.length === 0 ? (
                                    <div className="p-8 text-center space-y-2">
                                        <Building2 className="w-8 h-8 text-slate-300 mx-auto" />
                                        <p className="text-xs text-slate-500 font-bold">No properties found in organization.</p>
                                    </div>
                                ) : filteredProps.length === 0 ? (
                                    <p className="p-6 text-center text-xs text-slate-400 font-bold">No properties match "{propSearch}".</p>
                                ) : (
                                    filteredProps.map(prop => {
                                        const isChecked = selectedPropIds.has(prop.id);
                                        return (
                                            <div
                                                key={prop.id}
                                                onClick={() => toggleProp(prop.id)}
                                                className={`flex items-center justify-between p-3.5 cursor-pointer hover:bg-slate-50 transition-colors select-none ${
                                                    isChecked ? 'bg-slate-50' : ''
                                                }`}
                                            >
                                                <div className="flex items-center gap-3">
                                                    <input
                                                        type="checkbox"
                                                        checked={isChecked}
                                                        onChange={() => toggleProp(prop.id)}
                                                        onClick={e => e.stopPropagation()}
                                                        className="w-4 h-4 rounded border-slate-300 text-slate-900 focus:ring-slate-900 cursor-pointer"
                                                    />
                                                    <div className="flex flex-col">
                                                        <span className="text-xs font-bold text-slate-900">{prop.name}</span>
                                                        {prop.location && (
                                                            <span className="text-[10px] text-slate-400 font-medium">{prop.location}</span>
                                                        )}
                                                    </div>
                                                </div>
                                                {isChecked && (
                                                    <span className="px-2.5 py-0.5 rounded-md bg-slate-900 text-white font-black text-[10px] uppercase tracking-wider">
                                                        Selected
                                                    </span>
                                                )}
                                            </div>
                                        );
                                    })
                                )}
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between">
                    <span className="text-xs text-slate-500 font-semibold pl-1">
                        {mode === 'all'
                            ? 'Visible for all properties'
                            : `${selectedPropIds.size} of ${availableProperties.length} properties selected`}
                    </span>
                    <div className="flex items-center gap-2.5">
                        <button
                            type="button"
                            onClick={onClose}
                            disabled={isSaving}
                            className="px-4 py-2.5 rounded-xl border border-slate-300 text-slate-700 font-bold text-xs hover:bg-slate-100 transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            type="button"
                            onClick={handleSave}
                            disabled={isSaving || (mode === 'specific' && selectedPropIds.size === 0)}
                            className="px-6 py-2.5 rounded-xl bg-slate-900 hover:bg-black text-white font-black text-xs uppercase tracking-wider transition-all shadow-md disabled:opacity-50 inline-flex items-center gap-2"
                        >
                            {isSaving ? (
                                <>
                                    <Loader2 className="w-4 h-4 animate-spin text-white" />
                                    Saving…
                                </>
                            ) : (
                                'Save Assignments'
                            )}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
