'use client';

import React, { useEffect, useRef, useState } from 'react';
import { BookOpen, FileUp, FolderPlus, Layers, PencilLine, Search, Trash2 } from 'lucide-react';
import type { Preferences } from '@/backend/lib/candidates/query-spec';
import { boardColumns, type StageDef } from '@/backend/lib/candidates/stage-list';
import { EMPLOYMENT_TYPE_LABELS, PRIORITY_LABELS, type Position, type PositionReadResponse } from '@/backend/lib/candidates/types';
import { api, qs } from './api';
import { formatCount, formatDate, formatInr } from './format';
import JdLibrary, { type JdPick } from './JdLibrary';
import PositionForm, { type PositionJdLink, type PositionSeed } from './PositionForm';
import { BTN_DANGER_FILLED } from './Remarks';
import { useStages } from './stage-ui';
import { BTN_DANGER_GHOST, BTN_GHOST, BTN_PRIMARY, BTN_SECONDARY, CARD, Dialog, EmptyState, INPUT, LABEL, NUM_SM, Spinner, Tag, useUi, WELL } from './ui';

/*
 * Positions (owner 2026-11-15; 2026-11-16 a job record, not only a saved search). A new one starts from a JD file
 * or pasted text (read into the Create position form by the two readers), or from an empty form. Each row shows the
 * job's details, its pipeline as a small funnel, days open against the target, and leads to Edit, Search (the
 * position's filters loaded) or its Pipeline.
 */

/** How a preference reads as a chip, for the Search view when a position's filters are loaded. */
export function preferLabels(prefer: Preferences): { key: keyof Preferences; label: string }[] {
    const out: { key: keyof Preferences; label: string }[] = [];
    if (prefer.roles?.length) out.push({ key: 'roles', label: `Role: ${prefer.roles.join(' / ')}` });
    if (prefer.locations?.length) out.push({ key: 'locations', label: `Location: ${prefer.locations.join(' / ')}` });
    if (prefer.min_relevant_exp_months !== undefined) out.push({ key: 'min_relevant_exp_months', label: `Relevant exp ≥ ${Math.round((prefer.min_relevant_exp_months / 12) * 10) / 10} yrs` });
    if (prefer.max_notice_days !== undefined) out.push({ key: 'max_notice_days', label: `Notice ≤ ${prefer.max_notice_days} days` });
    if (prefer.max_expected_inhand !== undefined) out.push({ key: 'max_expected_inhand', label: `Expected ≤ ₹${Math.round(prefer.max_expected_inhand / 1000)}K/month` });
    return out;
}

/** People per round (owner 2026-11-19: one bar per board column of HR's list; rejected people are not counted). */
function Funnel({ counts, stages }: { counts: Position['counts']; stages: StageDef[] }) {
    const columns = boardColumns(stages).map(c => ({ name: c.name, n: c.stages.filter(s => s.kind !== 'rejected').reduce((t, s) => t + (counts[s.key] ?? 0), 0) }));
    const max = Math.max(1, ...columns.map(c => c.n));
    const short = (name: string) => name.split(/[\s·/]+/)[0].slice(0, 5);
    return (
        <div className="flex h-10 items-end gap-x-1" aria-label={columns.map(c => `${c.name} ${c.n}`).join(', ')}>
            {columns.map((c, i) => (
                <span key={c.name} title={c.name} className="flex w-9 flex-col items-center gap-y-0.5 text-[10px] text-text-tertiary">
                    <span className={`${NUM_SM} text-xs text-text-primary`}>{c.n}</span>
                    <span className={`block w-full rounded-t-sm ${i === columns.length - 1 ? 'bg-success' : 'bg-primary/40'}`} style={{ height: `${Math.max(2, Math.round((c.n / max) * 18))}px` }} aria-hidden />
                    {short(c.name)}
                </span>
            ))}
        </div>
    );
}

