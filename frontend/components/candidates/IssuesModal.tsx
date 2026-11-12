'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Check, CircleAlert, CircleCheck, CircleSlash, Sparkles, Trash2, Wand2, X } from 'lucide-react';
import {
    AI_FIX_FIELD_LABELS,
    type AiFixApproval, type AiFixChange, type AiFixField, type CandidateSheet, type SheetIssueRow,
} from '@/backend/lib/candidates/types';
import Skeleton from '@/frontend/components/ui/Skeleton';
import { api, qs } from './api';
import { BTN_DANGER } from './DangerDialogs';
import { formatCount, formatInrFull, formatMonths, formatNotice } from './format';
import {
    askAi, deleteRows, dismissSuggestions, JOB_LABELS, jobKey, jobTarget, onJobEvent, saveRows, stopJob, toggleField, useRunningJobs, useSheetJobs,
    type Suggestion,
} from './issue-jobs';
import { issueKind, issueKinds } from './issue-kind';
import { BTN_DANGER_GHOST, BTN_GHOST, BTN_PRIMARY, BTN_SECONDARY, Dialog, EmptyState, FIELD, LABEL, NUM_SM, Spinner, useUi, WELL } from './ui';

type Loaded = { key: number; rows: SheetIssueRow[] | null; error: string };
type Tab = 'review' | 'fixed' | 'skipped';
/** Which rows of "Needs review" are shown, by what the AI said about them. */
type AiFilter = 'all' | 'fix' | 'nofix' | 'none';
/** What HR chose in the box; it belongs to one opening of it (`key`) and starts again on the next. */
type View = { key: number; tab: Tab | null; kind: string; ai: AiFilter; ticked: number[] };

const AI_FILTER_LABELS: Record<AiFilter, string> = { all: 'All', fix: 'AI has a fix', nofix: 'AI could not fix', none: 'Not asked yet' };

function formatValue(field: AiFixField, value: string | number | null): string {
    if (value === null || value === '') return '—';
    if (typeof value === 'number') {
        if (field === 'totalExpMonths' || field === 'relevantExpMonths') return formatMonths(value);
        if (field === 'noticePeriodDays') return formatNotice(value);
        if (field === 'currentInhand' || field === 'expectedInhand') return `${formatInrFull(value)}/mo`;
    }
    return String(value);
}

function RawValues({ raw }: { raw: Record<string, string> }) {
    return (
        <details className="group mt-2">
            <summary className="cursor-pointer select-none text-xs font-semibold text-text-secondary hover:text-text-primary">Values in the sheet</summary>
            <dl className="mt-2 grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-3 gap-y-0.5 rounded-lg bg-surface-elevated px-3 py-3 text-xs">
                {Object.entries(raw).map(([k, v]) => (
                    <React.Fragment key={k}>
                        <dt className="truncate text-text-tertiary" title={k}>{k}</dt>
                        <dd className="break-words text-text-primary">{v || <span className="text-text-tertiary">(empty)</span>}</dd>
                    </React.Fragment>
                ))}
            </dl>
        </details>
    );
}

