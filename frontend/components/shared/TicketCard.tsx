'use client';

import React, { useState, useEffect, useRef, useId, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Pencil, Trash2, CheckCircle2, XCircle, Share2, Timer, Box, Lock, MoreHorizontal, ChevronRight } from 'lucide-react';
import { motion } from 'framer-motion';
import ShareModal from './ShareModal';
import { parseDate } from '@/frontend/utils/date';
import { SLABadge } from '@/frontend/components/tickets/SLABreachDetailsCard';
import { useIsDesktop } from '@/frontend/components/task-manager/assign/Sheet';

/**
 * Owner 2026-11-15: the grid every ticket list uses, so a card is never squeezed. One column on phones; from `sm` up
 * as many columns as fit at 360px or wider (two on a 1280px laptop with the sidebar open).
 */
export const TICKET_GRID_CLASS = 'grid grid-cols-1 sm:grid-cols-[repeat(auto-fill,minmax(min(360px,100%),1fr))]';

interface TicketAction {
    key: string;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    danger?: boolean;
    run: (e: React.MouseEvent) => void;
}

/**
 * Owner 2026-11-15: the card's one "⋯" button. Below `sm` it opens a sheet from the bottom of the screen; from `sm` up a
 * small menu under the button. Each entry calls the same handler the old Share / Edit / Delete icons did. Clicks never
 * reach the card (which would open the ticket). Esc closes and puts focus back on the button.
 */
