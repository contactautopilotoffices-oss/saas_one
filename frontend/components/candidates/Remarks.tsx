'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Ban, MessageSquareText, ShieldOff } from 'lucide-react';
import type { CandidateAction } from '@/backend/lib/candidates/actions';
import {
    BLACKLIST_REASON_LABELS, BLACKLIST_REASONS, CALL_FACT_LABELS, REMARK_REQUIRED_STATUSES, STATUS_LABELS,
    type Blacklist, type BlacklistReason, type CallFactKey, type CandidateRecord, type RecordStatus,
} from '@/backend/lib/candidates/types';
import { api, qs } from './api';
import { formatDate, formatInr } from './format';
import { BTN_GHOST, BTN_PRIMARY, BTN_SECONDARY, Dialog, INPUT, LABEL, Spinner, useUi, WELL } from './ui';

/*
 * Remarks, the blacklist and the history (owner 2026-11-15; migration 20261115000002).
 *
 *  - A status change asks for a remark only when the new status needs one ("Others"); every other change goes
 *    straight through, as before. The remark is kept in the history, not on the record.
 *  - Blacklisting asks for a reason from the fixed list; the remark is optional and should stay factual.
 *  - The history is read newest first and never edited.
 */

export const REMARK_MAX = 1000;
export const BTN_DANGER_FILLED =
    'inline-flex h-10 shrink-0 items-center justify-center gap-x-2 gap-y-2 rounded-xl bg-error px-4 text-sm font-bold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50';

export const statusNeedsRemark = (status: RecordStatus) => REMARK_REQUIRED_STATUSES.includes(status);

/** One remark box. `required` disables Save until something is typed. */
export function RemarkDialog({ open, title, description, placeholder, required, busy, confirmLabel = 'Save', onClose, onSubmit }: {
    open: boolean; title: React.ReactNode; description?: React.ReactNode; placeholder?: string; required: boolean; busy: boolean;
    confirmLabel?: string; onClose: () => void; onSubmit: (remark: string) => void;
}) {
    const [text, setText] = useState('');
    // A fresh box each time it opens (the render-time reset the other inputs in this folder use).
    const [seenOpen, setSeenOpen] = useState(open);
    if (open !== seenOpen) { setSeenOpen(open); if (open) setText(''); }
    const value = text.trim();
    return (
        <Dialog
            open={open}
            onClose={onClose}
            labelId="cand-remark-title"
            title={title}
            description={description}
            footer={
                <>
                    <button type="button" onClick={onClose} disabled={busy} className={BTN_SECONDARY}>Cancel</button>
                    <button type="button" onClick={() => onSubmit(value)} disabled={busy || (required && !value)} className={BTN_PRIMARY}>{busy && <Spinner />}{confirmLabel}</button>
                </>
            }
        >
            <label htmlFor="cand-remark" className="block text-sm font-semibold text-text-primary">Remark{required ? '' : ' (optional)'}</label>
            <textarea
                id="cand-remark" rows={3} maxLength={REMARK_MAX} value={text} onChange={e => setText(e.target.value)} autoFocus
                placeholder={placeholder} className={`${INPUT} mt-1.5 h-auto min-h-[84px] resize-y py-2.5 leading-relaxed`}
            />
        </Dialog>
    );
}

/**
 * The status-change remark, shared by the lists: asks only when the new status needs it. Returns the handler to give
 * the dropdowns and the dialog to render once.
 */
export function useStatusRemark(onChange: (record: CandidateRecord, status: RecordStatus, remark: string | null) => Promise<void>) {
    const [pending, setPending] = useState<{ record: CandidateRecord; status: RecordStatus } | null>(null);
    const [busy, setBusy] = useState(false);
    const change = (record: CandidateRecord, status: RecordStatus) => {
        if (statusNeedsRemark(status)) setPending({ record, status });
        else void onChange(record, status, null);
    };
    const dialog = (
        <RemarkDialog
            open={!!pending}
            required
            busy={busy}
            title={pending ? `${pending.record.fullName}: ${STATUS_LABELS[pending.status]}` : ''}
            description={pending ? `"${STATUS_LABELS[pending.status]}" needs a remark, so the next person knows what it means.` : undefined}
            placeholder="e.g. Asked to be considered for the Bengaluru role instead"
            onClose={() => { if (!busy) setPending(null); }}
            onSubmit={async remark => {
                if (!pending) return;
                setBusy(true);
                await onChange(pending.record, pending.status, remark);
                setBusy(false);
                setPending(null);
            }}
        />
    );
    return { change, dialog };
}

