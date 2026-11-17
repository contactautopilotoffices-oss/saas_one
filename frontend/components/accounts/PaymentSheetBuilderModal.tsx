'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
    X, Upload, FileSpreadsheet, Plus, Trash2, CheckCircle2,
    AlertCircle, Loader2, ArrowRight, IndianRupee, Search, Filter, ShieldAlert, Download
} from 'lucide-react';
import { useAuth } from '@/frontend/context/AuthContext';

interface Props {
    isOpen: boolean;
    onClose: () => void;
    orgId?: string;
    onCreated?: (sheetId?: string) => void;
}

interface SheetRow {
    id: string;
    department: string;
    vendor_name: string;
    category: string;
    site_name: string;
    po_number: string;
    total_po_amount: number;
    request_amount: number;
    gst_hold: number;
    tds: number;
    net_payable_amount: number;
    payment_date: string;
    utr_no?: string;
    remarks?: string;
    po_id?: string;
}

const inr = (n: number | string) =>
    '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });

export default function PaymentSheetBuilderModal({ isOpen, onClose, orgId: propOrgId, onCreated }: Props) {
    const { membership, user } = useAuth();
    const effectiveOrgId = propOrgId || membership?.organization_id || membership?.org_id || (user?.user_metadata?.organization_id as string | undefined);

    const [mode, setMode] = useState<'zoho' | 'upload' | 'sheet'>('zoho');
    const [title, setTitle] = useState('');
    const [department, setDepartment] = useState<'Capex' | 'Opex' | 'Mixed'>('Mixed');
    const [notes, setNotes] = useState('');

    // Zoho PO selection state
    const [zohoPos, setZohoPos] = useState<any[]>([]);
    const [loadingZoho, setLoadingZoho] = useState(false);
    const [zohoSearch, setZohoSearch] = useState('');
    const [zohoDeptFilter, setZohoDeptFilter] = useState('');
    const [selectedPoIds, setSelectedPoIds] = useState<Set<string>>(new Set());

    // Working rows for the sheet
    const [rows, setRows] = useState<SheetRow[]>([]);

    // Upload state
    const [uploading, setUploading] = useState(false);
    const [uploadError, setUploadError] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Submission state
    const [submitting, setSubmitting] = useState(false);
    const [submitError, setSubmitError] = useState<string | null>(null);

    // Initial setup on open
    useEffect(() => {
        if (!isOpen) return;
        const now = new Date();
        const dateStr = now.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
        setTitle(`Payment Batch — ${dateStr}`);
        setNotes('');
        setRows([]);
        setSelectedPoIds(new Set());
        setSubmitError(null);
        setUploadError(null);
        setMode('zoho');

        // Fetch pending Zoho POs
        setLoadingZoho(true);
        const orgParam = effectiveOrgId ? `&org_id=${effectiveOrgId}` : '';
        fetch(`/api/accounts/pos?tab=to_align&page=1&page_size=100${orgParam}`)
            .then(res => res.json())
            .then(data => {
                setZohoPos(data.pos || []);
            })
            .catch(() => setZohoPos([]))
            .finally(() => setLoadingZoho(false));
    }, [isOpen, effectiveOrgId]);

    // Handle Zoho PO selection toggle
    const handleToggleZohoPo = (po: any) => {
        const nextSelected = new Set(selectedPoIds);
        if (nextSelected.has(po.id)) {
            nextSelected.delete(po.id);
            setRows(prev => prev.filter(r => r.po_id !== po.id));
        } else {
            nextSelected.add(po.id);
            const reqAmt = Number(po.pending_amount || po.po_amount || 0);
            const newRow: SheetRow = {
                id: crypto.randomUUID(),
                po_id: po.id,
                department: po.department || department || 'Capex',
                vendor_name: po.vendor_name || 'Vendor',
                category: po.category || 'General',
                site_name: po.project_name || '',
                po_number: po.po_number || '',
                total_po_amount: Number(po.po_amount || 0),
                request_amount: reqAmt,
                gst_hold: 0,
                tds: 0,
                net_payable_amount: reqAmt,
                payment_date: new Date().toISOString().split('T')[0],
                remarks: '',
            };
            setRows(prev => [...prev, newRow]);
        }
        setSelectedPoIds(nextSelected);
    };

    // Update row calculations inline
    const handleUpdateRow = (id: string, field: keyof SheetRow, value: any) => {
        setRows(prev => prev.map(row => {
            if (row.id !== id) return row;
            const updated = { ...row, [field]: value };
            if (field === 'request_amount' || field === 'gst_hold' || field === 'tds') {
                const req = Number(field === 'request_amount' ? value : updated.request_amount) || 0;
                const gst = Number(field === 'gst_hold' ? value : updated.gst_hold) || 0;
                const tds = Number(field === 'tds' ? value : updated.tds) || 0;
                updated.net_payable_amount = Math.max(0, req - gst - tds);
            }
            return updated;
        }));
    };

    const handleRemoveRow = (id: string, poId?: string) => {
        setRows(prev => prev.filter(r => r.id !== id));
        if (poId) {
            setSelectedPoIds(prev => {
                const next = new Set(prev);
                next.delete(poId);
                return next;
            });
        }
    };

    // Handle Excel / CSV File Upload
    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setUploading(true);
        setUploadError(null);

        const formData = new FormData();
        formData.append('file', file);
        if (effectiveOrgId) formData.append('org_id', effectiveOrgId);

        try {
            const res = await fetch('/api/accounts/sheets/import-parse', {
                method: 'POST',
                body: formData,
            });

            const data = await res.json();
            if (!res.ok) {
                setUploadError(data.error || 'Failed to parse file');
                return;
            }

            const importedRows: SheetRow[] = (data.items || []).map((item: any) => ({
                id: crypto.randomUUID(),
                po_id: item.po_id,
                department: item.department || 'Capex',
                vendor_name: item.vendor_name,
                category: item.category || 'General',
                site_name: item.site_name || '',
                po_number: item.po_number,
                total_po_amount: Number(item.total_po_amount || 0),
                request_amount: Number(item.request_amount || 0),
                gst_hold: Number(item.gst_hold || 0),
                tds: Number(item.tds || 0),
                net_payable_amount: Number(item.net_payable_amount || 0),
                payment_date: item.payment_date || new Date().toISOString().split('T')[0],
                utr_no: item.utr_no || '',
                remarks: item.remarks || '',
            }));

            setRows(importedRows);
            const poIdSet = new Set<string>();
            importedRows.forEach(r => { if (r.po_id) poIdSet.add(r.po_id); });
            setSelectedPoIds(poIdSet);
            setMode('sheet');
        } catch {
            setUploadError('Network error while processing file');
        } finally {
            setUploading(false);
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    // Aggregate summary
    const summary = useMemo(() => {
        const totalPos = rows.length;
        const totalPoAmount = rows.reduce((acc, r) => acc + Number(r.total_po_amount || 0), 0);
        const totalRequest = rows.reduce((acc, r) => acc + Number(r.request_amount || 0), 0);
        const totalGst = rows.reduce((acc, r) => acc + Number(r.gst_hold || 0), 0);
        const totalTds = rows.reduce((acc, r) => acc + Number(r.tds || 0), 0);
        const totalNet = rows.reduce((acc, r) => acc + Number(r.net_payable_amount || 0), 0);
        return { totalPos, totalPoAmount, totalRequest, totalGst, totalTds, totalNet };
    }, [rows]);

    // Submit Sheet for Approval
    const handleSubmit = async () => {
        if (rows.length === 0) return;
        setSubmitting(true);
        setSubmitError(null);

        try {
            const res = await fetch('/api/accounts/sheets', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    org_id: effectiveOrgId,
                    title: title || 'Payment Batch',
                    department,
                    notes,
                    items: rows,
                }),
            });

            const data = await res.json();
            if (!res.ok) {
                setSubmitError(data.error || 'Failed to submit payment sheet');
                return;
            }

            onCreated?.(data.sheet?.id);
            onClose();
        } catch {
            setSubmitError('Network error while submitting sheet');
        } finally {
            setSubmitting(false);
        }
    };

    // Export current sheet line items as standard 13-column CSV
    const handleExportCsv = () => {
        if (rows.length === 0) return;
        const headers = [
            '#', 'Department', 'Vendor Name', 'Category', 'Site',
            'PO Number', 'Total PO Amount', 'Request Amount', 'GST Hold', 'TDS',
            'Net Payable Amount', 'Payment Date', 'UTR Number', 'Remarks'
        ];

        const escapeVal = (val: any) => {
            const str = String(val ?? '');
            if (str.includes(',') || str.includes('"') || str.includes('\n')) {
                return `"${str.replace(/"/g, '""')}"`;
            }
            return str;
        };

        const lines = [
            headers.join(','),
            ...rows.map((r, idx) => [
                idx + 1,
                escapeVal(r.department),
                escapeVal(r.vendor_name),
                escapeVal(r.category),
                escapeVal(r.site_name),
                escapeVal(r.po_number),
                r.total_po_amount || 0,
                r.request_amount || 0,
                r.gst_hold || 0,
                r.tds || 0,
                r.net_payable_amount || 0,
                escapeVal(r.payment_date),
                escapeVal(r.utr_no || ''),
                escapeVal(r.remarks || '')
            ].join(','))
        ];

        const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.setAttribute('href', url);
        link.setAttribute('download', `${(title || 'Payment_Sheet').replace(/[^a-zA-Z0-9_-]/g, '_')}_${new Date().toISOString().split('T')[0]}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    };

    if (!isOpen) return null;

    const filteredZohoPos = zohoPos.filter(po => {
        const matchSearch = (po.po_number || '').toLowerCase().includes(zohoSearch.toLowerCase()) ||
            (po.vendor_name || '').toLowerCase().includes(zohoSearch.toLowerCase());
        const matchDept = !zohoDeptFilter || po.department === zohoDeptFilter;
        return matchSearch && matchDept;
    });

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200">
            <div className="relative w-full max-w-5xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl flex flex-col max-h-[92vh] overflow-hidden">
                
                {/* Modal Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-[#587e85]/10 text-[#587e85] rounded-xl">
                            <FileSpreadsheet className="w-5 h-5" />
                        </div>
                        <div>
                            <h2 className="text-base font-bold text-slate-900 dark:text-white">Create Payment Sheet for Approval</h2>
                            <p className="text-xs text-slate-500 dark:text-slate-400">
                                Pre-aligns in Accounts in parallel while notifying the Approver
                            </p>
                        </div>
                    </div>

                    <button
                        onClick={onClose}
                        className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Batch Meta Inputs & Mode Selector */}
                <div className="p-5 border-b border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900/70 space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <div className="sm:col-span-2">
                            <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                                Batch Title / Description
                            </label>
                            <input
                                type="text"
                                value={title}
                                onChange={(e) => setTitle(e.target.value)}
                                placeholder="e.g., Capex Acoustic & Electrical Batch - Oct 2026"
                                className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#587e85]/30 focus:border-[#587e85]"
                            />
                        </div>
                        <div>
                            <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                                Department
                            </label>
                            <select
                                value={department}
                                onChange={(e) => setDepartment(e.target.value as any)}
                                className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#587e85]/30 focus:border-[#587e85]"
                            >
                                <option value="Mixed">Mixed (Capex & Opex)</option>
                                <option value="Capex">Capex Only</option>
                                <option value="Opex">Opex Only</option>
                            </select>
                        </div>
                    </div>

                    {/* Mode Toggle Bar */}
                    <div className="flex items-center justify-between pt-1 gap-2 flex-wrap">
                        <div className="inline-flex p-1 bg-slate-100 dark:bg-slate-800 rounded-xl">
                            <button
                                type="button"
                                onClick={() => setMode('zoho')}
                                className={`px-4 py-1.5 text-xs font-bold rounded-lg transition ${
                                    mode === 'zoho'
                                        ? 'bg-white dark:bg-slate-900 text-[#587e85] shadow-xs'
                                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                                }`}
                            >
                                1. Select from Zoho POs ({filteredZohoPos.length} Available)
                            </button>
                            <button
                                type="button"
                                onClick={() => setMode('upload')}
                                className={`px-4 py-1.5 text-xs font-bold rounded-lg transition flex items-center gap-1.5 ${
                                    mode === 'upload'
                                        ? 'bg-white dark:bg-slate-900 text-[#587e85] shadow-xs'
                                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                                }`}
                            >
                                <Upload className="w-3.5 h-3.5" />
                                2. Upload Excel / CSV
                            </button>
                            <button
                                type="button"
                                onClick={() => setMode('sheet')}
                                className={`px-4 py-1.5 text-xs font-bold rounded-lg transition flex items-center gap-1.5 ${
                                    mode === 'sheet'
                                        ? 'bg-white dark:bg-slate-900 text-[#587e85] shadow-xs'
                                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                                }`}
                            >
                                <FileSpreadsheet className="w-3.5 h-3.5" />
                                3. Review Payment Sheet ({rows.length})
                            </button>
                        </div>

                        {rows.length > 0 && (
                            <button
                                type="button"
                                onClick={() => setMode(mode === 'sheet' ? 'zoho' : 'sheet')}
                                className="text-xs font-bold px-3 py-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 hover:bg-emerald-100 transition flex items-center gap-1.5 cursor-pointer"
                            >
                                <span>{rows.length} {rows.length === 1 ? 'PO' : 'POs'} added ({inr(summary.totalNet)})</span>
                                <span className="underline font-black">{mode === 'sheet' ? '← Add More POs' : 'View Sheet →'}</span>
                            </button>
                        )}
                    </div>
                </div>

                {/* Body Content Area */}
                <div className="flex-1 overflow-y-auto p-5 space-y-5">
                    
                    {/* MODE 1: ZOHO PO SELECTION */}
                    {mode === 'zoho' && (
                        <div className="space-y-4">
                            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
                                <div className="relative flex-1">
                                    <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
                                    <input
                                        type="text"
                                        placeholder="Search PO number or vendor..."
                                        value={zohoSearch}
                                        onChange={(e) => setZohoSearch(e.target.value)}
                                        className="w-full pl-9 pr-3 py-1.5 text-xs rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-[#587e85]"
                                    />
                                </div>
                                <select
                                    value={zohoDeptFilter}
                                    onChange={(e) => setZohoDeptFilter(e.target.value)}
                                    className="px-3 py-1.5 text-xs rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 text-slate-900 dark:text-white"
                                >
                                    <option value="">All Departments</option>
                                    <option value="Capex">Capex</option>
                                    <option value="Opex">Opex</option>
                                </select>
                            </div>

                            {/* Zoho PO Table */}
                            <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden max-h-72 overflow-y-auto shadow-2xs">
                                {loadingZoho ? (
                                    <div className="py-12 flex justify-center items-center gap-2 text-xs text-slate-400">
                                        <Loader2 className="w-4 h-4 animate-spin text-[#587e85]" />
                                        Loading synced Zoho POs...
                                    </div>
                                ) : filteredZohoPos.length === 0 ? (
                                    <div className="py-12 text-center text-xs text-slate-400">
                                        No pending Zoho purchase orders found
                                    </div>
                                ) : (
                                    <table className="w-full text-left text-xs">
                                        <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-600 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800 sticky top-0 z-10">
                                            <tr>
                                                <th className="py-2.5 px-3 w-10 text-center">Select</th>
                                                <th className="py-2.5 px-3 font-semibold">PO Number</th>
                                                <th className="py-2.5 px-3 font-semibold">Vendor</th>
                                                <th className="py-2.5 px-3 font-semibold">Department</th>
                                                <th className="py-2.5 px-3 font-semibold">Site</th>
                                                <th className="py-2.5 px-3 font-semibold text-right">PO Amount</th>
                                                <th className="py-2.5 px-3 font-semibold text-right">Pending</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                                            {filteredZohoPos.map(po => {
                                                const isSelected = selectedPoIds.has(po.id);
                                                return (
                                                    <tr
                                                        key={po.id}
                                                        onClick={() => handleToggleZohoPo(po)}
                                                        className={`cursor-pointer transition ${
                                                            isSelected
                                                                ? 'bg-[#587e85]/10 dark:bg-[#587e85]/20 font-medium'
                                                                : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                                                        }`}
                                                    >
                                                        <td className="py-2.5 px-3 text-center" onClick={(e) => e.stopPropagation()}>
                                                            <input
                                                                type="checkbox"
                                                                checked={isSelected}
                                                                onChange={() => handleToggleZohoPo(po)}
                                                                className="w-4 h-4 text-[#587e85] rounded cursor-pointer"
                                                            />
                                                        </td>
                                                        <td className="py-2.5 px-3 font-bold text-slate-900 dark:text-white">
                                                            {po.po_number}
                                                        </td>
                                                        <td className="py-2.5 px-3 text-slate-700 dark:text-slate-300">
                                                            {po.vendor_name || '—'}
                                                        </td>
                                                        <td className="py-2.5 px-3 text-slate-500">
                                                            <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-slate-100 dark:bg-slate-800">
                                                                {po.department || 'Capex'}
                                                            </span>
                                                        </td>
                                                        <td className="py-2.5 px-3 text-slate-500 truncate max-w-[120px]">
                                                            {po.project_name || '—'}
                                                        </td>
                                                        <td className="py-2.5 px-3 text-right font-medium text-slate-700 dark:text-slate-300">
                                                            {inr(po.po_amount)}
                                                        </td>
                                                        <td className="py-2.5 px-3 text-right font-bold text-[#587e85]">
                                                            {inr(po.pending_amount || po.po_amount)}
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                )}
                            </div>

                            {/* Floating Selection Banner when rows exist */}
                            {rows.length > 0 && (
                                <div className="p-3 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/60 rounded-xl flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                                        <span className="text-xs font-bold text-slate-800 dark:text-slate-200">
                                            {rows.length} POs selected for this sheet · Net: {inr(summary.totalNet)}
                                        </span>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => setMode('sheet')}
                                        className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-[#587e85] hover:bg-[#48686e] text-white rounded-lg text-xs font-bold shadow-xs transition cursor-pointer"
                                    >
                                        <span>View & Edit Sheet ({rows.length})</span>
                                        <ArrowRight className="w-3.5 h-3.5" />
                                    </button>
                                </div>
                            )}
                        </div>
                    )}

                    {/* MODE 2: EXCEL / CSV UPLOAD */}
                    {mode === 'upload' && (
                        <div className="space-y-4">
                            <div
                                onClick={() => fileInputRef.current?.click()}
                                className="border-2 border-dashed border-slate-300 dark:border-slate-700 hover:border-[#587e85] dark:hover:border-[#587e85] rounded-2xl p-8 text-center cursor-pointer bg-slate-50/50 dark:bg-slate-850/50 transition group"
                            >
                                <input
                                    type="file"
                                    ref={fileInputRef}
                                    onChange={handleFileUpload}
                                    accept=".xlsx, .xls, .csv"
                                    className="hidden"
                                />
                                {uploading ? (
                                    <div className="flex flex-col items-center justify-center gap-2">
                                        <Loader2 className="w-8 h-8 animate-spin text-[#587e85]" />
                                        <p className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                                            Parsing sheet and cross-referencing Zoho POs...
                                        </p>
                                    </div>
                                ) : (
                                    <div className="flex flex-col items-center justify-center gap-2">
                                        <div className="p-3 bg-[#587e85]/10 text-[#587e85] rounded-xl group-hover:scale-110 transition">
                                            <Upload className="w-6 h-6" />
                                        </div>
                                        <p className="text-xs font-bold text-slate-900 dark:text-white">
                                            Click to upload or drag & drop payment sheet (.xlsx, .csv)
                                        </p>
                                        <p className="text-[11px] text-slate-500 dark:text-slate-400">
                                            Supports standard 13-column template: Department, Vendor Name, Category, Site, PO No, Total Amount, Request Amount, GST Hold, TDS, etc.
                                        </p>
                                    </div>
                                )}
                            </div>

                            {uploadError && (
                                <div className="p-3 rounded-xl bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-900 text-xs flex items-center gap-2">
                                    <ShieldAlert className="w-4 h-4 shrink-0" />
                                    <span>{uploadError}</span>
                                </div>
                            )}
                        </div>
                    )}

                    {/* MODE 3: FULL PAYMENT SHEET VIEW (13 Columns Editable) */}
                    {(mode === 'sheet' || rows.length > 0) && (
                        <div className={`space-y-4 ${mode !== 'sheet' ? 'pt-4 border-t border-slate-200 dark:border-slate-800' : ''}`}>
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <h3 className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider flex items-center gap-1.5">
                                        <FileSpreadsheet className="w-4 h-4 text-[#587e85]" />
                                        Payment Sheet Line Items ({rows.length})
                                    </h3>
                                    <span className="text-[11px] text-slate-500">
                                        — Editable Request amounts, GST Hold, TDS, and Remarks
                                    </span>
                                </div>

                                <div className="flex items-center gap-2">
                                    {rows.length > 0 && (
                                        <button
                                            type="button"
                                            onClick={handleExportCsv}
                                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 rounded-lg transition cursor-pointer"
                                            title="Export current sheet as CSV"
                                        >
                                            <Download className="w-3.5 h-3.5 text-[#587e85]" />
                                            <span>Export CSV</span>
                                        </button>
                                    )}

                                    {mode === 'sheet' && (
                                        <button
                                            type="button"
                                            onClick={() => setMode('zoho')}
                                            className="text-xs font-bold text-[#587e85] hover:text-[#48686e] hover:underline flex items-center gap-1 cursor-pointer"
                                        >
                                            <Plus className="w-3.5 h-3.5" />
                                            <span>Add More Zoho POs</span>
                                        </button>
                                    )}
                                </div>
                            </div>

                            {rows.length === 0 ? (
                                <div className="p-12 text-center border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-2xl text-xs text-slate-400 space-y-2">
                                    <FileSpreadsheet className="w-8 h-8 mx-auto text-slate-300 dark:text-slate-600" />
                                    <p className="font-semibold text-slate-600 dark:text-slate-300">No purchase orders in this sheet yet.</p>
                                    <p className="text-[11px]">Select pending POs from Tab 1 or upload an Excel file from Tab 2.</p>
                                    <button
                                        type="button"
                                        onClick={() => setMode('zoho')}
                                        className="mt-2 inline-flex items-center gap-1.5 px-4 py-2 bg-[#587e85] text-white rounded-xl text-xs font-bold"
                                    >
                                        Browse Zoho POs ({filteredZohoPos.length} Available)
                                    </button>
                                </div>
                            ) : (
                                <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-x-auto max-h-96 shadow-2xs">
                                    <table className="w-full text-left text-xs whitespace-nowrap">
                                        <thead className="bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-b border-slate-200 dark:border-slate-800 sticky top-0 z-10 shadow-2xs">
                                            <tr>
                                                <th className="py-2.5 px-3">#</th>
                                                <th className="py-2.5 px-3">Dept</th>
                                                <th className="py-2.5 px-3">Vendor</th>
                                                <th className="py-2.5 px-3">Category</th>
                                                <th className="py-2.5 px-3">Site</th>
                                                <th className="py-2.5 px-3">PO Number</th>
                                                <th className="py-2.5 px-3 text-right">Total PO</th>
                                                <th className="py-2.5 px-3 text-right w-28 font-bold text-slate-900 dark:text-white">Request Amt</th>
                                                <th className="py-2.5 px-3 text-right w-24">GST Hold</th>
                                                <th className="py-2.5 px-3 text-right w-24">TDS</th>
                                                <th className="py-2.5 px-3 text-right font-black text-emerald-600 dark:text-emerald-400">Net Payable</th>
                                                <th className="py-2.5 px-3">Remarks / Notes</th>
                                                <th className="py-2.5 px-3 text-center w-10">Remove</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                                            {rows.map((row, idx) => (
                                                <tr key={row.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-850/70 transition">
                                                    <td className="py-2 px-3 text-slate-400 font-mono text-[11px]">
                                                        {idx + 1}
                                                    </td>
                                                    <td className="py-2 px-3">
                                                        <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-slate-100 dark:bg-slate-800">
                                                            {row.department}
                                                        </span>
                                                    </td>
                                                    <td className="py-2 px-3 font-semibold text-slate-900 dark:text-white max-w-[150px] truncate" title={row.vendor_name}>
                                                        {row.vendor_name}
                                                    </td>
                                                    <td className="py-2 px-3 text-slate-600 dark:text-slate-400">
                                                        {row.category}
                                                    </td>
                                                    <td className="py-2 px-3 text-slate-600 dark:text-slate-400 max-w-[120px] truncate" title={row.site_name}>
                                                        {row.site_name || '—'}
                                                    </td>
                                                    <td className="py-2 px-3 font-bold text-[#587e85]">
                                                        {row.po_number}
                                                    </td>
                                                    <td className="py-2 px-3 text-right font-medium text-slate-600 dark:text-slate-400">
                                                        {inr(row.total_po_amount)}
                                                    </td>
                                                    <td className="py-2 px-3 text-right">
                                                        <input
                                                            type="number"
                                                            value={row.request_amount}
                                                            onChange={(e) => handleUpdateRow(row.id, 'request_amount', parseFloat(e.target.value) || 0)}
                                                            className="w-24 px-2 py-1 text-right text-xs font-bold rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 focus:ring-2 focus:ring-[#587e85]/40 focus:border-[#587e85]"
                                                        />
                                                    </td>
                                                    <td className="py-2 px-3 text-right">
                                                        <input
                                                            type="number"
                                                            value={row.gst_hold}
                                                            onChange={(e) => handleUpdateRow(row.id, 'gst_hold', parseFloat(e.target.value) || 0)}
                                                            className="w-20 px-2 py-1 text-right text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 focus:ring-2 focus:ring-[#587e85]/40 focus:border-[#587e85]"
                                                        />
                                                    </td>
                                                    <td className="py-2 px-3 text-right">
                                                        <input
                                                            type="number"
                                                            value={row.tds}
                                                            onChange={(e) => handleUpdateRow(row.id, 'tds', parseFloat(e.target.value) || 0)}
                                                            className="w-20 px-2 py-1 text-right text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 focus:ring-2 focus:ring-[#587e85]/40 focus:border-[#587e85]"
                                                        />
                                                    </td>
                                                    <td className="py-2 px-3 text-right font-bold text-emerald-600 dark:text-emerald-400 text-xs">
                                                        {inr(row.net_payable_amount)}
                                                    </td>
                                                    <td className="py-2 px-3">
                                                        <input
                                                            type="text"
                                                            value={row.remarks || ''}
                                                            placeholder="Notes / UTR"
                                                            onChange={(e) => handleUpdateRow(row.id, 'remarks', e.target.value)}
                                                            className="w-28 px-2 py-1 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950"
                                                        />
                                                    </td>
                                                    <td className="py-2 px-3 text-center">
                                                        <button
                                                            type="button"
                                                            onClick={() => handleRemoveRow(row.id, row.po_id)}
                                                            className="p-1 text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40 rounded-lg transition"
                                                            title="Remove row"
                                                        >
                                                            <Trash2 className="w-3.5 h-3.5" />
                                                        </button>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}

                            {/* Batch Total Summary Cards */}
                            {rows.length > 0 && (
                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-4 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800">
                                    <div>
                                        <span className="text-[11px] text-slate-500 block">Total PO Value</span>
                                        <span className="text-sm font-bold text-slate-800 dark:text-slate-200">
                                            {inr(summary.totalPoAmount)}
                                        </span>
                                    </div>
                                    <div>
                                        <span className="text-[11px] text-slate-500 block">Total Requested</span>
                                        <span className="text-sm font-bold text-slate-800 dark:text-slate-200">
                                            {inr(summary.totalRequest)}
                                        </span>
                                    </div>
                                    <div>
                                        <span className="text-[11px] text-slate-500 block">Deductions (GST + TDS)</span>
                                        <span className="text-sm font-bold text-amber-600 dark:text-amber-400">
                                            -{inr(summary.totalGst + summary.totalTds)}
                                        </span>
                                    </div>
                                    <div>
                                        <span className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400 block uppercase">
                                            Net Payable Disbursement
                                        </span>
                                        <span className="text-base font-black text-emerald-600 dark:text-emerald-400">
                                            {inr(summary.totalNet)}
                                        </span>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {submitError && (
                        <div className="p-3 rounded-xl bg-red-50 text-red-600 border border-red-200 text-xs flex items-center gap-2">
                            <AlertCircle className="w-4 h-4 shrink-0" />
                            <span>{submitError}</span>
                        </div>
                    )}
                </div>

                {/* Modal Footer */}
                <div className="flex items-center justify-between px-6 py-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50">
                    <div className="text-xs text-slate-500">
                        {rows.length > 0 && (
                            <span>
                                Net: <strong>{inr(summary.totalNet)}</strong> across {rows.length} PO lines
                            </span>
                        )}
                    </div>
                    <div className="flex items-center gap-3">
                        {rows.length > 0 && (
                            <button
                                type="button"
                                onClick={handleExportCsv}
                                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition cursor-pointer"
                                title="Download sheet as CSV file"
                            >
                                <Download className="w-3.5 h-3.5 text-[#587e85]" />
                                <span>Export CSV</span>
                            </button>
                        )}
                        <button
                            type="button"
                            onClick={onClose}
                            disabled={submitting}
                            className="px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition"
                        >
                            Cancel
                        </button>
                        <button
                            type="button"
                            onClick={handleSubmit}
                            disabled={submitting || rows.length === 0}
                            className="inline-flex items-center gap-2 px-5 py-2.5 text-xs font-bold text-white bg-[#587e85] hover:bg-[#48686e] rounded-xl shadow-xs transition active:scale-95 disabled:opacity-50"
                        >
                            {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                            <span>Submit for Approval & Pre-Alignment</span>
                            <ArrowRight className="w-4 h-4" />
                        </button>
                    </div>
                </div>

            </div>
        </div>
    );
}
