'use client';

import React, { useEffect, useState } from 'react';
import { Loader2, Save } from 'lucide-react';
import type { RecruitmentConfig } from '@/backend/lib/candidates/types';

/*
 * Settings -> Notifications -> Recruitment (owner 2026-11-17): who approves hiring requests. Stage 2 of the
 * Recruitment Module spec: the HR Head, then the Director; above the CTC level the Director approves regardless.
 * Each approver has a backup for leave, and for the rule that nobody approves a request they raised. Stored in
 * organization_settings.recruitment_config through /api/recruitment/settings; never in code.
 */

interface UserItem { id: string; full_name: string; email: string; role?: string }
type Slot = 'hrHead' | 'director';
const SLOTS: { id: Slot; label: string; hint: string }[] = [
    { id: 'hrHead', label: 'HR Head', hint: 'Reviews every request first and ticks whether the role is in the approved plan.' },
    { id: 'director', label: 'Director', hint: 'Approves out-of-plan roles and any above the CTC level; informed of in-plan approvals.' },
];

export default function RecruitmentApproverSettings({ organizationId, users }: { organizationId: string; users: UserItem[] }) {
    const [config, setConfig] = useState<RecruitmentConfig | null>(null);
    const [canConfigure, setCanConfigure] = useState(true);
    const [ctcLpa, setCtcLpa] = useState('');
    const [targetDays, setTargetDays] = useState('21');
    const [saving, setSaving] = useState(false);
    const [note, setNote] = useState<{ text: string; ok: boolean } | null>(null);
    useEffect(() => {
        let cancelled = false;
        void fetch(`/api/recruitment/settings?orgId=${encodeURIComponent(organizationId)}`).then(async res => {
            const data = await res.json().catch(() => null);
            if (cancelled) return;
            if (!res.ok || !data?.config) { setNote({ text: data?.error ?? 'Could not load the recruitment settings.', ok: false }); setConfig({ hrHead: { userId: null, backupUserId: null }, director: { userId: null, backupUserId: null }, directorCtcLevel: null, targetDays: 21 }); return; }
            setConfig(data.config);
            setCanConfigure(data.canConfigure !== false);
            setCtcLpa(data.config.directorCtcLevel === null ? '' : String(data.config.directorCtcLevel / 100_000));
            setTargetDays(String(data.config.targetDays ?? 21));
        });
        return () => { cancelled = true; };
    }, [organizationId]);

    const setSlot = (slot: Slot, key: 'userId' | 'backupUserId', value: string) => setConfig(c => (c ? { ...c, [slot]: { ...c[slot], [key]: value || null } } : c));
    const save = async () => {
        if (!config) return;
        setSaving(true);
        setNote(null);
        const lpa = ctcLpa.trim() === '' ? null : Number(ctcLpa);
        const res = await fetch('/api/recruitment/settings', {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ orgId: organizationId, hrHead: config.hrHead, director: config.director, directorCtcLevel: lpa === null || !Number.isFinite(lpa) ? null : Math.round(lpa * 100_000), targetDays: Math.max(1, Number(targetDays) || 21) }),
        });
        const data = await res.json().catch(() => null);
        setSaving(false);
        if (!res.ok) { setNote({ text: data?.error ?? 'Could not save.', ok: false }); return; }
        setConfig(data.config);
        setNote({ text: 'Recruitment approvers saved.', ok: true });
    };
    const sorted = [...users].sort((a, b) => a.full_name.localeCompare(b.full_name));
    const picker = (slot: Slot, key: 'userId' | 'backupUserId', label: string) => (
        <label className="block text-xs font-semibold text-slate-600">
            {label}
            <select value={config?.[slot][key] ?? ''} onChange={e => setSlot(slot, key, e.target.value)} disabled={!canConfigure || !config} className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm text-slate-900 disabled:opacity-60">
                <option value="">— nobody —</option>
                {sorted.map(u => <option key={u.id} value={u.id}>{u.full_name}{u.role ? ` · ${u.role}` : ''}{u.email ? ` · ${u.email}` : ''}</option>)}
            </select>
        </label>
    );

    return (
        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm md:p-5" aria-label="Recruitment approvers">
            <h3 className="text-sm font-bold text-slate-900 md:text-base">Who approves hiring requests</h3>
            <p className="mt-0.5 text-xs text-slate-500">A manager&rsquo;s request goes to the HR Head, then to the Director when the role is out of plan or above the CTC level. A request never goes to the person who raised it: that level&rsquo;s backup takes it, or the other level does. The alerts below say who else is told.</p>
            {!config ? <p className="mt-3 flex items-center gap-2 text-xs text-slate-500"><Loader2 className="h-3.5 w-3.5 animate-spin" />Loading</p> : (
                <>
                    <div className="mt-4 grid gap-4 md:grid-cols-2">
                        {SLOTS.map(s => (
                            <div key={s.id} className="rounded-xl border border-slate-100 bg-slate-50/60 p-3">
                                <p className="text-sm font-bold text-slate-800">{s.label}</p>
                                <p className="mb-2 text-xs text-slate-500">{s.hint}</p>
                                <div className="grid gap-2">
                                    {picker(s.id, 'userId', 'Approver')}
                                    {picker(s.id, 'backupUserId', 'Backup (on leave, or when the approver raised the request)')}
                                </div>
                            </div>
                        ))}
                    </div>
                    <div className="mt-4 grid gap-4 md:grid-cols-2">
                        <label className="block text-xs font-semibold text-slate-600">Director must approve above (LPA, CTC)
                            <input type="number" min={0} step={0.5} value={ctcLpa} onChange={e => setCtcLpa(e.target.value)} disabled={!canConfigure} placeholder="Leave empty: never on pay alone" className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm text-slate-900 disabled:opacity-60" />
                            <span className="mt-1 block text-[11px] font-normal text-slate-500">A request whose budget band maximum is above this goes to the Director even when in plan.</span>
                        </label>
                        <label className="block text-xs font-semibold text-slate-600">Target days to fill an approved role
                            <input type="number" min={1} max={365} value={targetDays} onChange={e => setTargetDays(e.target.value)} disabled={!canConfigure} className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm text-slate-900 disabled:opacity-60" />
                            <span className="mt-1 block text-[11px] font-normal text-slate-500">The position opened from an approved request gets this target (21 by default).</span>
                        </label>
                    </div>
                    <div className="mt-4 flex flex-wrap items-center justify-end gap-3">
                        {note && <span className={`text-xs ${note.ok ? 'text-emerald-700' : 'text-rose-700'}`}>{note.text}</span>}
                        {!canConfigure && <span className="text-xs text-slate-500">Only an organisation admin or the Tech team can change these.</span>}
                        <button type="button" onClick={() => void save()} disabled={saving || !canConfigure} className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-xs font-bold text-white disabled:opacity-60">
                            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}Save approvers
                        </button>
                    </div>
                </>
            )}
        </section>
    );
}
