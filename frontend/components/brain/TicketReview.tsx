'use client';

/**
 * Review → Tickets (owner 2026-11-15): how new tickets were sorted. The AI sorts every ticket and rates how sure it is;
 * the ones below High, and the ones the keyword rules sorted while the AI was unavailable, wait here. The Tech team says
 * Right or Wrong; a wrong one with the right category teaches the AI and, while the ticket is open, moves it.
 * The ticket's words arrive masked and nothing here says who raised it.
 * Built from the screen's own pieces (ui.tsx, brain.module.css); no new visual values.
 */
import React, { useEffect, useId, useState } from 'react';
import { Check, CircleSlash, Eye, Gauge, History, ShieldCheck, TriangleAlert, X } from 'lucide-react';
import type { CategoryChoice, TicketReviewItem, TicketReviewView } from '@/backend/lib/ticketing/sortReview';
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
                    <div className={cx(s.tab, 'flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px] text-(--bc-ink-2)')}>
                        <span><b className={cx(s.numMd, 'text-(--bc-ink-1)')}>{int(d.waiting)}</b> waiting</span>
                        {d.waiting > d.queue.length && <span className="text-(--bc-ink-3)">showing the newest {int(d.queue.length)}</span>}
                    </div>
                    {d.queue.length === 0 ? (
                        <Card><Empty icon={ShieldCheck} title="Nothing to check">Tickets the AI is not sure about appear here.</Empty></Card>
                    ) : (
                        <ul className="flex min-w-0 flex-col gap-[16px]">
                            {d.queue.map(t => <TicketItem key={t.id} t={t} choices={d.choices[t.choicesKey] ?? []} off={d.tableMissing} onReplace={replace} />)}
                        </ul>
                    )}
                    {d.recent.length > 0 && <Recent d={d} />}
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

function TicketItem({ t, choices, off, onReplace }: { t: TicketReviewItem; choices: CategoryChoice[]; off: boolean; onReplace: (d: TicketReviewView) => void }) {
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

function Recent({ d }: { d: TicketReviewView }) {
    // Category codes in plain names, from every property's list the screen already has.
    const names = new Map<string, string>();
    for (const list of Object.values(d.choices)) for (const c of list) if (!names.has(c.code)) names.set(c.code, c.name);
    const name = (code: string | null) => (code ? names.get(code) ?? code : 'No category');
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
