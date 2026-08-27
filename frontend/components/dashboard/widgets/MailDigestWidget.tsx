'use client';

import React, { useEffect, useState } from 'react';
import { Clock, Search, X } from 'lucide-react';
import type { WidgetProps } from '@/frontend/lib/dashboard/types';
import { useWidgetData, relativeTime } from '@/frontend/lib/dashboard/useWidgetData';
import { Metric, WidgetEmpty, WidgetSkeleton } from './WidgetShell';

/**
 * Purchase mailbox digest — "who is waiting on the purchase team".
 *
 * This is the standalone version of what used to be a four-line tile buried inside another
 * card. The point of promoting it is the SUBJECT LINES: a count of open threads tells you
 * there is a queue, but only "Re: Quotation for AHU belts — 14 days" tells you what it is,
 * and that is the difference between a number and a task list. So sm/md carry the counts
 * and lg/xl carry the actual mail.
 *
 * TWO OPEN STATES, TWO COLOURS. `awaiting_reply` (they wrote, nobody answered) is amber;
 * `unactioned_request` (answered, but the thing was never done) is blue. They fail
 * differently — one is a courtesy debt, one is an operational one — and a single colour for
 * both would hide which kind of backlog this is. `no_discovery` and `other` are neither, and
 * the API already excludes them from `open`.
 *
 * ACCESS. /api/procurement/mailbox/summary is procurement + super-admin only and 403s for
 * accounts and org_admin, who can otherwise see the rest of this dashboard. On 'forbidden'
 * this renders null — not an error, not an empty card — so the card's very existence stays
 * invisible to roles that must not read purchase@.
 */

interface Person {
    person: string;
    open: number;
    needs_reply: number;
    needs_action: number;
    waiting_days: number;
}

interface Thread {
    id: string;
    subject: string | null;
    from_address: string | null;
    category: string;
    waiting_days: number;
}

interface Payload {
    provisioned: boolean;
    filtered_by: string | null;
    totals: {
        threads: number; open: number; awaiting_reply: number;
        unactioned_request: number; resolved: number; oldest_days: number;
    } | null;
    people: Person[];
    oldest: Thread[];
}

/** The only two categories the API counts as open. Tokens only — no new colours. */
const CATEGORY = {
    awaiting_reply: { label: 'Needs a reply', colour: 'var(--warning)' },
    unactioned_request: { label: 'Nobody acted', colour: 'var(--info)' },
} as const;

const categoryOf = (c: string) =>
    c === 'awaiting_reply' ? CATEGORY.awaiting_reply : CATEGORY.unactioned_request;

/** dipti.walanj@vendor.co.in -> dipti.walanj. Full address stays in the title attribute. */
const shortAddress = (a: string | null) => (a || 'unknown').split('@')[0];

