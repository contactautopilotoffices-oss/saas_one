'use client';

import React, { useState, useMemo } from 'react';
import {
    X, Upload, CheckCircle2, Building2, Calendar, User,
    FileSpreadsheet, FileText, AlertCircle, Loader2,
    ShieldCheck, CheckSquare, Square, DollarSign, Filter,
    Sparkles, ArrowRight
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface BulkApproverUploadModalProps {
    isOpen: boolean;
    onClose: () => void;
    requisitions: any[];
    approvers: any[];
    organizationId: string;
    currentUser: any;
    onSuccess: () => void;
}

const MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
];

export default function BulkApproverUploadModal({
    isOpen,
    onClose,
    requisitions = [],
    approvers = [],
    organizationId,
    currentUser,
    onSuccess
}: BulkApproverUploadModalProps) {
    // Selection state: set of selected requisition IDs
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

    // Form inputs
    const [vendorNotes, setVendorNotes] = useState<string>('');
    const [selectedApproverId, setSelectedApproverId] = useState<string>(approvers[0]?.id || '');
    const [quoteFile, setQuoteFile] = useState<File | null>(null);
    const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);

    // Filter submitted / ready requisitions (exclude already approved or ordered ones by default, but allow user to pick)
    const eligibleRequisitions = useMemo(() => {
        return requisitions.filter(r => r.status !== 'approved' && r.status !== 'ordered');
    }, [requisitions]);

    // Initialize all eligible selected when opening
    React.useEffect(() => {
        if (isOpen && eligibleRequisitions.length > 0) {
            setSelectedIds(new Set(eligibleRequisitions.map(r => r.id)));
            if (approvers.length > 0 && !selectedApproverId) {
                setSelectedApproverId(approvers[0].id);
            }
        }
    }, [isOpen, eligibleRequisitions, approvers]);

    if (!isOpen) return null;

    const toggleSelect = (id: string) => {
        setSelectedIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) {
                next.delete(id);
            } else {
                next.add(id);
            }
            return next;
        });
    };

    const toggleSelectAll = () => {
        if (selectedIds.size === eligibleRequisitions.length) {
            setSelectedIds(new Set());
        } else {
            setSelectedIds(new Set(eligibleRequisitions.map(r => r.id)));
        }
    };

    const selectedRequisitionsList = eligibleRequisitions.filter(r => selectedIds.has(r.id));
    const totalSelectedEstAmount = selectedRequisitionsList.reduce((acc, r) => {
        return acc + (Number(r.total_estimated_amount) || Number(r.vendor_quotation?.total_quoted_amount) || 0);
    }, 0);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setErrorMessage(null);

        if (selectedIds.size === 0) {
            setErrorMessage('Please select at least one property / site requisition.');
            return;
        }

        if (!selectedApproverId) {
            setErrorMessage('Please select an Approver from the dropdown.');
            return;
        }

        setIsSubmitting(true);
        try {
            const formData = new FormData();
            formData.append('organization_id', organizationId || currentUser?.user_metadata?.organization_id || '');
            formData.append('requisition_ids', JSON.stringify(Array.from(selectedIds)));
            formData.append('vendor_name', 'Vendor Quote');
            formData.append('total_quoted_amount', String(totalSelectedEstAmount));
            formData.append('vendor_notes', vendorNotes.trim());
            formData.append('target_approver_id', selectedApproverId);
            if (quoteFile) {
                formData.append('quote_file', quoteFile);
            }

            const res = await fetch('/api/procurement/requisitions/bulk-approval', {
                method: 'POST',
                body: formData
            });

            const data = await res.json();
            if (!res.ok) {
                throw new Error(data.error || 'Failed to submit multi-site approval');
            }

            alert(`✅ Request for approval sent to Director / Approver for ${selectedIds.size} sites! Approver has been notified.`);
            onSuccess();
            onClose();
        } catch (err: any) {
            console.error('Bulk approval error:', err);
            setErrorMessage(err.message || 'Failed to submit bulk approval');
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <AnimatePresence>
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs overflow-y-auto">
                <motion.div
                    initial={{ opacity: 0, scale: 0.95, y: 15 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95, y: 15 }}
                    className="bg-white dark:bg-slate-900 rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 w-full max-w-4xl overflow-hidden my-6 flex flex-col max-h-[92vh]"
                >
                    {/* Header */}
                    <div className="bg-slate-900 text-white p-5 flex items-center justify-between border-b border-slate-800 shrink-0">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-xl bg-sky-500/20 border border-sky-400/30 flex items-center justify-center text-sky-400">
                                <Upload className="w-5 h-5" />
                            </div>
                            <div>
                                <h3 className="font-bold text-base text-white">Upload Quote & Assign Approver (Multi-Site)</h3>
                                <p className="text-xs text-slate-400">Attach a consolidated vendor quotation and request approval for multiple properties in 1 click.</p>
                            </div>
                        </div>
                        <button
                            onClick={onClose}
                            className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
                        >
                            <X className="w-5 h-5" />
                        </button>
                    </div>

                    {/* Scrollable Body */}
                    <form onSubmit={handleSubmit} className="overflow-y-auto p-6 space-y-6 flex-1">
                        {errorMessage && (
                            <div className="p-4 rounded-2xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 text-sm flex items-center gap-3">
                                <AlertCircle className="w-5 h-5 shrink-0 text-red-500" />
                                <span>{errorMessage}</span>
                            </div>
                        )}

                        {/* Section 1: Multi-Site Selection */}
                        <div>
                            <div className="flex items-center justify-between mb-3">
                                <div>
                                    <h4 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                                        <span>1. Select Properties / Sites to Include</span>
                                        <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-sky-100 dark:bg-sky-950 text-sky-700 dark:text-sky-300 border border-sky-200 dark:border-sky-800">
                                            {selectedIds.size} of {eligibleRequisitions.length} selected
                                        </span>
                                    </h4>
                                    <p className="text-xs text-slate-500 dark:text-slate-400">
                                        Choose all property sheets that share this vendor quotation.
                                    </p>
                                </div>
                                <button
                                    type="button"
                                    onClick={toggleSelectAll}
                                    className="text-xs font-bold text-sky-600 dark:text-sky-400 hover:underline flex items-center gap-1.5 cursor-pointer"
                                >
                                    {selectedIds.size === eligibleRequisitions.length ? (
                                        <>
                                            <CheckSquare className="w-4 h-4" />
                                            <span>Deselect All</span>
                                        </>
                                    ) : (
                                        <>
                                            <Square className="w-4 h-4" />
                                            <span>Select All</span>
                                        </>
                                    )}
                                </button>
                            </div>

                            {eligibleRequisitions.length === 0 ? (
                                <div className="p-8 text-center bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-slate-200 dark:border-slate-700">
                                    <FileSpreadsheet className="w-8 h-8 mx-auto mb-2 text-slate-400" />
                                    <p className="text-sm font-medium text-slate-600 dark:text-slate-300">No active submitted requisitions found.</p>
                                    <p className="text-xs text-slate-400 mt-1">Properties must submit their monthly sheet first before assigning quotes.</p>
                                </div>
                            ) : (
                                <div className="border border-slate-200 dark:border-slate-700 rounded-2xl overflow-hidden divide-y divide-slate-100 dark:divide-slate-800 max-h-60 overflow-y-auto">
                                    {eligibleRequisitions.map(req => {
                                        const isSelected = selectedIds.has(req.id);
                                        const monthName = MONTH_NAMES[(req.requisition_month || 1) - 1] || 'Month';
                                        const itemsCount = req.total_items_count || req.items?.length || 0;
                                        const estAmount = req.total_estimated_amount || req.vendor_quotation?.total_quoted_amount || 0;

                                        return (
                                            <div
                                                key={req.id}
                                                onClick={() => toggleSelect(req.id)}
                                                className={`p-3.5 flex items-center justify-between gap-3 cursor-pointer transition-colors ${
                                                    isSelected 
                                                        ? 'bg-sky-50/70 dark:bg-sky-950/30' 
                                                        : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                                                }`}
                                            >
                                                <div className="flex items-center gap-3 min-w-0">
                                                    <div className="text-sky-600 dark:text-sky-400 shrink-0">
                                                        {isSelected ? (
                                                            <CheckSquare className="w-5 h-5" />
                                                        ) : (
                                                            <Square className="w-5 h-5 text-slate-300 dark:text-slate-600" />
                                                        )}
                                                    </div>
                                                    <div className="min-w-0">
                                                        <div className="flex items-center gap-2">
                                                            <span className="font-bold text-sm text-slate-900 dark:text-white truncate">
                                                                {req.property?.name || 'Property'}
                                                            </span>
                                                            {req.floor_tag && req.floor_tag !== 'All Floors' && (
                                                                <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                                                                    {req.floor_tag}
                                                                </span>
                                                            )}
                                                        </div>
                                                        <p className="text-xs text-slate-500 dark:text-slate-400">
                                                            {monthName} {req.requisition_year} • {itemsCount} items • Requested by {req.uploader?.full_name || req.uploader?.email || 'Site Admin'}
                                                        </p>
                                                    </div>
                                                </div>

                                                <div className="text-right shrink-0">
                                                    <div className="text-sm font-black text-slate-900 dark:text-white">
                                                        ₹{Number(estAmount).toLocaleString('en-IN')}
                                                    </div>
                                                    {req.is_over_budget && (
                                                        <span className="inline-block text-[10px] font-bold text-amber-600 dark:text-amber-400">
                                                            Over Budget
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}

                            {selectedIds.size > 0 && (
                                <div className="mt-2.5 p-3 rounded-xl bg-slate-100 dark:bg-slate-800/80 flex items-center justify-between text-xs text-slate-700 dark:text-slate-300">
                                    <span className="font-semibold">{selectedIds.size} sites selected for consolidated quote</span>
                                    <span className="font-black text-emerald-700 dark:text-emerald-400">
                                        Combined Est: ₹{totalSelectedEstAmount.toLocaleString('en-IN')}
                                    </span>
                                </div>
                            )}
                        </div>

                        {/* Section 2: Quotation File & Procurement Notes */}
                        <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
                            <h4 className="text-sm font-bold text-slate-900 dark:text-white mb-3">
                                2. Quotation File & Procurement Notes <span className="text-slate-400 font-normal text-xs">(Optional)</span>
                            </h4>

                            <div>
                                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1">
                                    Attach Quotation File / Comparative Sheet <span className="text-slate-400 font-normal">(.pdf, .xlsx, .docx, .png, .jpg)</span>
                                </label>
                                <div className="border-2 border-dashed border-slate-200 dark:border-slate-700 hover:border-sky-400 dark:hover:border-sky-500 rounded-2xl p-4 transition-colors">
                                    <input
                                        type="file"
                                        accept=".pdf,.xlsx,.xls,.doc,.docx,.csv,.png,.jpg,.jpeg"
                                        onChange={e => setQuoteFile(e.target.files?.[0] || null)}
                                        className="w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-bold file:bg-sky-50 file:text-sky-700 hover:file:bg-sky-100 cursor-pointer"
                                    />
                                    {quoteFile && (
                                        <div className="mt-2 flex items-center gap-2 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                                            <FileText className="w-4 h-4" />
                                            <span>Ready to upload: {quoteFile.name} ({(quoteFile.size / 1024).toFixed(1)} KB)</span>
                                        </div>
                                    )}
                                </div>
                            </div>

                            <div className="mt-4">
                                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1">
                                    Procurement Notes for Approver
                                </label>
                                <textarea
                                    rows={2}
                                    value={vendorNotes}
                                    onChange={e => setVendorNotes(e.target.value)}
                                    placeholder="e.g. Rate contracts applied, ready for executive approval..."
                                    className="w-full px-3.5 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-800 dark:text-slate-100 focus:outline-hidden focus:ring-2 focus:ring-sky-500"
                                />
                            </div>
                        </div>

                        {/* Section 3: Select Approver */}
                        <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
                            <h4 className="text-sm font-bold text-slate-900 dark:text-white mb-2">
                                3. Assign Reviewing Approver
                            </h4>
                            <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
                                The selected Director / Super Admin will receive the uploaded quote and can approve or reject all selected sites.
                            </p>

                            <select
                                required
                                value={selectedApproverId}
                                onChange={e => setSelectedApproverId(e.target.value)}
                                className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-semibold text-slate-800 dark:text-slate-100 focus:outline-hidden focus:ring-2 focus:ring-sky-500"
                            >
                                {approvers.map(a => (
                                    <option key={a.id} value={a.id}>
                                        {a.full_name || a.email} ({a.email})
                                    </option>
                                ))}
                            </select>
                        </div>
                    </form>

                    {/* Footer */}
                    <div className="bg-slate-50 dark:bg-slate-950 p-4 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between shrink-0">
                        <button
                            type="button"
                            onClick={onClose}
                            className="h-9 px-4 inline-flex items-center justify-center rounded-xl text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                        >
                            Cancel
                        </button>

                        <button
                            type="button"
                            onClick={handleSubmit}
                            disabled={isSubmitting || selectedIds.size === 0}
                            className="h-9 px-5 inline-flex items-center gap-1.5 bg-gradient-to-r from-sky-600 to-blue-700 hover:from-sky-700 hover:to-blue-800 text-white rounded-xl font-bold text-xs shadow-md shadow-sky-600/20 transition-all cursor-pointer disabled:opacity-50"
                        >
                            {isSubmitting ? (
                                <>
                                    <Loader2 className="w-3.5 h-3.5 animate-spin text-white" />
                                    <span>Submitting Multi-Site Approval...</span>
                                </>
                            ) : (
                                <>
                                    <ShieldCheck className="w-3.5 h-3.5 text-white" />
                                    <span>Submit for Approval ({selectedIds.size} Sites)</span>
                                </>
                            )}
                        </button>
                    </div>
                </motion.div>
            </div>
        </AnimatePresence>
    );
}
