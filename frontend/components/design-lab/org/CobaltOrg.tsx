'use client';

import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Building2, Home, ListChecks, Plus, Ticket, Undo2, type LucideIcon } from 'lucide-react';
import { themeVars } from '../lab/frame';
import { clockTime, slaInfo } from '../lab/format';
import type { Priority, TicketStatus } from '../lab/types';
import { preview, sampleFeed, type Feed, type OrgModel } from './useOrgModel';
import { SLA_HOURS } from './orgTickets';
import {
    AppCtx, C, PALETTES, QUEUES, paletteVars, stackFor,
    type CobaltApp, type Decision, type OrgTicket, type PaletteName, type Route, type Sheet, type TabName, type TicketDraft,
} from './cobalt/core';
import { APPROVAL_ITEMS, NOTICES, type QueueId } from './cobalt/sample';
import { HomeScreen } from './cobalt/Home';
import { ApprovalSheet, ApprovalsScreen } from './cobalt/Approvals';
import { SiteScreen, SitesScreen } from './cobalt/Sites';
import { ComplianceScreen, MoneyScreen, MoreScreen, PeopleScreen } from './cobalt/Hub';
import { CreateSheet, NotificationsScreen, SearchScreen } from './cobalt/Inbox';
import { AssignSheet, NewTicketScreen, TicketScreen, TicketsScreen } from './cobalt/Tickets';

/**
 * The org super admin's phone app, in two palettes that share every screen: Cobalt (light
 * page, white cards, one blue accent) and Slate (deep navy from the six colour palette, with
 * white as its primary colour).
 * Four tabs (Home, Tickets, Approvals, Sites) and a raised + for creating things; every card
 * and row opens the screen behind it, Back returns to where you were (scroll included),
 * changes can be undone for a few seconds, and sheets slide up over the screen.
 *
 * Everything is local preview state: approving, assigning, resolving or raising a ticket
 * changes this screen only and nothing is saved. The app renders inside its own fixed
 * height shell so headers, the tab bar and sheets sit where they would on a device.
 */

export interface CobaltStart { route?: Route; sheet?: Sheet }

/** The same app in the Slate palette. */
export function SlateOrg(props: { m: OrgModel; start?: CobaltStart }) {
    return <CobaltOrg {...props} palette="slate" />;
}

/** The same app in Slate Light, the bright version. */
export function SlateLightOrg(props: { m: OrgModel; start?: CobaltStart }) {
    return <CobaltOrg {...props} palette="slateLight" />;
}

const TABS: ({ id: TabName; label: string; icon: LucideIcon } | null)[] = [
    { id: 'home', label: 'Home', icon: Home }, { id: 'tickets', label: 'Tickets', icon: Ticket }, null,
    { id: 'approvals', label: 'Approvals', icon: ListChecks }, { id: 'sites', label: 'Sites', icon: Building2 },
];

function Screen({ route }: { route: Route }) {
    switch (route.name) {
        case 'home': return <HomeScreen />;
        case 'tickets': return <TicketsScreen initialView={route.view} initialSite={route.site} />;
        case 'ticket': return <TicketScreen id={route.id} />;
        case 'newTicket': return <NewTicketScreen initialSite={route.site} />;
        case 'approvals': return <ApprovalsScreen initialQueue={route.queue} />;
        case 'sites': return <SitesScreen initialSort={route.sort} initialFilter={route.filter} />;
        case 'site': return <SiteScreen id={route.id} />;
        case 'more': return <MoreScreen />;
        case 'money': return <MoneyScreen />;
        case 'people': return <PeopleScreen />;
        case 'compliance': return <ComplianceScreen />;
        case 'notifications': return <NotificationsScreen />;
        case 'search': return <SearchScreen />;
    }
}

type TicketEdit = { status?: TicketStatus; assignee?: string | null; priority?: Priority };

