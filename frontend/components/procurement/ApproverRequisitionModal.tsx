'use client';

import React, { useState } from 'react';
import {
    X, CheckCircle2, XCircle, FileSpreadsheet, Download,
    Building2, Calendar, User, DollarSign, FileText, AlertCircle,
    Loader2, ShieldCheck, MessageSquare, Search, Filter
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface ApproverRequisitionModalProps {
    isOpen: boolean;
    onClose: () => void;
    requisition: any;
    allRequisitions?: any[];
    currentUser: any;
    onStatusUpdated: () => void;
}

const MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
];

export default function ApproverRequisitionModal({
    isOpen,
    onClose,
    requisition,
    allRequisitions = [],
    currentUser,
    onStatusUpdated
}: ApproverRequisitionModalProps) {
    const [actionType, setActionType] = useState<'approve' | 'reject' | null>(null);
    const [remarks, setRemarks] = useState<string>('');
    const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    const [filterMode, setFilterMode] = useState<'all' | 'requested'>('all');
    const [searchQuery, setSearchQuery] = useState<string>('');
    const [applyToAllInBatch, setApplyToAllInBatch] = useState<boolean>(true);

    if (!isOpen || !requisition) return null;

    const monthName = MONTH_NAMES[(requisition.requisition_month || 1) - 1] || 'Month';
    const items = requisition.items || [];
    const vendorQuotation = requisition.vendor_quotation || null;
    const isAlreadyActioned = requisition.status === 'approved' || requisition.status === 'rejected';

    // Check if requisition is part of a multi-site batch
    const batchRequisitions = (allRequisitions && vendorQuotation?.batch_id) 
        ? allRequisitions.filter(r => r.vendor_quotation?.batch_id === vendorQuotation.batch_id)
        : [requisition];
    const isMultiSiteBatch = batchRequisitions.length > 1;

    const userRole = (currentUser?.user_metadata?.role || '').toLowerCase();
    const isSuperAdmin = userRole === 'org_super_admin' || userRole === 'master_admin';
    const targetApproverId = requisition.approver_info?.id || requisition.approver_info?.approver_id || (requisition as any).target_approver_id;
    const isDesignatedApprover = Boolean(targetApproverId && currentUser?.id === targetApproverId);
    const canTakeApprovalAction = (isSuperAdmin || isDesignatedApprover) && requisition.status === 'pending_approval';

    const handleAction = async (action: 'approve' | 'reject') => {
        if (!canTakeApprovalAction) {
            setErrorMsg('Unauthorized: Only the designated approver or Org Super Admins can approve or reject this requisition.');
            return;
        }

        if (action === 'reject' && !remarks.trim()) {
            setErrorMsg('Please enter a rejection reason or revision notes.');
            return;
        }

        setIsSubmitting(true);
        setErrorMsg(null);

        try {
            if (isMultiSiteBatch && applyToAllInBatch) {
                const res = await fetch('/api/procurement/requisitions/bulk-approve-action', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        requisition_ids: batchRequisitions.map(r => r.id),
                        action,
                        approver_id: currentUser?.id,
                        approver_name: currentUser?.user_metadata?.full_name || currentUser?.email || 'Approver',
                        remarks: remarks.trim()
                    })
                });

                const data = await res.json();
                if (!res.ok) {
                    throw new Error(data.error || 'Failed to update approval status');
                }

                alert(`✅ Multi-Site Requisitions (${batchRequisitions.length} sites) ${action === 'approve' ? 'Approved' : 'Rejected'} successfully! Procurement team has been notified.`);
            } else {
                const res = await fetch(`/api/procurement/requisitions/${requisition.id}/approve`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        action,
                        approver_id: currentUser?.id,
                        approver_name: currentUser?.user_metadata?.full_name || currentUser?.email || 'Approver',
                        remarks: remarks.trim()
                    })
                });

                const data = await res.json();
                if (!res.ok) {
                    throw new Error(data.error || 'Failed to update approval status');
                }

                alert(`✅ Requisition for ${requisition.property?.name || 'Property'} ${action === 'approve' ? 'Approved' : 'Rejected'} successfully! Procurement team has been notified.`);
            }

            onStatusUpdated();
            onClose();
        } catch (err: any) {
            console.error('Approval action error:', err);
            setErrorMsg(err.message || 'Something went wrong');
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <AnimatePresence>
            <div className="fixed inset-0 z-[9999] flex items-center justify-center p-3 sm:p-6 bg-slate-950/80 backdrop-blur-md overflow-y-auto">
                <motion.div
                    initial={{ opacity: 0, scale: 0.96, y: 15 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.96, y: 15 }}
                    className="bg-white dark:bg-slate-900 rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 w-full max-w-6xl overflow-hidden my-auto flex flex-col max-h-[92vh]"
                >
                    {/* Modal Header */}
                    <div className="bg-slate-950 text-white px-6 py-4 flex items-center justify-between border-b border-slate-800 shrink-0">
                        <div className="flex items-center gap-3.5">
                            <div className="w-10 h-10 rounded-xl bg-emerald-500/20 border border-emerald-400/30 flex items-center justify-center text-emerald-400 shrink-0">
                                <ShieldCheck className="w-5 h-5" />
                            </div>
                            <div>
                                <h2 className="text-base sm:text-lg font-black text-white tracking-tight flex items-center gap-2">
                                    <span>Requisition In-App Review & Approval</span>
                                    <span className={`px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider ${
                                        requisition.status === 'approved' ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40' :
                                        requisition.status === 'rejected' ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40' :
                                        'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                                    }`}>
                                        {requisition.status?.replace('_', ' ')}
                                    </span>
                                </h2>
                                <p className="text-xs text-slate-300 font-medium">
                                    {requisition.property?.name || 'Property Center'}{requisition.floor_tag && requisition.floor_tag !== 'All Floors' ? ` (${requisition.floor_tag})` : ''} • {monthName} {requisition.requisition_year}
                                </p>
                            </div>
                        </div>

                        <div className="flex items-center gap-2">
                            <a
                                href={`/api/procurement/requisitions/${requisition.id}/export`}
                                target="_blank"
                                rel="noreferrer"
                                className="hidden sm:inline-flex items-center gap-1.5 h-8 px-3 rounded-xl text-xs font-bold text-sky-300 bg-sky-950/60 border border-sky-800 hover:bg-sky-900 transition-colors whitespace-nowrap"
                            >
                                <Download className="w-3.5 h-3.5" />
                                <span>Export Excel</span>
                            </a>
                            <button
                                onClick={onClose}
                                className="p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
                                title="Close modal"
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </div>
                    </div>

                    {/* Modal Content Scroll Area */}
                    <div className="p-5 sm:p-6 overflow-y-auto space-y-5 flex-1 bg-white dark:bg-slate-900">
                        {/* Summary KPI Cards */}
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
                            <div className="bg-slate-50 dark:bg-slate-800/60 p-4 rounded-2xl border border-slate-200/80 dark:border-slate-700">
                                <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider block">Property Center</span>
                                <span className="text-base font-black text-slate-900 dark:text-white mt-0.5 block truncate">
                                    {requisition.property?.name || 'N/A'}{requisition.floor_tag && requisition.floor_tag !== 'All Floors' ? ` (${requisition.floor_tag})` : ''}
                                </span>
                                <span className="text-xs text-slate-500 dark:text-slate-400 mt-1 block">
                                    Requested by: <b className="text-slate-700 dark:text-slate-300">{requisition.uploader?.full_name || requisition.uploader?.email || 'Site Team'}</b>
                                </span>
                            </div>

                            <div className="bg-emerald-50/70 dark:bg-emerald-950/30 p-4 rounded-2xl border border-emerald-200/80 dark:border-emerald-800/50">
                                <span className="text-[11px] font-bold text-emerald-700 dark:text-emerald-400 uppercase tracking-wider block">Total Estimated Amount</span>
                                <span className="text-xl font-black text-emerald-800 dark:text-emerald-300 mt-0.5 block">
                                    ₹{(vendorQuotation?.total_quoted_amount || requisition.total_estimated_amount || 0).toLocaleString('en-IN')}
                                </span>
                                <span className="text-xs text-emerald-700 dark:text-emerald-400 font-medium mt-1 block">
                                    {items.length} total line items ({items.filter((i: any) => (i.requested_qty || 0) > 0).length} with requested qty)
                                </span>
                            </div>

                            <div className="bg-slate-50 dark:bg-slate-800/60 p-4 rounded-2xl border border-slate-200/80 dark:border-slate-700 flex flex-col justify-between">
                                <div>
                                    <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider block">Requisition Status</span>
                                    <span className={`inline-flex items-center gap-1.5 h-6 px-2.5 rounded-lg text-[11px] font-black uppercase tracking-wider whitespace-nowrap mt-1 ${
                                        requisition.status === 'approved' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200/80 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800/80' :
                                        requisition.status === 'rejected' ? 'bg-rose-50 text-rose-700 border border-rose-200/80 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800/80' :
                                        requisition.status === 'ordered' ? 'bg-indigo-50 text-indigo-700 border border-indigo-200/80 dark:bg-indigo-950/40 dark:text-indigo-300 dark:border-indigo-800/80' :
                                        requisition.status === 'pending_approval' ? 'bg-sky-50 text-sky-700 border border-sky-200/80 dark:bg-sky-950/40 dark:text-sky-300 dark:border-sky-800/80' :
                                        'bg-amber-50 text-amber-700 border border-amber-200/80 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800/80'
                                    }`}>
                                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                                            requisition.status === 'approved' ? 'bg-emerald-500' :
                                            requisition.status === 'rejected' ? 'bg-rose-500' :
                                            requisition.status === 'ordered' ? 'bg-indigo-500' :
                                            requisition.status === 'pending_approval' ? 'bg-sky-500' :
                                            'bg-amber-500'
                                        }`} />
                                        <span>{requisition.status === 'ordered' ? 'PO Issued' : requisition.status === 'pending_approval' ? 'Pending Approval' : requisition.status?.replace('_', ' ')}</span>
                                    </span>
                                </div>

                                <a
                                    href={`/api/procurement/requisitions/${requisition.id}/export`}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="flex items-center gap-1.5 text-xs font-bold text-sky-600 dark:text-sky-400 hover:underline mt-2"
                                >
                                    <Download className="w-3.5 h-3.5" />
                                    Download Excel Sheet (.xlsx)
                                </a>
                            </div>
                        </div>

                        {/* Budget Audit Card */}
                        <div className={`p-4 rounded-2xl border ${
                            requisition.is_over_budget 
                                ? 'bg-rose-50/80 dark:bg-rose-950/30 border-rose-200 dark:border-rose-800' 
                                : 'bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700'
                        }`}>
                            <div className="flex flex-wrap items-center justify-between gap-3">
                                <div className="flex items-center gap-3">
                                    <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                                        requisition.is_over_budget ? 'bg-rose-600 text-white' : 'bg-emerald-600 text-white'
                                    }`}>
                                        {requisition.is_over_budget ? <AlertCircle className="w-5 h-5" /> : <CheckCircle2 className="w-5 h-5" />}
                                    </div>
                                    <div>
                                        <div className="flex items-center gap-2">
                                            <span className="text-xs font-black uppercase tracking-wider text-slate-900 dark:text-white">
                                                Monthly Budget Audit
                                            </span>
                                            {requisition.is_over_budget ? (
                                                <span className="px-2 py-0.5 rounded-md text-[10px] font-black uppercase bg-rose-200 dark:bg-rose-900 text-rose-900 dark:text-rose-200 border border-rose-300 dark:border-rose-700">
                                                    Over Budget (+₹{(requisition.over_budget_amount || 0).toLocaleString('en-IN')})
                                                </span>
                                            ) : (
                                                <span className="px-2 py-0.5 rounded-md text-[10px] font-black uppercase bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                                                    Within Budget
                                                </span>
                                            )}
                                        </div>
                                        <div className="text-xs text-slate-600 dark:text-slate-400 mt-1 flex flex-wrap items-center gap-3">
                                            {requisition.budget_limit && requisition.budget_limit > 0 ? (
                                                <span>Allocated Limit: <b className="text-slate-900 dark:text-slate-200">₹{requisition.budget_limit.toLocaleString('en-IN')}</b></span>
                                            ) : (
                                                <span>Allocated Limit: <i>No fixed limit set</i></span>
                                            )}
                                            {requisition.budget_breakdown?.hk_spent !== undefined && (
                                                <span>· HK Spent: <b className="text-slate-900 dark:text-slate-200">₹{(requisition.budget_breakdown.hk_spent || 0).toLocaleString('en-IN')}</b></span>
                                            )}
                                            {requisition.budget_breakdown?.beverage_spent !== undefined && (
                                                <span>· Beverage Spent: <b className="text-slate-900 dark:text-slate-200">₹{(requisition.budget_breakdown.beverage_spent || 0).toLocaleString('en-IN')}</b></span>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                {requisition.is_over_budget && (
                                    <div className="text-right">
                                        <span className="text-[10px] font-bold uppercase tracking-wider text-rose-600 dark:text-rose-400 block">Excess Amount</span>
                                        <span className="text-sm font-black text-rose-700 dark:text-rose-300">
                                            +₹{(requisition.over_budget_amount || 0).toLocaleString('en-IN')}
                                        </span>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Vendor Quotation Box (If Uploaded by Procurement) */}
                        {vendorQuotation && (
                            <div className="bg-sky-50/70 dark:bg-sky-950/30 border border-sky-200 dark:border-sky-800 rounded-2xl p-4">
                                <h3 className="text-xs font-black text-sky-900 dark:text-sky-300 uppercase tracking-wider mb-2 flex items-center gap-2">
                                    <FileText className="w-4 h-4 text-sky-600 dark:text-sky-400" />
                                    Vendor Quotation Attached by Procurement
                                </h3>
                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                                    <div>
                                        <span className="text-slate-500 dark:text-slate-400 font-semibold block">Quotation Reference:</span>
                                        <span className="font-bold text-slate-900 dark:text-white">{vendorQuotation.vendor_name || 'Vendor Quote'}</span>
                                    </div>
                                    <div>
                                        <span className="text-slate-500 dark:text-slate-400 font-semibold block">Final Quoted Total:</span>
                                        <span className="font-bold text-emerald-700 dark:text-emerald-400">₹{(vendorQuotation.total_quoted_amount || 0).toLocaleString('en-IN')}</span>
                                    </div>
                                    <div>
                                        <span className="text-slate-500 dark:text-slate-400 font-semibold block">Attachment:</span>
                                        {vendorQuotation.file_url ? (
                                            <a
                                                href={vendorQuotation.file_url}
                                                target="_blank"
                                                rel="noreferrer"
                                                className="inline-flex items-center gap-1 text-sky-700 dark:text-sky-300 font-bold hover:underline"
                                            >
                                                <Download className="w-3.5 h-3.5" />
                                                {vendorQuotation.file_name || 'View Quotation Document'}
                                            </a>
                                        ) : (
                                            <span className="text-slate-400">No file attached</span>
                                        )}
                                    </div>
                                </div>
                                {vendorQuotation.notes && (
                                    <p className="mt-2 text-xs text-slate-700 dark:text-slate-300 bg-white/80 dark:bg-slate-800/80 p-2.5 rounded-xl border border-sky-100 dark:border-sky-900 italic">
                                        &quot;{vendorQuotation.notes}&quot;
                                    </p>
                                )}
                            </div>
                        )}

                        {/* Purchase Order (PO) Details Box (If Issued) */}
                        {requisition.po_info && (
                            <div className="bg-emerald-50/80 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 rounded-2xl p-4">
                                <h3 className="text-xs font-black text-emerald-900 dark:text-emerald-300 uppercase tracking-wider mb-2 flex items-center gap-2">
                                    <FileSpreadsheet className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                                    Purchase Order Issued to Vendor
                                </h3>
                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                                    <div>
                                        <span className="text-slate-500 dark:text-slate-400 font-semibold block">PO Number:</span>
                                        <span className="font-bold text-slate-900 dark:text-white">#{requisition.po_info.po_number || 'N/A'}</span>
                                    </div>
                                    <div>
                                        <span className="text-slate-500 dark:text-slate-400 font-semibold block">Final PO Value:</span>
                                        <span className="font-bold text-emerald-700 dark:text-emerald-400">₹{(requisition.po_info.total_po_amount || 0).toLocaleString('en-IN')}</span>
                                    </div>
                                    <div>
                                        <span className="text-slate-500 dark:text-slate-400 font-semibold block">Vendor:</span>
                                        <span className="font-bold text-slate-800 dark:text-slate-200">{requisition.po_info.vendor_name || 'N/A'}</span>
                                    </div>
                                    {requisition.po_info.expected_delivery_date && (
                                        <div>
                                            <span className="text-slate-500 dark:text-slate-400 font-semibold block">Expected Delivery:</span>
                                            <span className="font-bold text-slate-800 dark:text-slate-200">{requisition.po_info.expected_delivery_date}</span>
                                        </div>
                                    )}
                                    {requisition.po_info.file_url && (
                                        <div>
                                            <span className="text-slate-500 dark:text-slate-400 font-semibold block">PO Document:</span>
                                            <a
                                                href={requisition.po_info.file_url}
                                                target="_blank"
                                                rel="noreferrer"
                                                className="text-emerald-700 dark:text-emerald-300 underline font-bold"
                                            >
                                                Download PO ({requisition.po_info.file_name || 'PDF'})
                                            </a>
                                        </div>
                                    )}
                                </div>
                                {requisition.po_info.notes && (
                                    <p className="mt-2 text-xs text-slate-700 dark:text-slate-300 bg-white/80 dark:bg-slate-800/80 p-2.5 rounded-xl border border-emerald-100 dark:border-emerald-900 italic">
                                        &quot;{requisition.po_info.notes}&quot;
                                    </p>
                                )}
                            </div>
                        )}

                        {/* Dual Table Display (Requisition vs Available Stock) */}
                        <div>
                            <div className="flex flex-wrap items-center justify-between gap-3 mb-2.5">
                                <div>
                                    <h3 className="text-xs font-black text-slate-900 dark:text-white uppercase tracking-wider">
                                        Item-by-Item Breakdown & Physical Stock
                                    </h3>
                                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                                        Showing {items.filter((i: any) => (i.requested_qty || 0) > 0).length} requested items ({items.length} total catalog line items)
                                    </p>
                                </div>
                                <div className="flex items-center gap-2">
                                    {/* Search input */}
                                    <div className="relative">
                                        <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                                        <input
                                            type="text"
                                            placeholder="Search item..."
                                            value={searchQuery}
                                            onChange={e => setSearchQuery(e.target.value)}
                                            className="pl-8 pr-3 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-emerald-500 w-36 sm:w-48"
                                        />
                                    </div>
                                    {/* Filter Toggle */}
                                    <div className="flex items-center bg-slate-100 dark:bg-slate-800 p-0.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs">
                                        <button
                                            type="button"
                                            onClick={() => setFilterMode('all')}
                                            className={`px-2.5 py-1 rounded-lg font-bold transition-all cursor-pointer ${filterMode === 'all' ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs' : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'}`}
                                        >
                                            All ({items.length})
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setFilterMode('requested')}
                                            className={`px-2.5 py-1 rounded-lg font-bold transition-all cursor-pointer ${filterMode === 'requested' ? 'bg-emerald-600 text-white shadow-xs' : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'}`}
                                        >
                                            Requested Only ({items.filter((i: any) => (i.requested_qty || 0) > 0).length})
                                        </button>
                                    </div>
                                </div>
                            </div>

                            <div className="border border-slate-200 dark:border-slate-700 rounded-2xl overflow-hidden max-h-[320px] overflow-y-auto">
                                <table className="w-full text-xs border-collapse">
                                    <thead>
                                        <tr className="bg-slate-100 dark:bg-slate-800 font-black text-slate-800 dark:text-slate-200 border-b border-slate-200 dark:border-slate-700 sticky top-0 z-10">
                                            <th className="py-2.5 px-2.5 bg-slate-200 dark:bg-slate-700 border-r border-slate-300 dark:border-slate-600 w-10 text-center">#</th>
                                            <th className="py-2.5 px-3 bg-sky-100 dark:bg-sky-950 text-sky-950 dark:text-sky-200 border-r border-slate-200 dark:border-slate-700 text-left">Product Name</th>
                                            <th className="py-2.5 px-3 bg-slate-100 dark:bg-slate-800 border-r border-slate-200 dark:border-slate-700 text-left">Brand</th>
                                            <th className="py-2.5 px-3 bg-slate-100 dark:bg-slate-800 border-r border-slate-200 dark:border-slate-700 text-left">Specification / Details</th>
                                            <th className="py-2.5 px-3 bg-emerald-100 dark:bg-emerald-950 text-emerald-950 dark:text-emerald-200 border-r border-slate-200 dark:border-slate-700 text-center min-w-[90px]">Requested Qty</th>
                                            <th className="py-2.5 px-3 bg-slate-100 dark:bg-slate-800 border-r border-slate-200 dark:border-slate-700 text-center min-w-[90px]">Available Stock</th>
                                            <th className="py-2.5 px-2.5 bg-slate-100 dark:bg-slate-800 text-center min-w-[60px]">UOM</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                                        {items
                                            .filter((item: any) => {
                                                if (filterMode === 'requested' && !(item.requested_qty > 0)) return false;
                                                if (searchQuery.trim()) {
                                                    const q = searchQuery.toLowerCase();
                                                    return (item.name || '').toLowerCase().includes(q) ||
                                                           (item.brand || '').toLowerCase().includes(q) ||
                                                           (item.details || '').toLowerCase().includes(q);
                                                }
                                                return true;
                                            })
                                            .map((item: any, idx: number) => {
                                                const isRequested = (item.requested_qty || 0) > 0;
                                                return (
                                                    <tr key={idx} className={`hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors ${isRequested ? 'bg-emerald-50/30 dark:bg-emerald-950/20' : ''}`}>
                                                        <td className="py-2 px-2.5 text-center text-slate-500 dark:text-slate-400 font-semibold bg-slate-50/50 dark:bg-slate-800/40 border-r border-slate-100 dark:border-slate-800">{idx + 1}</td>
                                                        <td className="py-2 px-3 font-bold text-slate-900 dark:text-white border-r border-slate-100 dark:border-slate-800">{item.name}</td>
                                                        <td className="py-2 px-3 text-slate-600 dark:text-slate-300 border-r border-slate-100 dark:border-slate-800">{item.brand || '—'}</td>
                                                        <td className="py-2 px-3 text-slate-600 dark:text-slate-300 border-r border-slate-100 dark:border-slate-800">{item.details || '—'}</td>
                                                        <td className={`py-2 px-3 text-center font-black border-r border-slate-100 dark:border-slate-800 min-w-[90px] tabular-nums ${isRequested ? 'text-emerald-700 dark:text-emerald-300 bg-emerald-100/60 dark:bg-emerald-900/40 text-sm' : 'text-slate-400'}`}>
                                                            {item.requested_qty || 0}
                                                        </td>
                                                        <td className="py-2 px-3 text-center font-bold text-slate-700 dark:text-slate-300 border-r border-slate-100 dark:border-slate-800 min-w-[90px] tabular-nums">{item.available_stock_qty || 0}</td>
                                                        <td className="py-2 px-2.5 text-center font-semibold text-slate-600 dark:text-slate-400 min-w-[60px]">{item.unit || 'pcs'}</td>
                                                    </tr>
                                                );
                                            })}
                                    </tbody>
                                </table>
                            </div>
                        </div>

                        {/* Multi-Site Batch Overview (If Applicable) */}
                        {isMultiSiteBatch && (
                            <div className="bg-sky-50/80 dark:bg-sky-950/30 border border-sky-200 dark:border-sky-800 rounded-2xl p-4 space-y-3">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                    <div className="flex items-center gap-2">
                                        <Building2 className="w-4 h-4 text-sky-600 dark:text-sky-400" />
                                        <h4 className="text-xs font-black text-sky-900 dark:text-sky-300 uppercase tracking-wider">
                                            Multi-Site Batch ({batchRequisitions.length} Sites Included)
                                        </h4>
                                    </div>
                                    <label className="flex items-center gap-2 text-xs font-bold text-sky-800 dark:text-sky-300 cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={applyToAllInBatch}
                                            onChange={e => setApplyToAllInBatch(e.target.checked)}
                                            className="w-4 h-4 rounded text-sky-600 focus:ring-sky-500"
                                        />
                                        <span>Apply action to all {batchRequisitions.length} sites in this batch</span>
                                    </label>
                                </div>

                                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2 text-xs">
                                    {batchRequisitions.map(bReq => (
                                        <div key={bReq.id} className="p-2.5 bg-white dark:bg-slate-800 rounded-xl border border-sky-100 dark:border-sky-900 flex items-center justify-between">
                                            <span className="font-bold text-slate-800 dark:text-slate-200 truncate">
                                                {bReq.property?.name || 'Property'} {bReq.floor_tag && bReq.floor_tag !== 'All Floors' ? `(${bReq.floor_tag})` : ''}
                                            </span>
                                            <span className="font-semibold text-emerald-700 dark:text-emerald-400">
                                                ₹{(bReq.total_estimated_amount || 0).toLocaleString('en-IN')}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Approval Remarks Input Box (Approver Only) */}
                        {!isAlreadyActioned && canTakeApprovalAction && (
                            <div className="space-y-1.5">
                                <label className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider block">
                                    Approver Remarks / Instructions
                                </label>
                                <textarea
                                    value={remarks}
                                    onChange={e => setRemarks(e.target.value)}
                                    placeholder="Enter any specific approval notes, payment conditions, or reason for revision/rejection..."
                                    rows={2}
                                    className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-3 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
                                />
                                {errorMsg && (
                                    <div className="text-xs text-rose-600 dark:text-rose-400 font-bold flex items-center gap-1.5 mt-1">
                                        <AlertCircle className="w-4 h-4" />
                                        {errorMsg}
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Read-Only Notice for Non-Approver Viewers */}
                        {!isAlreadyActioned && !canTakeApprovalAction && (
                            <div className="p-4 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-amber-900 dark:text-amber-200 text-xs font-medium flex items-center gap-2.5">
                                <ShieldCheck className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0" />
                                <div>
                                    <span className="font-bold block">Awaiting Decision by Assigned Approver</span>
                                    <span>This requisition requires approval from <b>{requisition.approver_info?.name || 'the designated approver / Org Super Admin'}</b>. You are viewing in read-only mode.</span>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Modal Footer Actions */}
                    <div className="p-4 sm:p-5 bg-slate-50 dark:bg-slate-950 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-4 shrink-0">
                        <div className="text-xs text-slate-500 dark:text-slate-400 font-medium">
                            {isAlreadyActioned ? (
                                <span>Status has already been marked as <b>{requisition.status}</b>.</span>
                            ) : canTakeApprovalAction ? (
                                <span>Taking action will notify the Procurement team to proceed with the Purchase Order.</span>
                            ) : (
                                <span>Read-only inspection mode.</span>
                            )}
                        </div>

                        <div className="flex items-center gap-2">
                            <button
                                onClick={onClose}
                                className="h-9 px-4 inline-flex items-center justify-center rounded-xl text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                            >
                                Close
                            </button>

                            {!isAlreadyActioned && canTakeApprovalAction && (
                                <>
                                    <button
                                        onClick={() => handleAction('reject')}
                                        disabled={isSubmitting}
                                        className="h-9 px-4 inline-flex items-center gap-1.5 rounded-xl text-xs font-bold text-rose-700 dark:text-rose-300 bg-rose-100 dark:bg-rose-950/80 hover:bg-rose-200 dark:hover:bg-rose-900/80 transition-colors disabled:opacity-50 cursor-pointer"
                                    >
                                        <XCircle className="w-3.5 h-3.5" />
                                        <span>Reject / Revise</span>
                                    </button>

                                    <button
                                        onClick={() => handleAction('approve')}
                                        disabled={isSubmitting}
                                        className="h-9 px-5 inline-flex items-center gap-1.5 rounded-xl text-xs font-black text-white bg-emerald-600 hover:bg-emerald-700 shadow-md shadow-emerald-600/20 transition-all disabled:opacity-50 cursor-pointer"
                                    >
                                        {isSubmitting ? (
                                             <Loader2 className="w-3.5 h-3.5 animate-spin text-white" />
                                        ) : (
                                             <CheckCircle2 className="w-3.5 h-3.5 text-white" />
                                        )}
                                        <span>Approve Requisition</span>
                                    </button>
                                </>
                            )}
                        </div>
                    </div>
                </motion.div>
            </div>
        </AnimatePresence>
    );
}
