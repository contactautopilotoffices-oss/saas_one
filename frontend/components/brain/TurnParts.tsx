'use client';

/**
 * One turn of a conversation, in pieces every screen shares: the exchange (the person's message and the brain's reply),
 * the "what it did" trace, and the right / wrong control. The person is never named: only their messages are shown.
 */
import React, { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, ChevronDown, CircleSlash, Compass, CornerDownLeft, GraduationCap, ImageIcon, Wrench, X } from 'lucide-react';
import type { Outcome } from '@/backend/lib/aiLayer/brain/types';
import type { TurnLabel, TurnView } from '@/backend/lib/aiLayer/brain/console/types';
import { useBrain } from './BrainContext';
import {
    CHANNEL_LABEL, FLAG_SENTENCE, OUTCOME_LABEL, TOOL_KIND_LABEL, duration, int, outcomeLabel, pct, plural, stopReasonLabel, timeIN, tokens, usd,
} from './labels';
import { Btn, Chip, FlagChips, NoteChips, OutcomeChip, cx, s, useMotion } from './ui';

const ALL_OUTCOMES = Object.keys(OUTCOME_LABEL) as Outcome[];

// ── The words ─────────────────────────────────────────────────────────────────────────────────────────────────────

function missingWords(turn: TurnView, who: 'user' | 'brain'): string {
    if (turn.notes.includes('hr_hidden')) return 'Hidden: this was an HR matter.';
    if (turn.notes.includes('text_cleared')) return 'The words were cleared after the keep period.';
    if (who === 'user') return turn.notes.includes('photo') ? 'No words, only a photo.' : 'No words were recorded.';
    return 'The brain sent no reply.';
}

/** The person's message (left) and the brain's reply (right), as a readable transcript. */
export function Exchange({ turn, replyLabel = 'The brain' }: { turn: TurnView; replyLabel?: string }) {
    return (
        <div className="flex min-w-0 flex-col gap-[8px]">
            <div className="flex min-w-0 flex-col items-start gap-[4px]">
                <span className="px-1 text-[11.5px] text-(--bc-ink-3)">Person · {timeIN(turn.at)} · {CHANNEL_LABEL[turn.channel]}</span>
                <div className={cx(s.bubbleUser, !turn.userText && s.bubbleMuted)}>
                    {turn.userText ?? missingWords(turn, 'user')}
                    {turn.notes.includes('photo') && (
                        <span className="mt-2 flex items-center gap-1.5 text-[12px] not-italic text-(--bc-ink-3)"><ImageIcon className="h-3.5 w-3.5" />A photo was attached (photos are never shown here)</span>
                    )}
                </div>
            </div>
            <div className="flex min-w-0 flex-col items-end gap-[4px]">
                <span className="px-1 text-[11.5px] text-(--bc-ink-3)">{replyLabel}{turn.shadow ? ' (would have said)' : ''}</span>
                <div className={cx(s.bubbleBrain, !turn.replyText && s.bubbleMuted)}>{turn.replyText ?? missingWords(turn, 'brain')}</div>
            </div>
        </div>
    );
}

/** The facts line under a turn: what it ended as, which skill, flags and notes. */
export function TurnMeta({ turn }: { turn: TurnView }) {
    return (
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            {/* The flag already says it when the brain handed over: one chip, not two saying the same. */}
            {!(turn.outcome === 'handoff' && turn.flags.includes('handed_to_person')) && <OutcomeChip outcome={turn.outcome} />}
            {turn.skillId && <Chip icon={Wrench}><span className={s.mono}>{turn.skillId}</span></Chip>}
            <FlagChips flags={turn.flags} />
            <NoteChips notes={turn.notes.filter(n => n !== 'photo' && n !== 'hr_hidden' && n !== 'text_cleared')} />
        </div>
    );
}

// ── What it did ───────────────────────────────────────────────────────────────────────────────────────────────────

