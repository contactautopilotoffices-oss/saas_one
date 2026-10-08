'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { FlaskConical } from 'lucide-react';
import { useLabModel } from './lab/useLabModel';
import type { DesignId, PreviewState, ScreenId } from './lab/types';
import InkDesign from './designs/ink/InkDesign';
import BentoDesign from './designs/bento/BentoDesign';
import ContrastDesign from './designs/contrast/ContrastDesign';
import PlannerDesign from './designs/planner/PlannerDesign';
import InboxDesign from './designs/inbox/InboxDesign';
import SkylineDesign from './designs/skyline/SkylineDesign';
import type { LabModel } from './lab/useLabModel';

/**
 * /design-lab: six complete UI directions, three screens each, switchable instantly.
 *
 * All six designs are imported statically so switching never waits on a chunk. State lives
 * in the URL (?design=&screen=&state=) through history.replaceState, so a view can be shared
 * without a reload or a server round trip.
 */

export interface DesignProps {
    lab: LabModel;
    screen: ScreenId;
    setScreen: (s: ScreenId) => void;
}

const DESIGNS: { id: DesignId; name: string; dot: string; Component: React.ComponentType<DesignProps> }[] = [
    { id: 'ink', name: 'Ink', dot: '#0B0B0C', Component: InkDesign },
    { id: 'bento', name: 'Bento', dot: '#0A8A5F', Component: BentoDesign },
    { id: 'contrast', name: 'Contrast', dot: '#2457F5', Component: ContrastDesign },
    { id: 'planner', name: 'Day Planner', dot: '#F5A623', Component: PlannerDesign },
    { id: 'inbox', name: 'Violet Inbox', dot: '#5B4CF5', Component: InboxDesign },
    { id: 'skyline', name: 'Skyline Glass', dot: 'linear-gradient(135deg, #4677AC 0%, #4677AC 50%, #A6DD4E 50%, #A6DD4E 100%)', Component: SkylineDesign },
];

const SCREENS: { id: ScreenId; label: string }[] = [
    { id: 'dashboard', label: 'Dashboard' },
    { id: 'tickets', label: 'Tickets' },
    { id: 'detail', label: 'Ticket detail' },
];

const STATES: { id: PreviewState; label: string }[] = [
    { id: 'normal', label: 'Normal' },
    { id: 'loading', label: 'Loading' },
    { id: 'empty', label: 'Empty' },
    { id: 'error', label: 'Error' },
    { id: 'offline', label: 'Offline' },
];

const LAB_CSS = `
.lab-shell { --lab-bar-h: 100px; }
@media (min-width: 1400px) { .lab-shell { --lab-bar-h: 56px; } }
.lab-root p, .lab-root label, .lab-root button, .lab-root input, .lab-root select { font-family: inherit; }
.lab-root :focus-visible { outline: 2px solid var(--lab-focus); outline-offset: 2px; }
.lab-root label input:focus-visible { outline: none; }
.lab-root label:has(input:focus-visible) { outline: 2px solid var(--lab-focus); outline-offset: 2px; }
.lab-bar :focus-visible { outline: 2px solid #FFFFFF; outline-offset: 2px; }
.lab-skeleton { background: linear-gradient(90deg, var(--lab-skel-a) 0%, var(--lab-skel-b) 50%, var(--lab-skel-a) 100%); background-size: 200% 100%; animation: lab-shimmer 1.4s ease-in-out infinite; }
@keyframes lab-shimmer { 0% { background-position: 100% 0; } 100% { background-position: -100% 0; } }
@media (prefers-reduced-motion: reduce) { .lab-skeleton { animation: none; } .lab-root * { transition-duration: 0ms !important; } }
.lab-scroll-x { scrollbar-width: none; }
.lab-scroll-x::-webkit-scrollbar { display: none; }
`;

function readParam<T extends string>(name: string, allowed: readonly T[], fallback: T): T {
    if (typeof window === 'undefined') return fallback;
    const v = new URLSearchParams(window.location.search).get(name) as T | null;
    return v && allowed.includes(v) ? v : fallback;
}

