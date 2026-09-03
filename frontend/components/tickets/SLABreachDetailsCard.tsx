'use client';

import React from 'react';
import { AlertCircle, Clock } from 'lucide-react';
import { formatDuration } from '@/frontend/utils/date';

export function SLABadge({ slaDeadline, isBreached }: { slaDeadline: string | null; isBreached: boolean }) {
    if (!slaDeadline && !isBreached) return null;
    if (isBreached) {
        return (
            <span className="px-2 py-0.5 text-[10px] font-black uppercase text-red-400 bg-red-500/20 rounded-md border border-red-500/30 flex items-center gap-1">
                ⚠️ LATE / BREACHED
            </span>
        );
    }
    return (
        <span className="px-2 py-0.5 text-[10px] font-black uppercase text-emerald-400 bg-emerald-500/20 rounded-md">
            WITHIN SLA
        </span>
    );
}


export function SLABreachDetailsCard({ ticket }: { ticket: any }) {
    if (!ticket?.sla_deadline && !ticket?.sla_breached) return null;

    const referenceTime = new Date();
    const slaDeadline = ticket.sla_deadline ? new Date(ticket.sla_deadline) : null;
    const isPendingValidation = ticket.status === 'pending_validation';

    
    // Evaluate if breached
    const isSLABreached = Boolean(ticket.sla_breached) || 
        (slaDeadline !== null && slaDeadline < referenceTime && !isPendingValidation);

    // Overdue duration calculation
    const breachMs = slaDeadline && isSLABreached ? referenceTime.getTime() - slaDeadline.getTime() : 0;
    const resolvedAt = ticket.resolved_at ? new Date(ticket.resolved_at) : null;

    return (
        <div className="bg-[#161b22] border border-[#30363d] rounded-xl p-6 space-y-6">
            {/* Header & Status Banner */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-[#30363d] pb-5">
                <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${isSLABreached ? 'bg-red-500/10 text-red-400 border border-red-500/20' : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'}`}>
                        {isSLABreached ? <AlertCircle className="w-5 h-5" /> : <Clock className="w-5 h-5" />}
                    </div>
                    <div>
                        <h3 className="text-base font-bold text-white flex items-center gap-2">
                            SLA Status: {isSLABreached ? 'BREACHED' : 'ON TRACK'}
                        </h3>
                        <p className="text-xs text-gray-400">
                            {isSLABreached
                                ? `Resolution target (${ticket.sla_hours || 4}h ${ticket.priority ? String(ticket.priority).toUpperCase() : ''} Priority) was missed.`
                                : 'Ticket is progressing within target SLA window.'}
                        </p>
                    </div>
                </div>
                {/* Overdue / Target Stats Pills */}
                <div className="flex items-center gap-2">
                    <div className="px-3 py-1.5 bg-white/5 border border-white/10 rounded-lg text-center">
                        <div className="text-sm font-black text-white">{ticket.sla_hours || 24}h</div>
                        <div className="text-[9px] text-gray-400 uppercase tracking-wide">Target</div>
                    </div>
                    {isSLABreached && (
                        <div className="px-3 py-1.5 bg-red-500/15 border border-red-500/30 rounded-lg text-center">
                            <div className="text-sm font-black text-red-400">{formatDuration(breachMs)}</div>
                            <div className="text-[9px] text-gray-400 uppercase tracking-wide">Overdue By</div>
                        </div>
                    )}
                    {(ticket.total_paused_minutes || 0) > 0 && (
                        <div className="px-3 py-1.5 bg-yellow-500/10 border border-yellow-500/20 rounded-lg text-center">
                            <div className="text-sm font-black text-yellow-400">{formatDuration((ticket.total_paused_minutes || 0) * 60000)}</div>
                            <div className="text-[9px] text-gray-400 uppercase tracking-wide">Time Paused</div>
                        </div>
                    )}
                </div>
            </div>
            {/* "WHY" Breach Timeline Breakdown */}
            <div className="relative pl-4 space-y-4">
                <div className="absolute left-[7px] top-2 bottom-2 w-px bg-[#30363d]" />
                {/* 1. Ticket Created */}
                <div className="flex items-center gap-3">
                    <div className="w-3.5 h-3.5 rounded-full bg-gray-500 border-2 border-[#0d1117] flex-shrink-0 z-10" />
                    <div className="flex-1 flex items-center justify-between text-xs">
                        <span className="text-gray-400">Ticket Created</span>
                        <span className="text-gray-500">{new Date(ticket.created_at).toLocaleString()}</span>
                    </div>
                </div>
                {/* 2. SLA Clock Started */}
                {ticket.assigned_at && (
                    <div className="flex items-center gap-3">
                        <div className="w-3.5 h-3.5 rounded-full bg-blue-500 border-2 border-[#0d1117] flex-shrink-0 z-10" />
                        <div className="flex-1 flex items-center justify-between text-xs">
                            <span className="text-gray-400">SLA Clock Started <span className="text-gray-600">(Assigned)</span></span>
                            <span className="text-gray-500">{new Date(ticket.assigned_at).toLocaleString()}</span>
                        </div>
                    </div>
                )}
                {/* 3. Paused Duration & Reason */}
                {(ticket.total_paused_minutes || 0) > 0 && (
                    <div className="flex items-center gap-3">
                        <div className="w-3.5 h-3.5 rounded-full bg-yellow-500 border-2 border-[#0d1117] flex-shrink-0 z-10" />
                        <div className="flex-1 flex items-center justify-between text-xs">
                            <span className="text-yellow-400/90">
                                SLA Paused {ticket.sla_pause_reason && `— ${ticket.sla_pause_reason}`}
                            </span>
                            <span className="text-yellow-500/70">+{formatDuration((ticket.total_paused_minutes || 0) * 60000)} extended</span>
                        </div>
                    </div>
                )}
                {/* 4. SLA Deadline Row */}
                <div className={`flex items-center gap-3 rounded-lg px-3 py-2 -ml-2 ${isSLABreached ? 'bg-red-500/10' : 'bg-emerald-500/10'}`}>
                    <div className={`w-3.5 h-3.5 rounded-full border-2 border-[#0d1117] flex-shrink-0 z-10 ${isSLABreached ? 'bg-red-500' : 'bg-emerald-500'}`} />
                    <div className="flex-1 flex items-center justify-between text-xs font-bold">
                        <span className={isSLABreached ? 'text-red-400' : 'text-emerald-400'}>
                            SLA Deadline {isSLABreached ? '— Missed' : '— Met'}
                        </span>
                        <span className={isSLABreached ? 'text-red-400' : 'text-emerald-400'}>
                            {slaDeadline ? slaDeadline.toLocaleString() : 'Missed Deadline'}
                        </span>

                    </div>
                </div>
                {/* 5. Resolution / Work Completed */}
                {resolvedAt && (
                    <div className="flex items-center gap-3">
                        <div className="w-3.5 h-3.5 rounded-full bg-emerald-500 border-2 border-[#0d1117] flex-shrink-0 z-10" />
                        <div className="flex-1 flex items-center justify-between text-xs">
                            <span className="text-emerald-400 font-medium">
                                Resolved
                                {isSLABreached && <span className="text-red-400/70 ml-1.5">(+{formatDuration(breachMs)} late)</span>}
                            </span>
                            <span className="text-gray-500">{resolvedAt.toLocaleString()}</span>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

export default SLABreachDetailsCard;
