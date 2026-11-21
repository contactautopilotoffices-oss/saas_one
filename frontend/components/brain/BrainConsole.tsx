'use client';

/**
 * The Brain Console: the Tech team's control room for the Unified Brain (the assistant that answers WhatsApp and
 * in-app messages). A dark instrument set into the light Tech shell; design sources are in brain.module.css.
 *
 * Privacy (owner 2026-11-14): messages are shown, never who sent them. The API sends no name, phone or id; a person is
 * an opaque day tag. Names exist only in the pilot picker on Switches, never next to a message.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import {
    Blocks, BrainCircuit, ClipboardCheck, Coins, Compass, Contrast, Cpu, Database, FlaskConical, ListChecks, MessagesSquare, OctagonAlert, Radar, RotateCw,
    ShieldAlert, SlidersHorizontal, Tags, TriangleAlert, Undo2,
} from 'lucide-react';
import { createHttpApi, type BrainApi } from './api';
import { BrainProvider, useBrain, type ScreenId } from './BrainContext';
import { MODE_LABEL, plural } from './labels';
import { Btn, Dialog, Empty, Toast, cx, s, useMotion } from './ui';
import OverviewScreen from './OverviewScreen';
import SwitchesScreen from './SwitchesScreen';
import SkillsScreen from './SkillsScreen';
import ConversationsScreen from './ConversationsScreen';
import ShadowScreen from './ShadowScreen';
import ReviewScreen from './ReviewScreen';
import GuidanceScreen from './GuidanceScreen';
import MemoryScreen from './MemoryScreen';
import CostScreen from './CostScreen';
import ModelsScreen from './ModelsScreen';
import CategoriesScreen from './CategoriesScreen';
import ScorecardScreen from './ScorecardScreen';

const SCREENS: Array<{ id: ScreenId; label: string; icon: React.ComponentType<{ className?: string }>; Component: React.ComponentType }> = [
    { id: 'overview', label: 'Overview', icon: Radar, Component: OverviewScreen },
    { id: 'switches', label: 'Switches', icon: SlidersHorizontal, Component: SwitchesScreen },
    { id: 'skills', label: 'Skills', icon: Blocks, Component: SkillsScreen },
    { id: 'conversations', label: 'Conversations', icon: MessagesSquare, Component: ConversationsScreen },
    { id: 'shadow', label: 'Shadow', icon: Contrast, Component: ShadowScreen },
    { id: 'review', label: 'Review', icon: ListChecks, Component: ReviewScreen },
    { id: 'guidance', label: 'Guidance', icon: Compass, Component: GuidanceScreen },
    { id: 'memory', label: 'Memory', icon: Database, Component: MemoryScreen },
    { id: 'cost', label: 'Cost and keys', icon: Coins, Component: CostScreen },
    { id: 'models', label: 'AI models', icon: Cpu, Component: ModelsScreen },
    { id: 'categories', label: 'Categories & SLAs', icon: Tags, Component: CategoriesScreen },
    { id: 'scorecard', label: 'Scorecard', icon: ClipboardCheck, Component: ScorecardScreen },
];
const isScreen = (v: string | null): v is ScreenId => !!v && SCREENS.some(x => x.id === v);

export default function BrainConsole({ orgId }: { orgId: string }) {
    const router = useRouter();
    const params = useSearchParams();
    const screenParam = params.get('screen');
    const screen: ScreenId = isScreen(screenParam) ? screenParam : 'overview';

    // Demo data: development only, and only with ?brainDemo=1. The import sits inside the NODE_ENV check so a
    // production build drops it (and demoData.ts) entirely.
    const demoWanted = process.env.NODE_ENV !== 'production' && params.get('brainDemo') === '1';
    const httpApi = useMemo(() => createHttpApi(orgId), [orgId]);
    const [demoApi, setDemoApi] = useState<BrainApi | null>(null);
    useEffect(() => {
        let live = true;
        if (process.env.NODE_ENV !== 'production') {
            if (demoWanted) import('./demoData').then(m => { if (live) setDemoApi(m.createDemoApi()); });
        }
        return () => { live = false; };
    }, [demoWanted]);
    const api = demoWanted ? demoApi : httpApi;

    // Same pattern as TechDashboard: the screen lives in the URL (?tab=brain&screen=…), so a reload stays put.
    const go = useCallback((id: ScreenId) => {
        const next = new URLSearchParams(window.location.search);
        next.set('screen', id);
        router.replace(`${window.location.pathname}?${next.toString()}`, { scroll: false });
    }, [router]);

    return (
        <div className={cx(s.theme, s.root, '@container flex min-w-0 flex-col')}>
            {api ? (
                <BrainProvider key={demoWanted ? 'demo' : 'server'} api={api} orgId={orgId} demo={demoWanted} go={go}>
                    <Shell screen={screen} />
                </BrainProvider>
            ) : (
                <div role="status" className="grid flex-1 place-items-center p-10 text-[13px] text-(--bc-ink-3)">Loading demo data…</div>
            )}
        </div>
    );
}

function Shell({ screen }: { screen: ScreenId }) {
    const { status, forbidden, toastState } = useBrain();
    const Current = SCREENS.find(x => x.id === screen)!.Component;

    if (forbidden) {
        return (
            <Center>
                <Empty icon={ShieldAlert} title="This console is for the Tech team only.">If you are in the Tech team and see this, sign out and in again.</Empty>
            </Center>
        );
    }
    if (status?.tableMissing) {
        return (
            <>
                <Header />
                <Center>
                    <Empty icon={Database} title="Set-up needed" action={<Btn icon={RotateCw} onClick={() => window.location.reload()}>Reload</Btn>}>
                        The brain’s database tables are not applied yet. Apply migrations 20261114000001, 20261114000002 and 20261114000003, then reload.
                    </Empty>
                </Center>
            </>
        );
    }

    return (
        <>
            <Header />
            {status?.killSwitch && (
                <div className="pb-[16px]">
                    <div role="alert" className={cx(s.banner, s.bannerBad)}>
                        <OctagonAlert className="mt-0.5 h-5 w-5 shrink-0 text-(--bc-bad-text)" />
                        <div className="min-w-0">
                            <p className="text-[14px] font-semibold text-(--bc-bad-text)">Stopped for every organisation by the platform kill switch</p>
                            <p className="text-[12.5px] text-(--bc-ink-2)">Whatever the switches say, the brain does nothing until platform staff turn the kill switch off. Today’s bots answer every message.</p>
                        </div>
                    </div>
                </div>
            )}
            <Nav screen={screen} />
            <main className="flex min-w-0 flex-1 flex-col pt-[24px] pb-[40px] @3xl:pt-[32px]">
                <Current key={screen} />
            </main>
            <SaveBar />
            <Toast message={toastState?.message ?? null} tone={toastState?.tone ?? 'ok'} />
        </>
    );
}

function Center({ children }: { children: React.ReactNode }) {
    return <div className="grid min-h-[55vh] flex-1 place-items-center p-[24px]">{children}</div>;
}

function Header() {
    const { demo, status, settings } = useBrain();
    const killed = !!status?.killSwitch;
    // No mode is in force while the tables are missing: say nothing rather than something untrue.
    const mode = status?.tableMissing ? null : status?.mode ?? settings.view?.settings.mode ?? null;
    const modeClass = killed ? s.modeKilled : mode === 'live' ? s.modeLive : mode === 'shadow' ? s.modeShadow : s.modeOff;
    return (
        // The dashboard header above already says "Brain": this row only says what the console is and what state it is in.
        <header className="flex min-w-0 flex-wrap items-center gap-x-[12px] gap-y-[8px] pb-[16px]">
            <span aria-hidden="true" className="grid h-8 w-8 shrink-0 place-items-center rounded-[8px] bg-(--bc-accent-soft) text-(--bc-accent-text) shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--bc-accent)_24%,transparent)]">
                <BrainCircuit className="h-4 w-4" />
            </span>
            <p className="min-w-[12rem] flex-1 text-[13px] leading-snug text-(--bc-ink-2)">The control room for the assistant that answers WhatsApp and in-app messages.</p>
            <div className="flex flex-wrap items-center gap-[8px]">
                {demo && <span className={cx(s.chip, s['tone-accent'])} title="Made-up data for design review. Nothing is saved to the server."><FlaskConical className="h-3 w-3" />Demo data</span>}
                {mode && (
                    <span className={cx(s.chip, modeClass)} aria-label={`The brain is ${killed ? 'stopped by the kill switch' : MODE_LABEL[mode]}`}>
                        <span aria-hidden="true" className={cx(s.lamp, modeClass, 'h-2! w-2!')} />
                        {killed ? 'Stopped' : MODE_LABEL[mode]}
                    </span>
                )}
            </div>
        </header>
    );
}

function Nav({ screen }: { screen: ScreenId }) {
    const { go } = useBrain();
    const m = useMotion();
    const strip = useRef<HTMLDivElement>(null);
    // On a narrow console the strip scrolls sideways: keep the current screen in view (sideways only, never the page).
    useEffect(() => {
        const el = strip.current?.querySelector<HTMLElement>('[aria-current="page"]');
        if (!strip.current || !el) return;
        const { offsetLeft: left, offsetWidth: width } = el;
        const box = strip.current;
        if (left < box.scrollLeft || left + width > box.scrollLeft + box.clientWidth) box.scrollLeft = Math.max(0, left - 24);
    }, [screen]);
    // A full-width strip under the dashboard header: the negative margins undo TechDashboard's content padding
    // (p-4 md:p-8), so the glass runs edge to edge like a second header row.
    return (
        <nav aria-label="Brain console screens" className={cx(s.glass, 'sticky top-16 z-20 -mx-4 border-b border-(--bc-line) px-2 md:-mx-8 md:px-6')}>
            <div ref={strip} className={s.nav}>
                {SCREENS.map(x => {
                    const on = x.id === screen;
                    const Icon = x.icon;
                    return (
                        <button key={x.id} type="button" className={s.navItem} aria-current={on ? 'page' : undefined} onClick={() => go(x.id)}>
                            <Icon className="h-4 w-4" />{x.label}
                            {on && <motion.span layoutId="brain-nav-bar" className={s.navBar} transition={m.t(0.3)} />}
                        </button>
                    );
                })}
            </div>
        </nav>
    );
}

/**
 * Unsaved switches (from Switches or Skills) float here on every screen. Saving opens a plain list of what will change;
 * going live, opening to everyone, or making an action skill live needs an explicit "I understand" first.
 */
