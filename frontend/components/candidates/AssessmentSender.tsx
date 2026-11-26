'use client';

import React, { useEffect, useState } from 'react';
import type { AssessmentChoice, AssessmentInvite } from '@/backend/lib/candidates/assessments';
import type { CandidateRecord } from '@/backend/lib/candidates/types';
import { api, qs } from './api';
import { BTN_GHOST, BTN_PRIMARY, BTN_SECONDARY, INPUT, LABEL, Spinner, WELL } from './ui';

type Data = { tests: AssessmentChoice[]; receipts: AssessmentInvite[]; connections: { id: string; address: string }[] };
export default function AssessmentSender({ orgId, record, onSent, onClose }: { orgId: string; record: CandidateRecord; onSent: () => void; onClose: () => void }) {
    const [data, setData] = useState<Data | null>(null);
    const [testId, setTestId] = useState('');
    const [connectionId, setConnectionId] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [uncertain, setUncertain] = useState(false);
    const [nonce, setNonce] = useState(0);
    useEffect(() => {
        const ctrl = new AbortController();
        void api<Data>(`/api/candidates/assessments${qs({ orgId, applicationId: record.id })}`, { signal: ctrl.signal }).then(res => {
            if (ctrl.signal.aborted) return;
            if (!res.ok) { setError(res.error); return; }
            setData(res.data); setError(''); setUncertain(false);
            setConnectionId(id => res.data.connections.some(c => c.id === id) ? id : res.data.connections[0]?.id ?? '');
        });
        return () => ctrl.abort();
    }, [orgId, record.id, nonce]);
    const test = data?.tests.find(t => t.id === testId);
    const receipt = (channel: AssessmentInvite['channel']) => data?.receipts.find(r => r.test_id === testId && r.channel === channel);
    const canSend = (channel: AssessmentInvite['channel']) => !!test && !busy && !uncertain && !record.blacklisted && (!receipt(channel) || receipt(channel)?.status === 'failed');
    const send = async (channel: AssessmentInvite['channel']) => {
        if (!canSend(channel)) return;
        setBusy(true); setError('');
        const res = await api<{ invite: AssessmentInvite }>('/api/candidates/assessments', { json: { orgId, applicationId: record.id, testId, channel, ...(channel === 'email' ? { connectionId } : {}) } });
        setBusy(false);
        if (!res.ok) { setError(`${res.error} Refresh delivery status before retrying.`); setUncertain(true); return; }
        setData(d => d ? { ...d, receipts: [...d.receipts.filter(r => r.id !== res.data.invite.id), res.data.invite] } : d);
        if (res.data.invite.status === 'sent') onSent();
    };
    return <section aria-label="Send assessment" className={`${WELL} p-4 space-y-3`}>
        <div className="flex items-center justify-between gap-2"><h3 className="font-semibold">Send assessment</h3><button type="button" className={BTN_GHOST} onClick={onClose} disabled={busy}>Close</button></div>
        {error && <p role="alert" className="text-sm text-error">{error}</p>}
        {!data && !error && <p className="flex items-center gap-2 text-sm"><Spinner />Loading assessments</p>}
        {data && <>
            <label className={LABEL} htmlFor="candidate-assessment">Assessment</label>
            <select id="candidate-assessment" className={INPUT} value={testId} disabled={busy} onChange={e => setTestId(e.target.value)}>
                <option value="">Select an assessment</option>
                {data.tests.map(t => <option key={t.id} value={t.id}>{t.title} ({t.duration} minutes)</option>)}
            </select>
            {!data.tests.length && <p className="text-sm">No active assessments. Create or activate one in the Assessments module first.</p>}
            {test && <>
                <p className="text-sm">Send <strong>{test.title}</strong> to <strong>{record.fullName}</strong>. The candidate opens the link and enters their name and email to take the assessment.</p>
                <a href={test.url} target="_blank" rel="noopener noreferrer" className="block break-all text-sm text-primary-dark underline">{test.url}</a>
                <label className={LABEL} htmlFor="assessment-mailbox">Send email from</label>
                <select id="assessment-mailbox" className={INPUT} value={connectionId} disabled={busy} onChange={e => setConnectionId(e.target.value)}>
                    {!data.connections.length && <option value="">No mailbox connected for sending</option>}
                    {data.connections.map(c => <option key={c.id} value={c.id}>{c.address}</option>)}
                </select>
                {!data.connections.length && <p className="text-xs">Connect Zoho for sending in Recruitment → Email to use email here.</p>}
                <p className="text-xs">Email: {record.email || 'Missing'} · WhatsApp: {record.phone || 'Missing'}</p>
                <div className="flex flex-wrap gap-2">
                    <button type="button" className={BTN_PRIMARY} disabled={!canSend('email') || !record.email || !connectionId} onClick={() => void send('email')}>{busy && <Spinner />}Send by email</button>
                    <button type="button" className={BTN_SECONDARY} disabled={!canSend('whatsapp') || !record.phone} onClick={() => void send('whatsapp')}>Send on WhatsApp</button>
                </div>
                {(['email', 'whatsapp'] as const).map(channel => { const r = receipt(channel); return r && <p key={channel} role="status" className={`text-sm ${r.status === 'sent' ? 'text-green-800' : 'text-amber-800'}`}>
                    {channel === 'email' ? 'Email' : 'WhatsApp'}: {r.status === 'sent' ? `sent to ${r.recipient}` : r.status === 'failed' ? `not sent. ${r.error ?? ''} You can retry.` : 'delivery not confirmed; check Zoho Sent or AiSensy before sending again.'}
                </p>; })}
            </>}
        </>}
        <button type="button" className={BTN_GHOST} disabled={busy} onClick={() => setNonce(n => n + 1)}>Refresh delivery status</button>
    </section>;
}
