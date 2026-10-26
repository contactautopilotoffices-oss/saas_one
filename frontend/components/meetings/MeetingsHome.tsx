'use client';

/**
 * MEETINGS — the list, and starting a new one.
 *
 * First topic: a review of purchase orders stuck at "pending approval". The
 * agenda is built from Zoho when the meeting is created, sorted by value, and
 * Ira runs it in the room. Approvers start meetings; the purchase team and
 * accounts join them.
 *
 * Rendered both as the org dashboard's Meetings tab (`embedded`, the dashboard
 * supplies the page title) and as a standalone page for other roles.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Check, ChevronDown, Copy, Loader2, Mic, Play, SlidersHorizontal } from 'lucide-react';

interface MeetingRow {
    id: string; title: string; topic: string; agent_slug: string;
    status: 'scheduled' | 'live' | 'ended';
    created_at: string; started_at: string | null; ended_at: string | null; items: number;
}
interface Payload { provisioned: boolean; can_host: boolean; setup: string[]; meetings: MeetingRow[]; note?: string; error?: string }

const STATUS = {
    scheduled: { label: 'Not started', cls: 'text-text-secondary border-border', action: 'Open' },
    live: { label: 'Live now', cls: 'text-emerald-700 border-emerald-500/40 bg-emerald-500/8', action: 'Join' },
    ended: { label: 'Ended', cls: 'text-text-tertiary border-border', action: 'View notes' },
} as const;

const STEPS = [
    'Start a review. Ira lists the stuck POs, biggest first.',
    'Share the link with the purchase team and accounts.',
    'Ira walks each PO. You confirm her notes after.',
];

const when = (iso: string) =>
    new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

const inputCls = 'w-20 rounded-lg border border-border bg-card px-2.5 py-2 text-[13px] focus:border-primary/40 focus:outline-none';

export default function MeetingsHome({ orgId, embedded = false }: { orgId: string; embedded?: boolean }) {
    const router = useRouter();
    const [data, setData] = useState<Payload | null>(null);
    const [minDays, setMinDays] = useState(30);
    const [limit, setLimit] = useState(15);
    const [title, setTitle] = useState('');
    const [showOptions, setShowOptions] = useState(false);
    const [creating, setCreating] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [copied, setCopied] = useState<string | null>(null);

    const load = useCallback(async () => {
        const res = await fetch(`/api/meetings?org_id=${encodeURIComponent(orgId)}`, { cache: 'no-store' });
        const j = await res.json().catch(() => null);
        if (!res.ok) { setData({ provisioned: false, can_host: false, setup: [], meetings: [], error: j?.error ?? `HTTP ${res.status}` }); return; }
        setData(j);
    }, [orgId]);
    useEffect(() => { void load(); }, [load]);

    const create = async () => {
        setCreating(true); setError(null);
        try {
            const res = await fetch('/api/meetings', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ org_id: orgId, min_days: minDays, limit, title }),
            });
            const j = await res.json().catch(() => null);
            if (!res.ok || !j?.id) { setError(j?.error ?? `Could not create the meeting (HTTP ${res.status}).`); return; }
            router.push(`/${orgId}/meetings/${j.id}`);
        } finally { setCreating(false); }
    };

    const copyLink = async (id: string) => {
        try {
            await navigator.clipboard.writeText(`${window.location.origin}/${orgId}/meetings/${id}`);
            setCopied(id);
            setTimeout(() => setCopied((c) => (c === id ? null : c)), 1800);
        } catch { /* clipboard blocked — the Open link still works */ }
    };

    if (!data) {
        return <div className="flex items-center gap-2 p-6 text-sm text-text-secondary"><Loader2 className="h-4 w-4 animate-spin" /> Loading meetings…</div>;
    }

    const live = data.meetings.filter((m) => m.status === 'live');
    const rest = data.meetings.filter((m) => m.status !== 'live');

    return (
        <div className={`mx-auto flex max-w-3xl flex-col gap-5 ${embedded ? '' : 'p-4 md:p-6'}`}>
            {!embedded && (
                <header>
                    <h1 className="flex items-center gap-2 text-xl font-bold text-foreground"><Mic className="h-5 w-5" /> Meetings</h1>
                    <p className="mt-1 text-[13px] text-text-secondary">Meeting rooms with Ira, our agent, in the room.</p>
                </header>
            )}

            {(data.error || data.note || data.setup.length > 0) && (
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/8 px-3.5 py-3 text-[12px] leading-relaxed text-amber-900">
                    <AlertTriangle className="mr-1.5 inline h-3.5 w-3.5" />
                    <b>Not ready yet.</b>
                    <ul className="mt-1.5 space-y-1">
                        {data.error && <li>· {data.error}</li>}
                        {data.note && <li>· {data.note}</li>}
                        {data.setup.map((s) => <li key={s}>· {s}</li>)}
                    </ul>
                </div>
            )}

            {live.length > 0 && (
                <section className="flex flex-col gap-2">
                    {live.map((m) => (
                        <Link key={m.id} href={`/${orgId}/meetings/${m.id}`}
                            className="flex items-center gap-3 rounded-2xl border border-emerald-500/40 bg-emerald-500/8 px-4 py-3.5 hover:border-emerald-500/70">
                            <span className="relative flex h-2.5 w-2.5">
                                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-60" />
                                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
                            </span>
                            <span className="text-[14px] font-semibold text-foreground">{m.title}</span>
                            <span className="text-[12px] text-emerald-800">is live</span>
                            <span className="ml-auto rounded-xl bg-emerald-600 px-3.5 py-1.5 text-xs font-bold text-white">Join now</span>
                        </Link>
                    ))}
                </section>
            )}

            {data.provisioned && data.can_host && (
                <section className="rounded-2xl border border-border bg-card p-5">
                    <div className="flex flex-wrap items-center gap-4">
                        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                            <Mic className="h-5 w-5" />
                        </div>
                        <div className="min-w-0 flex-1">
                            <h2 className="text-[15px] font-semibold text-foreground">PO approvals review</h2>
                            <p className="mt-0.5 text-[12.5px] text-text-secondary">
                                Ira reviews POs waiting {minDays}+ days, up to {limit}. She never approves or cancels anything herself.
                            </p>
                        </div>
                        <button type="button" onClick={() => void create()} disabled={creating}
                            className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2.5 text-[13px] font-bold text-white hover:opacity-90 disabled:opacity-50">
                            {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                            {creating ? 'Building agenda…' : 'Start review'}
                        </button>
                    </div>

                    <button type="button" onClick={() => setShowOptions((v) => !v)}
                        className="mt-3 inline-flex items-center gap-1 text-[12px] font-medium text-text-tertiary hover:text-foreground">
                        <SlidersHorizontal className="h-3.5 w-3.5" /> Options
                        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showOptions ? 'rotate-180' : ''}`} />
                    </button>
                    {showOptions && (
                        <div className="mt-3 grid gap-3 rounded-xl border border-border bg-card-tint p-3 sm:grid-cols-3">
                            <label className="text-[12px] text-text-secondary">
                                Waiting at least
                                <div className="mt-1 flex items-center gap-2">
                                    <input type="number" min={0} max={365} value={minDays} onChange={(e) => setMinDays(Number(e.target.value))} className={inputCls} />
                                    <span>days</span>
                                </div>
                            </label>
                            <label className="text-[12px] text-text-secondary">
                                At most
                                <div className="mt-1 flex items-center gap-2">
                                    <input type="number" min={1} max={30} value={limit} onChange={(e) => setLimit(Number(e.target.value))} className={inputCls} />
                                    <span>POs</span>
                                </div>
                            </label>
                            <label className="text-[12px] text-text-secondary">
                                Title
                                <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="PO approvals review"
                                    className="mt-1 w-full rounded-lg border border-border bg-card px-2.5 py-2 text-[13px] focus:border-primary/40 focus:outline-none" />
                            </label>
                        </div>
                    )}
                    {error && <p className="mt-2 text-[12px] text-red-700">{error}</p>}

                    <ol className="mt-4 grid gap-2 border-t border-border pt-4 sm:grid-cols-3">
                        {STEPS.map((s, i) => (
                            <li key={s} className="flex gap-2 text-[12px] leading-snug text-text-secondary">
                                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-bold text-foreground">{i + 1}</span>
                                {s}
                            </li>
                        ))}
                    </ol>
                </section>
            )}

            <section>
                <h2 className="mb-2 px-1 text-[12px] font-semibold uppercase tracking-wide text-text-tertiary">Past and upcoming</h2>
                <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
                    {rest.map((m) => (
                        <li key={m.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                            <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                    <span className="truncate text-[13.5px] font-semibold text-foreground">{m.title}</span>
                                    <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10.5px] font-bold ${STATUS[m.status].cls}`}>{STATUS[m.status].label}</span>
                                </div>
                                <p className="mt-0.5 text-[11.5px] text-text-tertiary">{m.items} POs · {when(m.created_at)}</p>
                            </div>
                            {m.status !== 'ended' && (
                                <button type="button" onClick={() => void copyLink(m.id)}
                                    className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-[12px] font-medium text-text-secondary hover:text-foreground">
                                    {copied === m.id ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                                    {copied === m.id ? 'Copied' : 'Copy link'}
                                </button>
                            )}
                            <Link href={`/${orgId}/meetings/${m.id}`}
                                className="rounded-lg bg-muted px-3 py-1.5 text-[12px] font-bold text-foreground hover:bg-primary hover:text-white">
                                {STATUS[m.status].action}
                            </Link>
                        </li>
                    ))}
                    {!rest.length && (
                        <li className="px-4 py-6 text-center text-[12.5px] text-text-secondary">
                            No meetings yet.{data.can_host ? ' Start your first review above.' : ' An approver starts them.'}
                        </li>
                    )}
                </ul>
            </section>
        </div>
    );
}
