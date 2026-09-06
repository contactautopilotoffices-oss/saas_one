'use client';

/**
 * CONNECTED MAILBOXES — "Connect my mailbox", and what is connected.
 * -----------------------------------------------------------------------------
 * Adding a mailbox used to mean minting a Zoho Self Client by hand, pasting
 * three secrets into a server file and deploying. That is fine once and
 * impossible as a habit: every agent after the first is linked to a different
 * person's inbox.
 *
 * One Zoho application is created once, ever. After that, connecting a mailbox
 * is this button: the person consents as themselves, and an agent can read
 * replies there. Read-only — sending goes out over SMTP and no send scope is
 * requested — and the owner can revoke it from their own Zoho account.
 */

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Check, Inbox, Loader2, Plus, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react';

interface Account {
    id: string; address: string; addresses: string[]; dc: string;
    connected_at: string; connected_by_name: string | null;
    last_ok_at: string | null; last_error: string | null; is_active: boolean;
}
interface Payload {
    provisioned: boolean; app_ready: boolean; key_ready: boolean;
    accounts: Account[]; error?: string;
}

export default function MailAccounts({ orgId }: { orgId: string }) {
    const [data, setData] = useState<Payload | null>(null);
    const [busy, setBusy] = useState<string | null>(null);
    const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

    const load = useCallback(async () => {
        try {
            const res = await fetch(`/api/agents/mail?orgId=${encodeURIComponent(orgId)}`, { cache: 'no-store' });
            const raw = (await res.json().catch(() => null)) as Partial<Payload> | null;
            setData({
                provisioned: Boolean(raw?.provisioned),
                app_ready: Boolean(raw?.app_ready),
                key_ready: Boolean(raw?.key_ready),
                accounts: Array.isArray(raw?.accounts) ? raw.accounts : [],
                error: raw?.error,
            });
        } catch (e) {
            setData({ provisioned: false, app_ready: false, key_ready: false, accounts: [], error: (e as Error).message });
        }
    }, [orgId]);
    useEffect(() => { void load(); }, [load]);

    /**
     * Aliases are captured when the mailbox is connected, so one added later —
     * which is how an agent gets its own address — stays invisible until asked
     * for again. This asks.
     */
    const refresh = async (a: Account) => {
        setBusy(a.id);
        try {
            const res = await fetch(`/api/agents/mail?orgId=${encodeURIComponent(orgId)}&address=${encodeURIComponent(a.address)}`, { method: 'POST' });
            const j = await res.json().catch(() => null);
            setNote(j?.error ? { ok: false, text: j.error } : { ok: true, text: j?.note ?? 'Refreshed.' });
            await load();
        } finally { setBusy(null); }
    };

    const disconnect = async (a: Account) => {
        setBusy(a.id);
        try {
            await fetch(`/api/agents/mail?orgId=${encodeURIComponent(orgId)}&id=${encodeURIComponent(a.id)}`, { method: 'DELETE' });
            await load();
        } finally { setBusy(null); }
    };

    if (!data) {
        return <div className="flex items-center gap-2 p-4 text-sm text-text-secondary"><Loader2 className="h-4 w-4 animate-spin" /> Loading mailboxes…</div>;
    }

    const blocked = !data.app_ready || !data.key_ready || !data.provisioned;

    return (
        <section className="rounded-[14px] border border-border bg-card p-4">
            <h4 className="mb-1 flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide text-text-tertiary">
                <Inbox className="h-3.5 w-3.5" /> Connected mailboxes
            </h4>
            <p className="mb-3 text-[11.5px] leading-relaxed text-text-secondary">
                Where agents read replies. Connect a mailbox once and any agent can be pointed at it &mdash; including
                its aliases. <b>Read-only</b>: this can list and read mail, never send or delete, and whoever connects
                it can revoke that from their own Zoho account at any time.
            </p>

            {blocked && (
                <div className="mb-3 rounded-xl border border-amber-500/30 bg-amber-500/8 px-3.5 py-3 text-[11.5px] leading-relaxed text-amber-900">
                    <AlertTriangle className="mr-1.5 inline h-3.5 w-3.5" />
                    <b>One-time setup is not finished.</b>
                    <ul className="mt-2 space-y-1.5">
                        {!data.provisioned && <li>· Apply migration <span className="font-mono">20260907000003_mail_accounts.sql</span>. {data.error}</li>}
                        {!data.app_ready && (
                            <li>· Create <b>one</b> Zoho application at <span className="font-mono">api-console.zoho.com</span> &rarr;
                                Add Client &rarr; <b>Server-based Application</b>, with the redirect URL this app gives you, then set{' '}
                                <span className="font-mono">ZOHO_MAIL_APP_CLIENT_ID</span> and <span className="font-mono">ZOHO_MAIL_APP_CLIENT_SECRET</span>.
                                Do this once; every mailbox after it connects from here.</li>
                        )}
                        {!data.key_ready && <li>· Set <span className="font-mono">MAIL_TOKEN_KEY</span> &mdash; connections are encrypted with it before being stored.</li>}
                    </ul>
                </div>
            )}

            {note && (
                <div className={`mb-3 rounded-xl border px-3 py-2 text-[11.5px] ${note.ok ? 'border-emerald-500/30 bg-emerald-500/8 text-emerald-800' : 'border-red-500/30 bg-red-500/8 text-red-700'}`}>
                    {note.text}
                </div>
            )}

            <ul className="mb-3 space-y-2">
                {data.accounts.map((a) => {
                    const others = a.addresses.filter((x) => x !== a.address);
                    return (
                        <li key={a.id} className="rounded-xl border border-border bg-card-tint px-3.5 py-3">
                            <div className="flex flex-wrap items-center gap-2">
                                <ShieldCheck className={`h-4 w-4 shrink-0 ${a.last_error ? 'text-red-600' : 'text-emerald-600'}`} />
                                <span className="text-[13px] font-semibold text-foreground">{a.address}</span>
                                {a.connected_by_name && <span className="text-[11.5px] text-text-tertiary">connected by {a.connected_by_name}</span>}
                                <button type="button" onClick={() => void refresh(a)} disabled={busy === a.id}
                                    title="Re-read the aliases on this mailbox"
                                    className="ml-auto inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-[11px] font-semibold text-text-secondary hover:text-foreground disabled:opacity-50">
                                    {busy === a.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />} Refresh aliases
                                </button>
                                <button type="button" onClick={() => void disconnect(a)} disabled={busy === a.id}
                                    className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-[11px] font-semibold text-text-secondary hover:text-red-600 disabled:opacity-50">
                                    {busy === a.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />} Disconnect
                                </button>
                            </div>
                            {others.length > 0 && (
                                <div className="mt-1.5 text-[11.5px] leading-relaxed text-text-secondary">
                                    Also answers to {others.map((x) => <span key={x} className="font-mono text-[11px] text-foreground">{x} </span>)}
                                    &mdash; point an agent at any of these.
                                </div>
                            )}
                            {a.last_error
                                ? <div className="mt-1.5 text-[11.5px] text-red-700">Last read failed: {a.last_error}</div>
                                : a.last_ok_at
                                    ? <div className="mt-1.5 flex items-center gap-1 text-[11.5px] text-emerald-700"><Check className="h-3 w-3" /> Last read {new Date(a.last_ok_at).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</div>
                                    : <div className="mt-1.5 text-[11.5px] text-text-tertiary">Not read from yet.</div>}
                        </li>
                    );
                })}
                {!data.accounts.length && !blocked && (
                    <li className="rounded-xl border border-dashed border-border px-3.5 py-3 text-[12px] text-text-secondary">
                        No mailbox connected yet. Agents can send, but nobody is reading the replies.
                    </li>
                )}
            </ul>

            <a
                href={blocked ? undefined : `/api/agents/mail/connect?orgId=${encodeURIComponent(orgId)}`}
                aria-disabled={blocked}
                className={`inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-bold text-white ${blocked ? 'pointer-events-none bg-primary/40' : 'bg-primary hover:opacity-90'}`}
            >
                <Plus className="h-3.5 w-3.5" /> Connect a mailbox
            </a>
            <span className="ml-2 text-[11px] text-text-tertiary">
                Opens Zoho. Sign in as the person whose inbox the agent should read.
            </span>
        </section>
    );
}
