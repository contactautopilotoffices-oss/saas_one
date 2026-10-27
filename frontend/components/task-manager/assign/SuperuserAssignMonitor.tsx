'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, CheckCircle2, Loader2, Plus, RefreshCw, Search } from 'lucide-react';
import { useAuth } from '@/frontend/context/AuthContext';
import { createClient } from '@/frontend/utils/supabase/client';
import { DateRange, localDay, todayRange } from '../DateRangePicker';
import TaskRangeFilter from './TaskRangeFilter';
import DueDatePicker, { DueDateChoices, dueLabel } from './DueDatePicker';
import ProgressRings, { Ring } from './ProgressRings';
import SelectMenu, { MenuOption } from './SelectMenu';
import { BottomSheet, useIsDesktop } from './Sheet';

/**
 * "Assign & monitor" for a superuser (owner 2026-10-22):
 *  - Assign tasks: department → person → task → day, right on the page (a bottom sheet on a phone)
 *  - Organisation progress rings, then one Department and one Staff dropdown (only departments switched ON in the
 *    Control Center, "Show all" for the rest)
 *  - Everyone's tasks grouped by person, VIEW ONLY: only the person holding a task moves it (the server enforces this)
 * The server also hides every other superuser's tasks.
 */

interface Department { id: string; name: string }
interface Person { id: string; name: string; department_id: string | null; role?: string }
type Status = 'pending' | 'in_progress' | 'completed';
interface Task {
    id: string; title: string; description: string | null; employee_id: string; assigned_date: string; status: Status;
    is_carried_forward?: boolean; employee?: { id: string; full_name: string };
}
type StatusFilter = 'all' | 'open' | 'done' | 'carried';

