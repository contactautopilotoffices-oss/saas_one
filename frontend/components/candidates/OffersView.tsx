'use client';

import React, { useEffect, useState } from 'react';
import { BadgeIndianRupee, Check, ClipboardCheck, Link2, Phone, Send, X } from 'lucide-react';
import type { OutreachSettings } from '@/backend/lib/candidates/outreach-settings';
import { OFFER_STATUS_LABELS, RECOMMENDATION_LABELS, type CandidateRecord, type Interview, type Offer, type OfferHandover } from '@/backend/lib/candidates/types';
import { api, qs } from './api';
import { formatDate } from './format';
import { Dialog, Spinner, useUi } from './ui';
import { EmptyBlock, K_BTN, K_BTN_DANGER, K_BTN_GHOST, K_BTN_GHOST_DANGER, K_BTN_PRIMARY, K_AREA, K_CARD, K_FIELD, K_LABEL, K_WELL, Loading, PageHeader, type PillTone, Segmented, StatusPill } from './page-kit';

/*
 * Selection and the offer, to joining (owner 2026-11-21; spec Stages 7-9, screen 11 "Offer screen"). On a candidate:
 * the combined scorecard per position and "Select and make an offer" (the CTC against the request's band). In the
 * Recruitment tab "Offers": every offer, where it stands, and the next step for whoever may take it: the HR Head and the
 * Director approve; HR edits the letter and releases it (blocked while a blank is unfilled), records the answer, logs
 * the calls until joining, and marks joined or dropped. Nothing is decided by the app.
 */

const lpa = (v: number | null) => (v === null ? '—' : `₹${(v / 100_000).toLocaleString('en-IN', { maximumFractionDigits: 2 })} LPA`);
const LEVEL: Record<NonNullable<Offer['currentLevel']>, string> = { hiring_manager: 'the hiring manager', hod: 'the department head', hr_head: 'the HR Head', director: 'the Director' };
const inr = (v: number) => `₹${Math.round(v).toLocaleString('en-IN')}`;
const TONE: Record<Offer['status'], PillTone> = { pending: 'amber', approved: 'blue', rejected: 'red', released: 'blue', accepted: 'green', declined: 'red', joined: 'green', dropped: 'grey', withdrawn: 'grey' };
const OPEN: Offer['status'][] = ['pending', 'approved', 'released', 'accepted'];
const INPUT = `${K_FIELD} w-full`;

