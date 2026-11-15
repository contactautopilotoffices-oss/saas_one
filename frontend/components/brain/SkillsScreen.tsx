'use client';

/**
 * Skills: the brain's registry. Each skill's mode (off / practice only / live) edits the same draft as Switches and is
 * saved through the same "Review changes" bar. A write skill must practise before it can go live.
 */
import React, { useState } from 'react';
import { BookOpen, ChevronDown, ClipboardList, Database, DoorOpen, Eye, PenLine, Search, Ticket, TriangleAlert, Zap } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import type { BrainModule, SkillMode } from '@/backend/lib/aiLayer/brain/types';
import type { SkillView } from '@/backend/lib/aiLayer/brain/console/types';
import { useBrain } from './BrainContext';
import { MODULE_LABEL, RISK_LABEL, ROLE_LABEL, SKILL_MODE_LABEL, dateTimeIN, int, plural } from './labels';
import { offToLiveRefused, skillModeOf } from './settingsDiff';
import { Card, Chip, Empty, ErrorState, LoadingScreen, Screen, Segmented, cx, s, useMotion } from './ui';

const MODULE_ICON: Record<BrainModule, React.ComponentType<{ className?: string }>> = {
    tickets: Ticket, rooms: DoorOpen, tasks: ClipboardList, electricity: Zap, knowledge: BookOpen, memory: Database,
};
const ORDER: BrainModule[] = ['tickets', 'rooms', 'tasks', 'electricity', 'knowledge', 'memory'];

export default function SkillsScreen() {
    const { settings: st } = useBrain();
    const [q, setQ] = useState('');
    const [kind, setKind] = useState<'all' | 'read' | 'write'>('all');

    if (!st.res || (!st.skills && !st.skillsError)) return <Screen title="Skills"><LoadingScreen label="Loading the skills" /></Screen>;
    if (st.skillsError || !st.skills) return <Screen title="Skills"><ErrorState what="the skills" message={st.skillsError ?? 'No skills came back.'} onRetry={st.reload} /></Screen>;
    if (!st.draft || !st.view) return <Screen title="Skills"><ErrorState what="the switches" message={st.res.ok ? 'No settings came back.' : st.res.message} onRetry={st.reload} /></Screen>;

    const draft = st.draft, saved = st.view.settings, all = st.skills;
    const needle = q.trim().toLowerCase();
    const shown = all.filter(sk => (kind === 'all' || sk.kind === kind) && (!needle || sk.id.toLowerCase().includes(needle) || sk.description.toLowerCase().includes(needle) || sk.examples.some(e => e.toLowerCase().includes(needle))));
    const count = (m: SkillMode) => all.filter(sk => skillModeOf(draft, sk) === m).length;

    const setMode = (sk: SkillView, mode: SkillMode) => st.edit(x => {
        const next = { ...x.skillModes };
        // Going back to what is saved restores the saved form exactly, so it is not counted as a change.
        if (mode === skillModeOf(saved, sk)) { if (saved.skillModes[sk.id] === undefined) delete next[sk.id]; else next[sk.id] = saved.skillModes[sk.id]; }
        else next[sk.id] = mode;
        return { ...x, skillModes: next };
    });

    return (
        <Screen title="Skills" sub="What the brain can look up and do. Practice only means it shows what it would do and records it, but never does it.">
            <div className="flex flex-col gap-[12px] @3xl:flex-row @3xl:items-center @3xl:justify-between">
                <p className={cx(s.tab, 'text-[13px] text-(--bc-ink-2)')}>
                    {plural(all.length, 'skill')} · <b className="font-semibold text-(--bc-ok-text)">{count('live')} live</b> · <b className="font-semibold text-(--bc-info-text)">{count('shadow')} practice only</b> · {count('off')} off
                </p>
                <div className="flex flex-col gap-[8px] @lg:flex-row @lg:items-center">
                    <div className="relative min-w-0 @lg:w-64">
                        <label htmlFor="skill-q" className="sr-only">Search skills</label>
                        <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-(--bc-ink-3)" />
                        <input id="skill-q" type="search" className={cx(s.input, 'pl-9!')} placeholder="Search skills or phrases" value={q} onChange={e => setQ(e.target.value)} autoComplete="off" />
                    </div>
                    <Segmented label="Kind of skill" value={kind} onChange={setKind} options={[{ value: 'all', label: 'All' }, { value: 'read', label: 'Look-ups', icon: Eye }, { value: 'write', label: 'Actions', icon: PenLine }]} />
                </div>
            </div>

            {shown.length === 0 ? (
                <Card><Empty icon={Search} title={all.length ? 'No skill matches' : 'No skills yet'}>{all.length ? 'Try another word, or show all kinds.' : 'Skills appear here once the brain’s registry is deployed.'}</Empty></Card>
            ) : (
                ORDER.filter(mod => shown.some(sk => sk.module === mod)).map(mod => {
                    const Icon = MODULE_ICON[mod];
                    return (
                        <section key={mod} aria-labelledby={`mod-${mod}`} className="flex flex-col gap-[12px]">
                            <h3 id={`mod-${mod}`} className={cx(s.label, 'flex items-center gap-[8px]')}><Icon className="h-3.5 w-3.5" />{MODULE_LABEL[mod]}</h3>
                            <ul className="grid min-w-0 gap-[12px] @5xl:grid-cols-2">
                                {shown.filter(sk => sk.module === mod).map(sk => (
                                    <SkillRow key={sk.id} sk={sk} mode={skillModeOf(draft, sk)} savedMode={skillModeOf(saved, sk)} onMode={m => setMode(sk, m)} />
                                ))}
                            </ul>
                        </section>
                    );
                })
            )}
        </Screen>
    );
}

