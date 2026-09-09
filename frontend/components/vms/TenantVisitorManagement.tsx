'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
    Users, Clock, CheckCircle2, XCircle, Search, Filter,
    Building2, Phone, Calendar, User, Truck, Shield, AlertCircle,
    Maximize2, ExternalLink, X, RefreshCw, Loader2, ArrowUpRight
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface TenantVisitorManagementProps {
    propertyId: string;
    user: {
        id: string;
        full_name?: string;
        email?: string;
    };
    propertyName?: string;
}

interface VisitorLog {
    id: string;
    visitor_id: string;
    category: string;
    name: string;
    mobile: string | null;
    coming_from: string | null;
    whom_to_meet: string | null;
    host_id?: string | null;
    created_by?: string | null;
    creator?: { id: string; full_name?: string; email?: string } | null;
    photo_url: string | null;
    checkin_time: string;
    checkout_time: string | null;
    status: string;
    approval_status?: 'pending' | 'approved' | 'rejected' | string;
}

const CATEGORY_BADGES: Record<string, { label: string; bg: string; text: string }> = {
    guest: { label: 'Guest', bg: 'bg-blue-50', text: 'text-blue-700' },
    vendor: { label: 'Vendor / Service', bg: 'bg-amber-50', text: 'text-amber-700' },
    delivery: { label: 'Delivery', bg: 'bg-purple-50', text: 'text-purple-700' },
    contractor: { label: 'Contractor', bg: 'bg-orange-50', text: 'text-orange-700' },
    interview: { label: 'Interview', bg: 'bg-emerald-50', text: 'text-emerald-700' },
};

