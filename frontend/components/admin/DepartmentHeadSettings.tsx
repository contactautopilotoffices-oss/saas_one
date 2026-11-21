'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Loader2, Plus, Save, Trash2 } from 'lucide-react';

/*
 * The Tech dashboard's HR Configs tab: the department heads (owner 2026-11-21, "go ahead with all"; the spec's
 * "Department head: see own department's requisitions and status; endorse requisitions"). Each head gets "Hiring
 * requests" in their sidebar, sees the requests raised for their department, and may endorse them. Endorsing tells
 * the approvers they support it; it approves nothing. The Tech team and admins change it (/api/recruitment/department-heads).
 * The people and departments are the Task Manager's list.
 */

interface Person { id: string; name: string; department: string | null }
interface Head { department: string; userId: string }
interface Row { key: number; department: string; userId: string }

let nextKey = 1;
const toRows = (heads: Head[]): Row[] => heads.map(h => ({ key: nextKey++, department: h.department, userId: h.userId }));
const sig = (rows: { department: string; userId: string }[]) => JSON.stringify(rows.map(r => [r.department.trim().toLowerCase(), r.userId]).sort());

export default function DepartmentHeadSettings({ organizationId }: { organizationId: string }) {
    const [saved, setSaved] = useState<Head[] | null>(null);
    const [rows, setRows] = useState<Row[]>([]);
    const [people, setPeople] = useState<Person[]>([]);
    const [departments, setDepartments] = useState<string[]>([]);
    const [canConfigure, setCanConfigure] = useState(false);
    const [saving, setSaving] = useState(false);
    const [note, setNote] = useState<{ text: string; ok: boolean } | null>(null);

    useEffect(() => {
        let cancelled = false;
        void fetch(`/api/recruitment/department-heads?orgId=${encodeURIComponent(organizationId)}`, { cache: 'no-store' }).then(async res => {
            const data = await res.json().catch(() => null);
            if (cancelled) return;
            if (!res.ok || !Array.isArray(data?.heads)) { setNote({ text: data?.error ?? 'Could not load the department heads.', ok: false }); setSaved([]); return; }
            setSaved(data.heads);
            setRows(toRows(data.heads));
            setPeople(data.people ?? []);
            setDepartments(data.departments ?? []);
            setCanConfigure(data.canConfigure === true);
        });
        return () => { cancelled = true; };
    }, [organizationId]);

    const nameOf = useMemo(() => {
        const byId = new Map(people.map(p => [p.id, p.name]));
        return (id: string) => byId.get(id) ?? 'Someone no longer in the list';
    }, [people]);
    const complete = rows.every(r => r.department.trim() && r.userId);
    const dirty = !!saved && sig(rows) !== sig(saved);
    const keys = rows.map(r => r.department.trim().toLowerCase()).filter(Boolean);
    const twice = keys.find((k, i) => keys.indexOf(k) !== i);
    const patch = (key: number, change: Partial<Row>) => { setNote(null); setRows(list => list.map(r => (r.key === key ? { ...r, ...change } : r))); };

    const save = async () => {
        if (!complete || twice) return;
        setSaving(true);
        setNote(null);
        const res = await fetch('/api/recruitment/department-heads', {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ orgId: organizationId, heads: rows.map(r => ({ department: r.department.trim(), userId: r.userId })) }),
        });
        const data = await res.json().catch(() => null);
        setSaving(false);
        if (!res.ok) { setNote({ text: data?.error ?? 'Could not save.', ok: false }); return; }
        setSaved(data.heads);
        setRows(toRows(data.heads));
        setNote({ text: 'Saved. Each head sees “Hiring requests” in their sidebar the next time they open the app.', ok: true });
    };

    return (
        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm md:p-5" aria-label="Department heads">
            <h3 className="text-sm font-bold text-slate-900 md:text-base">Department heads</h3>
            <p className="mt-0.5 text-xs text-slate-500">
                A department head gets <span className="font-semibold">Hiring requests</span> in their sidebar, sees the requests raised for their department, and can <span className="font-semibold">endorse</span> them.
                Endorsing tells the HR Head and Director they support the request; it does not approve it. The department on a request must match the name here (the form suggests these names).
            </p>
            {!saved ? <p className="mt-3 flex items-center gap-2 text-xs text-slate-500"><Loader2 className="h-3.5 w-3.5 animate-spin" />Loading</p> : (
                <>
                    {rows.length === 0 && <p className="mt-3 text-xs text-slate-500">No department heads set.</p>}
                    {rows.length > 0 && (
                        <ul className="mt-3 space-y-2">
                            {rows.map(r => (
                                <li key={r.key} className="flex flex-wrap items-center gap-2">
                                    {canConfigure ? (
                                        <>
                                            <label className="sr-only" htmlFor={`dh-dept-${r.key}`}>Department</label>
                                            <input id={`dh-dept-${r.key}`} list={`dh-depts-${organizationId}`} value={r.department} onChange={e => patch(r.key, { department: e.target.value })} maxLength={80} placeholder="Department"
                                                className="h-9 min-w-[180px] flex-1 rounded-lg border border-slate-200 bg-white px-2.5 text-sm text-slate-900" />
                                            <label className="sr-only" htmlFor={`dh-user-${r.key}`}>Head of the department</label>
                                            <select id={`dh-user-${r.key}`} value={r.userId} onChange={e => patch(r.key, { userId: e.target.value })}
                                                className="h-9 min-w-[200px] flex-1 rounded-lg border border-slate-200 bg-white px-2 text-sm text-slate-900">
                                                <option value="">Pick the head…</option>
                                                {r.userId && !people.some(p => p.id === r.userId) && <option value={r.userId}>{nameOf(r.userId)}</option>}
                                                {people.map(p => <option key={p.id} value={p.id}>{p.name}{p.department ? ` · ${p.department}` : ''}</option>)}
                                            </select>
                                            <button type="button" onClick={() => { setNote(null); setRows(list => list.filter(x => x.key !== r.key)); }} aria-label={`Remove the ${r.department || 'new'} row`} className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600"><Trash2 className="h-4 w-4" /></button>
                                        </>
                                    ) : (
                                        <p className="text-sm text-slate-800"><span className="font-semibold">{r.department}</span> — {nameOf(r.userId)}</p>
                                    )}
                                </li>
                            ))}
                        </ul>
                    )}
                    <datalist id={`dh-depts-${organizationId}`}>{departments.map(d => <option key={d} value={d} />)}</datalist>
                    {twice && <p className="mt-2 text-xs font-medium text-rose-700">A department is listed twice. Give each department one head.</p>}
                    <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                        {canConfigure ? <button type="button" onClick={() => { setNote(null); setRows(list => [...list, { key: nextKey++, department: '', userId: '' }]); }} className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"><Plus className="h-3.5 w-3.5" />Add a department head</button> : <span />}
                        <div className="flex flex-wrap items-center gap-3">
                            {note && <span className={`text-xs ${note.ok ? 'text-emerald-700' : 'text-rose-700'}`}>{note.text}</span>}
                            {!canConfigure && <span className="text-xs text-slate-500">Only the Tech team or an admin can change this.</span>}
                            {canConfigure && (
                                <button type="button" onClick={() => void save()} disabled={saving || !dirty || !complete || !!twice} title={!complete ? 'Each row needs a department and a person' : undefined}
                                    className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-xs font-bold text-white disabled:opacity-60">
                                    {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}Save
                                </button>
                            )}
                        </div>
                    </div>
                </>
            )}
        </section>
    );
}
