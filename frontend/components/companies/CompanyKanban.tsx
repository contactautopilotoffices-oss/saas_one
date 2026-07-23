'use client';

import React, { useState, useEffect } from 'react';
import { 
    Plus, Building2, User, Users, Search, 
    ArrowRight, CreditCard, Loader2, X,
    ChevronRight, LayoutGrid, ListFilter,
    Clock, Wallet, MoreVertical, Trash2,
    Zap
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import CompanyCreditHistory from './CompanyCreditHistory';

interface Company {
    id: string;
    name: string;
    logo_url?: string;
    property_id: string;
    organization_id: string;
    members: { user_id: string; user: { id: string, full_name: string, email: string } }[];
    credits?: { monthly_hours: number; remaining_hours: number };
}

interface Tenant {
    id: string;
    full_name: string;
    email: string;
    user_photo_url?: string;
}

interface Props {
    propertyId: string;
    organizationId: string;
}

export default function CompanyKanban({ propertyId, organizationId }: Props) {
    const [companies, setCompanies] = useState<Company[]>([]);
    const [allTenants, setAllTenants] = useState<Tenant[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isCreating, setIsCreating] = useState(false);
    const [newCompanyName, setNewCompanyName] = useState('');
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedCompany, setSelectedCompany] = useState<Company | null>(null);
    const [creditModalOpen, setCreditModalOpen] = useState(false);
    const [monthlyHours, setMonthlyHours] = useState('5');
    const [remainingHours, setRemainingHours] = useState('5');
    const [historyModalOpen, setHistoryModalOpen] = useState(false);
    const [historyTarget, setHistoryTarget] = useState<{ id: string, name: string } | null>(null);

    useEffect(() => {
        fetchData();
    }, [propertyId, organizationId]);

    const fetchData = async () => {
        setIsLoading(true);
        try {
            const [companiesRes, tenantsRes, creditsRes] = await Promise.all([
                fetch(`/api/companies?propertyId=${propertyId}`),
                fetch(`/api/properties/${propertyId}/tenants`),
                fetch(`/api/meeting-room-credits?propertyId=${propertyId}`)
            ]);
            
            const companiesData = await companiesRes.json();
            const tenantsData = await tenantsRes.json();
            const creditsData = await creditsRes.json();

            // Merge credits into companies
            const mappedCompanies = (companiesData || []).map((c: Company) => {
                const credit = (creditsData.credits || []).find((cr: any) => cr.company_id === c.id);
                return {
                    ...c,
                    credits: credit ? {
                        monthly_hours: credit.monthly_hours,
                        remaining_hours: credit.remaining_hours
                    } : { monthly_hours: 0, remaining_hours: 0 }
                };
            });

            setCompanies(mappedCompanies);
            setAllTenants(tenantsData.tenants || []);
        } catch (error) {
            console.error('Failed to fetch data:', error);
        } finally {
            setIsLoading(false);
        }
    };

    const handleCreateCompany = async () => {
        if (!newCompanyName.trim()) return;
        try {
            const res = await fetch('/api/companies', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    property_id: propertyId,
                    organization_id: organizationId,
                    name: newCompanyName
                })
            });
            if (res.ok) {
                setNewCompanyName('');
                setIsCreating(false);
                fetchData();
            }
        } catch (error) {
            console.error('Failed to create company:', error);
        }
    };

    const [draggedTenantId, setDraggedTenantId] = useState<string | null>(null);

    const handleAssignMember = async (companyId: string, userId: string) => {
        try {
            const res = await fetch(`/api/companies/${companyId}/members`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ user_id: userId, action: 'add' })
            });
            if (res.ok) fetchData();
        } catch (error) {
            console.error('Failed to assign member:', error);
        }
    };

    const handleRemoveMember = async (companyId: string, userId: string) => {
        try {
            const res = await fetch(`/api/companies/${companyId}/members`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ user_id: userId, action: 'remove' })
            });
            if (res.ok) fetchData();
        } catch (error) {
            console.error('Failed to remove member:', error);
        }
    };

    const handleUpdateCredits = async () => {
        if (!selectedCompany) return;
        try {
                        const res = await fetch(`/api/meeting-room-credits`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    propertyId,
                    companyId: selectedCompany.id,
                    monthlyHours: parseFloat(monthlyHours),
                    remainingHours: parseFloat(remainingHours)
                })
            });
            if (res.ok) {
                setCreditModalOpen(false);
                fetchData();
            }
        } catch (error) {
            console.error('Failed to update credits:', error);
        }
    };

    const unassignedTenants = allTenants.filter(t => 
        !companies.some(c => c.members.some(m => m.user_id === t.id))
    );

    const filteredUnassigned = unassignedTenants.filter(t => 
        t.full_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        t.email.toLowerCase().includes(searchTerm.toLowerCase())
    );

    if (isLoading) {
        return (
            <div className="flex flex-col items-center justify-center py-24 space-y-4">
                <Loader2 className="w-8 h-8 text-primary animate-spin" />
                <p className="text-slate-400 font-black uppercase tracking-widest text-[10px]">Loading Companies...</p>
            </div>
        );
    }

    return (
        <div className="space-y-8">
            {/* Header section with glassmorphism */}
            <div className="flex items-center justify-between bg-white/60 backdrop-blur-xl p-6 rounded-[2.5rem] border border-white/40 shadow-2xl shadow-slate-200/50">
                <div className="flex items-center gap-4">
                    <div className="w-14 h-14 rounded-3xl bg-primary flex items-center justify-center shadow-lg shadow-primary/20 rotate-3">
                        <Building2 className="w-7 h-7 text-white -rotate-3" />
                    </div>
                    <div>
                        <h2 className="text-2xl font-black text-slate-900 tracking-tight">Company Management</h2>
                        <p className="text-slate-500 font-bold text-xs uppercase tracking-widest flex items-center gap-2">
                            Shared Meeting Room Credits <ArrowRight className="w-3 h-3" /> {companies.length} Companies
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-4">
                    <div className="relative group">
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 group-focus-within:text-primary transition-colors" />
                        <input 
                            type="text"
                            placeholder="Search clients..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="pl-11 pr-6 py-3.5 bg-white/80 border border-slate-200 rounded-[1.5rem] text-sm font-bold text-slate-700 focus:outline-none focus:ring-4 focus:ring-primary/10 transition-all w-64 shadow-inner"
                        />
                    </div>
                    
                    <button 
                        onClick={() => setIsCreating(true)}
                        className="flex items-center gap-2 px-6 py-4 bg-slate-900 text-white rounded-[1.5rem] font-black text-xs uppercase tracking-widest hover:bg-slate-800 transition-all hover:scale-[1.02] active:scale-[0.98] shadow-xl shadow-slate-900/10"
                    >
                        <Plus className="w-4 h-4" />
                        New Company
                    </button>
                </div>
            </div>

            {/* Kanban Board */}
            <div className="flex gap-8 overflow-x-auto pb-12 pt-4 snap-x px-4 -mx-4 no-scrollbar">
                
                {/* Unassigned Clients Column */}
                <div className="w-96 shrink-0 snap-start space-y-6">
                    <div className="flex items-center justify-between px-4">
                        <div className="flex items-center gap-3">
                            <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                            <h3 className="text-sm font-black text-slate-800 uppercase tracking-widest">Unassigned Clients</h3>
                        </div>
                        <span className="text-[10px] font-black bg-slate-100 text-slate-500 px-2 py-1 rounded-full uppercase tracking-widest">
                            {filteredUnassigned.length} Clients
                        </span>
                    </div>

                    <div className="bg-slate-50/50 border-2 border-dashed border-slate-200 rounded-[2.5rem] p-4 min-h-[500px] space-y-3">
                        {filteredUnassigned.length === 0 ? (
                            <div className="py-12 text-center space-y-3 opacity-40">
                                <Users className="w-10 h-10 mx-auto text-slate-300" />
                                <p className="text-[10px] font-bold uppercase tracking-widest">All clients assigned</p>
                            </div>
                        ) : (
                            filteredUnassigned.map(tenant => (
                                <motion.div 
                                    layoutId={tenant.id}
                                    key={tenant.id}
                                    draggable
                                    onDragStart={() => setDraggedTenantId(tenant.id)}
                                    className="bg-white p-4 rounded-3xl border border-slate-100 shadow-sm hover:shadow-xl hover:scale-[1.01] transition-all cursor-move group"
                                >
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-3">
                                            <div className="w-10 h-10 rounded-2xl bg-amber-50 flex items-center justify-center border border-amber-100/50">
                                                <User className="w-5 h-5 text-amber-500" />
                                            </div>
                                            <div>
                                                <p className="text-sm font-black text-slate-800">{tenant.full_name}</p>
                                                <p className="text-[10px] font-bold text-slate-400 truncate w-32">{tenant.email}</p>
                                            </div>
                                        </div>
                                        <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                                            <MoreVertical className="w-4 h-4 text-slate-300" />
                                        </div>
                                    </div>
                                </motion.div>
                            ))
                        )}
                    </div>
                </div>

                {/* Company Columns */}
                <AnimatePresence>
                    {companies.map((company, index) => (
                        <motion.div 
                            initial={{ opacity: 0, x: 50 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ delay: index * 0.1 }}
                            key={company.id}
                            className="w-96 shrink-0 snap-start space-y-6"
                        >
                            <div className="flex items-center justify-between px-4">
                                <div className="flex items-center gap-3">
                                    <div className="w-2 h-2 rounded-full bg-emerald-400" />
                                    <h3 className="text-sm font-black text-slate-800 uppercase tracking-widest truncate max-w-[180px]">{company.name}</h3>
                                </div>
                                <div className="flex items-center gap-2">
                                    <button 
                                        onClick={() => {
                                            setHistoryTarget({ id: company.id, name: company.name });
                                            setHistoryModalOpen(true);
                                        }}
                                        className="p-1.5 bg-slate-50 text-slate-400 rounded-xl hover:bg-slate-100 transition-colors border border-slate-100"
                                        title="View History"
                                    >
                                        <Clock className="w-4 h-4" />
                                    </button>
                                    <button 
                                        onClick={() => {
                                            setSelectedCompany(company);
                                            setMonthlyHours(String(company.credits?.monthly_hours || 0));
                                            setRemainingHours(String(company.credits?.remaining_hours || 0));
                                            setCreditModalOpen(true);
                                        }}
                                        className="text-[10px] font-black bg-emerald-50 text-emerald-600 px-3 py-1.5 rounded-2xl uppercase tracking-widest hover:bg-emerald-100 transition-colors flex items-center gap-1.5 border border-emerald-100/50"
                                    >
                                        <Wallet className="w-3 h-3" />
                                        {company.credits?.remaining_hours || 0}h / {company.credits?.monthly_hours || 0}h
                                    </button>
                                </div>
                            </div>

                            <div 
                                className="bg-white/80 border border-slate-200 rounded-[2.5rem] p-4 min-h-[500px] shadow-2xl shadow-slate-200/40 relative overflow-hidden group/col"
                                onDragOver={(e) => e.preventDefault()}
                                onDrop={() => {
                                    if (draggedTenantId) {
                                        handleAssignMember(company.id, draggedTenantId);
                                        setDraggedTenantId(null);
                                    }
                                }}
                            >
                                {/* Drag Target Overlay */}
                                <div className="absolute inset-0 bg-primary/5 opacity-0 group-hover/col:opacity-100 transition-opacity pointer-events-none flex flex-col items-center justify-center gap-3">
                                    <div className="w-12 h-12 rounded-full bg-primary/20 flex items-center justify-center border-2 border-dashed border-primary/40">
                                        <ArrowRight className="w-6 h-6 text-primary" />
                                    </div>
                                    <p className="text-[10px] font-black text-primary uppercase tracking-[0.2em]">Drop to align</p>
                                </div>

                                <div className="space-y-3 relative z-10">
                                    {company.members.length === 0 ? (
                                        <div className="py-12 text-center space-y-3 opacity-40">
                                            <Users className="w-10 h-10 mx-auto text-slate-300" />
                                            <p className="text-[10px] font-bold uppercase tracking-widest">No clients aligned yet</p>
                                        </div>
                                    ) : (
                                        company.members.map(member => (
                                            <motion.div 
                                                layoutId={member.user_id}
                                                key={member.user_id}
                                                className="bg-slate-50/50 p-4 rounded-3xl border border-slate-100/50 hover:bg-white hover:shadow-lg transition-all group"
                                            >
                                                <div className="flex items-center justify-between">
                                                    <div className="flex items-center gap-3">
                                                        <div className="w-10 h-10 rounded-2xl bg-white flex items-center justify-center border border-slate-100 shadow-sm">
                                                            <User className="w-5 h-5 text-slate-400" />
                                                        </div>
                                                        <div>
                                                            <p className="text-sm font-black text-slate-800">{member.user.full_name}</p>
                                                            <p className="text-[10px] font-bold text-slate-400 truncate w-32">{member.user.email}</p>
                                                        </div>
                                                    </div>
                                                    <button 
                                                        onClick={() => handleRemoveMember(company.id, member.user_id)}
                                                        className="opacity-0 group-hover:opacity-100 p-2 text-rose-400 hover:bg-rose-50 rounded-xl transition-all"
                                                    >
                                                        <Trash2 className="w-4 h-4" />
                                                    </button>
                                                </div>
                                            </motion.div>
                                        ))
                                    )}
                                </div>
                            </div>
                        </motion.div>
                    ))}
                </AnimatePresence>

                {/* Add column placeholder */}
                <div className="w-96 shrink-0 snap-start h-[500px] mt-12 border-4 border-dashed border-slate-100 rounded-[2.5rem] flex flex-col items-center justify-center gap-4 group hover:border-slate-200 transition-all">
                    <div className="w-16 h-16 rounded-full bg-slate-50 flex items-center justify-center group-hover:scale-110 transition-transform">
                        <Building2 className="w-8 h-8 text-slate-200" />
                    </div>
                    <p className="text-xs font-black text-slate-200 uppercase tracking-widest">Add another company</p>
                </div>
            </div>

            {/* Credit Modal */}
            <AnimatePresence>
                {creditModalOpen && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                        <motion.div 
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
                            onClick={() => setCreditModalOpen(false)}
                        />
                        <motion.div 
                            initial={{ opacity: 0, scale: 0.9, y: 20 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.9, y: 20 }}
                            className="relative w-full max-w-md bg-white rounded-[2.5rem] shadow-2xl p-8 overflow-hidden"
                        >
                            {/* Modal Header */}
                            <div className="flex items-center justify-between mb-8">
                                <div className="flex items-center gap-4">
                                    <div className="w-12 h-12 rounded-2xl bg-emerald-50 flex items-center justify-center border border-emerald-100">
                                        <CreditCard className="w-6 h-6 text-emerald-500" />
                                    </div>
                                    <div>
                                        <h4 className="text-xl font-black text-slate-900 tracking-tight">Manage Credits</h4>
                                        <p className="text-xs font-bold text-slate-500 uppercase tracking-widest">{selectedCompany?.name}</p>
                                    </div>
                                </div>
                                <button onClick={() => setCreditModalOpen(false)} className="p-3 bg-slate-50 rounded-2xl hover:bg-slate-100 transition-all">
                                    <X className="w-5 h-5 text-slate-400" />
                                </button>
                            </div>

                            {/* Modal Body */}
                            <div className="space-y-6">
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-4">Monthly Quota</label>
                                        <div className="relative">
                                            <Clock className="absolute left-5 top-1/2 -translate-y-1/2 w-4 h-4 text-primary" />
                                            <input 
                                                type="number"
                                                value={monthlyHours}
                                                onChange={(e) => setMonthlyHours(e.target.value)}
                                                className="w-full pl-12 pr-4 py-4 bg-slate-50 border border-slate-100 rounded-3xl text-sm font-black text-slate-800 focus:outline-none focus:ring-4 focus:ring-primary/10 transition-all"
                                                placeholder="Quota..."
                                            />
                                        </div>
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-4">Current Balance</label>
                                        <div className="relative">
                                            <Zap className="absolute left-5 top-1/2 -translate-y-1/2 w-4 h-4 text-emerald-500" />
                                            <input 
                                                type="number"
                                                value={remainingHours}
                                                onChange={(e) => setRemainingHours(e.target.value)}
                                                className="w-full pl-12 pr-4 py-4 bg-slate-50 border border-slate-100 rounded-3xl text-sm font-black text-slate-800 focus:outline-none focus:ring-4 focus:ring-emerald-500/10 transition-all"
                                                placeholder="Balance..."
                                            />
                                        </div>
                                    </div>
                                </div>

                                <div className="bg-amber-50 p-6 rounded-3xl border border-amber-100/50 space-y-2">
                                    <p className="text-[10px] font-black text-amber-600 uppercase tracking-widest flex items-center gap-2">
                                        <ListFilter className="w-3 h-3" /> Refill Logic
                                    </p>
                                    <p className="text-xs font-bold text-amber-700 leading-relaxed">
                                        <b>Monthly Quota:</b> Hours reset to this value on the 1st of every month.<br/>
                                        <b>Current Balance:</b> Use this to manually refill or override the available hours right now.
                                    </p>
                                </div>

                                <button 
                                    onClick={handleUpdateCredits}
                                    className="w-full py-5 bg-primary text-white rounded-3xl font-black text-sm uppercase tracking-[0.2em] shadow-xl shadow-primary/20 hover:scale-[1.02] active:scale-[0.98] transition-all"
                                >
                                    Update Credits & Refill
                                </button>
                            </div>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>

            {/* Create Company Modal */}
            <AnimatePresence>
                {isCreating && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                        <motion.div 
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
                            onClick={() => setIsCreating(false)}
                        />
                        <motion.div 
                            initial={{ opacity: 0, scale: 0.9, y: 20 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.9, y: 20 }}
                            className="relative w-full max-w-md bg-white rounded-[2.5rem] shadow-2xl p-8 overflow-hidden"
                        >
                            <div className="flex items-center justify-between mb-8">
                                <h4 className="text-xl font-black text-slate-900 tracking-tight uppercase tracking-widest">Add New Company</h4>
                                <button onClick={() => setIsCreating(false)} className="p-3 bg-slate-50 rounded-2xl hover:bg-slate-100 transition-all">
                                    <X className="w-5 h-5 text-slate-400" />
                                </button>
                            </div>

                            <div className="space-y-6">
                                <div className="space-y-2">
                                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-4">Company Name</label>
                                    <input 
                                        type="text"
                                        value={newCompanyName}
                                        onChange={(e) => setNewCompanyName(e.target.value)}
                                        className="w-full px-8 py-5 bg-slate-50 border border-slate-100 rounded-3xl text-lg font-black text-slate-800 focus:outline-none focus:ring-4 focus:ring-primary/10 transition-all"
                                        placeholder="e.g. Google India"
                                    />
                                </div>

                                <button 
                                    onClick={handleCreateCompany}
                                    className="w-full py-5 bg-slate-900 text-white rounded-3xl font-black text-sm uppercase tracking-[0.2em] shadow-xl shadow-slate-900/20 hover:scale-[1.02] active:scale-[0.98] transition-all"
                                >
                                    Create Company
                                </button>
                            </div>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>

            {/* History Modal */}
            <AnimatePresence>
                {historyModalOpen && historyTarget && (
                    <CompanyCreditHistory 
                        propertyId={propertyId}
                        companyId={historyTarget.id}
                        title={historyTarget.name}
                        onClose={() => setHistoryModalOpen(false)}
                    />
                )}
            </AnimatePresence>
        </div>
    );
}
