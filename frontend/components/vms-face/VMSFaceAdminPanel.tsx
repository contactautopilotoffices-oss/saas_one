'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Search, Settings2, Trash2, Users, X } from 'lucide-react';

// VMS Face (testing) — organisation switches and the saved-faces list (with delete), for the Tech Team.

interface Settings {
    face_recognition_enabled: boolean;
    liveness_enabled: boolean;
    match_threshold: number;
    otp_delivery: 'screen_test' | 'whatsapp';
    host_call_enabled: boolean;
}

interface Configured { biofrq: boolean; whatsapp_otp: boolean; host_call: boolean; host_whatsapp: boolean }

interface Profile { id: string; name: string; mobile: string; coming_from: string | null; last_seen_at: string; created_at: string }

interface Props {
    orgId: string;
    isOpen: boolean;
    onClose: () => void;
}

const Toggle: React.FC<{ id: string; label: string; hint: string; checked: boolean; disabled?: boolean; onChange: (v: boolean) => void }> = ({ id, label, hint, checked, disabled, onChange }) => (
    <div className="flex items-start justify-between gap-4 py-3 border-b border-slate-100 last:border-0">
        <div>
            <label htmlFor={id} className="text-sm font-bold text-slate-900">{label}</label>
            <p className="text-[11px] text-slate-500 mt-0.5">{hint}</p>
        </div>
        <button
            id={id}
            type="button"
            role="switch"
            aria-checked={checked}
            disabled={disabled}
            onClick={() => onChange(!checked)}
            className={`relative shrink-0 w-11 h-6 rounded-full transition-colors disabled:opacity-40 ${checked ? 'bg-primary' : 'bg-slate-300'}`}
        >
            <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${checked ? 'translate-x-5' : ''}`} />
        </button>
    </div>
);

const VMSFaceAdminPanel: React.FC<Props> = ({ orgId, isOpen, onClose }) => {
    const [tab, setTab] = useState<'settings' | 'faces'>('settings');
    const [settings, setSettings] = useState<Settings | null>(null);
    const [configured, setConfigured] = useState<Configured | null>(null);
    const [profiles, setProfiles] = useState<Profile[]>([]);
    const [search, setSearch] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    const loadSettings = useCallback(async () => {
        const res = await fetch(`/api/vms-face/org/${orgId}/settings`);
        const data = await res.json().catch(() => ({}));
        if (res.ok) { setSettings(data.settings); setConfigured(data.configured); } else setError(data.error || 'Could not load settings');
    }, [orgId]);

    const loadProfiles = useCallback(async (q: string) => {
        const res = await fetch(`/api/vms-face/org/${orgId}/profiles?search=${encodeURIComponent(q)}`);
        const data = await res.json().catch(() => ({}));
        if (res.ok) setProfiles(data.profiles || []); else setError(data.error || 'Could not load faces');
    }, [orgId]);

    useEffect(() => { if (isOpen) { setError(''); loadSettings(); } }, [isOpen, loadSettings]);
    useEffect(() => {
        if (!isOpen || tab !== 'faces') return;
        const t = setTimeout(() => loadProfiles(search), 300);
        return () => clearTimeout(t);
    }, [isOpen, tab, search, loadProfiles]);

    const save = async (patch: Partial<Settings>) => {
        setBusy(true);
        setError('');
        try {
            const res = await fetch(`/api/vms-face/org/${orgId}/settings`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(patch),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || 'Save failed');
            setSettings(data.settings);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Save failed');
        } finally {
            setBusy(false);
        }
    };

    const removeFace = async (p: Profile, reason: 'visitor_request' | 'admin') => {
        if (!confirm(`Permanently delete ${p.name}'s face? This cannot be undone.`)) return;
        setBusy(true);
        setError('');
        try {
            const res = await fetch(`/api/vms-face/org/${orgId}/profiles?id=${p.id}&reason=${reason}`, { method: 'DELETE' });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || 'Delete failed');
            setProfiles(prev => prev.filter(x => x.id !== p.id));
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Delete failed');
        } finally {
            setBusy(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm" onClick={onClose}>
            <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                role="dialog"
                aria-modal="true"
                aria-label="Face VMS settings"
                className="bg-white w-full max-w-lg max-h-[90vh] rounded-3xl shadow-2xl overflow-hidden flex flex-col"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
                    <div className="flex gap-1 bg-slate-100 rounded-xl p-1" role="tablist">
                        {([['settings', 'Settings', Settings2], ['faces', 'Saved Faces', Users]] as const).map(([id, label, Icon]) => (
                            <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
                                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-black uppercase tracking-wider ${tab === id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>
                                <Icon className="w-3.5 h-3.5" /> {label}
                            </button>
                        ))}
                    </div>
                    <button type="button" onClick={onClose} aria-label="Close" className="p-1.5 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <div className="p-6 overflow-y-auto">
                    {error && <p role="alert" className="mb-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">{error}</p>}

                    {tab === 'settings' && (!settings || !configured ? (
                        <div className="py-10 flex justify-center"><div className="w-6 h-6 border-2 border-slate-200 border-t-primary rounded-full animate-spin" /></div>
                    ) : (
                        <div>
                            {!configured.biofrq && (
                                <p className="mb-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                                    BIOFRQ_API_KEY is not set on the server, so face recognition is off until it is added.
                                </p>
                            )}
                            <Toggle id="fv-face" label="Face recognition" hint="Verify returning visitors by face at check-in; save new faces after OTP consent."
                                checked={settings.face_recognition_enabled} disabled={busy} onChange={(v) => save({ face_recognition_enabled: v })} />
                            <Toggle id="fv-live" label="Liveness check" hint="Reject photos of a screen or a print. Adds one BioFRQ call per scan."
                                checked={settings.liveness_enabled} disabled={busy} onChange={(v) => save({ liveness_enabled: v })} />
                            <Toggle id="fv-otp" label="Send OTP on WhatsApp" hint={configured.whatsapp_otp
                                ? 'Off = test mode: the code is shown on this screen instead of sent.'
                                : 'Needs an approved WhatsApp OTP template (VMS_FACE_OTP_CAMPAIGN). Until then the code is shown on screen.'}
                                checked={settings.otp_delivery === 'whatsapp'} disabled={busy || !configured.whatsapp_otp}
                                onChange={(v) => save({ otp_delivery: v ? 'whatsapp' : 'screen_test' })} />
                            <Toggle id="fv-call" label="Call host for approval" hint={configured.host_call
                                ? 'A voice agent rings the host on check-in. This calls a real phone.'
                                : 'Needs the Bolna host-approval agent (VMS_FACE_BOLNA_AGENT_ID).'}
                                checked={settings.host_call_enabled} disabled={busy || !configured.host_call} onChange={(v) => save({ host_call_enabled: v })} />
                            <div className="flex items-center justify-between gap-4 py-3">
                                <div>
                                    <label htmlFor="fv-threshold" className="text-sm font-bold text-slate-900">Match threshold</label>
                                    <p className="text-[11px] text-slate-500 mt-0.5">Higher = fewer false matches, more &ldquo;not recognised&rdquo;. 0.30–0.99.</p>
                                </div>
                                <input id="fv-threshold" type="number" min={0.3} max={0.99} step={0.01} defaultValue={settings.match_threshold} disabled={busy}
                                    onBlur={(e) => { const v = Number(e.target.value); if (v !== settings.match_threshold) save({ match_threshold: v }); }}
                                    className="w-20 px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-sm text-right" />
                            </div>
                        </div>
                    ))}

                    {tab === 'faces' && (
                        <div>
                            <div className="relative mb-3">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                                <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name or mobile" aria-label="Search saved faces"
                                    className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm" />
                            </div>
                            <p className="text-[11px] text-slate-500 mb-3">Faces are deleted automatically 12 months after the last visit. Delete one now when a visitor asks.</p>
                            {profiles.length === 0 ? (
                                <p className="py-8 text-center text-sm italic text-slate-400">No saved faces.</p>
                            ) : (
                                <ul className="divide-y divide-slate-100">
                                    {profiles.map(p => (
                                        <li key={p.id} className="flex items-center justify-between gap-3 py-3">
                                            <div className="min-w-0">
                                                <p className="truncate text-sm font-bold text-slate-900">{p.name}</p>
                                                <p className="text-[11px] text-slate-500">{p.mobile}{p.coming_from ? ` · ${p.coming_from}` : ''}</p>
                                                <p className="text-[10px] text-slate-400">Last visit {new Date(p.last_seen_at).toLocaleDateString()}</p>
                                            </div>
                                            <button type="button" onClick={() => removeFace(p, 'visitor_request')} disabled={busy}
                                                className="inline-flex shrink-0 items-center gap-1 px-2.5 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-xl text-xs font-bold disabled:opacity-50">
                                                <Trash2 className="w-3.5 h-3.5" /> Delete face
                                            </button>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>
                    )}
                </div>
            </motion.div>
        </div>
    );
};

export default VMSFaceAdminPanel;
