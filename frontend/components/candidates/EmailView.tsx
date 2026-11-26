'use client';

import React, { useEffect, useRef, useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, Check, ChevronLeft, ClipboardList, ClipboardPlus, ListFilter, Mail, Plug, Plus, RefreshCw, Reply, Search, Send, Settings, UserRound, X } from 'lucide-react';
import type { RecruitmentEmail } from '@/backend/lib/candidates/email';
import type { CandidateRecord } from '@/backend/lib/candidates/types';
import CandidatePicker from './CandidatePicker';
import EmailCandidateContext, { CAPS, InitialsAvatar } from './EmailCandidateContext';
import { api, qs } from './api';
import { BTN_GHOST, BTN_PRIMARY, BTN_SECONDARY, Dialog, EmptyState, FIELD, LABEL, Spinner, Tag } from './ui';
import { formatDate, formatDateShort } from './format';

interface Mailbox { id: string; address: string; connected: boolean; active: boolean; can_send: boolean; folder_name: string | null; folder_id: string | null; email_scan_start: number }
interface Draft { id: string; candidateId?: string; replyToId?: string; subject: string; body: string }
const ENDPOINT = '/api/candidates/email';

/*
 * Owner 2026-11-25: the Recruitment Email screen as a three-pane inbox — emails | the conversation | the candidate —
 * in the look of the owner's reference "Communication" screen: one white container with hairline column dividers, a
 * slim toolbar above it for the mailbox controls. It collapses to list → conversation (with a back button) when the
 * workspace is narrow. Same data and the same rules as before: emails and replies are written and reviewed in the
 * dialog, and nothing is sent without the review step.
 */

/** "Asha Rao <asha@x.com>" → name and address; a bare address has no name. */
function party(raw: string) {
  const m = raw.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  const address = (m ? m[2] : raw).trim();
  const name = m?.[1].trim() ?? '';
  return { name, address, label: name || address, initialsOf: name || address.split('@')[0].replace(/[._+-]+/g, ' ') };
}
/** The other side of the email: who wrote to us, or who we wrote to. */
const otherParty = (m: RecruitmentEmail) => party(m.direction === 'incoming' ? m.sender : m.recipient);

function dayDiff(iso: string): number | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  return Math.round((start(new Date()) - start(d)) / 86_400_000);
}
const timeOf = (iso: string) => new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
/** A row's time: "11:30 am" today, "Yesterday", "Mon" this week, then "11 Nov". */
function listTime(iso: string): string {
  const diff = dayDiff(iso);
  if (diff === null) return '—';
  if (diff === 0) return timeOf(iso);
  if (diff === 1) return 'Yesterday';
  if (diff > 1 && diff < 7) return new Date(iso).toLocaleDateString('en-IN', { weekday: 'short' });
  return formatDateShort(iso);
}
/** The divider between days in a conversation. */
function dayLabel(iso: string): string {
  const diff = dayDiff(iso);
  return diff === 0 ? 'Today' : diff === 1 ? 'Yesterday' : formatDate(iso);
}

const STATUS_TAG: Partial<Record<RecruitmentEmail['status'], { tone: 'neutral' | 'warn' | 'info'; label: string }>> = {
  draft: { tone: 'neutral', label: 'Draft' },
  sending: { tone: 'info', label: 'Sending' },
  failed: { tone: 'warn', label: 'Failed' },
  unknown: { tone: 'warn', label: 'Status unknown' },
};
function StatusTag({ status }: { status: RecruitmentEmail['status'] }) {
  const t = STATUS_TAG[status];
  return t ? <Tag tone={t.tone}>{t.label}</Tag> : null;
}
const FOCUS = 'outline-none focus-visible:ring-2 focus-visible:ring-primary';
/** A small square icon button (the reference's column-header icons). */
const ICON_BTN = `inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-text-secondary ring-1 ring-inset ring-border transition-colors hover:bg-surface-elevated hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS}`;
/** The reference's selected row: near-black with white text (white on #292929 is 15:1; the grey lines on it 7:1+). */
const ROW_SELECTED = 'bg-[#292929] text-white dark:bg-[#404040]';

