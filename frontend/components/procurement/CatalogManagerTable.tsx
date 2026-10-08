'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    Search, Loader2, Trash2, ImageIcon, AlertTriangle, ArchiveRestore,
    Archive, Package, Check, Building2, Globe, SlidersHorizontal, X,
    CheckSquare, Square, RotateCcw, Filter, CheckCheck
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

export interface ColumnFilters {
    srNo: string;
    photo: 'all' | 'with_photo' | 'no_photo';
    name: string;
    category: string;
    unit: string;
    brand: string;
    priceRange: 'all' | 'free' | 'under_100' | '100_500' | '500_2000' | 'over_2000' | 'custom';
    minPrice: string;
    maxPrice: string;
    property: string; // 'all' | 'universal' | 'specific_only' | propertyId
    propertyCountOp: 'any' | 'exact' | 'gte' | 'lte';
    propertyCountValue: string;
}

export const DEFAULT_COLUMN_FILTERS: ColumnFilters = {
    srNo: '',
    photo: 'all',
    name: '',
    category: 'all',
    unit: 'all',
    brand: 'all',
    priceRange: 'all',
    minPrice: '',
    maxPrice: '',
    property: 'all',
    propertyCountOp: 'any',
    propertyCountValue: '',
};

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
    const [filters, setFilters] = useState<ColumnFilters>(DEFAULT_COLUMN_FILTERS);
    const [showFilterRow, setShowFilterRow] = useState(true);
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

    // Derived category options with item counts
    const categoryOptions = useMemo(() => {
        const countsMap: Record<string, number> = {};
        let uncategorized = 0;
        items.forEach(i => {
            const cat = (i.category || '').trim();
            if (cat) countsMap[cat] = (countsMap[cat] || 0) + 1;
            else uncategorized++;
        });
        CATEGORIES.forEach(c => {
            if (!(c in countsMap)) countsMap[c] = 0;
        });
        const list = Object.entries(countsMap)
            .sort((a, b) => a[0].localeCompare(b[0]))
            .map(([name, count]) => ({ name, count }));
        return { list, uncategorized };
    }, [items]);

    // Derived unit options with item counts
    const unitOptions = useMemo(() => {
        const countsMap: Record<string, number> = {};
        items.forEach(i => {
            const u = (i.unit || '').trim();
            if (u) countsMap[u] = (countsMap[u] || 0) + 1;
        });
        return Object.entries(countsMap)
            .sort((a, b) => b[1] - a[1])
            .map(([name, count]) => ({ name, count }));
    }, [items]);

    // Derived brand options with item counts
    const brandOptions = useMemo(() => {
        const countsMap: Record<string, number> = {};
        let noBrand = 0;
        items.forEach(i => {
            const b = (i.brand || '').trim();
            if (b) countsMap[b] = (countsMap[b] || 0) + 1;
            else noBrand++;
        });
        const list = Object.entries(countsMap)
            .sort((a, b) => a[0].localeCompare(b[0]))
            .map(([name, count]) => ({ name, count }));
        return { list, noBrand };
    }, [items]);

    // Derived property count options (e.g. 22 properties assigned, 1 property assigned, etc.)
    const propertyCountOptions = useMemo(() => {
        const countsMap: Record<number, number> = {};
        items.filter(i => (i.lifecycle || 'standard') === section).forEach(i => {
            const count = (i.assigned_property_ids || []).filter(p => p !== 'ALL').length;
            countsMap[count] = (countsMap[count] || 0) + 1;
        });
        return Object.entries(countsMap)
            .map(([cnt, numItems]) => ({ count: Number(cnt), numItems }))
            .filter(pc => pc.count > 0)
            .sort((a, b) => b.count - a.count);
    }, [items, section]);

    // Active column filter count
    const activeFilterCount = useMemo(() => {
        let count = 0;
        if (filters.srNo.trim()) count++;
        if (filters.photo !== 'all') count++;
        if (filters.name.trim()) count++;
        if (filters.category !== 'all') count++;
        if (filters.unit !== 'all') count++;
        if (filters.brand !== 'all') count++;
        if (filters.priceRange !== 'all') count++;
        if (filters.property !== 'all') count++;
        if (filters.propertyCountOp !== 'any' && filters.propertyCountValue.trim()) count++;
        return count;
    }, [filters]);

    const resetFilters = useCallback(() => {
        setFilters(DEFAULT_COLUMN_FILTERS);
    }, []);

    // Property names lookup map
    const propertyNameMap = useMemo(() => {
        const map: Record<string, string> = {};
        availableProperties.forEach(p => { map[p.id] = p.name; });
        return map;
    }, [availableProperties]);

    // Filtered property helper
    const filteredPropertyObj = useMemo(() => {
        if (!filters.property || ['all', 'universal', 'specific_only'].includes(filters.property) || filters.property.startsWith('count_')) return null;
        return availableProperties.find(p => p.id === filters.property) || null;
    }, [filters.property, availableProperties]);

    const visible = useMemo(() => {
        const q = search.trim().toLowerCase();
        const fSr = filters.srNo.trim();
        const fName = filters.name.trim().toLowerCase();

        return items
            .filter(i => (i.lifecycle || 'standard') === section)
            // Global search (matches name, brand, category, item code, description, and assigned property name)
            .filter(i => !q
                || i.name?.toLowerCase().includes(q)
                || (i.brand || '').toLowerCase().includes(q)
                || (i.category || '').toLowerCase().includes(q)
                || (i.item_code || '').toLowerCase().includes(q)
                || (i.description || '').toLowerCase().includes(q)
                || (i.assigned_property_ids || []).some(pid => (propertyNameMap[pid] || '').toLowerCase().includes(q)))
            // Column: Sr. No.
            .filter(i => {
                if (!fSr) return true;
                const order = i.sort_order ?? 0;
                if (fSr.includes('-')) {
                    const [minStr, maxStr] = fSr.split('-');
                    const min = parseInt(minStr, 10);
                    const max = parseInt(maxStr, 10);
                    if (!isNaN(min) && !isNaN(max)) return order >= min && order <= max;
                    if (!isNaN(min)) return order >= min;
                    if (!isNaN(max)) return order <= max;
                }
                const num = parseInt(fSr, 10);
                if (!isNaN(num) && order === num) return true;
                return String(order).includes(fSr);
            })
            // Column: Photo
            .filter(i => {
                if (filters.photo === 'with_photo') return Boolean(i.photo_url);
                if (filters.photo === 'no_photo') return !i.photo_url;
                return true;
            })
            // Column: Name / Description / Item code
            .filter(i => {
                if (!fName) return true;
                return (
                    i.name?.toLowerCase().includes(fName) ||
                    (i.description || '').toLowerCase().includes(fName) ||
                    (i.item_code || '').toLowerCase().includes(fName)
                );
            })
            // Column: Category
            .filter(i => {
                if (filters.category === 'all') return true;
                if (filters.category === '__uncategorized__') return !i.category || !i.category.trim();
                return (i.category || '').trim().toLowerCase() === filters.category.toLowerCase();
            })
            // Column: Unit
            .filter(i => {
                if (filters.unit === 'all') return true;
                return (i.unit || '').trim().toLowerCase() === filters.unit.toLowerCase();
            })
            // Column: Brand
            .filter(i => {
                if (filters.brand === 'all') return true;
                if (filters.brand === '__no_brand__') return !i.brand || !i.brand.trim();
                return (i.brand || '').trim().toLowerCase() === filters.brand.toLowerCase();
            })
            // Column: Rate
            .filter(i => {
                const p = priceOf(i);
                if (filters.priceRange === 'free') return p === 0;
                if (filters.priceRange === 'under_100') return p > 0 && p <= 100;
                if (filters.priceRange === '100_500') return p > 100 && p <= 500;
                if (filters.priceRange === '500_2000') return p > 500 && p <= 2000;
                if (filters.priceRange === 'over_2000') return p > 2000;
                if (filters.priceRange === 'custom') {
                    const min = parseFloat(filters.minPrice);
                    const max = parseFloat(filters.maxPrice);
                    if (!isNaN(min) && p < min) return false;
                    if (!isNaN(max) && p > max) return false;
                }
                return true;
            })
            // Column: Property & Count
            .filter(i => {
                const assigned = i.assigned_property_ids || [];
                const actualCount = assigned.filter(p => p !== 'ALL').length;
                const isUniversal = assigned.length === 0 || assigned.includes('ALL');

                // Property count operator filter (=, >=, <=)
                if (filters.propertyCountOp !== 'any' && filters.propertyCountValue.trim() !== '') {
                    const target = parseInt(filters.propertyCountValue, 10);
                    if (!isNaN(target)) {
                        if (filters.propertyCountOp === 'exact' && actualCount !== target) return false;
                        if (filters.propertyCountOp === 'gte' && actualCount < target) return false;
                        if (filters.propertyCountOp === 'lte' && actualCount > target) return false;
                    }
                }

                if (filters.property === 'all') return true;
                if (filters.property === 'universal') return isUniversal;
                if (filters.property === 'specific_only') return !isUniversal;

                // Filter by exact property count: e.g. "count_22"
                if (filters.property.startsWith('count_')) {
                    const targetCount = parseInt(filters.property.replace('count_', ''), 10);
                    return actualCount === targetCount;
                }

                // Property selected: show items available to this property (Universal items + items specifically assigned to it)
                return isUniversal || assigned.includes(filters.property);
            });
    }, [items, section, search, filters]);

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

    // ─── Save Property Assignments (Single / Bulk / Instant) ───────────────────────────
    const handleSavePropertyAssignments = async (
        assignedPropertyIds: string[],
        strategy: 'replace' | 'append' = 'replace'
    ) => {
        if (!propertyModalState) return;
        const { targetItemIds } = propertyModalState;
        if (targetItemIds.length === 0) return;

        setIsSavingProp(true);
        setError('');
        try {
            const isBulk = targetItemIds.length > 1;

            if (isBulk && strategy === 'append' && assignedPropertyIds.length > 0) {
                // Append mode: merge assigned IDs for each item
                const updates = targetItemIds.map(id => {
                    const current = items.find(i => i.id === id)?.assigned_property_ids || [];
                    const merged = Array.from(new Set([...current.filter(p => p !== 'ALL'), ...assignedPropertyIds]));
                    return { id, assigned_property_ids: merged };
                });

                await Promise.all(updates.map(u =>
                    fetch('/api/procurement/catalog', {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            id: u.id,
                            organization_id: organizationId,
                            assigned_property_ids: u.assigned_property_ids
                        }),
                    })
                ));

                updates.forEach(u => {
                    const current = items.find(i => i.id === u.id);
                    if (current) onItemUpdated({ ...current, assigned_property_ids: u.assigned_property_ids });
                });
            } else {
                // Replace mode: single bulk or single item call
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
            }

            setSelectedItemIds(new Set());
            setPropertyModalState(null);
        } catch {
            setError('Network error while saving property assignments');
        } finally {
            setIsSavingProp(false);
        }
    };

    // ─── Instant 1-Click Assign to Filtered Property ────────────────────────
    const handleInstantAssignFilteredProperty = async () => {
        if (!filteredPropertyObj) return;
        const targetItemIds = Array.from(selectedItemIds);
        if (targetItemIds.length === 0) return;

        setIsSavingProp(true);
        setError('');
        try {
            const updates = targetItemIds.map(id => {
                const current = items.find(i => i.id === id)?.assigned_property_ids || [];
                const merged = Array.from(new Set([...current.filter(p => p !== 'ALL'), filteredPropertyObj.id]));
                return { id, assigned_property_ids: merged };
            });

            const firstArrStr = JSON.stringify(updates[0].assigned_property_ids.slice().sort());
            const allSame = updates.every(u => JSON.stringify(u.assigned_property_ids.slice().sort()) === firstArrStr);

            if (allSame) {
                const res = await fetch('/api/procurement/catalog', {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        item_ids: targetItemIds,
                        organization_id: organizationId,
                        assigned_property_ids: updates[0].assigned_property_ids
                    }),
                });
                if (!res.ok) {
                    const data = await res.json();
                    setError(data.error || `Failed to assign to ${filteredPropertyObj.name}`);
                    return;
                }
            } else {
                await Promise.all(updates.map(u =>
                    fetch('/api/procurement/catalog', {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            id: u.id,
                            organization_id: organizationId,
                            assigned_property_ids: u.assigned_property_ids
                        }),
                    })
                ));
            }

            updates.forEach(u => {
                const current = items.find(i => i.id === u.id);
                if (current) onItemUpdated({ ...current, assigned_property_ids: u.assigned_property_ids });
            });

            setSelectedItemIds(new Set());
        } catch {
            setError(`Network error while assigning to ${filteredPropertyObj.name}`);
        } finally {
            setIsSavingProp(false);
        }
    };

    // ─── Instant 1-Click Make Universal (All Properties) ────────────────────
    const handleInstantMakeUniversal = async () => {
        const targetItemIds = Array.from(selectedItemIds);
        if (targetItemIds.length === 0) return;

        setIsSavingProp(true);
        setError('');
        try {
            const res = await fetch('/api/procurement/catalog', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    item_ids: targetItemIds,
                    organization_id: organizationId,
                    assigned_property_ids: []
                }),
            });
            if (!res.ok) {
                const data = await res.json();
                setError(data.error || 'Failed to make items universal');
                return;
            }

            targetItemIds.forEach(id => {
                const current = items.find(i => i.id === id);
                if (current) onItemUpdated({ ...current, assigned_property_ids: [] });
            });

            setSelectedItemIds(new Set());
        } catch {
            setError('Network error while updating items');
        } finally {
            setIsSavingProp(false);
        }
    };

    // ─── Instant 1-Click Add Property to Selected (Append) ─────────────────
    const handleAddSinglePropertyToSelected = async (propertyIdToAdd: string) => {
        const targetItemIds = Array.from(selectedItemIds);
        if (targetItemIds.length === 0 || !propertyIdToAdd) return;

        setIsSavingProp(true);
        setError('');
        try {
            const updates = targetItemIds.map(id => {
                const current = items.find(i => i.id === id)?.assigned_property_ids || [];
                const merged = Array.from(new Set([...current.filter(p => p !== 'ALL'), propertyIdToAdd]));
                return { id, assigned_property_ids: merged };
            });

            await Promise.all(updates.map(u =>
                fetch('/api/procurement/catalog', {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        id: u.id,
                        organization_id: organizationId,
                        assigned_property_ids: u.assigned_property_ids
                    }),
                })
            ));

            updates.forEach(u => {
                const current = items.find(i => i.id === u.id);
                if (current) onItemUpdated({ ...current, assigned_property_ids: u.assigned_property_ids });
            });

            setSelectedItemIds(new Set());
        } catch {
            setError('Network error while adding property to selected items');
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

                <div className="flex items-center gap-2 flex-1 min-w-[240px] max-w-md">
                    <div className="relative flex-1">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                        <input
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                            placeholder="Search name, brand, category…"
                            className="w-full pl-9 pr-3 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-xs font-bold text-slate-700 focus:outline-hidden focus:border-slate-400 focus:bg-white transition-colors"
                        />
                    </div>
                    {/* Toggle Column Filters Row */}
                    <button
                        type="button"
                        onClick={() => setShowFilterRow(prev => !prev)}
                        className={`px-3 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center gap-2 border shrink-0 ${
                            showFilterRow || activeFilterCount > 0
                                ? 'bg-slate-900 text-white border-slate-900 shadow-sm'
                                : 'bg-slate-50 hover:bg-slate-100 text-slate-700 border-slate-200'
                        }`}
                        title="Toggle column filters row"
                    >
                        <SlidersHorizontal className="w-3.5 h-3.5" />
                        <span className="hidden sm:inline">Filters</span>
                        {activeFilterCount > 0 && (
                            <span className="px-1.5 py-0.5 rounded-md text-[10px] font-black bg-emerald-400 text-slate-950">
                                {activeFilterCount}
                            </span>
                        )}
                    </button>
                </div>
            </div>

            {/* ── Active Filter Badges ───────────────────────────────────────── */}
            {activeFilterCount > 0 && (
                <div className="flex flex-wrap items-center gap-2 p-2 bg-slate-50 border border-slate-200/80 rounded-2xl animate-in fade-in duration-200">
                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 pl-1 mr-1">
                        Active Filters:
                    </span>

                    {filters.srNo && (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white text-slate-800 text-[11px] font-bold border border-slate-200 shadow-2xs">
                            <span>Sr. No: {filters.srNo}</span>
                            <button type="button" onClick={() => setFilters(f => ({ ...f, srNo: '' }))} className="hover:text-rose-500">
                                <X className="w-3 h-3" />
                            </button>
                        </span>
                    )}

                    {filters.photo !== 'all' && (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white text-slate-800 text-[11px] font-bold border border-slate-200 shadow-2xs">
                            <span>Photo: {filters.photo === 'with_photo' ? 'With Photo' : 'No Photo'}</span>
                            <button type="button" onClick={() => setFilters(f => ({ ...f, photo: 'all' }))} className="hover:text-rose-500">
                                <X className="w-3 h-3" />
                            </button>
                        </span>
                    )}

                    {filters.name && (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white text-slate-800 text-[11px] font-bold border border-slate-200 shadow-2xs">
                            <span>Name: "{filters.name}"</span>
                            <button type="button" onClick={() => setFilters(f => ({ ...f, name: '' }))} className="hover:text-rose-500">
                                <X className="w-3 h-3" />
                            </button>
                        </span>
                    )}

                    {filters.category !== 'all' && (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white text-slate-800 text-[11px] font-bold border border-slate-200 shadow-2xs">
                            <span>Category: {filters.category === '__uncategorized__' ? 'Uncategorized' : filters.category}</span>
                            <button type="button" onClick={() => setFilters(f => ({ ...f, category: 'all' }))} className="hover:text-rose-500">
                                <X className="w-3 h-3" />
                            </button>
                        </span>
                    )}

                    {filters.unit !== 'all' && (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white text-slate-800 text-[11px] font-bold border border-slate-200 shadow-2xs">
                            <span>Unit: {filters.unit}</span>
                            <button type="button" onClick={() => setFilters(f => ({ ...f, unit: 'all' }))} className="hover:text-rose-500">
                                <X className="w-3 h-3" />
                            </button>
                        </span>
                    )}

                    {filters.brand !== 'all' && (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white text-slate-800 text-[11px] font-bold border border-slate-200 shadow-2xs">
                            <span>Brand: {filters.brand === '__no_brand__' ? 'No Brand' : filters.brand}</span>
                            <button type="button" onClick={() => setFilters(f => ({ ...f, brand: 'all' }))} className="hover:text-rose-500">
                                <X className="w-3 h-3" />
                            </button>
                        </span>
                    )}

                    {filters.priceRange !== 'all' && (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white text-slate-800 text-[11px] font-bold border border-slate-200 shadow-2xs">
                            <span>
                                Rate: {
                                    filters.priceRange === 'free' ? 'Free (₹0)' :
                                    filters.priceRange === 'under_100' ? '≤ ₹100' :
                                    filters.priceRange === '100_500' ? '₹100–₹500' :
                                    filters.priceRange === '500_2000' ? '₹500–₹2k' :
                                    filters.priceRange === 'over_2000' ? '> ₹2k' :
                                    `₹${filters.minPrice || 0}–₹${filters.maxPrice || '∞'}`
                                }
                            </span>
                            <button type="button" onClick={() => setFilters(f => ({ ...f, priceRange: 'all', minPrice: '', maxPrice: '' }))} className="hover:text-rose-500">
                                <X className="w-3 h-3" />
                            </button>
                        </span>
                    )}

                    {filters.property !== 'all' && (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-900 text-[11px] font-black border border-emerald-200 shadow-2xs">
                            <Building2 className="w-3 h-3 text-emerald-600" />
                            <span>
                                Property: {
                                    filters.property === 'universal' ? 'Universal (All)' :
                                    filters.property === 'specific_only' ? 'Specific Properties' :
                                    filters.property.startsWith('count_') ? `Assigned to ${filters.property.replace('count_', '')} Properties` :
                                    (filteredPropertyObj?.name || 'Selected Property')
                                }
                            </span>
                            <button type="button" onClick={() => setFilters(f => ({ ...f, property: 'all' }))} className="hover:text-rose-500">
                                <X className="w-3 h-3" />
                            </button>
                        </span>
                    )}

                    {filters.propertyCountOp !== 'any' && filters.propertyCountValue.trim() && (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-900 text-[11px] font-black border border-emerald-200 shadow-2xs">
                            <Building2 className="w-3 h-3 text-emerald-600" />
                            <span>
                                Property Count: {
                                    filters.propertyCountOp === 'exact' ? `= ${filters.propertyCountValue}` :
                                    filters.propertyCountOp === 'gte' ? `≥ ${filters.propertyCountValue}` :
                                    `≤ ${filters.propertyCountValue}`
                                }
                            </span>
                            <button type="button" onClick={() => setFilters(f => ({ ...f, propertyCountOp: 'any', propertyCountValue: '' }))} className="hover:text-rose-500">
                                <X className="w-3 h-3" />
                            </button>
                        </span>
                    )}

                    <button
                        type="button"
                        onClick={resetFilters}
                        className="text-[11px] font-black text-rose-500 hover:text-rose-700 underline underline-offset-2 ml-auto pr-2"
                    >
                        Clear all
                    </button>
                </div>
            )}

            {/* ── Bulk Action Bar ────────────────────────────────────────────── */}
            {canManage && selectedItemIds.size > 0 && (
                <div className="rounded-2xl bg-slate-950 p-3 text-white shadow-xl flex flex-wrap items-center justify-between gap-3 animate-in fade-in slide-in-from-top-2 duration-200">
                    <div className="flex items-center gap-2 pl-2">
                        <CheckSquare className="w-5 h-5 text-emerald-400" />
                        <span className="text-xs font-black tracking-wide">
                            {selectedItemIds.size} item{selectedItemIds.size > 1 ? 's' : ''} selected
                        </span>
                        {visible.length !== items.length && (
                            <span className="text-[11px] text-slate-400 font-medium">
                                (of {visible.length} filtered)
                            </span>
                        )}
                        {selectedItemIds.size < visible.length && (
                            <button
                                type="button"
                                onClick={() => setSelectedItemIds(new Set(visible.map(i => i.id)))}
                                className="text-[11px] text-emerald-400 hover:underline font-bold ml-1"
                            >
                                Select all {visible.length} filtered
                            </button>
                        )}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        {/* 1-Click Instant Assign to the filtered property! */}
                        {filteredPropertyObj && (
                            <button
                                type="button"
                                onClick={handleInstantAssignFilteredProperty}
                                disabled={isSavingProp}
                                className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-black uppercase tracking-wider transition-all shadow-md flex items-center gap-1.5 border border-emerald-500 active:scale-95 disabled:opacity-50"
                                title={`Instantly assign all ${selectedItemIds.size} selected items to ${filteredPropertyObj.name}`}
                            >
                                {isSavingProp ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Building2 className="w-3.5 h-3.5" />}
                                <span>Assign to {filteredPropertyObj.name}</span>
                            </button>
                        )}

                        {/* 1-Click Make Universal */}
                        <button
                            type="button"
                            onClick={handleInstantMakeUniversal}
                            disabled={isSavingProp}
                            className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold transition-all border border-slate-700 flex items-center gap-1.5"
                            title="Make selected items available to ALL properties"
                        >
                            <Globe className="w-3.5 h-3.5 text-emerald-400" />
                            <span>Make Universal</span>
                        </button>

                        {/* Instant Quick Add Property Dropdown */}
                        {availableProperties.length > 0 && (
                            <select
                                defaultValue=""
                                disabled={isSavingProp}
                                onChange={async (e) => {
                                    const propId = e.target.value;
                                    if (!propId) return;
                                    const targetProp = availableProperties.find(p => p.id === propId);
                                    if (!targetProp) return;
                                    if (!confirm(`Add "${targetProp.name}" to all ${selectedItemIds.size} selected items? (Existing properties will be kept)`)) {
                                        e.target.value = '';
                                        return;
                                    }
                                    await handleAddSinglePropertyToSelected(propId);
                                    e.target.value = '';
                                }}
                                className="h-8 px-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-emerald-400 text-xs font-bold border border-slate-700 focus:outline-none cursor-pointer"
                                title="Add a property to all selected items while keeping their existing assignments"
                            >
                                <option value="" disabled>+ Add Property to Selected…</option>
                                {availableProperties.map(p => (
                                    <option key={p.id} value={p.id}>
                                        + {p.name}
                                    </option>
                                ))}
                            </select>
                        )}

                        {/* Standard Modal Assign */}
                        <button
                            type="button"
                            onClick={() => {
                                const selectedArr = Array.from(selectedItemIds);
                                const selectedItems = items.filter(i => selectedItemIds.has(i.id));

                                // Calculate common properties assigned across selected items
                                let resolvedInitialPropIds: string[] = [];

                                if (selectedItems.length > 0) {
                                    // Properties present on ALL selected items (intersection)
                                    const commonProps = selectedItems.reduce<string[]>((acc, item, idx) => {
                                        const itemProps = (item.assigned_property_ids || []).filter(p => p && p !== 'ALL');
                                        if (idx === 0) return [...itemProps];
                                        return acc.filter(id => itemProps.includes(id));
                                    }, []);

                                    if (commonProps.length > 0) {
                                        resolvedInitialPropIds = commonProps;
                                    } else {
                                        // Union of assigned properties across selected items
                                        const unionProps = Array.from(new Set(
                                            selectedItems.flatMap(i => (i.assigned_property_ids || []).filter(p => p && p !== 'ALL'))
                                        ));
                                        resolvedInitialPropIds = unionProps;
                                    }
                                }

                                if (filteredPropertyObj && !resolvedInitialPropIds.includes(filteredPropertyObj.id)) {
                                    resolvedInitialPropIds = [filteredPropertyObj.id, ...resolvedInitialPropIds];
                                }

                                setPropertyModalState({
                                    isOpen: true,
                                    targetItemIds: selectedArr,
                                    initialPropIds: resolvedInitialPropIds
                                });
                            }}
                            className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-black uppercase tracking-wider transition-all shadow-md flex items-center gap-2 border border-slate-700 active:scale-95"
                        >
                            <Building2 className="w-4 h-4 text-emerald-400" />
                            Assign Properties…
                        </button>

                        <button
                            type="button"
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
            <div className="rounded-2xl border border-slate-200 overflow-hidden bg-white shadow-xs">
                <div className="overflow-x-auto max-h-[62vh]">
                    <table className="w-full text-xs border-collapse">
                        <thead className="sticky top-0 z-10 shadow-xs">
                            {/* Column Header Titles */}
                            <tr className="bg-slate-100 text-slate-500 text-[10px] font-black uppercase tracking-widest text-left">
                                {canManage && (
                                    <th className="py-2.5 px-3 w-10 border-b border-slate-200 text-center">
                                        <button
                                            type="button"
                                            onClick={toggleSelectAll}
                                            title={isAllVisibleSelected ? 'Deselect all visible' : 'Select all visible'}
                                            className="text-slate-400 hover:text-slate-900 transition-colors inline-flex items-center justify-center"
                                        >
                                            {isAllVisibleSelected ? <CheckSquare className="w-4 h-4 text-slate-900" /> : <Square className="w-4 h-4" />}
                                        </button>
                                    </th>
                                )}
                                <th className="py-2.5 px-2 w-20 border-b border-slate-200">Sr. No.</th>
                                <th className="py-2.5 px-2 w-20 border-b border-slate-200">Image</th>
                                <th className="py-2.5 px-2 min-w-[200px] border-b border-slate-200">Item Description</th>
                                <th className="py-2.5 px-2 w-36 border-b border-slate-200">Category</th>
                                <th className="py-2.5 px-2 w-28 border-b border-slate-200">Unit</th>
                                <th className="py-2.5 px-2 w-36 border-b border-slate-200">Brands</th>
                                <th className="py-2.5 px-2 w-32 border-b border-slate-200">Final Rate</th>
                                <th className="py-2.5 px-3 min-w-[220px] border-b border-slate-200">Assigned Properties</th>
                                {canManage && <th className="py-2.5 px-2 w-24 border-b border-slate-200 text-right">Actions</th>}
                            </tr>

                            {/* ── Column Filters Row ────────────────────────────── */}
                            {showFilterRow && (
                                <tr className="bg-slate-50/95 backdrop-blur-xs border-b-2 border-slate-200 text-left">
                                    {canManage && (
                                        <th className="py-1.5 px-3 text-center align-top">
                                            {activeFilterCount > 0 ? (
                                                <button
                                                    type="button"
                                                    onClick={resetFilters}
                                                    title="Reset all column filters"
                                                    className="p-1 rounded-md text-rose-500 hover:bg-rose-100 transition-colors inline-flex items-center justify-center"
                                                >
                                                    <RotateCcw className="w-3.5 h-3.5" />
                                                </button>
                                            ) : (
                                                <div className="flex items-center justify-center pt-1.5">
                                                    <Filter className="w-3 h-3 text-slate-300" />
                                                </div>
                                            )}
                                        </th>
                                    )}

                                    {/* Sr No Filter */}
                                    <th className="py-1.5 px-2 align-top">
                                        <input
                                            type="text"
                                            value={filters.srNo}
                                            onChange={e => setFilters(f => ({ ...f, srNo: e.target.value }))}
                                            placeholder="e.g. 1-20"
                                            title="Filter by Sr. No. (e.g. 5 or 1-50)"
                                            className="w-full h-7 px-1.5 text-center text-[11px] font-bold rounded-lg border border-slate-200 bg-white placeholder:text-slate-400 placeholder:font-medium text-slate-800 focus:outline-none focus:border-slate-400"
                                        />
                                    </th>

                                    {/* Photo Filter */}
                                    <th className="py-1.5 px-2 align-top">
                                        <select
                                            value={filters.photo}
                                            onChange={e => setFilters(f => ({ ...f, photo: e.target.value as any }))}
                                            className="w-full h-7 px-1 text-[11px] font-bold rounded-lg border border-slate-200 bg-white text-slate-800 focus:outline-none focus:border-slate-400"
                                        >
                                            <option value="all">All</option>
                                            <option value="with_photo">📷 Photo</option>
                                            <option value="no_photo">No photo</option>
                                        </select>
                                    </th>

                                    {/* Name / Description Filter */}
                                    <th className="py-1.5 px-2 align-top">
                                        <div className="relative">
                                            <input
                                                type="text"
                                                value={filters.name}
                                                onChange={e => setFilters(f => ({ ...f, name: e.target.value }))}
                                                placeholder="Filter description…"
                                                className="w-full h-7 pl-2 pr-6 text-[11px] font-bold rounded-lg border border-slate-200 bg-white placeholder:text-slate-400 placeholder:font-medium text-slate-800 focus:outline-none focus:border-slate-400"
                                            />
                                            {filters.name && (
                                                <button
                                                    type="button"
                                                    onClick={() => setFilters(f => ({ ...f, name: '' }))}
                                                    className="absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
                                                >
                                                    <X className="w-3 h-3" />
                                                </button>
                                            )}
                                        </div>
                                    </th>

                                    {/* Category Filter */}
                                    <th className="py-1.5 px-2 align-top">
                                        <select
                                            value={filters.category}
                                            onChange={e => setFilters(f => ({ ...f, category: e.target.value }))}
                                            className="w-full h-7 px-1.5 text-[11px] font-bold rounded-lg border border-slate-200 bg-white text-slate-800 focus:outline-none focus:border-slate-400 truncate"
                                        >
                                            <option value="all">All Categories</option>
                                            {categoryOptions.list.map(c => (
                                                <option key={c.name} value={c.name}>
                                                    {c.name} ({c.count})
                                                </option>
                                            ))}
                                            {categoryOptions.uncategorized > 0 && (
                                                <option value="__uncategorized__">
                                                    Uncategorized ({categoryOptions.uncategorized})
                                                </option>
                                            )}
                                        </select>
                                    </th>

                                    {/* Unit Filter */}
                                    <th className="py-1.5 px-2 align-top">
                                        <select
                                            value={filters.unit}
                                            onChange={e => setFilters(f => ({ ...f, unit: e.target.value }))}
                                            className="w-full h-7 px-1.5 text-[11px] font-bold rounded-lg border border-slate-200 bg-white text-slate-800 focus:outline-none focus:border-slate-400 truncate"
                                        >
                                            <option value="all">All Units</option>
                                            {unitOptions.map(u => (
                                                <option key={u.name} value={u.name}>
                                                    {u.name} ({u.count})
                                                </option>
                                            ))}
                                        </select>
                                    </th>

                                    {/* Brand Filter */}
                                    <th className="py-1.5 px-2 align-top">
                                        <select
                                            value={filters.brand}
                                            onChange={e => setFilters(f => ({ ...f, brand: e.target.value }))}
                                            className="w-full h-7 px-1.5 text-[11px] font-bold rounded-lg border border-slate-200 bg-white text-slate-800 focus:outline-none focus:border-slate-400 truncate"
                                        >
                                            <option value="all">All Brands</option>
                                            {brandOptions.list.map(b => (
                                                <option key={b.name} value={b.name}>
                                                    {b.name} ({b.count})
                                                </option>
                                            ))}
                                            {brandOptions.noBrand > 0 && (
                                                <option value="__no_brand__">
                                                    No Brand ({brandOptions.noBrand})
                                                </option>
                                            )}
                                        </select>
                                    </th>

                                    {/* Final Rate Filter */}
                                    <th className="py-1.5 px-2 align-top">
                                        <div className="space-y-1">
                                            <select
                                                value={filters.priceRange}
                                                onChange={e => setFilters(f => ({ ...f, priceRange: e.target.value as any }))}
                                                className="w-full h-7 px-1 text-[11px] font-bold rounded-lg border border-slate-200 bg-white text-slate-800 focus:outline-none focus:border-slate-400"
                                            >
                                                <option value="all">All Rates</option>
                                                <option value="free">Free (₹0)</option>
                                                <option value="under_100">≤ ₹100</option>
                                                <option value="100_500">₹100–₹500</option>
                                                <option value="500_2000">₹500–₹2k</option>
                                                <option value="over_2000">&gt; ₹2k</option>
                                                <option value="custom">Custom…</option>
                                            </select>
                                            {filters.priceRange === 'custom' && (
                                                <div className="flex items-center gap-1">
                                                    <input
                                                        type="number"
                                                        placeholder="Min"
                                                        value={filters.minPrice}
                                                        onChange={e => setFilters(f => ({ ...f, minPrice: e.target.value }))}
                                                        className="w-1/2 h-6 px-1 text-[10px] font-bold rounded border border-slate-200 bg-white text-slate-800 focus:outline-none"
                                                    />
                                                    <input
                                                        type="number"
                                                        placeholder="Max"
                                                        value={filters.maxPrice}
                                                        onChange={e => setFilters(f => ({ ...f, maxPrice: e.target.value }))}
                                                        className="w-1/2 h-6 px-1 text-[10px] font-bold rounded border border-slate-200 bg-white text-slate-800 focus:outline-none"
                                                    />
                                                </div>
                                            )}
                                        </div>
                                    </th>

                                    {/* Assigned Properties Filter */}
                                    <th className="py-1.5 px-3 align-top min-w-[200px]">
                                        <div className="space-y-1.5">
                                            <select
                                                value={filters.property}
                                                onChange={e => {
                                                    const val = e.target.value;
                                                    setFilters(f => ({
                                                        ...f,
                                                        property: val,
                                                        ...(val.startsWith('count_') ? { propertyCountOp: 'any', propertyCountValue: '' } : {})
                                                    }));
                                                }}
                                                className="w-full h-7 px-1.5 text-[11px] font-bold rounded-lg border border-slate-200 bg-white text-slate-800 focus:outline-none focus:border-slate-400 truncate"
                                                title="Filter items showing for this property"
                                            >
                                                <option value="all">All Properties</option>
                                                <option value="universal">🌐 Universal (All Properties)</option>
                                                <option value="specific_only">🏢 Specific Properties Only</option>

                                                {/* Dynamically derived property count groups */}
                                                {propertyCountOptions.length > 0 && (
                                                    <optgroup label="By Assigned Count (Dynamic):">
                                                        {propertyCountOptions.map(pc => (
                                                            <option key={pc.count} value={`count_${pc.count}`}>
                                                                📋 Exactly {pc.count} {pc.count === 1 ? 'Property' : 'Properties'} ({pc.numItems} items)
                                                            </option>
                                                        ))}
                                                    </optgroup>
                                                )}

                                                {availableProperties.length > 0 && (
                                                    <optgroup label="Filter by Property:">
                                                        {availableProperties.map(p => (
                                                            <option key={p.id} value={p.id}>
                                                                🏢 {p.name}
                                                            </option>
                                                        ))}
                                                    </optgroup>
                                                )}
                                            </select>

                                            {/* Dynamic Flexible Property Count Filter (=, >=, <=) */}
                                            <div className="flex items-center gap-1">
                                                <select
                                                    value={filters.propertyCountOp}
                                                    onChange={e => {
                                                        const op = e.target.value as any;
                                                        setFilters(f => ({
                                                            ...f,
                                                            propertyCountOp: op,
                                                            ...(f.property.startsWith('count_') ? { property: 'all' } : {})
                                                        }));
                                                    }}
                                                    className="h-6 px-1 text-[10px] font-black rounded border border-slate-200 bg-white text-slate-700"
                                                    title="Filter by count of assigned properties"
                                                >
                                                    <option value="any">Count Filter…</option>
                                                    <option value="exact">= (Exact)</option>
                                                    <option value="gte">≥ (At least)</option>
                                                    <option value="lte">≤ (At most)</option>
                                                </select>
                                                {filters.propertyCountOp !== 'any' ? (
                                                    <div className="flex items-center gap-0.5 flex-1">
                                                        <input
                                                            type="number"
                                                            min="0"
                                                            placeholder="Count"
                                                            value={filters.propertyCountValue}
                                                            onChange={e => setFilters(f => ({ ...f, propertyCountValue: e.target.value }))}
                                                            className="w-14 h-6 px-1.5 text-[10px] font-black rounded border border-emerald-300 bg-emerald-50/50 text-emerald-950 focus:outline-none"
                                                        />
                                                        {filters.propertyCountValue && (
                                                            <button
                                                                type="button"
                                                                onClick={() => setFilters(f => ({ ...f, propertyCountOp: 'any', propertyCountValue: '' }))}
                                                                className="text-slate-400 hover:text-rose-500 p-0.5"
                                                                title="Clear count filter"
                                                            >
                                                                <X className="w-3 h-3" />
                                                            </button>
                                                        )}
                                                    </div>
                                                ) : (
                                                    /* Dynamic Quick Count Badges from Catalog */
                                                    propertyCountOptions.length > 0 && (
                                                        <div className="flex items-center gap-1 overflow-x-auto scrollbar-hide py-0.5">
                                                            {propertyCountOptions.map(pc => (
                                                                <button
                                                                    key={pc.count}
                                                                    type="button"
                                                                    onClick={() => setFilters(f => ({
                                                                        ...f,
                                                                        propertyCountOp: 'exact',
                                                                        propertyCountValue: String(pc.count),
                                                                        ...(f.property.startsWith('count_') ? { property: 'all' } : {})
                                                                    }))}
                                                                    className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200/80 whitespace-nowrap transition-colors"
                                                                    title={`Filter to items with exactly ${pc.count} properties assigned (${pc.numItems} items)`}
                                                                >
                                                                    ={pc.count} ({pc.numItems})
                                                                </button>
                                                            ))}
                                                        </div>
                                                    )
                                                )}
                                            </div>
                                        </div>
                                    </th>

                                    {/* Actions Column Filter Reset */}
                                    {canManage && (
                                        <th className="py-1.5 px-2 text-right align-top">
                                            {activeFilterCount > 0 ? (
                                                <button
                                                    type="button"
                                                    onClick={resetFilters}
                                                    className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-rose-50 hover:bg-rose-100 text-rose-600 font-black text-[10px] border border-rose-200 transition-colors"
                                                >
                                                    <RotateCcw className="w-3 h-3" />
                                                    <span>Reset</span>
                                                </button>
                                            ) : (
                                                <span className="text-[10px] text-slate-300 font-bold block pt-1 pr-1">—</span>
                                            )}
                                        </th>
                                    )}
                                </tr>
                            )}
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
                <div className="flex items-center gap-2">
                    <span>{visible.length} of {section === 'standard' ? counts.standard : counts.legacy} shown</span>
                    {activeFilterCount > 0 && (
                        <span className="px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700 text-[10px] font-black border border-emerald-200">
                            {activeFilterCount} active filter{activeFilterCount > 1 ? 's' : ''}
                        </span>
                    )}
                </div>
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
                    activeFilterPropertyName={
                        filteredPropertyObj?.name ||
                        (filters.property.startsWith('count_')
                            ? `Assigned to ${filters.property.replace('count_', '')} Properties`
                            : (filters.propertyCountOp !== 'any' && filters.propertyCountValue
                                ? `Assigned to ${filters.propertyCountValue} Properties`
                                : undefined))
                    }
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
    activeFilterPropertyName?: string;
    onClose: () => void;
    onSave: (assignedPropertyIds: string[], strategy?: 'replace' | 'append') => void;
}

function PropertyAssignmentModal({
    isOpen,
    targetItemCount,
    sampleItemName,
    initialAssignedIds,
    availableProperties,
    isSaving,
    activeFilterPropertyName,
    onClose,
    onSave,
}: PropertyAssignmentModalProps) {
    const isInitialAll = initialAssignedIds.length === 0 || initialAssignedIds.includes('ALL');
    const [mode, setMode] = useState<'all' | 'specific'>(isInitialAll ? 'all' : 'specific');
    const [strategy, setStrategy] = useState<'replace' | 'append'>('replace');
    const [selectedPropIds, setSelectedPropIds] = useState<Set<string>>(
        new Set(isInitialAll ? [] : initialAssignedIds)
    );
    const [propSearch, setPropSearch] = useState('');

    useEffect(() => {
        if (isOpen) {
            const isAll = initialAssignedIds.length === 0 || initialAssignedIds.includes('ALL');
            setMode(isAll ? 'all' : 'specific');
            setSelectedPropIds(new Set(isAll ? [] : initialAssignedIds));
        }
    }, [isOpen, initialAssignedIds]);

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
            onSave(Array.from(selectedPropIds), strategy);
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
                    {/* Active Filter Notice */}
                    {activeFilterPropertyName && (
                        <div className="p-3 rounded-2xl bg-emerald-50 border border-emerald-200 flex items-center gap-2 text-emerald-900 text-xs font-bold">
                            <Building2 className="w-4 h-4 text-emerald-600 shrink-0" />
                            <span>Pre-selected for your filter: <strong>{activeFilterPropertyName}</strong></span>
                        </div>
                    )}

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
                            {/* Bulk strategy when multiple items are selected */}
                            {targetItemCount > 1 && (
                                <div className="p-3 rounded-2xl bg-slate-50 border border-slate-200 flex flex-wrap items-center justify-between gap-2 text-xs">
                                    <span className="font-bold text-slate-700">Assignment Strategy:</span>
                                    <div className="flex items-center gap-2">
                                        <button
                                            type="button"
                                            onClick={() => setStrategy('replace')}
                                            className={`px-2.5 py-1 rounded-lg font-bold text-[11px] transition-all ${
                                                strategy === 'replace'
                                                    ? 'bg-slate-900 text-white'
                                                    : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'
                                            }`}
                                        >
                                            Replace Assignments
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setStrategy('append')}
                                            className={`px-2.5 py-1 rounded-lg font-bold text-[11px] transition-all ${
                                                strategy === 'append'
                                                    ? 'bg-slate-900 text-white'
                                                    : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'
                                            }`}
                                        >
                                            Add to Existing
                                        </button>
                                    </div>
                                </div>
                            )}

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