export default function MailDigestWidget({ orgId, size, onSeverity, onHeadline, onFetchedAt }: WidgetProps) {
    const [query, setQuery] = useState('');
    const [applied, setApplied] = useState('');

    // The filter is part of the cache key, so switching back to an earlier search is
    // instant and two cards on the same filter share one request.
    const url = orgId
        ? `/api/procurement/mailbox/summary?org_id=${orgId}&limit=10${applied ? `&from=${encodeURIComponent(applied)}` : ''}`
        : null;
    const { data, loading, error, fetchedAt } = useWidgetData<Payload>(url);

    const t = data?.totals ?? null;


    useEffect(() => { onFetchedAt?.(fetchedAt); }, [fetchedAt, onFetchedAt]);
    useEffect(() => {
        if (!data?.provisioned || !t) { onSeverity('ok'); onHeadline?.(null); return; }

        // A fortnight of silence on a purchase thread is a vendor relationship problem, not
        // an inbox problem — hence the jump straight to critical at 14 days.
        onSeverity(
            t.oldest_days >= 14 ? 'critical'
                : t.oldest_days >= 7 ? 'warn'
                    : t.open > 0 ? 'info' : 'ok',
        );

        onHeadline?.(
            t.open === 0
                ? applied ? `Nothing open from “${applied}”.` : 'Nothing is waiting on the purchase team.'
                : `${t.open} open — oldest waiting ${t.oldest_days}d · ${t.awaiting_reply} need a reply, ${t.unactioned_request} never actioned.`,
        );
    }, [data, t, applied, onSeverity, onHeadline]);

    if (loading) return <WidgetSkeleton lines={3} />;
    // Not permitted to read purchase@ — leak nothing, not even a placeholder.
    if (error === 'forbidden') return null;
    if (!data?.provisioned || !t) {
        return <WidgetEmpty>Mailbox digest has not run yet.</WidgetEmpty>;
    }

    const total = Math.max(1, t.awaiting_reply + t.unactioned_request);
    const stamp = `synced ${relativeTime(fetchedAt)}`;

    // sm — one question: is anything waiting?
    if (size === 'sm') {
        return (
            <div className="h-full flex flex-col justify-between">
                <Metric value={t.open} sub="mails waiting" size="sm" />
                {t.oldest_days > 0 && (
                    <span className="inline-flex items-center gap-1 text-[10px] font-bold tabular-nums"
                        style={{ color: t.oldest_days >= 7 ? 'var(--error)' : 'var(--text-tertiary)' }}>
                        <Clock className="w-2.5 h-2.5" />oldest {t.oldest_days}d
                    </span>
                )}
            </div>
        );
    }

    const wide = size === 'xl';

    return (
        <div className="h-full flex flex-col min-h-0">
            <div className="flex items-end justify-between gap-2">
                <Metric
                    value={t.open}
                    sub={`open of ${t.threads} thread${t.threads === 1 ? '' : 's'}${applied ? ` · from “${applied}”` : ''}`}
                    size={size}
                />
                <div className="flex flex-col items-end gap-1 flex-none">
                    {t.oldest_days > 0 && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-black tabular-nums"
                            style={{ color: t.oldest_days >= 7 ? 'var(--error)' : 'var(--text-tertiary)' }}>
                            <Clock className="w-2.5 h-2.5" />oldest {t.oldest_days}d
                        </span>
                    )}
                    <span className="text-[9px] font-bold text-text-tertiary" title="When this card last read the digest">
                        {stamp}
                    </span>
                </div>
            </div>

            {/* Split bar: the two open states on one shared scale, so the mix reads at a
                glance without needing to compare two separate numbers. */}
            <div className="mt-2.5">
                <div className="h-2 w-full rounded-full bg-muted overflow-hidden flex" role="presentation">
                    <div className="h-full transition-[width] duration-500"
                        style={{ width: `${(t.awaiting_reply / total) * 100}%`, background: CATEGORY.awaiting_reply.colour }} />
                    <div className="h-full transition-[width] duration-500"
                        style={{ width: `${(t.unactioned_request / total) * 100}%`, background: CATEGORY.unactioned_request.colour }} />
                </div>
                <div className="flex items-center gap-3 mt-1.5">
                    {([['awaiting_reply', t.awaiting_reply], ['unactioned_request', t.unactioned_request]] as const).map(([key, n]) => (
                        <span key={key} className="inline-flex items-center gap-1.5 text-[10px] font-bold text-text-secondary">
                            <span className="w-1.5 h-1.5 rounded-full flex-none" style={{ background: CATEGORY[key].colour }} />
                            <span className="tabular-nums">{n}</span> {CATEGORY[key].label.toLowerCase()}
                        </span>
                    ))}
                    {t.resolved > 0 && size !== 'md' && (
                        <span className="text-[10px] font-bold text-text-tertiary tabular-nums ml-auto">
                            {t.resolved} closed
                        </span>
                    )}
                </div>
            </div>

            {(size === 'lg' || size === 'xl') && (
                <>
                    {/* from: search — matches the sender AND the participant list server-side,
                        so a thread someone is merely on still surfaces under their name. */}
                    <form
                        className="relative mt-3 flex-none"
                        onSubmit={e => { e.preventDefault(); setApplied(query.trim()); }}
                    >
                        <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-text-tertiary" />
                        <input
                            value={query}
                            onChange={e => setQuery(e.target.value)}
                            placeholder="from: name or domain…"
                            aria-label="Filter mailbox threads by sender or participant"
                            className="w-full pl-8 pr-7 py-1.5 rounded-lg bg-surface border border-border text-text-primary text-[11px] font-semibold outline-none focus:border-primary transition-colors"
                        />
                        {applied && (
                            <button
                                type="button"
                                aria-label="Clear sender filter"
                                onClick={() => { setQuery(''); setApplied(''); }}
                                className="absolute right-2 top-1/2 -translate-y-1/2 text-text-tertiary hover:text-text-primary"
                            >
                                <X className="w-3.5 h-3.5" />
                            </button>
                        )}
                    </form>

                    <div className={`mt-2.5 flex-1 min-h-0 overflow-hidden ${wide ? 'grid grid-cols-[1.6fr_1fr] gap-4' : ''}`}>
                        {/* The subjects. This is the entire reason the widget exists. */}
                        <div className="min-w-0 overflow-hidden">
                            <p className="text-[9px] font-black uppercase tracking-widest text-text-tertiary mb-1">
                                Waiting longest
                            </p>
                            {data.oldest.length === 0 ? (
                                <p className="text-[11px] font-semibold text-text-tertiary">
                                    {applied ? `Nothing open from “${applied}”.` : 'Inbox zero on the purchase queue.'}
                                </p>
                            ) : (
                                <div className="divide-y divide-border-subtle">
                                    {data.oldest.slice(0, wide ? 5 : 3).map(m => {
                                        const cat = categoryOf(m.category);
                                        return (
                                            <div key={m.id} className="flex items-start gap-2 py-1.5 min-w-0">
                                                <span className="w-1.5 h-1.5 rounded-full flex-none mt-1.5"
                                                    style={{ background: cat.colour }}
                                                    title={cat.label} />
                                                <div className="min-w-0 flex-1">
                                                    <p className="text-[11px] font-bold text-text-primary truncate"
                                                        title={m.subject || undefined}>
                                                        {m.subject || '(no subject)'}
                                                    </p>
                                                    <p className="text-[10px] font-semibold text-text-tertiary truncate"
                                                        title={m.from_address || undefined}>
                                                        {shortAddress(m.from_address)} · {cat.label.toLowerCase()}
                                                    </p>
                                                </div>
                                                <span className="text-[10px] font-black tabular-nums flex-none pt-0.5"
                                                    style={{ color: m.waiting_days >= 14 ? 'var(--error)' : m.waiting_days >= 7 ? 'var(--warning)' : 'var(--text-tertiary)' }}>
                                                    {m.waiting_days}d
                                                </span>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>

                        {/* xl only — who the queue belongs to, so it can be handed out. */}
                        {wide && (
                            <div className="min-w-0 overflow-hidden border-l border-border-subtle pl-4">
                                <p className="text-[9px] font-black uppercase tracking-widest text-text-tertiary mb-1">
                                    Waiting on us
                                </p>
                                {data.people.length === 0 ? (
                                    <p className="text-[11px] font-semibold text-text-tertiary">Nobody.</p>
                                ) : (
                                    <div className="divide-y divide-border-subtle">
                                        {data.people.slice(0, 5).map(p => (
                                            <div key={p.person} className="flex items-center gap-2 py-1.5 min-w-0">
                                                <span className="text-[11px] font-bold text-text-secondary truncate flex-1"
                                                    title={p.person}>
                                                    {shortAddress(p.person)}
                                                </span>
                                                <span className="text-[10px] font-semibold text-text-tertiary tabular-nums flex-none">
                                                    {p.waiting_days}d
                                                </span>
                                                <span className="text-[11px] font-black tabular-nums flex-none text-text-primary">
                                                    {p.open}
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </>
            )}
        </div>
    );
}
