'use client';

import React, { useState } from 'react';
import {
    X, CheckCircle2, XCircle, FileSpreadsheet, Download,
    Building2, Calendar, User, DollarSign, FileText, AlertCircle,
    Loader2, ShieldCheck, MessageSquare, Search, Filter,
    Maximize2, Minimize2, ArrowLeft
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import ModalPortal from '../ui/ModalPortal';
import { siteVendorQuotation, siteEstimatedAmount, fileRevision } from '@/backend/lib/procurement/requisition-approval.mjs';
import { maskStorageUrl } from '@/frontend/utils/storageUrl';

interface ApproverRequisitionModalProps {
    isOpen?: boolean;
    isInline?: boolean; // When true, renders directly in-body without fixed backdrop overlay
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
    isOpen = true,
    isInline = false,
    onClose,
    requisition,
    currentUser,
    onStatusUpdated
}: ApproverRequisitionModalProps) {
    const [remarks, setRemarks] = useState<string>('');
    const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    const [filterMode, setFilterMode] = useState<'all' | 'requested'>('all');
    const [searchQuery, setSearchQuery] = useState<string>('');
    const [isTableMaximized, setIsTableMaximized] = useState<boolean>(false);

    if (!requisition) return null;
    if (!isInline && !isOpen) return null;

    const monthName = MONTH_NAMES[(requisition.requisition_month || 1) - 1] || 'Month';
    const items = requisition.items || [];
    const requestedCount = items.filter((i: any) => (i.requested_qty || 0) > 0).length;
    const vendorQuotation = (() => {
        try { return siteVendorQuotation(requisition); } catch { return null; }
    })();
    const estimatedTotal = (() => {
        try {
            return siteEstimatedAmount(requisition);
        } catch {
            const fallback = Number(requisition?.total_estimated_amount || 0);
            return Number.isFinite(fallback) && fallback >= 0 ? fallback : 0;
        }
    })();
    const isAlreadyActioned = requisition.status === 'approved' || requisition.status === 'rejected';

    const userRole = (currentUser?.user_metadata?.role || '').toLowerCase();
    const isSuperAdmin = userRole === 'org_super_admin' || userRole === 'master_admin';
    const targetApproverId = requisition.approver_info?.id || requisition.approver_info?.approver_id || (requisition as any).target_approver_id;
    const isDesignatedApprover = Boolean(targetApproverId && currentUser?.id === targetApproverId);
    const canTakeApprovalAction = (isSuperAdmin || isDesignatedApprover) && requisition.status === 'pending_approval';

    // Safely extract creator / site notes across all schema variations
    const creatorNotes = (() => {
        if (requisition.site_notes && typeof requisition.site_notes === 'string' && !requisition.site_notes.trim().startsWith('{')) {
            return requisition.site_notes.trim();
        }
        if (requisition.creator_notes && typeof requisition.creator_notes === 'string') {
            return requisition.creator_notes.trim();
        }
        if (requisition.notes && typeof requisition.notes === 'string') {
            const trimmed = requisition.notes.trim();
            if (trimmed.startsWith('{')) {
                try {
                    const parsed = JSON.parse(trimmed);
                    return (parsed.site_notes || parsed.creator_notes || '').trim();
                } catch {
                    return '';
                }
            }
            return trimmed;
        }
        if (typeof requisition.notes === 'object' && requisition.notes !== null) {
            return (requisition.notes.site_notes || requisition.notes.creator_notes || '').trim();
        }
        return '';
    })();

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
                // The server refuses the decision if procurement replaced the file after this screen loaded.
                body: JSON.stringify({ action, remarks: remarks.trim(), file_revision: fileRevision(requisition) })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to update approval status');
            alert(`✅ Requisition for ${requisition.property?.name || 'Property'} ${action === 'approve' ? 'Approved' : 'Rejected'} successfully! Procurement team has been notified.`);

            onStatusUpdated();
            onClose();
        } catch (err: any) {
            console.error('Approval action error:', err);
            setErrorMsg(err.message || 'Something went wrong');
        } finally {
            setIsSubmitting(false);
        }
    };

    // Shared content body
    const renderContent = (inModal: boolean) => (
        <div className={`${inModal ? 'p-4 sm:p-6 overflow-y-auto space-y-4 flex-1 bg-white dark:bg-slate-900' : 'space-y-5'}`}>
            {/* Compact Header Bar When Table is Maximized */}
            {isTableMaximized ? (
                <div className="bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 p-3 rounded-2xl flex flex-wrap items-center justify-between gap-3 text-xs">
                    <div className="flex flex-wrap items-center gap-3">
                        <span className="font-bold text-slate-900 dark:text-white">
                            {requisition.property?.name || 'N/A'}{requisition.floor_tag && requisition.floor_tag !== 'All Floors' ? ` (${requisition.floor_tag})` : ''}
                        </span>
                        <span className="text-slate-400">·</span>
                        <span className="text-slate-600 dark:text-slate-300">
                            Creator: <strong>{requisition.uploader?.full_name || requisition.uploader?.email || 'Site Team'}</strong>
                        </span>
                        <span className="text-slate-400">·</span>
                        <span className="text-emerald-700 dark:text-emerald-400 font-black">
                            Total: ₹{estimatedTotal.toLocaleString('en-IN')}
                        </span>
                        {creatorNotes && (
                            <span className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-700 dark:text-amber-400 bg-amber-100 dark:bg-amber-950/60 px-2 py-0.5 rounded-md" title={creatorNotes}>
                                <MessageSquare size={11} /> Note: &quot;{creatorNotes.slice(0, 40)}{creatorNotes.length > 40 ? '…' : ''}&quot;
                            </span>
                        )}
                    </div>
                    <button
                        type="button"
                        onClick={() => setIsTableMaximized(false)}
                        className="text-xs font-bold text-sky-600 dark:text-sky-400 hover:underline flex items-center gap-1 cursor-pointer"
                    >
                        <Minimize2 className="w-3.5 h-3.5" />
                        <span>Show Summary Cards</span>
                    </button>
                </div>
            ) : (
                <>
                    {/* Summary KPI Cards */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
                        <div className="bg-slate-50 dark:bg-slate-800/60 p-4 rounded-2xl border border-slate-200/80 dark:border-slate-700">
                            <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider block">Property Center</span>
                            <span className="text-base font-black text-slate-900 dark:text-white mt-0.5 block truncate">
                                {requisition.property?.name || 'N/A'}{requisition.floor_tag && requisition.floor_tag !== 'All Floors' ? ` (${requisition.floor_tag})` : ''}
                            </span>
                            <div className="text-xs text-slate-500 dark:text-slate-400 mt-1 flex flex-wrap items-center gap-1.5">
                                <span>Requested by:</span>
                                <strong className="text-slate-700 dark:text-slate-300">{requisition.uploader?.full_name || requisition.uploader?.email || 'Site Team'}</strong>
                            </div>
                        </div>

                        <div className="bg-emerald-50/70 dark:bg-emerald-950/30 p-4 rounded-2xl border border-emerald-200/80 dark:border-emerald-800/50">
                            <span className="text-[11px] font-bold text-emerald-700 dark:text-emerald-400 uppercase tracking-wider block">Total Estimated Amount</span>
                            <span className="text-xl font-black text-emerald-800 dark:text-emerald-300 mt-0.5 block">
                                ₹{estimatedTotal.toLocaleString('en-IN')}
                            </span>
                            <span className="text-xs text-emerald-700 dark:text-emerald-400 font-medium mt-1 block">
                                {items.length} total line items ({requestedCount} with requested qty)
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

                    {/* Creator / Site Requisition Notes Box */}
                    {creatorNotes && (
                        <div className="bg-gradient-to-r from-amber-50/90 via-amber-50/50 to-orange-50/40 dark:from-amber-950/30 dark:via-amber-950/20 dark:to-slate-900 border border-amber-200 dark:border-amber-800/60 rounded-2xl p-4 flex items-start gap-3.5 shadow-2xs">
                            <div className="w-9 h-9 rounded-xl bg-amber-500/15 border border-amber-500/25 text-amber-700 dark:text-amber-400 flex items-center justify-center shrink-0 mt-0.5">
                                <MessageSquare className="w-4 h-4" />
                            </div>
                            <div className="flex-1 min-w-0">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                    <div className="flex items-center gap-2">
                                        <span className="text-xs font-black uppercase tracking-wider text-amber-900 dark:text-amber-300">
                                            Creator Requisition Notes / Site Instructions
                                        </span>
                                        <span className="px-2 py-0.5 rounded-md text-[10px] font-black uppercase bg-amber-200/70 dark:bg-amber-900/50 text-amber-900 dark:text-amber-200 border border-amber-300/60 dark:border-amber-700/60">
                                            From Creator
                                        </span>
                                    </div>
                                    <span className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">
                                        Submitted by <strong className="text-slate-700 dark:text-slate-300">{requisition.uploader?.full_name || requisition.uploader?.email || 'Site Requester'}</strong>
                                    </span>
                                </div>
                                <div className="mt-2 text-xs text-slate-800 dark:text-slate-200 font-medium whitespace-pre-wrap leading-relaxed bg-white/90 dark:bg-slate-900/80 p-3 rounded-xl border border-amber-200/60 dark:border-amber-800/40 shadow-2xs">
                                    &quot;{creatorNotes}&quot;
                                </div>
                            </div>
                        </div>
                    )}

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

                    {/* Re-approval: procurement replaced the comparison file after sending it */}
                    {vendorQuotation?.is_reapproval && (
                        <div role="status" className="bg-amber-50 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-800 rounded-2xl p-4 text-xs text-amber-900 dark:text-amber-200 space-y-1.5">
                            <h3 className="font-black uppercase tracking-wider flex items-center gap-2">
                                <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                                Re-approval request · Rev {fileRevision(requisition)}
                            </h3>
                            <p>
                                The comparison file was updated
                                {vendorQuotation.replaced_by_name ? <> by <b>{vendorQuotation.replaced_by_name}</b></> : null}
                                {vendorQuotation.replaced_at ? <> on <b>{new Date(vendorQuotation.replaced_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</b></> : null}.
                                {' '}Please review the new file before deciding.
                            </p>
                            {vendorQuotation.previous_decision?.status === 'approved' && (
                                <p className="font-bold">
                                    This site was approved earlier by {vendorQuotation.previous_decision.by_name || 'the approver'} on the old file and needs approval again.
                                </p>
                            )}
                            {vendorQuotation.previous_decision?.status === 'rejected' && (
                                <p>
                                    Rejected earlier by {vendorQuotation.previous_decision.by_name || 'the approver'}
                                    {vendorQuotation.previous_decision.remarks ? <>: &quot;{vendorQuotation.previous_decision.remarks}&quot;</> : '.'}
                                </p>
                            )}
                            {vendorQuotation.reapproval_note && (
                                <p><b>What was corrected:</b> {vendorQuotation.reapproval_note}</p>
                            )}
                            {Array.isArray(vendorQuotation.previous_files) && vendorQuotation.previous_files.length > 0 && (
                                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-1">
                                    <span className="font-semibold">Previous files:</span>
                                    {vendorQuotation.previous_files.map((previous: { revision?: number; file_url?: string; file_name?: string }) => previous?.file_url ? (
                                        <a key={`${previous.revision}-${previous.file_url}`}
                                            href={maskStorageUrl(previous.file_url) || previous.file_url}
                                            target="_blank" rel="noreferrer"
                                            className="inline-flex items-center gap-1 text-amber-800 dark:text-amber-300 underline">
                                            <Download className="w-3 h-3" /> Rev {previous.revision}{previous.file_name ? `: ${previous.file_name}` : ''}
                                        </a>
                                    ) : null)}
                                </div>
                            )}
                        </div>
                    )}

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
                                    <span className="text-slate-500 dark:text-slate-400 font-semibold block">{vendorQuotation.amount_source === 'site_estimate' ? 'Site Amount (Estimated):' : 'Site Quoted Amount:'}</span>
                                    <span className="font-bold text-emerald-700 dark:text-emerald-400">₹{Number(vendorQuotation.total_quoted_amount ?? 0).toLocaleString('en-IN')}</span>
                                </div>
                                <div>
                                    <span className="text-slate-500 dark:text-slate-400 font-semibold block">Attachment:</span>
                                    {vendorQuotation.file_url ? (
                                        <a
                                            href={maskStorageUrl(vendorQuotation.file_url) || vendorQuotation.file_url}
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
                                            href={maskStorageUrl(requisition.po_info.file_url) || requisition.po_info.file_url}
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
                </>
            )}

            {/* Dual Table Display (Requisition vs Available Stock) */}
            <div className="space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                        <h3 className="text-xs font-black text-slate-900 dark:text-white uppercase tracking-wider flex items-center gap-2">
                            Item-by-Item Breakdown & Physical Stock
                            {requestedCount > 0 && (
                                <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                                    {requestedCount} Requested Items
                                </span>
                            )}
                        </h3>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400">
                            Showing {filterMode === 'requested' ? requestedCount : items.length} of {items.length} total catalog line items
                        </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        {/* Search input */}
                        <div className="relative">
                            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                            <input
                                type="text"
                                placeholder="Search item, brand, specs..."
                                value={searchQuery}
                                onChange={e => setSearchQuery(e.target.value)}
                                className="pl-8 pr-3 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-emerald-500 w-36 sm:w-56"
                            />
                        </div>
                        {/* Filter Toggle */}
                        <div className="flex items-center bg-slate-100 dark:bg-slate-800 p-0.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs">
                            <button
                                type="button"
                                onClick={() => setFilterMode('all')}
                                className={`px-3 py-1 rounded-lg font-bold transition-all cursor-pointer ${filterMode === 'all' ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs' : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'}`}
                            >
                                All ({items.length})
                            </button>
                            <button
                                type="button"
                                onClick={() => setFilterMode('requested')}
                                className={`px-3 py-1 rounded-lg font-bold transition-all cursor-pointer ${filterMode === 'requested' ? 'bg-emerald-600 text-white shadow-xs font-black' : 'text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/30'}`}
                            >
                                Requested Only ({requestedCount})
                            </button>
                        </div>
                        {/* Maximize Table Toggle */}
                        <button
                            type="button"
                            onClick={() => setIsTableMaximized(!isTableMaximized)}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-xs font-bold text-slate-700 dark:text-slate-200 transition-colors shadow-2xs cursor-pointer"
                            title={isTableMaximized ? "Show summary cards" : "Expand table"}
                        >
                            {isTableMaximized ? (
                                <>
                                    <Minimize2 className="w-3.5 h-3.5 text-slate-600 dark:text-slate-300" />
                                    <span>Show Summary</span>
                                </>
                            ) : (
                                <>
                                    <Maximize2 className="w-3.5 h-3.5 text-slate-600 dark:text-slate-300" />
                                    <span>Maximize Table</span>
                                </>
                            )}
                        </button>
                    </div>
                </div>

                {/* Spacious Table Container */}
                <div className={`border border-slate-200 dark:border-slate-700 rounded-2xl overflow-hidden transition-all duration-200 ${
                    inModal
                        ? (isTableMaximized ? 'max-h-[76vh] min-h-[520px]' : 'max-h-[520px] min-h-[380px]')
                        : (isTableMaximized ? 'max-h-[82vh] min-h-[560px]' : 'max-h-[640px] min-h-[400px]')
                } overflow-y-auto shadow-xs`}>
                    <table className="w-full text-xs border-collapse">
                        <thead>
                            <tr className="bg-slate-100 dark:bg-slate-800 font-black text-slate-800 dark:text-slate-200 border-b border-slate-200 dark:border-slate-700 sticky top-0 z-10">
                                <th className="py-2.5 px-2.5 bg-slate-200 dark:bg-slate-700 border-r border-slate-300 dark:border-slate-600 w-10 text-center">#</th>
                                <th className="py-2.5 px-3 bg-sky-100 dark:bg-sky-950 text-sky-950 dark:text-sky-200 border-r border-slate-200 dark:border-slate-700 text-left">Product Name</th>
                                <th className="py-2.5 px-3 bg-slate-100 dark:bg-slate-800 border-r border-slate-200 dark:border-slate-700 text-left">Brand</th>
                                <th className="py-2.5 px-3 bg-slate-100 dark:bg-slate-800 border-r border-slate-200 dark:border-slate-700 text-left">Specification / Details</th>
                                <th className="py-2.5 px-3 bg-emerald-100 dark:bg-emerald-950 text-emerald-950 dark:text-emerald-200 border-r border-slate-200 dark:border-slate-700 text-center min-w-[95px]">Requested Qty</th>
                                <th className="py-2.5 px-3 bg-slate-100 dark:bg-slate-800 border-r border-slate-200 dark:border-slate-700 text-center min-w-[95px]">Available Stock</th>
                                <th className="py-2.5 px-2.5 bg-slate-100 dark:bg-slate-800 text-center min-w-[65px]">UOM</th>
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
                                               (item.details || '').toLowerCase().includes(q) ||
                                               (item.remarks || '').toLowerCase().includes(q);
                                    }
                                    return true;
                                })
                                .map((item: any, idx: number) => {
                                    const isRequested = (item.requested_qty || 0) > 0;
                                    return (
                                        <tr key={idx} className={`hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors ${isRequested ? 'bg-emerald-50/40 dark:bg-emerald-950/20' : ''}`}>
                                            <td className="py-2.5 px-2.5 text-center text-slate-500 dark:text-slate-400 font-semibold bg-slate-50/50 dark:bg-slate-800/40 border-r border-slate-100 dark:border-slate-800">{idx + 1}</td>
                                            <td className="py-2.5 px-3 font-bold text-slate-900 dark:text-white border-r border-slate-100 dark:border-slate-800">
                                                <div className="flex flex-col">
                                                    <span>{item.name}</span>
                                                    {item.remarks && (
                                                        <span className="text-[10px] text-amber-600 dark:text-amber-400 font-medium italic mt-0.5">
                                                            Note: &quot;{item.remarks}&quot;
                                                        </span>
                                                    )}
                                                </div>
                                            </td>
                                            <td className="py-2.5 px-3 text-slate-600 dark:text-slate-300 border-r border-slate-100 dark:border-slate-800">{item.brand || '—'}</td>
                                            <td className="py-2.5 px-3 text-slate-600 dark:text-slate-300 border-r border-slate-100 dark:border-slate-800">{item.details || '—'}</td>
                                            <td className={`py-2.5 px-3 text-center font-black border-r border-slate-100 dark:border-slate-800 min-w-[95px] tabular-nums ${isRequested ? 'text-emerald-700 dark:text-emerald-300 bg-emerald-100/60 dark:bg-emerald-900/40 text-sm' : 'text-slate-400'}`}>
                                                {item.requested_qty || 0}
                                            </td>
                                            <td className="py-2.5 px-3 text-center font-bold text-slate-700 dark:text-slate-300 border-r border-slate-100 dark:border-slate-800 min-w-[95px] tabular-nums">{item.available_stock_qty || 0}</td>
                                            <td className="py-2.5 px-2.5 text-center font-semibold text-slate-600 dark:text-slate-400 min-w-[65px]">{item.unit || 'pcs'}</td>
                                        </tr>
                                    );
                                })}
                        </tbody>
                    </table>
                </div>
            </div>

            <p className="text-xs text-slate-500">
                Your decision applies only to this requisition. Review other sites separately.
            </p>

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
    );

    // IN-BODY / FULL PAGE RENDERING (Keeps dashboard sidebar and header fully accessible)
    if (isInline) {
        return (
            <div className="space-y-6 pb-20 w-full min-w-0">
                {/* Clean Top Navigation Bar */}
                <div className="bg-white dark:bg-slate-800 p-4 sm:p-5 rounded-2xl border border-slate-200/80 dark:border-slate-700 shadow-xs flex flex-wrap items-center justify-between gap-4 sticky top-0 z-20 backdrop-blur-md bg-white/95 dark:bg-slate-800/95">
                    <div className="flex items-center gap-3.5 min-w-0">
                        <button
                            type="button"
                            onClick={onClose}
                            className="inline-flex items-center gap-2 h-9 px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-bold transition-colors cursor-pointer shrink-0 shadow-2xs"
                            title="Back to Requisitions"
                        >
                            <ArrowLeft className="w-4 h-4" />
                            <span>Back to Requisitions</span>
                        </button>
                        <div className="h-6 w-px bg-slate-200 dark:bg-slate-700 hidden sm:block" />
                        <div className="min-w-0">
                            <div className="flex items-center gap-2.5 flex-wrap">
                                <h1 className="text-base sm:text-lg font-black text-slate-900 dark:text-white truncate">
                                    Requisition Review & Details
                                </h1>
                                <span className={`px-2.5 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider ${
                                    requisition.status === 'approved' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800' :
                                    requisition.status === 'rejected' ? 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300 border border-rose-300 dark:border-rose-800' :
                                    requisition.status === 'ordered' ? 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300 border border-indigo-300 dark:border-indigo-800' :
                                    requisition.status === 'pending_approval' ? 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300 border border-sky-300 dark:border-sky-800' :
                                    'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 border border-amber-300 dark:border-amber-800'
                                }`}>
                                    {requisition.status === 'ordered' ? 'PO Issued' : requisition.status === 'pending_approval' ? 'Pending Approval' : requisition.status?.replace('_', ' ')}
                                </span>
                            </div>
                            <p className="text-xs text-slate-500 dark:text-slate-400 truncate mt-0.5 font-medium">
                                {requisition.property?.name || 'Property Center'}{requisition.floor_tag && requisition.floor_tag !== 'All Floors' ? ` (${requisition.floor_tag})` : ''} • {monthName} {requisition.requisition_year}
                            </p>
                        </div>
                    </div>

                    <div className="flex items-center gap-2">
                        <a
                            href={`/api/procurement/requisitions/${requisition.id}/export`}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-xl text-xs font-bold text-sky-700 bg-sky-50 dark:text-sky-300 dark:bg-sky-950/60 border border-sky-200 dark:border-sky-800 hover:bg-sky-100 dark:hover:bg-sky-900/60 transition-colors whitespace-nowrap shadow-2xs"
                        >
                            <Download className="w-3.5 h-3.5" />
                            <span>Export Excel</span>
                        </a>

                        {!isAlreadyActioned && canTakeApprovalAction && (
                            <>
                                <button
                                    onClick={() => handleAction('reject')}
                                    disabled={isSubmitting}
                                    className="h-9 px-3.5 inline-flex items-center gap-1.5 rounded-xl text-xs font-bold text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/80 border border-rose-200 dark:border-rose-800 hover:bg-rose-100 dark:hover:bg-rose-900/80 transition-colors disabled:opacity-50 cursor-pointer"
                                >
                                    <XCircle className="w-3.5 h-3.5" />
                                    <span>Reject / Revise</span>
                                </button>
                                <button
                                    onClick={() => handleAction('approve')}
                                    disabled={isSubmitting}
                                    className="h-9 px-4 inline-flex items-center gap-1.5 rounded-xl text-xs font-black text-white bg-emerald-600 hover:bg-emerald-700 shadow-md shadow-emerald-600/20 transition-all disabled:opacity-50 cursor-pointer"
                                >
                                    {isSubmitting ? (
                                        <Loader2 className="w-3.5 h-3.5 animate-spin text-white" />
                                    ) : (
                                        <CheckCircle2 className="w-3.5 h-3.5 text-white" />
                                    )}
                                    <span>Approve</span>
                                </button>
                            </>
                        )}
                    </div>
                </div>

                {/* Main Body Content Card */}
                <div className="bg-white dark:bg-slate-900 p-5 sm:p-7 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-xs space-y-6">
                    {renderContent(false)}

                    {/* Bottom Action Footer */}
                    <div className="pt-5 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-4">
                        <button
                            type="button"
                            onClick={onClose}
                            className="inline-flex items-center gap-2 h-9 px-4 rounded-xl text-xs font-bold text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                        >
                            <ArrowLeft className="w-4 h-4" />
                            <span>Back to Requisitions</span>
                        </button>

                        <div className="flex items-center gap-2">
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
                </div>
            </div>
        );
    }

    // MODAL OVERLAY RENDERING (Fallback if invoked with isInline=false)
    return (
        <ModalPortal>
            <AnimatePresence>
            <div className="fixed inset-0 z-[9999] flex items-center justify-center p-2 sm:p-4 lg:p-6 bg-slate-950/80 backdrop-blur-md overflow-y-auto">
                <motion.div
                    initial={{ opacity: 0, scale: 0.97, y: 12 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.97, y: 12 }}
                    className="bg-white dark:bg-slate-900 rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 w-full max-w-[96vw] 2xl:max-w-[1550px] overflow-hidden my-auto flex flex-col h-[94vh] max-h-[96vh]"
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
                    {renderContent(true)}

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
        </ModalPortal>
    );
}
