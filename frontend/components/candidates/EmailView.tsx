'use client';

import React, { useEffect, useState } from 'react';
import type { RecruitmentEmail } from '@/backend/lib/candidates/email';
import type { CandidateRecord } from '@/backend/lib/candidates/types';
import CandidatePicker from './CandidatePicker';
import EmailCandidateContext from './EmailCandidateContext';
import { api, qs } from './api';
import { BTN_GHOST, BTN_PRIMARY, BTN_SECONDARY, CARD, Dialog, FIELD, LABEL, Spinner } from './ui';
import { formatDate } from './format';

interface Mailbox { id: string; address: string; connected: boolean; active: boolean; can_send: boolean; folder_name: string | null; folder_id: string | null; email_scan_start: number }
interface Draft { id: string; candidateId?: string; replyToId?: string; subject: string; body: string }
const ENDPOINT = '/api/candidates/email';
export default function EmailView({ orgId, onSettings, onRequisitions }: { orgId: string; onSettings: () => void; onRequisitions: () => void }) {
  const [boxes, setBoxes] = useState<Mailbox[]>([]);
  const [boxId, setBoxId] = useState('');
  const [canRaise, setCanRaise] = useState(false);
  const [nonce, setNonce] = useState(0);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [candidate, setCandidate] = useState<CandidateRecord | null>(null);
  const [direction, setDirection] = useState('');
  const [page, setPage] = useState(1);
  const [loaded, setLoaded] = useState<{ key: string; messages: RecruitmentEmail[]; total: number } | null>(null);
  const [detail, setDetail] = useState<{ message: RecruitmentEmail; thread: RecruitmentEmail[]; requisitionId: string | null } | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [review, setReview] = useState<RecruitmentEmail | null>(null);
  const [request, setRequest] = useState<{ id: string; roleTitle: string; department: string; location: string; positions: string; budgetMaxCtc: string; justification: string } | null>(null);
  const box = boxes.find(b => b.id === boxId);
  const key = JSON.stringify([orgId, boxId, candidate?.candidateId, direction, page, nonce]);
  const messages = loaded?.key === key ? loaded.messages : [];
  const total = loaded?.key === key ? loaded.total : 0;
  useEffect(() => {
    const ctrl = new AbortController();
    void api<{ connections: Mailbox[]; canRaise: boolean }>(`${ENDPOINT}${qs({ orgId })}`, { signal: ctrl.signal }).then(res => {
      if (ctrl.signal.aborted) return;
      if (!res.ok) { setError(res.error); return; }
      setBoxes(res.data.connections); setCanRaise(res.data.canRaise);
      setBoxId(id => res.data.connections.some(c => c.id === id) ? id : res.data.connections[0]?.id ?? '');
    });
    return () => ctrl.abort();
  }, [orgId, nonce]);
  useEffect(() => {
    if (!boxId) return;
    const ctrl = new AbortController();
    void api<{ messages: RecruitmentEmail[]; total: number }>(`${ENDPOINT}${qs({ orgId, view: 'messages', connectionId: boxId, candidateId: candidate?.candidateId, direction, page })}`, { signal: ctrl.signal }).then(res => {
      if (ctrl.signal.aborted) return;
      if (res.ok) setLoaded({ key, ...res.data }); else setError(res.error);
    });
    return () => ctrl.abort();
  }, [orgId, boxId, candidate?.candidateId, direction, page, key]);
  const call = async <T,>(action: string, extra: Record<string, unknown> = {}) => {
    setBusy(true); setError(''); setNotice('');
    const res = await api<T>(ENDPOINT, { json: { orgId, connectionId: boxId, action, ...extra } });
    setBusy(false);
    if (!res.ok) { setError(res.error); return null; }
    setNonce(n => n + 1); return res.data;
  };
  const enableSend = async () => {
    const tab = window.open('', '_blank');
    if (!tab) { setError('Allow pop-ups, then connect again.'); return; }
    tab.opener = null;
    const result = await call<{ url: string }>('connect-send');
    if (result) { tab.location.href = result.url; setNotice('Complete Zoho consent in the new tab, then click Refresh connections.'); } else tab.close();
  };
  const openMessage = async (id: string) => {
    setBusy(true); setError('');
    const res = await api<{ message: RecruitmentEmail; thread: RecruitmentEmail[]; requisitionId: string | null }>(`${ENDPOINT}${qs({ orgId, view: 'message', id })}`);
    setBusy(false);
    if (res.ok) setDetail(res.data); else setError(res.error);
  };
  const compose = (incoming?: RecruitmentEmail) => {
    setError(''); setReview(null); setDetail(null);
    setDraft({ id: crypto.randomUUID(), ...(incoming ? { replyToId: incoming.id } : { candidateId: candidate?.candidateId }),
      subject: incoming ? `Re: ${incoming.subject.replace(/^re:\s*/i, '')}`.slice(0, 250) : '', body: '' });
  };
  const resumeDraft = (m: RecruitmentEmail) => {
    setError(''); setDetail(null);
    setDraft({ id: m.id, ...(m.reply_to_id ? { replyToId: m.reply_to_id } : { candidateId: m.candidate_id ?? undefined }), subject: m.subject, body: m.body });
    setReview(m);
  };
  const send = async () => {
    if (!review) return;
    const result = await call<{ message: RecruitmentEmail }>('send', { id: review.id, reviewedAt: review.updated_at });
    if (!result) return;
    setReview(result.message);
    if (result.message.status === 'sent') { setNotice('Email sent. It is listed in outgoing mail.'); setDraft(null); setReview(null); }
  };
  const resolve = async (resolution: string) => {
    if (!detail) return;
    const result = await call<{ message: RecruitmentEmail }>('resolve', { id: detail.message.id, resolution });
    if (result) setDetail({ ...detail, message: result.message });
  };
  const startRequest = () => {
    if (!detail) return;
    setError('');
    setRequest({ id: detail.message.id, roleTitle: '', department: '', location: '', positions: '1', budgetMaxCtc: '',
      justification: `Email from ${detail.message.sender}\nSubject: ${detail.message.subject}\n\n${detail.message.body}`.slice(0, 4000) });
    setDetail(null);
  };
  const saveRequest = async () => {
    if (!request) return;
    const { id, ...fields } = request;
    const result = await call<{ requisition: { id: string } }>('requisition', { id, fields: { ...fields, positions: Number(fields.positions), budgetMaxCtc: fields.budgetMaxCtc ? Number(fields.budgetMaxCtc) : null } });
    if (result) { setRequest(null); setNotice('Hiring request saved as a draft. Complete it in Requisitions and submit it for the normal approvals.'); }
  };
  const errorMessage = error && <p role="alert" className="text-sm text-red-700 break-words">{error}</p>;
  return <section className={`${CARD} min-w-0 space-y-4 p-4 sm:p-6`}>
    <h2 className="text-lg font-semibold">Recruitment email</h2>
    <p className="text-sm text-text-secondary">Send reviewed emails to candidates, read replies and turn incoming hiring requests into drafts. Nothing is sent or submitted automatically. Emails loaded here are visible to people with Recruitment access.</p>
    <div className="flex flex-wrap gap-2">
      <button type="button" className={BTN_PRIMARY} disabled={busy} onClick={() => void enableSend()}>Connect Zoho for sending</button>
      <button type="button" className={BTN_SECONDARY} disabled={busy} onClick={() => { setError(''); setNonce(n => n + 1); }}>Refresh connections</button>
      <button type="button" className={BTN_GHOST} disabled={busy} onClick={onSettings}>Mailbox and folder settings</button>
    </div>
    {errorMessage}{notice && <p role="status" className="text-sm">{notice}</p>}
    <div className="grid min-w-0 gap-3 sm:grid-cols-2">
      <label className="min-w-0"><span className={LABEL}>Mailbox</span><select aria-label="Email mailbox" className={`${FIELD} mt-1 w-full`} value={boxId} disabled={busy} onChange={e => { setBoxId(e.target.value); setPage(1); }}>
        <option value="">Choose a mailbox</option>{boxes.map(b => <option key={b.id} value={b.id}>{b.address}{!b.connected ? ' (disconnected)' : !b.active ? ' (paused)' : !b.can_send ? ' (read-only)' : ''}</option>)}
      </select></label>
      <div className="min-w-0"><p className={LABEL}>Candidate — optional filter</p>{!candidate && <CandidatePicker orgId={orgId} label="Find candidate for email" busy={busy} autoFocus={false} onPick={c => { setCandidate(c); setPage(1); }} onCancel={() => { setCandidate(null); setPage(1); }} />}
        {candidate && <p className="mt-1 break-words text-sm">{candidate.fullName} · {candidate.email || 'No email on record'} <button type="button" className="underline" onClick={() => { setCandidate(null); setPage(1); }}>Clear candidate</button></p>}
      </div>
    </div>
    {box && <p className="text-sm text-text-secondary">Reading folder: {box.folder_name || 'Choose one in mailbox settings'}. Email checks are manual and read 30 emails at a time.</p>}
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" disabled={busy || !box?.connected || !box.active || !box.folder_id} className={BTN_SECONDARY} onClick={async () => { const r = await call<{ added: number; complete: boolean }>('sync'); if (r) setNotice(`${r.added} new emails loaded. ${r.complete ? 'This pass is complete.' : 'Click Continue checking for older emails.'}`); }}>{box && box.email_scan_start > 1 ? 'Continue checking' : 'Check emails'}</button>
      <button type="button" disabled={busy || !box?.connected || !box.active || !box.can_send || !candidate?.email} className={BTN_PRIMARY} onClick={() => compose()}>Write to candidate</button>
      <select aria-label="Email direction" className={`${FIELD} max-w-full`} disabled={busy} value={direction} onChange={e => { setDirection(e.target.value); setPage(1); }}><option value="">All correspondence</option><option value="incoming">Incoming</option><option value="outgoing">Outgoing and drafts</option></select>
      <button type="button" className={BTN_GHOST} onClick={onRequisitions}>Open Requisitions</button>
    </div>
    {busy && <p role="status" className="flex items-center gap-2 text-sm"><Spinner />Working…</p>}
    <ul className="space-y-2">{messages.map(m => <li key={m.id} className="rounded-lg border border-border p-3">
      <button type="button" disabled={busy} onClick={() => void openMessage(m.id)} className="w-full text-left text-sm">
        <span className="block break-words font-medium">{m.subject || '(No subject)'}</span>
        <span className="block break-words text-text-secondary">{m.direction === 'incoming' ? `From ${m.sender}` : `To ${m.recipient}`} · {formatDate(m.received_at)} · {m.status}{m.candidate_id ? ' · linked to a candidate' : ''}</span>
        {m.last_error && <span className="mt-1 block text-red-700">{m.last_error}</span>}
      </button>
    </li>)}</ul>
    {boxId && loaded?.key === key && !messages.length && <p className="text-sm text-text-secondary">No emails in this view. Check emails to load the selected folder.</p>}
    {total > 30 && <div className="flex gap-3"><button type="button" className={BTN_GHOST} disabled={busy || page === 1} onClick={() => setPage(p => p - 1)}>Previous emails</button><span>Page {page}</span><button type="button" className={BTN_GHOST} disabled={busy || page * 30 >= total} onClick={() => setPage(p => p + 1)}>Next emails</button></div>}

    <Dialog open={Boolean(draft)} onClose={() => { if (!busy) { setDraft(null); setReview(null); } }} title={review ? 'Review email before sending' : 'Write email'} labelId="email-compose-title" size="lg">
      {errorMessage}
      {draft && <div className="space-y-3">
        {review ? <>
          <p className="break-words text-sm">From: {review.sender}<br />To: {review.recipient}</p><p className="font-medium break-words">{review.subject}</p><pre className="whitespace-pre-wrap break-words font-sans text-sm">{review.body}</pre>
          {review.last_error && <p role="alert" className="text-sm text-red-700">{review.last_error} Close this preview and open the outgoing email to resolve its status.</p>}
          <div className="flex flex-wrap gap-2"><button type="button" className={BTN_SECONDARY} disabled={busy || review.status !== 'draft'} onClick={() => setReview(null)}>Edit email</button><button type="button" className={BTN_PRIMARY} disabled={busy || review.status !== 'draft'} onClick={() => void send()}>Send email</button></div>
        </> : <>
          <label className="block"><span className={LABEL}>Subject</span><input aria-label="Email subject" className={`${FIELD} mt-1 w-full`} maxLength={250} value={draft.subject} disabled={busy} onChange={e => setDraft({ ...draft, subject: e.target.value })} /></label>
          <label className="block"><span className={LABEL}>Message</span><textarea aria-label="Email message" className={`${FIELD} mt-1 min-h-48 w-full`} maxLength={20000} value={draft.body} disabled={busy} onChange={e => setDraft({ ...draft, body: e.target.value })} /></label>
          <button type="button" className={BTN_PRIMARY} disabled={busy || !draft.subject.trim() || !draft.body.trim()} onClick={async () => { const r = await call<{ message: RecruitmentEmail }>('draft', { ...draft }); if (r) setReview(r.message); }}>Save draft and review</button>
          <p className="text-xs text-text-secondary">Plain text, one recipient. Saving a draft sends nothing.</p>
        </>}
      </div>}
    </Dialog>
    <Dialog open={Boolean(detail)} onClose={() => { if (!busy) setDetail(null); }} title="Email details" labelId="email-detail-title" size="lg">
      {errorMessage}{detail && <div className="space-y-3">
        <p className="text-sm break-words">From: {detail.message.sender}<br />To: {detail.message.recipient}</p><h3 className="font-medium break-words">{detail.message.subject}</h3>
        {/* Owner 2026-11-25: where this person stands, beside their email. */}
        {detail.message.candidate_id && <EmailCandidateContext orgId={orgId} candidateId={detail.message.candidate_id} />}
        <pre className="max-h-96 overflow-y-auto whitespace-pre-wrap break-words font-sans text-sm">{detail.message.body}</pre>
        {detail.message.last_error && <p className="text-sm text-red-700">{detail.message.last_error}</p>}
        {detail.thread.length > 1 && <div><p className={LABEL}>Conversation</p>{detail.thread.map(m => <button type="button" key={m.id} className={`${BTN_GHOST} mb-1 block max-w-full truncate`} disabled={busy} onClick={() => void openMessage(m.id)}>{formatDate(m.received_at)} · {m.direction} · {m.subject}</button>)}</div>}
        <div className="flex flex-wrap gap-2">
          {detail.message.direction === 'incoming' && <>
            <button type="button" className={BTN_PRIMARY} disabled={busy || !box?.can_send || !box.active || !box.connected} onClick={() => compose(detail.message)}>Reply</button>
            <button type="button" className={BTN_SECONDARY} disabled={busy || !canRaise || Boolean(detail.requisitionId)} onClick={startRequest}>{detail.requisitionId ? 'Hiring draft already created' : 'Create hiring request draft'}</button>
            {!canRaise && <p className="text-xs text-text-secondary">Creating a hiring request requires the existing permission set by the Tech team.</p>}
          </>}
          {detail.message.status === 'draft' && <button type="button" className={BTN_PRIMARY} disabled={busy} onClick={() => resumeDraft(detail.message)}>Review draft</button>}
          {['unknown', 'sending', 'failed'].includes(detail.message.status) && <div className="space-y-2">
            <p className="text-sm">Check this mailbox’s Sent folder in Zoho first. Confirming “not sent” allows another send and could create a duplicate if the first email was delivered.</p>
            <button type="button" className={BTN_SECONDARY} disabled={busy} onClick={() => void resolve('sent')}>I checked Zoho — it was sent</button>
            <button type="button" className={BTN_GHOST} disabled={busy} onClick={() => void resolve('not_sent')}>I checked Zoho — it was not sent</button>
          </div>}
        </div>
      </div>}
    </Dialog>
    <Dialog open={Boolean(request)} onClose={() => { if (!busy) setRequest(null); }} title="Review hiring request draft" labelId="email-request-title" size="lg">
      {errorMessage}{request && <div className="space-y-3">
        <p className="text-sm text-text-secondary">You will raise this draft under your login. The email sender is recorded as the source, not treated as an authorised requester. Submission and approvals happen in Requisitions.</p>
        {([['roleTitle', 'Designation / role', 'text', 120], ['department', 'Department', 'text', 80], ['location', 'Location', 'text', 80], ['positions', 'Number of openings', 'number', undefined], ['budgetMaxCtc', 'Maximum annual CTC (₹)', 'number', undefined]] as const).map(([field, label, type, maxLength]) => <label key={field} className="block"><span className={LABEL}>{label}</span><input aria-label={label} type={type} maxLength={maxLength} className={`${FIELD} mt-1 w-full`} disabled={busy} value={request[field]} onChange={e => setRequest({ ...request, [field]: e.target.value })} /></label>)}
        <label className="block"><span className={LABEL}>Reason / email details</span><textarea aria-label="Hiring request reason" maxLength={4000} className={`${FIELD} mt-1 min-h-36 w-full`} disabled={busy} value={request.justification} onChange={e => setRequest({ ...request, justification: e.target.value })} /></label>
        <button type="button" className={BTN_PRIMARY} disabled={busy || !request.roleTitle.trim()} onClick={() => void saveRequest()}>Create draft only</button>
      </div>}
    </Dialog>
  </section>;
}
