'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Check, Loader2, Save, Search, X } from 'lucide-react';

/*
 * The Tech dashboard's "HR Configs" tab (owner 2026-11-20: "make it configurable somewhere in the tech login on who can
 * have that option in their sidebars"; "i dont want it in settings, create a new sidebar tab"): who may raise a hiring
 * request. Those picked, by role
 * or one by one, get "Hiring requests" in their sidebar; nobody else can raise one (HR follows them in Recruitment ->
 * Requisitions). The Tech team and admins change it (/api/recruitment/raisers). Who approves is in Recruitment ->
 * Configurations (the HR Head and admins).
 */

/** The Task Manager's people list (owner 2026-11-20: "the same data like the one in the task manager"). */
interface Person { id: string; name: string; department: string | null }
interface Raisers { roles: string[]; userIds: string[] }

const roleLabel = (r: string) => r.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

export default function RecruitmentRaiserSettings({ organizationId }: { organizationId: string }) {
    const [saved, setSaved] = useState<Raisers | null>(null);
    const [roles, setRoles] = useState<string[]>([]);
    const [userIds, setUserIds] = useState<string[]>([]);
    const [roleOptions, setRoleOptions] = useState<string[]>([]);
    const [people, setPeople] = useState<Person[]>([]);
    const [canConfigure, setCanConfigure] = useState(false);
    const [query, setQuery] = useState('');
    const [saving, setSaving] = useState(false);
    const [note, setNote] = useState<{ text: string; ok: boolean } | null>(null);

    useEffect(() => {
        let cancelled = false;
        void fetch(`/api/recruitment/raisers?orgId=${encodeURIComponent(organizationId)}`, { cache: 'no-store' }).then(async res => {
            const data = await res.json().catch(() => null);
            if (cancelled) return;
            if (!res.ok || !data?.raisers) { setNote({ text: data?.error ?? 'Could not load who can raise hiring requests.', ok: false }); setSaved({ roles: [], userIds: [] }); return; }
            setSaved(data.raisers);
            setRoles(data.raisers.roles);
            setUserIds(data.raisers.userIds);
            setRoleOptions(data.roles ?? []);
            setPeople(data.people ?? []);
            setCanConfigure(data.canConfigure === true);
        });
        return () => { cancelled = true; };
    }, [organizationId]);

    const dirty = !!saved && (JSON.stringify([...roles].sort()) !== JSON.stringify([...saved.roles].sort()) || JSON.stringify([...userIds].sort()) !== JSON.stringify([...saved.userIds].sort()));
    const matches = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return [];
        return people.filter(p => !userIds.includes(p.id) && (p.name.toLowerCase().includes(q) || (p.department ?? '').toLowerCase().includes(q))).slice(0, 30);
    }, [people, query, userIds]);
    const nameOf = (id: string) => people.find(p => p.id === id)?.name ?? 'Someone no longer in the organisation';
    const toggleRole = (r: string) => setRoles(rs => (rs.includes(r) ? rs.filter(x => x !== r) : [...rs, r]));

    const save = async () => {
        setSaving(true);
        setNote(null);
        const res = await fetch('/api/recruitment/raisers', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orgId: organizationId, roles, userIds }) });
        const data = await res.json().catch(() => null);
        setSaving(false);
        if (!res.ok) { setNote({ text: data?.error ?? 'Could not save.', ok: false }); return; }
        setSaved(data.raisers);
        setRoles(data.raisers.roles);
        setUserIds(data.raisers.userIds);
        setNote({ text: 'Saved. Those picked see “Hiring requests” in their sidebar the next time they open the app.', ok: true });
    };

    return (
        <section className="space-y-3">
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm md:p-5" aria-label="Who can raise hiring requests">
                <h3 className="text-sm font-bold text-slate-900 md:text-base">Who can raise hiring requests</h3>
                <p className="mt-0.5 text-xs text-slate-500">The roles and people picked here get <span className="font-semibold">Hiring requests</span> in their sidebar, to raise a request and follow it. Nobody else can raise one; HR follows every request in Recruitment → Requisitions. Nobody is picked until you save.</p>
                {!saved ? <p className="mt-3 flex items-center gap-2 text-xs text-slate-500"><Loader2 className="h-3.5 w-3.5 animate-spin" />Loading</p> : (
                    <>
                        <p className="mt-4 text-xs font-semibold text-slate-600">Roles <span className="font-normal text-slate-400">· everyone with the role (on the organisation or on a property)</span></p>
                        {roleOptions.length === 0 && canConfigure ? <p className="mt-1 text-xs text-slate-500">No roles found in this organisation.</p> : (
                            <div className="mt-1.5 flex flex-wrap gap-1.5" role="group" aria-label="Roles">
                                {(canConfigure ? roleOptions : roles).map(r => {
                                    const on = roles.includes(r);
                                    return (
                                        <button key={r} type="button" onClick={() => toggleRole(r)} disabled={!canConfigure} aria-pressed={on}
                                            className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold disabled:cursor-default ${on ? 'border-primary bg-primary text-white' : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'}`}>
                                            {on && <Check className="h-3 w-3" aria-hidden />}{roleLabel(r)}
                                        </button>
                                    );
                                })}
                                {!canConfigure && roles.length === 0 && <span className="text-xs text-slate-500">None</span>}
                            </div>
                        )}

                        <p className="mt-4 text-xs font-semibold text-slate-600">People <span className="font-normal text-slate-400">· one by one, whatever their role</span></p>
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                            {userIds.map(id => (
                                <span key={id} className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-800">
                                    {nameOf(id)}
                                    {canConfigure && <button type="button" onClick={() => setUserIds(ids => ids.filter(x => x !== id))} aria-label={`Remove ${nameOf(id)}`} className="text-slate-400 hover:text-rose-600"><X className="h-3 w-3" /></button>}
                                </span>
                            ))}
                            {userIds.length === 0 && <span className="text-xs text-slate-500">Nobody picked by name.</span>}
                        </div>
                        {canConfigure && (
                            <div className="relative mt-2 max-w-md">
                                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" aria-hidden />
                                <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Add a person: search by name or department" aria-label="Add a person"
                                    className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-8 pr-2.5 text-sm text-slate-900" />
                                {matches.length > 0 && (
                                    <ul className="absolute z-10 mt-1 max-h-60 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
                                        {matches.map(p => (
                                            <li key={p.id}>
                                                <button type="button" onClick={() => { setUserIds(ids => [...ids, p.id]); setQuery(''); }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50">
                                                    <span className="min-w-0 flex-1 truncate font-medium text-slate-900">{p.name}</span>
                                                    <span className="shrink-0 text-xs text-slate-500">{p.department ?? ''}</span>
                                                </button>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </div>
                        )}

                        <div className="mt-4 flex flex-wrap items-center justify-end gap-3">
                            {note && <span className={`text-xs ${note.ok ? 'text-emerald-700' : 'text-rose-700'}`}>{note.text}</span>}
                            {!canConfigure && <span className="text-xs text-slate-500">Only the Tech team or an admin can change this.</span>}
                            {canConfigure && (
                                <button type="button" onClick={() => void save()} disabled={saving || !dirty} className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-xs font-bold text-white disabled:opacity-60">
                                    {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}Save
                                </button>
                            )}
                        </div>
                    </>
                )}
            </div>
        </section>
    );
}
