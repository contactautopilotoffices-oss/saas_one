'use client';

import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, ClipboardCheck, Download, FileText, ListChecks, MoreHorizontal, PanelRightOpen, Plus, UserPlus, X } from 'lucide-react';
import { boardColumns, findStage, reasonNeeded, sideStages, stageGroups, unlistedStage, type StageDef } from '@/backend/lib/candidates/stage-list';
import { recordOrigin, type CandidateRecord, type Position, type PositionMember, type Stage } from '@/backend/lib/candidates/types';
import { api, qs } from './api';
import CandidateDetails, { type CandidateTab } from './CandidateDetails';
import { downloadCsv, recordsToCsv } from './export-csv';
import { formatCount, formatDate } from './format';
import { OutreachDialog } from './OutreachPanel';
import type { PipelineContext } from './PipelineContext';
import PositionForm, { type PositionSeed } from './PositionForm';
import RecordForm from './RecordForm';
import ScreeningQuestionsDialog from './ScreeningQuestionsDialog';
import { RemarkDialog } from './Remarks';
import { retryStages, StageChip, StageOptions, stagesFailed, TONE_CHIP, TONE_DOT, useRejectionReasons, useStages } from './stage-ui';
import { Avatar, BTN_GHOST, BTN_PRIMARY, BTN_SECONDARY, CARD, Dialog, EmptyState, INPUT, LABEL, NUM_SM, OVERLAY, ScoreTag, Spinner, Tag, useUi, WELL } from './ui';

/*
 * The pipeline per position (owner 2026-11-15, to the mockup). One position at a time: the numbers a recruiter acts
 * on today, then the board, then the out-of-the-flow boxes. Every move is in the candidate's history. The record's
 * own status is not touched.
 *
 * Owner 2026-11-19: the stages are HR's list (Recruitment -> Configurations). The board has one column per round
 * (Screening, L1, L2 …), scrolling sideways, and each status of that round is an area inside the column that a card
 * is dropped on (L1 Pending, L1 Select, L1 Reject). Rejected areas stay folded to a count until opened. A stage marked
 * "remark needed" asks for a remark; one marked for WhatsApp offers to send the candidate an update.
 */

/** A person waiting this long in the first two rounds is counted as waiting. */
const WAITING_DAYS = 2;
/** Cards shown per status area before "+N more". */
const ZONE_SHOWN = 4;

const daysSince = (iso: string) => Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));

/**
 * New position from Search ("Save as a position"): the full Create position form (owner 2026-11-16), seeded with
 * the search as it stands (its JD, starred keywords, filters).
 */
export function PositionDialog({ open, orgId, seed, onClose, onSaved }: {
    open: boolean; orgId: string;
    seed?: PositionSeed;
    onClose: () => void; onSaved: (position: Position) => void;
}) {
    return <PositionForm open={open} orgId={orgId} seed={seed} onClose={onClose} onSaved={onSaved} />;
}

/** The open positions, for "Add to position" on a list of ticked records. */
export function AddToPositionSelect({ orgId, applicationIds, disabled, onAdded, dark = false }: { orgId: string; applicationIds: string[]; disabled?: boolean; onAdded?: () => void; dark?: boolean }) {
    const { notify, reportError } = useUi();
    const [positions, setPositions] = useState<Position[] | null>(null);
    const [busy, setBusy] = useState(false);
    useEffect(() => {
        const ctrl = new AbortController();
        void api<{ positions: Position[] }>(`/api/candidates/positions${qs({ orgId })}`, { signal: ctrl.signal }).then(res => {
            if (ctrl.signal.aborted) return;
            setPositions(res.ok ? res.data.positions : []);
        });
        return () => ctrl.abort();
    }, [orgId]);
    const add = async (positionId: string) => {
        if (!positionId || busy) return;
        setBusy(true);
        const res = await api<{ added: number; skipped: number }>(`/api/candidates/positions/${encodeURIComponent(positionId)}/members`, { json: { orgId, applicationIds } });
        setBusy(false);
        if (!res.ok) { notify(res.error, 'error'); if (res.noAccess) reportError(res); return; }
        const title = positions?.find(p => p.id === positionId)?.title ?? 'the position';
        notify(`${formatCount(res.data.added)} added to ${title}${res.data.skipped ? `; ${formatCount(res.data.skipped)} already there` : ''}`, 'success');
        onAdded?.();
    };
    if (!positions?.length) return null;
    return (
        <select
            aria-label="Add the selected candidates to a position" value="" disabled={disabled || busy} onChange={e => void add(e.target.value)}
            className={dark
                ? 'h-8 cursor-pointer rounded-lg border-0 bg-surface px-2 text-sm font-semibold text-text-primary outline-none disabled:opacity-60'
                : 'h-8 cursor-pointer rounded-lg border border-border bg-surface px-2 text-sm font-semibold text-text-primary outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:opacity-60'}
        >
            <option value="">Add to position…</option>
            {positions.map(p => <option key={p.id} value={p.id}>{p.title}{p.location ? ` · ${p.location}` : ''}</option>)}
        </select>
    );
}

/** A person whose recorded source is a referral ("Referral", "Employee referral", "Referred by Neha"). */
const isReferral = (r: CandidateRecord | null) => !!r?.candidateSource && /refer/i.test(r.candidateSource);

/**
 * The card's "…" menu (owner 2026-11-25, to the reference board): the per-card actions in one place instead of a
 * hover-only X. Escape or a click elsewhere closes it; focus goes back to the button.
 */