function Fact({ k, children, tone }: { k: string; children: React.ReactNode; tone?: 'ok' | 'bad' }) {
    return (
        <div className="min-w-0">
            <dt className={s.label}>{k}</dt>
            <dd className={cx(s.numSm, 'mt-1 truncate', tone === 'bad' ? 'text-(--bc-bad-text)' : tone === 'ok' ? 'text-(--bc-ok-text)' : 'text-(--bc-ink-1)')}>{children}</dd>
        </div>
    );
}

function Step({ n, ok, children }: { n: React.ReactNode; ok: boolean; children: React.ReactNode }) {
    return (
        <li className="group/step relative flex min-w-0 gap-[12px] pb-4 last:pb-0">
            <span aria-hidden="true" className="absolute top-6 bottom-0 left-[11px] w-px bg-(--bc-line) group-last/step:hidden" />
            <span className={cx('relative grid h-[23px] w-[23px] shrink-0 place-items-center rounded-md text-[11px] font-bold', ok ? 'bg-(--bc-l1) text-(--bc-ink-2) shadow-[inset_0_0_0_1px_var(--bc-edge)]' : 'bg-(--bc-l1) text-(--bc-bad-text) shadow-[inset_0_0_0_1px_var(--bc-bad)]')}>
                {ok ? n : <X className="h-3 w-3" />}
            </span>
            <div className="min-w-0 flex-1">{children}</div>
        </li>
    );
}

