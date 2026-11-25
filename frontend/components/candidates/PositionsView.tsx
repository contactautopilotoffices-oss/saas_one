'use client';

import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, BookOpen, Briefcase, Building2, CalendarDays, ChevronDown, ChevronRight, CircleDot, ClipboardPaste, FileUp, Info, Layers, MapPin, MoreHorizontal, PencilLine, Plus, RotateCcw, Search, Trash2, Users, XCircle } from 'lucide-react';
import type { Preferences } from '@/backend/lib/candidates/query-spec';
import { boardColumns, type StageDef } from '@/backend/lib/candidates/stage-list';
import { EMPLOYMENT_TYPE_LABELS, PRIORITY_LABELS, type Position, type PositionReadResponse } from '@/backend/lib/candidates/types';
import { api, qs } from './api';
import { formatCount, formatDate, formatInr } from './format';
import JdLibrary, { type JdPick } from './JdLibrary';
import PositionForm, { type PositionJdLink, type PositionSeed } from './PositionForm';
import { BTN_DANGER_FILLED } from './Remarks';
import { useStages } from './stage-ui';
import { BTN_PRIMARY, BTN_SECONDARY, CARD, CARD_HOVER, Dialog, EmptyState, INPUT, OVERLAY, Spinner, Tag, useUi } from './ui';

/*
 * Positions (owner 2026-11-15; 2026-11-16 a job record, not only a saved search). A new one starts from a JD file
 * or pasted text (read into the Create position form by the two readers), or from an empty form. Each card shows the
 * job's details, its pipeline as a small segmented bar, days open against the target, and leads to Edit, Search (the
 * position's filters loaded) or its Pipeline.
 * Owner 2026-11-25 (to the reference "Jobs Opening" screen): a page header on the grey page with the counts as coloured
 * dots, the JD ways in as a white button group beside a teal "Create job"; a toolbar of search and pill filters
 * (status from the server, location and department over the loaded jobs); a grid of white 12px cards (3 wide, 2 on
 * tablets, 1 on phones) with a status pill, a department chip, a two-number box, the target row and bar, the recruiter
 * and "View pipeline" in the footer, and a 3px status edge.
 * Spacing: two-axis utilities only (px-4, gap-x-2): app/globals.css redefines p-* and gap-* on an 8px scale.
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

/** Visible focus everywhere on this screen: a primary outline (owner 2026-11-25). */
const FOCUS = 'outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';
const ICON_BTN = `inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-surface text-text-secondary transition-colors hover:bg-muted hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS}`;
/** The joined white buttons beside "Create job" (the reference's "Import" button). */
const GROUP_BTN = `inline-flex h-10 items-center gap-x-2 bg-surface px-3.5 text-sm font-semibold text-text-primary transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS} focus-visible:z-10`;

/** Segment shades for the pipeline bar, earliest round first; the last round (hired) is always green. */
const FUNNEL_SHADES = ['bg-primary/25', 'bg-primary/40', 'bg-primary/55', 'bg-primary/70', 'bg-primary/85', 'bg-primary'];

/** People per round as one thin segmented bar (owner 2026-11-19: one per board column; rejected people are not counted). */
function Funnel({ counts, stages }: { counts: Position['counts']; stages: StageDef[] }) {
    const columns = boardColumns(stages).map(c => ({ name: c.name, n: c.stages.filter(s => s.kind !== 'rejected').reduce((t, s) => t + (counts[s.key] ?? 0), 0) }));
    const total = columns.reduce((t, c) => t + c.n, 0);
    const label = `Pipeline by round: ${columns.map(c => `${c.name} ${c.n}`).join(', ')}`;
    return (
        <div className="mt-3 border-t border-border-subtle pt-2.5">
            <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-muted" role="img" aria-label={label} title={label}>
                {total > 0 && columns.map((c, i) => c.n > 0 && (
                    <span key={c.name} title={`${c.name}: ${c.n}`} style={{ width: `${(c.n / total) * 100}%` }}
                        className={`block h-full ${i > 0 ? 'border-l border-surface' : ''} ${i === columns.length - 1 ? 'bg-emerald-500 dark:bg-emerald-400' : FUNNEL_SHADES[Math.min(i, FUNNEL_SHADES.length - 1)]}`} />
                ))}
            </div>
            <p className="mt-1.5 flex flex-wrap gap-x-2.5 gap-y-0.5 text-[11px] text-text-tertiary" aria-hidden>
                {columns.map(c => <span key={c.name} className="whitespace-nowrap">{c.name} <span className="font-semibold tabular-nums text-text-secondary">{c.n}</span></span>)}
            </p>
        </div>
    );
}

