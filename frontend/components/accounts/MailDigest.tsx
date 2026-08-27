'use client';

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useParams } from 'next/navigation';
import { Mail, MessageSquare, PackageOpen, Inbox, Check, RotateCcw, RefreshCw, Clock, Paperclip } from 'lucide-react';
import { useAuth } from '@/frontend/context/AuthContext';
import { createClient } from '@/frontend/utils/supabase/client';
import { accountsCaps } from '@/frontend/lib/accounts/roles';

// Digest of the shared purchase@ mailbox. Rows are written by the cron
// (/api/cron/sync-purchase-mailbox) and read through a role-scoped RLS SELECT policy.
// The resolve toggle goes through /api/accounts/mailbox/[id] under the service role, so
// the write is role-checked and resolved_at is stamped server-side.

type Category = 'awaiting_reply' | 'unactioned_request' | 'no_discovery' | 'other';

interface MailThread {
    id: string;
    thread_id: string;
    subject: string | null;
    from_address: string | null;
    participants: string[] | null;
    last_message_at: string | null;
    message_count: number;
    snippet: string | null;
    category: Category;
    waiting_on: string | null;
    classified_by: string | null;
    is_resolved: boolean;
}

// The digest is a queue, not a report, so a bounded page is enough — but the page is
// paired with a server-side `count` below so an overflow is surfaced rather than silently
// truncated (PostgREST would cap this at 1000 rows regardless).
const PAGE_SIZE = 300;

const SECTIONS: { key: Category; label: string; blurb: string; color: string; icon: React.ElementType }[] = [
    { key: 'awaiting_reply', label: 'Needs a reply from you', blurb: 'Someone asked and the mailbox has not answered.', color: '#F97316', icon: MessageSquare },
    { key: 'unactioned_request', label: 'Requests with no action', blurb: 'Someone needs an item and nobody has picked it up.', color: '#EAB308', icon: PackageOpen },
    { key: 'no_discovery', label: 'Shared, no discovery started', blurb: 'Something landed and no conversation followed.', color: '#6366F1', icon: Inbox },
    { key: 'other', label: 'Everything else', blurb: 'Already handled or nothing pending.', color: '#94A3B8', icon: Mail },
];

