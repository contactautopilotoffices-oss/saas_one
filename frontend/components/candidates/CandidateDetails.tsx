'use client';

import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Ban, BookOpen, Briefcase, Building2, CalendarDays, ChevronDown, ChevronLeft, ChevronRight, ClipboardList, Clock, Download, ExternalLink, FileText, GraduationCap, History, LayoutGrid, Mail, MapPin, MoreHorizontal, Paperclip, PencilLine, Phone, PhoneCall, RefreshCw, ScanText, School, Search, Star, Unlink } from 'lucide-react';
import { DEFENCE_OPTIONS, EDUCATION_TYPES, NO_QUALIFICATION } from '@/backend/lib/candidates/filters';
import { markKeywords } from '@/backend/lib/candidates/snippet';
import {
    BLACKLIST_REASON_LABELS, BLACKLIST_REASONS, MATCH_REASON_LABELS, originLabel, RECORD_STATUSES, STATUS_LABELS, TEXT_STATUS_LABELS,
    type BlacklistReason, type CandidateRecord, type MemberScore, type Position, type RecordStatus, type ResumeFile, type ResumeFilesResponse, type Stage,
} from '@/backend/lib/candidates/types';
import { api, qs } from './api';
import CallsTab from './CallsTab';
import AssignmentsTab from './AssignmentsTab';
import { MessageLog, RemoveDataButton } from './PrivacyControls';
import AssessmentSender from './AssessmentSender';
import { formatDate, formatInr, formatMonths, formatNotice, STATUS_DOT } from './format';
import { InterviewsList } from './InterviewScheduler';
import { StageChip, useStages } from './stage-ui';
import { findStage, unlistedStage } from '@/backend/lib/candidates/stage-list';
import { PipelineStrip, PositionFitCard, type PipelineContext } from './PipelineContext';
import { ActivityTimeline, BlacklistedTag, CandidateRemarks, BTN_DANGER_FILLED, REMARK_MAX, statusNeedsRemark } from './Remarks';
import { WorkedOut } from './ResultCard';
import ResumeDocument, { hasProfile } from './ResumeDocument';
import { Avatar, BTN_GHOST, BTN_PRIMARY, BTN_SECONDARY, CARD, CopyButton, Drawer, EmptyState, INPUT, LABEL, OVERLAY, Spinner, Tag, useUi, WELL } from './ui';

/** A small grey label over a bold value; nothing at all when the value is not on record (reference layout). */
function Row({ label, value }: { label: string; value: React.ReactNode }) {
    if (!value) return null;
    return (
        <div className="min-w-0">
            <dt className="text-xs text-text-tertiary">{label}</dt>
            <dd className="mt-0.5 break-words text-[13px] font-semibold text-text-primary">{value}</dd>
        </div>
    );
}

type Files = { candidateId: string; files: ResumeFile[]; error: string };
type Tab = 'overview' | 'resume' | 'activity' | 'positions' | 'interviews' | 'calls' | 'work';
export type CandidateTab = Tab;
/** The inline form open under the header, if any. */
type Panel = null | 'status' | 'positions' | 'blacklist' | 'assessment';
/** The mockup's small header buttons (36 px, 13 px text). */
const BTN_SM = 'h-9 rounded-xl px-3 text-[13px]';
/** Reference layout (owner 2026-11-25): small square outline buttons in the header, and the "‹ ›" walkers. */
const BTN_OUTLINE = 'inline-flex h-9 shrink-0 items-center justify-center gap-x-1.5 rounded-lg border border-border bg-surface px-3 text-[13px] font-semibold text-text-primary transition-colors hover:bg-surface-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 disabled:cursor-not-allowed disabled:opacity-50';
const NAV_BTN = 'inline-flex h-7 w-7 items-center justify-center rounded-md border border-border bg-surface text-text-secondary transition-colors hover:bg-surface-elevated hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 disabled:cursor-not-allowed disabled:opacity-40';
/** The status pill's tint: green while the person is in play, red when rejected, amber on hold, grey otherwise. */
const statusPill = (s: RecordStatus) => (
    s === 'rejected' ? 'bg-red-50 text-red-800 dark:bg-red-950/40 dark:text-red-200'
        : s === 'on_hold' ? 'bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200'
        : s === 'not_responding' || s === 'others' ? 'bg-muted text-text-primary'
        : 'bg-green-50 text-green-800 dark:bg-green-950/40 dark:text-green-200'
);
/** The contact pills on the right panel: light green with teal text. */
const CONTACT_PILL = 'inline-flex max-w-full items-center rounded-full bg-primary/10 pl-2.5 text-[13px] font-medium text-primary-dark dark:text-primary-light';