function Bullets({ items, tone }: { items: string[]; tone: 'warning' | 'success' | 'muted' }) {
    const dot = { warning: 'bg-warning', success: 'bg-success', muted: 'bg-text-tertiary' }[tone];
    return (
        <ul className="space-y-1">
            {items.map((x, i) => (
                <li key={i} className="flex gap-1.5 text-sm text-text-primary">
                    <span className={`mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} aria-hidden />{x}
                </li>
            ))}
        </ul>
    );
}

/**
 * Shows the result of a "View issues" job wherever HR is by then, refreshes the lists it changed, and asks before the
 * browser tab is left while one is running (owner 2026-11-12: the work goes on after the box is closed). Mounted once
 * for the whole Candidate Search tab.
 */
export function IssueJobsWatcher({ onChanged }: { onChanged: () => void }) {
    const { notify } = useUi();
    const running = useRunningJobs();
    useEffect(() => onJobEvent(event => { notify(event.message, event.tone); if (event.changed) onChanged(); }), [notify, onChanged]);
    useEffect(() => {
        if (!running) return;
        const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
        window.addEventListener('beforeunload', warn);
        return () => window.removeEventListener('beforeunload', warn);
    }, [running]);
    return null;
}

/** Beside a sheet on the Sheets page: the job running on its flagged rows, if any. */
export function IssueJobChip({ sheet }: { sheet: CandidateSheet }) {
    const { job } = useSheetJobs(jobKey(sheet));
    if (!job) return null;
    return (
        <span className="inline-flex items-center gap-x-1.5 whitespace-nowrap text-xs font-semibold text-text-secondary" title="This goes on while the browser tab stays open. Open View issues to see it or stop it.">
            <Spinner className="h-3 w-3" />{JOB_LABELS[job.kind]}
            <span className="tabular-nums">{formatCount(job.done)}/{formatCount(job.total)}</span>
        </span>
    );
}

/**
 * "View issues": a sheet's rows from its latest upload, in three groups: needs review (with the AI fix), fixed
 * automatically on import, and skipped. AI suggestions are only saved when HR approves them (owner 2026-11-03).
 *
 * Owner 2026-11-12: many rows at once. Rows can be ticked (or all shown rows at once) and then fixed with AI, applied,
 * marked reviewed or deleted together; the list can be narrowed to one kind of issue or to what the AI said; and the
 * rows the AI could not fix can be deleted in one step ("mass discard means deleting those rows which the AI could not
 * fix": their records move to Deleted, restorable from the Candidates tab). The work itself lives in issue-jobs.ts, so
 * it goes on when this box is closed.
 */
export default function IssuesModal({
    orgId, request, open, onClose,
}: {
    orgId: string;
    /** Kept after close so the content stays put during the exit animation; a new `key` refetches. */
    request: { sheet: CandidateSheet; key: number } | null;
    open: boolean;
    onClose: () => void;
}) {
    const { reportError } = useUi();
    const [loaded, setLoaded] = useState<Loaded | null>(null);
    const [viewState, setViewState] = useState<View>({ key: -1, tab: null, kind: '', ai: 'all', ticked: [] });
    /** Row numbers waiting for "yes, delete them". */
    const [confirm, setConfirm] = useState<number[] | null>(null);

    const sheet = request?.sheet ?? null;
    const reqKey = request?.key ?? -1;
    const target = useMemo(() => (sheet ? jobTarget(orgId, sheet) : null), [orgId, sheet]);
    const jobs = useSheetJobs(target?.key ?? null);

    // The rows, again each time a job changed some on the server.
    useEffect(() => {
        if (!request) return;
        const { sheet: wanted, key } = request;
        const ctrl = new AbortController();
        void api<{ rows: SheetIssueRow[] }>(`/api/candidates/sheets/${encodeURIComponent(wanted.id)}/issues${qs({ orgId })}`, { signal: ctrl.signal })
            .then(res => {
                if (ctrl.signal.aborted) return;
                if (!res.ok) { if (res.noAccess) reportError(res); setLoaded({ key, rows: null, error: res.error }); return; }
                setLoaded({ key, rows: res.data.rows, error: '' });
            });
        return () => ctrl.abort();
    }, [orgId, request, reportError, jobs.version]);

    const current = request && loaded?.key === request.key ? loaded : null;
    const rows = useMemo(() => current?.rows ?? [], [current]);
    const review = useMemo(() => rows.filter(r => !r.skipped && r.issues.length > 0), [rows]);
    const fixed = rows.filter(r => !r.skipped && r.issues.length === 0 && r.fixed.length > 0);
    const skipped = rows.filter(r => r.skipped);

    const view: View = viewState.key === reqKey ? viewState : { key: reqKey, tab: null, kind: '', ai: 'all', ticked: [] };
    const setView = (patch: Partial<View>) => setViewState({ ...view, ...patch });
    const tab: Tab = view.tab ?? (review.length ? 'review' : fixed.length ? 'fixed' : skipped.length ? 'skipped' : 'review');

    const { byRow, job } = jobs;
    const busy = job !== null;
    const inJob = useMemo(() => new Set(job?.rows ?? []), [job]);
    const noAnswer = useMemo(() => new Set(jobs.noAnswer), [jobs.noAnswer]);
    const aiState = (row: SheetIssueRow): Exclude<AiFilter, 'all'> => {
        const s = byRow[row.rowNumber];
        return !s ? 'none' : s.proposal.changes.length ? 'fix' : 'nofix';
    };

    // What is shown, and what is ticked among it.
    const kinds = useMemo(() => issueKinds(review), [review]);
    const kind = kinds.some(([k]) => k === view.kind) ? view.kind : '';
    const ofKind = kind ? review.filter(r => r.issues.some(issue => issueKind(issue) === kind)) : review;
    const aiCounts: Record<AiFilter, number> = { all: ofKind.length, fix: 0, nofix: 0, none: 0 };
    for (const r of ofKind) aiCounts[aiState(r)] += 1;
    const shown = view.ai === 'all' ? ofKind : ofKind.filter(r => aiState(r) === view.ai);
    const tickedSet = new Set(view.ticked);
    const picked = shown.filter(r => tickedSet.has(r.rowNumber));
    const allTicked = shown.length > 0 && picked.length === shown.length;

    const changesOf = (s: Suggestion): AiFixApproval['changes'] =>
        Object.fromEntries(s.proposal.changes.filter(c => s.selected.includes(c.field)).map(c => [c.field, c.proposed]));
    const askable = (list: SheetIssueRow[]) => list.filter(r => !byRow[r.rowNumber] && r.applicationId && !noAnswer.has(r.rowNumber)).map(r => r.rowNumber);
    const fixable = (list: SheetIssueRow[]) => list.filter(r => (byRow[r.rowNumber]?.selected.length ?? 0) > 0);
    const noFix = review.filter(r => aiState(r) === 'nofix');

    const ask = (rowNumbers: number[]) => { if (target) void askAi(target, rowNumbers); };
    const apply = (list: SheetIssueRow[]) => {
        if (!target) return;
        void saveRows(target, fixable(list).map(r => ({ rowNumber: r.rowNumber, changes: changesOf(byRow[r.rowNumber]) })), 'apply');
        setView({ ticked: [] });
    };
    const markReviewed = (list: SheetIssueRow[]) => {
        if (!target) return;
        void saveRows(target, list.map(r => ({ rowNumber: r.rowNumber, changes: {} })), 'review');
        setView({ ticked: [] });
    };
    const doDelete = () => {
        if (!target || !confirm) return;
        void deleteRows(target, confirm);
        setConfirm(null);
        setView({ ticked: [] });
    };
    const toggleRow = (rowNumber: number) => setView({ ticked: tickedSet.has(rowNumber) ? view.ticked.filter(n => n !== rowNumber) : [...view.ticked, rowNumber] });

    const tabButton = (value: Tab, label: string, count: number) => (
        <button
            type="button" role="tab" aria-selected={tab === value}
            onClick={() => setView({ tab: value })}
            className={`inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold transition-colors ${tab === value ? 'bg-surface text-text-primary shadow-[var(--w-shadow)]' : 'text-text-secondary hover:text-text-primary'}`}
        >
            {label}<span className="tabular-nums text-text-tertiary">{formatCount(count)}</span>
        </button>
    );

    const changeLine = (rowNumber: number, s: Suggestion, c: AiFixChange) => (
        <li key={c.field}>
            <label className="flex cursor-pointer items-start gap-2.5 rounded-lg px-2 py-1.5 hover:bg-surface">
                <input type="checkbox" checked={s.selected.includes(c.field)} onChange={() => { if (target) toggleField(target.key, rowNumber, c.field); }} disabled={busy} className="mt-1 h-4 w-4 shrink-0 accent-primary" />
                <span className="min-w-0 text-sm">
                    <span className="font-semibold text-text-primary">{AI_FIX_FIELD_LABELS[c.field]}</span>{' '}
                    <span className="text-text-tertiary line-through">{formatValue(c.field, c.current)}</span>{' '}
                    <span aria-hidden className="text-text-tertiary">→</span><span className="sr-only">changes to</span>{' '}
                    <span className="font-semibold text-text-primary">{formatValue(c.field, c.proposed)}</span>
                    <span className="block text-xs text-text-secondary">{c.reason}</span>
                </span>
            </label>
        </li>
    );

    const reviewRow = (row: SheetIssueRow) => {
        const s = byRow[row.rowNumber];
        const working = inJob.has(row.rowNumber);
        return (
            <li key={row.rowNumber} className="flex gap-x-3 py-4">
                <input
                    type="checkbox" checked={tickedSet.has(row.rowNumber)} onChange={() => toggleRow(row.rowNumber)}
                    aria-label={`Select row ${row.rowNumber}`} className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
                />
                <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-start gap-x-2 gap-y-2">
                        <p className={`${NUM_SM} min-w-0 flex-1 text-text-primary`}>
                            Row {row.rowNumber}
                            {s && <span className="ml-2 font-sans font-normal text-text-secondary">{s.proposal.fullName}</span>}
                            {working && <span className="ml-2 inline-flex translate-y-0.5"><Spinner className="h-3.5 w-3.5" /></span>}
                        </p>
                        {!s && (
                            <div className="flex gap-x-1 gap-y-1">
                                <button type="button" onClick={() => markReviewed([row])} disabled={busy} className={BTN_GHOST} title="The row is fine as it is">
                                    <Check className="h-4 w-4" />Mark reviewed
                                </button>
                                <button type="button" onClick={() => ask([row.rowNumber])} disabled={busy || !row.applicationId || noAnswer.has(row.rowNumber)} className={BTN_GHOST}>
                                    <Wand2 className="h-4 w-4" />Fix with AI
                                </button>
                            </div>
                        )}
                    </div>
                    <div className="mt-2"><Bullets items={row.issues} tone="warning" /></div>
                    {!s && noAnswer.has(row.rowNumber) && (
                        <p className="mt-2 text-xs text-text-secondary">The AI had no answer for this row; its record may have been deleted. Mark it reviewed, or delete the row.</p>
                    )}

                    {s && (
                        <div className={`${WELL} mt-3 px-3 py-3`}>
                            <p className={`${LABEL} flex items-center gap-1.5`}><Sparkles className="h-3.5 w-3.5" aria-hidden />AI suggestion</p>
                            {s.proposal.changes.length > 0 ? (
                                <ul className="mt-1.5 space-y-0.5">{s.proposal.changes.map(c => changeLine(row.rowNumber, s, c))}</ul>
                            ) : (
                                <p className="mt-1.5 text-sm text-text-secondary">No change suggested: the AI could not fix this row from what it says.</p>
                            )}
                            {s.proposal.cannotFix.length > 0 && (
                                <div className="mt-2">
                                    <p className={LABEL}>Check yourself</p>
                                    <div className="mt-1"><Bullets items={s.proposal.cannotFix} tone="muted" /></div>
                                </div>
                            )}
                            <div className="mt-3 flex flex-wrap justify-end gap-x-1 gap-y-1">
                                <button type="button" onClick={() => { if (target) dismissSuggestions(target.key, [row.rowNumber]); }} disabled={busy} className={BTN_GHOST} title="Throw this suggestion away; the row stays as it is">Discard suggestion</button>
                                <button type="button" onClick={() => markReviewed([row])} disabled={busy} className={BTN_GHOST} title="Keep the record as it is and clear the issue">
                                    <Check className="h-4 w-4" />Mark reviewed
                                </button>
                                {s.proposal.changes.length > 0 ? (
                                    <button type="button" onClick={() => apply([row])} disabled={busy || s.selected.length === 0} className={`${BTN_SECONDARY} h-9`}>
                                        <CircleCheck className="h-4 w-4" />
                                        Apply {s.selected.length > 0 ? `${s.selected.length} ${s.selected.length === 1 ? 'change' : 'changes'}` : ''}
                                    </button>
                                ) : (
                                    <button type="button" onClick={() => setConfirm([row.rowNumber])} disabled={busy} className={`${BTN_DANGER_GHOST} h-9`}>
                                        <Trash2 className="h-4 w-4" />Delete row
                                    </button>
                                )}
                            </div>
                        </div>
                    )}
                    <RawValues raw={row.raw} />
                </div>
            </li>
        );
    };

    const notAsked = askable(review);
    const readyToApply = fixable(review);
    const pickedAskable = askable(picked);
    const pickedFixable = fixable(picked);

    const footer = (
        <>
            <button type="button" onClick={onClose} className={BTN_SECONDARY}>Close</button>
            {tab === 'review' && notAsked.length > 0 && (
                <button type="button" onClick={() => ask(notAsked)} disabled={busy} className={BTN_SECONDARY}>
                    <Wand2 className="h-4 w-4" />Fix all with AI ({formatCount(notAsked.length)})
                </button>
            )}
            {tab === 'review' && readyToApply.length > 0 && (
                <button type="button" disabled={busy} className={BTN_PRIMARY} onClick={() => apply(readyToApply)}>
                    <CircleCheck className="h-4 w-4" />Apply all ticked changes ({formatCount(readyToApply.length)} rows)
                </button>
            )}
        </>
    );

    return (
        <>
            <Dialog
                open={open}
                onClose={() => { if (!confirm) onClose(); }}
                labelId="sheet-issues-title"
                size="xl"
                title="Rows with issues"
                description={sheet && <span className="break-words">{sheet.name}</span>}
                footer={footer}
            >
                {!current ? (
                    <div className="space-y-3 py-2">{[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-10 w-full rounded-lg" />)}</div>
                ) : current.error ? (
                    <p role="alert" className="flex gap-x-2 gap-y-2 py-6 text-sm text-text-primary"><CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-error" />{current.error}</p>
                ) : rows.length === 0 ? (
                    <EmptyState icon={CircleCheck} title="No issues">Every row in this sheet was imported cleanly.</EmptyState>
                ) : (
                    <div>
                        <div role="tablist" aria-label="Issue groups" className={`${WELL} inline-flex flex-wrap gap-x-1 gap-y-1 px-1 py-1`}>
                            {tabButton('review', 'Needs review', review.length)}
                            {tabButton('fixed', 'Fixed automatically', fixed.length)}
                            {tabButton('skipped', 'Skipped', skipped.length)}
                        </div>

                        {/* The running job: it goes on when the box is closed. */}
                        {job && target && (
                            <div className={`${WELL} mt-3 px-3 py-3`} aria-live="polite">
                                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
                                    <p className="inline-flex items-center gap-x-2 text-sm font-semibold text-text-primary">
                                        <Spinner />{JOB_LABELS[job.kind]}
                                        <span className="tabular-nums text-text-secondary">{formatCount(job.done)} / {formatCount(job.total)} rows</span>
                                    </p>
                                    <button type="button" onClick={() => stopJob(target.key)} disabled={job.stopping} className={BTN_GHOST}>{job.stopping ? 'Stopping' : 'Stop'}</button>
                                </div>
                                <span className="mt-2 block h-1.5 w-full overflow-hidden rounded-full bg-border" role="progressbar" aria-label={JOB_LABELS[job.kind]} aria-valuemin={0} aria-valuemax={job.total} aria-valuenow={job.done}>
                                    <span className="block h-full rounded-full bg-primary transition-[width] duration-300" style={{ width: `${job.total ? Math.round((job.done / job.total) * 100) : 0}%` }} />
                                </span>
                                <p className="mt-2 text-xs text-text-secondary">You can close this box. The work goes on while this browser tab stays open, and its progress shows beside the sheet.</p>
                            </div>
                        )}

                        {tab === 'review' && (
                            review.length === 0 ? (
                                <EmptyState icon={CircleCheck} title="Nothing to review">Every imported row is clean or was fixed automatically.</EmptyState>
                            ) : (
                                <>
                                    <p className="mt-3 text-sm text-text-secondary">
                                        The AI suggests corrected values from each row&apos;s own cells. Nothing is saved until you apply it.
                                    </p>

                                    {/* What is shown */}
                                    <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
                                        <label className="inline-flex h-10 cursor-pointer items-center gap-x-2 text-sm font-semibold text-text-primary">
                                            <input
                                                type="checkbox" checked={allTicked} disabled={shown.length === 0}
                                                ref={el => { if (el) el.indeterminate = picked.length > 0 && !allTicked; }}
                                                onChange={() => setView({ ticked: allTicked ? [] : shown.map(r => r.rowNumber) })}
                                                className="h-4 w-4 accent-primary"
                                            />
                                            {picked.length > 0 ? `${formatCount(picked.length)} selected` : `Select all ${formatCount(shown.length)}`}
                                        </label>
                                        {kinds.length > 1 && (
                                            <select aria-label="Kind of issue" value={kind} onChange={e => setView({ kind: e.target.value, ticked: [] })} className={`${FIELD} min-w-0 max-w-full sm:max-w-[340px]`}>
                                                <option value="">All kinds of issue ({formatCount(review.length)})</option>
                                                {kinds.map(([k, n]) => <option key={k} value={k}>{k} ({formatCount(n)})</option>)}
                                            </select>
                                        )}
                                        <div role="group" aria-label="What the AI said" className={`${WELL} inline-flex flex-wrap gap-x-0.5 gap-y-0.5 px-0.5 py-0.5`}>
                                            {(Object.keys(AI_FILTER_LABELS) as AiFilter[]).map(value => (
                                                <button
                                                    key={value} type="button" aria-pressed={view.ai === value}
                                                    onClick={() => setView({ ai: value, ticked: [] })}
                                                    className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold transition-colors ${view.ai === value ? 'bg-surface text-text-primary shadow-[var(--w-shadow)]' : 'text-text-secondary hover:text-text-primary'}`}
                                                >
                                                    {AI_FILTER_LABELS[value]}<span className="tabular-nums text-text-tertiary">{formatCount(aiCounts[value])}</span>
                                                </button>
                                            ))}
                                        </div>
                                    </div>

                                    {/* The rows the AI could not fix, in one step (owner 2026-11-12). */}
                                    {noFix.length > 0 && picked.length === 0 && (
                                        <div className="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-xl px-3 py-2 ring-1 ring-inset ring-border">
                                            <p className="min-w-0 text-sm text-text-primary">
                                                The AI could not fix <span className="font-semibold tabular-nums">{formatCount(noFix.length)}</span> {noFix.length === 1 ? 'row' : 'rows'}: it has no change to suggest for {noFix.length === 1 ? 'it' : 'them'}.
                                            </p>
                                            <div className="flex flex-wrap gap-x-1 gap-y-1">
                                                {view.ai !== 'nofix' && <button type="button" onClick={() => setView({ ai: 'nofix', kind: '', ticked: [] })} className={BTN_GHOST}>Show {noFix.length === 1 ? 'it' : 'them'}</button>}
                                                <button type="button" onClick={() => setConfirm(noFix.map(r => r.rowNumber))} disabled={busy} className={BTN_DANGER_GHOST}>
                                                    <Trash2 className="h-4 w-4" />Delete {noFix.length === 1 ? 'this row' : `these ${formatCount(noFix.length)} rows`}
                                                </button>
                                            </div>
                                        </div>
                                    )}

                                    {/* What to do with the ticked rows */}
                                    {picked.length > 0 && (
                                        <div className={`${WELL} mt-3 flex flex-wrap items-center gap-x-1 gap-y-1 px-3 py-2`}>
                                            <p className="mr-auto text-sm font-semibold text-text-primary">{formatCount(picked.length)} {picked.length === 1 ? 'row' : 'rows'} selected</p>
                                            {pickedAskable.length > 0 && (
                                                <button type="button" onClick={() => { ask(pickedAskable); setView({ ticked: [] }); }} disabled={busy} className={BTN_GHOST}>
                                                    <Wand2 className="h-4 w-4" />Fix with AI ({formatCount(pickedAskable.length)})
                                                </button>
                                            )}
                                            {pickedFixable.length > 0 && (
                                                <button type="button" onClick={() => apply(picked)} disabled={busy} className={BTN_GHOST}>
                                                    <CircleCheck className="h-4 w-4" />Apply fixes ({formatCount(pickedFixable.length)})
                                                </button>
                                            )}
                                            <button type="button" onClick={() => markReviewed(picked)} disabled={busy} className={BTN_GHOST} title="Keep these records as they are and clear their issues">
                                                <Check className="h-4 w-4" />Mark reviewed
                                            </button>
                                            <button type="button" onClick={() => setConfirm(picked.map(r => r.rowNumber))} disabled={busy} className={BTN_DANGER_GHOST}>
                                                <Trash2 className="h-4 w-4" />Delete rows
                                            </button>
                                            <button type="button" onClick={() => setView({ ticked: [] })} className={BTN_GHOST} aria-label="Clear the selection"><X className="h-4 w-4" /></button>
                                        </div>
                                    )}

                                    {shown.length === 0 ? (
                                        <p className="py-8 text-center text-sm text-text-secondary">No rows match. Change what is shown above.</p>
                                    ) : (
                                        <ul className="mt-1 divide-y divide-border-subtle">{shown.map(reviewRow)}</ul>
                                    )}
                                </>
                            )
                        )}

                        {tab === 'fixed' && (
                            fixed.length === 0 ? (
                                <EmptyState icon={CircleCheck} title="No automatic fixes">No row needed one.</EmptyState>
                            ) : (
                                <>
                                    <p className="mt-3 text-sm text-text-secondary">These were read with a routine rule on import, or resolved later. No action is needed.</p>
                                    <ul className="divide-y divide-border-subtle">
                                        {fixed.map(row => (
                                            <li key={row.rowNumber} className="py-4">
                                                <p className={`${NUM_SM} text-text-primary`}>Row {row.rowNumber}</p>
                                                <div className="mt-2"><Bullets items={row.fixed} tone="success" /></div>
                                                <RawValues raw={row.raw} />
                                            </li>
                                        ))}
                                    </ul>
                                </>
                            )
                        )}

                        {tab === 'skipped' && (
                            skipped.length === 0 ? (
                                <EmptyState icon={CircleSlash} title="No skipped rows">Every row was imported.</EmptyState>
                            ) : (
                                <>
                                    <p className="mt-3 text-sm text-text-secondary">These rows were not imported. Fix them in the Excel file and upload it again with Merge.</p>
                                    <ul className="divide-y divide-border-subtle">
                                        {skipped.map(row => (
                                            <li key={row.rowNumber} className="py-4">
                                                <p className={`${NUM_SM} text-text-primary`}>Row {row.rowNumber}</p>
                                                <div className="mt-2"><Bullets items={row.issues} tone="warning" /></div>
                                                <RawValues raw={row.raw} />
                                            </li>
                                        ))}
                                    </ul>
                                </>
                            )
                        )}
                    </div>
                )}
            </Dialog>

            <Dialog
                open={confirm !== null}
                onClose={() => setConfirm(null)}
                labelId="sheet-issues-delete-title"
                size="sm"
                title={confirm && confirm.length === 1 ? 'Delete this row?' : `Delete ${formatCount(confirm?.length ?? 0)} rows?`}
                footer={(
                    <>
                        <button type="button" onClick={() => setConfirm(null)} className={BTN_SECONDARY}>Cancel</button>
                        <button type="button" onClick={doDelete} className={BTN_DANGER}>
                            <Trash2 className="h-4 w-4" />Delete {confirm && confirm.length === 1 ? 'row' : `${formatCount(confirm?.length ?? 0)} rows`}
                        </button>
                    </>
                )}
            >
                <p className="text-sm text-text-primary">
                    The {confirm && confirm.length === 1 ? 'candidate record this row became moves' : 'candidate records these rows became move'} to Deleted and {confirm && confirm.length === 1 ? 'leaves' : 'leave'} the search.
                    {' '}You can restore {confirm && confirm.length === 1 ? 'it' : 'them'} from the Candidates tab with Show deleted.
                </p>
                <p className="mt-2 text-sm text-text-secondary">The {confirm && confirm.length === 1 ? 'row leaves' : 'rows leave'} &ldquo;Needs review&rdquo;. The Excel file is not changed.</p>
            </Dialog>
        </>
    );
}
