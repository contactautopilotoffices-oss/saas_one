'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
    CheckCircle2, XCircle, Clock, FileSpreadsheet, Download,
    Check, X, AlertCircle, Loader2, ArrowLeft, Building2,
    Calendar, User, ShieldCheck, IndianRupee, RefreshCw
} from 'lucide-react';
import { useAuth } from '@/frontend/context/AuthContext';

interface Props {
    orgId?: string;
    initialSheetId?: string;
    onBatchUpdated?: () => void;
}

const inr = (n: number | string) =>
    '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });

const STATUS_BADGES: Record<string, { label: string; cls: string }> = {
    submitted: { label: 'Pending Approval', cls: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-900' },
    partially_approved: { label: 'Partially Approved', cls: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-400 dark:border-blue-900' },
    approved: { label: 'Approved & Aligned', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-900' },
    rejected: { label: 'Rejected', cls: 'bg-red-50 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-400 dark:border-red-900' },
    completed: { label: 'Settled & Paid', cls: 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700' },
};

export default function ApprovalWorkspace({ orgId: propOrgId, initialSheetId, onBatchUpdated }: Props) {
    const { membership, user } = useAuth();
    const orgId = propOrgId || membership?.organization_id || membership?.org_id || (user?.user_metadata?.organization_id as string | undefined);

    const [sheets, setSheets] = useState<any[]>([]);
    const [loadingSheets, setLoadingSheets] = useState(true);
    const [activeTab, setActiveTab] = useState<'all' | 'pending' | 'approved'>('pending');
    
    // Selected sheet for line-by-line review
    const [selectedSheetId, setSelectedSheetId] = useState<string | null>(initialSheetId || null);
    const [sheetDetail, setSheetDetail] = useState<any | null>(null);
    const [items, setItems] = useState<any[]>([]);
    const [loadingDetail, setLoadingDetail] = useState(false);

    // Reject line item dialog state
    const [rejectingItem, setRejectingItem] = useState<any | null>(null);
    const [rejectReason, setRejectReason] = useState('');
    const [actionLoading, setActionLoading] = useState(false);
    const [actionMsg, setActionMsg] = useState<{ text: string; error?: boolean } | null>(null);

    // Fetch list of sheets
    const fetchSheets = useCallback(async () => {
        setLoadingSheets(true);
        try {
            const p = new URLSearchParams();
            if (orgId) p.set('org_id', orgId);
            if (activeTab === 'pending') p.set('status', 'submitted');
            else if (activeTab === 'approved') p.set('status', 'approved');

            const res = await fetch(`/api/accounts/sheets?${p}`);
            const data = await res.json();
            setSheets(data.sheets || []);
        } catch {
            setSheets([]);
        } finally {
            setLoadingSheets(false);
        }
    }, [orgId, activeTab]);

    useEffect(() => {
        fetchSheets();
    }, [fetchSheets]);

    // Fetch detail of selected sheet
    const fetchSheetDetail = useCallback(async (id: string) => {
        if (!orgId) return;
        setLoadingDetail(true);
        try {
            const res = await fetch(`/api/accounts/sheets/${id}?org_id=${orgId}`);
            const data = await res.json();
            if (res.ok) {
                setSheetDetail(data.sheet);
                setItems(data.items || []);
            }
        } catch {
            setSheetDetail(null);
            setItems([]);
        } finally {
            setLoadingDetail(false);
        }
    }, [orgId]);

    useEffect(() => {
        if (selectedSheetId) {
            fetchSheetDetail(selectedSheetId);
        } else {
            setSheetDetail(null);
            setItems([]);
        }
    }, [selectedSheetId, fetchSheetDetail]);

    // Handle Approver Action: Approve All
    const handleApproveAll = async () => {
        if (!selectedSheetId || !orgId) return;
        setActionLoading(true);
        setActionMsg(null);
        try {
            const res = await fetch(`/api/accounts/sheets/${selectedSheetId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    org_id: orgId,
                    action: 'approve_all',
                }),
            });
            const data = await res.json();
            if (res.ok) {
                setActionMsg({ text: 'All items approved & aligned for Accounts!' });
                fetchSheetDetail(selectedSheetId);
                fetchSheets();
                onBatchUpdated?.();
            } else {
                setActionMsg({ text: data.error || 'Failed to approve batch', error: true });
            }
        } catch {
            setActionMsg({ text: 'Network error during approval', error: true });
        } finally {
            setActionLoading(false);
        }
    };

    // Handle Approver Action: Approve Single Item
    const handleApproveItem = async (itemId: string) => {
        if (!selectedSheetId || !orgId) return;
        setActionLoading(true);
        try {
            const res = await fetch(`/api/accounts/sheets/${selectedSheetId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    org_id: orgId,
                    action: 'approve_items',
                    item_ids: [itemId],
                }),
            });
            if (res.ok) {
                fetchSheetDetail(selectedSheetId);
                fetchSheets();
                onBatchUpdated?.();
            }
        } finally {
            setActionLoading(false);
        }
    };

    // Handle Approver Action: Reject / Drop Single Item
    const handleRejectItem = async () => {
        if (!selectedSheetId || !rejectingItem || !orgId) return;
        setActionLoading(true);
        try {
            const res = await fetch(`/api/accounts/sheets/${selectedSheetId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    org_id: orgId,
                    action: 'reject_items',
                    item_ids: [rejectingItem.id],
                    reason: rejectReason || 'Dropped by Approver',
                }),
            });
            if (res.ok) {
                setRejectingItem(null);
                setRejectReason('');
                fetchSheetDetail(selectedSheetId);
                fetchSheets();
                onBatchUpdated?.();
            }
        } finally {
            setActionLoading(false);
        }
    };

    // VIEW: SINGLE SHEET DETAIL WORKSPACE
    if (selectedSheetId && sheetDetail) {
        return (
            <div className="space-y-5">
                {/* Back button and Header */}
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800">
                    <div className="flex items-center gap-3">
                        <button
                            type="button"
                            onClick={() => setSelectedSheetId(null)}
                            className="p-2 text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition"
                        >
                            <ArrowLeft className="w-5 h-5" />
                        </button>
                        <div>
                            <div className="flex items-center gap-2">
                                <h2 className="text-base font-bold text-slate-900 dark:text-white">
                                    {sheetDetail.title}
                                </h2>
                                <span className={`px-2 py-0.5 text-[11px] font-bold rounded-full border ${
                                    STATUS_BADGES[sheetDetail.status]?.cls || 'bg-slate-100'
                                }`}>
                                    {STATUS_BADGES[sheetDetail.status]?.label || sheetDetail.status}
                                </span>
                            </div>
                            <p className="text-xs text-slate-500 mt-0.5">
                                Batch: <strong className="text-slate-700 dark:text-slate-300">{sheetDetail.batch_number}</strong> · Submitted by {sheetDetail.creator?.full_name || 'Procurement'} on {new Date(sheetDetail.created_at).toLocaleDateString('en-IN')}
                            </p>
                        </div>
                    </div>

                    <div className="flex items-center gap-2 self-end sm:self-auto flex-wrap">
                        <a
                            href={`/api/accounts/sheets/${selectedSheetId}/export-csv?org_id=${orgId}`}
                            download
                            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-xl transition shadow-2xs"
                            title="Download standard 13-column payment sheet CSV"
                        >
                            <Download className="w-3.5 h-3.5 text-[#587e85]" />
                            <span>Export Sheet CSV</span>
                        </a>

                        <a
                            href={`/api/accounts/sheets/${selectedSheetId}/export-cms?org_id=${orgId}`}
                            download
                            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 dark:text-slate-300 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 rounded-xl transition"
                            title="Download Corporate Bank CMS Payout format (HDFC / ICICI)"
                        >
                            <Download className="w-3.5 h-3.5" />
                            <span>Export Bank CMS</span>
                        </a>

                        {(sheetDetail.status === 'submitted' || sheetDetail.status === 'partially_approved') && (
                            <button
                                type="button"
                                onClick={handleApproveAll}
                                disabled={actionLoading}
                                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl shadow-xs transition active:scale-95 disabled:opacity-50"
                            >
                                <CheckCircle2 className="w-4 h-4" />
                                <span>Approve Entire Batch</span>
                            </button>
                        )}
                    </div>
                </div>

                {/* Summary Banner */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="p-3.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl">
                        <span className="text-[11px] text-slate-500 block">Total PO Lines</span>
                        <span className="text-sm font-bold text-slate-900 dark:text-white">
                            {items.length} Lines
                        </span>
                    </div>
                    <div className="p-3.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl">
                        <span className="text-[11px] text-slate-500 block">Total Requested</span>
                        <span className="text-sm font-bold text-slate-900 dark:text-white">
                            {inr(sheetDetail.total_request_amount)}
                        </span>
                    </div>
                    <div className="p-3.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl">
                        <span className="text-[11px] text-slate-500 block">Total Deductions</span>
                        <span className="text-sm font-bold text-amber-600">
                            -{inr(Number(sheetDetail.total_gst_hold || 0) + Number(sheetDetail.total_tds || 0))}
                        </span>
                    </div>
                    <div className="p-3.5 bg-white dark:bg-slate-900 border border-emerald-200 dark:border-emerald-900/40 rounded-xl bg-emerald-50/20">
                        <span className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400 block uppercase">
                            Net Payable Disbursement
                        </span>
                        <span className="text-base font-black text-emerald-600 dark:text-emerald-400">
                            {inr(sheetDetail.total_payable_amount)}
                        </span>
                    </div>
                </div>

                {actionMsg && (
                    <div className={`p-3 rounded-xl text-xs flex items-center gap-2 ${
                        actionMsg.error ? 'bg-red-50 text-red-600 border border-red-200' : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                    }`}>
                        <CheckCircle2 className="w-4 h-4 shrink-0" />
                        <span>{actionMsg.text}</span>
                    </div>
                )}

                {/* Line Items Table (13 Columns Review) */}
                <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
                    <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
                        <h3 className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider">
                            Line Item Breakdown
                        </h3>
                        <span className="text-[11px] text-slate-500">
                            Rejecting an item automatically removes it from the Accounts disbursement queue
                        </span>
                    </div>

                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-xs whitespace-nowrap">
                            <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-600 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
                                <tr>
                                    <th className="py-2.5 px-3">Status</th>
                                    <th className="py-2.5 px-3">Dept</th>
                                    <th className="py-2.5 px-3">Vendor</th>
                                    <th className="py-2.5 px-3">Category</th>
                                    <th className="py-2.5 px-3">Site</th>
                                    <th className="py-2.5 px-3">PO No</th>
                                    <th className="py-2.5 px-3 text-right">PO Total</th>
                                    <th className="py-2.5 px-3 text-right">Request Amt</th>
                                    <th className="py-2.5 px-3 text-right">GST Hold</th>
                                    <th className="py-2.5 px-3 text-right">TDS</th>
                                    <th className="py-2.5 px-3 text-right font-bold text-emerald-600 dark:text-emerald-400">Net Payable</th>
                                    <th className="py-2.5 px-3">Remarks / UTR</th>
                                    <th className="py-2.5 px-3 text-center">Approver Action</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                                {items.map(item => {
                                    const isApproved = item.approval_status === 'approved';
                                    const isRejected = item.approval_status === 'rejected';
                                    return (
                                        <tr key={item.id} className={`hover:bg-slate-50/50 dark:hover:bg-slate-850/50 ${
                                            isRejected ? 'opacity-60 bg-red-50/20' : isApproved ? 'bg-emerald-50/10' : ''
                                        }`}>
                                            <td className="py-2 px-3">
                                                {isApproved ? (
                                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                                                        <Check className="w-3 h-3 stroke-[3]" /> Approved
                                                    </span>
                                                ) : isRejected ? (
                                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-50 text-red-700 border border-red-200">
                                                        <X className="w-3 h-3 stroke-[3]" /> Rejected
                                                    </span>
                                                ) : (
                                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
                                                        <Clock className="w-3 h-3" /> Under Review
                                                    </span>
                                                )}
                                            </td>
                                            <td className="py-2 px-3">
                                                <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-slate-100 dark:bg-slate-800">
                                                    {item.department || 'Capex'}
                                                </span>
                                            </td>
                                            <td className="py-2 px-3 font-semibold text-slate-900 dark:text-white max-w-[140px] truncate" title={item.vendor_name}>
                                                {item.vendor_name}
                                            </td>
                                            <td className="py-2 px-3 text-slate-600 dark:text-slate-400">
                                                {item.category || 'General'}
                                            </td>
                                            <td className="py-2 px-3 text-slate-600 dark:text-slate-400 max-w-[120px] truncate" title={item.site_name}>
                                                {item.site_name || '—'}
                                            </td>
                                            <td className="py-2 px-3 font-bold text-[#587e85]">
                                                {item.po_number}
                                            </td>
                                            <td className="py-2 px-3 text-right font-medium text-slate-600 dark:text-slate-400">
                                                {inr(item.total_po_amount)}
                                            </td>
                                            <td className="py-2 px-3 text-right font-medium text-slate-900 dark:text-white">
                                                {inr(item.request_amount)}
                                            </td>
                                            <td className="py-2 px-3 text-right text-slate-500">
                                                {item.gst_hold ? inr(item.gst_hold) : '—'}
                                            </td>
                                            <td className="py-2 px-3 text-right text-slate-500">
                                                {item.tds ? inr(item.tds) : '—'}
                                            </td>
                                            <td className="py-2 px-3 text-right font-bold text-emerald-600 dark:text-emerald-400">
                                                {inr(item.net_payable_amount)}
                                            </td>
                                            <td className="py-2 px-3 text-slate-500 max-w-[140px] truncate" title={item.rejection_reason || item.remarks}>
                                                {item.rejection_reason ? (
                                                    <span className="text-red-600 font-semibold">{item.rejection_reason}</span>
                                                ) : (
                                                    item.remarks || item.utr_no || '—'
                                                )}
                                            </td>
                                            <td className="py-2 px-3 text-center">
                                                {item.approval_status === 'pending' ? (
                                                    <div className="inline-flex items-center gap-1.5">
                                                        <button
                                                            type="button"
                                                            onClick={() => handleApproveItem(item.id)}
                                                            disabled={actionLoading}
                                                            className="p-1 rounded bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition"
                                                            title="Approve this line"
                                                        >
                                                            <Check className="w-3.5 h-3.5" />
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() => {
                                                                setRejectingItem(item);
                                                                setRejectReason('');
                                                            }}
                                                            disabled={actionLoading}
                                                            className="p-1 rounded bg-red-50 text-red-700 hover:bg-red-100 transition"
                                                            title="Reject/Drop this line"
                                                        >
                                                            <X className="w-3.5 h-3.5" />
                                                        </button>
                                                    </div>
                                                ) : (
                                                    <span className="text-[11px] text-slate-400">Signed off</span>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>

                {/* Reject Line Modal */}
                {rejectingItem && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
                        <div className="w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl p-5 space-y-4">
                            <div className="flex items-center justify-between">
                                <h4 className="text-sm font-bold text-slate-900 dark:text-white">
                                    Reject / Remove PO Line Item
                                </h4>
                                <button
                                    onClick={() => setRejectingItem(null)}
                                    className="p-1 text-slate-400 hover:text-slate-600"
                                >
                                    <X className="w-4 h-4" />
                                </button>
                            </div>
                            <p className="text-xs text-slate-600 dark:text-slate-400">
                                Are you sure you want to drop <strong>{rejectingItem.po_number}</strong> ({rejectingItem.vendor_name}) of {inr(rejectingItem.net_payable_amount)}? This will automatically cancel it in Accounts.
                            </p>
                            <div>
                                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                                    Reason for Rejection / Deferral
                                </label>
                                <input
                                    type="text"
                                    value={rejectReason}
                                    onChange={(e) => setRejectReason(e.target.value)}
                                    placeholder="e.g., Hold until site inspection / Exceeds monthly cap"
                                    className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 focus:outline-none focus:ring-1 focus:ring-red-500"
                                />
                            </div>
                            <div className="flex items-center justify-end gap-2 pt-2">
                                <button
                                    onClick={() => setRejectingItem(null)}
                                    className="px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100 rounded-lg"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={handleRejectItem}
                                    disabled={actionLoading}
                                    className="px-4 py-1.5 text-xs font-bold text-white bg-red-600 hover:bg-red-700 rounded-lg shadow-xs"
                                >
                                    Confirm Rejection
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        );
    }

    // VIEW: LIST OF BATCHES AWAITING REVIEW
    return (
        <div className="space-y-4">
            {/* Filter Tabs */}
            <div className="flex items-center justify-between">
                <div className="inline-flex p-1 bg-slate-100 dark:bg-slate-800 rounded-xl">
                    <button
                        type="button"
                        onClick={() => setActiveTab('pending')}
                        className={`px-3.5 py-1.5 text-xs font-bold rounded-lg transition ${
                            activeTab === 'pending'
                                ? 'bg-white dark:bg-slate-900 text-[#587e85] shadow-xs'
                                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                        }`}
                    >
                        Pending Approval
                    </button>
                    <button
                        type="button"
                        onClick={() => setActiveTab('approved')}
                        className={`px-3.5 py-1.5 text-xs font-bold rounded-lg transition ${
                            activeTab === 'approved'
                                ? 'bg-white dark:bg-slate-900 text-[#587e85] shadow-xs'
                                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                        }`}
                    >
                        Approved & Aligned
                    </button>
                    <button
                        type="button"
                        onClick={() => setActiveTab('all')}
                        className={`px-3.5 py-1.5 text-xs font-bold rounded-lg transition ${
                            activeTab === 'all'
                                ? 'bg-white dark:bg-slate-900 text-[#587e85] shadow-xs'
                                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                        }`}
                    >
                        All Batches
                    </button>
                </div>

                <button
                    type="button"
                    onClick={fetchSheets}
                    className="p-1.5 text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition"
                    title="Refresh batches"
                >
                    <RefreshCw className="w-4 h-4" />
                </button>
            </div>

            {loadingSheets ? (
                <div className="py-16 flex flex-col items-center justify-center gap-2 text-slate-400">
                    <Loader2 className="w-6 h-6 animate-spin text-[#587e85]" />
                    <p className="text-xs">Loading payment sheets...</p>
                </div>
            ) : sheets.length === 0 ? (
                <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-12 text-center">
                    <FileSpreadsheet className="w-10 h-10 mx-auto text-slate-400 mb-3" />
                    <h4 className="text-sm font-bold text-slate-900 dark:text-white">No payment batches in this queue</h4>
                    <p className="text-xs text-slate-500 max-w-sm mx-auto mt-1">
                        When the Procurement team submits a PO payment sheet, it will appear here for review and approval.
                    </p>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                    {sheets.map(sheet => {
                        const badge = STATUS_BADGES[sheet.status] || { label: sheet.status, cls: 'bg-slate-100' };
                        return (
                            <div
                                key={sheet.id}
                                onClick={() => setSelectedSheetId(sheet.id)}
                                className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-[#587e85] dark:hover:border-[#587e85] p-5 rounded-2xl shadow-xs hover:shadow-md transition cursor-pointer flex flex-col justify-between group"
                            >
                                <div className="space-y-3">
                                    <div className="flex items-start justify-between gap-2">
                                        <div>
                                            <span className="text-[11px] font-mono font-bold text-[#587e85]">
                                                {sheet.batch_number}
                                            </span>
                                            <h3 className="text-sm font-bold text-slate-900 dark:text-white group-hover:text-[#587e85] transition line-clamp-1">
                                                {sheet.title}
                                            </h3>
                                        </div>
                                        <span className={`px-2 py-0.5 text-[10px] font-bold rounded-full border shrink-0 ${badge.cls}`}>
                                            {badge.label}
                                        </span>
                                    </div>

                                    <div className="grid grid-cols-2 gap-2 text-xs py-1 border-y border-slate-100 dark:border-slate-800">
                                        <div>
                                            <span className="text-[11px] text-slate-400 block">Total POs</span>
                                            <span className="font-bold text-slate-800 dark:text-slate-200">{sheet.total_pos} Lines</span>
                                        </div>
                                        <div>
                                            <span className="text-[11px] text-slate-400 block">Net Disbursement</span>
                                            <span className="font-black text-emerald-600 dark:text-emerald-400">{inr(sheet.total_payable_amount)}</span>
                                        </div>
                                    </div>
                                </div>

                                <div className="flex items-center justify-between text-[11px] text-slate-400 mt-4 pt-1">
                                    <span>By {sheet.creator?.full_name || 'Procurement'}</span>
                                    <span>{new Date(sheet.created_at).toLocaleDateString('en-IN')}</span>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
