'use client';

import React, { useState } from 'react';
import { Check, CircleHelp, Star, X } from 'lucide-react';
import { positionFit, type FitVerdict } from '@/backend/lib/candidates/position-fit';
import { boardColumns, findStage, nextRoundStage, reasonNeeded, rejectStageFor, stageGroups, unlistedStage, withReason, type StageDef } from '@/backend/lib/candidates/stage-list';
import type { CandidateRecord, Position, PositionMember, Stage } from '@/backend/lib/candidates/types';
import { api } from './api';
import { formatDate } from './format';
import { ScheduleInterviewForm } from './InterviewScheduler';
import { OutreachBody } from './OutreachPanel';
import { BTN_DANGER_FILLED, REMARK_MAX } from './Remarks';
import { StageChip, StageOptions, useRejectionReasons, useStages } from './stage-ui';
import { BTN_GHOST, BTN_PRIMARY, BTN_SECONDARY, CARD, INPUT, LABEL, Spinner, useUi, WELL } from './ui';

/*
 * The candidate's panel opened from the Pipeline tab (owner 2026-11-17). The panel knows the position it was opened
 * from: a strip at the top shows the stage there and moves it, with the quick actions a recruiter uses at each step
 * (schedule an interview, shortlist, reject, write a round's feedback, remove from the position), and arrows walk
 * through the people the panel was opened among. Every action is one click on a named button and lands in the
 * history, filed under the position.
 * Owner 2026-11-19: the stages are HR's list (Configurations); the quick buttons are "Next round" (the next column's
 * first status) and "Reject" (this round's rejected status).
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

const RECOMMENDATIONS = [['move_ahead', 'Move ahead'], ['hold', 'Hold'], ['reject', 'Reject']] as const;

/**
 * The strip at the top of the panel, and the one form it has open at a time. `onHistory`: an entry was written (the
 * Activity tab refetches). The panel itself shows `ctx`'s previous / next and `member.score` (owner 2026-11-25).
 */