export default function DesignLab() {
    const [design, setDesign] = useState<DesignId>(() => readParam('design', DESIGNS.map(d => d.id), 'ink'));
    const [screen, setScreen] = useState<ScreenId>(() => readParam('screen', SCREENS.map(s => s.id), 'dashboard'));
    const [preview, setPreview] = useState<PreviewState>(() => readParam('state', STATES.map(s => s.id), 'normal'));

    // ?drawer=1 on a detail link opens the Assign technician drawer on arrival.
    const [initialDrawer] = useState(() => screen === 'detail' && readParam('drawer', ['1', '0'] as const, '0') === '1');
    const lab = useLabModel(preview, initialDrawer);

    useEffect(() => {
        const url = new URL(window.location.href);
        url.searchParams.set('design', design);
        url.searchParams.set('screen', screen);
        if (preview === 'normal') url.searchParams.delete('state');
        else url.searchParams.set('state', preview);
        window.history.replaceState(window.history.state, '', url.toString());
    }, [design, screen, preview]);

    const go = useCallback((s: ScreenId) => {
        setScreen(s);
        window.scrollTo({ top: 0 });
    }, []);

    const active = DESIGNS.find(d => d.id === design) ?? DESIGNS[0];
    const Active = active.Component;

    return (
        <div className="lab-shell min-h-screen bg-white">
            <style dangerouslySetInnerHTML={{ __html: LAB_CSS }} />
            <header
                className="lab-bar sticky top-0 z-[60] flex flex-col bg-[#111113] text-white min-[1400px]:h-14 min-[1400px]:flex-row min-[1400px]:items-center min-[1400px]:gap-[16px] min-[1400px]:px-4"
                style={{ fontFamily: 'var(--font-lab-inter), system-ui, sans-serif' }}
            >
                <div className="flex h-[52px] min-w-0 items-center gap-[12px] px-3 min-[1400px]:h-auto min-[1400px]:flex-1 min-[1400px]:px-0">
                    <span className="flex shrink-0 items-center gap-[8px] pr-1 text-[13px] font-semibold tracking-tight">
                        <FlaskConical className="h-4 w-4" aria-hidden />
                        <span className="hidden sm:inline">Design Lab</span>
                    </span>
                    <div role="tablist" aria-label="Design" className="lab-scroll-x flex min-w-0 items-center gap-1.5 overflow-x-auto">
                        {DESIGNS.map(d => {
                            const on = d.id === design;
                            return (
                                <button
                                    key={d.id}
                                    type="button"
                                    role="tab"
                                    aria-selected={on}
                                    onClick={() => setDesign(d.id)}
                                    className="inline-flex h-10 shrink-0 items-center gap-[8px] rounded-full px-3.5 text-[13px] font-medium transition-colors"
                                    style={{ background: on ? '#FFFFFF' : 'rgba(255,255,255,0.08)', color: on ? '#111113' : 'rgba(255,255,255,0.86)' }}
                                >
                                    <span aria-hidden className="h-2.5 w-2.5 rounded-full" style={{ background: d.dot, boxShadow: on ? 'none' : '0 0 0 1px rgba(255,255,255,0.35)' }} />
                                    {d.name}
                                </button>
                            );
                        })}
                    </div>
                </div>
                <div className="lab-scroll-x flex h-12 items-center gap-[12px] overflow-x-auto border-t border-white/10 px-3 min-[1400px]:h-auto min-[1400px]:overflow-visible min-[1400px]:border-0 min-[1400px]:px-0">
                    <div role="tablist" aria-label="Screen" className="flex shrink-0 items-center gap-0.5 rounded-full bg-white/[0.08] p-[4px]">
                        {SCREENS.map(s => {
                            const on = s.id === screen;
                            return (
                                <button
                                    key={s.id}
                                    type="button"
                                    role="tab"
                                    aria-selected={on}
                                    onClick={() => go(s.id)}
                                    className="h-8 shrink-0 rounded-full px-3.5 text-[12.5px] font-semibold"
                                    style={{ background: on ? '#FFFFFF' : 'transparent', color: on ? '#111113' : 'rgba(255,255,255,0.8)' }}
                                >
                                    {s.label}
                                </button>
                            );
                        })}
                    </div>
                    <label className="flex shrink-0 items-center gap-[8px] text-[12px] text-white/70">
                        <span className="min-[1400px]:sr-only">State</span>
                        <select
                            value={preview}
                            onChange={e => setPreview(e.target.value as PreviewState)}
                            className="h-8 rounded-full border border-white/15 bg-white/[0.08] px-2.5 text-[12.5px] font-medium text-white"
                        >
                            {STATES.map(s => <option key={s.id} value={s.id} className="text-black">{s.label}</option>)}
                        </select>
                    </label>
                    <span
                        className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-[12px] font-medium"
                        style={{ background: lab.source === 'live' ? 'rgba(124,199,46,0.18)' : 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.86)' }}
                        title={lab.source === 'live' ? 'Tickets come from the existing tickets endpoint for this property.' : 'Sign in to a property to see live tickets. Showing the sample data from the brief.'}
                    >
                        <span aria-hidden className="h-1.5 w-1.5 rounded-full" style={{ background: lab.source === 'live' ? '#A6DD4E' : 'rgba(255,255,255,0.5)' }} />
                        {lab.source === 'live' ? `Live tickets: ${lab.propertyName}` : 'Sample data'}
                    </span>
                </div>
            </header>
            <Active key={design} lab={lab} screen={screen} setScreen={go} />
        </div>
    );
}