/** The rest of the job's details, in a small line under the card's meta line: budget, hiring manager, must-haves. */
function extraLine(p: Position): string {
    const must = p.filters.keywords?.filter(k => k.required).length ?? 0;
    const budget = p.budgetMaxInhand !== null ? `up to ${formatInr(p.budgetMaxInhand)}/month` : null;
    return [
        budget,
        p.hiringManager ? `HM ${p.hiringManager}` : null,
        must ? `${must} must-have${must === 1 ? '' : 's'}` : null,
    ].filter(Boolean).join(' · ');
}

/** A department keeps the same small colour square everywhere (a stable pick from its name). */
const DEPT_SQUARES = ['bg-sky-500', 'bg-violet-500', 'bg-amber-500', 'bg-rose-500', 'bg-indigo-500', 'bg-teal-500', 'bg-orange-500', 'bg-fuchsia-500'];
function deptSquare(name: string): string {
    let h = 0;
    for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
    return DEPT_SQUARES[h % DEPT_SQUARES.length];
}

/** Status look per card: the pill, its dot, and the 3px edge. Hardcoded hues carry a dark: pair. */
const STATUS_LOOK = {
    open: { pill: 'bg-emerald-50 text-emerald-800 ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-500/30', dot: 'bg-emerald-500', edge: 'bg-emerald-500 dark:bg-emerald-400' },
    ageing: { pill: 'bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-500/30', dot: 'bg-amber-500', edge: 'bg-amber-500 dark:bg-amber-400' },
    closed: { pill: 'bg-muted text-text-secondary ring-border', dot: 'bg-gray-400 dark:bg-gray-500', edge: 'bg-gray-300 dark:bg-gray-600' },
} as const;

/** A white bordered pill holding a native select, with a leading icon and a caret (the reference's filter pills). */
function FilterPill<T extends string>({ icon: Icon, label, value, options, onChange }: {
    icon: React.ComponentType<{ className?: string }>; label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void;
}) {
    return (
        <label className="relative inline-flex h-9 items-center rounded-lg border border-border bg-surface text-sm font-medium text-text-primary transition-colors hover:bg-muted focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-primary">
            <span className="sr-only">{label}</span>
            <Icon className="pointer-events-none absolute left-3 h-4 w-4 text-text-tertiary" aria-hidden />
            <select value={value} onChange={e => onChange(e.target.value as T)} className="h-full cursor-pointer appearance-none rounded-lg bg-transparent pl-9 pr-8 text-sm font-medium text-text-primary outline-none">
                {options.map(o => <option key={o.value} value={o.value} className="bg-surface text-text-primary">{o.label}</option>)}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2.5 h-4 w-4 text-text-tertiary" aria-hidden />
        </label>
    );
}

const STATUS_FILTERS: { value: 'open' | 'closed' | 'all'; label: string }[] = [
    { value: 'open', label: 'Open' },
    { value: 'closed', label: 'Closed' },
    { value: 'all', label: 'All status' },
];
const ALL = '__all__';

/**
 * The card's "…" menu: Search, Pipeline, Close or Reopen, Delete. Escape or a click elsewhere closes it and focus goes
 * back to the button (the same pattern as the Pipeline board's card menu).
 */
