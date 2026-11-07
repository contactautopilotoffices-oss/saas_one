'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Ban, Plus, Search, Sparkles } from 'lucide-react';
import type { KeywordSuggestion, SearchFilters } from '@/backend/lib/candidates/filters';
import { api } from './api';
import { TokenField } from './FieldPickers';
import { BTN_PRIMARY, BTN_GHOST, CARD, INPUT, OVERLAY, Reveal, Spinner, WELL } from './ui';

const SAMPLE_MAX = 4000;

/** AI suggestions for the current keywords, kept per keyword set for this visit so going back to a box is instant. */
function useAiKeywords(orgId: string, keywords: string[], enabled: boolean) {
    const key = [...keywords].map(k => k.toLowerCase()).sort().join('|');
    const [cache, setCache] = useState<Record<string, KeywordSuggestion[]>>({});
    const ready = cache[key];
    useEffect(() => {
        if (!enabled || !key || ready) return;
        const ctrl = new AbortController();
        const t = setTimeout(() => {
            void api<{ suggestions: KeywordSuggestion[] }>('/api/candidates/suggest-keywords', { json: { orgId, keywords: key.split('|') }, signal: ctrl.signal }).then(res => {
                if (!ctrl.signal.aborted) setCache(c => ({ ...c, [key]: res.ok ? res.data.suggestions : [] }));
            });
        }, 400);
        return () => { clearTimeout(t); ctrl.abort(); };
    }, [enabled, key, orgId, ready]);
    return { suggestions: ready ?? [], loading: enabled && !!key && !ready };
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
    const { suggestions, loading } = useAiKeywords(orgId, filters.keywords.map(k => k.text), keywordFocus);

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
                {offered.length > 0 && <span className="text-xs text-text-tertiary">Hold Ctrl while clicking a keyword to star it</span>}
            </div>
            {loading && !offered.length ? (
                <p className="mt-2.5 flex items-center gap-2 text-sm text-text-secondary"><Spinner className="h-3.5 w-3.5" />Finding related keywords…</p>
            ) : (
                <div className="mt-2.5 flex flex-wrap gap-2">
                    {offered.map(s => (
                        <button key={s.text} type="button" onMouseDown={e => { e.preventDefault(); addKeywords([s.text], e.ctrlKey || e.metaKey); }} title={`On ${s.count} ${s.count === 1 ? 'record' : 'records'}`}
                            className="h-8 rounded-full border border-border bg-surface px-3 text-[13px] font-semibold text-text-primary transition-colors hover:border-primary">
                            {s.text}
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
        <section aria-label="Keywords" className={`${CARD} space-y-2.5 p-4`}>
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

            <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                    <button type="button" onClick={() => setExcludeOpen(o => !o)} aria-expanded={excludeOpen} className="inline-flex h-7 items-center gap-1 rounded-lg px-1.5 text-xs font-semibold text-primary-dark hover:bg-muted">
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
                <div className={`${WELL} space-y-2 p-3`}>
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
