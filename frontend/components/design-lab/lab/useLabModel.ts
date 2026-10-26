'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useAuth } from '@/frontend/context/AuthContext';
import { useWidgetData } from '@/frontend/lib/dashboard/useWidgetData';
import { useTicketMedia } from '@/frontend/hooks/useTicketMedia';
import {
    SAMPLE_CHAT, SAMPLE_MATERIAL_REQUESTS, SAMPLE_NOW, SAMPLE_PERIOD_COUNTS, SAMPLE_PROPERTY,
    SAMPLE_TICKETS, SAMPLE_USER, MATERIAL_STAGES,
} from './sample';
import { ACTIVE_STATUSES, RAW_ACTIVE, RAW_CLOSED, RAW_WAITLIST, normalizePriority, normalizeStatus } from './status';
import { initials, slaInfo, slaSortKey } from './format';
import { ORG_WIDE_ROLES, ROLE_LABELS, navForRole, type LabNavItem } from './nav';
import type {
    ChatMessage, DataSource, LabTicket, LabUser, Period, PreviewState, PropertyOption, SlaInfo, TimelineEvent,
} from './types';

/**
 * The single source every design renders from.
 *
 * LIVE (read only, existing code paths):
 *   - useAuth: the signed-in user, their properties and role
 *   - useWidgetData over GET /api/tickets: active, waitlist and closed tickets, period counts
 *   - useTicketMedia: before and after photos and videos on the open ticket
 * Everything else comes from sample.ts and is flagged so the design can show a Sample badge.
 *
 * GET /api/tickets/[id] is deliberately NOT called: it stamps material requests as viewed
 * for some users, and the lab must never write.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
interface TicketsPayload { tickets: any[]; total: number }

function fromRow(r: any): LabTicket {
    const escalations = Array.isArray(r.ticket_escalation_logs)
        ? r.ticket_escalation_logs
            .filter((l: any) => l?.escalated_at)
            .map((l: any) => ({ at: new Date(l.escalated_at), to: l.to_employee?.full_name ?? null }))
        : [];
    return {
        id: String(r.id),
        number: r.ticket_number || String(r.id).slice(0, 8).toUpperCase(),
        title: r.title || 'Untitled ticket',
        status: normalizeStatus(r.status),
        priority: normalizePriority(r.priority),
        category: r.category?.name ?? r.skill_group?.name ?? null,
        location: null,
        raisedAt: new Date(r.created_at),
        raisedBy: r.creator?.full_name ?? null,
        company: null,
        assignee: r.assignee?.full_name ?? null,
        slaDue: r.sla_deadline ? new Date(r.sla_deadline) : null,
        slaHours: typeof r.sla_hours === 'number' ? r.sla_hours : null,
        resolvedAt: r.resolved_at ? new Date(r.resolved_at) : null,
        escalationLevel: escalations.length,
        escalations,
        photoBefore: r.photo_before_url ?? null,
        hasMaterialRequest: Array.isArray(r.material_requests) && r.material_requests.length > 0,
        description: null,
        source: 'live',
    };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

function monthStartISO(now: Date): string {
    const d = new Date(now.getFullYear(), now.getMonth(), 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

function subscribeOnline(cb: () => void) {
    window.addEventListener('online', cb);
    window.addEventListener('offline', cb);
    return () => {
        window.removeEventListener('online', cb);
        window.removeEventListener('offline', cb);
    };
}

function useOnline(): boolean {
    return useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
}

/** Live mode ticks every 30 seconds so SLA countdowns move. Sample mode is frozen at 9:41 AM. */
function useNow(live: boolean): Date {
    const [tick, setTick] = useState<Date>(() => new Date());
    useEffect(() => {
        if (!live) return;
        const id = window.setInterval(() => setTick(new Date()), 30_000);
        return () => window.clearInterval(id);
    }, [live]);
    return live ? tick : SAMPLE_NOW;
}

export type TicketAction =
    | 'assign' | 'reassign' | 'start' | 'complete' | 'approval' | 'looks_good' | 'request_changes'
    | 'reopen' | 'material' | 'edit';

