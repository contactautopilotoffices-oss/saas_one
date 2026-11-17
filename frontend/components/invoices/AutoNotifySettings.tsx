'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { api, shortDate, inputCls, btnGhost, ErrorLine } from './invoiceUi';

/**
 * The switch for "approved in Zoho, so WhatsApp the vendor". Off does nothing. Test sends to the
 * test number. Live sends to the vendor's own number. Super admins only.
 */

interface State {
    has_phone: boolean; last4: string | null; auto_mode: 'off' | 'test' | 'live'; auto_since: string | null; last_run_at: string | null;
    last_run_summary: { pendingSeen?: number; approvedFound?: number; notified?: number; noPhone?: number; failed?: number; error?: string } | null; can_edit: boolean;
}

const MODES: { key: State['auto_mode']; title: string; text: string }[] = [
    { key: 'off', title: 'Off', text: 'Nothing is sent. The job does not run.' },
    { key: 'test', title: 'Test', text: 'Real approvals trigger the message, but it goes to the test number only.' },
    { key: 'live', title: 'Live', text: "Real approvals message the vendor's own WhatsApp number." },
];

export default function AutoNotifySettings({ orgId, canEdit }: { orgId: string; canEdit: boolean }) {
    const [s, setS] = useState<State | null>(null);
    const [phone, setPhone] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        try { setS(await api<State>(`/api/po-approval/settings?org_id=${orgId}`)); setError(null); } catch (e) { setError((e as Error).message); }
    }, [orgId]);
    useEffect(() => { load(); }, [load]);

    const put = async (body: Record<string, unknown>) => {
        setBusy(true); setError(null);
        try { await api('/api/po-approval/settings', { method: 'PUT', body: JSON.stringify({ org_id: orgId, ...body }) }); setPhone(''); await load(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
    };

    if (!s) return error ? <ErrorLine message={error} /> : <p className="text-sm text-text-tertiary py-6">Loading…</p>;
    const run = s.last_run_summary;
    return (
        <section className="space-y-3 max-w-3xl">
            <h3 className="text-sm font-bold text-text-primary">Vendor WhatsApp when the founder approves a PO</h3>
            <p className="text-xs text-text-secondary">A check runs every 10 minutes. When a PO that was waiting for approval is approved in Zoho, the vendor gets the approved PO on WhatsApp, once. POs already approved before you turn this on are never messaged.</p>
            <div className="grid sm:grid-cols-3 gap-2">
                {MODES.map((m) => (
                    <button key={m.key} disabled={!canEdit || busy} onClick={() => put({ auto_mode: m.key })}
                        className={`text-left rounded-xl border px-3 py-2.5 ${s.auto_mode === m.key ? (m.key === 'live' ? 'border-red-500 bg-red-500/10' : 'border-primary bg-primary/10') : 'border-border'} ${canEdit ? 'hover:bg-surface-elevated' : 'opacity-70'}`}>
                        <div className="text-sm font-bold text-text-primary">{m.title}{s.auto_mode === m.key ? ' · on' : ''}</div>
                        <div className="text-[11px] text-text-secondary mt-0.5">{m.text}</div>
                    </button>
                ))}
            </div>
            <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-text-secondary">Test number: {s.has_phone ? <b>ending {s.last4}</b> : 'not set'}</span>
                {canEdit && (<><input className={`${inputCls} max-w-[220px]`} inputMode="tel" placeholder="91 98123 45678" value={phone} onChange={(e) => setPhone(e.target.value)} /><button className={btnGhost} disabled={busy || phone.trim().length < 10} onClick={() => put({ test_phone: phone })}>Save number</button></>)}
            </div>
            <div className="text-[11px] text-text-tertiary">
                {s.auto_mode === 'off' ? 'Switched off.' : <>On since {shortDate(s.auto_since)}. {s.last_run_at ? <>Last check {new Date(s.last_run_at).toLocaleString('en-IN')}{run ? ` · ${run.pendingSeen ?? 0} waiting, ${run.notified ?? 0} sent, ${run.noPhone ?? 0} without a number, ${run.failed ?? 0} failed` : ''}{run?.error ? ` · ${run.error}` : ''}</> : 'No check has run yet.'}</>}
            </div>
            <ErrorLine message={error} />
            {!canEdit && <p className="text-xs text-text-tertiary">Only super admins can change this.</p>}
        </section>
    );
}
