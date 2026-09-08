'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
    Users, LogIn, LogOut, Search, FileDown,
    User, Truck, Building2, X, ChevronDown, MapPin, Plus, CheckCircle2
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import VMSKiosk from './VMSKiosk';
import { useAuth } from '@/frontend/context/AuthContext';

interface VMSOrgVisitorDashboardProps {
    orgId: string;
}

interface VisitorLog {
    id: string;
    visitor_id: string;
    category: string;
    name: string;
    mobile: string;
    coming_from: string;
    whom_to_meet: string;
    host_id?: string;
    created_by?: string;
    creator?: { id: string; full_name?: string; email?: string } | null;
    photo_url: string;
    checkin_time: string;
    checkout_time: string | null;
    status: string;
    approval_status?: string;
    property_id: string;
    properties?: { id: string; name: string } | null;
}

interface Property {
    id: string;
    name: string;
}

type DateFilter = 'today' | 'yesterday' | 'week' | 'month' | 'custom' | 'all';

const VMSOrgVisitorDashboard: React.FC<VMSOrgVisitorDashboardProps> = ({ orgId }) => {
    const { user, membership } = useAuth();
    const [visitors, setVisitors] = useState<VisitorLog[]>([]);
    const [properties, setProperties] = useState<Property[]>([]);

    const isUserHost = (visitor: VisitorLog) => {
        if (!user) return false;
        const currentUserId = user.id;
        const currentUserEmail = (user.email || '').toLowerCase();
        const currentUserName = (user.user_metadata?.full_name || '').toLowerCase();

        if ((visitor as any).host_id && String((visitor as any).host_id) === String(currentUserId)) return true;
        if ((visitor as any).whom_to_meet_uid && String((visitor as any).whom_to_meet_uid) === String(currentUserId)) return true;
        if (visitor.whom_to_meet) {
            const wtm = visitor.whom_to_meet.toLowerCase();
            if (currentUserEmail && wtm.includes(currentUserEmail)) return true;
            if (currentUserName && (wtm === currentUserName || wtm.includes(currentUserName))) return true;
        }
        if (!(visitor as any).host_id && !(visitor as any).whom_to_meet_uid) {
            const userRole = (membership?.org_role || '').toLowerCase();
            const isElevated = ['ops_super_admin', 'org_super_admin', 'master_admin', 'org_admin', 'property_admin', 'security'].includes(userRole);
            if (isElevated) return true;
        }
        return false;
    };
    const [stats, setStats] = useState({ total_visitors: 0, checked_in: 0, checked_out: 0 });
    const [isLoading, setIsLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState<'all' | 'checked_in' | 'checked_out'>('all');
    const [dateFilter, setDateFilter] = useState<DateFilter>('today');
    const [customDate, setCustomDate] = useState('');
    const [propertyFilter, setPropertyFilter] = useState('');
    const [selectedVisitor, setSelectedVisitor] = useState<VisitorLog | null>(null);
    const [actionLoading, setActionLoading] = useState(false);
    const [showCheckInModal, setShowCheckInModal] = useState(false);
    const [selectedCheckInPropertyId, setSelectedCheckInPropertyId] = useState<string>('');

    // Debounce search query - wait 300ms after user stops typing before searching
    useEffect(() => {
        const timer = setTimeout(() => {
            setDebouncedSearch(searchQuery);
        }, 300);
        return () => clearTimeout(timer);
    }, [searchQuery]);

    const fetchVisitors = useCallback(async () => {
        try {
            const params = new URLSearchParams({ status: statusFilter, date: dateFilter });
            if (dateFilter === 'custom' && customDate) params.set('customDate', customDate);
            if (debouncedSearch) params.set('search', debouncedSearch);
            if (propertyFilter) params.set('propertyId', propertyFilter);

            const res = await fetch(`/api/vms/org/${orgId}?${params}`);
            const data = await res.json();

            if (res.ok) {
                setVisitors(data.visitors || []);
                setStats(data.stats || { total_visitors: 0, checked_in: 0, checked_out: 0 });
                if (data.properties?.length) setProperties(data.properties);
            }
        } catch (err) {
            console.error('[VMS Org] Fetch error:', err);
        } finally {
            setIsLoading(false);
        }
    }, [orgId, statusFilter, dateFilter, customDate, debouncedSearch, propertyFilter]);

    useEffect(() => {
        fetchVisitors();
        const interval = setInterval(fetchVisitors, 30000);
        return () => clearInterval(interval);
    }, [fetchVisitors, debouncedSearch]);

    const handleForceCheckout = async (visitor: VisitorLog) => {
        if (!confirm(`Force checkout ${visitor.name}?`)) return;
        setActionLoading(true);
        try {
            const res = await fetch(`/api/vms/${visitor.property_id}/force-checkout`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ visitor_log_id: visitor.id }),
            });
            if (res.ok) {
                fetchVisitors();
                setSelectedVisitor(null);
            } else {
                const err = await res.json();
                alert(err.error || 'Force checkout failed');
            }
        } catch (err) {
            console.error('Force checkout error:', err);
        } finally {
            setActionLoading(false);
        }
    };

    const handleApproveEntry = async (visitor: VisitorLog, newStatus: 'approved' | 'rejected') => {
        setActionLoading(true);
        try {
            const res = await fetch(`/api/vms/${visitor.property_id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'approval',
                    visitor_id: visitor.id,
                    approval_status: newStatus,
                    approved_by_name: 'Super Admin',
                }),
            });
            if (res.ok) {
                fetchVisitors();
                setSelectedVisitor(null);
            } else {
                const err = await res.json();
                alert(err.error || `Failed to update entry status`);
            }
        } catch (err) {
            console.error('Approve entry error:', err);
        } finally {
            setActionLoading(false);
        }
    };

    const handleExport = () => {
        const headers = ['Visitor ID', 'Name', 'Category', 'Mobile', 'Property', 'Coming From', 'Whom to Meet', 'Check-in', 'Check-out', 'Status'];
        const rows = visitors.map(v => [
            v.visitor_id,
            v.name,
            v.category,
            v.mobile || '-',
            v.properties?.name || v.property_id,
            v.coming_from || '-',
            v.whom_to_meet,
            v.checkin_time ? new Date(v.checkin_time).toLocaleString() : '-',
            v.checkout_time ? new Date(v.checkout_time).toLocaleString() : '-',
            v.status,
        ]);
        const csv = "data:text/csv;charset=utf-8,"
            + headers.join(",") + "\n"
            + rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
        const link = document.createElement("a");
        link.setAttribute("href", encodeURI(csv));
        link.setAttribute("download", `all_visitors_${new Date().toISOString().split('T')[0]}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    const getDuration = (checkin: string, checkout: string | null) => {
        const diffMs = (checkout ? new Date(checkout) : new Date()).getTime() - new Date(checkin).getTime();
        const hours = Math.floor(diffMs / 3600000);
        const mins = Math.floor((diffMs % 3600000) / 60000);
        return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
    };

    const getCategoryIcon = (category: string) => {
        if (category === 'visitor') return <User className="w-4 h-4" />;
        if (category === 'vendor') return <Truck className="w-4 h-4" />;
        return <Building2 className="w-4 h-4" />;
    };

    const getCategoryColor = (category: string) => {
        if (category === 'visitor') return 'bg-primary/10 text-primary';
        if (category === 'vendor') return 'bg-secondary/10 text-secondary';
        return 'bg-slate-100 text-slate-600';
    };

    if (isLoading) {
        return (
            <div className="space-y-8 animate-pulse">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    {['bg-primary/10', 'bg-emerald-50', 'bg-rose-50'].map((bg, i) => (
                        <div key={i} className="bg-white border border-slate-100 rounded-3xl p-6 shadow-sm">
                            <div className="flex items-center gap-4">
                                <div className={`w-12 h-12 ${bg} rounded-2xl`} />
                                <div className="space-y-2">
                                    <div className="h-2.5 w-24 bg-slate-100 rounded-full" />
                                    <div className="h-8 w-12 bg-slate-200 rounded-lg" />
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
                <div className="bg-white border border-slate-100 rounded-3xl h-64 shadow-sm" />
            </div>
        );
    }

    return (
        <div className="space-y-8">
            {/* Stats */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
                    className="bg-white border border-slate-100 rounded-3xl p-6 shadow-sm">
                    <div className="flex items-center gap-4">
                        <div className="w-12 h-12 bg-primary/10 rounded-2xl flex items-center justify-center">
                            <Users className="w-6 h-6 text-primary" />
                        </div>
                        <div>
                            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                                {dateFilter === 'all' ? 'Total All Time' : dateFilter === 'today' ? 'Total Today' : dateFilter === 'yesterday' ? 'Total Yesterday' : dateFilter === 'week' ? 'Total This Week' : dateFilter === 'month' ? 'Total This Month' : 'Total'}
                            </p>
                            <p className="text-3xl font-black text-slate-900">{stats.total_visitors}</p>
                        </div>
                    </div>
                </motion.div>

                <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
                    className="bg-white border border-slate-100 rounded-3xl p-6 shadow-sm">
                    <div className="flex items-center gap-4">
                        <div className="w-12 h-12 bg-emerald-50 rounded-2xl flex items-center justify-center">
                            <LogIn className="w-6 h-6 text-emerald-600" />
                        </div>
                        <div>
                            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Currently In</p>
                            <p className="text-3xl font-black text-emerald-600">{stats.checked_in}</p>
                        </div>
                    </div>
                </motion.div>

                <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
                    className="bg-white border border-slate-100 rounded-3xl p-6 shadow-sm">
                    <div className="flex items-center gap-4">
                        <div className="w-12 h-12 bg-rose-50 rounded-2xl flex items-center justify-center">
                            <LogOut className="w-6 h-6 text-rose-600" />
                        </div>
                        <div>
                            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Checked Out</p>
                            <p className="text-3xl font-black text-rose-600">{stats.checked_out}</p>
                        </div>
                    </div>
                </motion.div>
            </div>

            {/* Visitor Table */}
            <div className="bg-white border border-slate-100 rounded-3xl overflow-hidden shadow-sm">
                {/* Header / Filters */}
                <div className="p-6 border-b border-slate-50 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                    <div>
                        <h3 className="text-xl font-bold text-slate-900">All Visitors</h3>
                        <p className="text-slate-500 text-xs font-medium mt-1">Across all properties · real-time</p>
                    </div>

                    <div className="flex flex-wrap items-center gap-3">
                        {/* Search */}
                        <form onSubmit={(e) => { e.preventDefault(); fetchVisitors(); }} className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                            <input
                                type="text"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                placeholder="Name, ID or mobile"
                                className="pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:border-slate-400 focus:ring-0 w-44"
                            />
                        </form>

                        {/* Property filter */}
                        {properties.length > 1 && (
                            <div className="relative">
                                <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                                <select
                                    value={propertyFilter}
                                    onChange={(e) => setPropertyFilter(e.target.value)}
                                    className="appearance-none pl-8 pr-7 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm"
                                >
                                    <option value="">All Properties</option>
                                    {properties.map(p => (
                                        <option key={p.id} value={p.id}>{p.name}</option>
                                    ))}
                                </select>
                                <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                            </div>
                        )}

                        {/* Date filter */}
                        <div className="relative">
                            <select
                                value={dateFilter}
                                onChange={(e) => setDateFilter(e.target.value as DateFilter)}
                                className="appearance-none pl-3 pr-8 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm"
                            >
                                <option value="all">All Time</option>
                                <option value="today">Today</option>
                                <option value="yesterday">Yesterday</option>
                                <option value="week">This Week</option>
                                <option value="month">This Month</option>
                                <option value="custom">Custom</option>
                            </select>
                            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                        </div>

                        {dateFilter === 'custom' && (
                            <input
                                type="date"
                                value={customDate}
                                onChange={(e) => setCustomDate(e.target.value)}
                                className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm"
                            />
                        )}

                        {/* Status toggle */}
                        <div className="flex border border-slate-200 rounded-xl overflow-hidden">
                            {(['all', 'checked_in', 'checked_out'] as const).map((s) => (
                                <button
                                    key={s}
                                    onClick={() => setStatusFilter(s)}
                                    className={`px-3 py-2 text-[10px] font-black uppercase tracking-widest transition-all ${statusFilter === s
                                        ? 'bg-primary text-white'
                                        : 'bg-white text-slate-500 hover:bg-slate-50'
                                        }`}
                                >
                                    {s === 'all' ? 'All' : s === 'checked_in' ? 'In' : 'Out'}
                                </button>
                            ))}
                        </div>

                        {/* Export */}
                        <button
                            onClick={handleExport}
                            className="flex items-center gap-2 px-4 py-2 bg-slate-100 text-slate-700 rounded-xl text-sm font-bold hover:bg-slate-200 transition-all"
                        >
                            <FileDown className="w-4 h-4" /> Export
                        </button>

                        {/* Check-In Visitor Button */}
                        <button
                            onClick={() => {
                                if (!selectedCheckInPropertyId && properties.length > 0) {
                                    setSelectedCheckInPropertyId(properties[0].id);
                                }
                                setShowCheckInModal(true);
                            }}
                            className="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary-dark text-white rounded-xl text-sm font-bold transition-all shadow-sm hover:shadow"
                        >
                            <Plus className="w-4 h-4" /> Check-In Visitor
                        </button>
                    </div>
                </div>

                {/* Desktop table */}
                <div className="hidden md:block overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead className="bg-slate-50 border-b border-slate-100">
                            <tr>
                                {['Visitor Info', 'Category', 'Property', 'Host / Purpose', 'Timing', 'Status', 'Actions'].map(col => (
                                    <th key={col} className="px-5 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">{col}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50">
                            {visitors.length === 0 ? (
                                <tr>
                                    <td colSpan={7} className="px-6 py-12 text-center text-slate-400 italic">No visitors found.</td>
                                </tr>
                            ) : visitors.map((visitor) => (
                                <tr
                                    key={visitor.id}
                                    className="hover:bg-slate-50/50 transition-all cursor-pointer"
                                    onClick={() => setSelectedVisitor(visitor)}
                                >
                                    <td className="px-5 py-4">
                                        <div className="flex items-center gap-3">
                                            {visitor.photo_url ? (
                                                <img src={visitor.photo_url} alt={visitor.name}
                                                    className="w-10 h-10 rounded-full object-cover border-2 border-slate-100" />
                                            ) : (
                                                <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center">
                                                    <User className="w-5 h-5 text-slate-400" />
                                                </div>
                                            )}
                                            <div>
                                                <p className="font-bold text-slate-900 text-sm">{visitor.name}</p>
                                                <p className="text-xs text-slate-500">{visitor.mobile || 'No mobile'}</p>
                                                <p className="text-[10px] text-slate-400 font-mono">{visitor.visitor_id}</p>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="px-5 py-4">
                                        <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider ${getCategoryColor(visitor.category)}`}>
                                            {getCategoryIcon(visitor.category)}
                                            {visitor.category}
                                        </span>
                                    </td>
                                    <td className="px-5 py-4">
                                        <span className="text-sm font-medium text-slate-700">
                                            {visitor.properties?.name || '—'}
                                        </span>
                                    </td>
                                    <td className="px-5 py-4">
                                        <div className="text-sm font-bold text-slate-900">{visitor.whom_to_meet}</div>
                                        <div className="text-xs text-slate-500">{visitor.coming_from || '-'}</div>
                                        <div className="text-[10px] text-slate-400 mt-1 font-medium">
                                            Logged by: <span className="font-semibold text-slate-600">{visitor.creator?.full_name || 'Gate / Kiosk'}</span>
                                        </div>
                                    </td>
                                    <td className="px-5 py-4">
                                        <div className="text-xs font-bold text-slate-900">
                                            In: {new Date(visitor.checkin_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                        </div>
                                        {visitor.checkout_time ? (
                                            <div className="text-xs text-slate-500 mt-1">
                                                Out: {new Date(visitor.checkout_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                            </div>
                                        ) : (
                                            <div className="text-xs text-emerald-600 mt-1 font-medium">
                                                ({getDuration(visitor.checkin_time, visitor.checkout_time)})
                                            </div>
                                        )}
                                    </td>
                                    <td className="px-5 py-4">
                                        <div className="flex flex-col gap-1 items-start">
                                            <span className={`px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider ${
                                                visitor.approval_status === 'pending'
                                                    ? 'bg-amber-50 text-amber-700 border border-amber-200'
                                                    : visitor.approval_status === 'rejected'
                                                    ? 'bg-rose-50 text-rose-700 border border-rose-200'
                                                    : visitor.status === 'checked_in'
                                                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                                    : 'bg-slate-100 text-slate-600'
                                            }`}>
                                                {visitor.approval_status === 'pending'
                                                    ? 'Pending Approval'
                                                    : visitor.approval_status === 'rejected'
                                                    ? 'Rejected'
                                                    : visitor.status === 'checked_in'
                                                    ? 'On Premise'
                                                    : 'Checked Out'}
                                            </span>
                                        </div>
                                    </td>
                                    <td className="px-5 py-4 text-center" onClick={(e) => e.stopPropagation()}>
                                        <div className="flex items-center justify-center gap-1.5">
                                            {visitor.approval_status === 'pending' && visitor.status === 'checked_in' && isUserHost(visitor) && (
                                                <>
                                                    <button
                                                        onClick={() => handleApproveEntry(visitor, 'approved')}
                                                        disabled={actionLoading}
                                                        title="Approve Visitor Entry"
                                                        className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 rounded-xl text-xs font-bold transition-all disabled:opacity-50 cursor-pointer"
                                                    >
                                                        <CheckCircle2 className="w-3.5 h-3.5" /> Approve
                                                    </button>
                                                    <button
                                                        onClick={() => handleApproveEntry(visitor, 'rejected')}
                                                        disabled={actionLoading}
                                                        title="Reject Visitor Entry"
                                                        className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-xl text-xs font-bold transition-all disabled:opacity-50 cursor-pointer"
                                                    >
                                                        <X className="w-3.5 h-3.5" /> Reject
                                                    </button>
                                                </>
                                            )}
                                            {visitor.status === 'checked_in' && (
                                                <button
                                                    onClick={() => handleForceCheckout(visitor)}
                                                    disabled={actionLoading}
                                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition-all disabled:opacity-50 cursor-pointer"
                                                >
                                                    <LogOut className="w-3.5 h-3.5" /> Check Out
                                                </button>
                                            )}
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>

                {/* Mobile cards */}
                <div className="md:hidden space-y-4 p-4">
                    {visitors.length === 0 ? (
                        <div className="text-center text-slate-400 italic py-8">No visitors found.</div>
                    ) : visitors.map((visitor) => (
                        <div
                            key={visitor.id}
                            className="bg-slate-50 rounded-2xl p-4 border border-slate-100 shadow-sm cursor-pointer"
                            onClick={() => setSelectedVisitor(visitor)}
                        >
                            <div className="flex items-start justify-between mb-3">
                                <div className="flex items-center gap-3">
                                    {visitor.photo_url ? (
                                        <img src={visitor.photo_url} alt={visitor.name}
                                            className="w-12 h-12 rounded-full object-cover border-2 border-white shadow-sm" />
                                    ) : (
                                        <div className="w-12 h-12 rounded-full bg-white flex items-center justify-center border border-slate-100">
                                            <User className="w-6 h-6 text-slate-400" />
                                        </div>
                                    )}
                                    <div>
                                        <p className="font-bold text-slate-900">{visitor.name}</p>
                                        <p className="text-xs text-slate-500">{visitor.mobile || 'No mobile'}</p>
                                        <p className="text-[10px] text-slate-400 font-medium">{visitor.properties?.name}</p>
                                    </div>
                                </div>
                                <span className={`px-2 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider ${
                                    visitor.approval_status === 'pending'
                                        ? 'bg-amber-50 text-amber-700 border border-amber-200'
                                        : visitor.approval_status === 'rejected'
                                        ? 'bg-rose-50 text-rose-700 border border-rose-200'
                                        : visitor.status === 'checked_in'
                                        ? 'bg-emerald-50 text-emerald-700'
                                        : 'bg-slate-100 text-slate-600'
                                }`}>
                                    {visitor.approval_status === 'pending' ? 'Pending' : visitor.approval_status === 'rejected' ? 'Rejected' : visitor.status === 'checked_in' ? 'In' : 'Out'}
                                </span>
                            </div>

                            <div className="grid grid-cols-2 gap-y-2 gap-x-4 mb-3 text-xs">
                                <div>
                                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Host</p>
                                    <p className="font-medium text-slate-900 truncate">{visitor.whom_to_meet}</p>
                                    {visitor.creator?.full_name && (
                                        <p className="text-[10px] text-slate-400 mt-0.5 font-medium">
                                            Logged by: {visitor.creator.full_name}
                                        </p>
                                    )}
                                </div>
                                <div>
                                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Check-in</p>
                                    <p className="font-medium text-slate-900">
                                        {new Date(visitor.checkin_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                    </p>
                                </div>
                            </div>

                            {visitor.status === 'checked_in' && (
                                <div className="pt-3 border-t border-slate-200/50 flex items-center justify-end gap-2" onClick={(e) => e.stopPropagation()}>
                                    {visitor.approval_status === 'pending' && isUserHost(visitor) && (
                                        <>
                                            <button
                                                onClick={() => handleApproveEntry(visitor, 'approved')}
                                                disabled={actionLoading}
                                                className="px-3 py-1.5 bg-emerald-50 text-emerald-700 rounded-lg text-xs font-bold hover:bg-emerald-100 border border-emerald-200"
                                            >
                                                Approve
                                            </button>
                                            <button
                                                onClick={() => handleApproveEntry(visitor, 'rejected')}
                                                disabled={actionLoading}
                                                className="px-3 py-1.5 bg-rose-50 text-rose-700 rounded-lg text-xs font-bold hover:bg-rose-100 border border-rose-200"
                                            >
                                                Reject
                                            </button>
                                        </>
                                    )}
                                    <button
                                        onClick={() => handleForceCheckout(visitor)}
                                        disabled={actionLoading}
                                        className="px-3 py-1.5 bg-slate-100 text-slate-700 rounded-lg text-xs font-bold hover:bg-slate-200"
                                    >
                                        Force Out
                                    </button>
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            </div>

            {/* Visitor Detail Modal */}
            <AnimatePresence>
                {selectedVisitor && (
                    <motion.div
                        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                        className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4"
                        onClick={() => setSelectedVisitor(null)}
                    >
                        <motion.div
                            initial={{ scale: 0.9 }} animate={{ scale: 1 }} exit={{ scale: 0.9 }}
                            className="bg-white rounded-3xl w-full max-w-md overflow-hidden"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <div className="bg-gradient-to-br from-primary to-primary-dark p-6 text-white relative">
                                <button onClick={() => setSelectedVisitor(null)}
                                    className="absolute top-4 right-4 p-1 rounded-full bg-white/20 hover:bg-white/30">
                                    <X className="w-5 h-5" />
                                </button>
                                <div className="flex items-center gap-4">
                                    {selectedVisitor.photo_url ? (
                                        <img src={selectedVisitor.photo_url} alt={selectedVisitor.name}
                                            className="w-20 h-20 rounded-2xl object-cover border-4 border-white/30" />
                                    ) : (
                                        <div className="w-20 h-20 rounded-2xl bg-white/20 flex items-center justify-center">
                                            <User className="w-10 h-10" />
                                        </div>
                                    )}
                                    <div>
                                        <h3 className="text-2xl font-black">{selectedVisitor.name}</h3>
                                        <p className="text-white/70 font-mono text-sm">{selectedVisitor.visitor_id}</p>
                                        <p className="text-white/60 text-sm mt-0.5">
                                            {selectedVisitor.properties?.name}
                                        </p>
                                    </div>
                                </div>
                            </div>

                            <div className="p-6 space-y-4">
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Category</p>
                                        <p className="text-slate-900 font-medium capitalize">{selectedVisitor.category}</p>
                                    </div>
                                    <div>
                                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Status</p>
                                        <span className={`inline-block px-2.5 py-0.5 rounded-lg text-xs font-black uppercase tracking-wider mt-0.5 ${
                                            selectedVisitor.approval_status === 'pending'
                                                ? 'bg-amber-50 text-amber-700 border border-amber-200'
                                                : selectedVisitor.approval_status === 'rejected'
                                                ? 'bg-rose-50 text-rose-700 border border-rose-200'
                                                : selectedVisitor.status === 'checked_in'
                                                ? 'bg-emerald-50 text-emerald-700'
                                                : 'bg-slate-100 text-slate-600'
                                        }`}>
                                            {selectedVisitor.approval_status === 'pending'
                                                ? 'Pending Host Approval'
                                                : selectedVisitor.approval_status === 'rejected'
                                                ? 'Entry Rejected'
                                                : selectedVisitor.status === 'checked_in'
                                                ? 'On Premise'
                                                : 'Checked Out'}
                                        </span>
                                    </div>
                                    <div>
                                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Mobile</p>
                                        <p className="text-slate-900 font-medium">{selectedVisitor.mobile || '-'}</p>
                                    </div>
                                    <div>
                                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Coming From</p>
                                        <p className="text-slate-900 font-medium">{selectedVisitor.coming_from || '-'}</p>
                                    </div>
                                    <div className="col-span-2">
                                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Whom to Meet</p>
                                        <p className="text-slate-900 font-medium">{selectedVisitor.whom_to_meet}</p>
                                        {selectedVisitor.creator?.full_name && (
                                            <p className="text-[10px] text-slate-400 mt-0.5 font-medium">
                                                Logged by: {selectedVisitor.creator.full_name}
                                            </p>
                                        )}
                                    </div>
                                </div>

                                <div className="border-t border-slate-100 pt-4">
                                    <div className="flex justify-between items-center mb-2">
                                        <div>
                                            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Check-in</p>
                                            <p className="text-slate-900 font-medium">
                                                {selectedVisitor.checkin_time ? new Date(selectedVisitor.checkin_time).toLocaleString() : '-'}
                                            </p>
                                        </div>
                                        <div className="text-right">
                                            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Duration</p>
                                            <p className="text-slate-900 font-bold">{getDuration(selectedVisitor.checkin_time, selectedVisitor.checkout_time)}</p>
                                        </div>
                                    </div>
                                    {selectedVisitor.checkout_time && (
                                        <div>
                                            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Check-out</p>
                                            <p className="text-slate-900 font-medium">{new Date(selectedVisitor.checkout_time).toLocaleString()}</p>
                                        </div>
                                    )}
                                </div>

                                {selectedVisitor.status === 'checked_in' && (
                                    <div className="space-y-3 pt-2">
                                        {selectedVisitor.approval_status === 'pending' && (
                                            <div className="grid grid-cols-2 gap-3">
                                                <button
                                                    onClick={() => handleApproveEntry(selectedVisitor, 'approved')}
                                                    disabled={actionLoading}
                                                    className="w-full py-3 bg-emerald-600 text-white rounded-xl font-bold hover:bg-emerald-700 transition-all flex items-center justify-center gap-2 shadow-md shadow-emerald-600/20 disabled:opacity-50 cursor-pointer"
                                                >
                                                    <CheckCircle2 className="w-4 h-4" /> Approve Entry
                                                </button>
                                                <button
                                                    onClick={() => handleApproveEntry(selectedVisitor, 'rejected')}
                                                    disabled={actionLoading}
                                                    className="w-full py-3 bg-rose-50 text-rose-700 border border-rose-200 rounded-xl font-bold hover:bg-rose-100 transition-all flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer"
                                                >
                                                    <X className="w-4 h-4" /> Reject Entry
                                                </button>
                                            </div>
                                        )}
                                        <button
                                            onClick={() => handleForceCheckout(selectedVisitor)}
                                            disabled={actionLoading}
                                            className="w-full py-3 bg-slate-100 text-slate-700 hover:bg-slate-200 rounded-xl font-bold transition-all disabled:opacity-50 cursor-pointer"
                                        >
                                            {actionLoading ? 'Processing...' : 'Force Checkout'}
                                        </button>
                                    </div>
                                )}
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Modal: Check-In Visitor (Org Super Admin) */}
            <AnimatePresence>
                {showCheckInModal && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
                        <motion.div
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.95 }}
                            className="bg-white dark:bg-slate-800 w-full max-w-4xl max-h-[90vh] rounded-3xl border border-slate-200 dark:border-slate-700 shadow-2xl overflow-hidden flex flex-col"
                        >
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-6 py-4 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900">
                                <div className="flex items-center gap-2">
                                    <LogIn className="w-5 h-5 text-primary" />
                                    <h3 className="font-bold text-slate-900 dark:text-white text-lg">Visitor Entry & Check-In</h3>
                                </div>

                                <div className="flex items-center gap-3">
                                    {properties.length > 1 && (
                                        <div className="flex items-center gap-2">
                                            <span className="text-xs font-semibold text-slate-500">Property:</span>
                                            <select
                                                value={selectedCheckInPropertyId}
                                                onChange={(e) => setSelectedCheckInPropertyId(e.target.value)}
                                                className="px-3 py-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-bold text-slate-900 dark:text-white"
                                            >
                                                {properties.map(p => (
                                                    <option key={p.id} value={p.id}>{p.name}</option>
                                                ))}
                                            </select>
                                        </div>
                                    )}
                                    <button
                                        onClick={() => {
                                            setShowCheckInModal(false);
                                            fetchVisitors();
                                        }}
                                        className="p-1.5 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                                    >
                                        <X className="w-5 h-5" />
                                    </button>
                                </div>
                            </div>

                            <div className="p-4 flex-1 overflow-y-auto min-h-[550px]">
                                {selectedCheckInPropertyId ? (
                                    <VMSKiosk propertyId={selectedCheckInPropertyId} propertyName="" />
                                ) : (
                                    <div className="p-8 text-center text-slate-500">Please select a property to check in a visitor.</div>
                                )}
                            </div>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>
        </div>
    );
};

export default VMSOrgVisitorDashboard;
