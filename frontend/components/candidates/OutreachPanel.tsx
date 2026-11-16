'use client';

import React, { useEffect, useState } from 'react';
import { Check, MessageCircle, X } from 'lucide-react';
import { OUTREACH_KIND_LABELS, OUTREACH_KINDS, type CandidateRecord, type OutreachKind, type OutreachPreview, type OutreachRecord, type Stage } from '@/backend/lib/candidates/types';
import { api, qs } from './api';
import { formatDate } from './format';
import { BTN_GHOST, BTN_PRIMARY, BTN_SECONDARY, Dialog, INPUT, LABEL, Spinner, useUi, WELL } from './ui';

/*
 * Outreach on WhatsApp (owner 2026-11-16, mockup board 7). One body, two homes: a dialog that opens right after a
 * card is dropped on Shortlisted or Rejected (PipelineView), and the "Send update" section in the candidate's panel
 * (CandidateDetails), where the kind and the position are chosen first. The message is the Meta-approved template
 * with the name and role filled in; a person clicks Send every time.
 */

/** The outreach kind a stage maps to, if any. */
export function outreachKindFor(stage: Stage): OutreachKind | null {
    return stage === 'shortlisted' ? 'shortlisted' : stage === 'rejected' ? 'not_shortlisted' : null;
}

const KIND_DOT: Record<OutreachKind, string> = { shortlisted: 'bg-secondary', not_shortlisted: 'bg-error' };

