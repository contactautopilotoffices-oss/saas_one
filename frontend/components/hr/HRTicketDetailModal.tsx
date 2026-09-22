'use client';

import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, Send, Lock, Clock, AlertTriangle, ShieldCheck, ArrowUpRight, User, UserCheck, CheckCircle, CheckCheck, MessageSquare, Paperclip, ExternalLink } from 'lucide-react';
import SLALiveTimer from '@/frontend/components/hr/SLALiveTimer';
import { formatDateIN, formatDateTimeIN, formatDateTimeShortIN } from '@/frontend/lib/dateFormat';

function getInitials(name?: string | null): string {
    if (!name) return 'U';
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    return name.slice(0, 2).toUpperCase();
}

function getWhatsAppSenderColor(name?: string | null): string {
    const colors = [
        'text-sky-600 dark:text-[#53bdeb]',
        'text-emerald-600 dark:text-[#25d366]',
        'text-amber-600 dark:text-[#f59e0b]',
        'text-purple-600 dark:text-[#a855f7]',
        'text-pink-600 dark:text-[#ec4899]',
        'text-teal-600 dark:text-[#2dd4bf]',
        'text-indigo-600 dark:text-[#818cf8]',
        'text-cyan-600 dark:text-[#06b6d4]'
    ];
    let hash = 0;
    const str = name || '';
    for (let i = 0; i < str.length; i++) {
        hash = (hash << 5) - hash + str.charCodeAt(i);
        hash |= 0;
    }
    return colors[Math.abs(hash) % colors.length];
}