/** Blacklist a person: reason from the list, optional remark. */
export function BlacklistDialog({ open, record, busy, onClose, onSubmit }: {
    open: boolean; record: CandidateRecord | null; busy: boolean; onClose: () => void; onSubmit: (reason: BlacklistReason, remark: string) => void;
}) {
    const [reason, setReason] = useState<BlacklistReason>('did_not_join');
    const [remark, setRemark] = useState('');
    const [seenOpen, setSeenOpen] = useState(open);
    if (open !== seenOpen) { setSeenOpen(open); if (open) { setReason('did_not_join'); setRemark(''); } }
    return (
        <Dialog
            open={open}
            onClose={onClose}
            labelId="cand-blacklist-title"
            title={record ? `Blacklist ${record.fullName}` : 'Blacklist'}
            description="Every record of this person leaves the searches, the counts and Rank with AI. Nothing is deleted, and any HR user can undo it. Both are kept in the history."
            footer={
                <>
                    <button type="button" onClick={onClose} disabled={busy} className={BTN_SECONDARY}>Cancel</button>
                    <button type="button" onClick={() => onSubmit(reason, remark.trim())} disabled={busy} className={BTN_DANGER_FILLED}>{busy && <Spinner />}<Ban className="h-4 w-4" />Blacklist</button>
                </>
            }
        >
            <div className="space-y-3">
                <div>
                    <label htmlFor="cand-blacklist-reason" className="block text-sm font-semibold text-text-primary">Reason</label>
                    <select id="cand-blacklist-reason" value={reason} onChange={e => setReason(e.target.value as BlacklistReason)} className={`${INPUT} mt-1.5`}>
                        {BLACKLIST_REASONS.map(r => <option key={r} value={r}>{BLACKLIST_REASON_LABELS[r]}</option>)}
                    </select>
                </div>
                <div>
                    <label htmlFor="cand-blacklist-remark" className="block text-sm font-semibold text-text-primary">Remark <span className="font-normal text-text-secondary">(optional, keep it factual)</span></label>
                    <textarea id="cand-blacklist-remark" rows={2} maxLength={REMARK_MAX} value={remark} onChange={e => setRemark(e.target.value)} placeholder="What happened, in one line" className={`${INPUT} mt-1.5 h-auto min-h-[64px] resize-y py-2.5 leading-relaxed`} />
                </div>
            </div>
        </Dialog>
    );
}

/** The red tag on a blacklisted person. */
export function BlacklistedTag({ entry }: { entry?: Blacklist | null }) {
    const title = entry ? `Blacklisted ${formatDate(entry.at)}${entry.byName ? ` by ${entry.byName}` : ''}: ${BLACKLIST_REASON_LABELS[entry.reason]}${entry.remark ? ` — ${entry.remark}` : ''}` : 'Blacklisted: hidden from searches';
    return (
        <span title={title} className="inline-flex h-[22px] max-w-full items-center gap-x-1 whitespace-nowrap rounded-full bg-error/10 px-2 text-xs font-semibold text-red-800">
            <Ban className="h-3 w-3 shrink-0" aria-hidden />Blacklisted
        </span>
    );
}

const ACTION_LABEL: Record<CandidateAction['action'], string> = {
    status_change: 'Status', stage_change: 'Stage', remark: 'Remark', blacklist: 'Blacklisted', unblacklist: 'Blacklist removed',
    resume_attached: 'Resume attached', resume_marked: 'Marked as a resume', added_to_position: 'Added to position',
    removed_from_position: 'Removed from position', call_logged: 'Call', field_edit: 'Details edited', outreach_sent: 'WhatsApp sent',
    duplicate_flagged: 'Already in the database',
};

const statusLabel = (value: string | null) => (value && value in STATUS_LABELS ? STATUS_LABELS[value as RecordStatus] : value ?? '');

