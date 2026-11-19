'use client';

/**
 * Review → Tickets (owner 2026-11-15): how new tickets were sorted. The AI sorts every ticket and rates how sure it is;
 * the ones below High, and the ones the keyword rules sorted while the AI was unavailable, wait here. The Tech team says
 * Right or Wrong; a wrong one with the right category teaches the AI and, while the ticket is open, moves it.
 * The ticket's words arrive masked and nothing here says who raised it.
 * 2026-11-19 (owner: "with corrections, it must improve the classification accuracy and confidence"): the learning.
 * Each ticket shows the similar past tickets used and why its confidence is what it is; a judgement can be undone for
 * 7 days; examples that disagree are listed to settle; "watch only" compares the old and the new way; the weeks show
 * whether the queue shrinks and the confidence gets more honest.
 * Built from the screen's own pieces (ui.tsx, charts.tsx, brain.module.css); no new visual values.
 */
import React, { useEffect, useId, useRef, useState } from 'react';
import { BookCheck, Check, CircleSlash, Eye, Gauge, GitCompare, GraduationCap, History, Scale, ShieldCheck, Sparkles, TriangleAlert, Undo2, X } from 'lucide-react';
import type { RuleVersionView, RulesView } from '@/backend/lib/ticketing/sortRulesStore';
import type { CategoryChoice, TicketReviewItem, TicketReviewView } from '@/backend/lib/ticketing/sortReview';
import type { ConflictView, LearningView, TicketLearningNote, WeekRow } from '@/backend/lib/ticketing/sortLearningView';
import { BarSeries } from './charts';
import { confidenceLabel, confidenceWord } from '@/backend/lib/ticketing/confidenceWord';
import { useBrain, useView } from './BrainContext';
import { dateTimeIN, int, type Tone } from './labels';
import { Btn, Card, CardHead, Chip, Empty, ErrorState, LoadingScreen, Num, cx, s } from './ui';

const TEAM_LABEL: Record<string, string> = { soft_services: 'Soft services', technical: 'Technical', plumbing: 'Plumbing', vendor: 'Vendor' };
const teamLabel = (t: string | null | undefined): string | null => (t ? TEAM_LABEL[t] ?? words(t) : null);
/** "in_progress" → "In progress": a status or priority code in plain words. */
const words = (code: string): string => { const t = code.replace(/_/g, ' ').trim(); return t ? t[0].toUpperCase() + t.slice(1) : ''; };
const WORD_TONE: Record<'High' | 'Medium' | 'Low', Tone> = { High: 'ok', Medium: 'warn', Low: 'bad' };

export default function TicketReview({ onCount }: { onCount: (n: number) => void }) {
    const v = useView(api => api.ticketReview(), 'ticket-review');
    const d = v.data;
    const waiting = d?.waiting;
    useEffect(() => { if (waiting !== undefined) onCount(waiting); }, [waiting, onCount]);
    const replace = (next: TicketReviewView) => v.mutate(() => next);

    return (
        <div className="flex min-w-0 flex-col gap-[16px]">
            <div className={cx(s.banner, s.bannerInfo)} role="note">
                <Eye className="mt-0.5 h-4 w-4 shrink-0 text-(--bc-accent)" />
                <p className="text-[13px] text-(--bc-ink-2)">Tickets the AI was not sure about (below 85%), and tickets the keyword rules sorted because the AI was unavailable, from the last 30 days. Mark each right or wrong. A wrong one teaches the AI, and an open ticket moves to the right team.</p>
            </div>
            {!v.res && <LoadingScreen label="Loading the tickets to check" />}
            {v.error && <ErrorState what="the tickets to check" message={v.error} onRetry={v.reload} />}
            {d && (
                <>
                    {d.tableMissing && (
                        <div className={cx(s.banner, s.bannerWarn)} role="note">
                            <CircleSlash className="mt-0.5 h-4 w-4 shrink-0 text-(--bc-warn-text)" />
                            <p className="text-[13px] text-(--bc-ink-2)">Judging is not available yet: migration 20261115000003 is not applied.</p>
                        </div>
                    )}
                    <Accuracy d={d} />
                    {d.learning && <LearningStatus l={d.learning} />}
                    {d.rules && <RulesCard r={d.rules} names={namesOf(d)} onReplace={replace} />}
                    <div className={cx(s.tab, 'flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px] text-(--bc-ink-2)')}>
                        <span><b className={cx(s.numMd, 'text-(--bc-ink-1)')}>{int(d.waiting)}</b> waiting</span>
                        {d.waiting > d.queue.length && <span className="text-(--bc-ink-3)">showing the newest {int(d.queue.length)}</span>}
                    </div>
                    {d.queue.length === 0 ? (
                        <Card><Empty icon={ShieldCheck} title="Nothing to check">Tickets the AI is not sure about appear here.</Empty></Card>
                    ) : (
                        <ul className="flex min-w-0 flex-col gap-[16px]">
                            {d.queue.map(t => <TicketItem key={t.id} t={t} choices={d.choices[t.choicesKey] ?? []} off={d.tableMissing} onReplace={replace} names={namesOf(d)} />)}
                        </ul>
                    )}
                    {d.learning && d.learning.conflicts.length > 0 && <Conflicts conflicts={d.learning.conflicts} names={namesOf(d)} onReplace={replace} />}
                    {d.recent.length > 0 && <Recent d={d} onReplace={replace} />}
                    {d.learning && d.learning.weeks.length > 0 && <Weeks weeks={d.learning.weeks} />}
                </>
            )}
        </div>
    );
}

