'use client';

/**
 * WIKI — ask the org wiki a question, or browse its pages.
 *
 * Pages are compiled by code from Zoho POs and line items, the purchase@ digest and
 * the development journal (backend/lib/wiki/compile.ts). Answers come from one model
 * call over the pages search retrieves, with every claim cited as a page link. A good
 * answer can be saved back as a note page. Super admins only; the API enforces it.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
    AlertTriangle, ArrowLeft, BookOpen, Bookmark, Check, Loader2, RefreshCw, Search, Send,
} from 'lucide-react';

type Kind = 'overview' | 'flags' | 'vendor' | 'site' | 'item' | 'month' | 'mail' | 'dev' | 'note';
type PageRef = { slug: string; title: string; kind: string; summary?: string | null };

interface Status {
    provisioned: boolean;
    note?: string;
    error?: string;
    compiled_at?: string | null;
    counts?: Record<string, number>;
    recent_questions?: { id: string; question: string; status: string; created_at: string }[];
}

interface Answer {
    id: string | null;
    status: 'answered' | 'not_found' | 'failed';
    answer: string;
    cited: PageRef[];
    retrieved: PageRef[];
    costUsd: number | null;
    latencyMs: number;
    question: string;
}

interface Page {
    slug: string; kind: string; title: string; summary: string | null; body_md: string;
    origin: string; compiled_at: string;
}

const BROWSE: { kind: Kind; label: string }[] = [
    { kind: 'vendor', label: 'Vendors' }, { kind: 'site', label: 'Sites' }, { kind: 'item', label: 'Items' },
    { kind: 'month', label: 'Months' }, { kind: 'mail', label: 'Mail' }, { kind: 'dev', label: 'Journal' },
    { kind: 'note', label: 'Notes' },
];

const EXAMPLES = [
    'What did we last pay for TASKI R2 and who sold it cheapest?',
    'How much have we spent with Metro Airconditioner this financial year?',
    'Which POs have been pending approval the longest?',
    'What was decided about the purchase mailbox sync?',
];

/* ---------------------------------------------------------------------------
 * A renderer for the small markdown subset the compiler writes. No HTML from
 * page text ever reaches the DOM: everything is built as React elements.
 * ------------------------------------------------------------------------- */

function Inline({ text, onOpen }: { text: string; onOpen: (slug: string) => void }) {
    const parts = text.split(/(\[\[[^\]]+\]\]|\[[^\]]+\]\(https:\/\/[^)\s]+\)|\*\*[^*]+\*\*|`[^`]+`)/g);
    return (
        <>
            {parts.map((p, i) => {
                const wiki = /^\[\[([^\]|]+)(?:\|([^\]]*))?\]\]$/.exec(p);
                if (wiki) {
                    return (
                        <button key={i} type="button" onClick={() => onOpen(wiki[1].trim())}
                            className="font-medium text-primary underline decoration-primary/30 underline-offset-2 hover:decoration-primary">
                            {wiki[2]?.trim() || wiki[1].trim()}
                        </button>
                    );
                }
                const ext = /^\[([^\]]+)\]\((https:\/\/[^)\s]+)\)$/.exec(p);
                if (ext) {
                    return <a key={i} href={ext[2]} target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2">{ext[1]}</a>;
                }
                if (/^\*\*[^*]+\*\*$/.test(p)) return <strong key={i}>{p.slice(2, -2)}</strong>;
                if (/^`[^`]+`$/.test(p)) return <code key={i} className="rounded bg-muted px-1 text-[12px]">{p.slice(1, -1)}</code>;
                return <React.Fragment key={i}>{p}</React.Fragment>;
            })}
        </>
    );
}

