'use client';

import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, Send, ShieldAlert, UserX, AlertTriangle, Paperclip, CheckCircle2, Info, Lock, HelpCircle, FileText, Check } from 'lucide-react';
import { formatSlaDisplay } from '@/frontend/components/hr/HRAdminConfigPanel';

interface TicketCreateModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSuccess?: (ticket?: any) => void;
    orgId: string;
    userId: string;
}

export default function TicketCreateModal({ isOpen, onClose, onSuccess, orgId, userId }: TicketCreateModalProps) {
    const [mounted, setMounted] = useState(false);
    const [categories, setCategories] = useState<any[]>([]);
    const [ticketType, setTicketType] = useState<'grievance' | 'hr_query' | 'confidential_feedback' | 'anonymous_feedback'>('grievance');
    const [showTypeInfoModal, setShowTypeInfoModal] = useState(false);
    const [categoryId, setCategoryId] = useState('');
    const [subject, setSubject] = useState('');
    const [description, setDescription] = useState('');
    const [priority, setPriority] = useState('medium');
    const [isConfidential, setIsConfidential] = useState(false);
    const [isAnonymous, setIsAnonymous] = useState(false);
    const [attachments, setAttachments] = useState<string[]>([]);
    const [uploadingFile, setUploadingFile] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        setMounted(true);
    }, []);

    useEffect(() => {
        if (isOpen) {
            fetchCategories();
        }
    }, [isOpen]);

    const fetchCategories = async () => {
        try {
            const res = await fetch('/api/hr/admin/categories');
            const text = await res.text();
            let data: any = {};
            try { data = text ? JSON.parse(text) : {}; } catch {}
            if (data.success) {
                setCategories(data.data || []);
            }
        } catch (err) {
            console.error('Error fetching categories:', err);
        }
    };

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files;
        if (!files || files.length === 0) return;

        setUploadingFile(true);
        setError('');
        try {
            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                const formData = new FormData();
                formData.append('file', file);

                const res = await fetch('/api/hr/upload', {
                    method: 'POST',
                    body: formData
                });
                const data = await res.json();
                if (data.success && data.url) {
                    setAttachments(prev => [...prev, data.url]);
                } else {
                    setError(data.error || 'Failed to upload document');
                }
            }
        } catch (err: any) {
            setError(err?.message || 'File upload failed');
        } finally {
            setUploadingFile(false);
            e.target.value = '';
        }
    };

    const filteredCategories = categories.filter(c => {
        if (ticketType === 'confidential_feedback') return c.ticket_type === 'confidential_feedback' || c.is_confidential;
        if (ticketType === 'anonymous_feedback') return c.ticket_type === 'anonymous_feedback' || c.is_anonymous;
        return c.ticket_type === ticketType;
    });

    // Auto-select category if there is only 1 option; reset if invalid
    useEffect(() => {
        if (filteredCategories.length === 1) {
            setCategoryId(filteredCategories[0].id);
        } else if (filteredCategories.length > 1) {
            if (categoryId && !filteredCategories.some(c => c.id === categoryId)) {
                setCategoryId('');
            }
        } else {
            setCategoryId('');
        }
    }, [ticketType, categories]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        if (!categoryId) {
            setError('Please select a category');
            return;
        }
        if (!subject.trim() || !description.trim()) {
            setError('Subject and description are required');
            return;
        }

        setSubmitting(true);
        try {
            const res = await fetch('/api/hr/tickets', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    organization_id: orgId,
                    category_id: categoryId,
                    raised_by_user_id: userId,
                    subject,
                    description,
                    priority,
                    is_confidential: isConfidential || ticketType === 'confidential_feedback',
                    is_anonymous: isAnonymous || ticketType === 'anonymous_feedback',
                    attachment_urls: attachments
                })
            });

            const text = await res.text();
            let data: any = {};
            try { data = text ? JSON.parse(text) : {}; } catch {}
            if (!data.success) throw new Error(data.error || 'Failed to submit ticket');

            if (onSuccess) onSuccess(data.data);
            if (typeof window !== 'undefined') {
                window.dispatchEvent(new CustomEvent('hr-ticket-created', { detail: { ticket: data.data } }));
            }
            onClose();
        } catch (err: any) {
            setError(err.message || 'Failed to submit ticket');
        } finally {
            setSubmitting(false);
        }
    };

    if (!isOpen || !mounted) return null;

    return createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-2 sm:p-4">
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl sm:rounded-3xl shadow-2xl w-full max-w-2xl max-h-[92vh] sm:max-h-[85vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200 my-auto">
                {/* Header - Fixed Top */}
                <div className="shrink-0 flex items-center justify-between px-4 sm:px-6 py-3.5 sm:py-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/50">
                    <div>
                        <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
                            New HR Request / Grievance
                        </h2>
                        <p className="text-[11px] sm:text-xs text-slate-500 dark:text-slate-400">
                            Submit an Employee Grievance, HR Query, Confidential or Anonymous Feedback
                        </p>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-white rounded-lg transition-colors shrink-0"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Form Container */}
                <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
                    {/* Scrollable Form Content */}
                    <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4 sm:space-y-5">
                        {error && (
                            <div className="p-3 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 rounded-xl text-xs text-red-600 dark:text-red-400 flex items-center gap-2">
                                <AlertTriangle className="w-4 h-4 shrink-0" />
                                <span>{error}</span>
                            </div>
                        )}

                        {/* Ticket Type Tabs */}
                        <div>
                            <div className="flex items-center justify-between mb-2">
                                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                                    Select Request Type
                                </label>
                                <button
                                    type="button"
                                    onClick={() => setShowTypeInfoModal(true)}
                                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold text-[#587e85] hover:text-[#3d5b60] dark:text-[#7ba9b1] bg-[#587e85]/10 hover:bg-[#587e85]/20 border border-[#587e85]/20 transition-all cursor-pointer shadow-2xs active:scale-95"
                                    title="Click to view full guide explaining ticket types"
                                >
                                    <Info className="w-3.5 h-3.5" />
                                    <span>Ticket Type Guide (i)</span>
                                </button>
                            </div>
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                                {[
                                    { id: 'grievance', label: 'Employee Grievance', sub: 'L1 Manager / HOD' },
                                    { id: 'hr_query', label: 'HR Query', sub: 'Payroll, Leave, Benefits' },
                                    { id: 'confidential_feedback', label: 'Confidential Feedback', sub: 'Director Channel' },
                                    { id: 'anonymous_feedback', label: 'Anonymous Feedback', sub: 'Identity Masked' }
                                ].map((tab) => (
                                    <button
                                        key={tab.id}
                                        type="button"
                                        onClick={() => {
                                            const newType = tab.id as any;
                                            setTicketType(newType);
                                            setIsConfidential(newType === 'confidential_feedback');
                                            setIsAnonymous(newType === 'anonymous_feedback');
                                            const matched = categories.filter(c => {
                                                if (newType === 'confidential_feedback') return c.ticket_type === 'confidential_feedback' || c.is_confidential;
                                                if (newType === 'anonymous_feedback') return c.ticket_type === 'anonymous_feedback' || c.is_anonymous;
                                                return c.ticket_type === newType;
                                            });
                                            if (matched.length === 1) {
                                                setCategoryId(matched[0].id);
                                            } else {
                                                setCategoryId('');
                                            }
                                        }}
                                        className={`p-2.5 sm:p-3 rounded-xl border text-left transition-all ${
                                            ticketType === tab.id
                                                ? 'border-indigo-500 bg-indigo-50/50 dark:bg-indigo-950/30 text-indigo-700 dark:text-indigo-300 ring-2 ring-indigo-500/20 font-bold'
                                                : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 text-slate-600 dark:text-slate-400'
                                        }`}
                                    >
                                        <div className="text-xs font-bold truncate">{tab.label}</div>
                                        <div className="text-[10px] opacity-75 mt-0.5 truncate">{tab.sub}</div>
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Notice Callouts */}
                        {ticketType === 'grievance' && (
                            <div className="p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/50 rounded-xl text-xs text-amber-800 dark:text-amber-300">
                                <strong>Note:</strong> Employee Grievances are assigned to your <strong>Reporting Manager / HOD (Level 1)</strong> with a 3-working-day resolution TAT (Turnaround Time) before automatically escalating to HR.
                            </div>
                        )}

                        {ticketType === 'hr_query' && (
                            <div className="p-3 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800/50 rounded-xl text-xs text-blue-800 dark:text-blue-300">
                                <strong>Note:</strong> HR Queries (Attendance, Payroll, Leaves, Payslips, Documents, Benefits) are routed directly to the <strong>HR Department (Level 1)</strong>.
                            </div>
                        )}

                        {ticketType === 'confidential_feedback' && (
                            <div className="p-3 bg-purple-50 dark:bg-purple-950/30 border border-purple-200 dark:border-purple-800/50 rounded-xl text-xs text-purple-800 dark:text-purple-300 flex items-start gap-2">
                                <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5 text-purple-600" />
                                <div>
                                    <strong>Confidential Channel:</strong> Your identity is captured but visible <strong>ONLY to authorized Directors</strong>. Reporting Managers and normal HR staff have zero access.
                                </div>
                            </div>
                        )}

                        {ticketType === 'anonymous_feedback' && (
                            <div className="p-3 bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-xs text-slate-800 dark:text-slate-200 flex items-start gap-2">
                                <UserX className="w-4 h-4 shrink-0 mt-0.5 text-slate-500" />
                                <div>
                                    <strong>Anonymous Channel:</strong> Your identity is completely hidden from the ticket recipient while allowing secure two-way communication without exposing your profile.
                                </div>
                            </div>
                        )}

                        {/* Category Selection */}
                        <div>
                            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5 flex items-center justify-between">
                                <span>Category *</span>
                                <span className="text-[10px] font-normal text-slate-400">
                                    {filteredCategories.length === 1
                                        ? 'Default Category'
                                        : `Select from list (${filteredCategories.length} options)`}
                                </span>
                            </label>

                            {filteredCategories.length === 1 ? (
                                <div className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 text-slate-900 dark:text-white text-xs font-semibold flex items-center justify-between shadow-2xs">
                                    <span className="truncate">
                                        {filteredCategories[0].category_name}
                                        {filteredCategories[0].sub_category_name ? ` — ${filteredCategories[0].sub_category_name}` : ''}
                                    </span>
                                    <span className="text-[10px] font-bold text-[#587e85] dark:text-[#7ba9b1] bg-[#587e85]/10 px-2 py-0.5 rounded-md border border-[#587e85]/20 shrink-0">
                                        Selected
                                    </span>
                                </div>
                            ) : (
                                <select
                                    value={categoryId}
                                    onChange={(e) => setCategoryId(e.target.value)}
                                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-xs font-semibold focus:ring-2 focus:ring-indigo-500 outline-none cursor-pointer"
                                    required
                                >
                                    <option value="">-- Select Category Option --</option>
                                    {filteredCategories.map((cat) => (
                                        <option key={cat.id} value={cat.id}>
                                            {cat.category_name}{cat.sub_category_name ? ` — ${cat.sub_category_name}` : ''}
                                        </option>
                                    ))}
                                </select>
                            )}
                        </div>

                        {/* Subject */}
                        <div>
                            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                                Subject *
                            </label>
                            <input
                                type="text"
                                value={subject}
                                onChange={(e) => setSubject(e.target.value)}
                                placeholder="Brief title of concern or query"
                                className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-xs focus:ring-2 focus:ring-indigo-500 outline-none"
                                required
                            />
                        </div>

                        {/* Description */}
                        <div>
                            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                                Detailed Description *
                            </label>
                            <textarea
                                value={description}
                                onChange={(e) => setDescription(e.target.value)}
                                rows={3}
                                placeholder="Provide full details, background context, or specific requests..."
                                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-xs focus:ring-2 focus:ring-indigo-500 outline-none resize-none"
                                required
                            />
                        </div>

                        {/* Document File Upload */}
                        <div>
                            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                                Attach Documents / Screenshots
                            </label>
                            <label className="flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl border border-dashed border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-semibold cursor-pointer transition-colors">
                                <Paperclip className="w-4 h-4 text-[#587e85]" />
                                <span>{uploadingFile ? 'Uploading file...' : 'Choose File(s) to Attach'}</span>
                                <input
                                    type="file"
                                    multiple
                                    onChange={handleFileUpload}
                                    disabled={uploadingFile}
                                    className="hidden"
                                />
                            </label>
                        </div>

                        {/* Attachments List */}
                        {attachments.length > 0 && (
                            <div className="flex flex-wrap gap-2 pt-1">
                                {attachments.map((url, idx) => {
                                    const name = url.split('/').pop()?.split('_').slice(2).join('_') || url.split('/').pop() || `Attachment ${idx + 1}`;
                                    return (
                                        <span key={idx} className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-teal-50 dark:bg-teal-950/40 border border-teal-200 dark:border-teal-800 text-teal-800 dark:text-teal-300 rounded-lg text-[11px] font-medium">
                                            <Paperclip className="w-3 h-3 text-[#587e85]" />
                                            <a href={url} target="_blank" rel="noopener noreferrer" className="max-w-[180px] truncate hover:underline">
                                                {name}
                                            </a>
                                            <button
                                                type="button"
                                                onClick={() => setAttachments(attachments.filter((_, i) => i !== idx))}
                                                className="text-slate-400 hover:text-red-500 ml-1 text-xs"
                                            >
                                                ×
                                            </button>
                                        </span>
                                    );
                                })}
                            </div>
                        )}
                    </div>

                    {/* Modal Footer - Fixed Bottom */}
                    <div className="shrink-0 flex items-center justify-end gap-2.5 sm:gap-3 px-4 sm:px-6 py-3.5 sm:py-4 bg-slate-50/50 dark:bg-slate-800/50 border-t border-slate-100 dark:border-slate-800">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 text-xs font-semibold hover:bg-slate-50 dark:hover:bg-slate-800"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={submitting}
                            className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-[#587e85] hover:bg-[#48686e] text-white text-xs font-bold shadow-md shadow-[#587e85]/20 disabled:opacity-50 transition-all active:scale-95"
                        >
                            {submitting ? 'Submitting...' : 'Submit Request'}
                            <Send className="w-3.5 h-3.5" />
                        </button>
                    </div>
                </form>
            </div>

            {/* Ticket Type Information Modal (i-button) */}
            {showTypeInfoModal && (
                <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-slate-950/70 backdrop-blur-sm p-3 sm:p-4">
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-2xl w-full max-w-xl max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                        {/* Header */}
                        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-800/60">
                            <div className="flex items-center gap-2.5">
                                <div className="w-8 h-8 rounded-xl bg-[#587e85]/15 text-[#587e85] dark:text-[#7ba9b1] flex items-center justify-center shrink-0">
                                    <Info className="w-4 h-4" />
                                </div>
                                <div>
                                    <h3 className="text-sm font-black text-slate-900 dark:text-white">
                                        Understanding Request Types
                                    </h3>
                                    <p className="text-[11px] text-slate-500">
                                        Choose the right channel for your grievance or query
                                    </p>
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={() => setShowTypeInfoModal(false)}
                                className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-white rounded-lg transition-colors"
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        {/* Guide Content Cards */}
                        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-3.5">
                            {/* Card 1: Grievance */}
                            <div 
                                onClick={() => {
                                    setTicketType('grievance');
                                    setCategoryId('');
                                    setIsConfidential(false);
                                    setIsAnonymous(false);
                                    setShowTypeInfoModal(false);
                                }}
                                className={`p-4 rounded-2xl border transition-all cursor-pointer hover:shadow-md ${
                                    ticketType === 'grievance' 
                                        ? 'border-amber-500 bg-amber-50/40 dark:bg-amber-950/20 ring-1 ring-amber-500/30' 
                                        : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-800 hover:border-amber-300'
                                }`}
                            >
                                <div className="flex items-start justify-between gap-3">
                                    <div className="flex items-center gap-2">
                                        <div className="w-7 h-7 rounded-lg bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300 flex items-center justify-center shrink-0 font-bold text-xs">
                                            🛡️
                                        </div>
                                        <div>
                                            <h4 className="text-xs font-black text-slate-900 dark:text-white flex items-center gap-1.5">
                                                Employee Grievance
                                                {ticketType === 'grievance' && <span className="text-[10px] font-bold text-amber-600 dark:text-amber-400">(Selected)</span>}
                                            </h4>
                                            <p className="text-[10.5px] text-slate-500">Workplace issues, peer conflict, policy dissatisfaction</p>
                                        </div>
                                    </div>
                                    <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300 shrink-0">
                                        Level 1 Manager
                                    </span>
                                </div>
                                <div className="mt-2.5 pt-2 border-t border-slate-100 dark:border-slate-800/80 text-[11px] text-slate-600 dark:text-slate-300 space-y-1">
                                    <p><strong>• Routing:</strong> Assigned directly to your <strong>Reporting Manager / HOD (Level 1)</strong>.</p>
                                    <p><strong>• Resolution SLA:</strong> 3 working days TAT. Automatically escalates to HR Head (Level 2) if unresolved.</p>
                                    <p><strong>• When to choose:</strong> For grievances regarding workplace conduct, team conflicts, work conditions, or managerial decisions.</p>
                                </div>
                            </div>

                            {/* Card 2: HR Query */}
                            <div 
                                onClick={() => {
                                    setTicketType('hr_query');
                                    setCategoryId('');
                                    setIsConfidential(false);
                                    setIsAnonymous(false);
                                    setShowTypeInfoModal(false);
                                }}
                                className={`p-4 rounded-2xl border transition-all cursor-pointer hover:shadow-md ${
                                    ticketType === 'hr_query' 
                                        ? 'border-blue-500 bg-blue-50/40 dark:bg-blue-950/20 ring-1 ring-blue-500/30' 
                                        : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-800 hover:border-blue-300'
                                }`}
                            >
                                <div className="flex items-start justify-between gap-3">
                                    <div className="flex items-center gap-2">
                                        <div className="w-7 h-7 rounded-lg bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300 flex items-center justify-center shrink-0 font-bold text-xs">
                                            📋
                                        </div>
                                        <div>
                                            <h4 className="text-xs font-black text-slate-900 dark:text-white flex items-center gap-1.5">
                                                HR Query
                                                {ticketType === 'hr_query' && <span className="text-[10px] font-bold text-blue-600 dark:text-blue-400">(Selected)</span>}
                                            </h4>
                                            <p className="text-[10.5px] text-slate-500">Payroll, leaves, benefits, letters, policies</p>
                                        </div>
                                    </div>
                                    <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-300 shrink-0">
                                        HR Operations
                                    </span>
                                </div>
                                <div className="mt-2.5 pt-2 border-t border-slate-100 dark:border-slate-800/80 text-[11px] text-slate-600 dark:text-slate-300 space-y-1">
                                    <p><strong>• Routing:</strong> Routes straight to the <strong>HR Operations Department (Level 1)</strong>.</p>
                                    <p><strong>• Scope:</strong> Salary slips, attendance regularization, leave quotas, PF/ESIC, health insurance, experience letters.</p>
                                    <p><strong>• When to choose:</strong> For standard questions, inquiries, and routine administrative requests.</p>
                                </div>
                            </div>

                            {/* Card 3: Confidential Feedback */}
                            <div 
                                onClick={() => {
                                    setTicketType('confidential_feedback');
                                    setCategoryId('');
                                    setIsConfidential(true);
                                    setIsAnonymous(false);
                                    setShowTypeInfoModal(false);
                                }}
                                className={`p-4 rounded-2xl border transition-all cursor-pointer hover:shadow-md ${
                                    ticketType === 'confidential_feedback' 
                                        ? 'border-purple-500 bg-purple-50/40 dark:bg-purple-950/20 ring-1 ring-purple-500/30' 
                                        : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-800 hover:border-purple-300'
                                }`}
                            >
                                <div className="flex items-start justify-between gap-3">
                                    <div className="flex items-center gap-2">
                                        <div className="w-7 h-7 rounded-lg bg-purple-100 dark:bg-purple-950 text-purple-700 dark:text-purple-300 flex items-center justify-center shrink-0 font-bold text-xs">
                                            🔒
                                        </div>
                                        <div>
                                            <h4 className="text-xs font-black text-slate-900 dark:text-white flex items-center gap-1.5">
                                                Confidential Feedback
                                                {ticketType === 'confidential_feedback' && <span className="text-[10px] font-bold text-purple-600 dark:text-purple-400">(Selected)</span>}
                                            </h4>
                                            <p className="text-[10.5px] text-slate-500">Sensitive ethics, leadership, or whistleblowing</p>
                                        </div>
                                    </div>
                                    <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md bg-purple-100 dark:bg-purple-900/40 text-purple-800 dark:text-purple-300 shrink-0">
                                        Directors Only
                                    </span>
                                </div>
                                <div className="mt-2.5 pt-2 border-t border-slate-100 dark:border-slate-800/80 text-[11px] text-slate-600 dark:text-slate-300 space-y-1">
                                    <p><strong>• Confidentiality:</strong> Your identity is captured for accountability, but visible <strong>ONLY to authorized Company Directors</strong>.</p>
                                    <p><strong>• Zero Peer/Manager Access:</strong> Reporting Managers, HODs, and standard HR staff have zero visibility into this ticket.</p>
                                    <p><strong>• When to choose:</strong> Severe ethical concerns, whistleblowing, harassment, or conflicts involving department leadership.</p>
                                </div>
                            </div>

                            {/* Card 4: Anonymous Feedback */}
                            <div 
                                onClick={() => {
                                    setTicketType('anonymous_feedback');
                                    setCategoryId('');
                                    setIsConfidential(false);
                                    setIsAnonymous(true);
                                    setShowTypeInfoModal(false);
                                }}
                                className={`p-4 rounded-2xl border transition-all cursor-pointer hover:shadow-md ${
                                    ticketType === 'anonymous_feedback' 
                                        ? 'border-teal-500 bg-teal-50/40 dark:bg-teal-950/20 ring-1 ring-teal-500/30' 
                                        : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-800 hover:border-teal-300'
                                }`}
                            >
                                <div className="flex items-start justify-between gap-3">
                                    <div className="flex items-center gap-2">
                                        <div className="w-7 h-7 rounded-lg bg-teal-100 dark:bg-teal-950 text-teal-700 dark:text-teal-300 flex items-center justify-center shrink-0 font-bold text-xs">
                                            🎭
                                        </div>
                                        <div>
                                            <h4 className="text-xs font-black text-slate-900 dark:text-white flex items-center gap-1.5">
                                                Anonymous Feedback
                                                {ticketType === 'anonymous_feedback' && <span className="text-[10px] font-bold text-teal-600 dark:text-teal-400">(Selected)</span>}
                                            </h4>
                                            <p className="text-[10.5px] text-slate-500">100% Identity Masked for fear-free communication</p>
                                        </div>
                                    </div>
                                    <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md bg-teal-100 dark:bg-teal-900/40 text-teal-800 dark:text-teal-300 shrink-0">
                                        Masked Identity
                                    </span>
                                </div>
                                <div className="mt-2.5 pt-2 border-t border-slate-100 dark:border-slate-800/80 text-[11px] text-slate-600 dark:text-slate-300 space-y-1">
                                    <p><strong>• Total Anonymity:</strong> Your name, email, employee code, and department are completely masked in ticket records.</p>
                                    <p><strong>• Two-way Communication:</strong> You can still reply and receive updates without exposing your identity.</p>
                                    <p><strong>• When to choose:</strong> Honest suggestions, culture feedback, or sensitive observations when you prefer 100% privacy.</p>
                                </div>
                            </div>
                        </div>

                        {/* Footer */}
                        <div className="p-4 bg-slate-50/80 dark:bg-slate-800/50 border-t border-slate-100 dark:border-slate-800 flex justify-end">
                            <button
                                type="button"
                                onClick={() => setShowTypeInfoModal(false)}
                                className="px-4 py-2 bg-[#587e85] hover:bg-[#48686e] text-white text-xs font-bold rounded-xl shadow-xs cursor-pointer"
                            >
                                Got it, Close Guide
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>,
        document.body
    );
}
