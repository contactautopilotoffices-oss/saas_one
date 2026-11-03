'use client';

/**
 * MAIL ARCHIVE — which mailboxes are being archived, and how far along each is.
 * -----------------------------------------------------------------------------
 * The intake half of the organisational brain, sandboxed to a few mailboxes.
 * Super admins only: the API answers 403 to anyone else and this renders
 * nothing. Counts and health only — no email is ever shown here.
 */

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Archive, Check, Clock, Loader2, Pause, Play, Plus, RefreshCw } from 'lucide-react';

interface Mailbox {
    id: string; address: string; is_active: boolean; connected: boolean;
    listed: number | null;
    bodies: { done: number | null; pending: number | null; failed: number | null };
    oldest_at: string | null; newest_at: string | null; history_done: boolean;
    last_run_at: string | null; last_ok_at: string | null; last_error: string | null;
}
interface Payload { provisioned: boolean; mailboxes: Mailbox[]; unique_emails_with_text?: number | null; note?: string }

const day = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
const ago = (iso: string | null) => {
    if (!iso) return 'never';
    const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
    return m < 60 ? `${m}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`;
};
const n = (x: number | null | undefined) => (x == null ? '—' : x.toLocaleString('en-IN'));

/** One plain sentence for where a mailbox stands, and whether that is a problem. */
function status(m: Mailbox): { text: string; tone: 'ok' | 'busy' | 'warn' | 'bad' } {
    if (!m.is_active) return { text: 'Paused', tone: 'warn' };
    if (!m.connected) return { text: 'Waiting for the owner to connect this mailbox', tone: 'warn' };
    const stale = m.last_run_at && Date.now() - Date.parse(m.last_run_at) > 60 * 60_000;
    if (!m.last_run_at || stale) return { text: `No run for ${ago(m.last_run_at)} — the 15-minute job is not running`, tone: 'bad' };
    if (m.last_error && m.last_ok_at !== m.last_run_at) return { text: m.last_error, tone: 'bad' };
    if (!m.history_done) return { text: `Reading history — back to ${day(m.oldest_at)} so far`, tone: 'busy' };
    if ((m.bodies.pending ?? 0) > 0) return { text: `History listed. Saving email text — ${n(m.bodies.pending)} to go`, tone: 'busy' };
    return { text: 'Up to date', tone: 'ok' };
}

const TONE = {
    ok: 'text-emerald-700',
    busy: 'text-primary',
    warn: 'text-amber-800',
    bad: 'text-red-700',
} as const;