function CheckLine({ ok, label, soft = false }: { ok: boolean; label: string; soft?: boolean }) {
    return (
        <li className="flex items-center gap-x-2 text-sm text-text-primary">
            <span className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full ${ok ? 'bg-success/15 text-emerald-800' : soft ? 'bg-warning/15 text-amber-800' : 'bg-error/10 text-red-800'}`} aria-hidden>
                {ok ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
            </span>
            <span className="sr-only">{ok ? 'Yes: ' : soft ? 'Warning: ' : 'No: '}</span>{label}
        </li>
    );
}

/**
 * The preview, the checks and the Send button for one (record, position, kind). Fetches its own preview; nothing
 * is sent until Send is clicked, and the server runs the same checks again.
 */
export function OutreachBody({ orgId, record, positionId, kind, onSent, onSkip, skipLabel = 'Skip for now' }: {
    orgId: string; record: CandidateRecord; positionId: string | null; kind: OutreachKind;
    onSent: (sent: OutreachRecord) => void; onSkip: () => void; skipLabel?: string;
}) {
    const { notify, reportError } = useUi();
    const [state, setState] = useState<{ key: string; preview: OutreachPreview | null; error: string } | null>(null);
    const key = JSON.stringify([orgId, record.id, positionId, kind]);
    useEffect(() => {
        const ctrl = new AbortController();
        void api<{ preview: OutreachPreview }>(`/api/candidates/outreach/preview${qs({ orgId, applicationId: record.id, positionId, kind })}`, { signal: ctrl.signal }).then(res => {
            if (ctrl.signal.aborted) return;
            if (res.ok) setState({ key, preview: res.data.preview, error: '' });
            else { if (res.noAccess) reportError(res); setState({ key, preview: null, error: res.error }); }
        });
        return () => ctrl.abort();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [key]);
    const preview = state?.key === key ? state.preview : null;
    const error = state?.key === key ? state.error : '';

    const [busy, setBusy] = useState(false);
    const send = async () => {
        if (!preview?.canSend || busy) return;
        setBusy(true);
        const res = await api<{ outreach: OutreachRecord }>('/api/candidates/outreach', { json: { orgId, applicationId: record.id, positionId, kind } });
        setBusy(false);
        if (!res.ok) { notify(res.error, 'error'); if (res.noAccess) reportError(res); return; }
        notify(`WhatsApp sent to ${record.fullName}`, 'success');
        onSent(res.data.outreach);
    };

    return (
        <div className="space-y-4">
            {!preview && !error && <p className="flex items-center gap-x-2 text-sm text-text-tertiary"><Spinner className="h-3.5 w-3.5" />Preparing the message</p>}
            {error && <p role="alert" className="text-sm text-error">{error}</p>}
            {preview && (
                <>
                    <div className="grid gap-x-4 gap-y-4 @2xl:grid-cols-[minmax(0,1fr)_220px]">
                        <div>
                            <p className={LABEL}>WhatsApp preview{preview.phoneMasked ? ` · to +91 ${preview.phoneMasked}` : ''} · via AiSensy</p>
                            <div className="relative mt-2 max-w-[440px] rounded-xl bg-[#E7F8EF] px-4 py-3 text-sm leading-relaxed text-text-primary">
                                <p className="whitespace-pre-wrap">{preview.message}</p>
                                <p className="mt-2 text-[11px] text-text-secondary">{preview.footer}</p>
                            </div>
                            <p className="mt-2 text-xs text-text-tertiary">The wording is the Meta-approved template <span className="font-medium text-text-secondary">{preview.campaign}</span>; only the name and the role change, so nothing typed by hand reaches the candidate.</p>
                        </div>
                        <div className={`${WELL} px-4 py-3`}>
                            <p className={LABEL}>Checks</p>
                            <ul className="mt-2 space-y-1.5">
                                <CheckLine ok={preview.checks.notBlacklisted} label="Not blacklisted" />
                                <CheckLine ok={preview.checks.phoneValid} label="Mobile number on record" />
                                <CheckLine ok={preview.checks.notSentBefore} label={preview.sentBefore ? `Already told on ${formatDate(preview.sentBefore.at)}${preview.sentBefore.byName ? ` by ${preview.sentBefore.byName}` : ''}` : preview.positionTitle ? `Not told before for ${preview.positionTitle}` : 'Not told before'} />
                                <CheckLine ok={preview.checks.roleNamed} label={preview.roleTitle ? `Role: ${preview.roleTitle}` : 'No role to name'} />
                                <CheckLine ok={preview.checks.withinHours} label={preview.checks.withinHours ? 'Within 9 am – 7 pm IST' : 'Outside 9 am – 7 pm IST'} soft />
                            </ul>
                            <p className="mt-2 text-xs text-text-tertiary">Recorded in Activity: who sent it and when.</p>
                        </div>
                    </div>
                    {preview.blockedBy && <p role="status" className="text-sm font-medium text-red-800">{preview.blockedBy}</p>}
                </>
            )}
            <div className="flex flex-wrap items-center justify-end gap-x-2 gap-y-2">
                <button type="button" onClick={onSkip} disabled={busy} className={BTN_GHOST}>{skipLabel}</button>
                <button type="button" onClick={() => void send()} disabled={busy || !preview?.canSend} className={BTN_PRIMARY}>{busy ? <Spinner /> : <MessageCircle className="h-4 w-4" />}Send on WhatsApp</button>
            </div>
        </div>
    );
}

/** Right after a drop on Shortlisted or Rejected: "Tell them?" */
export function OutreachDialog({ orgId, open, record, positionId, positionTitle, kind, movedRemark, onClose, onSent }: {
    orgId: string; open: boolean; record: CandidateRecord | null; positionId: string | null; positionTitle: string | null; kind: OutreachKind;
    movedRemark?: string | null; onClose: () => void; onSent: (sent: OutreachRecord) => void;
}) {
    return (
        <Dialog
            open={open && !!record}
            onClose={onClose}
            labelId="cand-outreach-title"
            size="lg"
            title={record ? `${record.fullName} is now ${OUTREACH_KIND_LABELS[kind]}. Tell ${record.fullName.split(' ')[0]}?` : ''}
            description={[positionTitle, movedRemark ? `“${movedRemark}”` : null].filter(Boolean).join(' · ') || undefined}
        >
            {record && <div className="@container"><OutreachBody orgId={orgId} record={record} positionId={positionId} kind={kind} onSent={onSent} onSkip={onClose} /></div>}
        </Dialog>
    );
}

/** In the candidate's panel: pick the message and the position, then the same body. */
export function OutreachSection({ orgId, record, onClose, onSent }: { orgId: string; record: CandidateRecord; onClose: () => void; onSent: (sent: OutreachRecord) => void }) {
    const [kind, setKind] = useState<OutreachKind>('shortlisted');
    const [positionId, setPositionId] = useState<string>('');
    const [memberships, setMemberships] = useState<{ id: string; rows: { position: { id: string; title: string; location: string | null; status: 'open' | 'closed' }; member: { stage: Stage } }[] } | null>(null);
    useEffect(() => {
        const ctrl = new AbortController();
        void api<{ memberships: NonNullable<typeof memberships>['rows'] }>(`/api/candidates/${encodeURIComponent(record.id)}/positions${qs({ orgId })}`, { signal: ctrl.signal }).then(res => {
            if (ctrl.signal.aborted) return;
            const rows = res.ok ? res.data.memberships : [];
            setMemberships({ id: record.id, rows });
            // The first position they are in, and the kind their stage there suggests.
            const first = rows[0];
            if (first) { setPositionId(first.position.id); setKind(outreachKindFor(first.member.stage) ?? 'shortlisted'); }
        });
        return () => ctrl.abort();
    }, [orgId, record.id]);
    const rows = memberships?.id === record.id ? memberships.rows : null;

    return (
        <section className={`${WELL} @container px-4 py-4`} aria-label="Send update">
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <span className="text-sm font-semibold text-text-primary">Send update on WhatsApp</span>
                <span className="text-xs text-text-secondary">a Meta-approved template · a person sends it, every time</span>
            </div>
            <div className="mt-3 grid gap-x-3 gap-y-3 @2xl:grid-cols-2">
                <div role="group" aria-label="Message" className="grid grid-cols-2 gap-x-2">
                    {OUTREACH_KINDS.map(k => (
                        <button key={k} type="button" onClick={() => setKind(k)} aria-pressed={kind === k} className={`${BTN_SECONDARY} h-10 justify-start gap-x-2 px-3 text-sm ${kind === k ? 'ring-[1.5px] ring-inset ring-primary' : ''}`}>
                            <span className={`h-2 w-2 shrink-0 rounded-full ${KIND_DOT[k]}`} aria-hidden />{OUTREACH_KIND_LABELS[k]}
                        </button>
                    ))}
                </div>
                <div>
                    <label htmlFor="cand-outreach-position" className="sr-only">Position</label>
                    <select id="cand-outreach-position" value={positionId} onChange={e => setPositionId(e.target.value)} disabled={!rows} className={INPUT}>
                        <option value="">{rows && rows.length === 0 ? 'Not in a position (the record’s role is named)' : 'Not for a position'}</option>
                        {(rows ?? []).map(({ position }) => <option key={position.id} value={position.id}>{position.title}{position.location ? ` · ${position.location}` : ''}{position.status === 'closed' ? ' · closed' : ''}</option>)}
                    </select>
                </div>
            </div>
            <div className="mt-4">
                <OutreachBody orgId={orgId} record={record} positionId={positionId || null} kind={kind} onSent={onSent} onSkip={onClose} skipLabel="Cancel" />
            </div>
        </section>
    );
}
