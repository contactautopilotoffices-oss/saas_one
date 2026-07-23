'use client';

import React, { useState, useEffect } from 'react';
import { 
    ClipboardCheck, Search, Filter, Download, 
    Upload, FileText, CheckCircle2, AlertCircle, 
    Clock, ExternalLink, User, Building2,
    Loader2, X, Info
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import * as XLSX from 'xlsx';

interface AuditChecklistItem {
    id: string;
    si_no: number;
    category: string;
    requirement: string;
    spoc_name: string;
    period: string;
    submission: {
        id?: string;
        status: 'missing' | 'pending_review' | 'compliant' | 'not_applicable';
        remark: string;
        proof_url: string | null;
        submitted_at?: string;
    };
}

interface Props {
    organizationId: string;
    propertyId: string;
}

export default function InternalAuditView({ organizationId, propertyId }: Props) {
    const [checklist, setChecklist] = useState<AuditChecklistItem[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [filterStatus, setFilterStatus] = useState('all');
    const [selectedItem, setSelectedItem] = useState<AuditChecklistItem | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);

    // Form state for submission
    const [remark, setRemark] = useState('');
    const [proofUrl, setProofUrl] = useState('');

    useEffect(() => {
        fetchChecklist();
    }, [propertyId]);

    const fetchChecklist = async () => {
        setIsLoading(true);
        try {
            const res = await fetch(`/api/audit/submissions?property_id=${propertyId}`);
            const data = await res.json();
            if (data.checklist) setChecklist(data.checklist);
        } catch (err) {
            console.error('Failed to fetch audit checklist:', err);
        } finally {
            setIsLoading(false);
        }
    };

    const handleUpdate = async () => {
        if (!selectedItem) return;
        setIsSubmitting(true);
        try {
            const res = await fetch('/api/audit/submissions', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    master_item_id: selectedItem.id,
                    property_id: propertyId,
                    organization_id: organizationId,
                    remark,
                    proof_url: proofUrl,
                    status: 'compliant' // Auto-set to compliant when updated by user for now
                })
            });
            if (res.ok) {
                await fetchChecklist();
                setSelectedItem(null);
            }
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setIsLoading(true);
        const reader = new FileReader();
        reader.onload = async (evt) => {
            try {
                const bstr = evt.target?.result;
                const wb = XLSX.read(bstr, { type: 'binary' });
                const wsname = wb.SheetNames[0];
                const ws = wb.Sheets[wsname];
                const data = XLSX.utils.sheet_to_json(ws) as any[];

                // Map Excel columns to our DB schema
                // Expected columns: Sl. No., Category, Data Required, SPOC, Period
                const mappedItems = data.map((row: any) => ({
                    si_no: row['Sl. No.'] || row['si_no'],
                    category: row['Category'] || row['category'] || 'General',
                    requirement: row['Data Required'] || row['requirement'] || row['Requirement'],
                    spoc_name: row['SPOC'] || row['spoc_name'],
                    period: row['Period'] || row['period'],
                    organization_id: organizationId
                })).filter(item => item.requirement);

                if (mappedItems.length > 0) {
                    const res = await fetch('/api/audit/master', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ items: mappedItems })
                    });
                    if (res.ok) {
                        alert(`Successfully imported ${mappedItems.length} audit points!`);
                        fetchChecklist();
                    }
                }
            } catch (err) {
                console.error('Import failed:', err);
                alert('Failed to parse file. Please ensure it matches the audit format.');
            } finally {
                setIsLoading(false);
            }
        };
        reader.readAsBinaryString(file);
    };

    const filteredList = checklist.filter(item => {
        const matchesSearch = item.requirement.toLowerCase().includes(searchTerm.toLowerCase()) || 
                             item.category.toLowerCase().includes(searchTerm.toLowerCase());
        const matchesStatus = filterStatus === 'all' || item.submission.status === filterStatus;
        return matchesSearch && matchesStatus;
    });

    const complianceStats = {
        total: checklist.length,
        compliant: checklist.filter(i => i.submission.status === 'compliant').length,
        missing: checklist.filter(i => i.submission.status === 'missing').length,
    };

    const compliancePct = checklist.length > 0 ? Math.round((complianceStats.compliant / checklist.length) * 100) : 0;

    return (
        <div className="space-y-6">
            {/* Stats Bar */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Overall Compliance</p>
                    <div className="flex items-end gap-2">
                        <h3 className="text-3xl font-black text-slate-900">{compliancePct}%</h3>
                        <span className={`text-[10px] font-bold mb-1.5 ${compliancePct > 80 ? 'text-emerald-500' : 'text-amber-500'}`}>
                            {compliancePct > 80 ? 'Excellent' : 'Needs Action'}
                        </span>
                    </div>
                </div>
                <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Total Points</p>
                    <h3 className="text-3xl font-black text-slate-900">{complianceStats.total}</h3>
                </div>
                <div className="bg-emerald-50 p-6 rounded-3xl border border-emerald-100 shadow-sm">
                    <p className="text-[10px] font-black text-emerald-600 uppercase tracking-widest mb-1">Verified</p>
                    <h3 className="text-3xl font-black text-emerald-700">{complianceStats.compliant}</h3>
                </div>
                <div className="bg-rose-50 p-6 rounded-3xl border border-rose-100 shadow-sm">
                    <p className="text-[10px] font-black text-rose-600 uppercase tracking-widest mb-1">Missing Proof</p>
                    <h3 className="text-3xl font-black text-rose-700">{complianceStats.missing}</h3>
                </div>
            </div>

            {/* Controls */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-slate-900 flex items-center justify-center text-white">
                        <ClipboardCheck className="w-5 h-5" />
                    </div>
                    <div>
                        <h2 className="text-sm font-black text-slate-900 uppercase tracking-tight">Internal Audit Checklist</h2>
                        <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">35-Point Property Verification</p>
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    <input 
                        type="file" 
                        id="audit-import" 
                        className="hidden" 
                        accept=".xlsx, .xls, .csv" 
                        onChange={handleImport}
                    />
                    <label 
                        htmlFor="audit-import"
                        className="flex items-center gap-2 px-4 py-2 bg-slate-100 text-slate-700 text-[10px] font-black uppercase tracking-widest rounded-xl hover:bg-slate-200 transition-all cursor-pointer border border-slate-200"
                    >
                        <Upload className="w-4 h-4" />
                        Import Sheet
                    </label>
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                        <input 
                            type="text"
                            placeholder="Search audit points..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-primary/20 w-64"
                        />
                    </div>
                    <select 
                        value={filterStatus}
                        onChange={(e) => setFilterStatus(e.target.value)}
                        className="px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold outline-none"
                    >
                        <option value="all">All Status</option>
                        <option value="compliant">Compliant</option>
                        <option value="missing">Missing</option>
                    </select>
                </div>
            </div>

            {/* Table */}
            <div className="bg-white rounded-3xl border border-slate-200 shadow-xl overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-left">
                        <thead>
                            <tr className="bg-slate-50 border-b border-slate-200">
                                <th className="px-6 py-4 text-[10px] font-black text-slate-500 uppercase tracking-widest w-16">No.</th>
                                <th className="px-6 py-4 text-[10px] font-black text-slate-500 uppercase tracking-widest">Requirement</th>
                                <th className="px-6 py-4 text-[10px] font-black text-slate-500 uppercase tracking-widest">SPOC</th>
                                <th className="px-6 py-4 text-[10px] font-black text-slate-500 uppercase tracking-widest">Period</th>
                                <th className="px-6 py-4 text-[10px] font-black text-slate-500 uppercase tracking-widest">Status</th>
                                <th className="px-6 py-4 text-right"></th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {isLoading ? (
                                <tr>
                                    <td colSpan={6} className="px-6 py-12 text-center">
                                        <Loader2 className="w-8 h-8 animate-spin text-primary mx-auto mb-2" />
                                        <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Loading Audit Sheet...</p>
                                    </td>
                                </tr>
                            ) : filteredList.map((item) => (
                                <tr key={item.id} className="hover:bg-slate-50/50 transition-all group">
                                    <td className="px-6 py-4 text-xs font-black text-slate-400">#{item.si_no}</td>
                                    <td className="px-6 py-4">
                                        <div className="flex flex-col">
                                            <span className="text-xs font-black text-slate-800 leading-tight">{item.requirement}</span>
                                            <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mt-1">{item.category}</span>
                                        </div>
                                    </td>
                                    <td className="px-6 py-4">
                                        <div className="flex items-center gap-2">
                                            <div className="w-6 h-6 rounded-lg bg-slate-100 flex items-center justify-center text-slate-500">
                                                <User className="w-3 h-3" />
                                            </div>
                                            <span className="text-xs font-bold text-slate-600">{item.spoc_name}</span>
                                        </div>
                                    </td>
                                    <td className="px-6 py-4">
                                        <span className="text-[10px] font-bold text-slate-500 italic">{item.period}</span>
                                    </td>
                                    <td className="px-6 py-4">
                                        <span className={`text-[9px] font-black uppercase tracking-widest px-2.5 py-1 rounded-full border ${
                                            item.submission.status === 'compliant' ? 'bg-emerald-50 border-emerald-200 text-emerald-600' : 
                                            'bg-rose-50 border-rose-200 text-rose-600'
                                        }`}>
                                            {item.submission.status}
                                        </span>
                                    </td>
                                    <td className="px-6 py-4 text-right">
                                        <button 
                                            onClick={() => {
                                                setSelectedItem(item);
                                                setRemark(item.submission.remark);
                                                setProofUrl(item.submission.proof_url || '');
                                            }}
                                            className="px-4 py-2 bg-slate-900 text-white text-[10px] font-black uppercase tracking-widest rounded-xl hover:bg-primary transition-all shadow-sm"
                                        >
                                            {item.submission.status === 'compliant' ? 'Update Proof' : 'Upload Proof'}
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Upload Modal */}
            <AnimatePresence>
                {selectedItem && (
                    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
                        <motion.div 
                            initial={{ scale: 0.95, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0.95, opacity: 0 }}
                            className="bg-white rounded-[2.5rem] shadow-2xl w-full max-w-lg overflow-hidden border border-slate-200"
                        >
                            <div className="p-8 border-b border-slate-100 flex items-center justify-between bg-slate-50">
                                <div className="flex items-center gap-4">
                                    <div className="w-12 h-12 rounded-2xl bg-slate-900 flex items-center justify-center text-white shadow-lg">
                                        <Upload className="w-6 h-6" />
                                    </div>
                                    <div>
                                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-0.5">Submit Audit Evidence</p>
                                        <h3 className="text-lg font-black text-slate-900 leading-tight">#{selectedItem.si_no} {selectedItem.category}</h3>
                                    </div>
                                </div>
                                <button onClick={() => setSelectedItem(null)} className="p-2 hover:bg-slate-200 rounded-full transition-all">
                                    <X className="w-5 h-5 text-slate-500" />
                                </button>
                            </div>

                            <div className="p-8 space-y-6">
                                <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200">
                                    <div className="flex gap-3">
                                        <Info className="w-5 h-5 text-primary flex-shrink-0" />
                                        <p className="text-xs font-bold text-slate-600 leading-relaxed">
                                            Requirement: <span className="text-slate-900">{selectedItem.requirement}</span>
                                        </p>
                                    </div>
                                </div>

                                <div className="space-y-4">
                                    <div>
                                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 block">Upload Proof (Public URL / File)</label>
                                        <div className="relative group">
                                            <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                                                <ExternalLink className="w-4 h-4 text-slate-400 group-focus-within:text-primary transition-colors" />
                                            </div>
                                            <input 
                                                type="text"
                                                value={proofUrl}
                                                onChange={(e) => setProofUrl(e.target.value)}
                                                placeholder="Link to PDF, Image or Document..."
                                                className="w-full pl-11 pr-4 py-3.5 bg-slate-50 border border-slate-200 rounded-2xl text-sm font-bold focus:ring-4 focus:ring-primary/10 focus:border-primary outline-none transition-all"
                                            />
                                        </div>
                                    </div>

                                    <div>
                                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 block">Remarks / Status Update</label>
                                        <textarea 
                                            value={remark}
                                            onChange={(e) => setRemark(e.target.value)}
                                            rows={4}
                                            placeholder="Current status, justification or additional details..."
                                            className="w-full px-4 py-4 bg-slate-50 border border-slate-200 rounded-2xl text-sm font-bold focus:ring-4 focus:ring-primary/10 focus:border-primary outline-none transition-all resize-none"
                                        />
                                    </div>
                                </div>

                                <div className="flex gap-3 pt-2">
                                    <button 
                                        onClick={() => setSelectedItem(null)}
                                        className="flex-1 px-6 py-4 bg-slate-100 text-slate-600 text-xs font-black uppercase tracking-widest rounded-2xl hover:bg-slate-200 transition-all"
                                    >
                                        Cancel
                                    </button>
                                    <button 
                                        onClick={handleUpdate}
                                        disabled={isSubmitting || !remark}
                                        className="flex-[2] px-6 py-4 bg-slate-900 text-white text-xs font-black uppercase tracking-widest rounded-2xl hover:bg-primary transition-all shadow-xl shadow-slate-900/10 disabled:opacity-50 flex items-center justify-center gap-2"
                                    >
                                        {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                                        Save Submission
                                    </button>
                                </div>
                            </div>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>
        </div>
    );
}
