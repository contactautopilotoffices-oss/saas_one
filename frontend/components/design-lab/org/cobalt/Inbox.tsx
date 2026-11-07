'use client';

import React, { useState } from 'react';
import {
    BellOff, Building2, CalendarClock, CheckCheck, ClipboardX, FileBarChart, FileText, Fuel, Megaphone, Search, Siren, Stamp,
    Ticket, UserPlus, Users, Wallet, Wrench, X, ShieldCheck, type LucideIcon,
} from 'lucide-react';
import { inrCompact } from '../../lab/format';
import { EmptyState, SkeletonRows, listKeys } from '../../lab/ui';
import { APPROVAL_ICONS, InlineError, Sample } from '../parts';
import { C, agoLabel, useApp, type Route } from './core';
import { RECENT_SEARCHES, type Notice, type NoticeKind } from './sample';
import { Card, Pills, Row, SheetFrame, TopBar } from './ui';

/** Notifications, search, and the create sheet behind the raised + button. */

const NOTICE_ICON: Record<NoticeKind, LucideIcon> = {
    sla: Siren, round: ClipboardX, approval: Stamp, diesel: Fuel, amc: Wrench, budget: Wallet, report: FileBarChart,
};

export function NotificationsScreen() {
    const { m, notices, unread, markRead, openSheet, push, back, siteByName } = useApp();
    const [show, setShow] = useState<'all' | 'unread'>('all');
    const list = (notices.data ?? []).filter(n => show === 'all' || n.unread).sort((a, b) => a.ago - b.ago);
    const groups = [
        { title: 'Today', items: list.filter(n => new Date(m.now.getTime() - n.ago * 60_000).toDateString() === m.now.toDateString()) },
        { title: 'Yesterday', items: list.filter(n => new Date(m.now.getTime() - n.ago * 60_000).toDateString() !== m.now.toDateString()) },
    ].filter(g => g.items.length > 0);

    const open = (n: Notice) => {
        markRead([n.id]);
        const to = n.to;
        if (to.name === 'approval') openSheet({ kind: 'approval', id: to.id });
        else if (to.name === 'site') { const s = siteByName(to.site); if (s) push({ name: 'site', id: s.id }); }
        else if (to.name === 'compliance' || to.name === 'money') push({ name: to.name });
        else m.previewAction(n.title);
    };

    return (
        <div>
            <TopBar title="Notifications" right={unread > 0 && (
                <button type="button" onClick={() => markRead('all')} className="inline-flex h-10 items-center gap-[6px] rounded-full px-[12px] text-[12.5px] font-bold" style={{ background: C.card, color: C.accentDeep }}>
                    <CheckCheck className="h-4 w-4" aria-hidden />Mark all read
                </button>
            )} />
            <div className="flex items-center gap-[8px]">
                <Pills label="Show" value={show} onChange={setShow} options={[{ id: 'all', label: 'All' }, { id: 'unread', label: 'Unread', count: notices.state === 'ready' ? unread : null }]} />
                <span className="ml-auto pr-[16px]"><Sample feed={notices} /></span>
            </div>
            <div className="px-[16px] pt-[10px]">
                {notices.state === 'loading' ? <SkeletonRows rows={5} height={64} gap={8} />
                    : notices.state === 'error' ? <Card className="p-[14px]"><InlineError onRetry={notices.retry} /></Card>
                        : groups.length === 0 ? (
                            <Card><EmptyState icon={BellOff} title={show === 'unread' ? 'You have read everything' : 'No notifications yet'} body="Alerts about SLA, rounds, approvals and budgets show up here." actionLabel={show === 'unread' ? 'Show all' : 'Back'} onAction={() => (show === 'unread' ? setShow('all') : back())} /></Card>
                        ) : groups.map(g => (
                            <section key={g.title} aria-label={g.title} className="mb-[14px]">
                                <p className="mb-[6px] px-[4px] text-[12px] font-bold uppercase tracking-[0.06em]" style={{ color: C.text3 }}>{g.title}</p>
                                <Card className="p-[6px]">
                                    <ul onKeyDown={listKeys}>
                                        {g.items.map(n => {
                                            const red = n.kind === 'sla' || n.kind === 'round';
                                            return (
                                                <li key={n.id}>
                                                    <Row icon={NOTICE_ICON[n.kind]} red={red} title={n.title} sub={n.body} onClick={() => open(n)} label={`${n.unread ? 'Unread. ' : ''}${n.title}. ${n.body}`}
                                                        right={<span className="flex shrink-0 flex-col items-end gap-[6px]">
                                                            <span className="text-[11.5px] tabular-nums" style={{ color: C.text3 }}>{agoLabel(m.now, n.ago)}</span>
                                                            {n.unread && <span aria-hidden className="h-2.5 w-2.5 rounded-full" style={{ background: C.accent }} />}
                                                        </span>} />
                                                </li>
                                            );
                                        })}
                                    </ul>
                                </Card>
                            </section>
                        ))}
            </div>
        </div>
    );
}

