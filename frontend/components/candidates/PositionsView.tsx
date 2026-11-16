'use client';

import React, { useEffect, useRef, useState } from 'react';
import { FileUp, FolderPlus, Layers, Search } from 'lucide-react';
import type { SearchFilters, UnderstandResponse } from '@/backend/lib/candidates/filters';
import type { Preferences } from '@/backend/lib/candidates/query-spec';
import { FLOW_STAGES, STAGE_LABELS, type Position, type Stage } from '@/backend/lib/candidates/types';
import { api, qs } from './api';
import { formatCount, formatDate } from './format';
import { PositionDialog } from './PipelineView';
import { BTN_GHOST, BTN_PRIMARY, BTN_SECONDARY, CARD, EmptyState, INPUT, LABEL, NUM_SM, Spinner, Tag, useUi, WELL } from './ui';

/*
 * Positions (owner 2026-11-15): the saved job descriptions. A new one starts from a JD file or pasted text (read
 * into filters by the same reader Search uses), or from a bare title. Each row shows its pipeline as a small funnel,
 * days open against the target, and leads to Search (the JD's filters loaded) or to its Pipeline.
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

function Funnel({ counts }: { counts: Position['counts'] }) {
    const max = Math.max(1, ...FLOW_STAGES.map(s => counts[s]));
    const short: Record<Stage, string> = { sourced: 'Src', screening: 'Scr', shortlisted: 'Short', interview: 'Int', offer: 'Offer', joined: 'Join', on_hold: '', not_responding: '', rejected: '', others: '' };
    return (
        <div className="flex h-10 items-end gap-x-1" aria-label={FLOW_STAGES.map(s => `${STAGE_LABELS[s]} ${counts[s]}`).join(', ')}>
            {FLOW_STAGES.map(s => (
                <span key={s} className="flex w-9 flex-col items-center gap-y-0.5 text-[10px] text-text-tertiary">
                    <span className={`${NUM_SM} text-xs text-text-primary`}>{counts[s]}</span>
                    <span className={`block w-full rounded-t-sm ${s === 'joined' ? 'bg-success' : 'bg-primary/40'}`} style={{ height: `${Math.max(2, Math.round((counts[s] / max) * 18))}px` }} aria-hidden />
                    {short[s]}
                </span>
            ))}
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
    const [positions, setPositions] = useState<Position[] | null>(null);
    const [statusFilter, setStatusFilter] = useState<'open' | 'closed' | 'all'>('open');
    const [q, setQ] = useState('');
    const [nonce, setNonce] = useState(0);
    const [busy, setBusy] = useState(false);
    const [newOpen, setNewOpen] = useState(false);
    const [seed, setSeed] = useState<{ title?: string; location?: string; jdText?: string; jdFileName?: string; filters?: SearchFilters; prefer?: Preferences } | undefined>(undefined);
    const [pasteOpen, setPasteOpen] = useState(false);
    const [pasteText, setPasteText] = useState('');
    const fileRef = useRef<HTMLInputElement | null>(null);

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

    /** A JD (file or text) is read into filters by the Search reader, then the position dialog opens with them. */
    const readJd = async (job: string | File) => {
        setBusy(true);
        let res;
        if (typeof job === 'string') res = await api<UnderstandResponse>('/api/candidates/understand', { json: { orgId, text: job } });
        else { const form = new FormData(); form.set('orgId', orgId); form.set('file', job, job.name); res = await api<UnderstandResponse>('/api/candidates/understand', { form }); }
        setBusy(false);
        if (fileRef.current) fileRef.current.value = '';
        if (!res.ok) { notify(res.error, 'error'); if (res.noAccess) reportError(res); return; }
        if (!res.data.aiParsed) { notify(res.data.notices[0] ?? 'Nothing could be read from that.', 'error'); return; }
        const fileName = res.data.fileName ?? '';
        const title = fileName ? fileName.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ') : (res.data.filters.keywords?.[0]?.text ?? '');
        setSeed({ title, location: res.data.filters.locations?.[0] ?? '', jdText: res.data.summary, jdFileName: fileName || undefined, filters: res.data.filters as SearchFilters, prefer: res.data.prefer });
        setPasteOpen(false);
        setPasteText('');
        setNewOpen(true);
        if (res.data.conflicts?.length) notify('The JD gives two values for the same thing: open the position in Search to pick one.', 'info');
    };
    const setStatus = async (position: Position, status: 'open' | 'closed') => {
        setBusy(true);
        const res = await api<{ position: Position }>(`/api/candidates/positions/${encodeURIComponent(position.id)}`, { method: 'PATCH', json: { orgId, status } });
        setBusy(false);
        if (!res.ok) { notify(res.error, 'error'); if (res.noAccess) reportError(res); return; }
        refresh();
    };

    const shown = (positions ?? []).filter(p => !q.trim() || [p.title, p.location, p.department].filter(Boolean).join(' ').toLowerCase().includes(q.trim().toLowerCase()));
    const inPipeline = (p: Position) => Object.values(p.counts).reduce((n, c) => n + c, 0);

    return (
        <div className="space-y-4">
            <PositionDialog open={newOpen} orgId={orgId} seed={seed} onClose={() => setNewOpen(false)} onSaved={() => { setNewOpen(false); setSeed(undefined); refresh(); }} />

            {/* New position from a job description */}
            <section className={`${CARD} flex flex-wrap items-center gap-x-4 gap-y-3 border border-dashed border-border px-4 py-4 sm:px-6`} aria-label="Add a position">
                <span className="hidden h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-surface-elevated text-primary-dark sm:inline-flex" aria-hidden><FileUp className="h-5 w-5" /></span>
                <div className="min-w-0 flex-1 basis-72">
                    <p className="font-display text-base font-semibold text-text-primary">Add a position from a job description</p>
                    <p className="text-sm text-text-secondary">Upload a PDF, Word or text file, or paste the text. It is read into must-haves and nice-to-haves you confirm, then saved here so anyone can re-run it.</p>
                </div>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
                    <input ref={fileRef} type="file" accept=".pdf,.docx,.txt,.md" className="sr-only" aria-label="Upload a job description" onChange={e => { const f = e.target.files?.[0]; if (f) void readJd(f); }} />
                    <button type="button" onClick={() => fileRef.current?.click()} disabled={busy} className={BTN_PRIMARY}>{busy ? <Spinner /> : <FileUp className="h-4 w-4" />}Upload a JD</button>
                    <button type="button" onClick={() => setPasteOpen(o => !o)} disabled={busy} className={BTN_SECONDARY}>Paste a JD</button>
                    <button type="button" onClick={() => { setSeed(undefined); setNewOpen(true); }} disabled={busy} className={BTN_GHOST}><FolderPlus className="h-4 w-4" />Title only</button>
                </div>
                {pasteOpen && (
                    <div className={`${WELL} basis-full space-y-2 px-3 py-3`}>
                        <label htmlFor="pos-paste" className="block text-[13px] font-semibold text-text-primary">Job description</label>
                        <textarea id="pos-paste" rows={5} value={pasteText} onChange={e => setPasteText(e.target.value)} maxLength={20000} className={`${INPUT} h-auto min-h-[110px] resize-y py-2.5 leading-relaxed`} placeholder="Paste the job description here" />
                        <button type="button" onClick={() => void readJd(pasteText)} disabled={busy || !pasteText.trim()} className={BTN_PRIMARY}>{busy && <Spinner />}Read it</button>
                    </div>
                )}
            </section>

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
                        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Title, location, department" className={`${INPUT} h-9 pl-9 text-sm`} />
                    </label>
                    {busy && <Spinner className="h-3.5 w-3.5 text-text-tertiary" />}
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
                                        <button type="button" onClick={() => onPipeline(p)} className="block max-w-full truncate text-left font-display text-[15px] font-semibold text-text-primary underline-offset-2 hover:underline">{p.title}</button>
                                        <p className="truncate text-xs text-text-secondary">{[p.location, p.department].filter(Boolean).join(' · ')}{p.jdFileName ? ` · ${p.jdFileName}` : ''}{p.filters.keywords?.length ? ` · ${p.filters.keywords.filter(k => k.required).length} must-haves` : ''}</p>
                                    </div>
                                    <Tag tone={p.status === 'closed' ? 'neutral' : ageing ? 'warn' : 'success'}>{p.status === 'closed' ? `Closed${p.closedAt ? ` ${formatDate(p.closedAt)}` : ''}` : ageing ? 'Ageing' : 'Open'}</Tag>
                                    <Funnel counts={p.counts} />
                                    <div className="w-28 shrink-0">
                                        <p className={LABEL}>Recruiter</p>
                                        <p className="truncate text-sm font-medium text-text-primary" title={p.recruiterName ?? ''}>{p.recruiterName ?? <span className="font-normal text-text-tertiary">—</span>}</p>
                                    </div>
                                    <div className="w-24 shrink-0">
                                        <p className={LABEL}>{p.status === 'open' ? 'Days open' : 'Days to fill'}</p>
                                        <p className={`${NUM_SM} ${ageing ? 'text-red-700' : 'text-text-primary'}`}>{p.daysOpen} <span className="text-xs font-normal text-text-tertiary">of {p.targetDays}</span></p>
                                    </div>
                                    <div className="w-20 shrink-0">
                                        <p className={LABEL}>In pipeline</p>
                                        <p className={`${NUM_SM} text-text-primary`}>{formatCount(inPipeline(p))}</p>
                                    </div>
                                    <div className="flex shrink-0 items-center gap-x-1">
                                        <button type="button" onClick={() => onSearch(p)} className={BTN_SECONDARY}><Search className="h-4 w-4" />Search</button>
                                        <button type="button" onClick={() => onPipeline(p)} className={BTN_GHOST}><Layers className="h-4 w-4" />Pipeline</button>
                                        {p.status === 'open'
                                            ? <button type="button" onClick={() => void setStatus(p, 'closed')} disabled={busy} className={BTN_GHOST}>Close</button>
                                            : <button type="button" onClick={() => void setStatus(p, 'open')} disabled={busy} className={BTN_GHOST}>Reopen</button>}
                                    </div>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </section>
        </div>
    );
}
