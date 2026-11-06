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

/**
 * /design-lab/org-mobile: the org super admin's mobile dashboard in five directions.
 * "Compare all" puts the phones side by side; picking one shows it alone with its notes.
 * Pulse shows three of its screens at once, the way a design shot would.
 * On a real phone the chosen design fills the screen instead of sitting in a frame.
 */

type OrgDesignId = 'pulse' | 'noir' | 'ivory' | 'onyx' | 'gilt';
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

const DESIGNS: { id: OrgDesignId; name: string; dot: string; statusDark: boolean; blurb: string; order?: string[]; Component: React.ComponentType<{ m: OrgModel }> }[] = [
    { id: 'pulse', name: 'Pulse', dot: 'linear-gradient(135deg, #ECECE9 0%, #ECECE9 50%, #E6CD8C 50%)', statusDark: false, Component: PulseOrg,
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
    { id: 'noir', name: 'Noir', dot: 'linear-gradient(135deg, #0A0A0A 0%, #0A0A0A 55%, #C9A24A 55%)', statusDark: true, Component: NoirOrg,
        blurb: 'Private banking feel. A black band with a gold glow holds the portfolio score and your sites as swipeable cards; a white sheet below holds the rest in order of urgency.' },
    { id: 'ivory', name: 'Ivory', dot: 'linear-gradient(135deg, #FAF8F3 0%, #FAF8F3 55%, #C9A24A 55%)', statusDark: false, Component: IvoryOrg,
        blurb: 'A morning brief. One headline sentence says what matters, then numbered sections read top to bottom like a newspaper, with a ranked ledger of sites.' },
    { id: 'onyx', name: 'Onyx', dot: 'radial-gradient(circle at 35% 35%, #D4AF5A 0 28%, #111113 30%)', statusDark: true, Component: OnyxOrg,
        blurb: 'Dark triage. Act now, Watch and Trends are tabs; Act now is one inbox of every approval and risk, each with its action button.' },
    { id: 'gilt', name: 'Gilt', dot: 'linear-gradient(135deg, #EED79A 0%, #C9A24A 100%)', statusDark: true, Component: GiltOrg,
        blurb: 'Photo led. The building sits under a dark gradient, frosted glass tiles float over it, and gold appears only on good news.' },
];

const STATES: { id: PreviewState; label: string }[] = [
    { id: 'normal', label: 'Normal' }, { id: 'loading', label: 'Loading' }, { id: 'empty', label: 'Empty' },
    { id: 'error', label: 'Error' }, { id: 'offline', label: 'Offline' },
];

function Notes({ design, sticky }: { design: (typeof DESIGNS)[number]; sticky?: boolean }) {
    return (
        <section className={`max-w-[380px] rounded-[20px] bg-white p-[24px] text-[#17171A]${sticky ? ' lg:sticky lg:top-[88px]' : ''}`}>
            <div role="heading" aria-level={1} className="text-[22px] font-semibold">{design.name}</div>
            <p className="mt-[8px] text-[14px] leading-relaxed text-[#4A4A50]">{design.blurb}</p>
            <div role="heading" aria-level={2} className="mt-[18px] text-[13px] font-semibold uppercase tracking-[0.1em] text-[#6B6B70]">In this order</div>
            <ol className="mt-[8px] list-decimal pl-[18px] text-[13.5px] leading-[1.7] text-[#2A2A2E]">
                {(design.order ?? DEFAULT_ORDER).map(line => <li key={line}>{line}</li>)}
            </ol>
            <p className="mt-[16px] text-[12.5px] leading-relaxed text-[#6B6B70]">Blocks marked Sample are not wired to a data hook yet. Every button is preview only.</p>
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
    const [view, setView] = useState<View>(() => read('design', ['all', 'pulse', 'noir', 'ivory', 'onyx', 'gilt'] as const, 'pulse'));
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

    const shown = device && view === 'all' ? 'pulse' : view;
    const cols = width >= 1380 ? 5 : width >= 1000 ? 3 : width >= 760 ? 2 : 1;
    const pulseCols = width >= 1000 ? 3 : 1;
    const pulseScale = Math.min(1, (width - 64 - (pulseCols - 1) * 28) / pulseCols / 414);
    const allScale = Math.min(1, (width - 64 - (cols - 1) * 28) / cols / 414);
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
                        {[{ id: 'all' as View, name: 'Compare all', dot: '' }, ...DESIGNS].filter(d => !(device && d.id === 'all')).map(d => {
                            const on = d.id === shown;
                            return (
                                <button key={d.id} type="button" role="tab" aria-selected={on} onClick={() => setView(d.id)}
                                    className="inline-flex h-10 shrink-0 items-center gap-[8px] rounded-full px-[14px] text-[13px] font-medium"
                                    style={{ background: on ? '#FFFFFF' : 'rgba(255,255,255,0.08)', color: on ? '#111113' : 'rgba(255,255,255,0.86)' }}>
                                    {d.dot && <span aria-hidden className="h-2.5 w-2.5 rounded-full" style={{ background: d.dot, boxShadow: on ? 'none' : '0 0 0 1px rgba(255,255,255,0.35)' }} />}
                                    {d.name}
                                </button>
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
                <div style={{ ['--org-safe-top' as string]: '0px' } as React.CSSProperties}><one.Component m={m} /></div>
            ) : shown === 'all' ? (
                <main className="mx-auto flex flex-wrap justify-center gap-[28px] px-[32px] py-[32px]">
                    {DESIGNS.map(d => (
                        <div key={d.id} className="flex flex-col items-center gap-[12px]">
                            <PhoneFrame label={d.name} scale={allScale} statusDark={d.statusDark}><d.Component m={m} /></PhoneFrame>
                            <button type="button" onClick={() => setView(d.id)} className="h-10 rounded-full bg-white px-[16px] text-[13px] font-semibold text-[#111113] shadow-sm">{d.name}</button>
                        </div>
                    ))}
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
