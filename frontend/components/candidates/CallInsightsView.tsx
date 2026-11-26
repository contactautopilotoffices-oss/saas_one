'use client';

import React, { useState } from 'react';
import { AlertTriangle, Check } from 'lucide-react';
import { formatClock } from '@/backend/lib/candidates/call-files';
import {
    ANSWER_VERDICT_LABELS, CALL_CONCERN_LABELS, CALL_FACT_LABELS,
    type CallAnalysis, type CallFactKey, type CallInsights, type CallSentiment, type CandidateRecord, type InterviewAnalysis, type PayBasis,
} from '@/backend/lib/candidates/types';
import { api } from './api';
import { formatInr, formatNotice } from './format';
import { BTN_GHOST, BTN_PRIMARY, BTN_SECONDARY, CARD, LABEL, Spinner, Tag, useUi, WELL } from './ui';

const SENTIMENT_LABEL: Record<CallSentiment, string> = { positive: 'Positive', neutral: 'Neutral', negative: 'Negative' };
const SENTIMENT_BG: Record<CallSentiment, string> = { positive: 'bg-success', neutral: 'bg-border', negative: 'bg-error' };
const INTEREST_LABEL: Record<CallInsights['interestLevel'], string> = { high: 'High', medium: 'Medium', low: 'Low', unclear: 'Unclear' };
const CONFIDENCE_LABEL: Record<CallInsights['sentimentConfidence'], string> = { high: 'high confidence', medium: 'fair confidence', low: 'low confidence' };

function Quote({ quote, at, onSeek }: { quote: string | null; at: number | null; onSeek?: (seconds: number) => void }) {
    if (!quote) return null;
    return (
        <span className="text-xs italic text-text-secondary">
            {at !== null && (onSeek
                ? <button type="button" onClick={() => onSeek(at)} className="mr-1 not-italic font-semibold tabular-nums text-primary-dark hover:underline" title="Play from here">{formatClock(at)}</button>
                : <span className="mr-1 not-italic font-semibold tabular-nums text-text-tertiary">{formatClock(at)}</span>)}
            “{quote}”
        </span>
    );
}