function describe(a: CandidateAction): React.ReactNode {
    switch (a.action) {
        case 'status_change': return <>{statusLabel(a.fromValue)} → <strong>{statusLabel(a.toValue)}</strong></>;
        case 'stage_change': return <>{a.fromValue} → <strong>{a.toValue}</strong></>;
        case 'blacklist': return <>{a.toValue && a.toValue in BLACKLIST_REASON_LABELS ? BLACKLIST_REASON_LABELS[a.toValue as BlacklistReason] : a.toValue}</>;
        case 'unblacklist': return <>Was: {a.fromValue && a.fromValue in BLACKLIST_REASON_LABELS ? BLACKLIST_REASON_LABELS[a.fromValue as BlacklistReason] : a.fromValue}</>;
        case 'field_edit': {
            // Owner 2026-11-16: a fact applied from a call names its field and says where it came from.
            const fields = Array.isArray(a.meta.fields) ? (a.meta.fields as string[]) : [];
            const label = (f: string) => (f in CALL_FACT_LABELS ? CALL_FACT_LABELS[f as CallFactKey] : f);
            const fromCall = a.meta.source === 'call'
                ? <span className="text-text-secondary"> · from the call{typeof a.meta.calledOn === 'string' ? ` on ${formatDate(a.meta.calledOn)}` : ''}</span>
                : null;
            // Owner 2026-11-17: an applied call fact shows the value it replaced, so an overwritten sheet value can be found.
            const changes = Array.isArray(a.meta.changes) ? (a.meta.changes as { field: string; from: unknown; to: unknown; basis?: string }[]) : [];
            if (changes.length) {
                return (
                    <>
                        {changes.map((c, i) => (
                            <span key={c.field} className="block">
                                {label(c.field)}: {c.from === null || c.from === undefined || c.from === '' ? <span className="text-text-secondary">empty</span> : factValue(c.field, c.from)} → <strong>{factValue(c.field, c.to)}</strong>{c.basis === 'ctc' ? <span className="text-text-secondary"> (said as CTC, not in-hand)</span> : c.basis === 'unclear' ? <span className="text-text-secondary"> (in-hand or CTC not said)</span> : null}
                                {i === changes.length - 1 ? fromCall : null}
                            </span>
                        ))}
                    </>
                );
            }
            return <>{fields.map(label).join(', ')}{fromCall}</>;
        }
        case 'duplicate_flagged': {
            // Owner 2026-11-16: a second CV, or a row in another sheet: which copy, and how the person was first sourced.
            const m = a.meta as { source?: string; fileName?: string | null; sheetName?: string | null; firstAt?: string | null; firstBy?: string | null; previous?: { fileName?: string; uploadedAt?: string | null } | null; first?: { at?: string | null; from?: string | null; byName?: string | null } | null };
            if (m.source === 'same_file') {
                // The same file uploaded again by someone else; it was not stored twice.
                const firstUp = [m.firstBy ? `first uploaded by ${m.firstBy}` : 'already on file', m.firstAt ? formatDate(m.firstAt) : null].filter(Boolean).join(', ');
                return <>{`Same CV uploaded again ${m.fileName ?? ''}`.trim()}<span className="text-text-secondary"> · {firstUp}</span></>;
            }
            const copy = m.source === 'sheet' ? `Sheet ${m.sheetName ?? ''}`.trim() : `Second CV ${m.fileName ?? ''}`.trim();
            const had = m.source !== 'sheet' && m.previous?.fileName ? `already had ${m.previous.fileName}${m.previous.uploadedAt ? ` (${formatDate(m.previous.uploadedAt)})` : ''}` : '';
            const first = m.first ? [m.first.at ? `first sourced ${formatDate(m.first.at)}` : null, m.first.from ? `from ${m.first.from}` : null, m.first.byName ? `by ${m.first.byName}` : null].filter(Boolean).join(' ') : '';
            return <>{copy}{had ? ` · ${had}` : ''}{first ? <span className="text-text-secondary"> · {first}</span> : null}</>;
        }
        case 'outreach_sent': {
            const position = typeof a.meta.position === 'string' ? a.meta.position : null;
            const phone = typeof a.meta.phone === 'string' ? a.meta.phone : null;
            // Owner 2026-11-19: a stage update keeps the text HR sent.
            const message = typeof a.meta.message === 'string' ? a.meta.message : null;
            return <>{a.toValue ?? ''}{position ? ` · ${position}` : ''}{phone ? <span className="text-text-secondary"> · to {phone}</span> : null}{message ? <span className="block italic text-text-secondary">“{message}”</span> : null}</>;
        }
        case 'call_logged': {
            const position = typeof a.meta.position === 'string' ? a.meta.position : null;
            const calledOn = typeof a.meta.calledOn === 'string' ? a.meta.calledOn : null;
            // Owner 2026-11-17: which round the call was for.
            const round = typeof a.meta.round === 'string' ? a.meta.round : null;
            return <>{round ? `${round} · ` : ''}{a.toValue ?? 'Call'}{position ? ` · ${position}` : ''}{calledOn ? ` · ${formatDate(calledOn)}` : ''}</>;
        }
        case 'remark': {
            // Owner 2026-11-17: an interview scheduled, or a round's feedback, from the pipeline.
            const m = a.meta as { kind?: string; at?: string; mode?: string | null; interviewer?: string | null; round?: string; rating?: number; recommendation?: string };
            if (m.kind === 'interview') {
                const when = m.at ? new Date(m.at).toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '';
                return <>{when}{m.mode ? ` · ${MODE_LABEL[m.mode] ?? m.mode}` : ''}{m.interviewer ? ` · with ${m.interviewer}` : ''}</>;
            }
            if (m.kind === 'feedback') {
                const stars = typeof m.rating === 'number' ? `${'★'.repeat(m.rating)}${'☆'.repeat(5 - m.rating)}` : '';
                return <>{m.round ?? ''}{stars ? <span className="text-amber-600"> · {stars}</span> : null}{m.recommendation ? <strong> · {RECOMMENDATION_LABEL[m.recommendation] ?? m.recommendation}</strong> : null}</>;
            }
            return null;
        }
        default: return <>{a.toValue ?? ''}</>;
    }
}

