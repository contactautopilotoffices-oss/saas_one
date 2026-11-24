'use client';

import React, { useEffect, useState } from 'react';
import { Download, Loader2, Plus, Save, Trash2 } from 'lucide-react';

/*
 * The Tech dashboard's HR Configs tab: the company hierarchy for the hiring request form (owner 2026-11-24, from the
 * 23 Nov HR meeting: "role title and department will be dropdowns following the company hierarchy; new designations go
 * through Others"). Each department with its designations, one per line. Empty, the form uses the employee master (the
 * departments and designations of the active employees). The Tech team and admins change it (/api/recruitment/hierarchy).
 */

interface Dept { department: string; designations: string[] }
interface Row { key: number; department: string; designations: string }

let nextKey = 1;
const toRows = (list: Dept[]): Row[] => list.map(d => ({ key: nextKey++, department: d.department, designations: d.designations.join('\n') }));
const lines = (text: string) => text.split('\n').map(s => s.trim()).filter(Boolean);
const toList = (rows: Row[]): Dept[] => rows.map(r => ({ department: r.department.trim(), designations: lines(r.designations) }));
const sig = (list: Dept[]) => JSON.stringify(list.map(d => [d.department.toLowerCase(), d.designations.map(x => x.toLowerCase()).sort()]).sort());

