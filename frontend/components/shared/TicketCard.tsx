'use client';

import React, { useState, useEffect, useRef, useId, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Pencil, Trash2, CheckCircle2, XCircle, Share2, Box, Lock, MoreHorizontal, ChevronRight, Tag, Pause, AlertCircle, ImageOff } from 'lucide-react';
import { motion } from 'framer-motion';
import ShareModal from './ShareModal';
import { parseDate } from '@/frontend/utils/date';
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
    /** The ticket's own status is paused or blocked: its step on the strip turns striped. */
    workPaused?: boolean;

    // Visual hint
    raisedByTenant?: boolean; // yellow border when ticket was raised by a client/tenant (internal === false)
    hasMaterialRequest?: boolean; // indicator for procurement needs
    isVendorTagged?: boolean; // indicator when vendor procurement is tagged
    isInternal?: boolean; // badge when ticket is internal (not visible to tenants)

    // Actions
    onClick: () => void;
    onEdit?: (e: React.MouseEvent) => void;
    onDelete?: (e: React.MouseEvent) => void;
    // Validation actions (shown when status is PENDING_VALIDATION)
    onValidate?: (e: React.MouseEvent) => void;
    onReject?: (e: React.MouseEvent) => void;
}

/** The 5 fixed steps of the strip on top of the card (owner 2026-11-20). */
const CARD_STEPS = ['Reported', 'Assigned', 'In progress', 'Validation', 'Resolved'] as const;
const STEP_TONE = ['text-gray-700', 'text-blue-700', 'text-amber-800', 'text-violet-700', 'text-emerald-700'] as const;

const STATUS_LABEL: Record<string, string> = {
    OPEN: 'Open',
    ASSIGNED: 'Assigned',
    IN_PROGRESS: 'In progress',
    COMPLETED: 'Completed',
    PENDING_VALIDATION: 'Pending validation',
    WAITLISTED: 'Waitlisted',
};

/**
 * Owner 2026-11-20: the priority as a road sign on the corner of the photo (approved over text chips, to save space).
 * Low: blue circle with "i". Medium: amber warning triangle. High: orange diamond. Critical: red stop sign.
 * The shape changes as well as the colour, so it can be told apart without colour. Screen readers hear the word.
 */
const PRIORITY_SIGN: Record<TicketCardProps['priority'], { label: string; shape: React.ReactNode }> = {
    LOW: { label: 'Low', shape: <><circle cx="12" cy="12" r="10" fill="#3446A8" stroke="#FFFFFF" strokeWidth="2.2" /><circle cx="12" cy="7.4" r="1.6" fill="#FFFFFF" /><path d="M12 11v6.2" stroke="#FFFFFF" strokeWidth="2.8" strokeLinecap="round" /></> },
    MEDIUM: { label: 'Medium', shape: <><path d="M12 2.2 22.6 20.6H1.4z" fill="#9A5800" stroke="#FFFFFF" strokeWidth="2.2" strokeLinejoin="round" /><path d="M12 9.5v5" stroke="#FFFFFF" strokeWidth="2.6" strokeLinecap="round" /><circle cx="12" cy="17.6" r="1.4" fill="#FFFFFF" /></> },
    HIGH: { label: 'High', shape: <><path d="M12 1.6 22.4 12 12 22.4 1.6 12z" fill="#C4320A" stroke="#FFFFFF" strokeWidth="2.2" strokeLinejoin="round" /><path d="M12 7.4v5.6" stroke="#FFFFFF" strokeWidth="2.8" strokeLinecap="round" /><circle cx="12" cy="16.5" r="1.5" fill="#FFFFFF" /></> },
    CRITICAL: { label: 'Critical', shape: <><path d="M8 1.6h8l6.4 6.4v8L16 22.4H8L1.6 16V8z" fill="#B42318" stroke="#FFFFFF" strokeWidth="2.2" strokeLinejoin="round" /><path d="M12 6.5v7" stroke="#FFFFFF" strokeWidth="2.8" strokeLinecap="round" /><circle cx="12" cy="17.2" r="1.6" fill="#FFFFFF" /></> },
};