/** A fact's value as people read it: rupees per month, days, or the text. */
function factValue(field: string, value: unknown): string {
    if (typeof value === 'number' && (field === 'currentInhand' || field === 'expectedInhand')) return `${formatInr(value)} / month`;
    if (typeof value === 'number' && field === 'noticePeriodDays') return `${value} ${value === 1 ? 'day' : 'days'}`;
    return String(value);
}

const MODE_LABEL: Record<string, string> ={ in_person: 'In person', video: 'Video call', phone: 'Phone', online: 'Video call', hybrid: 'Hybrid' };
const RECOMMENDATION_LABEL: Record<string, string> = { move_ahead: 'Move ahead', hold: 'Hold', reject: 'Reject' };
const NOTE_LABEL: Record<string, string> = { interview: 'Interview scheduled', feedback: 'Interview feedback' };
/** The entry's heading: an interview or feedback note reads as such, not as "Remark". */
const labelOf = (a: CandidateAction) => (a.action === 'remark' && typeof a.meta.kind === 'string' && a.meta.kind in NOTE_LABEL ? NOTE_LABEL[a.meta.kind] : ACTION_LABEL[a.action] ?? a.action);

/**
 * The candidate's history with an "Add remark" box (owner 2026-11-15). Reads /api/candidates/[id]/actions; shows a
 * short note when the database update is not applied yet (the list comes back empty then).
 */
