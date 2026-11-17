'use client';

import React, { useState } from 'react';
import { CalendarClock, Check, ChevronLeft, ChevronRight, CircleHelp, Star, X } from 'lucide-react';
import { positionFit, type FitVerdict } from '@/backend/lib/candidates/position-fit';
import { FLOW_STAGES, SIDE_STAGES, STAGE_LABELS, STAGE_REMARK_REQUIRED, type CandidateRecord, type Position, type PositionMember, type Stage } from '@/backend/lib/candidates/types';
import { api } from './api';
import { formatDate } from './format';
import { OutreachBody, outreachKindFor } from './OutreachPanel';
import { BTN_DANGER_FILLED, REMARK_MAX } from './Remarks';
import { BTN_GHOST, BTN_PRIMARY, BTN_SECONDARY, CARD, INPUT, LABEL, Spinner, Tag, useUi, WELL } from './ui';

/*
 * The candidate's panel opened from the Pipeline tab (owner 2026-11-17). The panel knows the position it was opened
 * from: a strip at the top shows the stage there and moves it, with the quick actions a recruiter uses at each step
 * (schedule an interview, shortlist, reject, write a round's feedback, remove from the position), and arrows walk
 * through the people the panel was opened among. Every action is one click on a named button and lands in the
 * history, filed under the position.
 */

export interface PipelineContext {
    position: Position;
    member: PositionMember;
    /** 1-based place among the people the panel walks through, and how many there are. */
    index: number;
    total: number;
    /** "Screening", or "this position" from the table. */
    scopeLabel: string;
    onPrev: (() => void) | null;
    onNext: (() => void) | null;
    /** The stage changed (or a note was saved): the board refetches. */
    onMoved: () => void;
    /** The person left the position. */
    onRemoved: () => void;
}

const daysSince = (iso: string) => Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));

type Form = null | { kind: 'move'; stage: Stage } | { kind: 'interview' } | { kind: 'feedback' } | { kind: 'remove' } | { kind: 'told'; stage: Stage };

const MODES = [['in_person', 'In person'], ['video', 'Video call'], ['phone', 'Phone']] as const;
const RECOMMENDATIONS = [['move_ahead', 'Move ahead'], ['hold', 'Hold'], ['reject', 'Reject']] as const;

