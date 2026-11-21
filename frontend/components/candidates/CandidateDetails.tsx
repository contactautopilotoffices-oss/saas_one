'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Ban, Download, ExternalLink, FileText, Paperclip, PencilLine, ScanText, Search, Unlink } from 'lucide-react';
import { DEFENCE_OPTIONS, EDUCATION_TYPES, NO_QUALIFICATION } from '@/backend/lib/candidates/filters';
import { markKeywords } from '@/backend/lib/candidates/snippet';
import {
    BLACKLIST_REASON_LABELS, BLACKLIST_REASONS, MATCH_REASON_LABELS, originLabel, RECORD_STATUSES, STATUS_LABELS, TEXT_STATUS_LABELS,
    type BlacklistReason, type CandidateRecord, type Position, type RecordStatus, type ResumeFile, type ResumeFilesResponse, type Stage,
} from '@/backend/lib/candidates/types';
import { api, qs } from './api';
import CallsTab from './CallsTab';
import { formatDate, formatInr, formatMonths, formatNotice, STATUS_DOT } from './format';
import { InterviewsList } from './InterviewScheduler';
import { OutreachSection } from './OutreachPanel';
import { StageChip, useStages } from './stage-ui';
import { findStage, unlistedStage } from '@/backend/lib/candidates/stage-list';
import { PipelineStrip, PositionFitCard, type PipelineContext } from './PipelineContext';
import { ActivityTimeline, BlacklistedTag, BTN_DANGER_FILLED, REMARK_MAX, statusNeedsRemark } from './Remarks';
import { WorkedOut } from './ResultCard';
import ResumeDocument, { hasProfile } from './ResumeDocument';
import { Avatar, BTN_GHOST, BTN_PRIMARY, BTN_SECONDARY, CARD, Drawer, EmptyState, INPUT, LABEL, Spinner, Tag, useUi, WELL } from './ui';

function Row({ label, value }: { label: string; value: React.ReactNode }) {
    return (
        <div className="min-w-0">
            <dt className="text-xs font-medium text-text-secondary">{label}</dt>
            <dd className="mt-0.5 break-words text-sm font-medium text-text-primary">{value || <span className="font-normal text-text-tertiary">Not on record</span>}</dd>
        </div>
    );
}

type Files = { candidateId: string; files: ResumeFile[]; error: string };
type Tab = 'overview' | 'resume' | 'activity' | 'positions' | 'interviews' | 'calls';
/** The inline form open under the header, if any. */
type Panel = null | 'status' | 'positions' | 'blacklist' | 'outreach';
/** The mockup's small header buttons (36 px, 13 px text). */
const BTN_SM = 'h-9 rounded-xl px-3 text-[13px]';

/** Email and phone with the middle hidden, as the panel's meta line shows them. */
const maskEmail = (email: string) => { const [user, domain] = email.split('@'); return domain && user.length > 3 ? `${user.slice(0, 3)}•••@${domain}` : email; };
const maskPhone = (phone: string) => (phone.length > 6 ? `${phone.slice(0, 2)}•••• ${phone.slice(-4)}` : phone);

/**
 * One candidate's panel (owner 2026-11-15, to the mockup): the person at the top with the actions that matter
 * (status, add to position, add remark, attach a resume, blacklist), then Overview · Resume · Activity · Positions.
 * A status change opens "Change status" inline: "Others" needs a remark. Nothing here changes by accident: every
 * action is a click on a named button, and every one of them is in the history.
 */
