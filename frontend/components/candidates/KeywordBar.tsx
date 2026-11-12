'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Ban, Plus, Search, Sparkles } from 'lucide-react';
import type { KeywordSuggestion, SearchFilters } from '@/backend/lib/candidates/filters';
import { api } from './api';
import { TokenField } from './FieldPickers';
import { BTN_PRIMARY, BTN_GHOST, CARD, INPUT, OVERLAY, Reveal, Spinner, WELL } from './ui';

const SAMPLE_MAX = 4000;

const keyOf = (keywords: string[]) => [...new Set(keywords.map(k => k.trim().toLowerCase()).filter(Boolean))].sort().join('|');
/** A word being typed is asked about once it is this long and the typing has paused this long. */
const AHEAD_MIN = 3;
const AHEAD_MS = 400;

/**
 * AI suggestions for the current keywords, kept per keyword set for this visit so going back to a box is instant.
 *
 * Owner 2026-11-11, quicker: (1) the terms are shown the moment the model answers; nothing waits for the records and
 * no term is dropped for not being on them; (2) how many records carry each term is asked afterwards and filled in
 * beside it; (3) while a keyword is still being typed, its suggestions are already asked for, so they are usually
 * there when Enter is pressed.
 */
function useAiKeywords(orgId: string, keywords: string[], typed: string, enabled: boolean) {
    const key = keyOf(keywords);
    const [cache, setCache] = useState<Record<string, KeywordSuggestion[]>>({});
    const [counted, setCounted] = useState<Record<string, true>>({});
    const asked = useRef(new Set<string>());

    /** One request per keyword set, whoever asks first (the keywords themselves, or the word being typed). */
    const fetchTerms = (wanted: string) => {
        if (!wanted || asked.current.has(wanted)) return;
        asked.current.add(wanted);
        void api<{ suggestions: KeywordSuggestion[] }>('/api/candidates/suggest-keywords', { json: { orgId, keywords: wanted.split('|') } }).then(res => {
            if (res.ok) setCache(c => ({ ...c, [wanted]: res.data.suggestions }));
            else { asked.current.delete(wanted); setCache(c => (wanted in c ? c : { ...c, [wanted]: [] })); }
        });
    };

    // The keywords in the box: asked at once.
    useEffect(() => {
        if (enabled && key) fetchTerms(key);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [enabled, key, orgId]);

    // The word being typed: asked after a short pause, as if it were already a keyword.
    const aheadKey = typed.length >= AHEAD_MIN ? keyOf([...keywords, typed]) : '';
    useEffect(() => {
        if (!enabled || !aheadKey || aheadKey === key) return;
        const t = setTimeout(() => fetchTerms(aheadKey), AHEAD_MS);
        return () => clearTimeout(t);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [enabled, aheadKey, key, orgId]);

    // Once the terms are on screen: how many records carry each.
    const ready = cache[key];
    const needCounts = enabled && !!ready?.length && !counted[key];
    useEffect(() => {
        if (!needCounts) return;
        const ctrl = new AbortController();
        void api<{ counts: KeywordSuggestion[] }>('/api/candidates/suggest-keywords', { json: { orgId, count: ready.map(s => s.text) }, signal: ctrl.signal }).then(res => {
            if (ctrl.signal.aborted) return;
            setCounted(c => ({ ...c, [key]: true }));
            if (!res.ok) return;
            const byText = new Map(res.data.counts.map(c => [c.text.toLowerCase(), c.count]));
            setCache(c => ({ ...c, [key]: (c[key] ?? []).map(s => ({ ...s, count: byText.get(s.text.toLowerCase()) ?? s.count })) }));
        });
        return () => ctrl.abort();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [needCounts, key, orgId]);

    return { suggestions: ready ?? [], loading: enabled && !!key && !ready, counting: needCounts };
}

export default function KeywordBar({
    orgId, filters, update, reading, onReadJob, jobNote,
}: {
    orgId: string;
    filters: SearchFilters;
    update: (patch: Partial<SearchFilters>) => void;
    reading: boolean;
    /** Resolves true when the filters were filled in. */
    onReadJob: (text: string) => Promise<boolean>;
    jobNote: string;
}) {
    const [excludeOpen, setExcludeOpen] = useState(false);
    const [jobOpen, setJobOpen] = useState(false);
    const [jobText, setJobText] = useState('');
    const excludeRef = useRef<HTMLInputElement | null>(null);
    const jobRef = useRef<HTMLTextAreaElement | null>(null);
    const [keywordFocus, setKeywordFocus] = useState(false);
    const [typing, setTyping] = useState('');
    const { suggestions, loading, counting } = useAiKeywords(orgId, filters.keywords.map(k => k.text), typing, keywordFocus);

    // A job description can fill in exclusions: open the row so HR sees them.
    const [excludeCount, setExcludeCount] = useState(0);
    if (filters.excludes.length !== excludeCount) {
        setExcludeCount(filters.excludes.length);
        if (filters.excludes.length > excludeCount) setExcludeOpen(true);
    }
    useEffect(() => { if (excludeOpen) excludeRef.current?.focus({ preventScroll: true }); }, [excludeOpen]);
    useEffect(() => { if (jobOpen) jobRef.current?.focus({ preventScroll: true }); }, [jobOpen]);

    const addKeywords = (texts: string[], required: boolean) => update({ keywords: [...filters.keywords, ...texts.map(text => ({ text, required }))] });
    const taken = new Set([...filters.keywords.map(k => k.text.toLowerCase()), ...filters.excludes.map(e => e.toLowerCase())]);
    const offered = suggestions.filter(s => !taken.has(s.text.toLowerCase()));

    const aiPanel = filters.keywords.length > 0 && (loading || offered.length > 0) ? (
        <div onMouseDown={e => e.preventDefault()} className={`${OVERLAY} absolute inset-x-0 top-full z-40 mt-1 rounded-xl px-3.5 pb-3.5 pt-3`}>
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <span className="inline-flex items-center gap-1.5 text-[13px] font-bold text-primary-dark"><Sparkles className="h-3.5 w-3.5" aria-hidden />AI suggested keywords</span>
                {offered.length > 0 && <span className="text-xs text-text-secondary">The number is how many candidates have the word; 0 means none yet. Hold Ctrl while clicking to star it.</span>}
            </div>
            {loading && !offered.length ? (
                <p className="mt-2.5 flex items-center gap-x-2 gap-y-2 text-sm text-text-secondary"><Spinner className="h-3.5 w-3.5" />Finding related keywords…</p>
            ) : (
                <div className="mt-2.5 flex flex-wrap gap-x-2 gap-y-2">
                    {offered.map(s => (
                        <button key={s.text} type="button" onMouseDown={e => { e.preventDefault(); addKeywords([s.text], e.ctrlKey || e.metaKey); }}
                            title={s.count === null ? 'Add this keyword' : s.count === 0 ? 'No candidate has this word yet. Adding it alone, or starred, will show no one.' : `${s.count} ${s.count === 1 ? 'candidate has' : 'candidates have'} this word`}
                            className="inline-flex h-8 items-center gap-x-1.5 rounded-full border border-border bg-surface px-3 text-[13px] font-semibold text-text-primary transition-colors hover:border-primary">
                            {s.text}
                            {/* The number's place is kept while it is being counted, so the row does not shuffle when it arrives. */}
                            {s.count !== null
                                ? <span className={`min-w-4 text-center text-xs font-medium tabular-nums ${s.count > 0 ? 'text-primary-dark' : 'text-text-tertiary'}`}>{s.count}</span>
                                : counting && <span className="inline-block h-1.5 w-4 animate-pulse rounded-full bg-border" aria-hidden />}
                        </button>
                    ))}
                </div>
            )}
        </div>
    ) : null;

    const readJob = async () => {
        if (await onReadJob(jobText)) setJobOpen(false);
    };

    return (
        <section aria-label="Keywords" className={`${CARD} space-y-2.5 px-4 py-4`}>
            <div className="flex flex-wrap items-start gap-x-3 gap-y-1.5">
                <label htmlFor="cand-keywords" className="w-[72px] shrink-0 pt-2.5 text-[13px] font-semibold text-text-primary">Keywords</label>
                <div className="min-w-[240px] flex-1" onFocus={() => setKeywordFocus(true)} onBlur={() => setKeywordFocus(false)}>
                    <TokenField
                        id="cand-keywords"
                        orgId={orgId}
                        field="keyword"
                        tokens={filters.keywords}
                        onAdd={addKeywords}
                        onRemove={text => update({ keywords: filters.keywords.filter(k => k.text !== text) })}
                        onToggle={text => update({ keywords: filters.keywords.map(k => (k.text === text ? { ...k, required: !k.required } : k)) })}
                        placeholder={filters.keywords.length ? 'Type another keyword' : 'Start typing a keyword, company or designation'}
                        icon={<Search className="h-4 w-4 shrink-0 text-text-tertiary" aria-hidden />}
                        panel={aiPanel}
                        onTyping={setTyping}
                    />
                </div>
            </div>

            <Reveal open={excludeOpen}>
                <div className="flex flex-wrap items-start gap-x-3 gap-y-1.5">
                    <label htmlFor="cand-excludes" className="w-[72px] shrink-0 pt-2.5 text-[13px] font-semibold text-text-primary">Exclude</label>
                    <div className="min-w-[240px] flex-1">
                        <TokenField
                            id="cand-excludes"
                            orgId={orgId}
                            field="keyword"
                            focusRef={excludeRef}
                            tokens={filters.excludes.map(text => ({ text }))}
                            onAdd={texts => update({ excludes: [...filters.excludes, ...texts] })}
                            onRemove={text => update({ excludes: filters.excludes.filter(e => e !== text) })}
                            placeholder="Words to leave out, like residential"
                            icon={<Ban className="h-4 w-4 shrink-0 text-text-tertiary" aria-hidden />}
                        />
                    </div>
                </div>
            </Reveal>

            <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-2">
                <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                    <button type="button" onClick={() => setExcludeOpen(o => !o)} aria-expanded={excludeOpen} className="inline-flex h-7 items-center gap-x-1 gap-y-1 rounded-lg px-1.5 text-xs font-semibold text-primary-dark hover:bg-muted">
                        <Plus className={`h-3 w-3 transition-transform duration-300 ${excludeOpen ? 'rotate-45' : ''}`} aria-hidden />
                        {excludeOpen ? 'Close Exclude Keywords' : filters.excludes.length ? `Exclude Keywords (${filters.excludes.length})` : 'Add Exclude Keywords'}
                    </button>
                    <span className="text-xs text-text-tertiary">Star a keyword to make it compulsory.</span>
                </div>
                <button type="button" onClick={() => setJobOpen(o => !o)} aria-expanded={jobOpen} className={`${BTN_GHOST} text-primary-dark`}>
                    <Sparkles className="h-4 w-4" aria-hidden />{jobOpen ? 'Close job description' : 'Paste a job description'}
                </button>
            </div>

            <Reveal open={jobOpen}>
                <div className={`${WELL} space-y-2 px-3 py-3`}>
                    <label htmlFor="cand-job" className="block text-[13px] font-semibold text-text-primary">Job description or plain-English request</label>
                    <textarea
                        id="cand-job"
                        ref={jobRef}
                        rows={4}
                        maxLength={SAMPLE_MAX}
                        value={jobText}
                        onChange={e => setJobText(e.target.value)}
                        placeholder="Paste the job description here. AI fills in the filters, and you can change anything before using them."
                        className={`${INPUT} h-auto min-h-[96px] resize-y py-2.5 leading-relaxed`}
                    />
                    <button type="button" onClick={() => void readJob()} disabled={reading || !jobText.trim()} className={BTN_PRIMARY}>
                        {reading && <Spinner />}{reading ? 'Reading…' : 'Fill in the filters'}
                    </button>
                </div>
            </Reveal>
            {jobNote && <p role="status" className="text-[13px] font-semibold text-primary-dark">{jobNote}</p>}
        </section>
    );
}
