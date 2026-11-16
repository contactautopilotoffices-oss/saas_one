'use client';

/**
 * Review: the learning loop. Turns that look wrong come one at a time (or as a list); a person says whether the brain
 * got it right, and if not, what should have happened. A wrong answer becomes a test case the brain is checked against.
 * Built to be worked through from the keyboard.
 */
import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, CircleSlash, Eye, GraduationCap, Keyboard, List, ListChecks, Rows3, ShieldCheck, SlidersHorizontal, TriangleAlert, X } from 'lucide-react';
import type { EvalCaseView, OtherBotItem, ReviewView, TurnView } from '@/backend/lib/aiLayer/brain/console/types';
import { useBrain, useView } from './BrainContext';
import { CHANNEL_LABEL, FLAG_SENTENCE, OTHER_BOT_LABEL, OTHER_BOT_WHERE, OTHER_STATE, ROLE_LABEL, dateIN, dateTimeIN, int, outcomeLabel } from './labels';
import { Exchange, LabelControl, TraceToggle, TurnMeta, WrongForm, type WrongAnswer } from './TurnParts';
import { Btn, Card, CardHead, Chip, Empty, ErrorState, LoadingScreen, PersonTag, Screen, Segmented, Toggle, cx, s, useMotion } from './ui';
import { AnimatePresence, motion } from 'framer-motion';
// Shared with the AI assistant's own learning screen: the same "what should it have done" picker, not a copy.
import AnswerPicker, { type Answer } from '@/frontend/components/ai-layer/AnswerPicker';
// The task assistant's own review (moved here from the Control Centre); it calls its own guarded API.
import BotLearningPanel from '@/frontend/components/task-manager/BotLearningPanel';
// Review → Tickets: how new tickets were sorted (owner 2026-11-15). Loaded only when its tab is chosen.
import TicketReview from './TicketReview';

export default function ReviewScreen() {
    const { acceptReview, status } = useBrain();
    const [mode, setMode] = useState<'focus' | 'list'>('focus');
    const [source, setSource] = useState<Source>('brain');
    // The Tickets count is known once that tab has loaded (it is not fetched before).
    const [ticketsWaiting, setTicketsWaiting] = useState<number | null>(null);
    const v = useView(api => api.review().then(r => { if (r.ok) acceptReview(r.data); return r; }), 'review');
    const off = !!status?.reviewMissing;
    const replace = (d: ReviewView) => { acceptReview(d); v.mutate(() => d); };

    return (
        <Screen title="Review" sub="Messages the brain may have got wrong, one at a time. Say whether it was right; if not, what should have happened. Each wrong answer becomes a test case."
            actions={source === 'brain' ? <Segmented label="Layout" value={mode} onChange={setMode} options={[{ value: 'focus', label: 'One at a time', icon: Rows3 }, { value: 'list', label: 'List', icon: List }]} /> : undefined}>
            {off && source !== 'tickets' && (
                <div className={cx(s.banner, s.bannerWarn)} role="note">
                    <CircleSlash className="mt-0.5 h-4 w-4 shrink-0 text-(--bc-warn-text)" />
                    <p className="text-[13px] text-(--bc-ink-2)">Marking is not available yet: the review tables (migration 20261114000003) are not applied. The queue can be read but not marked.</p>
                </div>
            )}
            {!v.res && <LoadingScreen label="Loading the review queue" />}
            {v.error && <ErrorState what="the review queue" message={v.error} onRetry={v.reload} />}
            {v.data && (
                <>
                    {/* Whose flagged messages: the brain's, the task assistant's (its own review panel) or the AI assistant's.
                        The wrapper scrolls sideways on a narrow screen instead of pushing the page wider. */}
                    <div className="max-w-full overflow-x-auto">
                        <Segmented label="Whose messages" value={source} onChange={setSource} options={[
                            { value: 'brain', label: <>The brain<span className={cx(s.tab, 'text-(--bc-ink-3)')}>{int(v.data.queue.length)}</span></> },
                            { value: 'task_assistant', label: OTHER_BOT_LABEL.task_assistant },
                            { value: 'ai_assistant', label: <>{OTHER_BOT_LABEL.ai_assistant}<span className={cx(s.tab, 'text-(--bc-ink-3)')}>{int(v.data.others.filter(o => o.state === 'waiting').length)}</span></> },
                            { value: 'tickets', label: <>Tickets{ticketsWaiting !== null && <span className={cx(s.tab, 'text-(--bc-ink-3)')}>{int(ticketsWaiting)}</span>}</> },
                        ]} />
                    </div>
                    {source === 'tickets' ? <TicketReview onCount={setTicketsWaiting} />
                        : source === 'task_assistant' ? <TaskAssistant />
                        : source === 'ai_assistant' ? <AiAssistant d={v.data} onReplace={replace} />
                            : <>
                    <Progress d={v.data} />
                    {v.data.queue.length === 0 ? (
                        <Card>
                            <Empty icon={ShieldCheck} title="Nothing to review">
                                Messages that look wrong and that nobody has judged yet appear here: when the brain gave up, said something no look-up supported, asked two questions in a row, or the person corrected it.
                            </Empty>
                        </Card>
                    ) : mode === 'focus'
                        ? <Focus queue={v.data.queue} off={off} onReplace={replace} />
                        : <ul className="flex min-w-0 flex-col gap-[16px]">{v.data.queue.map(t => <ListItem key={t.id} turn={t} onDone={v.reload} />)}</ul>}
                    <Cases d={v.data} off={off} onReplace={replace} />
                    </>}
                </>
            )}
        </Screen>
    );
}

