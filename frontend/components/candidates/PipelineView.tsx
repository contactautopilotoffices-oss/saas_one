'use client';

import React, { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, Download, FileText, Plus, X } from 'lucide-react';
import { boardColumns, findStage, sideStages, stageGroups, unlistedStage, type StageDef } from '@/backend/lib/candidates/stage-list';
import { recordOrigin, type CandidateRecord, type Position, type PositionMember, type Stage } from '@/backend/lib/candidates/types';
import { api, qs } from './api';
import CandidateDetails from './CandidateDetails';
import { downloadCsv, recordsToCsv } from './export-csv';
import { formatCount, formatDate } from './format';
import { OutreachDialog } from './OutreachPanel';
import type { PipelineContext } from './PipelineContext';
import PositionForm, { type PositionSeed } from './PositionForm';
import RecordForm from './RecordForm';
import { RemarkDialog } from './Remarks';
import { retryStages, StageChip, StageOptions, stagesFailed, TONE_DOT, useStages } from './stage-ui';
import { Avatar, BTN_GHOST, BTN_PRIMARY, BTN_SECONDARY, CARD, EmptyState, INPUT, LABEL, NUM_SM, Spinner, Tag, useUi, WELL } from './ui';

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

function MemberCard({ member, stage, early, busy, onRemove, onOpen, onDragStart }: {
    member: PositionMember; stage: StageDef; early: boolean; busy: boolean; onRemove: (member: PositionMember) => void; onOpen: (member: PositionMember) => void; onDragStart: (member: PositionMember) => void;
}) {
    const r = member.record;
    const name = r?.fullName ?? 'Record removed';
    const where = r ? [[r.currentDesignation, r.currentOrganization].filter(Boolean).join(' @ '), r.location].filter(Boolean).join(' · ') : '';
    const days = daysSince(member.stageChangedAt);
    const late = days > WAITING_DAYS && early && stage.kind === 'progress';
    return (
        <li draggable={!busy} onDragStart={e => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', member.id); onDragStart(member); }}
            className={`${CARD} group cursor-grab px-3 py-2.5 active:cursor-grabbing ${late ? 'ring-1 ring-inset ring-error/60' : ''}`}>
            <div className="flex items-center gap-x-2">
                <Avatar name={name} size="sm" />
                <button type="button" disabled={!r} onClick={() => r && onOpen(member)} className="min-w-0 flex-1 truncate text-left font-display text-[15px] font-semibold text-text-primary underline-offset-2 hover:underline disabled:no-underline">{name}</button>
                <button type="button" onClick={() => onRemove(member)} disabled={busy} aria-label={`Remove ${name} from this position`} title="Remove from this position" className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-text-tertiary opacity-0 hover:bg-muted hover:text-text-primary group-hover:opacity-100 focus-visible:opacity-100"><X className="h-3.5 w-3.5" /></button>
            </div>
            {where && <p className="mt-1.5 text-[13px] leading-snug text-text-secondary">{where}</p>}
            {member.remark && <p className="mt-1.5 text-[13px] italic leading-snug text-text-secondary">“{member.remark}”</p>}
            <div className="mt-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                <StageChip stage={stage} />
                {r?.hasResume === true && <Tag tone="success">Resume</Tag>}
                {r?.hasResume === false && <Tag tone="warn">No resume</Tag>}
                {member.stageChangedByName && <span className="min-w-0 truncate text-[13px] text-text-secondary">{member.stageChangedByName}</span>}
                <span className={`${NUM_SM} ml-auto shrink-0 text-[13px] ${late ? 'text-red-700' : 'text-text-secondary'}`} title={`In this stage since ${formatDate(member.stageChangedAt)}`}>{days} d</span>
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
    // Owner 2026-11-16: right after a drop on a stage marked for WhatsApp (Configurations), offer to tell the candidate.
    const [outreach, setOutreach] = useState<{ record: CandidateRecord; positionId: string; positionTitle: string; stageName: string; remark: string | null; open: boolean } | null>(null);
    const stageList = useStages(orgId);
    // Owner 2026-11-17: the panel knows which person of the pipeline it shows and the people it walks through (the
    // stage the card was opened in, or the whole table), so the arrows step through them; `record` is kept for when
    // the person leaves the position while the panel is open.
    const [details, setDetails] = useState<{ memberId: string; record: CandidateRecord; ids: string[]; scopeLabel: string; open: boolean } | null>(null);
    // Edit from the panel opens the record's form here; saving or closing it returns to the panel.
    const [editor, setEditor] = useState<{ record: CandidateRecord; key: number; open: boolean } | null>(null);
    const [panelKey, setPanelKey] = useState(0);
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
        if (stage.needsRemark && !remark) { setPendingMove({ member, stage }); return; }
        setBusy(true);
        const res = await api<{ member: PositionMember }>(`/api/candidates/positions/${encodeURIComponent(position.id)}/members/${encodeURIComponent(member.id)}`, { method: 'PATCH', json: { orgId, stage: stageKey, ...(remark ? { remark } : {}) } });
        setBusy(false);
        if (!res.ok) { notify(res.error, 'error'); if (res.noAccess) reportError(res); return; }
        setPendingMove(null);
        notify(`${member.record?.fullName ?? 'Candidate'} → ${stage.name}`, 'success');
        refresh();
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
    const cardProps = { busy, onRemove: (m: PositionMember) => void remove(m), onOpen: (m: PositionMember) => openMember(m, inStage(m.stage).map(x => x.id), stageOf(m).name), onDragStart: setDragging };
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

    return (
        <div className="space-y-4">
            <RemarkDialog
                open={!!pendingMove} required busy={busy}
                title={pendingMove ? `${pendingMove.member.record?.fullName ?? 'Candidate'}: ${pendingMove.stage.name}` : ''}
                description={pendingMove ? `"${pendingMove.stage.name}" needs a remark, so the next person knows what it means.` : undefined}
                onClose={() => { if (!busy) setPendingMove(null); }}
                onSubmit={remark => { if (pendingMove) void move(pendingMove.member, pendingMove.stage.key, remark); }}
            />
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
                                        return (
                                            <section key={column.name} aria-label={column.name} className={`${WELL} flex w-[264px] shrink-0 flex-col gap-y-2 px-2 py-2 ring-1 ring-inset ring-border-subtle`}>
                                                <header className="flex items-baseline gap-x-2 px-1.5 pt-1">
                                                    <span className="min-w-0 truncate font-display text-[15px] font-semibold text-text-primary" title={column.name}>{column.name}</span>
                                                    {rejected > 0 && <span className="shrink-0 text-xs text-text-tertiary">{formatCount(rejected)} rejected</span>}
                                                    <span className={`${NUM_SM} ml-auto shrink-0 rounded-full bg-surface px-2 py-0.5 text-xs text-text-secondary ring-1 ring-inset ring-border`}>{formatCount(active)}</span>
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
                                                                <ul className="mt-1.5 space-y-2">
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
                            <table className="w-full min-w-[760px] text-sm">
                                <thead className="bg-surface-elevated text-left text-xs font-medium text-text-secondary">
                                    <tr>
                                        <th className="px-4 py-2.5 font-medium">Candidate</th><th className="px-3 py-2.5 font-medium">Where</th><th className="px-3 py-2.5 font-medium">Stage</th><th className="px-3 py-2.5 text-right font-medium">Days</th><th className="px-3 py-2.5 font-medium">Moved by</th><th className="px-3 py-2.5 font-medium">Latest remark</th><th className="px-3 py-2.5" />
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
                                                <td className={`${NUM_SM} px-3 py-2 text-right text-text-primary`}>{daysSince(m.stageChangedAt)}</td>
                                                <td className="px-3 py-2 text-text-secondary">{m.stageChangedByName ?? ''}</td>
                                                <td className="max-w-[320px] truncate px-3 py-2 italic text-text-secondary" title={m.remark ?? ''}>{m.remark ?? ''}</td>
                                                <td className="px-3 py-2 text-right"><button type="button" onClick={() => void remove(m)} disabled={busy} className={BTN_GHOST}>Remove</button></td>
                                            </tr>
                                        );
                                    })}
                                    {list !== null && list.length === 0 && <tr><td colSpan={7} className="px-4 py-6 text-center text-text-tertiary">Nobody in this position yet.</td></tr>}
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
                        setPanelKey(k => k + 1);
                        setDetails(d => (d ? { ...d, record: saved, open: true } : d));
                        refresh();
                        notify(`${saved.fullName} saved`, 'success');
                    }}
                />
            )}
        </div>
    );
}
