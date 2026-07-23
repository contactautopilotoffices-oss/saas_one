'use client';

import React, { useState, useEffect } from 'react';
import Image from 'next/image';
import { Pencil, Trash2, CheckCircle2, XCircle, Share2, Timer, Box } from 'lucide-react';
import { motion } from 'framer-motion';
import ShareModal from './ShareModal';
import { parseDate } from '@/frontend/utils/date';

/**
 * THE Standard Ticket Card Component
 * 
 * This is the ONLY ticket card component allowed in the application.
 * Any ticket appearing in a list MUST use this component.
 * 
 * Contract: See TICKET_CARD_CONTRACT.md
 */

export interface TicketCardProps {
    // Core Data
    id: string;
    title: string;
    description?: string;
    priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    status: 'ASSIGNED' | 'IN_PROGRESS' | 'COMPLETED' | 'OPEN' | 'PENDING_VALIDATION' | 'WAITLISTED';

    // Metadata
    ticketNumber: string;
    createdAt: string; // ISO date string
    raisedBy?: string; // Full name of the creator
    raisedByPhotoUrl?: string | null; // Profile photo for the person who raised it

    // Optional
    assignedTo?: string; // Full name
    assigneePhotoUrl?: string | null; // Profile photo for the person serving the request
    photoUrl?: string;
    resolvedAt?: string | null; // ISO date string for when the ticket was completed
    updatedAt?: string | null; // ISO date string - used when resolvedAt is not set
    propertyName?: string; // Property name for Super Admin view
    escalationChain?: { name: string; avatar?: string | null }[]; // Ordered: [original → ... → current]

    // Visual hint
    raisedByTenant?: boolean; // yellow border when ticket was raised by a client/tenant (internal === false)
    hasMaterialRequest?: boolean; // indicator for procurement needs

    // Actions
    onClick: () => void;
    onEdit?: (e: React.MouseEvent) => void;
    onDelete?: (e: React.MouseEvent) => void;
    // Validation actions (shown when status is PENDING_VALIDATION)
    onValidate?: (e: React.MouseEvent) => void;
    onReject?: (e: React.MouseEvent) => void;
}

const PRIORITY_STYLES = {
    LOW: 'bg-blue-50 text-blue-700 border-blue-200',
    MEDIUM: 'bg-amber-50 text-amber-700 border-amber-200',
    HIGH: 'bg-orange-50 text-orange-700 border-orange-200',
    CRITICAL: 'bg-rose-50 text-rose-700 border-rose-200',
} as const;

const STATUS_STYLES = {
    OPEN: 'bg-gray-100 text-gray-700',
    ASSIGNED: 'bg-blue-100 text-blue-700',
    IN_PROGRESS: 'bg-amber-100 text-amber-700',
    COMPLETED: 'bg-emerald-100 text-emerald-700',
    PENDING_VALIDATION: 'bg-violet-100 text-violet-700',
    WAITLISTED: 'bg-purple-100 text-purple-700',
} as const;