function Accuracy({ d }: { d: TicketReviewView }) {
    const a = d.accuracy;
    return (
        <Card as="section" className="@container flex min-w-0 flex-col gap-[12px] p-[16px] @3xl:p-6" aria-labelledby="ticket-acc-h">
            <CardHead id="ticket-acc-h" icon={Gauge} label="How well tickets are sorted" />
            <p className="flex flex-wrap items-baseline gap-x-2">
                {a.percent === null
                    ? <span className={s.h2}>No tickets yet</span>
                    : <><Num size="lg">{a.percent}%</Num><span className="text-[14px] text-(--bc-ink-2)">sorted right</span></>}
            </p>
            <p className={cx(s.tab, 'text-[12.5px] leading-relaxed text-(--bc-ink-2)')}>
                last {int(a.days)} days · {int(a.sorted)} tickets · {int(a.byAi)} by AI · {int(a.byRules)} by keyword rules · {int(a.resorted)} re-sorted by a person · judged here: {int(a.judgedRight)} right, {int(a.judgedWrong)} wrong
            </p>
            <p className="text-[12px] text-(--bc-ink-3)">Tickets nobody checked count as right.</p>
        </Card>
    );
}

function Fact({ k, children }: { k: string; children: React.ReactNode }) {
    return (
        <div className="min-w-0">
            <dt className={s.label}>{k}</dt>
            <dd className="mt-1 text-[13.5px] break-words text-(--bc-ink-1)">{children}</dd>
        </div>
    );
}

