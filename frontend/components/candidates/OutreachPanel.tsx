'use client';

import React, { useEffect, useState } from 'react';
import { Send } from 'lucide-react';
import { isSelectionStage, oneLine, STAGE_MESSAGE_MAX, type StageDef } from '@/backend/lib/candidates/stage-list';
import type { CampaignSummary } from '@/backend/lib/candidates/outreach-campaigns';
import type { CandidateRecord, OutreachPreview, StageNotification } from '@/backend/lib/candidates/types';
import { api, qs } from './api';
import { BTN_GHOST, BTN_PRIMARY, Dialog, INPUT, LABEL, Spinner, useUi, WELL } from './ui';

type UpdateProps = {
    orgId: string;
    record: CandidateRecord;
    positionId: string;
    stage: StageDef;
    notification: StageNotification;
    onSent: () => void;
};

export function OutreachBody({ orgId, record, positionId, stage, notification, onSent, onSkip }: UpdateProps & { onSkip: () => void }) {
    const { notify, reportError } = useUi();
    const [preview, setPreview] = useState<OutreachPreview | null>(null);
    const [waError, setWaError] = useState('');
    const [mail, setMail] = useState<{ address?: string; message?: string } | null>(null);
    const [whatsapp, setWhatsapp] = useState(false);
    const [email, setEmail] = useState(false);
    const [edited, setEdited] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [results, setResults] = useState<{ whatsapp?: string; email?: string } | null>(null);
    const expectedStage = stage.key;

    useEffect(() => {
        const ctrl = new AbortController();
        const signal = ctrl.signal;
        if (notification.whatsapp) {
            void api<{ preview: OutreachPreview }>(`/api/candidates/outreach/preview${qs({ orgId, applicationId: record.id, positionId, kind: 'stage_update', expectedStage })}`, { signal }).then(res => {
                if (signal.aborted) return;
                if (res.ok) setPreview(res.data.preview);
                else { setWaError(res.error); if (res.noAccess) reportError(res); }
            });
        }
        if (notification.emailTemplateId && record.email) {
            void api<{ mailboxes: { address: string }[] }>(`/api/candidates/outreach/campaigns${qs({ orgId })}`, { signal }).then(res => {
                if (signal.aborted) return;
                if (!res.ok && res.noAccess) reportError(res);
                const address = res.ok ? res.data.mailboxes[0]?.address : undefined;
                setMail({ address, message: res.ok ? 'Connect Zoho Mail to send email.' : res.error });
            });
        }
        return () => ctrl.abort();
    }, [orgId, record.id, record.email, positionId, expectedStage, notification.whatsapp, notification.emailTemplateId, reportError]);

    const update = preview?.stageUpdate;
    const text = edited ?? (update?.defaultText || (stage.kind === 'rejected'
        ? 'Thank you for your time. We have decided not to move forward with your application for this role.'
        : isSelectionStage(stage) ? 'We are pleased to let you know you are moving forward in the recruitment process. Our recruiter will share the next steps.' : ''));
    const clean = oneLine(text);
    const canSend = (whatsapp || email) && (!whatsapp || (preview?.canSend && clean.length > 0 && clean.length <= STAGE_MESSAGE_MAX)) && (!email || !!mail?.address);

    const send = async () => {
        if (!canSend || busy || results) return;
        setBusy(true);
        const [wa, em] = await Promise.all([
            whatsapp ? api('/api/candidates/outreach', { json: { orgId, applicationId: record.id, positionId, kind: 'stage_update', expectedStage, message: clean } }) : null,
            email ? api<{ campaign: CampaignSummary }>('/api/candidates/outreach/campaigns', { json: {
                orgId, action: 'send', applicationIds: [record.id], positionId, expectedStage, emailTemplateId: notification.emailTemplateId,
            } }) : null,
        ]);
        setBusy(false);
        if (wa && !wa.ok && wa.noAccess) reportError(wa);
        if (em && !em.ok && em.noAccess) reportError(em);
        const sentEmail = em?.ok && em.data.campaign.counts.sent > 0;
        if ((!wa || wa.ok) && (!em || sentEmail)) {
            notify(`Update sent to ${record.fullName}`, 'success');
            onSent();
            return;
        }
        setResults({
            whatsapp: wa ? (wa.ok ? 'Sent' : wa.error) : undefined,
            email: em ? (sentEmail ? 'Sent' : em.ok ? 'See Outreach → Sends for the delivery status.' : em.error) : undefined,
        });
    };

    return (
        <div className="space-y-4">
            <fieldset disabled={busy || !!results}>
                <legend className={LABEL}>Send via</legend>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    <label className={`${WELL} flex items-start gap-2 p-3 text-sm`}>
                        <input type="checkbox" checked={whatsapp} disabled={!preview?.canSend} onChange={e => setWhatsapp(e.target.checked)} className="mt-1 accent-primary" />
                        <span>WhatsApp<span className="block text-xs text-text-secondary">{!notification.whatsapp ? 'Unavailable for this stage' : waError || preview?.blockedBy || (preview ? (preview.checks.withinHours ? preview.phoneMasked : 'Outside 9 am – 7 pm IST') : 'Checking availability…')}</span></span>
                    </label>
                    <label className={`${WELL} flex items-start gap-2 p-3 text-sm`}>
                        <input type="checkbox" checked={email} disabled={!mail?.address} onChange={e => setEmail(e.target.checked)} className="mt-1 accent-primary" />
                        <span>Email<span className="block break-all text-xs text-text-secondary">{!notification.emailTemplateId ? 'Unavailable for this stage' : !record.email ? 'No email on record' : mail?.address || mail?.message || 'Checking mailbox…'}</span></span>
                    </label>
                </div>
            </fieldset>
            {whatsapp && update && (
                <div>
                    <label htmlFor="cand-outreach-text" className={LABEL}>WhatsApp message</label>
                    <textarea id="cand-outreach-text" rows={3} value={text} onChange={e => setEdited(e.target.value)} disabled={busy || !!results}
                        className={`${INPUT} mt-1.5 h-auto min-h-[84px] resize-y py-2`} />
                    <p className={`mt-1 text-xs ${clean.length > STAGE_MESSAGE_MAX ? 'text-error' : 'text-text-secondary'}`}>{clean.length}/{STAGE_MESSAGE_MAX} characters. Uses the approved WhatsApp template.</p>
                    <details className="mt-2 text-sm">
                        <summary className="cursor-pointer font-medium text-text-secondary">Preview WhatsApp</summary>
                        <p className={`${WELL} mt-2 whitespace-pre-wrap p-3 text-text-primary`}>{[update.opening, clean, update.closing].filter(Boolean).join('\n\n')}</p>
                    </details>
                </div>
            )}
            {results && <div className={`${WELL} space-y-1 px-3 py-2 text-sm`} role="status">
                {results.whatsapp && <p><strong>WhatsApp</strong> · {results.whatsapp}</p>}
                {results.email && <p><strong>Email</strong> · {results.email}</p>}
            </div>}
            <div className="flex flex-wrap justify-end gap-2">
                <button type="button" onClick={results ? onSent : onSkip} disabled={busy} className={BTN_GHOST}>{results ? 'Close' : 'Skip for now'}</button>
                {!results && <button type="button" onClick={() => void send()} disabled={busy || !canSend} className={BTN_PRIMARY}>{busy ? <Spinner /> : <Send className="h-4 w-4" />}Send</button>}
            </div>
        </div>
    );
}

export function OutreachDialog({ positionTitle, remark, onClose, ...update }: UpdateProps & {
    positionTitle: string; remark: string | null; onClose: () => void;
}) {
    return (
        <Dialog open onClose={onClose} labelId="cand-outreach-title" size="md"
            title={`Notify ${update.record.fullName}?`} description={[positionTitle, update.stage.name, remark].filter(Boolean).join(' · ')}>
            <OutreachBody {...update} onSkip={onClose} />
        </Dialog>
    );
}
