/**
 * View-model types for the Design Lab.
 *
 * Every design renders from these shapes, never from raw API rows, so the six designs stay
 * comparable and the live/sample switch happens in exactly one place (useLabModel).
 */

export type DesignId = 'ink' | 'bento' | 'contrast' | 'planner' | 'inbox' | 'skyline';
export type ScreenId = 'dashboard' | 'tickets' | 'detail';
export type Period = 'today' | 'month' | 'all';
export type PreviewState = 'normal' | 'loading' | 'empty' | 'error' | 'offline';

/** The six statuses the product exposes. Raw DB statuses are folded into these. */
export type TicketStatus = 'open' | 'assigned' | 'in_progress' | 'resolved' | 'closed' | 'waitlist';
export type Priority = 'low' | 'medium' | 'high' | 'urgent' | 'critical';
export type DataSource = 'live' | 'sample';

export interface LabTicket {
    id: string;
    number: string;
    title: string;
    status: TicketStatus;
    priority: Priority;
    category: string | null;
    location: string | null;
    raisedAt: Date;
    raisedBy: string | null;
    company: string | null;
    assignee: string | null;
    slaDue: Date | null;
    slaHours: number | null;
    resolvedAt: Date | null;
    escalationLevel: number;
    escalations: { at: Date; to: string | null }[];
    photoBefore: string | null;
    hasMaterialRequest: boolean;
    description: string | null;
    source: DataSource;
}

export interface SlaInfo {
    /** Minutes left until due. Negative when breached. Null when the ticket has no SLA. */
    minutesLeft: number | null;
    due: Date | null;
    targetHours: number | null;
    /** 0..1+ share of the SLA window already used. */
    used: number;
    breached: boolean;
    /** Red applies only to breach, or critical priority with under an hour left. */
    danger: boolean;
    label: string;
    done: boolean;
}

export interface Technician {
    id: string;
    name: string;
    initials: string;
    skill: string;
    shift: 'on_a_ticket' | 'free' | 'off_shift';
    since: string | null;
    openTickets: number;
}

export interface WeekDay {
    label: string;
    date: string;
    raised: number;
    closed: number;
    today: boolean;
}

export interface RoundSlot {
    id: string;
    name: string;
    floor: string;
    time: string;
    minutes: number;
    state: 'done' | 'late' | 'upcoming';
}

export interface PlanEvent {
    id: string;
    time: string;
    minutes: number;
    type: 'ROUND' | 'PPM' | 'VISIT';
    title: string;
    meta: string;
    state: 'done' | 'late' | 'upcoming';
    action: 'Open' | 'Start' | 'View';
}

export interface ChatMessage {
    id: string;
    author: string;
    role: string;
    at: string;
    text: string;
    mine: boolean;
}

export interface TimelineEvent {
    id: string;
    label: string;
    at: Date | null;
    detail: string;
    state: 'done' | 'current' | 'pending';
}

export interface NavItem {
    id: string;
    label: string;
    group: 'main' | 'operations' | 'people' | 'tenant' | 'account';
    screen?: ScreenId;
}

export interface LabUser {
    name: string;
    firstName: string;
    initials: string;
    role: string;
    roleLabel: string;
}

export interface PropertyOption {
    id: string;
    name: string;
}