/** On a candidate (the Interviews tab): the combined scorecard per position, the offers, and "Select and make an offer". */
export function CandidateOffers({ orgId, record, interviews }: { orgId: string; record: CandidateRecord; interviews: Interview[] }) {
    const { notify } = useUi();
    const [offers, setOffers] = useState<Offer[] | null>(null);
    const [nonce, setNonce] = useState(0);
    const [form, setForm] = useState<{ positionId: string; ctc: string; joining: string; note: string } | null>(null);
    const [busy, setBusy] = useState(false);
    useEffect(() => {
        const ctrl = new AbortController();
        void api<{ offers: Offer[] }>(`/api/candidates/offers${qs({ orgId, candidateId: record.candidateId })}`, { signal: ctrl.signal }).then(res => { if (!ctrl.signal.aborted) setOffers(res.ok ? res.data.offers : []); });
        return () => ctrl.abort();
    }, [orgId, record.candidateId, nonce]);

    // The combined scorecard: every submitted card, per position.
    const positions = [...new Map(interviews.filter(i => i.positionId).map(i => [i.positionId!, i.positionTitle ?? 'Position'])).entries()];
    const cardsFor = (positionId: string) => interviews.filter(i => i.positionId === positionId).flatMap(i => (i.scorecards ?? []).filter(c => c.submittedAt).map(c => ({ ...c, round: i.round })));
    const make = async () => {
        if (!form) return;
        const ctc = Math.round(Number(form.ctc) * 100_000);
        if (!(ctc > 0)) { notify('Give the offer CTC in lakhs per year, e.g. 4.5.', 'error'); return; }
        setBusy(true);
        const res = await api<{ offer: Offer }>('/api/candidates/offers', { json: { orgId, applicationId: record.id, positionId: form.positionId, proposedCtc: ctc, joiningDate: form.joining || null, note: form.note.trim() || undefined } });
        setBusy(false);
        if (!res.ok) { notify(res.error, 'error'); return; }
        notify(`Offer sent for approval to ${res.data.offer.currentApproverName ?? (res.data.offer.currentLevel ? LEVEL[res.data.offer.currentLevel] : 'the HR Head')}${res.data.offer.needsDirector ? '; the Director approves too' : ''}. Add the salary breakup from the offer.`, 'success');
        setForm(null);
        setNonce(n => n + 1);
    };

    if (!positions.length && !offers?.length) return null;
    return (
        <section className={`${K_CARD} px-4 py-3`} aria-label="Selection and offer">
            <p className="flex items-center gap-x-1.5 text-sm font-semibold text-text-primary"><BadgeIndianRupee className="h-4 w-4" aria-hidden />Selection and offer</p>
            {positions.map(([positionId, title]) => {
                const cards = cardsFor(positionId);
                const rounds = interviews.filter(i => i.positionId === positionId && i.status !== 'cancelled' && i.status !== 'no_show');
                const eligible = rounds.length > 0 && rounds.every(i => i.status === 'done' && i.scorecards?.length && i.scorecards.every(c => c.submittedAt));
                const avg = cards.length ? Math.round((cards.reduce((n, c) => n + (c.overall ?? 0), 0) / cards.length) * 10) / 10 : null;
                const live = offers?.some(o => o.positionId === positionId && ['pending', 'approved', 'released', 'accepted'].includes(o.status));
                return (
                    <div key={positionId} className={`${K_WELL} mt-2 px-3 py-2.5`}>
                        <p className="text-sm font-semibold text-text-primary">{title}</p>
                        <p className="text-xs text-text-secondary">{cards.length ? `Combined scorecard: ${avg}/5 over ${cards.length} card${cards.length === 1 ? '' : 's'} · ${cards.map(c => `${c.round ?? 'Round'}: ${c.recommendation ? RECOMMENDATION_LABELS[c.recommendation] : '—'}`).join(' · ')}` : 'No scorecard submitted yet.'}</p>
                        {!live && !eligible && <p className="mt-2 text-sm text-text-secondary">Complete the interviews and collect all panel scorecards before making an offer.</p>}
                        {!live && eligible && (form?.positionId === positionId ? (
                            <div className="mt-2 grid gap-2 sm:grid-cols-3">
                                <label className="text-xs text-text-secondary">Offer CTC (lakhs per year)<input type="number" min={0} step={0.1} value={form.ctc} onChange={e => setForm({ ...form, ctc: e.target.value })} className={`${INPUT} mt-1`} autoFocus /></label>
                                <label className="text-xs text-text-secondary">Joining date<input type="date" value={form.joining} onChange={e => setForm({ ...form, joining: e.target.value })} className={`${INPUT} mt-1`} /></label>
                                <label className="text-xs text-text-secondary sm:col-span-3">Why this candidate (optional)<input value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} maxLength={500} className={`${INPUT} mt-1`} /></label>
                                <div className="flex gap-2 sm:col-span-3">
                                    <button type="button" onClick={() => setForm(null)} disabled={busy} className={K_BTN}>Cancel</button>
                                    <button type="button" onClick={() => void make()} disabled={busy || !form.ctc} className={K_BTN_PRIMARY}>{busy && <Spinner />}Send for approval</button>
                                </div>
                                <p className="text-xs text-text-tertiary sm:col-span-3">The annexure goes to the configured approvers for this position. The candidate sees nothing until HR releases the letter of intent.</p>
                            </div>
                        ) : <button type="button" onClick={() => setForm({ positionId, ctc: '', joining: '', note: '' })} className={`${K_BTN} mt-2`}><Check className="h-4 w-4" />Select and make an offer</button>)}
                    </div>
                );
            })}
            {offers === null ? <Loading>Loading offers</Loading>
                : offers.map(o => <OfferCard key={o.id} orgId={orgId} offer={o} onChanged={() => setNonce(n => n + 1)} compact />)}
        </section>
    );
}

