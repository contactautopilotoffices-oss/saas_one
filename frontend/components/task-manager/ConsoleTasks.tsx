'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, Trash2 } from 'lucide-react';
import Board from '@/frontend/components/procurement/tasks/Board';
import NotificationsView from '@/frontend/components/procurement/tasks/NotificationsView';
import { Status, WTask } from '@/frontend/components/procurement/tasks/types';

/**
 * The superuser's own Task Manager view across ALL departments:
 *  - "Assigned to me": a board of the tasks they hold (move and delete)
 *  - "Assigned by me": the tasks they gave to others, grouped by department (status is shown; only the owner moves it)
 *  - Notifications: the department notification rules, with a department picker
 * The server decides who may see and do what; this file only shows and sends. Nothing here animates on entry:
 * this screen is opened often, so it simply appears.
 */

interface ConsoleTask {
    id: string; title: string; description: string | null; status: Status; assignedDate: string;
    kind: 'mine' | 'given'; personId: string | null; personName: string; department: string;
    locked: boolean; canLock: boolean;
}
export interface ConsoleData {
    actor: { userId: string; name: string };
    departments: string[];
    mine: ConsoleTask[];
    given: ConsoleTask[];
}

// Kept for the whole page load, so coming back to the tab shows the last data at once and refreshes quietly.
let cache: ConsoleData | null = null;
let cachedNotSuperuser = false;

export type ConsoleState = ReturnType<typeof useConsoleTasks>;

const messageOf = (err: unknown, fallback: string) => (err instanceof Error && err.message ? err.message : fallback);

export function useConsoleTasks() {
    const [data, setData] = useState<ConsoleData | null>(cache);
    const [status, setStatus] = useState<'loading' | 'ok' | 'not_superuser'>(cache ? 'ok' : cachedNotSuperuser ? 'not_superuser' : 'loading');
    const [refreshing, setRefreshing] = useState(false);
    const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
    const dataRef = useRef<ConsoleData | null>(cache);
    dataRef.current = data;

    const say = useCallback((kind: 'ok' | 'err', text: string) => {
        setNotice({ kind, text });
        setTimeout(() => setNotice(n => (n && n.text === text ? null : n)), 3600);
    }, []);

    const load = useCallback(async () => {
        if (dataRef.current) setRefreshing(true);
        try {
            const res = await fetch('/api/task-manager/workspace?scope=console');
            const json = await res.json().catch(() => ({}));
            if (res.ok && json.success) {
                cache = json.console; cachedNotSuperuser = false;
                setData(json.console); setStatus('ok');
            } else if (!dataRef.current) {
                // Not a superuser (or the call failed): the caller shows the screen exactly as it was before
                cachedNotSuperuser = res.status === 403;
                setStatus('not_superuser');
            } else {
                say('err', json.error || 'Could not refresh your tasks');
            }
        } catch {
            if (!dataRef.current) setStatus('not_superuser');
        } finally {
            setRefreshing(false);
        }
    }, [say]);

    useEffect(() => { load(); }, [load]);

    const post = async (body: Record<string, unknown>) => {
        const res = await fetch('/api/task-manager/workspace', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || !json.success) throw new Error(json.error || 'That did not work');
    };

    /** Moves one of MY tasks. The screen changes at once and snaps back with a message if the server refuses. */
    const moveTask = useCallback(async (taskId: string, next: Status) => {
        const before = dataRef.current;
        if (!before) return;
        const task = before.mine.find(t => t.id === taskId);
        if (!task || task.status === next) return;
        const apply = (d: ConsoleData): ConsoleData => ({ ...d, mine: d.mine.map(t => (t.id === taskId ? { ...t, status: next } : t)) });
        setData(apply(before));
        try {
            await post({ action: 'set_status', taskId, status: next });
            load();
        } catch (err) {
            setData(before);
            say('err', messageOf(err, 'Could not move that task'));
        }
    }, [load, say]);

    /** Adds a task to MY own list (today). The server applies the same rules as the Procurement tab. */
    const addTask = useCallback(async (title: string) => {
        const me = dataRef.current?.actor.userId;
        if (!me) return false;
        try {
            await post({ action: 'assign', targetUserId: me, title });
            say('ok', 'Task added');
            await load();
            return true;
        } catch (err) {
            say('err', messageOf(err, 'Could not add the task'));
            return false;
        }
    }, [load, say]);

    /** Locks (comes back every working day) or unlocks one of MY tasks, with the same snap-back as moving. */
    const setLocked = useCallback(async (taskId: string, locked: boolean) => {
        const before = dataRef.current;
        if (!before) return;
        setData({ ...before, mine: before.mine.map(t => (t.id === taskId ? { ...t, locked } : t)) });
        try {
            await post({ action: 'set_locked', taskId, locked });
            say('ok', locked ? 'Locked. This task comes back every working day.' : 'Unlocked. It will not come back.');
            load();
        } catch (err) {
            setData(before);
            say('err', messageOf(err, 'Could not change that task'));
        }
    }, [load, say]);

    /** Deletes a task for good (no confirmation, by request). The server checks who may. */
    const deleteTask = useCallback(async (taskId: string) => {
        try {
            await post({ action: 'delete_task', taskId });
            say('ok', 'Task deleted');
            await load();
            return true;
        } catch (err) {
            say('err', messageOf(err, 'Could not delete that task'));
            load();
            return false;
        }
    }, [load, say]);

    return { data, status, refreshing, notice, reload: load, moveTask, deleteTask, setLocked, addTask };
}

