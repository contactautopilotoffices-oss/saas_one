'use client';

import React, { useState } from 'react';
import { AlertTriangle, Eye, Send } from 'lucide-react';
import type { CampaignSummary } from '@/backend/lib/candidates/outreach-campaigns';
import { api } from './api';
import { formatCount } from './format';
import { useOutreachChoices } from './OutreachView';
import { BTN_GHOST, BTN_PRIMARY, BTN_SECONDARY, Dialog, INPUT, LABEL, Spinner, useUi, WELL } from './ui';

export default function BulkOutreachDialog({ orgId, applicationIds, open, onClose }: { orgId: string; applicationIds: string[]; open: boolean; onClose: () => void }) {
    const { notify } = useUi();
    const { state, error } = useOutreachChoices(orgId, open);
    const [positionId, setPositionId] = useState('');
    const [whatsapp, setWhatsapp] = useState(false);
    const [email, setEmail] = useState(false);
    const [mailbox, setMailbox] = useState('');
    const [preview, setPreview] = useState<{ whatsapp: string | null; email: { subject: string; body: string } | null; gaps: string[] } | null>(null);
    const [busy, setBusy] = useState<'preview' | 'send' | null>(null);
    const [progress, setProgress] = useState<CampaignSummary | null>(null);
    const [seenOpen, setSeenOpen] = useState(open);
    if (open !== seenOpen) {
        setSeenOpen(open);
        if (open) { setPreview(null); setProgress(null); setWhatsapp(false); setEmail(false); setPositionId(''); setMailbox(''); }
    }
    const wa = state?.settings.templates.find(t => t.id === 'wa_job_opening' && t.channel === 'whatsapp');
    const em = state?.settings.templates.find(t => t.id === 'email_job_opening' && t.channel === 'email');
    const chosenWa = whatsapp ? wa?.id : null;
    const chosenEm = email ? em?.id : null;
    const chosenMailbox = mailbox || state?.mailboxes[0]?.id || '';
    const body = { orgId, applicationIds, positionId: positionId || null, whatsappTemplateId: chosenWa || null, emailTemplateId: chosenEm || null, mailConnectionId: chosenEm ? chosenMailbox || null : null };
    const position = state?.positions.find(p => p.id === positionId);
    const ready = !!position?.location?.trim() && (!whatsapp || !!wa) && (!email || !!em) && (whatsapp || email);
    const needsMailbox = !!chosenEm && !state?.mailboxes.length;

    const doPreview = async () => {
        setBusy('preview');
        const res = await api<NonNullable<typeof preview>>('/api/candidates/outreach/campaigns', { json: { ...body, action: 'preview' } });
        setBusy(null);
        if (!res.ok) { notify(res.error, 'error'); return; }
        setPreview(res.data);
    };
    const send = async () => {
        setBusy('send');
        const res = await api<{ campaign: CampaignSummary; done: boolean }>('/api/candidates/outreach/campaigns', { json: { ...body, action: 'send' } });
        if (!res.ok) { setBusy(null); notify(res.error, 'error'); return; }
        let campaign = res.data.campaign;
        let done = res.data.done;
        setProgress(campaign);
        // The next batches while the dialog stays open (closing it leaves the rest to the hourly job).
        for (let i = 0; !done && i < 60; i += 1) {
            const next = await api<{ campaign: CampaignSummary; done: boolean }>(`/api/candidates/outreach/campaigns/${encodeURIComponent(campaign.id)}`, { json: { orgId, action: 'continue' } });
            if (!next.ok) { notify(next.error, 'error'); break; }
            campaign = next.data.campaign;
            done = next.data.done;
            setProgress(campaign);
        }
        setBusy(null);
        const c = campaign.counts;
        notify(`${formatCount(c.sent)} sent${c.failed + c.unknown ? `, ${formatCount(c.failed + c.unknown)} failed` : ''}${c.skipped ? `, ${formatCount(c.skipped)} skipped` : ''}. Details under Outreach → Sends.`, c.failed + c.unknown ? 'info' : 'success');
    };

    const people = `${formatCount(applicationIds.length)} ${applicationIds.length === 1 ? 'candidate' : 'candidates'}`;
    return (
        <Dialog open={open} onClose={() => { if (busy !== 'send') onClose(); }} labelId="bulk-outreach-title" size="lg" title={`Send a message to ${people}`}
            description="Each person gets their own copy, and their own application form link. Blacklisted people and anyone without a valid number or email are skipped."
            footer={progress ? <button type="button" onClick={onClose} disabled={busy === 'send'} className={BTN_PRIMARY}>{busy === 'send' ? <><Spinner />Sending…</> : 'Close'}</button> : <>
                <button type="button" onClick={onClose} className={BTN_GHOST}>Cancel</button>
                <button type="button" onClick={() => void doPreview()} disabled={!!busy || !ready} className={BTN_SECONDARY}>{busy === 'preview' ? <Spinner /> : <Eye className="h-4 w-4" />}Preview</button>
                <button type="button" onClick={() => void send()} disabled={!!busy || !ready || needsMailbox} className={BTN_PRIMARY}><Send className="h-4 w-4" />Send to {people}</button>
            </>}>
            {error && <p className="text-sm text-error">{error}</p>}
            {!state && !error && <p className="flex items-center gap-2 text-sm text-text-tertiary"><Spinner className="h-3.5 w-3.5" />Loading</p>}
            {state && !progress && (
                <div className="space-y-4">
                    <label className="block"><span className={LABEL}>Position (the role, location and application link in the message)</span>
                        <select value={positionId} onChange={e => { setPositionId(e.target.value); setPreview(null); }} className={`${INPUT} mt-1`}>
                            <option value="">Choose a position</option>
                            {state.positions.map(p => <option key={p.id} value={p.id}>{p.title}{p.location ? ` · ${p.location}` : ''}</option>)}
                        </select>
                    </label>
                    {position && !position.location?.trim() && <p role="status" className="text-sm text-warning">Add a location to this position before sending.</p>}
                    <fieldset>
                        <legend className={LABEL}>Job opening with application link</legend>
                        <div className="mt-2 grid gap-3 sm:grid-cols-2">
                            <label className={`${WELL} flex items-center gap-2 p-3 text-sm font-medium`}>
                                <input type="checkbox" checked={whatsapp} disabled={!wa || !!busy} className="accent-primary" onChange={e => { setWhatsapp(e.target.checked); setPreview(null); }} />WhatsApp
                            </label>
                            <label className={`${WELL} flex items-center gap-2 p-3 text-sm font-medium`}>
                                <input type="checkbox" checked={email} disabled={!em || !!busy} className="accent-primary" onChange={e => { setEmail(e.target.checked); setPreview(null); }} />Email
                            </label>
                        </div>
                    </fieldset>
                    {(!wa || !em) && <p role="status" className="text-sm text-warning">A job-opening template is missing. Check Outreach → Templates.</p>}
                    {chosenEm && (state.mailboxes.length > 1
                        ? <label className="block"><span className={LABEL}>Send from</span><select value={chosenMailbox} onChange={e => setMailbox(e.target.value)} className={`${INPUT} mt-1`}>{state.mailboxes.map(b => <option key={b.id} value={b.id}>{b.address}</option>)}</select></label>
                        : state.mailboxes.length === 1 ? <p className="text-xs text-text-secondary">Sent from {state.mailboxes[0].address}.</p>
                            : <p className="flex items-center gap-1.5 text-sm text-warning"><AlertTriangle className="h-4 w-4" />Connect Zoho Mail for sending first (the button at the top of Recruitment).</p>)}
                    {preview && (
                        <div className="space-y-3">
                            <p className={LABEL}>Preview, for the first person</p>
                            {preview.whatsapp && <div className={`${WELL} whitespace-pre-wrap px-3 py-2 text-sm text-text-primary`}><span className="mb-1 block text-xs font-semibold text-success">WhatsApp</span>{preview.whatsapp}</div>}
                            {preview.email && <div className={`${WELL} whitespace-pre-wrap px-3 py-2 text-sm text-text-primary`}><span className="mb-1 block text-xs font-semibold text-info">Email · {preview.email.subject}</span>{preview.email.body}</div>}
                            {preview.gaps.length > 0 && <p className="flex items-start gap-1.5 text-sm text-warning"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />Nothing to fill {preview.gaps.map(g => `{{${g}}}`).join(', ')}{preview.gaps.some(g => g === 'role' || g === 'location') ? ': choose a position' : ''}. People whose message would have a gap are skipped.</p>}
                        </div>
                    )}
                </div>
            )}
            {progress && (
                <div className="space-y-2 text-sm">
                    <p className="font-semibold text-text-primary">{progress.status === 'done' ? 'Done' : 'Sending…'}</p>
                    <p className="tabular-nums text-text-secondary">{formatCount(progress.counts.sent)} sent · {formatCount(progress.counts.failed + progress.counts.unknown)} failed · {formatCount(progress.counts.skipped)} skipped · {formatCount(progress.counts.queued + progress.counts.sending)} waiting</p>
                    {progress.status !== 'done' && <p className="text-xs text-text-tertiary">You can close this; whatever is left goes out within the hour. Results are under Outreach → Sends.</p>}
                </div>
            )}
        </Dialog>
    );
}