export default function CandidateDetails({ record, open, onClose, onEdit, orgId, onChanged, keywords = [], pipeline = null }: {
    record: CandidateRecord; open: boolean; onClose: () => void; onEdit: () => void;
    orgId: string;
    /**
     * Opened from the Pipeline tab (owner 2026-11-17): the position and the person's place in it. Adds the strip with
     * the stage and the quick actions, the fit for the position, and that position's history first.
     */
    pipeline?: PipelineContext | null;
    /** Something changed (status, resume, blacklist, position): the lists behind the panel refetch. */
    onChanged?: () => void;
    /** The search's keywords, marked in the resume's text. */
    keywords?: string[];
}) {
    const { notify, reportError } = useUi();

    // The lists hand over a record without the resume fields or the blacklist entry: fetch the full record once per opening.
    const [full, setFull] = useState<{ id: string; record: CandidateRecord } | null>(null);
    const needsFull = open && (record.extras === undefined || record.blacklist === undefined) && full?.id !== record.id;
    useEffect(() => {
        if (!needsFull) return;
        const ctrl = new AbortController();
        void api<{ record: CandidateRecord }>(`/api/candidates/${encodeURIComponent(record.id)}${qs({ orgId })}`, { signal: ctrl.signal }).then(res => {
            if (ctrl.signal.aborted) return;
            if (res.ok) setFull({ id: record.id, record: res.data.record });
            else if (res.noAccess) reportError(res);
        });
        return () => ctrl.abort();
    }, [needsFull, record.id, orgId, reportError]);
    const r: CandidateRecord = full?.id === record.id
        ? { ...record, ...full.record, keywordHits: record.keywordHits ?? full.record.keywordHits, resumeSnippet: record.resumeSnippet ?? full.record.resumeSnippet }
        : record;
    const x = r.extras;
    const replace = (saved: CandidateRecord) => { setFull({ id: record.id, record: saved }); onChanged?.(); };

    const [tab, setTab] = useState<Tab>('overview');
    const [historyNonce, setHistoryNonce] = useState(0);
    const [focusRemark, setFocusRemark] = useState(0);
    // Owner 2026-11-16: the Calls tab (a recorded screening call, transcribed and read); the count beside the tab.
    const [callsNonce, setCallsNonce] = useState(0);

    // Owner 2026-11-16: one inline form open at a time (Change status, Add to position, Blacklist, the resume picker).
    // Opening one closes the others, and moving to another tab, closing the panel or opening another candidate closes
    // it: a form never stays open behind the user's back, and the next one opens with its defaults.
    const [panel, setPanel] = useState<Panel>(null);
    const [picking, setPicking] = useState(false);
    const closeForms = () => { setPanel(null); setPicking(false); };
    const goTo = (next: Tab) => { closeForms(); setTab(next); };
    const [seenFor, setSeenFor] = useState(`${record.id}:${open}`);
    if (seenFor !== `${record.id}:${open}`) { setSeenFor(`${record.id}:${open}`); closeForms(); }

    // The candidate's resume files.
    const [nonce, setNonce] = useState(0);
    const filesKey = JSON.stringify([orgId, r.candidateId, nonce]);
    const [loaded, setLoaded] = useState<Files | null>(null);
    useEffect(() => {
        if (!open) return;
        const ctrl = new AbortController();
        void api<ResumeFilesResponse>(`/api/candidates/resumes${qs({ orgId, candidateId: r.candidateId, pageSize: 20 })}`, { signal: ctrl.signal }).then(res => {
            if (ctrl.signal.aborted) return;
            if (!res.ok) { if (res.noAccess) reportError(res); setLoaded({ candidateId: r.candidateId, files: [], error: res.error }); return; }
            setLoaded({ candidateId: r.candidateId, files: res.data.files, error: '' });
        });
        return () => ctrl.abort();
    }, [open, filesKey, orgId, r.candidateId, reportError]);
    const mine = loaded?.candidateId === r.candidateId ? loaded : null;
    const files = mine?.files ?? [];
    const filesReady = mine !== null;
    const [viewId, setViewId] = useState<string | null>(null);
    const viewing = files.find(f => f.id === viewId) ?? files[0] ?? null;

    // Status: the pill opens "Change status"; Others needs a remark.
    const statusOpen = panel === 'status';
    const [nextStatus, setNextStatus] = useState<RecordStatus>(r.status);
    const [statusRemark, setStatusRemark] = useState('');
    const [busy, setBusy] = useState(false);
    const openStatus = () => {
        if (statusOpen) { setPanel(null); return; }
        setNextStatus(r.status); setStatusRemark(''); setPicking(false); setPanel('status');
    };
    const saveStatus = async () => {
        if (busy) return;
        const remark = statusRemark.trim();
        if (statusNeedsRemark(nextStatus) && !remark) return;
        setBusy(true);
        const res = await api<{ record: CandidateRecord }>(`/api/candidates/${encodeURIComponent(r.id)}`, { method: 'PATCH', json: { orgId, status: nextStatus, ...(remark ? { actionRemark: remark } : {}) } });
        setBusy(false);
        if (!res.ok) { notify(res.error, 'error'); if (res.noAccess) reportError(res); return; }
        replace(res.data.record);
        setPanel(null);
        setHistoryNonce(n => n + 1);
        notify(`${r.fullName}: ${STATUS_LABELS[nextStatus]}`, 'success');
    };

    // Add to position: the open positions, picked inline.
    const positionsOpen = panel === 'positions';
    const togglePositions = () => { setPicking(false); setPanel(positionsOpen ? null : 'positions'); };
    const [positions, setPositions] = useState<Position[] | null>(null);
    useEffect(() => {
        if (!positionsOpen || positions) return;
        const ctrl = new AbortController();
        void api<{ positions: Position[] }>(`/api/candidates/positions${qs({ orgId })}`, { signal: ctrl.signal }).then(res => { if (!ctrl.signal.aborted) setPositions(res.ok ? res.data.positions : []); });
        return () => ctrl.abort();
    }, [positionsOpen, positions, orgId]);
    const [membershipNonce, setMembershipNonce] = useState(0);
    const addTo = async (p: Position) => {
        setBusy(true);
        const res = await api<{ added: number; skipped: number }>(`/api/candidates/positions/${encodeURIComponent(p.id)}/members`, { json: { orgId, applicationIds: [r.id] } });
        setBusy(false);
        if (!res.ok) { notify(res.error, 'error'); if (res.noAccess) reportError(res); return; }
        setPanel(null);
        setHistoryNonce(n => n + 1);
        setMembershipNonce(n => n + 1);
        notify(res.data.added ? `${r.fullName} added to ${p.title}` : `${r.fullName} is already in ${p.title}`, res.data.added ? 'success' : 'info');
        onChanged?.();
    };

    // Blacklist, inline.
    const blacklistOpen = panel === 'blacklist';
    const [reason, setReason] = useState<BlacklistReason>('did_not_join');
    const [blRemark, setBlRemark] = useState('');
    const toggleBlacklist = () => {
        if (blacklistOpen) { setPanel(null); return; }
        setReason('did_not_join'); setBlRemark(''); setPicking(false); setPanel('blacklist');
    };
    const applyBlacklist = async (method: 'POST' | 'DELETE', json: Record<string, unknown>) => {
        setBusy(true);
        const res = await api<{ record: CandidateRecord }>(`/api/candidates/${encodeURIComponent(r.id)}/blacklist`, { method, json: { orgId, ...json } });
        setBusy(false);
        if (!res.ok) { notify(res.error, 'error'); if (res.noAccess) reportError(res); return; }
        replace(res.data.record);
        setPanel(null);
        setHistoryNonce(n => n + 1);
        notify(method === 'POST' ? `${r.fullName} is blacklisted and hidden from searches` : `${r.fullName} is back in the searches`, 'success');
    };

    const qualifications = x ? [x.ugQualification, x.pgQualification, x.ppgQualification].filter(q => q && q.toLowerCase() !== NO_QUALIFICATION) : [];
    const resumeRows: [string, React.ReactNode][] = x ? [
        ['Industry', x.industry],
        ['Education', qualifications.join(', ')],
        ['Institute', x.institute],
        ['Degree completed', x.degreeYear ? String(x.degreeYear) : null],
        ['Education type', EDUCATION_TYPES.find(t => t.id === x.educationType)?.label],
        ['Would move to', x.preferredLocations.join(', ')],
        ['Career break', x.careerBreak === null ? null : x.careerBreak ? 'Yes' : 'No'],
        ['Defence background', DEFENCE_OPTIONS.find(d => d.id === x.defenceBackground)?.label],
        ['Serving notice', x.servingNotice === null ? null : x.servingNotice ? 'Yes' : 'No'],
    ].filter(([, value]) => !!value) as [string, React.ReactNode][] : [];
    const headline = [[r.currentDesignation, r.currentOrganization].filter(Boolean).join(' @ '), r.location, [r.totalExpMonths !== null && `${formatMonths(r.totalExpMonths)} total`, r.relevantExpMonths !== null && `${formatMonths(r.relevantExpMonths)} relevant`].filter(Boolean).join(', ')].filter(Boolean).join(' · ');
    const meta = [r.email && maskEmail(r.email), r.phone && maskPhone(r.phone), r.sourcingDate && `sourced ${formatDate(r.sourcingDate)}${r.candidateSource ? ` via ${r.candidateSource}` : ''}`].filter(Boolean).join(' · ');
    const hits = r.keywordHits ?? [];

    const header = (
        <div className="px-5 pb-0 pt-5 sm:px-6 sm:pt-6">
            <div className="flex items-start gap-x-3.5 pr-10">
                <Avatar name={r.fullName} size="lg" />
                <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="font-display text-xl font-bold leading-tight text-text-primary">{r.fullName}</span>
                        {r.hasResume === true && <Tag tone="success" icon={FileText}>Resume{files.length > 1 ? ` · ${files.length}` : ''}</Tag>}
                        {r.hasResume === false && <Tag>No resume</Tag>}
                        <MembershipCount orgId={orgId} record={r} nonce={membershipNonce} />
                        {r.blacklisted && <BlacklistedTag entry={r.blacklist} />}
                    </div>
                    {headline && <p className="mt-0.5 text-sm text-text-primary">{headline}</p>}
                    {meta && <p className="mt-0.5 text-xs text-text-secondary">{meta}</p>}
                </div>
                <button type="button" onClick={() => { closeForms(); onEdit(); }} className={`${BTN_GHOST} -mt-1 shrink-0`} title="Edit details"><PencilLine className="h-4 w-4" />Edit</button>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-2">
                <button type="button" onClick={openStatus} aria-expanded={statusOpen} className={`${BTN_SECONDARY} ${BTN_SM} gap-x-2 ring-[1.5px] ring-inset ring-primary`}>
                    <span className={`h-2 w-2 rounded-full ${STATUS_DOT[r.status]}`} aria-hidden />{STATUS_LABELS[r.status]}<span className="text-text-tertiary" aria-hidden>▾</span>
                </button>
                <button type="button" onClick={togglePositions} aria-expanded={positionsOpen} className={`${BTN_PRIMARY} ${BTN_SM}`}>Add to position</button>
                <button type="button" onClick={() => { goTo('activity'); setFocusRemark(n => n + 1); }} className={`${BTN_SECONDARY} ${BTN_SM}`}>Add remark</button>
                <button type="button" onClick={() => { goTo('resume'); setPicking(true); }} className={`${BTN_SECONDARY} ${BTN_SM}`}>Attach a resume</button>
                {!r.blacklisted && (
                    <button type="button" onClick={() => { setPicking(false); setPanel(panel === 'outreach' ? null : 'outreach'); }} aria-expanded={panel === 'outreach'} className={`${BTN_SECONDARY} ${BTN_SM}`} title="Tell the candidate on WhatsApp">Send update</button>
                )}
                {r.blacklist !== undefined && !r.blacklisted && (
                    <button type="button" onClick={toggleBlacklist} aria-expanded={blacklistOpen} className="ml-auto inline-flex h-9 items-center rounded-xl px-3 text-[13px] font-semibold text-error hover:bg-error/[.08]">Blacklist…</button>
                )}
            </div>
            <div role="tablist" aria-label="Candidate sections" className="mt-4 flex flex-wrap">
                {([['overview', 'Overview', null], ['resume', 'Resume', files.length || null], ['activity', 'Activity', null], ['positions', 'Positions', null], ['interviews', 'Interviews', null], ['calls', 'Calls', null]] as const).map(([id, label, n]) => (
                    <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => goTo(id)}
                        className={`-mb-px mr-5 h-10 border-b-2 px-0.5 text-sm font-semibold transition-colors ${tab === id ? 'border-primary text-text-primary' : 'border-transparent text-text-secondary hover:text-text-primary'}`}>
                        {label}{n ? <span className="ml-1.5 text-xs font-medium text-text-tertiary">{n}</span> : null}
                        {id === 'activity' && <ActivityCount orgId={orgId} record={r} nonce={historyNonce} />}
                        {id === 'calls' && <CallsCount orgId={orgId} record={r} nonce={callsNonce} />}
                    </button>
                ))}
            </div>
        </div>
    );

    return (
        <Drawer open={open} onClose={onClose} labelId="candidate-details-title" title={r.fullName} header={header}
            resize={{ storeKey: 'candidate-details-width', initial: 640, min: 520 }}
        >
            <div className="@container space-y-4">
                {pipeline && <PipelineStrip key={`${r.id}:${pipeline.member.id}`} orgId={orgId} record={r} ctx={pipeline} tab={tab} onHistory={() => { setHistoryNonce(n => n + 1); setMembershipNonce(n => n + 1); }} />}

                {/* Change status */}
                {statusOpen && (
                    <section className={`${CARD} px-4 py-4`} aria-label="Change status">
                        <div className="flex items-center justify-between"><span className="font-semibold text-text-primary">Change status</span><span className="text-xs text-text-secondary">a remark is required only for Others</span></div>
                        <div className="mt-3 grid grid-cols-2 gap-x-2 gap-y-1">
                            {RECORD_STATUSES.map(s => (
                                <button key={s} type="button" onClick={() => setNextStatus(s)} aria-pressed={nextStatus === s}
                                    className={`flex h-10 items-center gap-x-3 rounded-lg px-3 text-left text-sm font-medium text-text-primary ${s === 'others' ? 'col-span-2' : ''} ${nextStatus === s ? 'bg-surface-elevated ring-1 ring-inset ring-primary' : 'hover:bg-surface-elevated'}`}>
                                    <span className={`h-2 w-2 shrink-0 rounded-full ${STATUS_DOT[s]}`} aria-hidden />{STATUS_LABELS[s]}
                                    {statusNeedsRemark(s) && <span className="ml-auto text-xs text-text-secondary">remark required</span>}
                                </button>
                            ))}
                        </div>
                        <label htmlFor="cand-status-remark" className="mt-3 block text-xs font-medium text-text-secondary">Remark {statusNeedsRemark(nextStatus) ? <span className="text-error">*</span> : <span>(optional)</span>}</label>
                        <textarea id="cand-status-remark" rows={2} maxLength={REMARK_MAX} value={statusRemark} onChange={e => setStatusRemark(e.target.value)} placeholder={statusNeedsRemark(nextStatus) ? 'Why Others? e.g. Candidate moved to the Bengaluru requirement.' : 'Why, if it helps the next person'} className={`${INPUT} mt-1.5 h-auto min-h-[72px] resize-y py-2.5 leading-relaxed`} />
                        <div className="mt-3 flex justify-end gap-x-2">
                            <button type="button" onClick={() => setPanel(null)} disabled={busy} className={BTN_GHOST}>Cancel</button>
                            <button type="button" onClick={() => void saveStatus()} disabled={busy || nextStatus === r.status || (statusNeedsRemark(nextStatus) && !statusRemark.trim())} className={BTN_PRIMARY}>{busy && <Spinner />}Save status</button>
                        </div>
                    </section>
                )}

                {/* Add to position */}
                {positionsOpen && (
                    <section className={`${WELL} px-4 py-3`} aria-label="Add to position">
                        <p className="text-sm font-semibold text-text-primary">Add to position</p>
                        {positions === null ? <p className="mt-2 text-sm text-text-tertiary"><Spinner className="mr-1.5 inline h-3.5 w-3.5" />Loading</p>
                            : positions.length === 0 ? <p className="mt-2 text-sm text-text-tertiary">No open positions. Save a job description as a position first.</p>
                            : <ul className="mt-2 flex flex-wrap gap-1.5">{positions.map(p => <li key={p.id}><button type="button" onClick={() => void addTo(p)} disabled={busy} className={`${BTN_SECONDARY} h-8 px-3 text-xs`}>{p.title}{p.location ? ` · ${p.location}` : ''}</button></li>)}</ul>}
                    </section>
                )}

                {/* Send update on WhatsApp (owner 2026-11-16) */}
                {panel === 'outreach' && !r.blacklisted && (
                    <OutreachSection orgId={orgId} record={r} onClose={() => setPanel(null)} onSent={() => { setPanel(null); setHistoryNonce(n => n + 1); onChanged?.(); }} />
                )}

                {/* Blacklist */}
                {r.blacklist && (
                    <section role="status" className="rounded-xl bg-error/[.06] px-4 py-3 ring-1 ring-inset ring-error/30">
                        <p className="text-sm font-semibold text-red-800">Blacklisted · {BLACKLIST_REASON_LABELS[r.blacklist.reason]}</p>
                        <p className="mt-0.5 text-xs text-text-secondary">{formatDate(r.blacklist.at)}{r.blacklist.byName ? ` by ${r.blacklist.byName}` : ''}. Hidden from every search until removed.</p>
                        {r.blacklist.remark && <p className="mt-1 text-sm text-text-primary">“{r.blacklist.remark}”</p>}
                        <button type="button" onClick={() => void applyBlacklist('DELETE', {})} disabled={busy} className={`${BTN_GHOST} mt-1.5 -ml-2.5 text-primary-dark`}>{busy ? <Spinner className="h-4 w-4" /> : <Ban className="h-4 w-4" />}Remove from blacklist</button>
                    </section>
                )}
                {blacklistOpen && !r.blacklisted && (
                    <section className={`${CARD} px-4 py-4 ring-1 ring-inset ring-error/30`} aria-label="Blacklist">
                        <div className="flex flex-wrap items-baseline gap-x-2"><span className="font-semibold text-error">Blacklist {r.fullName}</span><span className="text-xs text-text-secondary">hidden from every search and ranking · any HR user can undo it, and it stays in Activity</span></div>
                        <label htmlFor="cand-bl-reason" className="mt-3 block text-xs font-medium text-text-secondary">Reason</label>
                        <select id="cand-bl-reason" value={reason} onChange={e => setReason(e.target.value as BlacklistReason)} className={`${INPUT} mt-1.5`}>{BLACKLIST_REASONS.map(k => <option key={k} value={k}>{BLACKLIST_REASON_LABELS[k]}</option>)}</select>
                        <label htmlFor="cand-bl-remark" className="mt-3 block text-xs font-medium text-text-secondary">Remark <span className="text-text-tertiary">· optional, keep it factual</span></label>
                        <input id="cand-bl-remark" value={blRemark} onChange={e => setBlRemark(e.target.value)} maxLength={REMARK_MAX} placeholder="What happened, in one line" className={`${INPUT} mt-1.5`} />
                        <div className="mt-3 flex justify-end gap-x-2">
                            <button type="button" onClick={() => setPanel(null)} disabled={busy} className={BTN_GHOST}>Cancel</button>
                            <button type="button" onClick={() => void applyBlacklist('POST', { reason, remark: blRemark.trim() })} disabled={busy} className={BTN_DANGER_FILLED}>{busy && <Spinner />}<Ban className="h-4 w-4" />Blacklist</button>
                        </div>
                    </section>
                )}

                {tab === 'overview' && (
                    <>
                        {pipeline && <PositionFitCard record={r} position={pipeline.position} />}
                        {/* Owner 2026-11-16: the cards sit side by side only when the panel is wide enough for one-line values. */}
                        <div className="grid gap-3 @4xl:grid-cols-2">
                            {(hits.length > 0 || r.resumeSnippet) && (
                                <section className={`${CARD} px-4 py-3`} aria-label="Match">
                                    <p className={LABEL}>Match to the search</p>
                                    <ul className="mt-2 space-y-1.5">
                                        {hits.map(h => <li key={h.text}><Tag tone={h.required ? 'success' : 'neutral'}>✓ {h.text} · {h.where === 'both' ? 'record + resume' : h.where}</Tag></li>)}
                                        {hits.length === 0 && <li className="text-sm text-text-tertiary">No keyword matched on record.</li>}
                                    </ul>
                                </section>
                            )}
                            <section className={`${CARD} @container px-4 py-3 ${hits.length > 0 || r.resumeSnippet ? '' : '@4xl:col-span-2'}`} aria-label="Essentials">
                                <dl className="grid grid-cols-[110px_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-sm @2xl:grid-cols-[110px_minmax(0,1fr)_110px_minmax(0,1fr)] @2xl:gap-x-5">
                                    <dt className="text-text-secondary">Notice</dt><dd className="font-semibold text-text-primary">{r.noticePeriodDays !== null ? `${formatNotice(r.noticePeriodDays)}${x?.servingNotice ? ' · serving' : ''}` : '—'}</dd>
                                    <dt className="text-text-secondary">In-hand</dt><dd className="font-semibold text-text-primary">{r.currentInhand !== null || r.expectedInhand !== null ? `${r.currentInhand !== null ? formatInr(r.currentInhand) : '—'} → ${r.expectedInhand !== null ? formatInr(r.expectedInhand) : '—'} / month` : '—'}</dd>
                                    <dt className="text-text-secondary">Relocate</dt><dd className="font-semibold text-text-primary">{x?.preferredLocations?.length ? x.preferredLocations.join(', ') : r.location ? `${r.location} only` : '—'}</dd>
                                    <dt className="text-text-secondary">Education</dt><dd className="font-semibold text-text-primary">{[qualifications.join(', '), x?.degreeYear].filter(Boolean).join(' · ') || '—'}</dd>
                                    <dt className="text-text-secondary">Sourced for</dt><dd className="font-semibold text-text-primary">{r.role ?? '—'}</dd>
                                </dl>
                            </section>
                        </div>
                        <dl className="grid grid-cols-2 gap-x-4 gap-y-3.5 @2xl:grid-cols-3 @5xl:grid-cols-4">
                            <Row label="Current designation" value={r.currentDesignation && <>{r.currentDesignation}{r.inferred?.includes('currentDesignation') && <WorkedOut what="the latest employer" />}</>} />
                            <Row label="Current company" value={r.currentOrganization && <>{r.currentOrganization}{r.inferred?.includes('currentOrganization') && <WorkedOut what="the latest employer" />}</>} />
                            <Row label="Location" value={r.location} />
                            <Row label="Total experience" value={r.totalExpMonths !== null && <>{formatMonths(r.totalExpMonths)}{r.inferred?.includes('totalExpMonths') && <WorkedOut />}</>} />
                            <Row label="Relevant experience" value={r.relevantExpMonths !== null && formatMonths(r.relevantExpMonths)} />
                            <Row label="Source" value={r.candidateSource} />
                            <Row label="Came from" value={`${originLabel(r)}${r.sourceRow ? `, row ${r.sourceRow}` : ''}`} />
                            <Row label="Updated" value={formatDate(r.updatedAt)} />
                            {resumeRows.filter(([label]) => label !== 'Education' && label !== 'Would move to' && label !== 'Serving notice').map(([label, value]) => <Row key={label} label={label} value={value} />)}
                        </dl>
                        <div>
                            <p className="text-xs font-medium text-text-secondary">Remark on the record</p>
                            <p className="mt-0.5 whitespace-pre-wrap break-words text-sm text-text-primary">{r.remark || <span className="text-text-tertiary">No remark</span>}</p>
                        </div>
                    </>
                )}

                {tab === 'resume' && (
                    <>
                        <ResumeSection
                            orgId={orgId} candidateId={r.candidateId} fullName={r.fullName}
                            files={files} ready={filesReady} error={mine?.error ?? ''} viewingId={viewing?.id ?? null} onView={setViewId}
                            onChanged={() => { setNonce(n => n + 1); setHistoryNonce(n => n + 1); onChanged?.(); }}
                            picking={picking} onPicking={p => { if (p) setPanel(null); setPicking(p); }}
                        />
                        <ResumeReader orgId={orgId} record={r} file={viewing} ready={filesReady} keywords={keywords} />
                    </>
                )}

                {tab === 'activity' && open && <ActivityTimeline orgId={orgId} record={r} nonce={historyNonce} focusNonce={focusRemark} position={pipeline ? { id: pipeline.position.id, title: pipeline.position.title } : null} />}

                {tab === 'positions' && open && <MembershipsList orgId={orgId} record={r} nonce={membershipNonce} />}
                {/* Owner 2026-11-19: the interviews scheduled, their links and, after the call, the notes */}
                {tab === 'interviews' && open && <InterviewsList orgId={orgId} record={r} nonce={historyNonce} />}

                {tab === 'calls' && open && (
                    <CallsTab orgId={orgId} record={r}
                        onLogged={() => { setHistoryNonce(n => n + 1); setCallsNonce(n => n + 1); }}
                        onRecord={saved => replace(saved)} />
                )}
            </div>
        </Drawer>
    );
}