function TicketItem({ t, choices, off, onReplace, names }: { t: TicketReviewItem; choices: CategoryChoice[]; off: boolean; onReplace: (d: TicketReviewView) => void; names: (code: string | null) => string }) {
    const { api, report, toast } = useBrain();
    const id = useId();
    const [wrong, setWrong] = useState(false);
    const [code, setCode] = useState('');
    const [busy, setBusy] = useState<null | 'right' | 'wrong'>(null);
    const [err, setErr] = useState<string | null>(null);
    const options = choices.filter(c => c.code !== t.categoryCode);
    const byAi = t.sortedBy === 'ai';
    const word = t.confidence === null ? null : confidenceWord(t.confidence);

    const judge = async (verdict: 'right' | 'wrong') => {
        if (off || busy) return;
        setBusy(verdict); setErr(null);
        const r = await api.postTicketReview({ ticketId: t.id, verdict, code: verdict === 'wrong' ? code : null });
        setBusy(null);
        report(r);
        if (!r.ok) { setErr(r.message); return; }
        onReplace(r.data);
        toast(r.message ?? 'Saved.');
    };
    const cancel = () => { setWrong(false); setCode(''); setErr(null); };

    return (
        <Card as="li" className="@container flex min-w-0 flex-col gap-[12px] p-[16px] @3xl:p-6">
            <div className="flex min-w-0 flex-wrap items-center gap-[8px]">
                <span className={cx(s.tab, 'text-[13.5px] font-semibold text-(--bc-ink-1)')}>{t.number ?? 'Ticket'}</span>
                {t.status && <Chip>{words(t.status)}</Chip>}
                <span className={cx(s.tab, 'min-w-0 text-[12px] text-(--bc-ink-3)')}>{dateTimeIN(t.at)}{t.property ? ` · ${t.property}` : ''}</span>
            </div>
            <div className="flex min-w-0 flex-col items-start gap-[4px]">
                <span className="px-1 text-[11.5px] text-(--bc-ink-3)">The ticket says</span>
                <div className={cx(s.bubbleUser, !t.text && s.bubbleMuted)}>{t.text || 'No words were recorded.'}</div>
            </div>
            <div className="flex min-w-0 flex-wrap items-center gap-[8px]">
                {byAi
                    ? <Chip tone={word ? WORD_TONE[word] : 'neutral'}>Sorted by AI{t.confidence !== null ? ` · ${confidenceLabel(t.confidence)}` : ''}</Chip>
                    : <Chip>Sorted by keyword rules (the AI was unavailable)</Chip>}
            </div>
            <dl className="grid min-w-0 grid-cols-2 gap-x-6 gap-y-3 @xl:grid-cols-4">
                <Fact k="Category">{t.categoryName ?? t.categoryCode ?? 'No category'}</Fact>
                <Fact k="Team">{teamLabel(t.team) ?? 'No team'}</Fact>
                <Fact k="Priority">{t.priority ? words(t.priority) : 'Not set'}</Fact>
                {t.risk && <Fact k="Risk"><span className="inline-flex items-start gap-1.5 text-(--bc-warn-text)"><TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />{t.risk}</span></Fact>}
            </dl>
            {t.reason && <p className="text-[13px] break-words text-(--bc-ink-2)"><span className="text-(--bc-ink-3)">Why: </span>{t.reason}</p>}
            {t.learning && <TicketLearning n={t.learning} names={names} />}
            <div className="flex min-w-0 flex-wrap items-center gap-[8px]">
                <span className="mr-1 text-[13.5px] font-semibold text-(--bc-ink-1)">Was it sorted right?</span>
                <Btn size="sm" variant="ok" icon={Check} disabled={off || !!busy} onClick={() => judge('right')}>{busy === 'right' ? 'Saving…' : 'Right'}</Btn>
                <Btn size="sm" variant="bad" icon={X} disabled={off || !!busy} aria-expanded={wrong} onClick={() => (wrong ? cancel() : setWrong(true))}>Wrong</Btn>
            </div>
            {wrong && !off && (
                <div className={cx(s.well, 'flex min-w-0 flex-col gap-[10px] p-[12px]')}>
                    <label htmlFor={`${id}code`} className="text-[13.5px] font-semibold text-(--bc-ink-1)">What is the right category?</label>
                    <select id={`${id}code`} className={s.input} value={code} disabled={!!busy || options.length === 0} onChange={e => setCode(e.target.value)}>
                        <option value="">{options.length === 0 ? 'No other category is available' : 'Choose a category'}</option>
                        {options.map(c => <option key={c.code} value={c.code}>{c.name}{c.team ? ` (${teamLabel(c.team)})` : ''}</option>)}
                    </select>
                    <div className="flex flex-wrap justify-end gap-[8px]">
                        <Btn size="sm" variant="quiet" disabled={!!busy} onClick={cancel}>Cancel</Btn>
                        <Btn size="sm" variant="primary" disabled={!code || !!busy} onClick={() => judge('wrong')}>{busy === 'wrong' ? 'Saving…' : 'Save'}</Btn>
                    </div>
                    {!t.canMove && <p className="text-[12.5px] text-(--bc-ink-3)">This ticket is no longer open, so it will not be moved. The AI still learns from it.</p>}
                </div>
            )}
            {err && <p role="alert" className="text-[12.5px] text-(--bc-bad-text)">{err}</p>}
        </Card>
    );
}

function Recent({ d, onReplace }: { d: TicketReviewView; onReplace: (d: TicketReviewView) => void }) {
    const { api, report, toast } = useBrain();
    const name = namesOf(d);
    const [busy, setBusy] = useState<string | null>(null);
    const undo = async (ticketId: string) => {
        if (busy) return;
        setBusy(ticketId);
        const r = await api.postTicketReview({ action: 'undo', ticketId });
        setBusy(null);
        report(r);
        if (!r.ok) { toast(r.message, 'bad'); return; }
        onReplace(r.data);
        toast(r.message ?? 'Undone.');
    };
    return (
        <Card as="section" className="@container flex min-w-0 flex-col gap-[12px] p-[16px] @3xl:p-6" aria-labelledby="ticket-recent-h">
            <CardHead id="ticket-recent-h" icon={History} label="Recently judged" />
            <ul className={s.rows}>
                {d.recent.map((r, i) => (
                    <li key={`${r.at}-${i}`} className="flex min-w-0 flex-col gap-1.5 py-3 first:pt-1 last:pb-1">
                        <p className="text-[13.5px] break-words text-(--bc-ink-1)">“{r.text}”</p>
                        <p className={cx(s.tab, 'flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-(--bc-ink-3)')}>
                            {r.verdict === 'right' ? <Chip tone="ok" icon={Check}>Right</Chip> : <Chip tone="bad" icon={X}>Wrong</Chip>}
                            <span>{dateTimeIN(r.at)}</span>
                            {r.canUndo && r.ticketId && (
                                <Btn size="sm" variant="quiet" icon={Undo2} disabled={!!busy} onClick={() => undo(r.ticketId!)}>{busy === r.ticketId ? 'Undoing…' : 'Undo'}</Btn>
                            )}
                        </p>
                        {r.verdict === 'wrong' && (
                            <p className="text-[12.5px] break-words text-(--bc-ink-2)">
                                {name(r.chosen)}<span aria-hidden="true" className="mx-1.5 text-(--bc-ink-3)">→</span><span className="sr-only"> changed to </span><b className="font-semibold text-(--bc-ink-1)">{name(r.right)}</b>
                                <span className="text-(--bc-ink-3)">{r.moved ? ' · the ticket was moved' : ' · the ticket was not moved'}</span>
                            </p>
                        )}
                    </li>
                ))}
            </ul>
        </Card>
    );
}