function PositionMenu({ p, busy, onSearch, onPipeline, onToggle, onDelete }: {
    p: Position; busy: boolean; onSearch: () => void; onPipeline: () => void; onToggle: () => void; onDelete: () => void;
}) {
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
    const item = `flex w-full items-center gap-x-2 rounded-lg px-2.5 py-1.5 text-left text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS} focus-visible:outline-offset-0`;
    const run = (fn: () => void) => () => { setOpen(false); fn(); };
    return (
        <div ref={wrap} className="relative shrink-0">
            <button ref={trigger} type="button" onClick={() => setOpen(o => !o)} aria-haspopup="menu" aria-expanded={open} aria-label={`More actions for ${p.title}`} title="More actions" className={ICON_BTN}>
                <MoreHorizontal className="h-4 w-4" aria-hidden />
            </button>
            {open && (
                <div role="menu" aria-label={`Actions for ${p.title}`} className={`${OVERLAY} absolute right-0 top-full z-20 mt-1 w-52 rounded-xl px-1 py-1`}>
                    <button ref={firstItem} type="button" role="menuitem" onClick={run(onSearch)} className={`${item} text-text-primary hover:bg-muted`}>
                        <Search className="h-4 w-4 shrink-0 text-text-secondary" aria-hidden />Search with its filters
                    </button>
                    <button type="button" role="menuitem" onClick={run(onPipeline)} className={`${item} text-text-primary hover:bg-muted`}>
                        <Layers className="h-4 w-4 shrink-0 text-text-secondary" aria-hidden />Open the pipeline
                    </button>
                    <button type="button" role="menuitem" disabled={busy} onClick={run(onToggle)} className={`${item} text-text-primary hover:bg-muted`}>
                        {p.status === 'open'
                            ? <><XCircle className="h-4 w-4 shrink-0 text-text-secondary" aria-hidden />Close the position</>
                            : <><RotateCcw className="h-4 w-4 shrink-0 text-text-secondary" aria-hidden />Reopen the position</>}
                    </button>
                    <div className="my-1 border-t border-border-subtle" role="separator" />
                    <button type="button" role="menuitem" disabled={busy} onClick={run(onDelete)} className={`${item} text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10`}>
                        <Trash2 className="h-4 w-4 shrink-0" aria-hidden />Delete…
                    </button>
                </div>
            )}
        </div>
    );
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
    // Owner 2026-11-25: location and department filters, over the positions already loaded (no server round trip).
    const [locFilter, setLocFilter] = useState<string>(ALL);
    const [deptFilter, setDeptFilter] = useState<string>(ALL);
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
    const openBlank = () => { setDraft(null); setJdLink(null); setForm({ open: true, seed: undefined, position: null }); };

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

    const all = positions ?? [];
    const uniq = (xs: (string | null)[]) => [...new Set(xs.filter((x): x is string => !!x && !!x.trim()))].sort((a, b) => a.localeCompare(b));
    const locations = uniq(all.map(p => p.location));
    const departments = uniq(all.map(p => p.department));
    // A location or department that left the loaded list stops filtering (the pill falls back to "All").
    const locOn = locFilter !== ALL && locations.includes(locFilter) ? locFilter : ALL;
    const deptOn = deptFilter !== ALL && departments.includes(deptFilter) ? deptFilter : ALL;
    const needle = q.trim().toLowerCase();
    const shown = all.filter(p =>
        (!needle || [p.title, p.location, p.department, p.hiringManager].filter(Boolean).join(' ').toLowerCase().includes(needle))
        && (locOn === ALL || p.location === locOn)
        && (deptOn === ALL || p.department === deptOn));
    const filtered = !!needle || locOn !== ALL || deptOn !== ALL;
    const inPipeline = (p: Position) => Object.values(p.counts).reduce((n, c) => n + c, 0);

    // The list at a glance (owner 2026-11-25): what is open, what is late, what has nobody on it, what is closed.
    const openOnes = all.filter(p => p.status === 'open');
    const glance = [
        { label: 'Open', n: openOnes.length, dot: 'bg-emerald-500' },
        { label: 'Past target', n: openOnes.filter(p => p.daysOpen > p.targetDays).length, dot: 'bg-amber-500' },
        { label: 'Without a recruiter', n: openOnes.filter(p => !p.recruiterId).length, dot: 'bg-red-500' },
        { label: 'Closed', n: all.length - openOnes.length, dot: 'bg-gray-400 dark:bg-gray-500' },
    ];

    return (
        <div className="space-y-5">
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

            {/* Page header: title and the counts as dots on the left; the JD ways in and "Create job" on the right. */}
            <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3" aria-labelledby="pos-heading">
                <div className="min-w-0">
                    <h2 id="pos-heading" className="text-xl font-semibold tracking-[-0.2px] text-text-primary">{view === 'library' ? 'JD library' : 'Jobs'}</h2>
                    {view === 'library' ? (
                        <button type="button" onClick={() => setView('positions')} className={`mt-1 inline-flex items-center gap-x-1 rounded text-sm font-semibold text-primary hover:underline ${FOCUS}`}>
                            <ArrowLeft className="h-4 w-4" aria-hidden />Back to jobs
                        </button>
                    ) : all.length > 0 ? (
                        <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-text-secondary" aria-label="Jobs at a glance">
                            {glance.map(g => (
                                <span key={g.label} className="inline-flex items-center gap-x-1.5">
                                    <span className={`h-2 w-2 rounded-full ${g.dot}`} aria-hidden />
                                    {g.label} <span className="font-semibold tabular-nums text-text-primary">{formatCount(g.n)}</span>
                                </span>
                            ))}
                        </p>
                    ) : (
                        <p className="mt-1 max-w-xl text-sm text-text-secondary">Upload or paste a job description and the AI fills the form: title, department, type, openings, experience, budget, must-haves. You check it, then it is saved.</p>
                    )}
                </div>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
                    <input ref={fileRef} type="file" accept=".pdf,.docx,.txt,.md" className="sr-only" tabIndex={-1} aria-label="Upload a job description" onChange={e => { const f = e.target.files?.[0]; if (f) void readJd(f); }} />
                    <div role="group" aria-label="Start from a job description" className="inline-flex divide-x divide-border overflow-hidden rounded-lg border border-border bg-surface">
                        <button type="button" onClick={() => fileRef.current?.click()} disabled={busy} className={GROUP_BTN}>{busy ? <Spinner /> : <FileUp className="h-4 w-4 text-text-secondary" aria-hidden />}Upload JD</button>
                        <button type="button" onClick={() => setPasteOpen(o => !o)} disabled={busy} aria-expanded={pasteOpen} aria-controls="pos-paste-panel" className={`${GROUP_BTN} ${pasteOpen ? 'bg-muted' : ''}`}><ClipboardPaste className="h-4 w-4 text-text-secondary" aria-hidden />Paste JD</button>
                        <button type="button" onClick={() => setView(v => (v === 'library' ? 'positions' : 'library'))} disabled={busy} aria-pressed={view === 'library'} className={`${GROUP_BTN} ${view === 'library' ? 'bg-muted' : ''}`}><BookOpen className="h-4 w-4 text-text-secondary" aria-hidden />JD library</button>
                    </div>
                    <button type="button" onClick={openBlank} disabled={busy} className={`${BTN_PRIMARY} rounded-lg font-semibold ${FOCUS}`}><Plus className="h-4 w-4" aria-hidden />Create job</button>
                </div>
            </header>

            {pasteOpen && (
                <section id="pos-paste-panel" aria-label="Paste a job description" className="space-y-2 rounded-xl border border-border bg-surface px-4 py-4">
                    <label htmlFor="pos-paste" className="block text-sm font-semibold text-text-primary">Job description</label>
                    <textarea id="pos-paste" rows={5} value={pasteText} onChange={e => setPasteText(e.target.value)} maxLength={20000} className={`${INPUT} h-auto min-h-[110px] resize-y py-2.5 leading-relaxed`} placeholder="Paste the job description here" />
                    <div className="flex items-center gap-x-2">
                        <button type="button" onClick={() => void readJd(pasteText)} disabled={busy || !pasteText.trim()} className={`${BTN_PRIMARY} rounded-lg font-semibold ${FOCUS}`}>{busy && <Spinner />}Read it into the form</button>
                        <button type="button" onClick={() => setPasteOpen(false)} className={`${BTN_SECONDARY} rounded-lg font-semibold ${FOCUS}`}>Cancel</button>
                    </div>
                </section>
            )}

            {/* Toolbar: search, then the pill filters. */}
            {view === 'positions' && (
                <div className="flex flex-wrap items-center gap-x-2 gap-y-2" role="search" aria-label="Find jobs">
                    <label className="relative flex w-full items-center sm:w-60">
                        <span className="sr-only">Search jobs</span>
                        <Search className="pointer-events-none absolute left-3 h-4 w-4 text-text-tertiary" aria-hidden />
                        <input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Search jobs"
                            className={`h-9 w-full rounded-lg border border-border bg-surface pl-9 pr-3 text-sm text-text-primary placeholder:text-text-tertiary ${FOCUS}`} />
                    </label>
                    <FilterPill icon={CircleDot} label="Status" value={statusFilter} options={STATUS_FILTERS} onChange={setStatusFilter} />
                    {locations.length > 0 && (
                        <FilterPill icon={MapPin} label="Location" value={locOn} onChange={setLocFilter}
                            options={[{ value: ALL, label: 'All locations' }, ...locations.map(l => ({ value: l, label: l }))]} />
                    )}
                    {departments.length > 0 && (
                        <FilterPill icon={Building2} label="Department" value={deptOn} onChange={setDeptFilter}
                            options={[{ value: ALL, label: 'All departments' }, ...departments.map(d => ({ value: d, label: d }))]} />
                    )}
                    {filtered && (
                        <button type="button" onClick={() => { setQ(''); setLocFilter(ALL); setDeptFilter(ALL); }} className={`h-9 rounded-lg px-2.5 text-sm font-semibold text-primary hover:bg-muted ${FOCUS}`}>Clear</button>
                    )}
                    {busy && <Spinner className="h-3.5 w-3.5 text-text-tertiary" />}
                </div>
            )}

            {view === 'library' ? (
                <JdLibrary orgId={orgId} onUse={(pick: JdPick) => {
                    setView('positions');
                    notify(`Reading ${pick.title} v${pick.version} into the form…`, 'info');
                    void readJd(pick.content, { jdId: pick.jdId, version: pick.version, title: pick.title, content: pick.content });
                }} />
            ) : positions === null ? (
                <p className="flex items-center gap-x-2 px-1 py-6 text-sm text-text-tertiary"><Spinner className="h-3.5 w-3.5" />Loading</p>
            ) : shown.length === 0 ? (
                <section className={CARD} aria-label="Jobs">
                    <EmptyState icon={Layers} title={positions.length ? 'No job matches that' : 'No jobs yet'}>{positions.length ? 'Try another word or filter.' : 'Upload or paste a job description, or Create job, to open the first one.'}</EmptyState>
                </section>
            ) : (
                <ul className="grid grid-cols-1 gap-x-4 gap-y-4 md:grid-cols-2 xl:grid-cols-3" aria-label="Jobs">
                    {shown.map(p => {
                        const ageing = p.status === 'open' && p.daysOpen > p.targetDays;
                        const look = STATUS_LOOK[p.status === 'closed' ? 'closed' : ageing ? 'ageing' : 'open'];
                        const near = p.status === 'open' && !ageing && p.daysOpen >= p.targetDays * 0.8;
                        const extra = extraLine(p);
                        const meta: { icon: typeof Briefcase; text: string }[] = [];
                        if (p.employmentType) meta.push({ icon: Briefcase, text: EMPLOYMENT_TYPE_LABELS[p.employmentType] });
                        if (p.location) meta.push({ icon: MapPin, text: p.location });
                        meta.push({ icon: Users, text: `${p.openings} opening${p.openings === 1 ? '' : 's'}` });
                        const bare = !p.department && !p.location && !p.employmentType && !extra;
                        return (
                            <li key={p.id} className={`relative flex flex-col rounded-xl bg-surface shadow-[var(--w-shadow)] ${CARD_HOVER}`}>
                                <div className="flex flex-1 flex-col px-5 pb-4 pt-4">
                                    {/* Status pill (a real select: Open or Closed), department chip, priority; edit and "…" on the right. */}
                                    <div className="flex items-start justify-between gap-x-2">
                                        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5">
                                            <label className={`relative inline-flex h-6 items-center rounded-full ring-1 ring-inset ${look.pill} focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-primary`}
                                                title={p.status === 'closed' && p.closedAt ? `Closed ${formatDate(p.closedAt)}` : ageing ? `Past its ${p.targetDays}-day target` : undefined}>
                                                <span className="sr-only">Status of {p.title}</span>
                                                <span className={`pointer-events-none absolute left-2 h-1.5 w-1.5 rounded-full ${look.dot}`} aria-hidden />
                                                <select value={p.status} disabled={busy} onChange={e => void setStatus(p, e.target.value as 'open' | 'closed')}
                                                    className="h-full cursor-pointer appearance-none rounded-full bg-transparent pl-[18px] pr-6 text-xs font-semibold text-inherit outline-none disabled:cursor-not-allowed">
                                                    <option value="open" className="bg-surface text-text-primary">{ageing ? 'Ageing' : 'Open'}</option>
                                                    <option value="closed" className="bg-surface text-text-primary">Closed</option>
                                                </select>
                                                <ChevronDown className="pointer-events-none absolute right-1.5 h-3.5 w-3.5 opacity-70" aria-hidden />
                                            </label>
                                            {p.department && (
                                                <span className="inline-flex h-6 min-w-0 max-w-[11rem] items-center gap-x-1.5 rounded-md border border-border bg-surface px-2 text-xs font-medium text-text-secondary" title={`Department: ${p.department}`}>
                                                    <span className={`h-2 w-2 shrink-0 rounded-[2px] ${deptSquare(p.department)}`} aria-hidden />
                                                    <Building2 className="h-3.5 w-3.5 shrink-0 text-text-tertiary" aria-hidden />
                                                    <span className="truncate">{p.department}</span>
                                                </span>
                                            )}
                                            {(p.priority === 'high' || p.priority === 'urgent') && <Tag tone="warn">{PRIORITY_LABELS[p.priority]}</Tag>}
                                        </div>
                                        <div className="flex shrink-0 items-center gap-x-1.5">
                                            <button type="button" onClick={() => void edit(p)} disabled={busy} aria-label={`Edit ${p.title}`} title="Edit the job" className={ICON_BTN}>
                                                <PencilLine className="h-4 w-4" aria-hidden />
                                            </button>
                                            <PositionMenu p={p} busy={busy} onSearch={() => onSearch(p)} onPipeline={() => onPipeline(p)}
                                                onToggle={() => void setStatus(p, p.status === 'open' ? 'closed' : 'open')} onDelete={() => setDeleting(p)} />
                                        </div>
                                    </div>

                                    {/* Title (opens the pipeline), meta line, the rest of the details, summary, JD. */}
                                    <div className="mt-3 min-w-0">
                                        <h3 className="min-w-0">
                                            <button type="button" onClick={() => onPipeline(p)} title={p.title}
                                                className={`block max-w-full truncate rounded text-left text-base font-bold text-text-primary underline-offset-2 hover:underline ${FOCUS}`}>{p.title}</button>
                                        </h3>
                                        <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-text-secondary">
                                            {meta.map(m => (
                                                <span key={m.text} className="inline-flex min-w-0 items-center gap-x-1">
                                                    <m.icon className="h-3.5 w-3.5 shrink-0 text-text-tertiary" aria-hidden /><span className="truncate">{m.text}</span>
                                                </span>
                                            ))}
                                        </p>
                                        {extra && <p className="mt-1 truncate text-xs text-text-tertiary" title={extra}>{extra}</p>}
                                        {bare && (
                                            <p className="mt-1 text-xs text-text-tertiary">No details yet · <button type="button" onClick={() => void edit(p)} disabled={busy} className={`rounded font-semibold text-primary underline-offset-2 hover:underline ${FOCUS}`}>Edit to add them</button></p>
                                        )}
                                        {p.summary && <p className="mt-1 line-clamp-2 text-xs text-text-tertiary" title={p.summary}>{p.summary}</p>}
                                        {p.jd && (
                                            <p className="mt-1 text-xs text-text-tertiary">
                                                <BookOpen className="mr-1 inline h-3 w-3 align-[-2px]" aria-hidden />JD: {p.jd.title} v{p.jd.version}
                                                {p.jd.currentVersion > p.jd.version && <span className="text-amber-800 dark:text-amber-300"> · the library now has v{p.jd.currentVersion}</span>}
                                            </p>
                                        )}
                                    </div>

                                    {/* The two numbers side by side, then the pipeline by round as a thin segmented bar. */}
                                    <div className="mt-auto pt-4">
                                        <div className="rounded-lg bg-surface-elevated px-4 py-3">
                                            <div className="grid grid-cols-2 divide-x divide-border">
                                                <div className="pr-4">
                                                    <p className="text-2xl font-semibold leading-tight tabular-nums text-text-primary">{formatCount(inPipeline(p))}</p>
                                                    <p className="mt-0.5 text-xs text-text-tertiary">Candidates in pipeline</p>
                                                </div>
                                                <div className="pl-4">
                                                    <p className="text-2xl font-semibold leading-tight tabular-nums text-text-primary">{p.interviewsDone === undefined ? <span className="text-text-tertiary">—</span> : formatCount(p.interviewsDone)}</p>
                                                    <p className="mt-0.5 flex items-center gap-x-1 text-xs text-text-tertiary">
                                                        Completed interviews
                                                        <span className="group relative inline-flex">
                                                            <button type="button" className={`inline-flex rounded-full text-text-tertiary hover:text-text-primary ${FOCUS}`}
                                                                aria-label={p.interviewsDone === undefined ? 'About this number: counted once the hiring-flow database update is applied' : 'About this number: interviews marked done for this job, across every round'}>
                                                                <Info className="h-3.5 w-3.5" aria-hidden />
                                                            </button>
                                                            <span role="tooltip" className={`${OVERLAY} pointer-events-none invisible absolute bottom-full right-0 z-20 mb-1.5 w-52 rounded-lg px-2.5 py-2 text-xs font-normal text-text-secondary opacity-0 transition-opacity group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100`}>
                                                                {p.interviewsDone === undefined ? 'Counted once the hiring-flow database update is applied.' : 'Interviews marked done for this job, across every round.'}
                                                            </span>
                                                        </span>
                                                    </p>
                                                </div>
                                            </div>
                                            {stages.length > 0 && <Funnel counts={p.counts} stages={stages} />}
                                        </div>
                                    </div>

                                    {/* Opened, target, and time used against it. */}
                                    <div className="mt-4">
                                        <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1 text-[13px]">
                                            <span className="inline-flex items-center gap-x-1.5 text-text-secondary">
                                                <CalendarDays className="h-3.5 w-3.5 shrink-0 text-text-tertiary" aria-hidden />Opened {formatDate(p.createdAt)} · Target {p.targetDays} days
                                            </span>
                                            {p.status === 'open'
                                                ? ageing
                                                    ? <span className="text-red-700 dark:text-red-400"><span className="font-bold tabular-nums">{p.daysOpen - p.targetDays}</span> days late</span>
                                                    : <span className={near ? 'text-amber-800 dark:text-amber-300' : 'text-text-secondary'}><span className={`font-bold tabular-nums ${near ? '' : 'text-text-primary'}`}>{p.targetDays - p.daysOpen}</span> Days to go</span>
                                                : <span className="text-text-secondary"><span className="font-bold tabular-nums text-text-primary">{p.daysOpen}</span> days to fill</span>}
                                        </div>
                                        {/* Owner 2026-11-25: time used against the target: green on time, amber near it, red late. */}
                                        <span className="mt-2 block h-1.5 overflow-hidden rounded-full bg-muted" role="img" aria-label={`${p.daysOpen} of ${p.targetDays} days used`}>
                                            <span className={`block h-full rounded-full ${p.status === 'closed' ? 'bg-gray-400 dark:bg-gray-500' : ageing ? 'bg-red-500' : near ? 'bg-amber-500' : 'bg-emerald-500'}`}
                                                style={{ width: `${Math.min(100, (p.daysOpen / Math.max(1, p.targetDays)) * 100)}%` }} />
                                        </span>
                                    </div>
                                </div>

                                {/* Footer: the recruiter, and the way into the pipeline. */}
                                <div className="flex items-center justify-between gap-x-3 border-t border-border px-5 pb-4 pt-3">
                                    <div className="flex min-w-0 flex-1 items-center gap-x-1.5 text-[13px]">
                                        <label htmlFor={`pos-recruiter-${p.id}`} className="shrink-0 text-text-tertiary">Recruiter:</label>
                                        {recruiters.length || p.recruiterId ? (
                                            <span className="relative inline-flex min-w-0 max-w-[11rem] items-center">
                                                <select id={`pos-recruiter-${p.id}`} value={p.recruiterId ?? ''} disabled={assigning === p.id || p.status === 'closed'} onChange={e => void assignRecruiter(p, e.target.value)}
                                                    title={p.recruiterName ?? 'Nobody assigned yet'}
                                                    className={`h-7 min-w-0 max-w-full cursor-pointer appearance-none truncate rounded-md border bg-surface pl-2 pr-6 text-[13px] font-semibold disabled:cursor-not-allowed disabled:opacity-70 ${FOCUS} ${!p.recruiterId && p.status === 'open' ? 'border-amber-300 text-amber-800 dark:border-amber-500/40 dark:text-amber-300' : 'border-transparent text-text-primary hover:border-border'}`}>
                                                    <option value="" className="bg-surface text-text-primary">{p.status === 'open' ? 'Assign…' : '—'}</option>
                                                    {p.recruiterId && !recruiters.some(r => r.id === p.recruiterId) && <option value={p.recruiterId} className="bg-surface text-text-primary">{p.recruiterName ?? 'Someone'}</option>}
                                                    {recruiters.map(r => <option key={r.id} value={r.id} className="bg-surface text-text-primary">{r.name}</option>)}
                                                </select>
                                                {assigning === p.id
                                                    ? <Spinner className="pointer-events-none absolute right-1.5 h-3.5 w-3.5 text-text-tertiary" />
                                                    : <ChevronDown className="pointer-events-none absolute right-1.5 h-3.5 w-3.5 text-text-tertiary" aria-hidden />}
                                            </span>
                                        ) : <span className="truncate font-semibold text-text-primary">{p.recruiterName ?? <span className="font-normal text-text-tertiary">—</span>}</span>}
                                    </div>
                                    <button type="button" onClick={() => onPipeline(p)} aria-label={`View the pipeline for ${p.title}`}
                                        className={`inline-flex shrink-0 items-center gap-x-0.5 rounded text-[13px] font-semibold text-primary hover:text-primary-dark hover:underline underline-offset-2 ${FOCUS}`}>
                                        View pipeline<ChevronRight className="h-4 w-4" aria-hidden />
                                    </button>
                                </div>
                                {/* The 3px status edge: green open, amber ageing, grey closed. */}
                                <span className={`pointer-events-none absolute inset-x-0 bottom-0 h-[3px] rounded-b-xl ${look.edge}`} aria-hidden />
                            </li>
                        );
                    })}
                </ul>
            )}
        </div>
    );
}