const DIRECTIONS = [
  { value: '', label: 'All correspondence' },
  { value: 'incoming', label: 'Incoming' },
  { value: 'outgoing', label: 'Outgoing and drafts' },
] as const;

/** The direction filter as a small menu behind the filter icon. */
function DirectionMenu({ value, disabled, onChange }: { value: string; disabled: boolean; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const items = useRef<(HTMLButtonElement | null)[]>([]);
  const current = DIRECTIONS.find(d => d.value === value) ?? DIRECTIONS[0];
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);
  const close = () => { setOpen(false); button.current?.focus(); };
  return (
    <div ref={wrap} className="relative" onKeyDown={e => {
      if (!open) return;
      if (e.key === 'Escape') { e.stopPropagation(); close(); return; }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const at = items.current.findIndex(el => el === document.activeElement);
        const next = (at + (e.key === 'ArrowDown' ? 1 : -1) + DIRECTIONS.length) % DIRECTIONS.length;
        items.current[next]?.focus();
      }
    }}>
      <button ref={button} type="button" className={`${ICON_BTN} relative ${value ? 'text-primary' : ''}`} disabled={disabled}
        aria-haspopup="menu" aria-expanded={open} aria-label={`Filter emails: ${current.label}`} title={`Showing: ${current.label}`}
        onClick={() => setOpen(o => !o)}>
        <ListFilter className="h-4 w-4" aria-hidden />
        {value && <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-primary" aria-hidden />}
      </button>
      {open && <div role="menu" aria-label="Show emails" className="absolute right-0 top-full z-20 mt-1 w-52 rounded-xl bg-surface p-1 shadow-[var(--w-shadow-drag)]">
        {DIRECTIONS.map((d, i) => (
          <button key={d.value} ref={el => { items.current[i] = el; }} type="button" role="menuitemradio" aria-checked={d.value === value}
            autoFocus={d.value === value}
            className={`flex w-full items-center gap-x-2 rounded-lg px-2.5 py-2 text-left text-sm text-text-primary hover:bg-surface-elevated focus-visible:bg-surface-elevated ${FOCUS} focus-visible:ring-inset`}
            onClick={() => { onChange(d.value); close(); }}>
            <Check className={`h-4 w-4 shrink-0 text-primary ${d.value === value ? '' : 'invisible'}`} aria-hidden />{d.label}
          </button>
        ))}
      </div>}
    </div>
  );
}

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
  // A filter over the emails already loaded on this page (nothing is fetched for it).
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const threadRef = useRef<HTMLDivElement>(null);
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
  // On a narrow screen the conversation replaces the list: bring it into view when an email is opened.
  const openedId = detail?.message.id;
  useEffect(() => { if (openedId) threadRef.current?.scrollIntoView({ block: 'nearest' }); }, [openedId]);
  useEffect(() => { if (searchOpen) searchRef.current?.focus(); }, [searchOpen]);
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
    const result = await call<{ url?: string }>('connect-send', { reconnect: !!box?.connected });
    if (result && !result.url) { tab.close(); setNotice('The shared HR mailbox is already connected.'); }
    else if (result?.url) { tab.location.href = result.url; setNotice('Complete Zoho consent in the new tab, then click Refresh connections.'); } else tab.close();
  };
  const openMessage = async (id: string) => {
    setBusy(true); setError('');
    const res = await api<{ message: RecruitmentEmail; thread: RecruitmentEmail[]; requisitionId: string | null }>(`${ENDPOINT}${qs({ orgId, view: 'message', id })}`);
    setBusy(false);
    if (res.ok) setDetail(res.data); else setError(res.error);
  };
  // The conversation stays open beside the compose and hiring-request dialogs, so they do not close it.
  const compose = (incoming?: RecruitmentEmail) => {
    setError(''); setReview(null);
    setDraft({ id: crypto.randomUUID(), ...(incoming ? { replyToId: incoming.id } : { candidateId: candidate?.candidateId }),
      subject: incoming ? `Re: ${incoming.subject.replace(/^re:\s*/i, '')}`.slice(0, 250) : '', body: '' });
  };
  const resumeDraft = (m: RecruitmentEmail) => {
    setError('');
    setDraft({ id: m.id, ...(m.reply_to_id ? { replyToId: m.reply_to_id } : { candidateId: m.candidate_id ?? undefined }), subject: m.subject, body: m.body });
    setReview(m);
  };
  const send = async () => {
    if (!review) return;
    const result = await call<{ message: RecruitmentEmail }>('send', { id: review.id, reviewedAt: review.updated_at });
    if (!result) return;
    setReview(result.message);
    if (result.message.status === 'sent') {
      setNotice('Email sent. It is listed in outgoing mail.'); setDraft(null); setReview(null);
      if (detail) void openMessage(detail.message.id); // the sent reply joins the open conversation
    }
  };
  const resolve = async (resolution: string) => {
    if (!detail) return;
    const result = await call<{ message: RecruitmentEmail }>('resolve', { id: detail.message.id, resolution });
    if (result) setDetail({ ...detail, message: result.message, thread: detail.thread.map(t => t.id === result.message.id ? result.message : t) });
  };
  const startRequest = () => {
    if (!detail) return;
    setError('');
    setRequest({ id: detail.message.id, roleTitle: '', department: '', location: '', positions: '1', budgetMaxCtc: '',
      justification: `Email from ${detail.message.sender}\nSubject: ${detail.message.subject}\n\n${detail.message.body}`.slice(0, 4000) });
  };
  const saveRequest = async () => {
    if (!request) return;
    const { id, ...fields } = request;
    const result = await call<{ requisition: { id: string } }>('requisition', { id, fields: { ...fields, positions: Number(fields.positions), budgetMaxCtc: fields.budgetMaxCtc ? Number(fields.budgetMaxCtc) : null } });
    if (result) {
      setRequest(null); setNotice('Hiring request saved as a draft. Complete it in Requisitions and submit it for the normal approvals.');
      if (detail?.message.id === id) setDetail({ ...detail, requisitionId: result.requisition.id });
    }
  };
  const errorMessage = error && <p role="alert" className="text-sm text-red-700 break-words dark:text-red-300">{error}</p>;

  // The conversation, oldest first, with the opened email in it (and in its freshest form).
  const thread = detail ? [...detail.thread.filter(t => t.id !== detail.message.id), detail.message].sort((a, b) => a.received_at.localeCompare(b.received_at)) : [];
  const opened = detail?.message;
  const openedParty = opened ? otherParty(opened) : null;
  const canReply = Boolean(box?.can_send && box.active && box.connected);
  const canWrite = Boolean(canReply && candidate?.email);
  const needle = search.trim().toLowerCase();
  const shown = needle ? messages.filter(m => [m.sender, m.recipient, m.subject, m.body].some(s => s.toLowerCase().includes(needle))) : messages;
  const hiringLabel = detail?.requisitionId ? 'Hiring draft already created' : !canRaise ? 'Creating a hiring request requires the existing permission set by the Tech team' : 'Create hiring request draft';

  return <section className="min-w-0 space-y-3">
    <div className="recruitment-hero flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-semibold">Recruitment inbox</h2><p className="mt-1 text-sm text-text-secondary">Conversations, candidate context and next steps in one place.</p></div><span className="rounded-full bg-surface px-4 py-2 text-sm">{box?.address ?? 'Connect a mailbox to get started'}</span></div>
    <div role="group" aria-label="Mailbox views" className="flex flex-wrap gap-2">{DIRECTIONS.map(item => <button key={item.value} type="button" aria-pressed={direction === item.value} disabled={busy} onClick={() => { setDirection(item.value); setPage(1); }} className={direction === item.value ? BTN_PRIMARY : BTN_SECONDARY}>{item.label}</button>)}</div>
    {/* Slim toolbar: mailbox, candidate filter, check emails, and the mailbox's connection controls. */}
    <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
      <label className="min-w-0 basis-60 grow sm:grow-0">
        <span className="sr-only">Mailbox</span>
        <select aria-label="Email mailbox" className={`${FIELD} h-9 w-full`} value={boxId} disabled={busy} onChange={e => { setBoxId(e.target.value); setPage(1); }}>
          <option value="">Choose a mailbox</option>{boxes.map(b => <option key={b.id} value={b.id}>{b.address}{!b.connected ? ' (disconnected)' : !b.active ? ' (paused)' : !b.can_send ? ' (read-only)' : ''}</option>)}
        </select>
      </label>
      <div className="min-w-0 basis-60 grow sm:grow-0">
        {!candidate && <CandidatePicker orgId={orgId} label="Find candidate for email" busy={busy} autoFocus={false} onPick={c => { setCandidate(c); setPage(1); }} onCancel={() => { setCandidate(null); setPage(1); }} />}
        {candidate && <div className="flex h-9 min-w-0 items-center gap-x-2 rounded-xl bg-surface px-3 text-sm ring-1 ring-inset ring-border">
          <UserRound className="h-4 w-4 shrink-0 text-text-tertiary" aria-hidden />
          <span className="min-w-0 flex-1 truncate" title={`${candidate.fullName} · ${candidate.email || 'No email on record'}`}>{candidate.fullName} · {candidate.email || 'No email on record'}</span>
          <button type="button" className={`shrink-0 rounded text-xs font-semibold text-primary underline ${FOCUS}`} onClick={() => { setCandidate(null); setPage(1); }}>Clear candidate</button>
        </div>}
      </div>
      <button type="button" disabled={busy || !box?.connected || !box.active || !box.folder_id} className={BTN_SECONDARY} onClick={async () => { const r = await call<{ added: number; complete: boolean }>('sync'); if (r) setNotice(`${r.added} new emails loaded. ${r.complete ? 'This pass is complete.' : 'Click Continue checking for older emails.'}`); }}><RefreshCw className="h-4 w-4" aria-hidden />{box && box.email_scan_start > 1 ? 'Continue checking' : 'Check emails'}</button>
      <div className="ml-auto flex flex-wrap items-center gap-x-1 gap-y-1">
        {!box?.can_send || !box.connected ? <button type="button" className={ICON_BTN} disabled={busy} aria-label="Connect Zoho for sending" title="Connect Zoho for sending" onClick={() => void enableSend()}><Plug className="h-4 w-4" aria-hidden /></button> : null}
        <button type="button" className={ICON_BTN} disabled={busy} aria-label="Refresh connections" title="Refresh connections" onClick={() => { setError(''); setNonce(n => n + 1); }}><RefreshCw className="h-4 w-4" aria-hidden /></button>
        <button type="button" className={ICON_BTN} disabled={busy} aria-label="Mailbox and folder settings" title="Mailbox and folder settings" onClick={onSettings}><Settings className="h-4 w-4" aria-hidden /></button>
        <button type="button" className={BTN_GHOST} onClick={onRequisitions}><ClipboardList className="h-4 w-4" aria-hidden />Open Requisitions</button>
      </div>
      <p className="basis-full text-xs text-text-secondary">
        {box && <>Reading folder: {box.folder_name || 'Choose one in mailbox settings'}. Email checks are manual and read 30 emails at a time. </>}
        Nothing is sent or submitted automatically. Emails loaded here are visible to people with Recruitment access.
      </p>
    </div>

    {errorMessage}{notice && <p role="status" className="text-sm text-text-primary">{notice}</p>}
    {busy && <p role="status" className="flex items-center gap-x-2 text-sm text-text-primary"><Spinner />Working…</p>}

    {/* The inbox: list | conversation | candidate, in one white container. Below 48rem only one of list / conversation
        shows at a time; between 48rem and 64rem the candidate sits under the conversation. */}
    <div className="recruitment-inbox @container overflow-hidden rounded-2xl bg-surface shadow-[var(--w-shadow)]">
      <div className="grid min-w-0 @3xl:h-[min(48rem,calc(100dvh-12rem))] @3xl:grid-rows-[minmax(0,1fr)] @3xl:grid-cols-[minmax(0,18.75rem)_minmax(0,1fr)] @5xl:grid-cols-[minmax(0,18.75rem)_minmax(0,1fr)_minmax(0,18.75rem)]">

        {/* Left: the emails. */}
        <div className={`${detail ? 'hidden @3xl:flex' : 'flex'} min-h-0 min-w-0 flex-col @3xl:border-r @3xl:border-border`}>
          <div className="flex items-center gap-x-1.5 px-4 pb-2 pt-4">
            <h3 className="min-w-0 flex-1 truncate text-base font-semibold text-text-primary">Emails</h3>
            <button type="button" className={`${ICON_BTN} ${searchOpen ? 'bg-surface-elevated text-text-primary' : ''}`} aria-label="Search loaded emails" aria-expanded={searchOpen} aria-controls="email-search"
              title="Search the emails on this page" onClick={() => { if (searchOpen) searchRef.current?.focus(); else setSearchOpen(true); }}>
              <Search className="h-4 w-4" aria-hidden />
            </button>
            <DirectionMenu value={direction} disabled={busy} onChange={v => { setDirection(v); setPage(1); }} />
            <button type="button" aria-label="Write to candidate" title={candidate?.email ? `Write to ${candidate.fullName}` : 'Choose a candidate with an email in the toolbar above to write to them'}
              disabled={busy || !canWrite}
              className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary text-white transition-colors hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS} focus-visible:ring-offset-2`} onClick={() => compose()}>
              <Plus className="h-4 w-4" aria-hidden />
            </button>
          </div>
          {searchOpen && <div className="px-4 pb-2">
            <div className="flex h-9 items-center gap-x-2 rounded-lg bg-surface-elevated px-2.5 ring-1 ring-inset ring-border focus-within:ring-2 focus-within:ring-primary">
              <Search className="h-3.5 w-3.5 shrink-0 text-text-tertiary" aria-hidden />
              <input id="email-search" ref={searchRef} type="search" aria-label="Search the loaded emails by name, address, subject or text" placeholder="Search these emails"
                className="h-full min-w-0 flex-1 bg-transparent text-sm text-text-primary outline-none placeholder:text-text-tertiary" value={search}
                onChange={e => setSearch(e.target.value)} onKeyDown={e => { if (e.key === 'Escape') { setSearch(''); setSearchOpen(false); } }} />
              <button type="button" className={`rounded p-0.5 text-text-tertiary hover:text-text-primary ${FOCUS}`} aria-label="Close search" onClick={() => { setSearch(''); setSearchOpen(false); }}><X className="h-3.5 w-3.5" aria-hidden /></button>
            </div>
          </div>}
          <p className={`${CAPS} px-4 pb-1.5 pt-2`}>{candidate ? 'Candidate inbox' : 'Recruitment inbox'}{loaded?.key === key && <span className="tabular-nums"> · {needle ? `${shown.length} of ${messages.length}` : total}</span>}</p>
          <div className="min-h-0 flex-1 px-2 pb-2 @3xl:overflow-y-auto">
            {!boxId && <p className="px-2 py-6 text-center text-sm text-text-secondary">Choose a mailbox to see its emails.</p>}
            {boxId && loaded?.key === key && !messages.length && <p className="px-2 py-6 text-center text-sm text-text-secondary">No emails in this view. Check emails to load the selected folder.</p>}
            {needle && messages.length > 0 && !shown.length && <p className="px-2 py-6 text-center text-sm text-text-secondary">No email on this page matches “{search.trim()}”.</p>}
            <ul className="space-y-0.5" aria-label="Emails">{shown.map(m => {
              const who = otherParty(m);
              const selected = m.id === opened?.id;
              const preview = m.body.replace(/\s+/g, ' ').trim() || m.subject;
              const Dir = m.direction === 'incoming' ? ArrowDownLeft : ArrowUpRight;
              return <li key={m.id}>
                <button type="button" disabled={busy} aria-current={selected ? 'true' : undefined} onClick={() => void openMessage(m.id)}
                  className={`flex w-full min-w-0 items-start gap-x-3 rounded-xl px-2.5 py-2.5 text-left text-sm transition-colors disabled:cursor-wait ${selected ? `${ROW_SELECTED} focus-visible:ring-white/80` : 'hover:bg-surface-elevated'} ${FOCUS} focus-visible:ring-inset`}>
                  <InitialsAvatar name={who.initialsOf} />
                  <span className="min-w-0 flex-1">
                    <span className="flex min-w-0 items-center gap-x-1.5">
                      <span className={`min-w-0 flex-1 truncate font-semibold ${selected ? 'text-white' : 'text-text-primary'}`} title={who.address}>{who.label}</span>
                      <span className={`shrink-0 text-xs tabular-nums ${selected ? 'text-white/75' : 'text-text-tertiary'}`}>{listTime(m.received_at)}</span>
                    </span>
                    <span className={`mt-0.5 flex min-w-0 items-center gap-x-1 ${selected ? 'text-white/80' : 'text-text-secondary'}`}>
                      <Dir className="h-3 w-3 shrink-0" aria-hidden /><span className="sr-only">{m.direction === 'incoming' ? 'Incoming: ' : 'Outgoing: '}</span>
                      <span className="min-w-0 truncate"><span className="font-medium">{m.subject || '(No subject)'}</span>{preview !== m.subject && <> — {preview}</>}</span>
                    </span>
                    {(m.direction === 'incoming' || m.candidate_id || STATUS_TAG[m.status]) && <span className="mt-1 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
                      {m.direction === 'incoming' && <span className={`text-xs ${selected ? 'text-white/75' : 'text-text-tertiary'}`}>Zoho Mail</span>}
                      {m.candidate_id && <span className={`truncate text-xs ${selected ? 'text-white/75' : 'text-text-tertiary'}`}>Linked to a candidate</span>}
                      <StatusTag status={m.status} />
                    </span>}
                    {m.last_error && <span className={`mt-1 block break-words text-xs ${selected ? 'text-red-200' : 'text-red-700 dark:text-red-300'}`}>{m.last_error}</span>}
                  </span>
                </button>
              </li>;
            })}</ul>
          </div>
          {total > 30 && <div className="flex items-center justify-between gap-x-2 border-t border-border px-2 py-2 text-sm">
            <button type="button" className={BTN_GHOST} disabled={busy || page === 1} onClick={() => setPage(p => p - 1)}>Previous emails</button>
            <span className="text-text-secondary tabular-nums">Page {page}</span>
            <button type="button" className={BTN_GHOST} disabled={busy || page * 30 >= total} onClick={() => setPage(p => p + 1)}>Next emails</button>
          </div>}
        </div>

        {/* Middle and right. Between 48rem and 64rem the candidate sits under the conversation; from 64rem this wrapper
            dissolves (display: contents) and the two become the grid's second and third columns. */}
        <div className={`${detail ? 'flex' : 'hidden @3xl:flex'} min-h-0 min-w-0 flex-col @5xl:contents`}>
        {/* Middle: the conversation. */}
        <div ref={threadRef} className="flex min-h-0 min-w-0 flex-1 scroll-mt-4 flex-col" aria-label="Conversation" role="region">
          {!detail || !opened || !openedParty ? <div className="flex flex-1 items-center justify-center bg-surface-elevated py-10"><EmptyState icon={Mail} title="No email open">Choose an email on the left to read the conversation.</EmptyState></div> : <>
            <div className="flex items-center gap-x-2 border-b border-border px-4 py-3">
              <button type="button" className={`${ICON_BTN} @3xl:hidden`} aria-label="Back to emails" onClick={() => setDetail(null)}><ChevronLeft className="h-4 w-4" aria-hidden /></button>
              <div className="min-w-0 flex-1">
                <h3 className="truncate text-base font-semibold text-text-primary" title={opened.subject}>{opened.subject || '(No subject)'}</h3>
                <p className="truncate text-xs text-text-tertiary" title={`From: ${opened.sender} · To: ${opened.recipient}`}>From: {opened.sender} · To: {opened.recipient}</p>
              </div>
              {opened.direction === 'incoming' && <>
                <button type="button" className={ICON_BTN} disabled={busy || !canRaise || Boolean(detail.requisitionId)} aria-label={hiringLabel} title={hiringLabel} onClick={startRequest}><ClipboardPlus className="h-4 w-4" aria-hidden /></button>
                <button type="button" className={ICON_BTN} disabled={busy || !canReply} aria-label={`Reply to ${openedParty.label}`} title={canReply ? `Reply to ${openedParty.label}` : 'Replying needs a connected mailbox that can send'} onClick={() => compose(opened)}><Reply className="h-4 w-4" aria-hidden /></button>
              </>}
            </div>
            <ol className="min-h-0 flex-1 space-y-4 bg-surface-elevated px-4 py-4 @3xl:overflow-y-auto" aria-label="Emails in this conversation">
              {thread.map((m, i) => {
                const who = party(m.sender);
                const isOpen = m.id === opened.id;
                const newDay = i === 0 || new Date(thread[i - 1].received_at).toDateString() !== new Date(m.received_at).toDateString();
                return <li key={m.id} className="space-y-4">
                  {newDay && <div className="flex justify-center" role="separator" aria-label={dayLabel(m.received_at)}>
                    <span className="rounded-full bg-surface px-2.5 py-0.5 text-xs font-medium text-text-secondary ring-1 ring-inset ring-border">{dayLabel(m.received_at)}</span>
                  </div>}
                  <article className="flex min-w-0 gap-x-3" aria-current={isOpen ? 'true' : undefined}>
                    <InitialsAvatar name={who.initialsOf} />
                    <div className="min-w-0 flex-1">
                      <p className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-sm">
                        <span className="min-w-0 truncate font-semibold text-text-primary" title={who.address}>{who.label}</span>
                        <span className="text-xs text-text-tertiary">{m.direction === 'incoming' && 'Zoho Mail · '}{timeOf(m.received_at)}<span className="sr-only">, {m.direction === 'incoming' ? 'received' : 'sent from this mailbox'}</span></span>
                        <StatusTag status={m.status} />
                      </p>
                      {isOpen
                        ? <pre className="mt-1 whitespace-pre-wrap break-words font-sans text-sm leading-relaxed text-text-primary">{m.body || '(No text)'}</pre>
                        : <>
                          {m.body && <p className="mt-1 line-clamp-3 whitespace-pre-wrap break-words text-sm leading-relaxed text-text-secondary">{m.body}</p>}
                          <button type="button" className={`mt-1 rounded text-xs font-semibold text-primary underline ${FOCUS}`} disabled={busy} onClick={() => void openMessage(m.id)}>Open this email</button>
                        </>}
                      {isOpen && m.last_error && <p className="mt-2 text-sm text-red-700 dark:text-red-300">{m.last_error}</p>}
                    </div>
                  </article>
                </li>;
              })}
            </ol>
            {/* Actions for the opened email. Replies open the compose dialog with its review step. */}
            <div className="space-y-2 border-t border-border bg-surface-elevated px-4 py-3">
              {opened.status === 'draft' && <button type="button" className={BTN_PRIMARY} disabled={busy} onClick={() => resumeDraft(opened)}>Review draft</button>}
              {['unknown', 'sending', 'failed'].includes(opened.status) && <div className="space-y-2">
                <p className="text-sm text-text-primary">Check this mailbox’s Sent folder in Zoho first. Confirming “not sent” allows another send and could create a duplicate if the first email was delivered.</p>
                <div className="flex flex-wrap gap-x-2 gap-y-2">
                  <button type="button" className={BTN_SECONDARY} disabled={busy} onClick={() => void resolve('sent')}>I checked Zoho — it was sent</button>
                  <button type="button" className={BTN_GHOST} disabled={busy} onClick={() => void resolve('not_sent')}>I checked Zoho — it was not sent</button>
                </div>
              </div>}
              {opened.direction === 'incoming' && <button type="button" disabled={busy || !canReply} onClick={() => compose(opened)}
                className={`flex h-11 w-full min-w-0 items-center gap-x-2 rounded-xl bg-surface pl-4 pr-1.5 text-left text-sm text-text-tertiary ring-1 ring-inset ring-border transition-shadow hover:ring-[#d6d3d1] disabled:cursor-not-allowed disabled:opacity-60 dark:hover:ring-white/25 ${FOCUS}`}>
                <span className="min-w-0 flex-1 truncate">{canReply ? `Write message to ${openedParty.label}… you review it before it is sent` : 'Replying needs a connected mailbox that can send'}</span>
                <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary text-white" aria-hidden><Send className="h-4 w-4" /></span>
              </button>}
            </div>
          </>}
        </div>

        {/* Right: the candidate (under the conversation until the workspace is wide). */}
        <aside aria-label="Candidate" className={`${detail ? 'block' : 'hidden @5xl:block'} min-h-0 min-w-0 shrink-0 border-t border-border @3xl:max-h-[45%] @3xl:overflow-y-auto @5xl:max-h-none @5xl:border-l @5xl:border-t-0`}>
          {/* Owner 2026-11-25: where this person stands, beside their email. */}
          {opened?.candidate_id && openedParty
            ? <EmailCandidateContext orgId={orgId} candidateId={opened.candidate_id} contact={openedParty} />
            : <EmptyState icon={UserRound} title={opened ? 'Not linked to a candidate' : 'No candidate yet'}>
              {opened ? 'This email’s address does not match a candidate on record.' : 'Open an email from a candidate to see their positions and interviews here.'}
            </EmptyState>}
        </aside>
        </div>
      </div>
    </div>

    <Dialog open={Boolean(draft)} onClose={() => { if (!busy) { setDraft(null); setReview(null); } }} title={review ? 'Review email before sending' : 'Write email'} labelId="email-compose-title" size="lg">
      {errorMessage}
      {draft && <div className="space-y-3">
        {review ? <>
          <p className="break-words text-sm">From: {review.sender}<br />To: {review.recipient}</p><p className="font-medium break-words">{review.subject}</p><pre className="whitespace-pre-wrap break-words font-sans text-sm">{review.body}</pre>
          {review.last_error && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{review.last_error} Close this preview and open the outgoing email to resolve its status.</p>}
          <div className="flex flex-wrap gap-x-2 gap-y-2"><button type="button" className={BTN_SECONDARY} disabled={busy || review.status !== 'draft'} onClick={() => setReview(null)}>Edit email</button><button type="button" className={BTN_PRIMARY} disabled={busy || review.status !== 'draft'} onClick={() => void send()}>Send email</button></div>
        </> : <>
          <label className="block"><span className={LABEL}>Subject</span><input aria-label="Email subject" className={`${FIELD} mt-1 w-full`} maxLength={250} value={draft.subject} disabled={busy} onChange={e => setDraft({ ...draft, subject: e.target.value })} /></label>
          <label className="block"><span className={LABEL}>Message</span><textarea aria-label="Email message" className={`${FIELD} mt-1 min-h-48 w-full py-2`} maxLength={20000} value={draft.body} disabled={busy} onChange={e => setDraft({ ...draft, body: e.target.value })} /></label>
          <button type="button" className={BTN_PRIMARY} disabled={busy || !draft.subject.trim() || !draft.body.trim()} onClick={async () => { const r = await call<{ message: RecruitmentEmail }>('draft', { ...draft }); if (r) setReview(r.message); }}>Save draft and review</button>
          <p className="text-xs text-text-secondary">Plain text, one recipient. Saving a draft sends nothing.</p>
        </>}
      </div>}
    </Dialog>
    <Dialog open={Boolean(request)} onClose={() => { if (!busy) setRequest(null); }} title="Review hiring request draft" labelId="email-request-title" size="lg">
      {errorMessage}{request && <div className="space-y-3">
        <p className="text-sm text-text-secondary">You will raise this draft under your login. The email sender is recorded as the source, not treated as an authorised requester. Submission and approvals happen in Requisitions.</p>
        {([['roleTitle', 'Designation / role', 'text', 120], ['department', 'Department', 'text', 80], ['location', 'Location', 'text', 80], ['positions', 'Number of openings', 'number', undefined], ['budgetMaxCtc', 'Maximum annual CTC (₹)', 'number', undefined]] as const).map(([field, label, type, maxLength]) => <label key={field} className="block"><span className={LABEL}>{label}</span><input aria-label={label} type={type} maxLength={maxLength} className={`${FIELD} mt-1 w-full`} disabled={busy} value={request[field]} onChange={e => setRequest({ ...request, [field]: e.target.value })} /></label>)}
        <label className="block"><span className={LABEL}>Reason / email details</span><textarea aria-label="Hiring request reason" maxLength={4000} className={`${FIELD} mt-1 min-h-36 w-full py-2`} disabled={busy} value={request.justification} onChange={e => setRequest({ ...request, justification: e.target.value })} /></label>
        <button type="button" className={BTN_PRIMARY} disabled={busy || !request.roleTitle.trim()} onClick={() => void saveRequest()}>Create draft only</button>
      </div>}
    </Dialog>
  </section>;
}