function CardMenu({ name, canOpen, busy, onOpen, onAssess, onRemove }: { name: string; canOpen: boolean; busy: boolean; onOpen: () => void; onAssess: () => void; onRemove: () => void }) {
    const [open, setOpen] = useState(false);
    const wrap = useRef<HTMLDivElement>(null);
    const trigger = useRef<HTMLButtonElement>(null);
    const firstItem = useRef<HTMLButtonElement>(null);
    useEffect(() => {
        if (!open) return;
        firstItem.current?.focus();
        const onDown = (e: MouseEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); trigger.current?.focus(); } };
        document.addEventListener('mousedown', onDown);
        document.addEventListener('keydown', onKey);
        return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
    }, [open]);
    const item = 'flex w-full items-center gap-x-2 rounded-lg px-2.5 py-1.5 text-left text-sm font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-50';
    return (
        <div ref={wrap} className="relative shrink-0">
            <button ref={trigger} type="button" onClick={() => setOpen(o => !o)} aria-haspopup="menu" aria-expanded={open} aria-label={`Actions for ${name}`} title="Actions"
                className="inline-flex h-7 w-7 items-center justify-center rounded-full text-text-tertiary outline-none transition-colors hover:bg-muted hover:text-text-primary focus-visible:ring-2 focus-visible:ring-primary/40">
                <MoreHorizontal className="h-4 w-4" aria-hidden />
            </button>
            {open && (
                <div role="menu" aria-label={`Actions for ${name}`} className={`${OVERLAY} absolute bottom-full right-0 z-20 mb-1 w-52 rounded-xl p-1`}>
                    <button ref={firstItem} type="button" role="menuitem" disabled={!canOpen} onClick={() => { setOpen(false); onOpen(); }} className={`${item} text-text-primary hover:bg-muted`}>
                        <PanelRightOpen className="h-4 w-4 shrink-0 text-text-secondary" aria-hidden />Open details
                    </button>
                    {/* Owner 2026-11-25: the reference's "Add assessment"; ours is sent per person, from their Assignment & documents tab. */}
                    <button type="button" role="menuitem" disabled={!canOpen} onClick={() => { setOpen(false); onAssess(); }} className={`${item} text-text-primary hover:bg-muted`}>
                        <ClipboardCheck className="h-4 w-4 shrink-0 text-text-secondary" aria-hidden />Send assessment
                    </button>
                    <button type="button" role="menuitem" disabled={busy} onClick={() => { setOpen(false); onRemove(); }} className={`${item} text-error hover:bg-error/[.08]`}>
                        <X className="h-4 w-4 shrink-0" aria-hidden />Remove from this position
                    </button>
                </div>
            )}
        </div>
    );
}

/*
 * Owner 2026-11-25, to the reference board: avatar and name with when they joined this position, the role line, then
 * a divider and the at-a-glance row (rating, referral, resume, who moved them, days in the stage, the "…" menu). The
 * stage itself is the area the card sits in, so the card no longer repeats it.
 */