/** The Recruitment tab "Offers": every offer, newest first, with the next step for whoever may take it. */
export default function OffersView({ orgId }: { orgId: string }) {
    const [offers, setOffers] = useState<Offer[] | null>(null);
    const [error, setError] = useState('');
    const [nonce, setNonce] = useState(0);
    const [filter, setFilter] = useState<'open' | 'all' | 'mine'>('open');
    const [selectedId, setSelectedId] = useState<string | null>(null);
    useEffect(() => {
        const ctrl = new AbortController();
        void api<{ offers: Offer[] }>(`/api/candidates/offers${qs({ orgId })}`, { signal: ctrl.signal }).then(res => {
            if (ctrl.signal.aborted) return;
            if (!res.ok) { setError(res.error); setOffers([]); return; }
            setError('');
            setOffers(res.data.offers);
        });
        return () => ctrl.abort();
    }, [orgId, nonce]);
    const [handovers, setHandovers] = useState<OfferHandover[]>([]);
    useEffect(() => {
        const ctrl = new AbortController();
        void api<{ handovers: OfferHandover[] }>(`/api/candidates/offers${qs({ orgId, handovers: '1' })}`, { signal: ctrl.signal }).then(res => { if (!ctrl.signal.aborted && res.ok) setHandovers(res.data.handovers); });
        return () => ctrl.abort();
    }, [orgId, nonce]);
    const shown = (offers ?? []).filter(o => filter === 'all' || (filter === 'mine' ? o.canDecide : OPEN.includes(o.status)));
    const activeId = shown.some(o => o.id === selectedId) ? selectedId : shown[0]?.id;
    const mine = (offers ?? []).filter(o => o.canDecide).length;
    const open = (offers ?? []).filter(o => OPEN.includes(o.status)).length;
    const ready = handovers.filter(h => h.status === 'pending').length;
    const sub = offers === null ? 'From selection to joining' : [
        `${open} in progress`, `${offers.length} in all`,
        ...(mine ? [`${mine} waiting for your approval`] : []),
        ...(ready ? [`${ready} ready for onboarding`] : []),
    ].join(' · ');
    return (
        <div className="space-y-5">
            <PageHeader title="Offers" sub={sub}
                actions={<Segmented label="Which offers" value={filter} onChange={setFilter} options={[{ value: 'open', label: 'In progress' }, { value: 'mine', label: 'My approvals' }, { value: 'all', label: 'All' }]} />} />
            {error && <p role="alert" className={`${K_CARD} px-4 py-3 text-sm text-error`}>{error}</p>}
            <div className="recruitment-queue" aria-label="Offer priorities">
                <button type="button" onClick={() => setFilter('mine')} aria-pressed={filter === 'mine'}><strong>{offers ? mine : '—'}</strong><span>Waiting for your approval</span></button>
                <button type="button" onClick={() => setFilter('open')} aria-pressed={filter === 'open'}><strong>{offers ? open : '—'}</strong><span>In progress</span></button>
                <button type="button" onClick={() => document.getElementById('offer-handovers')?.scrollIntoView({ block: 'start' })}><strong>{ready}</strong><span>Ready for onboarding</span></button>
            </div>
            <div id="offer-handovers"><Handovers orgId={orgId} handovers={handovers} onChanged={() => setNonce(n => n + 1)} /></div>
            {offers === null ? <Loading />
                : (
                    <div className={`${K_CARD} overflow-hidden`}>
                        {shown.length === 0
                            ? <EmptyBlock icon={BadgeIndianRupee} title={offers.length ? 'Nothing in progress' : 'No offers yet'}>{offers.length ? 'Switch to All to see the closed ones.' : 'Make an offer from a candidate’s Interviews tab.'}</EmptyBlock>
                            : <div className="grid items-start lg:grid-cols-[300px_minmax(0,1fr)]">
                                <nav aria-label="Offer list" className="max-h-[640px] overflow-y-auto border-b border-border px-3 py-3 lg:border-b-0 lg:border-r">{shown.map(o => <button type="button" key={o.id} aria-pressed={activeId === o.id} onClick={() => setSelectedId(o.id)} className={`mb-2 w-full rounded-xl px-4 py-4 text-left ${activeId === o.id ? 'bg-surface-elevated ring-1 ring-primary/30' : 'hover:bg-muted'}`}><span className="block font-semibold">{o.candidateName}</span><span className="mb-2 block text-sm text-text-secondary">{o.positionTitle}</span><StatusPill tone={TONE[o.status]}>{OFFER_STATUS_LABELS[o.status]}</StatusPill></button>)}</nav>
                                <div className="min-w-0">{shown.map(o => <div key={o.id} hidden={activeId !== o.id}><OfferCard orgId={orgId} offer={o} onChanged={() => setNonce(n => n + 1)} /></div>)}</div>
                            </div>}
                    </div>
                )}
        </div>
    );
}