export const ACTION_LABELS: Record<TicketAction, string> = {
    assign: 'Assign technician',
    reassign: 'Reassign',
    start: 'Start work',
    complete: 'Complete',
    approval: 'Send for approval',
    looks_good: 'Looks good',
    request_changes: 'Request changes',
    reopen: 'Reopen',
    material: 'Material request',
    edit: 'Edit',
};

const ADMIN_ROLES = ['property_admin', 'org_admin', 'org_super_admin', 'ops_super_admin', 'master_admin', 'owner', 'soft_service_manager'];
const TECH_ROLES = ['staff', 'mst', 'technician', 'soft_service_supervisor'];
const TENANT_ROLES = ['tenant', 'super_tenant'];

/** Which actions a role sees on a ticket. Mirrors the brief; enforcement stays in the app. */
export function ticketActions(role: string, t: LabTicket): { primary: TicketAction[]; secondary: TicketAction[] } {
    const done = t.status === 'resolved' || t.status === 'closed';
    if (TENANT_ROLES.includes(role)) {
        if (t.status === 'resolved') return { primary: ['looks_good', 'request_changes'], secondary: [] };
        if (t.status === 'closed') return { primary: ['reopen'], secondary: [] };
        return { primary: [], secondary: ['edit'] };
    }
    if (TECH_ROLES.includes(role)) {
        if (t.status === 'assigned') return { primary: ['start'], secondary: ['material'] };
        if (t.status === 'in_progress') return { primary: ['complete'], secondary: ['approval', 'material'] };
        return { primary: [], secondary: ['material'] };
    }
    if (ADMIN_ROLES.includes(role) || !role) {
        if (done) return { primary: ['reopen'], secondary: ['edit'] };
        if (!t.assignee) return { primary: ['assign'], secondary: ['material', 'edit'] };
        return { primary: ['reassign'], secondary: ['material', 'edit'] };
    }
    return { primary: [], secondary: [] };
}

function buildTimeline(t: LabTicket): TimelineEvent[] {
    const events: TimelineEvent[] = [];
    const who = [t.raisedBy, t.company].filter(Boolean).join(', ');
    events.push({ id: 'raised', label: 'Raised', at: t.raisedAt, detail: who ? `by ${who}` : 'Ticket created', state: 'done' });
    if (t.category) {
        const confidence = t.source === 'sample' ? ', AI confidence 94%' : '';
        events.push({ id: 'classified', label: 'Classified', at: t.raisedAt, detail: `${t.category}${confidence}`, state: 'done' });
    }
    t.escalations.forEach((e, i) => {
        events.push({ id: `esc-${i}`, label: 'Escalated', at: e.at, detail: `Level ${i + 1}${e.to ? `, ${e.to}` : ''}`, state: 'done' });
    });
    const started = t.status === 'in_progress' || t.status === 'resolved' || t.status === 'closed';
    if (t.assignee) {
        const at = t.source === 'sample' ? new Date(t.raisedAt.getTime() + 12 * 60000) : null;
        events.push({ id: 'assigned', label: 'Assigned', at, detail: `to ${t.assignee}`, state: started ? 'done' : 'current' });
    } else {
        events.push({ id: 'assigned', label: 'Assigned', at: null, detail: 'Waiting for a technician', state: 'current' });
    }
    if (started) {
        const at = t.source === 'sample' ? new Date(t.raisedAt.getTime() + 34 * 60000) : null;
        events.push({ id: 'started', label: 'Work started', at, detail: t.assignee ? `by ${t.assignee}` : 'On site', state: t.status === 'in_progress' ? 'current' : 'done' });
    } else {
        events.push({ id: 'started', label: 'Work started', at: null, detail: 'Not started', state: 'pending' });
    }
    if (t.resolvedAt) {
        events.push({ id: 'resolved', label: t.status === 'closed' ? 'Closed' : 'Resolved', at: t.resolvedAt, detail: 'Work completed', state: 'done' });
    }
    return events;
}

