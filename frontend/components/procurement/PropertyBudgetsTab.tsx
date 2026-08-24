'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
    IndianRupee, Building2, Search, Plus, Upload, CheckCircle2,
    AlertCircle, RefreshCw, Loader2, Save, X, Layers,
    Coffee, Sparkles, Filter, ShieldCheck, Trash2, ArrowRight
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

export interface PropertyBudgetItem {
    id?: string;
    organization_id: string;
    property_id: string;
    property_name?: string;
    property_location?: string;
    floor_tag: string;
    site_name: string;
    hk_budget: number;
    beverage_budget: number;
    total_budget: number;
    is_active: boolean;
    is_new?: boolean;
    is_modified?: boolean;
}

interface PropertyBudgetsTabProps {
    user: any;
    organizationId: string;
    properties?: Array<{ id: string; name: string; location?: string; address?: string }>;
}

const COMMON_FLOORS = [
    'All Floors',
    'Ground Floor',
    '1st Floor',
    '2nd Floor',
    '3rd Floor',
    '4th Floor',
    '5th Floor',
    '6th Floor',
    '7th Floor',
    '8th Floor',
    'A Wing',
    'B Wing',
    'C Wing',
    'D Wing',
    'Basement',
    'Cafeteria'
];

export default function PropertyBudgetsTab({
    user,
    organizationId,
    properties = []
}: PropertyBudgetsTabProps) {
    const [allProperties, setAllProperties] = useState<Array<{ id: string; name: string; location?: string; address?: string }>>(properties || []);
    const [budgets, setBudgets] = useState<PropertyBudgetItem[]>([]);
    const [isLoading, setIsLoading] = useState<boolean>(true);
    const [isSaving, setIsSaving] = useState<boolean>(false);
    const [searchQuery, setSearchQuery] = useState<string>('');
    const [selectedPropertyFilter, setSelectedPropertyFilter] = useState<string>('all');
    const [selectedStatusFilter, setSelectedStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
    const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);

    // Add new floor budget row state
    const [showAddForm, setShowAddForm] = useState<boolean>(false);
    const [newPropertyId, setNewPropertyId] = useState<string>('');
    const [newFloorTag, setNewFloorTag] = useState<string>('All Floors');
    const [customFloorInput, setCustomFloorInput] = useState<string>('');
    const [newHkBudget, setNewHkBudget] = useState<string>('');
    const [newBeverageBudget, setNewBeverageBudget] = useState<string>('');
    const [newSiteName, setNewSiteName] = useState<string>('');

    const showNotification = (message: string, type: 'success' | 'error' | 'info' = 'info') => {
        setToast({ message, type });
        setTimeout(() => setToast(null), 4000);
    };

    // Load existing properties and budgets from API
    const fetchBudgetsAndProperties = useCallback(async () => {
        if (!organizationId) return;
        setIsLoading(true);
        try {
            // 1. Fetch live properties directly to guarantee we have all properties
            let resolvedProps: any[] = properties && properties.length > 0 ? [...properties] : [];
            try {
                const propRes = await fetch(`/api/properties?organization_id=${organizationId}`);
                if (propRes.ok) {
                    const propData = await propRes.json();
                    if (Array.isArray(propData) && propData.length > 0) {
                        const propMap = new Map<string, any>();
                        resolvedProps.forEach(p => propMap.set(p.id, p));
                        propData.forEach(p => propMap.set(p.id, {
                            id: p.id,
                            name: p.name,
                            location: p.location || p.city || p.address || '',
                            address: p.address || ''
                        }));
                        resolvedProps = Array.from(propMap.values());
                    }
                }
            } catch (pErr) {
                console.warn('Failed to load properties from /api/properties:', pErr);
            }

            setAllProperties(resolvedProps);
            if (resolvedProps.length > 0 && !newPropertyId) {
                setNewPropertyId(resolvedProps[0].id);
            }

            // 2. Fetch configured budgets from API
            const res = await fetch(`/api/procurement/requisitions/budgets?organization_id=${organizationId}`);
            const data = await res.json();
            const existingBudgets: any[] = data.budgets || [];

            // 3. Map all properties and existing budgets into the table
            const budgetMap = new Map<string, PropertyBudgetItem>();

            // Add existing saved budgets
            existingBudgets.forEach((b: any) => {
                const key = `${b.property_id}_${b.floor_tag}`;
                const prop = resolvedProps.find(p => p.id === b.property_id) || b.property;
                budgetMap.set(key, {
                    id: b.id,
                    organization_id: b.organization_id || organizationId,
                    property_id: b.property_id,
                    property_name: prop?.name || b.property?.name || 'Property',
                    property_location: prop?.location || prop?.address || b.property?.address || '',
                    floor_tag: b.floor_tag || 'All Floors',
                    site_name: b.site_name || prop?.name || 'Site',
                    hk_budget: Number(b.hk_budget) || 0,
                    beverage_budget: Number(b.beverage_budget) || 0,
                    total_budget: Number(b.total_budget) || ((Number(b.hk_budget) || 0) + (Number(b.beverage_budget) || 0)),
                    is_active: b.is_active !== undefined ? b.is_active : true,
                    is_modified: false
                });
            });

            // Ensure every property has at least one default row in the table
            resolvedProps.forEach(p => {
                const key = `${p.id}_All Floors`;
                const hasAnyBudget = Array.from(budgetMap.values()).some(b => b.property_id === p.id);
                if (!hasAnyBudget && !budgetMap.has(key)) {
                    budgetMap.set(key, {
                        organization_id: organizationId,
                        property_id: p.id,
                        property_name: p.name,
                        property_location: p.location || p.address || '',
                        floor_tag: 'All Floors',
                        site_name: p.name,
                        hk_budget: 0,
                        beverage_budget: 0,
                        total_budget: 0,
                        is_active: true,
                        is_new: true,
                        is_modified: false
                    });
                }
            });

            setBudgets(Array.from(budgetMap.values()));
        } catch (err: any) {
            console.error('Failed to load budgets and properties:', err);
            showNotification('Failed to load existing site budgets', 'error');
        } finally {
            setIsLoading(false);
        }
    }, [organizationId, properties, newPropertyId]);

    useEffect(() => {
        fetchBudgetsAndProperties();
    }, [fetchBudgetsAndProperties]);

    // Value edit handlers
    const handleBudgetFieldChange = (index: number, field: 'hk_budget' | 'beverage_budget' | 'total_budget' | 'site_name' | 'floor_tag', value: any) => {
        setBudgets(prev => {
            const next = [...prev];
            const item = { ...next[index], [field]: value, is_modified: true };

            if (field === 'hk_budget' || field === 'beverage_budget') {
                const hk = field === 'hk_budget' ? (Number(value) || 0) : (Number(item.hk_budget) || 0);
                const bev = field === 'beverage_budget' ? (Number(value) || 0) : (Number(item.beverage_budget) || 0);
                item.total_budget = hk + bev;
            }

            next[index] = item;
            return next;
        });
    };

    const handleToggleActive = (index: number) => {
        setBudgets(prev => {
            const next = [...prev];
            next[index] = { ...next[index], is_active: !next[index].is_active, is_modified: true };
            return next;
        });
    };

    const handleDeleteBudget = async (item: PropertyBudgetItem, index: number) => {
        if (!confirm(`Are you sure you want to remove the budget allocation for ${item.property_name} (${item.floor_tag})?`)) {
            return;
        }

        if (item.id) {
            try {
                const res = await fetch(`/api/procurement/requisitions/budgets?id=${item.id}`, { method: 'DELETE' });
                if (!res.ok) throw new Error('Failed to delete budget');
            } catch (err: any) {
                showNotification(`Delete failed: ${err.message}`, 'error');
                return;
            }
        }

        setBudgets(prev => prev.filter((_, i) => i !== index));
        showNotification(`Budget for ${item.property_name} (${item.floor_tag}) removed`, 'success');
    };

    const handleAddNewFloorBudget = (e: React.FormEvent) => {
        e.preventDefault();
        if (!newPropertyId) {
            alert('Please select a property.');
            return;
        }

        const prop = allProperties.find(p => p.id === newPropertyId);
        const resolvedFloor = newFloorTag === 'Custom' ? (customFloorInput.trim() || 'Custom Floor') : newFloorTag;
        const hk = Number(newHkBudget) || 0;
        const bev = Number(newBeverageBudget) || 0;
        const total = hk + bev;

        const exists = budgets.some(b => b.property_id === newPropertyId && b.floor_tag.toLowerCase() === resolvedFloor.toLowerCase());
        if (exists) {
            alert(`A budget entry for ${prop?.name} with floor "${resolvedFloor}" already exists in the table.`);
            return;
        }

        const newItem: PropertyBudgetItem = {
            organization_id: organizationId,
            property_id: newPropertyId,
            property_name: prop?.name || 'Property',
            property_location: prop?.location || prop?.address || '',
            floor_tag: resolvedFloor,
            site_name: newSiteName.trim() || `${prop?.name || 'Site'} (${resolvedFloor})`,
            hk_budget: hk,
            beverage_budget: bev,
            total_budget: total,
            is_active: true,
            is_new: true,
            is_modified: true
        };

        setBudgets(prev => [newItem, ...prev]);
        setShowAddForm(false);
        setNewHkBudget('');
        setNewBeverageBudget('');
        setNewSiteName('');
        setCustomFloorInput('');
        setNewFloorTag('All Floors');
        showNotification(`Added ${newItem.site_name}. Click "Save All Budgets" to persist.`, 'info');
    };

    const handleSaveAll = async () => {
        setIsSaving(true);
        try {
            const payload = budgets.map(b => ({
                organization_id: organizationId,
                property_id: b.property_id,
                floor_tag: b.floor_tag || 'All Floors',
                site_name: b.site_name || b.property_name || '',
                hk_budget: Number(b.hk_budget) || 0,
                beverage_budget: Number(b.beverage_budget) || 0,
                total_budget: Number(b.total_budget) || ((Number(b.hk_budget) || 0) + (Number(b.beverage_budget) || 0)),
                is_active: b.is_active
            }));

            const res = await fetch('/api/procurement/requisitions/budgets', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const data = await res.json();
            if (!res.ok) {
                throw new Error(data.error || 'Failed to save property budgets');
            }

            // Instantly update state with saved IDs and reset modified state
            if (data.budgets && Array.isArray(data.budgets)) {
                const savedMap = new Map<string, any>();
                data.budgets.forEach((b: any) => savedMap.set(`${b.property_id}_${b.floor_tag}`, b));
                setBudgets(prev => prev.map(b => {
                    const saved = savedMap.get(`${b.property_id}_${b.floor_tag}`);
                    return {
                        ...b,
                        id: saved?.id || b.id,
                        is_modified: false,
                        is_new: false
                    };
                }));
            } else {
                setBudgets(prev => prev.map(b => ({ ...b, is_modified: false, is_new: false })));
            }

            showNotification('✅ All Property Monthly Requisition Budgets saved instantly!', 'success');
        } catch (err: any) {
            console.error('Save failed:', err);
            showNotification(`Error: ${err.message}`, 'error');
        } finally {
            setIsSaving(false);
        }
    };

    // Filtered list
    const filteredBudgets = useMemo(() => {
        return budgets.filter(b => {
            const matchesQuery = 
                (b.property_name || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
                (b.site_name || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
                (b.floor_tag || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
                (b.property_location || '').toLowerCase().includes(searchQuery.toLowerCase());

            const matchesProp = selectedPropertyFilter === 'all' || b.property_id === selectedPropertyFilter;
            const matchesStatus = selectedStatusFilter === 'all' || (selectedStatusFilter === 'active' ? b.is_active : !b.is_active);

            return matchesQuery && matchesProp && matchesStatus;
        });
    }, [budgets, searchQuery, selectedPropertyFilter, selectedStatusFilter]);

    // Summary calculations
    const summary = useMemo(() => {
        const active = budgets.filter(b => b.is_active);
        const totalHk = active.reduce((acc, b) => acc + (Number(b.hk_budget) || 0), 0);
        const totalBev = active.reduce((acc, b) => acc + (Number(b.beverage_budget) || 0), 0);
        const totalGrand = active.reduce((acc, b) => acc + (Number(b.total_budget) || 0), 0);
        return {
            totalSites: budgets.length,
            activeSites: active.length,
            totalHk,
            totalBev,
            totalGrand
        };
    }, [budgets]);

    return (
        <div className="space-y-6">
            {/* Header Box */}
            <div className="bg-white dark:bg-slate-900 rounded-3xl p-6 border border-slate-200 dark:border-slate-800 shadow-xs flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-600 dark:text-emerald-400">
                        <IndianRupee className="w-6 h-6" />
                    </div>
                    <div>
                        <div className="flex items-center gap-2.5">
                            <h1 className="text-xl font-bold text-slate-900 dark:text-white">Monthly Requisition Property Budgets</h1>
                            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                                Site & Floor Allocation
                            </span>
                        </div>
                        <p className="text-xs md:text-sm text-slate-500 dark:text-slate-400 mt-0.5">
                            Configure monthly Housekeeping & Tissue, Beverage, and Total budget limits per property and floor. Property Admins will see live budget progress and will be flagged if their order exceeds the budget.
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    <button
                        onClick={() => setShowAddForm(!showAddForm)}
                        className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold transition-all cursor-pointer ${
                            showAddForm 
                                ? 'bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-slate-200' 
                                : 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800 hover:bg-emerald-100'
                        }`}
                    >
                        <Plus className="w-4 h-4" />
                        <span>{showAddForm ? 'Close Add Form' : '+ Add Floor Allocation'}</span>
                    </button>

                    <button
                        onClick={handleSaveAll}
                        disabled={isSaving}
                        className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-6 py-2.5 rounded-xl font-bold text-sm transition-all shadow-md shadow-emerald-600/20 disabled:opacity-50 cursor-pointer"
                    >
                        {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                        <span>Save All Budgets</span>
                    </button>
                </div>
            </div>

            {/* Toast Notification */}
            {toast && (
                <div className={`p-4 rounded-2xl text-xs font-bold flex items-center gap-2 shadow-xs ${
                    toast.type === 'success' ? 'bg-emerald-500 text-white' :
                    toast.type === 'error' ? 'bg-red-500 text-white' : 'bg-blue-500 text-white'
                }`}>
                    {toast.type === 'success' ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
                    <span>{toast.message}</span>
                </div>
            )}

            {/* KPI Summary Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="bg-white dark:bg-slate-800 p-5 rounded-3xl border border-slate-200 dark:border-slate-700 shadow-xs">
                    <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block">Total Sites / Floors</span>
                    <div className="flex items-baseline gap-2 mt-2">
                        <span className="text-2xl font-black text-slate-900 dark:text-white">{summary.totalSites}</span>
                        <span className="text-xs font-bold text-emerald-600">({summary.activeSites} Active)</span>
                    </div>
                    <span className="text-[11px] text-slate-400 mt-1 block">Properties in your organization</span>
                </div>

                <div className="bg-white dark:bg-slate-800 p-5 rounded-3xl border border-slate-200 dark:border-slate-700 shadow-xs">
                    <div className="flex items-center gap-1.5 text-xs font-bold text-amber-600 uppercase tracking-wider">
                        <Sparkles className="w-4 h-4" />
                        <span>HK & Tissue Budget</span>
                    </div>
                    <div className="text-2xl font-black text-slate-900 dark:text-white mt-2">
                        ₹{summary.totalHk.toLocaleString('en-IN')}
                    </div>
                    <span className="text-[11px] text-slate-400 mt-1 block">Total monthly HK allocation</span>
                </div>

                <div className="bg-white dark:bg-slate-800 p-5 rounded-3xl border border-slate-200 dark:border-slate-700 shadow-xs">
                    <div className="flex items-center gap-1.5 text-xs font-bold text-sky-600 uppercase tracking-wider">
                        <Coffee className="w-4 h-4" />
                        <span>Beverage Budget</span>
                    </div>
                    <div className="text-2xl font-black text-slate-900 dark:text-white mt-2">
                        ₹{summary.totalBev.toLocaleString('en-IN')}
                    </div>
                    <span className="text-[11px] text-slate-400 mt-1 block">Total monthly Beverage allocation</span>
                </div>

                <div className="bg-emerald-50/50 dark:bg-emerald-950/30 p-5 rounded-3xl border-2 border-emerald-500/30 shadow-xs">
                    <span className="text-xs font-bold text-emerald-700 dark:text-emerald-400 uppercase tracking-wider block">Grand Combined Budget</span>
                    <div className="text-2xl font-black text-emerald-700 dark:text-emerald-400 mt-2">
                        ₹{summary.totalGrand.toLocaleString('en-IN')}
                    </div>
                    <span className="text-[11px] text-emerald-600/80 mt-1 block">Overall monthly limit across sites</span>
                </div>
            </div>

            {/* Filter and Search Bar */}
            <div className="bg-white dark:bg-slate-800 p-4 rounded-3xl border border-slate-200 dark:border-slate-700 shadow-xs flex flex-wrap items-center justify-between gap-4">
                <div className="flex flex-wrap items-center gap-3 flex-1">
                    <div className="relative flex-1 min-w-[240px] max-w-md">
                        <Search className="w-4 h-4 absolute left-3.5 top-3 text-slate-400" />
                        <input
                            type="text"
                            placeholder="Search property name, site label, floor, city..."
                            value={searchQuery}
                            onChange={e => setSearchQuery(e.target.value)}
                            className="w-full pl-10 pr-3.5 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-semibold text-slate-800 dark:text-slate-200 placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
                        />
                    </div>

                    <select
                        value={selectedPropertyFilter}
                        onChange={e => setSelectedPropertyFilter(e.target.value)}
                        className="py-2.5 px-3.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-semibold text-slate-800 dark:text-slate-200 focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
                    >
                        <option value="all">All Properties ({allProperties.length})</option>
                        {allProperties.map(p => (
                            <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                    </select>

                    <select
                        value={selectedStatusFilter}
                        onChange={e => setSelectedStatusFilter(e.target.value as any)}
                        className="py-2.5 px-3.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-semibold text-slate-800 dark:text-slate-200 focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
                    >
                        <option value="all">All Status</option>
                        <option value="active">Active Only</option>
                        <option value="inactive">Inactive Only</option>
                    </select>
                </div>

                <div className="flex items-center gap-3">
                    <span className="text-xs text-slate-500 font-medium">
                        Showing <b>{filteredBudgets.length}</b> of {budgets.length} entries
                    </span>

                    <button
                        onClick={handleSaveAll}
                        disabled={isSaving}
                        className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-5 py-2.5 rounded-xl font-bold text-xs transition-all shadow-sm disabled:opacity-50 cursor-pointer"
                    >
                        {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                        <span>Save All Changes</span>
                    </button>
                </div>
            </div>

            {/* Add New Floor Budget Expandable Form */}
            <AnimatePresence>
                {showAddForm && (
                    <motion.form
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        onSubmit={handleAddNewFloorBudget}
                        className="bg-emerald-50/70 dark:bg-emerald-950/30 rounded-3xl border border-emerald-200 dark:border-emerald-800/60 p-6 overflow-hidden shadow-xs"
                    >
                        <div className="flex items-center justify-between mb-4">
                            <div className="flex items-center gap-2">
                                <Layers className="w-5 h-5 text-emerald-600" />
                                <h3 className="text-sm font-black text-slate-800 dark:text-slate-200 uppercase tracking-wider">
                                    Add Floor-Specific Allocation for a Site
                                </h3>
                            </div>
                            <button
                                type="button"
                                onClick={() => setShowAddForm(false)}
                                className="p-1 rounded-lg text-slate-400 hover:text-slate-600"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-6 gap-4">
                            <div>
                                <label className="text-[11px] font-bold text-slate-600 dark:text-slate-400 uppercase block mb-1.5">Property Center</label>
                                <select
                                    value={newPropertyId}
                                    onChange={e => setNewPropertyId(e.target.value)}
                                    className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-3.5 py-2.5 text-xs font-bold text-slate-800 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
                                >
                                    {allProperties.map(p => (
                                        <option key={p.id} value={p.id}>{p.name}</option>
                                    ))}
                                </select>
                            </div>

                            <div>
                                <label className="text-[11px] font-bold text-slate-600 dark:text-slate-400 uppercase block mb-1.5">Floor / Section</label>
                                <select
                                    value={newFloorTag}
                                    onChange={e => setNewFloorTag(e.target.value)}
                                    className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-3.5 py-2.5 text-xs font-bold text-emerald-800 dark:text-emerald-400 focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
                                >
                                    {COMMON_FLOORS.map(f => (
                                        <option key={f} value={f}>{f}</option>
                                    ))}
                                    <option value="Custom">Custom Floor...</option>
                                </select>
                            </div>

                            {newFloorTag === 'Custom' && (
                                <div>
                                    <label className="text-[11px] font-bold text-slate-600 dark:text-slate-400 uppercase block mb-1.5">Custom Floor Name</label>
                                    <input
                                        type="text"
                                        placeholder="e.g. 9th Floor Tower A"
                                        value={customFloorInput}
                                        onChange={e => setCustomFloorInput(e.target.value)}
                                        className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-3.5 py-2.5 text-xs font-medium text-slate-800 dark:text-white"
                                    />
                                </div>
                            )}

                            <div>
                                <label className="text-[11px] font-bold text-slate-600 dark:text-slate-400 uppercase block mb-1.5">Display Site Label</label>
                                <input
                                    type="text"
                                    placeholder="e.g. RABALE 7TH FLOOR"
                                    value={newSiteName}
                                    onChange={e => setNewSiteName(e.target.value)}
                                    className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-3.5 py-2.5 text-xs font-medium text-slate-800 dark:text-white"
                                />
                            </div>

                            <div>
                                <label className="text-[11px] font-bold text-amber-600 uppercase block mb-1.5">HK & Tissue (₹)</label>
                                <input
                                    type="number"
                                    placeholder="0"
                                    value={newHkBudget}
                                    onChange={e => setNewHkBudget(e.target.value)}
                                    className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-3.5 py-2.5 text-xs font-bold text-slate-800 dark:text-white"
                                />
                            </div>

                            <div>
                                <label className="text-[11px] font-bold text-sky-600 uppercase block mb-1.5">Beverage (₹)</label>
                                <input
                                    type="number"
                                    placeholder="0"
                                    value={newBeverageBudget}
                                    onChange={e => setNewBeverageBudget(e.target.value)}
                                    className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-3.5 py-2.5 text-xs font-bold text-slate-800 dark:text-white"
                                />
                            </div>

                            <div className="flex items-end">
                                <button
                                    type="submit"
                                    className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs py-3 px-3 rounded-xl transition-all shadow-xs cursor-pointer"
                                >
                                    + Add Floor Row
                                </button>
                            </div>
                        </div>
                    </motion.form>
                )}
            </AnimatePresence>

            {/* Table Container */}
            <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-xs overflow-hidden">
                {isLoading ? (
                    <div className="py-28 text-center text-slate-500 dark:text-slate-400">
                        <Loader2 className="w-10 h-10 animate-spin mx-auto mb-3 text-emerald-500" />
                        <p className="text-sm font-semibold">Loading properties and budgets...</p>
                    </div>
                ) : filteredBudgets.length === 0 ? (
                    <div className="py-28 text-center text-slate-500 dark:text-slate-400">
                        <Building2 className="w-16 h-16 mx-auto mb-3 text-slate-300 dark:text-slate-600" />
                        <h3 className="text-lg font-bold text-slate-800 dark:text-slate-200 mb-1">No Matching Properties Found</h3>
                        <p className="text-xs">Adjust your search query or add a new floor allocation above.</p>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-xs border-collapse">
                            <thead className="bg-slate-50 dark:bg-slate-800/80 text-slate-600 dark:text-slate-400 uppercase text-[11px] font-bold tracking-wider border-b border-slate-200 dark:border-slate-700">
                                <tr>
                                    <th className="py-4 px-4 w-12 text-center">#</th>
                                    <th className="py-4 px-4 min-w-[260px]">Center / Property Name</th>
                                    <th className="py-4 px-4 min-w-[160px]">Floor / Section</th>
                                    <th className="py-4 px-4 min-w-[170px] text-amber-700 dark:text-amber-400">HK & Tissue Budget (₹)</th>
                                    <th className="py-4 px-4 min-w-[170px] text-sky-700 dark:text-sky-400">Beverage Budget (₹)</th>
                                    <th className="py-4 px-4 min-w-[180px] text-emerald-700 dark:text-emerald-400">Total Monthly Budget (₹)</th>
                                    <th className="py-4 px-4 w-24 text-center">Active</th>
                                    <th className="py-4 px-4 w-16 text-center">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                                {filteredBudgets.map((item, idx) => {
                                    const globalIndex = budgets.findIndex(b => b.property_id === item.property_id && b.floor_tag === item.floor_tag);

                                    return (
                                        <tr 
                                            key={`${item.property_id}_${item.floor_tag}_${idx}`}
                                            className={`hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors ${
                                                !item.is_active ? 'opacity-50 bg-slate-50 dark:bg-slate-900/40' : ''
                                            } ${item.is_modified ? 'bg-amber-50/30 dark:bg-amber-950/10' : ''}`}
                                        >
                                            <td className="py-4 px-4 text-center text-slate-400 font-bold">
                                                {idx + 1}
                                            </td>

                                            <td className="py-4 px-4">
                                                <div className="flex items-center gap-3">
                                                    <div className="w-10 h-10 rounded-2xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center text-slate-600 dark:text-slate-300 shrink-0">
                                                        <Building2 className="w-5 h-5" />
                                                    </div>
                                                    <div className="min-w-0 flex-1">
                                                        <input
                                                            type="text"
                                                            value={item.site_name || item.property_name || ''}
                                                            onChange={e => handleBudgetFieldChange(globalIndex, 'site_name', e.target.value)}
                                                            className="font-bold text-slate-900 dark:text-white bg-transparent hover:bg-slate-100 dark:hover:bg-slate-800 focus:bg-white dark:focus:bg-slate-800 border border-transparent hover:border-slate-200 dark:hover:border-slate-700 focus:border-emerald-500 rounded-lg px-2 py-1 w-full text-xs"
                                                        />
                                                        {item.property_location && (
                                                            <span className="block text-[11px] text-slate-400 font-medium px-2 truncate">
                                                                {item.property_location}
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>
                                            </td>

                                            <td className="py-4 px-4">
                                                <select
                                                    value={item.floor_tag || 'All Floors'}
                                                    onChange={e => handleBudgetFieldChange(globalIndex, 'floor_tag', e.target.value)}
                                                    className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-xs font-bold text-emerald-700 dark:text-emerald-400 focus:outline-hidden focus:ring-1 focus:ring-emerald-500 w-full"
                                                >
                                                    {COMMON_FLOORS.map(f => (
                                                        <option key={f} value={f}>{f}</option>
                                                    ))}
                                                    {!COMMON_FLOORS.includes(item.floor_tag) && (
                                                        <option value={item.floor_tag}>{item.floor_tag}</option>
                                                    )}
                                                </select>
                                            </td>

                                            <td className="py-4 px-4">
                                                <div className="relative">
                                                    <span className="absolute left-3 top-2.5 text-slate-400 text-xs font-bold">₹</span>
                                                    <input
                                                        type="number"
                                                        min="0"
                                                        step="100"
                                                        value={item.hk_budget === 0 ? '' : item.hk_budget}
                                                        placeholder="0"
                                                        onChange={e => handleBudgetFieldChange(globalIndex, 'hk_budget', e.target.value)}
                                                        className="w-full pl-7 pr-3 py-2 bg-amber-50/40 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/50 rounded-xl text-xs font-bold text-slate-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-amber-500"
                                                    />
                                                </div>
                                            </td>

                                            <td className="py-4 px-4">
                                                <div className="relative">
                                                    <span className="absolute left-3 top-2.5 text-slate-400 text-xs font-bold">₹</span>
                                                    <input
                                                        type="number"
                                                        min="0"
                                                        step="100"
                                                        value={item.beverage_budget === 0 ? '' : item.beverage_budget}
                                                        placeholder="0"
                                                        onChange={e => handleBudgetFieldChange(globalIndex, 'beverage_budget', e.target.value)}
                                                        className="w-full pl-7 pr-3 py-2 bg-sky-50/40 dark:bg-sky-950/20 border border-sky-200 dark:border-sky-900/50 rounded-xl text-xs font-bold text-slate-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-sky-500"
                                                    />
                                                </div>
                                            </td>

                                            <td className="py-4 px-4">
                                                <div className="relative">
                                                    <span className="absolute left-3 top-2.5 text-emerald-600 text-xs font-bold">₹</span>
                                                    <input
                                                        type="number"
                                                        min="0"
                                                        step="100"
                                                        value={item.total_budget === 0 ? '' : item.total_budget}
                                                        placeholder="0"
                                                        onChange={e => handleBudgetFieldChange(globalIndex, 'total_budget', e.target.value)}
                                                        className="w-full pl-7 pr-3 py-2 bg-emerald-50/40 dark:bg-emerald-950/20 border-2 border-emerald-300 dark:border-emerald-800/60 rounded-xl text-xs font-black text-emerald-800 dark:text-emerald-300 focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
                                                    />
                                                </div>
                                            </td>

                                            <td className="py-4 px-4 text-center">
                                                <button
                                                    type="button"
                                                    onClick={() => handleToggleActive(globalIndex)}
                                                    className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase transition-all cursor-pointer ${
                                                        item.is_active 
                                                            ? 'bg-emerald-100 text-emerald-800 border border-emerald-300 dark:bg-emerald-950 dark:text-emerald-300'
                                                            : 'bg-slate-200 text-slate-600 border border-slate-300 dark:bg-slate-800 dark:text-slate-400'
                                                    }`}
                                                >
                                                    {item.is_active ? 'Active' : 'Off'}
                                                </button>
                                            </td>

                                            <td className="py-4 px-4 text-center">
                                                {item.floor_tag !== 'All Floors' && (
                                                    <button
                                                        type="button"
                                                        onClick={() => handleDeleteBudget(item, globalIndex)}
                                                        className="p-2 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors cursor-pointer"
                                                        title="Delete floor budget"
                                                    >
                                                        <Trash2 className="w-4 h-4" />
                                                    </button>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}

                {/* Table Footer */}
                <div className="p-5 bg-slate-50 dark:bg-slate-800/60 border-t border-slate-200 dark:border-slate-700 flex flex-wrap items-center justify-between gap-4">
                    <div className="flex items-center gap-2 text-xs text-slate-500">
                        <ShieldCheck className="w-4 h-4 text-emerald-600" />
                        <span>Configured budgets apply instantly to property requisition sheets.</span>
                    </div>

                    <button
                        onClick={handleSaveAll}
                        disabled={isSaving}
                        className="flex items-center gap-2 px-6 py-2.5 rounded-xl text-xs font-black text-white bg-emerald-600 hover:bg-emerald-700 shadow-md shadow-emerald-600/20 transition-all disabled:opacity-50 cursor-pointer"
                    >
                        {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                        <span>Save All Budgets</span>
                    </button>
                </div>
            </div>
        </div>
    );
}