export default function TicketCard({
    id,
    title,
    description,
    priority,
    status,
    ticketNumber,
    createdAt,
    raisedBy,
    raisedByPhotoUrl,
    assignedTo,
    assigneePhotoUrl,
    photoUrl,
    resolvedAt,
    updatedAt,
    propertyName,
    escalationChain,
    raisedByTenant,
    onClick,
    onEdit,
    onDelete,
    onValidate,
    onReject,
    hasMaterialRequest,
}: TicketCardProps) {
    const dateObj = parseDate(createdAt) || new Date();
    const dateStr = dateObj.toLocaleDateString('en-US', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
    });
    const timeStr = dateObj.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
    });
    const formattedDate = `${dateStr} • ${timeStr}`;


    const [shareOpen, setShareOpen] = useState(false);

    // Normalize status - replace spaces with underscores for consistent comparison
    const normalizedStatus = (status || '').toUpperCase().replace(/\s+/g, '_');

    // Tickets that are "resolved by our side" - work is complete, timer should stop
    const isResolvedByUs = normalizedStatus === 'PENDING_VALIDATION';
    // Tickets that are fully closed (tenant approved or admin closed)
    const isFullyClosed = ['COMPLETED', 'CLOSED', 'RESOLVED'].includes(normalizedStatus);
    const isCritical = priority?.toUpperCase() === 'CRITICAL' && !isFullyClosed;

    // Live elapsed timer — counts up every second for active tickets
    // For pending_validation tickets, timer stops (work is done by our side)
    const getElapsed = () => {
        const start = parseDate(createdAt);
        if (!start) return { seconds: 0, endTime: null };

        // For resolved/closed tickets, use resolvedAt or updatedAt as end time
        if (isResolvedByUs || isFullyClosed) {
            // Try resolvedAt first, then updatedAt, then current time
            const endTime = parseDate(resolvedAt) || parseDate(updatedAt || '') || new Date();
            return { seconds: Math.floor((endTime.getTime() - start.getTime()) / 1000), endTime };
        }

        // Active ticket - use current time
        return { seconds: Math.floor((new Date().getTime() - start.getTime()) / 1000), endTime: null };
    };

    const elapsedData = getElapsed();
    const [elapsedSec, setElapsedSec] = useState(elapsedData.seconds);

    useEffect(() => {
        // No live update for resolved by us or fully closed tickets
        if (isResolvedByUs || isFullyClosed) return;

        const id = setInterval(() => setElapsedSec(getElapsed().seconds), 1000);
        return () => clearInterval(id);
    }, [createdAt, isResolvedByUs, isFullyClosed]);

    const formatElapsed = (sec: number) => {
        const d = Math.floor(sec / 86400);
        const h = Math.floor((sec % 86400) / 3600);
        const m = Math.floor((sec % 3600) / 60);
        const s = sec % 60;
        if (d > 0) return `${d}d ${h}h ${m}m`;
        if (h > 0) return `${h}h ${m}m ${s}s`;
        if (m > 0) return `${m}m ${s}s`;
        return `${s}s`;
    };

    // Format the end time in local format for display
    const formatEndTime = (date: Date | null) => {
        if (!date) return null;
        return date.toLocaleString('en-US', {
            day: '2-digit',
            month: 'short',
            hour: '2-digit',
            minute: '2-digit',
            hour12: true
        });
    };

    // Color based on age of active ticket
    const timerColor = isResolvedByUs || isFullyClosed
        ? 'text-violet-600 bg-violet-50'  // Violet for pending validation / closed
        : elapsedSec < 3600         ? 'text-emerald-600 bg-emerald-50'   // < 1h: green
        : elapsedSec < 86400        ? 'text-amber-600 bg-amber-50'       // < 1d: yellow
        : elapsedSec < 86400 * 3   ? 'text-orange-600 bg-orange-50'     // < 3d: orange
        : 'text-rose-600 bg-rose-50 animate-pulse';                       // > 3d: red pulse

    return (
        <motion.div
            id={`ticket-${id}`}
            onClick={onClick}
            initial={isCritical ? { scale: 1 } : false}
            animate={isCritical ? {
                boxShadow: [
                    '0 0 0 0px rgba(225, 29, 72, 0)',
                    '0 0 30px 6px rgba(225, 29, 72, 0.6)',
                    '0 0 0 0px rgba(225, 29, 72, 0)'
                ],
                borderColor: ['#e11d48', '#fb7185', '#e11d48'],
                scale: [1, 1.02, 1]
            } : {}}
            transition={isCritical ? {
                duration: 2,
                repeat: Infinity,
                ease: "easeInOut"
            } : {}}
            className={`@container relative w-full h-full bg-white rounded-2xl p-3 cursor-pointer transition-all hover:shadow-md flex flex-col gap-2 ${isCritical ? 'border-2' : ''}`}
            style={{
                scrollMarginTop: '100px',
                ...(isCritical
                    ? { borderStyle: 'solid' }
                    : raisedByTenant
                        ? { border: '2px solid #F59E0B', boxShadow: '0 0 0 3px rgba(245,158,11,0.1)' }
                        : { border: '1px solid #e5e7eb' })
            }}
        >
            {/* Photo Thumbnail in absolute top-left corner */}
            {photoUrl && (
                <div className="absolute top-3 left-3 w-12 h-12 z-40 group cursor-pointer">
                    <img
                        src={photoUrl}
                        alt="Site photo"
                        className="w-12 h-12 object-cover rounded-md shadow-sm border border-gray-200 transition-all duration-300 origin-top-left relative group-hover:scale-[4] group-hover:shadow-2xl"
                    />
                </div>
            )}

            {/* Header: Title + Actions */}
            <div className={`flex items-start justify-between gap-2 relative z-20 ${photoUrl ? 'pl-14 sm:pl-16 min-h-[48px]' : ''}`}>
                <div className="flex-1 min-w-0">
                    {/* Title */}
                    <h3 className="text-sm font-semibold text-gray-900 leading-snug line-clamp-2 break-words pr-2" title={title}>
                        {title}
                    </h3>
                    {description && (
                        <p className="text-xs text-gray-500 mt-1 leading-snug line-clamp-2 break-words pr-2" title={description}>
                            {description}
                        </p>
                    )}
                </div>

                {/* Actions Container: Grouped and Top-Right - Compact on mobile */}
                <div className="flex items-center gap-0.5 sm:gap-1 shrink-0 bg-gray-50/80 p-0.5 sm:p-1 rounded-lg sm:rounded-xl border border-gray-100">
                    <button
                        onClick={(e) => { e.stopPropagation(); setShareOpen(true); }}
                        className="p-1 sm:p-1.5 text-gray-400 hover:text-blue-600 hover:bg-white rounded-md sm:rounded-lg transition-all"
                        title="Share Ticket"
                    >
                        <Share2 className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                    </button>
                    {onEdit && (
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                onEdit(e);
                            }}
                            className="p-1 sm:p-1.5 text-gray-400 hover:text-blue-600 hover:bg-white rounded-md sm:rounded-lg transition-all"
                            title="Edit Request"
                        >
                            <Pencil className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                        </button>
                    )}
                    {onDelete && (
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                onDelete(e);
                            }}
                            className="p-1 sm:p-1.5 text-gray-400 hover:text-red-600 hover:bg-white rounded-md sm:rounded-lg transition-all"
                            title="Delete Request"
                        >
                            <Trash2 className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                        </button>
                    )}
                </div>
            </div>

            {/* Badges Flow */}
            <div className="flex flex-wrap items-center gap-1.5">
                <span
                    className={`
                        px-2 py-0.5 rounded-full 
                        text-[10px] font-bold uppercase border
                        ${PRIORITY_STYLES[priority]}
                    `}
                >
                    {priority}
                </span>

                <span
                    className={`
                        px-2 py-0.5 rounded-full
                        text-[10px] font-medium uppercase
                        ${STATUS_STYLES[normalizedStatus as keyof typeof STATUS_STYLES] || 'bg-gray-100 text-gray-700'}
                    `}
                >
                    {status?.replace(/_/g, ' ')}
                </span>

                {propertyName && (
                    <span className="inline-flex items-center gap-1 px-[clamp(0.4rem,1.5cqw,0.6rem)] py-[clamp(0.15rem,0.5cqw,0.25rem)] bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-full text-[clamp(0.6rem,2.2cqw,0.7rem)] font-semibold">
                        <svg className="w-[clamp(0.6rem,2cqw,0.75rem)] h-[clamp(0.6rem,2cqw,0.75rem)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                        </svg>
                        {propertyName}
                    </span>
                )}

                {hasMaterialRequest && (
                    <span className="inline-flex items-center gap-1 px-[clamp(0.4rem,1.5cqw,0.6rem)] py-[clamp(0.15rem,0.5cqw,0.25rem)] bg-fuchsia-100 text-fuchsia-700 border border-fuchsia-200 rounded-full text-[clamp(0.6rem,2.2cqw,0.7rem)] font-bold shadow-sm">
                        <Box className="w-[clamp(0.6rem,2cqw,0.75rem)] h-[clamp(0.6rem,2cqw,0.75rem)]" />
                        Materials
                    </span>
                )}
            </div>

            {/* Raised By Information */}
            {raisedBy && (
                <div className="flex items-center gap-1.5">
                    <span className="text-[clamp(0.75rem,3cqw,0.875rem)] text-gray-600">Raised By:</span>
                    <div className="flex items-center gap-1.5 text-indigo-700">
                        <div className="w-5 h-5 rounded-full flex-shrink-0 border border-indigo-200 overflow-hidden bg-indigo-50">
                            {raisedByPhotoUrl ? (
                                <img src={raisedByPhotoUrl} alt={raisedBy} className="w-full h-full object-cover" />
                            ) : (
                                <div className="w-full h-full flex items-center justify-center text-[8px] font-bold">
                                    {raisedBy.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                                </div>
                            )}
                        </div>
                        <span className="text-[clamp(0.75rem,3cqw,0.875rem)] font-semibold">{raisedBy}</span>
                    </div>
                </div>
            )}

            {/* Assignee Information */}
            {assignedTo && status !== 'OPEN' && (
                <div className="flex items-center gap-1.5">
                    <span className="text-[clamp(0.75rem,3cqw,0.875rem)] text-gray-600">Serving Request:</span>
                    <div className="flex items-center gap-1.5">
                        <div className="w-5 h-5 rounded-full flex-shrink-0 border border-gray-200 overflow-hidden">
                            {assigneePhotoUrl ? (
                                <img src={assigneePhotoUrl} alt={assignedTo} className="w-full h-full object-cover" />
                            ) : (
                                <div className="w-full h-full flex items-center justify-center text-[8px] font-bold bg-blue-100 text-blue-700">
                                    {assignedTo.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                                </div>
                            )}
                        </div>
                        <span className="text-[clamp(0.75rem,3cqw,0.875rem)] font-semibold text-gray-900">{assignedTo}</span>
                    </div>
                </div>
            )}

            {/* Escalation Chain — circles with arrows */}
            {escalationChain && escalationChain.length > 0 && (
                <div className="flex items-center gap-1 flex-wrap">
                    <span className="text-[10px] text-red-500 font-semibold uppercase tracking-wider mr-1">Escalated</span>
                    {escalationChain.map((person, i) => {
                        const initials = person.name.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase();
                        const isLast = i === escalationChain.length - 1;
                        return (
                            <React.Fragment key={i}>
                                <div
                                    title={person.name}
                                    className={`w-6 h-6 rounded-full flex-shrink-0 border overflow-hidden
                                        ${isLast ? 'border-red-300' : 'border-gray-200'}`}
                                >
                                    {person.avatar ? (
                                        <img src={person.avatar} alt={person.name} className="w-full h-full object-cover" />
                                    ) : (
                                        <div className={`w-full h-full flex items-center justify-center text-[9px] font-bold
                                            ${isLast ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-500'}`}>
                                            {initials}
                                        </div>
                                    )}
                                </div>
                                {!isLast && (
                                    <svg className="w-3 h-3 text-red-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                                    </svg>
                                )}
                            </React.Fragment>
                        );
                    })}
                </div>
            )}

            {/* Footer Metadata + CTA */}
            <div className="mt-auto flex flex-col @sm:flex-row @sm:items-center justify-between gap-3 pt-3 border-t border-gray-100 min-w-0">
                <div className="flex flex-col gap-1 min-w-0">
                    <div className="flex items-center gap-2 text-[10px] text-text-tertiary">
                        <span className="font-mono bg-gray-50 px-1 py-0.5 rounded text-gray-600">{ticketNumber}</span>
                        <span className="text-gray-200">•</span>
                        <span className="font-medium">{formattedDate}</span>
                    </div>
                    {/* Live elapsed timer */}
                    <div className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-lg text-[9px] font-black w-fit ${timerColor}`}>
                        <Timer className="w-2.5 h-2.5 shrink-0" />
                        {(isResolvedByUs || isFullyClosed) ? (
                            <span>
                                Closed at {(() => {
                                    const closeTime = parseDate(resolvedAt || updatedAt || '') || new Date();
                                    return closeTime.toLocaleString('en-US', {
                                        month: 'short',
                                        day: '2-digit',
                                        hour: '2-digit',
                                        minute: '2-digit',
                                        hour12: true
                                    });
                                })()}
                            </span>
                        ) : (
                            formatElapsed(elapsedSec)
                        )}
                    </div>
                </div>

                <button
                    className="
                        w-full @sm:w-auto px-4 py-1.5
                        bg-blue-600 text-white rounded-xl
                        text-xs font-bold hover:bg-blue-700
                        transition-all active:scale-[0.98] shadow-sm shadow-blue-200
                    "
                    onClick={(e) => {
                        e.stopPropagation();
                        onClick();
                    }}
                >
                    View Ticket
                </button>
            </div>

            {/* Validation Actions — shown only when pending client approval */}
            {normalizedStatus === 'PENDING_VALIDATION' && (onValidate || onReject) && (
                <div className="flex gap-2 pt-[clamp(0.5rem,2cqw,0.75rem)] border-t border-violet-100">
                    {onValidate && (
                        <button
                            onClick={(e) => { e.stopPropagation(); onValidate(e); }}
                            className="flex-1 flex items-center justify-center gap-1.5 py-2 bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-bold rounded-xl transition-all active:scale-[0.98]"
                        >
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            Looks Good
                        </button>
                    )}
                    {onReject && (
                        <button
                            onClick={(e) => { e.stopPropagation(); onReject(e); }}
                            className="flex-1 flex items-center justify-center gap-1.5 py-2 bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 text-xs font-bold rounded-xl transition-all active:scale-[0.98]"
                        >
                            <XCircle className="w-3.5 h-3.5" />
                            Not Resolved
                        </button>
                    )}
                </div>
            )}

            <ShareModal
                isOpen={shareOpen}
                onClose={() => setShareOpen(false)}
                ticketId={id}
                ticketNumber={ticketNumber}
                title={title}
            />
        </motion.div>
    );
}
