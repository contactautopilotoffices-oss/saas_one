'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Link2, Mail, X } from 'lucide-react';
import { api, qs } from './api';
import { Spinner, useUi } from './ui';

/**
 * "Connect Zoho Mail" (owner 2026-11-24: "add a button to link the Zoho mail similar to what we have done for Login and
 * Zoho Tasks"). Links the HR mailbox so Recruitment can send candidate emails from it (bulk outreach, replies) and read
 * CVs from it. Opens Zoho's consent page in a new tab; coming back to this tab refreshes the status. Connected, it
 * shows a small menu: the address, Reconnect, Disconnect. The mailbox itself is set up under Resumes → Zoho Mail.
 */

interface Mailbox { id: string; address: string; connected: boolean; active: boolean; can_send: boolean }

export default function RecruitmentMailButton({ orgId, onOpenEmail }: { orgId: string; onOpenEmail?: () => void }) {
    const { notify } = useUi();
    const [boxes, setBoxes] = useState<Mailbox[] | null>(null);
    const [open, setOpen] = useState(false);
    const [busy, setBusy] = useState(false);
    const ref = useRef<HTMLDivElement>(null);

    // Bumped to read the status again: on return from the Zoho consent tab, and after a disconnect.
    const [nonce, setNonce] = useState(0);
    const load = useCallback(() => setNonce(n => n + 1), []);
    useEffect(() => {
        let cancelled = false;
        void api<{ connections: Mailbox[] }>(`/api/candidates/email${qs({ orgId })}`).then(res => {
            // Before the mail migration (or without access) the button stays hidden rather than showing an error.
            if (!cancelled && res.ok) setBoxes(res.data.connections);
        });
        return () => { cancelled = true; };
    }, [orgId, nonce]);
    useEffect(() => {
        window.addEventListener('focus', load);
        return () => window.removeEventListener('focus', load);
    }, [load]);
    useEffect(() => {
        if (!open) return;
        const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
        document.addEventListener('mousedown', close);
        return () => document.removeEventListener('mousedown', close);
    }, [open]);

    const connect = async (reconnect = false) => {
        // The tab opens on the click (a pop-up blocker allows that), then goes to Zoho once the link is ready.
        const tab = window.open('about:blank', '_blank');
        if (!tab) { notify('Allow pop-ups for this site, then click Connect Zoho Mail again.', 'error'); return; }
        setBusy(true);
        const res = await api<{ url?: string }>('/api/candidates/email', { json: { orgId, action: 'connect-send', reconnect } });
        setBusy(false);
        if (!res.ok) { tab.close(); notify(res.error, 'error'); return; }
        if (!res.data.url) { tab.close(); load(); setOpen(false); notify('The shared HR mailbox is already connected.', 'success'); return; }
        tab.location.href = res.data.url;
        notify('Finish connecting in the Zoho tab. This page updates when you come back.', 'info');
        setOpen(false);
    };
    const disconnect = async (box: Mailbox) => {
        if (!window.confirm(`Disconnect ${box.address}? Emails and resumes already brought in are kept.`)) return;
        setBusy(true);
        const res = await api('/api/candidates/resume-mail', { json: { orgId, action: 'disconnect', id: box.id } });
        setBusy(false);
        if (!res.ok) { notify(res.error, 'error'); return; }
        notify('Zoho Mail disconnected.', 'success');
        setOpen(false);
        load();
    };

    if (boxes === null) return null;
    const live = boxes.filter(b => b.connected);
    const sending = live.filter(b => b.can_send && b.active);
    const btn = 'inline-flex h-9 items-center gap-x-2 rounded-[10px] bg-surface px-3 text-sm font-semibold text-text-primary shadow-[var(--w-shadow)] hover:shadow-[var(--w-shadow-hover)] disabled:opacity-60';

    if (!live.length) {
        return (
            <button type="button" onClick={() => void connect()} disabled={busy} className={btn} title="Send candidate emails from the HR mailbox, and read CVs from it">
                {busy ? <Spinner className="h-3.5 w-3.5" /> : <Link2 className="h-4 w-4 text-text-tertiary" />}Connect Zoho Mail
            </button>
        );
    }
    return (
        <div className="relative" ref={ref}>
            <button type="button" onClick={() => setOpen(o => !o)} className={btn} aria-expanded={open} title="Zoho Mail">
                {sending.length ? <Check className="h-4 w-4 text-success" /> : <Mail className="h-4 w-4 text-warning" />}
                Zoho Mail
            </button>
            {open && (
                <div className="absolute right-0 z-50 mt-1.5 w-72 space-y-3 rounded-xl bg-surface p-3 text-sm shadow-[var(--w-shadow-hover)] ring-1 ring-border-subtle">
                    {live.map(b => (
                        <div key={b.id} className="space-y-1">
                            <p className="break-all font-semibold text-text-primary">{b.address}</p>
                            <p className="flex items-center gap-1.5 text-xs text-text-secondary">
                                {b.can_send ? <><Check className="h-3.5 w-3.5 text-success" />Shared HR mailbox · sending enabled</> : <><X className="h-3.5 w-3.5 text-warning" />Read-only: reconnect to send from it</>}
                                {!b.active && ' · paused'}
                            </p>
                            <button type="button" onClick={() => void disconnect(b)} disabled={busy} className="text-xs font-semibold text-error hover:underline">Disconnect</button>
                        </div>
                    ))}
                    <div className="flex flex-wrap gap-2 border-t border-border-subtle pt-3">
                        <button type="button" onClick={() => void connect(true)} disabled={busy} className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold text-text-primary ring-1 ring-inset ring-border hover:bg-surface-elevated">
                            <Link2 className="h-3.5 w-3.5" />{sending.length ? 'Connect another' : 'Reconnect to send'}
                        </button>
                        {onOpenEmail && <button type="button" onClick={() => { setOpen(false); onOpenEmail(); }} className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold text-text-primary ring-1 ring-inset ring-border hover:bg-surface-elevated"><Mail className="h-3.5 w-3.5" />Open Email</button>}
                    </div>
                </div>
            )}
        </div>
    );
}
