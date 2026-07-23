'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { Loader2, Check, ExternalLink, RefreshCw, ShieldCheck, AlertTriangle, Linkedin } from 'lucide-react';

interface Option { id: string; name?: string; full_name?: string; }

/**
 * LinkedIn Marketing integration setup.
 *
 * Flow: save Client ID/Secret → "Connect LinkedIn" (OAuth) → pick defaults →
 * leads + ad spend sync automatically every 30 min (and via "Pull now").
 */
export default function LinkedInIntegrationGuide({ orgId }: { orgId: string }) {
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const [saveError, setSaveError] = useState('');
    const [syncing, setSyncing] = useState(false);
    const [syncResult, setSyncResult] = useState<{ ok: boolean; msg: string } | null>(null);
    const [users, setUsers] = useState<Option[]>([]);
    const [properties, setProperties] = useState<Option[]>([]);
    const [sources, setSources] = useState<Option[]>([]);
    const [cfg, setCfg] = useState<any>({
        client_id: '', client_secret: '', ad_account_urn: '', organization_urn: '',
        default_assignee: '', default_property: '', default_lead_source: '',
        connected: false, token_expired: null as boolean | null,
        last_sync_at: null as string | null, last_sync_status: null as string | null,
    });

    const q = useCallback((p: string) => `${p}${p.includes('?') ? '&' : '?'}org_id=${orgId}`, [orgId]);

    const load = useCallback(async () => {
        try {
            const [lRes, sRes] = await Promise.all([
                fetch(q('/api/crm/settings?type=linkedin')),
                fetch(q('/api/crm/settings?type=all&scope=bd')),
            ]);
            if (lRes.ok) {
                const l = (await lRes.json()).linkedin;
                if (l) setCfg((c: any) => ({ ...c, ...l, client_secret: l.client_secret || '' }));
            }
            if (sRes.ok) {
                const s = await sRes.json();
                setUsers(s.users || []); setProperties(s.properties || []); setSources(s.sources || []);
            }
        } finally {
            setLoading(false);
        }
    }, [q]);

    useEffect(() => { load(); }, [load]);

    // Surface the OAuth round-trip result (?linkedin=connected|denied|error).
    useEffect(() => {
        if (typeof window === 'undefined') return;
        const status = new URLSearchParams(window.location.search).get('linkedin');
        if (status === 'connected') setSyncResult({ ok: true, msg: 'LinkedIn connected successfully.' });
        else if (status === 'denied') setSyncResult({ ok: false, msg: 'Authorization was denied.' });
        else if (status === 'error') setSyncResult({ ok: false, msg: 'Connection failed — check Client ID/Secret + redirect URL.' });
    }, []);

    const save = async () => {
        setSaving(true); setSaved(false); setSaveError('');
        try {
            const res = await fetch(q('/api/crm/settings'), {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'save_linkedin_config', organization_id: orgId, data: cfg }),
            });
            if (res.ok) { setSaved(true); setTimeout(() => setSaved(false), 3000); await load(); }
            else { const e = await res.json().catch(() => null); setSaveError(e?.error || `Save failed (${res.status})`); }
        } catch (e: any) {
            setSaveError(e?.message || 'Network error');
        } finally {
            setSaving(false);
        }
    };

    const connect = () => {
        // Server builds the consent URL + state, then 302s to LinkedIn.
        window.location.href = q('/api/crm/oauth/linkedin');
    };

    const pullNow = async () => {
        setSyncing(true); setSyncResult(null);
        try {
            const res = await fetch(q('/api/crm/linkedin-sync'), {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ mode: 'both' }),
            });
            const data = await res.json().catch(() => null);
            if (res.ok) {
                const ins = data?.leads?.inserted ?? 0;
                const spend = data?.insights?.spendRowsUpserted ?? 0;
                setSyncResult({ ok: true, msg: `Pulled ${ins} new lead(s), ${spend} spend row(s).` });
                await load();
            } else {
                setSyncResult({ ok: false, msg: data?.error || `Sync failed (${res.status})` });
            }
        } catch (e: any) {
            setSyncResult({ ok: false, msg: e?.message || 'Network error' });
        } finally {
            setSyncing(false);
        }
    };

    const redirectUrl = typeof window !== 'undefined'
        ? `${window.location.origin}/api/crm/oauth/linkedin/callback`
        : '/api/crm/oauth/linkedin/callback';

    if (loading) return <div className="flex items-center gap-2 text-sm text-text-secondary"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>;

    const inputCls = 'w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary';
    const labelCls = 'block text-xs font-bold text-text-secondary uppercase tracking-wide mb-1';

    return (
        <div className="space-y-5">
            {/* Connection status */}
            <div className={`flex items-center justify-between gap-3 px-4 py-3 rounded-xl border ${
                cfg.connected && !cfg.token_expired ? 'bg-emerald-50 border-emerald-200'
                : cfg.token_expired ? 'bg-amber-50 border-amber-200'
                : 'bg-slate-50 border-slate-200'
            }`}>
                <div className="flex items-center gap-2 text-sm">
                    {cfg.connected && !cfg.token_expired ? (
                        <><ShieldCheck className="w-4 h-4 text-emerald-600" /><span className="font-bold text-emerald-700">Connected</span></>
                    ) : cfg.token_expired ? (
                        <><AlertTriangle className="w-4 h-4 text-amber-600" /><span className="font-bold text-amber-700">Token expired — reconnect</span></>
                    ) : (
                        <><AlertTriangle className="w-4 h-4 text-slate-400" /><span className="font-bold text-slate-500">Not connected</span></>
                    )}
                    {cfg.last_sync_at && (
                        <span className="text-xs text-text-tertiary ml-2">Last sync: {new Date(cfg.last_sync_at).toLocaleString()}</span>
                    )}
                </div>
                <div className="flex items-center gap-2">
                    {cfg.connected && (
                        <button onClick={pullNow} disabled={syncing}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-bold text-text-secondary hover:bg-slate-50 disabled:opacity-50">
                            {syncing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />} Pull now
                        </button>
                    )}
                    <button onClick={connect} disabled={!cfg.client_id || !!saveError}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#0A66C2] text-white rounded-lg text-xs font-bold hover:bg-[#084d92] disabled:opacity-40">
                        <Linkedin className="w-3.5 h-3.5" /> {cfg.connected ? 'Reconnect' : 'Connect LinkedIn'}
                    </button>
                </div>
            </div>

            {syncResult && (
                <div className={`text-sm px-3 py-2 rounded-lg ${syncResult.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
                    {syncResult.msg}
                </div>
            )}

            {/* Step 1: app credentials */}
            <div className="space-y-3">
                <h4 className="text-sm font-bold text-text-primary">1. LinkedIn App credentials</h4>
                <p className="text-xs text-text-tertiary">
                    From your LinkedIn Developer App (with Marketing Developer Platform access). Add this exact redirect URL to the app's Auth settings:
                </p>
                <code className="block text-[11px] bg-slate-100 rounded-lg px-3 py-2 break-all">{redirectUrl}</code>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                        <label className={labelCls}>Client ID</label>
                        <input className={inputCls} value={cfg.client_id || ''} onChange={(e) => setCfg({ ...cfg, client_id: e.target.value })} placeholder="86xxxxxxxxxxx" />
                    </div>
                    <div>
                        <label className={labelCls}>Client Secret</label>
                        <input className={inputCls} type="password" value={cfg.client_secret || ''} onChange={(e) => setCfg({ ...cfg, client_secret: e.target.value })} placeholder="••••••••" />
                    </div>
                </div>
            </div>

            {/* Step 2: marketing assets */}
            <div className="space-y-3">
                <h4 className="text-sm font-bold text-text-primary">2. Marketing assets</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                        <label className={labelCls}>Ad Account URN</label>
                        <input className={inputCls} value={cfg.ad_account_urn || ''} onChange={(e) => setCfg({ ...cfg, ad_account_urn: e.target.value })} placeholder="urn:li:sponsoredAccount:123456789" />
                    </div>
                    <div>
                        <label className={labelCls}>Organization URN <span className="font-normal lowercase">(optional)</span></label>
                        <input className={inputCls} value={cfg.organization_urn || ''} onChange={(e) => setCfg({ ...cfg, organization_urn: e.target.value })} placeholder="urn:li:organization:123456" />
                    </div>
                </div>
            </div>

            {/* Step 3: routing defaults */}
            <div className="space-y-3">
                <h4 className="text-sm font-bold text-text-primary">3. Lead routing defaults</h4>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div>
                        <label className={labelCls}>Default assignee</label>
                        <select className={inputCls} value={cfg.default_assignee || ''} onChange={(e) => setCfg({ ...cfg, default_assignee: e.target.value })}>
                            <option value="">Round-robin / admin</option>
                            {users.map((u) => <option key={u.id} value={u.id}>{u.full_name || u.name}</option>)}
                        </select>
                    </div>
                    <div>
                        <label className={labelCls}>Lead source</label>
                        <select className={inputCls} value={cfg.default_lead_source || ''} onChange={(e) => setCfg({ ...cfg, default_lead_source: e.target.value })}>
                            <option value="">Auto (LinkedIn)</option>
                            {sources.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                        </select>
                    </div>
                    <div>
                        <label className={labelCls}>Property interest</label>
                        <select className={inputCls} value={cfg.default_property || ''} onChange={(e) => setCfg({ ...cfg, default_property: e.target.value })}>
                            <option value="">None</option>
                            {properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </select>
                    </div>
                </div>
            </div>

            <div className="flex items-center gap-3">
                <button onClick={save} disabled={saving}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-xl text-sm font-bold hover:bg-primary/90 disabled:opacity-50">
                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : saved ? <Check className="w-4 h-4" /> : null}
                    {saved ? 'Saved' : 'Save configuration'}
                </button>
                <a href="https://www.linkedin.com/developers/apps" target="_blank" rel="noreferrer"
                    className="inline-flex items-center gap-1.5 text-xs font-bold text-[#0A66C2] hover:underline">
                    LinkedIn Developer Portal <ExternalLink className="w-3 h-3" />
                </a>
                {saveError && <span className="text-sm text-red-600">{saveError}</span>}
            </div>
        </div>
    );
}
