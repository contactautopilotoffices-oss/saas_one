'use client';

import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Building2, Home, ListChecks, Menu, Plus, Undo2, type LucideIcon } from 'lucide-react';
import { themeVars } from '../lab/frame';
import { clockTime } from '../lab/format';
import { preview, sampleFeed, type Feed, type OrgModel } from './useOrgModel';
import {
    AppCtx, C, QUEUES, stackFor, theme, type CobaltApp, type Decision, type Route, type Sheet, type TabName,
} from './cobalt/core';
import { APPROVAL_ITEMS, NOTICES, type QueueId } from './cobalt/sample';
import { HomeScreen } from './cobalt/Home';
import { ApprovalSheet, ApprovalsScreen } from './cobalt/Approvals';
import { SiteScreen, SitesScreen } from './cobalt/Sites';
import { ComplianceScreen, MoneyScreen, MoreScreen, PeopleScreen } from './cobalt/Hub';
import { CreateSheet, NotificationsScreen, SearchScreen } from './cobalt/Inbox';

/**
 * Cobalt: the org super admin's phone app. Light page, white cards, one blue accent, Plus
 * Jakarta Sans. Four tabs (Home, Approvals, Sites, More) and a raised + for creating things;
 * every card and row opens the screen behind it, Back returns to where you were (scroll
 * included), approvals can be undone for a few seconds, and sheets slide up over the screen.
 *
 * Everything is local preview state: approving or rejecting changes this screen only and
 * nothing is saved. The app renders inside its own fixed height shell so headers, the tab
 * bar and sheets sit where they would on a device.
 */

export interface CobaltStart { route?: Route; sheet?: Sheet }

const TABS: ({ id: TabName; label: string; icon: LucideIcon } | null)[] = [
    { id: 'home', label: 'Home', icon: Home }, { id: 'approvals', label: 'Approvals', icon: ListChecks }, null,
    { id: 'sites', label: 'Sites', icon: Building2 }, { id: 'more', label: 'More', icon: Menu },
];