export function PipelineStrip({ orgId, record, ctx, onHistory, tab }: {
    orgId: string; record: CandidateRecord; ctx: PipelineContext; onHistory: () => void;
    /** The panel's tab: switching to another closes the open form (owner 2026-11-20). */
    tab?: string;
}) {
    const { notify, reportError } = useUi();
    const { position, member } = ctx;
    const stageList = useStages(orgId);
    const stages = stageList?.stages ?? [];
    const rejectionReasons = useRejectionReasons(orgId);
    const [reason, setReason] = useState('');
    const here: StageDef = findStage(stages, member.stage) ?? unlistedStage(member.stage);
    const stageOf = (key: Stage): StageDef => findStage(stages, key) ?? unlistedStage(key);
    const next = nextRoundStage(stages, member.stage);
    const reject = rejectStageFor(stages, member.stage);
    const [form, setForm] = useState<Form>(null);
    // Owner 2026-11-20: "when i clicked on some other tab, the add feedback form did not close"
    const [seenTab, setSeenTab] = useState(tab);
    if (tab !== seenTab) { setSeenTab(tab); setForm(null); }
    const [busy, setBusy] = useState(false);
    const [remark, setRemark] = useState('');
    const open = (next: Form) => { setRemark(''); setReason(''); setForm(f => (f && next && f.kind === next.kind && (f.kind !== 'move' || (next.kind === 'move' && f.stage === next.stage)) ? null : next)); };
    const first = record.fullName.split(' ')[0];
    const days = daysSince(member.stageChangedAt);

    const moveTo = async (stage: Stage, why: string | null): Promise<boolean> => {
        const res = await api<{ member: PositionMember }>(`/api/candidates/positions/${encodeURIComponent(position.id)}/members/${encodeURIComponent(member.id)}`, { method: 'PATCH', json: { orgId, stage, ...(why ? { remark: why } : {}) } });
        if (!res.ok) { notify(res.error, 'error'); if (res.noAccess) reportError(res); return false; }
        return true;
    };
    const saveMove = async (stage: Stage) => {
        const target = stageOf(stage);
        // Owner 2026-11-21 (spec): a rejection takes a reason from HR's list; a move back a round needs a remark.
        const need = reasonNeeded(stages, member.stage, stage);
        if (need === 'reject' && !reason) return;
        const why = need === 'reject' ? withReason(reason, remark) : remark.trim() || null;
        if ((target.needsRemark || need === 'back') && !why) return;
        setBusy(true);
        const ok = await moveTo(stage, why);
        setBusy(false);
        if (!ok) return;
        notify(`${record.fullName} → ${target.name}`, 'success');
        onHistory();
        ctx.onMoved();
        // A stage marked for WhatsApp: offer to tell the candidate, as a drop on the board does.
        setForm(target.whatsapp && !record.blacklisted && stageList?.source !== 'legacy' ? { kind: 'told', stage } : null);
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
        // Owner 2026-11-25 (reference layout): the strip is the "Hiring process" card: where the person is, the stepper of
        // the board's columns, and "Move stage" at the top right. Previous / next sit at the top of the panel, and the
        // ratings in the panel's "Candidate score" card.
        <section aria-labelledby="pipe-hiring-title" className={`${CARD} px-4 py-4`}>
            <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
                <div className="min-w-0 flex-1">
                    <h3 id="pipe-hiring-title" className="text-sm font-semibold text-text-primary">Hiring process</h3>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-text-secondary">
                        <span className="min-w-0 truncate font-semibold text-text-primary" title={position.title}>{position.title}{position.location ? <span className="font-normal text-text-secondary"> · {position.location}</span> : null}</span>
                        <StageChip stage={here} />
                        <span title={`Since ${formatDate(member.stageChangedAt)}`}>{days} {days === 1 ? 'day' : 'days'} in this stage{member.stageChangedByName ? ` · moved by ${member.stageChangedByName}` : ''}</span>
                    </p>
                </div>
                <label htmlFor="pipe-move" className="sr-only">Move stage</label>
                <select id="pipe-move" value="" disabled={busy} onChange={e => { if (e.target.value) open({ kind: 'move', stage: e.target.value as Stage }); }}
                    className="h-9 shrink-0 cursor-pointer rounded-xl border border-primary bg-surface px-3 text-[13px] font-bold text-text-primary outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-60">
                    <option value="">Move stage…</option>
                    <StageOptions groups={stageGroups(stages).map(g => ({ ...g, stages: g.stages.filter(x => x.key !== member.stage) })).filter(g => g.stages.length)} />
                </select>
            </div>
            {member.remark && <p className="mt-1.5 text-xs italic text-text-secondary">“{member.remark}”</p>}

            {/* Owner 2026-11-25: where the person is in the hiring process (the board's columns), filled up to here. */}
            {(() => {
                const cols = boardColumns(stages, x => x.key === member.stage);
                const at = cols.findIndex(c => c.stages.some(x => x.key === member.stage));
                const rejected = here.kind === 'rejected';
                return cols.length > 1 && at >= 0 ? (
                    <ol aria-label="Hiring process stages" className="mt-3.5 flex gap-x-1.5">
                        {cols.map((c, i) => (
                            <li key={c.name} aria-current={i === at ? 'step' : undefined} className="min-w-0 flex-1">
                                <span aria-hidden className={`block h-2 rounded-full ${i < at ? 'bg-primary' : i === at ? (rejected ? 'bg-error' : 'bg-primary') : 'bg-muted'}`} />
                                <span className={`mt-1.5 block truncate text-xs ${i === at ? 'font-semibold text-text-primary' : i < at ? 'text-text-secondary' : 'text-text-tertiary'}`} title={c.name}>{c.name}{i === at && rejected ? ' (rejected)' : ''}</span>
                            </li>
                        ))}
                    </ol>
                ) : null;
            })()}

            <div className="mt-3.5 flex flex-wrap items-center gap-1.5 border-t border-border-subtle pt-3">
                {quick('Schedule interview', { kind: 'interview' })}
                {next && quick(`Next: ${next.name}`, { kind: 'move', stage: next.key })}
                {reject && reject.key !== member.stage && quick(`Reject${reject.name.toLowerCase() === 'rejected' ? '' : ` (${reject.name})`}`, { kind: 'move', stage: reject.key })}
                {quick('Add feedback', { kind: 'feedback' })}
                <button type="button" onClick={() => open({ kind: 'remove' })} aria-expanded={form?.kind === 'remove'} className="ml-auto inline-flex h-8 items-center rounded-lg px-2.5 text-xs font-semibold text-error hover:bg-error/[.08]">Remove from position</button>
            </div>

            {form?.kind === 'move' && (
                <div className={`${WELL} mt-3 px-3 py-3`}>
                    <p className="text-sm font-semibold text-text-primary">Move {first} to {stageOf(form.stage).name}</p>
                    {reasonNeeded(stages, member.stage, form.stage) === 'reject' && (
                        <>
                            <label htmlFor="pipe-move-reason" className="mt-2 block text-xs font-medium text-text-secondary">Reason <span className="text-error">*</span></label>
                            <select id="pipe-move-reason" value={reason} onChange={e => setReason(e.target.value)} className={`${INPUT} mt-1`}>
                                <option value="">Pick a reason…</option>
                                {rejectionReasons.map(r => <option key={r} value={r}>{r}</option>)}
                            </select>
                        </>
                    )}
                    <label htmlFor="pipe-move-remark" className="mt-2 block text-xs font-medium text-text-secondary">{reasonNeeded(stages, member.stage, form.stage) === 'reject' ? 'Note' : 'Remark'} {stageOf(form.stage).needsRemark || reasonNeeded(stages, member.stage, form.stage) === 'back' ? <span className="text-error">*</span> : '(optional)'}</label>
                    <input id="pipe-move-remark" value={remark} onChange={e => setRemark(e.target.value)} maxLength={REMARK_MAX} autoFocus
                        placeholder={stageOf(form.stage).kind === 'rejected' ? 'Why, in one line (kept in the history, not sent)' : 'Why, if it helps the next person'} className={`${INPUT} mt-1`}
                        onKeyDown={e => { if (e.key === 'Enter') void saveMove(form.stage); }} />
                    <div className="mt-2.5 flex justify-end gap-x-2">
                        <button type="button" onClick={() => setForm(null)} disabled={busy} className={BTN_GHOST}>Cancel</button>
                        <button type="button" onClick={() => void saveMove(form.stage)} disabled={busy || ((stageOf(form.stage).needsRemark || reasonNeeded(stages, member.stage, form.stage) === 'back') && !remark.trim()) || (reasonNeeded(stages, member.stage, form.stage) === 'reject' && !reason)} className={stageOf(form.stage).kind === 'rejected' ? BTN_DANGER_FILLED : BTN_PRIMARY}>{busy && <Spinner />}Move to {stageOf(form.stage).name}</button>
                    </div>
                </div>
            )}

            {form?.kind === 'told' && (
                <div className={`${WELL} @container mt-3 px-3 py-3`}>
                    <p className="mb-2 text-sm font-semibold text-text-primary">{first} is now {stageOf(form.stage).name}. Tell {first} on WhatsApp?</p>
                    <OutreachBody orgId={orgId} record={record} positionId={position.id}
                        onSent={() => { setForm(null); onHistory(); ctx.onMoved(); }} onSkip={() => setForm(null)} />
                </div>
            )}

            {form?.kind === 'interview' && (
                <ScheduleInterviewForm orgId={orgId} record={record} position={position} member={member} stages={stages} onCancel={() => setForm(null)}
                    onSaved={moved => { onHistory(); ctx.onMoved(); notify(moved ? `Interview scheduled; ${first} moved to ${moved}` : 'Interview scheduled', 'success'); }} />
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
    meets: <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-success/15 text-green-800"><Check className="h-3 w-3" /></span>,
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
