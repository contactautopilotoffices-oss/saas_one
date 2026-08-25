'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { createClient } from '@/frontend/utils/supabase/client';
import {
    FileText, Upload, CheckCircle2, Clock, Download, Filter,
    Building2, Calendar, Search, RefreshCw, Loader2, AlertCircle,
    Plus, FileSpreadsheet, Eye, UserCheck, X, ShieldCheck,
    DollarSign, User as UserIcon, ArrowRight, Send, ShoppingCart, Truck, PackageCheck, FileCheck2, Trash2,
    IndianRupee
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import SiteRequisitionSheet from './SiteRequisitionSheet';
import ApproverRequisitionModal from './ApproverRequisitionModal';
import PropertyBudgetManagerModal from './PropertyBudgetManagerModal';
import BulkApproverUploadModal from './BulkApproverUploadModal';

interface Property {
    id: string;
    name: string;
    location?: string;
}

interface MonthlyRequisition {
    id: string;
    organization_id: string;
    property_id: string;
    floor_tag?: string;
    requisition_month: number;
    requisition_year: number;
    file_url: string;
    file_name: string;
    file_size_bytes?: number;
    notes?: string;
    status: string; // 'submitted' | 'uploaded' | 'acknowledged' | 'pending_approval' | 'approved' | 'rejected' | 'ordered'
    created_at: string;
    acknowledged_at?: string;
    uploaded_by?: string;
    acknowledged_by?: string;
    property?: { id: string; name: string };
    uploader?: { id: string; full_name?: string; email: string };
    acknowledger?: { id: string; full_name?: string; email: string };
    items?: any[];
    categories?: string[];
    total_estimated_amount?: number;
    total_items_count?: number;
    vendor_quotation?: any;
    approver_info?: any;
    po_info?: any;
    is_over_budget?: boolean;
    budget_limit?: number;
    over_budget_amount?: number;
    budget_breakdown?: any;
}

interface MonthlyRequisitionsTabProps {
    user: any;
    organizationId?: string;
    propertyId?: string;
    userRole?: string;
    onNavigateToBudgets?: () => void;
}

const MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
];

