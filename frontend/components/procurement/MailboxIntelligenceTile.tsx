'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Mail, Clock, Search, X } from 'lucide-react';

/**
 * "Who is waiting on the purchase team" — the mailbox digest condensed to a dashboard tile.
 *
 * Reads /api/procurement/mailbox/summary, which enforces the procurement/super-admin
 * restriction server-side. This component renders nothing at all when the caller is not
 * permitted (403) or the digest is not provisioned, so it can be dropped onto a shared
 * dashboard without leaking its existence to roles that must not see it.
 */

interface Person {
    person: string;
    open: number;
    needs_reply: number;
    needs_action: number;
    waiting_days: number;
}

interface Summary {
    provisioned: boolean;
    filtered_by: string | null;
    totals: {
        threads: number; open: number; awaiting_reply: number;
        unactioned_request: number; resolved: number; oldest_days: number;
    } | null;
    people: Person[];
}

export default function MailboxIntelligenceTile({ orgId, tone = 'light' }: { orgId?: string; tone?: 'light' | 'onYellow' }) {
    const [data, setData] = useState<Summary | null>(null);
    const [denied, setDenied] = useState(false);
    const [loading, setLoading] = useState(true);
    const [query, setQuery] = useState('');
    const [applied, setApplied] = useState('');

    const load = useCallback(async (from: string) => {
        setLoading(true);
        try {
            const qs = new URLSearchParams();
            if (orgId) qs.set('org_id', orgId);
            if (from) qs.set('from', from);
            const res = await fetch(`/api/procurement/mailbox/summary?${qs}`);
            if (res.status === 401 || res.status === 403) { setDenied(true); return; }
            if (!res.ok) { setData(null); return; }
            setData(await res.json());
        } catch { setData(null); }
        finally { setLoading(false); }
    }, [orgId]);

    useEffect(() => { load(applied); }, [load, applied]);

    const onYellow = tone === 'onYellow';
    const c = useMemo(() => onYellow ? {
        label: 'text-slate-700', value: 'text-slate-900', muted: 'text-slate-600',
        row: 'bg-white/40 hover:bg-white/60', field: 'bg-white/50 placeholder:text-slate-500 text-slate-900',
    } : {
        label: 'text-text-secondary', value: 'text-text-primary', muted: 'text-text-tertiary',
        row: 'bg-surface-elevated hover:bg-muted', field: 'bg-surface border border-border text-text-primary',
    }, [onYellow]);

    // Not permitted, or the digest has never run — render nothing rather than an empty shell.
    if (denied || (!loading && (!data || !data.provisioned || !data.totals))) return null;
    if (loading && !data) {
        return <div className={`h-4 w-32 rounded animate-pulse ${onYellow ? 'bg-white/40' : 'bg-muted'}`} />;
    }

    const t = data!.totals!;
    const submit = (e: React.FormEvent) => { e.preventDefault(); setApplied(query.trim()); };

    return (
        <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                    <Mail className={`w-3.5 h-3.5 ${c.label}`} />
                    <span className={`text-xs font-bold ${c.label}`}>Purchase mailbox</span>
                </div>
                {t.oldest_days > 0 && (
                    <span className={`inline-flex items-center gap-1 text-[10px] font-bold ${t.oldest_days >= 7 ? 'text-red-600' : c.muted}`}>
                        <Clock className="w-3 h-3" />oldest {t.oldest_days}d
                    </span>
                )}
            </div>

            <div className="grid grid-cols-2 gap-3">
                <div>
                    <div className={`text-2xl font-black ${c.value} tabular-nums`}>{t.awaiting_reply}</div>
                    <div className={`text-[10px] font-bold ${c.muted}`}>need a reply</div>
                </div>
                <div>
                    <div className={`text-2xl font-black ${c.value} tabular-nums`}>{t.unactioned_request}</div>
                    <div className={`text-[10px] font-bold ${c.muted}`}>no action taken</div>
                </div>
            </div>

            <form onSubmit={submit} className="relative">
                <Search className={`w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 ${c.muted}`} />
                <input
                    value={query}
                    onChange={e => setQuery(e.target.value)}
                    placeholder="from: dipti.walanj@…"
                    aria-label="Filter mailbox threads by person"
                    className={`w-full pl-8 pr-7 py-1.5 rounded-lg text-xs font-medium outline-none ${c.field}`}
                />
                {applied && (
                    <button type="button" aria-label="Clear filter"
                        onClick={() => { setQuery(''); setApplied(''); }}
                        className={`absolute right-2 top-1/2 -translate-y-1/2 ${c.muted}`}>
                        <X className="w-3.5 h-3.5" />
                    </button>
                )}
            </form>

            <div className="space-y-1">
                {data!.people.slice(0, 5).map(p => (
                    <div key={p.person} className={`flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg transition-colors ${c.row}`}>
                        <span className={`text-[11px] font-bold truncate ${c.value}`}>{p.person.split('@')[0]}</span>
                        <span className={`text-[10px] font-medium shrink-0 ${c.muted} tabular-nums`}>
                            {p.open} open · {p.waiting_days}d
                        </span>
                    </div>
                ))}
                {data!.people.length === 0 && (
                    <p className={`text-[11px] ${c.muted}`}>
                        {applied ? `Nothing open from “${applied}”.` : 'Nothing waiting on the purchase team.'}
                    </p>
                )}
            </div>
        </div>
    );
}
