'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
    DollarSign, Building2, Search, Plus, Upload, CheckCircle2,
    AlertCircle, RefreshCw, Loader2, Edit2, Save, X, Layers,
    FileSpreadsheet, Sparkles, Filter, ChevronDown, ChevronRight,
    Download, Package
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import * as XLSX from 'xlsx';

interface SitePricingAdminTabProps {
    user: any;
    organizationId: string;
    properties?: Array<{ id: string; name: string }>;
}

export default function SitePricingAdminTab({
    user,
    organizationId,
    properties = []
}: SitePricingAdminTabProps) {
    const [propertyList, setPropertyList] = useState<Array<{ id: string; name: string }>>(properties || []);
    const [selectedPropertyId, setSelectedPropertyId] = useState<string>(properties[0]?.id || '');
    const [catalogWithPrices, setCatalogWithPrices] = useState<any[]>([]);
    const [isLoading, setIsLoading] = useState<boolean>(true);
    const [searchQuery, setSearchQuery] = useState<string>('');
    const [selectedCategory, setSelectedCategory] = useState<string>('all');

    // Auto-load properties if not supplied by parent
    useEffect(() => {
        if (properties && properties.length > 0) {
            setPropertyList(properties);
            if (!selectedPropertyId) {
                setSelectedPropertyId(properties[0].id);
            }
        } else if (organizationId) {
            fetch(`/api/properties?organization_id=${organizationId}`)
                .then(res => res.json())
                .then(data => {
                    if (Array.isArray(data) && data.length > 0) {
                        setPropertyList(data);
                        if (!selectedPropertyId) {
                            setSelectedPropertyId(data[0].id);
                        }
                    }
                })
                .catch(err => console.error('Failed to load properties for site pricing tab:', err));
        }
    }, [properties, organizationId]);

    // Single Price Edit Modal
    const [showPriceEditModal, setShowPriceEditModal] = useState<any | null>(null);
    const [editPriceValue, setEditPriceValue] = useState<string>('');
    const [isSavingPrice, setIsSavingPrice] = useState<boolean>(false);

    // Add Single Item Modal
    const [showAddItemModal, setShowAddItemModal] = useState<boolean>(false);
    const [newItemName, setNewItemName] = useState<string>('');
    const [newItemCategory, setNewItemCategory] = useState<string>('HK');
    const [newItemBrand, setNewItemBrand] = useState<string>('NA');
    const [newItemDetails, setNewItemDetails] = useState<string>('');
    const [newItemUnit, setNewItemUnit] = useState<string>('pcs');
    const [newItemBasePrice, setNewItemBasePrice] = useState<string>('0');
    const [isSavingNewItem, setIsSavingNewItem] = useState<boolean>(false);

    // Bulk Add Items Modal (Excel)
    const [showBulkAddModal, setShowBulkAddModal] = useState<boolean>(false);
    const [bulkFile, setBulkFile] = useState<File | null>(null);
    const [bulkPreviewItems, setBulkPreviewItems] = useState<any[]>([]);
    const [isProcessingBulk, setIsProcessingBulk] = useState<boolean>(false);

    // Fetch site prices for currently selected property
    const fetchCatalogPrices = useCallback(async () => {
        if (!organizationId) return;
        setIsLoading(true);
        try {
            const url = selectedPropertyId
                ? `/api/procurement/pricing?organization_id=${organizationId}&property_id=${selectedPropertyId}`
                : `/api/procurement/pricing?organization_id=${organizationId}`;
            const res = await fetch(url);
            const data = await res.json();
            if (data.items) {
                setCatalogWithPrices(data.items);
            }
        } catch (err) {
            console.error('Error fetching site catalog pricing:', err);
        } finally {
            setIsLoading(false);
        }
    }, [organizationId, selectedPropertyId]);

    useEffect(() => {
        fetchCatalogPrices();
    }, [fetchCatalogPrices]);

    // Save individual site price override
    const handleSavePrice = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!showPriceEditModal || !selectedPropertyId) return;

        setIsSavingPrice(true);
        try {
            const res = await fetch('/api/procurement/pricing', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    organization_id: organizationId,
                    item_id: showPriceEditModal.id,
                    property_id: selectedPropertyId,
                    unit_price: parseFloat(editPriceValue),
                    source: 'ADMIN_OVERRIDE'
                })
            });

            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to update price');

            setShowPriceEditModal(null);
            fetchCatalogPrices();
        } catch (err: any) {
            alert(`Error: ${err.message}`);
        } finally {
            setIsSavingPrice(false);
        }
    };

    // Add New Single Item
    const handleCreateSingleItem = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newItemName.trim()) return;

        setIsSavingNewItem(true);
        try {
            const res = await fetch('/api/procurement/catalog/bulk', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    organization_id: organizationId,
                    items: [
                        {
                            name: newItemName.trim(),
                            category: newItemCategory,
                            brand: newItemBrand.trim() || 'NA',
                            color_size_details: newItemDetails.trim(),
                            unit: newItemUnit.trim() || 'pcs',
                            estimated_price: parseFloat(newItemBasePrice) || 0,
                            unit_price: parseFloat(newItemBasePrice) || 0
                        }
                    ]
                })
            });

            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to add item');

            alert('✅ Item added to master catalog successfully!');
            setShowAddItemModal(false);
            setNewItemName('');
            setNewItemDetails('');
            setNewItemBasePrice('0');
            fetchCatalogPrices();
        } catch (err: any) {
            alert(`Error: ${err.message}`);
        } finally {
            setIsSavingNewItem(false);
        }
    };

    // Download Sample Template for Bulk Items Excel
    const handleDownloadSampleExcel = () => {
        const sampleRows = [
            { 'Item Name': 'Wet Mop Refill', 'Category': 'HK', 'Brand': 'NA', 'Details': 'Cotton', 'Unit': 'pcs', 'Base Price': 62, 'HSN': '9603' },
            { 'Item Name': 'Toilet Roll', 'Category': 'HK', 'Brand': 'NA', 'Details': 'White', 'Unit': 'pcs', 'Base Price': 45, 'HSN': '4818' },
            { 'Item Name': 'CCD Coffee Beans', 'Category': 'Beverages', 'Brand': 'CCD', 'Details': 'Beans', 'Unit': 'KG', 'Base Price': 850, 'HSN': '0901' },
            { 'Item Name': 'M fold Tissue', 'Category': 'HK', 'Brand': 'NA', 'Details': 'White', 'Unit': 'pcs', 'Base Price': 35, 'HSN': '4818' },
            { 'Item Name': 'Harpic 500ml', 'Category': 'HK', 'Brand': 'Harpic', 'Details': 'Blue', 'Unit': 'can', 'Base Price': 95, 'HSN': '3402' },
        ];
        const ws = XLSX.utils.json_to_sheet(sampleRows);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Items_Template');
        XLSX.writeFile(wb, 'Master_Catalog_Items_Template.xlsx');
    };

    // Parse Excel for Bulk Preview
    const handleParseBulkFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setBulkFile(file);

        try {
            const buffer = await file.arrayBuffer();
            const workbook = XLSX.read(buffer, { type: 'array' });
            const sheet = workbook.Sheets[workbook.SheetNames[0]];
            const jsonData = XLSX.utils.sheet_to_json(sheet) as any[];

            const parsed = jsonData.map((r: any) => ({
                name: String(r['Item Name'] || r['Item'] || r['name'] || '').trim(),
                category: String(r['Category'] || r['category'] || 'HK').trim(),
                brand: String(r['Brand'] || r['brand'] || 'NA').trim(),
                details: String(r['Details'] || r['Color / Size'] || r['details'] || '').trim(),
                unit: String(r['Unit'] || r['UOM'] || r['unit'] || 'pcs').trim(),
                estimated_price: parseFloat(r['Base Price'] || r['Price'] || r['price'] || r['Rate'] || '0')
            })).filter(i => i.name.length > 0);

            setBulkPreviewItems(parsed);
        } catch (err) {
            alert('Failed to read Excel file. Please ensure it is a valid .xlsx or .csv file.');
        }
    };

    // Save Bulk Items
    const handleSaveBulkItems = async () => {
        if (!bulkFile || bulkPreviewItems.length === 0) return;

        setIsProcessingBulk(true);
        try {
            const formData = new FormData();
            formData.append('organization_id', organizationId);
            formData.append('file', bulkFile);

            const res = await fetch('/api/procurement/catalog/bulk', {
                method: 'POST',
                body: formData
            });

            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to upload items');

            alert(`✅ ${data.message}`);
            setShowBulkAddModal(false);
            setBulkFile(null);
            setBulkPreviewItems([]);
            fetchCatalogPrices();
        } catch (err: any) {
            alert(`Error: ${err.message}`);
        } finally {
            setIsProcessingBulk(false);
        }
    };

    // Extract all unique category names dynamically from current catalog
    const uniqueCategories = useMemo(() => {
        const set = new Set<string>();
        catalogWithPrices.forEach(item => {
            if (item.category && typeof item.category === 'string') {
                const cat = item.category.trim();
                if (cat) set.add(cat);
            }
        });
        return Array.from(set).sort();
    }, [catalogWithPrices]);

    const filteredItems = useMemo(() => {
        return catalogWithPrices.filter(item => {
            if (selectedCategory !== 'all') {
                const itemCat = (item.category || '').toLowerCase().trim();
                const selCat = selectedCategory.toLowerCase().trim();

                if (itemCat !== selCat) {
                    // Check broad category groupings
                    const isHkGroup = (selCat === 'hk' || selCat === 'housekeeping') && (
                        itemCat.includes('hk') || itemCat.includes('housekeeping') || 
                        itemCat.includes('office') || itemCat.includes('stationery') || 
                        itemCat.includes('paper') || itemCat.includes('clean') || itemCat.includes('refill')
                    );
                    const isBevGroup = (selCat === 'beverages' || selCat === 'pantry') && (
                        itemCat.includes('bev') || itemCat.includes('pantry') || 
                        itemCat.includes('water') || itemCat.includes('coffee') || 
                        itemCat.includes('ccd') || itemCat.includes('tea') || itemCat.includes('bottle')
                    );
                    const isTechGroup = (selCat === 'technical' || selCat === 'spares') && (
                        itemCat.includes('tech') || itemCat.includes('spare') || 
                        itemCat.includes('maint') || itemCat.includes('elect') || 
                        itemCat.includes('plumb') || itemCat.includes('light')
                    );
                    const isGenGroup = selCat === 'general' && (
                        itemCat.includes('gen') || itemCat.includes('misc') || !itemCat
                    );

                    if (!isHkGroup && !isBevGroup && !isTechGroup && !isGenGroup) {
                        return false;
                    }
                }
            }

            if (searchQuery) {
                const q = searchQuery.toLowerCase().trim();
                const name = (item.name || '').toLowerCase();
                const brand = (item.brand || '').toLowerCase();
                const cat = (item.category || '').toLowerCase();
                const details = (item.color_size_details || '').toLowerCase();
                return name.includes(q) || brand.includes(q) || cat.includes(q) || details.includes(q);
            }
            return true;
        });
    }, [catalogWithPrices, selectedCategory, searchQuery]);

    const selectedPropertyName = propertyList.find(p => p.id === selectedPropertyId)?.name || 'All Properties';

    return (
        <div className="space-y-6">
            {/* Header Toolbar */}
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-600">
                        <Package className="w-6 h-6" />
                    </div>
                    <div>
                        <h2 className="text-lg font-black text-slate-800">Master Item Catalog & Site-Specific Pricing</h2>
                        <p className="text-xs text-slate-500 font-medium">
                            Manage centralized products and configure property rates (e.g. Rabale, Mumbai, Noida).
                        </p>
                    </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                    {/* + Add Single Item */}
                    <button
                        onClick={() => setShowAddItemModal(true)}
                        className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 transition-all cursor-pointer"
                    >
                        <Plus className="w-4 h-4 text-emerald-600" />
                        + Add New Item
                    </button>

                    {/* Bulk Upload Items via Excel */}
                    <button
                        onClick={() => setShowBulkAddModal(true)}
                        className="flex items-center gap-1.5 px-5 py-2.5 rounded-xl text-xs font-black text-white bg-emerald-600 hover:bg-emerald-700 shadow-xs transition-all cursor-pointer"
                    >
                        <Upload className="w-4 h-4" />
                        Bulk Upload Items (Excel)
                    </button>
                </div>
            </div>

            {/* Property Selector & Filter Strip */}
            <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs grid grid-cols-1 sm:grid-cols-3 gap-3">
                {/* Property Dropdown */}
                <div>
                    <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                        Select Property to View / Edit Applicable Rates
                    </label>
                    <select
                        value={selectedPropertyId}
                        onChange={e => setSelectedPropertyId(e.target.value)}
                        className="w-full bg-emerald-50/50 border border-emerald-200 text-emerald-900 font-bold text-sm rounded-xl px-3 py-2 focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
                    >
                        <option value="">All Properties (Base Catalog Rates)</option>
                        {propertyList.map(p => (
                            <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                    </select>
                </div>

                {/* Search */}
                <div>
                    <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                        Search Item, Brand or Detail
                    </label>
                    <div className="relative">
                        <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
                        <input
                            type="text"
                            placeholder="Filter items..."
                            value={searchQuery}
                            onChange={e => setSearchQuery(e.target.value)}
                            className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
                        />
                    </div>
                </div>

                {/* Category Filter */}
                <div>
                    <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                        Category
                    </label>
                    <select
                        value={selectedCategory}
                        onChange={e => setSelectedCategory(e.target.value)}
                        className="w-full bg-slate-50 border border-slate-200 text-slate-800 font-semibold text-sm rounded-xl px-3 py-2 focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
                    >
                        <option value="all">All Categories ({catalogWithPrices.length} items)</option>
                        <optgroup label="Broad Groups">
                            <option value="HK">HK / Stationery / Paper</option>
                            <option value="Beverages">Beverages / CCD / Water</option>
                            <option value="Technical">Technical & Spares</option>
                        </optgroup>
                        {uniqueCategories.length > 0 && (
                            <optgroup label="Exact Database Categories">
                                {uniqueCategories.map(cat => (
                                    <option key={cat} value={cat}>{cat}</option>
                                ))}
                            </optgroup>
                        )}
                    </select>
                </div>
            </div>

            {/* Catalog Items & Site Pricing Table */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
                <div className="p-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                    <span className="text-xs font-black text-slate-700 uppercase tracking-wider">
                        Master Items ({filteredItems.length}) • Active Rates for <b>{selectedPropertyName}</b>
                    </span>
                    <span className="text-xs text-slate-500">
                        Click pencil icon on any row to override rate for {selectedPropertyName}.
                    </span>
                </div>

                {isLoading ? (
                    <div className="p-4 space-y-3 animate-pulse">
                        {[1, 2, 3, 4, 5, 6].map((i) => (
                            <div key={`pricing-skeleton-${i}`} className="flex items-center justify-between py-3 px-4 border-b border-slate-100 last:border-0">
                                <div className="h-4 bg-slate-100 rounded-md w-8" />
                                <div className="space-y-1.5 w-1/3">
                                    <div className="h-4 bg-slate-200 rounded-md w-3/4" />
                                    <div className="h-3 bg-slate-100 rounded-md w-1/2" />
                                </div>
                                <div className="h-4 bg-slate-100 rounded-md w-20" />
                                <div className="h-4 bg-slate-100 rounded-md w-16" />
                                <div className="h-4 bg-slate-200 rounded-md w-24" />
                                <div className="h-4 bg-emerald-100 rounded-md w-24" />
                                <div className="h-7 bg-slate-100 rounded-lg w-10" />
                            </div>
                        ))}
                    </div>
                ) : filteredItems.length === 0 ? (
                    <div className="py-16 text-center text-slate-400">
                        <Package className="w-12 h-12 mx-auto mb-2 text-slate-300" />
                        <p className="text-sm font-semibold text-slate-600">No items found in catalog</p>
                        <p className="text-xs text-slate-400 mt-1">Click "+ Add New Item" or "Bulk Upload Items" above to populate products.</p>
                    </div>
                ) : (
                    <div className="overflow-x-auto max-h-[600px]">
                        <table className="w-full text-xs text-left">
                            <thead className="bg-slate-100 font-bold text-slate-700 uppercase text-[11px] border-b border-slate-200">
                                <tr>
                                    <th className="py-3 px-4 w-12 text-center">#</th>
                                    <th className="py-3 px-4 min-w-[200px]">Product / Item Name</th>
                                    <th className="py-3 px-3">Category</th>
                                    <th className="py-3 px-3">Brand</th>
                                    <th className="py-3 px-3">Details / Size</th>
                                    <th className="py-3 px-3 text-center">UOM</th>
                                    <th className="py-3 px-4 text-right">Base Catalog Price (₹)</th>
                                    <th className="py-3 px-4 text-right bg-emerald-50/70 border-x border-emerald-100 text-emerald-950 font-black">
                                        {selectedPropertyName} Rate (₹)
                                    </th>
                                    <th className="py-3 px-3 text-center">Action</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {filteredItems.map((item, idx) => (
                                    <tr key={item.id} className="hover:bg-slate-50/80 transition-colors">
                                        <td className="py-2.5 px-4 text-center font-semibold text-slate-400 bg-slate-50/50">
                                            {idx + 1}
                                        </td>
                                        <td className="py-2.5 px-4 font-bold text-slate-900">
                                            {item.name}
                                        </td>
                                        <td className="py-2.5 px-3 font-semibold text-slate-600">
                                            <span className="px-2 py-0.5 rounded-md bg-slate-100 text-[10px]">
                                                {item.category || 'HK'}
                                            </span>
                                        </td>
                                        <td className="py-2.5 px-3 text-slate-700">{item.brand || 'NA'}</td>
                                        <td className="py-2.5 px-3 text-slate-500">{item.details || '-'}</td>
                                        <td className="py-2.5 px-3 text-center font-semibold text-slate-700">{item.unit || 'pcs'}</td>
                                        <td className="py-2.5 px-4 text-right font-semibold text-slate-500">₹{item.base_price || 0}</td>
                                        <td className="py-2.5 px-4 text-right font-black text-emerald-700 bg-emerald-50/30 border-x border-emerald-100">
                                            <div className="flex items-center justify-end gap-1.5">
                                                <span>₹{item.unit_price}</span>
                                                {item.is_site_specific && (
                                                    <span className="text-[9px] px-1.5 py-0.2 rounded-sm bg-emerald-200 text-emerald-900 font-bold uppercase tracking-tight">
                                                        Site Override
                                                    </span>
                                                )}
                                            </div>
                                        </td>
                                        <td className="py-2.5 px-3 text-center">
                                            <button
                                                onClick={() => {
                                                    setShowPriceEditModal(item);
                                                    setEditPriceValue(item.unit_price.toString());
                                                }}
                                                className="p-1.5 rounded-lg text-slate-500 hover:text-emerald-700 hover:bg-emerald-50 transition-colors cursor-pointer"
                                                title={`Edit price for ${selectedPropertyName}`}
                                            >
                                                <Edit2 className="w-3.5 h-3.5" />
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* Modal 1: Add Single Item */}
            <AnimatePresence>
                {showAddItemModal && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
                        <motion.div
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.95 }}
                            className="bg-white rounded-3xl shadow-2xl border border-slate-200 w-full max-w-lg overflow-hidden p-6 space-y-4"
                        >
                            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                                <div className="flex items-center gap-2">
                                    <Plus className="w-5 h-5 text-emerald-600" />
                                    <h3 className="font-black text-slate-900 text-base">Add New Item to Master Catalog</h3>
                                </div>
                                <button onClick={() => setShowAddItemModal(false)} className="p-1 text-slate-400 hover:text-slate-700">
                                    <X className="w-5 h-5" />
                                </button>
                            </div>

                            <form onSubmit={handleCreateSingleItem} className="space-y-3">
                                <div>
                                    <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block mb-1">
                                        Item Name / Description <span className="text-red-500">*</span>
                                    </label>
                                    <input
                                        type="text"
                                        required
                                        placeholder="e.g. Wet Mop Refill, Toilet Roll, Harpic"
                                        value={newItemName}
                                        onChange={e => setNewItemName(e.target.value)}
                                        className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
                                    />
                                </div>

                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block mb-1">Category</label>
                                        <select
                                            value={newItemCategory}
                                            onChange={e => setNewItemCategory(e.target.value)}
                                            className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-800"
                                        >
                                            <option value="HK">HK / Stationery / Paper</option>
                                            <option value="Beverages">Beverages / CCD / Pantry</option>
                                            <option value="Technical">Technical & Spares</option>
                                            <option value="General">General Supplies</option>
                                        </select>
                                    </div>

                                    <div>
                                        <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block mb-1">Brand</label>
                                        <input
                                            type="text"
                                            placeholder="e.g. NA, Harpic, CCD, Doms"
                                            value={newItemBrand}
                                            onChange={e => setNewItemBrand(e.target.value)}
                                            className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-800"
                                        />
                                    </div>
                                </div>

                                <div className="grid grid-cols-3 gap-3">
                                    <div>
                                        <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block mb-1">Details / Size</label>
                                        <input
                                            type="text"
                                            placeholder="White, 32x42"
                                            value={newItemDetails}
                                            onChange={e => setNewItemDetails(e.target.value)}
                                            className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-800"
                                        />
                                    </div>

                                    <div>
                                        <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block mb-1">UOM / Unit</label>
                                        <select
                                            value={newItemUnit}
                                            onChange={e => setNewItemUnit(e.target.value)}
                                            className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-800"
                                        >
                                            <option value="pcs">pcs</option>
                                            <option value="pkt">pkt</option>
                                            <option value="KG">KG</option>
                                            <option value="Ltr">Ltr</option>
                                            <option value="can">can</option>
                                            <option value="Roll">Roll</option>
                                            <option value="pair">pair</option>
                                            <option value="box">box</option>
                                        </select>
                                    </div>

                                    <div>
                                        <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block mb-1">Base Price (₹)</label>
                                        <input
                                            type="number"
                                            min="0"
                                            step="0.01"
                                            value={newItemBasePrice}
                                            onChange={e => setNewItemBasePrice(e.target.value)}
                                            className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-emerald-700"
                                        />
                                    </div>
                                </div>

                                <div className="flex justify-end gap-2 pt-3">
                                    <button
                                        type="button"
                                        onClick={() => setShowAddItemModal(false)}
                                        className="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-100"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        type="submit"
                                        disabled={isSavingNewItem}
                                        className="px-5 py-2 rounded-xl text-xs font-black text-white bg-emerald-600 hover:bg-emerald-700 shadow-xs"
                                    >
                                        {isSavingNewItem ? 'Saving Item...' : 'Save to Catalog'}
                                    </button>
                                </div>
                            </form>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>

            {/* Modal 2: Bulk Add Items (Excel Upload) */}
            <AnimatePresence>
                {showBulkAddModal && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
                        <motion.div
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.95 }}
                            className="bg-white rounded-3xl shadow-2xl border border-slate-200 w-full max-w-2xl overflow-hidden p-6 space-y-4 max-h-[88vh] flex flex-col"
                        >
                            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                                <div className="flex items-center gap-2">
                                    <Upload className="w-5 h-5 text-emerald-600" />
                                    <div>
                                        <h3 className="font-black text-slate-900 text-base">Bulk Upload Catalog Items (Excel)</h3>
                                        <p className="text-xs text-slate-500">Add multiple products to the master catalog simultaneously.</p>
                                    </div>
                                </div>
                                <button onClick={() => setShowBulkAddModal(false)} className="p-1 text-slate-400 hover:text-slate-700">
                                    <X className="w-5 h-5" />
                                </button>
                            </div>

                            {/* Download Template Strip */}
                            <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center justify-between">
                                <div className="text-xs text-emerald-950 font-medium">
                                    Need the standard format? Download the sample Excel template.
                                </div>
                                <button
                                    onClick={handleDownloadSampleExcel}
                                    className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-emerald-300 text-emerald-800 rounded-lg text-xs font-bold hover:bg-emerald-100 cursor-pointer"
                                >
                                    <Download className="w-3.5 h-3.5" />
                                    Download Template (.xlsx)
                                </button>
                            </div>

                            {/* File Upload Dropzone */}
                            <div className="p-6 border-2 border-dashed border-slate-200 rounded-2xl text-center space-y-2 bg-slate-50">
                                <FileSpreadsheet className="w-8 h-8 mx-auto text-emerald-600" />
                                <p className="text-xs font-bold text-slate-700">Choose your filled Excel / CSV file</p>
                                <input
                                    type="file"
                                    accept=".xlsx,.xls,.csv"
                                    onChange={handleParseBulkFile}
                                    className="text-xs text-slate-500 file:mr-3 file:py-1.5 file:px-3 file:rounded-xl file:border-0 file:text-xs file:font-bold file:bg-emerald-100 file:text-emerald-800"
                                />
                            </div>

                            {/* Preview Table */}
                            {bulkPreviewItems.length > 0 && (
                                <div className="space-y-2 flex-1 overflow-hidden flex flex-col">
                                    <span className="text-xs font-black text-slate-700 uppercase">
                                        Detected Items ({bulkPreviewItems.length})
                                    </span>
                                    <div className="border border-slate-200 rounded-xl overflow-y-auto flex-1 max-h-[220px]">
                                        <table className="w-full text-xs text-left">
                                            <thead className="bg-slate-100 font-bold text-slate-700">
                                                <tr>
                                                    <th className="py-2 px-3">Item Name</th>
                                                    <th className="py-2 px-3">Category</th>
                                                    <th className="py-2 px-3">Brand</th>
                                                    <th className="py-2 px-3">Unit</th>
                                                    <th className="py-2 px-3 text-right">Base Price (₹)</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-slate-100">
                                                {bulkPreviewItems.map((item, idx) => (
                                                    <tr key={idx} className="hover:bg-slate-50">
                                                        <td className="py-1.5 px-3 font-bold text-slate-800">{item.name}</td>
                                                        <td className="py-1.5 px-3 text-slate-600">{item.category}</td>
                                                        <td className="py-1.5 px-3 text-slate-500">{item.brand}</td>
                                                        <td className="py-1.5 px-3 text-slate-600">{item.unit}</td>
                                                        <td className="py-1.5 px-3 text-right font-bold text-emerald-700">₹{item.estimated_price}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            )}

                            <div className="flex justify-end gap-2 pt-2">
                                <button
                                    type="button"
                                    onClick={() => setShowBulkAddModal(false)}
                                    className="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-100"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={handleSaveBulkItems}
                                    disabled={isProcessingBulk || bulkPreviewItems.length === 0}
                                    className="px-5 py-2 rounded-xl text-xs font-black text-white bg-emerald-600 hover:bg-emerald-700 shadow-md shadow-emerald-600/20 disabled:opacity-50"
                                >
                                    {isProcessingBulk ? 'Saving Items...' : `Save ${bulkPreviewItems.length} Items to Catalog`}
                                </button>
                            </div>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>

            {/* Modal 3: Edit Site Price */}
            <AnimatePresence>
                {showPriceEditModal && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
                        <motion.div
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.95 }}
                            className="bg-white rounded-3xl shadow-2xl border border-slate-200 w-full max-w-md overflow-hidden p-6 space-y-4"
                        >
                            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                                <div>
                                    <h3 className="font-black text-slate-900 text-base">Set Site-Specific Price</h3>
                                    <p className="text-xs text-slate-500">{selectedPropertyName}</p>
                                </div>
                                <button onClick={() => setShowPriceEditModal(null)} className="p-1 text-slate-400 hover:text-slate-700">
                                    <X className="w-5 h-5" />
                                </button>
                            </div>

                            <div>
                                <span className="text-xs font-bold text-slate-400 block mb-1">Item Name</span>
                                <span className="text-sm font-bold text-slate-800 block p-2 bg-slate-50 rounded-xl border border-slate-200">
                                    {showPriceEditModal.name} ({showPriceEditModal.unit})
                                </span>
                            </div>

                            <div>
                                <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block mb-1">
                                    Price for {selectedPropertyName} (₹)
                                </label>
                                <input
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    value={editPriceValue}
                                    onChange={e => setEditPriceValue(e.target.value)}
                                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-base font-black text-emerald-700 focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
                                />
                            </div>

                            <div className="flex justify-end gap-2 pt-2">
                                <button
                                    type="button"
                                    onClick={() => setShowPriceEditModal(null)}
                                    className="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-100"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={handleSavePrice}
                                    disabled={isSavingPrice}
                                    className="px-5 py-2 rounded-xl text-xs font-black text-white bg-emerald-600 hover:bg-emerald-700 shadow-xs"
                                >
                                    {isSavingPrice ? 'Saving...' : 'Save Site Price'}
                                </button>
                            </div>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>
        </div>
    );
}