export function TurnTrace({ turn, showFlags = true }: { turn: TurnView; showFlags?: boolean }) {
    const detail = turn.toolCalls !== undefined || turn.modelCalls !== undefined || turn.hops !== undefined;
    const cache = turn.tokensIn > 0 ? turn.cacheRead / turn.tokensIn : null;
    const tools = turn.toolCalls ?? [];
    const models = turn.modelCalls ?? [];
    const hops = turn.hops ?? [];
    return (
        <div className={cx(s.well, '@container flex min-w-0 flex-col gap-[20px] p-[16px]')}>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 @md:grid-cols-3 @3xl:grid-cols-6">
                <Fact k="Grounded" tone={turn.grounded === false ? 'bad' : turn.grounded ? 'ok' : undefined}>
                    {turn.grounded === null ? 'Not checked' : turn.grounded ? 'Yes' : 'No'}
                </Fact>
                <Fact k="Time">{duration(turn.latencyMs)}</Fact>
                <Fact k="Tokens in / out">{tokens(turn.tokensIn)} / {tokens(turn.tokensOut)}</Fact>
                <Fact k="From cache">{cache === null ? '—' : pct(cache)}</Fact>
                <Fact k="Cost">{turn.costUsd === null ? 'Not priced' : usd(turn.costUsd, { tiny: true })}</Fact>
                <Fact k="Look-ups">{int(turn.toolCount)}</Fact>
            </dl>

            {/* What the brain had in view from the Tech team: facts, not flags, so they stay quiet. */}
            {(turn.lessons > 0 || turn.guidance !== null) && (
                <p className="-mt-[8px] flex flex-wrap gap-x-[16px] gap-y-[4px] text-[12.5px] text-(--bc-ink-3)">
                    {turn.lessons > 0 && <span className="flex items-center gap-[6px]"><GraduationCap className="h-3.5 w-3.5" />{plural(turn.lessons, 'lesson')} in view</span>}
                    {turn.guidance !== null && <span className="flex items-center gap-[6px]"><Compass className="h-3.5 w-3.5" />Guidance v{turn.guidance}</span>}
                </p>
            )}

            {showFlags && turn.flags.length > 0 && (
                <div className="flex flex-col gap-1.5">
                    <h4 className={s.label}>Why it was flagged</h4>
                    <ul className="flex flex-col gap-[4px] text-[13px] text-(--bc-ink-2)">
                        {turn.flags.map(f => <li key={f} className="flex gap-[8px]"><span aria-hidden="true" className="text-(--bc-warn-text)">▲</span>{FLAG_SENTENCE[f]}</li>)}
                    </ul>
                </div>
            )}

            {detail ? (
                <div className="grid min-w-0 gap-[20px] @3xl:grid-cols-2">
                    <section className="min-w-0">
                        <h4 className={cx(s.label, 'mb-3')}>Models, in order</h4>
                        {hops.length === 0 && models.length === 0 ? <p className="text-[13px] text-(--bc-ink-3)">No model was called (code answered on its own).</p> : (
                            <ol className="min-w-0">
                                {hops.map((h, i) => (
                                    <Step key={`h${i}`} n="" ok={false}>
                                        <p className="text-[13px]"><span className={cx(s.mono, 'text-(--bc-ink-1)')}>{h.model}</span> <span className="text-(--bc-bad-text)">failed</span>, so the next model was tried.</p>
                                        <p className={cx(s.mono, 'mt-1 text-(--bc-ink-3)')}>{h.error}</p>
                                    </Step>
                                ))}
                                {models.map(mc => (
                                    <Step key={`m${mc.seq}`} n={mc.seq} ok>
                                        <p className="flex flex-wrap items-baseline gap-x-2 text-[13px]">
                                            <span className={cx(s.mono, 'text-(--bc-ink-1)')}>{mc.model}</span>
                                            {mc.keySlot && <span className="text-(--bc-ink-3)">Key {mc.keySlot}</span>}
                                            <span className="text-(--bc-ink-3)">· {stopReasonLabel(mc.stopReason)}</span>
                                        </p>
                                        <p className={cx(s.tab, 'mt-1 text-[12px] text-(--bc-ink-3)')}>
                                            {tokens(mc.tokensIn)} in · {tokens(mc.tokensOut)} out · {tokens(mc.cacheRead)} from cache · {mc.costUsd === null ? 'not priced' : usd(mc.costUsd, { tiny: true })} · {duration(mc.ms)}
                                        </p>
                                    </Step>
                                ))}
                            </ol>
                        )}
                    </section>
                    <section className="min-w-0">
                        <h4 className={cx(s.label, 'mb-3')}>Skills called, in order</h4>
                        {tools.length === 0 ? <p className="text-[13px] text-(--bc-ink-3)">No skill was called.</p> : (
                            <ol className="min-w-0">
                                {tools.map(t => (
                                    <Step key={t.seq} n={t.seq} ok={t.ok}>
                                        <p className="flex flex-wrap items-baseline gap-x-2 text-[13px]">
                                            <span className={cx(s.mono, 'text-(--bc-ink-1)')}>{t.skillId}</span>
                                            <span className="text-(--bc-ink-3)">{TOOL_KIND_LABEL[t.kind]}</span>
                                            <span className={cx(s.tab, 'text-(--bc-ink-3)')}>· {duration(t.ms)}</span>
                                            {!t.ok && <span className="text-(--bc-bad-text)">· failed</span>}
                                        </p>
                                        <pre className={cx(s.mono, 'mt-1.5 rounded-md bg-(--bc-l1) px-2.5 py-1.5 whitespace-pre-wrap text-(--bc-ink-2)')}>{t.args}</pre>
                                        {t.error && <p className={cx(s.mono, 'mt-1 text-(--bc-bad-text)')}>{t.error}</p>}
                                    </Step>
                                ))}
                            </ol>
                        )}
                    </section>
                </div>
            ) : (
                <p className="text-[12.5px] text-(--bc-ink-3)">
                    Model {turn.model ? <span className={s.mono}>{turn.model}</span> : 'none'}{turn.keySlot ? `, key ${turn.keySlot}` : ''}. Open the conversation to see each step.
                </p>
            )}

            {(turn.reason || turn.handoffTo || turn.lang) && (
                <p className="text-[12.5px] text-(--bc-ink-3)">
                    {turn.reason && <>Reason recorded: <span className={s.mono}>{turn.reason}</span>. </>}
                    {turn.handoffTo && <>Passed to: {turn.handoffTo}. </>}
                    {turn.lang && <>Language: {turn.lang}.</>}
                </p>
            )}
        </div>
    );
}

