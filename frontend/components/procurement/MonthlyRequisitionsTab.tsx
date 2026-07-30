'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { createClient } from '@/frontend/utils/supabase/client';
import {
    FileText, Upload, CheckCircle2, Clock, Download, Filter,
    Building2, Calendar, Search, RefreshCw, Loader2, AlertCircle,
    Plus, FileSpreadsheet, Eye, UserCheck, X
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface Property {
    id: string;
    name: string;
}

interface MonthlyRequisition {
    id: string;
    organization_id: string;
    property_id: string;
    requisition_month: number;
    requisition_year: number;
    file_url: string;
    file_name: string;
    file_size_bytes?: number;
    notes?: string;
    status: 'uploaded' | 'acknowledged';
    created_at: string;
    acknowledged_at?: string;
    property?: { id: string; name: string };
    uploader?: { id: string; full_name?: string; email: string };
    acknowledger?: { id: string; full_name?: string; email: string };
}

interface MonthlyRequisitionsTabProps {
    user: any;
    organizationId?: string;
    userRole?: string;
}

const MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
];

export default function MonthlyRequisitionsTab({ user, organizationId, userRole }: MonthlyRequisitionsTabProps) {
    const supabase = createClient();

    const userRoleLower = (userRole || user?.user_metadata?.role || '').toLowerCase();

    // Is Property Admin / Site Team (Upload allowed, Acknowledge NOT allowed)
    const isPropertyAdmin =
        userRoleLower.includes('property_admin') ||
        userRoleLower.includes('property_manager') ||
        userRoleLower === 'property_admin';

    // Is Procurement Role / Admin
    const isProcurementRole =
        userRoleLower.includes('procurement') ||
        userRoleLower === 'org_super_admin' ||
        userRoleLower === 'master_admin';

    // 1. Upload Requisition button: ONLY for Property Admins (and Org Super Admins)
    const canUploadRequisition = isPropertyAdmin || userRoleLower === 'org_super_admin' || userRoleLower === 'master_admin';

    // 2. Acknowledge button: ONLY for Procurement users (and Org Super Admins)
    const canAcknowledgeRequisition = (isProcurementRole || !isPropertyAdmin) && !isPropertyAdmin;

    const [requisitions, setRequisitions] = useState<MonthlyRequisition[]>([]);
    const [properties, setProperties] = useState<Property[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [acknowledgingId, setAcknowledgingId] = useState<string | null>(null);

    // Filters
    const [selectedPropertyFilter, setSelectedPropertyFilter] = useState<string>('all');
    const [selectedStatusFilter, setSelectedStatusFilter] = useState<string>('all');
    const [selectedMonthFilter, setSelectedMonthFilter] = useState<string>('all');
    const [selectedYearFilter, setSelectedYearFilter] = useState<string>('all');
    const [searchQuery, setSearchQuery] = useState<string>('');

    // Upload Modal State
    const [showUploadModal, setShowUploadModal] = useState<boolean>(false);
    const [uploadPropertyId, setUploadPropertyId] = useState<string>('');
    const [uploadMonth, setUploadMonth] = useState<number>(new Date().getMonth() + 1);
    const [uploadYear, setUploadYear] = useState<number>(new Date().getFullYear());
    const [uploadNotes, setUploadNotes] = useState<string>('');
    const [uploadFile, setUploadFile] = useState<File | null>(null);
    const [modalError, setModalError] = useState<string | null>(null);
    const [toastMessage, setToastMessage] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

    const showToast = (message: string, type: 'success' | 'error' = 'success') => {
        setToastMessage({ message, type });
        setTimeout(() => setToastMessage(null), 3500);
    };

    // Load Properties (Filter based on User Permissions)
    const fetchProperties = useCallback(async () => {
        try {
            const isSuperAdmin = userRole === 'org_super_admin' || userRole === 'procurement_admin' || userRole === 'master_admin';

            if (isSuperAdmin) {
                let query = supabase.from('properties').select('id, name').order('name');
                if (organizationId) {
                    query = query.eq('organization_id', organizationId);
                }
                const { data, error } = await query;
                if (!error && data) {
                    setProperties(data);
                    if (data.length > 0 && !uploadPropertyId) {
                        setUploadPropertyId(data[0].id);
                    }
                }
            } else if (user?.id) {
                // Property Admins / Members: fetch assigned properties from property_memberships
                const { data: memberships, error: memError } = await supabase
                    .from('property_memberships')
                    .select('property_id, property:properties(id, name)')
                    .eq('user_id', user.id)
                    .eq('is_active', true);

                if (!memError && memberships && memberships.length > 0) {
                    const userProps: Property[] = memberships
                        .map((m: any) => m.property)
                        .filter(Boolean)
                        .sort((a: Property, b: Property) => a.name.localeCompare(b.name));

                    // Remove duplicate properties
                    const uniqueProps = Array.from(new Map(userProps.map(p => [p.id, p])).values());
                    setProperties(uniqueProps);
                    if (uniqueProps.length > 0) {
                        setUploadPropertyId(uniqueProps[0].id);
                    }
                } else {
                    // Fallback to org properties if no memberships found
                    let query = supabase.from('properties').select('id, name').order('name');
                    if (organizationId) query = query.eq('organization_id', organizationId);
                    const { data } = await query;
                    if (data && data.length > 0) {
                        setProperties(data);
                        setUploadPropertyId(data[0].id);
                    }
                }
            }
        } catch (err) {
            console.error('Failed to fetch properties:', err);
        }
    }, [supabase, organizationId, user, userRole, uploadPropertyId]);

    // Load Requisitions
    const fetchRequisitions = useCallback(async () => {
        setIsLoading(true);
        try {
            const params = new URLSearchParams();
            if (organizationId) params.append('organization_id', organizationId);
            if (selectedPropertyFilter !== 'all') params.append('property_id', selectedPropertyFilter);
            if (selectedStatusFilter !== 'all') params.append('status', selectedStatusFilter);
            if (selectedMonthFilter !== 'all') params.append('requisition_month', selectedMonthFilter);
            if (selectedYearFilter !== 'all') params.append('requisition_year', selectedYearFilter);

            const res = await fetch(`/api/procurement/requisitions?${params.toString()}`);
            const data = await res.json();
            if (res.ok) {
                setRequisitions(data.requisitions || []);
            } else {
                console.error('Fetch requisitions error:', data.error);
            }
        } catch (err) {
            console.error('Error fetching requisitions:', err);
        } finally {
            setIsLoading(false);
        }
    }, [organizationId, selectedPropertyFilter, selectedStatusFilter, selectedMonthFilter, selectedYearFilter]);

    useEffect(() => {
        fetchProperties();
    }, [fetchProperties]);

    useEffect(() => {
        fetchRequisitions();
    }, [fetchRequisitions]);

    // Handle Upload Requisition
    const handleUploadSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setModalError(null);

        const effectivePropertyId = uploadPropertyId || properties[0]?.id;

        if (!uploadFile) {
            setModalError('Please select a file to upload (.xlsx, .xls, .csv).');
            return;
        }
        if (!effectivePropertyId) {
            setModalError('Please select a property.');
            return;
        }

        setIsSubmitting(true);
        try {
            const formData = new FormData();
            formData.append('file', uploadFile);
            formData.append('organization_id', organizationId || '');
            formData.append('property_id', effectivePropertyId);
            formData.append('requisition_month', uploadMonth.toString());
            formData.append('requisition_year', uploadYear.toString());
            formData.append('notes', uploadNotes);
            formData.append('user_id', user?.id || '');

            const res = await fetch('/api/procurement/requisitions', {
                method: 'POST',
                body: formData,
            });
            const data = await res.json();

            if (!res.ok) {
                throw new Error(data.error || 'Failed to upload requisition');
            }

            showToast('Requisition uploaded successfully! Procurement team notified.');
            setShowUploadModal(false);
            setUploadFile(null);
            setUploadNotes('');
            fetchRequisitions();
        } catch (err: any) {
            setModalError(err.message || 'Upload failed');
        } finally {
            setIsSubmitting(false);
        }
    };

    // Handle Acknowledge Requisition
    const handleAcknowledge = async (id: string) => {
        if (!user?.id) return;
        setAcknowledgingId(id);
        try {
            const res = await fetch(`/api/procurement/requisitions/${id}/acknowledge`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ user_id: user.id }),
            });
            const data = await res.json();

            if (!res.ok) {
                throw new Error(data.error || 'Failed to acknowledge requisition');
            }

            showToast('Requisition acknowledged successfully!');
            setRequisitions(prev => prev.map(r => r.id === id ? data.requisition : r));
        } catch (err: any) {
            showToast(err.message || 'Failed to acknowledge', 'error');
        } finally {
            setAcknowledgingId(null);
        }
    };

    // Filtered requisitions (search query)
    const filteredRequisitions = useMemo(() => {
        return requisitions.filter(req => {
            const propName = req.property?.name?.toLowerCase() || '';
            const fileName = req.file_name?.toLowerCase() || '';
            const uploaderName = (req.uploader?.full_name || req.uploader?.email || '').toLowerCase();
            const query = searchQuery.toLowerCase();
            return propName.includes(query) || fileName.includes(query) || uploaderName.includes(query);
        });
    }, [requisitions, searchQuery]);

    const formatFileSize = (bytes?: number) => {
        if (!bytes) return 'N/A';
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    };

    return (
        <div className="space-y-6 p-4 md:p-6 bg-slate-50/50 dark:bg-slate-900/50 min-h-screen">
            {/* Notification Toast */}
            <AnimatePresence>
                {toastMessage && (
                    <motion.div
                        initial={{ opacity: 0, y: -20 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -20 }}
                        className={`fixed top-5 right-5 z-[100] flex items-center gap-2 px-4 py-3 rounded-xl shadow-lg border text-sm font-medium ${
                            toastMessage.type === 'success'
                                ? 'bg-emerald-50 border-emerald-200 text-emerald-800 dark:bg-emerald-950/80 dark:border-emerald-800 dark:text-emerald-200'
                                : 'bg-red-50 border-red-200 text-red-800 dark:bg-red-950/80 dark:border-red-800 dark:text-red-200'
                        }`}
                    >
                        {toastMessage.type === 'success' ? <CheckCircle2 className="w-5 h-5 text-emerald-600" /> : <AlertCircle className="w-5 h-5 text-red-600" />}
                        <span>{toastMessage.message}</span>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Header & Stats Banner */}
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-200/80 dark:border-slate-700 shadow-sm">
                <div>
                    <div className="flex items-center gap-3">
                        <div className="p-3 bg-secondary/10 text-secondary rounded-xl dark:bg-secondary/20">
                            <FileSpreadsheet className="w-6 h-6" />
                        </div>
                        <div>
                            <h1 className="text-xl font-bold text-slate-900 dark:text-white">Monthly Requisitions</h1>
                            <p className="text-xs md:text-sm text-slate-500 dark:text-slate-400">
                                Upload property monthly requirement spreadsheets and track acknowledgement status.
                            </p>
                        </div>
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    <button
                        onClick={fetchRequisitions}
                        className="p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                        title="Refresh List"
                    >
                        <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
                    </button>
                    {canUploadRequisition && (
                        <button
                            onClick={() => setShowUploadModal(true)}
                            className="flex items-center gap-2 bg-secondary hover:bg-secondary-dark text-white px-4 py-2.5 rounded-xl font-medium text-sm transition-all shadow-sm hover:shadow"
                        >
                            <Upload className="w-4 h-4" />
                            <span>Upload Requisition</span>
                        </button>
                    )}
                </div>
            </div>

            {/* Controls & Filters Toolbar */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
                {/* Search */}
                <div className="relative">
                    <Search className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
                    <input
                        type="text"
                        placeholder="Search property, file..."
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                        className="w-full pl-9 pr-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-800 dark:text-slate-200 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-secondary/20 focus:border-secondary"
                    />
                </div>

                {/* Property Filter */}
                <select
                    value={selectedPropertyFilter}
                    onChange={e => setSelectedPropertyFilter(e.target.value)}
                    className="py-2 px-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-secondary/20 focus:border-secondary"
                >
                    <option value="all">All Properties</option>
                    {properties.map(p => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                </select>

                {/* Month Filter */}
                <select
                    value={selectedMonthFilter}
                    onChange={e => setSelectedMonthFilter(e.target.value)}
                    className="py-2 px-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-secondary/20 focus:border-secondary"
                >
                    <option value="all">All Months</option>
                    {MONTH_NAMES.map((month, idx) => (
                        <option key={idx + 1} value={idx + 1}>{month}</option>
                    ))}
                </select>

                {/* Year Filter */}
                <select
                    value={selectedYearFilter}
                    onChange={e => setSelectedYearFilter(e.target.value)}
                    className="py-2 px-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-secondary/20 focus:border-secondary"
                >
                    <option value="all">All Years</option>
                    <option value="2025">2025</option>
                    <option value="2026">2026</option>
                    <option value="2027">2027</option>
                </select>

                {/* Status Filter */}
                <select
                    value={selectedStatusFilter}
                    onChange={e => setSelectedStatusFilter(e.target.value)}
                    className="py-2 px-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-secondary/20 focus:border-secondary"
                >
                    <option value="all">All Statuses</option>
                    <option value="uploaded">Uploaded (Pending)</option>
                    <option value="acknowledged">Acknowledged</option>
                </select>
            </div>

            {/* Requisitions List Table */}
            <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/80 dark:border-slate-700 shadow-sm overflow-hidden">
                {isLoading ? (
                    <div className="py-16 text-center text-slate-500 dark:text-slate-400">
                        <Loader2 className="w-8 h-8 animate-spin mx-auto mb-3 text-sky-500" />
                        <p className="text-sm">Loading requisitions...</p>
                    </div>
                ) : filteredRequisitions.length === 0 ? (
                    <div className="py-16 text-center text-slate-500 dark:text-slate-400">
                        <FileSpreadsheet className="w-12 h-12 mx-auto mb-3 text-slate-300 dark:text-slate-600" />
                        <h3 className="text-base font-semibold text-slate-800 dark:text-slate-200 mb-1">No Requisitions Found</h3>
                        <p className="text-xs md:text-sm">Try adjusting your filters or upload a new requisition file.</p>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm text-slate-600 dark:text-slate-300">
                            <thead className="bg-slate-50 dark:bg-slate-900/60 text-slate-500 dark:text-slate-400 uppercase text-[11px] tracking-wider font-semibold border-b border-slate-200 dark:border-slate-700">
                                <tr>
                                    <th className="py-3.5 px-4">Property</th>
                                    <th className="py-3.5 px-4">Period</th>
                                    <th className="py-3.5 px-4">File Details</th>
                                    <th className="py-3.5 px-4">Uploaded By</th>
                                    <th className="py-3.5 px-4">Status</th>
                                    <th className="py-3.5 px-4 text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 dark:divide-slate-700/50">
                                {filteredRequisitions.map(req => {
                                    const monthName = MONTH_NAMES[req.requisition_month - 1] || req.requisition_month;
                                    const isAcknowledged = req.status === 'acknowledged';

                                    return (
                                        <tr key={req.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-700/30 transition-colors">
                                            {/* Property */}
                                            <td className="py-4 px-4 font-semibold text-slate-900 dark:text-white">
                                                <div className="flex items-center gap-2">
                                                    <Building2 className="w-4 h-4 text-slate-400 shrink-0" />
                                                    <span>{req.property?.name || 'Property'}</span>
                                                </div>
                                            </td>

                                            {/* Month & Year */}
                                            <td className="py-4 px-4">
                                                <div className="flex items-center gap-1.5 font-medium text-slate-800 dark:text-slate-200">
                                                    <Calendar className="w-4 h-4 text-secondary" />
                                                    <span>{monthName} {req.requisition_year}</span>
                                                </div>
                                            </td>

                                            {/* File Info */}
                                            <td className="py-4 px-4">
                                                <div className="space-y-0.5">
                                                    <div className="font-medium text-slate-900 dark:text-white flex items-center gap-1.5 truncate max-w-xs" title={req.file_name}>
                                                        <FileSpreadsheet className="w-4 h-4 text-secondary shrink-0" />
                                                        <span className="truncate">{req.file_name}</span>
                                                    </div>
                                                    <div className="text-xs text-slate-400">
                                                        {formatFileSize(req.file_size_bytes)}
                                                    </div>
                                                </div>
                                            </td>

                                            {/* Uploaded By & Date */}
                                            <td className="py-4 px-4">
                                                <div className="space-y-0.5">
                                                    <div className="text-xs font-medium text-slate-800 dark:text-slate-200">
                                                        {req.uploader?.full_name || req.uploader?.email || 'Admin'}
                                                    </div>
                                                    <div className="text-xs text-slate-400 flex items-center gap-1">
                                                        <Clock className="w-3 h-3" />
                                                        <span>{new Date(req.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' })}</span>
                                                    </div>
                                                </div>
                                            </td>

                                            {/* Status & Acknowledgement */}
                                            <td className="py-4 px-4">
                                                {isAcknowledged ? (
                                                    <div className="space-y-1">
                                                        <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                                                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                                                            <span>Acknowledged</span>
                                                        </div>
                                                        <div className="text-xs font-medium text-slate-700 dark:text-slate-300 flex items-center gap-1">
                                                            <UserCheck className="w-3 h-3 text-emerald-600 shrink-0" />
                                                            <span className="truncate">{req.acknowledger?.full_name || req.acknowledger?.email || 'Procurement Team'}</span>
                                                        </div>
                                                        {req.acknowledged_at && (
                                                            <div className="text-[11px] text-slate-400 flex items-center gap-1">
                                                                <Clock className="w-3 h-3 shrink-0" />
                                                                <span>{new Date(req.acknowledged_at).toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' })}</span>
                                                            </div>
                                                        )}
                                                    </div>
                                                ) : (
                                                    <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
                                                        <Clock className="w-3.5 h-3.5 text-amber-600" />
                                                        <span>Uploaded (Pending)</span>
                                                    </div>
                                                )}
                                            </td>

                                            {/* Actions */}
                                            <td className="py-4 px-4 text-right">
                                                <div className="flex items-center justify-end gap-2">
                                                    {/* Download file button */}
                                                    <a
                                                        href={req.file_url}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        download
                                                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-medium transition-colors"
                                                    >
                                                        <Download className="w-3.5 h-3.5" />
                                                        <span>Download</span>
                                                    </a>

                                                    {/* Acknowledge Button (Procurement users & Super Admins only) */}
                                                    {!isAcknowledged && canAcknowledgeRequisition && (
                                                        <button
                                                            onClick={() => handleAcknowledge(req.id)}
                                                            disabled={acknowledgingId === req.id}
                                                            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium transition-colors disabled:opacity-50"
                                                        >
                                                            {acknowledgingId === req.id ? (
                                                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                                            ) : (
                                                                <UserCheck className="w-3.5 h-3.5" />
                                                            )}
                                                            <span>Acknowledge</span>
                                                        </button>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* Modal: Upload Monthly Requisition */}
            <AnimatePresence>
                {showUploadModal && (
                    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
                        <motion.div
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.95 }}
                            className="bg-white dark:bg-slate-800 w-full max-w-lg rounded-2xl border border-slate-200 dark:border-slate-700 shadow-2xl overflow-hidden"
                        >
                            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900/50">
                                <div className="flex items-center gap-2">
                                    <Upload className="w-5 h-5 text-secondary" />
                                    <h3 className="font-bold text-slate-900 dark:text-white text-lg">Upload Monthly Requisition</h3>
                                </div>
                                <button
                                    onClick={() => setShowUploadModal(false)}
                                    className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700"
                                >
                                    <X className="w-5 h-5" />
                                </button>
                            </div>

                            <form onSubmit={handleUploadSubmit} className="p-6 space-y-4">
                                {modalError && (
                                    <div className="p-3 bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 rounded-xl text-xs flex items-center gap-2">
                                        <AlertCircle className="w-4 h-4 shrink-0" />
                                        <span>{modalError}</span>
                                    </div>
                                )}

                                {/* Property Select / Single Property Display */}
                                <div>
                                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                                        Property <span className="text-red-500">*</span>
                                    </label>
                                    {properties.length === 1 ? (
                                        <div className="flex items-center gap-2.5 px-3.5 py-2.5 bg-slate-100/90 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-semibold text-slate-900 dark:text-white">
                                            <Building2 className="w-4 h-4 text-secondary shrink-0" />
                                            <span>{properties[0].name}</span>
                                            <span className="ml-auto text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full bg-secondary/10 text-secondary border border-secondary/20">
                                                Assigned Property
                                            </span>
                                        </div>
                                    ) : (
                                        <select
                                            value={uploadPropertyId}
                                            onChange={e => setUploadPropertyId(e.target.value)}
                                            required
                                            className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-secondary/20 focus:border-secondary"
                                        >
                                            <option value="" disabled>Select Property</option>
                                            {properties.map(p => (
                                                <option key={p.id} value={p.id}>{p.name}</option>
                                            ))}
                                        </select>
                                    )}
                                </div>

                                {/* Requisition Month & Year */}
                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                                            Requisition Month <span className="text-red-500">*</span>
                                        </label>
                                        <select
                                            value={uploadMonth}
                                            onChange={e => setUploadMonth(parseInt(e.target.value))}
                                            required
                                            className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-secondary/20 focus:border-secondary"
                                        >
                                            {MONTH_NAMES.map((month, idx) => (
                                                <option key={idx + 1} value={idx + 1}>{month}</option>
                                            ))}
                                        </select>
                                    </div>

                                    <div>
                                        <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                                            Requisition Year <span className="text-red-500">*</span>
                                        </label>
                                        <select
                                            value={uploadYear}
                                            onChange={e => setUploadYear(parseInt(e.target.value))}
                                            required
                                            className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-secondary/20 focus:border-secondary"
                                        >
                                            <option value={2025}>2025</option>
                                            <option value={2026}>2026</option>
                                            <option value={2027}>2027</option>
                                        </select>
                                    </div>
                                </div>

                                {/* File Attachment */}
                                <div>
                                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                                        Requisition File (.xlsx, .xls, .csv) <span className="text-red-500">*</span>
                                    </label>
                                    <div className="border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-xl p-4 text-center bg-slate-50/50 dark:bg-slate-900/50 hover:bg-slate-100/50 transition-colors cursor-pointer relative">
                                        <input
                                            type="file"
                                            accept=".xlsx,.xls,.csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
                                            onChange={e => setUploadFile(e.target.files?.[0] || null)}
                                            required
                                            className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                                        />
                                        <FileSpreadsheet className="w-8 h-8 mx-auto text-secondary mb-1" />
                                        {uploadFile ? (
                                            <div>
                                                <p className="text-xs font-bold text-slate-800 dark:text-slate-200 truncate">{uploadFile.name}</p>
                                                <p className="text-[11px] text-slate-400">{formatFileSize(uploadFile.size)}</p>
                                            </div>
                                        ) : (
                                            <div>
                                                <p className="text-xs font-medium text-slate-600 dark:text-slate-300">Click or drag requisition spreadsheet here</p>
                                                <p className="text-[11px] text-slate-400">Supports .xlsx, .xls, .csv up to 15MB</p>
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {/* Notes */}
                                <div>
                                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                                        Notes / Remarks (Optional)
                                    </label>
                                    <textarea
                                        rows={2}
                                        value={uploadNotes}
                                        onChange={e => setUploadNotes(e.target.value)}
                                        placeholder="Add any specific requirements or notes for procurement team..."
                                        className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-secondary/20 focus:border-secondary"
                                    />
                                </div>

                                {/* Modal Footer */}
                                <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-200 dark:border-slate-700">
                                    <button
                                        type="button"
                                        onClick={() => setShowUploadModal(false)}
                                        className="px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-xl transition-colors"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        type="submit"
                                        disabled={isSubmitting}
                                        className="flex items-center gap-2 px-5 py-2 text-sm font-medium bg-secondary hover:bg-secondary-dark text-white rounded-xl transition-all disabled:opacity-50 shadow-sm"
                                    >
                                        {isSubmitting ? (
                                            <>
                                                <Loader2 className="w-4 h-4 animate-spin" />
                                                <span>Uploading...</span>
                                            </>
                                        ) : (
                                            <>
                                                <Upload className="w-4 h-4" />
                                                <span>Submit Requisition</span>
                                            </>
                                        )}
                                    </button>
                                </div>
                            </form>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>
        </div>
    );
}