/** The number beside the Calls tab. */
function CallsCount({ orgId, record, nonce }: { orgId: string; record: CandidateRecord; nonce: number }) {
    const [n, setN] = useState<{ id: string; n: number } | null>(null);
    useEffect(() => {
        const ctrl = new AbortController();
        void api<{ calls: unknown[] }>(`/api/candidates/calls${qs({ orgId, candidateId: record.candidateId })}`, { signal: ctrl.signal }).then(res => { if (!ctrl.signal.aborted && res.ok) setN({ id: record.id, n: res.data.calls.length }); });
        return () => ctrl.abort();
    }, [orgId, record.id, record.candidateId, nonce]);
    if (!n || n.id !== record.id || n.n === 0) return null;
    return <span className="ml-1.5 text-xs font-medium text-text-tertiary">{n.n}</span>;
}

/** The "In N positions" tag in the header. */
function MembershipCount({ orgId, record, nonce }: { orgId: string; record: CandidateRecord; nonce: number }) {
    const [n, setN] = useState<{ id: string; n: number } | null>(null);
    useEffect(() => {
        const ctrl = new AbortController();
        void api<{ memberships: unknown[] }>(`/api/candidates/${encodeURIComponent(record.id)}/positions${qs({ orgId })}`, { signal: ctrl.signal }).then(res => { if (!ctrl.signal.aborted && res.ok) setN({ id: record.id, n: res.data.memberships.length }); });
        return () => ctrl.abort();
    }, [orgId, record.id, nonce]);
    if (!n || n.id !== record.id || n.n === 0) return null;
    return <Tag tone="info">In {n.n} {n.n === 1 ? 'position' : 'positions'}</Tag>;
}

