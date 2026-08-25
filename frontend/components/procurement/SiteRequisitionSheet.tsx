import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { createClient } from '@/frontend/utils/supabase/client';
import {
    FileSpreadsheet, Download, Save, Send, Plus, Trash2,
    CheckCircle2, AlertCircle, RefreshCw, Layers, Calendar,
    Building2, User, Phone, Sparkles, Loader2, ArrowRight,
    MapPin, IndianRupee, ShieldAlert, Coffee, X
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

export interface RequisitionRow {
    id: string;
    category: 'HK' | 'Beverages' | 'Technical' | 'General';
    name: string;
    brand: string;
    details: string; // color, size
    requested_qty: number;
    available_stock_qty: number;
    unit: string;
    unit_price: number;
    is_site_specific?: boolean;
    remarks?: string;
}

interface SiteRequisitionSheetProps {
    user: any;
    organizationId: string;
    properties: Array<{ id: string; name: string; location?: string }>;
    initialPropertyId?: string;
    onSubmitted?: (newReq: any) => void;
    onCancel?: () => void;
}

const MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
];

const STANDARD_FLOOR_TAGS = [
    'All Floors',
    'Ground Floor',
    '2nd Floor',
    '7th Floor',
    '1st Floor',
    '3rd Floor',
    '4th Floor',
    '5th Floor',
    '6th Floor',
    '8th Floor',
    'Basement',
    'Cafeteria'
];

// Pre-populated default standard items matching the user's template photos
const DEFAULT_HK_ITEMS: Omit<RequisitionRow, 'id'>[] = [
    { category: 'HK', name: 'Toilet Roll', brand: 'NA', details: 'White', requested_qty: 60, available_stock_qty: 60, unit: 'pcs', unit_price: 45 },
    { category: 'HK', name: 'M fold', brand: 'NA', details: 'White', requested_qty: 120, available_stock_qty: 80, unit: 'pcs', unit_price: 35 },
    { category: 'HK', name: 'Tissue paper', brand: 'NA', details: 'White', requested_qty: 55, available_stock_qty: 20, unit: 'pcs', unit_price: 25 },
    { category: 'HK', name: 'Disposel', brand: 'NA', details: 'White', requested_qty: 25, available_stock_qty: 10, unit: 'pkt', unit_price: 60 },
    { category: 'HK', name: 'garbage Big 32x42', brand: 'NA', details: 'Black', requested_qty: 5, available_stock_qty: 0, unit: 'KG', unit_price: 110 },
    { category: 'HK', name: 'garbage 19x21', brand: 'NA', details: 'Black', requested_qty: 7, available_stock_qty: 5, unit: 'Roll', unit_price: 75 },
    { category: 'HK', name: 'Room Freshner', brand: 'NA', details: 'NA', requested_qty: 5, available_stock_qty: 3, unit: 'pcs', unit_price: 130 },
    { category: 'HK', name: 'Odonil Zipper', brand: 'Odonil', details: 'NA', requested_qty: 4, available_stock_qty: 6, unit: 'pcs', unit_price: 55 },
    { category: 'HK', name: 'Prill Liquid', brand: 'Prill', details: 'Yellow', requested_qty: 3, available_stock_qty: 0, unit: 'pcs', unit_price: 145 },
    { category: 'HK', name: 'Black Hit', brand: 'Hit', details: 'Black', requested_qty: 3, available_stock_qty: 0, unit: 'pcs', unit_price: 180 },
    { category: 'HK', name: 'Red hit', brand: 'Hit', details: 'Red', requested_qty: 1, available_stock_qty: 0, unit: 'pcs', unit_price: 190 },
    { category: 'HK', name: 'Harpic', brand: 'Harpic', details: 'Blue', requested_qty: 1, available_stock_qty: 0, unit: 'can', unit_price: 195 },
    { category: 'HK', name: 'Surf Excel', brand: 'Surf Excel', details: 'NA', requested_qty: 1, available_stock_qty: 1, unit: 'Kg', unit_price: 140 },
    { category: 'HK', name: 'plastic Water bottle', brand: 'NA', details: '250ml', requested_qty: 6, available_stock_qty: 0, unit: 'pcs', unit_price: 10 },
    { category: 'HK', name: 'Microfiber Duster', brand: 'NA', details: 'Yellow', requested_qty: 2, available_stock_qty: 0, unit: 'pcs', unit_price: 65 },
    { category: 'HK', name: 'Hand Glubus', brand: 'NA', details: 'Pair', requested_qty: 2, available_stock_qty: 0, unit: 'pair', unit_price: 40 },
    { category: 'HK', name: 'Scoth Brite', brand: 'Scotch Brite', details: 'Green', requested_qty: 5, available_stock_qty: 1, unit: 'pkt', unit_price: 30 },
    { category: 'HK', name: 'Urinal Cube', brand: 'NA', details: 'White', requested_qty: 4, available_stock_qty: 0, unit: 'pkt', unit_price: 50 },
    { category: 'HK', name: 'Urinal Ped Screen', brand: 'NA', details: 'Yellow', requested_qty: 2, available_stock_qty: 34, unit: 'pcs', unit_price: 120 },
    { category: 'HK', name: 'Wiper Big', brand: 'NA', details: 'Big', requested_qty: 1, available_stock_qty: 5, unit: 'pcs', unit_price: 240 },
    { category: 'HK', name: 'Wiper Small', brand: 'NA', details: 'Small', requested_qty: 1, available_stock_qty: 3, unit: 'pcs', unit_price: 160 },
    { category: 'HK', name: 'Note Book', brand: 'NA', details: 'White', requested_qty: 2, available_stock_qty: 0, unit: 'pcs', unit_price: 70 },
    { category: 'HK', name: 'cello tape 1inch', brand: 'Cello', details: 'white', requested_qty: 2, available_stock_qty: 0, unit: 'pcs', unit_price: 35 },
];