/** Tomorrow at 11:00, local, as a datetime-local input wants it. */
function tomorrowAt11(): string {
    const d = new Date(Date.now() + 86_400_000);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T11:00`;
}

/**
 * The strip at the top of the panel, and the one form it has open at a time. `onHistory`: an entry was written (the
 * Activity tab refetches).
 */
export function PipelineStrip({ orgId, record, ctx, onHistory }: { orgId: string; record: CandidateRecord; ctx: PipelineContext; onHistory: () => void }) {
    const { notify, reportError } = useUi();
    const { position, member } = ctx;
    const [form, setForm] = useState<Form>(null);
    const [busy, setBusy] = useState(false);
    const [remark, setRemark] = useState('');
    const open = (next: Form) => { setRemark(''); setForm(f => (f && next && f.kind === next.kind && (f.kind !== 'move' || (next.kind === 'move' && f.stage === next.stage)) ? null : next)); };
    const first = record.fullName.split(' ')[0];
    const days = daysSince(member.stageChangedAt);

    const moveTo = async (stage: Stage, why: string | null): Promise<boolean> => {
        const res = await api<{ member: PositionMember }>(`/api/candidates/positions/${encodeURIComponent(position.id)}/members/${encodeURIComponent(member.id)}`, { method: 'PATCH', json: { orgId, stage, ...(why ? { remark: why } : {}) } });
        if (!res.ok) { notify(res.error, 'error'); if (res.noAccess) reportError(res); return false; }
        return true;
    };
    const saveMove = async (stage: Stage) => {
        const why = remark.trim() || null;
        if (STAGE_REMARK_REQUIRED.includes(stage) && !why) return;
        setBusy(true);
        const ok = await moveTo(stage, why);
        setBusy(false);
        if (!ok) return;
        notify(`${record.fullName} → ${STAGE_LABELS[stage]}`, 'success');
        onHistory();
        ctx.onMoved();
        // Shortlisted or Rejected: offer to tell the candidate on WhatsApp, as a drop on the board does.
        setForm(outreachKindFor(stage) && !record.blacklisted ? { kind: 'told', stage } : null);
    };
    const remove = async () => {
        setBusy(true);
        const res = await api<{ ok: true }>(`/api/candidates/positions/${encodeURIComponent(position.id)}/members/${encodeURIComponent(member.id)}`, { method: 'DELETE', json: { orgId, ...(remark.trim() ? { remark: remark.trim() } : {}) } });
        setBusy(false);
        if (!res.ok) { notify(res.error, 'error'); if (res.noAccess) reportError(res); return; }
        notify(`${record.fullName} removed from ${position.title}`, 'success');
        setForm(null);
        onHistory();
        ctx.onRemoved();
    };

    const quick = (label: string, next: Form, extra = '') => (
        <button type="button" onClick={() => open(next)} aria-expanded={!!form && !!next && form.kind === next.kind && (form.kind !== 'move' || (next.kind === 'move' && form.stage === next.stage))}
            className={`${BTN_SECONDARY} h-8 rounded-lg px-2.5 text-xs ${extra}`}>{label}</button>
    );

    return (
        <section aria-label={`In ${position.title}`} className={`${CARD} px-4 py-3`}>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
                <span className="min-w-0 truncate text-sm font-semibold text-text-primary" title={position.title}>{position.title}{position.location ? <span className="font-normal text-text-secondary"> · {position.location}</span> : null}</span>
                <Tag tone={member.stage === 'rejected' ? 'warn' : member.stage === 'joined' ? 'success' : 'info'}>{STAGE_LABELS[member.stage]}</Tag>
                <span className="text-xs text-text-secondary" title={`Since ${formatDate(member.stageChangedAt)}`}>{days} {days === 1 ? 'day' : 'days'} in this stage{member.stageChangedByName ? ` · moved by ${member.stageChangedByName}` : ''}</span>
                <span className="ml-auto flex items-center gap-x-1">
                    <button type="button" onClick={() => ctx.onPrev?.()} disabled={!ctx.onPrev} aria-label="Previous candidate" title="Previous candidate" className={`${BTN_GHOST} h-8 px-1.5`}><ChevronLeft className="h-4 w-4" /></button>
                    <span className="text-xs tabular-nums text-text-secondary" aria-live="polite">{ctx.index} of {ctx.total} in {ctx.scopeLabel}</span>
                    <button type="button" onClick={() => ctx.onNext?.()} disabled={!ctx.onNext} aria-label="Next candidate" title="Next candidate" className={`${BTN_GHOST} h-8 px-1.5`}><ChevronRight className="h-4 w-4" /></button>
                </span>
            </div>
            {member.remark && <p className="mt-1 text-xs italic text-text-secondary">“{member.remark}”</p>}

            <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                <label htmlFor="pipe-move" className="sr-only">Move to stage</label>
                <select id="pipe-move" value="" disabled={busy} onChange={e => { if (e.target.value) open({ kind: 'move', stage: e.target.value as Stage }); }}
                    className="h-8 cursor-pointer rounded-lg border border-border bg-surface px-2 text-xs font-semibold text-text-primary outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:opacity-60">
                    <option value="">Move to…</option>
                    <optgroup label="Flow">{FLOW_STAGES.filter(s => s !== member.stage).map(s => <option key={s} value={s}>{STAGE_LABELS[s]}</option>)}</optgroup>
                    <optgroup label="Out of the flow">{SIDE_STAGES.filter(s => s !== member.stage).map(s => <option key={s} value={s}>{STAGE_LABELS[s]}</option>)}</optgroup>
                </select>
                {quick('Schedule interview', { kind: 'interview' })}
                {member.stage !== 'shortlisted' && quick('Shortlist', { kind: 'move', stage: 'shortlisted' })}
                {member.stage !== 'rejected' && quick('Reject', { kind: 'move', stage: 'rejected' })}
                {quick('Add feedback', { kind: 'feedback' })}
                <button type="button" onClick={() => open({ kind: 'remove' })} aria-expanded={form?.kind === 'remove'} className="ml-auto inline-flex h-8 items-center rounded-lg px-2.5 text-xs font-semibold text-error hover:bg-error/[.08]">Remove from position</button>
            </div>

            {form?.kind === 'move' && (
                <div className={`${WELL} mt-3 px-3 py-3`}>
                    <p className="text-sm font-semibold text-text-primary">Move {first} to {STAGE_LABELS[form.stage]}</p>
                    <label htmlFor="pipe-move-remark" className="mt-2 block text-xs font-medium text-text-secondary">Remark {STAGE_REMARK_REQUIRED.includes(form.stage) ? <span className="text-error">*</span> : '(optional)'}</label>
                    <input id="pipe-move-remark" value={remark} onChange={e => setRemark(e.target.value)} maxLength={REMARK_MAX} autoFocus
                        placeholder={form.stage === 'rejected' ? 'Why, in one line (kept in the history, not sent)' : 'Why, if it helps the next person'} className={`${INPUT} mt-1`}
                        onKeyDown={e => { if (e.key === 'Enter') void saveMove(form.stage); }} />
                    <div className="mt-2.5 flex justify-end gap-x-2">
                        <button type="button" onClick={() => setForm(null)} disabled={busy} className={BTN_GHOST}>Cancel</button>
                        <button type="button" onClick={() => void saveMove(form.stage)} disabled={busy || (STAGE_REMARK_REQUIRED.includes(form.stage) && !remark.trim())} className={form.stage === 'rejected' ? BTN_DANGER_FILLED : BTN_PRIMARY}>{busy && <Spinner />}Move to {STAGE_LABELS[form.stage]}</button>
                    </div>
                </div>
            )}

            {form?.kind === 'told' && outreachKindFor(form.stage) && (
                <div className={`${WELL} @container mt-3 px-3 py-3`}>
                    <p className="mb-2 text-sm font-semibold text-text-primary">{first} is now {STAGE_LABELS[form.stage]}. Tell {first} on WhatsApp?</p>
                    <OutreachBody orgId={orgId} record={record} positionId={position.id} kind={outreachKindFor(form.stage)!}
                        onSent={() => { setForm(null); onHistory(); ctx.onMoved(); }} onSkip={() => setForm(null)} />
                </div>
            )}

            {form?.kind === 'interview' && (
                <InterviewForm orgId={orgId} record={record} position={position} member={member} onCancel={() => setForm(null)}
                    onSaved={moved => { setForm(null); onHistory(); ctx.onMoved(); notify(moved ? `Interview scheduled; ${first} moved to Interview` : 'Interview scheduled', 'success'); }} />
            )}

            {form?.kind === 'feedback' && (
                <FeedbackForm orgId={orgId} record={record} position={position} onCancel={() => setForm(null)}
                    onSaved={() => { setForm(null); onHistory(); notify('Feedback saved', 'success'); }} />
            )}

            {form?.kind === 'remove' && (
                <div className={`${WELL} mt-3 px-3 py-3 ring-1 ring-inset ring-error/30`}>
                    <p className="text-sm font-semibold text-text-primary">Remove {first} from {position.title}?</p>
                    <p className="mt-0.5 text-xs text-text-secondary">The record stays in the database and in searches; the history keeps that {first} was here.</p>
                    <input value={remark} onChange={e => setRemark(e.target.value)} maxLength={REMARK_MAX} placeholder="Why (optional)" aria-label="Why (optional)" className={`${INPUT} mt-2`} />
                    <div className="mt-2.5 flex justify-end gap-x-2">
                        <button type="button" onClick={() => setForm(null)} disabled={busy} className={BTN_GHOST}>Keep</button>
                        <button type="button" onClick={() => void remove()} disabled={busy} className={BTN_DANGER_FILLED}>{busy && <Spinner />}Remove</button>
                    </div>
                </div>
            )}
        </section>
    );
}

/** Schedule an interview: when, how, with whom. Optionally moves the person to Interview first. */
function InterviewForm({ orgId, record, position, member, onCancel, onSaved }: {
    orgId: string; record: CandidateRecord; position: Position; member: PositionMember; onCancel: () => void; onSaved: (moved: boolean) => void;
}) {
    const { notify, reportError } = useUi();
    const [at, setAt] = useState(tomorrowAt11);
    const [mode, setMode] = useState<(typeof MODES)[number][0]>('in_person');
    const [interviewer, setInterviewer] = useState('');
    const [note, setNote] = useState('');
    const canMove = member.stage !== 'interview';
    const at0 = FLOW_STAGES.indexOf(member.stage as (typeof FLOW_STAGES)[number]);
    // Ticked when the person is still before Interview in the flow; out of the flow, HR decides.
    const [alsoMove, setAlsoMove] = useState(canMove && at0 >= 0 && at0 < FLOW_STAGES.indexOf('interview'));
    const [busy, setBusy] = useState(false);
    const save = async () => {
        if (!at) return;
        setBusy(true);
        let moved = false;
        if (canMove && alsoMove) {
            const res = await api<{ member: PositionMember }>(`/api/candidates/positions/${encodeURIComponent(position.id)}/members/${encodeURIComponent(member.id)}`, { method: 'PATCH', json: { orgId, stage: 'interview' } });
            if (!res.ok) { setBusy(false); notify(res.error, 'error'); if (res.noAccess) reportError(res); return; }
            moved = true;
        }
        const res = await api<{ actions: unknown[] }>(`/api/candidates/${encodeURIComponent(record.id)}/actions`, {
            json: { orgId, note: { kind: 'interview', positionId: position.id, at, mode, ...(interviewer.trim() ? { interviewer: interviewer.trim() } : {}), ...(note.trim() ? { note: note.trim() } : {}) } },
        });
        setBusy(false);
        if (!res.ok) { notify(res.error, 'error'); if (res.noAccess) reportError(res); if (moved) onSaved(true); return; }
        onSaved(moved);
    };
    return (
        <div className={`${WELL} mt-3 px-3 py-3`}>
            <p className="flex items-center gap-x-2 text-sm font-semibold text-text-primary"><CalendarClock className="h-4 w-4 text-text-tertiary" aria-hidden />Schedule an interview</p>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <label className="block text-xs font-medium text-text-secondary">When
                    <input type="datetime-local" value={at} onChange={e => setAt(e.target.value)} className={`${INPUT} mt-1`} />
                </label>
                <label className="block text-xs font-medium text-text-secondary">How
                    <select value={mode} onChange={e => setMode(e.target.value as typeof mode)} className={`${INPUT} mt-1`}>{MODES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select>
                </label>
                <label className="block text-xs font-medium text-text-secondary sm:col-span-2">With (optional)
                    <input value={interviewer} onChange={e => setInterviewer(e.target.value)} maxLength={120} placeholder="e.g. Rahul (Facility Manager)" className={`${INPUT} mt-1`} />
                </label>
                <label className="block text-xs font-medium text-text-secondary sm:col-span-2">Note (optional)
                    <input value={note} onChange={e => setNote(e.target.value)} maxLength={REMARK_MAX} placeholder="Venue, round, what to bring" className={`${INPUT} mt-1`} />
                </label>
            </div>
            {canMove && (
                <label className="mt-2 flex items-center gap-x-2 text-xs text-text-primary">
                    <input type="checkbox" checked={alsoMove} onChange={e => setAlsoMove(e.target.checked)} className="h-4 w-4 accent-primary" />
                    Also move to Interview (now {STAGE_LABELS[member.stage]})
                </label>
            )}
            <p className="mt-1.5 text-xs text-text-tertiary">Saved in the history under this position. Nothing is sent to the candidate.</p>
            <div className="mt-2.5 flex justify-end gap-x-2">
                <button type="button" onClick={onCancel} disabled={busy} className={BTN_GHOST}>Cancel</button>
                <button type="button" onClick={() => void save()} disabled={busy || !at} className={BTN_PRIMARY}>{busy && <Spinner />}Save interview</button>
            </div>
        </div>
    );
}

/** One round's feedback: the round, a 1–5 rating, a recommendation and the notes. */
function FeedbackForm({ orgId, record, position, onCancel, onSaved }: { orgId: string; record: CandidateRecord; position: Position; onCancel: () => void; onSaved: () => void }) {
    const { notify, reportError } = useUi();
    const [round, setRound] = useState('Round 1');
    const [rating, setRating] = useState(0);
    const [recommendation, setRecommendation] = useState<(typeof RECOMMENDATIONS)[number][0] | null>(null);
    const [note, setNote] = useState('');
    const [busy, setBusy] = useState(false);
    const ready = round.trim() && rating > 0 && recommendation && note.trim();
    const save = async () => {
        if (!ready) return;
        setBusy(true);
        const res = await api<{ actions: unknown[] }>(`/api/candidates/${encodeURIComponent(record.id)}/actions`, {
            json: { orgId, note: { kind: 'feedback', positionId: position.id, round: round.trim(), rating, recommendation, note: note.trim() } },
        });
        setBusy(false);
        if (!res.ok) { notify(res.error, 'error'); if (res.noAccess) reportError(res); return; }
        onSaved();
    };
    return (
        <div className={`${WELL} mt-3 px-3 py-3`}>
            <p className="text-sm font-semibold text-text-primary">Interview feedback</p>
            <div className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                <label className="block text-xs font-medium text-text-secondary">Round
                    <input value={round} onChange={e => setRound(e.target.value)} maxLength={60} placeholder="Round 1 · HR" className={`${INPUT} mt-1`} />
                </label>
                <div className="text-xs font-medium text-text-secondary">
                    <span id="pipe-fb-rating">Rating</span>
                    <div role="radiogroup" aria-labelledby="pipe-fb-rating" className="mt-1 flex h-11 items-center gap-x-0.5">
                        {[1, 2, 3, 4, 5].map(n => (
                            <button key={n} type="button" role="radio" aria-checked={rating === n} aria-label={`${n} of 5`} onClick={() => setRating(n)} className="rounded-md p-1 hover:bg-surface-elevated">
                                <Star className={`h-5 w-5 ${n <= rating ? 'fill-amber-400 text-amber-500' : 'text-text-tertiary'}`} />
                            </button>
                        ))}
                    </div>
                </div>
            </div>
            <div role="radiogroup" aria-label="Recommendation" className="mt-2 flex flex-wrap gap-1.5">
                {RECOMMENDATIONS.map(([id, label]) => (
                    <button key={id} type="button" role="radio" aria-checked={recommendation === id} onClick={() => setRecommendation(id)}
                        className={`${BTN_SECONDARY} h-8 rounded-lg px-3 text-xs ${recommendation === id ? (id === 'reject' ? 'ring-[1.5px] ring-inset ring-error' : 'ring-[1.5px] ring-inset ring-primary') : ''}`}>{label}</button>
                ))}
            </div>
            <label htmlFor="pipe-fb-note" className="mt-2 block text-xs font-medium text-text-secondary">Feedback <span className="text-error">*</span></label>
            <textarea id="pipe-fb-note" rows={3} value={note} onChange={e => setNote(e.target.value)} maxLength={REMARK_MAX} placeholder="Strengths, gaps, what the next round should check"
                className={`${INPUT} mt-1 h-auto min-h-[72px] resize-y py-2 leading-relaxed`} />
            <p className="mt-1.5 text-xs text-text-tertiary">Saved in the history under this position. The stage does not change by itself.</p>
            <div className="mt-2.5 flex justify-end gap-x-2">
                <button type="button" onClick={onCancel} disabled={busy} className={BTN_GHOST}>Cancel</button>
                <button type="button" onClick={() => void save()} disabled={busy || !ready} className={BTN_PRIMARY}>{busy && <Spinner />}Save feedback</button>
            </div>
        </div>
    );
}

const VERDICT_ICON: Record<FitVerdict, React.ReactNode> = {
    meets: <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-success/15 text-emerald-800"><Check className="h-3 w-3" /></span>,
    off: <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-warning/15 text-amber-800"><X className="h-3 w-3" /></span>,
    unknown: <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-surface-elevated text-text-tertiary"><CircleHelp className="h-3 w-3" /></span>,
};
const VERDICT_WORD: Record<FitVerdict, string> = { meets: 'Meets', off: 'Outside', unknown: 'Not known' };

/** How the person compares with the position: experience, notice, expected pay, location; must-haves to check. */
export function PositionFitCard({ record, position }: { record: CandidateRecord; position: Position }) {
    const fit = positionFit(record, position);
    return (
        <section className={`${CARD} px-4 py-3`} aria-label={`Fit for ${position.title}`}>
            <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                <p className={LABEL}>Fit for {position.title}</p>
                {fit.checks.length > 0 && <span className="text-xs text-text-secondary">{fit.met} of {fit.checks.length} met{fit.known < fit.checks.length ? ` · ${fit.checks.length - fit.known} not known` : ''}</span>}
            </div>
            {fit.checks.length === 0 ? (
                <p className="mt-1.5 text-sm text-text-tertiary">This position has no experience, notice, budget or location set. Edit the position to compare.</p>
            ) : (
                <ul className="mt-2 space-y-1.5">
                    {fit.checks.map(c => (
                        <li key={c.key} className="flex items-start gap-x-2 text-sm">
                            <span className="mt-0.5">{VERDICT_ICON[c.verdict]}</span>
                            <span className="sr-only">{VERDICT_WORD[c.verdict]}: </span>
                            <span className="min-w-0"><span className="font-semibold text-text-primary">{c.label}</span> <span className="text-text-secondary">{c.detail}</span></span>
                        </li>
                    ))}
                </ul>
            )}
            {(fit.mustHaves.length > 0 || fit.education) && (
                <p className="mt-2 text-xs text-text-secondary">
                    Check in the resume: {[...fit.mustHaves, ...(fit.education ? [`education: ${fit.education}`] : [])].join(' · ')}
                </p>
            )}
        </section>
    );
}