export default function MailArchivePanel({ orgId }: { orgId: string }) {
    const [data, setData] = useState<Payload | null>(null);
    const [hidden, setHidden] = useState(false);
    const [busy, setBusy] = useState<string | null>(null);
    const [adding, setAdding] = useState('');
    const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

    const load = useCallback(async () => {
        const res = await fetch(`/api/mail-archive?org_id=${encodeURIComponent(orgId)}`, { cache: 'no-store' });
        if (res.status === 401 || res.status === 403) { setHidden(true); return; }
        const j = await res.json().catch(() => null);
        setData(j && Array.isArray(j.mailboxes) ? j : { provisioned: false, mailboxes: [], note: j?.error ?? 'Could not load the archive.' });
    }, [orgId]);
    useEffect(() => { void load(); }, [load]);

    const act = async (address: string, action: 'add' | 'pause' | 'resume') => {
        setBusy(address);
        try {
            const res = await fetch(`/api/mail-archive?org_id=${encodeURIComponent(orgId)}`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ address, action }),
            });
            const j = await res.json().catch(() => null);
            setNote(j?.error ? { ok: false, text: j.error } : { ok: true, text: j?.note ?? 'Done.' });
            if (!j?.error && action === 'add') setAdding('');
            await load();
        } finally { setBusy(null); }
    };

    if (hidden) return null;
    if (!data) {
        return <div className="flex items-center gap-2 p-4 text-sm text-text-secondary"><Loader2 className="h-4 w-4 animate-spin" /> Loading the mail archive…</div>;
    }

    return (
        <section className="rounded-[14px] border border-border bg-card p-4">
            <div className="mb-1 flex items-center gap-2">
                <h4 className="flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide text-text-tertiary">
                    <Archive className="h-3.5 w-3.5" /> Mail archive &middot; sandbox
                </h4>
                <button type="button" onClick={() => void load()} title="Refresh"
                    className="ml-auto rounded-lg p-1 text-text-tertiary hover:text-foreground">
                    <RefreshCw className="h-3.5 w-3.5" />
                </button>
            </div>
            <p className="mb-3 text-[11.5px] leading-relaxed text-text-secondary">
                Every email in these mailboxes, past and new, read every 15 minutes and stored once. Nobody can read the
                stored mail through FMS yet; this shows progress only. Super admins only.
                {data.unique_emails_with_text != null && <> <b>{n(data.unique_emails_with_text)}</b> unique emails saved with their text.</>}
            </p>

            {!data.provisioned && (
                <div className="mb-3 rounded-xl border border-amber-500/30 bg-amber-500/8 px-3.5 py-3 text-[11.5px] text-amber-900">
                    <AlertTriangle className="mr-1.5 inline h-3.5 w-3.5" />
                    {data.note ?? 'Apply supabase/migrations/20261006000002_mail_archive.sql.'}
                </div>
            )}

            {note && (
                <div className={`mb-3 rounded-xl border px-3 py-2 text-[11.5px] ${note.ok ? 'border-emerald-500/30 bg-emerald-500/8 text-emerald-800' : 'border-red-500/30 bg-red-500/8 text-red-700'}`}>
                    {note.text}
                </div>
            )}

            <ul className="mb-3 space-y-2">
                {data.mailboxes.map((m) => {
                    const s = status(m);
                    return (
                        <li key={m.id} className="rounded-xl border border-border bg-card-tint px-3.5 py-3">
                            <div className="flex flex-wrap items-center gap-2">
                                <span className="text-[13px] font-semibold text-foreground">{m.address}</span>
                                <button type="button" disabled={busy === m.address}
                                    onClick={() => void act(m.address, m.is_active ? 'pause' : 'resume')}
                                    className="ml-auto inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-[11px] font-semibold text-text-secondary hover:text-foreground disabled:opacity-50">
                                    {busy === m.address ? <Loader2 className="h-3 w-3 animate-spin" />
                                        : m.is_active ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
                                    {m.is_active ? 'Pause' : 'Resume'}
                                </button>
                            </div>
                            <div className={`mt-1.5 flex items-start gap-1.5 text-[11.5px] leading-relaxed ${TONE[s.tone]}`}>
                                {s.tone === 'ok' ? <Check className="mt-0.5 h-3 w-3 shrink-0" />
                                    : s.tone === 'busy' ? <Clock className="mt-0.5 h-3 w-3 shrink-0" />
                                        : <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />}
                                <span>{s.text}</span>
                            </div>
                            {m.connected && (
                                <div className="mt-1 text-[11.5px] tabular-nums text-text-secondary">
                                    {n(m.listed)} emails listed &middot; {n(m.bodies.done)} with text &middot; {n(m.bodies.pending)} waiting
                                    {(m.bodies.failed ?? 0) > 0 && <> &middot; <span className="text-red-700">{n(m.bodies.failed)} failed</span></>}
                                    <span className="text-text-tertiary"> &middot; newest {day(m.newest_at)} &middot; last run {ago(m.last_run_at)}</span>
                                </div>
                            )}
                        </li>
                    );
                })}
            </ul>

            {data.provisioned && (
                <div className="flex flex-wrap gap-2">
                    <input value={adding} onChange={(e) => setAdding(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter' && adding.trim()) void act(adding.trim(), 'add'); }}
                        placeholder="name@worksquare.in"
                        className="min-w-[240px] flex-1 rounded-lg border border-border bg-card px-3 py-2 font-mono text-[12px] focus:border-primary/40 focus:outline-none" />
                    <button type="button" disabled={!adding.trim() || busy === adding.trim()}
                        onClick={() => void act(adding.trim(), 'add')}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-xs font-semibold text-text-secondary hover:text-foreground disabled:opacity-50">
                        <Plus className="h-3.5 w-3.5" /> Add to archive
                    </button>
                </div>
            )}
        </section>
    );
}