/** Category codes in plain names, from every property's list the screen already has. */
function namesOf(d: TicketReviewView): (code: string | null) => string {
    const names = new Map<string, string>();
    for (const list of Object.values(d.choices)) for (const c of list) if (!names.has(c.code)) names.set(c.code, c.name);
    return (code: string | null) => (code ? names.get(code) ?? words(code) : 'No category');
}

const SOURCE_LABEL: Record<string, string> = { judged_right: 'confirmed right', judged_wrong: 'corrected', override: 're-sorted on the ticket' };
const MODE_WORD: Record<LearningView['setting']['mode'], string> = { off: 'Off', shadow: 'Watch only', live: 'On' };

/** The similar past tickets used, and why the confidence is what it is (one ticket). */
function TicketLearning({ n, names }: { n: TicketLearningNote; names: (code: string | null) => string }) {
    const differs = n.mode === 'shadow' && n.method !== 'failed' && n.newCode !== n.oldCode;
    return (
        <details className={cx(s.well, 'min-w-0 p-[12px]')}>
            <summary className="cursor-pointer text-[13px] font-semibold text-(--bc-ink-1)">
                {n.method === 'shortcut' ? 'Sorted as a repeat, without the AI' : 'Similar past tickets and why this confidence'}
                {n.mode === 'shadow' && <span className="ml-2 font-normal text-(--bc-ink-3)">(watch only: the learning way did not decide)</span>}
            </summary>
            <div className="mt-[10px] flex min-w-0 flex-col gap-[10px]">
                {n.method === 'failed' && <p className="text-[13px] text-(--bc-ink-2)">The learning way could not sort this ticket, so it was sorted the old way.</p>}
                {n.mode === 'shadow' && n.method !== 'failed' && (
                    <p className="text-[13px] text-(--bc-ink-2)">
                        The learning way would have chosen <b className="font-semibold text-(--bc-ink-1)">{names(n.newCode)}</b>{n.newConfidence !== null && <> at {confidenceLabel(n.newConfidence)}</>}
                        {differs ? <span className="text-(--bc-warn-text)"> (different from the old way)</span> : ' (the same as the old way)'}.
                    </p>
                )}
                {n.why && <p className="text-[13px] break-words text-(--bc-ink-2)"><span className="text-(--bc-ink-3)">Why this confidence: </span>{n.why}</p>}
                {n.neighbours.length > 0 ? (
                    <ul className={s.rows}>
                        {n.neighbours.map(x => (
                            <li key={x.id} className="flex min-w-0 flex-col gap-1 py-2 first:pt-0 last:pb-0">
                                <p className="text-[13px] break-words text-(--bc-ink-1)">“{x.text}”</p>
                                <p className={cx(s.tab, 'flex flex-wrap gap-x-2 text-[12px] text-(--bc-ink-3)')}>
                                    <span>→ <b className="font-semibold text-(--bc-ink-2)">{names(x.code)}</b></span>
                                    <span>{SOURCE_LABEL[x.source] ?? x.source}</span>
                                    <span>{Math.round(x.strength * 100)}% alike{x.by === 'meaning' ? ' (by meaning)' : ''}</span>
                                </p>
                            </li>
                        ))}
                    </ul>
                ) : <p className="text-[12.5px] text-(--bc-ink-3)">No similar past ticket was found.</p>}
            </div>
        </details>
    );
}

