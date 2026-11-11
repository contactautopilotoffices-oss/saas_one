'use client';

import React, { useEffect, useState } from 'react';
import { Check, CircleAlert, CircleCheck, CircleSlash, Sparkles, Wand2 } from 'lucide-react';
import {
    AI_FIX_FIELD_LABELS,
    type AiFixApplyResponse, type AiFixApproval, type AiFixChange, type AiFixField, type AiFixProposal, type AiFixResponse,
    type CandidateSheet, type SheetIssueRow,
} from '@/backend/lib/candidates/types';
import Skeleton from '@/frontend/components/ui/Skeleton';
import { api, qs } from './api';
import { formatCount, formatInrFull, formatMonths, formatNotice } from './format';
import { BTN_GHOST, BTN_PRIMARY, BTN_SECONDARY, Dialog, EmptyState, LABEL, NUM_SM, Spinner, useUi, WELL } from './ui';

type Loaded = { key: number; rows: SheetIssueRow[] | null; error: string };
type Tab = 'review' | 'fixed' | 'skipped';
/** One row's AI suggestion and which of its changes HR has ticked. */
type Suggestion = { proposal: AiFixProposal; logId: string | null; selected: AiFixField[] };

/** Rows per AI call: the server's AI_FIX_BATCH. */
const AI_BATCH = 15;

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
 * "View issues": a sheet's rows from its latest upload, in three groups: needs review (with the AI fix), fixed
 * automatically on import, and skipped. AI suggestions are only saved when HR approves them (owner 2026-11-03).
 */