export default function CobaltOrg({ m, start, palette = 'cobalt' }: { m: OrgModel; start?: CobaltStart; palette?: PaletteName }) {
    const p = PALETTES[palette];
    const [stack, setStack] = useState<Route[]>(() => stackFor(start?.route ?? { name: 'home' }));
    const [sheet, setSheet] = useState<Sheet | null>(start?.sheet ?? null);
    const [decided, setDecided] = useState<Record<string, Decision>>({});
    const [snack, setSnack] = useState<{ id: number; text: string; undo?: () => void } | null>(null);
    const [read, setRead] = useState<string[]>([]);
    const [edits, setEdits] = useState<Record<string, TicketEdit>>({});
    const [notes, setNotes] = useState<Record<string, { at: Date; text: string }[]>>({});
    const [created, setCreated] = useState<OrgTicket[]>([]);
    const [refreshing, setRefreshing] = useState(false);
    const [refreshed, setRefreshed] = useState(false);
    const scroller = useRef<HTMLDivElement>(null);
    const scrollMemo = useRef<number[]>([]);
    const nextScroll = useRef<number | null>(null);
    const moved = useRef(false);
    const timers = useRef<number[]>([]);
    const snackSeq = useRef(0);

    const route = stack[stack.length - 1];
    const depth = stack.length - 1;
    const tab = stack[0].name as TabName;

    useEffect(() => () => timers.current.forEach(t => window.clearTimeout(t)), []);
    const later = (fn: () => void, ms: number) => { timers.current.push(window.setTimeout(fn, ms)); };

    // After a move: restore or reset the scroll position, then put focus on the new screen's title.
    useLayoutEffect(() => {
        const el = scroller.current;
        if (!el) return;
        if (nextScroll.current !== null) { el.scrollTop = nextScroll.current; nextScroll.current = null; }
        if (moved.current) {
            moved.current = false;
            const target = el.querySelector<HTMLElement>('[data-screen-focus]') ?? el.querySelector<HTMLElement>('[data-screen-title]');
            target?.focus({ preventScroll: true });
        }
    }, [stack]);

    const remember = () => { scrollMemo.current[depth] = scroller.current?.scrollTop ?? 0; };

    const go = (r: Route) => {
        setSheet(null);
        const fresh = stackFor(r);
        if (depth === 0 && JSON.stringify(fresh) === JSON.stringify(stack)) {
            scroller.current?.scrollTo({ top: 0, behavior: 'smooth' });
            return;
        }
        nextScroll.current = 0;
        moved.current = true;
        setStack(fresh);
    };
    const push = (r: Route) => {
        setSheet(null);
        remember();
        nextScroll.current = 0;
        moved.current = true;
        setStack(s => [...s, r]);
    };
    const replace = (r: Route) => {
        nextScroll.current = 0;
        moved.current = true;
        setStack(s => [...s.slice(0, -1), r]);
    };
    const back = () => {
        if (depth === 0) return;
        nextScroll.current = scrollMemo.current[depth - 1] ?? 0;
        moved.current = true;
        setStack(s => s.slice(0, -1));
    };

    const notify = (text: string, undo?: () => void) => {
        const id = ++snackSeq.current;
        setSnack({ id, text, undo });
        later(() => setSnack(s => (s && s.id === id ? null : s)), 6000);
    };
    const offlineNote = m.online ? 'Preview only, nothing was saved.' : 'Queued, it sends when you are back online.';

    /* Approval items: sample for now, honouring the preview states, minus what you decided here. */
    const baseItems = useMemo(() => preview(sampleFeed(APPROVAL_ITEMS), m.preview, []), [m.preview]);
    const items = useMemo(() => ({ ...baseItems, data: baseItems.data ? baseItems.data.filter(i => !decided[i.id]) : null }), [baseItems, decided]);
    const pending = Object.fromEntries(QUEUES.map((q, i) => {
        const f = m.approvals[i];
        if (f.state !== 'ready' || !f.data) return [q, f.state === 'off' ? 0 : null];
        const gone = APPROVAL_ITEMS.filter(x => x.queue === q && decided[x.id]).length;
        return [q, Math.max(0, f.data.count - gone)];
    })) as Record<QueueId, number | null>;
    const pendingTotal = m.waiting.state === 'ready' ? QUEUES.reduce((n, q) => n + (pending[q] ?? 0), 0) : null;

    const decide = (ids: string[], d: Decision, reason?: string) => {
        if (ids.length === 0) return;
        setDecided(prev => ({ ...prev, ...Object.fromEntries(ids.map(id => [id, d])) }));
        const refs = APPROVAL_ITEMS.filter(i => ids.includes(i.id)).map(i => i.ref);
        const what = refs.length === 1 ? refs[0] : `${refs.length} items`;
        notify(`${d === 'approved' ? 'Approved' : 'Rejected'} ${what}${reason ? `, ${reason.toLowerCase()}` : ''}. ${offlineNote}`,
            () => setDecided(prev => Object.fromEntries(Object.entries(prev).filter(([id]) => !ids.includes(id)))));
    };

    /* Tickets: the org list (live or sample) with what you changed, noted or raised here. */
    const tickets = useMemo<Feed<OrgTicket[]>>(() => {
        const f = m.ticketList;
        if (f.state !== 'ready' || !f.data) return { ...f, data: null };
        const all: OrgTicket[] = [...created, ...f.data.map(t => ({ ...t, notes: [] }))];
        return { ...f, data: all.map(t => ({ ...t, ...edits[t.id], notes: [...t.notes, ...(notes[t.id] ?? [])] })) };
    }, [m.ticketList, created, edits, notes]);

    const updateTicket = (id: string, patch: TicketEdit, message: string) => {
        const before = edits[id];
        setEdits(prev => ({ ...prev, [id]: { ...prev[id], ...patch } }));
        notify(`${message} ${offlineNote}`, () => setEdits(prev => {
            const next = { ...prev };
            if (before) next[id] = before; else delete next[id];
            return next;
        }));
    };
    const addNote = (id: string, text: string) => setNotes(prev => ({ ...prev, [id]: [...(prev[id] ?? []), { at: new Date(m.now.getTime()), text }] }));
    const raiseTicket = (d: TicketDraft) => {
        const n = 400 + created.length + 1;
        const at = new Date(m.now.getTime());
        const hours = SLA_HOURS[d.priority];
        const t: OrgTicket = {
            id: `new-${n}`, number: `TKT-${n}`, title: d.title, status: d.assignee ? 'assigned' : 'open', priority: d.priority, category: d.category,
            location: d.location || null, raisedAt: at, raisedBy: m.user.name, company: null, assignee: d.assignee,
            slaDue: new Date(at.getTime() + hours * 3_600_000), slaHours: hours, resolvedAt: null, escalationLevel: 0, escalations: [],
            photoBefore: null, hasMaterialRequest: false, description: d.description || null, source: m.source, site: d.site, notes: [], local: true,
        };
        setCreated(prev => [t, ...prev]);
        return t.id;
    };
    const pastSla = tickets.state === 'ready' ? (tickets.data ?? []).filter(t => ['open', 'assigned', 'in_progress'].includes(t.status) && slaInfo(t, m.now).breached).length : 0;

    /* Notifications: sample, with read state kept here. */
    const baseNotices = useMemo(() => preview(sampleFeed(NOTICES), m.preview, []), [m.preview]);
    const notices = useMemo(() => ({ ...baseNotices, data: baseNotices.data?.map(n => ({ ...n, unread: n.unread && !read.includes(n.id) })) ?? null }), [baseNotices, read]);
    const unread = notices.state === 'ready' ? (notices.data ?? []).filter(n => n.unread).length : 0;
    const markRead = (ids: string[] | 'all') => setRead(prev => [...prev, ...(ids === 'all' ? NOTICES.map(n => n.id) : ids)]);

    const refresh = () => {
        setRefreshing(true);
        const feeds: Feed<unknown>[] = [m.sites, m.tickets, m.budget, m.elec, m.bills, m.roster, m.ppm, m.visitors, m.vendor, m.ticketList, ...m.approvals];
        feeds.forEach(f => f.retry());
        later(() => { setRefreshing(false); setRefreshed(true); }, 800);
    };

    const app: CobaltApp = {
        m, p, route, depth, go, push, replace, back, sheet,
        openSheet: setSheet, closeSheet: () => setSheet(null), notify,
        items, pending, pendingTotal, decide,
        tickets, updateTicket, addNote, raiseTicket,
        notices, unread, markRead,
        refresh, refreshing, updatedLabel: refreshed ? 'Updated just now' : `Updated ${clockTime(m.now)}`,
        siteByName: name => m.sites.data?.find(s => s.name === name) ?? null,
    };

    const badge = (n: number, red?: boolean) => (
        <span aria-hidden className="absolute right-[6px] top-[-2px] grid h-[18px] min-w-[18px] place-items-center rounded-full px-[4px] text-[10.5px] font-bold"
            style={{ background: red ? C.red : C.accent, color: red ? C.onRed : C.onAccent, boxShadow: `0 0 0 2px ${C.card}` }}>{n}</span>
    );

    return (
        <AppCtx.Provider value={app}>
            <div className="lab-root cb-root relative flex flex-col overflow-hidden" style={{ ...themeVars(p.theme), ...paletteVars(p), background: C.page, color: C.text, colorScheme: p.scheme, height: 'var(--org-app-h, 100%)' }}>
                <div aria-hidden className="shrink-0" style={{ height: 'var(--org-safe-top, 0px)', background: C.page }} />
                <div ref={scroller} inert={sheet ? true : undefined}
                    className="relative flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                    <div key={`${depth}-${JSON.stringify(route)}`} className="flex flex-1 flex-col pb-[24px]"><Screen route={route} /></div>
                </div>

                {/* Above the tab bar, and above a screen's own sticky actions where it has them. */}
                <div aria-live="polite" className="pointer-events-none absolute inset-x-[12px] z-30 flex justify-center" style={{ bottom: route.name === 'ticket' || route.name === 'newTicket' ? 148 : 84 }}>
                    {snack && (
                        <div className="lab-sheet-in pointer-events-auto flex w-full items-center gap-[10px] rounded-[18px] py-[8px] pl-[14px] pr-[8px] text-[13px] font-medium shadow-xl" style={{ background: C.ink, color: C.onInk }}>
                            <span className="min-w-0 flex-1 py-[4px]">{snack.text}</span>
                            {snack.undo && (
                                <button type="button" onClick={() => { snack.undo?.(); setSnack(null); }} className="inline-flex h-10 shrink-0 items-center gap-[6px] rounded-full px-[12px] text-[13px] font-bold" style={{ background: 'rgba(127,127,127,0.22)' }}>
                                    <Undo2 className="h-4 w-4" aria-hidden />Undo
                                </button>
                            )}
                        </div>
                    )}
                </div>

                <nav aria-label="Main" inert={sheet ? true : undefined} className="relative z-30 shrink-0">
                    <div className="relative flex h-[72px] items-center justify-around px-[8px] pb-[6px]" style={{ background: C.card, boxShadow: C.shadowTab }}>
                        {TABS.map(t => t === null ? (
                            <button key="create" type="button" aria-label="Create" aria-haspopup="dialog" onClick={() => setSheet({ kind: 'create' })}
                                className="-mt-[34px] grid h-[60px] w-[60px] place-items-center rounded-full" style={{ background: C.accent, color: C.onAccent, boxShadow: `${C.shadowAccent}, 0 0 0 6px ${C.page}` }}>
                                <Plus className="h-6 w-6" aria-hidden />
                            </button>
                        ) : (
                            <button key={t.id} type="button" aria-current={tab === t.id ? 'page' : undefined} onClick={() => go({ name: t.id })}
                                aria-label={t.id === 'approvals' && pendingTotal ? `Approvals, ${pendingTotal} waiting` : t.id === 'tickets' && pastSla ? `Tickets, ${pastSla} past SLA` : t.label}
                                className="relative flex h-12 w-16 flex-col items-center justify-center gap-[3px] text-[11px] font-semibold" style={{ color: tab === t.id ? C.accentDeep : C.text3 }}>
                                <span aria-hidden className="grid h-7 w-12 place-items-center rounded-full" style={{ background: tab === t.id ? C.tint : 'transparent' }}><t.icon className="h-5 w-5" /></span>
                                {t.label}
                                {t.id === 'approvals' && !!pendingTotal && badge(pendingTotal)}
                                {t.id === 'tickets' && pastSla > 0 && badge(pastSla, true)}
                            </button>
                        ))}
                    </div>
                    <div aria-hidden style={{ height: 'env(safe-area-inset-bottom, 0px)', background: C.card }} />
                </nav>

                {sheet?.kind === 'create' && <CreateSheet />}
                {sheet?.kind === 'approval' && <ApprovalSheet key={`${sheet.id}-${sheet.reject ? 'r' : 'v'}`} id={sheet.id} startReject={sheet.reject} />}
                {sheet?.kind === 'assign' && <AssignSheet key={sheet.id} id={sheet.id} />}
            </div>
        </AppCtx.Provider>
    );
}