export interface LabModel {
    now: Date;
    source: DataSource;
    liveAvailable: boolean;
    user: LabUser;
    nav: LabNavItem[];
    properties: PropertyOption[];
    propertyId: string;
    propertyName: string;
    setPropertyId: (id: string) => void;
    canAllProperties: boolean;
    period: Period;
    setPeriod: (p: Period) => void;
    periodCounts: { today: number; month: number; all: number };
    online: boolean;
    preview: PreviewState;
    tickets: {
        loading: boolean;
        error: string | null;
        retry: () => void;
        active: LabTicket[];
        waitlist: LabTicket[];
        closed: LabTicket[];
        all: LabTicket[];
    };
    stats: {
        active: number;
        open: number;
        assigned: number;
        inProgress: number;
        waitlist: number;
        closed: number;
        critical: number;
        unassigned: number;
    };
    attention: LabTicket[];
    sla: (t: LabTicket) => SlaInfo;
    selected: LabTicket | null;
    selectTicket: (id: string) => void;
    detail: {
        description: { text: string; sample: boolean } | null;
        chat: { messages: ChatMessage[]; sample: boolean };
        timeline: TimelineEvent[];
        material: { number: string; title: string; stage: (typeof MATERIAL_STAGES)[number]; sample: boolean } | null;
        media: { before: string | null; after: string | null; beforeVideo: string | null; afterVideo: string | null; loading: boolean; sample: boolean };
        actions: { primary: TicketAction[]; secondary: TicketAction[] };
    };
    drawerOpen: boolean;
    drawerKey: number;
    openDrawer: () => void;
    closeDrawer: () => void;
    toastMessage: string | null;
    toast: (message: string) => void;
    /** Every button that would change data in the app routes here instead. */
    previewAction: (label: string) => void;
}