function MemberCard({ member, stage, early, busy, onRemove, onOpen, onAssess, onDragStart }: {
    member: PositionMember; stage: StageDef; early: boolean; busy: boolean; onRemove: (member: PositionMember) => void; onOpen: (member: PositionMember) => void; onAssess: (member: PositionMember) => void; onDragStart: (member: PositionMember) => void;
}) {
    const r = member.record;
    const name = r?.fullName ?? 'Record removed';
    const where = r ? [[r.currentDesignation, r.currentOrganization].filter(Boolean).join(' @ '), r.location].filter(Boolean).join(' · ') : '';
    const days = daysSince(member.stageChangedAt);
    const late = days > WAITING_DAYS && early && stage.kind === 'progress';
    return (
        <li draggable={!busy} onDragStart={e => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', member.id); onDragStart(member); }}
            className={`${CARD} cursor-grab px-3 pb-2 pt-3 active:cursor-grabbing ${late ? 'ring-1 ring-inset ring-error/60' : ''}`}>
            <div className="flex items-start gap-x-2.5">
                <Avatar name={name} size="sm" />
                <div className="min-w-0 flex-1">
                    <button type="button" disabled={!r} onClick={() => r && onOpen(member)} title={name}
                        className="block max-w-full truncate rounded text-left font-display text-[15px] font-semibold leading-snug text-text-primary underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-primary/40 disabled:no-underline">{name}</button>
                    <p className="text-xs text-text-secondary" title="When they were added to this position">Added {formatDate(member.addedAt)}</p>
                </div>
            </div>
            {where && <p className="mt-2 truncate text-xs leading-snug text-text-tertiary" title={where}>{where}</p>}
            {member.remark && <p className="mt-1.5 text-[13px] italic leading-snug text-text-secondary">“{member.remark}”</p>}
            <div className="mt-2.5 flex min-w-0 items-center gap-x-2 border-t border-border-subtle pt-2">
                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1.5 gap-y-1">
                    {/* Owner 2026-11-25: the panel's rating, and a referral, at a glance on the card. */}
                    <ScoreTag score={member.score} />
                    {isReferral(r) && <Tag tone="info" icon={UserPlus} title={`Source: ${r?.candidateSource}`}>Referral</Tag>}
                    {r?.hasResume === true && <Tag tone="success">Resume</Tag>}
                    {r?.hasResume === false && <Tag tone="warn">No resume</Tag>}
                    {member.stageChangedByName && <span className="min-w-0 max-w-full truncate text-xs text-text-secondary" title={`Moved here by ${member.stageChangedByName}`}>{member.stageChangedByName}</span>}
                </div>
                <span className={`${NUM_SM} shrink-0 text-[13px] ${late ? 'text-red-700' : 'text-text-secondary'}`} title={`In this stage since ${formatDate(member.stageChangedAt)}`}>{days} d</span>
                <CardMenu name={name} canOpen={!!r} busy={busy} onOpen={() => onOpen(member)} onAssess={() => onAssess(member)} onRemove={() => onRemove(member)} />
            </div>
        </li>
    );
}

function Kpi({ label, value, hint, alert = false }: { label: string; value: React.ReactNode; hint: React.ReactNode; alert?: boolean }) {
    return (
        <div className="flex min-w-[150px] flex-1 flex-col gap-y-1 border-l border-border-subtle px-5 py-4 first:border-l-0">
            <span className="text-[13px] text-text-secondary">{label}</span>
            <span className="font-display text-[32px] font-bold leading-none tracking-[-0.3px] text-text-primary">{value}</span>
            <span className={`text-[13px] ${alert ? 'font-medium text-red-700' : 'text-text-secondary'}`}>{hint}</span>
        </div>
    );
}

export default function PipelineView({ orgId, dataVersion, onDataChanged, selectPosition = null, onSearch }: {
    orgId: string; dataVersion: number; onDataChanged: () => void;
    /** A position to show (from the Positions tab); the nonce reopens the same one. */
    selectPosition?: { positionId: string; nonce: number } | null;
    /** Opens Search with the position's filters loaded ("+ Add candidates", "search the database for this JD"). */
    onSearch?: (position: Position) => void;
}) {
    const { notify, reportError } = useUi();
    const [positions, setPositions] = useState<Position[] | null>(null);
    const [selectedId, setSelectedId] = useState<string>('');
    const [members, setMembers] = useState<{ id: string; list: PositionMember[] } | null>(null);
    const [nonce, setNonce] = useState(0);
    const [busy, setBusy] = useState(false);
    const [pendingMove, setPendingMove] = useState<{ member: PositionMember; stage: StageDef } | null>(null);
    // Owner 2026-11-24: after a move to a rejected stage, the soft rejection email on offer.
    const [rejection, setRejection] = useState<{ member: PositionMember; templateId: string; positionId: string } | null>(null);
    const [rejecting, setRejecting] = useState(false);
    const sendRejection = async () => {
        if (!rejection) return;
        setRejecting(true);
        const res = await api<{ campaign: { counts: { sent: number; skipped: number; failed: number; unknown: number } } }>('/api/candidates/outreach/campaigns', {
            json: { orgId, action: 'send', applicationIds: [rejection.member.applicationId ?? rejection.member.record?.id], positionId: rejection.positionId, emailTemplateId: rejection.templateId },
        });
        setRejecting(false);
        if (!res.ok) { notify(res.error, 'error'); return; }
        const c = res.data.campaign.counts;
        notify(c.sent ? 'Rejection email sent' : 'The email was not sent. See Outreach → Sends for why.', c.sent ? 'success' : 'info');
        setRejection(null);
    };
    // Owner 2026-11-16: right after a drop on a stage marked for WhatsApp (Configurations), offer to tell the candidate.
    const [outreach, setOutreach] = useState<{ record: CandidateRecord; positionId: string; positionTitle: string; stageName: string; remark: string | null; open: boolean } | null>(null);
    // Owner 2026-11-25: the position's own screening questions, drafted by the AI from its JD.
    const [questionsOpen, setQuestionsOpen] = useState(false);
    const stageList = useStages(orgId);
    const rejectionReasons = useRejectionReasons(orgId);
    // Owner 2026-11-17: the panel knows which person of the pipeline it shows and the people it walks through (the
    // stage the card was opened in, or the whole table), so the arrows step through them; `record` is kept for when
    // the person leaves the position while the panel is open.
    const [details, setDetails] = useState<{ memberId: string; record: CandidateRecord; ids: string[]; scopeLabel: string; open: boolean } | null>(null);
    // Edit from the panel opens the record's form here; saving or closing it returns to the panel.
    const [editor, setEditor] = useState<{ record: CandidateRecord; key: number; open: boolean } | null>(null);
    const [panelKey, setPanelKey] = useState(0);
    const [showTab, setShowTab] = useState<{ tab: CandidateTab; nonce: number } | null>(null);
    const [view, setView] = useState<'board' | 'table'>('board');
    const [dragging, setDragging] = useState<PositionMember | null>(null);
    const [over, setOver] = useState<Stage | null>(null);
    // Rejected areas and the out-of-the-flow boxes are folded until opened; other areas show ZONE_SHOWN until "+N more".
    const [expanded, setExpanded] = useState<Record<string, boolean>>({});

    const selectNonce = selectPosition?.nonce ?? 0;
    const [seenSelect, setSeenSelect] = useState(selectNonce);
    if (selectNonce !== seenSelect) { setSeenSelect(selectNonce); if (selectPosition) setSelectedId(selectPosition.positionId); }

    // Every position, open ones first: a closed one is still readable here.
    useEffect(() => {
        const ctrl = new AbortController();
        void api<{ positions: Position[] }>(`/api/candidates/positions${qs({ orgId, status: 'all' })}`, { signal: ctrl.signal }).then(res => {
            if (ctrl.signal.aborted) return;
            if (!res.ok) { if (res.noAccess) reportError(res); else notify(res.error, 'error'); setPositions([]); return; }
            setPositions(res.data.positions);
            setSelectedId(id => (res.data.positions.some(p => p.id === id) ? id : res.data.positions[0]?.id ?? ''));
        });
        return () => ctrl.abort();
    }, [orgId, dataVersion, nonce, reportError, notify]);

    useEffect(() => {
        if (!selectedId) return;
        const ctrl = new AbortController();
        void api<{ members: PositionMember[] }>(`/api/candidates/positions/${encodeURIComponent(selectedId)}/members${qs({ orgId })}`, { signal: ctrl.signal }).then(res => {
            if (ctrl.signal.aborted) return;
            if (!res.ok) { if (res.noAccess) reportError(res); else notify(res.error, 'error'); setMembers({ id: selectedId, list: [] }); return; }
            setMembers({ id: selectedId, list: res.data.members });
        });
        return () => ctrl.abort();
    }, [orgId, selectedId, dataVersion, nonce, reportError, notify]);

    const position = positions?.find(p => p.id === selectedId) ?? null;
    const list = members?.id === selectedId ? members.list : null;
    const refresh = () => { setNonce(n => n + 1); onDataChanged(); };

    const move = async (member: PositionMember, stageKey: Stage, remark: string | null = null) => {
        const stage = findStage(stageList?.stages ?? [], stageKey);
        if (!stage || stageKey === member.stage || !position) return;
        // Owner 2026-11-21 (spec): a reason to reject or to move back a round, as for a stage that needs a remark.
        if ((stage.needsRemark || reasonNeeded(stageList?.stages ?? [], member.stage, stageKey)) && !remark) { setPendingMove({ member, stage }); return; }
        setBusy(true);
        const res = await api<{ member: PositionMember; screening?: { status: string; note: string | null } | null; rejectionEmail?: { templateId: string } | null }>(`/api/candidates/positions/${encodeURIComponent(position.id)}/members/${encodeURIComponent(member.id)}`, { method: 'PATCH', json: { orgId, stage: stageKey, ...(remark ? { remark } : {}) } });
        setBusy(false);
        if (!res.ok) { notify(res.error, 'error'); if (res.noAccess) reportError(res); return; }
        setPendingMove(null);
        notify(`${member.record?.fullName ?? 'Candidate'} → ${stage.name}`, 'success');
        refresh();
        // Owner 2026-11-24: a rejected stage offers the soft rejection email (HR's template, from the connected mailbox).
        if (res.data.rejectionEmail && member.record && !member.record.blacklisted && member.record.email) {
            setRejection({ member, templateId: res.data.rejectionEmail.templateId, positionId: position.id });
        }
        // The editable update needs the stages migration (stage_update); before it, nothing is offered.
        if (stage.whatsapp && member.record && !member.record.blacklisted && stageList?.source !== 'legacy') {
            setOutreach({ record: member.record, positionId: position.id, positionTitle: position.title, stageName: stage.name, remark, open: true });
        }
    };
    const remove = async (member: PositionMember) => {
        if (!position) return;
        setBusy(true);
        const res = await api<{ ok: true }>(`/api/candidates/positions/${encodeURIComponent(position.id)}/members/${encodeURIComponent(member.id)}`, { method: 'DELETE', json: { orgId } });
        setBusy(false);
        if (!res.ok) { notify(res.error, 'error'); if (res.noAccess) reportError(res); return; }
        refresh();
    };
    const exportMembers = () => {
        const records = (list ?? []).map(m => m.record).filter((r): r is CandidateRecord => !!r);
        if (!records.length || !position) return;
        downloadCsv(`${position.title.replace(/[^\w-]+/g, '_')}-pipeline-${new Date().toISOString().slice(0, 10)}.csv`, recordsToCsv(records));
        // Owner 2026-11-24: every export is kept in the audit log.
        void api('/api/candidates/audit', { json: { orgId, action: 'export', count: records.length, what: `people in the ${position.title} pipeline` } });
        notify(`${formatCount(records.length)} exported (logged)`, 'success');
    };

    const inStage = (stage: Stage) => (list ?? []).filter(m => m.stage === stage);
    // The board's stages: HR's list, plus any stage people are in that is no longer on it (shown until they move).
    const listed = stageList?.stages ?? [];
    const allStages: StageDef[] = [...listed, ...[...new Set((list ?? []).map(m => m.stage))].filter(k => !findStage(listed, k)).map(unlistedStage)];
    const hasPeople = (s: StageDef) => inStage(s.key).length > 0;
    const columns = boardColumns(allStages, hasPeople);
    const side = sideStages(allStages, hasPeople);
    const stageOf = (m: PositionMember): StageDef => findStage(allStages, m.stage) ?? unlistedStage(m.stage);
    const columnOf = new Map(columns.flatMap((c, i) => c.stages.map(s => [s.key, i] as const)));
    const inColumns = (from: number, to: number, kinds: StageDef['kind'][] = ['progress']) => (list ?? []).filter(m => {
        const at = columnOf.get(m.stage);
        return at !== undefined && at >= from && at <= to && kinds.includes(stageOf(m).kind);
    });
    const isEarly = (m: PositionMember) => (columnOf.get(m.stage) ?? 99) < 2;
    const sideCount = side.reduce((n, s) => n + inStage(s.key).length, 0);
    const early = inColumns(0, 1);
    const waiting = early.filter(m => daysSince(m.stageChangedAt) > WAITING_DAYS).length;
    const rounds = columns.length > 4 ? inColumns(2, columns.length - 3) : [];
    const rejectedCount = (list ?? []).filter(m => stageOf(m).kind === 'rejected').length;
    const lastTwo = columns.length >= 2 ? inColumns(columns.length - 2, columns.length - 1) : [];
    const lastColumn = columns[columns.length - 1];
    const inLast = lastColumn ? inColumns(columns.length - 1, columns.length - 1).length : 0;
    const fromDatabase = (list ?? []).filter(m => m.record && recordOrigin(m.record) === 'sheet').length;
    const addedThisWeek = (list ?? []).filter(m => daysSince(m.addedAt) <= 7).length;

    // Drag and drop between columns and boxes: the browser's own events, no library.
    const dragProps = (stage: Stage) => ({
        onDragOver: (e: React.DragEvent) => { if (dragging) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (over !== stage) setOver(stage); } },
        onDragLeave: () => { if (over === stage) setOver(null); },
        onDrop: (e: React.DragEvent) => { e.preventDefault(); setOver(null); const m = dragging; setDragging(null); if (m) void move(m, stage); },
    });
    const openMember = (m: PositionMember, ids: string[], scopeLabel: string) => { if (m.record) setDetails({ memberId: m.id, record: m.record, ids, scopeLabel, open: true }); };
    const cardProps = {
        busy, onRemove: (m: PositionMember) => void remove(m), onOpen: (m: PositionMember) => openMember(m, inStage(m.stage).map(x => x.id), stageOf(m).name), onDragStart: setDragging,
        // Opens the person's panel on Assignment & documents, where an assessment is sent.
        onAssess: (m: PositionMember) => { openMember(m, inStage(m.stage).map(x => x.id), stageOf(m).name); setShowTab(t => ({ tab: 'work', nonce: (t?.nonce ?? 0) + 1 })); },
    };
    const card = (m: PositionMember) => <MemberCard key={m.id} member={m} stage={stageOf(m)} early={isEarly(m)} {...cardProps} />;
    const groups = stageGroups(listed);

    // The panel's place in the pipeline: the person as the board has them now, and the neighbours still there.
    const shownMember = details ? (list ?? []).find(m => m.id === details.memberId) ?? null : null;
    const walk = details ? details.ids.filter(id => id === details.memberId || (list ?? []).some(m => m.id === id && m.record)) : [];
    const at = details ? walk.indexOf(details.memberId) : -1;
    const step = (to: number) => {
        const m = (list ?? []).find(x => x.id === walk[to]);
        if (m?.record) setDetails(d => (d ? { ...d, memberId: m.id, record: m.record as CandidateRecord } : d));
    };
    const pipelineCtx: PipelineContext | null = details && position && shownMember ? {
        position, member: shownMember, index: at + 1, total: walk.length, scopeLabel: details.scopeLabel,
        onPrev: at > 0 ? () => step(at - 1) : null,
        onNext: at >= 0 && at < walk.length - 1 ? () => step(at + 1) : null,
        onMoved: refresh,
        onRemoved: () => {
            refresh();
            // Straight on to the next person, as a recruiter working down the column expects.
            if (at >= 0 && at < walk.length - 1) step(at + 1);
            else if (at > 0) step(at - 1);
        },
    } : null;

    const pendingWhy = pendingMove ? reasonNeeded(stageList?.stages ?? [], pendingMove.member.stage, pendingMove.stage.key) : null;
    return (
        <div className="space-y-4">
            <RemarkDialog
                open={!!pendingMove} required busy={busy}
                title={pendingMove ? `${pendingMove.member.record?.fullName ?? 'Candidate'}: ${pendingMove.stage.name}` : ''}
                description={pendingMove ? (pendingWhy === 'reject' ? 'Pick the reason: it is kept in the history and counted in the reports. Nothing is sent to the candidate.' : pendingWhy === 'back' ? `Moving back to "${pendingMove.stage.name}" needs a reason.` : `"${pendingMove.stage.name}" needs a remark, so the next person knows what it means.`) : undefined}
                reasons={pendingWhy === 'reject' ? rejectionReasons : undefined}
                onClose={() => { if (!busy) setPendingMove(null); }}
                onSubmit={remark => { if (pendingMove) void move(pendingMove.member, pendingMove.stage.key, remark); }}
            />
            <Dialog open={!!rejection} onClose={() => { if (!rejecting) setRejection(null); }} labelId="reject-email-title" size="sm"
                title={`Send ${rejection?.member.record?.fullName ?? 'them'} the rejection email?`}
                description="A polite note from the HR mailbox (Outreach → Templates → Soft rejection). Nothing is sent unless you press Send."
                footer={<>
                    <button type="button" onClick={() => setRejection(null)} disabled={rejecting} className={BTN_GHOST}>Not now</button>
                    <button type="button" onClick={() => void sendRejection()} disabled={rejecting} className={BTN_PRIMARY}>{rejecting && <Spinner />}Send the email</button>
                </>} />
            <OutreachDialog
                orgId={orgId} open={!!outreach?.open} record={outreach?.record ?? null}
                positionId={outreach?.positionId ?? null} positionTitle={outreach?.positionTitle ?? null} stageName={outreach?.stageName ?? ''} movedRemark={outreach?.remark ?? null}
                onClose={() => setOutreach(o => (o ? { ...o, open: false } : o))}
                onSent={() => { setOutreach(o => (o ? { ...o, open: false } : o)); refresh(); }}
            />

            {/* Position row */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <label htmlFor="pipe-position" className="text-sm text-text-secondary">Position</label>
                <select id="pipe-position" value={selectedId} onChange={e => setSelectedId(e.target.value)} disabled={!positions?.length} className={`${INPUT} h-11 w-auto min-w-[320px] font-display text-[15px] font-semibold`}>
                    {!positions?.length && <option value="">No positions yet</option>}
                    {positions?.map(p => <option key={p.id} value={p.id}>{p.title}{p.location ? ` · ${p.location}` : ''} · {p.status === 'open' ? `open ${p.daysOpen} d` : 'closed'}</option>)}
                </select>
                {position && (
                    <>
                        <Tag tone={position.status === 'open' ? 'success' : 'neutral'}>{position.status === 'open' ? 'Open' : 'Closed'}</Tag>
                        <span className="text-[13px] text-text-secondary">
                            {position.recruiterName ? `Recruiter: ${position.recruiterName} · ` : ''}{position.jdFileName ? `${position.jdFileName} · ` : ''}
                            {onSearch && <button type="button" onClick={() => onSearch(position)} className="font-medium text-primary-dark underline underline-offset-2 hover:text-primary">search the database for this JD</button>}
                        </span>
                    </>
                )}
                <span className="ml-auto flex flex-wrap items-center gap-x-2 gap-y-2">
                    {busy && <Spinner className="h-3.5 w-3.5 text-text-tertiary" />}
                    <div role="group" aria-label="View" className="inline-grid grid-cols-2 gap-x-1 rounded-xl bg-surface-elevated px-1 py-1 ring-1 ring-inset ring-border-subtle">
                        {(['board', 'table'] as const).map(id => (
                            <button key={id} type="button" onClick={() => setView(id)} aria-pressed={view === id}
                                className={`h-8 rounded-lg px-3 text-sm font-semibold capitalize transition-colors ${view === id ? 'bg-surface text-text-primary shadow-[var(--w-shadow)]' : 'text-text-secondary hover:text-text-primary'}`}>{id}</button>
                        ))}
                    </div>
                    {position && <button type="button" onClick={() => setQuestionsOpen(true)} className={BTN_SECONDARY}><ListChecks className="h-4 w-4" />Screening questions</button>}
                    {questionsOpen && position && <ScreeningQuestionsDialog orgId={orgId} positionId={position.id} positionTitle={position.title} onClose={() => setQuestionsOpen(false)} />}
                    <button type="button" onClick={exportMembers} disabled={!list?.length} className={BTN_SECONDARY}><Download className="h-4 w-4" />Export (logged)</button>
                    {onSearch && position && <button type="button" onClick={() => onSearch(position)} className={BTN_PRIMARY}><Plus className="h-4 w-4" />Add candidates</button>}
                </span>
            </div>

            {positions !== null && positions.length > 0 && !stageList && stagesFailed(orgId) ? (
                <div className={`${CARD} px-5 py-4`}>
                    <p role="alert" className="text-sm text-error">Couldn&rsquo;t load the pipeline&rsquo;s stages.</p>
                    <button type="button" onClick={() => retryStages(orgId)} className={`${BTN_GHOST} mt-1`}>Try again</button>
                </div>
            ) : positions === null || (positions.length > 0 && !stageList) ? (
                <p className="flex items-center gap-x-2 text-sm text-text-tertiary"><Spinner className="h-3.5 w-3.5" />Loading</p>
            ) : !position ? (
                <div className={CARD}><EmptyState icon={FileText} title="No positions yet">Save a job description as a position from Search or the Positions tab, then tick candidates in the results and add them to it.</EmptyState></div>
            ) : (
                <>
                    <section className="recruitment-hero" aria-label="Role brief">
                        <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-wider text-text-secondary">Hiring workspace</p><h2 className="mt-2 text-2xl font-semibold">{position.title}</h2><p className="mt-2 text-sm text-text-secondary">{[position.department, position.location, position.recruiterName ? `Recruiter: ${position.recruiterName}` : 'Recruiter not assigned'].filter(Boolean).join(' · ')}</p></div><span className="rounded-full bg-surface px-4 py-2 text-sm font-medium">{position.daysOpen} / {position.targetDays} days</span></div>
                        {position.summary && <p className="mt-3 max-w-3xl text-sm text-text-secondary">{position.summary}</p>}
                    </section>
                    {waiting > 0 && <details className={`${CARD} px-5 py-4`}><summary className="cursor-pointer text-sm font-semibold">{waiting} {waiting === 1 ? 'candidate needs' : 'candidates need'} a follow-up</summary><div className="mt-3 grid gap-2 sm:grid-cols-2">{early.filter(m => daysSince(m.stageChangedAt) > WAITING_DAYS).map(m => <button type="button" key={m.id} onClick={() => { if (m.record) setDetails({ memberId: m.id, record: m.record, ids: early.map(x => x.id), scopeLabel: 'Needs follow-up', open: true }); }} className="rounded-xl bg-surface-elevated px-4 py-3 text-left"><span className="block font-semibold">{m.record?.fullName ?? 'Candidate'}</span><span className="text-sm text-text-secondary">{stageOf(m).name} · {daysSince(m.stageChangedAt)} days in stage</span></button>)}</div></details>}
                    {/* The numbers a recruiter acts on today */}
                    <section className={`${CARD} flex flex-wrap`} aria-label="This position at a glance">
                        <Kpi label="In pipeline" value={formatCount(list?.length ?? 0)} hint={addedThisWeek ? `+${formatCount(addedThisWeek)} this week` : 'nobody added this week'} />
                        <Kpi label={columns.slice(0, 2).map(c => c.name).join(' & ') || 'Early stages'} value={formatCount(early.length)} hint={waiting ? `${formatCount(waiting)} waiting over ${WAITING_DAYS} days` : 'none waiting long'} alert={waiting > 0} />
                        {columns.length > 4 && <Kpi label="In interview rounds" value={formatCount(rounds.length)} hint={rejectedCount ? `${formatCount(rejectedCount)} rejected so far` : 'nobody rejected'} />}
                        {columns.length > 2 && <Kpi label={columns.slice(-2).map(c => c.name).join(' & ')} value={formatCount(lastTwo.length)} hint={lastColumn ? `${formatCount(inLast)} ${lastColumn.name.toLowerCase()}` : ''} />}
                        <Kpi label="Days open" value={position.daysOpen} hint={`target ${position.targetDays}`} alert={position.status === 'open' && position.daysOpen > position.targetDays} />
                        <Kpi label="From the database" value={<>{formatCount(fromDatabase)} <span className="font-body text-sm font-medium text-text-secondary">of {formatCount(list?.length ?? 0)}</span></>} hint="found without new sourcing" />
                    </section>

                    {view === 'board' ? (
                        <>
                            {/* Owner 2026-11-19: one column per round, scrolling sideways; each status is an area to drop on */}
                            <div className="-mx-1 overflow-x-auto px-1 pb-2" aria-label="Pipeline board (scrolls sideways)">
                                <div className="flex min-w-min items-start gap-x-3">
                                    {columns.map(column => {
                                        const active = column.stages.filter(st => st.kind !== 'rejected').reduce((n, st) => n + inStage(st.key).length, 0);
                                        const rejected = column.stages.filter(st => st.kind === 'rejected').reduce((n, st) => n + inStage(st.key).length, 0);
                                        const tone = (column.stages.find(st => st.kind !== 'rejected') ?? column.stages[0])?.tone ?? 'grey';
                                        return (
                                            <section key={column.name} aria-label={column.name} className={`${WELL} flex w-[280px] shrink-0 flex-col gap-y-2.5 px-2.5 py-2.5 ring-1 ring-inset ring-border-subtle`}>
                                                {/* Owner 2026-11-25, to the reference board: the round as a pill in its own colour (its first stage's), the count beside it. */}
                                                <header className="flex items-center gap-x-2 px-1 pb-0.5 pt-1">
                                                    <span title={column.name} className={`inline-flex h-7 min-w-0 items-center gap-x-1.5 rounded-full pl-2 pr-3 font-display text-sm font-semibold ${TONE_CHIP[tone]}`}>
                                                        <span className={`h-2 w-2 shrink-0 rounded-full ${TONE_DOT[tone]}`} aria-hidden />
                                                        <span className="truncate">{column.name}</span>
                                                    </span>
                                                    <span className={`${NUM_SM} shrink-0 text-sm text-text-secondary`}>{formatCount(active)}<span className="sr-only"> in {column.name}</span></span>
                                                    {rejected > 0 && <span className="ml-auto shrink-0 text-xs text-text-tertiary">{formatCount(rejected)} rejected</span>}
                                                </header>
                                                {column.stages.map(st => {
                                                    const items = inStage(st.key);
                                                    const folds = st.kind === 'rejected';
                                                    const open = !folds || !!expanded[st.key];
                                                    const shown = folds || expanded[`more:${st.key}`] ? items : items.slice(0, ZONE_SHOWN);
                                                    return (
                                                        <div key={st.key} {...dragProps(st.key)} aria-label={st.name}
                                                            className={`rounded-lg border-[1.5px] border-dashed px-1.5 py-1.5 transition-colors ${over === st.key ? 'border-primary bg-primary/[.06]' : 'border-transparent'}`}>
                                                            {folds ? (
                                                                <button type="button" onClick={() => items.length && setExpanded(e => ({ ...e, [st.key]: !e[st.key] }))} disabled={!items.length} aria-expanded={open}
                                                                    className="flex w-full items-center gap-x-2 rounded-md px-1 py-0.5 text-left disabled:cursor-default">
                                                                    <StageChip stage={st} />
                                                                    <span className={`${NUM_SM} ml-auto text-xs text-text-secondary`}>{items.length}</span>
                                                                    {items.length > 0 && (open ? <ChevronDown className="h-3.5 w-3.5 text-text-tertiary" aria-hidden /> : <ChevronRight className="h-3.5 w-3.5 text-text-tertiary" aria-hidden />)}
                                                                </button>
                                                            ) : (
                                                                <div className="flex items-center gap-x-2 px-1 py-0.5">
                                                                    <StageChip stage={st} title={st.hidden ? 'Hidden in Configurations: nobody new can be moved here' : undefined} />
                                                                    <span className={`${NUM_SM} ml-auto text-xs text-text-secondary`}>{items.length}</span>
                                                                </div>
                                                            )}
                                                            {list === null ? <p className="px-1 pt-1 text-xs text-text-tertiary">Loading</p> : open && (
                                                                <ul className="mt-2 space-y-2.5">
                                                                    {shown.map(card)}
                                                                    {!items.length && <li className="px-1 pb-1 text-xs text-text-tertiary">Drop a card here</li>}
                                                                    {!folds && items.length > ZONE_SHOWN && (
                                                                        <li>
                                                                            <button type="button" onClick={() => setExpanded(e => ({ ...e, [`more:${st.key}`]: !e[`more:${st.key}`] }))} className={`${WELL} block w-full bg-surface px-3 py-2.5 text-left text-sm text-text-secondary hover:text-text-primary`}>
                                                                                {expanded[`more:${st.key}`] ? 'Show fewer' : `+${formatCount(items.length - ZONE_SHOWN)} more`}
                                                                            </button>
                                                                        </li>
                                                                    )}
                                                                </ul>
                                                            )}
                                                        </div>
                                                    );
                                                })}
                                            </section>
                                        );
                                    })}
                                </div>
                            </div>

                            {side.length > 0 && (
                                <section aria-label="Out of the flow" className="space-y-2">
                                    <p className={LABEL}>Out of the flow <span className="font-normal text-text-tertiary">· still in the database, still searchable · drop a card here to move it · {sideCount}</span></p>
                                    <div className="grid gap-x-3 gap-y-3 sm:grid-cols-2 xl:grid-cols-4">
                                        {side.map(st => {
                                            const items = inStage(st.key);
                                            const isOpen = !!expanded[st.key];
                                            return (
                                                <section key={st.key} aria-label={st.name} {...dragProps(st.key)} className={`rounded-xl border border-dashed border-border bg-surface px-3 py-2.5 transition-shadow ${over === st.key ? 'ring-2 ring-inset ring-primary' : ''}`}>
                                                    <button type="button" onClick={() => items.length && setExpanded(e => ({ ...e, [st.key]: !e[st.key] }))} aria-expanded={isOpen} className="flex w-full items-center gap-x-2 text-left">
                                                        <span className={`h-2 w-2 shrink-0 rounded-full ${TONE_DOT[st.tone]}`} aria-hidden />
                                                        <span className="min-w-0 truncate font-semibold text-text-primary">{st.name}</span>
                                                        {st.needsRemark && <span className="shrink-0 text-xs text-text-tertiary">· remark required</span>}
                                                        {(st.unlisted || st.hidden) && <span className="shrink-0 text-xs text-text-tertiary">· {st.unlisted ? 'not on the list' : 'hidden'}</span>}
                                                        <span className={`${NUM_SM} ml-auto text-sm text-text-secondary`}>{items.length}</span>
                                                    </button>
                                                    {isOpen && items.length > 0 && <ul className="mt-2.5 space-y-2">{items.map(card)}</ul>}
                                                </section>
                                            );
                                        })}
                                    </div>
                                </section>
                            )}
                        </>
                    ) : (
                        <section className={`${CARD} overflow-x-auto`} aria-label="Pipeline table">
                            <table className="w-full min-w-[840px] text-sm">
                                <thead className="bg-surface-elevated text-left text-xs font-medium text-text-secondary">
                                    <tr>
                                        <th className="px-4 py-2.5 font-medium">Candidate</th><th className="px-3 py-2.5 font-medium">Where</th><th className="px-3 py-2.5 font-medium">Stage</th><th className="px-3 py-2.5 font-medium">Score</th><th className="px-3 py-2.5 text-right font-medium">Days</th><th className="px-3 py-2.5 font-medium">Moved by</th><th className="px-3 py-2.5 font-medium">Latest remark</th><th className="px-3 py-2.5" />
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-border-subtle">
                                    {(list ?? []).map(m => {
                                        const r = m.record;
                                        return (
                                            <tr key={m.id} className="hover:bg-surface-elevated">
                                                <td className="px-4 py-2"><button type="button" disabled={!r} onClick={() => openMember(m, (list ?? []).map(x => x.id), 'this position')} className="font-semibold text-text-primary underline-offset-2 hover:underline disabled:no-underline">{r?.fullName ?? 'Record removed'}</button></td>
                                                <td className="max-w-[260px] truncate px-3 py-2 text-text-secondary">{r ? [r.currentDesignation, r.currentOrganization, r.location].filter(Boolean).join(' · ') : ''}</td>
                                                <td className="px-3 py-2">
                                                    <select aria-label={`Stage of ${r?.fullName ?? 'candidate'}`} value={m.stage} disabled={busy} onChange={e => void move(m, e.target.value)} className="h-8 max-w-[240px] cursor-pointer rounded-lg border border-border bg-surface px-1.5 text-sm font-semibold text-text-primary outline-none focus:border-primary disabled:opacity-60">
                                                        <StageOptions groups={groups} current={stageOf(m)} />
                                                    </select>
                                                </td>
                                                <td className="px-3 py-2">{m.score ? <ScoreTag score={m.score} /> : <span className="text-text-tertiary">—</span>}</td>
                                                <td className={`${NUM_SM} px-3 py-2 text-right text-text-primary`}>{daysSince(m.stageChangedAt)}</td>
                                                <td className="px-3 py-2 text-text-secondary">{m.stageChangedByName ?? ''}</td>
                                                <td className="max-w-[320px] truncate px-3 py-2 italic text-text-secondary" title={m.remark ?? ''}>{m.remark ?? ''}</td>
                                                <td className="px-3 py-2 text-right"><button type="button" onClick={() => void remove(m)} disabled={busy} className={BTN_GHOST}>Remove</button></td>
                                            </tr>
                                        );
                                    })}
                                    {list !== null && list.length === 0 && <tr><td colSpan={8} className="px-4 py-6 text-center text-text-tertiary">Nobody in this position yet.</td></tr>}
                                </tbody>
                            </table>
                        </section>
                    )}
                </>
            )}

            {details && (
                <CandidateDetails
                    key={panelKey}
                    orgId={orgId}
                    record={shownMember?.record ?? details.record}
                    open={details.open}
                    onClose={() => setDetails(d => (d ? { ...d, open: false } : d))}
                    onEdit={() => {
                        const record = shownMember?.record ?? details.record;
                        setDetails(d => (d ? { ...d, open: false } : d));
                        setEditor(e => ({ record, key: (e?.key ?? 0) + 1, open: true }));
                    }}
                    onChanged={refresh}
                    pipeline={pipelineCtx}
                    showTab={showTab}
                />
            )}
            {editor && (
                <RecordForm
                    key={editor.key}
                    orgId={orgId}
                    record={editor.record}
                    open={editor.open}
                    onClose={() => { setEditor(e => (e ? { ...e, open: false } : e)); setDetails(d => (d ? { ...d, open: true } : d)); }}
                    onSaved={saved => {
                        setEditor(e => (e ? { ...e, open: false } : e));
                        // A fresh panel, so it reads the saved record instead of the one it had loaded.
                        setPanelKey(k => k + 1); setShowTab(null);
                        setDetails(d => (d ? { ...d, record: saved, open: true } : d));
                        refresh();
                        notify(`${saved.fullName} saved`, 'success');
                    }}
                />
            )}
        </div>
    );
}