/* ------------------------------------------------------------ search */

const JUMPS: { label: string; words: string; icon: LucideIcon; to: Route }[] = [
    { label: 'Money and utilities', words: 'money budget electricity power diesel fuel bills vendor', icon: Wallet, to: { name: 'money' } },
    { label: 'People', words: 'people staff roster shift attendance hr grievance', icon: Users, to: { name: 'people' } },
    { label: 'Compliance', words: 'compliance ppm rounds amc renewal maintenance', icon: ShieldCheck, to: { name: 'compliance' } },
    { label: 'Notifications', words: 'notifications alerts', icon: Siren, to: { name: 'notifications' } },
];

export function SearchScreen() {
    const { m, items, push, openSheet } = useApp();
    const [query, setQuery] = useState('');
    const q = query.trim().toLowerCase();
    const sites = q ? (m.sites.data ?? []).filter(s => s.name.toLowerCase().includes(q) || s.code.toLowerCase().includes(q)) : [];
    const approvals = q ? (items.data ?? []).filter(i => [i.ref, i.title, i.site, i.party, i.by].some(t => t.toLowerCase().includes(q))).slice(0, 6) : [];
    const jumps = q ? JUMPS.filter(j => j.label.toLowerCase().includes(q) || j.words.includes(q)) : JUMPS;
    const none = q && sites.length === 0 && approvals.length === 0 && jumps.length === 0;

    return (
        <div>
            <TopBar title="Search" />
            <div className="sticky top-[56px] z-10 px-[16px] pb-[8px]" style={{ background: C.page }}>
                <label className="flex h-12 items-center gap-[8px] rounded-full px-[14px]" style={{ background: C.card, boxShadow: `inset 0 0 0 2px ${C.accent}` }}>
                    <Search className="h-[18px] w-[18px] shrink-0" style={{ color: C.accentDeep }} aria-hidden />
                    <span className="sr-only">Search sites, approvals and screens</span>
                    <input data-screen-focus value={query} onChange={e => setQuery(e.target.value)} placeholder="Sites, POs, people, screens" className="min-w-0 flex-1 bg-transparent text-[14.5px] outline-none placeholder:text-[#7A8197]" />
                    {query && <button type="button" onClick={() => setQuery('')} aria-label="Clear search" className="-mr-[8px] grid h-10 w-10 place-items-center rounded-full"><X className="h-4 w-4" aria-hidden /></button>}
                </label>
            </div>

            {!q && (
                <div className="px-[16px] pt-[6px]">
                    <p className="mb-[8px] text-[12px] font-bold uppercase tracking-[0.06em]" style={{ color: C.text3 }}>Recent</p>
                    <div className="flex flex-wrap gap-[6px]">
                        {RECENT_SEARCHES.map(r => (
                            <button key={r} type="button" onClick={() => setQuery(r)} className="inline-flex h-10 items-center gap-[6px] rounded-full px-[14px] text-[13px] font-semibold" style={{ background: C.card, color: C.text2 }}>
                                <CalendarClock className="h-3.5 w-3.5" aria-hidden />{r}
                            </button>
                        ))}
                    </div>
                </div>
            )}

            <div aria-live="polite" className="px-[16px]">
                {none && <Card className="mt-[10px]"><EmptyState compact icon={Search} title={`Nothing found for "${query.trim()}"`} body="Try a site name, a PO number like PO-2231, or a word like diesel." actionLabel="Clear search" onAction={() => setQuery('')} /></Card>}
                {sites.length > 0 && (
                    <ResultGroup title="Sites">
                        {sites.map(s => <li key={s.id}><Row icon={Building2} title={s.name} sub={`${s.code}, score ${s.score}, ${s.active} active`} onClick={() => push({ name: 'site', id: s.id })} /></li>)}
                    </ResultGroup>
                )}
                {approvals.length > 0 && (
                    <ResultGroup title="Waiting on you" right={<Sample feed={items} />}>
                        {approvals.map(i => <li key={i.id}><Row icon={APPROVAL_ICONS[i.queue] ?? FileText} title={`${i.ref}, ${i.title}`} sub={`${i.site}${i.amount !== null ? `, ${inrCompact(i.amount)}` : ''}`} onClick={() => openSheet({ kind: 'approval', id: i.id })} /></li>)}
                    </ResultGroup>
                )}
                {jumps.length > 0 && (
                    <ResultGroup title={q ? 'Screens' : 'Jump to'}>
                        {jumps.map(j => <li key={j.label}><Row icon={j.icon} title={j.label} onClick={() => push(j.to)} /></li>)}
                    </ResultGroup>
                )}
            </div>
        </div>
    );
}

