'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
    FolderLock, Search, Upload, FileText, Image as ImageIcon, X, Loader2,
    CheckCircle2, AlertTriangle, AlertCircle, ShieldCheck, Sparkles, Trash2,
    ExternalLink, RefreshCw, Link2, Tag,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface OcrExtracted {
    docType?: string | null;
    docNumber?: string | null;
    vendorName?: string | null;
    equipment?: string | null;
    issueDate?: string | null;
    validFrom?: string | null;
    validTo?: string | null;
    confidence?: number | null;
    fieldConfidence?: Record<string, number>;
    error?: string | null;
}

interface DocumentRow {
    id: string;
    organization_id: string;
    property_id: string | null;
    category: string;
    equipment: string | null;
    title: string;
    vendor_name: string | null;
    doc_number: string | null;
    issue_date: string | null;
    valid_from: string | null;
    valid_to: string | null;
    linked_master_item_id: string | null;
    file_name: string;
    file_type: string | null;
    ocr_status: 'pending' | 'processed' | 'failed' | 'not_applicable';
    ocr_extracted: OcrExtracted | null;
    ocr_confidence: number | null;
    ocr_text: string | null;
    tags: string[];
    verified_by: string | null;
    verified_at: string | null;
    created_at: string;
    signed_url: string | null;
}

interface MasterItem {
    id: string;
    si_no: number;
    category: string;
    requirement: string;
}

interface Props {
    organizationId: string;
    propertyId: string;
}

const CATEGORY_LABELS: Record<string, string> = {
    amc_contract: 'AMC Contract',
    warranty_certificate: 'Warranty Certificate',
    calibration_certificate: 'Calibration Certificate',
    statutory_certificate: 'Statutory Certificate',
    consent_approval: 'Consent / Approval',
    oem_manual: 'OEM Manual',
    sld_drawing: 'Single-Line Diagram',
    load_schedule: 'Load Schedule',
    sop: 'SOP',
    training_record: 'Training Record',
    insurance: 'Insurance',
    kyc: 'KYC',
    invoice: 'Invoice',
    test_report: 'Test Report',
    other: 'Other',
};

const EQUIPMENT_OPTIONS = ['DG Set', 'UPS', 'STP', 'Fire System', 'HVAC', 'Elevator', 'Electrical', 'General'];

const FIELD_LABELS: Record<string, string> = {
    doc_number: 'Doc Number', vendor_name: 'Vendor', equipment: 'Equipment',
    issue_date: 'Issue Date', valid_from: 'Valid From', valid_to: 'Valid To',
};

function expiryStatus(validTo: string | null): 'expired' | 'expiring' | 'valid' | 'none' {
    if (!validTo) return 'none';
    const days = (new Date(validTo).getTime() - Date.now()) / 86400000;
    if (days < 0) return 'expired';
    if (days <= 30) return 'expiring';
    return 'valid';
}

const STATUS_STYLES: Record<string, string> = {
    expired: 'bg-rose-50 border-rose-200 text-rose-600',
    expiring: 'bg-amber-50 border-amber-200 text-amber-600',
    valid: 'bg-emerald-50 border-emerald-200 text-emerald-600',
    none: 'bg-slate-50 border-slate-200 text-slate-400',
};
const STATUS_LABELS: Record<string, string> = {
    expired: 'Expired', expiring: 'Expiring Soon', valid: 'Valid', none: 'No Expiry',
};

const emptyForm = {
    title: '', category: 'amc_contract', equipment: '', vendor_name: '', doc_number: '',
    issue_date: '', valid_from: '', valid_to: '', tags: '', linked_master_item_id: '',
};