function PrioritySign({ priority }: { priority: TicketCardProps['priority'] }) {
    const sign = PRIORITY_SIGN[(priority || 'MEDIUM').toUpperCase() as TicketCardProps['priority']] ?? PRIORITY_SIGN.MEDIUM;
    return (
        <svg
            role="img"
            aria-label={`Priority: ${sign.label}`}
            viewBox="0 0 24 24"
            className="pointer-events-none absolute -bottom-1.5 -right-1.5 h-[22px] w-[22px] @sm:h-6 @sm:w-6"
        >
            <title>{`${sign.label} priority`}</title>
            {sign.shape}
        </svg>
    );
}

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
    workPaused,
    raisedByTenant,
    isInternal,
    onClick,
    onEdit,
    onDelete,
    onValidate,
    onReject,
    hasMaterialRequest,
    isVendorTagged,
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

    // Owner 2026-11-20 (approved design): a strip of 5 fixed steps on top, so every card lines up. The step follows
    // the ticket's status on its own; a paused or blocked ticket stays on its step, which turns striped amber.
    const stepNow = isFullyClosed ? 5 : isResolvedByUs ? 4 : normalizedStatus === 'IN_PROGRESS' ? 3 : normalizedStatus === 'ASSIGNED' ? 2 : 1;
    const isPausedNow = !isFullyClosed && !isResolvedByUs && Boolean(slaPaused || workPaused);
    const stripText = isFullyClosed
        ? (computedIsBreached ? 'Resolved · SLA breached' : 'Resolved')
        : `Step ${stepNow} of 5 · ${CARD_STEPS[stepNow - 1]}${isPausedNow ? ' (paused)' : ''}`;
    const stripTone = computedIsBreached ? 'text-red-700' : isFullyClosed ? 'text-emerald-700' : isPausedNow ? 'text-amber-800' : STEP_TONE[stepNow - 1];
    const closedAt = formatEndTime(elapsedData.endTime);
    // Time open, on the right of the strip. Same colour steps as the old timer chip, as text.
    const timeTone = isFullyClosed ? (computedIsBreached ? 'text-red-700' : 'text-emerald-700')
        : isResolvedByUs ? 'text-violet-700'
        : elapsedSec < 3600 ? 'text-emerald-700'
        : elapsedSec < 86400 ? 'text-amber-800'
        : elapsedSec < 86400 * 3 ? 'text-orange-700'
        : 'text-rose-700';
    const timeText = isFullyClosed ? `Done in ${formatElapsed(elapsedSec)}` : isResolvedByUs ? 'Awaiting validation' : `Open ${formatElapsed(elapsedSec)}`;
    const showWithinSla = Boolean(slaDeadline) && !computedIsBreached && !isPausedNow;

    const initialsOf = (name: string) => name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
    const showServing = Boolean(assignedTo && status !== 'OPEN');
    // Card contract: never repeat the title as the description.
    const showDescription = Boolean(description && description.trim() && description.trim().toLowerCase() !== (title || '').trim().toLowerCase());
    const chip = 'inline-flex h-6 items-center gap-[4px] rounded-full border px-2.5 text-xs font-bold';

    return (
        <motion.div
            id={`ticket-${id}`}
            onClick={onClick}
            className={`@container relative w-full h-full min-w-0 bg-white rounded-2xl px-3.5 pt-3 pb-1 @sm:px-4 @sm:pt-3 @sm:pb-1.5 cursor-pointer transition-shadow hover:shadow-md flex flex-col gap-2.5 ${menuOpen ? 'z-30' : ''}`}
            style={{
                scrollMarginTop: '100px',
                ...(isCritical
                    ? { border: '1.5px solid #F1A9A2' }
                    : raisedByTenant
                        ? { border: '2px solid #F59E0B', boxShadow: '0 0 0 3px rgba(245,158,11,0.1)' }
                        : { border: '1px solid #e5e7eb' })
            }}
        >
            {/* Progress strip: 5 fixed steps (Reported, Assigned, In progress, Validation, Resolved) and the time open */}
            <div className="flex flex-col gap-1.5">
                <div className="grid grid-cols-5 gap-[3px]" aria-hidden="true">
                    {CARD_STEPS.map((step, i) => {
                        const done = isFullyClosed || i < stepNow - 1;
                        const now = !done && i === stepNow - 1;
                        return (
                            <span
                                key={step}
                                className={`h-1 rounded-full ${done ? 'bg-emerald-600' : now ? (isPausedNow ? '' : 'bg-amber-500') : 'bg-gray-200'}`}
                                style={now && isPausedNow ? { backgroundImage: 'repeating-linear-gradient(135deg, #E08A00 0 5px, #F7C97A 5px 10px)' } : undefined}
                            />
                        );
                    })}
                </div>
                <div className="flex items-center justify-between gap-[8px] text-[12.5px] font-semibold">
                    <span className={`min-w-0 truncate ${stripTone}`}>{stripText}</span>
                    <span className={`shrink-0 tabular-nums ${timeTone}`} title={closedAt ? `Closed at ${closedAt}` : undefined}>{timeText}</span>
                </div>
            </div>

            {/* Header: photo with the priority sign on its corner + title (and the property) + the one "⋯" actions button */}
            <div className="flex items-start gap-[12px]">
                <div className="relative z-10 h-11 w-11 shrink-0 @sm:h-12 @sm:w-12">
                    {photoUrl ? (
                        // Desktop keeps the hover zoom; it grows to the right/down and stays under the actions menu (z-50).
                        <img
                            src={photoUrl}
                            alt="Site photo"
                            className="h-full w-full origin-top-left rounded-[10px] border border-gray-200 object-cover transition-transform duration-300 sm:hover:scale-[4] sm:hover:shadow-2xl"
                        />
                    ) : (
                        <span className="flex h-full w-full items-center justify-center rounded-[10px] border-[1.5px] border-dashed border-gray-300 text-gray-500">
                            <ImageOff className="h-[18px] w-[18px]" aria-label="No photo" />
                        </span>
                    )}
                    <PrioritySign priority={priority} />
                </div>
                <div className="min-w-0 flex-1">
                    {/* A <p role="heading">, not an <h3>: globals.css forces every h3 to weight 500 (and 18px on phones). */}
                    <p role="heading" aria-level={3} className="line-clamp-2 break-words text-base font-bold leading-[1.3] text-gray-900" title={title}>
                        {title}
                    </p>
                    {propertyName && (
                        <p className="mt-0.5 truncate text-[13px] text-gray-600" title={propertyName}>{propertyName}</p>
                    )}
                    {showDescription && (
                        <p className="mt-1 line-clamp-1 break-words text-sm leading-[1.4] text-gray-600" title={description}>
                            {description}
                        </p>
                    )}
                </div>
                <TicketActionsMenu actions={actions} open={menuOpen} setOpen={setMenuOpen} ticketNumber={ticketNumber} title={title} />
            </div>

            {/* Chips: status and flags (the priority is the sign on the photo) */}
            <div className="flex flex-wrap items-center gap-1.5">
                <span className={`${chip} border-transparent ${STATUS_STYLES[normalizedStatus as keyof typeof STATUS_STYLES] || 'bg-gray-100 text-gray-700'}`}>
                    {STATUS_LABEL[normalizedStatus] ?? status?.replace(/_/g, ' ')}
                </span>

                {isInternal && (
                    <span className={`${chip} bg-slate-800 text-white border-slate-800`}>
                        <Lock className="h-3 w-3" aria-hidden="true" />
                        Internal
                    </span>
                )}

                {showWithinSla && (
                    <span className={`${chip} bg-emerald-50 text-emerald-700 border-emerald-200`}>Within SLA</span>
                )}

                {isVendorTagged && (
                    <span className={`${chip} bg-cyan-50 text-cyan-800 border-cyan-200`}>
                        <Tag className="h-3 w-3" aria-hidden="true" />
                        Vendor tagged
                    </span>
                )}

                {hasMaterialRequest && (
                    <span className={`${chip} bg-fuchsia-100 text-fuchsia-800 border-fuchsia-200`}>
                        <Box className="h-3 w-3" aria-hidden="true" />
                        Materials
                    </span>
                )}
            </div>

            {/* SLA messages, in sentence case: why the clock is paused, or that it ran out */}
            {isPausedNow && slaPaused && (
                <div className="flex items-start gap-[8px] rounded-[8px] bg-amber-50 px-2.5 py-1.5 text-[13px] leading-[1.4] text-amber-900">
                    <Pause className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    <span className="line-clamp-2 break-words" title={slaPauseReason || undefined}>
                        <b className="font-bold">SLA paused:</b> {slaPauseReason || 'the SLA clock is on hold'}
                    </span>
                </div>
            )}
            {computedIsBreached && (
                <div className="flex items-start gap-[8px] rounded-[8px] bg-red-50 px-2.5 py-1.5 text-[13px] leading-[1.4] text-red-800">
                    <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    <span><b className="font-bold">SLA breached:</b> {isFullyClosed || isResolvedByUs ? 'closed after the SLA time ran out' : 'the SLA time has run out'}</span>
                </div>
            )}

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

            {/* Footer: ticket number · date on the left; a slim "View" on the right (same action as the card) */}
            <div className="mt-auto flex min-w-0 items-center justify-between gap-[8px] border-t border-slate-100 pt-1">
                <div className="flex min-w-0 flex-col gap-[3px] py-1.5 @sm:flex-row @sm:flex-wrap @sm:items-center @sm:gap-x-2">
                    <span className="text-xs text-gray-600 @sm:text-[13px]">
                        <span className="font-mono text-gray-700">{ticketNumber}</span> · <span className="tabular-nums">{formattedDate}</span>
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