function OfferCard({ orgId, offer: o, onChanged, compact = false }: { orgId: string; offer: Offer; onChanged: () => void; compact?: boolean }) {
    const { notify } = useUi();
    const [busy, setBusy] = useState(false);
    const [step, setStep] = useState<null | 'reject' | 'revise' | 'letter' | 'declined' | 'accepted' | 'dropped' | 'contact'>(null);
    const [breakupOpen, setBreakupOpen] = useState(false);
    const rows = Object.entries(o.breakup ?? {});
    const [text, setText] = useState('');
    const [date, setDate] = useState(o.joiningDate ?? '');
    const [letter, setLetter] = useState(o.letter ?? '');
    const act = async (json: Record<string, unknown>, done: string) => {
        setBusy(true);
        const res = await api<{ offer: Offer }>(`/api/candidates/offers/${encodeURIComponent(o.id)}`, { method: 'PATCH', json: { orgId, ...json } });
        setBusy(false);
        if (!res.ok) { notify(res.error, 'error'); return; }
        notify(done, 'success');
        setStep(null); setText('');
        onChanged();
    };
    const box = (label: string, required: boolean, submit: () => void, cta: string, danger = false, withDate = false) => (
        <div className={`${K_WELL} mt-2 space-y-2 px-3 py-2.5`}>
            {withDate && <label className="block text-xs text-text-secondary">Joining date<input type="date" value={date} onChange={e => setDate(e.target.value)} className={`${INPUT} mt-1 sm:max-w-[200px]`} /></label>}
            <label className="block text-xs text-text-secondary">{label}{required ? ' *' : ' (optional)'}<input value={text} onChange={e => setText(e.target.value)} maxLength={1000} className={`${INPUT} mt-1`} autoFocus /></label>
            <div className="flex gap-2"><button type="button" onClick={() => setStep(null)} disabled={busy} className={K_BTN}>Back</button><button type="button" onClick={submit} disabled={busy || (required && !text.trim()) || (withDate && !date)} className={danger ? K_BTN_DANGER : K_BTN_PRIMARY}>{busy && <Spinner />}{cta}</button></div>
        </div>
    );
    return (
        <div className={compact ? `${K_WELL} mt-2 px-4 py-3` : 'px-4 py-4 transition-colors hover:bg-surface-elevated/50 sm:px-5'}>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                {!compact && <span className="text-[15px] font-semibold text-text-primary">{o.candidateName}</span>}
                <span className="text-sm text-text-secondary">{o.positionTitle ?? 'Position'}{o.requisitionNo ? ` · ${o.requisitionNo}` : ''}</span>
                <StatusPill tone={TONE[o.status]}>{OFFER_STATUS_LABELS[o.status]}</StatusPill>
                {o.canDecide && <StatusPill tone="amber">Your approval</StatusPill>}
            </div>
            <p className="mt-1 text-sm text-text-primary">
                <span className="font-semibold">{lpa(o.proposedCtc)}</span>
                <span className="text-text-secondary"> · band {lpa(o.bandMin)} to {lpa(o.bandMax)}</span>
                {o.variancePct !== null && <span className="font-semibold text-red-700 dark:text-red-400"> · {o.variancePct}% above the band</span>}
                <span className="text-text-secondary"> · joining {o.joiningDate ? formatDate(o.joiningDate) : '—'}</span>
            </p>
            {o.status === 'pending' && <p className="text-xs text-text-secondary">Waiting on {o.currentApproverName ?? (o.currentLevel ? LEVEL[o.currentLevel] : 'the approver')}{o.currentLevel === 'hiring_manager' ? ' (hiring manager)' : ''}{o.needsDirector && o.currentLevel !== 'director' ? ', then the Director' : ''}.</p>}
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-text-secondary">
                <span>Salary breakup: {rows.length ? rows.map(([k, v]) => `${k} ${inr(v)}`).join(' · ') : 'not given yet'}</span>
                {(o.status === 'pending' || o.status === 'approved') && <button type="button" onClick={() => setBreakupOpen(true)} className={K_BTN_GHOST}>{rows.length ? 'Edit' : 'Add the breakup'}</button>}
            </div>
            {o.publicUrl && o.status === 'released' && (
                <p className="text-xs text-text-secondary"><button type="button" onClick={() => { void navigator.clipboard.writeText(o.publicUrl ?? '').then(() => notify('The letter page link is copied', 'success'), () => undefined); }} className="inline-flex items-center gap-1 rounded font-semibold text-primary underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"><Link2 className="h-3.5 w-3.5" />Copy the candidate&rsquo;s letter page</button> · they accept or decline there</p>
            )}
            {o.respondedVia === 'candidate' && <p className="text-xs text-text-secondary">Answered by the candidate on the letter page.</p>}
            {o.responseReason && <p className="text-xs text-text-secondary">“{o.responseReason}”</p>}
            {o.status === 'accepted' && <p className="text-xs text-text-secondary">Last contact {o.lastContactAt ? formatDate(o.lastContactAt) : '—'} · call at least once a week until joining.</p>}

            {/* The next step */}
            {o.canDecide && !step && (
                <div className="mt-2 flex flex-wrap gap-2">
                    <button type="button" onClick={() => void act({ action: 'decide', approvalRevision: o.approvalRevision, expectedLevel: o.currentLevel, decision: 'approve' }, 'Approval recorded')} disabled={busy} className={K_BTN_PRIMARY}>{busy && <Spinner />}<Check className="h-4 w-4" />Approve</button>
                    <button type="button" onClick={() => setStep('revise')} disabled={busy} className={K_BTN}>Ask to revise</button>
                    <button type="button" onClick={() => setStep('reject')} disabled={busy} className={K_BTN_GHOST_DANGER}><X className="h-4 w-4" />Reject</button>
                </div>
            )}
            {step === 'reject' && box('Reason', true, () => void act({ action: 'decide', approvalRevision: o.approvalRevision, expectedLevel: o.currentLevel, decision: 'reject', reason: text }, 'Rejected'), 'Reject', true)}
            {step === 'revise' && box('What to revise', true, () => void act({ action: 'decide', approvalRevision: o.approvalRevision, expectedLevel: o.currentLevel, decision: 'revise', reason: text }, 'Sent back to revise'), 'Send back')}

            {o.status === 'approved' && !step && (
                <div className="mt-2 space-y-2">
                    {o.letterGaps.length > 0 && <p role="status" className="text-xs font-medium text-red-700 dark:text-red-400">The letter has blanks to fill before release: {o.letterGaps.join(', ')}.</p>}
                    <div className="flex flex-wrap gap-2">
                        <button type="button" onClick={() => { setLetter(o.letter ?? ''); setDate(o.joiningDate ?? ''); setStep('letter'); }} className={K_BTN}>Check the letter</button>
                        <button type="button" onClick={() => void act({ action: 'release' }, 'Released: the letter was emailed to the candidate')} disabled={busy || o.letterGaps.length > 0} className={K_BTN_PRIMARY} title={o.letterGaps.length ? 'Fill the blanks in the letter first' : undefined}>{busy && <Spinner />}<Send className="h-4 w-4" />Release the offer</button>
                    </div>
                </div>
            )}
            {step === 'letter' && (
                <div className={`${K_WELL} mt-2 space-y-2 px-3 py-2.5`}>
                    <label className="block text-xs text-text-secondary">Joining date<input type="date" value={date} onChange={e => setDate(e.target.value)} className={`${INPUT} mt-1 sm:max-w-[200px]`} /></label>
                    <label className={K_LABEL} htmlFor={`letter-${o.id}`}>The letter (anything still in {'{{…}}'} blocks the release)</label>
                    <textarea id={`letter-${o.id}`} rows={12} value={letter} onChange={e => setLetter(e.target.value)} className={`${K_AREA} font-mono text-[13px]`} />
                    <div className="flex gap-2"><button type="button" onClick={() => setStep(null)} disabled={busy} className={K_BTN}>Back</button><button type="button" onClick={() => void act({ action: 'letter', letter, joiningDate: date || null }, 'Letter saved')} disabled={busy} className={K_BTN_PRIMARY}>{busy && <Spinner />}Save the letter</button></div>
                </div>
            )}

            {o.status === 'released' && !step && (
                <div className="mt-2 flex flex-wrap gap-2">
                    <button type="button" onClick={() => setStep('accepted')} className={K_BTN_PRIMARY}><Check className="h-4 w-4" />Accepted</button>
                    <button type="button" onClick={() => setStep('declined')} className={K_BTN_GHOST_DANGER}>Declined</button>
                </div>
            )}
            {step === 'accepted' && box('Note', false, () => void act({ action: 'response', response: 'accepted', reason: text || undefined, joiningDate: date }, 'Accepted: weekly contact reminders start'), 'Record acceptance', false, true)}
            {step === 'declined' && box('Why did they decline?', true, () => void act({ action: 'response', response: 'declined', reason: text }, 'Declined: recorded'), 'Record', true)}

            {o.status === 'accepted' && !step && (
                <div className="mt-2 flex flex-wrap gap-2">
                    <button type="button" onClick={() => setStep('contact')} className={K_BTN}><Phone className="h-4 w-4" />Log a call</button>
                    <button type="button" onClick={() => void act({ action: 'joining', outcome: 'joined' }, 'Joined')} disabled={busy} className={K_BTN_PRIMARY}>{busy && <Spinner />}Joined</button>
                    <button type="button" onClick={() => setStep('dropped')} className={K_BTN_GHOST_DANGER}>Did not join</button>
                </div>
            )}
            {step === 'contact' && box('What was said', false, () => void act({ action: 'contact', note: text || undefined }, 'Call logged'), 'Log the call')}
            {step === 'dropped' && box('Why are they not joining?', true, () => void act({ action: 'joining', outcome: 'dropped', reason: text }, 'Dropped: the position is open again; the HR Head and Director are told'), 'Record', true)}

            {breakupOpen && <BreakupEditor orgId={orgId} offer={o} onClose={() => setBreakupOpen(false)} onSaved={() => { setBreakupOpen(false); onChanged(); }} />}
            {!compact && o.events.length > 0 && (
                <details className="mt-2 text-xs text-text-secondary">
                    <summary className="cursor-pointer rounded font-medium text-text-secondary hover:text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">History</summary>
                    <ol className="mt-1 space-y-0.5 pl-4">{o.events.map((e, k) => <li key={k}>{formatDate(e.at)} · {e.action.replace(/_/g, ' ')}{e.byName ? ` · ${e.byName}` : ''}{e.reason ? `: “${e.reason}”` : ''}</li>)}</ol>
                </details>
            )}
        </div>
    );
}