function Screen({ route }: { route: Route }) {
    switch (route.name) {
        case 'home': return <HomeScreen />;
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

export default function CobaltOrg({ m, start }: { m: OrgModel; start?: CobaltStart }) {
    const [stack, setStack] = useState<Route[]>(() => stackFor(start?.route ?? { name: 'home' }));
    const [sheet, setSheet] = useState<Sheet | null>(start?.sheet ?? null);
    const [decided, setDecided] = useState<Record<string, Decision>>({});
    const [snack, setSnack] = useState<{ ids: string[]; text: string } | null>(null);
    const [read, setRead] = useState<string[]>([]);
    const [refreshing, setRefreshing] = useState(false);
    const [refreshed, setRefreshed] = useState(false);
    const scroller = useRef<HTMLDivElement>(null);
    const scrollMemo = useRef<number[]>([]);
    const nextScroll = useRef<number | null>(null);
    const moved = useRef(false);
    const timers = useRef<number[]>([]);

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
    const back = () => {
        if (depth === 0) return;
        nextScroll.current = scrollMemo.current[depth - 1] ?? 0;
        moved.current = true;
        setStack(s => s.slice(0, -1));
    };

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
        const text = m.online
            ? `${d === 'approved' ? 'Approved' : 'Rejected'} ${what}${reason ? `, ${reason.toLowerCase()}` : ''}. Preview only, nothing was saved.`
            : `${d === 'approved' ? 'Approval' : 'Rejection'} of ${what} is queued. It sends when you are back online.`;
        setSnack({ ids, text });
        later(() => setSnack(s => (s && s.ids === ids ? null : s)), 6000);
    };
    const undo = () => {
        if (!snack) return;
        const ids = snack.ids;
        setDecided(prev => Object.fromEntries(Object.entries(prev).filter(([id]) => !ids.includes(id))));
        setSnack(null);
    };

    /* Notifications: sample, with read state kept here. */
    const baseNotices = useMemo(() => preview(sampleFeed(NOTICES), m.preview, []), [m.preview]);
    const notices = useMemo(() => ({ ...baseNotices, data: baseNotices.data?.map(n => ({ ...n, unread: n.unread && !read.includes(n.id) })) ?? null }), [baseNotices, read]);
    const unread = notices.state === 'ready' ? (notices.data ?? []).filter(n => n.unread).length : 0;
    const markRead = (ids: string[] | 'all') => setRead(prev => [...prev, ...(ids === 'all' ? NOTICES.map(n => n.id) : ids)]);

    const refresh = () => {
        setRefreshing(true);
        const feeds: Feed<unknown>[] = [m.sites, m.tickets, m.budget, m.elec, m.bills, m.roster, m.ppm, m.visitors, m.vendor, ...m.approvals];
        feeds.forEach(f => f.retry());
        later(() => { setRefreshing(false); setRefreshed(true); }, 800);
    };

    const app: CobaltApp = {
        m, route, depth, go, push, back, sheet,
        openSheet: setSheet, closeSheet: () => setSheet(null),
        items, pending, pendingTotal, decide,
        notices, unread, markRead,
        refresh, refreshing, updatedLabel: refreshed ? 'Updated just now' : `Updated ${clockTime(m.now)}`,
        siteByName: name => m.sites.data?.find(s => s.name === name) ?? null,
    };

    return (
        <AppCtx.Provider value={app}>
            <div className="lab-root relative flex flex-col overflow-hidden" style={{ ...themeVars(theme), background: C.page, color: C.text, height: 'var(--org-app-h, 100%)' }}>
                <div aria-hidden className="shrink-0" style={{ height: 'var(--org-safe-top, 0px)', background: C.page }} />
                <div ref={scroller} inert={sheet ? true : undefined}
                    className="relative flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                    <div key={`${depth}-${JSON.stringify(route)}`} className="flex flex-1 flex-col pb-[24px]"><Screen route={route} /></div>
                </div>

                <div aria-live="polite" className="pointer-events-none absolute inset-x-[12px] bottom-[84px] z-30 flex justify-center">
                    {snack && (
                        <div className="lab-sheet-in pointer-events-auto flex w-full items-center gap-[10px] rounded-[18px] py-[8px] pl-[14px] pr-[8px] text-[13px] font-medium text-white shadow-xl" style={{ background: C.text }}>
                            <span className="min-w-0 flex-1">{snack.text}</span>
                            <button type="button" onClick={undo} className="inline-flex h-10 shrink-0 items-center gap-[6px] rounded-full px-[12px] text-[13px] font-bold" style={{ background: 'rgba(255,255,255,0.14)' }}>
                                <Undo2 className="h-4 w-4" aria-hidden />Undo
                            </button>
                        </div>
                    )}
                </div>

                <nav aria-label="Main" inert={sheet ? true : undefined} className="relative z-30 shrink-0">
                    <div className="relative flex h-[72px] items-center justify-around px-[8px] pb-[6px]" style={{ background: C.card, boxShadow: '0 -8px 24px rgba(14,20,36,0.06)' }}>
                        {TABS.map(t => t === null ? (
                            <button key="create" type="button" aria-label="Create" aria-haspopup="dialog" onClick={() => setSheet({ kind: 'create' })}
                                className="-mt-[34px] grid h-[60px] w-[60px] place-items-center rounded-full text-white" style={{ background: C.accent, boxShadow: `0 10px 24px rgba(43,89,232,0.38), 0 0 0 6px ${C.page}` }}>
                                <Plus className="h-6 w-6" aria-hidden />
                            </button>
                        ) : (
                            <button key={t.id} type="button" aria-current={tab === t.id ? 'page' : undefined} onClick={() => go({ name: t.id })}
                                aria-label={t.id === 'approvals' && pendingTotal ? `Approvals, ${pendingTotal} waiting` : t.label}
                                className="relative flex h-12 w-16 flex-col items-center justify-center gap-[3px] text-[11px] font-semibold" style={{ color: tab === t.id ? C.accentDeep : C.text3 }}>
                                <span aria-hidden className="grid h-7 w-12 place-items-center rounded-full" style={{ background: tab === t.id ? C.tint : 'transparent' }}><t.icon className="h-5 w-5" /></span>
                                {t.label}
                                {t.id === 'approvals' && !!pendingTotal && (
                                    <span aria-hidden className="absolute right-[6px] top-[-2px] grid h-[18px] min-w-[18px] place-items-center rounded-full px-[4px] text-[10.5px] font-bold text-white" style={{ background: C.accent, boxShadow: `0 0 0 2px ${C.card}` }}>{pendingTotal}</span>
                                )}
                            </button>
                        ))}
                    </div>
                    <div aria-hidden style={{ height: 'env(safe-area-inset-bottom, 0px)', background: C.card }} />
                </nav>

                {sheet?.kind === 'create' && <CreateSheet />}
                {sheet?.kind === 'approval' && <ApprovalSheet key={`${sheet.id}-${sheet.reject ? 'r' : 'v'}`} id={sheet.id} startReject={sheet.reject} />}
            </div>
        </AppCtx.Provider>
    );
}
