'use client';

import React, { useEffect, useState } from 'react';
import { Check, Lock, RotateCcw } from 'lucide-react';
import type { RecruitmentConfig } from '@/backend/lib/candidates/types';
import { api, qs } from './api';
import { BTN_GHOST, BTN_PRIMARY, CARD, FIELD, LABEL, Spinner, WELL } from './ui';

/*
 * "Hiring request approvals" in the Tech dashboard's HR Configs tab (owner 2026-11-20: "move this Hiring request
 * approvals section to the tech login in HR configs tab"; the Tech team and admins change it). The HR Head (and
 * backup) is picked from the HR team, the Director (and backup) from the org super admins. Who
 * approves hiring requests: the HR Head, then the Director when the role is out of plan or above the CTC level; each
 * with a backup for leave, and for the rule that nobody approves a request they raised. Plus the target days to fill
 * a role opened from an approved request. Stored in organization_settings.recruitment_config (/api/recruitment/settings).
 */

interface Person { id: string; name: string; department: string | null; role: string | null }
interface Pools { hr: Person[]; directors: Person[] }
type Slot = 'hrHead' | 'director';
const SLOTS: { id: Slot; label: string; hint: string; pool: keyof Pools; from: string }[] = [
    { id: 'hrHead', label: 'HR Head', hint: 'Reviews every request first and ticks whether the role is in the approved plan.', pool: 'hr', from: 'the HR team' },
    { id: 'director', label: 'Director', hint: 'Approves roles out of plan or above the CTC level; told about in-plan approvals.', pool: 'directors', from: 'the org super admins' },
];
const EMPTY: RecruitmentConfig = { hrHead: { userId: null, backupUserId: null }, director: { userId: null, backupUserId: null }, directorCtcLevel: null, targetDays: 21, raisers: { roles: [], userIds: [] }, departmentHeads: [], rejectionReasons: [], offerLetter: "", hierarchy: [] };

const lpaOf = (c: RecruitmentConfig) => (c.directorCtcLevel === null ? '' : String(c.directorCtcLevel / 100_000));