export function ActivityTimeline({ orgId, record, nonce = 0, focusNonce = 0, position = null }: {
    orgId: string; record: CandidateRecord; nonce?: number; focusNonce?: number;
    /** Opened from the pipeline (owner 2026-11-17): this position's entries first, "Everything" shows the rest. */
    position?: { id: string; title: string } | null;
}) {
    const { notify, reportError } = useUi();
    const [state, setState] = useState<{ id: string; actions: CandidateAction[] } | null>(null);
    const [scope, setScope] = useState<'position' | 'all'>('position');
    const [text, setText] = useState('');
    const [busy, setBusy] = useState(false);
    const box = useRef<HTMLTextAreaElement | null>(null);
    // "Add remark" on the panel: the box takes focus.
    useEffect(() => { if (focusNonce) box.current?.focus({ preventScroll: false }); }, [focusNonce]);
    const key = JSON.stringify([orgId, record.id, nonce]);
    useEffect(() => {
        const ctrl = new AbortController();
        void api<{ actions: CandidateAction[] }>(`/api/candidates/${encodeURIComponent(record.id)}/actions${qs({ orgId })}`, { signal: ctrl.signal }).then(res => {
            if (ctrl.signal.aborted) return;
            if (res.ok) setState({ id: record.id, actions: res.data.actions });
            else if (res.noAccess) reportError(res);
        });
        return () => ctrl.abort();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [key]);
    const every = state?.id === record.id ? state.actions : null;
    const onlyPosition = !!position && scope === 'position';
    const actions = every && position && onlyPosition ? every.filter(a => a.positionId === position.id) : every;

    const add = async () => {
        const remark = text.trim();
        if (!remark || busy) return;
        setBusy(true);
        // In this position's view, the remark is filed under the position, so it shows where it was typed.
        const res = await api<{ actions: CandidateAction[] }>(`/api/candidates/${encodeURIComponent(record.id)}/actions`, { json: { orgId, remark, ...(position && onlyPosition ? { positionId: position.id } : {}) } });
        setBusy(false);
        if (!res.ok) { notify(res.error, 'error'); if (res.noAccess) reportError(res); return; }
        setText('');
        setState({ id: record.id, actions: res.data.actions });
    };

    return (
        <section aria-label="Activity" className="mt-5">
            <div className="flex items-center justify-between">
                <p className={LABEL}>Activity</p>
                {actions && actions.length > 0 && <span className="text-xs text-text-tertiary">{actions.length} {actions.length === 1 ? 'entry' : 'entries'} · nothing here is ever edited</span>}
            </div>
            {position && (
                <div role="group" aria-label="Which history" className="mt-2 inline-grid grid-cols-2 gap-x-1 rounded-xl bg-surface-elevated px-1 py-1 ring-1 ring-inset ring-border-subtle">
                    {([['position', position.title], ['all', 'Everything']] as const).map(([id, label]) => (
                        <button key={id} type="button" onClick={() => setScope(id)} aria-pressed={scope === id}
                            className={`h-8 max-w-[260px] truncate rounded-lg px-3 text-sm font-semibold transition-colors ${scope === id ? 'bg-surface text-text-primary shadow-[var(--w-shadow)]' : 'text-text-secondary hover:text-text-primary'}`}>
                            {label}{every ? <span className="ml-1.5 text-xs font-medium text-text-tertiary">{id === 'all' ? every.length : every.filter(a => a.positionId === position.id).length}</span> : null}
                        </button>
                    ))}
                </div>
            )}
            <div className={`${WELL} mt-2 flex items-end gap-x-2 gap-y-2 px-3 py-2.5`}>
                <label htmlFor="cand-add-remark" className="sr-only">Add a remark</label>
                <textarea ref={box} id="cand-add-remark" rows={1} maxLength={REMARK_MAX} value={text} onChange={e => setText(e.target.value)} placeholder="Add a remark"
                    onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void add(); }}
                    className="h-9 min-h-9 min-w-0 flex-1 resize-y rounded-lg border border-border bg-surface px-2.5 py-1.5 text-sm text-text-primary outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" />
                <button type="button" onClick={() => void add()} disabled={busy || !text.trim()} className={`${BTN_GHOST} text-primary-dark`}>{busy ? <Spinner className="h-4 w-4" /> : <MessageSquareText className="h-4 w-4" />}Add</button>
            </div>
            {!actions ? (
                <p className="mt-3 flex items-center gap-x-2 text-sm text-text-tertiary"><Spinner className="h-3.5 w-3.5" />Loading</p>
            ) : actions.length === 0 ? (
                <p className="mt-3 text-sm text-text-tertiary">{position && onlyPosition ? `Nothing filed under ${position.title} yet. Stage moves, interviews, feedback and remarks typed here show here; Everything shows the rest.` : 'No history yet. Status changes, remarks and blacklisting appear here from now on.'}</p>
            ) : (
                <ol className="mt-3 space-y-3 border-l-2 border-border-subtle pl-3.5">
                    {actions.map(a => (
                        <li key={a.id} className="text-sm">
                            <p className="flex flex-wrap items-baseline gap-x-2">
                                <span className="font-semibold text-text-primary">{labelOf(a)}</span>
                                <span className="text-xs text-text-tertiary">{formatDate(a.at)}{a.byName ? ` · ${a.byName}` : ''}</span>
                            </p>
                            <p className="text-text-primary">{describe(a)}</p>
                            {a.remark && <p className="mt-0.5 whitespace-pre-wrap break-words text-text-secondary">“{a.remark}”</p>}
                        </li>
                    ))}
                </ol>
            )}
        </section>
    );
}

/** The blacklist line on the panel, with the undo. */
export function BlacklistNote({ entry, busy, onRemove }: { entry: Blacklist; busy: boolean; onRemove: () => void }) {
    return (
        <div role="status" className="mt-4 rounded-xl bg-error/[.06] px-3.5 py-3 ring-1 ring-inset ring-error/30">
            <p className="text-sm font-semibold text-red-800">Blacklisted · {BLACKLIST_REASON_LABELS[entry.reason]}</p>
            <p className="mt-0.5 text-xs text-text-secondary">{formatDate(entry.at)}{entry.byName ? ` by ${entry.byName}` : ''}. Hidden from every search until removed.</p>
            {entry.remark && <p className="mt-1 whitespace-pre-wrap break-words text-sm text-text-primary">“{entry.remark}”</p>}
            <button type="button" onClick={onRemove} disabled={busy} className={`${BTN_GHOST} mt-1.5 -ml-2.5 text-primary-dark`}>{busy ? <Spinner className="h-4 w-4" /> : <ShieldOff className="h-4 w-4" />}Remove from blacklist</button>
        </div>
    );
}
