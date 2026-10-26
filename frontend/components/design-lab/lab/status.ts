import {
    ArrowDown, ArrowUp, ChevronsUp, CircleCheckBig, CircleDot, CheckCircle2, Hourglass, Minus,
    Siren, UserCheck, Wrench, type LucideIcon,
} from 'lucide-react';
import type { Priority, TicketStatus } from './types';

/**
 * Status and priority vocabulary shared by all six designs.
 *
 * A status is always colour + icon + label. The colour comes from the design's own ramp
 * (index 0 is darkest for Open, 3 is lightest for Closed), the icon and label come from here.
 */

export const RED = '#E5484D';
export const RED_TEXT = '#C8282E';
export const RED_BG = '#FDECEC';

export const STATUS_META: Record<TicketStatus, { label: string; icon: LucideIcon; ramp: 0 | 1 | 2 | 3 }> = {
    open: { label: 'Open', icon: CircleDot, ramp: 0 },
    assigned: { label: 'Assigned', icon: UserCheck, ramp: 1 },
    in_progress: { label: 'In progress', icon: Wrench, ramp: 2 },
    waitlist: { label: 'Waitlist', icon: Hourglass, ramp: 1 },
    resolved: { label: 'Resolved', icon: CheckCircle2, ramp: 3 },
    closed: { label: 'Closed', icon: CircleCheckBig, ramp: 3 },
};

export const PRIORITY_META: Record<Priority, { label: string; icon: LucideIcon; rank: number }> = {
    critical: { label: 'Critical', icon: Siren, rank: 4 },
    urgent: { label: 'Urgent', icon: ChevronsUp, rank: 3 },
    high: { label: 'High', icon: ArrowUp, rank: 2 },
    medium: { label: 'Medium', icon: Minus, rank: 1 },
    low: { label: 'Low', icon: ArrowDown, rank: 0 },
};

export const ACTIVE_STATUSES: TicketStatus[] = ['open', 'assigned', 'in_progress'];

/** Raw DB statuses folded into the six the product shows. */
export function normalizeStatus(raw: string | null | undefined): TicketStatus {
    switch ((raw || '').toLowerCase()) {
        case 'assigned':
            return 'assigned';
        case 'in_progress':
        case 'work_started':
        case 'paused':
            return 'in_progress';
        case 'waitlist':
            return 'waitlist';
        case 'resolved':
        case 'pending_validation':
            return 'resolved';
        case 'closed':
        case 'satisfied':
            return 'closed';
        default:
            return 'open';
    }
}

export function normalizePriority(raw: string | null | undefined): Priority {
    const p = (raw || '').toLowerCase();
    if (p === 'critical' || p === 'urgent' || p === 'high' || p === 'low') return p;
    return 'medium';
}

/** The raw statuses each tab asks the existing tickets endpoint for. */
export const RAW_ACTIVE = 'open,assigned,in_progress,blocked,client_raised,paused,work_started';
export const RAW_CLOSED = 'resolved,closed,satisfied,pending_validation';
export const RAW_WAITLIST = 'waitlist';