export default function TenantVisitorManagement({ propertyId, user, propertyName }: TenantVisitorManagementProps) {
    const [visitors, setVisitors] = useState<VisitorLog[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [approvalTab, setApprovalTab] = useState<'all' | 'pending' | 'approved' | 'rejected'>('all');
    const [dateFilter, setDateFilter] = useState<'all' | 'today' | 'week' | 'month'>('all');
    const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
    const [previewPhotoUrl, setPreviewPhotoUrl] = useState<string | null>(null);
    const [toastMessage, setToastMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

    const fetchAssignedVisitors = useCallback(async () => {
        setIsLoading(true);
        try {
            const params = new URLSearchParams({
                host_id: user.id,
                date: dateFilter,
            });

            if (user.full_name) {
                params.set('host_name', user.full_name);
            }
            if (approvalTab !== 'all') {
                params.set('approval_status', approvalTab);
            }
            if (searchQuery.trim()) {
                params.set('search', searchQuery.trim());
            }

            const response = await fetch(`/api/vms/${propertyId}?${params}`);
            const data = await response.json();

            if (response.ok) {
                setVisitors(data.visitors || []);
            }
        } catch (err) {
            console.error('Error fetching tenant assigned visitors:', err);
        } finally {
            setIsLoading(false);
        }
    }, [propertyId, user.id, user.full_name, approvalTab, dateFilter, searchQuery]);

    useEffect(() => {
        fetchAssignedVisitors();
        const interval = setInterval(fetchAssignedVisitors, 15000);
        return () => clearInterval(interval);
    }, [fetchAssignedVisitors]);

    const handleApprovalAction = async (visitor: VisitorLog, status: 'approved' | 'rejected') => {
        setActionLoadingId(visitor.id);
        try {
            const response = await fetch(`/api/vms/${propertyId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    visitor_id: visitor.visitor_id || visitor.id,
                    action: 'approval',
                    approval_status: status,
                    approved_by_name: user.full_name || 'Host'
                }),
            });

            const data = await response.json();

            if (response.ok) {
                // Update state locally
                setVisitors(prev => prev.map(v => v.id === visitor.id ? { ...v, approval_status: status } : v));
                setToastMessage({
                    text: `Visitor entry for ${visitor.name} has been ${status}.`,
                    type: 'success'
                });
                setTimeout(() => setToastMessage(null), 3500);
            } else {
                setToastMessage({ text: data.error || 'Failed to update approval status', type: 'error' });
            }
        } catch (err) {
            console.error('Approval action error:', err);
            setToastMessage({ text: 'Network error updating approval', type: 'error' });
        } finally {
            setActionLoadingId(null);
        }
    };

    // Calculate count stats
    const pendingCount = visitors.filter(v => (v.approval_status || 'pending') === 'pending').length;
    const approvedCount = visitors.filter(v => v.approval_status === 'approved').length;
    const rejectedCount = visitors.filter(v => v.approval_status === 'rejected').length;

    return (
        <div className="space-y-6 pb-12">
            {/* Header & Title Banner */}
            <div className="bg-white rounded-3xl p-6 sm:p-8 border border-slate-200 shadow-xs relative overflow-hidden">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div>
                        <div className="flex items-center gap-2 text-emerald-600 text-xs font-bold uppercase tracking-widest mb-1.5">
                            <Shield className="w-4 h-4 text-emerald-600" />
                            <span>Visitor Management & Gate Approvals</span>
                        </div>
                        <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-slate-900">
                            My Visitors
                        </h1>
                        <p className="text-slate-500 text-xs sm:text-sm mt-1 max-w-xl">
                            View and manage guest check-ins assigned to you at {propertyName || 'the property'}. Instantly approve or reject gate entries.
                        </p>
                    </div>
                </div>

                {/* Quick Summary Stat Cards */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-6 pt-6 border-t border-slate-100">
                    <div className="bg-slate-50 rounded-2xl p-4 border border-slate-200/80 shadow-2xs">
                        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Total Visits</p>
                        <p className="text-2xl font-black text-slate-900 mt-1">{visitors.length}</p>
                    </div>
                    <div className="bg-amber-50/80 rounded-2xl p-4 border border-amber-200/80 shadow-2xs">
                        <p className="text-[10px] font-bold text-amber-800 uppercase tracking-wider flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                            Pending Approval
                        </p>
                        <p className="text-2xl font-black text-amber-900 mt-1">{pendingCount}</p>
                    </div>
                    <div className="bg-emerald-50/80 rounded-2xl p-4 border border-emerald-200/80 shadow-2xs">
                        <p className="text-[10px] font-bold text-emerald-800 uppercase tracking-wider">Approved</p>
                        <p className="text-2xl font-black text-emerald-900 mt-1">{approvedCount}</p>
                    </div>
                    <div className="bg-rose-50/80 rounded-2xl p-4 border border-rose-200/80 shadow-2xs">
                        <p className="text-[10px] font-bold text-rose-800 uppercase tracking-wider">Rejected</p>
                        <p className="text-2xl font-black text-rose-900 mt-1">{rejectedCount}</p>
                    </div>
                </div>
            </div>

            {/* Toast Notification */}
            <AnimatePresence>
                {toastMessage && (
                    <motion.div
                        initial={{ opacity: 0, y: -20 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -20 }}
                        className={`p-4 rounded-2xl shadow-lg border flex items-center justify-between text-xs font-bold ${
                            toastMessage.type === 'success'
                                ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                                : 'bg-rose-50 text-rose-800 border-rose-200'
                        }`}
                    >
                        <div className="flex items-center gap-2">
                            {toastMessage.type === 'success' ? <CheckCircle2 className="w-4 h-4 text-emerald-600" /> : <AlertCircle className="w-4 h-4 text-rose-600" />}
                            <span>{toastMessage.text}</span>
                        </div>
                        <button onClick={() => setToastMessage(null)} className="p-1 hover:bg-black/5 rounded-lg">
                            <X className="w-3.5 h-3.5 opacity-60" />
                        </button>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Filters Bar & Search */}
            <div className="bg-white rounded-2xl p-4 border border-slate-100 shadow-sm space-y-4">
                <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
                    {/* Status Tabs */}
                    <div className="flex items-center p-1 bg-slate-100/80 rounded-xl overflow-x-auto no-scrollbar">
                        <button
                            onClick={() => setApprovalTab('all')}
                            className={`px-3.5 py-1.5 text-xs font-black rounded-lg transition-all whitespace-nowrap ${
                                approvalTab === 'all' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-500 hover:text-slate-800'
                            }`}
                        >
                            All ({visitors.length})
                        </button>
                        <button
                            onClick={() => setApprovalTab('pending')}
                            className={`px-3.5 py-1.5 text-xs font-black rounded-lg transition-all flex items-center gap-1.5 whitespace-nowrap ${
                                approvalTab === 'pending' ? 'bg-white text-amber-700 shadow-xs' : 'text-slate-500 hover:text-slate-800'
                            }`}
                        >
                            <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                            Pending ({pendingCount})
                        </button>
                        <button
                            onClick={() => setApprovalTab('approved')}
                            className={`px-3.5 py-1.5 text-xs font-black rounded-lg transition-all whitespace-nowrap ${
                                approvalTab === 'approved' ? 'bg-white text-emerald-700 shadow-xs' : 'text-slate-500 hover:text-slate-800'
                            }`}
                        >
                            Approved ({approvedCount})
                        </button>
                        <button
                            onClick={() => setApprovalTab('rejected')}
                            className={`px-3.5 py-1.5 text-xs font-black rounded-lg transition-all whitespace-nowrap ${
                                approvalTab === 'rejected' ? 'bg-white text-rose-700 shadow-xs' : 'text-slate-500 hover:text-slate-800'
                            }`}
                        >
                            Rejected ({rejectedCount})
                        </button>
                    </div>

                    {/* Date filter & Search box */}
                    <div className="flex items-center gap-2">
                        <div className="relative flex-1 sm:w-64">
                            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                            <input
                                type="text"
                                placeholder="Search by name, phone, ID..."
                                value={searchQuery}
                                onChange={e => setSearchQuery(e.target.value)}
                                className="w-full pl-9 pr-4 py-2 border border-slate-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all bg-slate-50/50"
                            />
                            {searchQuery && (
                                <button onClick={() => setSearchQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                                    <X className="w-3.5 h-3.5" />
                                </button>
                            )}
                        </div>

                        <select
                            value={dateFilter}
                            onChange={e => setDateFilter(e.target.value as any)}
                            className="px-3 py-2 border border-slate-200 rounded-xl text-xs font-bold text-slate-700 bg-slate-50/50 focus:outline-none focus:ring-2 focus:ring-primary/20"
                        >
                            <option value="all">All Dates</option>
                            <option value="today">Today</option>
                            <option value="week">This Week</option>
                            <option value="month">This Month</option>
                        </select>
                    </div>
                </div>
            </div>

            {/* Row-wise Visitor List */}
            {isLoading ? (
                <div className="bg-white rounded-3xl p-12 text-center border border-slate-100 shadow-sm">
                    <Loader2 className="w-8 h-8 text-primary animate-spin mx-auto mb-3" />
                    <p className="text-xs font-bold text-slate-500">Fetching assigned visitor logs...</p>
                </div>
            ) : visitors.length === 0 ? (
                <div className="bg-white rounded-3xl p-12 text-center border border-slate-100 shadow-sm space-y-3">
                    <div className="w-16 h-16 bg-slate-50 text-slate-300 rounded-full flex items-center justify-center mx-auto">
                        <Users className="w-8 h-8" />
                    </div>
                    <h3 className="text-base font-black text-slate-800">No Visitors Found</h3>
                    <p className="text-xs text-slate-500 max-w-sm mx-auto">
                        There are no visitor check-in logs assigned to you matching your current filter settings.
                    </p>
                </div>
            ) : (
                <div className="space-y-3">
                    {visitors.map(visitor => {
                        const catConfig = CATEGORY_BADGES[visitor.category?.toLowerCase()] || { label: visitor.category || 'Visitor', bg: 'bg-slate-100', text: 'text-slate-700' };
                        const appStatus = visitor.approval_status || 'pending';
                        const isPending = appStatus === 'pending';
                        const isApproved = appStatus === 'approved';
                        const isRejected = appStatus === 'rejected';

                        return (
                            <motion.div
                                key={visitor.id}
                                layout
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                className={`bg-white rounded-2xl border transition-all hover:shadow-md p-4 sm:p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 ${
                                    isPending ? 'border-amber-200 bg-gradient-to-r from-amber-50/20 to-white' : 'border-slate-100'
                                }`}
                            >
                                {/* Left Section: Photo & Basic Details */}
                                <div className="flex items-start sm:items-center gap-3.5 flex-1 min-w-0">
                                    {/* Visitor Photo Thumbnail */}
                                    <div className="relative group shrink-0">
                                        {visitor.photo_url ? (
                                            <div
                                                onClick={() => setPreviewPhotoUrl(visitor.photo_url)}
                                                className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl overflow-hidden border border-slate-200 bg-slate-100 cursor-pointer relative"
                                            >
                                                <img
                                                    src={visitor.photo_url}
                                                    alt={visitor.name}
                                                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                                                />
                                                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white">
                                                    <Maximize2 className="w-4 h-4" />
                                                </div>
                                            </div>
                                        ) : (
                                            <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl bg-primary/10 text-primary font-black text-lg flex items-center justify-center border border-primary/20">
                                                {visitor.name ? visitor.name.charAt(0).toUpperCase() : 'V'}
                                            </div>
                                        )}
                                    </div>

                                    {/* Information Stack */}
                                    <div className="space-y-1 min-w-0 flex-1">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <h3 className="text-sm sm:text-base font-black text-slate-900 truncate">
                                                {visitor.name}
                                            </h3>
                                            <span className="text-[10px] font-extrabold text-slate-400 bg-slate-100 px-2 py-0.5 rounded-md uppercase tracking-wider">
                                                {visitor.visitor_id || 'ID N/A'}
                                            </span>
                                            <span className={`text-[10px] font-black px-2.5 py-0.5 rounded-full ${catConfig.bg} ${catConfig.text}`}>
                                                {catConfig.label}
                                            </span>
                                        </div>

                                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500 font-medium">
                                            {visitor.mobile && (
                                                <span className="flex items-center gap-1 text-slate-600 font-bold">
                                                    <Phone className="w-3 h-3 text-slate-400" />
                                                    {visitor.mobile}
                                                </span>
                                            )}
                                            {visitor.coming_from && (
                                                <span className="flex items-center gap-1">
                                                    <Building2 className="w-3 h-3 text-slate-400" />
                                                    From: <strong className="text-slate-700">{visitor.coming_from}</strong>
                                                </span>
                                            )}
                                            <span className="text-[10px] text-slate-400 font-medium">
                                                Logged by: <strong className="text-slate-600 font-semibold">{visitor.creator?.full_name || 'Gate / Kiosk'}</strong>
                                            </span>
                                        </div>

                                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-400 pt-0.5">
                                            <span className="flex items-center gap-1">
                                                <Clock className="w-3 h-3 text-slate-400" />
                                                Check-in:{' '}
                                                <strong className="text-slate-600 font-semibold">
                                                    {new Date(visitor.checkin_time).toLocaleString('en-IN', {
                                                        day: 'numeric',
                                                        month: 'short',
                                                        hour: '2-digit',
                                                        minute: '2-digit',
                                                        hour12: true
                                                    })}
                                                </strong>
                                            </span>
                                            {visitor.checkout_time && (
                                                <span className="flex items-center gap-1 text-emerald-600">
                                                    <CheckCircle2 className="w-3 h-3" />
                                                    Checked out:{' '}
                                                    {new Date(visitor.checkout_time).toLocaleTimeString('en-IN', {
                                                        hour: '2-digit',
                                                        minute: '2-digit',
                                                        hour12: true
                                                    })}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                {/* Right Section: Approval Status Badge & Mobile Action Row */}
                                <div className="flex items-center justify-between md:justify-end gap-3 pt-3 md:pt-0 border-t md:border-t-0 border-slate-100">
                                    {/* Status Badge */}
                                    <div>
                                        {isPending && (
                                            <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-amber-100 text-amber-800 border border-amber-300 text-xs font-black rounded-full">
                                                <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                                                Awaiting Approval
                                            </span>
                                        )}
                                        {isApproved && (
                                            <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-emerald-100 text-emerald-800 border border-emerald-300 text-xs font-black rounded-full">
                                                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                                                Approved
                                            </span>
                                        )}
                                        {isRejected && (
                                            <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-rose-100 text-rose-800 border border-rose-300 text-xs font-black rounded-full">
                                                <XCircle className="w-3.5 h-3.5 text-rose-600" />
                                                Rejected
                                            </span>
                                        )}
                                    </div>

                                    {/* Action Buttons (Approve & Reject) */}
                                    <div className="flex items-center gap-2">
                                        {isPending ? (
                                            <>
                                                <button
                                                    onClick={() => handleApprovalAction(visitor, 'approved')}
                                                    disabled={actionLoadingId === visitor.id}
                                                    className="flex-1 sm:flex-initial px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black rounded-xl transition-all shadow-sm flex items-center justify-center gap-1.5 active:scale-95 disabled:opacity-50"
                                                >
                                                    {actionLoadingId === visitor.id ? (
                                                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                                    ) : (
                                                        <>
                                                            <CheckCircle2 className="w-3.5 h-3.5" />
                                                            Approve
                                                        </>
                                                    )}
                                                </button>
                                                <button
                                                    onClick={() => handleApprovalAction(visitor, 'rejected')}
                                                    disabled={actionLoadingId === visitor.id}
                                                    className="flex-1 sm:flex-initial px-4 py-2 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 text-xs font-black rounded-xl transition-all flex items-center justify-center gap-1.5 active:scale-95 disabled:opacity-50"
                                                >
                                                    <XCircle className="w-3.5 h-3.5" />
                                                    Reject
                                                </button>
                                            </>
                                        ) : (
                                            <button
                                                onClick={() => handleApprovalAction(visitor, isApproved ? 'rejected' : 'approved')}
                                                disabled={actionLoadingId === visitor.id}
                                                className="text-[11px] font-bold text-slate-400 hover:text-slate-700 underline px-2 py-1 transition-colors"
                                            >
                                                Change to {isApproved ? 'Reject' : 'Approve'}
                                            </button>
                                        )}
                                    </div>
                                </div>
                            </motion.div>
                        );
                    })}
                </div>
            )}

            {/* Photo Lightbox Preview Modal */}
            <AnimatePresence>
                {previewPhotoUrl && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 z-[100] bg-black/90 backdrop-blur-md flex flex-col items-center justify-center p-4"
                        onClick={() => setPreviewPhotoUrl(null)}
                    >
                        <div className="absolute top-4 right-4 flex items-center gap-3 z-10">
                            <a
                                href={previewPhotoUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={e => e.stopPropagation()}
                                className="p-2.5 bg-white/10 hover:bg-white/20 text-white rounded-full transition-colors backdrop-blur-sm"
                                title="Open original in new tab"
                            >
                                <ExternalLink className="w-5 h-5" />
                            </a>
                            <button
                                onClick={() => setPreviewPhotoUrl(null)}
                                className="p-2.5 bg-white/10 hover:bg-white/20 text-white rounded-full transition-colors backdrop-blur-sm"
                                title="Close preview"
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </div>
                        <motion.div
                            initial={{ scale: 0.9, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0.9, opacity: 0 }}
                            className="max-w-3xl max-h-[85vh] relative flex items-center justify-center p-2"
                            onClick={e => e.stopPropagation()}
                        >
                            <img
                                src={previewPhotoUrl}
                                alt="Visitor Photo Preview"
                                className="max-w-full max-h-[85vh] object-contain rounded-2xl shadow-2xl border border-white/10"
                            />
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