/** The setting, the examples and, while watching, the old way against the new way. */
function LearningStatus({ l }: { l: LearningView }) {
    const { go } = useBrain();
    const w = l.watch;
    const share = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)}%` : '—');
    return (
        <Card as="section" className="@container flex min-w-0 flex-col gap-[12px] p-[16px] @3xl:p-6" aria-labelledby="ticket-learn-h">
            <CardHead id="ticket-learn-h" icon={GraduationCap} label="How ticket sorting learns"
                right={<Btn size="sm" variant="quiet" onClick={() => go('switches')}>Change in Switches</Btn>} />
            <p className={cx(s.tab, 'flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-(--bc-ink-2)')}>
                <Chip tone={l.setting.mode === 'live' ? 'ok' : l.setting.mode === 'shadow' ? 'warn' : 'neutral'}>{MODE_WORD[l.setting.mode]}</Chip>
                <span>{int(l.examples)} learning examples</span>
                <span>similar tickets found by {l.setting.meaning ? 'meaning and words' : 'words'}</span>
            </p>
            {l.tableMissing && <p className="text-[12.5px] text-(--bc-warn-text)">Learning examples need migration 20261119000001 to be applied. Until then, tickets are sorted as before whatever the setting says.</p>}
            {w && (
                <div className="flex min-w-0 flex-col gap-[8px] border-t border-(--bc-line) pt-[12px]">
                    <span className="flex items-center gap-1.5 text-[13.5px] font-semibold text-(--bc-ink-1)"><GitCompare className="h-4 w-4" />Old way and learning way, last 30 days</span>
                    {w.known === 0 ? <p className="text-[13px] text-(--bc-ink-3)">No ticket with a known right answer yet. Judge some tickets here, or wait a week.</p> : (
                        <dl className="grid min-w-0 grid-cols-2 gap-x-6 gap-y-3 @xl:grid-cols-4">
                            <Fact k="Sorted right">old {share(w.oldRight, w.known)} · new <b>{share(w.newRight, w.known)}</b> <span className="text-(--bc-ink-3)">of {int(w.known)}</span></Fact>
                            <Fact k="Sent to Review">old {int(w.oldToReview)} · new <b>{int(w.newToReview)}</b></Fact>
                            <Fact k="Wrong but rated High">old {int(w.oldWrongButHigh)} · new <b>{int(w.newWrongButHigh)}</b></Fact>
                            <Fact k="Repeats, no AI">{int(w.shortcuts)}</Fact>
                        </dl>
                    )}
                    <p className="text-[12px] text-(--bc-ink-3)">Tickets nobody re-sorted within 7 days count as right. Switch to On when the new way is right at least as often and has fewer “wrong but rated High”.</p>
                </div>
            )}
        </Card>
    );
}

/** Near-identical examples with different categories: a person keeps one. */
function Conflicts({ conflicts, names, onReplace }: { conflicts: ConflictView[]; names: (code: string | null) => string; onReplace: (d: TicketReviewView) => void }) {
    const { api, report, toast } = useBrain();
    const [busy, setBusy] = useState<string | null>(null);
    const keep = async (keepId: string, dropId: string) => {
        if (busy) return;
        setBusy(keepId);
        const r = await api.postTicketReview({ action: 'keep', keep: keepId, drop: dropId });
        setBusy(null);
        report(r);
        if (!r.ok) { toast(r.message, 'bad'); return; }
        onReplace(r.data);
        toast(r.message ?? 'Kept.');
    };
    const side = (x: ConflictView['a'], other: ConflictView['a']) => (
        <div className="flex min-w-0 flex-col gap-[6px]">
            <p className="text-[13px] break-words text-(--bc-ink-1)">“{x.text}”</p>
            <p className={cx(s.tab, 'text-[12px] text-(--bc-ink-3)')}>→ <b className="font-semibold text-(--bc-ink-2)">{names(x.code)}</b> · {SOURCE_LABEL[x.source] ?? x.source} · {dateTimeIN(x.at)}</p>
            <Btn size="sm" variant="ghost" icon={Check} className="self-start" disabled={!!busy} onClick={() => keep(x.id, other.id)}>{busy === x.id ? 'Saving…' : 'Keep this one'}</Btn>
        </div>
    );
    return (
        <Card as="section" className="@container flex min-w-0 flex-col gap-[12px] p-[16px] @3xl:p-6" aria-labelledby="ticket-conflict-h">
            <CardHead id="ticket-conflict-h" icon={Scale} label="Examples that disagree" hint="Nearly the same ticket, sorted to different categories. The AI is shown both until you keep one." />
            <ul className={s.rows}>
                {conflicts.map(c => (
                    <li key={`${c.a.id}-${c.b.id}`} className="grid min-w-0 gap-[16px] py-3 first:pt-1 last:pb-1 @xl:grid-cols-2">
                        {side(c.a, c.b)}
                        {side(c.b, c.a)}
                    </li>
                ))}
            </ul>
        </Card>
    );
}

/** Week by week: is the Review queue shrinking, and is the confidence getting more honest? */
function Weeks({ weeks }: { weeks: WeekRow[] }) {
    const label = (from: string) => new Date(`${from}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });
    const queue = weeks.map(w => ({ key: w.from, label: label(w.from), long: `Week from ${label(w.from)}: ${w.toReview} of ${w.tickets} tickets sent to Review`, value: w.toReview }));
    const right = weeks.map(w => ({ key: w.from, label: label(w.from), long: `Week from ${label(w.from)}: ${w.tickets ? Math.round((100 * (w.tickets - w.resorted)) / w.tickets) : 0}% not re-sorted by a person`, value: w.tickets ? Math.round((100 * (w.tickets - w.resorted)) / w.tickets) : 0 }));
    return (
        <Card as="section" className="@container flex min-w-0 flex-col gap-[16px] p-[16px] @3xl:p-6" aria-labelledby="ticket-weeks-h">
            <CardHead id="ticket-weeks-h" icon={History} label="Week by week" hint="Learning works when the Review queue shrinks, fewer tickets need re-sorting, and the confidence given matches how often it is right." />
            <div className="grid min-w-0 gap-[24px] @3xl:grid-cols-2">
                <BarSeries bars={queue} format={v => int(v)} unit="tickets" title="Sent to Review" />
                <BarSeries bars={right} format={v => `${int(v)}%`} unit="%" title="Sorted right" />
            </div>
            <div className="min-w-0 overflow-x-auto">
                <table className={cx(s.tab, 'w-full text-left text-[12.5px]')}>
                    <thead className="text-(--bc-ink-3)"><tr><th className="py-1 pr-4 font-medium">Week from</th><th className="py-1 pr-4 font-medium">Tickets</th><th className="py-1 pr-4 font-medium">Judged right / wrong</th><th className="py-1 font-medium">Confidence given vs really right</th></tr></thead>
                    <tbody className="text-(--bc-ink-2)">
                        {weeks.map(w => (
                            <tr key={w.from} className="border-t border-(--bc-line)">
                                <td className="py-1.5 pr-4">{label(w.from)}</td>
                                <td className="py-1.5 pr-4">{int(w.tickets)}</td>
                                <td className="py-1.5 pr-4">{int(w.judgedRight)} / {int(w.judgedWrong)}</td>
                                <td className="py-1.5">{w.saidAvg === null ? '—' : <>said {w.saidAvg}%, right {w.actuallyRight}%{Math.abs(w.saidAvg - (w.actuallyRight ?? 0)) <= 5 ? ' (honest)' : ''}</>}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </Card>
    );
}

// ── sorting rules (2026-11-19) ──────────────────────────────────────────────────────────────────────────────────────

const TRIGGER_WORD: Record<string, string> = { daily: 'Daily', button: 'Suggested now', person: 'Your rules' };
const RUN_TONE: Record<string, Tone> = { offered: 'ok', not_offered: 'warn', no_change: 'neutral', failed: 'bad', testing: 'warn' };
const RUN_WORD: Record<string, string> = { offered: 'Offered', not_offered: 'Not offered', no_change: 'Nothing new', failed: 'Failed', testing: 'Testing' };

/**
 * Short rules the AI follows for every ticket, learned from the team's corrections. Drafted every day (when there are
 * new corrections) and on "Suggest rules now"; tested on judged tickets; used only after a person approves.
 */
function RulesCard({ r, names, onReplace }: { r: RulesView; names: (code: string | null) => string; onReplace: (d: TicketReviewView) => void }) {
    const { api, report, toast, go } = useBrain();
    const ids = useId();
    const [busy, setBusy] = useState<string | null>(null);
    const [own, setOwn] = useState<string>(() => r.active?.rules.map((x, i) => `${i + 1}. ${x.text}`).join('\n') ?? '');
    const continuing = useRef(false);

    const send = async (body: Parameters<typeof api.postTicketReview>[0], label: string) => {
        setBusy(label);
        const res = await api.postTicketReview(body);
        setBusy(null);
        report(res);
        if (!res.ok) { toast(res.message, 'bad'); return null; }
        onReplace(res.data);
        if (res.message) toast(res.message);
        return res.data;
    };

    // While a run is being tested, keep asking the server to carry on until it is done (it also carries on by itself).
    useEffect(() => {
        if (!r.running || continuing.current) return;
        continuing.current = true;
        let stop = false;
        (async () => {
            let runId: string | null = r.running?.id ?? null;
            while (runId && !stop) {
                const res = await api.postTicketReview({ action: 'rules_continue', runId });
                if (!res.ok || stop) break;
                onReplace(res.data);
                runId = res.data.rules?.running?.id ?? null;
                if (!runId && res.message) toast(res.message);
            }
            continuing.current = false;
        })();
        return () => { stop = true; continuing.current = false; };
        // eslint-disable-next-line react-hooks/exhaustive-deps -- restart only when another run starts
    }, [r.running?.id]);

    if (r.tableMissing) {
        return (
            <Card as="section" className="flex min-w-0 flex-col gap-2 p-[16px]" aria-labelledby={`${ids}h`}>
                <CardHead id={`${ids}h`} icon={BookCheck} label="Sorting rules" />
                <p className="text-[13px] text-(--bc-warn-text)">Sorting rules need migrations 20261119000002 and 20261119000003 to be applied.</p>
            </Card>
        );
    }
    const running = r.running;
    return (
        <Card as="section" className="@container flex min-w-0 flex-col gap-[14px] p-[16px] @3xl:p-6" aria-labelledby={`${ids}h`}>
            <CardHead id={`${ids}h`} icon={BookCheck} label="Sorting rules"
                hint="Short rules the AI follows for every ticket, learned from your corrections. A draft is tested on judged tickets first and is only used after you approve it."
                right={<Btn size="sm" variant="ghost" icon={Sparkles} disabled={!!busy || !!running} onClick={() => send({ action: 'rules_suggest' }, 'suggest')}>{busy === 'suggest' ? 'Drafting…' : 'Suggest rules now'}</Btn>} />
            <p className="text-[12.5px] text-(--bc-ink-3)">
                {r.daily ? 'Drafted automatically every day at 2:45 am when there are new corrections.' : 'Daily drafting is off.'}{' '}
                <button type="button" className="underline" onClick={() => go('switches')}>Change in Switches</button>
            </p>

            {running && (
                <div className={cx(s.well, 'flex min-w-0 flex-col gap-2 p-[12px]')} role="status">
                    <span className="text-[13px] font-semibold text-(--bc-ink-1)">Testing rules ({TRIGGER_WORD[running.trigger] ?? running.trigger}): {int(running.done)} of {int(running.total)} tickets</span>
                    <div className="h-[6px] w-full rounded-full bg-(--bc-line)"><div className="h-[6px] rounded-full bg-(--bc-accent)" style={{ width: `${running.total ? Math.round((100 * running.done) / running.total) : 0}%` }} /></div>
                    <span className="text-[12px] text-(--bc-ink-3)">You can leave this page; testing carries on by itself.</span>
                </div>
            )}

            {r.offered && <OfferedRules v={r.offered} names={names} busy={busy}
                onUse={() => send({ action: 'rules_use', versionId: r.offered!.id }, 'use')}
                onReject={() => send({ action: 'rules_reject', versionId: r.offered!.id }, 'reject')} />}

            <div className="flex min-w-0 flex-col gap-2">
                <span className="text-[13.5px] font-semibold text-(--bc-ink-1)">{r.active ? `In use: version ${r.active.version}` : 'No rules in use'}</span>
                {r.active ? (
                    <>
                        <ol className="list-decimal pl-5 text-[13px] text-(--bc-ink-2)">{r.active.rules.map((x, i) => <li key={i} className="break-words py-0.5">{x.text}</li>)}</ol>
                        <p className="text-[12px] text-(--bc-ink-3)">Approved {r.active.decidedAt ? dateTimeIN(r.active.decidedAt) : ''}</p>
                        <Btn size="sm" variant="quiet" className="self-start" disabled={!!busy} onClick={() => send({ action: 'rules_stop' }, 'stop')}>{busy === 'stop' ? 'Stopping…' : 'Stop using rules'}</Btn>
                    </>
                ) : <p className="text-[13px] text-(--bc-ink-3)">Tickets are sorted with the fixed instructions only.</p>}
            </div>

            <details className={cx(s.well, 'min-w-0 p-[12px]')}>
                <summary className="cursor-pointer text-[13px] font-semibold text-(--bc-ink-1)">Write or edit rules yourself</summary>
                <div className="mt-[10px] flex min-w-0 flex-col gap-2">
                    <label htmlFor={`${ids}own`} className="text-[12.5px] text-(--bc-ink-3)">One rule per line, about which category fits which kind of ticket. They are tested like the AI&apos;s before you can use them.</label>
                    <textarea id={`${ids}own`} className={s.input} rows={5} maxLength={1600} value={own} onChange={e => setOwn(e.target.value)}
                        placeholder="1. MCP at our sites means the MCB panel: power_outage, not fire_alarm." />
                    <Btn size="sm" variant="ghost" className="self-start" disabled={!!busy || !!running || !own.trim()} onClick={() => send({ action: 'rules_own', text: own }, 'own')}>{busy === 'own' ? 'Starting the test…' : 'Test my rules'}</Btn>
                </div>
            </details>

            {r.history.length > 0 && (
                <details className="min-w-0">
                    <summary className="cursor-pointer text-[13px] font-semibold text-(--bc-ink-1)">Earlier versions</summary>
                    <ul className={cx(s.rows, 'mt-2')}>
                        {r.history.map(v => (
                            <li key={v.id} className="flex min-w-0 flex-wrap items-center gap-2 py-2 text-[13px]">
                                <span className="font-semibold">Version {v.version}</span>
                                <Chip tone={v.status === 'rejected' ? 'bad' : 'neutral'}>{v.status === 'rejected' ? 'Rejected' : 'Not in use'}</Chip>
                                <span className="text-(--bc-ink-3)">{v.rules.length} rule(s) · {dateTimeIN(v.at)}</span>
                                {v.status === 'retired' && <Btn size="sm" variant="quiet" disabled={!!busy} onClick={() => send({ action: 'rules_use', versionId: v.id }, `use-${v.id}`)}>{busy === `use-${v.id}` ? 'Putting back…' : 'Put back'}</Btn>}
                            </li>
                        ))}
                    </ul>
                </details>
            )}

            {r.runs.length > 0 && (
                <details className="min-w-0">
                    <summary className="cursor-pointer text-[13px] font-semibold text-(--bc-ink-1)">Recent runs</summary>
                    <ul className={cx(s.rows, 'mt-2')}>
                        {r.runs.map(x => (
                            <li key={x.id} className="flex min-w-0 flex-col gap-1 py-2">
                                <p className={cx(s.tab, 'flex flex-wrap items-center gap-2 text-[12px] text-(--bc-ink-3)')}>
                                    <Chip tone={RUN_TONE[x.status] ?? 'neutral'}>{RUN_WORD[x.status] ?? x.status}</Chip>
                                    <span>{TRIGGER_WORD[x.trigger] ?? x.trigger}</span><span>{dateTimeIN(x.at)}</span>
                                </p>
                                <p className="text-[13px] break-words text-(--bc-ink-2)">{x.message}</p>
                            </li>
                        ))}
                    </ul>
                </details>
            )}
        </Card>
    );
}

/** A tested draft waiting for a person: the rules, where each came from, and the test. */
function OfferedRules({ v, names, busy, onUse, onReject }: { v: RuleVersionView; names: (code: string | null) => string; busy: string | null; onUse: () => void; onReject: () => void }) {
    const t = v.test;
    const ba = (b: number, a: number, of: number) => <>{int(b)} → <b className="font-semibold text-(--bc-ink-1)">{int(a)}</b> <span className="text-(--bc-ink-3)">of {int(of)}</span></>;
    return (
        <div className="flex min-w-0 flex-col gap-[12px] rounded-[12px] border border-(--bc-line) p-[14px]">
            <div className="flex flex-wrap items-center gap-2">
                <span className="text-[14px] font-semibold text-(--bc-ink-1)">Version {v.version} is waiting for you</span>
                <Chip tone="ok" icon={Check}>Passed the test</Chip>
                <span className="text-[12px] text-(--bc-ink-3)">{TRIGGER_WORD[v.source] ?? v.source} · {dateTimeIN(v.at)}</span>
            </div>
            {v.summary && <p className="text-[13px] text-(--bc-ink-2)">{v.summary}</p>}
            <ol className="flex list-decimal flex-col gap-2 pl-5">
                {v.rules.map((x, i) => (
                    <li key={i} className="text-[13px] break-words text-(--bc-ink-1)">
                        {x.text}
                        {x.sources.length > 0 && (
                            <details className="mt-1">
                                <summary className="cursor-pointer text-[12px] text-(--bc-ink-3)">Learned from {x.sources.length} ticket(s)</summary>
                                <ul className="mt-1 flex flex-col gap-1 text-[12px] text-(--bc-ink-2)">{x.sources.map((src, k) => <li key={k}>“{src.text}” → {names(src.code)}</li>)}</ul>
                            </details>
                        )}
                    </li>
                ))}
            </ol>
            {t && (
                <dl className="grid min-w-0 grid-cols-1 gap-x-6 gap-y-2 text-[13px] text-(--bc-ink-2) @xl:grid-cols-2">
                    <Fact k="Tickets it was written from, sorted right">{ba(t.fix.beforeRight, t.fix.afterRight, t.fix.tickets)}</Fact>
                    <Fact k="Tickets it never saw, sorted right">{ba(t.heldOut.beforeRight, t.heldOut.afterRight, t.heldOut.tickets)}</Fact>
                    <Fact k="Wrong but rated High">{int(t.heldOut.beforeWrongButHigh)} → <b className="font-semibold text-(--bc-ink-1)">{int(t.heldOut.afterWrongButHigh)}</b></Fact>
                    <Fact k="Danger tickets given a lower priority">{int(t.dangerLowered.length)}</Fact>
                </dl>
            )}
            {t && (t.fixed.length > 0 || t.broke.length > 0) && (
                <details>
                    <summary className="cursor-pointer text-[12.5px] text-(--bc-ink-3)">Tickets it changes ({t.fixed.length} fixed, {t.broke.length} broken)</summary>
                    <ul className="mt-1 flex flex-col gap-1 text-[12px] text-(--bc-ink-2)">
                        {t.fixed.map((x, i) => <li key={`f${i}`}><span className="text-(--bc-ok-text)">Fixed:</span> “{x.text}” → {names(x.right)}</li>)}
                        {t.broke.map((x, i) => <li key={`b${i}`}><span className="text-(--bc-bad-text)">Broken:</span> “{x.text}” (right: {names(x.right)})</li>)}
                    </ul>
                </details>
            )}
            <div className="flex flex-wrap gap-2">
                <Btn size="sm" icon={Check} disabled={!!busy} onClick={onUse}>{busy === 'use' ? 'Saving…' : 'Use these rules'}</Btn>
                <Btn size="sm" variant="quiet" icon={X} disabled={!!busy} onClick={onReject}>{busy === 'reject' ? 'Saving…' : 'Reject'}</Btn>
            </div>
        </div>
    );
}