export default function ApprovalSettings({ orgId }: { orgId: string }) {
    const [savedNote, setSavedNote] = useState(false);
    const [saved, setSaved] = useState<RecruitmentConfig | null>(null);
    const [config, setConfig] = useState<RecruitmentConfig>(EMPTY);
    const [ctcLpa, setCtcLpa] = useState('');
    const [targetDays, setTargetDays] = useState('21');
    const [pools, setPools] = useState<Pools>({ hr: [], directors: [] });
    const [canConfigure, setCanConfigure] = useState(false);
    const [loadError, setLoadError] = useState('');
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const [nonce, setNonce] = useState(0);

    useEffect(() => {
        const ctrl = new AbortController();
        void api<{ config: RecruitmentConfig; canConfigure: boolean; pools: Pools }>(`/api/recruitment/settings${qs({ orgId })}`, { signal: ctrl.signal }).then(res => {
            if (ctrl.signal.aborted) return;
            if (!res.ok) { setLoadError(res.error); return; }
            setLoadError('');
            setSaved(res.data.config);
            setConfig(res.data.config);
            setCtcLpa(lpaOf(res.data.config));
            setTargetDays(String(res.data.config.targetDays));
            setPools(res.data.pools);
            setCanConfigure(res.data.canConfigure);
        });
        return () => ctrl.abort();
    }, [orgId, nonce]);

    const lpa = ctcLpa.trim() === '' ? null : Number(ctcLpa);
    const days = Number(targetDays);
    const badLpa = lpa !== null && (!Number.isFinite(lpa) || lpa < 0 || lpa > 1000);
    const badDays = !Number.isInteger(days) || days < 1 || days > 365;
    const next: RecruitmentConfig = { ...config, directorCtcLevel: lpa === null || badLpa ? null : Math.round(lpa * 100_000), targetDays: badDays ? config.targetDays : days };
    const dirty = !!saved && (JSON.stringify(next) !== JSON.stringify(saved) || badLpa || badDays);

    const setSlot = (slot: Slot, key: 'userId' | 'backupUserId', value: string) => { setSavedNote(false); setConfig(c => ({ ...c, [slot]: { ...c[slot], [key]: value || null } })); };
    const discard = () => { if (!saved) return; setSavedNote(false); setConfig(saved); setCtcLpa(lpaOf(saved)); setTargetDays(String(saved.targetDays)); setError(''); };
    const save = async () => {
        if (busy || badLpa || badDays) return;
        setBusy(true);
        setError('');
        const res = await api<{ config: RecruitmentConfig }>('/api/recruitment/settings', {
            method: 'PATCH', json: { orgId, hrHead: next.hrHead, director: next.director, directorCtcLevel: next.directorCtcLevel, targetDays: next.targetDays },
        });
        setBusy(false);
        if (!res.ok) { setError(res.error); return; }
        setSaved(res.data.config);
        setConfig(res.data.config);
        setCtcLpa(lpaOf(res.data.config));
        setTargetDays(String(res.data.config.targetDays));
        setSavedNote(true);
    };

    const all = [...pools.hr, ...pools.directors];
    const nameOf = (id: string | null) => (id ? all.find(p => p.id === id)?.name ?? 'Someone no longer in the list' : 'Nobody');
    const picker = (slot: Slot, key: 'userId' | 'backupUserId', label: string) => {
        const id = `appr-${slot}-${key}`;
        const people = pools[SLOTS.find(s => s.id === slot)!.pool];
        return (
            <div>
                <label htmlFor={id} className={LABEL}>{label}</label>
                {canConfigure ? (
                    <select id={id} value={config[slot][key] ?? ''} onChange={e => setSlot(slot, key, e.target.value)} disabled={busy} className={`${FIELD} mt-1 w-full`}>
                        <option value="">Nobody</option>
                        {config[slot][key] && !people.some(p => p.id === config[slot][key]) && <option value={config[slot][key]!}>{nameOf(config[slot][key])} (not in this list any more)</option>}
                        {people.map(p => <option key={p.id} value={p.id}>{p.name}{p.department ? ` · ${p.department}` : p.role ? ` · ${p.role.replace(/_/g, ' ')}` : ''}</option>)}
                    </select>
                ) : <p id={id} className="mt-1 text-sm font-semibold text-text-primary">{nameOf(config[slot][key])}</p>}
            </div>
        );
    };

    if (loadError) return <div className={`${CARD} px-5 py-4`}><p role="alert" className="text-sm text-error">{loadError}</p><button type="button" onClick={() => setNonce(n => n + 1)} className={`${BTN_GHOST} mt-1`}>Try again</button></div>;
    if (!saved) return <p className="flex items-center gap-x-2 text-sm text-text-tertiary"><Spinner className="h-3.5 w-3.5" />Loading the approvers</p>;

    return (
        <section className={`${CARD} px-5 py-4`} aria-label="Hiring request approvals">
            <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
                <div className="min-w-0 flex-1">
                    <h2 className="font-display text-lg font-semibold text-text-primary">Hiring request approvals</h2>
                    <p className="mt-1 max-w-[70ch] text-sm text-text-secondary">A request goes to the HR Head, then to the Director when the role is out of plan or above the CTC level. Nobody approves a request they raised: that level&rsquo;s backup takes it, or the other level does.</p>
                </div>
                {canConfigure ? (
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
                        {dirty ? <span className="text-xs font-semibold text-amber-800">Unsaved changes</span> : savedNote ? <span className="inline-flex items-center gap-x-1 text-xs font-semibold text-emerald-800"><Check className="h-3.5 w-3.5" aria-hidden />Approvers saved</span> : <span className="text-xs text-text-tertiary">All changes saved</span>}
                        <button type="button" onClick={discard} disabled={!dirty || busy} className={BTN_GHOST}><RotateCcw className="h-4 w-4" />Discard</button>
                        <button type="button" onClick={() => void save()} disabled={!dirty || busy || badLpa || badDays} className={BTN_PRIMARY}>{busy && <Spinner />}Save approvers</button>
                    </div>
                ) : (
                    <span className="inline-flex items-center gap-x-1.5 text-xs text-text-secondary"><Lock className="h-3.5 w-3.5" aria-hidden />Only the Tech team or an admin can change these.</span>
                )}
            </div>
            {!saved.hrHead.userId && !saved.director.userId && <p role="status" className="mt-3 rounded-lg bg-warning/15 px-3 py-2 text-sm text-amber-900">No approvers yet: hiring requests can be drafted but not submitted until the HR Head or the Director is set.</p>}
            {error && <p role="alert" className="mt-3 text-sm font-medium text-error">{error}</p>}

            <div className="mt-4 grid gap-3 md:grid-cols-2">
                {SLOTS.map(s => (
                    <div key={s.id} className={`${WELL} px-4 py-3`}>
                        <p className="text-sm font-semibold text-text-primary">{s.label}</p>
                        <p className="mb-2 text-xs text-text-secondary">{s.hint} Picked from {s.from}.</p>
                        <div className="grid gap-2.5">
                            {picker(s.id, 'userId', 'Approver')}
                            {picker(s.id, 'backupUserId', 'Backup (on leave, or when the approver raised the request)')}
                        </div>
                    </div>
                ))}
            </div>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
                <div>
                    <label htmlFor="appr-ctc" className={LABEL}>Director must also approve above (CTC, lakhs per year)</label>
                    {canConfigure
                        ? <input id="appr-ctc" type="number" min={0} step={0.5} value={ctcLpa} onChange={e => setCtcLpa(e.target.value)} disabled={busy} placeholder="Empty: never on pay alone" className={`${FIELD} mt-1 w-full`} />
                        : <p id="appr-ctc" className="mt-1 text-sm font-semibold text-text-primary">{saved.directorCtcLevel === null ? 'Not set (never on pay alone)' : `${saved.directorCtcLevel / 100_000} LPA`}</p>}
                    <p className="mt-1 text-xs text-text-tertiary">{badLpa ? <span className="font-medium text-red-800">Enter lakhs per year, e.g. 12 or 12.5.</span> : 'Example: 12 means a role budgeted above ₹12 LPA also goes to the Director, even in plan.'}</p>
                </div>
                <div>
                    <label htmlFor="appr-days" className={LABEL}>Target days to fill an approved role</label>
                    {canConfigure
                        ? <input id="appr-days" type="number" min={1} max={365} value={targetDays} onChange={e => setTargetDays(e.target.value)} disabled={busy} className={`${FIELD} mt-1 w-full`} />
                        : <p id="appr-days" className="mt-1 text-sm font-semibold text-text-primary">{saved.targetDays} days</p>}
                    <p className="mt-1 text-xs text-text-tertiary">{badDays ? <span className="font-medium text-red-800">Between 1 and 365 days.</span> : 'The position opened from an approved request gets this target.'}</p>
                </div>
            </div>
        </section>
    );
}
