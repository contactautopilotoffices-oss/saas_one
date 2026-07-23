'use client';

import React, { useState, useEffect } from 'react';
import { 
    Shield, Settings, Users, IndianRupee, Save, Loader2, 
    CheckCircle2, AlertCircle, Search, Building2, TrendingUp,
    X, Plus, Lock, ShoppingCart
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface Approver {
    id: string;
    full_name: string;
    email: string;
    membership_role?: string;
    property_id?: string | null;
}

interface PropertySettings {
    property_id: string;
    organization_id: string;
    price_visibility_roles?: string[];
    price_visibility_users?: string[];
}

interface Budget {
    property_id: string;
    budget_type: 'rnm' | 'general';
    total_amount: number;
    spent_amount: number;
}

export default function ProcurementAdminSettings({ organizationId, properties }: { organizationId: string, properties: any[] }) {
    const [selectedPropertyId, setSelectedPropertyId] = useState(properties[0]?.id || '');
    const [visibilityPropertyId, setVisibilityPropertyId] = useState(properties[0]?.id || '');
    const [settings, setSettings] = useState<PropertySettings | null>(null);
    const [budgets, setBudgets] = useState<Budget[]>([]);
    const [employees, setEmployees] = useState<Approver[]>([]);
    const [allVisibilitySettings, setAllVisibilitySettings] = useState<Record<string, { roles: string[], users: string[] }>>({});
    const [searchQuery, setSearchQuery] = useState('');
    const [filterProperty, setFilterProperty] = useState('all');
    const [filterRole, setFilterRole] = useState('all');
    const [isLoading, setIsLoading] = useState(false);
    const [isSaving, setIsSaving] = useState({ accounts: false, visibility: false });
    const [message, setMessage] = useState({ type: '', text: '' });
    const [searchTerm, setSearchTerm] = useState('');

    useEffect(() => {
        if (!selectedPropertyId && properties.length > 0) {
            setSelectedPropertyId(properties[0].id);
            setVisibilityPropertyId(properties[0].id);
        }
    }, [properties]);

    useEffect(() => {
        if (selectedPropertyId) {
            fetchSettings(selectedPropertyId);
            fetchBudgets(selectedPropertyId);
        }
        fetchEmployees();
        fetchAllVisibility();
    }, [selectedPropertyId, organizationId]);

    const fetchAllVisibility = async () => {
        try {
            const res = await fetch(`/api/procurement/settings?organizationId=${organizationId}`);
            const data = await res.json();
            if (Array.isArray(data)) {
                const visMap: Record<string, { roles: string[], users: string[] }> = {};
                data.forEach((item: any) => {
                    visMap[item.property_id] = {
                        roles: item.roles || [],
                        users: item.users || []
                    };
                });
                setAllVisibilitySettings(visMap);
            }
        } catch (err) {
            console.error('Error fetching visibility rules:', err);
        }
    };

    const fetchSettings = async (id: string) => {
        setIsLoading(true);
        try {
            const res = await fetch(`/api/procurement/settings?propertyId=${id}`);
            const data = await res.json();
            setSettings(data.property_id ? data : {
                property_id: id,
                organization_id: organizationId,
                roles: ['procurement', 'org_super_admin', 'property_admin'],
                users: []
            });
        } catch (err) {
            console.error(err);
        } finally {
            setIsLoading(false);
        }
    };

    const fetchBudgets = async (id: string) => {
        try {
            const res = await fetch(`/api/procurement/budgets?propertyId=${id}`);
            const data = await res.json();
            setBudgets(data || []);
        } catch (err) {
            console.error(err);
        }
    };

    const fetchEmployees = async () => {
        try {
            const res = await fetch(`/api/escalation/employees?organizationId=${organizationId}`);
            const data = await res.json();
            if (Array.isArray(data)) {
                setEmployees(data);
            } else {
                console.warn('API Warning: /api/escalation/employees returned non-array data:', data);
                setEmployees([]);
            }
        } catch (err) {
            console.error('Error fetching employees:', err);
            setEmployees([]);
        }
    };



    const handleSaveVisibility = async (overrideSettings?: Record<string, { roles: string[], users: string[] }>) => {
        setIsSaving(prev => ({ ...prev, visibility: true }));
        setMessage({ type: '', text: '' });
        
        // Fix: Ensure we don't try to use the Event object as settings if called from a button
        const settingsToSave = (overrideSettings && typeof overrideSettings === 'object' && !('nativeEvent' in overrideSettings)) 
            ? overrideSettings 
            : allVisibilitySettings;
        
        try {
            // Save each property that has visibility settings
            const savePromises = Object.entries(settingsToSave).map(([propId, data]) => {
                return fetch('/api/procurement/settings', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        property_id: propId,
                        organization_id: organizationId,
                        price_visibility_roles: data.roles,
                        price_visibility_users: data.users
                    })
                });
            });
            
            const results = await Promise.all(savePromises);
            if (results.every(r => r.ok)) {
                setMessage({ type: 'success', text: 'Visibility rules saved!' });
                setTimeout(() => setMessage({ type: '', text: '' }), 3000);
            }
        } catch (err) {
            setMessage({ type: 'error', text: 'Failed to save visibility.' });
        } finally {
            setIsSaving(prev => ({ ...prev, visibility: false }));
        }
    };

    const handleUpdateBudget = async (type: 'rnm' | 'general', amount: number) => {
        setIsSaving(prev => ({ ...prev, accounts: true }));
        try {
            const res = await fetch('/api/procurement/budgets', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    property_id: selectedPropertyId,
                    organization_id: organizationId,
                    budget_type: type,
                    total_amount: amount
                })
            });
            if (res.ok) {
                fetchBudgets(selectedPropertyId);
                setMessage({ type: 'success', text: `${type.toUpperCase()} Budget updated!` });
                setTimeout(() => setMessage({ type: '', text: '' }), 3000);
            }
        } catch (err) {
            console.error(err);
        } finally {
            setIsSaving(prev => ({ ...prev, accounts: false }));
        }
    };

    // Simplified save all for compatibility if needed, but we'll use individual ones
    const handleSave = async () => {
        await handleSaveVisibility();
    };

    return (
        <div className="space-y-6 max-w-5xl mx-auto p-4 sm:p-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
                        <Shield className="w-6 h-6" />
                    </div>
                    <div>
                        <h2 className="text-xl font-black text-slate-900 tracking-tight">Supply Controls</h2>
                        <p className="text-sm text-slate-500 font-medium">Set limits and managers for orders</p>
                    </div>
                </div>
                
                <div className="flex items-center gap-2">
                    <Building2 className="w-4 h-4 text-slate-400" />
                    <select 
                        value={selectedPropertyId}
                        onChange={(e) => setSelectedPropertyId(e.target.value)}
                        className="bg-slate-50 border border-slate-200 text-slate-700 text-sm font-bold rounded-xl focus:ring-primary focus:border-primary block p-2.5 outline-none"
                    >
                        {properties.map(p => (
                            <option key={`prop-opt-${p.id}`} value={p.id}>{p.name}</option>
                        ))}
                    </select>
                </div>
            </div>

            {/* Section Navigation Chips */}
            <div className="flex flex-wrap gap-2 px-2">
                {[
                    { id: 'budgets-section', label: 'Money Accounts', icon: IndianRupee },
                    { id: 'visibility-section', label: 'Price Visibility', icon: TrendingUp },
                    { id: 'zoho-section', label: 'Zoho Books', icon: ShoppingCart }
                ].map(section => (
                    <button
                        key={section.id}
                        onClick={() => document.getElementById(section.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                        className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-full text-[10px] font-black uppercase tracking-widest text-slate-500 hover:border-primary hover:text-primary transition-all shadow-sm group"
                    >
                        <section.icon className="w-3 h-3 text-slate-400 group-hover:text-primary" />
                        {section.label}
                    </button>
                ))}
            </div>

            {isLoading ? (
                <div className="flex items-center justify-center py-24">
                    <Loader2 className="w-8 h-8 text-primary animate-spin" />
                </div>
            ) : settings ? (
                <>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {/* Flow Info Card */}
                        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-6">
                            <div className="flex items-center gap-2 pb-4 border-b border-slate-100">
                                <Shield className="w-5 h-5 text-primary" />
                                <h3 className="font-black text-slate-800 uppercase tracking-wider text-sm">Procurement Flow</h3>
                            </div>

                            <div className="space-y-4">
                                <div className="flex items-start gap-3 p-3 bg-slate-50 rounded-xl border border-slate-100">
                                    <div className="w-6 h-6 rounded-full bg-amber-100 text-amber-600 flex items-center justify-center text-[10px] font-black shrink-0">1</div>
                                    <div>
                                        <p className="text-xs font-black text-slate-700">Site Team Requests</p>
                                        <p className="text-[10px] text-slate-500 font-medium">Staff raises a request with service description and budget selection.</p>
                                    </div>
                                </div>
                                <div className="flex items-start gap-3 p-3 bg-slate-50 rounded-xl border border-slate-100">
                                    <div className="w-6 h-6 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-[10px] font-black shrink-0">2</div>
                                    <div>
                                        <p className="text-xs font-black text-slate-700">Procurement Quotes</p>
                                        <p className="text-[10px] text-slate-500 font-medium">Procurement user adds vendor details, quotation items, and submits. Budget is deducted automatically.</p>
                                    </div>
                                </div>
                                <div className="flex items-start gap-3 p-3 bg-slate-50 rounded-xl border border-slate-100">
                                    <div className="w-6 h-6 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center text-[10px] font-black shrink-0">3</div>
                                    <div>
                                        <p className="text-xs font-black text-slate-700">Order & Deliver</p>
                                        <p className="text-[10px] text-slate-500 font-medium">Procurement marks ordered and then delivered when items reach site.</p>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Budgets Card */}
                        <div id="budgets-section" className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-6 scroll-mt-6">
                            <div className="flex items-center gap-2 pb-4 border-b border-slate-100">
                                <IndianRupee className="w-5 h-5 text-primary" />
                                <h3 className="font-black text-slate-800 uppercase tracking-wider text-sm">Money Accounts</h3>
                            </div>

                            <div className="space-y-8">
                                {['rnm', 'general'].map(type => {
                                    const budget = budgets.find(b => b.budget_type === type);
                                    const percentage = budget ? Math.min(100, (budget.spent_amount / budget.total_amount) * 100) : 0;
                                    
                                    return (
                                        <div key={`budget-${type}`} className="space-y-4 p-4 bg-slate-50/50 rounded-2xl border border-slate-100">
                                            <div className="flex justify-between items-end">
                                                <div>
                                                    <h4 className="text-sm font-black text-slate-700 uppercase tracking-tight">{type === 'rnm' ? 'Repair and Maintenance Account' : 'General Account'}</h4>
                                                    <p className="text-[10px] text-slate-400 font-medium">Money for current month</p>
                                                </div>
                                                <div className="text-right">
                                                    <span className="text-lg font-black text-slate-900">₹{(budget?.total_amount || 0).toLocaleString()}</span>
                                                </div>
                                            </div>
                                            
                                            <div className="w-full h-3 bg-slate-100 rounded-full overflow-hidden">
                                                <div 
                                                    className={`h-full rounded-full transition-all duration-500 ${percentage > 90 ? 'bg-red-500' : percentage > 70 ? 'bg-amber-500' : 'bg-primary'}`}
                                                    style={{ width: `${percentage}%` }}
                                                />
                                            </div>
                                            
                                            <div className="flex justify-between text-[10px] font-black uppercase tracking-widest">
                                                <span className="text-slate-400">Spent: ₹{(budget?.spent_amount || 0).toLocaleString()}</span>
                                                <span className={percentage > 90 ? 'text-red-500' : 'text-slate-400'}>{percentage.toFixed(1)}% used</span>
                                            </div>

                                            <div className="pt-2 flex items-center gap-2">
                                                <div className="relative flex-1">
                                                    <div className="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none">
                                                        <span className="text-slate-400 text-[10px] font-black">₹</span>
                                                    </div>
                                                    <input 
                                                        type="number"
                                                        placeholder="Set Limit"
                                                        defaultValue={budget?.total_amount}
                                                        onBlur={(e) => {
                                                            const val = parseInt(e.target.value);
                                                            if (val && val !== budget?.total_amount) handleUpdateBudget(type as any, val);
                                                        }}
                                                        className="w-full pl-6 pr-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-black outline-none focus:ring-2 focus:ring-primary/20"
                                                    />
                                                </div>
                                                <span className="text-[9px] font-black text-slate-300 uppercase tracking-widest italic">Auto-save on blur</span>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>

                            <div className="pt-4 border-t border-slate-50">
                                <button 
                                    onClick={() => {
                                        // Re-trigger saves for all budgets currently shown
                                        budgets.forEach(b => handleUpdateBudget(b.budget_type, b.total_amount));
                                    }}
                                    disabled={isSaving.accounts}
                                    className="w-full flex items-center justify-center gap-2 bg-slate-900 text-white font-black py-3 px-6 rounded-xl hover:bg-primary transition-all disabled:opacity-50 text-[10px] uppercase tracking-widest"
                                >
                                    {isSaving.accounts ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                                    Save Account Limits
                                </button>
                            </div>

                            <div className="mt-8 p-4 bg-slate-50 rounded-2xl border border-slate-100 border-dashed">
                                <div className="flex gap-3">
                                    <AlertCircle className="w-5 h-5 text-slate-400 flex-shrink-0" />
                                    <p className="text-xs text-slate-500 font-medium leading-relaxed">
                                        Accounts are updated automatically whenever a procurement order is marked as "Quoted" by the procurement team.
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Price Visibility Card */}
                    <div id="visibility-section" className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-6 scroll-mt-6">
                        <div className="flex items-center justify-between pb-4 border-b border-slate-100">
                            <div className="flex items-center gap-2">
                                <TrendingUp className="w-5 h-5 text-primary" />
                                <h3 className="font-black text-slate-800 uppercase tracking-wider text-sm">Price Visibility</h3>
                            </div>
                            
                            <div className="flex items-center gap-2">
                                <Building2 className="w-4 h-4 text-slate-400" />
                                <select 
                                    value={visibilityPropertyId}
                                    onChange={(e) => setVisibilityPropertyId(e.target.value)}
                                    className="bg-slate-50 border border-slate-200 text-slate-700 text-[10px] font-black uppercase tracking-widest rounded-xl focus:ring-primary focus:border-primary block p-2 outline-none"
                                >
                                    {properties.map(p => (
                                        <option key={`vis-prop-opt-${p.id}`} value={p.id}>{p.name}</option>
                                    ))}
                                </select>
                            </div>
                        </div>

                        <div className="space-y-6">
                            <div>
                                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">
                                    Roles that can see prices at {properties.find(p => p.id === visibilityPropertyId)?.name}
                                </label>
                                <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                                    {[
                                        'master_admin', 
                                        'org_super_admin', 
                                        'property_admin', 
                                        'procurement', 
                                        'staff', 
                                        'mst', 
                                        'security', 
                                        'soft_service_manager', 
                                        'super_tenant', 
                                        'tenant'
                                    ].map(role => {
                                        const isSystemLocked = ['master_admin', 'org_super_admin', 'procurement'].includes(role);
                                        const currentRoles = allVisibilitySettings[visibilityPropertyId]?.roles || [];
                                        const isSelected = isSystemLocked || currentRoles.includes(role);
                                        const label = role === 'mst' ? 'Technicians' : 
                                                     role === 'tenant' ? 'Client' : 
                                                     role === 'super_tenant' ? 'Super Client' : 
                                                     role === 'property_admin' ? 'Admin' :
                                                     role === 'org_super_admin' ? 'Super Admin' :
                                                     role.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
                                        return (
                                            <button 
                                                key={`role-${role}`}
                                                disabled={isSystemLocked}
                                                onClick={() => {
                                                    if (isSystemLocked) return;
                                                    const updatedRoles = isSelected 
                                                        ? currentRoles.filter(r => r !== role)
                                                        : [...currentRoles, role];
                                                    const updated = {
                                                        ...allVisibilitySettings,
                                                        [visibilityPropertyId]: {
                                                            ...(allVisibilitySettings[visibilityPropertyId] || { users: [] }),
                                                            roles: updatedRoles
                                                        }
                                                    };
                                                    setAllVisibilitySettings(updated);
                                                    handleSaveVisibility(updated);
                                                }}
                                                className={`flex items-center justify-between gap-2 px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest border transition-all ${
                                                    isSystemLocked
                                                        ? 'bg-primary/10 border-primary/30 text-primary shadow-sm opacity-90 cursor-not-allowed'
                                                        : isSelected 
                                                            ? 'bg-primary/10 border-primary text-primary shadow-sm' 
                                                            : 'bg-slate-50 border-slate-100 text-slate-400'
                                                }`}
                                            >
                                                {label}
                                                {isSystemLocked && <Lock className="w-3 h-3 text-slate-400" />}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>

                            <div className="pt-4 border-t border-slate-50">
                                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">
                                    Specific User Exceptions (Global Access)
                                </label>
                                <div className="space-y-4">
                                    <div className="flex flex-col gap-3">
                                        <div className="relative group">
                                            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 group-focus-within:text-primary transition-colors" />
                                            <input 
                                                type="text"
                                                placeholder="Search user to grant global price access..."
                                                value={searchQuery}
                                                onChange={(e) => setSearchQuery(e.target.value)}
                                                className="w-full bg-white border border-slate-200 rounded-2xl py-3 pl-12 pr-4 text-sm font-bold text-slate-700 outline-none focus:ring-4 focus:ring-primary/10 focus:border-primary transition-all shadow-sm placeholder:text-slate-400 placeholder:font-medium"
                                            />
                                        </div>

                                        {searchQuery.length > 0 && (
                                            <div className="max-h-[300px] overflow-y-auto bg-white border border-slate-100 rounded-2xl shadow-2xl p-2 space-y-1 border-t-0 -mt-2 relative z-10 animate-in fade-in slide-in-from-top-2 duration-200">
                                                {(Array.isArray(employees) ? employees : [])
                                                    .filter(emp => {
                                                        const matchesSearch = emp.full_name?.toLowerCase().includes(searchQuery.toLowerCase());
                                                        const isAlreadyAdded = Object.values(allVisibilitySettings).some(s => s.users.includes(emp.id));
                                                        return matchesSearch && !isAlreadyAdded;
                                                    })
                                                    .slice(0, 10)
                                                    .map(emp => {
                                                        const propName = properties.find(p => p.id === emp.property_id)?.name || 'Global';
                                                        return (
                                                            <button 
                                                                key={`emp-res-${emp.id}`}
                                                                onClick={() => {
                                                                    const userPropId = emp.property_id || visibilityPropertyId;
                                                                    const currentPropData = allVisibilitySettings[userPropId] || { roles: [], users: [] };
                                                                    const updated = {
                                                                        ...allVisibilitySettings,
                                                                        [userPropId]: {
                                                                            ...currentPropData,
                                                                            users: [...currentPropData.users, emp.id]
                                                                        }
                                                                    };
                                                                    setAllVisibilitySettings(updated);
                                                                    handleSaveVisibility(updated);
                                                                    setSearchQuery('');
                                                                }}
                                                                className="w-full flex items-center justify-between p-3 hover:bg-primary/5 rounded-xl transition-all group border border-transparent hover:border-primary/10"
                                                            >
                                                                <div className="flex flex-col items-start gap-0.5 text-left">
                                                                    <span className="text-sm font-black text-slate-800 group-hover:text-primary transition-colors">{emp.full_name}</span>
                                                                    <div className="flex items-center gap-2">
                                                                        <span className="text-[9px] font-black uppercase tracking-widest text-slate-400 bg-slate-50 px-1.5 py-0.5 rounded border border-slate-100">{emp.membership_role?.replace(/_/g, ' ')}</span>
                                                                        <span className="text-[9px] font-bold text-slate-500 italic">{propName}</span>
                                                                    </div>
                                                                </div>
                                                                <div className="w-8 h-8 rounded-full bg-slate-50 flex items-center justify-center text-slate-400 group-hover:bg-primary group-hover:text-white transition-all border border-slate-100">
                                                                    <Plus className="w-4 h-4" />
                                                                </div>
                                                            </button>
                                                        );
                                                    })
                                                }
                                            </div>
                                        )}
                                    </div>

                                    {/* Consolidated List of Users */}
                                    <div className="flex flex-wrap gap-3">
                                        {Object.entries(allVisibilitySettings).flatMap(([propId, data]) => 
                                            data.users.map(userId => {
                                                const user = Array.isArray(employees) ? employees.find(e => e.id === userId) : null;
                                                const propName = properties.find(p => p.id === propId)?.name || 'Global';
                                                return (
                                                    <div 
                                                        key={`vis-user-${userId}`} 
                                                        className="flex items-center gap-3 bg-slate-900 text-white pl-4 pr-2 py-2 rounded-2xl text-[10px] font-bold group hover:bg-slate-800 transition-all border border-slate-800 shadow-lg shadow-slate-200/50"
                                                    >
                                                        <div className="flex flex-col">
                                                            <span className="font-black text-xs leading-none mb-1">{user?.full_name || 'User'}</span>
                                                            <div className="flex items-center gap-1.5 opacity-60">
                                                                <span className="uppercase tracking-widest">{user?.membership_role?.replace(/_/g, ' ')}</span>
                                                                <span className="w-1 h-1 rounded-full bg-white/30" />
                                                                <span className="italic">{propName}</span>
                                                            </div>
                                                        </div>
                                                        <button 
                                                            onClick={() => {
                                                                const updated = {
                                                                    ...allVisibilitySettings,
                                                                    [propId]: {
                                                                        ...data,
                                                                        users: data.users.filter(id => id !== userId)
                                                                    }
                                                                };
                                                                setAllVisibilitySettings(updated);
                                                                handleSaveVisibility(updated);
                                                            }}
                                                            className="w-7 h-7 rounded-lg bg-white/10 flex items-center justify-center hover:bg-rose-500 hover:text-white transition-all"
                                                        >
                                                            <X className="w-3.5 h-3.5" />
                                                        </button>
                                                    </div>
                                                );
                                            })
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                

                    {/* Zoho Integration Card */}
                    <div id="zoho-section" className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-6 scroll-mt-6">
                        <div className="flex items-center gap-2 pb-4 border-b border-slate-100">
                            <ShoppingCart className="w-5 h-5 text-primary" />
                            <h3 className="font-black text-slate-800 uppercase tracking-wider text-sm">Zoho Books Integration</h3>
                        </div>

                        <div className="bg-blue-50 p-6 rounded-2xl border border-blue-100 flex gap-4">
                            <div className="w-12 h-12 rounded-xl bg-white flex items-center justify-center shrink-0">
                                <ShoppingCart className="w-6 h-6 text-primary" />
                            </div>
                            <div className="space-y-1">
                                <h4 className="text-sm font-black text-blue-900">PO Generation Active</h4>
                                <p className="text-xs text-blue-700 font-medium leading-relaxed">
                                    You can now generate Purchase Orders automatically in Zoho Books using AI. 
                                    Ensure your <strong>.env</strong> file contains:
                                </p>
                                <ul className="text-[10px] font-bold text-blue-800 space-y-1 pt-2">
                                    <li className="flex items-center gap-2">• ZOHO_CLIENT_ID</li>
                                    <li className="flex items-center gap-2">• ZOHO_CLIENT_SECRET</li>
                                    <li className="flex items-center gap-2">• ZOHO_REFRESH_TOKEN</li>
                                    <li className="flex items-center gap-2">• GOOGLE_AI_API_KEY</li>
                                </ul>
                            </div>
                        </div>

                        <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100 italic text-[10px] text-slate-500">
                            Note: The Zoho Organization ID is requested during the PO generation process to allow flexibility across multiple accounts.
                        </div>
                    </div>

                    {/* Feedback Messages */}
                    <AnimatePresence>
                        {message.text && (
                            <motion.div 
                                initial={{ opacity: 0, y: 20 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: 10 }}
                                className={`fixed bottom-6 right-6 flex items-center gap-3 px-6 py-4 rounded-2xl text-sm font-black shadow-2xl z-50 ${
                                    message.type === 'success' 
                                        ? 'bg-emerald-500 text-white' 
                                        : 'bg-rose-500 text-white'
                                }`}
                            >
                                {message.type === 'success' ? <CheckCircle2 className="w-5 h-5" /> : <AlertCircle className="w-5 h-5" />}
                                {message.text}
                            </motion.div>
                        )}
                    </AnimatePresence>
                </>
            ) : (
                <div className="flex flex-col items-center justify-center py-24 bg-white rounded-3xl border border-slate-100 shadow-sm">
                    <div className="w-16 h-16 bg-slate-50 rounded-2xl flex items-center justify-center mb-4">
                        <AlertCircle className="w-8 h-8 text-slate-300" />
                    </div>
                    <p className="text-slate-500 font-bold uppercase tracking-widest text-[10px]">No settings found for this property</p>
                </div>
            )}
        </div>
    );
}