type Source = 'brain' | OtherBotItem['bot'] | 'tickets';

/** The task assistant's own review panel, open from the start (it used to be a card in the Control Centre). */
function TaskAssistant() {
    const { orgId } = useBrain();
    return (
        <div className="flex min-w-0 flex-col gap-[16px]">
            <div className={cx(s.banner, s.bannerInfo)} role="note">
                <Eye className="mt-0.5 h-4 w-4 shrink-0 text-(--bc-accent)" />
                <p className="text-[13px] text-(--bc-ink-2)">{OTHER_BOT_WHERE.task_assistant} It moved here from the Control Centre.</p>
            </div>
            <BotLearningPanel orgId={orgId} startOpen />
        </div>
    );
}

/** The older AI assistant's flagged messages: a waiting one is taught the right answer, or ignored. */
function AiAssistant({ d, onReplace }: { d: ReviewView; onReplace: (d: ReviewView) => void }) {
    const items = d.others.filter(o => o.bot === 'ai_assistant');
    return (
        <div className="flex min-w-0 flex-col gap-[16px]">
            <div className={cx(s.banner, s.bannerInfo)} role="note">
                <Eye className="mt-0.5 h-4 w-4 shrink-0 text-(--bc-accent)" />
                <p className="text-[13px] text-(--bc-ink-2)">{OTHER_BOT_WHERE.ai_assistant} Teaching makes the message an example for this organisation’s AI assistant, in use within about a minute.</p>
            </div>
            {items.length === 0 ? (
                <Card><Empty icon={ShieldCheck} title="Nothing flagged from the AI assistant">Messages it probably got wrong appear here, newest first, to be taught or ignored.</Empty></Card>
            ) : (
                <ul className="flex min-w-0 flex-col gap-[16px]">{items.map(o => <AiItem key={o.id} o={o} entries={d.aiAnswers} onReplace={onReplace} />)}</ul>
            )}
        </div>
    );
}

