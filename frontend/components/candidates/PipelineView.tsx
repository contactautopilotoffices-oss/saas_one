'use client';

import React, { useEffect, useState } from 'react';
import { Download, FileText, Plus, X } from 'lucide-react';
import type { SearchFilters } from '@/backend/lib/candidates/filters';
import type { Preferences } from '@/backend/lib/candidates/query-spec';
import { FLOW_STAGES, recordOrigin, SIDE_STAGES, STAGE_LABELS, STAGE_REMARK_REQUIRED, type CandidateRecord, type Position, type PositionMember, type Stage } from '@/backend/lib/candidates/types';
import { api, qs } from './api';
import CandidateDetails from './CandidateDetails';
import { downloadCsv, recordsToCsv } from './export-csv';
import { formatCount, formatDate } from './format';
import { OutreachDialog, outreachKindFor } from './OutreachPanel';
import { RemarkDialog } from './Remarks';
import { Avatar, BTN_GHOST, BTN_PRIMARY, BTN_SECONDARY, CARD, Dialog, EmptyState, INPUT, LABEL, NUM_SM, Spinner, Tag, useUi, WELL } from './ui';

/*
 * The pipeline per position (owner 2026-11-15, to the mockup). One position at a time: the numbers a recruiter acts
 * on today, then a column per stage of the flow (three cards each, "+N more" opens the rest), then the four
 * out-of-the-flow boxes. A card is dragged to another column or box; "Others" asks for a remark. Every move is in
 * the candidate's history. The record's own status is not touched.
 */

/** A person waiting this long at Sourced or Screening is counted as waiting. */
const WAITING_DAYS = 2;
/** Cards shown per column before "+N more". */
const COLUMN_SHOWN = 3;

const daysSince = (iso: string) => Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));