export default function DocumentBank({ organizationId, propertyId }: Props) {
    const [documents, setDocuments] = useState<DocumentRow[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    // Distinguishes "the table has no matching rows" from "the table does not exist yet".
    // An empty grid means the same thing on screen, and only one of the two is true.
    const [unprovisioned, setUnprovisioned] = useState<string | null>(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [categoryFilter, setCategoryFilter] = useState('all');
    const [statusFilter, setStatusFilter] = useState('all');
    const [showUploadModal, setShowUploadModal] = useState(false);
    const [selectedDoc, setSelectedDoc] = useState<DocumentRow | null>(null);
    const [masterItems, setMasterItems] = useState<MasterItem[]>([]);

    const [form, setForm] = useState(emptyForm);
    const [file, setFile] = useState<File | null>(null);
    const [isUploading, setIsUploading] = useState(false);
    const [uploadError, setUploadError] = useState('');
    const [isBusy, setIsBusy] = useState(false);

    const fetchDocuments = useCallback(async () => {
        setIsLoading(true);
        try {
            const params = new URLSearchParams({ organization_id: organizationId });
            if (propertyId) params.set('property_id', propertyId);
            if (categoryFilter !== 'all') params.set('category', categoryFilter);
            if (statusFilter !== 'all') params.set('status', statusFilter);
            if (searchTerm.trim()) params.set('q', searchTerm.trim());
            const res = await fetch(`/api/document-bank?${params}`);
            const data = await res.json();
            setUnprovisioned(data.provisioned === false ? (data.reason || 'Document Bank is not set up yet.') : null);
            if (data.documents) setDocuments(data.documents);
        } catch (err) {
            console.error('Failed to fetch document bank:', err);
        } finally {
            setIsLoading(false);
        }
    }, [organizationId, propertyId, categoryFilter, statusFilter, searchTerm]);

    useEffect(() => {
        const t = setTimeout(fetchDocuments, 250); // debounce search
        return () => clearTimeout(t);
    }, [fetchDocuments]);

    useEffect(() => {
        if (!showUploadModal || masterItems.length > 0) return;
        fetch(`/api/audit/master?organization_id=${organizationId}`)
            .then((r) => r.json())
            .then((d) => setMasterItems(d.items || []))
            .catch(() => {});
    }, [showUploadModal, organizationId, masterItems.length]);

    const stats = useMemo(() => {
        const expiring = documents.filter((d) => expiryStatus(d.valid_to) === 'expiring').length;
        const expired = documents.filter((d) => expiryStatus(d.valid_to) === 'expired').length;
        const processed = documents.filter((d) => d.ocr_status === 'processed').length;
        return { total: documents.length, expiring, expired, processed };
    }, [documents]);

    const handleUpload = async () => {
        if (!file || !form.title || !form.category) return;
        setIsUploading(true);
        setUploadError('');
        try {
            const fd = new FormData();
            fd.append('file', file);
            fd.append('organization_id', organizationId);
            if (propertyId) fd.append('property_id', propertyId);
            Object.entries(form).forEach(([k, v]) => { if (v) fd.append(k, v); });

            const res = await fetch('/api/document-bank', { method: 'POST', body: fd });
            const data = await res.json();
            if (!res.ok) { setUploadError(data.error || 'Upload failed'); return; }

            setShowUploadModal(false);
            setForm(emptyForm);
            setFile(null);
            await fetchDocuments();
            setSelectedDoc(data.document);
        } catch {
            setUploadError('Upload failed. Please try again.');
        } finally {
            setIsUploading(false);
        }
    };

    const applyOcrField = async (doc: DocumentRow, field: string) => {
        setIsBusy(true);
        try {
            const res = await fetch(`/api/document-bank/${doc.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ apply_ocr_fields: [field] }),
            });
            const data = await res.json();
            if (res.ok) {
                setSelectedDoc(data.document);
                setDocuments((prev) => prev.map((d) => (d.id === doc.id ? data.document : d)));
            }
        } finally {
            setIsBusy(false);
        }
    };

    const rerunOcr = async (doc: DocumentRow) => {
        setIsBusy(true);
        try {
            const res = await fetch(`/api/document-bank/${doc.id}/ocr`, { method: 'POST' });
            const data = await res.json();
            if (res.ok) {
                setSelectedDoc(data.document);
                setDocuments((prev) => prev.map((d) => (d.id === doc.id ? data.document : d)));
            }
        } finally {
            setIsBusy(false);
        }
    };

    const verifyDoc = async (doc: DocumentRow) => {
        setIsBusy(true);
        try {
            const res = await fetch(`/api/document-bank/${doc.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ verify: true }),
            });
            const data = await res.json();
            if (res.ok) {
                setSelectedDoc(data.document);
                setDocuments((prev) => prev.map((d) => (d.id === doc.id ? data.document : d)));
            }
        } finally {
            setIsBusy(false);
        }
    };

    const deleteDoc = async (doc: DocumentRow) => {
        if (!confirm(`Delete "${doc.title}"? This cannot be undone.`)) return;
        setIsBusy(true);
        try {
            const res = await fetch(`/api/document-bank/${doc.id}`, { method: 'DELETE' });
            if (res.ok) {
                setDocuments((prev) => prev.filter((d) => d.id !== doc.id));
                setSelectedDoc(null);
            } else {
                const data = await res.json();
                alert(data.error || 'Delete failed');
            }
        } finally {
            setIsBusy(false);
        }
    };

    return (
        <div className="space-y-6">
            {/* Stats Bar */}
            {/* One surface for all four. The tinted fills (emerald-50/amber-50/rose-50) paired
                each card with a border from its own family one step lighter, so those borders
                vanished while the plain first card kept a visible slate-200 edge — one card with
                an edge, three floating blocks, and the break landed on the green one.
                State is carried by the numeral, not the fill, and only when there is state to
                carry: a zero here is the healthy reading, so it stays neutral. Painting "0
                expired" red announces an alarm for the absence of a problem. */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                {([
                    { label: 'Total Documents', value: stats.total, tone: null },
                    { label: 'OCR Processed', value: stats.processed, tone: 'text-success' },
                    { label: 'Expiring ≤30 Days', value: stats.expiring, tone: 'text-warning' },
                    { label: 'Expired', value: stats.expired, tone: 'text-error' },
                ] as const).map((s) => {
                    const active = s.tone !== null && s.value > 0;
                    return (
                        <div key={s.label} className="bg-card p-6 rounded-3xl border border-border shadow-sm">
                            <p className="text-[10px] font-black text-text-tertiary uppercase tracking-widest mb-1 flex items-center gap-1.5">
                                {active && <span className={`w-1.5 h-1.5 rounded-full bg-current ${s.tone}`} />}
                                {s.label}
                            </p>
                            <h3 className={`text-3xl font-black tabular-nums ${active ? s.tone : 'text-foreground'}`}>
                                {s.value}
                            </h3>
                        </div>
                    );
                })}
            </div>

            {/* Controls */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-slate-900 flex items-center justify-center text-white">
                        <FolderLock className="w-5 h-5" />
                    </div>
                    <div>
                        <h2 className="text-sm font-black text-slate-900 uppercase tracking-tight">Document Bank</h2>
                        <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Searchable Compliance Vault</p>
                    </div>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                        <input
                            type="text"
                            placeholder="Search documents..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-primary/20 w-56"
                        />
                    </div>
                    <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}
                        className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold outline-none">
                        <option value="all">All Categories</option>
                        {Object.entries(CATEGORY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                    <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
                        className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold outline-none">
                        <option value="all">All Validity</option>
                        <option value="valid">Valid</option>
                        <option value="expiring">Expiring Soon</option>
                        <option value="expired">Expired</option>
                    </select>
                    <button
                        onClick={() => setShowUploadModal(true)}
                        className="flex items-center gap-2 px-4 py-2 bg-slate-900 text-white text-[10px] font-black uppercase tracking-widest rounded-xl hover:bg-primary transition-all shadow-sm"
                    >
                        <Upload className="w-4 h-4" /> Upload
                    </button>
                </div>
            </div>

            {/* Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {isLoading ? (
                    <div className="col-span-full py-16 text-center">
                        <Loader2 className="w-8 h-8 animate-spin text-primary mx-auto mb-2" />
                        <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Loading Document Bank...</p>
                    </div>
                ) : unprovisioned ? (
                    <div className="col-span-full py-16 text-center bg-white rounded-3xl border border-slate-200">
                        <FolderLock className="w-10 h-10 text-slate-200 mx-auto mb-3" />
                        <p className="text-xs font-black text-slate-400 uppercase tracking-widest">Document Bank not set up yet</p>
                        <p className="mt-2 text-[11px] font-medium text-slate-400 max-w-md mx-auto">{unprovisioned}</p>
                    </div>
                ) : documents.length === 0 ? (
                    <div className="col-span-full py-16 text-center bg-white rounded-3xl border border-slate-200">
                        <FolderLock className="w-10 h-10 text-slate-200 mx-auto mb-3" />
                        <p className="text-xs font-black text-slate-400 uppercase tracking-widest">No documents match your filters</p>
                    </div>
                ) : documents.map((doc) => {
                    const status = expiryStatus(doc.valid_to);
                    return (
                        <button
                            key={doc.id}
                            onClick={() => setSelectedDoc(doc)}
                            className="text-left bg-white rounded-3xl border border-slate-200 shadow-sm hover:shadow-xl hover:-translate-y-0.5 transition-all p-5 flex flex-col gap-3"
                        >
                            <div className="flex items-start justify-between gap-2">
                                <div className="w-10 h-10 rounded-xl bg-slate-50 flex items-center justify-center text-slate-500 flex-shrink-0">
                                    {doc.file_type?.includes('pdf') ? <FileText className="w-5 h-5" /> : <ImageIcon className="w-5 h-5" />}
                                </div>
                                <span className={`text-[9px] font-black uppercase tracking-widest px-2 py-1 rounded-full border whitespace-nowrap ${STATUS_STYLES[status]}`}>
                                    {STATUS_LABELS[status]}
                                </span>
                            </div>
                            <div>
                                <p className="text-xs font-black text-slate-900 leading-tight line-clamp-2">{doc.title}</p>
                                <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mt-1">
                                    {CATEGORY_LABELS[doc.category] || doc.category}{doc.equipment ? ` · ${doc.equipment}` : ''}
                                </p>
                            </div>
                            <div className="flex items-center justify-between text-[10px] font-bold text-slate-500 mt-auto pt-2 border-t border-slate-100">
                                <span className="truncate">{doc.vendor_name || '—'}</span>
                                <span>{doc.valid_to ? new Date(doc.valid_to).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : 'No expiry'}</span>
                            </div>
                            {doc.ocr_status === 'processed' && (
                                <div className="flex items-center gap-1.5 text-[9px] font-black text-primary uppercase tracking-widest">
                                    <Sparkles className="w-3 h-3" /> OCR Read
                                </div>
                            )}
                        </button>
                    );
                })}
            </div>

            {/* Upload Modal */}
            <AnimatePresence>
                {showUploadModal && (
                    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
                        <motion.div
                            initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
                            className="bg-white rounded-[2.5rem] shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto border border-slate-200"
                        >
                            <div className="p-8 border-b border-slate-100 flex items-center justify-between bg-slate-50 sticky top-0">
                                <div className="flex items-center gap-4">
                                    <div className="w-12 h-12 rounded-2xl bg-slate-900 flex items-center justify-center text-white shadow-lg">
                                        <Upload className="w-6 h-6" />
                                    </div>
                                    <div>
                                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-0.5">Document Bank</p>
                                        <h3 className="text-lg font-black text-slate-900 leading-tight">Upload Document</h3>
                                    </div>
                                </div>
                                <button onClick={() => setShowUploadModal(false)} className="p-2 hover:bg-slate-200 rounded-full transition-all">
                                    <X className="w-5 h-5 text-slate-500" />
                                </button>
                            </div>

                            <div className="p-8 space-y-5">
                                <div>
                                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 block">File (PDF or Image)</label>
                                    <input
                                        type="file"
                                        accept=".pdf,image/*"
                                        onChange={(e) => setFile(e.target.files?.[0] || null)}
                                        className="w-full text-xs font-bold text-slate-600 file:mr-4 file:py-2.5 file:px-4 file:rounded-xl file:border-0 file:text-[10px] file:font-black file:uppercase file:tracking-widest file:bg-slate-900 file:text-white hover:file:bg-primary file:cursor-pointer bg-slate-50 border border-slate-200 rounded-2xl p-2"
                                    />
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    <div className="col-span-2">
                                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 block">Title *</label>
                                        <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}
                                            placeholder="e.g. DG-1 AMC Contract 2026-27"
                                            className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl text-sm font-bold focus:ring-4 focus:ring-primary/10 focus:border-primary outline-none" />
                                    </div>
                                    <div>
                                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 block">Category *</label>
                                        <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}
                                            className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl text-sm font-bold outline-none">
                                            {Object.entries(CATEGORY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                                        </select>
                                    </div>
                                    <div>
                                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 block">Equipment</label>
                                        <input list="equipment-options" value={form.equipment} onChange={(e) => setForm({ ...form, equipment: e.target.value })}
                                            placeholder="e.g. DG Set"
                                            className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl text-sm font-bold outline-none" />
                                        <datalist id="equipment-options">
                                            {EQUIPMENT_OPTIONS.map((o) => <option key={o} value={o} />)}
                                        </datalist>
                                    </div>
                                    <div>
                                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 block">Vendor</label>
                                        <input value={form.vendor_name} onChange={(e) => setForm({ ...form, vendor_name: e.target.value })}
                                            className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl text-sm font-bold outline-none" />
                                    </div>
                                    <div>
                                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 block">Doc / Certificate No.</label>
                                        <input value={form.doc_number} onChange={(e) => setForm({ ...form, doc_number: e.target.value })}
                                            className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl text-sm font-bold outline-none" />
                                    </div>
                                    <div>
                                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 block">Issue Date</label>
                                        <input type="date" value={form.issue_date} onChange={(e) => setForm({ ...form, issue_date: e.target.value })}
                                            className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl text-sm font-bold outline-none" />
                                    </div>
                                    <div>
                                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 block">Valid From</label>
                                        <input type="date" value={form.valid_from} onChange={(e) => setForm({ ...form, valid_from: e.target.value })}
                                            className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl text-sm font-bold outline-none" />
                                    </div>
                                    <div>
                                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 block">Valid To (Expiry)</label>
                                        <input type="date" value={form.valid_to} onChange={(e) => setForm({ ...form, valid_to: e.target.value })}
                                            className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl text-sm font-bold outline-none" />
                                    </div>
                                    <div className="col-span-2">
                                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 block">Tags (comma separated)</label>
                                        <input value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })}
                                            placeholder="e.g. fire-safety, statutory"
                                            className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl text-sm font-bold outline-none" />
                                    </div>
                                    {propertyId && (
                                        <div className="col-span-2">
                                            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 block flex items-center gap-1.5">
                                                <Link2 className="w-3 h-3" /> Link to Digital Audit Checklist Item (optional)
                                            </label>
                                            <select value={form.linked_master_item_id} onChange={(e) => setForm({ ...form, linked_master_item_id: e.target.value })}
                                                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl text-sm font-bold outline-none">
                                                <option value="">None</option>
                                                {masterItems.map((m) => <option key={m.id} value={m.id}>#{m.si_no} — {m.requirement}</option>)}
                                            </select>
                                            <p className="text-[9px] text-slate-400 font-bold mt-1.5">Uploading here will also mark that checklist point compliant.</p>
                                        </div>
                                    )}
                                </div>

                                <p className="text-[9px] text-slate-400 font-bold uppercase tracking-widest flex items-center gap-1.5">
                                    <Sparkles className="w-3 h-3 text-primary" /> OCR will attempt to read validity dates automatically after upload
                                </p>

                                {uploadError && (
                                    <div className="bg-rose-50 border border-rose-200 text-rose-600 text-xs font-bold px-4 py-3 rounded-2xl">{uploadError}</div>
                                )}

                                <div className="flex gap-3 pt-2">
                                    <button onClick={() => setShowUploadModal(false)}
                                        className="flex-1 px-6 py-4 bg-slate-100 text-slate-600 text-xs font-black uppercase tracking-widest rounded-2xl hover:bg-slate-200 transition-all">
                                        Cancel
                                    </button>
                                    <button onClick={handleUpload} disabled={isUploading || !file || !form.title}
                                        className="flex-[2] px-6 py-4 bg-slate-900 text-white text-xs font-black uppercase tracking-widest rounded-2xl hover:bg-primary transition-all shadow-xl shadow-slate-900/10 disabled:opacity-50 flex items-center justify-center gap-2">
                                        {isUploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                                        {isUploading ? 'Uploading & Reading Document...' : 'Upload Document'}
                                    </button>
                                </div>
                            </div>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>

            {/* Detail Drawer */}
            <AnimatePresence>
                {selectedDoc && (
                    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[100] flex items-center justify-end">
                        <motion.div
                            initial={{ x: 40, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 40, opacity: 0 }}
                            className="bg-white h-full w-full max-w-xl overflow-y-auto shadow-2xl border-l border-slate-200"
                        >
                            <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50 sticky top-0 z-10">
                                <div>
                                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-0.5">
                                        {CATEGORY_LABELS[selectedDoc.category] || selectedDoc.category}
                                    </p>
                                    <h3 className="text-base font-black text-slate-900 leading-tight">{selectedDoc.title}</h3>
                                </div>
                                <button onClick={() => setSelectedDoc(null)} className="p-2 hover:bg-slate-200 rounded-full transition-all">
                                    <X className="w-5 h-5 text-slate-500" />
                                </button>
                            </div>

                            <div className="p-6 space-y-5">
                                <div className={`px-3 py-2 rounded-xl border text-[10px] font-black uppercase tracking-widest inline-flex items-center gap-1.5 ${STATUS_STYLES[expiryStatus(selectedDoc.valid_to)]}`}>
                                    {expiryStatus(selectedDoc.valid_to) === 'expired' ? <AlertCircle className="w-3.5 h-3.5" /> :
                                     expiryStatus(selectedDoc.valid_to) === 'expiring' ? <AlertTriangle className="w-3.5 h-3.5" /> :
                                     <CheckCircle2 className="w-3.5 h-3.5" />}
                                    {STATUS_LABELS[expiryStatus(selectedDoc.valid_to)]}
                                    {selectedDoc.valid_to && ` · ${new Date(selectedDoc.valid_to).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}`}
                                </div>

                                {selectedDoc.signed_url && (
                                    <div className="rounded-2xl overflow-hidden border border-slate-200 bg-slate-50">
                                        {selectedDoc.file_type?.includes('pdf') ? (
                                            <iframe src={selectedDoc.signed_url} className="w-full h-80" title={selectedDoc.title} />
                                        ) : (
                                            <img src={selectedDoc.signed_url} alt={selectedDoc.title} className="w-full max-h-80 object-contain" />
                                        )}
                                        <a href={selectedDoc.signed_url} target="_blank" rel="noopener noreferrer"
                                            className="flex items-center justify-center gap-2 py-2.5 text-[10px] font-black uppercase tracking-widest text-slate-500 hover:text-primary border-t border-slate-200">
                                            <ExternalLink className="w-3.5 h-3.5" /> Open Full Size
                                        </a>
                                    </div>
                                )}

                                <div className="grid grid-cols-2 gap-3 text-xs">
                                    <div className="bg-slate-50 rounded-xl p-3">
                                        <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Equipment</p>
                                        <p className="font-bold text-slate-800">{selectedDoc.equipment || '—'}</p>
                                    </div>
                                    <div className="bg-slate-50 rounded-xl p-3">
                                        <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Vendor</p>
                                        <p className="font-bold text-slate-800">{selectedDoc.vendor_name || '—'}</p>
                                    </div>
                                    <div className="bg-slate-50 rounded-xl p-3">
                                        <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Doc Number</p>
                                        <p className="font-bold text-slate-800">{selectedDoc.doc_number || '—'}</p>
                                    </div>
                                    <div className="bg-slate-50 rounded-xl p-3">
                                        <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Valid From</p>
                                        <p className="font-bold text-slate-800">{selectedDoc.valid_from || '—'}</p>
                                    </div>
                                </div>

                                {/* OCR Panel */}
                                <div className="bg-primary/5 border border-primary/10 rounded-2xl p-4">
                                    <div className="flex items-center justify-between mb-3">
                                        <div className="flex items-center gap-2 text-xs font-black text-slate-800 uppercase tracking-widest">
                                            <Sparkles className="w-4 h-4 text-primary" /> OCR Extraction
                                        </div>
                                        <button onClick={() => rerunOcr(selectedDoc)} disabled={isBusy}
                                            className="flex items-center gap-1.5 text-[9px] font-black uppercase tracking-widest text-slate-500 hover:text-primary disabled:opacity-50">
                                            <RefreshCw className={`w-3 h-3 ${isBusy ? 'animate-spin' : ''}`} /> Re-run
                                        </button>
                                    </div>

                                    {selectedDoc.ocr_status === 'pending' && (
                                        <p className="text-[10px] font-bold text-slate-400">Processing...</p>
                                    )}
                                    {selectedDoc.ocr_status === 'failed' && (
                                        <p className="text-[10px] font-bold text-rose-500">
                                            {selectedDoc.ocr_extracted?.error || 'Could not read this document automatically. Enter dates manually.'}
                                        </p>
                                    )}
                                    {selectedDoc.ocr_status === 'processed' && selectedDoc.ocr_extracted && (
                                        <div className="space-y-2">
                                            {Object.entries(FIELD_LABELS).map(([key, label]) => {
                                                const camel = key.replace(/_([a-z])/g, (_, c) => c.toUpperCase()) as keyof OcrExtracted;
                                                const ocrValue = selectedDoc.ocr_extracted?.[camel] as string | null | undefined;
                                                const currentValue = (selectedDoc as unknown as Record<string, unknown>)[key];
                                                const confidence = selectedDoc.ocr_extracted?.fieldConfidence?.[key] ?? 0;
                                                if (!ocrValue || ocrValue === currentValue) return null;
                                                return (
                                                    <div key={key} className="flex items-center justify-between gap-2 bg-white rounded-xl px-3 py-2 border border-primary/10">
                                                        <div className="min-w-0">
                                                            <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">{label} · {confidence}% confident</p>
                                                            <p className="text-xs font-bold text-slate-800 truncate">{ocrValue}</p>
                                                        </div>
                                                        <button onClick={() => applyOcrField(selectedDoc, key)} disabled={isBusy}
                                                            className="flex-shrink-0 px-3 py-1.5 bg-slate-900 text-white text-[9px] font-black uppercase tracking-widest rounded-lg hover:bg-primary transition-all disabled:opacity-50">
                                                            Apply
                                                        </button>
                                                    </div>
                                                );
                                            })}
                                            {selectedDoc.ocr_text && (
                                                <details className="mt-2">
                                                    <summary className="text-[9px] font-black text-slate-400 uppercase tracking-widest cursor-pointer">View Raw Extracted Text</summary>
                                                    <p className="text-[10px] text-slate-500 font-mono mt-2 whitespace-pre-wrap max-h-32 overflow-y-auto">{selectedDoc.ocr_text}</p>
                                                </details>
                                            )}
                                        </div>
                                    )}
                                </div>

                                {selectedDoc.tags.length > 0 && (
                                    <div className="flex flex-wrap gap-1.5">
                                        {selectedDoc.tags.map((t) => (
                                            <span key={t} className="flex items-center gap-1 px-2.5 py-1 bg-slate-100 text-slate-600 text-[9px] font-black uppercase tracking-widest rounded-full">
                                                <Tag className="w-2.5 h-2.5" /> {t}
                                            </span>
                                        ))}
                                    </div>
                                )}

                                {selectedDoc.verified_by ? (
                                    <div className="flex items-center gap-2 text-emerald-600 bg-emerald-50 border border-emerald-100 rounded-xl px-3 py-2 text-[10px] font-black uppercase tracking-widest">
                                        <ShieldCheck className="w-3.5 h-3.5" /> Verified {selectedDoc.verified_at ? new Date(selectedDoc.verified_at).toLocaleDateString('en-GB') : ''}
                                    </div>
                                ) : (
                                    <button onClick={() => verifyDoc(selectedDoc)} disabled={isBusy}
                                        className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-emerald-500 text-white text-[10px] font-black uppercase tracking-widest rounded-xl hover:bg-emerald-600 transition-all disabled:opacity-50">
                                        <ShieldCheck className="w-4 h-4" /> Mark Verified
                                    </button>
                                )}

                                <button onClick={() => deleteDoc(selectedDoc)} disabled={isBusy}
                                    className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-white border border-rose-200 text-rose-500 text-[10px] font-black uppercase tracking-widest rounded-xl hover:bg-rose-50 transition-all disabled:opacity-50">
                                    <Trash2 className="w-4 h-4" /> Delete Document
                                </button>
                            </div>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>
        </div>
    );
}
