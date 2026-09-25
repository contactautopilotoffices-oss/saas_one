'use client';

import { useCallback, useEffect, useState } from 'react';
import { Plus, Upload, QrCode, Search, Loader2, ChevronLeft, ChevronRight, PackageSearch } from 'lucide-react';
import type { EnrichedAsset } from '@/backend/lib/assets/enrich';
import { GRADE_META } from '@/backend/lib/assets/performance';
import { ASSET_STATUS_META } from '@/frontend/lib/assets/roles';
import AssetFormModal from './AssetFormModal';
import AssetDetailDrawer from './AssetDetailDrawer';
import BulkImportAssetsModal from './BulkImportAssetsModal';
import AssetQRLabelsModal, { type LabelAsset } from './AssetQRLabelsModal';

interface CategoryOption { id: string; name: string; code: string; color: string | null; default_lifecycle_years: number | null }
interface PropertyOption { id: string; name: string }

interface Props {
    organizationId: string;
    /** undefined = org-wide (org admin console); set = scoped to one property */
    propertyId?: string;
    propertyName?: string;
    properties?: PropertyOption[];
    canManage: boolean;
}

const PAGE_SIZE = 25;

export default function AssetRegisterView({ organizationId, propertyId, propertyName, properties = [], canManage }: Props) {
    const [assets, setAssets] = useState<EnrichedAsset[]>([]);
    const [categories, setCategories] = useState<CategoryOption[]>([]);
    const [loading, setLoading] = useState(true);
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [total, setTotal] = useState(0);

    const [search, setSearch] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const [categoryFilter, setCategoryFilter] = useState('');
    const [gradeFilter, setGradeFilter] = useState('');
    const [statusFilter, setStatusFilter] = useState('');
    const [propertyFilter, setPropertyFilter] = useState(propertyId || '');

    const [showForm, setShowForm] = useState(false);
    const [editingAsset, setEditingAsset] = useState<EnrichedAsset | null>(null);
    const [detailId, setDetailId] = useState<string | null>(null);
    const [showImport, setShowImport] = useState(false);
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [labelAssets, setLabelAssets] = useState<LabelAsset[] | null>(null);

    useEffect(() => {
        const t = setTimeout(() => setDebouncedSearch(search), 350);
        return () => clearTimeout(t);
    }, [search]);

    const fetchCategories = useCallback(async () => {
        const res = await fetch(`/api/assets/categories?organization_id=${organizationId}`);
        if (res.ok) { const data = await res.json(); setCategories(data.categories || []); }
    }, [organizationId]);

    const fetchAssets = useCallback(async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams({ organization_id: organizationId, page: String(page), page_size: String(PAGE_SIZE) });
            const scopedProperty = propertyId || propertyFilter;
            if (scopedProperty) params.set('property_id', scopedProperty);
            if (categoryFilter) params.set('category_id', categoryFilter);
            if (gradeFilter) params.set('grade', gradeFilter);
            if (statusFilter) params.set('status', statusFilter);
            if (debouncedSearch) params.set('search', debouncedSearch);
            const res = await fetch(`/api/assets?${params}`);
            if (res.ok) {
                const data = await res.json();
                setAssets(data.assets || []);
                setTotalPages(data.pagination?.total_pages || 1);
                setTotal(data.pagination?.total || 0);
            }
        } finally {
            setLoading(false);
        }
    }, [organizationId, propertyId, propertyFilter, categoryFilter, gradeFilter, statusFilter, debouncedSearch, page]);

    useEffect(() => { fetchCategories(); }, [fetchCategories]);
    useEffect(() => { setPage(1); }, [propertyFilter, categoryFilter, gradeFilter, statusFilter, debouncedSearch]);
    useEffect(() => { fetchAssets(); }, [fetchAssets]);

    const toggleSelect = (id: string) => {
        setSelected((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    };

    const printSelected = () => {
        const chosen = assets.filter((a) => selected.has(a.id));
        setLabelAssets(chosen.map((a) => ({ id: a.id, asset_code: a.asset_code, name: a.name, qr_token: a.qr_token })));
    };

    const activePropertyId = propertyId || propertyFilter;
    const activePropertyName = propertyId ? propertyName : properties.find((p) => p.id === propertyFilter)?.name;

    return (
        <div className="space-y-4">
            {/* Toolbar */}
            <div className="flex flex-wrap items-center gap-3">
                <div className="relative flex-1 min-w-[200px]">
                    <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Search name, code, serial..."
                        className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                    />
                </div>

                {!propertyId && properties.length > 0 && (
                    <select value={propertyFilter} onChange={(e) => setPropertyFilter(e.target.value)} className="px-3 py-2.5 rounded-xl border border-slate-200 text-sm">
                        <option value="">All Properties</option>
                        {properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                )}
                <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className="px-3 py-2.5 rounded-xl border border-slate-200 text-sm">
                    <option value="">All Categories</option>
                    {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <select value={gradeFilter} onChange={(e) => setGradeFilter(e.target.value)} className="px-3 py-2.5 rounded-xl border border-slate-200 text-sm">
                    <option value="">All Grades</option>
                    <option value="P1">P1 · Performing</option>
                    <option value="P2">P2 · Attention</option>
                    <option value="P3">P3 · End of life risk</option>
                </select>
                <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="px-3 py-2.5 rounded-xl border border-slate-200 text-sm">
                    <option value="">All Statuses</option>
                    {Object.entries(ASSET_STATUS_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                </select>

                {canManage && (
                    <div className="flex items-center gap-2 ml-auto">
                        {selected.size > 0 && (
                            <button onClick={printSelected} className="flex items-center gap-1.5 px-3.5 py-2.5 bg-slate-100 text-slate-700 rounded-xl text-xs font-bold">
                                <QrCode size={15} /> Print {selected.size} Label{selected.size === 1 ? '' : 's'}
                            </button>
                        )}
                        <button
                            onClick={() => setShowImport(true)}
                            disabled={!activePropertyId}
                            title={activePropertyId ? undefined : 'Select a property to import into'}
                            className="flex items-center gap-1.5 px-3.5 py-2.5 bg-slate-100 text-slate-700 rounded-xl text-xs font-bold disabled:opacity-40"
                        >
                            <Upload size={15} /> Import
                        </button>
                        <button
                            onClick={() => { setEditingAsset(null); setShowForm(true); }}
                            disabled={!activePropertyId}
                            title={activePropertyId ? undefined : 'Select a property to add into'}
                            className="flex items-center gap-1.5 px-4 py-2.5 bg-primary text-white rounded-xl text-xs font-black uppercase tracking-wide disabled:opacity-40"
                        >
                            <Plus size={15} /> Add Asset
                        </button>
                    </div>
                )}
            </div>

            {/* Table */}
            <div className="rounded-2xl border border-slate-100 overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
                            <tr>
                                {canManage && <th className="w-10 p-3"></th>}
                                <th className="text-left p-3 font-bold">Asset</th>
                                <th className="text-left p-3 font-bold">Category</th>
                                {!propertyId && <th className="text-left p-3 font-bold">Property</th>}
                                <th className="text-left p-3 font-bold">Location</th>
                                <th className="text-left p-3 font-bold">Grade</th>
                                <th className="text-left p-3 font-bold">Status</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50">
                            {loading && (
                                <tr><td colSpan={7} className="p-10 text-center"><Loader2 className="animate-spin inline text-primary" size={24} /></td></tr>
                            )}
                            {!loading && assets.length === 0 && (
                                <tr><td colSpan={7} className="p-10 text-center text-slate-400">
                                    <PackageSearch size={28} className="mx-auto mb-2 text-slate-300" />
                                    No assets found
                                </td></tr>
                            )}
                            {!loading && assets.map((a) => {
                                const grade = GRADE_META[a.health.grade];
                                const status = ASSET_STATUS_META[a.status] || { label: a.status, color: '#64748B' };
                                return (
                                    <tr key={a.id} className="hover:bg-slate-50/60 cursor-pointer" onClick={() => setDetailId(a.id)}>
                                        {canManage && (
                                            <td className="p-3" onClick={(e) => e.stopPropagation()}>
                                                <input type="checkbox" checked={selected.has(a.id)} onChange={() => toggleSelect(a.id)} className="rounded border-slate-300" />
                                            </td>
                                        )}
                                        <td className="p-3">
                                            <p className="font-bold text-slate-800">{a.name}</p>
                                            <p className="text-xs text-slate-400 font-mono">{a.asset_code}</p>
                                        </td>
                                        <td className="p-3">
                                            {a.category && (
                                                <span className="px-2 py-0.5 rounded-full text-xs font-bold" style={{ backgroundColor: `${a.category.color || '#708F96'}1a`, color: a.category.color || '#708F96' }}>
                                                    {a.category.name}
                                                </span>
                                            )}
                                        </td>
                                        {!propertyId && <td className="p-3 text-slate-600">{a.property?.name}</td>}
                                        <td className="p-3 text-slate-500 text-xs">{[a.floor, a.location].filter(Boolean).join(' · ') || '—'}</td>
                                        <td className="p-3">
                                            <span className="flex items-center gap-1.5 text-xs font-black" style={{ color: grade.color }}>
                                                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: grade.color }} />
                                                {a.health.grade}
                                            </span>
                                        </td>
                                        <td className="p-3">
                                            <span className="px-2 py-0.5 rounded-full text-xs font-bold" style={{ backgroundColor: `${status.color}1a`, color: status.color }}>
                                                {status.label}
                                            </span>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
                {totalPages > 1 && (
                    <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100 text-xs text-slate-500">
                        <span>{total} asset{total === 1 ? '' : 's'}</span>
                        <div className="flex items-center gap-2">
                            <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="p-1.5 rounded-lg hover:bg-slate-100 disabled:opacity-30"><ChevronLeft size={16} /></button>
                            <span>Page {page} of {totalPages}</span>
                            <button disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} className="p-1.5 rounded-lg hover:bg-slate-100 disabled:opacity-30"><ChevronRight size={16} /></button>
                        </div>
                    </div>
                )}
            </div>

            {showForm && activePropertyId && (
                <AssetFormModal
                    organizationId={organizationId}
                    propertyId={activePropertyId}
                    asset={editingAsset}
                    categories={categories}
                    onClose={() => { setShowForm(false); setEditingAsset(null); }}
                    onSaved={() => { setShowForm(false); setEditingAsset(null); fetchAssets(); }}
                />
            )}

            {detailId && (
                <AssetDetailDrawer
                    assetId={detailId}
                    canManage={canManage}
                    onClose={() => setDetailId(null)}
                    onEdit={() => {
                        const a = assets.find((x) => x.id === detailId);
                        if (a) { setEditingAsset(a); setShowForm(true); setDetailId(null); }
                    }}
                    onDeleted={() => { setDetailId(null); fetchAssets(); }}
                    onShowQr={() => {
                        const a = assets.find((x) => x.id === detailId);
                        if (a) setLabelAssets([{ id: a.id, asset_code: a.asset_code, name: a.name, qr_token: a.qr_token }]);
                    }}
                />
            )}

            {showImport && activePropertyId && (
                <BulkImportAssetsModal
                    organizationId={organizationId}
                    propertyId={activePropertyId}
                    propertyName={activePropertyName}
                    onClose={() => setShowImport(false)}
                    onSuccess={() => { fetchAssets(); fetchCategories(); }}
                />
            )}

            {labelAssets && (
                <AssetQRLabelsModal assets={labelAssets} propertyName={activePropertyName} onClose={() => setLabelAssets(null)} />
            )}
        </div>
    );
}