/** New position: a title and where, plus whatever the search already knows (a JD, the filters). */
export function PositionDialog({ open, orgId, seed, onClose, onSaved }: {
    open: boolean; orgId: string;
    seed?: { title?: string; location?: string; jdText?: string; jdFileName?: string; filters?: SearchFilters; prefer?: Preferences };
    onClose: () => void; onSaved: (position: Position) => void;
}) {
    const { notify, reportError } = useUi();
    const [title, setTitle] = useState('');
    const [location, setLocation] = useState('');
    const [department, setDepartment] = useState('');
    const [busy, setBusy] = useState(false);
    const [seenOpen, setSeenOpen] = useState(open);
    if (open !== seenOpen) { setSeenOpen(open); if (open) { setTitle(seed?.title ?? ''); setLocation(seed?.location ?? ''); setDepartment(''); } }
    const save = async () => {
        if (!title.trim() || busy) return;
        setBusy(true);
        const res = await api<{ position: Position }>('/api/candidates/positions', {
            json: { orgId, title: title.trim(), location: location.trim() || undefined, department: department.trim() || undefined, jdText: seed?.jdText || undefined, jdFileName: seed?.jdFileName || undefined, filters: seed?.filters, prefer: seed?.prefer },
        });
        setBusy(false);
        if (!res.ok) { notify(res.error, 'error'); if (res.noAccess) reportError(res); return; }
        notify(`Position saved: ${res.data.position.title}`, 'success');
        onSaved(res.data.position);
    };
    return (
        <Dialog
            open={open} onClose={() => { if (!busy) onClose(); }} labelId="cand-position-title" title="New position"
            description={seed?.jdText ? 'The job description and the filters as they stand now are saved with it, so anyone can re-run this search.' : 'Candidates are added to a position from the search results.'}
            footer={<><button type="button" onClick={onClose} disabled={busy} className={BTN_SECONDARY}>Cancel</button><button type="button" onClick={() => void save()} disabled={busy || !title.trim()} className={BTN_PRIMARY}>{busy && <Spinner />}Save position</button></>}
        >
            <div className="space-y-3">
                <div><label htmlFor="pos-title" className="block text-sm font-semibold text-text-primary">Title</label><input id="pos-title" value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Sr Technical Executive" className={`${INPUT} mt-1.5`} autoFocus /></div>
                <div className="grid gap-3 sm:grid-cols-2">
                    <div><label htmlFor="pos-location" className="block text-sm font-semibold text-text-primary">Location</label><input id="pos-location" value={location} onChange={e => setLocation(e.target.value)} placeholder="e.g. SS Plaza, Bengaluru" className={`${INPUT} mt-1.5`} /></div>
                    <div><label htmlFor="pos-department" className="block text-sm font-semibold text-text-primary">Department</label><input id="pos-department" value={department} onChange={e => setDepartment(e.target.value)} placeholder="e.g. Operations" className={`${INPUT} mt-1.5`} /></div>
                </div>
                {seed?.jdFileName && <p className="text-xs text-text-secondary">Job description: {seed.jdFileName}</p>}
            </div>
        </Dialog>
    );
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

function MemberCard({ member, busy, onRemove, onOpen, onDragStart }: {
    member: PositionMember; busy: boolean; onRemove: (member: PositionMember) => void; onOpen: (record: CandidateRecord) => void; onDragStart: (member: PositionMember) => void;
}) {
    const r = member.record;
    const name = r?.fullName ?? 'Record removed';
    const where = r ? [[r.currentDesignation, r.currentOrganization].filter(Boolean).join(' @ '), r.location].filter(Boolean).join(' · ') : '';
    const days = daysSince(member.stageChangedAt);
    const late = days > WAITING_DAYS && (member.stage === 'sourced' || member.stage === 'screening');
    return (
        <li draggable={!busy} onDragStart={e => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', member.id); onDragStart(member); }}
            className={`${CARD} group cursor-grab px-3 py-2.5 active:cursor-grabbing ${late ? 'ring-1 ring-inset ring-error/60' : ''}`}>
            <div className="flex items-center gap-x-2">
                <Avatar name={name} size="sm" />
                <button type="button" disabled={!r} onClick={() => r && onOpen(r)} className="min-w-0 flex-1 truncate text-left font-display text-[15px] font-semibold text-text-primary underline-offset-2 hover:underline disabled:no-underline">{name}</button>
                <button type="button" onClick={() => onRemove(member)} disabled={busy} aria-label={`Remove ${name} from this position`} title="Remove from this position" className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-text-tertiary opacity-0 hover:bg-muted hover:text-text-primary group-hover:opacity-100 focus-visible:opacity-100"><X className="h-3.5 w-3.5" /></button>
            </div>
            {where && <p className="mt-1.5 text-[13px] leading-snug text-text-secondary">{where}</p>}
            {member.remark && <p className="mt-1.5 text-[13px] italic leading-snug text-text-secondary">“{member.remark}”</p>}
            <div className="mt-2 flex items-center gap-x-2">
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
    const [pendingMove, setPendingMove] = useState<{ member: PositionMember; stage: Stage } | null>(null);
    // Owner 2026-11-16: right after a drop on Shortlisted or Rejected, offer to tell the candidate on WhatsApp.
    const [outreach, setOutreach] = useState<{ record: CandidateRecord; positionId: string; positionTitle: string; kind: 'shortlisted' | 'not_shortlisted'; remark: string | null; open: boolean } | null>(null);
    const [details, setDetails] = useState<{ record: CandidateRecord; open: boolean } | null>(null);
    const [view, setView] = useState<'board' | 'table'>('board');
    const [dragging, setDragging] = useState<PositionMember | null>(null);
    const [over, setOver] = useState<Stage | null>(null);
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

    const move = async (member: PositionMember, stage: Stage, remark: string | null = null) => {
        if (stage === member.stage || !position) return;
        if (STAGE_REMARK_REQUIRED.includes(stage) && !remark) { setPendingMove({ member, stage }); return; }
        setBusy(true);
        const res = await api<{ member: PositionMember }>(`/api/candidates/positions/${encodeURIComponent(position.id)}/members/${encodeURIComponent(member.id)}`, { method: 'PATCH', json: { orgId, stage, ...(remark ? { remark } : {}) } });
        setBusy(false);
        if (!res.ok) { notify(res.error, 'error'); if (res.noAccess) reportError(res); return; }
        setPendingMove(null);
        notify(`${member.record?.fullName ?? 'Candidate'} → ${STAGE_LABELS[stage]}`, 'success');
        refresh();
        const kind = outreachKindFor(stage);
        if (kind && member.record) setOutreach({ record: member.record, positionId: position.id, positionTitle: position.title, kind, remark, open: true });
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
    const sideCount = SIDE_STAGES.reduce((n, s) => n + inStage(s).length, 0);
    const waiting = (list ?? []).filter(m => (m.stage === 'sourced' || m.stage === 'screening') && daysSince(m.stageChangedAt) > WAITING_DAYS).length;
    const fromDatabase = (list ?? []).filter(m => m.record && recordOrigin(m.record) === 'sheet').length;
    const addedThisWeek = (list ?? []).filter(m => daysSince(m.addedAt) <= 7).length;
    const offersWaiting = inStage('offer').filter(m => daysSince(m.stageChangedAt) >= 3).length;

    // Drag and drop between columns and boxes: the browser's own events, no library.
    const dragProps = (stage: Stage) => ({
        onDragOver: (e: React.DragEvent) => { if (dragging) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (over !== stage) setOver(stage); } },
        onDragLeave: () => { if (over === stage) setOver(null); },
        onDrop: (e: React.DragEvent) => { e.preventDefault(); setOver(null); const m = dragging; setDragging(null); if (m) void move(m, stage); },
    });
    const cardProps = { busy, onRemove: (m: PositionMember) => void remove(m), onOpen: (record: CandidateRecord) => setDetails({ record, open: true }), onDragStart: setDragging };

    return (
        <div className="space-y-4">
            <RemarkDialog
                open={!!pendingMove} required busy={busy}
                title={pendingMove ? `${pendingMove.member.record?.fullName ?? 'Candidate'}: ${STAGE_LABELS[pendingMove.stage]}` : ''}
                description={pendingMove ? `"${STAGE_LABELS[pendingMove.stage]}" needs a remark, so the next person knows what it means.` : undefined}
                onClose={() => { if (!busy) setPendingMove(null); }}
                onSubmit={remark => { if (pendingMove) void move(pendingMove.member, pendingMove.stage, remark); }}
            />
            <OutreachDialog
                orgId={orgId} open={!!outreach?.open} record={outreach?.record ?? null}
                positionId={outreach?.positionId ?? null} positionTitle={outreach?.positionTitle ?? null} kind={outreach?.kind ?? 'shortlisted'} movedRemark={outreach?.remark ?? null}
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

            {positions === null ? (
                <p className="flex items-center gap-x-2 text-sm text-text-tertiary"><Spinner className="h-3.5 w-3.5" />Loading</p>
            ) : !position ? (
                <div className={CARD}><EmptyState icon={FileText} title="No positions yet">Save a job description as a position from Search or the Positions tab, then tick candidates in the results and add them to it.</EmptyState></div>
            ) : (
                <>
                    {/* The numbers a recruiter acts on today */}
                    <section className={`${CARD} flex flex-wrap`} aria-label="This position at a glance">
                        <Kpi label="In pipeline" value={formatCount(list?.length ?? 0)} hint={addedThisWeek ? `+${formatCount(addedThisWeek)} this week` : 'nobody added this week'} />
                        <Kpi label="Awaiting screening" value={formatCount(inStage('sourced').length + inStage('screening').length)} hint={waiting ? `${formatCount(waiting)} waiting over ${WAITING_DAYS} days` : 'none waiting long'} alert={waiting > 0} />
                        <Kpi label="Interviews" value={formatCount(inStage('interview').length)} hint={inStage('shortlisted').length ? `${formatCount(inStage('shortlisted').length)} shortlisted to schedule` : 'nobody shortlisted'} />
                        <Kpi label="Offers out" value={formatCount(inStage('offer').length)} hint={offersWaiting ? `${formatCount(offersWaiting)} no reply for 3 days` : inStage('joined').length ? `${formatCount(inStage('joined').length)} joined` : 'none joined yet'} alert={offersWaiting > 0} />
                        <Kpi label="Days open" value={position.daysOpen} hint={`target ${position.targetDays}`} alert={position.status === 'open' && position.daysOpen > position.targetDays} />
                        <Kpi label="From the database" value={<>{formatCount(fromDatabase)} <span className="font-body text-sm font-medium text-text-secondary">of {formatCount(list?.length ?? 0)}</span></>} hint="found without new sourcing" />
                    </section>

                    {view === 'board' ? (
                        <>
                            <div className="grid gap-x-3 gap-y-3 md:grid-cols-3 xl:grid-cols-6" aria-label="Pipeline board">
                                {FLOW_STAGES.map(stage => {
                                    const items = inStage(stage);
                                    const shown = expanded[stage] ? items : items.slice(0, COLUMN_SHOWN);
                                    return (
                                        <section key={stage} aria-label={STAGE_LABELS[stage]} {...dragProps(stage)} className={`min-h-[180px] rounded-xl px-0.5 py-0.5 transition-shadow ${over === stage ? 'ring-2 ring-inset ring-primary' : ''}`}>
                                            <header className="flex items-center gap-x-2 px-1.5 pb-2.5 pt-1">
                                                <span className="font-display text-[15px] font-semibold text-text-primary">{STAGE_LABELS[stage]}</span>
                                                <span className={`${NUM_SM} ml-auto rounded-full bg-surface-elevated px-2 py-0.5 text-xs text-text-secondary ring-1 ring-inset ring-border`}>{items.length}</span>
                                            </header>
                                            {list === null ? <p className="px-1.5 text-xs text-text-tertiary">Loading</p> : (
                                                <ul className="space-y-2.5">
                                                    {shown.map(m => <MemberCard key={m.id} member={m} {...cardProps} />)}
                                                    {items.length > COLUMN_SHOWN && (
                                                        <li>
                                                            <button type="button" onClick={() => setExpanded(e => ({ ...e, [stage]: !e[stage] }))} className={`${WELL} block w-full px-3 py-3 text-left text-sm text-text-secondary hover:text-text-primary`}>
                                                                {expanded[stage] ? 'Show fewer' : `+${formatCount(items.length - COLUMN_SHOWN)} more`}
                                                            </button>
                                                        </li>
                                                    )}
                                                </ul>
                                            )}
                                        </section>
                                    );
                                })}
                            </div>

                            <section aria-label="Out of the flow" className="space-y-2">
                                <p className={LABEL}>Out of the flow <span className="font-normal text-text-tertiary">· still in the database, still searchable · drop a card here to record why · {sideCount}</span></p>
                                <div className="grid gap-x-3 gap-y-3 md:grid-cols-2 xl:grid-cols-4">
                                    {SIDE_STAGES.map(stage => {
                                        const items = inStage(stage);
                                        const isOpen = !!expanded[stage];
                                        return (
                                            <section key={stage} aria-label={STAGE_LABELS[stage]} {...dragProps(stage)} className={`rounded-xl border border-dashed border-border bg-surface px-3 py-2.5 transition-shadow ${over === stage ? 'ring-2 ring-inset ring-primary' : ''}`}>
                                                <button type="button" onClick={() => items.length && setExpanded(e => ({ ...e, [stage]: !e[stage] }))} aria-expanded={isOpen} className="flex w-full items-center gap-x-2 text-left">
                                                    <span className={`h-2 w-2 shrink-0 rounded-full ${stage === 'on_hold' ? 'bg-warning' : stage === 'rejected' ? 'bg-error' : stage === 'others' ? 'bg-secondary-dark' : 'bg-text-tertiary'}`} aria-hidden />
                                                    <span className="font-semibold text-text-primary">{STAGE_LABELS[stage]}</span>
                                                    {stage === 'others' && <span className="text-xs text-text-tertiary">· remark required</span>}
                                                    <span className={`${NUM_SM} ml-auto text-sm text-text-secondary`}>{items.length}</span>
                                                </button>
                                                {isOpen && items.length > 0 && <ul className="mt-2.5 space-y-2">{items.map(m => <MemberCard key={m.id} member={m} {...cardProps} />)}</ul>}
                                            </section>
                                        );
                                    })}
                                </div>
                            </section>
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
                                                <td className="px-4 py-2"><button type="button" disabled={!r} onClick={() => r && setDetails({ record: r, open: true })} className="font-semibold text-text-primary underline-offset-2 hover:underline disabled:no-underline">{r?.fullName ?? 'Record removed'}</button></td>
                                                <td className="max-w-[260px] truncate px-3 py-2 text-text-secondary">{r ? [r.currentDesignation, r.currentOrganization, r.location].filter(Boolean).join(' · ') : ''}</td>
                                                <td className="px-3 py-2">
                                                    <select aria-label={`Stage of ${r?.fullName ?? 'candidate'}`} value={m.stage} disabled={busy} onChange={e => void move(m, e.target.value as Stage)} className="h-8 cursor-pointer rounded-lg border border-border bg-surface px-1.5 text-sm font-semibold text-text-primary outline-none focus:border-primary disabled:opacity-60">
                                                        <optgroup label="Flow">{FLOW_STAGES.map(s => <option key={s} value={s}>{STAGE_LABELS[s]}</option>)}</optgroup>
                                                        <optgroup label="Out of the flow">{SIDE_STAGES.map(s => <option key={s} value={s}>{STAGE_LABELS[s]}</option>)}</optgroup>
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
                    orgId={orgId}
                    record={details.record}
                    open={details.open}
                    onClose={() => setDetails(d => (d ? { ...d, open: false } : d))}
                    onEdit={() => notify('Edit the record from the Candidates tab.', 'info')}
                    onChanged={refresh}
                />
            )}
        </div>
    );
}
