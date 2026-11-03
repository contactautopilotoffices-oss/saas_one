"use client";

import React, { useEffect, useRef, useState } from 'react';
import { Link2, RefreshCw, Check, X } from 'lucide-react';

/**
 * "Connect Zoho Tasks" — the signed-in person links their own Zoho account so their open Zoho Mail tasks are
 * copied into their list (read-only, every 15 minutes). Once connected it shows a small menu: Sync now / Disconnect.
 */

interface Status {
    connected: boolean;
    lastSyncAt: string | null;
    lastImported: number | null;
    lastError: string | null;
    ready: boolean;
}

function ago(iso: string | null): string {
    if (!iso) return 'never';
    const mins = Math.round((Date.now() - Date.parse(iso)) / 60_000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins} min ago`;
    const h = Math.round(mins / 60);
    return h < 24 ? `${h} h ago` : `${Math.round(h / 24)} d ago`;
}

export default function ZohoTasksButton({ onSynced }: { onSynced?: () => void }) {
    const [status, setStatus] = useState<Status | null>(null);
    const [open, setOpen] = useState(false);
    const [busy, setBusy] = useState(false);
    const [note, setNote] = useState<string | null>(null);
    const ref = useRef<HTMLDivElement>(null);

    const load = async () => {
        try {
            const r = await fetch('/api/task-manager/zoho', { cache: 'no-store' });
            const d = await r.json();
            if (d?.success) setStatus(d.status);
        } catch { /* the button simply stays in its last state */ }
    };

    useEffect(() => { void load(); }, []);
    // Coming back from the Zoho consent tab: refresh the status.
    useEffect(() => {
        const onFocus = () => { void load(); };
        window.addEventListener('focus', onFocus);
        return () => window.removeEventListener('focus', onFocus);
    }, []);
    useEffect(() => {
        if (!open) return;
        const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
        document.addEventListener('mousedown', close);
        return () => document.removeEventListener('mousedown', close);
    }, [open]);

    if (!status) return null;

    const btn = 'flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-600 transition-all duration-200 shadow-xs active:scale-[0.97]';

    if (!status.connected) {
        return (
            <a
                href="/api/task-manager/zoho/connect"
                target="_blank"
                rel="noopener"
                className={btn}
                title={status.ready ? 'Copy your Zoho Mail tasks into this list' : 'Setup incomplete — ask the Tech team to apply the Zoho Tasks SQL file'}
            >
                <Link2 className="w-3 h-3 text-zinc-400" />
                Connect Zoho Tasks
            </a>
        );
    }

    const syncNow = async () => {
        setBusy(true); setNote(null);
        try {
            const r = await fetch('/api/task-manager/zoho', { method: 'POST' });
            const d = await r.json();
            setNote(d?.success ? `${d.result?.imported ?? 0} new task(s) imported` : (d?.error || 'Sync failed'));
            if (d?.success) onSynced?.();
        } catch {
            setNote('Sync failed');
        } finally {
            setBusy(false);
            void load();
        }
    };

    const disconnect = async () => {
        if (!window.confirm('Disconnect Zoho Tasks? Tasks already imported stay in your list.')) return;
        setBusy(true);
        try { await fetch('/api/task-manager/zoho', { method: 'DELETE' }); } finally { setBusy(false); setOpen(false); void load(); }
    };

    return (
        <div className="relative" ref={ref}>
            <button onClick={() => setOpen(o => !o)} className={btn} title="Zoho Tasks">
                {status.lastError
                    ? <X className="w-3 h-3 text-red-500" />
                    : <Check className="w-3 h-3 text-emerald-500" />}
                Zoho Tasks
            </button>
            {open && (
                <div className="absolute right-0 mt-1 w-60 z-50 p-2.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-lg text-[11px] text-zinc-600 dark:text-zinc-300 space-y-2">
                    <div>
                        <div className="font-semibold text-zinc-900 dark:text-zinc-100">Connected</div>
                        <div>Last sync: {ago(status.lastSyncAt)}{status.lastImported != null ? ` · ${status.lastImported} new` : ''}</div>
                        {status.lastError && <div className="mt-1 text-red-600 dark:text-red-400 break-words">{status.lastError}</div>}
                        {note && <div className="mt-1 text-indigo-600 dark:text-indigo-300">{note}</div>}
                    </div>
                    <div className="flex gap-1.5">
                        <button onClick={syncNow} disabled={busy} className={`${btn} disabled:opacity-50`}>
                            <RefreshCw className={`w-3 h-3 ${busy ? 'animate-spin' : ''}`} /> Sync now
                        </button>
                        <button onClick={disconnect} disabled={busy} className={`${btn} disabled:opacity-50 text-red-600 dark:text-red-400`}>
                            Disconnect
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
