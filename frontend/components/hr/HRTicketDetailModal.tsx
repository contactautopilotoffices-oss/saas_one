'use client';

import React, { useState, useEffect } from 'react';
import { X, Send, Lock, Clock, AlertTriangle, ShieldCheck, ArrowUpRight, User, CheckCircle, MessageSquare } from 'lucide-react';
import SLALiveTimer from '@/frontend/components/hr/SLALiveTimer';

interface HRTicketDetailModalProps {
    isOpen: boolean;
    ticketId: string | null;
    onClose: () => void;
    onRefresh: () => void;
    currentUserId: string;
    currentUserRole: string;
}

export default function HRTicketDetailModal({ isOpen, ticketId, onClose, onRefresh, currentUserId, currentUserRole }: HRTicketDetailModalProps) {
    const [ticket, setTicket] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [commentText, setCommentText] = useState('');
    const [isInternalNote, setIsInternalNote] = useState(false);
    const [submittingComment, setSubmittingComment] = useState(false);
    const [activeTab, setActiveTab] = useState<'discussion' | 'audit'>('discussion');
    const [resolutionNoteInput, setResolutionNoteInput] = useState('');
    const [showResolutionForm, setShowResolutionForm] = useState(false);

    useEffect(() => {
        if (isOpen && ticketId) {
            fetchTicketDetail();
        }
    }, [isOpen, ticketId]);

    const fetchTicketDetail = async () => {
        setLoading(true);
        try {
            const res = await fetch(`/api/hr/tickets/${ticketId}`);
            const text = await res.text();
            let data: any = {};
            try { data = text ? JSON.parse(text) : {}; } catch {}
            if (data.success) {
                setTicket(data.data);
            }
        } catch (err) {
            console.error('Error fetching ticket detail:', err);
        } finally {
            setLoading(false);
        }
    };

    const handleAddComment = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!commentText.trim()) return;

        setSubmittingComment(true);
        try {
            const res = await fetch(`/api/hr/tickets/${ticketId}/comments`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sender_user_id: currentUserId,
                    sender_name: '',
                    content: commentText.trim(),
                    is_internal: isInternalNote
                })
            });
            const text = await res.text();
            let data: any = {};
            try { data = text ? JSON.parse(text) : {}; } catch {}
            if (data.success) {
                setCommentText('');
                fetchTicketDetail();
            }
        } catch (err) {
            console.error('Error adding comment:', err);
        } finally {
            setSubmittingComment(false);
        }
    };

    const handleUpdateStatus = async (newStatus: string, escalate: boolean = false, resolutionNote?: string) => {
        try {
            const res = await fetch(`/api/hr/tickets/${ticketId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    status: newStatus,
                    actor_user_id: currentUserId,
                    escalate,
                    resolution_note: resolutionNote,
                    resolved_by_user_id: currentUserId
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

    if (!isOpen || !ticketId) return null;

    const isAssignedToMe = Boolean(currentUserId && ticket?.assigned_to_user_id === currentUserId);
    const isRaisedByMe = Boolean(currentUserId && ticket?.raised_by_user_id === currentUserId);
    
    // Check if user is active authority for current level
    const normalizedRole = (currentUserRole || '').toLowerCase();
    const isActiveLevelAuthority = Boolean(
        isAssignedToMe ||
        (ticket?.current_level === 4 && ['director', 'org_super_admin'].includes(normalizedRole)) ||
        (ticket?.current_level >= 2 && ['hr', 'hr_head', 'org_super_admin'].includes(normalizedRole) && !ticket?.is_confidential)
    );

    const isTicketResolvedOrClosed = ticket?.status === 'resolved' || ticket?.status === 'closed';
    const isEscalatedAway = Boolean(
        ticket?.status === 'escalated' || 
        (ticket?.current_level > 1 && !isAssignedToMe && !isActiveLevelAuthority)
    );

    // Can edit/action ticket ONLY if user is active assignee / authority or submitter, and ticket is not closed
    const canEditTicket = (isActiveLevelAuthority || isRaisedByMe) && !isTicketResolvedOrClosed;
    const canChangeStatus = isActiveLevelAuthority && !isTicketResolvedOrClosed;
    const isHandler = isActiveLevelAuthority;

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 backdrop-blur-md p-2 sm:p-4">
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-[2rem] sm:rounded-3xl shadow-2xl w-full max-w-4xl max-h-[95vh] lg:max-h-[88vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200 my-auto">
                {/* Modal Header */}
                <div className="shrink-0 flex items-center justify-between px-4 sm:px-6 py-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/50">
                    <div className="flex items-center gap-3 min-w-0">
                        <span className="px-3 py-1 bg-indigo-600/10 dark:bg-indigo-500/20 border border-indigo-600/20 text-indigo-700 dark:text-indigo-300 font-mono text-xs font-black rounded-xl shrink-0">
                            {ticket?.ticket_number || 'Loading...'}
                        </span>
                        <div className="min-w-0">
                            <h2 className="text-sm sm:text-base font-black text-slate-900 dark:text-white truncate tracking-tight">
                                {ticket?.subject || 'HR Ticket Details'}
                            </h2>
                            <p className="text-[10px] sm:text-xs font-bold text-slate-400 capitalize truncate tracking-wide">
                                Type: {ticket?.ticket_type?.replace('_', ' ')} • Priority: {ticket?.priority}
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-white rounded-xl transition-colors shrink-0 hover:bg-slate-100 dark:hover:bg-slate-800"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {loading ? (
                    <div className="p-12 text-center text-slate-400 text-xs">Loading ticket details...</div>
                ) : (
                    <div className="flex-1 overflow-y-auto grid grid-cols-1 lg:grid-cols-3 divide-y lg:divide-y-0 lg:divide-x divide-slate-100 dark:divide-slate-800">
                        {/* Main Content Area (Col 1 & 2) */}
                        <div className="lg:col-span-2 p-6 flex flex-col gap-6">
                            {/* Level Progress Tracker */}
                            <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-2xl border border-slate-100 dark:border-slate-800 space-y-2">
                                <div className="text-xs font-black text-slate-700 dark:text-slate-300 flex items-center justify-between">
                                    <span className="uppercase tracking-wider text-[10px] text-slate-400">Escalation Hierarchy & Level Owners</span>
                                    <span className="text-[#587e85] dark:text-teal-400 font-black text-xs">
                                        Level {ticket.current_level} of 4 Active
                                    </span>
                                </div>
                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
                                    {[
                                        { level: 1, label: 'L1 Manager', owner: ticket.level_owners?.l1 || (ticket.assigned_to?.full_name || 'Manager') },
                                        { level: 2, label: 'L2 HR Dept', owner: ticket.level_owners?.l2 || 'HR Ops' },
                                        { level: 3, label: 'L3 HR Head', owner: ticket.level_owners?.l3 || 'HR Head' },
                                        { level: 4, label: 'L4 Director', owner: ticket.level_owners?.l4 || 'Director' }
                                    ].map((step) => {
                                        const isCurrent = ticket.current_level === step.level;
                                        const isPassed = ticket.current_level > step.level;
                                        return (
                                            <div
                                                key={step.level}
                                                className={`p-2.5 rounded-xl text-[11px] transition-all flex flex-col justify-between items-center ${
                                                    isCurrent
                                                        ? 'bg-[#587e85] text-white shadow-md ring-2 ring-[#587e85]/40 font-black'
                                                        : isPassed
                                                        ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 font-bold'
                                                        : 'bg-white dark:bg-slate-800 text-slate-400 border border-slate-200 dark:border-slate-700 font-medium'
                                                }`}
                                            >
                                                <div className="text-[10px] uppercase tracking-wider font-bold opacity-80">{step.label}</div>
                                                <div className="text-[11px] font-extrabold truncate w-full mt-1" title={step.owner}>
                                                    {step.owner}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>

                            {/* Ticket Description */}
                            <div className="space-y-2">
                                <h3 className="text-xs font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wider">
                                    Description & Context
                                </h3>
                                <div className="p-4 bg-white dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/60 rounded-xl text-xs text-slate-700 dark:text-slate-300 leading-relaxed whitespace-pre-wrap">
                                    {ticket.description}
                                </div>
                            </div>

                            {/* Discussion & Public / Internal Note Tabs */}
                            <div className="flex-1 flex flex-col gap-3">
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
                                    <div className="flex-1 flex flex-col justify-between gap-4 min-h-[250px]">
                                         <div className="space-y-3 max-h-[320px] overflow-y-auto pr-1">
                                             {ticket.comments?.length === 0 ? (
                                                 <div className="text-center py-8 space-y-1">
                                                     <MessageSquare className="w-8 h-8 text-slate-300 mx-auto" />
                                                     <p className="text-xs text-slate-400 font-medium">No messages yet in this conversation.</p>
                                                 </div>
                                             ) : (
                                                 ticket.comments?.map((comment: any) => {
                                                     const isMe = currentUserId && comment.sender_user_id === currentUserId;
                                                     const isInternal = comment.is_internal;

                                                     let senderDisplayName = comment.sender_name;
                                                     if (!senderDisplayName || senderDisplayName === 'Handler / Support' || senderDisplayName === 'System User') {
                                                         if (comment.sender_user_id && comment.sender_user_id === ticket.raised_by_user_id) {
                                                             senderDisplayName = ticket.is_anonymous ? 'Anonymous Employee' : (ticket.employee_snapshot?.name || ticket.raised_by?.full_name || ticket.raised_by?.email || 'Employee');
                                                         } else if (comment.sender_user_id && comment.sender_user_id === ticket.assigned_to_user_id) {
                                                             senderDisplayName = ticket.assigned_to?.full_name || ticket.assigned_to?.email || 'Assigned Handler';
                                                         } else {
                                                             senderDisplayName = ticket.assigned_to?.full_name || ticket.employee_snapshot?.name || 'Handler / Support';
                                                         }
                                                     }

                                                     if (isInternal) {
                                                         return (
                                                             <div key={comment.id} className="p-3 bg-amber-50 dark:bg-amber-950/40 border border-amber-300/80 dark:border-amber-800 text-amber-900 dark:text-amber-200 rounded-2xl max-w-[92%] mx-auto text-xs shadow-xs space-y-1 my-1.5">
                                                                 <div className="flex items-center justify-between gap-2 border-b border-amber-200 dark:border-amber-800/60 pb-1">
                                                                     <span className="font-bold flex items-center gap-1.5 text-amber-800 dark:text-amber-300">
                                                                         <Lock className="w-3 h-3" />
                                                                         Internal Handler Note ({senderDisplayName})
                                                                     </span>
                                                                     <span className="text-[10px] opacity-75">
                                                                         {new Date(comment.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                                     </span>
                                                                 </div>
                                                                 <p className="whitespace-pre-wrap leading-relaxed">{comment.content}</p>
                                                             </div>
                                                         );
                                                     }

                                                     return (
                                                         <div
                                                             key={comment.id}
                                                             className={`flex flex-col ${isMe ? 'items-end' : 'items-start'} my-1`}
                                                         >
                                                             <div
                                                                 className={`p-3 rounded-2xl text-xs max-w-[85%] sm:max-w-[78%] shadow-xs space-y-1 relative ${
                                                                     isMe
                                                                         ? 'bg-[#d9fdd3] dark:bg-emerald-950/80 border border-emerald-200 dark:border-emerald-800 text-slate-900 dark:text-white rounded-tr-none'
                                                                         : 'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white rounded-tl-none'
                                                                 }`}
                                                             >
                                                                 <div className="flex items-center justify-between gap-3 text-[10px] font-bold pb-0.5">
                                                                     <span className={isMe ? 'text-emerald-800 dark:text-emerald-300' : 'text-indigo-600 dark:text-indigo-400'}>
                                                                         {isMe ? 'You' : senderDisplayName}
                                                                     </span>
                                                                 </div>
                                                                 <p className="whitespace-pre-wrap leading-relaxed text-xs font-normal">{comment.content}</p>
                                                                 <div className="text-[9px] text-slate-400 dark:text-slate-500 text-right pt-0.5 font-mono">
                                                                     {new Date(comment.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                                 </div>
                                                             </div>
                                                         </div>
                                                     );
                                                 })
                                             )}
                                         </div>

                                        {/* Add Comment Form */}
                                        {canEditTicket ? (
                                            <form onSubmit={handleAddComment} className="mt-auto space-y-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                                                {isHandler && (
                                                    <div className="flex items-center gap-2 mb-1">
                                                        <label className="inline-flex items-center gap-1.5 text-[11px] font-medium text-amber-600 dark:text-amber-400 cursor-pointer">
                                                            <input
                                                                type="checkbox"
                                                                checked={isInternalNote}
                                                                onChange={(e) => setIsInternalNote(e.target.checked)}
                                                                className="rounded text-amber-600 focus:ring-amber-500"
                                                            />
                                                            <Lock className="w-3 h-3" />
                                                            Post as Internal Note (Visible to handlers only)
                                                        </label>
                                                    </div>
                                                )}
                                                <div className="flex flex-col sm:flex-row gap-2">
                                                    <input
                                                        type="text"
                                                        value={commentText}
                                                        onChange={(e) => setCommentText(e.target.value)}
                                                        placeholder={isInternalNote ? "Write internal handler note..." : "Write reply..."}
                                                        className="flex-1 px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white focus:ring-2 focus:ring-[#587e85] outline-none"
                                                    />
                                                    <button
                                                        type="submit"
                                                        disabled={submittingComment}
                                                        className="px-4 py-2.5 bg-[#587e85] hover:bg-[#48686e] text-white rounded-xl text-xs font-bold disabled:opacity-50 transition-all flex items-center justify-center gap-1.5 shadow-md shadow-[#587e85]/20"
                                                    >
                                                        <Send className="w-3.5 h-3.5" />
                                                        Send
                                                    </button>
                                                </div>
                                            </form>
                                        ) : (
                                            <div className="mt-auto p-3 bg-slate-100 dark:bg-slate-800/80 rounded-2xl border border-slate-200 dark:border-slate-700 text-center text-[11px] font-bold text-slate-500 dark:text-slate-400">
                                                🔒 Read-Only Tracking Mode — Action controls & replies belong to Level {ticket.current_level} ({ticket.assigned_to?.full_name || 'Active Assignee'})
                                            </div>
                                        )}
                                    </div>
                                ) : (
                                    <div className="space-y-2 max-h-[350px] overflow-y-auto">
                                        {ticket.audit_logs?.map((log: any) => (
                                            <div key={log.id} className="p-3 bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-slate-200/60 dark:border-slate-700/50 text-xs space-y-1">
                                                <div className="flex justify-between font-bold text-slate-700 dark:text-slate-300">
                                                    <span>{log.action}</span>
                                                    <span className="text-[10px] font-normal text-slate-400">
                                                        {new Date(log.created_at).toLocaleString()}
                                                    </span>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Sidebar Info & Actions (Col 3) */}
                        <div className="p-6 bg-slate-50/50 dark:bg-slate-900/40 space-y-6">
                            {/* SLA Box */}
                            <div className="p-4 rounded-xl border bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 space-y-2">
                                <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider flex items-center justify-between">
                                    <span className="flex items-center gap-1.5">
                                        <Clock className="w-3.5 h-3.5 text-indigo-500" />
                                        SLA Countdown
                                    </span>
                                    {ticket.sla_due_at && (
                                        <span className="text-[10px] text-slate-400 font-mono">
                                            Due: {new Date(ticket.sla_due_at).toLocaleDateString()}
                                        </span>
                                    )}
                                </div>
                                <div>
                                    <SLALiveTimer slaDueAt={ticket.sla_due_at} status={ticket.status} />
                                </div>
                                <div className="text-[10px] text-slate-400">
                                    Real-time SLA resolution countdown active
                                </div>
                            </div>

                            {/* Employee Info Snapshot */}
                            <div className="space-y-3">
                                <h4 className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                                    Employee Snapshot
                                </h4>
                                <div className="p-3 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 text-xs space-y-2">
                                    <div>
                                        <div className="text-[10px] text-slate-400">Name / Code</div>
                                        <div className="font-semibold text-slate-900 dark:text-white">
                                            {ticket.employee_snapshot?.name} ({ticket.employee_snapshot?.code || 'N/A'})
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-2 gap-2">
                                        <div>
                                            <div className="text-[10px] text-slate-400">Department</div>
                                            <div className="font-semibold">{ticket.employee_snapshot?.department}</div>
                                        </div>
                                        <div>
                                            <div className="text-[10px] text-slate-400">Location</div>
                                            <div className="font-semibold">{ticket.employee_snapshot?.location}</div>
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
                                        <div className="p-3.5 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-2xl text-xs space-y-1.5">
                                            <div className="font-bold text-emerald-800 dark:text-emerald-300 flex items-center gap-1.5">
                                                <CheckCircle className="w-4 h-4 text-emerald-600" />
                                                Ticket Resolved & Closed
                                            </div>
                                            {ticket.resolution_note ? (
                                                <p className="text-xs text-slate-700 dark:text-slate-300 italic bg-white/60 dark:bg-slate-900/60 p-2 rounded-xl border border-emerald-200/60 dark:border-emerald-800/60">
                                                    "{ticket.resolution_note}"
                                                </p>
                                            ) : (
                                                <p className="text-[11px] text-slate-500 italic">No formal resolution note recorded.</p>
                                            )}
                                            {ticket.resolved_at && (
                                                <div className="text-[10px] text-emerald-700/80 dark:text-emerald-400/80 font-medium pt-1 border-t border-emerald-200/60 dark:border-emerald-800/60">
                                                    Resolved on {new Date(ticket.resolved_at).toLocaleString()}
                                                </div>
                                            )}
                                        </div>

                                        {(canChangeStatus || currentUserId === ticket.raised_by_user_id) && (
                                            <button
                                                type="button"
                                                onClick={() => handleUpdateStatus('reopened')}
                                                className="w-full py-2.5 px-3 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 rounded-2xl text-xs font-bold hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors flex items-center justify-center gap-1.5"
                                            >
                                                <Clock className="w-3.5 h-3.5" />
                                                Reopen Ticket
                                            </button>
                                        )}
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

                                        {/* 2. Resolve & Close Ticket Button & Resolution Form */}
                                        <button
                                            type="button"
                                            onClick={() => setShowResolutionForm(!showResolutionForm)}
                                            className="w-full py-2.5 px-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-2xl text-xs font-bold transition-all shadow-md shadow-emerald-600/20 flex items-center justify-center gap-1.5 active:scale-95"
                                        >
                                            <CheckCircle className="w-4 h-4" />
                                            {showResolutionForm ? 'Hide Resolution Form' : 'Resolve & Close Ticket'}
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
                                                        onClick={() => handleUpdateStatus('resolved', false, resolutionNoteInput)}
                                                        className="flex-1 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-sm"
                                                    >
                                                        Confirm & Close Ticket
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => setShowResolutionForm(false)}
                                                        className="px-3 py-2 bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-xl text-xs font-bold"
                                                    >
                                                        Cancel
                                                    </button>
                                                </div>
                                            </div>
                                        )}

                                        {/* 3. Escalate Button */}
                                        {ticket.current_level < 4 && (
                                            <button
                                                type="button"
                                                onClick={() => handleUpdateStatus('escalated', true)}
                                                className="w-full py-2.5 px-3 bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800 rounded-2xl text-xs font-bold hover:bg-amber-100 transition-colors flex items-center justify-center gap-1.5"
                                            >
                                                <ArrowUpRight className="w-3.5 h-3.5" />
                                                Escalate to Level {ticket.current_level + 1}
                                            </button>
                                        )}
                                    </div>
                                ) : (
                                    <div className="p-3.5 bg-amber-50/80 dark:bg-amber-950/40 border border-amber-200/80 dark:border-amber-800 rounded-2xl text-xs space-y-1">
                                        <div className="font-extrabold text-amber-900 dark:text-amber-300 flex items-center gap-1.5">
                                            <Lock className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                                            Tracking Mode — Read Only
                                        </div>
                                        <p className="text-[11px] text-amber-800/90 dark:text-amber-300/90 leading-relaxed font-medium">
                                            Active level: <strong>Level {ticket.current_level} ({ticket.assigned_to?.full_name || 'Level Authority'})</strong>. You can view all overall progress and live updates.
                                        </p>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