export default function IssuesModal({
    orgId, request, open, onClose, onChanged,
}: {
    orgId: string;
    /** Kept after close so the content stays put during the exit animation; a new `key` refetches. */
    request: { sheet: CandidateSheet; key: number } | null;
    open: boolean;
    onClose: () => void;
    /** Records or the sheet's counts changed (an AI fix or a review was saved). */
    onChanged: () => void;
}) {
    const { notify, reportError } = useUi();
    const [loaded, setLoaded] = useState<Loaded | null>(null);
    const [nonce, setNonce] = useState(0);
    const [tabState, setTabState] = useState<{ key: number; tab: Tab } | null>(null);
    const [suggestions, setSuggestions] = useState<{ key: number; byRow: Record<number, Suggestion> }>({ key: -1, byRow: {} });
    const [asking, setAsking] = useState<{ rows: number[]; done: number; total: number } | null>(null);
    const [saving, setSaving] = useState<number | 'all' | null>(null);

    useEffect(() => {
        if (!request) return;
        const { sheet, key } = request;
        const ctrl = new AbortController();
        void api<{ rows: SheetIssueRow[] }>(`/api/candidates/sheets/${encodeURIComponent(sheet.id)}/issues${qs({ orgId })}`, { signal: ctrl.signal })
            .then(res => {
                if (ctrl.signal.aborted) return;
                if (!res.ok) { if (res.noAccess) reportError(res); setLoaded({ key, rows: null, error: res.error }); return; }
                setLoaded({ key, rows: res.data.rows, error: '' });
            });
        return () => ctrl.abort();
    }, [orgId, request, reportError, nonce]);

    const sheet = request?.sheet ?? null;
    const reqKey = request?.key ?? -1;
    const current = request && loaded?.key === request.key ? loaded : null;
    const rows = current?.rows ?? [];
    const review = rows.filter(r => !r.skipped && r.issues.length > 0);
    const fixed = rows.filter(r => !r.skipped && r.issues.length === 0 && r.fixed.length > 0);
    const skipped = rows.filter(r => r.skipped);
    const tab: Tab = tabState?.key === reqKey ? tabState.tab : review.length ? 'review' : fixed.length ? 'fixed' : skipped.length ? 'skipped' : 'review';
    const byRow = suggestions.key === reqKey ? suggestions.byRow : {};
    const busy = asking !== null || saving !== null;

    const setByRow = (update: (prev: Record<number, Suggestion>) => Record<number, Suggestion>) =>
        setSuggestions(s => ({ key: reqKey, byRow: update(s.key === reqKey ? s.byRow : {}) }));

    const askAi = async (rowNumbers: number[]) => {
        if (!sheet || !rowNumbers.length) return;
        setAsking({ rows: rowNumbers, done: 0, total: rowNumbers.length });
        let got = 0;
        for (let i = 0; i < rowNumbers.length; i += AI_BATCH) {
            const batch = rowNumbers.slice(i, i + AI_BATCH);
            const res = await api<AiFixResponse>(`/api/candidates/sheets/${encodeURIComponent(sheet.id)}/ai-fix`, { json: { orgId, rowNumbers: batch } });
            if (!res.ok) { reportError(res); break; }
            const { proposals, logId } = res.data;
            got += proposals.length;
            setByRow(prev => {
                const next = { ...prev };
                for (const p of proposals) next[p.rowNumber] = { proposal: p, logId, selected: p.changes.map(c => c.field) };
                return next;
            });
            setAsking(a => (a ? { ...a, done: Math.min(a.total, a.done + batch.length) } : a));
        }
        setAsking(null);
        if (got > 1) notify(`AI suggestions ready for ${formatCount(got)} rows. Review them, then apply.`, 'info');
    };

    const toggle = (rowNumber: number, field: AiFixField) =>
        setByRow(prev => {
            const s = prev[rowNumber];
            if (!s) return prev;
            const selected = s.selected.includes(field) ? s.selected.filter(f => f !== field) : [...s.selected, field];
            return { ...prev, [rowNumber]: { ...s, selected } };
        });

    const dismiss = (rowNumber: number) => setByRow(prev => { const next = { ...prev }; delete next[rowNumber]; return next; });

    /** Save approvals, one call per AI fix log (a call can carry only one log id). */
    const save = async (approvals: AiFixApproval[], target: number | 'all') => {
        if (!sheet || !approvals.length) return;
        setSaving(target);
        const groups = new Map<string, AiFixApproval[]>();
        for (const a of approvals) {
            const logId = byRow[a.rowNumber]?.logId ?? '';
            groups.set(logId, [...(groups.get(logId) ?? []), a]);
        }
        let applied = 0;
        const failed: AiFixApplyResponse['failed'] = [];
        for (const [logId, group] of groups) {
            const res = await api<AiFixApplyResponse>(`/api/candidates/sheets/${encodeURIComponent(sheet.id)}/ai-fix/apply`, {
                json: { orgId, logId: logId || undefined, approvals: group },
            });
            if (!res.ok) { reportError(res); break; }
            applied += res.data.applied;
            failed.push(...res.data.failed);
        }
        setSaving(null);
        const failedRows = new Set(failed.map(f => f.rowNumber));
        setByRow(prev => {
            const next = { ...prev };
            for (const a of approvals) if (!failedRows.has(a.rowNumber)) delete next[a.rowNumber];
            return next;
        });
        if (applied) notify(`${formatCount(applied)} ${applied === 1 ? 'row' : 'rows'} updated`, 'success');
        if (failed.length) notify(`Row ${failed[0].rowNumber}: ${failed[0].error}`, 'error');
        if (applied) { setNonce(n => n + 1); onChanged(); }
    };

    const changesOf = (s: Suggestion): AiFixApproval['changes'] =>
        Object.fromEntries(s.proposal.changes.filter(c => s.selected.includes(c.field)).map(c => [c.field, c.proposed]));

    const readyToApply = review.filter(r => (byRow[r.rowNumber]?.selected.length ?? 0) > 0);
    const notAsked = review.filter(r => !byRow[r.rowNumber]).map(r => r.rowNumber);

    const tabButton = (value: Tab, label: string, count: number) => (
        <button
            type="button" role="tab" aria-selected={tab === value}
            onClick={() => setTabState({ key: reqKey, tab: value })}
            className={`inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold transition-colors ${tab === value ? 'bg-surface text-text-primary shadow-[var(--w-shadow)]' : 'text-text-secondary hover:text-text-primary'}`}
        >
            {label}<span className="tabular-nums text-text-tertiary">{formatCount(count)}</span>
        </button>
    );

    const changeLine = (rowNumber: number, s: Suggestion, c: AiFixChange) => (
        <li key={c.field}>
            <label className="flex cursor-pointer items-start gap-2.5 rounded-lg px-2 py-1.5 hover:bg-surface">
                <input type="checkbox" checked={s.selected.includes(c.field)} onChange={() => toggle(rowNumber, c.field)} disabled={busy} className="mt-1 h-4 w-4 shrink-0 accent-primary" />
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
        const thinking = asking?.rows.includes(row.rowNumber) && !s;
        return (
            <li key={row.rowNumber} className="py-4">
                <div className="flex flex-wrap items-start gap-x-2 gap-y-2">
                    <p className={`${NUM_SM} min-w-0 flex-1 text-text-primary`}>
                        Row {row.rowNumber}
                        {s && <span className="ml-2 font-sans font-normal text-text-secondary">{s.proposal.fullName}</span>}
                    </p>
                    {!s && (
                        <div className="flex gap-x-1 gap-y-1">
                            <button type="button" onClick={() => void save([{ rowNumber: row.rowNumber, changes: {} }], row.rowNumber)} disabled={busy} className={BTN_GHOST} title="The row is fine as it is">
                                {saving === row.rowNumber ? <Spinner /> : <Check className="h-4 w-4" />}Mark reviewed
                            </button>
                            <button type="button" onClick={() => void askAi([row.rowNumber])} disabled={busy || !row.applicationId} className={BTN_GHOST}>
                                {thinking ? <Spinner /> : <Wand2 className="h-4 w-4" />}Fix with AI
                            </button>
                        </div>
                    )}
                </div>
                <div className="mt-2"><Bullets items={row.issues} tone="warning" /></div>

                {s && (
                    <div className={`${WELL} mt-3 px-3 py-3`}>
                        <p className={`${LABEL} flex items-center gap-1.5`}><Sparkles className="h-3.5 w-3.5" aria-hidden />AI suggestion</p>
                        {s.proposal.changes.length > 0 ? (
                            <ul className="mt-1.5 space-y-0.5">{s.proposal.changes.map(c => changeLine(row.rowNumber, s, c))}</ul>
                        ) : (
                            <p className="mt-1.5 text-sm text-text-secondary">No change suggested.</p>
                        )}
                        {s.proposal.cannotFix.length > 0 && (
                            <div className="mt-2">
                                <p className={LABEL}>Check yourself</p>
                                <div className="mt-1"><Bullets items={s.proposal.cannotFix} tone="muted" /></div>
                            </div>
                        )}
                        <div className="mt-3 flex flex-wrap justify-end gap-x-1 gap-y-1">
                            <button type="button" onClick={() => dismiss(row.rowNumber)} disabled={busy} className={BTN_GHOST}>Discard</button>
                            <button type="button" onClick={() => void save([{ rowNumber: row.rowNumber, changes: {} }], row.rowNumber)} disabled={busy} className={BTN_GHOST} title="Keep the record as it is and clear the issue">
                                <Check className="h-4 w-4" />Mark reviewed
                            </button>
                            <button
                                type="button" onClick={() => void save([{ rowNumber: row.rowNumber, changes: changesOf(s) }], row.rowNumber)}
                                disabled={busy || s.selected.length === 0} className={`${BTN_SECONDARY} h-9`}
                            >
                                {saving === row.rowNumber ? <Spinner /> : <CircleCheck className="h-4 w-4" />}
                                Apply {s.selected.length > 0 ? `${s.selected.length} ${s.selected.length === 1 ? 'change' : 'changes'}` : ''}
                            </button>
                        </div>
                    </div>
                )}
                <RawValues raw={row.raw} />
            </li>
        );
    };

    const footer = (
        <>
            <button type="button" onClick={onClose} disabled={saving !== null} className={BTN_SECONDARY}>Close</button>
            {tab === 'review' && notAsked.length > 0 && (
                <button type="button" onClick={() => void askAi(notAsked)} disabled={busy} className={BTN_SECONDARY}>
                    {asking ? <Spinner /> : <Wand2 className="h-4 w-4" />}
                    {asking ? `Asking AI… ${formatCount(asking.done)}/${formatCount(asking.total)}` : `Fix all with AI (${formatCount(notAsked.length)})`}
                </button>
            )}
            {tab === 'review' && readyToApply.length > 0 && (
                <button
                    type="button" disabled={busy} className={BTN_PRIMARY}
                    onClick={() => void save(readyToApply.map(r => ({ rowNumber: r.rowNumber, changes: changesOf(byRow[r.rowNumber]) })), 'all')}
                >
                    {saving === 'all' ? <Spinner /> : <CircleCheck className="h-4 w-4" />}Apply ticked changes ({formatCount(readyToApply.length)} rows)
                </button>
            )}
        </>
    );

    return (
        <Dialog
            open={open}
            onClose={() => { if (saving === null) onClose(); }}
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

                    {tab === 'review' && (
                        review.length === 0 ? (
                            <EmptyState icon={CircleCheck} title="Nothing to review">Every imported row is clean or was fixed automatically.</EmptyState>
                        ) : (
                            <>
                                <p className="mt-3 text-sm text-text-secondary">
                                    The AI suggests corrected values from each row&apos;s own cells. Nothing is saved until you apply it.
                                </p>
                                <ul className="divide-y divide-border-subtle">{review.map(reviewRow)}</ul>
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
    );
}