function ResultGroup({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }) {
    return (
        <section aria-label={title} className="mt-[16px]">
            <p className="mb-[6px] flex items-center gap-[6px] px-[4px] text-[12px] font-bold uppercase tracking-[0.06em]" style={{ color: C.text3 }}>{title}{right}</p>
            <Card className="p-[6px]"><ul onKeyDown={listKeys}>{children}</ul></Card>
        </section>
    );
}

/* ------------------------------------------------------- create sheet */

export function CreateSheet() {
    const { m, closeSheet, go } = useApp();
    const actions: { label: string; sub: string; icon: LucideIcon; run: () => void; primary?: boolean }[] = [
        { label: 'Raise a ticket', sub: 'For any site', icon: Ticket, primary: true, run: () => m.previewAction('Raise a ticket') },
        { label: 'Approve POs', sub: 'Open the queue', icon: Stamp, run: () => { closeSheet(); go({ name: 'approvals', queue: 'po' }); } },
        { label: 'Announce', sub: 'To all sites', icon: Megaphone, run: () => m.previewAction('Announce to all sites') },
        { label: 'Add a visitor', sub: 'Pre-register a guest', icon: UserPlus, run: () => m.previewAction('Add a visitor') },
        { label: 'Petty cash', sub: 'Raise a request', icon: Wallet, run: () => m.previewAction('Raise petty cash') },
        { label: 'Schedule report', sub: 'Daily or weekly', icon: FileBarChart, run: () => m.previewAction('Schedule a report') },
    ];
    return (
        <SheetFrame title="Create" onClose={closeSheet}>
            <ul className="grid grid-cols-2 gap-[10px] pt-[4px]">
                {actions.map(a => (
                    <li key={a.label}>
                        <button type="button" onClick={a.run} className="flex h-[112px] w-full flex-col justify-between rounded-[22px] p-[14px] text-left"
                            style={a.primary ? { background: C.accent, color: '#FFFFFF' } : { background: C.card, color: C.text }}>
                            <span className="grid h-10 w-10 place-items-center rounded-full" style={{ background: a.primary ? 'rgba(255,255,255,0.18)' : C.tint }}>
                                <a.icon className="h-[18px] w-[18px]" style={{ color: a.primary ? '#FFFFFF' : C.accentDeep }} aria-hidden />
                            </span>
                            <span>
                                <span className="block text-[14px] font-bold">{a.label}</span>
                                <span className="block text-[12px]" style={{ color: a.primary ? 'rgba(255,255,255,0.85)' : C.text3 }}>{a.sub}</span>
                            </span>
                        </button>
                    </li>
                ))}
            </ul>
        </SheetFrame>
    );
}