function SkillRow({ sk, mode, savedMode, onMode }: { sk: SkillView; mode: SkillMode; savedMode: SkillMode; onMode: (m: SkillMode) => void }) {
    const [open, setOpen] = useState(false);
    const m = useMotion();
    const refused = offToLiveRefused(savedMode, sk.kind, sk.defaultMode);
    const changed = mode !== savedMode;
    const rateFailed = sk.usage.calls ? sk.usage.failed / sk.usage.calls : 0;
    return (
        <Card as="li" className="@container flex min-w-0 flex-col gap-[12px] p-[16px]">
            <div className="flex min-w-0 flex-col gap-[12px] @xl:flex-row @xl:items-start @xl:justify-between">
                <div className="flex min-w-0 flex-col gap-1.5">
                    <div className="flex min-w-0 flex-wrap items-center gap-[8px]">
                        <span className={cx(s.mono, 'text-[13px] font-semibold text-(--bc-ink-1)')}>{sk.id}</span>
                        {sk.kind === 'write' ? <Chip tone="accent" icon={PenLine}>Action</Chip> : <Chip icon={Eye}>Look-up</Chip>}
                        {changed && <span className="text-[11.5px] font-medium text-(--bc-accent-text)">● was {SKILL_MODE_LABEL[savedMode].toLowerCase()}</span>}
                    </div>
                    <p className="line-clamp-2 text-[13px] leading-snug text-(--bc-ink-2)">{sk.description}</p>
                </div>
                <Segmented size="sm" label={`Mode for ${sk.id}`} value={mode} onChange={onMode} className="shrink-0 self-start"
                    options={[
                        { value: 'off', label: 'Off' },
                        { value: 'shadow', label: 'Practice only' },
                        { value: 'live', label: 'Live', disabled: refused && mode !== 'live', title: refused ? 'Set it to practice only and save first.' : undefined },
                    ]} />
            </div>
            {refused && mode === 'off' && (
                <p className="text-[12px] leading-snug text-(--bc-ink-3)">To make it live, set it to practice only and save first: an action is practised before it is done for real.</p>
            )}
            <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 mt-auto border-t border-(--bc-line) pt-3 text-[12px] text-(--bc-ink-3)">
                <span className={cx(s.tab, 'flex flex-wrap items-center gap-x-3 gap-y-1')}>
                    <span>{sk.usage.calls ? `Used ${int(sk.usage.calls)} ${sk.usage.calls === 1 ? 'time' : 'times'}` : 'Not used yet'}</span>
                    {sk.usage.failed > 0 && <span className={cx('flex items-center gap-[4px]', rateFailed >= 0.1 ? 'text-(--bc-bad-text)' : 'text-(--bc-warn-text)')}><TriangleAlert className="h-3 w-3" />{int(sk.usage.failed)} failed</span>}
                    {sk.usage.lastUsedAt && <span>Last {dateTimeIN(sk.usage.lastUsedAt)}</span>}
                </span>
                <button type="button" aria-expanded={open} aria-controls={`sk-${sk.id}`} onClick={() => setOpen(o => !o)} className="inline-flex items-center gap-[4px] rounded-md py-0.5 font-semibold text-(--bc-ink-2) hover:text-(--bc-ink-1)">
                    {open ? 'Less' : 'More'}<ChevronDown className={cx('h-3.5 w-3.5 transition-transform duration-300', open && 'rotate-180')} />
                </button>
            </div>
            <AnimatePresence initial={false}>
                {open && (
                    <motion.div id={`sk-${sk.id}`} key="more" initial={m.reduce ? { opacity: 0 } : { height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={m.reduce ? { opacity: 0 } : { height: 0, opacity: 0 }} transition={m.t(0.3)} className="overflow-hidden">
                        <div className="flex flex-col gap-[16px] pt-1">
                            <p className="text-[13px] leading-relaxed whitespace-pre-line text-(--bc-ink-2)">{sk.description}</p>
                            {sk.examples.length > 0 && (
                                <div className="flex flex-col gap-[8px]">
                                    <span className={s.label}>People ask for it like this</span>
                                    <ul className="flex flex-wrap gap-1.5">{sk.examples.map(e => <li key={e} className="rounded-md bg-(--bc-l2) px-2.5 py-1 text-[12.5px] text-(--bc-ink-1) shadow-[inset_0_0_0_1px_var(--bc-line)]">“{e}”</li>)}</ul>
                                </div>
                            )}
                            <dl className="grid gap-[12px] text-[12.5px] @md:grid-cols-3">
                                <div><dt className={s.label}>What it changes</dt><dd className="mt-1 text-(--bc-ink-1)">{RISK_LABEL[sk.risk] ?? `Risk ${sk.risk}`}</dd></div>
                                <div><dt className={s.label}>Default</dt><dd className="mt-1 text-(--bc-ink-1)">{SKILL_MODE_LABEL[sk.defaultMode]}</dd></div>
                                <div>
                                    <dt className={s.label}>Who gets it by default</dt>
                                    <dd className="mt-1 flex flex-wrap gap-1.5">
                                        {(['staff', 'client', 'vendor'] as const).map(r => <Chip key={r} tone={sk.roles[r] ? 'ok' : 'neutral'}>{sk.roles[r] ? '✓' : '–'} {ROLE_LABEL[r]}</Chip>)}
                                    </dd>
                                </div>
                            </dl>
                            <p className="text-[12px] text-(--bc-ink-3)">The app’s own access rules still apply on top: a skill never shows anyone data the app would not.</p>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </Card>
    );
}