function SentimentStrip({ timeline, duration }: { timeline: CallInsights['timeline']; duration: number | null }) {
    const timed = !!duration && duration > 0 && timeline.length > 0 && timeline.every(p => p.startSeconds !== null && p.endSeconds !== null && p.endSeconds > p.startSeconds);
    const parts = timeline.map(p => ({ ...p, weight: timed ? Math.max(1, (p.endSeconds as number) - (p.startSeconds as number)) : Math.max(1, p.share) }));
    const total = parts.reduce((n, p) => n + p.weight, 0) || 1;
    if (!parts.length) return <p className="text-sm text-text-tertiary">The model did not split the call into parts.</p>;
    return (
        <div>
            <div role="img" aria-label={`Sentiment over the call, start to end: ${parts.map(p => `${SENTIMENT_LABEL[p.sentiment].toLowerCase()} (${p.note})`).join('; ')}`} className="flex h-3.5 gap-x-0.5">
                {parts.map((p, i) => (
                    <span key={i} title={`${SENTIMENT_LABEL[p.sentiment]}${p.startSeconds !== null ? ` · ${formatClock(p.startSeconds)}` : ''} · ${p.note}`} style={{ flexGrow: (p.weight / total) * 100, flexBasis: 0 }} className={`min-w-[6px] rounded-[3px] ${SENTIMENT_BG[p.sentiment]}`} />
                ))}
            </div>
            {timed && duration && <div className="mt-1 flex justify-between text-[11px] tabular-nums text-text-tertiary" aria-hidden><span>0:00</span><span>{formatClock(duration / 2)}</span><span>{formatClock(duration)}</span></div>}
            <ul className="mt-2 space-y-1">
                {parts.map((p, i) => (
                    <li key={i} className="flex items-start gap-x-2 text-xs text-text-secondary">
                        <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${SENTIMENT_BG[p.sentiment]}`} aria-hidden />
                        {p.startSeconds !== null && <span className="shrink-0 tabular-nums text-text-tertiary">{formatClock(p.startSeconds)}</span>}
                        <span className="sr-only">{SENTIMENT_LABEL[p.sentiment]}: </span>
                        <span>{p.note}</span>
                    </li>
                ))}
            </ul>
        </div>
    );
}

type FactRow = { key: CallFactKey; onRecord: string | null; heard: string | null; same: boolean; quote: string | null; at: number | null; value: unknown; basis?: PayBasis };

const overwrites = (row: FactRow) => row.key !== 'reasonForChange' && !!row.onRecord && !row.same;
const lpa = (monthly: number) => `${Number(((monthly * 12) / 100_000).toFixed(2))} LPA`;

function cautionOf(row: FactRow): { ctc: boolean; unclear: boolean; overwrite: boolean } | null {
    const ctc = row.basis === 'ctc';
    const unclear = row.basis === 'unclear' && row.value !== null && row.value !== undefined;
    const overwrite = overwrites(row);
    return ctc || unclear || overwrite ? { ctc, unclear, overwrite } : null;
}

function factRows(r: CallInsights, record: CandidateRecord): FactRow[] {
    const f = r.facts;
    const money = (v: number | null) => (v === null ? null : `${formatInr(v)} / month`);
    const sameText = (a: string | null, b: string | null) => !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();
    return [
        { key: 'currentInhand', onRecord: money(record.currentInhand), heard: money(f.currentInhand.value), same: f.currentInhand.basis !== 'ctc' && f.currentInhand.value !== null && f.currentInhand.value === record.currentInhand, quote: f.currentInhand.quote, at: f.currentInhand.at, value: f.currentInhand.value, basis: f.currentInhand.basis },
        { key: 'expectedInhand', onRecord: money(record.expectedInhand), heard: money(f.expectedInhand.value), same: f.expectedInhand.basis !== 'ctc' && f.expectedInhand.value !== null && f.expectedInhand.value === record.expectedInhand, quote: f.expectedInhand.quote, at: f.expectedInhand.at, value: f.expectedInhand.value, basis: f.expectedInhand.basis },
        { key: 'noticePeriodDays', onRecord: record.noticePeriodDays === null ? null : formatNotice(record.noticePeriodDays), heard: f.noticePeriodDays.value === null ? null : formatNotice(f.noticePeriodDays.value), same: f.noticePeriodDays.value !== null && f.noticePeriodDays.value === record.noticePeriodDays, quote: f.noticePeriodDays.quote, at: f.noticePeriodDays.at, value: f.noticePeriodDays.value },
        { key: 'location', onRecord: record.location, heard: f.location.value, same: sameText(f.location.value, record.location), quote: f.location.quote, at: f.location.at, value: f.location.value },
        { key: 'reasonForChange', onRecord: null, heard: f.reasonForChange.value, same: false, quote: f.reasonForChange.quote, at: f.reasonForChange.at, value: f.reasonForChange.value },
    ];
}

/** Shared Call Insights cards (sentiment, interest, answers, timeline, concerns, red flags, facts) used by Calls and Interviews. */
export default function CallInsightsView({ orgId, call, record, onApplied, onSeek }: {
    orgId: string;
    call: Pick<InterviewAnalysis, 'id' | 'durationSeconds' | 'result' | 'appliedFacts'>;
    record: CandidateRecord;
    onApplied: (updated: CallAnalysis, record: CandidateRecord | null) => void;
    onSeek?: (seconds: number) => void;
}) {
    const { notify, reportError } = useUi();
    const [applying, setApplying] = useState<CallFactKey | 'all' | null>(null);
    const [confirmAll, setConfirmAll] = useState(false);
    const [warnFor, setWarnFor] = useState<CallFactKey | null>(null);
    const r = call.result;
    if (!r) return null;

    const applied = new Set(call.appliedFacts.map(a => a.key));
    const rows = factRows(r, record);
    const recordFrom = record.sheetName ? `this record came from ${record.sheetName}` : null;
    const said = rows.filter(row => row.value !== null && row.value !== undefined && !row.same && !applied.has(row.key));
    const pending = said.filter(row => !cautionOf(row)?.ctc && !cautionOf(row)?.unclear);
    const heldBack = said.length - pending.length;

    const apply = async (key: CallFactKey) => {
        setApplying(key);
        const res = await api<{ call: CallAnalysis; record: CandidateRecord | null }>(`/api/candidates/calls/${encodeURIComponent(call.id)}/apply`, { json: { orgId, keys: [key] } });
        setApplying(null);
        if (!res.ok) { notify(res.error, 'error'); if (res.noAccess) reportError(res); return; }
        notify(key === 'reasonForChange' ? 'Kept as a remark' : `${CALL_FACT_LABELS[key]} updated`, 'success');
        onApplied(res.data.call, res.data.record);
    };

    const applyAll = async () => {
        if (!pending.length) return;
        setApplying('all');
        const res = await api<{ call: CallAnalysis; record: CandidateRecord | null }>(`/api/candidates/calls/${encodeURIComponent(call.id)}/apply`, { json: { orgId, keys: pending.map(row => row.key) } });
        setApplying(null);
        setConfirmAll(false);
        if (!res.ok) { notify(res.error, 'error'); if (res.noAccess) reportError(res); return; }
        notify(`${pending.length} ${pending.length === 1 ? 'fact' : 'facts'} applied to the record`, 'success');
        onApplied(res.data.call, res.data.record);
    };

    return (
        <div className="space-y-3">
            <div className="grid gap-x-3 gap-y-3 @2xl:grid-cols-3">
                <div className={`${WELL} px-4 py-3`}>
                    <p className={LABEL}>Sentiment</p>
                    <p className="mt-1 flex items-center gap-x-2 font-display text-lg font-bold leading-tight text-text-primary"><span className={`h-2.5 w-2.5 shrink-0 rounded-full ${SENTIMENT_BG[r.overallSentiment]}`} aria-hidden />{SENTIMENT_LABEL[r.overallSentiment]}</p>
                    <p className="mt-0.5 text-xs text-text-secondary">{CONFIDENCE_LABEL[r.sentimentConfidence]}</p>
                </div>
                <div className={`${WELL} px-4 py-3`}>
                    <p className={LABEL}>Interest in the role</p>
                    <p className="mt-1 font-display text-lg font-bold leading-tight text-text-primary">{INTEREST_LABEL[r.interestLevel]}</p>
                    <p className="mt-0.5 text-xs text-text-secondary">{r.concerns.length ? `${r.concerns.length} ${r.concerns.length === 1 ? 'concern' : 'concerns'} raised` : 'no concerns raised'}</p>
                </div>
                <div className={`${WELL} px-4 py-3`}>
                    <p className={LABEL}>Suggested next step</p>
                    <p className="mt-1 text-sm font-semibold leading-snug text-text-primary">{r.suggestedNextStep || '—'}</p>
                    <p className="mt-0.5 text-xs text-text-secondary">advisory · you decide</p>
                </div>
            </div>

            <div className={`${CARD} px-4 py-3`}>
                <p className={LABEL}>Summary</p>
                <p className="mt-1 text-sm leading-relaxed text-text-primary">{r.summary || 'The model wrote no summary.'}</p>
            </div>

            {(r.answers?.length || r.notCovered?.length || r.nextRoundQuestions?.length) ? (
                <div className={`${CARD} px-4 py-3`}>
                    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                        <p className={LABEL}>Answers in this round</p>
                        <span className="text-xs text-text-tertiary">{onSeek ? 'judged on what was said, not how · click a time to listen' : 'judged on what was said, not how'}</span>
                    </div>
                    {r.answers?.length ? (
                        <ul className="mt-2 space-y-2">
                            {r.answers.map((a, i) => (
                                <li key={i} className="text-sm">
                                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                        <Tag tone={a.verdict === 'clear' ? 'success' : a.verdict === 'partial' ? 'info' : 'warn'}>{ANSWER_VERDICT_LABELS[a.verdict]}</Tag>
                                        <span className="font-semibold text-text-primary">{a.topic}</span>
                                        {a.note && <span className="text-text-secondary">{a.note}</span>}
                                    </div>
                                    <div className="mt-0.5"><Quote quote={a.quote} at={a.at} onSeek={onSeek} /></div>
                                </li>
                            ))}
                        </ul>
                    ) : <p className="mt-1 text-sm text-text-tertiary">No questions on skills or experience were heard.</p>}
                    {r.notCovered?.length ? (
                        <p className="mt-3 text-sm text-text-primary"><span className="font-semibold">Not covered</span> <span className="text-text-secondary">· must-haves that never came up:</span> {r.notCovered.join(', ')}</p>
                    ) : null}
                    {r.nextRoundQuestions?.length ? (
                        <div className="mt-3">
                            <p className="text-sm font-semibold text-text-primary">Ask in the next round</p>
                            <ol className="mt-1 list-decimal space-y-1 pl-5 text-sm text-text-primary">{r.nextRoundQuestions.map((q, i) => <li key={i}>{q}</li>)}</ol>
                        </div>
                    ) : null}
                </div>
            ) : null}

            <div className={`${CARD} px-4 py-3`}>
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                    <p className={LABEL}>Sentiment over the call</p>
                    <span className="flex gap-x-3 text-xs text-text-secondary" aria-hidden>
                        {(['positive', 'neutral', 'negative'] as const).map(s => <span key={s} className="flex items-center gap-x-1"><span className={`h-2 w-2 rounded-full ${SENTIMENT_BG[s]}`} />{SENTIMENT_LABEL[s].toLowerCase()}</span>)}
                    </span>
                </div>
                <div className="mt-2"><SentimentStrip timeline={r.timeline} duration={call.durationSeconds} /></div>
            </div>

            <div className="grid gap-x-3 gap-y-3 @2xl:grid-cols-2">
                <div className={`${CARD} px-4 py-3`}>
                    <p className={LABEL}>Concerns heard</p>
                    {r.concerns.length === 0 ? <p className="mt-1 text-sm text-text-tertiary">None heard.</p> : (
                        <ul className="mt-2 space-y-2">
                            {r.concerns.map((c, i) => (
                                <li key={i} className="text-sm">
                                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1"><Tag tone={c.topic === 'salary' || c.topic === 'notice' ? 'warn' : 'neutral'}>{CALL_CONCERN_LABELS[c.topic]}</Tag><span className="text-text-primary">{c.note}</span></div>
                                    <div className="mt-0.5"><Quote quote={c.quote} at={c.at} onSeek={onSeek} /></div>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
                <div className={`${CARD} px-4 py-3`}>
                    <p className={LABEL}>Red flags</p>
                    {r.redFlags.length === 0 ? <p className="mt-1 text-sm text-text-tertiary">None heard. A red flag is only reported with a quote from the call.</p> : (
                        <ul className="mt-2 space-y-2">
                            {r.redFlags.map((f, i) => (
                                <li key={i} className="text-sm">
                                    <div className="flex items-start gap-x-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-error" aria-hidden /><span className="text-text-primary">{f.note}</span></div>
                                    <div className="mt-0.5 pl-6"><Quote quote={f.quote} at={f.at} onSeek={onSeek} /></div>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            </div>

            <div className={`${CARD} px-4 py-3`}>
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                    <p className={LABEL}>Facts heard on the call</p>
                    <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span className="text-xs text-text-tertiary">compared with the record · Apply writes one fact · nothing changes on its own</span>
                        {pending.length > 1 && !confirmAll && (
                            <button type="button" onClick={() => setConfirmAll(true)} disabled={applying !== null} className={`${BTN_SECONDARY} h-8 px-3 text-xs`}>Apply all ({pending.length})</button>
                        )}
                    </span>
                </div>
                {confirmAll && pending.length > 0 && (
                    <div role="group" aria-label="Apply all facts" className={`${WELL} mt-2 px-3 py-2.5`}>
                        <p className="text-sm font-semibold text-text-primary">Write {pending.length} facts to the record?</p>
                        {pending.some(overwrites) && (
                            <p className="mt-0.5 flex items-center gap-x-1.5 text-xs text-amber-800">
                                <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
                                {pending.filter(overwrites).length} of them will overwrite a value already on record{recordFrom ? ` (${recordFrom})` : ''}. The old values stay in the history.
                            </p>
                        )}
                        {heldBack > 0 && (
                            <p className="mt-0.5 text-xs text-text-secondary">{heldBack === 1 ? 'One pay figure is' : `${heldBack} pay figures are`} left out: said as CTC or not clearly in-hand. Check take-home and apply {heldBack === 1 ? 'it' : 'them'} on {heldBack === 1 ? 'its' : 'their'} own.</p>
                        )}
                        <ul className="mt-1 space-y-0.5 text-xs text-text-secondary">
                            {pending.map(row => (
                                <li key={row.key}>
                                    <span className="font-medium text-text-primary">{CALL_FACT_LABELS[row.key]}</span>{' '}
                                    {row.key === 'reasonForChange'
                                        ? <>kept as a remark: {row.heard}</>
                                        : <>{row.onRecord ? <>{row.onRecord} → </> : 'set to '}<span className="font-semibold text-amber-800">{row.heard}</span>{overwrites(row) && <span className="ml-1.5 inline-flex items-center gap-x-1 rounded-full bg-warning/15 px-1.5 text-[11px] font-semibold text-amber-800"><AlertTriangle className="h-3 w-3" aria-hidden />will overwrite</span>}</>}
                                </li>
                            ))}
                        </ul>
                        <div className="mt-2 flex justify-end gap-x-2">
                            <button type="button" onClick={() => setConfirmAll(false)} disabled={applying !== null} className={`${BTN_GHOST} h-8 px-3 text-xs`}>Cancel</button>
                            <button type="button" onClick={() => void applyAll()} disabled={applying !== null} className={`${BTN_PRIMARY} h-8 px-3 text-xs`}>{applying === 'all' ? <Spinner /> : `Apply all ${pending.length}`}</button>
                        </div>
                    </div>
                )}
                <div className="-mx-4 mt-2 overflow-x-auto px-4">
                    <table className="w-full min-w-[560px] text-sm">
                        <thead>
                            <tr className="text-left text-xs font-medium text-text-secondary">
                                <th className="pb-2 pr-3 font-medium">Field</th><th className="pb-2 pr-3 font-medium">On record</th><th className="pb-2 pr-3 font-medium">Heard on call</th><th className="pb-2 pr-3 font-medium">Where</th><th className="pb-2 text-right font-medium"><span className="sr-only">Action</span></th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border-subtle">
                            {rows.map(row => {
                                const done = applied.has(row.key);
                                const notSaid = row.value === null || row.value === undefined;
                                const warning = warnFor === row.key && !done;
                                return (
                                    <React.Fragment key={row.key}>
                                    <tr className={`align-top ${warning ? 'bg-warning/[.06]' : ''}`}>
                                        <td className="py-2.5 pr-3 font-medium text-text-primary">{CALL_FACT_LABELS[row.key]}</td>
                                        <td className="py-2.5 pr-3 text-text-secondary">{row.key === 'reasonForChange' ? <span className="text-text-tertiary">kept as a remark</span> : row.onRecord ?? <span className="text-text-tertiary">not on record</span>}</td>
                                        <td className={`py-2.5 pr-3 ${notSaid ? 'text-text-tertiary' : row.same ? 'text-text-secondary' : 'font-semibold text-amber-800'}`}>
                                            {notSaid ? 'not said' : row.same ? `${row.heard} · matches` : row.heard}
                                            {!notSaid && row.basis === 'ctc' && typeof row.value === 'number' && (
                                                <span className="mt-0.5 block text-xs font-normal text-text-secondary">CTC ({lpa(row.value)}) · not in-hand</span>
                                            )}
                                            {!notSaid && row.basis === 'unclear' && <span className="mt-0.5 block text-xs font-normal text-text-secondary">in-hand or CTC? not said</span>}
                                        </td>
                                        <td className="py-2.5 pr-3"><Quote quote={row.quote} at={row.at} onSeek={onSeek} /></td>
                                        <td className="py-2.5 text-right">
                                            {notSaid ? <span className="text-text-tertiary">—</span>
                                                : done ? <Tag tone="success" icon={Check}>Applied</Tag>
                                                : row.same ? <Tag tone="success">✓</Tag>
                                                : warning ? null
                                                : <button type="button" onClick={() => (cautionOf(row) ? setWarnFor(row.key) : void apply(row.key))} disabled={applying !== null} className={`${BTN_SECONDARY} h-8 px-3 text-xs`}>{applying === row.key ? <Spinner /> : 'Apply'}</button>}
                                        </td>
                                    </tr>
                                    {warning && (() => {
                                        const c = cautionOf(row) ?? { ctc: false, unclear: false, overwrite: false };
                                        return (
                                        <tr className="bg-warning/[.06]">
                                            <td colSpan={5} className="pb-2.5 pr-1">
                                                <div role="alert" className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg px-3 py-2 ring-1 ring-inset ring-warning/40">
                                                    <AlertTriangle className="h-4 w-4 shrink-0 text-amber-700" aria-hidden />
                                                    <p className="min-w-0 flex-1 text-sm text-text-primary">
                                                        {c.ctc && typeof row.value === 'number' && (
                                                            <span className="block">This was said as <strong>CTC ({lpa(row.value)})</strong>, not take-home. {row.heard} is the CTC divided by 12; the in-hand pay is lower after deductions. Confirm the take-home with the candidate first.</span>
                                                        )}
                                                        {c.unclear && <span className="block">The call does not say whether {row.heard} is in-hand or CTC. Confirm it with the candidate first.</span>}
                                                        {c.overwrite && (
                                                            <span className="block">{CALL_FACT_LABELS[row.key]} is <strong>{row.onRecord}</strong> on record{recordFrom ? ` (${recordFrom})` : ''}. It will be overwritten with <strong className="text-amber-800">{row.heard}</strong>.</span>
                                                        )}
                                                        {c.overwrite && <span className="block text-xs text-text-secondary">The old value stays in the history.</span>}
                                                    </p>
                                                    <span className="flex shrink-0 gap-x-2">
                                                        <button type="button" onClick={() => setWarnFor(null)} disabled={applying !== null} className={`${BTN_GHOST} h-8 px-3 text-xs`}>Keep</button>
                                                        <button type="button" onClick={() => { void apply(row.key).then(() => setWarnFor(null)); }} disabled={applying !== null} className={`${BTN_PRIMARY} h-8 px-3 text-xs`}>{applying === row.key ? <Spinner /> : c.ctc || c.unclear ? 'Apply anyway' : 'Overwrite'}</button>
                                                    </span>
                                                </div>
                                            </td>
                                        </tr>
                                        );
                                    })()}
                                    </React.Fragment>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
