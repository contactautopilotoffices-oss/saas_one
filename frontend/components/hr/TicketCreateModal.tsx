'use client';

import React, { useState, useEffect } from 'react';
import { X, Send, ShieldAlert, UserX, AlertTriangle, Paperclip, CheckCircle2 } from 'lucide-react';

interface TicketCreateModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSuccess: () => void;
    orgId: string;
    userId: string;
}

export default function TicketCreateModal({ isOpen, onClose, onSuccess, orgId, userId }: TicketCreateModalProps) {
    const [categories, setCategories] = useState<any[]>([]);
    const [ticketType, setTicketType] = useState<'grievance' | 'hr_query' | 'confidential_feedback' | 'anonymous_feedback'>('grievance');
    const [categoryId, setCategoryId] = useState('');
    const [subject, setSubject] = useState('');
    const [description, setDescription] = useState('');
    const [priority, setPriority] = useState('medium');
    const [isConfidential, setIsConfidential] = useState(false);
    const [isAnonymous, setIsAnonymous] = useState(false);
    const [attachmentUrl, setAttachmentUrl] = useState('');
    const [attachments, setAttachments] = useState<string[]>([]);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState('');

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

    const handleAddAttachment = () => {
        if (attachmentUrl.trim()) {
            setAttachments([...attachments, attachmentUrl.trim()]);
            setAttachmentUrl('');
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

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-2 sm:p-4">
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
                                <strong>Note:</strong> Employee Grievances are assigned to your <strong>Reporting Manager / HOD (Level 1)</strong> with a 3-working-day resolution SLA before automatically escalating to HR.
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
                            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                                Category *
                            </label>
                            <select
                                value={categoryId}
                                onChange={(e) => setCategoryId(e.target.value)}
                                className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-xs focus:ring-2 focus:ring-indigo-500 outline-none"
                                required
                            >
                                <option value="">Select Category...</option>
                                {filteredCategories.map((c) => (
                                    <option key={c.id} value={c.id}>
                                        {c.category_name} {c.sub_category_name ? `(${c.sub_category_name})` : ''} - SLA: {c.l1_sla_days}d
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

                        {/* Priority & Attachments */}
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
                                    Add Document Link / URL
                                </label>
                                <div className="flex gap-2">
                                    <input
                                        type="url"
                                        value={attachmentUrl}
                                        onChange={(e) => setAttachmentUrl(e.target.value)}
                                        placeholder="https://..."
                                        className="flex-1 min-w-0 px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-xs focus:ring-2 focus:ring-indigo-500 outline-none"
                                    />
                                    <button
                                        type="button"
                                        onClick={handleAddAttachment}
                                        className="px-3 py-2 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-xl text-xs font-semibold hover:bg-slate-200 dark:hover:bg-slate-700 shrink-0"
                                    >
                                        Add
                                    </button>
                                </div>
                            </div>
                        </div>

                        {/* Attachments List */}
                        {attachments.length > 0 && (
                            <div className="flex flex-wrap gap-2 pt-1">
                                {attachments.map((url, idx) => (
                                    <span key={idx} className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-lg text-[11px]">
                                        <Paperclip className="w-3 h-3 text-slate-400" />
                                        <span className="max-w-[150px] truncate">{url}</span>
                                        <button
                                            type="button"
                                            onClick={() => setAttachments(attachments.filter((_, i) => i !== idx))}
                                            className="text-slate-400 hover:text-red-500 ml-1"
                                        >
                                            ×
                                        </button>
                                    </span>
                                ))}
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
                            className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold shadow-lg shadow-indigo-600/20 disabled:opacity-50 transition-all"
                        >
                            {submitting ? 'Submitting...' : 'Submit Request'}
                            <Send className="w-3.5 h-3.5" />
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