/** The number beside the Activity tab. */
function ActivityCount({ orgId, record, nonce }: { orgId: string; record: CandidateRecord; nonce: number }) {
    const [n, setN] = useState<{ id: string; n: number } | null>(null);
    useEffect(() => {
        const ctrl = new AbortController();
        void api<{ actions: unknown[] }>(`/api/candidates/${encodeURIComponent(record.id)}/actions${qs({ orgId })}`, { signal: ctrl.signal }).then(res => { if (!ctrl.signal.aborted && res.ok) setN({ id: record.id, n: res.data.actions.length }); });
        return () => ctrl.abort();
    }, [orgId, record.id, nonce]);
    if (!n || n.id !== record.id || n.n === 0) return null;
    return <span className="ml-1.5 text-xs font-medium text-text-tertiary">{n.n}</span>;
}

/** The positions this person is in, with the stage in each. */
function MembershipsList({ orgId, record, nonce }: { orgId: string; record: CandidateRecord; nonce: number }) {
    const { reportError } = useUi();
    const [state, setState] = useState<{ id: string; rows: { member: { id: string; stage: Stage; stageChangedAt: string; remark: string | null }; position: { id: string; title: string; location: string | null; status: 'open' | 'closed' } }[] } | null>(null);
    useEffect(() => {
        const ctrl = new AbortController();
        void api<{ memberships: NonNullable<typeof state>['rows'] }>(`/api/candidates/${encodeURIComponent(record.id)}/positions${qs({ orgId })}`, { signal: ctrl.signal }).then(res => {
            if (ctrl.signal.aborted) return;
            if (res.ok) setState({ id: record.id, rows: res.data.memberships });
            else if (res.noAccess) reportError(res);
            else setState({ id: record.id, rows: [] });
        });
        return () => ctrl.abort();
    }, [orgId, record.id, reportError, nonce]);
    const rows = state?.id === record.id ? state.rows : null;
    const stages = useStages(orgId)?.stages ?? [];
    return (
        <section aria-label="Positions">
            {rows === null ? (
                <p className="flex items-center gap-x-2 text-sm text-text-tertiary"><Spinner className="h-3.5 w-3.5" />Loading</p>
            ) : rows.length === 0 ? (
                <p className="text-sm text-text-tertiary">Not in any position yet. Use Add to position above.</p>
            ) : (
                <ul className="space-y-2">
                    {rows.map(({ member, position }) => (
                        <li key={member.id} className={`${WELL} px-3 py-2.5`}>
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                <span className="min-w-0 flex-1 truncate text-sm font-semibold text-text-primary">{position.title}{position.location ? <span className="font-normal text-text-secondary"> · {position.location}</span> : null}</span>
                                <Tag tone={position.status === 'open' ? 'success' : 'neutral'}>{position.status === 'open' ? 'Open' : 'Closed'}</Tag>
                            </div>
                            <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-xs text-text-secondary"><StageChip stage={findStage(stages, member.stage) ?? unlistedStage(member.stage)} /> since {formatDate(member.stageChangedAt)}</p>
                            {member.remark && <p className="mt-0.5 text-xs italic text-text-secondary">“{member.remark}”</p>}
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}

const openUrl = (orgId: string, file: ResumeFile, inline: boolean) => {
    window.open(`/api/candidates/resumes/${encodeURIComponent(file.id)}${qs({ orgId, inline })}`, '_blank', 'noopener');
};

/** The resume being read, under the file list: a structured page built from the details on record and the file's own text. */
function ResumeReader({ orgId, record, file, ready, keywords }: { orgId: string; record: CandidateRecord; file: ResumeFile | null; ready: boolean; keywords: string[] }) {
    const [text, setText] = useState<{ id: string; text: string; fromScan: boolean; error: string } | null>(null);
    const fileId = file?.id ?? null;
    useEffect(() => {
        if (!fileId) return;
        const ctrl = new AbortController();
        void api<{ fileName: string; text: string; fromScan: boolean }>(`/api/candidates/resumes/${encodeURIComponent(fileId)}${qs({ orgId, text: true })}`, { signal: ctrl.signal }).then(res => {
            if (ctrl.signal.aborted) return;
            setText(res.ok ? { id: fileId, text: res.data.text, fromScan: res.data.fromScan, error: '' } : { id: fileId, text: '', fromScan: false, error: res.error });
        });
        return () => ctrl.abort();
    }, [fileId, orgId]);
    const current = text?.id === fileId ? text : null;
    const body = current?.text ?? '';
    const keywordKey = keywords.join('\n');
    const words = useMemo(() => (keywordKey ? keywordKey.split('\n') : []), [keywordKey]);
    const hits = useMemo(() => (body && words.length ? markKeywords(body, words).filter(p => p.hit).length : 0), [body, words]);
    const profile = hasProfile(record);
    return (
        <section aria-label="Resume text" className={`${WELL} px-4 py-4`}>
            {file && (
                <div className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold text-text-primary" title={file.fileName}>{file.fileName}</span>
                    {current?.fromScan && <Tag tone="info" icon={ScanText} title="This file is a scan: its text was typed out by AI and may have small mistakes.">Typed from a scan</Tag>}
                    {hits > 0 && <Tag tone="neutral">{hits} keyword {hits === 1 ? 'match' : 'matches'}</Tag>}
                    <button type="button" onClick={() => openUrl(orgId, file, true)} className={`${BTN_GHOST} h-8`}><ExternalLink className="h-4 w-4" />Open original</button>
                </div>
            )}
            {!ready ? <p className="flex items-center gap-x-2 text-sm text-text-tertiary"><Spinner className="h-3.5 w-3.5" />Loading the resume</p>
                : file && !current ? <p className="flex items-center gap-x-2 text-sm text-text-tertiary"><Spinner className="h-3.5 w-3.5" />Reading the resume</p>
                : current?.error ? <p role="alert" className="text-sm text-error">{current.error}</p>
                : !file && !profile ? <EmptyState icon={FileText} title="No resume on file">A resume with {record.fullName}&rsquo;s email or phone is linked by itself once it is uploaded, or attach one above.</EmptyState>
                : file && !body && !profile ? <EmptyState icon={FileText} title="This file's text could not be read">{file.textError ?? TEXT_STATUS_LABELS[file.textStatus]}. Use Open original to see the file itself.</EmptyState>
                : <ResumeDocument record={record} text={body} keywords={words} />}
        </section>
    );
}

type LinkFilter = '' | 'linked' | 'unlinked';

/**
 * The candidate's resume files (owner 2026-11-10, phase 2): matched by email / phone in the background, or attached by
 * HR here. Open shows a PDF in the browser's viewer and a .docx as a page; Detach marks a wrong match so it is never
 * matched again by itself. Whether the picker is open is the panel's state (`picking`), so the header's "Attach a
 * resume" opens it and leaving the tab closes it.
 */
function ResumeSection({ orgId, candidateId, fullName, files, ready, error, viewingId, onView, onChanged, picking, onPicking }: {
    orgId: string; candidateId: string; fullName: string; files: ResumeFile[]; ready: boolean; error: string;
    viewingId: string | null; onView: (id: string) => void; onChanged: () => void; picking: boolean; onPicking: (open: boolean) => void;
}) {
    const { notify, reportError } = useUi();
    const setPicking = onPicking;
    const [q, setQ] = useState(fullName);
    const [qDebounced, setQDebounced] = useState(fullName);
    useEffect(() => { const t = setTimeout(() => setQDebounced(q.trim()), 300); return () => clearTimeout(t); }, [q]);
    const link: LinkFilter = 'unlinked';
    const [searchNonce, setSearchNonce] = useState(0);
    const optionsKey = JSON.stringify([orgId, qDebounced, searchNonce]);
    const [options, setOptions] = useState<{ key: string; files: ResumeFile[] } | null>(null);
    useEffect(() => {
        if (!picking) return;
        const ctrl = new AbortController();
        void api<ResumeFilesResponse>(`/api/candidates/resumes${qs({ orgId, link, q: qDebounced, pageSize: 8 })}`, { signal: ctrl.signal }).then(res => {
            if (ctrl.signal.aborted) return;
            if (!res.ok && res.noAccess) reportError(res);
            setOptions({ key: optionsKey, files: res.ok ? res.data.files : [] });
        });
        return () => ctrl.abort();
    }, [picking, optionsKey, orgId, qDebounced, reportError]);

    const [busy, setBusy] = useState<string | null>(null);
    const [confirmDetach, setConfirmDetach] = useState<string | null>(null);
    const change = async (file: ResumeFile, target: string | null) => {
        setBusy(file.id);
        const res = await api<{ ok: true }>(`/api/candidates/resumes/${encodeURIComponent(file.id)}`, { method: 'PATCH', json: { orgId, candidateId: target } });
        setBusy(null);
        if (!res.ok) { reportError(res); return; }
        notify(target ? `${file.fileName} attached` : `${file.fileName} detached`, 'success');
        setConfirmDetach(null);
        setPicking(false);
        setSearchNonce(n => n + 1);
        onChanged();
    };

    return (
        <section aria-labelledby="cand-resumes-heading">
            <div className="flex items-center justify-between gap-x-2 gap-y-2">
                <h3 id="cand-resumes-heading" className={LABEL}>Resume files</h3>
                <button type="button" onClick={() => setPicking(!picking)} className={`${BTN_GHOST} -mr-2.5`}>
                    <Paperclip className="h-4 w-4" />{picking ? 'Cancel' : 'Attach a resume'}
                </button>
            </div>
            {!ready ? (
                <p className="mt-1 text-sm text-text-tertiary"><Spinner className="mr-1.5 inline h-3.5 w-3.5" />Loading</p>
            ) : error ? (
                <p className="mt-1 text-sm text-error">{error}</p>
            ) : files.length === 0 ? (
                <p className="mt-1 text-sm text-text-tertiary">
                    No resume on file. A resume with this person&rsquo;s email or phone is linked by itself once it is uploaded; or attach one here.
                </p>
            ) : (
                <ul className="mt-1.5 space-y-1.5">
                    {files.map(file => (
                        <li key={file.id} className={`${WELL} flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 ${files.length > 1 && file.id === viewingId ? 'ring-1 ring-inset ring-primary' : ''}`}>
                            <FileText className="h-4 w-4 shrink-0 text-text-tertiary" aria-hidden />
                            <span className="min-w-0 flex-1">
                                <button type="button" onClick={() => (files.length > 1 ? onView(file.id) : openUrl(orgId, file, true))} className="block max-w-full truncate text-left text-sm font-semibold text-text-primary hover:underline" title={files.length > 1 ? `Read ${file.fileName}` : `Open ${file.fileName}`}>
                                    {file.fileName}
                                </button>
                                <span className="block text-xs text-text-tertiary">
                                    {file.matchReason ? `Matched by ${MATCH_REASON_LABELS[file.matchReason].toLowerCase()}` : TEXT_STATUS_LABELS[file.textStatus]}
                                    {file.downloadedAt && <> · downloaded {formatDate(file.downloadedAt)}</>}
                                </span>
                            </span>
                            <span className="flex items-center gap-0.5">
                                <button type="button" onClick={() => openUrl(orgId, file, true)} className={`${BTN_GHOST} h-8 px-2`} aria-label={`Open ${file.fileName}`} title="Open original"><ExternalLink className="h-4 w-4" /></button>
                                <button type="button" onClick={() => openUrl(orgId, file, false)} className={`${BTN_GHOST} h-8 px-2`} aria-label={`Download ${file.fileName}`} title="Download"><Download className="h-4 w-4" /></button>
                                {confirmDetach === file.id ? (
                                    <>
                                        <button type="button" onClick={() => void change(file, null)} disabled={busy === file.id} className={`${BTN_GHOST} h-8 px-2 text-error`}>
                                            {busy === file.id ? <Spinner /> : 'Detach'}
                                        </button>
                                        <button type="button" onClick={() => setConfirmDetach(null)} className={`${BTN_GHOST} h-8 px-2`}>Keep</button>
                                    </>
                                ) : (
                                    <button type="button" onClick={() => setConfirmDetach(file.id)} className={`${BTN_GHOST} h-8 px-2`} aria-label={`Detach ${file.fileName}`} title="Not this person's resume"><Unlink className="h-4 w-4" /></button>
                                )}
                            </span>
                        </li>
                    ))}
                </ul>
            )}
            {picking && (
                <div className={`${WELL} mt-2 space-y-2 px-3 py-3`}>
                    <label className="relative block">
                        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-tertiary" aria-hidden />
                        <input value={q} onChange={e => setQ(e.target.value)} autoFocus placeholder="Search the resumes not linked to anyone yet" aria-label="Search the resumes not linked to anyone yet" className={`${INPUT} pl-9`} />
                    </label>
                    {!options || options.key !== optionsKey ? (
                        <p className="text-sm text-text-tertiary"><Spinner className="mr-1.5 inline h-3.5 w-3.5" />Searching</p>
                    ) : options.files.length === 0 ? (
                        <p className="text-sm text-text-tertiary">No unlinked resume matches. Try part of the file name, or upload the file in the Resumes tab first.</p>
                    ) : (
                        <ul className="divide-y divide-border-subtle">
                            {options.files.map(file => (
                                <li key={file.id} className="flex items-center gap-x-2 gap-y-2 py-1.5">
                                    <span className="min-w-0 flex-1">
                                        <span className="block truncate text-sm text-text-primary" title={file.fileName}>{file.fileName}</span>
                                        <span className="block text-xs text-text-tertiary">{TEXT_STATUS_LABELS[file.textStatus]}{file.downloadedAt && <> · downloaded {formatDate(file.downloadedAt)}</>}</span>
                                    </span>
                                    <button type="button" onClick={() => openUrl(orgId, file, true)} className={`${BTN_GHOST} h-8 px-2`}>View</button>
                                    <button type="button" onClick={() => void change(file, candidateId)} disabled={busy === file.id} className={`${BTN_SECONDARY} h-8 px-3 text-xs`}>
                                        {busy === file.id ? <Spinner /> : 'Attach'}
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            )}
        </section>
    );
}
