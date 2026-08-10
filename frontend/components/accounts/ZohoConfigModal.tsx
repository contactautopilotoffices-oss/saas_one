'use client';

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Loader2, CheckCircle2, AlertTriangle, RefreshCcwDot } from 'lucide-react';

interface Props { orgId?: string; onClose: () => void; onSynced?: () => void; }

interface Config {
    zoho_organization_id: string | null;
    is_active: boolean;
    last_synced_at: string | null;
    last_sync_status: string | null;
}

export default function ZohoConfigModal({ orgId, onClose, onSynced }: Props) {
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [syncing, setSyncing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [msg, setMsg] = useState<string | null>(null);
    const [credsPresent, setCredsPresent] = useState(false);
    const [zohoOrgId, setZohoOrgId] = useState('');
    const [active, setActive] = useState(true);
    const [cfg, setCfg] = useState<Config | null>(null);

    const qs = orgId ? `?org_id=${orgId}` : '';

    useEffect(() => {
        (async () => {
            try {
                const res = await fetch(`/api/accounts/zoho-config${qs}`);
                const d = await res.json();
                if (!res.ok) throw new Error(d.error || 'Failed to load');
                setCfg(d.config);
                setZohoOrgId(d.config?.zoho_organization_id || '');
                setActive(d.config?.is_active !== false);
                setCredsPresent(!!d.creds_present);
            } catch (e) { setError(e instanceof Error ? e.message : 'Failed to load'); }
            finally { setLoading(false); }
        })();
    }, [qs]);

    const save = async (thenSync = false) => {
        setSaving(true); setError(null); setMsg(null);
        try {
            const res = await fetch(`/api/accounts/zoho-config${qs}`, {
                method: 'PUT', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ zoho_organization_id: zohoOrgId.trim(), is_active: active }),
            });
            const d = await res.json();
            if (!res.ok) throw new Error(d.error || 'Failed to save');
            setCfg(d.config);
            setMsg('Saved.');
            if (thenSync) await runSync();
        } catch (e) { setError(e instanceof Error ? e.message : 'Failed to save'); }
        finally { setSaving(false); }
    };

    const runSync = async () => {
        setSyncing(true); setMsg(null); setError(null);
        try {
            const res = await fetch(`/api/accounts/pos/sync${qs}`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
            });
            const d = await res.json();
            if (d.error) setError(`Sync: ${d.error}`);
            else { setMsg(`Synced ${d.synced} PO(s) from Zoho.`); onSynced?.(); }
        } catch { setError('Sync failed'); }
        finally { setSyncing(false); }
    };

    if (typeof document === 'undefined') return null;
    const field = 'w-full px-3 py-2 border border-border rounded-lg text-sm bg-surface text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-primary/20';
    const label = 'block text-xs font-bold text-text-secondary uppercase tracking-wide mb-1.5';
    const fmt = (d?: string | null) => d ? new Date(d).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—';

    return createPortal(
        <div className="fixed inset-0 bg-black/50 z-[80] flex items-center justify-center p-4" onClick={onClose}>
            <div onClick={e => e.stopPropagation()} className="bg-surface rounded-2xl shadow-2xl w-full max-w-md max-h-[88vh] overflow-hidden flex flex-col">
                <div className="flex items-center justify-between px-6 py-4 border-b border-border">
                    <h3 className="text-base font-bold text-text-primary">Zoho Books connection</h3>
                    <button onClick={onClose} className="p-2 hover:bg-muted rounded-xl"><X className="w-5 h-5 text-text-secondary" /></button>
                </div>

                <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
                    {loading ? (
                        <div className="py-10 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-text-tertiary" /></div>
                    ) : (
                        <>
                            {/* Server credential state */}
                            {credsPresent ? (
                                <div className="flex items-start gap-2 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 px-3 py-2.5 text-sm text-emerald-700 dark:text-emerald-400">
                                    <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
                                    <span>Server credentials detected. Enter your Zoho Organization ID and sync.</span>
                                </div>
                            ) : (
                                <div className="flex items-start gap-2 rounded-xl bg-amber-50 dark:bg-amber-950/30 px-3 py-2.5 text-sm text-amber-700 dark:text-amber-500">
                                    <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                                    <span>Server is missing Zoho credentials. Set <span className="font-mono text-xs">ZOHO_CLIENT_ID</span>, <span className="font-mono text-xs">ZOHO_CLIENT_SECRET</span> and <span className="font-mono text-xs">ZOHO_REFRESH_TOKEN</span> in the environment, then sync.</span>
                                </div>
                            )}

                            <div>
                                <label className={label}>Zoho Organization ID</label>
                                <input value={zohoOrgId} onChange={e => setZohoOrgId(e.target.value)} placeholder="e.g. 807372318" inputMode="numeric" className={field} />
                                <p className="text-[11px] text-text-tertiary mt-1">Zoho Books → Settings → Organizations. All-numeric.</p>
                            </div>

                            <label className="flex items-center gap-2 text-sm text-text-primary">
                                <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} className="w-4 h-4 rounded border-border text-primary focus:ring-primary/20" />
                                Sync this organization automatically (every 2 hours)
                            </label>

                            <div className="bg-surface-elevated rounded-xl p-3 text-sm space-y-1">
                                <div className="flex justify-between"><span className="text-text-tertiary">Last synced</span><span className="text-text-primary">{fmt(cfg?.last_synced_at)}</span></div>
                                <div className="flex justify-between gap-3"><span className="text-text-tertiary shrink-0">Last status</span><span className="text-text-primary text-right truncate">{cfg?.last_sync_status || '—'}</span></div>
                            </div>

                            {msg && <p className="text-sm text-emerald-600">{msg}</p>}
                            {error && <p className="text-sm text-red-600">{error}</p>}
                        </>
                    )}
                </div>

                <div className="flex items-center justify-between gap-3 px-6 py-4 border-t border-border bg-surface-elevated">
                    <button onClick={runSync} disabled={syncing || saving || !zohoOrgId.trim()}
                        className="inline-flex items-center gap-1.5 px-3.5 py-2 border border-border rounded-xl text-sm font-bold text-text-secondary hover:bg-muted disabled:opacity-50">
                        <RefreshCcwDot className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} /> Sync now
                    </button>
                    <div className="flex items-center gap-2">
                        <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-text-secondary hover:bg-muted rounded-xl">Close</button>
                        <button onClick={() => save(true)} disabled={saving || syncing}
                            className="inline-flex items-center gap-1.5 px-5 py-2 bg-primary text-white rounded-xl text-sm font-bold hover:bg-primary/90 disabled:opacity-50">
                            {(saving || syncing) && <Loader2 className="w-4 h-4 animate-spin" />} Save &amp; sync
                        </button>
                    </div>
                </div>
            </div>
        </div>,
        document.body,
    );
}
