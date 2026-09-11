'use client';

import React from 'react';
import { Clock, AlertTriangle, UserCheck, ShieldAlert, ArrowRight, MessageCircle } from 'lucide-react';

import SLALiveTimer from '@/frontend/components/hr/SLALiveTimer';

interface HRKanbanBoardProps {
    tickets: any[];
    onSelectTicket: (ticketId: string) => void;
    onUpdateStatus: (ticketId: string, newStatus: string) => void;
}

const KANBAN_COLUMNS = [
    { id: 'new', label: 'New', color: 'border-blue-500 bg-blue-50/30 dark:bg-blue-950/20' },
    { id: 'in_progress', label: 'In Progress', color: 'border-indigo-500 bg-indigo-50/30 dark:bg-indigo-950/20' },
    { id: 'awaiting_employee_response', label: 'Awaiting Response', color: 'border-amber-500 bg-amber-50/30 dark:bg-amber-950/20' },
    { id: 'escalated', label: 'Escalated', color: 'border-red-500 bg-red-50/30 dark:bg-red-950/20' },
    { id: 'resolved', label: 'Resolved', color: 'border-emerald-500 bg-emerald-50/30 dark:bg-emerald-950/20' },
    { id: 'closed', label: 'Closed', color: 'border-slate-400 bg-slate-50/30 dark:bg-slate-900/20' }
];

export default function HRKanbanBoard({ tickets, onSelectTicket, onUpdateStatus }: HRKanbanBoardProps) {
    const handleDragStart = (e: React.DragEvent, ticketId: string) => {
        e.dataTransfer.setData('text/plain', ticketId);
    };

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
    };

    const handleDrop = (e: React.DragEvent, targetColumnId: string) => {
        e.preventDefault();
        const ticketId = e.dataTransfer.getData('text/plain');
        if (ticketId) {
            onUpdateStatus(ticketId, targetColumnId);
        }
    };

    return (
        <div className="w-full overflow-x-auto pb-6">
            <div className="flex gap-4 min-w-[1200px] lg:min-w-full">
                {KANBAN_COLUMNS.map((col) => {
                    const colTickets = tickets.filter(t => t.status === col.id);
                    return (
                        <div
                            key={col.id}
                            onDragOver={handleDragOver}
                            onDrop={(e) => handleDrop(e, col.id)}
                            className={`flex-1 min-w-[260px] max-w-[320px] rounded-2xl border ${col.color} p-3.5 flex flex-col gap-3 min-h-[500px] transition-all`}
                        >
                            {/* Column Header */}
                            <div className="flex items-center justify-between px-1">
                                <h3 className="text-xs font-bold text-slate-800 dark:text-slate-200 tracking-wide flex items-center gap-2">
                                    {col.label}
                                </h3>
                                <span className="px-2 py-0.5 bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-full text-[11px] font-bold">
                                    {colTickets.length}
                                </span>
                            </div>

                            {/* Ticket Cards */}
                            <div className="flex-1 flex flex-col gap-3 overflow-y-auto">
                                {colTickets.length === 0 ? (
                                    <div className="flex-1 flex items-center justify-center border-2 border-dashed border-slate-200 dark:border-slate-800/80 rounded-xl p-4 text-center">
                                        <span className="text-xs text-slate-400 font-medium">No tickets</span>
                                    </div>
                                ) : (
                                    colTickets.map((t) => {
                                        const isBreached = t.sla_due_at && new Date(t.sla_due_at) < new Date();
                                        return (
                                            <div
                                                key={t.id}
                                                draggable
                                                onDragStart={(e) => handleDragStart(e, t.id)}
                                                onClick={() => onSelectTicket(t.id)}
                                                className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-sm hover:shadow-md hover:border-indigo-400 dark:hover:border-indigo-600 transition-all cursor-pointer group space-y-3"
                                            >
                                                {/* Header Badges */}
                                                <div className="flex items-center justify-between text-[11px]">
                                                    <span className="font-mono font-bold text-indigo-600 dark:text-indigo-400">
                                                        {t.ticket_number}
                                                    </span>
                                                    <div className="flex gap-1">
                                                        {t.is_confidential && (
                                                            <span className="px-1.5 py-0.5 bg-purple-100 dark:bg-purple-950 text-purple-700 dark:text-purple-300 font-bold rounded">
                                                                Confidential
                                                            </span>
                                                        )}
                                                        <span className={`px-1.5 py-0.5 rounded font-bold uppercase text-[10px] ${
                                                            t.priority === 'critical' ? 'bg-red-100 text-red-700' :
                                                            t.priority === 'high' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600'
                                                        }`}>
                                                            {t.priority}
                                                        </span>
                                                    </div>
                                                </div>

                                                {/* Subject */}
                                                <h4 className="text-xs font-bold text-slate-900 dark:text-white line-clamp-2 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
                                                    {t.subject}
                                                </h4>

                                                {/* Category & Employee info */}
                                                <div className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center justify-between">
                                                    <span className="truncate max-w-[140px]">
                                                        👤 {t.employee_snapshot?.name || 'Employee'}
                                                    </span>
                                                    <span className="font-semibold text-slate-600 dark:text-slate-300">
                                                        L{t.current_level}
                                                    </span>
                                                </div>

                                                {/* Card Footer SLA */}
                                                <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-[10px]">
                                                    <SLALiveTimer slaDueAt={t.sla_due_at} status={t.status} compact />

                                                    <span className="text-indigo-600 dark:text-indigo-400 opacity-0 group-hover:opacity-100 transition-opacity font-bold flex items-center gap-0.5">
                                                        View <ArrowRight className="w-3 h-3" />
                                                    </span>
                                                </div>
                                            </div>
                                        );
                                    })
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
