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
    currentUser,
    onStatusUpdated
}: ApproverRequisitionModalProps) {
    const [actionType, setActionType] = useState<'approve' | 'reject' | null>(null);
    const [remarks, setRemarks] = useState<string>('');
    const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    const [filterMode, setFilterMode] = useState<'all' | 'requested'>('all');
    const [searchQuery, setSearchQuery] = useState<string>('');

    if (!isOpen || !requisition) return null;

    const monthName = MONTH_NAMES[(requisition.requisition_month || 1) - 1] || 'Month';
    const items = requisition.items || [];
    const vendorQuotation = requisition.vendor_quotation || null;
    const isAlreadyActioned = requisition.status === 'approved' || requisition.status === 'rejected';

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
            const res = await fetch(`/api/procurement/requisitions/${requisition.id}/approve`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action,
                    approver_id: currentUser?.id,
                    approver_name: currentUser?.user_metadata?.full_name || currentUser?.email || 'Approver',
                    remarks
                })
            });

            const data = await res.json();
            if (!res.ok) {
                throw new Error(data.error || 'Failed to update approval status');
            }

            alert(`✅ Requisition ${action === 'approve' ? 'Approved' : 'Rejected'} successfully! Procurement team has been notified via WhatsApp & Email.`);
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
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs overflow-y-auto">
                <motion.div
                    initial={{ opacity: 0, scale: 0.95, y: 20 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95, y: 20 }}
                    className="bg-white rounded-3xl shadow-2xl border border-slate-200 w-full max-w-5xl overflow-hidden my-8 flex flex-col max-h-[90vh]"
                >
                    {/* Modal Header */}
                    <div className="bg-slate-900 text-white p-5 flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-xl bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
                                <ShieldCheck className="w-6 h-6" />
                            </div>
                            <div>
                                <h2 className="text-lg font-black tracking-tight">Requisition In-App Review & Approval</h2>
                                <p className="text-xs text-slate-400">
                                    {requisition.property?.name || 'Property'} • {monthName} {requisition.requisition_year}
                                </p>
                            </div>
                        </div>

                        <button
                            onClick={onClose}
                            className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-all cursor-pointer"
                        >
                            <X className="w-5 h-5" />
                        </button>
                    </div>

                    {/* Modal Content Scroll Area */}
                    <div className="p-6 overflow-y-auto space-y-6 flex-1">
                        {/* Summary KPI Cards */}
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                            <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200">
                                <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block">Property Center</span>
                                <span className="text-base font-black text-slate-800 mt-1 block">
                                    {requisition.property?.name || 'N/A'}
                                </span>
                                <span className="text-xs text-slate-500">
                                    Requested by: {requisition.uploader?.full_name || requisition.uploader?.email || 'Site Team'}
                                </span>
                            </div>

                            <div className="bg-emerald-50/60 p-4 rounded-2xl border border-emerald-200">
                                <span className="text-xs font-bold text-emerald-600 uppercase tracking-wider block">Total Estimated Amount</span>
                                <span className="text-xl font-black text-emerald-700 mt-1 block">
                                    ₹{(vendorQuotation?.total_quoted_amount || requisition.total_estimated_amount || 0).toLocaleString('en-IN')}
                                </span>
                                <span className="text-xs text-emerald-600 font-medium">
                                    {items.length} line items requested
                                </span>
                            </div>

                            <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200 flex flex-col justify-between">
                                <div>
                                    <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block">Requisition Status</span>
                                    <span className={`inline-block px-2.5 py-1 rounded-lg text-xs font-black uppercase mt-1 ${
                                        requisition.status === 'approved' ? 'bg-emerald-100 text-emerald-800' :
                                        requisition.status === 'rejected' ? 'bg-red-100 text-red-800' :
                                        'bg-amber-100 text-amber-800'
                                    }`}>
                                        {requisition.status?.replace('_', ' ')}
                                    </span>
                                </div>

                                <a
                                    href={`/api/procurement/requisitions/${requisition.id}/export`}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="flex items-center gap-1.5 text-xs font-bold text-sky-600 hover:text-sky-800 mt-2"
                                >
                                    <Download className="w-3.5 h-3.5" />
                                    Download Excel Sheet (.xlsx)
                                </a>
                            </div>
                        </div>

                        {/* Vendor Quotation Box (If Uploaded by Procurement) */}
                        {vendorQuotation && (
                            <div className="bg-sky-50/70 border border-sky-200 rounded-2xl p-4">
                                <h3 className="text-xs font-black text-sky-900 uppercase tracking-wider mb-2 flex items-center gap-2">
                                    <FileText className="w-4 h-4 text-sky-600" />
                                    Vendor Quotation Finalized by Procurement
                                </h3>
                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                                    <div>
                                        <span className="text-slate-500 font-semibold block">Selected Vendor:</span>
                                        <span className="font-bold text-slate-900">{vendorQuotation.vendor_name || 'N/A'}</span>
                                    </div>
                                    <div>
                                        <span className="text-slate-500 font-semibold block">Final Quoted Total:</span>
                                        <span className="font-bold text-emerald-700">₹{(vendorQuotation.total_quoted_amount || 0).toLocaleString('en-IN')}</span>
                                    </div>
                                    <div>
                                        <span className="text-slate-500 font-semibold block">Attachment:</span>
                                        {vendorQuotation.file_url ? (
                                            <a
                                                href={vendorQuotation.file_url}
                                                target="_blank"
                                                rel="noreferrer"
                                                className="inline-flex items-center gap-1 text-sky-700 font-bold hover:underline"
                                            >
                                                <Download className="w-3 h-3" />
                                                {vendorQuotation.file_name || 'Quotation File'}
                                            </a>
                                        ) : (
                                            <span className="text-slate-400">No file attached</span>
                                        )}
                                    </div>
                                </div>
                                {vendorQuotation.notes && (
                                    <p className="mt-2 text-xs text-slate-700 bg-white/80 p-2 rounded-lg border border-sky-100 italic">
                                        &quot;{vendorQuotation.notes}&quot;
                                    </p>
                                )}
                            </div>
                        )}

                        {/* Purchase Order (PO) Details Box (If Issued) */}
                        {requisition.po_info && (
                            <div className="bg-emerald-50/80 border border-emerald-200 rounded-2xl p-4">
                                <h3 className="text-xs font-black text-emerald-900 uppercase tracking-wider mb-2 flex items-center gap-2">
                                    <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
                                    Purchase Order Issued to Vendor
                                </h3>
                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                                    <div>
                                        <span className="text-slate-500 font-semibold block">PO Number:</span>
                                        <span className="font-bold text-slate-900">#{requisition.po_info.po_number || 'N/A'}</span>
                                    </div>
                                    <div>
                                        <span className="text-slate-500 font-semibold block">Final PO Value:</span>
                                        <span className="font-bold text-emerald-700">₹{(requisition.po_info.total_po_amount || 0).toLocaleString('en-IN')}</span>
                                    </div>
                                    <div>
                                        <span className="text-slate-500 font-semibold block">Vendor:</span>
                                        <span className="font-bold text-slate-800">{requisition.po_info.vendor_name || 'N/A'}</span>
                                    </div>
                                    {requisition.po_info.expected_delivery_date && (
                                        <div>
                                            <span className="text-slate-500 font-semibold block">Expected Delivery:</span>
                                            <span className="font-bold text-slate-800">{requisition.po_info.expected_delivery_date}</span>
                                        </div>
                                    )}
                                    {requisition.po_info.file_url && (
                                        <div>
                                            <span className="text-slate-500 font-semibold block">PO Document:</span>
                                            <a
                                                href={requisition.po_info.file_url}
                                                target="_blank"
                                                rel="noreferrer"
                                                className="text-emerald-700 underline font-bold"
                                            >
                                                Download PO ({requisition.po_info.file_name || 'PDF'})
                                            </a>
                                        </div>
                                    )}
                                </div>
                                {requisition.po_info.notes && (
                                    <p className="mt-2 text-xs text-slate-700 bg-white/80 p-2 rounded-lg border border-emerald-100 italic">
                                        &quot;{requisition.po_info.notes}&quot;
                                    </p>
                                )}
                            </div>
                        )}

                        {/* Dual Table Display (Requisition vs Available Stock) */}
                        <div>
                            <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                                <div>
                                    <h3 className="text-xs font-black text-slate-700 uppercase tracking-wider">
                                        Dual-Table Comparison (Requested vs. Physical Stock on Site)
                                    </h3>
                                    <p className="text-[11px] text-slate-500">
                                        Showing {items.filter((i: any) => (i.requested_qty || 0) > 0).length} requested items ({items.length} total catalog line items)
                                    </p>
                                </div>
                                <div className="flex items-center gap-2">
                                    {/* Search input */}
                                    <div className="relative">
                                        <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                                        <input
                                            type="text"
                                            placeholder="Search product..."
                                            value={searchQuery}
                                            onChange={e => setSearchQuery(e.target.value)}
                                            className="pl-8 pr-3 py-1 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-800 placeholder:text-slate-400 focus:outline-hidden focus:ring-1 focus:ring-emerald-500 w-36 sm:w-48"
                                        />
                                    </div>
                                    {/* Filter Toggle */}
                                    <div className="flex items-center bg-slate-100 p-0.5 rounded-lg border border-slate-200 text-xs">
                                        <button
                                            type="button"
                                            onClick={() => setFilterMode('all')}
                                            className={`px-2.5 py-1 rounded-md font-bold transition-all cursor-pointer ${filterMode === 'all' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-500 hover:text-slate-800'}`}
                                        >
                                            All ({items.length})
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setFilterMode('requested')}
                                            className={`px-2.5 py-1 rounded-md font-bold transition-all cursor-pointer ${filterMode === 'requested' ? 'bg-emerald-600 text-white shadow-xs' : 'text-slate-500 hover:text-slate-800'}`}
                                        >
                                            Requested Only ({items.filter((i: any) => (i.requested_qty || 0) > 0).length})
                                        </button>
                                    </div>
                                </div>
                            </div>

                            <div className="border border-slate-200 rounded-2xl overflow-hidden max-h-[350px] overflow-y-auto">
                                <table className="w-full text-xs border-collapse">
                                    <thead>
                                        <tr className="bg-slate-100 font-black text-slate-800 border-b border-slate-200 sticky top-0 z-10">
                                            <th className="py-2 px-2 bg-slate-200 border border-slate-300 w-8">#</th>
                                            <th className="py-2 px-3 bg-[#00a2ed] text-white border border-[#00a2ed]">Product</th>
                                            <th className="py-2 px-3 bg-[#48c774] text-slate-950 border border-[#48c774]">Brand</th>
                                            <th className="py-2 px-3 bg-[#ffeb3b] text-slate-950 border border-[#ffeb3b]">Details</th>
                                            <th className="py-2 px-2 bg-emerald-100 text-emerald-950 border border-slate-300">Requested Qty</th>
                                            <th className="py-2 px-2 bg-slate-100 text-slate-800 border border-slate-300">Available Stock</th>
                                            <th className="py-2 px-2 bg-[#ffccbc] text-slate-950 border border-[#ffccbc]">UOM</th>
                                        </tr>
                                    </thead>
                                    <tbody>
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
                                                    <tr key={idx} className={`hover:bg-slate-50 border-b border-slate-100 ${isRequested ? 'bg-emerald-50/20' : ''}`}>
                                                        <td className="py-1.5 px-2 text-center text-slate-500 font-semibold bg-slate-50 border-r border-slate-200">{idx + 1}</td>
                                                        <td className="py-1.5 px-3 font-bold text-slate-900 border-r border-slate-200 bg-[#00a2ed]/5">{item.name}</td>
                                                        <td className="py-1.5 px-3 text-slate-700 border-r border-slate-200 bg-[#48c774]/5">{item.brand || 'NA'}</td>
                                                        <td className="py-1.5 px-3 text-slate-700 border-r border-slate-200 bg-[#ffeb3b]/5">{item.details || '-'}</td>
                                                        <td className={`py-1.5 px-2 text-center font-black border-r border-slate-200 ${isRequested ? 'text-emerald-700 bg-emerald-100/50 text-sm' : 'text-slate-400 bg-slate-50/30'}`}>
                                                            {item.requested_qty || 0}
                                                        </td>
                                                        <td className="py-1.5 px-2 text-center font-bold text-slate-700 bg-slate-50 border-r border-slate-200">{item.available_stock_qty || 0}</td>
                                                        <td className="py-1.5 px-2 text-center font-semibold text-slate-700 bg-[#ffccbc]/10">{item.unit || 'pcs'}</td>
                                                    </tr>
                                                );
                                            })}
                                    </tbody>
                                </table>
                            </div>
                        </div>

                        {/* Approval Remarks Input Box (Approver Only) */}
                        {!isAlreadyActioned && canTakeApprovalAction && (
                            <div className="space-y-2">
                                <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block">
                                    Approver Remarks / Instructions
                                </label>
                                <textarea
                                    value={remarks}
                                    onChange={e => setRemarks(e.target.value)}
                                    placeholder="Enter any specific approval notes or reason for rejection/revision..."
                                    rows={2}
                                    className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
                                />
                                {errorMsg && (
                                    <div className="text-xs text-red-600 font-bold flex items-center gap-1.5 mt-1">
                                        <AlertCircle className="w-3.5 h-3.5" />
                                        {errorMsg}
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Read-Only Notice for Non-Approver Viewers */}
                        {!isAlreadyActioned && !canTakeApprovalAction && (
                            <div className="p-4 rounded-2xl bg-amber-50 border border-amber-200 text-amber-900 text-xs font-medium flex items-center gap-2.5">
                                <ShieldCheck className="w-5 h-5 text-amber-600 shrink-0" />
                                <div>
                                    <span className="font-bold block">Awaiting Decision by Assigned Approver</span>
                                    <span>This requisition requires approval from <b>{requisition.approver_info?.name || 'the designated approver / Org Super Admin'}</b>. You are viewing in read-only mode.</span>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Modal Footer Actions */}
                    <div className="p-5 bg-slate-50 border-t border-slate-200 flex items-center justify-between gap-4">
                        <div className="text-xs text-slate-500 font-medium">
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
                                className="px-4 py-2 rounded-xl text-sm font-semibold text-slate-600 hover:bg-slate-200 transition-all cursor-pointer"
                            >
                                Close
                            </button>

                            {!isAlreadyActioned && canTakeApprovalAction && (
                                <>
                                    <button
                                        onClick={() => handleAction('reject')}
                                        disabled={isSubmitting}
                                        className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold text-red-700 bg-red-100 hover:bg-red-200 transition-all disabled:opacity-50 cursor-pointer"
                                    >
                                        <XCircle className="w-4 h-4" />
                                        Reject / Revise
                                    </button>

                                    <button
                                        onClick={() => handleAction('approve')}
                                        disabled={isSubmitting}
                                        className="flex items-center gap-1.5 px-5 py-2 rounded-xl text-sm font-black text-white bg-emerald-600 hover:bg-emerald-700 shadow-md shadow-emerald-600/20 transition-all disabled:opacity-50 cursor-pointer"
                                    >
                                        {isSubmitting ? (
                                             <Loader2 className="w-4 h-4 animate-spin" />
                                        ) : (
                                            <CheckCircle2 className="w-4 h-4" />
                                        )}
                                        Approve Requisition
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