function AiItem({ o, entries, onReplace }: { o: OtherBotItem; entries: ReviewView['aiAnswers']; onReplace: (d: ReviewView) => void }) {
    const { api, report, toast } = useBrain();
    const [answer, setAnswer] = useState<Answer>({ entryId: '', fields: {} });
    const [busy, setBusy] = useState<null | 'teach' | 'ignore'>(null);
    const [err, setErr] = useState<string | null>(null);
    const st = OTHER_STATE[o.state];
    const who = OTHER_BOT_LABEL[o.bot];

    const judge = async (verdict: 'teach' | 'ignore') => {
        setBusy(verdict); setErr(null);
        const r = await api.postReview({ action: 'ai_judge', id: o.id, verdict, entryId: verdict === 'teach' ? answer.entryId : '', fields: verdict === 'teach' ? answer.fields : {} });
        setBusy(null);
        report(r);
        if (!r.ok) { setErr(r.message); return; }
        onReplace(r.data);
        toast(verdict === 'teach' ? 'Taught. The AI assistant uses it within about a minute.' : 'Ignored.');
    };

    return (
        <Card as="li" className="@container flex min-w-0 flex-col gap-[12px] p-[16px] @3xl:p-6">
            <div className="flex min-w-0 flex-wrap items-center gap-[8px]">
                <Chip tone={st.tone}>{st.label}</Chip>
                <span className={cx(s.tab, 'text-[12px] text-(--bc-ink-3)')}>{who} · {dateTimeIN(o.at)}</span>
            </div>
            {o.reasons.length > 0 && (
                <ul className="flex flex-col gap-[4px] text-[13px] text-(--bc-ink-2)" aria-label="Why it was flagged">
                    {o.reasons.map(r => <li key={r} className="flex gap-[8px]"><TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-(--bc-warn)" />{r}</li>)}
                </ul>
            )}
            <div className="flex min-w-0 flex-col gap-[8px]">
                <div className="flex min-w-0 flex-col items-start gap-[4px]">
                    <span className="px-1 text-[11.5px] text-(--bc-ink-3)">The person wrote</span>
                    <div className={s.bubbleUser}>{o.text}</div>
                </div>
                <div className="flex min-w-0 flex-col items-end gap-[4px]">
                    <span className="px-1 text-[11.5px] text-(--bc-ink-3)">The {who} replied</span>
                    <div className={cx(s.bubbleOther, !o.reply && s.bubbleMuted)}>{o.reply ?? 'No reply was recorded.'}</div>
                </div>
                {o.followUp && (
                    <div className="flex min-w-0 flex-col items-start gap-[4px]">
                        <span className="px-1 text-[11.5px] text-(--bc-ink-3)">What the person wrote next</span>
                        <div className={s.bubbleUser}>{o.followUp}</div>
                    </div>
                )}
            </div>
            {o.chose && <p className="text-[13px] text-(--bc-ink-2)"><span className="text-(--bc-ink-3)">The AI chose: </span>{o.chose}</p>}
            {o.state === 'waiting' && (
                <div className={cx(s.well, 'flex min-w-0 flex-col gap-[10px] p-[12px]')}>
                    <span className="text-[13.5px] font-semibold text-(--bc-ink-1)">What should it have done?</span>
                    <div className="flex min-w-0 flex-wrap items-center gap-[8px]">
                        <div role="group" aria-label="The right answer" className="min-w-0"><AnswerPicker entries={entries} value={answer} onChange={setAnswer} /></div>
                        <Btn size="sm" variant="primary" icon={GraduationCap} disabled={!answer.entryId || !!busy} onClick={() => judge('teach')}>{busy === 'teach' ? 'Teaching…' : 'Teach'}</Btn>
                        <Btn size="sm" variant="quiet" disabled={!!busy} onClick={() => judge('ignore')}>{busy === 'ignore' ? 'Ignoring…' : 'Ignore'}</Btn>
                    </div>
                    {err && <p role="alert" className="text-[12.5px] text-(--bc-bad-text)">{err}</p>}
                </div>
            )}
        </Card>
    );
}

function Progress({ d }: { d: ReviewView }) {
    const total = d.judged.right + d.judged.wrong;
    return (
        <div className={cx(s.tab, 'flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px] text-(--bc-ink-2)')}>
            <span><b className={cx(s.numMd, 'text-(--bc-ink-1)')}>{int(d.queue.length)}</b> waiting</span>
            <span className="flex items-center gap-1.5"><Check className="h-3.5 w-3.5 text-(--bc-ok-text)" />{int(d.judged.right)} judged right</span>
            <span className="flex items-center gap-1.5"><X className="h-3.5 w-3.5 text-(--bc-bad-text)" />{int(d.judged.wrong)} judged wrong</span>
            {total > 0 && <span className="text-(--bc-ink-3)">{int(total)} judged so far</span>}
        </div>
    );
}

/** One turn at a time. R right · W wrong · 1–9 the right ending · Enter save · J / K next and previous · S skip. */
function Focus({ queue, off, onReplace }: { queue: TurnView[]; off: boolean; onReplace: (d: ReviewView) => void }) {
    const { label, toast } = useBrain();
    const m = useMotion();
    const [i, setI] = useState(0);
    const [wrong, setWrong] = useState(false);
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState<string | null>(null);
    const idx = Math.min(i, queue.length - 1);
    const turn = queue[idx];
    const top = useRef<HTMLElement>(null);
    const moved = useRef(false);

    // After moving on, bring the next message into view and put focus on it, so the keyboard flow never loses its place.
    useEffect(() => {
        if (!moved.current) return;
        moved.current = false;
        top.current?.scrollIntoView({ block: 'start', behavior: m.reduce ? 'auto' : 'smooth' });
        top.current?.focus({ preventScroll: true });
    }, [turn?.id, m.reduce]);

    const move = (d: number) => { moved.current = true; setWrong(false); setErr(null); setI(Math.max(0, Math.min(queue.length - 1, idx + d))); };
    const send = async (verdict: 'right' | 'wrong', a: WrongAnswer) => {
        if (busy || off) return;
        setBusy(true); setErr(null);
        const r = await label({ action: 'label', turnId: turn.id, verdict, ...a });
        setBusy(false);
        if (!r.ok) { setErr(r.message); return; }
        setWrong(false);
        moved.current = true;
        // The judged turn leaves the queue, so the next one slides into this place.
        if (r.data.queue.some(t => t.id === turn.id)) setI(idx + 1);
        onReplace(r.data);
        toast(verdict === 'right' ? 'Marked right.' : 'Marked wrong. It is now a test case.');
    };
    const right = () => send('right', { expectedOutcome: turn.outcome, expectedSkill: turn.skillId, note: null });

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
            const el = e.target as HTMLElement | null;
            if (el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName))) return;
            if (document.querySelector('[role="dialog"]')) return;
            if (wrong) return; // the form handles its own keys
            const k = e.key.toLowerCase();
            if (k === 'r' && !off) { e.preventDefault(); void send('right', { expectedOutcome: turn.outcome, expectedSkill: turn.skillId, note: null }); }
            else if (k === 'w' && !off) { e.preventDefault(); setWrong(true); }
            else if (k === 'j' || k === 's' || e.key === 'ArrowRight') { e.preventDefault(); move(1); }
            else if (k === 'k' || e.key === 'ArrowLeft') { e.preventDefault(); move(-1); }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    });

    if (!turn) return null;
    return (
        <section ref={top} tabIndex={-1} aria-label={`Review queue, message ${idx + 1} of ${queue.length}`} className="flex min-w-0 scroll-mt-[124px] flex-col gap-[12px] outline-none">
            <AnimatePresence mode="wait" initial={false}>
                <motion.div key={turn.id} initial={m.reduce ? { opacity: 0 } : { opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={m.reduce ? { opacity: 0 } : { opacity: 0, x: -12 }} transition={m.t(0.3)}>
                    <Card as="article" className="@container flex min-w-0 flex-col" aria-label={`Message ${idx + 1} of ${queue.length}`}>
                        <header className="flex flex-wrap items-center gap-[8px] border-b border-(--bc-line) p-[16px] @3xl:px-6">
                            <span className={cx(s.label, s.tab)}>{idx + 1} of {queue.length}</span>
                            <PersonTag tag={turn.person} />
                            <span className={cx(s.tab, 'text-[12px] text-(--bc-ink-3)')}>{dateTimeIN(turn.at)} · {CHANNEL_LABEL[turn.channel]}{turn.role ? ` · ${ROLE_LABEL[turn.role]}` : ''}{turn.shadow ? ' · shadow' : ''}</span>
                            <span className="ml-auto flex gap-[4px]">
                                <Btn size="sm" variant="quiet" icon={ArrowLeft} aria-label="Previous (K)" title="Previous (K)" disabled={idx === 0} onClick={() => move(-1)} />
                                <Btn size="sm" variant="quiet" icon={ArrowRight} aria-label="Next (J)" title="Next (J)" disabled={idx >= queue.length - 1} onClick={() => move(1)} />
                            </span>
                        </header>
                        <div className="flex min-w-0 flex-col gap-[20px] p-[16px] @3xl:p-6">
                            {turn.flags.length > 0 && (
                                <section aria-label="Why it was flagged" className={cx(s.banner, s.bannerWarn, 'flex-col gap-1.5')}>
                                    <span className={cx(s.label, 'flex items-center gap-1.5 text-(--bc-warn-text)!')}><TriangleAlert className="h-3.5 w-3.5" />Why it is here</span>
                                    <ul className="flex flex-col gap-[4px] text-[13.5px] text-(--bc-ink-1)">{turn.flags.map(f => <li key={f}>{FLAG_SENTENCE[f]}</li>)}</ul>
                                </section>
                            )}
                            <Exchange turn={turn} />
                            <TurnMeta turn={turn} />
                            <TraceToggle key={turn.id} turn={turn} defaultOpen showFlags={false} />
                        </div>
                        <footer className="flex min-w-0 flex-col gap-[12px] border-t border-(--bc-line) p-[16px] @3xl:px-6">
                            <div className="flex flex-wrap items-center gap-[8px]">
                                <span className="mr-1 text-[13.5px] font-semibold text-(--bc-ink-1)">Was this right?</span>
                                <Btn variant="ok" icon={Check} disabled={off || busy} onClick={right}>Right<span className={s.kbd} aria-hidden="true">R</span></Btn>
                                <Btn variant="bad" icon={X} disabled={off || busy} aria-expanded={wrong} onClick={() => setWrong(w => !w)}>Wrong<span className={s.kbd} aria-hidden="true">W</span></Btn>
                                <Btn variant="quiet" disabled={idx >= queue.length - 1} onClick={() => move(1)}>Skip<span className={s.kbd} aria-hidden="true">S</span></Btn>
                            </div>
                            {err && <p role="alert" className="text-[12.5px] text-(--bc-bad-text)">{err}</p>}
                            {wrong && !off && <WrongForm key={turn.id} keys turn={turn} busy={busy} onSubmit={a => send('wrong', a)} onCancel={() => setWrong(false)} />}
                        </footer>
                    </Card>
                </motion.div>
            </AnimatePresence>
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12px] text-(--bc-ink-3)">
                <Keyboard className="h-3.5 w-3.5" />
                <span><span className={s.kbd}>R</span> right</span>
                <span><span className={s.kbd}>W</span> wrong</span>
                <span><span className={s.kbd}>1</span>–<span className={s.kbd}>9</span> what should have happened</span>
                <span><span className={s.kbd}>Enter</span> save</span>
                <span><span className={s.kbd}>J</span> / <span className={s.kbd}>K</span> next, previous</span>
                <span><span className={s.kbd}>Esc</span> cancel</span>
            </p>
        </section>
    );
}