function TicketActionsMenu({ actions, open, setOpen, ticketNumber, title }: {
    actions: TicketAction[];
    open: boolean;
    setOpen: (open: boolean) => void;
    ticketNumber: string;
    title: string;
}) {
    const desktop = useIsDesktop();
    const buttonRef = useRef<HTMLButtonElement>(null);
    const menuRef = useRef<HTMLDivElement>(null);
    const menuId = useId();

    const close = useCallback((returnFocus = true) => {
        setOpen(false);
        if (returnFocus) buttonRef.current?.focus();
    }, [setOpen]);

    // Focus the first entry when the menu opens.
    useEffect(() => {
        if (!open) return;
        const raf = requestAnimationFrame(() => menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus());
        return () => cancelAnimationFrame(raf);
    }, [open, desktop]);

    // Esc closes; a click outside closes the desktop menu; the phone sheet stops the page scrolling behind it.
    useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); close(); } };
        const onDown = (e: MouseEvent) => {
            if (!desktop) return;
            const target = e.target as Node;
            if (menuRef.current?.contains(target) || buttonRef.current?.contains(target)) return;
            setOpen(false);
        };
        document.addEventListener('keydown', onKey);
        document.addEventListener('mousedown', onDown);
        const overflow = document.body.style.overflow;
        if (!desktop) document.body.style.overflow = 'hidden';
        return () => {
            document.removeEventListener('keydown', onKey);
            document.removeEventListener('mousedown', onDown);
            if (!desktop) document.body.style.overflow = overflow;
        };
    }, [open, desktop, close, setOpen]);

    const onMenuKey = (e: React.KeyboardEvent) => {
        const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
        const i = items.indexOf(document.activeElement as HTMLElement);
        if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length]?.focus(); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length]?.focus(); }
        else if (e.key === 'Home') { e.preventDefault(); items[0]?.focus(); }
        else if (e.key === 'End') { e.preventDefault(); items[items.length - 1]?.focus(); }
        else if (e.key === 'Tab' && desktop) close(false);
    };

    const pick = (action: TicketAction) => (e: React.MouseEvent) => {
        e.stopPropagation();
        close();
        action.run(e);
    };

    return (
        <>
            <button
                ref={buttonRef}
                type="button"
                aria-label="More actions for this ticket"
                aria-haspopup="menu"
                aria-expanded={open}
                aria-controls={open ? menuId : undefined}
                onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
                className={`-mr-2.5 -mt-2.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-[12px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${open ? 'bg-indigo-100 text-indigo-800' : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'}`}
            >
                <MoreHorizontal className="h-[22px] w-[22px]" aria-hidden="true" />
            </button>

            {/* Desktop: small menu under the button (positioned against the card, which is `relative`). */}
            {open && desktop && (
                <div
                    ref={menuRef}
                    id={menuId}
                    role="menu"
                    aria-label="Ticket actions"
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={onMenuKey}
                    className="absolute right-3 top-[52px] z-50 flex w-[200px] flex-col rounded-[12px] border border-gray-200 bg-white p-1.5 shadow-[0_12px_32px_rgba(15,23,42,0.18)]"
                >
                    {actions.map(action => {
                        const Icon = action.icon;
                        return (
                            <button
                                key={action.key}
                                type="button"
                                role="menuitem"
                                onClick={pick(action)}
                                className={`flex h-10 items-center gap-2.5 rounded-[8px] px-2.5 text-left text-[15px] font-semibold outline-none hover:bg-slate-100 focus-visible:bg-slate-100 ${action.danger ? 'text-red-700' : 'text-gray-900'}`}
                            >
                                <Icon className={`h-[18px] w-[18px] shrink-0 ${action.danger ? 'text-red-700' : 'text-gray-700'}`} />
                                {action.label}
                            </button>
                        );
                    })}
                </div>
            )}

            {/* Phone: a sheet from the bottom of the screen, rendered into <body>. */}
            {open && !desktop && typeof document !== 'undefined' && createPortal(
                <div className="fixed inset-0 z-[70]" onClick={(e) => e.stopPropagation()}>
                    <button type="button" tabIndex={-1} aria-label="Close" onClick={() => close()} className="absolute inset-0 h-full w-full cursor-default bg-slate-900/45" />
                    <div
                        role="dialog"
                        aria-modal="true"
                        aria-label="Ticket actions"
                        className="absolute inset-x-0 bottom-0 flex flex-col gap-[4px] rounded-t-[22px] bg-white px-4 pt-2 pb-[max(1.75rem,env(safe-area-inset-bottom))] text-gray-900 shadow-[0_-10px_30px_rgba(15,23,42,0.2)]"
                        style={{ fontFamily: 'var(--font-body)' }}
                    >
                        <span aria-hidden="true" className="mb-2 h-[5px] w-10 self-center rounded-full bg-gray-300" />
                        <p className="mx-1 mb-2 line-clamp-2 text-[13px] text-gray-600">
                            <span className="font-mono text-gray-700">{ticketNumber}</span> · {title}
                        </p>
                        <div ref={menuRef} id={menuId} role="menu" aria-label="Ticket actions" onKeyDown={onMenuKey} className="flex flex-col gap-[4px]">
                            {actions.map(action => {
                                const Icon = action.icon;
                                return (
                                    <button
                                        key={action.key}
                                        type="button"
                                        role="menuitem"
                                        onClick={pick(action)}
                                        className={`flex h-14 items-center gap-3.5 rounded-[14px] px-3 text-left text-[17px] font-semibold outline-none active:bg-slate-100 focus-visible:bg-slate-100 ${action.danger ? 'text-red-700' : 'text-gray-900'}`}
                                    >
                                        <Icon className={`h-[22px] w-[22px] shrink-0 ${action.danger ? 'text-red-700' : 'text-gray-700'}`} />
                                        {action.label}
                                    </button>
                                );
                            })}
                        </div>
                        <button type="button" onClick={() => close()} className="mt-1.5 h-[52px] rounded-[14px] bg-slate-100 text-base font-bold text-gray-900 active:bg-slate-200">
                            Cancel
                        </button>
                    </div>
                </div>,
                document.body,
            )}
        </>
    );
}

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
    slaDeadline?: string | null;
    slaBreached?: boolean;
    slaPaused?: boolean;
    slaPauseReason?: string | null;

    // Visual hint
    raisedByTenant?: boolean; // yellow border when ticket was raised by a client/tenant (internal === false)
    hasMaterialRequest?: boolean; // indicator for procurement needs
    isInternal?: boolean; // badge when ticket is internal (not visible to tenants)

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
    slaDeadline,
    slaBreached,
    slaPaused,
    slaPauseReason,
    raisedByTenant,
    isInternal,
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
    const [menuOpen, setMenuOpen] = useState(false);

    // The same three actions the card always had; Edit and Delete only when the screen passes their handlers.
    const actions: TicketAction[] = [
        { key: 'share', label: 'Share ticket', icon: Share2, run: () => setShareOpen(true) },
        ...(onEdit ? [{ key: 'edit', label: 'Edit request', icon: Pencil, run: (e: React.MouseEvent) => onEdit(e) }] : []),
        ...(onDelete ? [{ key: 'delete', label: 'Delete request', icon: Trash2, danger: true, run: (e: React.MouseEvent) => onDelete(e) }] : []),
    ];

    // Normalize status - replace spaces with underscores for consistent comparison
    const normalizedStatus = (status || '').toUpperCase().replace(/\s+/g, '_');

    // Tickets that are "resolved by our side" - work is complete, timer should stop
    const isResolvedByUs = normalizedStatus === 'PENDING_VALIDATION';
    // Tickets that are fully closed (tenant approved or admin closed)
    const isFullyClosed = ['COMPLETED', 'CLOSED', 'RESOLVED'].includes(normalizedStatus);
    const isCritical = priority?.toUpperCase() === 'CRITICAL' && !isFullyClosed;

    // Real-time SLA breach evaluation (never breached while paused)
    const parsedDeadline = slaDeadline ? parseDate(slaDeadline) : null;
    const computedIsBreached = !slaPaused && (Boolean(slaBreached) ||
        (parsedDeadline !== null && parsedDeadline.getTime() < Date.now() && !isResolvedByUs && !isFullyClosed));


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
    // Same colour steps as before; text one shade darker so the 12px timer stays readable.
    const timerColor = isResolvedByUs || isFullyClosed
        ? 'text-violet-700 bg-violet-50'  // Violet for pending validation / closed
        : elapsedSec < 3600         ? 'text-emerald-700 bg-emerald-50'   // < 1h: green
        : elapsedSec < 86400        ? 'text-amber-800 bg-amber-50'       // < 1d: yellow
        : elapsedSec < 86400 * 3   ? 'text-orange-700 bg-orange-50'     // < 3d: orange
        : 'text-rose-700 bg-rose-50 animate-pulse';                       // > 3d: red pulse

    const initialsOf = (name: string) => name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
    const showServing = Boolean(assignedTo && status !== 'OPEN');
    // Card contract: never repeat the title as the description.
    const showDescription = Boolean(description && description.trim() && description.trim().toLowerCase() !== (title || '').trim().toLowerCase());
    const chip = 'inline-flex h-6 items-center gap-[4px] rounded-full border px-2.5 text-xs font-bold';
    const capsChip = `${chip} uppercase tracking-[0.02em]`;

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
            className={`@container relative w-full h-full min-w-0 bg-white rounded-2xl px-3.5 pt-3.5 pb-1 @sm:px-4 @sm:pt-4 @sm:pb-1.5 cursor-pointer transition-shadow hover:shadow-md flex flex-col gap-2.5 ${isCritical ? 'border-2' : ''} ${menuOpen ? 'z-30' : ''}`}
            style={{
                scrollMarginTop: '100px',
                ...(isCritical
                    ? { borderStyle: 'solid' }
                    : raisedByTenant
                        ? { border: '2px solid #F59E0B', boxShadow: '0 0 0 3px rgba(245,158,11,0.1)' }
                        : { border: '1px solid #e5e7eb' })
            }}
        >
            {/* Header: photo (in flow, left) + title/description + the one "⋯" actions button */}
            <div className="flex items-start gap-[12px]">
                {photoUrl && (
                    // Desktop keeps the hover zoom; it grows to the right/down and stays under the actions menu (z-50).
                    <div className="relative z-10 h-10 w-10 shrink-0 @sm:h-11 @sm:w-11">
                        <img
                            src={photoUrl}
                            alt="Site photo"
                            className="h-full w-full origin-top-left rounded-[8px] border border-gray-200 object-cover transition-transform duration-300 sm:hover:scale-[4] sm:hover:shadow-2xl"
                        />
                    </div>
                )}
                <div className="min-w-0 flex-1">
                    {/* A <p role="heading">, not an <h3>: globals.css forces every h3 to weight 500 (and 18px on phones). */}
                    <p role="heading" aria-level={3} className="line-clamp-3 break-words text-base font-bold leading-[1.3] text-gray-900" title={title}>
                        {title}
                    </p>
                    {showDescription && (
                        <p className="mt-1 line-clamp-2 break-words text-sm leading-[1.4] text-gray-600" title={description}>
                            {description}
                        </p>
                    )}
                </div>
                <TicketActionsMenu actions={actions} open={menuOpen} setOpen={setMenuOpen} ticketNumber={ticketNumber} title={title} />
            </div>

            {/* Badges */}
            <div className="flex flex-wrap items-center gap-1.5">
                <span className={`${capsChip} ${PRIORITY_STYLES[priority]}`}>
                    {priority}
                </span>

                <span className={`${capsChip} border-transparent ${STATUS_STYLES[normalizedStatus as keyof typeof STATUS_STYLES] || 'bg-gray-100 text-gray-700'}`}>
                    {status?.replace(/_/g, ' ')}
                </span>

                {isInternal && (
                    <span className={`${capsChip} bg-slate-800 text-white border-slate-800`}>
                        <Lock className="h-3 w-3" aria-hidden="true" />
                        Internal
                    </span>
                )}

                <SLABadge
                    slaDeadline={slaDeadline ?? null}
                    isBreached={computedIsBreached}
                    isPaused={Boolean(slaPaused)}
                    pauseReason={slaPauseReason}
                    readable
                />

                {propertyName && (
                    <span className={`${chip} max-w-full bg-indigo-50 text-indigo-700 border-indigo-200`}>
                        <svg className="h-3 w-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                        </svg>
                        <span className="truncate">{propertyName}</span>
                    </span>
                )}

                {hasMaterialRequest && (
                    <span className={`${chip} bg-fuchsia-100 text-fuchsia-800 border-fuchsia-200`}>
                        <Box className="h-3 w-3" aria-hidden="true" />
                        Materials
                    </span>
                )}
            </div>

            {/* Raised by / Serving: two labelled rows in a narrow card, one line in a wide one */}
            {(raisedBy || showServing) && (
                <div className="flex flex-col gap-1.5 text-sm @sm:flex-row @sm:flex-wrap @sm:items-center @sm:gap-x-2 @sm:gap-y-1">
                    {raisedBy && (
                        <div className="flex min-w-0 max-w-full items-center gap-[8px]">
                            <span className="w-[72px] shrink-0 text-gray-600 @sm:w-auto">Raised by</span>
                            <span className="h-[22px] w-[22px] shrink-0 overflow-hidden rounded-full border border-indigo-200 bg-indigo-50 text-indigo-800" aria-hidden="true">
                                {raisedByPhotoUrl ? (
                                    <img src={raisedByPhotoUrl} alt="" className="h-full w-full object-cover" />
                                ) : (
                                    <span className="flex h-full w-full items-center justify-center text-[10px] font-bold">{initialsOf(raisedBy)}</span>
                                )}
                            </span>
                            <span className="min-w-0 truncate font-semibold text-indigo-800" title={raisedBy}>{raisedBy}</span>
                        </div>
                    )}
                    {raisedBy && showServing && <span aria-hidden="true" className="hidden text-gray-300 @sm:inline">|</span>}
                    {showServing && assignedTo && (
                        <div className="flex min-w-0 max-w-full items-center gap-[8px]">
                            <span className="w-[72px] shrink-0 text-gray-600 @sm:w-auto">Serving</span>
                            <span className="h-[22px] w-[22px] shrink-0 overflow-hidden rounded-full border border-blue-200 bg-blue-100 text-blue-800" aria-hidden="true">
                                {assigneePhotoUrl ? (
                                    <img src={assigneePhotoUrl} alt="" className="h-full w-full object-cover" />
                                ) : (
                                    <span className="flex h-full w-full items-center justify-center text-[10px] font-bold">{initialsOf(assignedTo)}</span>
                                )}
                            </span>
                            <span className="min-w-0 truncate font-semibold text-gray-900" title={assignedTo}>{assignedTo}</span>
                        </div>
                    )}
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

            {/* Footer: ticket number · date and the timer on the left; a slim "View" on the right (same action as the card) */}
            <div className="mt-auto flex min-w-0 items-center justify-between gap-[8px] border-t border-slate-100 pt-1">
                <div className="flex min-w-0 flex-col gap-[3px] py-1.5 @sm:flex-row @sm:flex-wrap @sm:items-center @sm:gap-x-2">
                    <span className="text-xs text-gray-600 @sm:text-[13px]">
                        <span className="font-mono text-gray-700">{ticketNumber}</span> · <span className="tabular-nums">{formattedDate}</span>
                    </span>
                    {/* Live elapsed timer */}
                    <span className={`inline-flex h-[22px] w-fit items-center gap-[4px] rounded-[8px] px-2 text-xs font-bold tabular-nums ${timerColor}`}>
                        <Timer className="h-3 w-3 shrink-0" aria-hidden="true" />
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
                    </span>
                </div>

                <button
                    type="button"
                    aria-label={`View ticket ${ticketNumber}`}
                    className="-mr-1 flex h-11 shrink-0 items-center gap-0.5 rounded-[8px] pl-3 pr-1 text-[15px] font-bold text-blue-700 transition-colors hover:bg-blue-50 hover:text-blue-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
                    onClick={(e) => {
                        e.stopPropagation();
                        onClick();
                    }}
                >
                    View
                    <ChevronRight className="h-[18px] w-[18px]" strokeWidth={2.5} aria-hidden="true" />
                </button>
            </div>

            {/* Validation Actions — shown only when pending client approval */}
            {normalizedStatus === 'PENDING_VALIDATION' && (onValidate || onReject) && (
                <div className="flex gap-2 pt-[clamp(0.5rem,2cqw,0.75rem)] mb-2.5 border-t border-violet-100">
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