/** Owner 2026-11-24: the salary breakup (annexure). Saving starts the approval again from the first approver. */
function BreakupEditor({ orgId, offer, onClose, onSaved }: { orgId: string; offer: Offer; onClose: () => void; onSaved: () => void }) {
    const { notify } = useUi();
    const [cfg, setCfg] = useState<OutreachSettings['offer'] | null>(null);
    const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(Object.entries(offer.breakup ?? {}).map(([k, v]) => [k, String(v)])));
    const [ctc, setCtc] = useState(String(offer.proposedCtc / 100_000));
    const [busy, setBusy] = useState(false);
    useEffect(() => {
        const ctrl = new AbortController();
        void api<{ settings: OutreachSettings }>(`/api/candidates/outreach/settings${qs({ orgId })}`, { signal: ctrl.signal }).then(res => { if (!ctrl.signal.aborted && res.ok) setCfg(res.data.settings.offer); });
        return () => ctrl.abort();
    }, [orgId]);
    const n = (k: string) => { const v = Number(values[k]); return Number.isFinite(v) ? v : 0; };
    const gross = (cfg?.earnings ?? []).reduce((t, k) => t + n(k), 0);
    const ded = (cfg?.deductions ?? []).reduce((t, k) => t + n(k), 0);
    const benefits = (cfg?.benefits ?? []).reduce((t, k) => t + n(k), 0);
    const annual = gross * 12 + benefits;
    const save = async () => {
        const breakup: Record<string, number> = {};
        for (const [k, v] of Object.entries(values)) if (v.trim() !== '' && Number.isFinite(Number(v)) && Number(v) >= 0) breakup[k] = Math.round(Number(v));
        const proposedCtc = Math.round(Number(ctc) * 100_000);
        if (!(proposedCtc > 0)) { notify('Give the CTC in lakhs per year.', 'error'); return; }
        setBusy(true);
        const res = await api<{ offer: Offer }>(`/api/candidates/offers/${encodeURIComponent(offer.id)}`, { method: 'PATCH', json: { orgId, action: 'breakup', breakup, proposedCtc } });
        setBusy(false);
        if (!res.ok) { notify(res.error, 'error'); return; }
        notify(`Saved. Approval starts again with ${res.data.offer.currentApproverName ?? 'the first approver'}.`, 'success');
        onSaved();
    };
    const field = (k: string) => (
        <label key={k} className="flex items-center justify-between gap-3 text-sm"><span className="text-text-secondary">{k}</span>
            <input type="number" min={0} step={100} value={values[k] ?? ''} onChange={e => setValues(v => ({ ...v, [k]: e.target.value }))} className={`${K_FIELD} w-36 text-right`} /></label>
    );
    return (
        <Dialog open onClose={onClose} title={`Salary breakup: ${offer.candidateName}`} labelId={`breakup-${offer.id}`} size="lg"
            description="In rupees: earnings and deductions per month, benefits per year. The hiring manager, the HR Head and the Director approve it before the candidate sees it; saving a change starts the approval again."
            footer={<button type="button" onClick={() => void save()} disabled={busy || !cfg} className={K_BTN_PRIMARY}>{busy && <Spinner />}Save and send for approval</button>}>
            {!cfg ? <div className="flex justify-center py-6"><Spinner /></div> : (
                <div className="space-y-4">
                    <label className="block text-sm"><span className={K_LABEL}>Offer CTC (lakhs per year)</span><input type="number" min={0} step={0.1} value={ctc} onChange={e => setCtc(e.target.value)} className={`${INPUT} mt-1 sm:max-w-[200px]`} /></label>
                    <div className="grid gap-4 sm:grid-cols-3">
                        <div className="space-y-2"><p className="text-sm font-semibold">Earnings (per month)</p>{cfg.earnings.map(field)}<p className="text-sm font-semibold">Gross {inr(gross)}</p></div>
                        <div className="space-y-2"><p className="text-sm font-semibold">Deductions (per month)</p>{cfg.deductions.map(field)}<p className="text-sm font-semibold">Net {inr(gross - ded)}</p></div>
                        <div className="space-y-2"><p className="text-sm font-semibold">Benefits (per year)</p>{cfg.benefits.map(field)}</div>
                    </div>
                    <p className={`text-sm ${Math.abs(annual - Number(ctc) * 100_000) > 1000 && gross > 0 ? 'text-amber-700 dark:text-amber-300' : 'text-text-secondary'}`}>Gross × 12 + benefits = {inr(annual)} a year{gross > 0 ? ` (the CTC is ${lpa(Math.round(Number(ctc) * 100_000))})` : ''}. Change the rows in Recruitment → Outreach → Assignment &amp; offer.</p>
                </div>
            )}
        </Dialog>
    );
}

