'use client';

import { useState } from 'react';
import { Check, Loader2, UserPlus, UserX, X } from 'lucide-react';
import type { GuestsView } from './api';

/**
 * Stage 2 (owner 2026-11-18): people without a login, for the team. Used on the meeting's page (light) and inside the
 * call (dark). Shows the people waiting with "Let in" / "Refuse", and guests already let in with "Remove". Since the
 * meeting has one link for everyone (owner 2026-11-18) there is no guest link to turn on or off. The server checks
 * every action; this only asks.
 */
export default function GuestPanel({ guests, onAction, dark = false }: {
    guests: GuestsView;
    /** Sends one action ({ action: 'guest_decide', guestId, decision }); resolves to an error sentence or null */
    onAction: (body: Record<string, unknown>) => Promise<string | null>;
    dark?: boolean;
}) {
    const [busy, setBusy] = useState<string | null>(null);
    const [note, setNote] = useState<string | null>(null);
    const waiting = guests.list.filter(g => g.state === 'waiting');
    const inCall = guests.list.filter(g => g.state === 'admitted');

    const run = async (label: string, body: Record<string, unknown>) => {
        setBusy(label);
        setNote(null);
        const err = await onAction(body);
        setBusy(null);
        if (err) setNote(err);
    };

    const t = dark
        ? { box: 'border-white/10 bg-white/5', text: 'text-zinc-200', soft: 'text-zinc-400', ghost: 'border-white/15 text-zinc-200 hover:bg-white/10' }
        : { box: 'border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-800/60', text: 'text-zinc-800 dark:text-zinc-200', soft: 'text-zinc-500', ghost: 'border-zinc-300 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800' };

    if (!waiting.length && !inCall.length) return null;

    return (
        <div className={`space-y-2 rounded-xl border p-3 ${t.box}`}>
            <span className={`flex items-center gap-1.5 text-xs font-black ${t.text}`}><UserPlus className="h-3.5 w-3.5" /> People without a login</span>

            {waiting.length > 0 && (
                <ul className="space-y-1.5" aria-label="Waiting to join">
                    {waiting.map(g => (
                        <li key={g.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-amber-500/10 px-2.5 py-1.5">
                            <span className={`min-w-0 flex-1 truncate text-xs font-bold ${t.text}`}>{g.name} <span className={`font-semibold ${t.soft}`}>is waiting</span></span>
                            <button type="button" disabled={!!busy} onClick={() => void run(`admit:${g.id}`, { action: 'guest_decide', guestId: g.id, decision: 'admit' })}
                                className="flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1 text-[11px] font-black text-white hover:bg-emerald-500 disabled:opacity-50">
                                {busy === `admit:${g.id}` ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />} Let in
                            </button>
                            <button type="button" disabled={!!busy} onClick={() => void run(`deny:${g.id}`, { action: 'guest_decide', guestId: g.id, decision: 'deny' })}
                                className={`flex items-center gap-1 rounded-lg border px-2.5 py-1 text-[11px] font-bold disabled:opacity-50 ${t.ghost}`}>
                                {busy === `deny:${g.id}` ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />} Refuse
                            </button>
                        </li>
                    ))}
                </ul>
            )}

            {inCall.length > 0 && (
                <ul className="space-y-1" aria-label="Guests let in">
                    {inCall.map(g => (
                        <li key={g.id} className="flex items-center gap-2 px-1">
                            <span className={`min-w-0 flex-1 truncate text-[11px] font-semibold ${t.soft}`}>{g.name} (guest, let in)</span>
                            <button type="button" disabled={!!busy}
                                onClick={() => { if (window.confirm(`Remove ${g.name} from the call? They cannot come back with this request.`)) void run(`remove:${g.id}`, { action: 'guest_decide', guestId: g.id, decision: 'remove' }); }}
                                className="flex items-center gap-1 text-[11px] font-bold text-red-500 hover:text-red-400 disabled:opacity-50">
                                {busy === `remove:${g.id}` ? <Loader2 className="h-3 w-3 animate-spin" /> : <UserX className="h-3 w-3" />} Remove
                            </button>
                        </li>
                    ))}
                </ul>
            )}

            {note && <p className={`text-[11px] font-semibold ${t.soft}`}>{note}</p>}
        </div>
    );
}