/** "What it did": a disclosure that opens the trace in place. */
export function TraceToggle({ turn, defaultOpen = false, showFlags = true }: { turn: TurnView; defaultOpen?: boolean; showFlags?: boolean }) {
    const [open, setOpen] = useState(defaultOpen);
    const m = useMotion();
    const id = `trace-${turn.id}`;
    return (
        <div className="min-w-0">
            <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen(o => !o)}
                className="inline-flex items-center gap-1.5 rounded-md py-1 text-[12.5px] font-semibold text-(--bc-ink-2) hover:text-(--bc-ink-1)">
                <ChevronDown className={cx('h-3.5 w-3.5 transition-transform duration-300', open && 'rotate-180')} />What it did
            </button>
            <AnimatePresence initial={false}>
                {open && (
                    <motion.div id={id} key="t" initial={m.reduce ? { opacity: 0 } : { height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={m.reduce ? { opacity: 0 } : { height: 0, opacity: 0 }} transition={m.t(0.3)} className="overflow-hidden">
                        <div className="pt-2"><TurnTrace turn={turn} showFlags={showFlags} /></div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}

// ── Right or wrong ────────────────────────────────────────────────────────────────────────────────────────────────

export interface WrongAnswer { expectedOutcome: Outcome; expectedSkill: string | null; note: string | null }

/**
 * "What should have happened": the ending, the skill, an optional note. With `keys`, 1–9 pick the ending, Enter saves
 * (Ctrl+Enter inside the note) and Escape cancels.
 */
export function WrongForm({ turn, busy, onSubmit, onCancel, keys }: { turn: TurnView; busy: boolean; onSubmit: (a: WrongAnswer) => void; onCancel: () => void; keys?: boolean }) {
    const { reviewOptions, settings } = useBrain();
    const outcomes = reviewOptions?.outcomes?.length ? reviewOptions.outcomes : ALL_OUTCOMES;
    const skills = reviewOptions?.skills ?? settings.skills?.map(sk => ({ id: sk.id, kind: sk.kind })) ?? [];
    const [outcome, setOutcome] = useState<Outcome | null>(null);
    const [skill, setSkill] = useState<string>(turn.skillId ?? '');
    const [note, setNote] = useState('');
    const name = `wrong-${turn.id}`;
    const submit = () => { if (outcome && !busy) onSubmit({ expectedOutcome: outcome, expectedSkill: skill || null, note: note.trim() || null }); };

    const onKeyDown = (e: React.KeyboardEvent) => {
        const tag = (e.target as HTMLElement).tagName;
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onCancel(); return; }
        if (tag === 'TEXTAREA') { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submit(); } return; }
        if (tag === 'SELECT') return;
        if (keys && /^[1-9]$/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) {
            const o = outcomes[Number(e.key) - 1];
            if (o) { e.preventDefault(); setOutcome(o); }
        } else if (e.key === 'Enter' && tag !== 'BUTTON') { e.preventDefault(); submit(); }
    };

    return (
        <div className={cx(s.well, 'flex min-w-0 flex-col gap-[16px] p-[16px]')} onKeyDown={onKeyDown}>
            <fieldset className="min-w-0">
                <legend className="mb-2 text-[13.5px] font-semibold text-(--bc-ink-1)">What should have happened?</legend>
                <div className="flex flex-wrap gap-1.5">
                    {outcomes.map((o, i) => (
                        <label key={o} className={cx(s.chip, 'cursor-pointer gap-[8px] py-1! text-[12.5px]! has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-(--bc-accent)', outcome === o ? s['tone-accent'] : 'hover:text-(--bc-ink-1)!')}>
                            <input type="radio" name={name} value={o} checked={outcome === o} onChange={() => setOutcome(o)} className="sr-only" autoFocus={keys && i === 0} />
                            {keys && i < 9 && <span className={s.kbd} aria-hidden="true">{i + 1}</span>}
                            {OUTCOME_LABEL[o] ?? o}
                        </label>
                    ))}
                </div>
            </fieldset>
            <div className="grid min-w-0 gap-[12px] @xl:grid-cols-2">
                <label className="flex min-w-0 flex-col gap-1.5">
                    <span className="text-[13px] font-semibold text-(--bc-ink-1)">Which skill should it have used?</span>
                    <select className={s.input} value={skill} onChange={e => setSkill(e.target.value)}>
                        <option value="">None: no skill was needed</option>
                        {skills.map(sk => <option key={sk.id} value={sk.id}>{sk.id}{sk.kind === 'write' ? ' (action)' : ''}</option>)}
                    </select>
                </label>
                <label className="flex min-w-0 flex-col gap-1.5">
                    <span className="text-[13px] font-semibold text-(--bc-ink-1)">Note <span className="font-normal text-(--bc-ink-3)">(optional)</span></span>
                    <textarea className={s.input} rows={2} maxLength={500} value={note} onChange={e => setNote(e.target.value)} placeholder="What a person would have done" />
                </label>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-[12px]">
                <span className="text-[12px] text-(--bc-ink-3)">It becomes a test case, so the brain is checked against it from now on.</span>
                <div className="flex gap-[8px]">
                    <Btn size="sm" variant="quiet" onClick={onCancel}>Cancel{keys && <span className={s.kbd} aria-hidden="true">Esc</span>}</Btn>
                    <Btn size="sm" variant="primary" disabled={!outcome || busy} onClick={submit}>Save as wrong{keys && <CornerDownLeft className="h-3.5 w-3.5" aria-hidden="true" />}</Btn>
                </div>
            </div>
        </div>
    );
}

/** The label a turn already has, in words. */
export function LabelBadge({ label }: { label: TurnLabel }) {
    return label.verdict === 'right'
        ? <Chip tone="ok" icon={Check}>Marked right</Chip>
        : <Chip tone="bad" icon={X} title={label.note ?? undefined}>Marked wrong · should have: {outcomeLabel(label.expectedOutcome)}{label.expectedSkill ? ` (${label.expectedSkill})` : ''}</Chip>;
}

/** Right / Wrong for one turn. Used on Conversations and Shadow; Review drives the same calls from the keyboard. */
export function LabelControl({ turn, onLabelled }: { turn: TurnView; onLabelled: (l: TurnLabel) => void }) {
    const { status, label, needReviewOptions, toast } = useBrain();
    const [wrong, setWrong] = useState(false);
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState<string | null>(null);
    const off = !!status?.reviewMissing;

    const send = async (verdict: 'right' | 'wrong', a: WrongAnswer) => {
        setBusy(true); setErr(null);
        const r = await label({ action: 'label', turnId: turn.id, verdict, ...a });
        setBusy(false);
        if (!r.ok) { setErr(r.message); return; }
        onLabelled({ verdict, ...a });
        setWrong(false);
        toast(verdict === 'right' ? 'Marked right.' : 'Marked wrong. It is now a test case.');
    };

    return (
        <div className="flex min-w-0 flex-col gap-[8px]">
            <div className="flex flex-wrap items-center gap-[8px]">
                {turn.label ? <LabelBadge label={turn.label} /> : <span className="text-[12.5px] text-(--bc-ink-3)">Was this right?</span>}
                <Btn size="sm" variant="ok" icon={Check} disabled={off || busy} aria-pressed={turn.label?.verdict === 'right'}
                    onClick={() => send('right', { expectedOutcome: turn.outcome, expectedSkill: turn.skillId, note: null })}>Right</Btn>
                <Btn size="sm" variant="bad" icon={X} disabled={off || busy} aria-expanded={wrong}
                    onClick={() => { needReviewOptions(); setWrong(w => !w); }}>Wrong</Btn>
            </div>
            {off && <p className="flex items-center gap-1.5 text-[12px] text-(--bc-ink-3)"><CircleSlash className="h-3.5 w-3.5" />Marking is not available yet: the review tables (migration 20261114000003) are not applied.</p>}
            {err && <p role="alert" className="text-[12.5px] text-(--bc-bad-text)">{err}</p>}
            {wrong && !off && <WrongForm turn={turn} busy={busy} onSubmit={a => send('wrong', a)} onCancel={() => setWrong(false)} />}
        </div>
    );
}