export function useLabModel(preview: PreviewState, initialDrawer = false): LabModel {
    const { user, membership } = useAuth();
    const online = useOnline();

    const memberProps = useMemo(() => membership?.properties ?? [], [membership?.properties]);
    const orgRole = membership?.org_role ?? null;
    const canAllProperties = !!membership?.is_master_admin || (!!orgRole && ORG_WIDE_ROLES.includes(orgRole));

    const [chosenProperty, setChosenProperty] = useState<string | null>(() => {
        try {
            return new URLSearchParams(window.location.search).get('propertyId');
        } catch {
            return null;
        }
    });

    const propertyId = chosenProperty
        && (chosenProperty === 'all' ? canAllProperties : memberProps.some(p => p.id === chosenProperty))
        ? chosenProperty
        : memberProps[0]?.id ?? (canAllProperties ? 'all' : null);

    const liveAvailable = !!user && !!propertyId && (propertyId !== 'all' || !!membership?.org_id);
    const scope = !liveAvailable
        ? null
        : propertyId === 'all'
            ? `propertyId=all&organizationId=${membership?.org_id}`
            : `propertyId=${propertyId}`;

    const now = useNow(liveAvailable);
    const monthStart = monthStartISO(now);

    const active = useWidgetData<TicketsPayload>(scope ? `/api/tickets?${scope}&status=${RAW_ACTIVE}&limit=200` : null, 60_000);
    const waitlist = useWidgetData<TicketsPayload>(scope ? `/api/tickets?${scope}&status=${RAW_WAITLIST}&limit=50` : null, 60_000);
    const closed = useWidgetData<TicketsPayload>(scope ? `/api/tickets?${scope}&status=${RAW_CLOSED}&limit=30` : null, 60_000);
    const countToday = useWidgetData<TicketsPayload>(scope ? `/api/tickets?${scope}&period=today&limit=1` : null, 60_000);
    const countMonth = useWidgetData<TicketsPayload>(scope ? `/api/tickets?${scope}&dateFrom=${monthStart}&limit=1` : null, 5 * 60_000);
    const countAll = useWidgetData<TicketsPayload>(scope ? `/api/tickets?${scope}&limit=1` : null, 5 * 60_000);

    // A 401/403 means this viewer cannot read live tickets here: fall back to sample.
    const forbidden = active.error === 'forbidden';
    const source: DataSource = liveAvailable && !forbidden ? 'live' : 'sample';

    const liveLoading = source === 'live' && (active.loading || waitlist.loading || closed.loading);
    const liveError = source === 'live' && active.error && !forbidden ? active.error : null;

    const retry = useCallback(() => {
        active.refresh();
        waitlist.refresh();
        closed.refresh();
    }, [active, waitlist, closed]);

    const lists = useMemo(() => {
        if (preview === 'empty') return { active: [], waitlist: [], closed: [] };
        if (source === 'sample') {
            return {
                active: SAMPLE_TICKETS.filter(t => ACTIVE_STATUSES.includes(t.status)),
                waitlist: SAMPLE_TICKETS.filter(t => t.status === 'waitlist'),
                closed: SAMPLE_TICKETS.filter(t => t.status === 'resolved' || t.status === 'closed'),
            };
        }
        return {
            active: (active.data?.tickets ?? []).map(fromRow).filter(t => ACTIVE_STATUSES.includes(t.status)),
            waitlist: (waitlist.data?.tickets ?? []).map(fromRow),
            closed: (closed.data?.tickets ?? []).map(fromRow),
        };
    }, [preview, source, active.data, waitlist.data, closed.data]);

    const sla = useCallback((t: LabTicket) => slaInfo(t, now), [now]);

    const stats = useMemo(() => {
        const a = lists.active;
        return {
            active: a.length,
            open: a.filter(t => t.status === 'open').length,
            assigned: a.filter(t => t.status === 'assigned').length,
            inProgress: a.filter(t => t.status === 'in_progress').length,
            waitlist: source === 'live' && preview !== 'empty' ? (waitlist.data?.total ?? lists.waitlist.length) : lists.waitlist.length,
            closed: source === 'live' && preview !== 'empty' ? (closed.data?.total ?? lists.closed.length) : lists.closed.length,
            critical: a.filter(t => t.priority === 'critical').length,
            unassigned: a.filter(t => !t.assignee).length,
        };
    }, [lists, source, preview, waitlist.data, closed.data]);

    const attention = useMemo(() => {
        return [...lists.active]
            .sort((x, y) => {
                const dx = slaInfo(x, now).danger ? 0 : 1;
                const dy = slaInfo(y, now).danger ? 0 : 1;
                if (dx !== dy) return dx - dy;
                return slaSortKey(x, now) - slaSortKey(y, now);
            })
            .slice(0, 5);
    }, [lists.active, now]);

    const periodCounts = useMemo(() => {
        if (preview === 'empty') return { today: 0, month: 0, all: 0 };
        if (source === 'sample') return SAMPLE_PERIOD_COUNTS;
        return {
            today: countToday.data?.total ?? 0,
            month: countMonth.data?.total ?? 0,
            all: countAll.data?.total ?? 0,
        };
    }, [preview, source, countToday.data, countMonth.data, countAll.data]);

    const all = useMemo(() => [...lists.active, ...lists.waitlist, ...lists.closed], [lists]);

    const [selectedId, setSelectedId] = useState<string | null>(null);
    const selected = useMemo(() => {
        const found = selectedId ? all.find(t => t.id === selectedId) : undefined;
        if (found) return found;
        const unassigned = attention.find(t => !t.assignee);
        return unassigned ?? attention[0] ?? all[0] ?? null;
    }, [selectedId, all, attention]);

    const media = useTicketMedia(selected && selected.source === 'live' ? selected.id : '');

    const role = source === 'live'
        ? (memberProps.find(p => p.id === propertyId)?.role ?? orgRole ?? 'property_admin')
        : SAMPLE_USER.role;

    const detail = useMemo<LabModel['detail']>(() => {
        if (!selected) {
            return {
                description: null,
                chat: { messages: [], sample: false },
                timeline: [],
                material: null,
                media: { before: null, after: null, beforeVideo: null, afterVideo: null, loading: false, sample: false },
                actions: { primary: [], secondary: [] },
            };
        }
        const isSample = selected.source === 'sample';
        const mr = selected.hasMaterialRequest
            ? SAMPLE_MATERIAL_REQUESTS.find(m => m.ticket === selected.number) ?? SAMPLE_MATERIAL_REQUESTS[0]
            : null;
        return {
            // The tickets list endpoint does not carry the description, and the detail endpoint
            // writes, so a live ticket shows no description rather than someone else's text.
            description: selected.description ? { text: selected.description, sample: isSample } : null,
            chat: { messages: SAMPLE_CHAT, sample: true },
            timeline: buildTimeline(selected),
            material: mr ? { number: mr.number, title: mr.title, stage: mr.stage, sample: true } : null,
            media: isSample
                ? { before: null, after: null, beforeVideo: null, afterVideo: null, loading: false, sample: true }
                : {
                    before: media.photos.before ?? selected.photoBefore,
                    after: media.photos.after,
                    beforeVideo: media.videos.before,
                    afterVideo: media.videos.after,
                    loading: media.loading,
                    sample: false,
                },
            actions: ticketActions(role, selected),
        };
    }, [selected, media.photos, media.videos, media.loading, role]);

    const [period, setPeriod] = useState<Period>('today');
    const [drawerOpen, setDrawerOpen] = useState(initialDrawer);
    // Bumped on every open so the drawer starts with a clean search and selection.
    const [drawerKey, setDrawerKey] = useState(0);
    const openDrawer = useCallback(() => { setDrawerKey(k => k + 1); setDrawerOpen(true); }, []);
    const closeDrawer = useCallback(() => setDrawerOpen(false), []);
    const [toastMessage, setToastMessage] = useState<string | null>(null);
    const toastTimer = useRef<number | null>(null);
    const toast = useCallback((message: string) => {
        setToastMessage(message);
        if (toastTimer.current) window.clearTimeout(toastTimer.current);
        toastTimer.current = window.setTimeout(() => setToastMessage(null), 2800);
    }, []);
    const previewAction = useCallback((label: string) => {
        toast(`Preview only. "${label}" works in the app, nothing was saved here.`);
    }, [toast]);

    const fullName = source === 'live'
        ? (user?.user_metadata?.full_name as string | undefined) || user?.email?.split('@')[0] || 'there'
        : SAMPLE_USER.name;

    const properties: PropertyOption[] = source === 'live'
        ? memberProps.map(p => ({ id: p.id, name: p.name }))
        : [SAMPLE_PROPERTY];
    const propertyName = source === 'live'
        ? (propertyId === 'all' ? 'All properties' : memberProps.find(p => p.id === propertyId)?.name ?? 'Property')
        : SAMPLE_PROPERTY.name;

    return {
        now,
        source,
        liveAvailable,
        user: {
            name: fullName,
            firstName: fullName.split(' ')[0],
            initials: initials(fullName),
            role,
            roleLabel: ROLE_LABELS[role] ?? role.replace(/_/g, ' '),
        },
        nav: navForRole(role),
        properties,
        propertyId: source === 'live' ? (propertyId as string) : SAMPLE_PROPERTY.id,
        propertyName,
        setPropertyId: (id: string) => setChosenProperty(id),
        canAllProperties: source === 'live' ? canAllProperties : false,
        period,
        setPeriod,
        periodCounts,
        online: preview === 'offline' ? false : online,
        preview,
        tickets: {
            loading: preview === 'loading' || liveLoading,
            error: preview === 'error' ? 'We could not load tickets.' : liveError,
            retry,
            active: lists.active,
            waitlist: lists.waitlist,
            closed: lists.closed,
            all,
        },
        stats,
        attention,
        sla,
        selected,
        selectTicket: setSelectedId,
        detail,
        drawerOpen,
        drawerKey,
        openDrawer,
        closeDrawer,
        toastMessage,
        toast,
        previewAction,
    };
}

export { MATERIAL_STAGES };