function ListItem({ turn, onDone }: { turn: TurnView; onDone: () => void }) {
    return (
        <Card as="li" className="@container flex min-w-0 flex-col gap-[16px] p-[16px] @3xl:p-6">
            <div className="flex flex-wrap items-center gap-[8px]">
                <PersonTag tag={turn.person} />
                <span className={cx(s.tab, 'text-[12px] text-(--bc-ink-3)')}>{dateTimeIN(turn.at)} · {CHANNEL_LABEL[turn.channel]}</span>
            </div>
            {turn.flags.length > 0 && <ul className="flex flex-col gap-[4px] text-[13px] text-(--bc-ink-2)">{turn.flags.map(f => <li key={f} className="flex gap-[8px]"><TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-(--bc-warn-text)" />{FLAG_SENTENCE[f]}</li>)}</ul>}
            <Exchange turn={turn} />
            <TurnMeta turn={turn} />
            <TraceToggle turn={turn} />
            <LabelControl turn={turn} onLabelled={onDone} />
        </Card>
    );
}

function Cases({ d, off, onReplace }: { d: ReviewView; off: boolean; onReplace: (d: ReviewView) => void }) {
    const { api, report, toast, go } = useBrain();
    const [show, setShow] = useState<'all' | 'active' | 'inactive'>('all');
    const [busy, setBusy] = useState<string | null>(null);
    const active = d.cases.filter(c => c.active).length;
    const shown = d.cases.filter(c => show === 'all' || (show === 'active') === c.active);

    const setActive = async (c: EvalCaseView, on: boolean) => {
        setBusy(c.id);
        const r = await api.postReview({ action: 'set_active', caseId: c.id, active: on });
        setBusy(null);
        report(r);
        if (r.ok) onReplace(r.data);
        else toast(r.message, 'bad');
    };

    return (
        <Card as="section" className="@container flex min-w-0 flex-col gap-[16px] p-[16px] @3xl:p-6" aria-labelledby="cases-h">
            <CardHead id="cases-h" icon={GraduationCap} label="Taught cases: tests and lessons"
                hint="Every message judged here is a test and a lesson. The Scorecard checks the brain against it, and when lessons are on, the brain is shown it when a similar message arrives from the same kind of login."
                right={<Segmented size="sm" label="Show cases" value={show} onChange={setShow} options={[{ value: 'all', label: `All ${d.cases.length}` }, { value: 'active', label: `In use ${active}` }, { value: 'inactive', label: 'Switched off' }]} />} />
            <div className="flex min-w-0 flex-col gap-[8px]">
                <div className="flex min-w-0 flex-wrap items-center gap-[8px]">
                    <Chip tone={d.lessonsOn ? 'ok' : 'neutral'} icon={d.lessonsOn ? Check : undefined}>{d.lessonsOn ? 'Lessons are on' : 'Lessons are off'}</Chip>
                    <span className="min-w-0 text-[12.5px] text-(--bc-ink-3)">A lesson can only steer which of the person’s own skills is used. It cannot add a skill, skip a confirmation or change access.</span>
                    <Btn size="sm" variant="quiet" icon={SlidersHorizontal} onClick={() => go('switches')}>Change in Switches</Btn>
                </div>
                <p className="flex items-start gap-[8px] text-[12.5px] text-(--bc-warn-text)"><TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />Switch off any case whose message names a person: when lessons are on, the brain is shown these messages while answering someone else.</p>
            </div>
            {d.cases.length === 0 ? (
                <Empty icon={ListChecks} title="No test cases yet">Mark a message right or wrong and it is added here.</Empty>
            ) : shown.length === 0 ? <p className="text-[13px] text-(--bc-ink-3)">No case matches.</p> : (
                <ul className={s.rows}>
                    {shown.map(c => (
                        <li key={c.id} className="flex min-w-0 flex-col gap-[8px] py-4 first:pt-1 last:pb-1 @3xl:flex-row @3xl:items-start @3xl:gap-6">
                            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                                <p className="text-[13.5px] break-words text-(--bc-ink-1)">“{c.text}”</p>
                                <p className={cx(s.tab, 'flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-(--bc-ink-3)')}>
                                    <span>{ROLE_LABEL[c.role]} · {CHANNEL_LABEL[c.channel]} · {dateIN(c.at)}</span>
                                    {c.verdict === 'right' ? <Chip tone="ok" icon={Check}>Was right</Chip> : <Chip tone="bad" icon={X}>Was wrong</Chip>}
                                </p>
                                <p className="text-[12.5px] text-(--bc-ink-2)">
                                    Got: {outcomeLabel(c.gotOutcome)}{c.gotSkill ? <> (<span className={s.mono}>{c.gotSkill}</span>)</> : ''}
                                    <span aria-hidden="true" className="mx-1.5 text-(--bc-ink-3)">→</span><span className="sr-only">. </span>
                                    Should be: <b className="font-semibold text-(--bc-ink-1)">{outcomeLabel(c.expectedOutcome)}</b>{c.expectedSkill ? <> (<span className={s.mono}>{c.expectedSkill}</span>)</> : ' (no skill)'}
                                </p>
                                {c.note && <p className="text-[12.5px] text-(--bc-ink-3)">Note: {c.note}</p>}
                            </div>
                            <label className="flex shrink-0 items-center gap-[8px] text-[12.5px] text-(--bc-ink-2)">
                                <Toggle label={`Use “${c.text.slice(0, 40)}” as a test and a lesson`} checked={c.active} disabled={off || busy === c.id} onChange={on => setActive(c, on)} />
                                {c.active ? 'Test and lesson' : 'Switched off: neither'}
                            </label>
                        </li>
                    ))}
                </ul>
            )}
        </Card>
    );
}
