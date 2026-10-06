'use client';

/**
 * MEETINGS — the list, and starting a new one.
 *
 * First topic: a review of purchase orders stuck at "pending approval". The
 * agenda is built from Zoho when the meeting is created, sorted by value, and
 * Ira runs it in the room. Approvers start meetings; the purchase team and
 * accounts join them.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertTriangle, CalendarClock, Loader2, Mic, Plus } from 'lucide-react';

interface MeetingRow {
    id: string; title: string; topic: string; agent_slug: string;
    status: 'scheduled' | 'live' | 'ended';
    created_at: string; started_at: string | null; ended_at: string | null; items: number;
}
interface Payload { provisioned: boolean; can_host: boolean; setup: string[]; meetings: MeetingRow[]; note?: string; error?: string }

const STATUS = {
    scheduled: { label: 'Not started', cls: 'text-text-secondary border-border' },
    live: { label: 'Live', cls: 'text-emerald-700 border-emerald-500/40 bg-emerald-500/8' },
    ended: { label: 'Ended', cls: 'text-text-tertiary border-border' },
} as const;

const when = (iso: string) =>
    new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

export default function MeetingsHome({ orgId }: { orgId: string }) {
    const router = useRouter();
    const [data, setData] = useState<Payload | null>(null);
    const [minDays, setMinDays] = useState(30);
    const [limit, setLimit] = useState(15);
    const [title, setTitle] = useState('');
    const [creating, setCreating] = useState(false);
    const [error, setError] = useState<string | null>(null);

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

    if (!data) {
        return <div className="flex items-center gap-2 p-6 text-sm text-text-secondary"><Loader2 className="h-4 w-4 animate-spin" /> Loading meetings…</div>;
    }

    return (
        <div className="mx-auto flex max-w-4xl flex-col gap-4 p-4 md:p-6">
            <header>
                <h1 className="flex items-center gap-2 text-xl font-bold text-foreground"><Mic className="h-5 w-5" /> Meetings</h1>
                <p className="mt-1 text-[13px] leading-relaxed text-text-secondary">
                    Meeting rooms inside FMS, with one of our agents in the room. Ira runs the PO review: she reads each
                    stuck purchase order, asks who owns it and what should happen, and writes the decision down for an
                    approver to confirm afterwards. She never approves or cancels anything herself.
                </p>
            </header>

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

            {data.provisioned && data.can_host && (
                <section className="rounded-[14px] border border-border bg-card p-4">
                    <h2 className="mb-3 flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide text-text-tertiary">
                        <Plus className="h-3.5 w-3.5" /> New PO review
                    </h2>
                    <div className="grid gap-3 sm:grid-cols-3">
                        <label className="text-[12px] text-text-secondary">
                            Waiting at least
                            <div className="mt-1 flex items-center gap-2">
                                <input type="number" min={0} max={365} value={minDays} onChange={(e) => setMinDays(Number(e.target.value))}
                                    className="w-20 rounded-lg border border-border bg-card px-2.5 py-2 text-[13px] focus:border-primary/40 focus:outline-none" />
                                <span>days</span>
                            </div>
                        </label>
                        <label className="text-[12px] text-text-secondary">
                            At most
                            <div className="mt-1 flex items-center gap-2">
                                <input type="number" min={1} max={30} value={limit} onChange={(e) => setLimit(Number(e.target.value))}
                                    className="w-20 rounded-lg border border-border bg-card px-2.5 py-2 text-[13px] focus:border-primary/40 focus:outline-none" />
                                <span>POs, largest first</span>
                            </div>
                        </label>
                        <label className="text-[12px] text-text-secondary">
                            Title (optional)
                            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="PO approvals review"
                                className="mt-1 w-full rounded-lg border border-border bg-card px-2.5 py-2 text-[13px] focus:border-primary/40 focus:outline-none" />
                        </label>
                    </div>
                    {error && <p className="mt-2 text-[12px] text-red-700">{error}</p>}
                    <button type="button" onClick={() => void create()} disabled={creating}
                        className="mt-3 inline-flex items-center gap-1.5 rounded-xl bg-primary px-3.5 py-2 text-xs font-bold text-white hover:opacity-90 disabled:opacity-50">
                        {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} Build agenda and create
                    </button>
                    <span className="ml-2 text-[11px] text-text-tertiary">Then share the meeting link with the people who should be in the room.</span>
                </section>
            )}

            <section className="rounded-[14px] border border-border bg-card p-4">
                <h2 className="mb-3 flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide text-text-tertiary">
                    <CalendarClock className="h-3.5 w-3.5" /> Meetings
                </h2>
                <ul className="space-y-2">
                    {data.meetings.map((m) => (
                        <li key={m.id}>
                            <Link href={`/${orgId}/meetings/${m.id}`}
                                className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card-tint px-3.5 py-3 hover:border-primary/30">
                                <span className="text-[13px] font-semibold text-foreground">{m.title}</span>
                                <span className={`rounded-full border px-2 py-0.5 text-[10.5px] font-bold ${STATUS[m.status].cls}`}>{STATUS[m.status].label}</span>
                                <span className="ml-auto text-[11.5px] text-text-tertiary">{m.items} items · {when(m.created_at)}</span>
                            </Link>
                        </li>
                    ))}
                    {!data.meetings.length && (
                        <li className="rounded-xl border border-dashed border-border px-3.5 py-3 text-[12px] text-text-secondary">
                            No meetings yet.{data.can_host ? ' Create the first PO review above.' : ' An approver starts them.'}
                        </li>
                    )}
                </ul>
            </section>
        </div>
    );
}