/** The job's details in one line under the title: where, department, type, openings, budget, hiring manager. */
function detailLine(p: Position): string {
    const must = p.filters.keywords?.filter(k => k.required).length ?? 0;
    const budget = p.budgetMaxInhand !== null ? `up to ${formatInr(p.budgetMaxInhand)}/month` : null;
    return [
        p.location, p.department,
        p.employmentType ? EMPLOYMENT_TYPE_LABELS[p.employmentType] : null,
        p.openings > 1 ? `${p.openings} openings` : null,
        budget,
        p.hiringManager ? `HM ${p.hiringManager}` : null,
        must ? `${must} must-have${must === 1 ? '' : 's'}` : null,
    ].filter(Boolean).join(' · ');
}

export default function PositionsView({ orgId, dataVersion, onDataChanged, onSearch, onPipeline }: {
    orgId: string; dataVersion: number; onDataChanged: () => void;
    /** Opens Search with the position's filters loaded. */
    onSearch: (position: Position) => void;
    /** Opens the Pipeline tab on this position. */
    onPipeline: (position: Position) => void;
}) {
    const { notify, reportError } = useUi();
    const stages = useStages(orgId)?.stages ?? [];
    const [positions, setPositions] = useState<Position[] | null>(null);
    const [statusFilter, setStatusFilter] = useState<'open' | 'closed' | 'all'>('open');
    const [q, setQ] = useState('');
    const [nonce, setNonce] = useState(0);
    const [busy, setBusy] = useState(false);
    // The form: a new position (optionally seeded by a JD read), or one being edited (with its JD text fetched first).
    const [form, setForm] = useState<{ open: boolean; seed?: PositionSeed; position?: Position | null }>({ open: false });
    const [pasteOpen, setPasteOpen] = useState(false);
    // Owner 2026-11-17: the JD library sits beside the positions; a position opened from it remembers the JD and version.
    const [view, setView] = useState<'positions' | 'library'>('positions');
    const [jdLink, setJdLink] = useState<PositionJdLink | null>(null);
    const [pasteText, setPasteText] = useState('');
    const fileRef = useRef<HTMLInputElement | null>(null);
    // Owner 2026-11-21 (spec A03): HR assigns each position's recruiter from the HR team; a role opened from an approved
    // hiring request starts with nobody, and the HR Head is told when nobody is assigned after 2 days.
    const [recruiters, setRecruiters] = useState<{ id: string; name: string }[]>([]);
    const [assigning, setAssigning] = useState<string | null>(null);
    useEffect(() => {
        const ctrl = new AbortController();
        void api<{ people: { id: string; name: string }[] }>(`/api/candidates/recruiters${qs({ orgId })}`, { signal: ctrl.signal }).then(res => {
            if (!ctrl.signal.aborted && res.ok) setRecruiters(res.data.people);
        });
        return () => ctrl.abort();
    }, [orgId]);
    const assignRecruiter = async (p: Position, recruiterId: string) => {
        setAssigning(p.id);
        const res = await api<{ position: Position }>(`/api/candidates/positions/${encodeURIComponent(p.id)}`, { method: 'PATCH', json: { orgId, recruiterId: recruiterId || null } });
        setAssigning(null);
        if (!res.ok) { notify(res.error, 'error'); if (res.noAccess) reportError(res); return; }
        setPositions(list => (list ?? []).map(x => (x.id === p.id ? { ...x, recruiterId: res.data.position.recruiterId ?? null, recruiterName: res.data.position.recruiterName } : x)));
        notify(recruiterId ? `${res.data.position.recruiterName ?? 'The recruiter'} is now the recruiter` : 'Recruiter removed', 'success');
    };

    useEffect(() => {
        const ctrl = new AbortController();
        void api<{ positions: Position[] }>(`/api/candidates/positions${qs({ orgId, status: statusFilter })}`, { signal: ctrl.signal }).then(res => {
            if (ctrl.signal.aborted) return;
            if (!res.ok) { if (res.noAccess) reportError(res); else notify(res.error, 'error'); setPositions([]); return; }
            setPositions(res.data.positions);
        });
        return () => ctrl.abort();
    }, [orgId, statusFilter, dataVersion, nonce, reportError, notify]);
    const refresh = () => { setNonce(n => n + 1); onDataChanged(); };

    /** A JD (file or text) is read by the two readers, then the form opens with every field it could fill. */
    const readJd = async (job: string | File, link: PositionJdLink | null = null) => {
        setBusy(true);
        let res;
        if (typeof job === 'string') res = await api<PositionReadResponse>('/api/candidates/positions/read', { json: { orgId, text: job } });
        else { const f = new FormData(); f.set('orgId', orgId); f.set('file', job, job.name); res = await api<PositionReadResponse>('/api/candidates/positions/read', { form: f }); }
        setBusy(false);
        if (fileRef.current) fileRef.current.value = '';
        if (!res.ok) { notify(res.error, 'error'); if (res.noAccess) reportError(res); return; }
        const d = res.data.draft;
        if (!res.data.aiParsed) notify(res.data.notices[0] ?? 'Nothing could be read from that.', 'error');
        else if (res.data.notices[0]) notify(res.data.notices[0], 'info');
        // The draft is handed over as a seed the form turns into fields; the form itself can read the JD again.
        setForm({
            open: true,
            seed: {
                title: d.title, location: d.location ?? undefined, jdText: d.jdText, jdFileName: d.jdFileName ?? undefined,
                filters: undefined, prefer: d.prefer,
            },
            position: null,
        });
        // The seed only carries the basics; the full draft is applied once the form is open.
        setDraft(d);
        setJdLink(link);
        setPasteOpen(false);
        setPasteText('');
    };
    const [draft, setDraft] = useState<PositionReadResponse['draft'] | null>(null);

    const edit = async (p: Position) => {
        setBusy(true);
        const res = await api<{ position: Position }>(`/api/candidates/positions/${encodeURIComponent(p.id)}${qs({ orgId })}`);
        setBusy(false);
        if (!res.ok) { notify(res.error, 'error'); if (res.noAccess) reportError(res); return; }
        setDraft(null);
        setJdLink(null);
        setForm({ open: true, position: res.data.position });
    };
    // Delete (owner 2026-11-16): asked first, with how many people it takes out of the pipeline.
    const [deleting, setDeleting] = useState<Position | null>(null);
    const remove = async () => {
        if (!deleting) return;
        setBusy(true);
        const res = await api<{ removed: number }>(`/api/candidates/positions/${encodeURIComponent(deleting.id)}${qs({ orgId })}`, { method: 'DELETE' });
        setBusy(false);
        if (!res.ok) { notify(res.error, 'error'); if (res.noAccess) reportError(res); return; }
        notify(`Deleted ${deleting.title}${res.data.removed ? `; ${formatCount(res.data.removed)} ${res.data.removed === 1 ? 'person' : 'people'} taken out of its pipeline` : ''}`, 'success');
        setDeleting(null);
        refresh();
    };
    const setStatus = async (position: Position, status: 'open' | 'closed') => {
        setBusy(true);
        const res = await api<{ position: Position }>(`/api/candidates/positions/${encodeURIComponent(position.id)}`, { method: 'PATCH', json: { orgId, status } });
        setBusy(false);
        if (!res.ok) { notify(res.error, 'error'); if (res.noAccess) reportError(res); return; }
        refresh();
    };

    const shown = (positions ?? []).filter(p => !q.trim() || [p.title, p.location, p.department, p.hiringManager].filter(Boolean).join(' ').toLowerCase().includes(q.trim().toLowerCase()));
    const inPipeline = (p: Position) => Object.values(p.counts).reduce((n, c) => n + c, 0);

    return (
        <div className="space-y-4">
            <PositionForm
                open={form.open} orgId={orgId} seed={form.seed} position={form.position} draft={draft} jdLink={jdLink}
                onClose={() => setForm(s => ({ ...s, open: false }))}
                onSaved={() => { setForm({ open: false }); setDraft(null); setJdLink(null); refresh(); }}
            />
            <Dialog
                open={!!deleting} onClose={() => { if (!busy) setDeleting(null); }} labelId="cand-position-delete" size="sm"
                title={deleting ? `Delete ${deleting.title}?` : ''}
                description={deleting ? (inPipeline(deleting)
                    ? `${formatCount(inPipeline(deleting))} ${inPipeline(deleting) === 1 ? 'person is' : 'people are'} in its pipeline and will be taken out of it. Their records and history stay. To keep the pipeline, Close the position instead.`
                    : 'It leaves the Positions list and the Search dropdown. To keep it for reference, Close it instead.') : undefined}
                footer={<>
                    <button type="button" onClick={() => setDeleting(null)} disabled={busy} className={BTN_SECONDARY}>Cancel</button>
                    <button type="button" onClick={() => void remove()} disabled={busy} className={BTN_DANGER_FILLED}>{busy ? <Spinner /> : <Trash2 className="h-4 w-4" />}Delete position</button>
                </>}
            />

            {/* New position */}
            <section className={`${CARD} flex flex-wrap items-center gap-x-4 gap-y-3 border border-dashed border-border px-4 py-4 sm:px-6`} aria-label="Add a position">
                <span className="hidden h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-surface-elevated text-primary-dark sm:inline-flex" aria-hidden><FileUp className="h-5 w-5" /></span>
                <div className="min-w-0 flex-1 basis-72">
                    <p className="font-display text-base font-semibold text-text-primary">Open a position</p>
                    <p className="text-sm text-text-secondary">Upload or paste the job description and the AI fills the form: title, department, type, openings, experience, budget, must-haves. You check it, then it is saved as a position anyone can search and run a pipeline for.</p>
                </div>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
                    <input ref={fileRef} type="file" accept=".pdf,.docx,.txt,.md" className="sr-only" aria-label="Upload a job description" onChange={e => { const f = e.target.files?.[0]; if (f) void readJd(f); }} />
                    <button type="button" onClick={() => fileRef.current?.click()} disabled={busy} className={BTN_PRIMARY}>{busy ? <Spinner /> : <FileUp className="h-4 w-4" />}Upload a JD</button>
                    <button type="button" onClick={() => setPasteOpen(o => !o)} disabled={busy} className={BTN_SECONDARY}>Paste a JD</button>
                    <button type="button" onClick={() => setView('library')} disabled={busy} className={BTN_SECONDARY}><BookOpen className="h-4 w-4" />From the JD library</button>
                    <button type="button" onClick={() => { setDraft(null); setJdLink(null); setForm({ open: true, seed: undefined, position: null }); }} disabled={busy} className={BTN_GHOST}><FolderPlus className="h-4 w-4" />Blank form</button>
                </div>
                {pasteOpen && (
                    <div className={`${WELL} basis-full space-y-2 px-3 py-3`}>
                        <label htmlFor="pos-paste" className="block text-[13px] font-semibold text-text-primary">Job description</label>
                        <textarea id="pos-paste" rows={5} value={pasteText} onChange={e => setPasteText(e.target.value)} maxLength={20000} className={`${INPUT} h-auto min-h-[110px] resize-y py-2.5 leading-relaxed`} placeholder="Paste the job description here" />
                        <button type="button" onClick={() => void readJd(pasteText)} disabled={busy || !pasteText.trim()} className={BTN_PRIMARY}>{busy && <Spinner />}Read it into the form</button>
                    </div>
                )}
            </section>

            <div role="group" aria-label="Positions or JD library" className="inline-grid grid-cols-2 gap-x-1 rounded-xl bg-surface-elevated px-1 py-1 ring-1 ring-inset ring-border-subtle">
                {([['positions', 'Positions'], ['library', 'JD library']] as const).map(([id, label]) => (
                    <button key={id} type="button" onClick={() => setView(id)} aria-pressed={view === id}
                        className={`h-9 rounded-lg px-4 text-sm font-semibold transition-colors ${view === id ? 'bg-surface text-text-primary shadow-[var(--w-shadow)]' : 'text-text-secondary hover:text-text-primary'}`}>{label}</button>
                ))}
            </div>

            {view === 'library' ? (
                <JdLibrary orgId={orgId} onUse={(pick: JdPick) => {
                    setView('positions');
                    notify(`Reading ${pick.title} v${pick.version} into the form…`, 'info');
                    void readJd(pick.content, { jdId: pick.jdId, version: pick.version, title: pick.title, content: pick.content });
                }} />
            ) : (
            <section className={`${CARD} overflow-hidden`} aria-label="Positions">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 sm:px-6">
                    <h2 className="font-display text-base font-semibold text-text-primary">Positions</h2>
                    <div role="group" aria-label="Open or closed" className="inline-grid grid-cols-3 gap-x-1 rounded-xl bg-surface-elevated px-1 py-1 ring-1 ring-inset ring-border-subtle">
                        {(['open', 'closed', 'all'] as const).map(id => (
                            <button key={id} type="button" onClick={() => setStatusFilter(id)} aria-pressed={statusFilter === id}
                                className={`h-8 rounded-lg px-3 text-sm font-semibold capitalize transition-colors ${statusFilter === id ? 'bg-surface text-text-primary shadow-[var(--w-shadow)]' : 'text-text-secondary hover:text-text-primary'}`}>{id}</button>
                        ))}
                    </div>
                    <label className="relative flex min-w-[220px] items-center">
                        <span className="sr-only">Find a position</span>
                        <Search className="pointer-events-none absolute left-3 h-4 w-4 text-text-tertiary" aria-hidden />
                        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Title, location, department, hiring manager" className={`${INPUT} h-9 pl-9 text-sm`} />
                    </label>
                    {busy && <Spinner className="h-3.5 w-3.5 text-text-tertiary" />}
                    {/* Owner 2026-11-25: the list at a glance: what is open, what is late, what has nobody on it. */}
                    {positions && positions.length > 0 && (() => {
                        const open = positions.filter(p => p.status === 'open');
                        const late = open.filter(p => p.daysOpen > p.targetDays).length;
                        const unassigned = open.filter(p => !p.recruiterId).length;
                        const closed = positions.length - open.length;
                        return (
                            <p className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-secondary" aria-label="Positions at a glance">
                                {open.length > 0 && <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-success align-middle" aria-hidden />{formatCount(open.length)} open</span>}
                                {late > 0 && <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-warning align-middle" aria-hidden />{formatCount(late)} past target</span>}
                                {unassigned > 0 && <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-error align-middle" aria-hidden />{formatCount(unassigned)} without a recruiter</span>}
                                {closed > 0 && <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-text-tertiary align-middle" aria-hidden />{formatCount(closed)} closed</span>}
                            </p>
                        );
                    })()}
                </div>

                {positions === null ? (
                    <p className="flex items-center gap-x-2 px-4 py-6 text-sm text-text-tertiary sm:px-6"><Spinner className="h-3.5 w-3.5" />Loading</p>
                ) : shown.length === 0 ? (
                    <EmptyState icon={Layers} title={positions.length ? 'No position matches that' : 'No positions yet'}>{positions.length ? 'Try another word.' : 'Upload or paste a job description above to open the first one.'}</EmptyState>
                ) : (
                    <ul className="divide-y divide-border-subtle">
                        {shown.map(p => {
                            const ageing = p.status === 'open' && p.daysOpen > p.targetDays;
                            return (
                                <li key={p.id} className="flex flex-wrap items-center gap-x-5 gap-y-2 px-4 py-3 sm:px-6">
                                    <div className="min-w-0 flex-1 basis-64">
                                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                            <button type="button" onClick={() => onPipeline(p)} className="block max-w-full truncate text-left font-display text-[15px] font-semibold text-text-primary underline-offset-2 hover:underline">{p.title}</button>
                                            {(p.priority === 'high' || p.priority === 'urgent') && <Tag tone="warn">{PRIORITY_LABELS[p.priority]}</Tag>}
                                        </div>
                                        <p className="truncate text-xs text-text-secondary" title={detailLine(p)}>{detailLine(p) || <span className="text-text-tertiary">No details yet · Edit to add them</span>}</p>
                                        {p.summary && <p className="mt-0.5 line-clamp-1 text-xs text-text-tertiary" title={p.summary}>{p.summary}</p>}
                                        {p.jd && (
                                            <p className="mt-0.5 text-xs text-text-tertiary">
                                                <BookOpen className="mr-1 inline h-3 w-3 align-[-2px]" aria-hidden />JD: {p.jd.title} v{p.jd.version}
                                                {p.jd.currentVersion > p.jd.version && <span className="text-amber-800"> · the library now has v{p.jd.currentVersion}</span>}
                                            </p>
                                        )}
                                    </div>
                                    <Tag tone={p.status === 'closed' ? 'neutral' : ageing ? 'warn' : 'success'}>{p.status === 'closed' ? `Closed${p.closedAt ? ` ${formatDate(p.closedAt)}` : ''}` : ageing ? 'Ageing' : 'Open'}</Tag>
                                    <Funnel counts={p.counts} stages={stages} />
                                    <div className="w-36 shrink-0">
                                        <label htmlFor={`pos-recruiter-${p.id}`} className={LABEL}>Recruiter</label>
                                        {recruiters.length || p.recruiterId ? (
                                            <select id={`pos-recruiter-${p.id}`} value={p.recruiterId ?? ''} disabled={assigning === p.id || p.status === 'closed'} onChange={e => void assignRecruiter(p, e.target.value)}
                                                className={`${INPUT} mt-0.5 h-8 px-2 text-sm ${!p.recruiterId && p.status === 'open' ? 'text-amber-800 ring-1 ring-inset ring-warning/60' : ''}`} title={p.recruiterName ?? 'Nobody assigned yet'}>
                                                <option value="">{p.status === 'open' ? 'Assign…' : '—'}</option>
                                                {p.recruiterId && !recruiters.some(r => r.id === p.recruiterId) && <option value={p.recruiterId}>{p.recruiterName ?? 'Someone'}</option>}
                                                {recruiters.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                                            </select>
                                        ) : <p className="truncate text-sm font-medium text-text-primary">{p.recruiterName ?? <span className="font-normal text-text-tertiary">—</span>}</p>}
                                    </div>
                                    <div className="w-28 shrink-0">
                                        <p className={LABEL}>{p.status === 'open' ? 'Days open' : 'Days to fill'}</p>
                                        <p className={`${NUM_SM} ${ageing ? 'text-red-700' : 'text-text-primary'}`}>{p.daysOpen} <span className="text-xs font-normal text-text-tertiary">of {p.targetDays}</span></p>
                                        {/* Owner 2026-11-25: time used against the target, and what is left. */}
                                        {p.status === 'open' && (
                                            <>
                                                <span className="mt-1 block h-1.5 rounded-full bg-muted" aria-hidden>
                                                    <span className={`block h-1.5 rounded-full ${ageing ? 'bg-error' : p.daysOpen >= p.targetDays * 0.8 ? 'bg-warning' : 'bg-primary'}`} style={{ width: `${Math.min(100, (p.daysOpen / Math.max(1, p.targetDays)) * 100)}%` }} />
                                                </span>
                                                <span className={`mt-0.5 block text-[11px] ${ageing ? 'font-semibold text-red-700' : 'text-text-tertiary'}`}>{ageing ? `${p.daysOpen - p.targetDays} days late` : `${p.targetDays - p.daysOpen} days to go`}</span>
                                            </>
                                        )}
                                    </div>
                                    <div className="w-20 shrink-0">
                                        <p className={LABEL}>In pipeline</p>
                                        <p className={`${NUM_SM} text-text-primary`}>{formatCount(inPipeline(p))}</p>
                                    </div>
                                    <div className="flex shrink-0 items-center gap-x-1">
                                        <button type="button" onClick={() => void edit(p)} disabled={busy} className={BTN_GHOST} title="Edit the position"><PencilLine className="h-4 w-4" />Edit</button>
                                        <button type="button" onClick={() => onSearch(p)} className={BTN_SECONDARY}><Search className="h-4 w-4" />Search</button>
                                        <button type="button" onClick={() => onPipeline(p)} className={BTN_GHOST}><Layers className="h-4 w-4" />Pipeline</button>
                                        {p.status === 'open'
                                            ? <button type="button" onClick={() => void setStatus(p, 'closed')} disabled={busy} className={BTN_GHOST}>Close</button>
                                            : <button type="button" onClick={() => void setStatus(p, 'open')} disabled={busy} className={BTN_GHOST}>Reopen</button>}
                                        <button type="button" onClick={() => setDeleting(p)} disabled={busy} className={`${BTN_DANGER_GHOST} px-2`} aria-label={`Delete ${p.title}`} title="Delete the position"><Trash2 className="h-4 w-4" /></button>
                                    </div>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </section>
            )}
        </div>
    );
}