function WikiMarkdown({ md, onOpen }: { md: string; onOpen: (slug: string) => void }) {
    const lines = md.split('\n');
    const blocks: React.ReactNode[] = [];
    let i = 0;
    while (i < lines.length) {
        const line = lines[i];
        if (!line.trim()) { i++; continue; }
        const h = /^(#{1,3}) (.*)$/.exec(line);
        if (h) {
            const cls = h[1].length === 1 ? 'text-lg font-bold text-foreground' : h[1].length === 2 ? 'mt-2 text-[15px] font-semibold text-foreground' : 'text-[14px] font-semibold text-foreground';
            blocks.push(<div key={i} className={cls}><Inline text={h[2]} onOpen={onOpen} /></div>);
            i++; continue;
        }
        if (line.startsWith('|')) {
            const rows: string[][] = [];
            while (i < lines.length && lines[i].startsWith('|')) {
                const cells = lines[i].replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
                if (!cells.every((c) => /^-+$/.test(c))) rows.push(cells);
                i++;
            }
            const [head, ...body] = rows;
            blocks.push(
                <div key={i} className="overflow-x-auto rounded-xl border border-border">
                    <table className="w-full text-left text-[12.5px]">
                        <thead className="bg-muted/60 text-text-secondary">
                            <tr>{head?.map((c, j) => <th key={j} className="whitespace-nowrap px-3 py-2 font-semibold">{c}</th>)}</tr>
                        </thead>
                        <tbody>
                            {body.map((r, k) => (
                                <tr key={k} className="border-t border-border align-top">
                                    {r.map((c, j) => <td key={j} className="px-3 py-1.5 text-foreground"><Inline text={c} onOpen={onOpen} /></td>)}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>,
            );
            continue;
        }
        if (line.startsWith('- ')) {
            const items: string[] = [];
            while (i < lines.length && lines[i].startsWith('- ')) { items.push(lines[i].slice(2)); i++; }
            blocks.push(
                <ul key={i} className="ml-4 list-disc space-y-1 text-[13.5px] text-foreground">
                    {items.map((t, k) => <li key={k}><Inline text={t} onOpen={onOpen} /></li>)}
                </ul>,
            );
            continue;
        }
        const para: string[] = [];
        while (i < lines.length && lines[i].trim() && !/^(#{1,3} |\||- )/.test(lines[i])) { para.push(lines[i]); i++; }
        const text = para.join(' ');
        const italic = /^_.*_$/.test(text);
        blocks.push(
            <p key={i} className={`text-[13.5px] leading-relaxed ${italic ? 'italic text-text-secondary' : 'text-foreground'}`}>
                <Inline text={italic ? text.slice(1, -1) : text} onOpen={onOpen} />
            </p>,
        );
    }
    return <div className="flex flex-col gap-3">{blocks}</div>;
}

/* ---------------------------------------------------------------------------
 * The tab
 * ------------------------------------------------------------------------- */

export default function WikiHome({ orgId }: { orgId: string }) {
    const [status, setStatus] = useState<Status | null>(null);
    const [question, setQuestion] = useState('');
    const [asking, setAsking] = useState(false);
    const [answer, setAnswer] = useState<Answer | null>(null);
    const [saved, setSaved] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const [page, setPage] = useState<{ page: Page; backlinks: PageRef[] } | null>(null);
    const [pageLoading, setPageLoading] = useState(false);
    const [history, setHistory] = useState<string[]>([]);
    const [browse, setBrowse] = useState<Kind | null>(null);
    const [list, setList] = useState<PageRef[] | null>(null);
    const [filter, setFilter] = useState('');
    const [rebuilding, setRebuilding] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const api = useCallback(async (path: string, init?: RequestInit) => {
        const sep = path.includes('?') ? '&' : '?';
        const res = await fetch(`${path}${sep}org_id=${encodeURIComponent(orgId)}`, init);
        const j = await res.json().catch(() => null);
        if (!res.ok) throw new Error(j?.error ?? `HTTP ${res.status}`);
        return j;
    }, [orgId]);

    const loadStatus = useCallback(async () => {
        try { setStatus(await api('/api/wiki')); } catch (e) { setStatus({ provisioned: false, error: (e as Error).message }); }
    }, [api]);
    useEffect(() => { void loadStatus(); }, [loadStatus]);

    const open = useCallback(async (slug: string, push = true) => {
        setPageLoading(true); setError(null);
        try {
            const j = await api(`/api/wiki?slug=${encodeURIComponent(slug)}`);
            if (j.page) {
                setPage(j);
                if (push) setHistory((h) => [...h, slug]);
                window.scrollTo?.({ top: 0, behavior: 'smooth' });
            }
        } catch (e) { setError((e as Error).message); } finally { setPageLoading(false); }
    }, [api]);

    const back = () => {
        const h = history.slice(0, -1);
        setHistory(h);
        if (h.length) void open(h[h.length - 1], false); else setPage(null);
    };

    const ask = async (q = question) => {
        const text = q.trim();
        if (text.length < 3 || asking) return;
        setQuestion(text); setAsking(true); setError(null); setSaved(null); setPage(null); setHistory([]);
        try {
            const j = await api('/api/wiki/ask', {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: text }),
            });
            setAnswer({ ...j, question: text });
            void loadStatus();
        } catch (e) { setError((e as Error).message); } finally { setAsking(false); }
    };

    const save = async () => {
        if (!answer || saving) return;
        setSaving(true);
        try {
            const j = await api('/api/wiki', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'note', question: answer.question, answer: answer.answer, cited: answer.cited.map((c) => c.slug) }),
            });
            setSaved(j.slug);
            void loadStatus();
        } catch (e) { setError((e as Error).message); } finally { setSaving(false); }
    };

    const rebuild = async () => {
        setRebuilding(true); setError(null);
        try { await api('/api/wiki/rebuild', { method: 'POST' }); await loadStatus(); } catch (e) { setError((e as Error).message); } finally { setRebuilding(false); }
    };

    const showKind = async (k: Kind) => {
        setBrowse(k); setList(null); setFilter(''); setPage(null); setHistory([]);
        try { setList((await api(`/api/wiki?kind=${k}`)).pages ?? []); } catch (e) { setError((e as Error).message); setList([]); }
    };

    const search = async () => {
        const q = filter.trim();
        if (!q) return;
        setBrowse(null); setList(null); setPage(null); setHistory([]);
        try { setList((await api(`/api/wiki?q=${encodeURIComponent(q)}`)).results ?? []); } catch (e) { setError((e as Error).message); setList([]); }
    };

    if (!status) {
        return <div className="flex items-center gap-2 p-6 text-sm text-text-secondary"><Loader2 className="h-4 w-4 animate-spin" /> Loading the wiki…</div>;
    }

    const empty = status.provisioned && !status.compiled_at;
    const shown = list && browse && filter.trim()
        ? list.filter((p) => `${p.title} ${p.summary ?? ''}`.toLowerCase().includes(filter.trim().toLowerCase()))
        : list;

    return (
        <div className="mx-auto flex max-w-4xl flex-col gap-5 p-4 md:p-6">
            <header className="flex flex-wrap items-start gap-3">
                <div className="min-w-0 flex-1">
                    <h1 className="flex items-center gap-2 text-xl font-bold text-foreground"><BookOpen className="h-5 w-5" /> Wiki</h1>
                    <p className="mt-1 text-[13px] text-text-secondary">
                        Ask about purchase orders, vendors, items, sites, purchase@ mail or how FMS was built. Answers cite the pages they come from.
                        {status.compiled_at && <> Pages compiled {new Date(status.compiled_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}.</>}
                    </p>
                </div>
                {status.provisioned && (
                    <button type="button" onClick={rebuild} disabled={rebuilding}
                        className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-3 py-2 text-[12.5px] font-semibold text-foreground hover:bg-muted disabled:opacity-50">
                        <RefreshCw className={`h-3.5 w-3.5 ${rebuilding ? 'animate-spin' : ''}`} /> {rebuilding ? 'Rebuilding…' : 'Rebuild'}
                    </button>
                )}
            </header>

            {(!status.provisioned || empty || error) && (
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3.5 py-3 text-[12.5px] leading-relaxed text-amber-900 dark:text-amber-200">
                    <AlertTriangle className="mr-1.5 inline h-3.5 w-3.5" />
                    {error ?? status.error ?? status.note ?? 'No pages yet. Press Rebuild to compile the wiki (about 15 seconds).'}
                </div>
            )}

            {status.provisioned && !empty && (
                <section className="rounded-2xl border border-border bg-card p-4">
                    <form onSubmit={(e) => { e.preventDefault(); void ask(); }} className="flex flex-col gap-2 sm:flex-row">
                        <input value={question} onChange={(e) => setQuestion(e.target.value)} maxLength={500}
                            placeholder="Ask a question, e.g. what did we pay BVG for housekeeping at SS Plaza?"
                            className="min-w-0 flex-1 rounded-xl border border-border bg-background px-3.5 py-2.5 text-[14px] text-foreground outline-none focus:border-primary" />
                        <button type="submit" disabled={asking || question.trim().length < 3}
                            className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-primary px-4 py-2.5 text-[13px] font-bold text-white hover:opacity-90 disabled:opacity-50">
                            {asking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Ask
                        </button>
                    </form>
                    {!answer && !asking && (
                        <div className="mt-3 flex flex-wrap gap-2">
                            {EXAMPLES.map((q) => (
                                <button key={q} type="button" onClick={() => void ask(q)}
                                    className="rounded-full border border-border px-3 py-1 text-[12px] text-text-secondary hover:border-primary hover:text-primary">{q}</button>
                            ))}
                        </div>
                    )}
                    {asking && <p className="mt-3 flex items-center gap-2 text-[12.5px] text-text-secondary"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Searching the wiki and reading the pages…</p>}
                    {answer && !asking && (
                        <div className="mt-4 flex flex-col gap-3 border-t border-border pt-4">
                            {answer.status !== 'answered' && (
                                <span className={`w-fit rounded-full px-2.5 py-0.5 text-[11px] font-bold ${answer.status === 'failed' ? 'bg-red-500/10 text-red-700 dark:text-red-300' : 'bg-amber-500/10 text-amber-800 dark:text-amber-200'}`}>
                                    {answer.status === 'failed' ? 'Failed' : 'Not in the wiki'}
                                </span>
                            )}
                            <WikiMarkdown md={answer.answer} onOpen={(s) => void open(s)} />
                            {answer.cited.length > 0 && (
                                <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
                                    <span className="text-text-secondary">Sources:</span>
                                    {answer.cited.map((c) => (
                                        <button key={c.slug} type="button" onClick={() => void open(c.slug)}
                                            className="rounded-lg bg-primary/10 px-2 py-0.5 font-medium text-primary hover:bg-primary/20">{c.title}</button>
                                    ))}
                                </div>
                            )}
                            <div className="flex flex-wrap items-center gap-3 text-[11.5px] text-text-secondary">
                                <span>{(answer.latencyMs / 1000).toFixed(1)}s{answer.costUsd != null ? ` · $${answer.costUsd.toFixed(4)}` : ''}</span>
                                <span>Searched {answer.retrieved.length} page{answer.retrieved.length === 1 ? '' : 's'}</span>
                                {answer.status === 'answered' && (
                                    saved
                                        ? <button type="button" onClick={() => void open(saved)} className="inline-flex items-center gap-1 font-semibold text-emerald-700 dark:text-emerald-300"><Check className="h-3.5 w-3.5" /> Saved as a note</button>
                                        : <button type="button" onClick={save} disabled={saving} className="inline-flex items-center gap-1 font-semibold text-primary hover:underline disabled:opacity-50"><Bookmark className="h-3.5 w-3.5" /> Save to wiki</button>
                                )}
                            </div>
                        </div>
                    )}
                </section>
            )}

            {status.provisioned && !empty && (
                <section className="flex flex-col gap-3">
                    <div className="flex flex-wrap items-center gap-1.5">
                        <button type="button" onClick={() => { setBrowse(null); setList(null); setHistory([]); void open('overview'); }}
                            className="rounded-lg px-2.5 py-1 text-[12.5px] font-semibold text-foreground hover:bg-muted">Overview</button>
                        <button type="button" onClick={() => { setBrowse(null); setList(null); setHistory([]); void open('flags'); }}
                            className="rounded-lg px-2.5 py-1 text-[12.5px] font-semibold text-foreground hover:bg-muted">Red flags</button>
                        {BROWSE.map((b) => (
                            <button key={b.kind} type="button" onClick={() => void showKind(b.kind)}
                                className={`rounded-lg px-2.5 py-1 text-[12.5px] font-semibold ${browse === b.kind && !page ? 'bg-primary text-white' : 'text-foreground hover:bg-muted'}`}>
                                {b.label} <span className="font-normal opacity-60">{status.counts?.[b.kind] ?? 0}</span>
                            </button>
                        ))}
                    </div>
                    <form onSubmit={(e) => { e.preventDefault(); if (!browse) void search(); }} className="relative">
                        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-secondary" />
                        <input value={filter} onChange={(e) => setFilter(e.target.value)}
                            placeholder={browse ? `Filter ${BROWSE.find((b) => b.kind === browse)?.label.toLowerCase()}…` : 'Search page titles and text, then press Enter'}
                            className="w-full rounded-xl border border-border bg-background py-2 pl-9 pr-3 text-[13px] text-foreground outline-none focus:border-primary" />
                    </form>

                    {pageLoading && <p className="flex items-center gap-2 text-[12.5px] text-text-secondary"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Opening page…</p>}

                    {page && !pageLoading && (
                        <article className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 md:p-5">
                            <div className="flex flex-wrap items-center gap-2 text-[12px] text-text-secondary">
                                <button type="button" onClick={back} className="inline-flex items-center gap-1 font-semibold text-primary hover:underline">
                                    <ArrowLeft className="h-3.5 w-3.5" /> Back
                                </button>
                                <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]">{page.page.slug}</span>
                                <span>{page.page.origin === 'filed' ? 'Saved note' : 'Compiled'} {new Date(page.page.compiled_at).toLocaleDateString('en-IN')}</span>
                            </div>
                            <WikiMarkdown md={page.page.body_md} onOpen={(s) => void open(s)} />
                            {page.backlinks.length > 0 && (
                                <div className="border-t border-border pt-3 text-[12px]">
                                    <span className="text-text-secondary">Linked from: </span>
                                    {page.backlinks.slice(0, 20).map((b, i) => (
                                        <React.Fragment key={b.slug}>
                                            {i > 0 && ' · '}
                                            <button type="button" onClick={() => void open(b.slug)} className="text-primary hover:underline">{b.title}</button>
                                        </React.Fragment>
                                    ))}
                                </div>
                            )}
                        </article>
                    )}

                    {!page && !pageLoading && list === null && (browse !== null) && (
                        <p className="flex items-center gap-2 text-[12.5px] text-text-secondary"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…</p>
                    )}

                    {!page && !pageLoading && shown && (
                        <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
                            {shown.length === 0 && <li className="px-4 py-3 text-[13px] text-text-secondary">No pages match.</li>}
                            {shown.slice(0, 300).map((p) => (
                                <li key={p.slug}>
                                    <button type="button" onClick={() => void open(p.slug)} className="flex w-full flex-col gap-0.5 px-4 py-2.5 text-left hover:bg-muted/60">
                                        <span className="text-[13.5px] font-medium text-foreground">{p.title}</span>
                                        {p.summary && <span className="text-[12px] text-text-secondary">{p.summary}</span>}
                                    </button>
                                </li>
                            ))}
                            {shown.length > 300 && <li className="px-4 py-2 text-[12px] text-text-secondary">Showing 300 of {shown.length}. Filter to narrow it down.</li>}
                        </ul>
                    )}

                    {!page && !pageLoading && !list && !browse && (status.recent_questions?.length ?? 0) > 0 && (
                        <div className="rounded-2xl border border-border bg-card p-4">
                            <div className="mb-2 text-[13px] font-semibold text-foreground">Recent questions</div>
                            <ul className="flex flex-col gap-1.5">
                                {status.recent_questions!.map((q) => (
                                    <li key={q.id} className="flex items-baseline gap-2 text-[12.5px]">
                                        <button type="button" onClick={() => void ask(q.question)} className="text-left text-primary hover:underline">{q.question}</button>
                                        <span className="shrink-0 text-text-secondary">{q.status === 'answered' ? '' : q.status === 'not_found' ? '· not in wiki' : '· failed'}</span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
                </section>
            )}
        </div>
    );
}
