'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { Copy, Check, Loader2, ExternalLink, ShieldCheck } from 'lucide-react';

interface Option { id: string; name?: string; full_name?: string; }

export default function MetaIntegrationGuide({ orgId }: { orgId: string }) {
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const [saveError, setSaveError] = useState('');
    const [copied, setCopied] = useState(false);
    const [testing, setTesting] = useState(false);
    const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);
    const [users, setUsers] = useState<Option[]>([]);
    const [properties, setProperties] = useState<Option[]>([]);
    const [sources, setSources] = useState<Option[]>([]);
    const [cfg, setCfg] = useState<any>({
        verify_token: '', app_secret: '', page_id: '', page_access_token: '',
        meta_ad_account_id: '', meta_app_id: '', meta_user_access_token: '',
        last_sync_at: null as string | null, last_sync_status: null as string | null,
        default_assignee: '', default_property: '', default_lead_source: '', is_active: true,
    });

    const webhookUrl = typeof window !== 'undefined' ? `${window.location.origin}/api/crm/webhooks/meta` : '/api/crm/webhooks/meta';
    const q = useCallback((p: string) => `${p}${p.includes('?') ? '&' : '?'}org_id=${orgId}`, [orgId]);

    useEffect(() => {
        (async () => {
            try {
                const [mRes, sRes] = await Promise.all([
                    fetch(q('/api/crm/settings?type=meta')),
                    fetch(q('/api/crm/settings?type=all&scope=bd')),
                ]);
                if (mRes.ok) {
                    const m = (await mRes.json()).meta;
                    if (m) setCfg((c: any) => ({
                        ...c,
                        ...m,
                        app_secret: m.app_secret || '',
                        page_access_token: m.page_access_token || '',
                        meta_user_access_token: m.meta_user_access_token || '',
                    }));
                }
                if (sRes.ok) {
                    const s = await sRes.json();
                    setUsers(s.users || []); setProperties(s.properties || []); setSources(s.sources || []);
                }
            } finally {
                setLoading(false);
            }
        })();
    }, [q]);

    const copy = () => {
        navigator.clipboard?.writeText(webhookUrl);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
    };

    const save = async () => {
        setSaving(true); setSaved(false); setSaveError('');
        try {
            const res = await fetch(q('/api/crm/settings'), {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'save_meta_config', organization_id: orgId, data: cfg }),
            });
            if (res.ok) {
                setSaved(true);
                setTimeout(() => setSaved(false), 3000);
            } else {
                const err = await res.json().catch(() => null);
                setSaveError(err?.error || `Save failed (${res.status})`);
            }
        } catch (e: any) {
            setSaveError(e?.message || 'Network error');
        } finally {
            setSaving(false);
        }
    };

    const testWebhook = async () => {
        setTesting(true); setTestResult(null);
        try {
            const token = cfg.verify_token;
            if (!token) { setTestResult({ ok: false, msg: 'Enter a Verify Token first' }); return; }
            const res = await fetch(`/api/crm/webhooks/meta?hub.mode=subscribe&hub.verify_token=${encodeURIComponent(token)}&hub.challenge=test_ok`);
            const text = await res.text();
            if (res.ok && text === 'test_ok') {
                setTestResult({ ok: true, msg: 'Webhook verification working!' });
            } else {
                setTestResult({ ok: false, msg: `Failed: ${res.status} — ${text.slice(0, 100)}` });
            }
        } catch (e: any) {
            setTestResult({ ok: false, msg: e?.message || 'Network error' });
        } finally {
            setTesting(false);
        }
    };

    const set = (k: string, v: any) => setCfg((c: any) => ({ ...c, [k]: v }));

    if (loading) return <div className="h-40 bg-slate-100 rounded-xl animate-pulse" />;

    const steps = [
        <>Create a Meta App at <a className="text-primary inline-flex items-center gap-0.5" href="https://developers.facebook.com/apps" target="_blank" rel="noreferrer">developers.facebook.com <ExternalLink className="w-3 h-3" /></a> and add the <b>Webhooks</b> and <b>Lead Ads</b> products.</>,
        <>Connect your Facebook Page and generate a <b>Page Access Token</b> with <code className="bg-slate-100 px-1 rounded">leads_retrieval</code>, <code className="bg-slate-100 px-1 rounded">pages_manage_metadata</code>, and <code className="bg-slate-100 px-1 rounded">pages_show_list</code> permissions.</>,
        <>In <b>Webhooks → Page</b>, set the <b>Callback URL</b> to the URL below and the <b>Verify Token</b> to the value you enter below, then subscribe to the <code className="bg-slate-100 px-1 rounded">leadgen</code> field.</>,
        <>Copy your App's <b>App Secret</b> and <b>Page ID</b> into the form below — these let us verify and route incoming leads. Save, and your lead flow is live.</>,
    ];

    return (
        <div className="space-y-6">
            {/* Webhook URL */}
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
                <label className="text-xs font-medium text-text-secondary">Callback / Webhook URL</label>
                <div className="flex items-center gap-2 mt-1">
                    <code className="flex-1 bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm break-all">{webhookUrl}</code>
                    <button onClick={copy} className="p-2 bg-white border border-slate-200 rounded-lg hover:bg-slate-100">
                        {copied ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4 text-text-secondary" />}
                    </button>
                </div>
            </div>

            {/* Steps */}
            <div>
                <h3 className="text-sm font-semibold text-text-primary mb-2">Connect your Meta account</h3>
                <ol className="space-y-2">
                    {steps.map((s, i) => (
                        <li key={i} className="flex gap-3 text-sm text-text-secondary">
                            <span className="flex-shrink-0 w-5 h-5 rounded-full bg-primary text-white text-xs flex items-center justify-center">{i + 1}</span>
                            <span>{s}</span>
                        </li>
                    ))}
                </ol>
            </div>

            {/* Config form */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 border-t border-slate-200 pt-4">
                <Field label="Verify Token" hint="Any secret string — must match what you enter in Meta">
                    <input value={cfg.verify_token || ''} onChange={(e) => set('verify_token', e.target.value)}
                        className="input" placeholder="e.g. my-crm-verify-123" />
                </Field>
                <Field label="App Secret" hint="From your Meta App settings (used to verify payloads)">
                    <input value={cfg.app_secret || ''} onChange={(e) => set('app_secret', e.target.value)}
                        type="password" className="input" placeholder="••••••••" />
                </Field>
                <Field label="Page ID" hint="The Facebook Page receiving the lead forms">
                    <input value={cfg.page_id || ''} onChange={(e) => set('page_id', e.target.value)} className="input" placeholder="1234567890" />
                </Field>
                <Field label="Page Access Token" hint="Used to fetch the submitted lead fields">
                    <input value={cfg.page_access_token || ''} onChange={(e) => set('page_access_token', e.target.value)}
                        type="password" className="input" placeholder="••••••••" />
                </Field>

                {/* Marketing API access — used by the hourly spend/metrics sync */}
                <div className="md:col-span-2 mt-2 border-t border-slate-200 pt-4">
                    <div className="flex items-center justify-between">
                        <h4 className="text-sm font-semibold text-text-primary">Marketing API (spend & metrics sync)</h4>
                        {cfg.last_sync_at && (
                            <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${
                                cfg.last_sync_status === 'ok' ? 'bg-green-100 text-green-700' :
                                cfg.last_sync_status === 'partial' ? 'bg-amber-100 text-amber-700' :
                                cfg.last_sync_status === 'auth_error' ? 'bg-red-100 text-red-700' :
                                'bg-slate-100 text-slate-600'
                            }`}>
                                Last sync: {new Date(cfg.last_sync_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
                                {cfg.last_sync_status && cfg.last_sync_status !== 'ok' ? ` · ${cfg.last_sync_status}` : ''}
                            </span>
                        )}
                    </div>
                    <p className="text-[11px] text-text-secondary mt-1">
                        Required to automatically pull campaign spend, impressions, clicks, CTR, CPC & CPM into the Reports page.
                        Tokens expire roughly every 60 days — re-paste when the sync fails with auth_error.
                    </p>
                </div>
                <Field label="Ad Account ID" hint="From Meta Business Manager → Ad Accounts. Looks like act_1234567890">
                    <input value={cfg.meta_ad_account_id || ''} onChange={(e) => set('meta_ad_account_id', e.target.value)}
                        className="input" placeholder="act_1234567890" />
                </Field>
                <Field label="App ID" hint="Your Meta App's numeric ID — used to validate the system-user token">
                    <input value={cfg.meta_app_id || ''} onChange={(e) => set('meta_app_id', e.target.value)}
                        className="input" placeholder="1234567890" />
                </Field>
                <Field label="System-User Access Token" hint="Long-lived token from a Meta System User with ads_read permission">
                    <input value={cfg.meta_user_access_token || ''} onChange={(e) => set('meta_user_access_token', e.target.value)}
                        type="password" className="input" placeholder="••••••••" />
                </Field>
                <Field label="Default Assignee" hint="New leads are assigned to this rep">
                    <select value={cfg.default_assignee || ''} onChange={(e) => set('default_assignee', e.target.value || null)} className="input">
                        <option value="">— None —</option>
                        {users.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
                    </select>
                </Field>
                <Field label="Default Property Interest" hint="Optional default property for Meta leads">
                    <select value={cfg.default_property || ''} onChange={(e) => set('default_property', e.target.value || null)} className="input">
                        <option value="">— None —</option>
                        {properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                </Field>
            </div>

            <div className="flex items-center gap-3 flex-wrap">
                <button onClick={save} disabled={saving}
                    className="px-5 py-2.5 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 flex items-center gap-2 disabled:opacity-50">
                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : saved ? <Check className="w-4 h-4" /> : <ShieldCheck className="w-4 h-4" />}
                    {saved ? 'Saved!' : 'Save & Connect'}
                </button>
                <button onClick={testWebhook} disabled={testing}
                    className="px-5 py-2.5 bg-white border border-slate-200 text-text-primary rounded-lg text-sm font-medium hover:bg-slate-50 flex items-center gap-2 disabled:opacity-50">
                    {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <ExternalLink className="w-4 h-4" />}
                    Test Webhook
                </button>
                <label className="flex items-center gap-2 text-sm text-text-secondary">
                    <input type="checkbox" checked={!!cfg.is_active} onChange={(e) => set('is_active', e.target.checked)} />
                    Integration active
                </label>
            </div>

            {saved && (
                <div className="px-4 py-3 bg-green-50 border border-green-200 rounded-xl text-sm text-green-700 font-medium">
                    Configuration saved successfully. You can now verify the webhook in Meta.
                </div>
            )}
            {saveError && (
                <div className="px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700 font-medium">
                    {saveError}
                </div>
            )}
            {testResult && (
                <div className={`px-4 py-3 rounded-xl text-sm font-medium border ${
                    testResult.ok ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'
                }`}>
                    {testResult.msg}
                </div>
            )}

            <style jsx>{`
                .input {
                    width: 100%;
                    border: 1px solid rgb(226 232 240);
                    border-radius: 0.5rem;
                    padding: 0.5rem 0.75rem;
                    font-size: 0.875rem;
                }
            `}</style>
        </div>
    );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
    return (
        <div>
            <label className="text-xs font-medium text-text-primary">{label}</label>
            {children}
            {hint && <p className="text-[11px] text-text-secondary mt-1">{hint}</p>}
        </div>
    );
}