export default function HierarchySettings({ organizationId }: { organizationId: string }) {
    const [saved, setSaved] = useState<Dept[] | null>(null);
    const [rows, setRows] = useState<Row[]>([]);
    const [employeeMaster, setEmployeeMaster] = useState<Dept[]>([]);
    const [canConfigure, setCanConfigure] = useState(false);
    const [saving, setSaving] = useState(false);
    const [note, setNote] = useState<{ text: string; ok: boolean } | null>(null);

    useEffect(() => {
        let cancelled = false;
        void fetch(`/api/recruitment/hierarchy?orgId=${encodeURIComponent(organizationId)}`, { cache: 'no-store' }).then(async res => {
            const data = await res.json().catch(() => null);
            if (cancelled) return;
            if (!res.ok || !Array.isArray(data?.departments)) { setNote({ text: data?.error ?? 'Could not load the departments and designations.', ok: false }); setSaved([]); return; }
            setSaved(data.departments);
            setRows(toRows(data.departments));
            setEmployeeMaster(Array.isArray(data.employeeMaster) ? data.employeeMaster : []);
            setCanConfigure(data.canConfigure === true);
        });
        return () => { cancelled = true; };
    }, [organizationId]);

    const list = toList(rows);
    const dirty = !!saved && sig(list) !== sig(saved);
    const complete = rows.every(r => r.department.trim());
    const keys = list.map(d => d.department.toLowerCase()).filter(Boolean);
    const twice = keys.find((k, i) => keys.indexOf(k) !== i);
    const patch = (key: number, change: Partial<Row>) => { setNote(null); setRows(all => all.map(r => (r.key === key ? { ...r, ...change } : r))); };

    const save = async (departments: Dept[]) => {
        setSaving(true);
        setNote(null);
        const res = await fetch('/api/recruitment/hierarchy', {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ orgId: organizationId, departments }),
        });
        const data = await res.json().catch(() => null);
        setSaving(false);
        if (!res.ok) { setNote({ text: data?.error ?? 'Could not save.', ok: false }); return; }
        setSaved(data.departments);
        setRows(toRows(data.departments));
        setNote({ text: data.departments.length ? 'Saved. The hiring request form uses this list now.' : 'Cleared. The form uses the employee master again.', ok: true });
    };

    return (
        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm md:p-5" aria-label="Departments and designations">
            <h3 className="text-sm font-bold text-slate-900 md:text-base">Departments and designations</h3>
            <p className="mt-0.5 text-xs text-slate-500">
                The hiring request form&apos;s <span className="font-semibold">Department</span> and <span className="font-semibold">Role title</span> dropdowns. A manager picks a department, then one of its designations;
                a role not in the list is raised under <span className="font-semibold">Others</span> and marked as a new designation for HR.
                {saved && saved.length === 0 ? ' Nothing is set here, so the form uses the employee master (the departments and designations of the active employees).' : ''}
            </p>
            {!saved ? <p className="mt-3 flex items-center gap-2 text-xs text-slate-500"><Loader2 className="h-3.5 w-3.5 animate-spin" />Loading</p> : (
                <>
                    {rows.length === 0 && (
                        <p className="mt-3 text-xs text-slate-500">
                            {employeeMaster.length ? `The employee master has ${employeeMaster.length} departments. Start from it to edit the list, or leave it empty to keep using it as it is.` : 'No departments set, and the employee master has none to start from.'}
                        </p>
                    )}
                    {rows.length > 0 && (
                        <ul className="mt-3 space-y-3">
                            {rows.map(r => (
                                <li key={r.key} className="rounded-xl border border-slate-200 p-3">
                                    {canConfigure ? (
                                        <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto] md:items-start">
                                            <div>
                                                <label className="text-[11px] font-semibold uppercase tracking-wide text-slate-500" htmlFor={`hi-dept-${r.key}`}>Department</label>
                                                <input id={`hi-dept-${r.key}`} value={r.department} onChange={e => patch(r.key, { department: e.target.value })} maxLength={80} placeholder="e.g. Operations"
                                                    className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-sm text-slate-900" />
                                            </div>
                                            <div>
                                                <label className="text-[11px] font-semibold uppercase tracking-wide text-slate-500" htmlFor={`hi-roles-${r.key}`}>Designations, one per line</label>
                                                <textarea id={`hi-roles-${r.key}`} value={r.designations} onChange={e => patch(r.key, { designations: e.target.value })} rows={Math.min(8, Math.max(3, lines(r.designations).length + 1))}
                                                    placeholder={'Community Manager\nFacility Executive\nCluster Head'} className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm leading-relaxed text-slate-900" />
                                            </div>
                                            <button type="button" onClick={() => { setNote(null); setRows(all => all.filter(x => x.key !== r.key)); }} aria-label={`Remove ${r.department || 'this department'}`}
                                                className="inline-flex h-9 w-9 items-center justify-center self-end rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600 md:mt-5 md:self-start"><Trash2 className="h-4 w-4" /></button>
                                        </div>
                                    ) : (
                                        <p className="text-sm text-slate-800"><span className="font-semibold">{r.department}</span>: {lines(r.designations).join(', ') || 'no designations'}</p>
                                    )}
                                </li>
                            ))}
                        </ul>
                    )}
                    {twice && <p className="mt-2 text-xs font-medium text-rose-700">A department is listed twice. Keep each department once.</p>}
                    <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                        {canConfigure ? (
                            <div className="flex flex-wrap gap-2">
                                <button type="button" onClick={() => { setNote(null); setRows(all => [...all, { key: nextKey++, department: '', designations: '' }]); }} className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"><Plus className="h-3.5 w-3.5" />Add a department</button>
                                {employeeMaster.length > 0 && <button type="button" onClick={() => { setNote({ text: 'Filled from the employee master. Edit it, then save.', ok: true }); setRows(toRows(employeeMaster)); }} className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"><Download className="h-3.5 w-3.5" />Start from the employee master</button>}
                                {saved.length > 0 && <button type="button" onClick={() => void save([])} disabled={saving} className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold text-rose-700 hover:bg-rose-50 disabled:opacity-60">Clear: use the employee master</button>}
                            </div>
                        ) : <span />}
                        <div className="flex flex-wrap items-center gap-3">
                            {note && <span className={`text-xs ${note.ok ? 'text-emerald-700' : 'text-rose-700'}`}>{note.text}</span>}
                            {!canConfigure && <span className="text-xs text-slate-500">Only the Tech team or an admin can change this.</span>}
                            {canConfigure && (
                                <button type="button" onClick={() => void save(list)} disabled={saving || !dirty || !complete || !!twice} title={!complete ? 'Each row needs a department name' : undefined}
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
