'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { Send, Plus, Loader2, Megaphone, CalendarClock, X, Check, AlertCircle, Play } from 'lucide-react';

interface Campaign {
    id: string;
    name: string;
    campaign_type: 'broadcast' | 'drip';
    status: 'draft' | 'scheduled' | 'running' | 'completed' | 'cancelled';
    total_recipients: number;
    sent_count: number;
    failed_count: number;
    scheduled_at: string | null;
    created_at: string;
    creator?: { full_name: string };
}

interface Option { id: string; name: string; }

export default function CampaignsManager({ orgId }: { orgId: string }) {
    const [campaigns, setCampaigns] = useState<Campaign[]>([]);
    const [statuses, setStatuses] = useState<Option[]>([]);
    const [sources, setSources] = useState<Option[]>([]);
    const [loading, setLoading] = useState(true);
    const [showForm, setShowForm] = useState(false);
    const [saving, setSaving] = useState(false);
    const [dispatching, setDispatching] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);

    // Form state
    const [name, setName] = useState('');
    const [type, setType] = useState<'broadcast' | 'drip'>('broadcast');
    const [message, setMessage] = useState('');
    const [steps, setSteps] = useState<{ day_offset: number; message: string }[]>([{ day_offset: 0, message: '' }]);
    const [scheduledAt, setScheduledAt] = useState('');
    const [audStatus, setAudStatus] = useState<string[]>([]);
    const [audSource, setAudSource] = useState<string[]>([]);

    const q = useCallback((path: string) => `${path}${path.includes('?') ? '&' : '?'}org_id=${orgId}`, [orgId]);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const [cRes, sRes] = await Promise.all([
                fetch(q('/api/crm/campaigns')),
                fetch(q('/api/crm/settings?type=all')),
            ]);
            if (cRes.ok) setCampaigns((await cRes.json()).campaigns || []);
            if (sRes.ok) {
                const s = await sRes.json();
                setStatuses(s.statuses || []);
                setSources(s.sources || []);
            }
        } catch {
            setError('Failed to load campaigns');
        } finally {
            setLoading(false);
        }
    }, [q]);

    useEffect(() => { load(); }, [load]);

    const resetForm = () => {
        setName(''); setType('broadcast'); setMessage('');
        setSteps([{ day_offset: 0, message: '' }]); setScheduledAt('');
        setAudStatus([]); setAudSource([]); setError(null);
    };

    const submit = async () => {
        setError(null);
        if (!name.trim()) { setError('Campaign name is required'); return; }
        setSaving(true);
        try {
            const payload: any = {
                organization_id: orgId,
                name,
                campaign_type: type,
                scheduled_at: scheduledAt || undefined,
                audience: { status: audStatus, lead_source: audSource },
            };
            if (type === 'broadcast') payload.message = message;
            else payload.steps = steps;

            const res = await fetch(q('/api/crm/campaigns'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            const data = await res.json();
            if (!res.ok) { setError(data.error || 'Failed to create campaign'); return; }
            setNotice(`Campaign created — ${data.recipients} message(s) queued.`);
            setShowForm(false);
            resetForm();
            load();
        } catch {
            setError('Failed to create campaign');
        } finally {
            setSaving(false);
        }
    };

    const dispatchNow = async () => {
        setDispatching(true);
        setNotice(null);
        try {
            const res = await fetch(q('/api/crm/campaigns/dispatch'), { method: 'POST' });
            const data = await res.json();
            if (res.ok) setNotice(`Dispatched: ${data.sent} sent, ${data.failed} failed.`);
            else setError(data.error || 'Dispatch failed');
            load();
        } catch {
            setError('Dispatch failed');
        } finally {
            setDispatching(false);
        }
    };

    const cancel = async (id: string) => {
        if (!confirm('Cancel this campaign? Unsent messages will be skipped.')) return;
        await fetch(`/api/crm/campaigns/${id}`, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'cancel' }),
        });
        load();
    };

    const statusBadge = (s: Campaign['status']) => {
        const map: Record<string, string> = {
            draft: 'bg-slate-100 text-slate-600',
            scheduled: 'bg-amber-100 text-amber-700',
            running: 'bg-blue-100 text-blue-700',
            completed: 'bg-green-100 text-green-700',
            cancelled: 'bg-red-100 text-red-700',
        };
        return map[s] || 'bg-slate-100 text-slate-600';
    };

    const toggle = (arr: string[], set: (v: string[]) => void, val: string) =>
        set(arr.includes(val) ? arr.filter((x) => x !== val) : [...arr, val]);

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                    <h1 className="text-2xl font-bold text-text-primary flex items-center gap-2">
                        <Megaphone className="w-6 h-6 text-primary" /> Meta Campaigns
                    </h1>
                    <p className="text-sm text-text-secondary mt-1">
                        Run and monitor Meta (Facebook & Instagram) ad campaigns. Track spend, leads, and CPL in real time.
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={dispatchNow}
                        disabled={dispatching}
                        className="px-4 py-2 bg-slate-100 text-text-secondary rounded-lg text-sm font-medium hover:bg-slate-200 flex items-center gap-2 disabled:opacity-50"
                        title="Send messages that are due now"
                    >
                        {dispatching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                        Send due now
                    </button>
                    <button
                        onClick={() => { resetForm(); setShowForm(true); }}
                        className="px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 flex items-center gap-2"
                    >
                        <Plus className="w-4 h-4" /> New Campaign
                    </button>
                </div>
            </div>

            {notice && (
                <div className="bg-green-50 border border-green-200 text-green-700 rounded-xl p-3 text-sm flex items-center gap-2">
                    <Check className="w-4 h-4" /> {notice}
                </div>
            )}

            {loading ? (
                <div className="space-y-3">
                    {[...Array(3)].map((_, i) => <div key={i} className="h-20 bg-slate-100 rounded-xl animate-pulse" />)}
                </div>
            ) : campaigns.length === 0 ? (
                <div className="text-center py-16 text-text-secondary border border-dashed border-slate-200 rounded-2xl">
                    <Megaphone className="w-12 h-12 mx-auto mb-3 text-slate-300" />
                    <p>No campaigns yet.</p>
                    <p className="text-sm mt-1">Create a broadcast or a multi-step drip sequence to engage your leads.</p>
                </div>
            ) : (
                <div className="space-y-3">
                    {campaigns.map((c) => {
                        const pct = c.total_recipients ? Math.round((c.sent_count / c.total_recipients) * 100) : 0;
                        return (
                            <div key={c.id} className="bg-white border border-slate-200 rounded-2xl p-4">
                                <div className="flex items-start justify-between gap-3">
                                    <div className="flex items-start gap-3">
                                        <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                                            {c.campaign_type === 'drip'
                                                ? <CalendarClock className="w-5 h-5 text-primary" />
                                                : <Megaphone className="w-5 h-5 text-primary" />}
                                        </div>
                                        <div>
                                            <div className="flex items-center gap-2">
                                                <span className="font-semibold text-text-primary">{c.name}</span>
                                                <span className={`text-xs px-2 py-0.5 rounded-full ${statusBadge(c.status)}`}>{c.status}</span>
                                                <span className="text-xs text-text-secondary capitalize">{c.campaign_type}</span>
                                            </div>
                                            <p className="text-xs text-text-secondary mt-0.5">
                                                {c.sent_count}/{c.total_recipients} sent
                                                {c.failed_count > 0 && <span className="text-red-500"> · {c.failed_count} failed</span>}
                                                {c.scheduled_at && ` · scheduled ${new Date(c.scheduled_at).toLocaleString()}`}
                                            </p>
                                        </div>
                                    </div>
                                    {['scheduled', 'running'].includes(c.status) && (
                                        <button onClick={() => cancel(c.id)} className="text-xs text-red-500 hover:underline">Cancel</button>
                                    )}
                                </div>
                                <div className="mt-3 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                                    <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${pct}%` }} />
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Create modal */}
            {showForm && (
                <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6 space-y-4">
                        <div className="flex items-center justify-between">
                            <h2 className="text-lg font-semibold">New Campaign</h2>
                            <button onClick={() => setShowForm(false)}><X className="w-5 h-5 text-text-secondary" /></button>
                        </div>

                        {error && (
                            <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-2.5 text-sm flex items-center gap-2">
                                <AlertCircle className="w-4 h-4" /> {error}
                            </div>
                        )}

                        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Campaign name"
                            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />

                        <div className="flex gap-2">
                            {(['broadcast', 'drip'] as const).map((t) => (
                                <button key={t} onClick={() => setType(t)}
                                    className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium capitalize ${type === t ? 'bg-primary text-white' : 'bg-slate-100 text-text-secondary'}`}>
                                    {t}
                                </button>
                            ))}
                        </div>

                        {type === 'broadcast' ? (
                            <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={4}
                                placeholder="Hi {{name}}, ..." className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
                        ) : (
                            <div className="space-y-2">
                                {steps.map((s, i) => (
                                    <div key={i} className="flex gap-2 items-start">
                                        <div className="flex flex-col items-center">
                                            <label className="text-[10px] text-text-secondary">Day</label>
                                            <input type="number" min={0} value={s.day_offset}
                                                onChange={(e) => setSteps(steps.map((x, idx) => idx === i ? { ...x, day_offset: parseInt(e.target.value) || 0 } : x))}
                                                className="w-14 border border-slate-200 rounded-lg px-2 py-2 text-sm" />
                                        </div>
                                        <textarea value={s.message} rows={2}
                                            onChange={(e) => setSteps(steps.map((x, idx) => idx === i ? { ...x, message: e.target.value } : x))}
                                            placeholder={`Step ${i + 1} message`} className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm" />
                                        {steps.length > 1 && (
                                            <button onClick={() => setSteps(steps.filter((_, idx) => idx !== i))} className="p-1 mt-4"><X className="w-4 h-4 text-red-400" /></button>
                                        )}
                                    </div>
                                ))}
                                <button onClick={() => setSteps([...steps, { day_offset: steps.length, message: '' }])}
                                    className="text-sm text-primary flex items-center gap-1"><Plus className="w-4 h-4" /> Add step</button>
                            </div>
                        )}

                        <div>
                            <label className="text-xs text-text-secondary">Schedule (optional — leave blank to start now)</label>
                            <input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)}
                                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm mt-1" />
                        </div>

                        <div>
                            <label className="text-xs text-text-secondary block mb-1">Audience — Statuses</label>
                            <div className="flex flex-wrap gap-1.5">
                                {statuses.map((s) => (
                                    <button key={s.id} onClick={() => toggle(audStatus, setAudStatus, s.id)}
                                        className={`text-xs px-2.5 py-1 rounded-full border ${audStatus.includes(s.id) ? 'bg-primary text-white border-primary' : 'border-slate-200 text-text-secondary'}`}>
                                        {s.name}
                                    </button>
                                ))}
                            </div>
                        </div>
                        <div>
                            <label className="text-xs text-text-secondary block mb-1">Audience — Sources</label>
                            <div className="flex flex-wrap gap-1.5">
                                {sources.map((s) => (
                                    <button key={s.id} onClick={() => toggle(audSource, setAudSource, s.id)}
                                        className={`text-xs px-2.5 py-1 rounded-full border ${audSource.includes(s.id) ? 'bg-primary text-white border-primary' : 'border-slate-200 text-text-secondary'}`}>
                                        {s.name}
                                    </button>
                                ))}
                            </div>
                            <p className="text-[11px] text-text-secondary mt-1">No filter = all leads with a phone number you can access.</p>
                        </div>

                        <button onClick={submit} disabled={saving}
                            className="w-full px-4 py-2.5 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 flex items-center justify-center gap-2 disabled:opacity-50">
                            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                            Create & Queue
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