/** Email and phone with the middle hidden, as the panel's meta line shows them. */

/**
 * One candidate's panel (owner 2026-11-15, to the mockup): the person at the top with the actions that matter
 * (status, add to position, add remark, attach a resume, blacklist), then Overview · Resume · Activity · Positions.
 * A status change opens "Change status" inline: "Others" needs a remark. Nothing here changes by accident: every
 * action is a click on a named button, and every one of them is in the history.
 */
export default function CandidateDetails({ record, open, onClose, onEdit, orgId, onChanged, keywords = [], pipeline = null, showTab = null, positionPicker }: {
    record: CandidateRecord; open: boolean; onClose: () => void; onEdit: () => void;
    orgId: string;
    /**
     * Opened from the Pipeline tab (owner 2026-11-17): the position and the person's place in it. Adds the strip with
     * the stage and the quick actions, the fit for the position, and that position's history first.
     */
    pipeline?: PipelineContext | null;
    /** Something changed (status, resume, blacklist, position): the lists behind the panel refetch. */
    onChanged?: () => void;
    positionPicker?: React.ReactNode;
    /** The search's keywords, marked in the resume's text. */
    keywords?: string[];
    /** Owner 2026-11-25: open on this tab (a new nonce asks again, e.g. "Send assessment" from a pipeline card). */
    showTab?: { tab: Tab; nonce: number } | null;
}) {
    const { notify, reportError } = useUi();

    // The lists hand over a record without the resume fields or the blacklist entry: fetch the full record once per opening.
    const [full, setFull] = useState<{ id: string; record: CandidateRecord } | null>(null);
    const [refreshNonce, setRefreshNonce] = useState(0);
    const [refreshed, setRefreshed] = useState(0);
    useEffect(() => {
        if (!open) return;
        const ctrl = new AbortController();
        void api<{ record: CandidateRecord }>(`/api/candidates/${encodeURIComponent(record.id)}${qs({ orgId })}`, { signal: ctrl.signal }).then(res => {
            if (ctrl.signal.aborted) return;
            setRefreshed(refreshNonce);
            if (res.ok) setFull({ id: record.id, record: res.data.record });
            else if (res.noAccess) reportError(res);
            else if (refreshNonce) notify(res.error, 'error');
        });
        return () => ctrl.abort();
    }, [open, record.id, orgId, refreshNonce, notify, reportError]);
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
    const tabRequest = showTab?.nonce ?? null;
    const [seenTabRequest, setSeenTabRequest] = useState<number | null>(null);
    const profileKey = `${record.id}:${open}`;
    const [seenProfile, setSeenProfile] = useState(profileKey);
    if (profileKey !== seenProfile || (open && showTab && tabRequest !== seenTabRequest)) {
        setSeenProfile(profileKey);
        closeForms();
        setTab(open && showTab && tabRequest !== seenTabRequest ? showTab.tab : 'overview');
        setSeenTabRequest(tabRequest);
    }

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
    const headline = [[r.currentDesignation, r.currentOrganization].filter(Boolean).join(' @ '), [r.totalExpMonths !== null && `${formatMonths(r.totalExpMonths)} total`, r.relevantExpMonths !== null && `${formatMonths(r.relevantExpMonths)} relevant`].filter(Boolean).join(', ')].filter(Boolean).join(' · ');
    const hits = r.keywordHits ?? [];
    const score = pipeline?.member.score ?? null;
    // Owner 2026-11-25 (reference layout): the small label/value pairs under the name, only the ones on record.
    const facts: [string, string][] = [
        ['Origin', r.candidateSource || originLabel(r)],
        r.sourcingDate ? ['Sourced on', formatDate(r.sourcingDate)] : ['Added on', formatDate(r.createdAt)],
        ...(pipeline ? [['Position', pipeline.position.title] as [string, string]] : r.role ? [['Sourced for', r.role] as [string, string]] : []),
    ];
    const addRemark = () => { goTo('activity'); setFocusRemark(n => n + 1); };
    const education = ([
        ['Qualification', qualifications.join(', ')],
        ['Institute', x?.institute],
        ['Year of degree', x?.degreeYear ? String(x.degreeYear) : null],
        ['Education type', EDUCATION_TYPES.find(t => t.id === x?.educationType)?.label],
    ] as [string, string | null | undefined][]).filter(([, value]) => !!value);
    const MENU_ITEM = 'flex h-9 w-full items-center rounded-lg px-3 text-left text-[13px] font-semibold text-text-primary hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40';

    const header = (
        <div className="px-5 pb-0 pt-4 sm:px-6 sm:pt-4">
            {/* Previous / next among the people the panel was opened among (from the Pipeline tab): "‹ ›  1 out of 56". */}
            {pipeline && (
                <div className="mb-3 flex min-h-8 items-center gap-x-1.5 pr-10">
                    <button type="button" onClick={() => pipeline.onPrev?.()} disabled={!pipeline.onPrev} aria-label="Previous candidate" title="Previous candidate" className={NAV_BTN}><ChevronLeft className="h-4 w-4" /></button>
                    <button type="button" onClick={() => pipeline.onNext?.()} disabled={!pipeline.onNext} aria-label="Next candidate" title="Next candidate" className={NAV_BTN}><ChevronRight className="h-4 w-4" /></button>
                    <span className="ml-1.5 text-xs tabular-nums text-text-secondary" aria-live="polite">
                        <span className="font-semibold text-text-primary">{pipeline.index}</span> out of {pipeline.total}<span className="text-text-tertiary"> · {pipeline.scopeLabel}</span>
                    </span>
                </div>
            )}
            <div className={`flex flex-wrap items-start gap-x-4 gap-y-3 ${pipeline ? '' : 'pr-10'}`}>
                {/* The shared Avatar, drawn large (72 px) and round for the profile (reference layout). */}
                <span className="shrink-0 [&>span]:h-[72px] [&>span]:w-[72px] [&>span]:rounded-full [&>span]:text-2xl"><Avatar name={r.fullName} size="lg" /></span>
                <div className="min-w-[14rem] flex-1">
                    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
                        <span className="font-display text-2xl font-semibold leading-tight tracking-[-0.2px] text-text-primary">{r.fullName}</span>
                        {score && (
                            <span title={`Average of ${score.scorecards} ${score.scorecards === 1 ? 'scorecard' : 'scorecards'}, out of 5`}
                                className="inline-flex h-7 items-center gap-x-1 rounded-full bg-amber-50 px-2.5 text-xs font-semibold text-text-primary ring-1 ring-inset ring-amber-200 dark:bg-amber-900/30 dark:text-amber-50 dark:ring-amber-800/60">
                                <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-500" aria-hidden /><span className="tabular-nums">{score.overall.toFixed(1)}</span><span className="font-medium text-text-secondary dark:text-amber-100/80">Overall</span>
                            </span>
                        )}
                        <button type="button" onClick={openStatus} aria-expanded={statusOpen} aria-label={`Status: ${STATUS_LABELS[r.status]}. Change status`} title="Change status"
                            className={`inline-flex h-7 items-center gap-x-1.5 rounded-full px-2.5 text-xs font-semibold transition-[filter] hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-1 ${statusPill(r.status)}`}>
                            <span className={`h-2 w-2 rounded-full ${STATUS_DOT[r.status]}`} aria-hidden />{STATUS_LABELS[r.status]}<ChevronDown className="h-3.5 w-3.5 opacity-70" aria-hidden />
                        </button>
                        {r.hasResume === true && <Tag tone="success" icon={FileText}>Resume{files.length > 1 ? ` · ${files.length}` : ''}</Tag>}
                        {r.hasResume === false && <Tag>No resume</Tag>}
                        <MembershipCount orgId={orgId} record={r} nonce={membershipNonce} />
                        {r.blacklisted && <BlacklistedTag entry={r.blacklist} />}
                    </div>
                    {headline && <p className="mt-1 text-sm text-text-secondary">{headline}</p>}
                    {/* Small grey labels over bold values, side by side (reference layout). */}
                    <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-2">
                        {facts.map(([label, value]) => (
                            <div key={label} className="min-w-0 max-w-[16rem]">
                                <dt className="text-xs text-text-tertiary">{label}</dt>
                                <dd className="mt-0.5 truncate text-[13px] font-semibold text-text-primary" title={value}>{value}</dd>
                            </div>
                        ))}
                    </dl>
                </div>
                <div className="ml-auto flex shrink-0 flex-wrap items-center justify-end gap-2">
                    <button type="button" onClick={() => { setRefreshNonce(n => n + 1); setNonce(n => n + 1); setHistoryNonce(n => n + 1); setCallsNonce(n => n + 1); setMembershipNonce(n => n + 1); onChanged?.(); }}
                        disabled={refreshed !== refreshNonce} aria-label="Refresh profile" title="Refresh profile" className={BTN_OUTLINE}>
                        <RefreshCw className={`h-4 w-4 ${refreshed !== refreshNonce ? 'animate-spin' : ''}`} aria-hidden />
                    </button>
                    <button type="button" onClick={() => { closeForms(); onEdit(); }} className={BTN_OUTLINE} title="Edit details"><PencilLine className="h-4 w-4" />Edit</button>
                    {/* Owner 2026-11-25: the less frequent actions in a "…" menu, each still one named button. */}
                    <OverflowMenu label="More actions">
                        {close => (
                            <>
                                <button type="button" onClick={() => { close(); addRemark(); }} className={MENU_ITEM}>Add remark</button>
                                <button type="button" onClick={() => { close(); goTo('resume'); setPicking(true); }} className={MENU_ITEM}>Attach a resume</button>
                                {!r.blacklisted && <button type="button" onClick={() => { close(); setPicking(false); setPanel(panel === 'assessment' ? null : 'assessment'); }} aria-expanded={panel === 'assessment'} className={MENU_ITEM}>Send assessment</button>}
                                {r.blacklist !== undefined && !r.blacklisted && (
                                    <button type="button" onClick={() => { close(); toggleBlacklist(); }} aria-expanded={blacklistOpen} className={`${MENU_ITEM} text-error hover:bg-error/[.08]`}>Blacklist…</button>
                                )}
                                {/* Owner 2026-11-24: on the person's request, their details are wiped and nothing is sent to them again. */}
                                {r.fullName !== 'Removed on request' && (
                                    <div className="[&>button]:w-full [&>button]:justify-start [&>button]:rounded-lg" onClickCapture={close}>
                                        <RemoveDataButton orgId={orgId} record={r} onRemoved={() => { setFull(null); setHistoryNonce(n => n + 1); onChanged?.(); }} />
                                    </div>
                                )}
                            </>
                        )}
                    </OverflowMenu>
                    <button type="button" onClick={togglePositions} aria-expanded={positionsOpen} className={`${BTN_PRIMARY} ${BTN_SM} rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2`}>Add to position</button>
                </div>
            </div>
            {positionPicker}
            {/* Section tabs as pills with an icon: the selected one dark (reference layout). */}
            <div role="tablist" aria-label="Candidate sections" className="mt-4 flex flex-wrap gap-2 pb-3.5">
                {([['overview', 'Overview', null, LayoutGrid], ['resume', 'Resume', files.length || null, FileText], ['activity', 'Activity', null, History], ['positions', 'Positions', null, Briefcase], ['interviews', 'Interviews', null, CalendarDays], ['calls', 'Calls', null, PhoneCall], ['work', 'Assignment & documents', null, ClipboardList]] as const).map(([id, label, n, Icon]) => (
                    <button key={id} type="button" role="tab" aria-selected={tab === id} tabIndex={tab === id ? 0 : -1} onKeyDown={event => { const tabs = Array.from(event.currentTarget.parentElement!.querySelectorAll<HTMLButtonElement>('[role="tab"]')); const index = tabs.indexOf(event.currentTarget); const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : -1; if (next >= 0) { event.preventDefault(); tabs[next].focus(); tabs[next].click(); } }} onClick={() => goTo(id)}
                        className={`inline-flex h-8 items-center gap-x-1.5 rounded-full px-3.5 text-[13px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-1 ${tab === id ? 'bg-[#292929] text-white dark:bg-[#f5f5f4] dark:text-[#171717]' : 'bg-surface text-text-secondary ring-1 ring-inset ring-border hover:bg-surface-elevated hover:text-text-primary'}`}>
                        <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
                        {label}{n ? <span className="ml-0.5 text-xs font-medium opacity-70">{n}</span> : null}
                        {id === 'activity' && <ActivityCount orgId={orgId} record={r} nonce={historyNonce} />}
                        {id === 'calls' && <CallsCount orgId={orgId} record={r} nonce={callsNonce} />}
                    </button>
                ))}
            </div>
        </div>
    );
    return (
        <Drawer open={open} onClose={onClose} labelId="candidate-details-title" title={r.fullName} header={header}
            resize={{ storeKey: 'candidate-details-width', initial: 980, min: 520 }}
        >
            {/* Owner 2026-11-25 (reference layout): the section on the left, the person on the right; one column below ~770 px. */}
            <div className="@container">
            <div className="grid items-start gap-x-5 gap-y-5 @3xl:grid-cols-[minmax(0,1fr)_minmax(260px,300px)]">
            {/* The left column sits on a very light grey panel, its cards white (reference layout). */}
            <div className="@container min-w-0 space-y-3.5 rounded-2xl bg-surface-elevated p-3 sm:p-3.5">                {pipeline && <PipelineStrip key={`${r.id}:${pipeline.member.id}`} orgId={orgId} record={r} ctx={pipeline} tab={tab} onHistory={() => { setHistoryNonce(n => n + 1); setMembershipNonce(n => n + 1); }} />}

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

                {panel === 'assessment' && !r.blacklisted && <AssessmentSender key={r.id} orgId={orgId} record={r} onClose={() => setPanel(null)} onSent={() => { setHistoryNonce(n => n + 1); onChanged?.(); }} />}


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
                        {score && <CandidateScore score={score} />}
                        {pipeline && <PositionFitCard record={r} position={pipeline.position} />}
                        {(hits.length > 0 || r.resumeSnippet) && (
                            <section className={`${CARD} px-4 py-3`} aria-label="Match">
                                <p className={LABEL}>Match to the search</p>
                                <ul className="mt-2 space-y-1.5">
                                    {hits.map(h => <li key={h.text}><Tag tone={h.required ? 'success' : 'neutral'}>✓ {h.text} · {h.where === 'both' ? 'record + resume' : h.where}</Tag></li>)}
                                    {hits.length === 0 && <li className="text-sm text-text-tertiary">No keyword matched on record.</li>}
                                </ul>
                            </section>
                        )}
                        {/* The record's job details as label / value pairs (owner 2026-11-25, reference layout). */}
                        <section className={`${CARD} @container px-4 py-4`} aria-labelledby="cand-job-title">
                            <div className="flex items-center justify-between gap-x-3">
                                <h3 id="cand-job-title" className="text-sm font-semibold text-text-primary">Job details</h3>
                                <button type="button" onClick={() => goTo('positions')} className="inline-flex h-8 items-center gap-x-0.5 rounded-md px-1.5 text-[13px] font-semibold text-primary-dark hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 dark:text-green-300">
                                    View positions<ChevronRight className="h-4 w-4" aria-hidden />
                                </button>
                            </div>
                            {/* The current job, bold, with a meta line; then the rest as a grid under a hairline. */}
                            {(r.currentDesignation || r.currentOrganization || r.location || r.totalExpMonths !== null) && (
                                <div className="mt-2">
                                    {r.currentDesignation && <p className="text-[15px] font-semibold text-text-primary">{r.currentDesignation}{r.inferred?.includes('currentDesignation') && <WorkedOut what="the latest employer" />}</p>}
                                    <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-text-secondary">
                                        {r.currentOrganization && <span className="inline-flex min-w-0 items-center gap-x-1.5"><Building2 className="h-3.5 w-3.5 shrink-0 text-text-tertiary" aria-hidden /><span className="sr-only">Current employer: </span>{r.currentOrganization}{r.inferred?.includes('currentOrganization') && <WorkedOut what="the latest employer" />}</span>}
                                        {r.location && <span className="inline-flex items-center gap-x-1.5"><MapPin className="h-3.5 w-3.5 shrink-0 text-text-tertiary" aria-hidden /><span className="sr-only">Location: </span>{r.location}</span>}
                                        {r.totalExpMonths !== null && <span className="inline-flex items-center gap-x-1.5"><Clock className="h-3.5 w-3.5 shrink-0 text-text-tertiary" aria-hidden />{formatMonths(r.totalExpMonths)} total{r.inferred?.includes('totalExpMonths') && <WorkedOut />}</span>}
                                    </p>
                                </div>
                            )}
                            <dl className="mt-3.5 grid grid-cols-2 gap-x-4 gap-y-3.5 border-t border-border-subtle pt-3.5 @xl:grid-cols-3">
                                <Row label="Relevant experience" value={r.relevantExpMonths !== null && formatMonths(r.relevantExpMonths)} />
                                <Row label="Current in-hand" value={r.currentInhand !== null && `${formatInr(r.currentInhand)} / month`} />
                                <Row label="Expected in-hand" value={r.expectedInhand !== null && `${formatInr(r.expectedInhand)} / month`} />
                                <Row label="Notice period" value={r.noticePeriodDays !== null && `${formatNotice(r.noticePeriodDays)}${x?.servingNotice ? ' · serving' : ''}`} />
                                <Row label="Would relocate to" value={x?.preferredLocations?.length ? x.preferredLocations.join(', ') : r.location ? `${r.location} only` : null} />
                                <Row label="Source" value={r.candidateSource} />
                                <Row label="Sourced for" value={r.role} />
                                <Row label="Came from" value={`${originLabel(r)}${r.sourceRow ? `, row ${r.sourceRow}` : ''}`} />
                                <Row label="Updated" value={formatDate(r.updatedAt)} />
                                {resumeRows.filter(([label]) => !['Education', 'Institute', 'Degree completed', 'Education type', 'Would move to', 'Serving notice'].includes(label)).map(([label, value]) => <Row key={label} label={label} value={value} />)}
                            </dl>
                        </section>
                        {r.trackerValues && <details className={`${CARD} p-4`}>
                            <summary className="cursor-pointer text-sm font-semibold">Tracker values</summary>
                            <p className="mt-2 text-xs text-text-secondary">Saved at the last import of this record, including extra columns. Changes here in HRMS do not change these source values.</p>
                            <dl className="mt-3 grid grid-cols-1 gap-3 @2xl:grid-cols-2">{Object.entries(r.trackerValues).map(([label, value]) => <Row key={label} label={label} value={value} />)}</dl>
                        </details>}
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

                {tab === 'activity' && open && <ActivityTimeline orgId={orgId} record={r} nonce={historyNonce} focusNonce={focusRemark} position={pipeline ? { id: pipeline.position.id, title: pipeline.position.title } : null} onAdded={() => setHistoryNonce(n => n + 1)} />}
                {/* Owner 2026-11-24: the one message log */}
                {tab === 'activity' && open && <MessageLog key={`${r.id}:${refreshNonce}`} orgId={orgId} record={r} />}

                {tab === 'positions' && open && <MembershipsList orgId={orgId} record={r} nonce={membershipNonce} />}
                {/* Owner 2026-11-19: the interviews scheduled, their links and, after the call, the notes */}
                {tab === 'interviews' && open && <InterviewsList orgId={orgId} record={r} nonce={historyNonce} onRecord={saved => { replace(saved); setHistoryNonce(n => n + 1); setCallsNonce(n => n + 1); }} />}

                {/* Owner 2026-11-24: the assignment (with the AI score, HR only) and the documents after selection */}
                {tab === 'work' && open && <AssignmentsTab key={`${r.id}:${refreshNonce}`} orgId={orgId} record={r} onChanged={() => setHistoryNonce(n => n + 1)} />}

                {tab === 'calls' && open && (
                    <CallsTab key={`${r.id}:${refreshNonce}`} orgId={orgId} record={r}
                        onLogged={() => { setHistoryNonce(n => n + 1); setCallsNonce(n => n + 1); }}
                        onRecord={saved => replace(saved)} />
                )}
            </div>

            {/* The person, on every tab (owner 2026-11-25, the reference layout's right panel). */}
            <aside aria-label={`About ${r.fullName}`} className="min-w-0 divide-y divide-border-subtle rounded-2xl bg-surface px-4 ring-1 ring-inset ring-border @3xl:sticky @3xl:top-0">
                {open && <CandidateRemarks key={r.id} orgId={orgId} record={r} nonce={historyNonce} onAdd={addRemark} />}
                <section aria-labelledby="cand-personal-title" className="py-4">
                    <h3 id="cand-personal-title" className="text-sm font-semibold text-text-primary">Personal Information</h3>
                    {r.email || r.phone || r.location ? (
                        <dl className="mt-3 space-y-3">
                            {r.email && (
                                <InfoRow icon={Mail} label="Email">
                                    <span className={CONTACT_PILL}><span className="min-w-0 break-all">{r.email}</span><CopyButton value={r.email} label="email address" /></span>
                                </InfoRow>
                            )}
                            {r.phone && (
                                <InfoRow icon={Phone} label="Phone">
                                    <span className={`${CONTACT_PILL} tabular-nums`}><span className="min-w-0 break-all">{r.phone}</span><CopyButton value={r.phone} label="phone number" /></span>
                                </InfoRow>
                            )}
                            {r.location && <InfoRow icon={MapPin} label="Location">{r.location}</InfoRow>}
                        </dl>
                    ) : <p className="mt-2 text-sm text-text-tertiary">No contact details on record.</p>}
                </section>
                {education.length > 0 && (
                    <section aria-labelledby="cand-education-title" className="py-4">
                        <h3 id="cand-education-title" className="text-sm font-semibold text-text-primary">Education Information</h3>
                        <dl className="mt-3 space-y-3">
                            {education.map(([label, value]) => <InfoRow key={label} icon={EDUCATION_ICON[label] ?? GraduationCap} label={label}>{value}</InfoRow>)}
                        </dl>
                    </section>
                )}
            </aside>
            </div>
            </div>
        </Drawer>
    );
}