export default function MonthlyRequisitionsTab({ user, organizationId, propertyId, userRole, onNavigateToBudgets }: MonthlyRequisitionsTabProps) {
    const supabase = createClient();

    const userRoleLower = (userRole || user?.user_metadata?.role || '').toLowerCase();

    // Permissions
    const isPropertyAdmin =
        userRoleLower.includes('property_admin') ||
        userRoleLower.includes('property_manager') ||
        userRoleLower === 'property_admin';

    const isProcurementRole =
        userRoleLower.includes('procurement') ||
        userRoleLower === 'org_super_admin' ||
        userRoleLower === 'master_admin';

    const isSuperAdmin =
        userRoleLower === 'org_super_admin' ||
        userRoleLower === 'master_admin';

    const canCreateRequisition = isPropertyAdmin || isSuperAdmin || isProcurementRole;

    const [requisitions, setRequisitions] = useState<MonthlyRequisition[]>([]);
    const [properties, setProperties] = useState<Property[]>([]);
    const [approverUsers, setApproverUsers] = useState<any[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [viewMode, setViewMode] = useState<'list' | 'create_sheet'>('list');

    // Modals
    const [approverModalReq, setApproverModalReq] = useState<MonthlyRequisition | null>(null);
    const [vendorQuoteModalReq, setVendorQuoteModalReq] = useState<MonthlyRequisition | null>(null);
    const [issuePoModalReq, setIssuePoModalReq] = useState<MonthlyRequisition | null>(null);
    const [showBudgetManagerModal, setShowBudgetManagerModal] = useState<boolean>(false);

    // Vendor Quote Modal Form State
    const [vendorName, setVendorName] = useState<string>('');
    const [vendorQuotedAmount, setVendorQuotedAmount] = useState<string>('');
    const [vendorNotes, setVendorNotes] = useState<string>('');
    const [selectedApproverId, setSelectedApproverId] = useState<string>('');
    const [vendorQuoteFile, setVendorQuoteFile] = useState<File | null>(null);
    const [isSubmittingVendorQuote, setIsSubmittingVendorQuote] = useState<boolean>(false);

    // Issue PO Modal Form State
    const [poNumber, setPoNumber] = useState<string>('');
    const [poVendorName, setPoVendorName] = useState<string>('');
    const [poAmount, setPoAmount] = useState<string>('');
    const [poExpectedDeliveryDate, setPoExpectedDeliveryDate] = useState<string>('');
    const [poNotes, setPoNotes] = useState<string>('');
    const [poFile, setPoFile] = useState<File | null>(null);
    const [isSubmittingPo, setIsSubmittingPo] = useState<boolean>(false);

    // Filters
    const [selectedPropertyFilter, setSelectedPropertyFilter] = useState<string>('all');
    const [selectedStatusFilter, setSelectedStatusFilter] = useState<string>('all');
    const [selectedMonthFilter, setSelectedMonthFilter] = useState<string>('all');
    const [selectedYearFilter, setSelectedYearFilter] = useState<string>('all');
    const [searchQuery, setSearchQuery] = useState<string>('');
    const [isExportingAll, setIsExportingAll] = useState<boolean>(false);
    const [showBulkApprovalModal, setShowBulkApprovalModal] = useState<boolean>(false);

    const handleDownloadAllPropertiesExcel = () => {
        const effectiveOrgId = organizationId || user?.user_metadata?.organization_id || properties[0]?.id;
        if (!effectiveOrgId && !organizationId) return;
        setIsExportingAll(true);
        try {
            const params = new URLSearchParams({
                organization_id: organizationId || user?.user_metadata?.organization_id || '',
            });
            if (selectedMonthFilter !== 'all') {
                params.set('requisition_month', selectedMonthFilter);
            }
            if (selectedYearFilter !== 'all') {
                params.set('requisition_year', selectedYearFilter);
            }
            if (selectedStatusFilter !== 'all') {
                params.set('status', selectedStatusFilter);
            }

            const exportUrl = `/api/procurement/requisitions/export-all?${params.toString()}`;
            
            const link = document.createElement('a');
            link.href = exportUrl;
            link.setAttribute('download', '');
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        } catch (err) {
            console.error('Error downloading all properties excel:', err);
        } finally {
            setTimeout(() => setIsExportingAll(false), 2500);
        }
    };

    // Load Properties
    const fetchProperties = useCallback(async () => {
        try {
            if (isSuperAdmin || isProcurementRole) {
                if (organizationId) {
                    try {
                        const propRes = await fetch(`/api/properties?organization_id=${organizationId}`);
                        if (propRes.ok) {
                            const propData = await propRes.json();
                            if (Array.isArray(propData) && propData.length > 0) {
                                const formatted = propData.map((p: any) => ({
                                    id: p.id,
                                    name: p.name,
                                    location: p.location || p.city || p.address || ''
                                }));
                                setProperties(formatted);
                                if (propertyId && formatted.some((p: any) => p.id === propertyId)) {
                                    setSelectedPropertyFilter(propertyId);
                                }
                                return;
                            }
                        }
                    } catch (e) {
                        console.warn('API property fetch fallback:', e);
                    }
                }

                let query = supabase.from('properties').select('id, name, location').order('name');
                if (organizationId) {
                    query = query.eq('organization_id', organizationId);
                }
                const { data } = await query;
                if (data && data.length > 0) {
                    setProperties(data);
                    if (propertyId && data.some(p => p.id === propertyId)) {
                        setSelectedPropertyFilter(propertyId);
                    }
                }
            } else if (user?.id) {
                const { data: memberships } = await supabase
                    .from('property_memberships')
                    .select('property_id, property:properties(id, name, location)')
                    .eq('user_id', user.id)
                    .eq('is_active', true);

                if (memberships && memberships.length > 0) {
                    const userProps: Property[] = memberships
                        .map((m: any) => m.property)
                        .filter(Boolean);
                    const uniqueProps = Array.from(new Map(userProps.map(p => [p.id, p])).values());
                    setProperties(uniqueProps);
                    
                    // Set default selected property: prioritize current route propertyId if user has access to it, otherwise first assigned property
                    if (propertyId && uniqueProps.some(p => p.id === propertyId)) {
                        setSelectedPropertyFilter(propertyId);
                    } else if (uniqueProps.length > 0) {
                        setSelectedPropertyFilter(uniqueProps[0].id);
                    }
                } else if (propertyId) {
                    const { data: propData } = await supabase
                        .from('properties')
                        .select('id, name, location')
                        .eq('id', propertyId)
                        .maybeSingle();
                    if (propData) {
                        setProperties([propData]);
                        setSelectedPropertyFilter(propData.id);
                    }
                } else {
                    let query = supabase.from('properties').select('id, name, location').order('name');
                    if (organizationId) query = query.eq('organization_id', organizationId);
                    const { data } = await query;
                    if (data) setProperties(data);
                }
            }
        } catch (err) {
            console.error('Failed to fetch properties:', err);
        }
    }, [supabase, organizationId, propertyId, user, isSuperAdmin, isProcurementRole]);

    // Load Approvers (Admins & Directors)
    const fetchApprovers = useCallback(async () => {
        try {
            if (!organizationId) return;
            const { data: members } = await supabase
                .from('organization_memberships')
                .select('user:users!user_id(id, full_name, email, phone), role')
                .eq('organization_id', organizationId)
                .in('role', ['org_super_admin', 'master_admin', 'org_admin', 'property_admin'])
                .eq('is_active', true);

            if (members) {
                const usersList = members.map((m: any) => m.user).filter(Boolean);
                const uniqueUsers = Array.from(new Map(usersList.map((u: any) => [u.id, u])).values());
                setApproverUsers(uniqueUsers);
                if (uniqueUsers.length > 0 && !selectedApproverId) {
                    setSelectedApproverId(uniqueUsers[0].id);
                }
            }
        } catch (e) {
            console.error('Failed to fetch approvers:', e);
        }
    }, [supabase, organizationId, selectedApproverId]);

    // Load Requisitions
    const fetchRequisitions = useCallback(async () => {
        setIsLoading(true);
        try {
            const params = new URLSearchParams();
            if (organizationId) params.append('organization_id', organizationId);
            
            // Strict scoping for Property Admins so they never see other properties
            if (selectedPropertyFilter !== 'all') {
                params.append('property_id', selectedPropertyFilter);
            } else if (propertyId) {
                params.append('property_id', propertyId);
            } else if (isPropertyAdmin && !isSuperAdmin && !isProcurementRole) {
                if (properties.length === 1) {
                    params.append('property_id', properties[0].id);
                } else if (properties.length > 1) {
                    params.append('property_ids', properties.map(p => p.id).join(','));
                }
            }

            if (selectedStatusFilter !== 'all') params.append('status', selectedStatusFilter);
            if (selectedMonthFilter !== 'all') params.append('requisition_month', selectedMonthFilter);
            if (selectedYearFilter !== 'all') params.append('requisition_year', selectedYearFilter);

            const res = await fetch(`/api/procurement/requisitions?${params.toString()}`);
            const data = await res.json();
            if (res.ok) {
                setRequisitions(data.requisitions || []);
            }
        } catch (err) {
            console.error('Error fetching requisitions:', err);
        } finally {
            setIsLoading(false);
        }
    }, [organizationId, selectedPropertyFilter, propertyId, isPropertyAdmin, isSuperAdmin, isProcurementRole, properties, selectedStatusFilter, selectedMonthFilter, selectedYearFilter]);

    useEffect(() => {
        fetchProperties();
        fetchApprovers();
    }, [fetchProperties, fetchApprovers]);

    useEffect(() => {
        fetchRequisitions();
    }, [fetchRequisitions]);

    // Handle Vendor Quotation Submission
    const handleVendorQuotationSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!vendorQuoteModalReq) return;

        setIsSubmittingVendorQuote(true);
        try {
            const formData = new FormData();
            formData.append('vendor_name', 'Vendor Quote');
            formData.append('total_quoted_amount', String(vendorQuoteModalReq.total_estimated_amount || 0));
            formData.append('vendor_notes', vendorNotes);
            formData.append('target_approver_id', selectedApproverId);
            formData.append('action', 'submit_for_approval');
            if (vendorQuoteFile) {
                formData.append('quote_file', vendorQuoteFile);
            }

            const res = await fetch(`/api/procurement/requisitions/${vendorQuoteModalReq.id}`, {
                method: 'PATCH',
                body: formData
            });

            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to submit vendor quote');

            alert('✅ Vendor quotation submitted and sent to Approver for review via WhatsApp & Email!');
            setVendorQuoteModalReq(null);
            fetchRequisitions();
        } catch (err: any) {
            console.error('Quotation upload error:', err);
            alert(`Error: ${err.message}`);
        } finally {
            setIsSubmittingVendorQuote(false);
        }
    };

    const handleIssuePo = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!issuePoModalReq) return;

        if (!poNumber.trim()) {
            alert('Please enter a PO Number.');
            return;
        }

        setIsSubmittingPo(true);
        try {
            const formData = new FormData();
            formData.append('action', 'issue_po');
            formData.append('po_number', poNumber.trim());
            formData.append('vendor_name', poVendorName.trim() || issuePoModalReq.vendor_quotation?.vendor_name || 'Selected Vendor');
            formData.append('total_po_amount', poAmount || String(issuePoModalReq.vendor_quotation?.total_quoted_amount || issuePoModalReq.total_estimated_amount || 0));
            formData.append('expected_delivery_date', poExpectedDeliveryDate);
            formData.append('po_notes', poNotes);
            if (poFile) {
                formData.append('po_file', poFile);
            }

            const res = await fetch(`/api/procurement/requisitions/${issuePoModalReq.id}`, {
                method: 'PATCH',
                body: formData
            });

            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to issue Purchase Order');

            alert(`✅ Purchase Order #${poNumber} issued successfully! Site team has been notified via WhatsApp & Email.`);
            setIssuePoModalReq(null);
            fetchRequisitions();
        } catch (err: any) {
            console.error('Error issuing PO:', err);
            alert(`Error: ${err.message}`);
        } finally {
            setIsSubmittingPo(false);
        }
    };

    const handleDeleteRequisition = async (req: MonthlyRequisition) => {
        const monthName = MONTH_NAMES[(req.requisition_month || 1) - 1];
        const confirmMsg = `Are you sure you want to delete the monthly requisition for ${req.property?.name || 'this property'} (${monthName} ${req.requisition_year})?\n\nThis action will delete the requisition sheet and cannot be undone.`;
        if (!window.confirm(confirmMsg)) return;

        try {
            const res = await fetch(`/api/procurement/requisitions/${req.id}`, {
                method: 'DELETE'
            });

            const data = await res.json();
            if (!res.ok) {
                throw new Error(data.error || 'Failed to delete requisition');
            }

            alert('✅ Requisition deleted successfully.');
            fetchRequisitions();
        } catch (err: any) {
            console.error('Error deleting requisition:', err);
            alert(`Error: ${err.message}`);
        }
    };

    // Filtered Requisitions
    const filteredRequisitions = useMemo(() => {
        return requisitions.filter(req => {
            if (searchQuery) {
                const q = searchQuery.toLowerCase();
                const propName = (req.property?.name || '').toLowerCase();
                const uploaderName = (req.uploader?.full_name || '').toLowerCase();
                const fileName = (req.file_name || '').toLowerCase();
                if (!propName.includes(q) && !uploaderName.includes(q) && !fileName.includes(q)) {
                    return false;
                }
            }
            return true;
        });
    }, [requisitions, searchQuery]);

    const formatFileSize = (bytes?: number) => {
        if (!bytes) return 'N/A';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    };

    // If in Create Sheet mode, render the full-screen interactive dual-table sheet
    if (viewMode === 'create_sheet') {
        const effectivePropertyId = propertyId || (selectedPropertyFilter !== 'all' ? selectedPropertyFilter : properties[0]?.id);
        return (
            <SiteRequisitionSheet
                user={user}
                organizationId={organizationId || ''}
                properties={properties}
                initialPropertyId={effectivePropertyId}
                onSubmitted={() => {
                    setViewMode('list');
                    fetchRequisitions();
                }}
                onCancel={() => setViewMode('list')}
            />
        );
    }

    return (
        <div className="space-y-6">
            {/* Header Section */}
            <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4 bg-white dark:bg-slate-800 p-5 rounded-2xl border border-slate-200/80 dark:border-slate-700 shadow-xs">
                <div className="flex items-center gap-3 min-w-0">
                    <div className="p-2.5 bg-emerald-500/10 text-emerald-600 rounded-xl dark:bg-emerald-500/20 shrink-0">
                        <FileSpreadsheet className="w-5 h-5" />
                    </div>
                    <div className="min-w-0">
                        <h1 className="text-lg font-bold text-slate-900 dark:text-white truncate">Monthly Material Requisitions</h1>
                        <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                            Create, download, and track site requisitions, vendor quotes, and in-app approvals.
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-2 shrink-0 flex-wrap">
                    <button
                        onClick={fetchRequisitions}
                        className="h-9 w-9 inline-flex items-center justify-center rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors cursor-pointer shrink-0"
                        title="Refresh List"
                    >
                        <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
                    </button>

                    {(isProcurementRole || isSuperAdmin) && (
                        <>
                            <button
                                onClick={() => setShowBulkApprovalModal(true)}
                                className="h-9 px-3.5 inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-sky-600 to-blue-700 hover:from-sky-700 hover:to-blue-800 text-white font-bold text-xs whitespace-nowrap transition-all shadow-xs cursor-pointer shrink-0"
                                title="Upload vendor quote and assign approver for multiple properties in 1 click"
                            >
                                <Upload className="w-3.5 h-3.5 text-white shrink-0" />
                                <span>Upload Quote & Approver (Multi-Site)</span>
                            </button>

                            <button
                                onClick={handleDownloadAllPropertiesExcel}
                                disabled={isExportingAll}
                                className="h-9 px-3.5 inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs whitespace-nowrap transition-all shadow-xs cursor-pointer disabled:opacity-60 shrink-0"
                                title="Download 1 consolidated Excel file containing all properties with a separate page for each site"
                            >
                                {isExportingAll ? (
                                    <Loader2 className="w-3.5 h-3.5 animate-spin text-white shrink-0" />
                                ) : (
                                    <Download className="w-3.5 h-3.5 text-white shrink-0" />
                                )}
                                <span>Download All Sites Excel</span>
                            </button>

                            <button
                                onClick={() => {
                                    if (onNavigateToBudgets) {
                                        onNavigateToBudgets();
                                    } else {
                                        const url = new URL(window.location.href);
                                        url.searchParams.set('subtab', 'site-budgets');
                                        url.searchParams.set('procurement_tab', 'site-budgets');
                                        window.location.href = url.pathname + '?' + url.searchParams.toString();
                                    }
                                }}
                                className="h-9 px-3.5 inline-flex items-center gap-1.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 hover:bg-emerald-100 dark:hover:bg-emerald-900/40 text-emerald-800 dark:text-emerald-300 border border-emerald-200/80 dark:border-emerald-800/80 font-bold text-xs whitespace-nowrap transition-all cursor-pointer shadow-xs shrink-0"
                                title="Configure monthly requisition budgets per site/floor"
                            >
                                <IndianRupee className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                                <span>Manage Budgets</span>
                            </button>

                            <button
                                onClick={() => {
                                    const url = new URL(window.location.href);
                                    url.searchParams.set('tab', 'site-pricing');
                                    window.location.href = url.pathname + '?' + url.searchParams.toString();
                                }}
                                className="h-9 px-3.5 inline-flex items-center gap-1.5 rounded-xl bg-slate-50 dark:bg-slate-700 hover:bg-slate-100 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-600 font-bold text-xs whitespace-nowrap transition-all cursor-pointer shrink-0"
                                title="Configure contracted site-specific rates"
                            >
                                <DollarSign className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                                <span>Site Prices</span>
                            </button>
                        </>
                    )}

                    {canCreateRequisition && (
                        <button
                            onClick={() => setViewMode('create_sheet')}
                            className="h-9 px-3.5 inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs whitespace-nowrap transition-all shadow-xs cursor-pointer shrink-0"
                        >
                            <Plus className="w-3.5 h-3.5 shrink-0" />
                            <span>+ Create Sheet</span>
                        </button>
                    )}
                </div>
            </div>

            {/* Filter Bar */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
                <div className="relative">
                    <Search className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
                    <input
                        type="text"
                        placeholder="Search property, user..."
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                        className="w-full pl-9 pr-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs sm:text-sm text-slate-800 dark:text-slate-200 placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-emerald-500 font-medium"
                    />
                </div>

                {(!isSuperAdmin && !isProcurementRole && properties.length <= 1) ? (
                    <div className="flex items-center gap-2 py-2 px-3.5 bg-slate-50 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-700 rounded-xl text-xs sm:text-sm font-bold text-slate-800 dark:text-slate-200 shadow-xs">
                        <Building2 className="w-4 h-4 text-emerald-600 shrink-0" />
                        <span className="truncate">{properties.find(p => p.id === (propertyId || selectedPropertyFilter))?.name || properties[0]?.name || 'Loading Property...'}</span>
                    </div>
                ) : (
                    <select
                        value={selectedPropertyFilter}
                        onChange={e => setSelectedPropertyFilter(e.target.value)}
                        className="py-2 px-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs sm:text-sm text-slate-800 dark:text-slate-200 focus:outline-hidden focus:ring-2 focus:ring-emerald-500 font-medium"
                    >
                        {(isSuperAdmin || isProcurementRole) && (
                            <option value="all">All Properties</option>
                        )}
                        {(!isSuperAdmin && !isProcurementRole && properties.length > 1) && (
                            <option value="all">All Assigned Properties</option>
                        )}
                        {properties.map(p => (
                            <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                    </select>
                )}

                <select
                    value={selectedMonthFilter}
                    onChange={e => setSelectedMonthFilter(e.target.value)}
                    className="py-2 px-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs sm:text-sm text-slate-800 dark:text-slate-200 focus:outline-hidden focus:ring-2 focus:ring-emerald-500 font-medium"
                >
                    <option value="all">All Months</option>
                    {MONTH_NAMES.map((month, idx) => (
                        <option key={idx + 1} value={idx + 1}>{month}</option>
                    ))}
                </select>

                <select
                    value={selectedYearFilter}
                    onChange={e => setSelectedYearFilter(e.target.value)}
                    className="py-2 px-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs sm:text-sm text-slate-800 dark:text-slate-200 focus:outline-hidden focus:ring-2 focus:ring-emerald-500 font-medium"
                >
                    <option value="all">All Years</option>
                    <option value="2025">2025</option>
                    <option value="2026">2026</option>
                    <option value="2027">2027</option>
                </select>

                <select
                    value={selectedStatusFilter}
                    onChange={e => setSelectedStatusFilter(e.target.value)}
                    className="py-2 px-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs sm:text-sm text-slate-800 dark:text-slate-200 focus:outline-hidden focus:ring-2 focus:ring-emerald-500 font-medium"
                >
                    <option value="all">All Statuses</option>
                    <option value="submitted">Submitted (Site)</option>
                    <option value="pending_approval">Pending Approval</option>
                    <option value="approved">Approved</option>
                    <option value="rejected">Rejected</option>
                    <option value="ordered">PO Issued / Ordered</option>
                </select>
            </div>

            {/* Requisitions List Table */}
            <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/80 dark:border-slate-700 shadow-xs overflow-hidden">
                {isLoading ? (
                    <div className="py-16 text-center text-slate-500 dark:text-slate-400">
                        <Loader2 className="w-8 h-8 animate-spin mx-auto mb-3 text-emerald-500" />
                        <p className="text-sm">Loading requisitions...</p>
                    </div>
                ) : filteredRequisitions.length === 0 ? (
                    <div className="py-16 text-center text-slate-500 dark:text-slate-400">
                        <FileSpreadsheet className="w-12 h-12 mx-auto mb-3 text-slate-300 dark:text-slate-600" />
                        <h3 className="text-base font-semibold text-slate-800 dark:text-slate-200 mb-1">No Requisitions Found</h3>
                        <p className="text-xs md:text-sm">Click "+ Create Requisition Sheet" to create your first monthly requisition.</p>
                        {(isProcurementRole || isSuperAdmin) && (
                            <div className="mt-4 flex items-center justify-center gap-3">
                                <button
                                    onClick={handleDownloadAllPropertiesExcel}
                                    disabled={isExportingAll}
                                    className="h-9 px-4 inline-flex items-center gap-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-md shadow-emerald-600/20 transition-all cursor-pointer disabled:opacity-60"
                                >
                                    {isExportingAll ? <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" /> : <Download className="w-3.5 h-3.5 shrink-0" />}
                                    <span>Download All Sites Master Sheet (.xlsx)</span>
                                </button>
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm text-slate-600 dark:text-slate-300">
                            <thead className="bg-slate-50/90 dark:bg-slate-900/80 text-slate-500 dark:text-slate-400 uppercase text-[11px] tracking-wider font-bold border-b border-slate-200 dark:border-slate-700">
                                <tr>
                                    <th className="py-3.5 px-4 whitespace-nowrap">Center / Property</th>
                                    <th className="py-3.5 px-4 whitespace-nowrap">Period</th>
                                    <th className="py-3.5 px-4 whitespace-nowrap">Items & Estimated Amount</th>
                                    <th className="py-3.5 px-4 whitespace-nowrap">Requested By</th>
                                    <th className="py-3.5 px-4 whitespace-nowrap">Status</th>
                                    <th className="py-3.5 px-4 text-right whitespace-nowrap">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 dark:divide-slate-700/50">
                                {filteredRequisitions.map(req => {
                                    const monthName = MONTH_NAMES[req.requisition_month - 1] || req.requisition_month;
                                    const itemsCount = req.total_items_count || req.items?.length || 0;
                                    const totalAmount = req.vendor_quotation?.total_quoted_amount || req.total_estimated_amount || 0;

                                    return (
                                        <tr key={req.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-700/30 transition-colors">
                                            <td className="py-4 px-4 font-semibold text-slate-900 dark:text-white align-middle">
                                                <div className="flex items-center gap-2">
                                                    <Building2 className="w-4 h-4 text-slate-400 shrink-0" />
                                                    <div>
                                                        <span>{req.property?.name || 'Property'}</span>
                                                        {req.floor_tag && req.floor_tag !== 'All Floors' && (
                                                            <span className="block text-[11px] font-bold text-emerald-600">
                                                                Floor: {req.floor_tag}
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>
                                            </td>

                                            <td className="py-4 px-4 align-middle whitespace-nowrap">
                                                <div className="flex items-center gap-1.5 font-medium text-slate-800 dark:text-slate-200">
                                                    <Calendar className="w-4 h-4 text-emerald-600 shrink-0" />
                                                    <span>{monthName} {req.requisition_year}</span>
                                                </div>
                                            </td>

                                            <td className="py-4 px-4 align-middle whitespace-nowrap">
                                                <div className="space-y-0.5">
                                                    <div className="flex items-center gap-2">
                                                        <span className="font-bold text-slate-900 dark:text-white">
                                                            ₹{totalAmount.toLocaleString('en-IN')}
                                                        </span>
                                                        {req.is_over_budget && (
                                                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-black uppercase whitespace-nowrap bg-rose-100 text-rose-800 border border-rose-200 dark:bg-rose-950 dark:text-rose-300 dark:border-rose-800 animate-pulse">
                                                                <AlertCircle className="w-3 h-3 text-rose-600 shrink-0" />
                                                                Over Budget (+₹{(req.over_budget_amount || 0).toLocaleString('en-IN')})
                                                            </span>
                                                        )}
                                                    </div>
                                                    <div className="text-xs text-slate-500 font-medium flex items-center gap-2">
                                                        <span>{itemsCount} line items</span>
                                                        {req.budget_limit && req.budget_limit > 0 ? (
                                                            <span className="text-[11px] text-slate-400">
                                                                · Limit: ₹{req.budget_limit.toLocaleString('en-IN')}
                                                            </span>
                                                        ) : null}
                                                    </div>
                                                </div>
                                            </td>

                                            <td className="py-4 px-4 align-middle whitespace-nowrap">
                                                <div className="space-y-0.5">
                                                    <div className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                                                        {req.uploader?.full_name || req.uploader?.email || 'Site Admin'}
                                                    </div>
                                                    <div className="text-[11px] text-slate-400">
                                                        {new Date(req.created_at).toLocaleDateString('en-GB')}
                                                    </div>
                                                </div>
                                            </td>

                                            <td className="py-4 px-4 align-middle whitespace-nowrap">
                                                <div className="flex flex-col items-start gap-1">
                                                    <span className={`inline-flex items-center gap-1.5 h-6 px-2.5 rounded-lg text-[11px] font-black uppercase tracking-wider whitespace-nowrap shrink-0 ${
                                                        req.status === 'approved' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200/80 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800/80' :
                                                        req.status === 'ordered' ? 'bg-indigo-50 text-indigo-700 border border-indigo-200/80 dark:bg-indigo-950/40 dark:text-indigo-300 dark:border-indigo-800/80' :
                                                        req.status === 'rejected' ? 'bg-rose-50 text-rose-700 border border-rose-200/80 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800/80' :
                                                        req.status === 'pending_approval' ? 'bg-sky-50 text-sky-700 border border-sky-200/80 dark:bg-sky-950/40 dark:text-sky-300 dark:border-sky-800/80' :
                                                        'bg-amber-50 text-amber-700 border border-amber-200/80 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800/80'
                                                    }`}>
                                                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                                                            req.status === 'approved' ? 'bg-emerald-500' :
                                                            req.status === 'ordered' ? 'bg-indigo-500' :
                                                            req.status === 'rejected' ? 'bg-rose-500' :
                                                            req.status === 'pending_approval' ? 'bg-sky-500' :
                                                            'bg-amber-500'
                                                        }`} />
                                                        <span>
                                                            {req.status === 'ordered' ? 'PO Issued' :
                                                             req.status === 'pending_approval' ? 'Pending Approval' : req.status}
                                                        </span>
                                                    </span>
                                                    {req.status === 'pending_approval' && req.approver_info?.name && (
                                                        <span className="text-[10px] font-medium text-slate-400 dark:text-slate-500 whitespace-nowrap truncate max-w-[140px]" title={req.approver_info.name}>
                                                            Approver: <strong className="text-slate-600 dark:text-slate-300 font-semibold">{req.approver_info.name}</strong>
                                                        </span>
                                                    )}
                                                    {req.status === 'ordered' && req.po_info?.po_number && (
                                                        <span className="text-[10px] font-semibold text-indigo-600 dark:text-indigo-400 whitespace-nowrap">
                                                            #{req.po_info.po_number}
                                                        </span>
                                                    )}
                                                </div>
                                            </td>

                                            <td className="py-4 px-4 text-right align-middle whitespace-nowrap">
                                                <div className="inline-flex items-center justify-end gap-2">
                                                    {/* Download Formatted Excel */}
                                                    <a
                                                        href={`/api/procurement/requisitions/${req.id}/export`}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        download
                                                        className="inline-flex items-center gap-1.5 h-8 px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-bold whitespace-nowrap transition-all shadow-2xs shrink-0 cursor-pointer"
                                                        title="Download color-coded Excel spreadsheet matching site format"
                                                    >
                                                        <Download className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                                                        <span>Download .xlsx</span>
                                                    </a>

                                                    {/* Procurement: Upload Vendor Quotation & Request Approval */}
                                                    {isProcurementRole && req.status === 'submitted' && (
                                                        <button
                                                            onClick={() => {
                                                                setVendorQuoteModalReq(req);
                                                                setVendorName(req.vendor_quotation?.vendor_name || '');
                                                                setVendorQuotedAmount(req.vendor_quotation?.total_quoted_amount?.toString() || req.total_estimated_amount?.toString() || '');
                                                            }}
                                                            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold whitespace-nowrap transition-all shadow-xs shrink-0 cursor-pointer"
                                                        >
                                                            <Upload className="w-3.5 h-3.5 text-white shrink-0" />
                                                            <span>Upload Quote & Approver</span>
                                                        </button>
                                                    )}

                                                    {/* Procurement: Issue Purchase Order when status is approved */}
                                                    {isProcurementRole && req.status === 'approved' && (
                                                        <button
                                                            onClick={() => {
                                                                setIssuePoModalReq(req);
                                                                setPoNumber(`PO-${req.requisition_year}-${String(Math.floor(1000 + Math.random() * 9000))}`);
                                                                setPoVendorName(req.vendor_quotation?.vendor_name || '');
                                                                setPoAmount(req.vendor_quotation?.total_quoted_amount?.toString() || req.total_estimated_amount?.toString() || '');
                                                                setPoExpectedDeliveryDate('');
                                                                setPoNotes('');
                                                                setPoFile(null);
                                                            }}
                                                            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold whitespace-nowrap transition-all shadow-xs shrink-0 cursor-pointer"
                                                            title="Issue formal Purchase Order to vendor and alert site team"
                                                        >
                                                            <ShoppingCart className="w-3.5 h-3.5 text-white shrink-0" />
                                                            <span>Issue PO</span>
                                                        </button>
                                                    )}

                                                    {/* Review & Approve / View Details Modal */}
                                                    {(() => {
                                                        const targetApproverId = req.approver_info?.id || req.approver_info?.approver_id || (req as any).target_approver_id;
                                                        const isDesignatedApprover = Boolean(targetApproverId && user?.id === targetApproverId);
                                                        const canApproveThisReq = (isSuperAdmin || isDesignatedApprover) && req.status === 'pending_approval';

                                                        return (
                                                            <button
                                                                onClick={() => setApproverModalReq(req)}
                                                                className={`inline-flex items-center gap-1.5 h-8 px-3.5 rounded-xl text-xs font-bold whitespace-nowrap transition-all shadow-xs shrink-0 cursor-pointer ${
                                                                    canApproveThisReq
                                                                        ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                                                                        : 'border border-slate-800 dark:border-slate-700 bg-slate-900 hover:bg-slate-800 dark:bg-slate-800 dark:hover:bg-slate-700 text-white'
                                                                }`}
                                                            >
                                                                {canApproveThisReq ? (
                                                                    <>
                                                                        <ShieldCheck className="w-3.5 h-3.5 text-white shrink-0" />
                                                                        <span>Review & Approve</span>
                                                                    </>
                                                                ) : (
                                                                    <>
                                                                        <Eye className="w-3.5 h-3.5 text-slate-300 shrink-0" />
                                                                        <span>View Details</span>
                                                                    </>
                                                                )}
                                                            </button>
                                                        );
                                                    })()}

                                                    {/* Delete Option for Requester / Admins */}
                                                    {(() => {
                                                        const isOwner = Boolean(user?.id && (user.id === req.uploaded_by || user.id === req.uploader?.id));
                                                        const canDelete = isOwner || isSuperAdmin || isProcurementRole;

                                                        if (!canDelete) return null;

                                                        return (
                                                            <button
                                                                onClick={() => handleDeleteRequisition(req)}
                                                                className="inline-flex items-center justify-center h-8 w-8 rounded-xl text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-all shrink-0 cursor-pointer"
                                                                title="Delete Requisition"
                                                            >
                                                                <Trash2 className="w-3.5 h-3.5" />
                                                            </button>
                                                        );
                                                    })()}
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

            {/* Modal: Upload Vendor Quotation & Assign Approver */}
            <AnimatePresence>
                {vendorQuoteModalReq && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
                        <motion.div
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.95 }}
                            className="bg-white rounded-3xl shadow-2xl border border-slate-200 w-full max-w-lg overflow-hidden"
                        >
                            <div className="bg-slate-900 text-white p-5 flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <Upload className="w-5 h-5 text-sky-400" />
                                    <h3 className="font-bold text-base">Finalize Vendor Quote & Assign Approver</h3>
                                </div>
                                <button
                                    onClick={() => setVendorQuoteModalReq(null)}
                                    className="p-1 rounded-lg text-slate-400 hover:text-white"
                                >
                                    <X className="w-5 h-5" />
                                </button>
                            </div>

                            <form onSubmit={handleVendorQuotationSubmit} className="p-6 space-y-4">
                                <div>
                                    <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                                        Select Designated Approver <span className="text-red-500">*</span>
                                    </label>
                                    <select
                                        value={selectedApproverId}
                                        onChange={e => setSelectedApproverId(e.target.value)}
                                        required
                                        className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-sky-500"
                                    >
                                        {approverUsers.map(u => (
                                            <option key={u.id} value={u.id}>
                                                {u.full_name || u.email} ({u.email})
                                            </option>
                                        ))}
                                    </select>
                                </div>

                                <div>
                                    <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                                        Attach Vendor Comparative Quotation Sheet (.xlsx / .pdf)
                                    </label>
                                    <input
                                        type="file"
                                        accept=".xlsx,.xls,.pdf,.csv"
                                        onChange={e => setVendorQuoteFile(e.target.files?.[0] || null)}
                                        className="w-full text-xs text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-bold file:bg-sky-50 file:text-sky-700 hover:file:bg-sky-100"
                                    />
                                </div>

                                <div>
                                    <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                                        Procurement Notes for Approver
                                    </label>
                                    <textarea
                                        value={vendorNotes}
                                        onChange={e => setVendorNotes(e.target.value)}
                                        placeholder="Quotes received from 3 vendors, lowest quoted attached..."
                                        rows={2}
                                        className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-sky-500"
                                    />
                                </div>

                                <div className="flex items-center justify-end gap-2 pt-2">
                                    <button
                                        type="button"
                                        onClick={() => setVendorQuoteModalReq(null)}
                                        className="h-9 px-4 inline-flex items-center justify-center rounded-xl text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        type="submit"
                                        disabled={isSubmittingVendorQuote}
                                        className="h-9 px-4.5 inline-flex items-center gap-1.5 rounded-xl text-xs font-black text-white bg-sky-600 hover:bg-sky-700 shadow-md shadow-sky-600/20 transition-all disabled:opacity-50 cursor-pointer"
                                    >
                                        {isSubmittingVendorQuote ? (
                                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                        ) : (
                                            <Send className="w-3.5 h-3.5" />
                                        )}
                                        Send for In-App Approval
                                    </button>
                                </div>
                            </form>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>

            {/* Modal: Issue Purchase Order (PO) */}
            <AnimatePresence>
                {issuePoModalReq && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
                        <motion.div
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.95 }}
                            className="bg-white dark:bg-slate-800 rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-700 w-full max-w-lg overflow-hidden"
                        >
                            <div className="bg-slate-900 text-white p-5 flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-xl bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
                                        <ShoppingCart className="w-5 h-5" />
                                    </div>
                                    <div>
                                        <h3 className="text-base font-black">Issue Purchase Order (PO)</h3>
                                        <p className="text-xs text-slate-400">
                                            {issuePoModalReq.property?.name} • {MONTH_NAMES[(issuePoModalReq.requisition_month || 1) - 1]} {issuePoModalReq.requisition_year}
                                        </p>
                                    </div>
                                </div>
                                <button
                                    onClick={() => setIssuePoModalReq(null)}
                                    className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800"
                                >
                                    <X className="w-5 h-5" />
                                </button>
                            </div>

                            <form onSubmit={handleIssuePo} className="p-6 space-y-4">
                                <div className="p-3.5 bg-emerald-50 dark:bg-emerald-950/30 rounded-2xl border border-emerald-200 dark:border-emerald-800/40 text-xs">
                                    <span className="font-bold text-emerald-800 dark:text-emerald-300 block mb-0.5">Approved Requisition</span>
                                    <p className="text-emerald-700 dark:text-emerald-400">
                                        Approved for ₹{Number(issuePoModalReq.vendor_quotation?.total_quoted_amount || issuePoModalReq.total_estimated_amount || 0).toLocaleString('en-IN')}. Issuing the PO will notify site staff via WhatsApp & Email.
                                    </p>
                                </div>

                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1">
                                            PO Number <span className="text-red-500">*</span>
                                        </label>
                                        <input
                                            type="text"
                                            required
                                            value={poNumber}
                                            onChange={e => setPoNumber(e.target.value)}
                                            placeholder="e.g. PO-2026-089"
                                            className="w-full px-3.5 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-bold text-slate-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
                                        />
                                    </div>

                                    <div>
                                        <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1">
                                            Final PO Amount (₹) <span className="text-red-500">*</span>
                                        </label>
                                        <input
                                            type="number"
                                            required
                                            min="0"
                                            step="0.01"
                                            value={poAmount}
                                            onChange={e => setPoAmount(e.target.value)}
                                            placeholder="Total PO Value"
                                            className="w-full px-3.5 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-bold text-emerald-600 dark:text-emerald-400 focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
                                        />
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1">
                                        Vendor / Supplier Name <span className="text-red-500">*</span>
                                    </label>
                                    <input
                                        type="text"
                                        required
                                        value={poVendorName}
                                        onChange={e => setPoVendorName(e.target.value)}
                                        placeholder="e.g. Reliable Spares & Supplies"
                                        className="w-full px-3.5 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-semibold text-slate-800 dark:text-slate-200 focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
                                    />
                                </div>

                                <div>
                                    <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1">
                                        Expected Delivery Date
                                    </label>
                                    <input
                                        type="date"
                                        value={poExpectedDeliveryDate}
                                        onChange={e => setPoExpectedDeliveryDate(e.target.value)}
                                        className="w-full px-3.5 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-semibold text-slate-800 dark:text-slate-200 focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
                                    />
                                </div>

                                <div>
                                    <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1">
                                        Attach PO Document / PDF (Optional)
                                    </label>
                                    <input
                                        type="file"
                                        accept=".pdf,.png,.jpg,.jpeg,.xlsx"
                                        onChange={e => setPoFile(e.target.files?.[0] || null)}
                                        className="w-full text-xs text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-bold file:bg-emerald-50 file:text-emerald-700 hover:file:bg-emerald-100"
                                    />
                                </div>

                                <div>
                                    <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1">
                                        Site Delivery Instructions / Notes
                                    </label>
                                    <textarea
                                        value={poNotes}
                                        onChange={e => setPoNotes(e.target.value)}
                                        placeholder="Items will be delivered in 2 lots. Site team to verify physical quantities on arrival..."
                                        rows={2}
                                        className="w-full px-3.5 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-800 dark:text-slate-200 focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
                                    />
                                </div>

                                <div className="flex items-center justify-end gap-2 pt-2">
                                    <button
                                        type="button"
                                        onClick={() => setIssuePoModalReq(null)}
                                        className="h-9 px-4 inline-flex items-center justify-center rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-700 transition-colors cursor-pointer"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        type="submit"
                                        disabled={isSubmittingPo}
                                        className="h-9 px-4.5 inline-flex items-center gap-1.5 rounded-xl text-xs font-black text-white bg-emerald-600 hover:bg-emerald-700 shadow-md shadow-emerald-600/20 transition-all disabled:opacity-50 cursor-pointer"
                                    >
                                        {isSubmittingPo ? (
                                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                        ) : (
                                            <ShoppingCart className="w-3.5 h-3.5" />
                                        )}
                                        Issue PO & Notify Site
                                    </button>
                                </div>
                            </form>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>

            {/* In-App Approver Review Modal */}
            <ApproverRequisitionModal
                isOpen={!!approverModalReq}
                onClose={() => setApproverModalReq(null)}
                requisition={approverModalReq}
                allRequisitions={requisitions}
                currentUser={user}
                onStatusUpdated={() => {
                    fetchRequisitions();
                    setApproverModalReq(null);
                }}
            />

            {/* Property Monthly Requisition Budgets Manager Modal */}
            <PropertyBudgetManagerModal
                isOpen={showBudgetManagerModal}
                onClose={() => setShowBudgetManagerModal(false)}
                organizationId={organizationId || ''}
                properties={properties}
                onBudgetsUpdated={() => {
                    fetchRequisitions();
                }}
            />

            {/* Multi-Site Bulk Quote Upload & Approver Assignment Modal */}
            <BulkApproverUploadModal
                isOpen={showBulkApprovalModal}
                onClose={() => setShowBulkApprovalModal(false)}
                requisitions={requisitions}
                approvers={approverUsers}
                organizationId={organizationId || ''}
                currentUser={user}
                onSuccess={() => {
                    fetchRequisitions();
                }}
            />
        </div>
    );
}
