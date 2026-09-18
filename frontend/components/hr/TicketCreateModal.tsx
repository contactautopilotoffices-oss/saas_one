'use client';

import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, Send, ShieldAlert, UserX, AlertTriangle, Paperclip, CheckCircle2 } from 'lucide-react';
import { formatSlaDisplay } from '@/frontend/components/hr/HRAdminConfigPanel';

interface TicketCreateModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSuccess: () => void;
    orgId: string;
    userId: string;
}

export default function TicketCreateModal({ isOpen, onClose, onSuccess, orgId, userId }: TicketCreateModalProps) {
    const [mounted, setMounted] = useState(false);
    const [categories, setCategories] = useState<any[]>([]);
    const [ticketType, setTicketType] = useState<'grievance' | 'hr_query' | 'confidential_feedback' | 'anonymous_feedback'>('grievance');
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

            onSuccess();
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
                            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2">
                                Select Request Type
                            </label>
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
                                            setTicketType(tab.id as any);
                                            setCategoryId('');
                                            setIsConfidential(tab.id === 'confidential_feedback');
                                            setIsAnonymous(tab.id === 'anonymous_feedback');
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

                        {/* Category Selection Dropdown */}
                        <div>
                            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5 flex items-center justify-between">
                                <span>Category *</span>
                                <span className="text-[10px] font-normal text-slate-400">Select from list ({filteredCategories.length} options)</span>
                            </label>
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

                        {/* Priority & Document File Upload */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                            <div>
                                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                                    Priority Level
                                </label>
                                <select
                                    value={priority}
                                    onChange={(e) => setPriority(e.target.value)}
                                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-xs focus:ring-2 focus:ring-indigo-500 outline-none"
                                >
                                    <option value="low">Low Priority</option>
                                    <option value="medium">Medium Priority</option>
                                    <option value="high">High Priority</option>
                                    <option value="critical">Critical / Urgent</option>
                                </select>
                            </div>

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
        </div>,
        document.body
    );
}
