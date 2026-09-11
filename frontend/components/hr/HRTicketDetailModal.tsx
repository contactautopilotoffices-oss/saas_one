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
                    sender_name: currentUserRole === 'director' ? 'Director' : 'Handler / Support',
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

    const handleUpdateStatus = async (newStatus: string, escalate: boolean = false) => {
        try {
            const res = await fetch(`/api/hr/tickets/${ticketId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    status: newStatus,
                    actor_user_id: currentUserId,
                    escalate
                })
            });
            const text = await res.text();
            let data: any = {};
            try { data = text ? JSON.parse(text) : {}; } catch {}
            if (data.success) {
                fetchTicketDetail();
                onRefresh();
            }
        } catch (err) {
            console.error('Error updating status:', err);
        }
    };

    if (!isOpen || !ticketId) return null;

    const isHandler = currentUserRole === 'hr' || currentUserRole === 'hr_head' || currentUserRole === 'manager' || currentUserRole === 'director';

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-2 sm:p-4">
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl sm:rounded-3xl shadow-2xl w-full max-w-4xl max-h-[92vh] sm:max-h-[85vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200 my-auto">
                {/* Modal Header */}
                <div className="shrink-0 flex items-center justify-between px-4 sm:px-6 py-3.5 sm:py-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/50">
                    <div className="flex items-center gap-3 min-w-0">
                        <span className="px-2.5 py-1 bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 font-mono text-xs font-bold rounded-lg shrink-0">
                            {ticket?.ticket_number || 'Loading...'}
                        </span>
                        <div className="min-w-0">
                            <h2 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white truncate">
                                {ticket?.subject || 'HR Ticket Details'}
                            </h2>
                            <p className="text-[11px] sm:text-xs text-slate-500 dark:text-slate-400 capitalize truncate">
                                Type: {ticket?.ticket_type?.replace('_', ' ')} • Priority: {ticket?.priority}
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-white rounded-lg transition-colors shrink-0"
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
                            <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-xl border border-slate-100 dark:border-slate-800">
                                <div className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2 flex items-center justify-between">
                                    <span>Escalation Hierarchy</span>
                                    <span className="text-indigo-600 dark:text-indigo-400 font-bold">
                                        Level {ticket.current_level} of 4
                                    </span>
                                </div>
                                <div className="grid grid-cols-4 gap-2 text-center">
                                    {[
                                        { level: 1, label: 'L1 Manager' },
                                        { level: 2, label: 'L2 HR Dept' },
                                        { level: 3, label: 'L3 HR Head' },
                                        { level: 4, label: 'L4 Director' }
                                    ].map((step) => {
                                        const isCurrent = ticket.current_level === step.level;
                                        const isPassed = ticket.current_level > step.level;
                                        return (
                                            <div
                                                key={step.level}
                                                className={`p-2 rounded-lg text-[11px] font-semibold transition-all ${
                                                    isCurrent
                                                        ? 'bg-indigo-600 text-white shadow-md'
                                                        : isPassed
                                                        ? 'bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
                                                        : 'bg-white dark:bg-slate-800 text-slate-400 border border-slate-200 dark:border-slate-700'
                                                }`}
                                            >
                                                {step.label}
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
                                                    ? 'text-indigo-600 border-b-2 border-indigo-600 dark:text-indigo-400'
                                                    : 'text-slate-400 hover:text-slate-600'
                                            }`}
                                        >
                                            Conversation Thread ({ticket.comments?.length || 0})
                                        </button>
                                        <button
                                            onClick={() => setActiveTab('audit')}
                                            className={`text-xs font-bold pb-1 transition-all ${
                                                activeTab === 'audit'
                                                    ? 'text-indigo-600 border-b-2 border-indigo-600 dark:text-indigo-400'
                                                    : 'text-slate-400 hover:text-slate-600'
                                            }`}
                                        >
                                            Audit History ({ticket.audit_logs?.length || 0})
                                        </button>
                                    </div>
                                </div>

                                {activeTab === 'discussion' ? (
                                    <div className="flex-1 flex flex-col justify-between gap-4 min-h-[250px]">
                                        <div className="space-y-3 max-h-[300px] overflow-y-auto pr-1">
                                            {ticket.comments?.length === 0 ? (
                                                <p className="text-xs text-slate-400 italic text-center py-6">No responses yet.</p>
                                            ) : (
                                                ticket.comments?.map((comment: any) => (
                                                    <div
                                                        key={comment.id}
                                                        className={`p-3.5 rounded-xl border text-xs ${
                                                            comment.is_internal
                                                                ? 'bg-amber-50/70 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800 text-amber-900 dark:text-amber-200'
                                                                : 'bg-slate-50 dark:bg-slate-800/80 border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200'
                                                        }`}
                                                    >
                                                        <div className="flex items-center justify-between mb-1">
                                                            <div className="flex items-center gap-2">
                                                                <span className="font-bold">{comment.sender_name}</span>
                                                                {comment.is_internal && (
                                                                    <span className="px-1.5 py-0.5 bg-amber-200 dark:bg-amber-800 text-amber-900 dark:text-amber-100 text-[10px] font-bold rounded">
                                                                        INTERNAL NOTE
                                                                    </span>
                                                                )}
                                                            </div>
                                                            <span className="text-[10px] opacity-60">
                                                                {new Date(comment.created_at).toLocaleString()}
                                                            </span>
                                                        </div>
                                                        <p className="whitespace-pre-wrap">{comment.content}</p>
                                                    </div>
                                                ))
                                            )}
                                        </div>

                                        {/* Add Comment Form */}
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
                                            <div className="flex gap-2">
                                                <input
                                                    type="text"
                                                    value={commentText}
                                                    onChange={(e) => setCommentText(e.target.value)}
                                                    placeholder={isInternalNote ? "Write internal handler note..." : "Write reply..."}
                                                    className="flex-1 px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none"
                                                />
                                                <button
                                                    type="submit"
                                                    disabled={submittingComment}
                                                    className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-semibold disabled:opacity-50 transition-all flex items-center gap-1.5"
                                                >
                                                    <Send className="w-3.5 h-3.5" />
                                                    Send
                                                </button>
                                            </div>
                                        </form>
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

                            {/* Status Actions for Handlers */}
                            {isHandler && (
                                <div className="space-y-2 pt-2 border-t border-slate-200 dark:border-slate-800">
                                    <h4 className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                                        Handler Actions
                                    </h4>
                                    <div className="grid grid-cols-1 gap-2">
                                        <div>
                                            <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Update Status</label>
                                            <select
                                                value={ticket.status}
                                                onChange={(e) => handleUpdateStatus(e.target.value)}
                                                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-semibold text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-indigo-500"
                                            >
                                                <option value="new">New</option>
                                                <option value="assigned">Assigned</option>
                                                <option value="in_progress">In Progress</option>
                                                <option value="awaiting_employee_response">Awaiting Employee Response</option>
                                                <option value="awaiting_manager_response">Awaiting Manager Response</option>
                                                <option value="awaiting_hr_response">Awaiting HR Response</option>
                                                <option value="awaiting_internal_approval">Awaiting Internal Approval</option>
                                                <option value="awaiting_external_party">Awaiting External Party</option>
                                                <option value="escalated">Escalated</option>
                                                <option value="resolved">Resolved</option>
                                                <option value="closed">Closed</option>
                                                <option value="reopened">Reopened</option>
                                                <option value="cancelled">Cancelled</option>
                                            </select>
                                        </div>

                                        {ticket.current_level < 4 && ticket.status !== 'resolved' && ticket.status !== 'closed' && (
                                            <button
                                                onClick={() => handleUpdateStatus('escalated', true)}
                                                className="w-full py-2 bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800 rounded-xl text-xs font-semibold hover:bg-amber-100 transition-colors"
                                            >
                                                Escalate to Level {ticket.current_level + 1}
                                            </button>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