const EDUCATION_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
    Qualification: GraduationCap, Institute: School, 'Year of degree': CalendarDays, 'Education type': BookOpen,
};

/** One line of the right-hand panel (reference layout): a small grey icon and label on the left, the value on the right. */
function InfoRow({ icon: Icon, label, children }: { icon: React.ComponentType<{ className?: string }>; label: string; children: React.ReactNode }) {
    return (
        <div className="flex min-h-7 items-center justify-between gap-x-3">
            <dt className="flex shrink-0 items-center gap-x-2 text-[13px] text-text-secondary">
                <Icon className="h-4 w-4 shrink-0 text-text-tertiary" aria-hidden />{label}
            </dt>
            <dd className="min-w-0 break-words text-right text-[13px] font-semibold text-text-primary">{children}</dd>
        </div>
    );
}

/**
 * The header's "…" menu: a disclosure (button + panel), closed by a click outside, Escape or picking an item. The panel
 * stays mounted while hidden, so an item that opens its own dialog (Remove data) keeps it open.
 */
function OverflowMenu({ label, children }: { label: string; children: (close: () => void) => React.ReactNode }) {
    const [open, setOpen] = useState(false);
    const wrap = useRef<HTMLDivElement>(null);
    const trigger = useRef<HTMLButtonElement>(null);
    const id = useId();
    useEffect(() => {
        if (!open) return;
        const onDown = (e: MouseEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
        document.addEventListener('mousedown', onDown);
        return () => document.removeEventListener('mousedown', onDown);
    }, [open]);
    const close = () => setOpen(false);
    return (
        <div ref={wrap} className="relative" onKeyDown={e => { if (e.key === 'Escape' && open) { e.stopPropagation(); setOpen(false); trigger.current?.focus(); } }}>
            <button ref={trigger} type="button" onClick={() => setOpen(o => !o)} aria-label={label} title={label} aria-expanded={open} aria-controls={id}
                className={`${BTN_OUTLINE} w-9 px-0`}><MoreHorizontal className="h-4 w-4" /></button>
            <div id={id} className={`${open ? '' : 'hidden'} absolute right-0 top-full z-30 mt-1.5 w-56 rounded-xl p-1.5 ${OVERLAY}`}>{children(close)}</div>
        </div>
    );
}

/** The panel's ratings for this position (owner 2026-11-25, reference layout): the overall, and a bar per round. */
function CandidateScore({ score }: { score: MemberScore }) {
    const stars = Math.round(score.overall);
    return (
        <section className={`${CARD} @container px-4 py-4`} aria-labelledby="cand-score-title">
            <h3 id="cand-score-title" className="text-sm font-semibold text-text-primary">Candidate Score</h3>
            {/* The overall on the left; a vertical hairline; a thin amber bar per round on the right (reference layout). */}
            <div className="mt-3 grid gap-x-6 gap-y-4 @md:grid-cols-[auto_minmax(0,1fr)]">
                <div className="@md:pr-6 @md:shadow-[1px_0_0_var(--border)]">
                    <p className="font-display text-[40px] font-bold leading-none tracking-[-0.5px] tabular-nums text-text-primary">{score.overall.toFixed(1)}</p>
                    <p className="mt-1.5 flex gap-x-0.5" aria-hidden>
                        {[1, 2, 3, 4, 5].map(n => <Star key={n} className={`h-3.5 w-3.5 ${n <= stars ? 'fill-amber-400 text-amber-500' : 'text-border'}`} />)}
                    </p>
                    <p className="mt-1.5 text-xs text-text-secondary">Overall score<span className="text-text-tertiary"> · out of 5, {score.scorecards} {score.scorecards === 1 ? 'scorecard' : 'scorecards'}</span></p>
                </div>
                {score.rounds.length > 0 && (
                    <ul className="space-y-3 self-center">
                        {score.rounds.map(rd => (
                            <li key={rd.round} className="grid grid-cols-[minmax(0,8rem)_minmax(0,1fr)_auto] items-center gap-x-3 text-xs">
                                <span className="truncate font-medium text-text-secondary" title={rd.round}>{rd.round}</span>
                                <span aria-hidden className="block h-1.5 overflow-hidden rounded-full bg-muted"><span className="block h-full rounded-full bg-amber-400" style={{ width: `${Math.max(0, Math.min(100, (rd.overall / 5) * 100))}%` }} /></span>
                                <span className="inline-flex items-center gap-x-1 font-semibold tabular-nums text-text-primary">
                                    <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-500" aria-hidden />{rd.overall.toFixed(1)}
                                    <span className="sr-only"> of 5, from {rd.scorecards} {rd.scorecards === 1 ? 'scorecard' : 'scorecards'}</span>
                                </span>
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </section>
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
    return <span className="ml-1.5 text-xs font-medium opacity-70">{n.n}</span>;
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
    return <span className="ml-1.5 text-xs font-medium opacity-70">{n.n}</span>;
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