const field = 'rounded-xl border border-zinc-300 bg-white px-3 py-2 text-xs font-bold text-zinc-900 outline-none focus:border-indigo-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100';

export function DepartmentSelect({ value, departments, onChange, allLabel, id }: {
    value: string; departments: string[]; onChange: (v: string) => void; allLabel?: string; id: string;
}) {
    return (
        <label htmlFor={id} className="flex items-center gap-2 text-[11px] font-black uppercase tracking-wider text-zinc-500">
            Department
            <select id={id} value={value} onChange={e => onChange(e.target.value)} className={`${field} normal-case tracking-normal`}>
                {allLabel && <option value="All">{allLabel}</option>}
                {departments.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
        </label>
    );
}

function Notice({ notice }: { notice: ConsoleState['notice'] }) {
    if (!notice) return null;
    return (
        <div role="status" className={`flex items-center gap-2 rounded-2xl px-4 py-2.5 text-xs font-bold ${notice.kind === 'ok' ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300' : 'bg-rose-50 text-rose-800 dark:bg-rose-950/40 dark:text-rose-300'}`}>
            {notice.kind === 'ok' ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />} {notice.text}
        </div>
    );
}

const shortDay = (iso: string) => {
    const d = new Date(`${iso}T12:00:00`);
    return isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
};
const daysOld = (iso: string) => Math.floor((Date.now() - new Date(`${iso}T12:00:00`).getTime()) / 86400000);

const STATUS_LABEL: Record<Status, string> = { pending: 'Not started', in_progress: 'In progress', completed: 'Done' };
const STATUS_STYLE: Record<Status, string> = {
    pending: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300',
    in_progress: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300',
    completed: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300',
};

type View = 'mine' | 'given';

export function ConsoleTasksView({ c }: { c: ConsoleState }) {
    const [view, setView] = useState<View>('mine');
    const [dept, setDept] = useState('All');
    const data = c.data;

    const inDept = useCallback((t: ConsoleTask) => dept === 'All' || t.department === dept, [dept]);
    const mine = useMemo(() => (data ? data.mine.filter(inDept) : []), [data, inDept]);
    const given = useMemo(() => (data ? data.given.filter(inDept) : []), [data, inDept]);

    const boardTasks: WTask[] = useMemo(() => (data ? mine.map(t => ({
        id: t.id, title: t.title, description: null, ownerId: data.actor.userId, ownerName: data.actor.name, status: t.status,
        assignedDate: t.assignedDate, isCarriedForward: false, canChange: true, locked: t.locked, canLock: t.canLock,
        meta: { from: t.personName, department: t.department },
    })) : []), [data, mine]);

    if (!data) return null;

    const shown = view === 'mine' ? mine : given;
    const count = (s: Status) => shown.filter(t => t.status === s).length;
    const stale = shown.filter(t => t.status !== 'completed' && daysOld(t.assignedDate) >= 3).length;
    const tiles: Array<[string, number, string]> = [
        [view === 'mine' ? 'To do' : 'Not started', count('pending'), ''],
        ['In progress', count('in_progress'), ''],
        ['Done', count('completed'), ''],
        ['Open 3+ days', stale, stale > 0 ? 'text-rose-600 dark:text-rose-400' : ''],
    ];

    const groups = DEPT_ORDER(given);

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div role="tablist" className="inline-flex max-w-full flex-wrap gap-1 rounded-2xl border border-zinc-200 bg-zinc-100/80 p-1 dark:border-zinc-800 dark:bg-zinc-900">
                    {([['mine', 'Assigned to me', data.mine.filter(inDept).length], ['given', 'Assigned by me', data.given.filter(inDept).length]] as const).map(([id, label, n]) => (
                        <button key={id} type="button" role="tab" aria-selected={view === id} onClick={() => setView(id)}
                            className={`flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-bold ${view === id ? 'bg-white text-zinc-900 shadow-sm dark:bg-zinc-800 dark:text-zinc-100' : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'}`}>
                            {label}<span className="text-[10px] font-black tabular-nums text-zinc-400">{n}</span>
                        </button>
                    ))}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <DepartmentSelect id="console-dept" value={dept} departments={data.departments} onChange={setDept} allLabel="All departments" />
                    <button type="button" onClick={c.reload} disabled={c.refreshing} aria-label="Refresh" className="rounded-xl border border-zinc-200 bg-white p-2.5 text-zinc-500 hover:text-zinc-800 disabled:opacity-60 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:text-zinc-200">
                        {c.refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                    </button>
                </div>
            </div>

            <Notice notice={c.notice} />

            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                {tiles.map(([label, n, tone]) => (
                    <div key={label} className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
                        <p className="text-[11px] font-bold text-zinc-500">{label}</p>
                        <p className={`mt-0.5 text-2xl font-black tabular-nums text-zinc-900 dark:text-zinc-100 ${tone}`}>{n}</p>
                    </div>
                ))}
            </div>

            {view === 'mine' ? (
                <Board tasks={boardTasks} meId={data.actor.userId} onMove={c.moveTask} onQuickAdd={c.addTask} onDelete={c.deleteTask} onLock={c.setLocked} instant />
            ) : (
                <div className="space-y-3">
                    {groups.length === 0 && <p className="rounded-2xl border border-dashed border-zinc-300 p-6 text-center text-xs text-zinc-500 dark:border-zinc-700">You have not given any tasks{dept === 'All' ? '' : ` in ${dept}`}.</p>}
                    {groups.map(([name, items]) => {
                        const open = items.filter(t => t.status !== 'completed').length;
                        return (
                            <section key={name} aria-label={name} className="overflow-hidden rounded-3xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
                                <header className="flex flex-wrap items-center gap-2 border-b border-zinc-100 px-4 py-3 dark:border-zinc-800">
                                    <h3 className="text-sm font-black text-zinc-900 dark:text-zinc-100">{name}</h3>
                                    <span className="text-[11px] font-bold text-zinc-400">{items.length} task{items.length === 1 ? '' : 's'}</span>
                                    <span className="ml-auto flex gap-1.5">
                                        <span className="rounded-full bg-zinc-100 px-2.5 py-0.5 text-[11px] font-black text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">{open} open</span>
                                        <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-[11px] font-black text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300">{items.length - open} done</span>
                                    </span>
                                </header>
                                <ul>
                                    {items.map(t => (
                                        <li key={t.id} className="flex items-center gap-3 border-b border-zinc-100 px-4 py-2.5 text-xs last:border-b-0 dark:border-zinc-800">
                                            <span className="w-36 shrink-0 truncate font-bold text-zinc-700 dark:text-zinc-200">{t.personName}</span>
                                            <span className="min-w-0 flex-1">
                                                <span className="block break-words font-semibold text-zinc-900 dark:text-zinc-100">{t.title}</span>
                                                <span className="text-[11px] text-zinc-400">Given {shortDay(t.assignedDate)}</span>
                                            </span>
                                            <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-black ${STATUS_STYLE[t.status]}`}>{STATUS_LABEL[t.status]}</span>
                                            <button type="button" onClick={() => { if (!t.locked) c.deleteTask(t.id); }} disabled={t.locked} aria-label={`Delete ${t.title}`} title={t.locked ? 'Locked by its owner: they must unlock it first' : 'Delete task'}
                                                className="shrink-0 rounded-lg p-1.5 text-zinc-400 transition-colors hover:bg-rose-50 hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-zinc-400 dark:hover:bg-rose-950/30"><Trash2 className="h-3.5 w-3.5" /></button>
                                        </li>
                                    ))}
                                </ul>
                            </section>
                        );
                    })}
                    <p className="text-[11px] text-zinc-400">These tasks belong to the people you gave them to. You can see their progress and delete a task, but only the owner moves it.</p>
                </div>
            )}
        </div>
    );
}

/** Group by department, biggest backlog first. */
function DEPT_ORDER(items: ConsoleTask[]): Array<[string, ConsoleTask[]]> {
    const map = new Map<string, ConsoleTask[]>();
    items.forEach(t => map.set(t.department, [...(map.get(t.department) || []), t]));
    return Array.from(map.entries()).sort((a, b) => b[1].filter(t => t.status !== 'completed').length - a[1].filter(t => t.status !== 'completed').length || a[0].localeCompare(b[0]));
}

export function ConsoleNotifications({ departments }: { departments: string[] }) {
    const [scope, setScope] = useState<'me' | 'dept'>('me');
    return (
        <div className="space-y-4">
            <div role="tablist" className="inline-flex max-w-full flex-wrap gap-1 rounded-2xl border border-zinc-200 bg-zinc-100/80 p-1 dark:border-zinc-800 dark:bg-zinc-900">
                {([['me', 'My notifications'], ['dept', 'Department notifications']] as const).map(([id, label]) => (
                    <button key={id} type="button" role="tab" aria-selected={scope === id} onClick={() => setScope(id)}
                        className={`rounded-xl px-3.5 py-2 text-xs font-bold ${scope === id ? 'bg-white text-zinc-900 shadow-sm dark:bg-zinc-800 dark:text-zinc-100' : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'}`}>{label}</button>
                ))}
            </div>
            {scope === 'me' ? <NotificationsView personal /> : <DepartmentNotifications departments={departments} />}
        </div>
    );
}

function DepartmentNotifications({ departments }: { departments: string[] }) {
    const [dept, setDept] = useState(departments.includes('Procurement') ? 'Procurement' : departments[0] || '');
    useEffect(() => { if (!dept && departments[0]) setDept(departments[0]); }, [dept, departments]);
    if (!dept) return <p className="rounded-2xl border border-dashed border-zinc-300 p-6 text-center text-xs text-zinc-500 dark:border-zinc-700">No departments to configure yet.</p>;
    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-zinc-500">Choose a department to see and change when its Task Manager messages go out.</p>
                <DepartmentSelect id="console-notif-dept" value={dept} departments={departments} onChange={setDept} />
            </div>
            <NotificationsView key={dept} departmentName={dept} />
        </div>
    );
}