function SaveBar() {
    const { settings: st, toast, go } = useBrain();
    const m = useMotion();
    const [open, setOpen] = useState(false);
    const [ack, setAck] = useState(false);
    const [err, setErr] = useState<{ message: string; conflict: boolean } | null>(null);
    const risky = st.risks.length > 0;

    const openReview = () => { setErr(null); setAck(false); setOpen(true); };
    const save = async () => {
        const r = await st.save();
        if (r.ok) { setOpen(false); toast('Saved. The brain uses the new switches from its next message.'); return; }
        setErr({ message: r.message, conflict: r.kind === 'conflict' });
    };

    return (
        <>
            <AnimatePresence>
                {st.dirty && (
                    <motion.div key="bar" initial={m.reduce ? { opacity: 0 } : { opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={m.reduce ? { opacity: 0 } : { opacity: 0, y: 12 }} transition={m.t(0.3)}
                        className="sticky bottom-4 z-30 mb-[16px]">
                        <div role="region" aria-label="Unsaved changes" className={cx(s.glass, 'flex flex-wrap items-center gap-[12px] rounded-xl px-4 py-3 shadow-(--bc-e5)')}>
                            <span className="h-2 w-2 shrink-0 rounded-full bg-(--bc-accent)" aria-hidden="true" />
                            <p className="min-w-0 flex-1 text-[13.5px] text-(--bc-ink-1)">
                                <b className="font-semibold">{plural(st.changes.length, 'unsaved change')}</b>
                                {risky && <span className="ml-2 inline-flex items-center gap-[4px] text-[12.5px] text-(--bc-warn-text)"><TriangleAlert className="h-3.5 w-3.5" />needs your confirmation</span>}
                            </p>
                            <Btn size="sm" variant="quiet" icon={Undo2} onClick={st.discard}>Discard</Btn>
                            <Btn size="sm" variant="primary" onClick={openReview}>Review changes</Btn>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
            <Dialog open={open} onClose={() => setOpen(false)} title="Review changes" footer={
                err?.conflict
                    ? <><Btn variant="quiet" onClick={() => setOpen(false)}>Close</Btn><Btn variant="primary" icon={RotateCw} onClick={() => { st.reload(); setOpen(false); go('switches'); }}>Reload the switches</Btn></>
                    : <><Btn variant="quiet" onClick={() => setOpen(false)}>Keep editing</Btn><Btn variant="primary" data-autofocus={!risky || undefined} disabled={st.saving || (risky && !ack)} onClick={save}>{st.saving ? 'Saving…' : risky ? 'Confirm and save' : 'Save'}</Btn></>
            }>
                <p className="text-[13px] text-(--bc-ink-3)">This is what will change. The server checks it again before saving.</p>
                <ul className={cx(s.well, s.rows, 'px-4')}>
                    {st.changes.map(c => <li key={c} className="py-2.5 text-[13.5px] break-words text-(--bc-ink-1)">{c}</li>)}
                </ul>
                {risky && (
                    <div className={cx(s.banner, s.bannerWarn, 'flex-col gap-[12px]')}>
                        <p className="flex items-center gap-[8px] text-[13.5px] font-semibold text-(--bc-warn-text)"><TriangleAlert className="h-4 w-4" />This changes what real people get</p>
                        <ul className="flex list-disc flex-col gap-1.5 pl-5 text-[13.5px] text-(--bc-ink-1)">{st.risks.map(r => <li key={r}>{r}</li>)}</ul>
                        <label className="flex items-center gap-2.5 text-[13.5px] text-(--bc-ink-1)">
                            <input type="checkbox" data-autofocus checked={ack} onChange={e => setAck(e.target.checked)} className="h-4 w-4 accent-(--bc-accent)" />
                            I understand, make {st.risks.length === 1 ? 'this change' : 'these changes'}
                        </label>
                    </div>
                )}
                {err && (
                    <p role="alert" className={cx(s.banner, s.bannerBad, 'text-[13.5px]')}>
                        <OctagonAlert className="mt-0.5 h-4 w-4 shrink-0 text-(--bc-bad-text)" />
                        <span>{err.message}</span>
                    </p>
                )}
            </Dialog>
        </>
    );
}
