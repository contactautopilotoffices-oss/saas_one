'use client';

import React, { useEffect, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { ArrowLeft, FlaskConical } from 'lucide-react';
import { LAB_CSS } from '../lab/css';
import type { PreviewState } from '../lab/types';
import { useOrgModel, type OrgModel } from './useOrgModel';
import { PhoneFrame } from './PhoneFrame';
import NoirOrg from './NoirOrg';
import IvoryOrg from './IvoryOrg';
import OnyxOrg from './OnyxOrg';
import GiltOrg from './GiltOrg';
import PulseOrg, { type PulseTab } from './PulseOrg';
import CobaltOrg, { SlateOrg, type CobaltStart } from './CobaltOrg';
import TealOrg from './TealOrg';
import PlumOrg from './PlumOrg';

/**
 * /design-lab/org-mobile: the org super admin's mobile dashboard.
 * Cobalt is the chosen direction and opens first, as a gallery of its screens; Slate is the
 * same app in the six colour navy palette, opening on its dashboard and ticket screens. Each
 * phone is the whole app, started on a different screen, so every one can be tapped through.
 * "Compare" puts Cobalt, Slate, Teal and Plum side by side, and the earlier gold set (Pulse,
 * Noir, Ivory, Onyx, Gilt) stays one click away. On a real phone the chosen design fills the
 * screen instead of sitting in a frame.
 */

type OrgDesignId = 'cobalt' | 'slate' | 'teal' | 'plum' | 'pulse' | 'noir' | 'ivory' | 'onyx' | 'gilt';
type View = OrgDesignId | 'all';

const DEFAULT_ORDER = [
    'Portfolio score and the sites that need you',
    'Waiting on you: approvals and escalations',
    'Service risk: SLA, urgent, oldest open',
    'Property scorecard, worst first',
    'People, then compliance and asset risk',
    'Money, utilities, and the rest of today',
];

const PULSE_SCREENS: { tab: PulseTab; label: string }[] = [
    { tab: 'home', label: 'Home' }, { tab: 'approvals', label: 'Approvals' }, { tab: 'sites', label: 'Sites' },
];

/** The app galleries: the same app started on a different screen in each phone. */
type GalleryScreen = { label: string; start: (siteId: string) => CobaltStart };
const GALLERIES: Record<'cobalt' | 'slate', GalleryScreen[]> = {
    cobalt: [
        { label: 'Home', start: () => ({}) },
        { label: 'Tickets', start: () => ({ route: { name: 'tickets' } }) },
        { label: 'Ticket detail', start: () => ({ route: { name: 'ticket', id: 'tkt-151' } }) },
        { label: 'Approvals', start: () => ({ route: { name: 'approvals' } }) },
        { label: 'Approval detail', start: () => ({ route: { name: 'approvals', queue: 'mr' }, sheet: { kind: 'approval', id: 'mr-118' } }) },
        { label: 'Sites', start: () => ({ route: { name: 'sites' } }) },
        { label: 'Site page', start: id => ({ route: { name: 'site', id } }) },
        { label: 'Money', start: () => ({ route: { name: 'money' } }) },
    ],
    slate: [
        { label: 'Dashboard', start: () => ({}) },
        { label: 'Tickets', start: () => ({ route: { name: 'tickets' } }) },
        { label: 'Tickets past SLA', start: () => ({ route: { name: 'tickets', view: 'sla' } }) },
        { label: 'Ticket detail', start: () => ({ route: { name: 'ticket', id: 'tkt-151' } }) },
        { label: 'Assign technician', start: () => ({ route: { name: 'ticket', id: 'tkt-151' }, sheet: { kind: 'assign', id: 'tkt-151' } }) },
        { label: 'Raise a ticket', start: () => ({ route: { name: 'newTicket' } }) },
        { label: 'Approvals', start: () => ({ route: { name: 'approvals' } }) },
        { label: 'Sites', start: () => ({ route: { name: 'sites' } }) },
    ],
};

const DESIGNS: { id: OrgDesignId; name: string; group: 'new' | 'gold'; dot: string; statusDark: boolean; blurb: string; order?: string[]; sections?: { title: string; items: string[] }[]; Component: React.ComponentType<{ m: OrgModel; start?: CobaltStart }> }[] = [
    { id: 'cobalt', name: 'Cobalt', group: 'new', dot: '#2B59E8', statusDark: false, Component: CobaltOrg,
        blurb: 'The chosen direction, now a full app. Light page, white cards, one blue accent. Every card, row and number opens the screen behind it, and every phone here can be tapped through.',
        sections: [
            { title: 'Screens', items: [
                'Home: hero deck, quick actions, Needs you, worst 3 sites, at a glance, today',
                'Tickets: every site, cut by past SLA, urgent, unassigned, waitlist, resolved; ticket page with the SLA clock, owner, activity and notes; raise a ticket; assign or reassign',
                'Approvals: every queue, approve from the card, select several, sort',
                'Approval detail: amount, budget impact, quotes, history, reject with a reason',
                'Sites: portfolio score, search, filter, sort, a card per site with its trend',
                'Site page: score, 14 day trend, what waits on you there, risks, team',
                'Money, People and Compliance, each opened from Home or More',
                'Notifications, Search, and a Create sheet behind the + button',
            ] },
            { title: 'What got better', items: [
                'Nothing is a dead end: hero cards, rows, legends and chips all navigate',
                'Approve in one tap with Undo for 6 seconds; rejecting always asks why',
                'Approve several at once; counts on Home and the tab badge update straight away',
                'Back returns to where you were, scroll position included',
                'Offline: approvals queue and say so instead of failing',
                'Freshness and refresh on Home; unread count on the bell',
                'Home is shorter: detail moved to its own screens',
            ] },
        ] },
    { id: 'slate', name: 'Slate', group: 'new', dot: 'linear-gradient(135deg, #06141B 0%, #253745 50%, #CCD0CF 100%)', statusDark: true, Component: SlateOrg,
        blurb: 'Your six colour palette on the same app as Cobalt, with white as the primary colour: deep navy page (#06141B), cards in #11212D, tiles and tracks in #253745 and #4A5C6A, #CCD0CF and #9BA8AB for text, and white for every action and the hero card. Dashboard and ticketing come first here.',
        sections: [
            { title: 'Dashboard and tickets', items: [
                'Dashboard: a light hero card for active tickets, quick actions, Needs you, sites, at a glance',
                'Tickets: 63 active across 5 sites, with past SLA, urgent and unassigned one tap away',
                'Filter by view, site and search; sort by SLA, priority or newest',
                'Ticket page: SLA countdown, owner, description, activity and notes',
                'Assign or reassign from a sheet: best fit for the skill first, then who is free',
                'Raise a ticket: site, category, priority with its SLA, details, assign now or later',
            ] },
            { title: 'How the palette is used', items: [
                'Page #06141B, cards #11212D, tiles and tracks #253745',
                'Text #CCD0CF, second level #9BA8AB; every pair passes 4.5:1',
                'Primary colour is white: buttons, active pills, the + button, the active tab and the hero card, with #06141B text on it',
                'Charts step through white, #9BA8AB, #4A5C6A',
                'Red is only for SLA breaches and late rounds, lightened to read on navy',
            ] },
        ] },
    { id: 'teal', name: 'Teal', group: 'new', dot: '#0F766E', statusDark: false, Component: TealOrg,
        blurb: 'Calm and roomy in mint and white. A 14 day line opens the screen, approvals are a card stack you flip one queue at a time, sites sit in a grid, and the rest folds into an accordion so the page stays short.',
        order: [
            'Active tickets over 14 days, with SLA, urgent and raised under it',
            'Waiting on you: a stack of cards, one queue each',
            'Sites in a two column grid with a trend line each',
            'At a glance: people, compliance, money, utilities (fold open)',
            'Also today: visitors, rooms, oldest open ticket',
        ] },
    { id: 'plum', name: 'Plum', group: 'new', dot: '#B9A6FF', statusDark: true, Component: PlumOrg,
        blurb: 'Dark and quiet with a lilac accent. Jump chips reach any part of the page, the hero switches between bars and a line, queues are pills whose length is the count, sites are score dials and staff on duty is one dot per person.',
        order: [
            'Jump chips with counts',
            'Active tickets: bars or line, 7 or 14 days',
            'Waiting on you: queue pills sized by count',
            'Alerts: red only for SLA and late rounds',
            'Sites as score dials you swipe',
            'Money: budget capsule, power, bills, vendors',
            'On duty: one dot per person',
            'Compliance: PPM, AMC renewals on a 30 day line',
            'Today: visitors, rooms, diesel, water',
        ] },
    { id: 'pulse', group: 'gold', name: 'Pulse', dot: 'linear-gradient(135deg, #ECECE9 0%, #ECECE9 50%, #E6CD8C 50%)', statusDark: false, Component: PulseOrg,
        blurb: 'Simple and informative. Soft grey page, white rounded cards, one gold hero chart per screen, number tiles in a 2x2 grid with an arrow to open each, progress bars for comparisons and a floating pill tab bar. Home, Approvals and Sites are live tabs.',
        order: [
            'Active tickets across all sites, last 7 days (hero chart)',
            'Four tiles: waiting on you, SLA breached, on duty, PPM on time',
            'Tickets raised, with Today, Month and All',
            'Sites, worst first, as progress bars',
            'Money: budget, electricity, bills at risk',
            'Risk and compliance: late rounds, AMC, oldest ticket, grievances',
            'Across sites today: diesel, water, visitors, rooms, vendor revenue',
        ] },
    { id: 'noir', group: 'gold', name: 'Noir', dot: 'linear-gradient(135deg, #0A0A0A 0%, #0A0A0A 55%, #C9A24A 55%)', statusDark: true, Component: NoirOrg,
        blurb: 'Private banking feel. A black band with a gold glow holds the portfolio score and your sites as swipeable cards; a white sheet below holds the rest in order of urgency.' },
    { id: 'ivory', group: 'gold', name: 'Ivory', dot: 'linear-gradient(135deg, #FAF8F3 0%, #FAF8F3 55%, #C9A24A 55%)', statusDark: false, Component: IvoryOrg,
        blurb: 'A morning brief. One headline sentence says what matters, then numbered sections read top to bottom like a newspaper, with a ranked ledger of sites.' },
    { id: 'onyx', group: 'gold', name: 'Onyx', dot: 'radial-gradient(circle at 35% 35%, #D4AF5A 0 28%, #111113 30%)', statusDark: true, Component: OnyxOrg,
        blurb: 'Dark triage. Act now, Watch and Trends are tabs; Act now is one inbox of every approval and risk, each with its action button.' },
    { id: 'gilt', group: 'gold', name: 'Gilt', dot: 'linear-gradient(135deg, #EED79A 0%, #C9A24A 100%)', statusDark: true, Component: GiltOrg,
        blurb: 'Photo led. The building sits under a dark gradient, frosted glass tiles float over it, and gold appears only on good news.' },
];

const STATES: { id: PreviewState; label: string }[] = [
    { id: 'normal', label: 'Normal' }, { id: 'loading', label: 'Loading' }, { id: 'empty', label: 'Empty' },
    { id: 'error', label: 'Error' }, { id: 'offline', label: 'Offline' },
];

function Notes({ design, sticky, wide }: { design: (typeof DESIGNS)[number]; sticky?: boolean; wide?: boolean }) {
    const sections = design.sections ?? [{ title: 'In this order', items: design.order ?? DEFAULT_ORDER }];
    return (
        <section className={`${wide ? 'w-full max-w-[1100px]' : 'max-w-[380px]'} rounded-[20px] bg-white p-[24px] text-[#17171A]${sticky ? ' lg:sticky lg:top-[88px]' : ''}`}>
            <div role="heading" aria-level={1} className="text-[22px] font-semibold">{design.name}</div>
            <p className="mt-[8px] max-w-[720px] text-[14px] leading-relaxed text-[#4A4A50]">{design.blurb}</p>
            <div className={wide ? 'grid gap-x-[32px] md:grid-cols-2' : ''}>
                {sections.map(sec => (
                    <div key={sec.title}>
                        <div role="heading" aria-level={2} className="mt-[18px] text-[13px] font-semibold uppercase tracking-[0.1em] text-[#6B6B70]">{sec.title}</div>
                        <ol className="mt-[8px] list-decimal pl-[18px] text-[13.5px] leading-[1.7] text-[#2A2A2E]">
                            {sec.items.map(line => <li key={line}>{line}</li>)}
                        </ol>
                    </div>
                ))}
            </div>
            <p className="mt-[16px] text-[12.5px] leading-relaxed text-[#6B6B70]">Blocks marked Sample are not wired to a data hook yet. Every button is preview only: approving or rejecting changes the screen, nothing is saved.</p>
        </section>
    );
}

function subscribeResize(cb: () => void) {
    window.addEventListener('resize', cb);
    return () => window.removeEventListener('resize', cb);
}

function read<T extends string>(name: string, allowed: readonly T[], fallback: T): T {
    const v = new URLSearchParams(window.location.search).get(name) as T | null;
    return v && allowed.includes(v) ? v : fallback;
}

export default function OrgMobileLab() {
    const [view, setView] = useState<View>(() => read('design', ['all', 'cobalt', 'slate', 'teal', 'plum', 'pulse', 'noir', 'ivory', 'onyx', 'gilt'] as const, 'cobalt'));
    const [state, setState] = useState<PreviewState>(() => read('state', STATES.map(s => s.id), 'normal'));
    const width = useSyncExternalStore(subscribeResize, () => window.innerWidth, () => 1440);
    const m = useOrgModel(state);
    const device = width < 520;

    useEffect(() => {
        const url = new URL(window.location.href);
        url.searchParams.set('design', view);
        if (state === 'normal') url.searchParams.delete('state'); else url.searchParams.set('state', state);
        window.history.replaceState(window.history.state, '', url.toString());
    }, [view, state]);

    const shown = device && view === 'all' ? 'cobalt' : view;
    const compared = DESIGNS.filter(d => d.group === 'new');
    const cols = width >= 1400 ? 4 : width >= 1000 ? 3 : width >= 760 ? 2 : 1;
    const pulseCols = width >= 1000 ? 3 : 1;
    const pulseScale = Math.min(1, (width - 64 - (pulseCols - 1) * 28) / pulseCols / 414);
    const allScale = Math.min(1, (width - 64 - (cols - 1) * 28) / cols / 414);
    const cobaltCols = width >= 1400 ? 4 : width >= 1000 ? 3 : width >= 760 ? 2 : 1;
    const cobaltScale = Math.min(1, (width - 64 - (cobaltCols - 1) * 28) / cobaltCols / 414);
    const worstSite = m.sites.data?.[0]?.id ?? 'site-hp';
    const one = DESIGNS.find(d => d.id === shown);

    return (
        <div className="lab-shell min-h-screen bg-[#E9E7E2]" style={{ fontFamily: 'var(--font-lab-inter), system-ui, sans-serif' }}>
            <style dangerouslySetInnerHTML={{ __html: LAB_CSS }} />
            <header className="lab-bar z-[60] bg-[#111113] text-white sm:sticky sm:top-0">
                <div className="lab-scroll-x flex min-h-[56px] items-center gap-[10px] overflow-x-auto px-[12px] py-[8px]">
                    <Link href="/design-lab" className="inline-flex h-10 shrink-0 items-center gap-[6px] rounded-full px-[10px] text-[13px] font-semibold text-white/80 hover:text-white">
                        <ArrowLeft className="h-4 w-4" aria-hidden /><FlaskConical className="h-4 w-4" aria-hidden /><span className="hidden md:inline">Design Lab</span>
                    </Link>
                    <span className="hidden shrink-0 text-[13px] font-semibold lg:inline">Org super admin, mobile</span>
                    <div role="tablist" aria-label="Design" className="flex shrink-0 items-center gap-[6px]">
                        {[{ id: 'all' as View, name: 'Compare', dot: '', group: 'new' as const }, ...DESIGNS].filter(d => !(device && d.id === 'all')).map((d, i, all) => {
                            const on = d.id === shown;
                            const firstGold = d.group === 'gold' && all[i - 1]?.group !== 'gold';
                            return (
                                <React.Fragment key={d.id}>
                                    {firstGold && <span className="ml-[8px] shrink-0 pr-[2px] text-[11.5px] font-medium uppercase tracking-[0.08em] text-white/55">Earlier, gold</span>}
                                    <button type="button" role="tab" aria-selected={on} onClick={() => setView(d.id)}
                                        className="inline-flex h-10 shrink-0 items-center gap-[8px] rounded-full px-[14px] text-[13px] font-medium"
                                        style={{ background: on ? '#FFFFFF' : 'rgba(255,255,255,0.08)', color: on ? '#111113' : d.group === 'gold' ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.9)' }}>
                                        {d.dot && <span aria-hidden className="h-2.5 w-2.5 rounded-full" style={{ background: d.dot, boxShadow: on ? 'none' : '0 0 0 1px rgba(255,255,255,0.35)' }} />}
                                        {d.name}
                                    </button>
                                </React.Fragment>
                            );
                        })}
                    </div>
                    <label className="ml-auto flex shrink-0 items-center gap-[8px] text-[12px] text-white/70">
                        State
                        <select value={state} onChange={e => setState(e.target.value as PreviewState)} className="h-8 rounded-full border border-white/15 bg-white/[0.08] px-[10px] text-[12.5px] font-medium text-white">
                            {STATES.map(s => <option key={s.id} value={s.id} className="text-black">{s.label}</option>)}
                        </select>
                    </label>
                    <span className="inline-flex h-8 shrink-0 items-center gap-[6px] rounded-full px-[12px] text-[12px] font-medium"
                        style={{ background: m.source === 'live' ? 'rgba(124,199,46,0.18)' : 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.86)' }}
                        title={m.source === 'live' ? 'Org feeds are live for your organisation. Blocks marked Sample are not wired to a data hook yet.' : 'Sign in with an org-wide role to see live data. Showing sample data.'}>
                        <span aria-hidden className="h-1.5 w-1.5 rounded-full" style={{ background: m.source === 'live' ? '#A6DD4E' : 'rgba(255,255,255,0.5)' }} />
                        {m.source === 'live' ? `Live: ${m.orgName}` : 'Sample data'}
                    </span>
                </div>
            </header>

            {device && one ? (
                <div style={{ ['--org-safe-top' as string]: '0px', ['--org-app-h' as string]: '100dvh' } as React.CSSProperties}><one.Component m={m} /></div>
            ) : shown === 'all' ? (
                <main className="mx-auto flex flex-wrap justify-center gap-[28px] px-[32px] py-[32px]">
                    {compared.map(d => (
                        <div key={d.id} className="flex flex-col items-center gap-[12px]">
                            <PhoneFrame label={d.name} scale={allScale} statusDark={d.statusDark}><d.Component m={m} /></PhoneFrame>
                            <button type="button" onClick={() => setView(d.id)} className="h-10 rounded-full bg-white px-[16px] text-[13px] font-semibold text-[#111113] shadow-sm">{d.name}</button>
                        </div>
                    ))}
                </main>
            ) : one && (one.id === 'cobalt' || one.id === 'slate') ? (
                <main className="mx-auto flex flex-col items-center gap-[28px] px-[32px] py-[32px]">
                    <Notes design={one} wide />
                    <div className="grid justify-center gap-[28px]" style={{ gridTemplateColumns: `repeat(${cobaltCols}, max-content)` }}>
                        {GALLERIES[one.id].map(s => (
                            <div key={s.label} className="flex flex-col items-center gap-[12px]">
                                <PhoneFrame label={`${one.name}, ${s.label}`} scale={cobaltScale} statusDark={one.statusDark}>
                                    <one.Component key={s.label === 'Site page' ? worstSite : s.label} m={m} start={s.start(worstSite)} />
                                </PhoneFrame>
                                <span className="text-[13px] font-semibold text-[#3A3A3F]">{s.label}</span>
                            </div>
                        ))}
                    </div>
                </main>
            ) : one?.id === 'pulse' ? (
                <main className="mx-auto flex flex-col items-center gap-[28px] px-[32px] py-[32px]">
                    <div className="flex flex-wrap justify-center gap-[28px]">
                        {PULSE_SCREENS.map(s => (
                            <div key={s.tab} className="flex flex-col items-center gap-[12px]">
                                <PhoneFrame label={`Pulse, ${s.label}`} scale={pulseScale} statusDark={false}><PulseOrg m={m} initialTab={s.tab} /></PhoneFrame>
                                <span className="text-[13px] font-semibold text-[#3A3A3F]">{s.label}</span>
                            </div>
                        ))}
                    </div>
                    <Notes design={one} />
                </main>
            ) : one ? (
                <main className="mx-auto flex max-w-[1100px] flex-col items-center gap-[32px] px-[24px] py-[32px] lg:flex-row lg:items-start lg:justify-center">
                    <PhoneFrame label={one.name} statusDark={one.statusDark}><one.Component m={m} /></PhoneFrame>
                    <Notes design={one} sticky />
                </main>
            ) : null}

            <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-[24px] z-[80] flex justify-center px-[16px]">
                {m.toastMessage && <div className="pointer-events-auto max-w-[480px] rounded-[14px] bg-[#111113] px-[16px] py-[12px] text-[13.5px] font-medium text-white shadow-2xl">{m.toastMessage}</div>}
            </div>
        </div>
    );
}