/** Owner 2026-11-24: accepted offers, ready for onboarding (HRMS), with everything collected. */
function Handovers({ orgId, handovers, onChanged }: { orgId: string; handovers: OfferHandover[]; onChanged: () => void }) {
    const { notify } = useUi();
    const [busy, setBusy] = useState<string | null>(null);
    const pending = handovers.filter(h => h.status === 'pending');
    if (!pending.length) return null;
    const take = async (id: string) => {
        setBusy(id);
        const res = await api<{ ok: true }>('/api/candidates/offers', { method: 'PATCH', json: { orgId, handoverId: id } });
        setBusy(null);
        if (!res.ok) { notify(res.error, 'error'); return; }
        notify('Marked as taken by onboarding', 'success');
        onChanged();
    };
    return (
        <section className={`${K_CARD} space-y-2 px-4 py-4 sm:px-5`} aria-label="Handovers to onboarding">
            <p className="flex items-center gap-1.5 text-[15px] font-semibold text-text-primary"><ClipboardCheck className="h-4 w-4 text-primary" aria-hidden />Ready for onboarding ({pending.length})</p>
            {pending.map(h => {
                const snap = h.snapshot as { candidate?: { email?: string | null; phone?: string | null }; department?: string | null; documents?: { item: string; status: string }[] };
                const docs = snap.documents ?? [];
                return (
                    <div key={h.id} className={`${K_WELL} flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm`}>
                        <span className="font-semibold text-text-primary">{h.candidateName}</span>
                        <span className="text-text-secondary">{[h.positionTitle, snap.department].filter(Boolean).join(' · ')}</span>
                        <span className="text-text-secondary">joining {h.joiningDate ? formatDate(h.joiningDate) : '—'}</span>
                        <span className="text-xs text-text-tertiary">{[snap.candidate?.email, snap.candidate?.phone].filter(Boolean).join(' · ')} · documents {docs.filter(d => d.status === 'verified').length}/{docs.length} verified</span>
                        <button type="button" onClick={() => void take(h.id)} disabled={busy === h.id} className={`${K_BTN} ml-auto`}>{busy === h.id && <Spinner />}Taken by onboarding</button>
                    </div>
                );
            })}
        </section>
    );
}
