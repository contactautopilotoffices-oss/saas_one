'use client';

import { useState } from 'react';
import { Check, Copy, Loader2, UserPlus, UserX, X } from 'lucide-react';
import { joinLink, type GuestsView } from './api';

/**
 * Stage 2 (owner 2026-11-18): guests without a login, for the team. Used on the meeting's page (light) and inside the
 * call (dark). Shows the guest link (the host turns it on or off), the people waiting with "Let in" / "Refuse", and
 * guests already let in with "Remove". The server checks every action; this only asks.
 */
export default function GuestPanel({ guests, onAction, dark = false }: {
    guests: GuestsView;
    /** Sends one action ({ action: 'guest_link', on } or { action: 'guest_decide', guestId, decision }); resolves to an error sentence or null */
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
    const copy = () => {
        if (!guests.path) return;
        void navigator.clipboard?.writeText(joinLink(guests.path)).then(
            () => setNote('Guest link copied. Send it to the people who do not have a login.'),
            () => setNote('Could not copy. Select the link and copy it by hand.'),
        );
    };

    const t = dark
        ? { box: 'border-white/10 bg-white/5', text: 'text-zinc-200', soft: 'text-zinc-400', link: 'bg-black/30 text-zinc-200', ghost: 'border-white/15 text-zinc-200 hover:bg-white/10' }
        : { box: 'border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-800/60', text: 'text-zinc-800 dark:text-zinc-200', soft: 'text-zinc-500', link: 'bg-white text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300', ghost: 'border-zinc-300 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800' };

    if (!guests.path && !guests.canManageLink && !waiting.length && !inCall.length) return null;

    return (
        <div className={`space-y-2 rounded-xl border p-3 ${t.box}`}>
            <div className="flex flex-wrap items-center gap-2">
                <span className={`flex items-center gap-1.5 text-xs font-black ${t.text}`}><UserPlus className="h-3.5 w-3.5" /> Guests without a login</span>
                {guests.canManageLink && (
                    guests.path ? (
                        <button type="button" disabled={!!busy} onClick={() => { if (window.confirm('Turn off the guest link? It stops working, and anyone still waiting is refused. Guests already in the call stay.')) void run('off', { action: 'guest_link', on: false }); }}
                            className={`ml-auto rounded-lg border px-2 py-1 text-[11px] font-bold disabled:opacity-50 ${t.ghost}`}>
                            {busy === 'off' ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Turn off link'}
                        </button>
                    ) : (
                        <button type="button" disabled={!!busy} onClick={() => void run('on', { action: 'guest_link', on: true })}
                            className="ml-auto flex items-center gap-1 rounded-lg bg-indigo-600 px-2.5 py-1 text-[11px] font-black text-white hover:bg-indigo-500 disabled:opacity-50">
                            {busy === 'on' ? <Loader2 className="h-3 w-3 animate-spin" /> : <UserPlus className="h-3 w-3" />} Allow guests
                        </button>
                    )
                )}
            </div>

            {guests.path ? (
                <div className={`flex items-center gap-2 rounded-lg px-2.5 py-1.5 ${t.link}`}>
                    <span className="min-w-0 flex-1 truncate font-mono text-[11px]">{joinLink(guests.path)}</span>
                    <button type="button" onClick={copy} className="flex shrink-0 items-center gap-1 text-[11px] font-bold text-indigo-500 hover:text-indigo-400"><Copy className="h-3 w-3" /> Copy</button>
                </div>
            ) : guests.canManageLink ? (
                <p className={`text-[11px] ${t.soft}`}>Turn this on to get a link for people without a login, like candidates or vendors. They wait until someone here lets them in.</p>
            ) : null}

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