export default function MailDigest() {
    const { membership } = useAuth();
    const params = useParams();
    const orgId = (params?.orgId as string | undefined) || membership?.org_id || undefined;
    const caps = useMemo(() => accountsCaps(membership), [membership]);
    const [supabase] = useState(() => createClient());

    const [threads, setThreads] = useState<MailThread[]>([]);
    const [total, setTotal] = useState(0);
    const [resolvedCount, setResolvedCount] = useState(0);
    const [loading, setLoading] = useState(true);
    const [unavailable, setUnavailable] = useState(false);
    const [showResolved, setShowResolved] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const fetchThreads = useCallback(async (opts?: { quiet?: boolean }) => {
        if (!orgId) { setLoading(false); return; }
        // A realtime-triggered refetch must not blank the list into skeletons — a cron run
        // upserts up to 300 rows and would otherwise thrash the whole digest.
        if (!opts?.quiet) setLoading(true);
        const { data, count, error: err } = await supabase
            .from('mailbox_threads')
            .select(
                'id, thread_id, subject, from_address, participants, last_message_at, message_count, snippet, category, waiting_on, classified_by, is_resolved',
                { count: 'exact' },
            )
            .eq('organization_id', orgId)
            .order('last_message_at', { ascending: false, nullsFirst: false })
            .range(0, PAGE_SIZE - 1);

        // Resolved threads are the oldest ones, so they fall off the page above first —
        // counting them server-side keeps the "Show resolved" tally honest.
        const { count: resolved } = await supabase
            .from('mailbox_threads')
            .select('id', { count: 'exact', head: true })
            .eq('organization_id', orgId)
            .eq('is_resolved', true);

        // Only "table does not exist" means the digest was never provisioned. Any other
        // failure (expired JWT, network blip) is a real error and must not masquerade as
        // setup instructions for an integration that is in fact running.
        if (err) {
            const notProvisioned = err.code === '42P01' || err.code === 'PGRST205';
            setUnavailable(notProvisioned);
            if (!notProvisioned) setError('Could not load the mailbox digest. Try refreshing.');
            setThreads([]); setTotal(0); setResolvedCount(0);
        } else {
            setUnavailable(false);
            setError(null);
            setThreads((data as MailThread[]) || []);
            setTotal(count || 0);
            setResolvedCount(resolved || 0);
        }
        setLoading(false);
    }, [orgId, supabase]);

    useEffect(() => { fetchThreads(); }, [fetchThreads]);

    // mailbox_threads is in the realtime publication precisely so a thread one teammate
    // ticks off leaves everyone else's digest, and the 4-hourly cron lands without a reload.
    // Debounced at 400ms (the house pattern, AccountsDashboard.tsx:131) because one cron
    // run emits up to 300 row-change events and each would otherwise fire two queries.
    const fetchRef = useRef(fetchThreads);
    useEffect(() => { fetchRef.current = fetchThreads; });
    useEffect(() => {
        if (!orgId) return;
        let t: ReturnType<typeof setTimeout> | null = null;
        const bump = () => { if (t) clearTimeout(t); t = setTimeout(() => fetchRef.current({ quiet: true }), 400); };
        const channel = supabase
            .channel(`mail_digest_${orgId}`)
            .on('postgres_changes',
                { event: '*', schema: 'public', table: 'mailbox_threads', filter: `organization_id=eq.${orgId}` },
                bump)
            .subscribe();
        return () => { if (t) clearTimeout(t); supabase.removeChannel(channel); };
    }, [orgId, supabase]);

    // Routed through the service role so the write is role-checked and resolved_at is
    // stamped from the SERVER clock — the sync's reopen rule compares it against Zoho's
    // timestamps, so a skewed browser clock would resurrect the thread on every run.
    const toggleResolved = async (t: MailThread) => {
        const next = !t.is_resolved;
        setError(null);
        setThreads(prev => prev.map(x => x.id === t.id ? { ...x, is_resolved: next } : x));
        setResolvedCount(c => Math.max(0, c + (next ? 1 : -1)));
        try {
            const res = await fetch(`/api/accounts/mailbox/${t.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ is_resolved: next, ...(orgId ? { organization_id: orgId } : {}) }),
            });
            if (!res.ok) throw new Error('failed');
        } catch {
            setThreads(prev => prev.map(x => x.id === t.id ? { ...x, is_resolved: t.is_resolved } : x));
            setResolvedCount(c => Math.max(0, c + (next ? -1 : 1)));
            setError('Could not update that thread.');
        }
    };

    const visible = useMemo(
        () => threads.filter(t => showResolved || !t.is_resolved),
        [threads, showResolved],
    );
    const grouped = useMemo(() => {
        const map = new Map<Category, MailThread[]>(SECTIONS.map(s => [s.key, [] as MailThread[]]));
        for (const t of visible) map.get(t.category)?.push(t);
        return map;
    }, [visible]);

    if (!caps.canSee) return <div className="text-center py-20 text-text-secondary">The purchase mailbox digest isn’t available for your role.</div>;

    return (
        <div className="space-y-5">
            <div className="flex items-center justify-between gap-3 flex-wrap">
                <div>
                    <h2 className="text-xl font-bold text-text-primary flex items-center gap-2">
                        <Mail className="w-5 h-5 text-primary" /> Purchase Mailbox
                    </h2>
                    <p className="text-sm text-text-secondary mt-0.5">What the shared inbox is still waiting on you for.</p>
                </div>
                <div className="flex items-center gap-2">
                    {resolvedCount > 0 && (
                        <button onClick={() => setShowResolved(v => !v)}
                            className="px-3 py-2 border border-border rounded-xl text-xs font-bold text-text-secondary hover:bg-surface-elevated">
                            {showResolved ? 'Hide' : 'Show'} resolved ({resolvedCount})
                        </button>
                    )}
                    <button onClick={() => fetchThreads()} title="Refresh" className="p-2 text-text-tertiary hover:text-text-primary">
                        <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                    </button>
                </div>
            </div>

            {error && <p className="text-xs text-red-500">{error}</p>}

            {!loading && threads.length < total && (
                <p className="text-xs text-text-tertiary">
                    Showing the {threads.length} most recent of {total} threads — resolve some to see older ones.
                </p>
            )}

            {loading ? (
                <div className="space-y-2">
                    {[...Array(4)].map((_, i) => <div key={i} className="h-16 bg-muted rounded-xl animate-pulse" />)}
                </div>
            ) : unavailable ? (
                <NotConnected />
            ) : threads.length === 0 ? (
                <div className="bg-surface rounded-xl border border-border px-6 py-14 text-center">
                    <Inbox className="w-10 h-10 mx-auto mb-3 text-text-tertiary" />
                    <p className="font-bold text-text-primary">Nothing waiting on the team right now</p>
                    <p className="text-sm text-text-secondary mt-1.5">
                        No purchase-mailbox threads need an answer or an action in the last few weeks.
                    </p>
                </div>
            ) : (
                <div className="space-y-6">
                    {SECTIONS.map(section => {
                        const rows = grouped.get(section.key) || [];
                        const Icon = section.icon;
                        return (
                            <section key={section.key}>
                                <div className="flex items-center gap-2 mb-2">
                                    <Icon className="w-4 h-4" style={{ color: section.color }} />
                                    <h3 className="text-sm font-bold text-text-primary">{section.label}</h3>
                                    <span className="px-2 py-0.5 rounded-full text-xs font-bold"
                                        style={{ color: section.color, backgroundColor: `${section.color}1A` }}>{rows.length}</span>
                                </div>
                                {rows.length === 0 ? (
                                    <p className="text-xs text-text-tertiary pl-6">{section.blurb} Nothing here right now.</p>
                                ) : (
                                    <div className="bg-surface rounded-xl border border-border divide-y divide-border overflow-hidden">
                                        {rows.map(t => <ThreadRow key={t.id} thread={t} accent={section.color} onToggle={() => toggleResolved(t)} />)}
                                    </div>
                                )}
                            </section>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

function ThreadRow({ thread, accent, onToggle }: { thread: MailThread; accent: string; onToggle: () => void }) {
    const waiting = thread.waiting_on || thread.from_address || 'Unassigned';
    return (
        <div className={`flex items-start gap-3 px-4 py-3 hover:bg-surface-elevated transition-colors ${thread.is_resolved ? 'opacity-55' : ''}`}>
            <span className="mt-1.5 w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: accent }} />
            <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-text-primary truncate">{thread.subject || '(no subject)'}</p>
                {thread.snippet && <p className="text-xs text-text-secondary mt-0.5 line-clamp-2">{thread.snippet}</p>}
                <div className="flex items-center gap-3 flex-wrap mt-1.5 text-xs text-text-tertiary">
                    <span className="truncate max-w-[220px]">Waiting on <span className="font-bold text-text-secondary">{waiting}</span></span>
                    {thread.from_address && <span className="truncate max-w-[220px]">from {thread.from_address}</span>}
                    <span className="inline-flex items-center gap-1 whitespace-nowrap"><Clock className="w-3 h-3" /> {age(thread.last_message_at)}</span>
                    <span className="inline-flex items-center gap-1 whitespace-nowrap"><Paperclip className="w-3 h-3" /> {thread.message_count} msg{thread.message_count === 1 ? '' : 's'}</span>
                </div>
            </div>
            <button onClick={onToggle}
                title={thread.is_resolved ? 'Reopen thread' : 'Mark as handled'}
                className="shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 border border-border rounded-lg text-xs font-bold text-text-secondary hover:bg-surface hover:text-text-primary">
                {thread.is_resolved ? <><RotateCcw className="w-3.5 h-3.5" /> Reopen</> : <><Check className="w-3.5 h-3.5" /> Resolve</>}
            </button>
        </div>
    );
}

function NotConnected() {
    return (
        <div className="bg-surface rounded-xl border border-border px-6 py-14 text-center">
            <Mail className="w-10 h-10 mx-auto mb-3 text-text-tertiary" />
            <p className="font-bold text-text-primary">The purchase mailbox isn’t connected yet</p>
            <p className="text-sm text-text-secondary mt-1.5 max-w-md mx-auto">
                Once purchase@worksquare.in is linked over Zoho Mail, threads waiting on the team show up here
                grouped by what they need — an answer, an action, or a first response.
            </p>
            <p className="text-xs text-text-tertiary mt-3">
                Setup: add the ZOHO_MAIL_* credentials, then the digest refreshes every 4 hours.
            </p>
        </div>
    );
}

// Ages read better than dates for a "how stale is this" list.
function age(iso: string | null): string {
    if (!iso) return '—';
    const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.round(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.round(hours / 24);
    return days < 30 ? `${days}d ago` : `${Math.round(days / 30)}mo ago`;
}
