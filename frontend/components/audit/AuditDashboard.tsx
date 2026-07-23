'use client';

import React, { useState, useEffect } from 'react';
import { 
    FileText, Calendar, CheckCircle2, AlertCircle, 
    Download, Search, Filter, Loader2, ChevronRight,
    PieChart, Activity, Building2, Package, ExternalLink
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import InternalAuditView from './InternalAuditView';

interface AuditItem {
    id: string;
    system_name: string;
    scheduled_date: string;
    status: string;
    has_report: boolean;
    attachment_url: string | null;
}

interface AuditSummary {
    total: number;
    completed: number;
    pending: number;
    compliance_pct: number;
}

interface Props {
    organizationId: string;
    propertyId?: string;
    isDark?: boolean;
}

export default function AuditDashboard({ organizationId, propertyId, isDark = true }: Props) {
    const [auditMonth, setAuditMonth] = useState(new Date().toISOString().slice(0, 7));
    const [summary, setSummary] = useState<AuditSummary | null>(null);
    const [items, setItems] = useState<AuditItem[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [statusFilter, setStatusFilter] = useState<'all' | 'compliant' | 'missing'>('all');
    const [view, setView] = useState<'digital' | 'internal'>('digital');

    useEffect(() => {
        fetchAudit();
    }, [auditMonth, organizationId, propertyId]);

    const fetchAudit = async () => {
        setIsLoading(true);
        try {
            let url = `/api/ppm/audit?organization_id=${organizationId}&audit_month=${auditMonth}`;
            if (propertyId) url += `&property_id=${propertyId}`;
            
            const res = await fetch(url);
            const data = await res.json();
            if (data.summary) {
                setSummary(data.summary);
                setItems(data.items || []);
            }
        } catch (err) {
            console.error('Failed to fetch audit:', err);
        } finally {
            setIsLoading(false);
        }
    };

    const handleExport = () => {
        if (!items.length) return;
        
        const headers = ['System Name', 'Scheduled Date', 'Status', 'Report Attached', 'Attachment URL'];
        const rows = items.map(item => [
            item.system_name,
            item.scheduled_date,
            item.status,
            item.has_report ? 'Yes' : 'No',
            item.attachment_url || 'N/A'
        ]);

        const csvContent = [
            headers.join(','),
            ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
        ].join('\n');

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        link.setAttribute('download', `PPM_Audit_${auditMonth}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    const filteredItems = items.filter(item => {
        const matchesSearch = item.system_name.toLowerCase().includes(searchTerm.toLowerCase());
        const matchesStatus = statusFilter === 'all' || 
            (statusFilter === 'compliant' && item.has_report) || 
            (statusFilter === 'missing' && !item.has_report);
        return matchesSearch && matchesStatus;
    });

    const containerVariants = {
        hidden: { opacity: 0, y: 20 },
        visible: { 
            opacity: 1, 
            y: 0,
            transition: { staggerChildren: 0.1 }
        }
    };

    const itemVariants = {
        hidden: { opacity: 0, x: -20 },
        visible: { opacity: 1, x: 0 }
    };

    return (
        <div className="flex flex-col h-full min-h-screen bg-white text-slate-900">
            {/* Header with Tab Switcher */}
            <div className="p-6 border-b border-slate-100 bg-white relative z-10">
                <div className="flex items-center justify-between mb-6">
                    <div className="flex items-center gap-3">
                        <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${isDark ? 'bg-primary/20 text-primary' : 'bg-primary text-white shadow-lg'}`}>
                            <Activity className="w-6 h-6" />
                        </div>
                        <div>
                            <h1 className="text-xl font-black uppercase tracking-tight text-slate-900">Compliance Audit</h1>
                            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                                {view === 'digital' ? 'PPM Digital Verification Engine' : 'Internal Audit Checklist'}
                            </p>
                        </div>
                    </div>

                    <div className="flex items-center gap-2 bg-slate-100 p-1 rounded-xl">
                        <button 
                            onClick={() => setView('digital')}
                            className={`px-4 py-2 rounded-lg text-xs font-black uppercase tracking-widest transition-all ${view === 'digital' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500 hover:text-slate-700'}`}
                        >
                            Digital Audit
                        </button>
                        <button 
                            onClick={() => setView('internal')}
                            className={`px-4 py-2 rounded-lg text-xs font-black uppercase tracking-widest transition-all ${view === 'internal' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500 hover:text-slate-700'}`}
                        >
                            Internal Audit
                        </button>
                    </div>
                </div>

                {view === 'digital' && (
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                        <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2">
                            <Calendar className="w-4 h-4 text-slate-400" />
                            <input 
                                type="month" 
                                value={auditMonth}
                                onChange={(e) => setAuditMonth(e.target.value)}
                                className="bg-transparent border-none outline-none text-xs font-bold text-slate-900 uppercase tracking-wider"
                            />
                        </div>
                        <button 
                            onClick={handleExport}
                            disabled={isLoading || !items.length}
                            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-white text-[10px] font-black uppercase tracking-widest shadow-lg shadow-primary/20 hover:-translate-y-1 transition-all disabled:opacity-50"
                        >
                            <Download className="w-4 h-4" />
                            Export Audit
                        </button>
                    </div>
                )}
            </div>

            {/* Content Area */}
            <div className="flex-1 overflow-auto p-6 bg-slate-50">
                {view === 'internal' ? (
                    <InternalAuditView organizationId={organizationId} propertyId={propertyId || ''} />
                ) : (
                    <AnimatePresence mode="wait">
                        {isLoading ? (
                            <motion.div 
                                key="loader"
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                                className="h-[400px] flex flex-col items-center justify-center space-y-4"
                            >
                                <div className="relative">
                                    <div className="w-16 h-16 rounded-full border-4 border-primary/20 border-t-primary animate-spin" />
                                    <Activity className="absolute inset-0 m-auto w-6 h-6 text-primary animate-pulse" />
                                </div>
                                <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.3em] animate-pulse">Analyzing Compliance Data...</p>
                            </motion.div>
                        ) : (
                            <motion.div 
                                key="content"
                                variants={containerVariants}
                                initial="hidden"
                                animate="visible"
                                className="space-y-6"
                            >
                                {/* KPI Grid */}
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                                    {[
                                        { label: 'Total Tasks', value: summary?.total || 0, icon: Package, color: 'text-primary', sub: 'Scheduled', bg: 'bg-white' },
                                        { label: 'Completed', value: summary?.completed || 0, icon: CheckCircle2, color: 'text-emerald-500', sub: 'With Reports', bg: 'bg-white' },
                                        { label: 'Pending', value: summary?.pending || 0, icon: AlertCircle, color: 'text-amber-500', sub: 'Missing Reports', bg: 'bg-white' },
                                        { label: 'Compliance', value: `${summary?.compliance_pct || 0}%`, icon: PieChart, color: 'text-blue-500', sub: 'Audit Score', bg: 'bg-white' }
                                    ].map((kpi, idx) => (
                                        <motion.div 
                                            key={kpi.label}
                                            variants={itemVariants}
                                            className={`${kpi.bg} border border-slate-200 p-6 rounded-[2rem] relative overflow-hidden group hover:shadow-xl hover:shadow-slate-200/50 transition-all shadow-sm`}
                                        >
                                            <div className="absolute -right-4 -top-4 w-24 h-24 bg-white/5 rounded-full blur-2xl group-hover:bg-white/10 transition-all" />
                                            <div className="flex items-start justify-between relative z-10">
                                                <div>
                                                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">{kpi.label}</p>
                                                    <h3 className="text-3xl font-black tracking-tighter">{kpi.value}</h3>
                                                    <p className={`text-[9px] font-bold mt-1 uppercase tracking-wider ${kpi.color}`}>{kpi.sub}</p>
                                                </div>
                                                <div className={`p-3 rounded-2xl bg-white/5 ${kpi.color}`}>
                                                    <kpi.icon className="w-5 h-5" />
                                                </div>
                                            </div>
                                        </motion.div>
                                    ))}
                                </div>

                                {/* Checklist Section */}
                                <div className="bg-white border border-slate-200 rounded-[2.5rem] overflow-hidden shadow-sm">
                                    <div className="p-6 border-b border-slate-100 flex flex-col md:flex-row md:items-center justify-between gap-4">
                                        <div className="flex items-center gap-3">
                                            <div className="w-8 h-8 rounded-xl bg-slate-50 flex items-center justify-center text-primary">
                                                <Activity className="w-4 h-4" />
                                            </div>
                                            <h3 className="text-sm font-black uppercase tracking-widest text-slate-900">Audit Checklist</h3>
                                        </div>

                                        <div className="flex items-center gap-3">
                                            <div className="relative">
                                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                                                <input 
                                                    type="text"
                                                    placeholder="Search system..."
                                                    value={searchTerm}
                                                    onChange={(e) => setSearchTerm(e.target.value)}
                                                    className="bg-slate-50 border border-slate-200 rounded-xl py-2 pl-10 pr-4 text-xs font-bold focus:ring-2 focus:ring-primary/20 outline-none w-full md:w-64 text-slate-900"
                                                />
                                            </div>
                                            <select 
                                                value={statusFilter}
                                                onChange={(e) => setStatusFilter(e.target.value as any)}
                                                className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-xs font-bold focus:ring-2 focus:ring-primary/20 outline-none text-slate-900"
                                            >
                                                <option value="all">All Items</option>
                                                <option value="compliant">Compliant (Reported)</option>
                                                <option value="missing">Non-Compliant (Missing)</option>
                                            </select>
                                        </div>
                                    </div>

                                    <div className="overflow-x-auto">
                                        <table className="w-full text-left">
                                            <thead>
                                                <tr className="bg-slate-50 border-b border-slate-100">
                                                    <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">System Name</th>
                                                    <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Planned Date</th>
                                                    <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Status</th>
                                                    <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Verification</th>
                                                    <th className="px-6 py-4 text-right"></th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-white/5">
                                                {filteredItems.length === 0 ? (
                                                    <tr>
                                                        <td colSpan={5} className="px-6 py-12 text-center">
                                                            <div className="flex flex-col items-center gap-3">
                                                                <div className="w-12 h-12 rounded-2xl bg-white/5 flex items-center justify-center">
                                                                    <Search className="w-6 h-6 text-slate-500 opacity-20" />
                                                                </div>
                                                                <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">No audit items match criteria</p>
                                                            </div>
                                                        </td>
                                                    </tr>
                                                ) : (
                                                    filteredItems.map((item) => (
                                                        <motion.tr 
                                                            key={item.id}
                                                            initial={{ opacity: 0 }}
                                                            animate={{ opacity: 1 }}
                                                            className="hover:bg-white/[0.02] transition-all group"
                                                        >
                                                            <td className="px-6 py-4">
                                                                <div className="flex items-center gap-3">
                                                                    <div className={`w-8 h-8 rounded-xl flex items-center justify-center font-black text-[10px] ${item.has_report ? 'bg-emerald-500/10 text-emerald-500' : 'bg-rose-500/10 text-rose-500'}`}>
                                                                        {item.system_name[0]}
                                                                    </div>
                                                                    <span className="text-xs font-black tracking-tight">{item.system_name}</span>
                                                                </div>
                                                            </td>
                                                            <td className="px-6 py-4">
                                                                <div className="flex flex-col">
                                                                    <span className="text-xs font-bold text-slate-300">
                                                                        {new Date(item.scheduled_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                                                                    </span>
                                                                    <span className="text-[9px] text-slate-500 font-bold uppercase tracking-widest">Scheduled</span>
                                                                </div>
                                                            </td>
                                                            <td className="px-6 py-4">
                                                                <span className={`text-[9px] font-black uppercase tracking-widest px-2.5 py-1 rounded-full border ${
                                                                    item.status === 'completed' ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-500' : 
                                                                    item.status === 'in_progress' ? 'bg-blue-500/10 border-blue-500/20 text-blue-500' : 
                                                                    'bg-amber-500/10 border-amber-500/20 text-amber-500'
                                                                }`}>
                                                                    {item.status}
                                                                </span>
                                                            </td>
                                                            <td className="px-6 py-4">
                                                                <div className="flex items-center gap-2">
                                                                    {item.has_report ? (
                                                                        <div className="flex items-center gap-2 text-emerald-500 bg-emerald-500/5 px-3 py-1.5 rounded-xl border border-emerald-500/10">
                                                                            <CheckCircle2 className="w-3 h-3" />
                                                                            <span className="text-[9px] font-black uppercase tracking-widest">Report Verified</span>
                                                                        </div>
                                                                    ) : (
                                                                        <div className="flex items-center gap-2 text-rose-400 bg-rose-500/5 px-3 py-1.5 rounded-xl border border-rose-500/10">
                                                                            <AlertCircle className="w-3 h-3" />
                                                                            <span className="text-[9px] font-black uppercase tracking-widest">Missing Report</span>
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            </td>
                                                            <td className="px-6 py-4 text-right">
                                                                {item.attachment_url && (
                                                                    <a 
                                                                        href={item.attachment_url} 
                                                                        target="_blank" 
                                                                        rel="noopener noreferrer"
                                                                        className="inline-flex items-center gap-2 p-2 rounded-lg bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white transition-all"
                                                                    >
                                                                        <ExternalLink className="w-4 h-4" />
                                                                    </a>
                                                                )}
                                                            </td>
                                                        </motion.tr>
                                                    ))
                                                )}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>
                )}
            </div>
        </div>
    );
}