const STATUS: Record<Status, { label: string; cls: string }> = {
    pending: { label: 'Not started', cls: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300' },
    in_progress: { label: 'In progress', cls: 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300' },
    completed: { label: 'Done', cls: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300' },
};
const SHOW_PER_PERSON = 5;

const isOpen = (t: Task) => t.status !== 'completed';
const pct = (done: number, total: number) => (total > 0 ? Math.round((done / total) * 100) : 0);
const donePct = (list: Task[]) => pct(list.filter(t => !isOpen(t)).length, list.length);
const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : 0);
const initials = (name: string) => name.trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
const shortDay = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

const field = 'min-h-11 w-full rounded-xl border border-zinc-200 bg-white px-3 shadow-[0_1px_2px_rgba(24,24,27,0.04)] hover:border-zinc-300 text-sm text-zinc-900 outline-none focus:border-indigo-500 focus:ring-[3px] focus:ring-indigo-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:ring-indigo-950';
const fieldLabel = 'flex flex-col gap-1.5 text-xs font-semibold text-zinc-600 dark:text-zinc-400';

export default function SuperuserAssignMonitor() {
    const { user } = useAuth();
    const actorId = user?.id || '';
    const desktop = useIsDesktop();

    const [range, setRange] = useState<DateRange>(todayRange());
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [departments, setDepartments] = useState<Department[]>([]);
    const [people, setPeople] = useState<Person[]>([]);
    const [tasks, setTasks] = useState<Task[]>([]);
    const [activeIds, setActiveIds] = useState<Set<string>>(new Set());
    const [truncated, setTruncated] = useState(false);
    const loadedRef = useRef(false);

    // List filters
    const [showAll, setShowAll] = useState(false);
    const [dept, setDept] = useState('all');
    const [staff, setStaff] = useState('all');
    const [status, setStatus] = useState<StatusFilter>('all');
    const [search, setSearch] = useState('');
    const [expanded, setExpanded] = useState<Set<string>>(new Set());

    // Assign tasks
    const [qDept, setQDept] = useState('all');
    const [qPerson, setQPerson] = useState('');
    const [qTitle, setQTitle] = useState('');
    const [qDate, setQDate] = useState(localDay());
    const [submitting, setSubmitting] = useState(false);
    const [sheetOpen, setSheetOpen] = useState(false);
    const [flash, setFlash] = useState(false);
    const [toast, setToast] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
    const cardRef = useRef<HTMLElement>(null);
    const titleRef = useRef<HTMLInputElement>(null);
    const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    const say = useCallback((kind: 'ok' | 'err', text: string) => {
        setToast({ kind, text });
        setTimeout(() => setToast(n => (n && n.text === text ? null : n)), 4000);
    }, []);

    const load = useCallback(async () => {
        if (!actorId) return;
        if (loadedRef.current) setRefreshing(true);
        try {
            const res = await fetch(`/api/task-manager/tasks?${new URLSearchParams({ actorId, from: range.from, to: range.to })}`);
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.error || 'Could not load tasks');
            setDepartments(data.departments || []);
            setPeople(data.assignableEmployees || data.employees || []);
            setTasks(data.tasks || []);
            setActiveIds(new Set(data.activeDepartmentIds || []));
            setTruncated(!!data.truncated);
            setError(null);
            loadedRef.current = true;
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not load tasks');
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, [actorId, range.from, range.to]);

    useEffect(() => { load(); }, [load]);

    // Live updates (e.g. someone marks a task done on WhatsApp)
    useEffect(() => {
        if (!actorId) return;
        const supabase = createClient();
        const channel = supabase.channel('superuser_assign_monitor')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'task_assignments' }, () => { load(); })
            .subscribe();
        return () => { supabase.removeChannel(channel); };
    }, [actorId, load]);

    // ── Who and what is in view ───────────────────────────────────────────────
    const personById = useMemo(() => new Map(people.map(p => [p.id, p])), [people]);
    const deptName = useMemo(() => new Map(departments.map(d => [d.id, d.name])), [departments]);
    const deptOfTask = useCallback((t: Task) => personById.get(t.employee_id)?.department_id ?? null, [personById]);
    const nameOf = useCallback((id: string, t?: Task) => personById.get(id)?.name || t?.employee?.full_name || 'Staff member', [personById]);

    const activeDepts = useMemo(() => departments.filter(d => activeIds.has(d.id)), [departments, activeIds]);
    const shownDepts = showAll ? departments : activeDepts;
    const shownDeptIds = useMemo(() => new Set(shownDepts.map(d => d.id)), [shownDepts]);
    const inShownScope = useCallback((t: Task) => showAll || shownDeptIds.has(deptOfTask(t) ?? ''), [showAll, shownDeptIds, deptOfTask]);

    const scopeTasks = useMemo(() => tasks.filter(inShownScope), [tasks, inShownScope]);
    const deptTasks = useMemo(() => (dept === 'all' ? scopeTasks : scopeTasks.filter(t => deptOfTask(t) === dept)), [scopeTasks, dept, deptOfTask]);
    const staffTasks = useMemo(() => (staff === 'all' ? deptTasks : deptTasks.filter(t => t.employee_id === staff)), [deptTasks, staff]);

    const counts: Record<StatusFilter, number> = {
        all: staffTasks.length,
        open: staffTasks.filter(isOpen).length,
        done: staffTasks.filter(t => !isOpen(t)).length,
        carried: staffTasks.filter(t => t.is_carried_forward && isOpen(t)).length,
    };

    const visible = useMemo(() => {
        const q = search.trim().toLowerCase();
        return staffTasks.filter(t => {
            if (status === 'open' && !isOpen(t)) return false;
            if (status === 'done' && isOpen(t)) return false;
            if (status === 'carried' && !(t.is_carried_forward && isOpen(t))) return false;
            return !q || t.title.toLowerCase().includes(q) || nameOf(t.employee_id, t).toLowerCase().includes(q);
        });
    }, [staffTasks, status, search, nameOf]);

    const groups = useMemo(() => {
        const map = new Map<string, Task[]>();
        visible.forEach(t => map.set(t.employee_id, [...(map.get(t.employee_id) || []), t]));
        return [...map.entries()]
            .map(([id, list]) => {
                const all = deptTasks.filter(t => t.employee_id === id);
                const open = all.filter(isOpen).length;
                // carried-forward first, then newest
                const sorted = [...list].sort((a, b) => Number(!!b.is_carried_forward) - Number(!!a.is_carried_forward) || b.assigned_date.localeCompare(a.assigned_date));
                return { id, name: nameOf(id, list[0]), deptId: personById.get(id)?.department_id ?? null, open, done: all.length - open, tasks: sorted };
            })
            .sort((a, b) => b.open - a.open || a.name.localeCompare(b.name));
    }, [visible, deptTasks, nameOf, personById]);

    // ── Organisation progress ────────────────────────────────────────────────
    const rings = useMemo((): [Ring, Ring, Ring] => {
        const orgDone = scopeTasks.filter(t => !isOpen(t)).length;
        const deptPcts = (dept === 'all' ? shownDepts.map(d => d.id) : [dept])
            .map(id => scopeTasks.filter(t => deptOfTask(t) === id)).filter(l => l.length).map(donePct);
        const staffIds = [...new Set(deptTasks.map(t => t.employee_id))];
        const staffPcts = staffIds.map(id => donePct(deptTasks.filter(t => t.employee_id === id)));
        const deptDone = deptTasks.filter(t => !isOpen(t)).length;
        return [
            { name: 'Company-wide', detail: `${orgDone} of ${scopeTasks.length} done`, pct: pct(orgDone, scopeTasks.length) },
            dept === 'all'
                ? { name: 'Departments', detail: `Average across ${deptPcts.length} with tasks`, pct: avg(deptPcts) }
                : { name: deptName.get(dept) || 'Department', detail: `${deptDone} of ${deptTasks.length} done`, pct: pct(deptDone, deptTasks.length) },
            { name: 'Staff', detail: `Average across ${staffIds.length} ${staffIds.length === 1 ? 'person' : 'people'}`, pct: avg(staffPcts) },
        ];
    }, [scopeTasks, deptTasks, dept, shownDepts, deptOfTask, deptName]);

    // ── Dropdowns ────────────────────────────────────────────────────────────
    const openIn = (ids: (t: Task) => boolean) => scopeTasks.filter(t => ids(t) && isOpen(t)).length;
    const deptOptions: MenuOption[] = [
        { value: 'all', label: showAll ? 'All departments' : 'All active departments', count: scopeTasks.filter(isOpen).length },
        ...shownDepts.map(d => ({ value: d.id, label: d.name, sub: activeIds.has(d.id) ? undefined : 'Task Manager is off', muted: !activeIds.has(d.id), count: openIn(t => deptOfTask(t) === d.id) })),
    ];
    const staffPool = people.filter(p => (dept === 'all' ? showAll || shownDeptIds.has(p.department_id ?? '') : p.department_id === dept));
    const staffOptions: MenuOption[] = [
        { value: 'all', label: dept === 'all' ? 'All staff' : `All staff in ${deptName.get(dept) || 'this department'}`, count: deptTasks.filter(isOpen).length },
        ...staffPool.map(p => ({
            value: p.id, label: p.name, count: openIn(t => t.employee_id === p.id),
            sub: dept === 'all' && p.department_id ? deptName.get(p.department_id) : undefined,
        })),
    ];

    // Assign: only people whose department has the Task Manager switched ON can receive tasks
    const assignPool = people.filter(p => activeIds.has(p.department_id ?? '') && (qDept === 'all' || p.department_id === qDept));
    const chosen = personById.get(qPerson);
    const canAssign = !!chosen && !!qTitle.trim() && !submitting;

    const assign = async () => {
        if (!chosen || !qTitle.trim()) return;
        setSubmitting(true);
        try {
            const res = await fetch('/api/task-manager/tasks', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'assign_task', actorId, targetEmployeeId: chosen.id, title: qTitle.trim(), assignedDate: qDate }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok || !data.success) throw new Error(data.error || 'Could not assign the task');
            const when = dueLabel(qDate);
            say('ok', `Task assigned to ${chosen.name} ${when === 'Today' || when === 'Tomorrow' ? when.toLowerCase() : `for ${when}`}.`);
            setQTitle('');
            setSheetOpen(false);
            load();
        } catch (err) {
            say('err', err instanceof Error ? err.message : 'Could not assign the task');
        } finally {
            setSubmitting(false);
        }
    };

    /** "+ Assign" next to a person: their department and name are filled in, then the form comes into view. */
    const assignTo = (person: { id: string; deptId: string | null }) => {
        setQDept(person.deptId && activeIds.has(person.deptId) ? person.deptId : 'all');
        setQPerson(person.id);
        if (!desktop) { setSheetOpen(true); return; }
        cardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setTimeout(() => titleRef.current?.focus({ preventScroll: true }), 450);
        setFlash(true);
        if (flashTimer.current) clearTimeout(flashTimer.current);
        flashTimer.current = setTimeout(() => setFlash(false), 1600);
    };
    useEffect(() => () => { if (flashTimer.current) clearTimeout(flashTimer.current); }, []);

    const deptField = (
        <SelectMenu label="Department" value={qDept} onChange={v => { setQDept(v); setQPerson(''); }}
            options={[{ value: 'all', label: 'All active departments' }, ...activeDepts.map(d => ({ value: d.id, label: d.name }))]} />
    );
    const personField = (
        <SelectMenu label="Assign to" value={qPerson} onChange={setQPerson} placeholder="Choose a person" emptyText="No one in this department yet"
            options={assignPool.map(p => ({ value: p.id, label: p.name, sub: qDept === 'all' && p.department_id ? deptName.get(p.department_id) : undefined }))} />
    );

    if (loading) {
        return <div className="flex items-center gap-2 p-6 text-sm text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>;
    }

    return (
        <div className="space-y-4 sm:space-y-5">
            {error && (
                <div role="alert" className="flex items-center gap-2 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:border-rose-900/50 dark:bg-rose-950/30 dark:text-rose-200">
                    <AlertTriangle className="h-4 w-4 shrink-0" /> {error}
                    <button type="button" onClick={load} className="ml-auto rounded-lg border border-rose-300 px-3 py-1 text-xs font-bold dark:border-rose-800">Try again</button>
                </div>
            )}
            {/* Floats at the bottom of the screen, so it is seen wherever the page is scrolled (body: no transformed parent) */}
            {toast && typeof document !== 'undefined' && createPortal(
                <div role="status" className={`fixed inset-x-4 bottom-4 z-[70] mx-auto flex max-w-md items-center gap-2 rounded-2xl px-4 py-3 text-sm font-semibold shadow-lg ${toast.kind === 'ok' ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300' : 'bg-rose-50 text-rose-800 dark:bg-rose-950 dark:text-rose-300'}`}>
                    {toast.kind === 'ok' ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <AlertTriangle className="h-4 w-4 shrink-0" />} {toast.text}
                </div>,
                document.body,
            )}

            <ProgressRings rings={rings}
                caption={dept === 'all' ? 'Across all tasks in view. Pick a department below to focus the rings.' : `Focused on ${deptName.get(dept) || 'this department'}. Pick “All” to see everyone.`} />

            {/* Assign tasks — full form on a computer */}
            <section ref={cardRef} aria-labelledby="assign-title"
                className={`hidden scroll-mt-24 flex-wrap items-end gap-2.5 rounded-2xl border bg-indigo-50/40 p-4 transition-[box-shadow,border-color] duration-300 sm:flex dark:bg-indigo-950/20 ${flash ? 'border-indigo-500 ring-4 ring-indigo-200 dark:ring-indigo-900' : 'border-indigo-100 dark:border-indigo-900/50'}`}>
                <h2 id="assign-title" className="basis-full text-base font-bold text-zinc-900 dark:text-zinc-100">Assign tasks</h2>
                <div className="flex min-w-[170px] flex-1 flex-col">{deptField}</div>
                <div className="flex min-w-[200px] flex-1 flex-col">{personField}</div>
                <label className={`${fieldLabel} min-w-[240px] flex-[3]`}>Task
                    <input ref={titleRef} value={qTitle} onChange={e => setQTitle(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && canAssign) assign(); }}
                        maxLength={200} className={field} />
                </label>
                <div className={`${fieldLabel} w-[170px]`}>
                    <span id="assign-for-label">For</span>
                    <DueDatePicker value={qDate} onChange={setQDate} />
                </div>
                <button type="button" onClick={assign} disabled={!canAssign}
                    className="flex min-h-11 items-center gap-1.5 rounded-xl bg-indigo-600 px-5 text-sm font-bold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-40">
                    {submitting && <Loader2 className="h-4 w-4 animate-spin" />} Assign
                </button>
            </section>

            {/* Assign tasks — a phone: one box, the rest opens in a bottom sheet */}
            <section aria-labelledby="assign-title-phone" className="space-y-3 rounded-2xl border border-indigo-100 bg-indigo-50/40 p-4 sm:hidden dark:border-indigo-900/50 dark:bg-indigo-950/20">
                <h2 id="assign-title-phone" className="text-base font-bold text-zinc-900 dark:text-zinc-100">Assign tasks</h2>
                <div className="flex gap-2">
                    <label className="flex-1">
                        <span className="sr-only">Task</span>
                        <input value={qTitle} onChange={e => setQTitle(e.target.value)} maxLength={200} className={`${field} min-h-12 text-[15px]`} />
                    </label>
                    <button type="button" onClick={() => setSheetOpen(true)} aria-label="Assign task"
                        className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-indigo-600 text-white"><Plus className="h-6 w-6" /></button>
                </div>
            </section>
            <BottomSheet open={sheetOpen} onClose={() => setSheetOpen(false)} title="Assign a task"
                footer={
                    <button type="button" onClick={assign} disabled={!canAssign}
                        className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 text-base font-bold text-white disabled:bg-zinc-200 disabled:text-zinc-500 dark:disabled:bg-zinc-800">
                        {submitting && <Loader2 className="h-4 w-4 animate-spin" />}{chosen ? `Assign to ${chosen.name.split(' ')[0]}` : 'Assign'}
                    </button>
                }>
                <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-2.5">{deptField}{personField}</div>
                    <label className={fieldLabel}>Task
                        <textarea value={qTitle} onChange={e => setQTitle(e.target.value)} rows={3} maxLength={200}
                            className={`${field} resize-none py-2.5 text-[15px]`} />
                    </label>
                    <div className={fieldLabel}>
                        <span>For</span>
                        <DueDateChoices value={qDate} onChange={setQDate} />
                    </div>
                </div>
            </BottomSheet>

            {/* Filters */}
            <div className="space-y-3">
                <div className="flex flex-wrap items-end gap-2.5">
                    <div className="w-full sm:w-[300px]">
                        <SelectMenu label="Department" value={dept} options={deptOptions} onChange={v => { setDept(v); setStaff('all'); }} />
                    </div>
                    <div className="w-full sm:w-[280px]">
                        <SelectMenu label="Staff" value={staff} options={staffOptions} onChange={setStaff} />
                    </div>
                    <button type="button" onClick={() => { setShowAll(s => !s); setDept('all'); setStaff('all'); }}
                        className="min-h-11 px-2 text-[13px] font-semibold text-indigo-700 hover:text-indigo-900 dark:text-indigo-300">
                        {showAll ? 'Show active only' : `Show all ${departments.length}`}
                    </button>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <div role="group" aria-label="Status" className="flex max-w-full gap-1 overflow-x-auto rounded-xl bg-zinc-100 p-1 [scrollbar-width:none] dark:bg-zinc-800 [&::-webkit-scrollbar]:hidden">
                        {([['all', 'All'], ['open', 'Open'], ['done', 'Done'], ['carried', 'Carried forward']] as const).map(([id, label]) => (
                            <button key={id} type="button" aria-pressed={status === id} onClick={() => setStatus(id)}
                                className={`min-h-9 whitespace-nowrap rounded-lg px-3 text-[13px] font-bold ${status === id ? 'bg-white text-zinc-900 shadow-sm dark:bg-zinc-900 dark:text-zinc-100' : 'text-zinc-600 dark:text-zinc-400'}`}>
                                {label} <span className="font-semibold text-zinc-500">{counts[id]}</span>
                            </button>
                        ))}
                    </div>
                    <TaskRangeFilter value={range} onChange={r => { setRange(r); setExpanded(new Set()); }} />
                    <label className="flex min-w-[180px] flex-1 items-center gap-2 rounded-xl border border-zinc-200 bg-white px-3 dark:border-zinc-700 dark:bg-zinc-900">
                        <Search className="h-4 w-4 text-zinc-400" />
                        <span className="sr-only">Search tasks or staff</span>
                        <input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search tasks or staff"
                            className="min-h-10 w-full bg-transparent text-[13px] text-zinc-900 outline-none dark:text-zinc-100" />
                    </label>
                    <button type="button" onClick={load} disabled={refreshing} aria-label="Refresh"
                        className="flex h-10 w-10 items-center justify-center rounded-xl border border-zinc-200 bg-white text-zinc-500 hover:text-zinc-800 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:text-zinc-200">
                        <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
                    </button>
                </div>
            </div>

            {truncated && <p className="text-xs text-amber-700 dark:text-amber-300">Showing the newest 500 tasks. Pick fewer days to see the rest.</p>}

            {/* Everyone's tasks, grouped by person — view only */}
            <div className="space-y-3">
                {groups.length === 0 && (
                    <div className="rounded-2xl border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">
                        {dept === 'all' && staff === 'all' && !search ? 'No tasks for these dates.' : 'No tasks match these filters.'}
                    </div>
                )}
                {groups.map(g => {
                    const showEvery = expanded.has(g.id);
                    const list = showEvery ? g.tasks : g.tasks.slice(0, SHOW_PER_PERSON);
                    const canAssignHere = !!g.deptId && activeIds.has(g.deptId);
                    return (
                        <section key={g.id} aria-label={g.name} className="overflow-hidden rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
                            <header className="flex items-center gap-3 bg-zinc-50 px-4 py-3 dark:bg-zinc-800/50">
                                <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-[13px] font-bold text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200">{initials(g.name)}</span>
                                <div className="min-w-0 flex-1">
                                    <p className="truncate text-[15px] font-bold text-zinc-900 dark:text-zinc-100">{g.name}</p>
                                    <p className="truncate text-xs text-zinc-500">
                                        {g.deptId ? deptName.get(g.deptId) || '' : 'No department'}
                                        <span className="sm:hidden"> · {g.open} open</span>
                                    </p>
                                </div>
                                <span className="hidden text-[13px] text-zinc-600 sm:inline dark:text-zinc-400">{g.open} open · {g.done} done</span>
                                {canAssignHere && (
                                    <button type="button" onClick={() => assignTo(g)} aria-label={`Assign a task to ${g.name}`}
                                        className="min-h-9 shrink-0 rounded-lg border border-indigo-200 bg-white px-3 text-[13px] font-bold text-indigo-700 hover:bg-indigo-50 dark:border-indigo-800 dark:bg-zinc-900 dark:text-indigo-300">
                                        + Assign
                                    </button>
                                )}
                            </header>
                            <ul>
                                {list.map(t => (
                                    <li key={t.id} className="flex flex-col gap-1.5 border-t border-zinc-100 px-4 py-3 sm:flex-row sm:items-center sm:gap-4 dark:border-zinc-800">
                                        <div className="min-w-0 flex-1">
                                            <p className="break-words text-sm font-semibold text-zinc-900 dark:text-zinc-100">{t.title}</p>
                                            {t.description && <p className="line-clamp-1 text-xs text-zinc-500">{t.description}</p>}
                                        </div>
                                        <div className="flex shrink-0 items-center gap-2.5">
                                            {t.is_carried_forward
                                                ? <span className="text-xs font-semibold text-amber-700 dark:text-amber-300">From {shortDay(t.assigned_date)}</span>
                                                : range.from !== range.to && <span className="text-xs text-zinc-500">{shortDay(t.assigned_date)}</span>}
                                            <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${STATUS[t.status].cls}`}>{STATUS[t.status].label}</span>
                                        </div>
                                    </li>
                                ))}
                                {g.tasks.length > SHOW_PER_PERSON && (
                                    <li className="border-t border-zinc-100 px-4 py-2 dark:border-zinc-800">
                                        <button type="button" onClick={() => setExpanded(s => { const n = new Set(s); if (n.has(g.id)) n.delete(g.id); else n.add(g.id); return n; })}
                                            className="min-h-9 text-[13px] font-semibold text-indigo-700 dark:text-indigo-300">
                                            {showEvery ? 'Show less' : `Show ${g.tasks.length - SHOW_PER_PERSON} more`}
                                        </button>
                                    </li>
                                )}
                            </ul>
                        </section>
                    );
                })}
                <p className="text-xs text-zinc-500">View only. Only the person holding a task can move it or mark it done.</p>
            </div>
        </div>
    );
}
