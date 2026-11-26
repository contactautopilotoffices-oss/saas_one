'use client';

import React, { useEffect, useState } from 'react';
import { Check, MessageCircle, X } from 'lucide-react';
import { oneLine, STAGE_MESSAGE_MAX } from '@/backend/lib/candidates/stage-list';
import type { CandidateRecord, OutreachPreview, OutreachRecord } from '@/backend/lib/candidates/types';
import { api, qs } from './api';
import { formatDate } from './format';
import { BTN_GHOST, BTN_PRIMARY, Dialog, INPUT, LABEL, Spinner, useUi, WELL } from './ui';

/*
 * Outreach on WhatsApp (owner 2026-11-16, mockup board 7). One body, two homes: a dialog that opens right after a
 * card is dropped on a stage marked for WhatsApp (PipelineView, the pipeline panel), and the "Send update" section in
 * the candidate's panel (CandidateDetails), where the position is chosen first. A person clicks Send every time.
 *
 * Owner 2026-11-19, editable messages: the message is the Meta-approved stage update template; its opening and
 * closing are fixed, and the middle is HR's text, prefilled from the stage's default (Configurations) and edited here.
 * It is about the stage the person is in now, in that position.
 */

function CheckLine({ ok, label, soft = false }: { ok: boolean; label: string; soft?: boolean }) {
    return (
        <li className="flex items-center gap-x-2 text-sm text-text-primary">
            <span className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full ${ok ? 'bg-success/15 text-green-800' : soft ? 'bg-warning/15 text-amber-800' : 'bg-error/10 text-red-800'}`} aria-hidden>
                {ok ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
            </span>
            <span className="sr-only">{ok ? 'Yes: ' : soft ? 'Warning: ' : 'No: '}</span>{label}
        </li>
    );
}

/**
 * The message (with HR's text to edit), the checks and the Send button for one (record, position). Fetches its own
 * preview; nothing is sent until Send is clicked, and the server runs the same checks again.
 */
export function OutreachBody({ orgId, record, positionId, onSent, onSkip, skipLabel = 'Skip for now' }: {
    orgId: string; record: CandidateRecord; positionId: string;
    onSent: (sent: OutreachRecord) => void; onSkip: () => void; skipLabel?: string;
}) {
    const { notify, reportError } = useUi();
    const [state, setState] = useState<{ key: string; preview: OutreachPreview | null; error: string } | null>(null);
    const key = JSON.stringify([orgId, record.id, positionId]);
    // HR's text: the stage's default until edited (null = not edited yet).
    const [edited, setEdited] = useState<{ key: string; text: string } | null>(null);
    useEffect(() => {
        const ctrl = new AbortController();
        void api<{ preview: OutreachPreview }>(`/api/candidates/outreach/preview${qs({ orgId, applicationId: record.id, positionId, kind: 'stage_update' })}`, { signal: ctrl.signal }).then(res => {
            if (ctrl.signal.aborted) return;
            if (res.ok) setState({ key, preview: res.data.preview, error: '' });
            else { if (res.noAccess) reportError(res); setState({ key, preview: null, error: res.error }); }
        });
        return () => ctrl.abort();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [key]);
    const preview = state?.key === key ? state.preview : null;
    const error = state?.key === key ? state.error : '';
    const update = preview?.stageUpdate ?? null;
    const text = edited?.key === key ? edited.text : update?.defaultText ?? '';
    const clean = oneLine(text);
    const tooLong = clean.length > STAGE_MESSAGE_MAX;

    const [busy, setBusy] = useState(false);
    const send = async () => {
        if (!preview?.canSend || busy || !clean || tooLong) return;
        setBusy(true);
        const res = await api<{ outreach: OutreachRecord }>('/api/candidates/outreach', { json: { orgId, applicationId: record.id, positionId, kind: 'stage_update', message: clean } });
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
                        <div className="min-w-0">
                            {update && (
                                <>
                                    <label htmlFor="cand-outreach-text" className={LABEL}>Your update · about <span className="font-semibold text-text-primary">{update.stageName}</span></label>
                                    <textarea id="cand-outreach-text" rows={3} value={text} onChange={e => setEdited({ key, text: e.target.value })} disabled={busy}
                                        placeholder="e.g. Your L1 interview is with the Finance Head on Friday at 11 am. Please bring your ID proof."
                                        className={`${INPUT} mt-1.5 h-auto min-h-[84px] resize-y py-2 leading-relaxed`} />
                                    <p className={`mt-1 flex flex-wrap justify-between gap-x-2 text-xs ${tooLong ? 'font-medium text-red-800' : 'text-text-tertiary'}`}>
                                        <span>{!update.defaultText ? 'This stage has no default text: write one here, or set it in Configurations.' : 'Prefilled from Configurations. Edit it for this candidate.'} Sent as one paragraph.</span>
                                        <span className="tabular-nums">{clean.length}/{STAGE_MESSAGE_MAX}</span>
                                    </p>
                                </>
                            )}
                            <p className={`${LABEL} mt-3`}>WhatsApp preview{preview.phoneMasked ? ` · to +91 ${preview.phoneMasked}` : ''} · via AiSensy</p>
                            <div className="relative mt-2 max-w-[440px] rounded-xl bg-[#E7F8EF] px-4 py-3 text-sm leading-relaxed text-text-primary">
                                {update ? (
                                    <p className="whitespace-pre-wrap">{update.opening}{'\n\n'}<span className={clean ? 'rounded bg-white/70 px-0.5' : 'italic text-text-tertiary'}>{clean || '[your update]'}</span>{'\n\n'}{update.closing}</p>
                                ) : <p className="whitespace-pre-wrap">{preview.message}</p>}
                                <p className="mt-2 text-[11px] text-text-secondary">{preview.footer}</p>
                            </div>
                            <p className="mt-2 text-xs text-text-tertiary">The opening and closing are the Meta-approved template <span className="font-medium text-text-secondary">{preview.campaign}</span>; only the highlighted part is your text.</p>
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
                <button type="button" onClick={() => void send()} disabled={busy || !preview?.canSend || !clean || tooLong} className={BTN_PRIMARY}>{busy ? <Spinner /> : <MessageCircle className="h-4 w-4" />}Send on WhatsApp</button>
            </div>
        </div>
    );
}

/** Right after a drop on a stage marked for WhatsApp: "Tell them?" */
export function OutreachDialog({ orgId, open, record, positionId, positionTitle, stageName, movedRemark, onClose, onSent }: {
    orgId: string; open: boolean; record: CandidateRecord | null; positionId: string | null; positionTitle: string | null; stageName: string;
    movedRemark?: string | null; onClose: () => void; onSent: (sent: OutreachRecord) => void;
}) {
    return (
        <Dialog
            open={open && !!record}
            onClose={onClose}
            labelId="cand-outreach-title"
            size="lg"
            title={record ? `${record.fullName} is now ${stageName}. Tell ${record.fullName.split(' ')[0]}?` : ''}
            description={[positionTitle, movedRemark ? `“${movedRemark}”` : null].filter(Boolean).join(' · ') || undefined}
        >
            {record && positionId && <div className="@container"><OutreachBody orgId={orgId} record={record} positionId={positionId} onSent={onSent} onSkip={onClose} /></div>}
        </Dialog>
    );
}

/** In the candidate's panel: pick the position, then the same body (an update about their stage there). */
export function OutreachSection({ orgId, record, onClose, onSent }: { orgId: string; record: CandidateRecord; onClose: () => void; onSent: (sent: OutreachRecord) => void }) {
    const [positionId, setPositionId] = useState<string>('');
    const [memberships, setMemberships] = useState<{ id: string; rows: { position: { id: string; title: string; location: string | null; status: 'open' | 'closed' }; member: { stage: string } }[] } | null>(null);
    useEffect(() => {
        const ctrl = new AbortController();
        void api<{ memberships: NonNullable<typeof memberships>['rows'] }>(`/api/candidates/${encodeURIComponent(record.id)}/positions${qs({ orgId })}`, { signal: ctrl.signal }).then(res => {
            if (ctrl.signal.aborted) return;
            const rows = res.ok ? res.data.memberships : [];
            setMemberships({ id: record.id, rows });
            // The first position they are in (the latest move first).
            const first = rows[0];
            if (first) setPositionId(first.position.id);
        });
        return () => ctrl.abort();
    }, [orgId, record.id]);
    const rows = memberships?.id === record.id ? memberships.rows : null;

    return (
        <section className={`${WELL} @container px-4 py-4`} aria-label="Send update">
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <span className="text-sm font-semibold text-text-primary">Send update on WhatsApp</span>
                <span className="text-xs text-text-secondary">about their stage in the position · a person sends it, every time</span>
            </div>
            {rows && rows.length === 0 ? (
                <div className="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
                    <p className="text-sm text-text-secondary">Add {record.fullName.split(' ')[0]} to a position first: the update is about their stage there.</p>
                    <button type="button" onClick={onClose} className={BTN_GHOST}>Close</button>
                </div>
            ) : (
                <>
                    <div className="mt-3">
                        <label htmlFor="cand-outreach-position" className="sr-only">Position</label>
                        <select id="cand-outreach-position" value={positionId} onChange={e => setPositionId(e.target.value)} disabled={!rows} className={INPUT}>
                            {!rows && <option value="">Loading the positions</option>}
                            {(rows ?? []).map(({ position }) => <option key={position.id} value={position.id}>{position.title}{position.location ? ` · ${position.location}` : ''}{position.status === 'closed' ? ' · closed' : ''}</option>)}
                        </select>
                    </div>
                    {positionId && (
                        <div className="mt-4">
                            <OutreachBody orgId={orgId} record={record} positionId={positionId} onSent={onSent} onSkip={onClose} skipLabel="Cancel" />
                        </div>
                    )}
                </>
            )}
        </section>
    );
}