function formatWhatsAppTime(dateInput?: string | Date | null): string {
    if (!dateInput) return '';
    const date = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
    if (isNaN(date.getTime())) return '';
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

interface HRTicketDetailModalProps {
    isOpen: boolean;
    ticketId: string | null;
    initialTicket?: any;
    onClose: () => void;
    onRefresh: () => void;
    currentUserId: string;
    currentUserRole: string;
}

function TicketDetailSkeleton() {
    return (
        <div className="flex-1 flex flex-col md:flex-row overflow-hidden min-h-0 animate-pulse">
            {/* Left Main Section */}
            <div className="flex-1 flex flex-col gap-4 p-4 sm:p-6 overflow-y-auto min-h-0 border-r border-slate-100 dark:border-slate-800">
                {/* Badges & Meta Bar Skeleton */}
                <div className="flex flex-wrap items-center gap-2">
                    <div className="h-6 w-24 rounded-lg bg-slate-200 dark:bg-slate-800" />
                    <div className="h-6 w-36 rounded-lg bg-slate-200 dark:bg-slate-800" />
                    <div className="h-6 w-28 rounded-lg bg-slate-200 dark:bg-slate-800" />
                    <div className="h-6 w-28 rounded-lg bg-slate-200 dark:bg-slate-800" />
                    <div className="h-6 w-20 rounded-lg bg-slate-200 dark:bg-slate-800" />
                </div>

                {/* Horizontal Escalation Stepper Skeleton */}
                <div className="p-4 bg-slate-50/70 dark:bg-slate-800/40 border border-slate-200/80 dark:border-slate-700/80 rounded-2xl space-y-3 shadow-2xs">
                    <div className="flex items-center justify-between text-xs px-0.5">
                        <div className="h-3.5 w-48 bg-slate-200 dark:bg-slate-700 rounded" />
                        <div className="h-3.5 w-24 bg-slate-200 dark:bg-slate-700 rounded" />
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-0.5">
                        {[1, 2, 3, 4].map((lvl) => (
                            <div
                                key={lvl}
                                className="flex flex-col items-center justify-center p-2.5 sm:p-3 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 min-h-[78px] space-y-2"
                            >
                                <div className="h-3 w-12 bg-slate-200 dark:bg-slate-700 rounded" />
                                <div className="h-3.5 w-20 bg-slate-200 dark:bg-slate-700 rounded" />
                            </div>
                        ))}
                    </div>
                </div>

                {/* Ticket Description Card Skeleton */}
                <div className="p-4 bg-white dark:bg-slate-800/60 rounded-2xl border border-slate-200 dark:border-slate-700/80 space-y-3 shadow-2xs">
                    <div className="flex items-center justify-between">
                        <div className="h-3.5 w-32 bg-slate-200 dark:bg-slate-700 rounded" />
                        <div className="h-3 w-20 bg-slate-100 dark:bg-slate-800 rounded" />
                    </div>
                    <div className="space-y-2 pt-1">
                        <div className="h-3.5 w-full bg-slate-200 dark:bg-slate-700 rounded" />
                        <div className="h-3.5 w-11/12 bg-slate-200 dark:bg-slate-700 rounded" />
                        <div className="h-3.5 w-4/5 bg-slate-200 dark:bg-slate-700 rounded" />
                    </div>
                </div>

                {/* Discussion Thread & Tabs Skeleton */}
                <div className="space-y-3 pt-1">
                    <div className="flex gap-2">
                        <div className="h-8 w-32 bg-slate-200 dark:bg-slate-700 rounded-xl" />
                        <div className="h-8 w-24 bg-slate-100 dark:bg-slate-800 rounded-xl" />
                    </div>
                    <div className="space-y-3">
                        <div className="p-3.5 bg-white dark:bg-slate-800/80 rounded-2xl border border-slate-200 dark:border-slate-700 space-y-2">
                            <div className="flex items-center gap-2.5">
                                <div className="w-7 h-7 rounded-full bg-slate-200 dark:bg-slate-700 shrink-0" />
                                <div className="space-y-1 flex-1">
                                    <div className="h-3 w-28 bg-slate-200 dark:bg-slate-700 rounded" />
                                    <div className="h-2 w-16 bg-slate-100 dark:bg-slate-800 rounded" />
                                </div>
                            </div>
                            <div className="h-3 w-full bg-slate-100 dark:bg-slate-800 rounded" />
                            <div className="h-3 w-3/4 bg-slate-100 dark:bg-slate-800 rounded" />
                        </div>
                        <div className="p-3.5 bg-white dark:bg-slate-800/80 rounded-2xl border border-slate-200 dark:border-slate-700 space-y-2">
                            <div className="flex items-center gap-2.5">
                                <div className="w-7 h-7 rounded-full bg-slate-200 dark:bg-slate-700 shrink-0" />
                                <div className="space-y-1 flex-1">
                                    <div className="h-3 w-24 bg-slate-200 dark:bg-slate-700 rounded" />
                                    <div className="h-2 w-14 bg-slate-100 dark:bg-slate-800 rounded" />
                                </div>
                            </div>
                            <div className="h-3 w-5/6 bg-slate-100 dark:bg-slate-800 rounded" />
                        </div>
                    </div>
                </div>
            </div>

            {/* Right Sidebar Section */}
            <div className="w-full md:w-80 p-4 sm:p-6 bg-slate-50/50 dark:bg-slate-800/30 flex flex-col justify-between gap-6 overflow-y-auto shrink-0 border-t md:border-t-0 md:border-l border-slate-100 dark:border-slate-800">
                <div className="space-y-5">
                    {/* SLA / TAT Timer Skeleton */}
                    <div className="p-3.5 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 space-y-2.5 shadow-xs">
                        <div className="flex items-center justify-between">
                            <div className="h-2.5 w-10 bg-slate-200 dark:bg-slate-700 rounded" />
                            <div className="h-2.5 w-24 bg-slate-200 dark:bg-slate-700 rounded" />
                        </div>
                        <div className="h-10 w-full bg-slate-200 dark:bg-slate-700 rounded-xl" />
                        <div className="h-2.5 w-36 bg-slate-100 dark:bg-slate-800 rounded" />
                    </div>

                    {/* Assigned Handler Profile Skeleton */}
                    <div className="space-y-2.5">
                        <div className="flex items-center justify-between">
                            <div className="h-3 w-32 bg-slate-200 dark:bg-slate-700 rounded" />
                            <div className="h-4 w-12 bg-slate-200 dark:bg-slate-700 rounded-md" />
                        </div>
                        <div className="p-3.5 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm space-y-3">
                            <div className="flex items-center gap-3">
                                <div className="w-12 h-12 rounded-full bg-slate-200 dark:bg-slate-700 shrink-0" />
                                <div className="space-y-1.5 flex-1 min-w-0">
                                    <div className="h-3.5 w-28 bg-slate-200 dark:bg-slate-700 rounded" />
                                    <div className="h-2.5 w-20 bg-slate-100 dark:bg-slate-800 rounded" />
                                    <div className="h-2.5 w-16 bg-slate-100 dark:bg-slate-800 rounded" />
                                </div>
                            </div>
                            <div className="pt-2 border-t border-slate-100 dark:border-slate-700/60 grid grid-cols-2 gap-2">
                                {[1, 2, 3, 4].map(k => (
                                    <div key={k} className="p-2 bg-slate-50 dark:bg-slate-900/50 rounded-lg space-y-1">
                                        <div className="h-2 w-12 bg-slate-200 dark:bg-slate-700 rounded" />
                                        <div className="h-2.5 w-16 bg-slate-200 dark:bg-slate-700 rounded" />
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>

                    {/* Submitter Snapshot Skeleton */}
                    <div className="space-y-2.5">
                        <div className="h-3 w-28 bg-slate-200 dark:bg-slate-700 rounded" />
                        <div className="p-3 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 space-y-2.5">
                            <div className="grid grid-cols-2 gap-2">
                                <div className="space-y-1">
                                    <div className="h-2 w-16 bg-slate-200 dark:bg-slate-700 rounded" />
                                    <div className="h-3 w-20 bg-slate-200 dark:bg-slate-700 rounded" />
                                </div>
                                <div className="space-y-1">
                                    <div className="h-2 w-16 bg-slate-200 dark:bg-slate-700 rounded" />
                                    <div className="h-3 w-16 bg-slate-200 dark:bg-slate-700 rounded" />
                                </div>
                            </div>
                            <div className="space-y-1 pt-1 border-t border-slate-100 dark:border-slate-700/60">
                                <div className="h-2 w-20 bg-slate-200 dark:bg-slate-700 rounded" />
                                <div className="h-3 w-24 bg-slate-200 dark:bg-slate-700 rounded" />
                            </div>
                        </div>
                    </div>
                </div>

                {/* Actions Skeleton */}
                <div className="space-y-2 pt-2">
                    <div className="h-10 w-full rounded-2xl bg-slate-200 dark:bg-slate-700" />
                </div>
            </div>
        </div>
    );
}

export default function HRTicketDetailModal({ isOpen, ticketId, initialTicket, onClose, onRefresh, currentUserId, currentUserRole }: HRTicketDetailModalProps) {
    const [mounted, setMounted] = useState(false);
    const [ticket, setTicket] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [commentText, setCommentText] = useState('');
    const [isInternalNote, setIsInternalNote] = useState(false);
    const [submittingComment, setSubmittingComment] = useState(false);
    const [activeTab, setActiveTab] = useState<'discussion' | 'audit'>('discussion');
    const [resolutionNoteInput, setResolutionNoteInput] = useState('');
    const [showResolutionForm, setShowResolutionForm] = useState(false);

    const [replyAttachments, setReplyAttachments] = useState<string[]>([]);
    const [uploadingReplyFile, setUploadingReplyFile] = useState(false);

    useEffect(() => {
        setMounted(true);
    }, []);

    useEffect(() => {
        if (isOpen && ticketId) {
            if (initialTicket) {
                setTicket(initialTicket);
            }
            fetchTicketDetail();
        } else if (!isOpen) {
            setTicket(null);
            setCommentText('');
            setResolutionNoteInput('');
            setShowResolutionForm(false);
        }
    }, [isOpen, ticketId]);

    const fetchTicketDetail = async () => {
        setLoading(true);
        try {
            const res = await fetch(`/api/hr/tickets/${ticketId}?userId=${currentUserId || ''}&role=${currentUserRole || ''}`);
            const text = await res.text();
            let data: any = {};
            try { data = text ? JSON.parse(text) : {}; } catch {}
            if (data.success) {
                setTicket(data.data);
            }
        } catch (err) {
            console.error('Error fetching HR ticket detail:', err);
        } finally {
            setLoading(false);
        }
    };

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files;
        if (!files || files.length === 0) return;

        setUploadingReplyFile(true);
        try {
            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                const formData = new FormData();
                formData.append('file', file);

                const res = await fetch('/api/public/submit-guest-request', {
                    method: 'POST',
                    body: formData
                });
                const text = await res.text();
                let data: any = {};
                try { data = text ? JSON.parse(text) : {}; } catch {}
                if (data.success && data.file_url) {
                    setReplyAttachments(prev => [...prev, data.file_url]);
                }
            }
        } catch (err) {
            console.error('Error uploading reply attachment:', err);
        } finally {
            setUploadingReplyFile(false);
        }
    };

    const handleAddComment = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!commentText.trim() && replyAttachments.length === 0) return;

        setSubmittingComment(true);
        try {
            let finalContent = commentText.trim();
            if (replyAttachments.length > 0) {
                const attStr = replyAttachments.map((url, idx) => `📎 Attachment ${idx + 1}: ${url}`).join('\n');
                finalContent = finalContent ? `${finalContent}\n\n${attStr}` : attStr;
            }

            const res = await fetch(`/api/hr/tickets/${ticketId}/comments`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sender_user_id: currentUserId,
                    sender_name: '',
                    content: finalContent,
                    is_internal: isInternalNote
                })
            });
            const text = await res.text();
            let data: any = {};
            try { data = text ? JSON.parse(text) : {}; } catch {}
            if (data.success) {
                setCommentText('');
                setReplyAttachments([]);
                fetchTicketDetail();
            }
        } catch (err) {
            console.error('Error adding comment:', err);
        } finally {
            setSubmittingComment(false);
        }
    };

    const handleUpdateStatus = async (newStatus: string, escalate: boolean = false, resolutionNote?: string, action?: string) => {
        try {
            const res = await fetch(`/api/hr/tickets/${ticketId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    status: newStatus,
                    actor_user_id: currentUserId,
                    escalate,
                    resolution_note: resolutionNote,
                    resolved_by_user_id: currentUserId,
                    action
                })
            });
            const text = await res.text();
            let data: any = {};
            try { data = text ? JSON.parse(text) : {}; } catch {}
            if (data.success) {
                setShowResolutionForm(false);
                setResolutionNoteInput('');
                fetchTicketDetail();
                onRefresh();
            }
        } catch (err) {
            console.error('Error updating status:', err);
        }
    };

    if (!isOpen || !ticketId || !mounted) return null;

    const isAssignedToMe = Boolean(currentUserId && ticket?.assigned_to_user_id === currentUserId);
    const isRaisedByMe = Boolean(currentUserId && ticket?.raised_by_user_id === currentUserId);
    
    // Check if user is active authority for current level
    const normalizedRole = (currentUserRole || '').toLowerCase();
    const currentLvl = ticket?.current_level || 1;
    const isHrRole = ['hr', 'hr_head', 'hr_manager', 'hr_ops'].includes(normalizedRole);
    const isSuperAdmin = ['org_super_admin', 'master_admin', 'super_admin', 'ops_super_admin'].includes(normalizedRole);
    const isHandler = isAssignedToMe || (Array.isArray(ticket?.assigned_history) && ticket.assigned_history.includes(currentUserId));

    let canChangeStatus = isSuperAdmin || isAssignedToMe;
    if (!canChangeStatus) {
        if (currentLvl === 2 && (normalizedRole === 'hr' || normalizedRole === 'hr_head' || normalizedRole === 'hr_manager')) {
            canChangeStatus = true;
        } else if (currentLvl === 3 && (normalizedRole === 'hr' || normalizedRole === 'hr_head')) {
            canChangeStatus = true;
        } else if (currentLvl === 4 && normalizedRole === 'director') {
            canChangeStatus = true;
        }
    }

    // HR roles, Admins, and Handlers can ALWAYS add internal notes even if ticket is assigned to someone else
    const canAddInternalNote = isHrRole || isSuperAdmin || isHandler || canChangeStatus;

    const isTicketResolvedOrClosed = ticket?.status === 'resolved' || ticket?.status === 'closed' || ticket?.status === 'pending_acknowledgement';

    const getClosingDetails = () => {
        if (!ticket) return { levelNum: 1, levelLabel: 'Level 1', resolverName: 'HR Head' };
        const levelNum = ticket.current_level || 1;
        const levelLabel = `Level ${levelNum} (${ticket.level_owners?.[`l${levelNum}`] || 'HR Head'})`;
        const resolverName = ticket.resolved_by_user_id === ticket.assigned_to_user_id && ticket.assigned_to?.full_name
            ? ticket.assigned_to.full_name
            : (ticket.level_owners?.[`l${levelNum}`] || 'HR Head');
        return { levelNum, levelLabel, resolverName };
    };

    const getAuditActionBadge = (action: string) => {
        if (!action) return { bg: 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200', label: 'Action Logged' };
        const act = action.toUpperCase();
        if (act.includes('CREATED')) return { bg: 'bg-[#587e85]/10 text-[#587e85] dark:text-[#6c9a9e] border-[#587e85]/20', label: 'Ticket Created' };
        if (act.includes('ESCALATED')) return { bg: 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20', label: action };
        if (act.includes('RESOLVED')) return { bg: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20', label: 'Resolved' };
        if (act.includes('ACKNOWLEDGED')) return { bg: 'bg-teal-500/10 text-teal-700 dark:text-teal-400 border-teal-500/20', label: 'Acknowledged by Employee' };
        if (act.includes('REOPENED')) return { bg: 'bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-500/20', label: 'Reopened' };
        return { bg: 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200', label: action };
    };

    const renderAuditLogDetails = (log: any) => {
        const oldVals = log.old_values || {};
        const newVals = log.new_values || {};
        const details = log.details;

        const diffs: { label: string; oldVal?: string; newVal?: string; isText?: boolean }[] = [];

        const formatVal = (key: string, val: any) => {
            if (val === null || val === undefined) return 'None';
            if (typeof val === 'boolean') return val ? 'Yes' : 'No';
            if (typeof val === 'object') return JSON.stringify(val);
            const str = String(val);
            if (key === 'status') return str.replace('_', ' ').toUpperCase();
            if (key === 'priority') return str.toUpperCase();
            if (key === 'level' || key === 'current_level') return `Level ${str}`;
            return str;
        };

        // 1. Status change
        const oldStatus = oldVals.status;
        const newStatus = newVals.status;
        if (newStatus && oldStatus && oldStatus !== newStatus) {
            diffs.push({
                label: 'Status Changed',
                oldVal: formatVal('status', oldStatus),
                newVal: formatVal('status', newStatus)
            });
        } else if (newStatus && !oldStatus) {
            diffs.push({
                label: 'Status',
                newVal: formatVal('status', newStatus)
            });
        }

        // 2. Escalation level change
        const oldLevel = oldVals.level || oldVals.current_level;
        const newLevel = newVals.current_level || newVals.level;
        if (newLevel && oldLevel && String(oldLevel) !== String(newLevel)) {
            diffs.push({
                label: 'Escalation Level',
                oldVal: formatVal('level', oldLevel),
                newVal: formatVal('level', newLevel)
            });
        } else if (newLevel && !oldLevel) {
            diffs.push({
                label: 'Level',
                newVal: formatVal('level', newLevel)
            });
        }

        // 3. Comments / Reply snippet
        const commentContent = newVals.content_snippet || newVals.content || (typeof details === 'object' ? details?.content : null);
        if (commentContent) {
            diffs.push({
                label: newVals.is_internal ? 'Internal Note' : 'Reply',
                newVal: commentContent,
                isText: true
            });
        }

        // 4. Resolution Notes
        const resNotes = newVals.resolution_notes || (typeof details === 'object' ? details?.resolution_notes : null);
        if (resNotes) {
            diffs.push({
                label: 'Resolution Notes',
                newVal: resNotes,
                isText: true
            });
        }

        // 5. Rejection Reason
        if (newVals.rejection_reason) {
            diffs.push({
                label: 'Rejection Reason',
                newVal: newVals.rejection_reason,
                isText: true
            });
        }

        // 6. Generic diffs for other keys
        const ignoredKeys = [
            'status', 'level', 'current_level', 'content_snippet', 'content', 
            'is_internal', 'resolution_notes', 'rejection_reason', 'updated_at', 
            'ticket_id', 'id', 'ticket_number', 'sender_name', 'employee_snapshot', 
            'assigned_history'
        ];

        Object.keys(newVals).forEach(key => {
            if (ignoredKeys.includes(key)) return;
            const oVal = oldVals[key];
            const nVal = newVals[key];
            if (oVal !== undefined && oVal !== nVal) {
                diffs.push({
                    label: key.replace(/_/g, ' '),
                    oldVal: formatVal(key, oVal),
                    newVal: formatVal(key, nVal)
                });
            } else if (oVal === undefined && nVal !== undefined) {
                diffs.push({
                    label: key.replace(/_/g, ' '),
                    newVal: formatVal(key, nVal)
                });
            }
        });

        // Fallback for raw details string/json if no diffs array generated
        if (diffs.length === 0 && details) {
            return (
                <div className="p-2.5 bg-slate-50 dark:bg-slate-900/60 rounded-xl text-[10.5px] font-medium text-slate-600 dark:text-slate-400 space-y-1 border border-slate-100 dark:border-slate-800">
                    {typeof details === 'string' ? details : JSON.stringify(details)}
                </div>
            );
        }

        if (diffs.length === 0) return null;

        return (
            <div className="p-2.5 bg-slate-50 dark:bg-slate-900/60 rounded-xl text-[11px] font-medium text-slate-700 dark:text-slate-300 space-y-1.5 border border-slate-200/80 dark:border-slate-800/80">
                {diffs.map((diff, idx) => (
                    <div key={idx} className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2">
                        <span className="font-bold text-slate-500 dark:text-slate-400 capitalize text-[10px] tracking-wide shrink-0">
                            {diff.label}:
                        </span>
                        {diff.isText ? (
                            <span className="italic text-slate-800 dark:text-slate-200 bg-white dark:bg-slate-800 px-2 py-1 rounded border border-slate-200 dark:border-slate-700 text-[10.5px] break-words">
                                "{diff.newVal}"
                            </span>
                        ) : diff.oldVal ? (
                            <div className="flex items-center gap-1.5 font-semibold text-[10.5px] flex-wrap">
                                <span className="px-1.5 py-0.5 rounded bg-slate-200/80 dark:bg-slate-700/80 text-slate-600 dark:text-slate-300 line-through decoration-slate-400">
                                    {diff.oldVal}
                                </span>
                                <span className="text-slate-400 font-bold">➔</span>
                                <span className="px-1.5 py-0.5 rounded bg-[#587e85]/15 text-[#587e85] dark:text-[#6c9a9e] border border-[#587e85]/30 font-bold">
                                    {diff.newVal}
                                </span>
                            </div>
                        ) : (
                            <span className="px-1.5 py-0.5 rounded bg-[#587e85]/15 text-[#587e85] dark:text-[#6c9a9e] border border-[#587e85]/30 font-bold text-[10.5px]">
                                {diff.newVal}
                            </span>
                        )}
                    </div>
                ))}
            </div>
        );
    };

    const modalContent = (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-2 sm:p-4">
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl sm:rounded-3xl shadow-2xl w-full max-w-4xl max-h-[92vh] sm:max-h-[88vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200 my-auto">
                {/* Header */}
                <div className="shrink-0 flex items-center justify-between px-4 sm:px-6 py-3.5 sm:py-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/50">
                    <div className="flex items-center gap-2 sm:gap-3 min-w-0 pr-2">
                        {ticket?.ticket_number ? (
                            <span className="px-2.5 py-1 bg-[#587e85]/10 text-[#587e85] dark:text-[#6c9a9e] font-mono text-xs font-black rounded-lg border border-[#587e85]/20 shrink-0">
                                {ticket.ticket_number}
                            </span>
                        ) : (
                            <div className="h-6 w-24 bg-slate-200 dark:bg-slate-700 rounded-lg animate-pulse shrink-0" />
                        )}
                        {ticket?.subject ? (
                            <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white truncate">
                                {ticket.subject}
                            </h2>
                        ) : (
                            <div className="h-6 w-48 sm:w-72 bg-slate-200 dark:bg-slate-700 rounded-lg animate-pulse" />
                        )}
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-white rounded-lg transition-colors shrink-0"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {loading && !ticket ? (
                    <TicketDetailSkeleton />
                ) : !ticket ? (
                    <div className="flex-1 flex items-center justify-center py-16 text-xs text-red-500 font-medium">
                        Failed to load ticket information.
                    </div>
                ) : (
                    <div className="flex-1 flex flex-col md:flex-row overflow-hidden min-h-0">
                        {/* Left Main Section: Context, Attachments & Discussion Thread */}
                        <div className="flex-1 flex flex-col gap-4 p-4 sm:p-6 overflow-y-auto min-h-0 border-r border-slate-100 dark:border-slate-800">
                            {/* Badges & Meta Bar */}
                            <div className="flex flex-wrap items-center gap-2">
                                <span className="px-2.5 py-1 bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/20 text-[11px] font-black rounded-lg uppercase tracking-wider">
                                    🛡️ {(ticket.ticket_type || 'Grievance').replace('_', ' ')}
                                </span>
                                {(() => {
                                    const catName = ticket.category?.category_name || ticket.category_name || ticket.category?.name || (typeof ticket.category === 'string' ? ticket.category : null);
                                    const subCatName = ticket.category?.sub_category_name || ticket.sub_category_name;
                                    const displayCategory = catName ? (subCatName ? `${catName} (${subCatName})` : catName) : null;
                                    if (!displayCategory) return null;
                                    return (
                                        <span className="px-2.5 py-1 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 text-[11px] font-semibold rounded-lg">
                                            Category: {displayCategory}
                                        </span>
                                    );
                                })()}
                                <span className={`px-2.5 py-1 text-[11px] font-black rounded-lg uppercase tracking-wider inline-flex items-center gap-1.5 ${
                                     ticket.status === 'closed'
                                         ? 'bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300 border border-emerald-300'
                                         : ticket.status === 'pending_acknowledgement' || ticket.status === 'resolved'
                                         ? 'bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300 border border-amber-300'
                                         : ticket.status === 'in_progress'
                                         ? 'bg-blue-100 dark:bg-blue-950 text-blue-800 dark:text-blue-300 border border-blue-300'
                                         : ticket.status === 'escalated'
                                         ? 'bg-purple-100 dark:bg-purple-950/80 text-purple-800 dark:text-purple-200 border border-purple-300 font-extrabold'
                                         : 'bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 border border-indigo-200'
                                 }`}>
                                     {ticket.status === 'escalated' && <span className="w-1.5 h-1.5 rounded-full bg-purple-600 dark:bg-purple-400 animate-pulse" />}
                                     Status: {ticket.status === 'pending_acknowledgement' ? 'PENDING ACKNOWLEDGEMENT' : ticket.status === 'escalated' ? `ESCALATED (L${ticket.current_level})` : ticket.status?.replace(/_/g, ' ')}
                                 </span>
                                <span className="px-2.5 py-1 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 border border-indigo-500/20 text-[11px] font-extrabold rounded-lg uppercase tracking-wider flex items-center gap-1">
                                    <ShieldCheck className="w-3.5 h-3.5 text-indigo-600" />
                                    Escalation Level {ticket.current_level || 1}
                                </span>
                                <span className={`px-2.5 py-1 text-[11px] font-bold rounded-lg uppercase tracking-wider ${
                                    ticket.priority === 'urgent'
                                        ? 'bg-rose-500/10 text-rose-700 border border-rose-500/20'
                                        : ticket.priority === 'high'
                                        ? 'bg-amber-500/10 text-amber-700 border border-amber-500/20'
                                        : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200'
                                }`}>
                                    Priority: {ticket.priority || 'Medium'}
                                </span>
                            </div>

                            {/* Horizontal Escalation Process Line / Pill Nodes Stepper */}
                            {(() => {
                                const curLvl = ticket.current_level || 1;
                                const steps: Array<{ level: number; label: string; assignee: string }> = ticket.escalation_flow || [
                                    { level: 1, label: 'Level 1', assignee: ticket.level_owners?.l1 || ticket.employee_snapshot?.manager_name || 'Manager' },
                                    { level: 2, label: 'Level 2', assignee: ticket.level_owners?.l2 || 'HR Ops' },
                                    { level: 3, label: 'Level 3', assignee: ticket.level_owners?.l3 || 'HR Head' },
                                    { level: 4, label: 'Level 4', assignee: ticket.level_owners?.l4 || (curLvl === 4 && ticket.assigned_to?.full_name ? ticket.assigned_to.full_name : 'Director') },
                                ];
                                const maxLvl = steps.length;

                                return (
                                    <div className="p-4 bg-slate-50/70 dark:bg-slate-800/40 border border-slate-200/80 dark:border-slate-700/80 rounded-2xl space-y-3 shadow-2xs">
                                        <div className="flex items-center justify-between text-xs px-0.5">
                                            <span className="uppercase tracking-wider text-[11px] font-black text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                                                <ShieldCheck className="w-4 h-4 text-[#587e85]" />
                                                ESCALATION HIERARCHY & LEVEL OWNERS
                                            </span>
                                            <span className="text-xs font-black text-[#486b72] dark:text-[#6c9a9e]">
                                                Level {curLvl} of {maxLvl} Active
                                            </span>
                                        </div>

                                        {/* Pill Nodes Cards matching screenshot */}
                                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-0.5">
                                            {steps.map((step, idx) => {
                                                const lvlNum = step.level || (idx + 1);
                                                const isPassed = lvlNum < curLvl;
                                                const isActive = lvlNum === curLvl;

                                                return (
                                                    <div
                                                        key={lvlNum}
                                                        className={`flex flex-col items-center justify-center p-2.5 sm:p-3 rounded-2xl border text-center transition-all duration-200 min-h-[78px] ${
                                                            isActive
                                                                ? 'bg-[#486b72] dark:bg-[#486b72] text-white border-[#486b72] shadow-md shadow-[#486b72]/20 ring-2 ring-[#486b72]/30'
                                                                : isPassed
                                                                ? 'bg-emerald-50/90 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-300 border-emerald-300/80 dark:border-emerald-800/80'
                                                                : 'bg-white dark:bg-slate-900 text-slate-400 dark:text-slate-500 border-slate-200 dark:border-slate-800'
                                                        }`}
                                                    >
                                                        <div className={`text-[11px] font-extrabold uppercase tracking-wide ${
                                                            isActive
                                                                ? 'text-white/90'
                                                                : isPassed
                                                                ? 'text-emerald-700 dark:text-emerald-400'
                                                                : 'text-slate-400 dark:text-slate-500'
                                                        }`}>
                                                            {`Level ${lvlNum}`}
                                                        </div>
                                                        <div 
                                                            title={step.assignee}
                                                            className={`text-[10.5px] sm:text-[11px] leading-snug font-extrabold mt-1 max-w-full break-words px-0.5 ${
                                                                isActive
                                                                    ? 'text-white'
                                                                    : isPassed
                                                                    ? 'text-emerald-800 dark:text-emerald-300'
                                                                    : 'text-slate-600 dark:text-slate-400'
                                                            }`}
                                                        >
                                                            {step.assignee || `Level ${lvlNum}`}
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                );
                            })()}

                            {/* Confidential / Anonymous Flags */}
                            {(ticket.is_confidential || ticket.is_anonymous) && (
                                <div className="p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/60 rounded-xl text-xs space-y-1">
                                    <div className="font-extrabold text-amber-800 dark:text-amber-300 flex items-center gap-1.5">
                                        <Lock className="w-3.5 h-3.5" />
                                        {ticket.is_anonymous ? 'Anonymous Employee Submission' : 'Confidential Feedback'}
                                    </div>
                                    <p className="text-[11px] text-amber-700 dark:text-amber-400">
                                        {ticket.is_anonymous
                                            ? 'Employee identity has been masked for anonymity.'
                                            : 'Access restricted to authorized HR Head & Director level.'}
                                    </p>
                                </div>
                            )}

                            {/* Ticket Description */}
                            <div className="space-y-2">
                                <h3 className="text-xs font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wider">
                                    Description & Context
                                </h3>
                                <div className="p-4 bg-white dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/60 rounded-xl text-xs text-slate-700 dark:text-slate-300 leading-relaxed whitespace-pre-wrap">
                                    {ticket.description}
                                </div>
                            </div>

                            {/* Attached Documents & Screenshots */}
                            {ticket.attachment_urls && ticket.attachment_urls.length > 0 && (
                                <div className="space-y-2">
                                    <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
                                        <Paperclip className="w-3.5 h-3.5 text-[#587e85]" />
                                        Attached Documents & Screenshots ({ticket.attachment_urls.length})
                                    </h4>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                        {ticket.attachment_urls.map((url: string, idx: number) => {
                                            const isImage = /\.(jpg|jpeg|png|webp|gif|svg)(\?.*)?$/i.test(url);
                                            const fileName = url.split('/').pop()?.split('_').slice(2).join('_') || url.split('/').pop() || `Attachment ${idx + 1}`;

                                            return (
                                                <a
                                                    key={idx}
                                                    href={url}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="flex items-center gap-2.5 p-2.5 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-all group shadow-2xs"
                                                >
                                                    {isImage ? (
                                                        <div className="w-9 h-9 rounded-lg overflow-hidden bg-slate-200 shrink-0 border border-slate-300 dark:border-slate-700">
                                                            <img src={url} alt={fileName} className="w-full h-full object-cover" />
                                                        </div>
                                                    ) : (
                                                        <div className="w-9 h-9 rounded-lg bg-teal-50 dark:bg-teal-950/60 border border-teal-200 dark:border-teal-800 flex items-center justify-center shrink-0">
                                                            <Paperclip className="w-4 h-4 text-[#587e85]" />
                                                        </div>
                                                    )}
                                                    <div className="min-w-0 flex-1">
                                                        <p className="text-xs font-bold text-slate-800 dark:text-slate-200 truncate group-hover:text-[#587e85] transition-colors">
                                                            {fileName}
                                                        </p>
                                                        <p className="text-[10px] text-slate-400 font-medium">Click to view / download</p>
                                                    </div>
                                                    <ExternalLink className="w-3.5 h-3.5 text-slate-400 group-hover:text-[#587e85] shrink-0" />
                                                </a>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}

                            {/* Discussion & Audit Tabs */}
                            <div className="flex-1 flex flex-col gap-3 min-h-[280px]">
                                <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-2">
                                    <div className="flex gap-4">
                                        <button
                                            onClick={() => setActiveTab('discussion')}
                                            className={`text-xs font-bold pb-1 transition-all ${
                                                activeTab === 'discussion'
                                                    ? 'text-[#587e85] border-b-2 border-[#587e85] dark:text-[#6c9a9e]'
                                                    : 'text-slate-400 hover:text-slate-600'
                                            }`}
                                        >
                                            Conversation Thread ({ticket.comments?.length || 0})
                                        </button>
                                        <button
                                            onClick={() => setActiveTab('audit')}
                                            className={`text-xs font-bold pb-1 transition-all ${
                                                activeTab === 'audit'
                                                    ? 'text-[#587e85] border-b-2 border-[#587e85] dark:text-[#6c9a9e]'
                                                    : 'text-slate-400 hover:text-slate-600'
                                            }`}
                                        >
                                            Audit History ({ticket.audit_logs?.length || 0})
                                        </button>
                                    </div>
                                </div>

                                {activeTab === 'discussion' ? (
                                    <div className="flex-1 flex flex-col justify-between gap-3 min-h-[250px]">
                                        {/* WhatsApp Chat Area */}
                                        <div className="space-y-3 max-h-[340px] overflow-y-auto pr-1.5 p-3 rounded-2xl bg-[#efeae2]/60 dark:bg-[#0b141a] border border-slate-200/80 dark:border-slate-800/90 shadow-inner">
                                            {ticket.comments?.length === 0 ? (
                                                <div className="text-center py-8 space-y-1">
                                                    <MessageSquare className="w-8 h-8 text-slate-300 dark:text-slate-600 mx-auto" />
                                                    <p className="text-xs text-slate-400 font-medium">No messages yet in this conversation.</p>
                                                </div>
                                            ) : (
                                                ticket.comments?.map((comment: any) => {
                                                    const isMe = currentUserId && comment.sender_user_id === currentUserId;
                                                    const isInternal = comment.is_internal;

                                                    // Strictly hide internal notes from the creator/submitter unless they are an assigned handler or super admin
                                                    const isSubmitter = currentUserId && ticket.raised_by_user_id === currentUserId;
                                                    const isAssignedHandler = currentUserId && (ticket.assigned_to_user_id === currentUserId || (Array.isArray(ticket.assigned_history) && ticket.assigned_history.includes(currentUserId)));
                                                    const isSuperAdmin = ['org_super_admin', 'master_admin', 'super_admin'].includes((currentUserRole || '').toLowerCase());
                                                    if (isInternal && isSubmitter && !isAssignedHandler && !isSuperAdmin) {
                                                        return null;
                                                    }

                                                    let senderDisplayName = comment.sender_name;
                                                    let senderPhoto = comment.sender?.user_photo_url || null;
                                                    let isAnonymousSender = false;

                                                    if (comment.sender_user_id && comment.sender_user_id === ticket.raised_by_user_id) {
                                                        if (ticket.is_anonymous) {
                                                            senderDisplayName = 'Anonymous Employee';
                                                            senderPhoto = null;
                                                            isAnonymousSender = true;
                                                        } else {
                                                            senderDisplayName = ticket.employee_snapshot?.name || ticket.raised_by?.full_name || comment.sender?.full_name || ticket.raised_by?.email || 'Employee';
                                                            senderPhoto = senderPhoto || ticket.submitter_details?.photo_url || ticket.raised_by?.user_photo_url || null;
                                                        }
                                                    } else if (comment.sender_user_id && comment.sender_user_id === ticket.assigned_to_user_id) {
                                                        senderDisplayName = ticket.assigned_to_details?.full_name || ticket.assigned_to?.full_name || comment.sender?.full_name || 'Assigned Handler';
                                                        senderPhoto = senderPhoto || ticket.assigned_to_details?.photo_url || ticket.assigned_to?.user_photo_url || null;
                                                    } else if (!senderDisplayName || senderDisplayName === 'Handler / Support' || senderDisplayName === 'System User') {
                                                        senderDisplayName = comment.sender?.full_name || ticket.assigned_to?.full_name || ticket.assigned_to_details?.full_name || 'Handler / Support';
                                                        senderPhoto = senderPhoto || comment.sender?.user_photo_url || null;
                                                    }

                                                    const senderColor = getWhatsAppSenderColor(senderDisplayName);

                                                    if (isInternal) {
                                                        return (
                                                            <div key={comment.id} className="p-3 bg-amber-50/90 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/80 rounded-2xl text-xs space-y-1.5 shadow-2xs">
                                                                <div className="flex items-center justify-between font-bold text-amber-800 dark:text-amber-300 text-[11px]">
                                                                    <span className="flex items-center gap-1.5">
                                                                        <Lock className="w-3.5 h-3.5 text-amber-600" />
                                                                        Internal Note • {senderDisplayName}
                                                                    </span>
                                                                    <span className="text-[10px] text-amber-600/75 dark:text-amber-400/75 font-normal">
                                                                        {formatWhatsAppTime(comment.created_at)}
                                                                    </span>
                                                                </div>
                                                                <p className="text-amber-950 dark:text-amber-100 font-medium whitespace-pre-wrap text-[12.5px] leading-relaxed">
                                                                    {comment.content}
                                                                </p>
                                                            </div>
                                                        );
                                                    }

                                                    return (
                                                        <div
                                                            key={comment.id}
                                                            className={`flex items-start gap-2 ${isMe ? 'justify-end' : 'justify-start'}`}
                                                        >
                                                            {/* WhatsApp Group Avatar (for other group members) */}
                                                            {!isMe && (
                                                                <div className="shrink-0 mt-0.5">
                                                                    {isAnonymousSender ? (
                                                                        <div className="w-8 h-8 rounded-full bg-amber-100 dark:bg-amber-950/60 border border-amber-300 dark:border-amber-800 text-amber-700 dark:text-amber-300 flex items-center justify-center shadow-xs">
                                                                            <Lock className="w-3.5 h-3.5" />
                                                                        </div>
                                                                    ) : senderPhoto ? (
                                                                        <div className="w-8 h-8 rounded-full overflow-hidden border border-slate-200 dark:border-slate-700 shadow-xs bg-slate-100 dark:bg-slate-800">
                                                                            <img
                                                                                src={senderPhoto}
                                                                                alt={senderDisplayName}
                                                                                referrerPolicy="no-referrer"
                                                                                onError={(e) => {
                                                                                    e.currentTarget.classList.add('!hidden');
                                                                                    const fb = e.currentTarget.nextElementSibling as HTMLElement;
                                                                                    if (fb) fb.classList.remove('!hidden');
                                                                                }}
                                                                                className="w-full h-full object-cover"
                                                                            />
                                                                            <div className="!hidden w-full h-full bg-[#182229] border border-slate-700/60 text-[#53bdeb] flex items-center justify-center font-bold text-xs">
                                                                                {getInitials(senderDisplayName)}
                                                                            </div>
                                                                        </div>
                                                                    ) : (
                                                                        <div className="w-8 h-8 rounded-full bg-[#182229] border border-slate-700/60 text-[#53bdeb] flex items-center justify-center font-bold text-xs shadow-xs">
                                                                            {getInitials(senderDisplayName)}
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            )}

                                                            {/* WhatsApp Message Bubble */}
                                                            <div
                                                                className={`relative max-w-[85%] sm:max-w-[75%] px-3.5 py-1.5 shadow-sm text-xs ${
                                                                    isMe
                                                                        ? 'bg-[#d9fdd3] dark:bg-[#005c4b] text-[#111b21] dark:text-[#e9edef] rounded-2xl rounded-tr-xs border border-[#bbf7d0] dark:border-[#025c4b]'
                                                                        : 'bg-white dark:bg-[#202c33] text-[#111b21] dark:text-[#e9edef] rounded-2xl rounded-tl-xs border border-slate-200/70 dark:border-[#2a3942]'
                                                                }`}
                                                            >
                                                                {/* WhatsApp Speech Bubble Tail */}
                                                                {isMe ? (
                                                                    <svg viewBox="0 0 8 13" height="13" width="8" className="absolute -right-[7px] top-0 text-[#d9fdd3] dark:text-[#005c4b] fill-current pointer-events-none">
                                                                        <path d="M6.467 3.568L0 0v13l6.467-9.432z" />
                                                                    </svg>
                                                                ) : (
                                                                    <svg viewBox="0 0 8 13" height="13" width="8" className="absolute -left-[7px] top-0 text-white dark:text-[#202c33] fill-current pointer-events-none">
                                                                        <path d="M1.533 3.568L8 0v13L1.533 3.568z" />
                                                                    </svg>
                                                                )}

                                                                {/* Sender Name in distinct WhatsApp group colors */}
                                                                {!isMe && (
                                                                    <div className={`text-[12px] font-bold tracking-tight mb-0.5 select-none ${senderColor}`}>
                                                                        {senderDisplayName}
                                                                    </div>
                                                                )}

                                                                {/* Message Content & Inline/Float Timestamp */}
                                                                <div className="leading-snug whitespace-pre-wrap select-text text-[13px] font-normal break-words">
                                                                    {comment.content}

                                                                    {/* Timestamp & Double Checkmark */}
                                                                    <span className="inline-flex items-center gap-1 float-right ml-3 mt-1.5 select-none shrink-0 align-bottom">
                                                                        <span className={`text-[10px] font-medium ${isMe ? 'text-emerald-800/80 dark:text-emerald-200/80' : 'text-slate-400 dark:text-[#8696a0]'}`}>
                                                                            {formatWhatsAppTime(comment.created_at)}
                                                                        </span>
                                                                        {isMe && (
                                                                            <CheckCheck className="w-3.5 h-3.5 text-[#53bdeb] shrink-0 inline" />
                                                                        )}
                                                                    </span>
                                                                </div>

                                                                {/* Attachments if any */}
                                                                {Array.isArray(comment.attachment_urls) && comment.attachment_urls.length > 0 && (
                                                                    <div className="mt-2 space-y-1 pt-1.5 border-t border-black/5 dark:border-white/5 clear-both">
                                                                        {comment.attachment_urls.map((attUrl: string, attIdx: number) => {
                                                                            const isImg = /\.(jpg|jpeg|png|webp|gif)$/i.test(attUrl);
                                                                            return isImg ? (
                                                                                <a
                                                                                    key={attIdx}
                                                                                    href={attUrl}
                                                                                    target="_blank"
                                                                                    rel="noreferrer"
                                                                                    className="block rounded-lg overflow-hidden border border-black/10 dark:border-white/10 max-w-[220px] hover:opacity-90 transition-opacity"
                                                                                >
                                                                                    <img src={attUrl} alt="attachment" referrerPolicy="no-referrer" className="w-full h-auto max-h-[160px] object-cover" />
                                                                                </a>
                                                                            ) : (
                                                                                <a
                                                                                    key={attIdx}
                                                                                    href={attUrl}
                                                                                    target="_blank"
                                                                                    rel="noreferrer"
                                                                                    className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-black/5 dark:bg-white/5 rounded-lg text-[11px] font-medium hover:underline"
                                                                                >
                                                                                    <Paperclip className="w-3 h-3 text-[#587e85]" />
                                                                                    <span className="truncate max-w-[160px]">{attUrl.split('/').pop()}</span>
                                                                                </a>
                                                                            );
                                                                        })}
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </div>
                                                    );
                                                })
                                            )}
                                        </div>

                                        {/* Reply / Comment Box */}
                                        {!isTicketResolvedOrClosed ? (
                                            <form onSubmit={handleAddComment} className="space-y-2 pt-2 border-t border-slate-200 dark:border-slate-800">
                                                {replyAttachments.length > 0 && (
                                                    <div className="flex flex-wrap gap-2">
                                                        {replyAttachments.map((url, idx) => (
                                                            <span key={idx} className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-teal-50 dark:bg-teal-950/40 border border-teal-200 dark:border-teal-800 text-teal-800 dark:text-teal-300 rounded-lg text-[11px] font-medium">
                                                                <Paperclip className="w-3 h-3 text-[#587e85]" />
                                                                <span className="max-w-[150px] truncate">{url.split('/').pop()}</span>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => setReplyAttachments(replyAttachments.filter((_, i) => i !== idx))}
                                                                    className="text-slate-400 hover:text-red-500 ml-1 text-xs"
                                                                >
                                                                    ×
                                                                </button>
                                                            </span>
                                                        ))}
                                                    </div>
                                                )}

                                                <div className="flex gap-2">
                                                    <div className="flex-1 relative">
                                                        <textarea
                                                            rows={2}
                                                            value={commentText}
                                                            onChange={(e) => setCommentText(e.target.value)}
                                                            placeholder={isInternalNote ? "Write an internal handler note (visible to HR staff only)..." : "Write a reply message..."}
                                                            className="w-full p-2.5 pr-8 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-[#587e85] resize-none font-medium"
                                                        />
                                                        <label className="absolute right-2.5 bottom-3.5 text-slate-400 hover:text-[#587e85] cursor-pointer">
                                                            <Paperclip className="w-4 h-4" />
                                                            <input
                                                                type="file"
                                                                multiple
                                                                onChange={handleFileUpload}
                                                                disabled={uploadingReplyFile}
                                                                className="hidden"
                                                            />
                                                        </label>
                                                    </div>
                                                </div>

                                                <div className="flex items-center justify-between">
                                                    {canAddInternalNote ? (
                                                        <label className="flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-400 font-semibold cursor-pointer select-none">
                                                            <input
                                                                type="checkbox"
                                                                checked={isInternalNote}
                                                                onChange={(e) => setIsInternalNote(e.target.checked)}
                                                                className="rounded border-amber-300 text-amber-600 focus:ring-amber-500 cursor-pointer"
                                                            />
                                                            <span>🔒 Internal Note (HR Only)</span>
                                                        </label>
                                                    ) : <div />}

                                                    <button
                                                        type="submit"
                                                        disabled={submittingComment || uploadingReplyFile}
                                                        className="px-4 py-2 bg-[#587e85] hover:bg-[#48686e] text-white rounded-xl text-xs font-bold disabled:opacity-50 transition-all flex items-center justify-center gap-1.5 shadow-md shadow-[#587e85]/20"
                                                    >
                                                        <Send className="w-3.5 h-3.5" />
                                                        Send
                                                    </button>
                                                </div>
                                            </form>
                                        ) : (
                                            <div className="mt-auto p-3 bg-emerald-50 dark:bg-emerald-950/40 rounded-2xl border border-emerald-200 dark:border-emerald-800 text-center text-[11px] font-bold text-emerald-800 dark:text-emerald-300 flex items-center justify-center gap-1.5">
                                                <CheckCircle className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                                                {isRaisedByMe
                                                    ? 'Ticket Resolved — Confirm resolution below or reopen if issue persists.'
                                                    : `Ticket Resolved & Closed — Completed at Level ${ticket.current_level} (${getClosingDetails().resolverName})`
                                                }
                                            </div>
                                        )}
                                    </div>
                                ) : (
                                    <div className="relative pl-6 space-y-4 max-h-[360px] overflow-y-auto pr-2 pt-1">
                                        {/* Continuous Vertical Timeline Line */}
                                        <div className="absolute left-2.5 top-2 bottom-4 w-0.5 bg-slate-200 dark:bg-slate-800" />

                                        {!ticket.audit_logs || ticket.audit_logs.length === 0 ? (
                                            <div className="text-center py-8 text-xs text-slate-400 font-medium">
                                                No audit history entries recorded yet.
                                            </div>
                                        ) : (
                                            ticket.audit_logs.map((log: any) => {
                                                const badge = getAuditActionBadge(log.action);
                                                const actorPhoto = log.actor?.user_photo_url || log.actor?.avatar_url || log.actor?.raw_user_meta_data?.user_photo_url;
                                                const actorName = log.actor?.full_name || log.actor?.email || 'System / Auto';

                                                return (
                                                    <div key={log.id} className="relative flex items-start gap-3 group">
                                                        {/* Node Dot / Circle Badge on Line */}
                                                        <div className="absolute -left-6 top-1.5 w-5 h-5 rounded-full bg-white dark:bg-slate-900 border-2 border-[#587e85] flex items-center justify-center shadow-xs z-10">
                                                            <div className="w-2 h-2 rounded-full bg-[#587e85]" />
                                                        </div>

                                                        <div className="flex-1 p-3.5 bg-white dark:bg-slate-800/90 border border-slate-200 dark:border-slate-700/80 rounded-2xl text-xs space-y-2 shadow-xs group-hover:border-[#587e85]/50 transition-colors">
                                                            <div className="flex items-center justify-between gap-2">
                                                                <span className={`px-2.5 py-0.5 border text-[10px] font-black rounded-lg uppercase tracking-wider ${badge.bg}`}>
                                                                    {badge.label}
                                                                </span>
                                                                <span className="text-[10px] font-medium text-slate-400 font-mono">
                                                                    {formatDateTimeShortIN(log.created_at)}
                                                                </span>
                                                            </div>

                                                            {/* Actor Info with Circle Monogram */}
                                                            <div className="flex items-center gap-2 pt-1 border-t border-slate-100 dark:border-slate-700/50">
                                                                <div className="w-5 h-5 rounded-full overflow-hidden bg-slate-200 dark:bg-slate-700 flex items-center justify-center shrink-0 text-[9px] font-bold text-slate-600 dark:text-slate-300">
                                                                    {actorPhoto ? (
                                                                        <img src={actorPhoto} alt={actorName} className="w-full h-full object-cover" />
                                                                    ) : (
                                                                        actorName[0]?.toUpperCase()
                                                                    )}
                                                                </div>
                                                                <span className="text-[11px] text-slate-600 dark:text-slate-300 font-semibold">
                                                                    Actor: <strong className="text-slate-900 dark:text-white font-bold">{actorName}</strong>
                                                                </span>
                                                            </div>

                                                            {/* Detailed Diffs and Changes */}
                                                            {renderAuditLogDetails(log)}
                                                        </div>
                                                    </div>
                                                );
                                            })
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Right Sidebar Section: SLA Timer, Assigned Handler Circle Profile, Employee Snapshot & Lifecycle Actions */}
                        <div className="w-full md:w-80 p-4 sm:p-6 bg-slate-50/50 dark:bg-slate-800/30 flex flex-col justify-between gap-6 overflow-y-auto shrink-0">
                            <div className="space-y-6">
                                {/* SLA / TAT Timer */}
                                <div className="p-3.5 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 space-y-2 shadow-xs">
                                    <div className="flex items-center justify-between">
                                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                                            TAT
                                        </span>
                                        {ticket.sla_due_at && (
                                            <span className="text-[10px] text-slate-400 font-mono">
                                                Due: {formatDateIN(ticket.sla_due_at)}
                                            </span>
                                        )}
                                    </div>
                                    <div>
                                        <SLALiveTimer slaDueAt={ticket.sla_due_at} status={ticket.status} />
                                    </div>
                                    <div className="text-[10px] text-slate-400">
                                        Real-time Turnaround Time (TAT) countdown active
                                    </div>
                                </div>

                                {/* Assigned Handler Circle Profile Card (Instagram/WhatsApp style) */}
                                <div className="space-y-3">
                                    <div className="flex items-center justify-between">
                                        <h4 className="text-xs font-black text-slate-800 dark:text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
                                            <UserCheck className="w-3.5 h-3.5 text-[#587e85]" />
                                            Assigned Handler Profile
                                        </h4>
                                        <span className="px-2 py-0.5 text-[9px] font-black uppercase tracking-wider bg-teal-500/10 text-teal-600 dark:text-teal-400 border border-teal-500/20 rounded-md">
                                            Level {ticket.current_level || 1}
                                        </span>
                                    </div>

                                    <div className="p-3.5 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm space-y-3">
                                        {/* Instagram/WhatsApp Circle Profile UI */}
                                        <div className="flex items-center gap-3">
                                            <div className="relative shrink-0">
                                                {/* Story Gradient Ring */}
                                                <div className="p-[2.5px] bg-gradient-to-tr from-amber-500 via-[#587e85] to-teal-500 rounded-full shadow-md transition-transform duration-300 hover:scale-105">
                                                    <div className="w-12 h-12 rounded-full overflow-hidden bg-slate-100 dark:bg-slate-900 border-2 border-white dark:border-slate-800 flex items-center justify-center">
                                                        {ticket.assigned_to_details?.photo_url || ticket.assigned_to?.user_photo_url || ticket.assigned_to?.avatar_url ? (
                                                            <>
                                                                <img
                                                                    src={ticket.assigned_to_details?.photo_url || ticket.assigned_to?.user_photo_url || ticket.assigned_to?.avatar_url}
                                                                    alt={ticket.assigned_to_details?.full_name || ticket.assigned_to?.full_name}
                                                                    referrerPolicy="no-referrer"
                                                                    onError={(e) => {
                                                                        e.currentTarget.classList.add('!hidden');
                                                                        const fallbackEl = e.currentTarget.nextElementSibling as HTMLElement;
                                                                        if (fallbackEl) fallbackEl.classList.remove('!hidden');
                                                                    }}
                                                                    className="w-full h-full object-cover"
                                                                />
                                                                <div className="!hidden w-full h-full bg-gradient-to-br from-[#587e85] to-[#3a5459] text-white font-black text-sm flex items-center justify-center">
                                                                    {((ticket.assigned_to_details?.full_name || ticket.assigned_to?.full_name || ticket.current_level_owner || 'HR').split(' ').map((n: string) => n[0]).join('')).substring(0, 2).toUpperCase()}
                                                                </div>
                                                            </>
                                                        ) : (
                                                            <div className="w-full h-full bg-gradient-to-br from-[#587e85] to-[#3a5459] text-white font-black text-sm flex items-center justify-center">
                                                                {((ticket.assigned_to_details?.full_name || ticket.assigned_to?.full_name || ticket.current_level_owner || 'HR').split(' ').map((n: string) => n[0]).join('')).substring(0, 2).toUpperCase()}
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>

                                            <div className="min-w-0 flex-1">
                                                <div className="font-extrabold text-xs text-slate-900 dark:text-white truncate">
                                                    {ticket.assigned_to_details?.full_name || ticket.assigned_to?.full_name || ticket.current_level_owner || 'Assigned Authority'}
                                                </div>
                                                <div className="text-[10px] font-bold text-[#587e85] dark:text-[#6c9a9e] truncate">
                                                    {ticket.assigned_to_details?.app_role || 'HR Authority'}
                                                </div>
                                                <div className="text-[10px] text-slate-500 dark:text-slate-400 font-medium truncate">
                                                    {ticket.assigned_to_details?.employee_role || 'Designated Handler'}
                                                </div>
                                            </div>
                                        </div>

                                        {/* Detailed User Metadata Grid */}
                                        <div className="pt-2 border-t border-slate-100 dark:border-slate-700/60 grid grid-cols-2 gap-2 text-[10.5px]">
                                            <div className="p-1.5 bg-slate-50 dark:bg-slate-900/50 rounded-lg">
                                                <span className="text-[9px] font-bold text-slate-400 block uppercase tracking-wider">Location</span>
                                                <span className="font-semibold text-slate-800 dark:text-slate-200 truncate block">
                                                    📍 {ticket.assigned_to_details?.location && ticket.assigned_to_details.location.toLowerCase() !== 'hidden' ? ticket.assigned_to_details.location : 'Head Office'}
                                                </span>
                                            </div>
                                            <div className="p-1.5 bg-slate-50 dark:bg-slate-900/50 rounded-lg">
                                                <span className="text-[9px] font-bold text-slate-400 block uppercase tracking-wider">Department</span>
                                                <span className="font-semibold text-slate-800 dark:text-slate-200 truncate block">
                                                    🏢 {ticket.assigned_to_details?.department || 'HR Ops'}
                                                </span>
                                            </div>
                                            <div className="p-1.5 bg-slate-50 dark:bg-slate-900/50 rounded-lg">
                                                <span className="text-[9px] font-bold text-slate-400 block uppercase tracking-wider">Emp Code</span>
                                                <span className="font-mono font-bold text-slate-800 dark:text-slate-200 truncate block">
                                                    {ticket.assigned_to_details?.employee_code || 'N/A'}
                                                </span>
                                            </div>
                                            <div className="p-1.5 bg-slate-50 dark:bg-slate-900/50 rounded-lg">
                                                <span className="text-[9px] font-bold text-slate-400 block uppercase tracking-wider">App Role</span>
                                                <span className="font-semibold text-indigo-600 dark:text-indigo-400 truncate block">
                                                    {ticket.assigned_to_details?.app_role || 'HR Admin'}
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* Submitter Profile Card (matching Assigned Handler UI) */}
                                <div className="space-y-3">
                                    <div className="flex items-center justify-between">
                                        <h4 className="text-xs font-black text-slate-800 dark:text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
                                            <User className="w-3.5 h-3.5 text-[#587e85]" />
                                            Submitter Profile
                                        </h4>
                                        <span className="px-2 py-0.5 text-[9px] font-black uppercase tracking-wider bg-slate-100 text-slate-700 dark:bg-slate-700/60 dark:text-slate-300 border border-slate-200 dark:border-slate-600 rounded-md">
                                            {ticket.is_anonymous ? 'Anonymous' : 'Employee'}
                                        </span>
                                    </div>

                                    <div className="p-3.5 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm space-y-3">
                                        {/* Submitter Circle Profile Header */}
                                        <div className="flex items-center gap-3">
                                            <div className="relative shrink-0">
                                                <div className="p-[2.5px] bg-gradient-to-tr from-teal-500 via-[#587e85] to-emerald-400 rounded-full shadow-md transition-transform duration-300 hover:scale-105">
                                                    <div className="w-12 h-12 rounded-full overflow-hidden bg-slate-100 dark:bg-slate-900 border-2 border-white dark:border-slate-800 flex items-center justify-center">
                                                        {ticket.is_anonymous ? (
                                                            <div className="w-full h-full bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 flex items-center justify-center">
                                                                <Lock className="w-5 h-5" />
                                                            </div>
                                                        ) : (ticket.submitter_details?.photo_url || ticket.raised_by?.user_photo_url) ? (
                                                            <>
                                                                <img
                                                                    src={ticket.submitter_details?.photo_url || ticket.raised_by?.user_photo_url}
                                                                    alt={ticket.submitter_details?.full_name || ticket.raised_by?.full_name}
                                                                    referrerPolicy="no-referrer"
                                                                    onError={(e) => {
                                                                        e.currentTarget.classList.add('!hidden');
                                                                        const fallbackEl = e.currentTarget.nextElementSibling as HTMLElement;
                                                                        if (fallbackEl) fallbackEl.classList.remove('!hidden');
                                                                    }}
                                                                    className="w-full h-full object-cover"
                                                                />
                                                                <div className="!hidden w-full h-full bg-gradient-to-br from-[#587e85] to-[#3a5459] text-white font-black text-sm flex items-center justify-center">
                                                                    {((ticket.submitter_details?.full_name || ticket.employee_snapshot?.name || ticket.raised_by?.full_name || 'EM').split(' ').map((n: string) => n[0]).join('')).substring(0, 2).toUpperCase()}
                                                                </div>
                                                            </>
                                                        ) : (
                                                            <div className="w-full h-full bg-gradient-to-br from-[#587e85] to-[#3a5459] text-white font-black text-sm flex items-center justify-center">
                                                                {((ticket.submitter_details?.full_name || ticket.employee_snapshot?.name || ticket.raised_by?.full_name || 'EM').split(' ').map((n: string) => n[0]).join('')).substring(0, 2).toUpperCase()}
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>

                                            <div className="min-w-0 flex-1">
                                                <div className="font-extrabold text-xs text-slate-900 dark:text-white truncate">
                                                    {ticket.is_anonymous ? '🔒 Anonymous Employee' : (ticket.submitter_details?.full_name || ticket.employee_snapshot?.name || ticket.raised_by?.full_name || 'Employee')}
                                                </div>
                                                <div className="text-[10px] font-bold text-[#587e85] dark:text-[#6c9a9e] truncate">
                                                    {ticket.is_anonymous ? 'Confidential Identity' : (ticket.submitter_details?.designation || ticket.employee_snapshot?.designation || 'Staff')}
                                                </div>
                                                <div className="text-[10px] text-slate-500 dark:text-slate-400 font-medium truncate">
                                                    {ticket.is_anonymous ? 'Identity Masked' : `Manager: ${ticket.submitter_details?.manager_name || ticket.employee_snapshot?.manager_name || ticket.employee_snapshot?.reporting_manager_name || 'N/A'}`}
                                                </div>
                                            </div>
                                        </div>

                                        {/* Submitter Metadata Grid */}
                                        <div className="pt-2 border-t border-slate-100 dark:border-slate-700/60 grid grid-cols-2 gap-2 text-[10.5px]">
                                            <div className="p-1.5 bg-slate-50 dark:bg-slate-900/50 rounded-lg">
                                                <span className="text-[9px] font-bold text-slate-400 block uppercase tracking-wider">Location</span>
                                                <span className="font-semibold text-slate-800 dark:text-slate-200 truncate block">
                                                    📍 {ticket.is_anonymous ? 'Hidden' : (ticket.submitter_details?.location || ticket.employee_snapshot?.location || 'Head Office')}
                                                </span>
                                            </div>
                                            <div className="p-1.5 bg-slate-50 dark:bg-slate-900/50 rounded-lg">
                                                <span className="text-[9px] font-bold text-slate-400 block uppercase tracking-wider">Department</span>
                                                <span className="font-semibold text-slate-800 dark:text-slate-200 truncate block">
                                                    🏢 {ticket.is_anonymous ? 'Confidential' : (ticket.submitter_details?.department || ticket.employee_snapshot?.department || 'Operations')}
                                                </span>
                                            </div>
                                            <div className="p-1.5 bg-slate-50 dark:bg-slate-900/50 rounded-lg">
                                                <span className="text-[9px] font-bold text-slate-400 block uppercase tracking-wider">Emp Code</span>
                                                <span className="font-mono font-bold text-slate-800 dark:text-slate-200 truncate block">
                                                    {ticket.is_anonymous ? 'Hidden' : (ticket.submitter_details?.employee_code || ticket.employee_snapshot?.code || 'N/A')}
                                                </span>
                                            </div>
                                            <div className="p-1.5 bg-slate-50 dark:bg-slate-900/50 rounded-lg">
                                                <span className="text-[9px] font-bold text-slate-400 block uppercase tracking-wider">Manager</span>
                                                <span className="font-semibold text-indigo-600 dark:text-indigo-400 truncate block">
                                                    {ticket.is_anonymous ? 'Hidden' : (ticket.submitter_details?.manager_name || ticket.employee_snapshot?.manager_name || ticket.employee_snapshot?.reporting_manager_name || 'N/A')}
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* Structured Ticket Lifecycle Actions */}
                                <div className="space-y-3 pt-3 border-t border-slate-200 dark:border-slate-800">
                                    <h4 className="text-xs font-black text-slate-900 dark:text-white uppercase tracking-wider">
                                        Ticket Lifecycle & Resolution
                                    </h4>

                                    {isTicketResolvedOrClosed ? (
                                        <div className="space-y-3">
                                            {(() => {
                                                const { levelNum, levelLabel, resolverName } = getClosingDetails();
                                                return (
                                                    <div className="p-3.5 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-2xl text-xs space-y-2.5 shadow-xs">
                                                        <div className="font-extrabold text-emerald-800 dark:text-emerald-300 flex items-center justify-between gap-1.5">
                                                            <span className="flex items-center gap-1.5">
                                                                <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0" />
                                                                {ticket.status === 'closed' ? 'Ticket Resolved & Closed' : 'Resolved — Pending Acknowledgement'}
                                                            </span>
                                                            <span className="px-2 py-0.5 bg-emerald-600 text-white font-mono text-[10px] font-black rounded-lg uppercase tracking-wider shrink-0">
                                                                L{levelNum} {ticket.status === 'closed' ? 'Closed' : 'Resolved'}
                                                            </span>
                                                        </div>

                                                        {/* Highlighted Metadata: Closed At Level & Who Closed */}
                                                        <div className="p-2.5 bg-white/90 dark:bg-slate-900/80 rounded-xl border border-emerald-200/80 dark:border-emerald-800/80 space-y-1.5">
                                                            <div className="flex items-center justify-between text-[11px]">
                                                                <span className="text-slate-500 font-medium">Resolved At Level:</span>
                                                                <span className="font-black text-slate-800 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-md">
                                                                    {levelLabel}
                                                                </span>
                                                            </div>
                                                            <div className="flex items-center justify-between text-[11px]">
                                                                <span className="text-slate-500 font-medium">Resolved By:</span>
                                                                <span className="font-black text-emerald-700 dark:text-emerald-300 flex items-center gap-1">
                                                                    <User className="w-3 h-3 text-emerald-600 shrink-0" />
                                                                    {resolverName}
                                                                </span>
                                                            </div>
                                                        </div>

                                                        {ticket.resolution_note ? (
                                                            <div className="space-y-1">
                                                                <div className="text-[10px] uppercase tracking-wider font-extrabold text-emerald-800 dark:text-emerald-400">Resolution Note:</div>
                                                                <p className="text-xs text-slate-700 dark:text-slate-300 italic bg-white/60 dark:bg-slate-900/60 p-2 rounded-xl border border-emerald-200/60 dark:border-emerald-800/60">
                                                                    "{ticket.resolution_note}"
                                                                </p>
                                                            </div>
                                                        ) : (
                                                            <p className="text-[11px] text-slate-500 italic">No formal resolution note recorded.</p>
                                                        )}
                                                        {ticket.resolved_at && (
                                                            <div className="text-[10px] text-emerald-700/80 dark:text-emerald-400/80 font-medium pt-1 border-t border-emerald-200/60 dark:border-emerald-800/60">
                                                                Resolved on {formatDateTimeIN(ticket.resolved_at)}
                                                            </div>
                                                        )}
                                                    </div>
                                                );
                                            })()}

                                            {/* Submitter Acknowledgement / Reopen Controls */}
                                            {isRaisedByMe && (ticket.status === 'resolved' || ticket.status === 'pending_acknowledgement') ? (
                                                <div className="space-y-2 pt-1">
                                                    <div className="p-3 bg-emerald-50/90 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 rounded-2xl space-y-2">
                                                        <div className="text-[11px] font-extrabold text-emerald-900 dark:text-emerald-200 flex items-center gap-1.5">
                                                            <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0" />
                                                            Action Required: Please Confirm Resolution
                                                        </div>
                                                        <p className="text-[10px] text-slate-600 dark:text-slate-400 font-medium leading-relaxed">
                                                            Your ticket has been marked resolved by HR. Please acknowledge if you are satisfied with the resolution, or reopen if further attention is needed.
                                                        </p>
                                                        <div className="flex flex-col gap-1.5 pt-1">
                                                            <button
                                                                type="button"
                                                                onClick={() => handleUpdateStatus('closed', false, undefined, 'acknowledge')}
                                                                className="w-full py-2 px-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-black shadow-md flex items-center justify-center gap-1.5 transition-all active:scale-95 cursor-pointer"
                                                            >
                                                                <CheckCircle className="w-3.5 h-3.5" />
                                                                Acknowledge & Confirm Resolution
                                                            </button>
                                                            <button
                                                                type="button"
                                                                onClick={() => handleUpdateStatus('reopened', false, undefined, 'reopen')}
                                                                className="w-full py-2 px-3 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-bold hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                                                            >
                                                                <Clock className="w-3.5 h-3.5 text-amber-500" />
                                                                Reopen Ticket (Issue Unresolved)
                                                            </button>
                                                        </div>
                                                    </div>
                                                </div>
                                            ) : isRaisedByMe && (ticket.employee_snapshot?.acknowledged_at || ticket.status === 'closed') ? (
                                                <div className="p-3 bg-emerald-100/80 dark:bg-emerald-950/60 border border-emerald-300 dark:border-emerald-800 rounded-2xl text-[11px] font-extrabold text-emerald-900 dark:text-emerald-200 flex items-center gap-2">
                                                    <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0" />
                                                    <span>Resolution Acknowledged & Accepted by Submitter</span>
                                                </div>
                                            ) : (canChangeStatus || isRaisedByMe) ? (
                                                <button
                                                    type="button"
                                                    onClick={() => handleUpdateStatus('reopened')}
                                                    className="w-full py-2.5 px-3 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 rounded-2xl text-xs font-bold hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors flex items-center justify-center gap-1.5"
                                                >
                                                    <Clock className="w-3.5 h-3.5" />
                                                    Reopen Ticket
                                                </button>
                                            ) : null}
                                        </div>
                                    ) : canChangeStatus ? (
                                        <div className="space-y-2.5">
                                            {/* 1. Mark In Progress */}
                                            {ticket.status !== 'in_progress' && (
                                                <button
                                                    type="button"
                                                    onClick={() => handleUpdateStatus('in_progress')}
                                                    className="w-full py-2.5 px-3 bg-sky-50 dark:bg-sky-950/40 text-sky-700 dark:text-sky-300 border border-sky-200 dark:border-sky-800 rounded-2xl text-xs font-bold hover:bg-sky-100 transition-colors flex items-center justify-center gap-1.5"
                                                >
                                                    <Clock className="w-3.5 h-3.5" />
                                                    Mark as In Progress
                                                </button>
                                            )}

                                            {/* 2. Resolve Ticket Button & Resolution Form */}
                                            <button
                                                type="button"
                                                onClick={() => setShowResolutionForm(!showResolutionForm)}
                                                className="w-full py-2.5 px-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-2xl text-xs font-bold transition-all shadow-md shadow-emerald-600/20 flex items-center justify-center gap-1.5 active:scale-95 cursor-pointer"
                                            >
                                                <CheckCircle className="w-4 h-4" />
                                                {showResolutionForm ? 'Hide Resolution Form' : 'Resolve Ticket'}
                                            </button>

                                            {showResolutionForm && (
                                                <div className="p-3.5 bg-emerald-50/80 dark:bg-emerald-950/50 rounded-2xl border border-emerald-200 dark:border-emerald-800 space-y-2.5 animate-in fade-in duration-200">
                                                    <label className="block text-[10px] font-black text-emerald-800 dark:text-emerald-300 uppercase tracking-wider">
                                                        Resolution Note / Action Taken
                                                    </label>
                                                    <textarea
                                                        rows={2}
                                                        value={resolutionNoteInput}
                                                        onChange={(e) => setResolutionNoteInput(e.target.value)}
                                                        placeholder="Summarize resolution action taken at Level 1 / Level 2..."
                                                        className="w-full p-2.5 text-xs rounded-xl border border-emerald-300 dark:border-emerald-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-emerald-500 resize-none font-medium"
                                                    />
                                                    <div className="flex gap-2">
                                                        <button
                                                            type="button"
                                                            onClick={() => handleUpdateStatus('pending_acknowledgement', false, resolutionNoteInput, 'resolve')}
                                                            className="flex-1 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-sm cursor-pointer"
                                                        >
                                                            Confirm Resolution (Request Acknowledgment)
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() => setShowResolutionForm(false)}
                                                            className="px-3 py-2 bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-xl text-xs font-bold cursor-pointer"
                                                        >
                                                            Cancel
                                                        </button>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    ) : (
                                        <div className="p-3.5 bg-amber-50/80 dark:bg-amber-950/40 border border-amber-200/80 dark:border-amber-800 rounded-2xl text-xs space-y-1">
                                            <div className="font-extrabold text-amber-900 dark:text-amber-300 flex items-center gap-1.5">
                                                <Lock className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                                                {isRaisedByMe ? 'Active Level Handler' : 'Tracking Mode — Read Only'}
                                            </div>
                                            <p className="text-[11px] text-amber-800/90 dark:text-amber-300/90 leading-relaxed font-medium">
                                                Active level: <strong>Level {ticket.current_level} ({ticket.escalation_flow?.find((s: any) => s.level === ticket.current_level)?.assignee || ticket.level_owners?.[`l${ticket.current_level}`] || ticket.assigned_to?.full_name || 'Level Authority'})</strong>. {isRaisedByMe ? 'You can communicate directly with the handler in the conversation thread.' : 'You can view all overall progress and live updates.'}
                                            </p>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );

    return createPortal(modalContent, document.body);
}
