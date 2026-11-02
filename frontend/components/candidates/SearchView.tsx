'use client';

import React, { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { CircleAlert, Lock, Search, Sparkles, Star, Tag } from 'lucide-react';
import {
    TOP_N_DEFAULT, TOP_N_MAX, TOP_N_MIN,
    type CandidateRecord, type ChipKind, type RecordStatus, type SearchResponse,
} from '@/backend/lib/candidates/types';
import Skeleton from '@/frontend/components/ui/Skeleton';
import { api } from './api';
import { formatCount } from './format';
import RecordForm from './RecordForm';
import ResultCard from './ResultCard';
import { BTN_PRIMARY, CARD, EASE_PATIENT, INPUT, LABEL, Spinner, useUi, WELL } from './ui';

const MAX_QUERY = 4000;

const EXAMPLES = [
    'BMS operators in Thane or Navi Mumbai, 3+ years relevant experience, notice under 30 days, expected under 35K',
    'Facility executive for a coworking site in Pune, 2 to 5 years, can join immediately',
    'Electrician with HVAC or DG set experience in Mumbai, expected in-hand up to ₹25K',
];

/** Rough phases of the 5–15 s search, shown as reassurance (timed hints, not real progress). */
const PHASES: Array<[number, string]> = [
    [0, 'Reading your query…'],
    [3, 'Searching the records…'],
    [7, 'Comparing the best matches…'],
    [14, 'Almost there…'],
];

const CHIP_STYLE: Record<ChipKind, { cls: string; icon: React.ComponentType<{ className?: string }> }> = {
    // Hard filter: the one solid fill. Preference: outline. Keyword: neutral. Shape differs, not only colour.
    must: { cls: 'bg-primary text-white', icon: Lock },
    prefer: { cls: 'bg-surface text-primary-dark ring-1 ring-inset ring-primary/60', icon: Star },
    keyword: { cls: 'bg-surface-elevated text-text-secondary ring-1 ring-inset ring-border', icon: Tag },
};
const CHIP_GROUPS: Array<[ChipKind, string]> = [['must', 'Must have'], ['prefer', 'Preferred'], ['keyword', 'Search terms']];

type TopN = { ok: true; value: number } | { ok: false; message: string };

function parseTopN(raw: string): TopN {
    const t = raw.trim();
    if (!t) return { ok: false, message: `Enter how many candidates to show (${TOP_N_MIN}–${TOP_N_MAX}).` };
    const n = Number(t);
    if (!Number.isInteger(n)) return { ok: false, message: 'Use a whole number.' };
    if (n < TOP_N_MIN || n > TOP_N_MAX) return { ok: false, message: `Choose a number from ${TOP_N_MIN} to ${TOP_N_MAX}.` };
    return { ok: true, value: n };
}

export default function SearchView({ orgId, onDataChanged }: { orgId: string; onDataChanged: () => void }) {
    const { notify, reportError } = useUi();
    const [query, setQuery] = useState('');
    const [topNText, setTopNText] = useState(String(TOP_N_DEFAULT));
    const [response, setResponse] = useState<SearchResponse | null>(null);
    const [searchError, setSearchError] = useState('');
    const [searching, setSearching] = useState(false);
    const [elapsed, setElapsed] = useState(0);
    const [statusBusy, setStatusBusy] = useState<Record<string, boolean>>({});
    const [editor, setEditor] = useState<{ record: CandidateRecord; key: number } | null>(null);
    const [editorOpen, setEditorOpen] = useState(false);
    const abortRef = useRef<AbortController | null>(null);
    const textareaRef = useRef<HTMLTextAreaElement | null>(null);

    const topN = parseTopN(topNText);
    const canSearch = query.trim().length > 0 && topN.ok && !searching;

    useEffect(() => () => abortRef.current?.abort(), []);

    useEffect(() => {
        if (!searching) return;
        const started = Date.now();
        const t = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 500);
        return () => clearInterval(t);
    }, [searching]);

    const runSearch = async () => {
        if (!canSearch || !topN.ok) return;
        abortRef.current?.abort();
        const ctrl = new AbortController();
        abortRef.current = ctrl;
        setSearching(true);
        setElapsed(0);
        setSearchError('');
        const res = await api<SearchResponse>('/api/candidates/search', {
            json: { orgId, query: query.trim(), topN: topN.value }, signal: ctrl.signal,
        });
        if (ctrl.signal.aborted) return;
        setSearching(false);
        // Shown inline under the query box; only a 401/403 goes to reportError (it swaps in the no-access panel).
        if (!res.ok) { setSearchError(res.error); if (res.noAccess) reportError(res); return; }
        setResponse(res.data);
    };

    const replaceRecord = (record: CandidateRecord) => {
        setResponse(prev => prev && { ...prev, results: prev.results.map(x => (x.record.id === record.id ? { ...x, record } : x)) });
    };

    const changeStatus = async (record: CandidateRecord, status: RecordStatus) => {
        if (status === record.status) return;
        setStatusBusy(b => ({ ...b, [record.id]: true }));
        const res = await api<{ record: CandidateRecord }>(`/api/candidates/${encodeURIComponent(record.id)}`, { method: 'PATCH', json: { orgId, status } });
        setStatusBusy(b => ({ ...b, [record.id]: false }));
        if (!res.ok) { reportError(res); return; }
        replaceRecord(res.data.record);
        onDataChanged();
        notify(`${record.fullName}: status updated`, 'success');
    };

    const phase = [...PHASES].reverse().find(([s]) => elapsed >= s)?.[1] ?? PHASES[0][1];

    return (
        <div className="space-y-6">
            {/* Query card */}
            <form
                className={`${CARD} p-4 sm:p-6`}
                onSubmit={e => { e.preventDefault(); void runSearch(); }}
            >
                <label htmlFor="cand-query" className="font-display text-base font-semibold text-text-primary">Who are you looking for?</label>
                <p className="mt-1 text-sm text-text-secondary">Describe the candidate in plain English, or paste a job description.</p>
                <textarea
                    id="cand-query"
                    ref={textareaRef}
                    value={query}
                    maxLength={MAX_QUERY}
                    rows={4}
                    onChange={e => setQuery(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void runSearch(); } }}
                    placeholder="e.g. BMS operators in Thane or Navi Mumbai, 3+ years relevant experience, notice under 30 days, expected under 35K"
                    className={`${INPUT} mt-4 h-auto min-h-[112px] resize-y py-3 leading-relaxed`}
                />
                <div className="mt-1 flex justify-between gap-2 text-xs text-text-tertiary">
                    <span className="hidden sm:inline">Ctrl + Enter to search</span>
                    <span className={`ml-auto tabular-nums ${query.length >= MAX_QUERY ? 'font-semibold text-text-primary' : ''}`}>{formatCount(query.length)} / {formatCount(MAX_QUERY)}</span>
                </div>

                <div className="mt-4 flex flex-wrap items-end gap-3">
                    <div className="w-28">
                        <label htmlFor="cand-topn" className={`${LABEL} mb-1.5 block`}>Show top</label>
                        <input
                            id="cand-topn"
                            type="number"
                            inputMode="numeric"
                            min={TOP_N_MIN}
                            max={TOP_N_MAX}
                            step={1}
                            value={topNText}
                            onChange={e => setTopNText(e.target.value)}
                            onBlur={() => {
                                const n = Number(topNText);
                                if (topNText.trim() && Number.isFinite(n)) setTopNText(String(Math.min(TOP_N_MAX, Math.max(TOP_N_MIN, Math.round(n)))));
                            }}
                            aria-invalid={!topN.ok}
                            aria-describedby="cand-topn-msg"
                            className={`${INPUT} tabular-nums ${!topN.ok ? 'border-error focus:border-error focus:ring-error/20' : ''}`}
                        />
                    </div>
                    <button type="submit" disabled={!canSearch} className={`${BTN_PRIMARY} flex-1 sm:flex-none sm:min-w-[140px]`}>
                        {searching ? <Spinner /> : <Search className="h-4 w-4" />}{searching ? 'Searching…' : 'Search'}
                    </button>
                </div>
                <p id="cand-topn-msg" className={`mt-1.5 text-xs ${topN.ok ? 'text-text-tertiary' : 'font-medium text-error'}`}>
                    {topN.ok ? `Candidates to show, ${TOP_N_MIN} to ${TOP_N_MAX}.` : topN.message}
                </p>
            </form>

            {/* Loading */}
            {searching && (
                <div aria-live="polite" className="space-y-4">
                    <p className="flex items-center gap-2 text-sm font-medium text-text-secondary"><Spinner className="h-4 w-4 text-primary" />{phase}<span className="tabular-nums text-text-tertiary">{elapsed}s</span></p>
                    {[0, 1, 2].map(i => (
                        <div key={i} className={`${CARD} space-y-3 p-4 sm:p-6`}>
                            <div className="flex gap-3"><Skeleton className="h-8 w-8 rounded-xl" /><div className="flex-1 space-y-2"><Skeleton className="h-4 w-1/3" /><Skeleton className="h-3 w-1/2" /></div><Skeleton className="h-9 w-14" /></div>
                            <Skeleton className="h-3 w-full" /><Skeleton className="h-3 w-4/5" />
                        </div>
                    ))}
                </div>
            )}

            {!searching && searchError && (
                <p role="alert" className={`${CARD} flex gap-3 border-l-2 border-error p-4 text-sm text-text-primary`}>
                    <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-error" aria-hidden />{searchError}
                </p>
            )}

            {/* Empty state with examples */}
            {!searching && !response && !searchError && (
                <div className={`${WELL} p-4 sm:p-6`}>
                    <p className="flex items-center gap-2 font-display text-sm font-semibold text-text-primary"><Sparkles className="h-4 w-4 text-secondary" aria-hidden />Try one of these</p>
                    <ul className="mt-3 grid gap-2">
                        {EXAMPLES.map(ex => (
                            <li key={ex}>
                                <button
                                    type="button"
                                    onClick={() => { setQuery(ex); textareaRef.current?.focus(); }}
                                    className={`${CARD} w-full px-4 py-3 text-left text-sm text-text-primary transition-shadow duration-[360ms] ease-[var(--w-ease-patient)] hover:shadow-[var(--w-shadow-hover)]`}
                                >
                                    {ex}
                                </button>
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {/* Results */}
            {!searching && response && (
                <motion.section initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22, ease: EASE_PATIENT }} className="space-y-6" aria-label="Search results">
                    <div className="space-y-4">
                        {response.notices.length > 0 && (
                            <ul className="space-y-2" aria-live="polite">
                                {response.notices.map((n, i) => (
                                    <li key={i} className={`${WELL} flex gap-2.5 border-l-2 border-warning px-4 py-3 text-sm text-text-primary`}>
                                        <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />{n}
                                    </li>
                                ))}
                            </ul>
                        )}

                        <div className={`${CARD} p-4 sm:p-6`}>
                            <p className={LABEL}>What the search understood</p>
                            {response.understood.summary && <p className="mt-2 text-sm leading-relaxed text-text-primary">{response.understood.summary}</p>}
                            {response.understood.chips.length > 0 && (
                                <div className="mt-4 space-y-3">
                                    {CHIP_GROUPS.map(([kind, title]) => {
                                        const chips = response.understood.chips.filter(c => c.kind === kind);
                                        if (!chips.length) return null;
                                        const { cls, icon: Icon } = CHIP_STYLE[kind];
                                        return (
                                            <div key={kind} className="flex flex-col gap-2 sm:flex-row sm:items-start sm:gap-3">
                                                <span className="w-28 shrink-0 pt-1 text-xs font-semibold text-text-secondary">{title}</span>
                                                <ul className="flex min-w-0 flex-wrap gap-1.5">
                                                    {chips.map((c, i) => (
                                                        <li key={i} className={`inline-flex max-w-full items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${cls}`}>
                                                            <Icon className="h-3 w-3 shrink-0" aria-hidden /><span className="break-words">{c.label}</span>
                                                        </li>
                                                    ))}
                                                </ul>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                            <p className="mt-4 border-t border-border-subtle pt-3 text-xs text-text-secondary">
                                <span className="font-semibold tabular-nums text-text-primary">{formatCount(response.matchingCount)}</span> {response.matchingCount === 1 ? 'record' : 'records'} matched the must-haves
                                {' · '}AI compared <span className="font-semibold tabular-nums text-text-primary">{formatCount(response.comparedCount)}</span>
                                {' · '}showing top <span className="font-semibold tabular-nums text-text-primary">{formatCount(response.results.length)}</span>
                            </p>
                        </div>
                    </div>

                    {response.results.length === 0 ? (
                        <div className={`${CARD} px-4 py-10 text-center`}>
                            <p className="font-display text-base font-semibold text-text-primary">No candidates matched</p>
                            <p className="mt-1 text-sm text-text-secondary">Try loosening a must-have, such as the location, notice period or salary.</p>
                        </div>
                    ) : (
                        <ol className="space-y-4">
                            {response.results.map(res => (
                                <li key={res.record.id}>
                                    <ResultCard
                                        result={res}
                                        aiRanked={response.aiRanked}
                                        statusBusy={!!statusBusy[res.record.id]}
                                        onStatus={changeStatus}
                                        onOpen={rec => { setEditor(e => ({ record: rec, key: (e?.key ?? 0) + 1 })); setEditorOpen(true); }}
                                    />
                                </li>
                            ))}
                        </ol>
                    )}
                </motion.section>
            )}

            {editor && (
                <RecordForm
                    key={editor.key}
                    orgId={orgId}
                    record={editor.record}
                    open={editorOpen}
                    onClose={() => setEditorOpen(false)}
                    onSaved={rec => { replaceRecord(rec); setEditorOpen(false); onDataChanged(); }}
                />
            )}
        </div>
    );
}