const DEFAULT_BEVERAGE_ITEMS: Omit<RequisitionRow, 'id'>[] = [
    { category: 'Beverages', name: 'CCD coffe Beans', brand: 'CCD', details: 'Beans', requested_qty: 5, available_stock_qty: 3, unit: 'KG', unit_price: 850 },
    { category: 'Beverages', name: 'CCD tetra Milk', brand: 'CCD', details: 'Litr', requested_qty: 24, available_stock_qty: 84, unit: 'Ltr', unit_price: 75 },
    { category: 'Beverages', name: 'Sugar', brand: 'NA', details: 'KG', requested_qty: 5, available_stock_qty: 5, unit: 'KG', unit_price: 45 },
    { category: 'Beverages', name: 'Disposel', brand: 'NA', details: 'PKT', requested_qty: 10, available_stock_qty: 1, unit: 'PKT', unit_price: 60 },
    { category: 'Beverages', name: 'CCD Assam Tea', brand: 'CCD', details: 'PKT', requested_qty: 2, available_stock_qty: 1, unit: 'PKT', unit_price: 350 },
];

export default function SiteRequisitionSheet({
    user,
    organizationId,
    properties,
    initialPropertyId,
    onSubmitted,
    onCancel
}: SiteRequisitionSheetProps) {
    const supabase = useMemo(() => createClient(), []);
    const [selectedPropertyId, setSelectedPropertyId] = useState<string>(
        initialPropertyId || (properties[0]?.id ?? '')
    );
    const [fetchedPropertyName, setFetchedPropertyName] = useState<string>('');
    const [floorTag, setFloorTag] = useState<string>('All Floors');
    const [requisitionMonth, setRequisitionMonth] = useState<number>(new Date().getMonth() + 1);
    const [requisitionYear, setRequisitionYear] = useState<number>(new Date().getFullYear());
    const [siteNotes, setSiteNotes] = useState<string>('');
    const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
    const [activeTab, setActiveTab] = useState<'all' | 'HK' | 'Beverages' | 'Technical'>('all');
    const [catalogItems, setCatalogItems] = useState<any[]>([]);

    // Monthly Requisition Budget State
    const [allocatedBudget, setAllocatedBudget] = useState<{
        hk_budget: number;
        beverage_budget: number;
        total_budget: number;
        site_name?: string;
        floor_tag?: string;
    } | null>(null);
    const [isLoadingBudget, setIsLoadingBudget] = useState<boolean>(false);
    const [showOverBudgetModal, setShowOverBudgetModal] = useState<boolean>(false);

    // Initialize rows
    const [items, setItems] = useState<RequisitionRow[]>([]);

    // Automatically sync selectedPropertyId when initialPropertyId or properties prop updates
    useEffect(() => {
        if (initialPropertyId && initialPropertyId !== selectedPropertyId) {
            setSelectedPropertyId(initialPropertyId);
        } else if (!selectedPropertyId && properties.length > 0) {
            setSelectedPropertyId(properties[0].id);
        }
    }, [initialPropertyId, properties]);

    // Ensure property name is resolved from properties prop or directly from DB
    useEffect(() => {
        const pid = selectedPropertyId || initialPropertyId;
        if (pid) {
            const found = properties.find(p => p.id === pid);
            if (found?.name) {
                setFetchedPropertyName(found.name);
            } else {
                supabase
                    .from('properties')
                    .select('id, name')
                    .eq('id', pid)
                    .maybeSingle()
                    .then(({ data }) => {
                        if (data?.name) setFetchedPropertyName(data.name);
                    });
            }
        }
    }, [selectedPropertyId, initialPropertyId, properties, supabase]);

    const selectedProperty = useMemo(() => {
        return properties.find(p => p.id === selectedPropertyId) || properties[0];
    }, [properties, selectedPropertyId]);

    // Helper to normalize strings for robust item matching between catalog and stock items
    const normalizeItemKey = (str: string): string => {
        return (str || '')
            .toLowerCase()
            .replace(/[\-_,\.\(\)\[\]\/\|"']/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    };

    // Helper to clean UOM values
    const cleanUom = (val: any): string => {
        const s = String(val || '').trim();
        if (!s || /^\d+$/.test(s)) return 'Piece';
        return s;
    };

    // Fetch active budget for selected property and floor tag
    useEffect(() => {
        const fetchBudget = async () => {
            if (!organizationId || !selectedPropertyId) return;
            setIsLoadingBudget(true);
            try {
                const res = await fetch(`/api/procurement/requisitions/budgets?organization_id=${organizationId}&property_id=${selectedPropertyId}`);
                const data = await res.json();
                const budgetsList: any[] = data.budgets || [];

                if (budgetsList.length > 0) {
                    const floorMatch = budgetsList.find((b: any) => b.floor_tag?.toLowerCase() === floorTag?.toLowerCase() && b.is_active !== false);
                    const allFloorsMatch = budgetsList.find((b: any) => b.floor_tag?.toLowerCase() === 'all floors' && b.is_active !== false);
                    const matched = floorMatch || allFloorsMatch || budgetsList[0];

                    if (matched) {
                        setAllocatedBudget({
                            hk_budget: Number(matched.hk_budget) || 0,
                            beverage_budget: Number(matched.beverage_budget) || 0,
                            total_budget: Number(matched.total_budget) || ((Number(matched.hk_budget) || 0) + (Number(matched.beverage_budget) || 0)),
                            site_name: matched.site_name,
                            floor_tag: matched.floor_tag
                        });
                    } else {
                        setAllocatedBudget(null);
                    }
                } else {
                    setAllocatedBudget(null);
                }
            } catch (err) {
                console.warn('Failed to load property budget:', err);
                setAllocatedBudget(null);
            } finally {
                setIsLoadingBudget(false);
            }
        };

        fetchBudget();
    }, [organizationId, selectedPropertyId, floorTag]);

    // Fetch site-specific item pricing and on-site stock counts whenever property changes
    useEffect(() => {
        const fetchSiteData = async () => {
            if (!organizationId || !selectedPropertyId) return;
            try {
                // 1. Fetch site prices & catalog
                const res = await fetch(`/api/procurement/pricing?organization_id=${organizationId}&property_id=${selectedPropertyId}`);
                const data = await res.json();
                const siteCatalogList = data.items || [];
                setCatalogItems(siteCatalogList);

                const priceLookup = new Map<string, any>();
                siteCatalogList.forEach((item: any) => {
                    priceLookup.set(normalizeItemKey(item.name), item);
                });

                // 2. Fetch live physical on-site stock items for this property
                let propertyStockItems: any[] = [];
                const stockByIdLookup = new Map<string, number>();
                const stockByNameLookup = new Map<string, number>();

                try {
                    const stockRes = await fetch(`/api/properties/${selectedPropertyId}/stock/items`);
                    const stockData = await stockRes.json();
                    if (stockData?.items && Array.isArray(stockData.items)) {
                        propertyStockItems = stockData.items;
                        propertyStockItems.forEach((si: any) => {
                            if (si.catalog_item_id) {
                                stockByIdLookup.set(si.catalog_item_id, Number(si.quantity) || 0);
                            }
                            const norm = normalizeItemKey(si.name);
                            if (norm) stockByNameLookup.set(norm, Number(si.quantity) || 0);
                        });
                    }
                } catch (stockErr) {
                    console.warn('Failed to load physical stock items for property:', stockErr);
                }

                const populatedRows: RequisitionRow[] = [];
                const seenKeys = new Set<string>();

                if (propertyStockItems.length > 0) {
                    propertyStockItems.forEach((si: any, idx: number) => {
                        const norm = normalizeItemKey(si.name);
                        seenKeys.add(norm);
                        const matchedPrice = (si.catalog_item_id && siteCatalogList.find((c: any) => c.id === si.catalog_item_id)) 
                            || priceLookup.get(norm);

                        populatedRows.push({
                            id: `stock-${si.id || idx + 1}`,
                            category: si.category || matchedPrice?.category || 'HK',
                            name: si.name,
                            brand: matchedPrice?.brand || 'NA',
                            details: matchedPrice?.color_size_details || '',
                            requested_qty: 0,
                            available_stock_qty: Number(si.quantity) || 0,
                            unit: cleanUom(si.unit || matchedPrice?.unit),
                            unit_price: matchedPrice?.unit_price || si.unit_price || 0,
                            is_site_specific: !!matchedPrice?.is_site_specific
                        });
                    });
                }

                siteCatalogList.forEach((catItem: any, idx: number) => {
                    const norm = normalizeItemKey(catItem.name);
                    if (!seenKeys.has(norm)) {
                        seenKeys.add(norm);
                        const availStock = stockByIdLookup.get(catItem.id) ?? stockByNameLookup.get(norm) ?? 0;
                        populatedRows.push({
                            id: `cat-${catItem.id || idx + 1}`,
                            category: catItem.category || 'HK',
                            name: catItem.name,
                            brand: catItem.brand || 'NA',
                            details: catItem.color_size_details || '',
                            requested_qty: 0,
                            available_stock_qty: availStock,
                            unit: cleanUom(catItem.unit),
                            unit_price: catItem.unit_price || catItem.estimated_price || 0,
                            is_site_specific: !!catItem.is_site_specific
                        });
                    }
                });

                if (populatedRows.length > 0) {
                    setItems(populatedRows);
                }
            } catch (err) {
                console.error('Failed to load site pricing:', err);
            }
        };
        fetchSiteData();
    }, [organizationId, selectedPropertyId]);

    const grandTotalEstimated = useMemo(() => {
        return items.reduce((acc, row) => acc + ((Number(row.requested_qty) || 0) * (Number(row.unit_price) || 0)), 0);
    }, [items]);

    const hkTotalEstimated = useMemo(() => {
        return items.reduce((acc, row) => {
            const cat = (row.category || '').toLowerCase();
            if (cat.includes('hk') || cat.includes('housekeeping') || cat.includes('tissue') || cat.includes('stationery') || cat.includes('paper') || !cat) {
                return acc + ((Number(row.requested_qty) || 0) * (Number(row.unit_price) || 0));
            }
            return acc;
        }, 0);
    }, [items]);

    const beverageTotalEstimated = useMemo(() => {
        return items.reduce((acc, row) => {
            const cat = (row.category || '').toLowerCase();
            if (cat.includes('bev') || cat.includes('pantry') || cat.includes('tea') || cat.includes('coffee') || cat.includes('ccd')) {
                return acc + ((Number(row.requested_qty) || 0) * (Number(row.unit_price) || 0));
            }
            return acc;
        }, 0);
    }, [items]);

    const isOverBudget = useMemo(() => {
        if (!allocatedBudget || allocatedBudget.total_budget <= 0) return false;
        return grandTotalEstimated > allocatedBudget.total_budget;
    }, [allocatedBudget, grandTotalEstimated]);

    const excessBudgetAmount = useMemo(() => {
        if (!allocatedBudget || allocatedBudget.total_budget <= 0) return 0;
        return Math.max(0, grandTotalEstimated - allocatedBudget.total_budget);
    }, [allocatedBudget, grandTotalEstimated]);

    const budgetUtilizationPercent = useMemo(() => {
        if (!allocatedBudget || allocatedBudget.total_budget <= 0) return 0;
        return Math.min(200, Math.round((grandTotalEstimated / allocatedBudget.total_budget) * 100));
    }, [allocatedBudget, grandTotalEstimated]);

    const totalRequestedUnits = useMemo(() => {
        return items.reduce((acc, row) => acc + (Number(row.requested_qty) || 0), 0);
    }, [items]);

    const handleRowChange = (id: string, field: keyof RequisitionRow, value: any) => {
        setItems(prev => prev.map(row => {
            if (row.id === id) {
                return { ...row, [field]: value };
            }
            return row;
        }));
    };

    const handleAddRow = (category: 'HK' | 'Beverages' | 'Technical' | 'General' = 'HK') => {
        const newRow: RequisitionRow = {
            id: `row-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
            category,
            name: '',
            brand: 'NA',
            details: '',
            requested_qty: 0,
            available_stock_qty: 0,
            unit: 'Piece',
            unit_price: 0
        };
        setItems(prev => [...prev, newRow]);
    };

    const handleDeleteRow = (id: string) => {
        setItems(prev => prev.filter(row => row.id !== id));
    };

    const filteredItems = useMemo(() => {
        if (activeTab === 'all') return items;
        if (activeTab === 'HK') {
            return items.filter(i => {
                const cat = (i.category || '').toLowerCase();
                return cat.includes('hk') || cat.includes('housekeeping') || cat.includes('stationery') || cat.includes('paper') || !cat;
            });
        }
        if (activeTab === 'Beverages') {
            return items.filter(i => {
                const cat = (i.category || '').toLowerCase();
                return cat.includes('bev') || cat.includes('pantry') || cat.includes('tea') || cat.includes('coffee') || cat.includes('ccd');
            });
        }
        if (activeTab === 'Technical') {
            return items.filter(i => {
                const cat = (i.category || '').toLowerCase();
                return cat.includes('tech') || cat.includes('spare') || cat.includes('maint') || cat.includes('elect') || cat.includes('plumb');
            });
        }
        return items;
    }, [items, activeTab]);

    const handleDownloadExcelPreview = async () => {
        try {
            const res = await fetch('/api/procurement/requisitions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    organization_id: organizationId,
                    property_id: selectedPropertyId,
                    floor_tag: floorTag,
                    requisition_month: requisitionMonth,
                    requisition_year: requisitionYear,
                    user_id: user?.id,
                    site_notes: siteNotes,
                    items
                })
            });
            const data = await res.json();
            if (data.requisition?.file_url) {
                window.open(data.requisition.file_url, '_blank');
            } else {
                alert('Could not generate Excel download link.');
            }
        } catch (e) {
            console.error('Download error:', e);
            alert('Failed to generate Excel download.');
        }
    };

    const handleSubmitRequisition = async (bypassBudgetCheck: boolean = false) => {
        if (!selectedPropertyId) {
            alert('Please select a Center / Property.');
            return;
        }

        const requestedCount = items.filter(i => (i.requested_qty || 0) > 0).length;
        if (requestedCount === 0) {
            if (!confirm('You have not entered requested quantities (> 0) for any items. Do you still want to submit the complete sheet?')) {
                return;
            }
        }

        // If over budget and not explicitly confirmed yet, prompt the user with the non-blocking warning modal
        if (isOverBudget && !bypassBudgetCheck) {
            setShowOverBudgetModal(true);
            return;
        }

        // Clean items list ensuring valid item objects
        const submitItems = items.filter(i => i.name && i.name.trim().length > 0);

        setIsSubmitting(true);
        setShowOverBudgetModal(false);
        try {
            const res = await fetch('/api/procurement/requisitions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    organization_id: organizationId,
                    property_id: selectedPropertyId,
                    floor_tag: floorTag,
                    requisition_month: requisitionMonth,
                    requisition_year: requisitionYear,
                    user_id: user?.id,
                    site_notes: siteNotes,
                    items: submitItems
                })
            });

            const data = await res.json();
            if (!res.ok || data.error) {
                throw new Error(data.error || 'Failed to submit requisition');
            }

            if (isOverBudget) {
                alert(`⚠️ Requisition for ${selectedProperty?.name || 'Property'} (${floorTag}) submitted with Over-Budget Flag (+₹${excessBudgetAmount.toLocaleString('en-IN')}). Procurement & Approvers have been notified.`);
            } else {
                alert(`✅ Requisition for ${selectedProperty?.name || 'Property'} (${floorTag}) submitted successfully! Procurement team has been notified.`);
            }

            if (onSubmitted) {
                onSubmitted(data.requisition);
            }
        } catch (err: any) {
            console.error('Submission failed:', err);
            alert(`Error: ${err.message}`);
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="bg-slate-50 min-h-screen pb-20">
            <div className="bg-white border-b border-slate-200 sticky top-0 z-30 shadow-xs">
                <div className="max-w-7xl mx-auto px-4 py-3 flex flex-wrap items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-600">
                            <FileSpreadsheet className="w-6 h-6" />
                        </div>
                        <div>
                            <h1 className="text-lg font-black text-slate-800">Monthly Material Requisition Sheet</h1>
                            <p className="text-xs text-slate-500 font-medium">Standard Dual-Table Site Requisition vs. Current Stock (Site-Specific Pricing)</p>
                        </div>
                    </div>

                    <div className="flex items-center gap-2">
                        {onCancel && (
                            <button
                                onClick={onCancel}
                                className="h-9 px-4 inline-flex items-center justify-center rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-100 transition-all cursor-pointer"
                            >
                                Close
                            </button>
                        )}
                        <button
                            onClick={handleDownloadExcelPreview}
                            className="h-9 px-3.5 inline-flex items-center gap-1.5 rounded-xl text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 transition-all cursor-pointer"
                            title="Download formatted Excel workbook (.xlsx)"
                        >
                            <Download className="w-3.5 h-3.5 text-slate-600" />
                            <span>Download .xlsx</span>
                        </button>
                        <button
                            onClick={() => handleSubmitRequisition(false)}
                            disabled={isSubmitting}
                            className="h-9 px-4.5 inline-flex items-center gap-1.5 rounded-xl text-xs font-black text-white bg-emerald-600 hover:bg-emerald-700 shadow-md shadow-emerald-600/20 transition-all disabled:opacity-50 cursor-pointer"
                        >
                            {isSubmitting ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                                <Send className="w-3.5 h-3.5" />
                            )}
                            <span>Submit to Procurement</span>
                        </button>
                    </div>
                </div>
            </div>

            <div className="max-w-7xl mx-auto px-4 py-6 space-y-6">
                <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-4">
                    <div>
                        <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block mb-1">Center / Property</label>
                        {properties.length <= 1 ? (
                            <div className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold text-slate-800 flex items-center gap-2">
                                <Building2 className="w-4 h-4 text-emerald-600 shrink-0" />
                                <span className="truncate">{fetchedPropertyName || selectedProperty?.name || properties[0]?.name || 'Loading Property...'}</span>
                            </div>
                        ) : (
                            <select
                                value={selectedPropertyId}
                                onChange={e => setSelectedPropertyId(e.target.value)}
                                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
                            >
                                {properties.map(p => (
                                    <option key={p.id} value={p.id}>{p.name}</option>
                                ))}
                            </select>
                        )}
                    </div>

                    <div>
                        <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block mb-1">
                            Floor / Section <span className="text-emerald-600 font-normal">(Multi-Floor)</span>
                        </label>
                        <select
                            value={floorTag}
                            onChange={e => setFloorTag(e.target.value)}
                            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold text-emerald-800 focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
                        >
                            {STANDARD_FLOOR_TAGS.map(f => (
                                <option key={f} value={f}>{f}</option>
                            ))}
                        </select>
                    </div>

                    <div>
                        <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block mb-1">Requisition Period</label>
                        <div className="flex items-center gap-2">
                            <select
                                value={requisitionMonth}
                                onChange={e => setRequisitionMonth(parseInt(e.target.value))}
                                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
                            >
                                {MONTH_NAMES.map((m, idx) => (
                                    <option key={idx + 1} value={idx + 1}>{m}</option>
                                ))}
                            </select>
                            <span className="text-xs font-black text-slate-500 px-2 py-2 bg-slate-100 rounded-xl border border-slate-200">
                                {requisitionYear}
                            </span>
                        </div>
                    </div>

                    <div>
                        <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block mb-1">Signed By / Role</label>
                        <div className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm font-medium text-slate-700 flex items-center gap-2">
                            <User className="w-4 h-4 text-slate-400" />
                            <span className="truncate">{user?.user_metadata?.full_name || user?.email || 'Site Admin'}</span>
                        </div>
                    </div>

                    <div>
                        <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block mb-1">Date</label>
                        <div className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm font-medium text-slate-700 flex items-center gap-2">
                            <Calendar className="w-4 h-4 text-slate-400" />
                            <span>{new Date().toLocaleDateString('en-GB')}</span>
                        </div>
                    </div>
                </div>

                <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs">
                    <div className="flex items-center gap-2 mb-2">
                        <Sparkles className="w-4 h-4 text-amber-500" />
                        <span className="text-xs font-black text-slate-700 uppercase tracking-wider">Standard Template Color Code Guide</span>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                        <div className="flex items-center gap-2 p-2 rounded-xl bg-[#00a2ed]/10 border border-[#00a2ed]/30">
                            <span className="w-4 h-4 rounded-md bg-[#00a2ed] shadow-xs flex-shrink-0" />
                            <div>
                                <span className="font-bold text-slate-900 block">Product</span>
                                <span className="text-slate-600 text-[11px]">Item Name / Description</span>
                            </div>
                        </div>
                        <div className="flex items-center gap-2 p-2 rounded-xl bg-[#48c774]/10 border border-[#48c774]/30">
                            <span className="w-4 h-4 rounded-md bg-[#48c774] shadow-xs flex-shrink-0" />
                            <div>
                                <span className="font-bold text-slate-900 block">Brand</span>
                                <span className="text-slate-600 text-[11px]">JK, Doms, Harpic, Prill, CCD</span>
                            </div>
                        </div>
                        <div className="flex items-center gap-2 p-2 rounded-xl bg-[#ffeb3b]/20 border border-[#ffeb3b]/50">
                            <span className="w-4 h-4 rounded-md bg-[#ffeb3b] shadow-xs flex-shrink-0 border border-amber-300" />
                            <div>
                                <span className="font-bold text-slate-900 block">Details</span>
                                <span className="text-slate-600 text-[11px]">Color, Size (White, 32x42)</span>
                            </div>
                        </div>
                        <div className="flex items-center gap-2 p-2 rounded-xl bg-[#ffccbc]/20 border border-[#ffccbc]/50">
                            <span className="w-4 h-4 rounded-md bg-[#ffccbc] shadow-xs flex-shrink-0 border border-orange-300" />
                            <div>
                                <span className="font-bold text-slate-900 block">UOM</span>
                                <span className="text-slate-600 text-[11px]">pcs, pkt, kg, ltr, can, roll</span>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Monthly Requisition Budget Live Tracker Card */}
                {allocatedBudget && allocatedBudget.total_budget > 0 && (
                    <div className={`rounded-2xl border p-4 shadow-xs transition-all ${
                        isOverBudget 
                            ? 'bg-rose-50/80 border-rose-200 dark:bg-rose-950/30 dark:border-rose-800' 
                            : budgetUtilizationPercent > 85 
                            ? 'bg-amber-50/80 border-amber-200 dark:bg-amber-950/30 dark:border-amber-800'
                            : 'bg-emerald-50/80 border-emerald-200 dark:bg-emerald-950/30 dark:border-emerald-800'
                    }`}>
                        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                            <div className="flex items-center gap-2.5">
                                <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${
                                    isOverBudget 
                                        ? 'bg-rose-500 text-white' 
                                        : 'bg-emerald-600 text-white'
                                }`}>
                                    {isOverBudget ? <ShieldAlert className="w-5 h-5" /> : <IndianRupee className="w-5 h-5" />}
                                </div>
                                <div>
                                    <div className="flex items-center gap-2">
                                        <h3 className="text-sm font-black text-slate-900 dark:text-white">
                                            Monthly Requisition Budget: {allocatedBudget.site_name || selectedProperty?.name}
                                        </h3>
                                        <span className="text-xs font-bold text-slate-500">
                                            ({allocatedBudget.floor_tag || floorTag})
                                        </span>
                                    </div>
                                    <p className="text-xs text-slate-500">
                                        Allocated Monthly Limit: <b>₹{allocatedBudget.total_budget.toLocaleString('en-IN')}</b>
                                        {allocatedBudget.hk_budget > 0 && ` (HK: ₹${allocatedBudget.hk_budget.toLocaleString('en-IN')})`}
                                        {allocatedBudget.beverage_budget > 0 && ` (Beverage: ₹${allocatedBudget.beverage_budget.toLocaleString('en-IN')})`}
                                    </p>
                                </div>
                            </div>

                            <div className="flex items-center gap-2">
                                {isOverBudget ? (
                                    <div className="px-3 py-1.5 rounded-xl bg-rose-500 text-white text-xs font-black flex items-center gap-1.5 shadow-sm animate-pulse">
                                        <AlertCircle className="w-4 h-4" />
                                        <span>OVER BUDGET BY ₹{excessBudgetAmount.toLocaleString('en-IN')} ({budgetUtilizationPercent}%)</span>
                                    </div>
                                ) : (
                                    <div className="px-3 py-1.5 rounded-xl bg-emerald-600 text-white text-xs font-black flex items-center gap-1.5 shadow-sm">
                                        <CheckCircle2 className="w-4 h-4" />
                                        <span>Within Budget ({budgetUtilizationPercent}% Used)</span>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Progress Bar */}
                        <div className="w-full bg-slate-200 dark:bg-slate-700 h-2.5 rounded-full overflow-hidden mb-2.5">
                            <div
                                className={`h-full transition-all duration-300 rounded-full ${
                                    isOverBudget 
                                        ? 'bg-rose-500' 
                                        : budgetUtilizationPercent > 85 
                                        ? 'bg-amber-500' 
                                        : 'bg-emerald-500'
                                }`}
                                style={{ width: `${Math.min(100, budgetUtilizationPercent)}%` }}
                            />
                        </div>

                        <div className="flex flex-wrap items-center justify-between text-xs text-slate-600 dark:text-slate-300 font-medium">
                            <div className="flex items-center gap-4">
                                <span>HK Cost: <b>₹{hkTotalEstimated.toLocaleString('en-IN')}</b> {allocatedBudget.hk_budget > 0 ? `/ ₹${allocatedBudget.hk_budget.toLocaleString('en-IN')}` : ''}</span>
                                <span>Beverage Cost: <b>₹{beverageTotalEstimated.toLocaleString('en-IN')}</b> {allocatedBudget.beverage_budget > 0 ? `/ ₹${allocatedBudget.beverage_budget.toLocaleString('en-IN')}` : ''}</span>
                            </div>
                            <div className="font-bold">
                                Current Requisition Total: <span className={isOverBudget ? 'text-rose-600 dark:text-rose-400 font-black' : 'text-emerald-700 dark:text-emerald-400 font-black'}>₹{grandTotalEstimated.toLocaleString('en-IN')}</span>
                            </div>
                        </div>

                        {isOverBudget && (
                            <div className="mt-3 p-2.5 rounded-xl bg-rose-100/80 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-900 text-xs text-rose-900 dark:text-rose-200 font-semibold flex items-center gap-2">
                                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                                <span>
                                    Note: You can still submit this requisition. It will be flagged for review by the procurement & approver teams.
                                </span>
                            </div>
                        )}
                    </div>
                )}

                <div className="flex flex-wrap items-center justify-between gap-4">
                    <div className="flex items-center gap-1 bg-white p-1 rounded-2xl border border-slate-200 shadow-xs">
                        {[
                            { id: 'all', label: 'All Items' },
                            { id: 'HK', label: 'HK / Stationery / Paper' },
                            { id: 'Beverages', label: 'Beverages / CCD' },
                            { id: 'Technical', label: 'Spares / Maintenance' }
                        ].map(tab => (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id as any)}
                                className={`px-4 py-2 rounded-xl text-xs font-black transition-all cursor-pointer ${
                                    activeTab === tab.id
                                        ? 'bg-slate-900 text-white shadow-xs'
                                        : 'text-slate-600 hover:bg-slate-100'
                                }`}
                            >
                                {tab.label}
                            </button>
                        ))}
                    </div>

                    <div className="flex items-center gap-4 bg-white px-5 py-2 rounded-2xl border border-slate-200 shadow-xs text-sm">
                        <div>
                            <span className="text-slate-400 text-xs block font-bold">Total Items</span>
                            <span className="font-black text-slate-800">{items.length} items ({totalRequestedUnits} units)</span>
                        </div>
                        <div className="h-6 w-px bg-slate-200" />
                        <div>
                            <span className="text-slate-400 text-xs block font-bold">Est. Total Amount ({selectedProperty?.name})</span>
                            <span className={`font-black ${isOverBudget ? 'text-rose-600' : 'text-emerald-600'}`}>
                                ₹{grandTotalEstimated.toLocaleString('en-IN')}
                            </span>
                        </div>
                    </div>
                </div>

                <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
                    <div className="overflow-x-auto max-h-[600px]">
                        <table className="w-full text-xs border-collapse">
                            <thead>
                                <tr className="bg-slate-100 text-slate-700 font-bold uppercase text-[11px] border-b border-slate-200">
                                    <th colSpan={8} className="py-2.5 px-4 text-center border-r-2 border-slate-300 bg-slate-200/80">
                                        📋 REQUISITION FORMAT ({selectedProperty?.name} • {floorTag})
                                    </th>
                                    <th colSpan={6} className="py-2.5 px-4 text-center bg-slate-200/80">
                                        📦 LIST OF AVAILABLE STOCK AT {floorTag.toUpperCase()}
                                    </th>
                                </tr>
                                <tr className="text-slate-900 font-black text-center select-none">
                                    <th className="py-2 px-2 bg-slate-200 border border-slate-300 w-10">#</th>
                                    <th className="py-2 px-3 bg-[#00a2ed] text-white border border-[#00a2ed] min-w-[170px]">Product Name/Type</th>
                                    <th className="py-2 px-3 bg-[#48c774] text-slate-950 border border-[#48c774] min-w-[130px]">Specific Brand if any</th>
                                    <th className="py-2 px-3 bg-[#ffeb3b] text-slate-950 border border-[#ffeb3b] min-w-[110px]">Color, Size</th>
                                    <th className="py-2 px-1 bg-slate-100 border border-slate-300 min-w-[80px] w-20 text-slate-900">Qty</th>
                                    <th className="py-2 px-2 bg-[#ffccbc] text-slate-950 border border-[#ffccbc] min-w-[55px] w-14">UOM</th>
                                    <th className="py-2 px-2 bg-emerald-50 text-emerald-950 border border-slate-300 min-w-[80px] w-24">Site Price (₹)</th>
                                    <th className="py-2 px-2 bg-slate-100 border-r-2 border-slate-300 w-10 text-slate-500">Del</th>

                                    <th className="py-2 px-2 bg-slate-200 border border-slate-300 w-10">#</th>
                                    <th className="py-2 px-3 bg-[#00a2ed] text-white border border-[#00a2ed] min-w-[170px]">Product Name/Type</th>
                                    <th className="py-2 px-3 bg-[#48c774] text-slate-950 border border-[#48c774] min-w-[130px]">Specific Brand if any</th>
                                    <th className="py-2 px-3 bg-[#ffeb3b] text-slate-950 border border-[#ffeb3b] min-w-[110px]">Color, Size</th>
                                    <th className="py-2 px-1 bg-slate-100 border border-slate-300 min-w-[80px] w-20 text-slate-900">Avail. Qty</th>
                                    <th className="py-2 px-2 bg-[#ffccbc] text-slate-950 border border-[#ffccbc] min-w-[55px] w-14">UOM</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredItems.map((row, idx) => (
                                    <tr key={row.id} className="hover:bg-slate-50/80 transition-colors">
                                        <td className="py-1 px-2 text-center text-slate-500 font-semibold border border-slate-200 bg-slate-50">
                                            {idx + 1}
                                        </td>
                                        <td className="p-0 border border-slate-200 bg-[#00a2ed]/10">
                                            <input
                                                type="text"
                                                value={row.name}
                                                onChange={e => handleRowChange(row.id, 'name', e.target.value)}
                                                className="w-full px-2.5 py-1.5 bg-transparent font-bold text-slate-900 focus:outline-hidden focus:bg-white"
                                                placeholder="Item Name"
                                            />
                                        </td>
                                        <td className="p-0 border border-slate-200 bg-[#48c774]/10">
                                            <input
                                                type="text"
                                                value={row.brand}
                                                onChange={e => handleRowChange(row.id, 'brand', e.target.value)}
                                                className="w-full px-2.5 py-1.5 bg-transparent text-slate-800 focus:outline-hidden focus:bg-white"
                                                placeholder="Brand (NA)"
                                            />
                                        </td>
                                        <td className="p-0 border border-slate-200 bg-[#ffeb3b]/10">
                                            <input
                                                type="text"
                                                value={row.details}
                                                onChange={e => handleRowChange(row.id, 'details', e.target.value)}
                                                className="w-full px-2.5 py-1.5 bg-transparent text-slate-800 focus:outline-hidden focus:bg-white"
                                                placeholder="Color / Size"
                                            />
                                        </td>
                                        <td className="p-0 border border-slate-200">
                                            <input
                                                type="number"
                                                min="0"
                                                value={row.requested_qty === 0 ? '' : row.requested_qty}
                                                placeholder="0"
                                                onChange={e => {
                                                    const val = e.target.value === '' ? 0 : Math.max(0, parseInt(e.target.value, 10) || 0);
                                                    handleRowChange(row.id, 'requested_qty', val);
                                                }}
                                                className="w-full px-1.5 py-1.5 text-center font-black text-emerald-700 bg-emerald-50/30 focus:bg-white focus:outline-hidden [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none tabular-nums text-xs md:text-sm"
                                            />
                                        </td>
                                        <td className="p-0 border border-slate-200 bg-[#ffccbc]/15">
                                            <input
                                                type="text"
                                                value={cleanUom(row.unit)}
                                                onChange={e => handleRowChange(row.id, 'unit', e.target.value)}
                                                className="w-full px-1.5 py-1.5 text-center font-semibold text-slate-800 focus:outline-hidden focus:bg-white"
                                                placeholder="Piece"
                                            />
                                        </td>
                                        <td className="p-0 border border-slate-200 bg-emerald-50/50">
                                            <div className="flex items-center justify-center px-2 py-1.5 font-black text-emerald-800">
                                                ₹{row.unit_price || 0}
                                            </div>
                                        </td>
                                        <td className="py-1 px-1 text-center border-r-2 border-slate-300">
                                            <button
                                                onClick={() => handleDeleteRow(row.id)}
                                                className="p-1 text-slate-400 hover:text-red-500 transition-colors cursor-pointer"
                                                title="Delete row"
                                            >
                                                <Trash2 className="w-3.5 h-3.5" />
                                            </button>
                                        </td>

                                        <td className="py-1 px-2 text-center text-slate-500 font-semibold border border-slate-200 bg-slate-50">
                                            {idx + 1}
                                        </td>
                                        <td className="py-1.5 px-2.5 border border-slate-200 bg-[#00a2ed]/5 font-medium text-slate-800">
                                            {row.name || '-'}
                                        </td>
                                        <td className="py-1.5 px-2.5 border border-slate-200 bg-[#48c774]/5 text-slate-700">
                                            {row.brand || 'NA'}
                                        </td>
                                        <td className="py-1.5 px-2.5 border border-slate-200 bg-[#ffeb3b]/5 text-slate-700">
                                            {row.details || '-'}
                                        </td>
                                        <td className="p-0 border border-slate-200">
                                            <input
                                                type="number"
                                                min="0"
                                                value={row.available_stock_qty === 0 ? '' : row.available_stock_qty}
                                                placeholder="0"
                                                onChange={e => {
                                                    const val = e.target.value === '' ? 0 : Math.max(0, parseInt(e.target.value, 10) || 0);
                                                    handleRowChange(row.id, 'available_stock_qty', val);
                                                }}
                                                className="w-full px-1.5 py-1.5 text-center font-bold text-slate-800 bg-slate-50/50 focus:bg-white focus:outline-hidden [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none tabular-nums text-xs md:text-sm"
                                            />
                                        </td>
                                        <td className="py-1.5 px-2 text-center border border-slate-200 bg-[#ffccbc]/10 text-slate-700 font-semibold">
                                            {cleanUom(row.unit)}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    <div className="p-4 bg-slate-50 border-t border-slate-200 flex flex-wrap items-center justify-between gap-4">
                        <div className="flex items-center gap-2">
                            <button
                                onClick={() => handleAddRow(activeTab === 'all' ? 'HK' : activeTab)}
                                className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-white border border-slate-200 text-slate-700 font-bold text-xs hover:bg-slate-100 shadow-2xs transition-all cursor-pointer"
                            >
                                <Plus className="w-3.5 h-3.5 text-emerald-600" />
                                Add Line Item
                            </button>
                        </div>

                        <div className="text-xs text-slate-500">
                            💡 Unit prices are automatically loaded based on <b>{selectedProperty?.name}</b> rate contracts.
                        </div>
                    </div>
                </div>

                {/* 6. Site Notes / Justification Textbox */}
                <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs">
                    <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block mb-2">
                        Site Notes & Floor Remarks (Optional)
                    </label>
                    <textarea
                        value={siteNotes}
                        onChange={e => setSiteNotes(e.target.value)}
                        placeholder="Add any specific requirements or consumption reasons for Procurement..."
                        rows={2}
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
                    />
                </div>
            </div>

            {/* Over-Budget Submit Confirmation Modal (Non-Blocking) */}
            <AnimatePresence>
                {showOverBudgetModal && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs overflow-y-auto">
                        <motion.div
                            initial={{ opacity: 0, scale: 0.95, y: 15 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.95, y: 15 }}
                            className="bg-white dark:bg-slate-900 rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 w-full max-w-lg overflow-hidden flex flex-col"
                        >
                            <div className="bg-rose-600 text-white p-5 flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-2xl bg-white/20 flex items-center justify-center text-white">
                                        <ShieldAlert className="w-6 h-6" />
                                    </div>
                                    <div>
                                        <h3 className="text-base font-black">Monthly Budget Exceeded</h3>
                                        <p className="text-xs text-rose-100 font-medium">
                                            {selectedProperty?.name || 'Property'} • {floorTag}
                                        </p>
                                    </div>
                                </div>
                                <button
                                    onClick={() => setShowOverBudgetModal(false)}
                                    className="p-1.5 rounded-xl text-white/80 hover:text-white hover:bg-white/10 transition-colors"
                                >
                                    <X className="w-5 h-5" />
                                </button>
                            </div>

                            <div className="p-6 space-y-4">
                                <p className="text-xs text-slate-600 dark:text-slate-300">
                                    This monthly requisition exceeds the allocated budget limit configured by Org Super Admin.
                                </p>

                                <div className="bg-slate-50 dark:bg-slate-800/60 rounded-2xl p-4 border border-slate-200 dark:border-slate-700 space-y-2 text-xs">
                                    <div className="flex items-center justify-between">
                                        <span className="text-slate-500">Allocated Monthly Limit:</span>
                                        <span className="font-bold text-slate-800 dark:text-white">
                                            ₹{(allocatedBudget?.total_budget || 0).toLocaleString('en-IN')}
                                        </span>
                                    </div>
                                    <div className="flex items-center justify-between">
                                        <span className="text-slate-500">Current Requisition Total:</span>
                                        <span className="font-black text-rose-600 dark:text-rose-400">
                                            ₹{grandTotalEstimated.toLocaleString('en-IN')}
                                        </span>
                                    </div>
                                    <div className="pt-2 border-t border-slate-200 dark:border-slate-700 flex items-center justify-between font-bold">
                                        <span className="text-rose-700 dark:text-rose-300">Over-Budget Amount:</span>
                                        <span className="font-black text-rose-600 dark:text-rose-400 text-sm">
                                            +₹{excessBudgetAmount.toLocaleString('en-IN')} ({budgetUtilizationPercent}%)
                                        </span>
                                    </div>
                                </div>

                                <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50 text-[11px] text-amber-900 dark:text-amber-200 flex items-start gap-2">
                                    <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                                    <span>
                                        <b>You can still proceed and submit this requisition.</b> It will be automatically tagged with the <b>Over-Budget Flag</b> for procurement & management review.
                                    </span>
                                </div>
                            </div>

                            <div className="p-4 bg-slate-50 dark:bg-slate-800/40 border-t border-slate-200 dark:border-slate-800 flex items-center justify-end gap-3">
                                <button
                                    onClick={() => setShowOverBudgetModal(false)}
                                    className="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors"
                                >
                                    Adjust Quantities
                                </button>
                                <button
                                    onClick={() => handleSubmitRequisition(true)}
                                    disabled={isSubmitting}
                                    className="flex items-center gap-1.5 px-5 py-2 rounded-xl text-xs font-black text-white bg-rose-600 hover:bg-rose-700 shadow-md shadow-rose-600/20 transition-all disabled:opacity-50"
                                >
                                    {isSubmitting ? (
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                    ) : (
                                        <Send className="w-4 h-4" />
                                    )}
                                    <span>Submit With Over-Budget Flag</span>
                                </button>
                            </div>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>
        </div>
    );
}
