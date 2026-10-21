'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Bell, Check, Clock, Eye, Loader2, Pencil, RefreshCw, Trash2, X } from 'lucide-react';
import { AssignedTask, EASE, avatarGradient, columnLabel, initials, shortDate, shortDateTime } from './types';

/**
 * "Assigned by me" (owner 2026-10-19): every task I gave to someone, with who holds it, its status and timestamps.
 * I can edit or delete the ones I gave. Tasks given by people below me in the reporting chain are listed too, view only.
 * The server decides what is listed and what may be changed; this screen only shows it.
 * Owner 2026-10-20: "Remind" on an open task I gave, and "Remind all overdue" (one message per person, at most once an hour).
 */

/** Today in India (YYYY-MM-DD): a task given before today and still open is overdue. */
const todayIndia = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

const STATUS_PILL: Record<AssignedTask['status'], string> = {
    pending: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
    in_progress: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300',
    completed: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300',
};

type Who = 'me' | 'team';

function Row({ task, onEdit, onDelete, onRemind }: {
    task: AssignedTask;
    onEdit: (id: string, title: string, description: string) => Promise<boolean>;
    onDelete: (id: string) => Promise<boolean>;
    onRemind: (ids: string[]) => Promise<void>;
}) {
    const [mode, setMode] = useState<'view' | 'edit' | 'confirm'>('view');
    const [title, setTitle] = useState(task.title);
    const [details, setDetails] = useState(task.description || '');
    const [busy, setBusy] = useState(false);
    const [reminding, setReminding] = useState(false);
    const done = task.status === 'completed';
    const remind = async () => {
        if (reminding) return;
        setReminding(true);
        await onRemind([task.id]);
        setReminding(false);
    };

    const save = async () => {
        if (!title.trim() || busy) return;
        setBusy(true);
        const ok = await onEdit(task.id, title.trim(), details.trim());
        setBusy(false);
        if (ok) setMode('view');
    };
    const remove = async () => {
        if (busy) return;
        setBusy(true);
        await onDelete(task.id);
        setBusy(false);
        setMode('view');
    };

    return (
        <motion.li
            layout
            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.3, ease: EASE }}
            className={`relative overflow-hidden rounded-2xl border p-3.5 ${task.isCarriedForward && !done
                ? 'border-amber-300/70 bg-amber-50/70 dark:border-amber-700/40 dark:bg-amber-950/20'
                : 'border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900'}`}
        >
            {task.isCarriedForward && !done && <span className="absolute inset-y-0 left-0 w-1 bg-amber-400" aria-hidden="true" />}

            {mode === 'edit' ? (
                <div className="space-y-2">
                    <input
                        value={title} onChange={e => setTitle(e.target.value)} maxLength={200} aria-label="Task name"
                        className="w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm font-bold text-zinc-900 outline-none focus:border-indigo-400 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                    />
                    <textarea
                        value={details} onChange={e => setDetails(e.target.value)} maxLength={900} placeholder="Details (optional)" aria-label="Task details"
                        className="h-16 w-full resize-none rounded-xl border border-zinc-300 bg-white px-3 py-2 text-xs text-zinc-800 outline-none focus:border-indigo-400 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200"
                    />
                    <div className="flex items-center gap-2">
                        <button type="button" onClick={save} disabled={busy || !title.trim()} className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-[11px] font-black text-white hover:bg-indigo-700 disabled:opacity-60">
                            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Save
                        </button>
                        <button type="button" onClick={() => { setTitle(task.title); setDetails(task.description || ''); setMode('view'); }} disabled={busy} className="rounded-lg border border-zinc-200 px-3 py-1.5 text-[11px] font-bold text-zinc-600 hover:bg-zinc-100 disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800">
                            Cancel
                        </button>
                    </div>
                </div>
            ) : (
                <>
                    <div className="flex items-start gap-2">
                        <p className={`min-w-0 flex-1 text-[13px] font-bold leading-snug break-words ${done ? 'text-zinc-400 line-through decoration-zinc-300 dark:decoration-zinc-600' : 'text-zinc-900 dark:text-zinc-100'}`}>
                            {task.title}
                        </p>
                        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-black ${STATUS_PILL[task.status]}`}>{columnLabel(task.status)}</span>
                        {task.mine ? (
                            <>
                                {!done && (
                                    <button type="button" onClick={remind} disabled={reminding} aria-label={`Remind ${task.holderName} about ${task.title}`} title={`Remind ${task.holderName}`} className="shrink-0 rounded-lg p-1 text-zinc-400 hover:bg-amber-50 hover:text-amber-600 disabled:opacity-60 dark:hover:bg-amber-950/30">
                                        {reminding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Bell className="h-3.5 w-3.5" />}
                                    </button>
                                )}
                                <button type="button" onClick={() => setMode('edit')} aria-label={`Edit ${task.title}`} title="Edit" className="shrink-0 rounded-lg p-1 text-zinc-400 hover:bg-indigo-50 hover:text-indigo-600 dark:hover:bg-indigo-950/30">
                                    <Pencil className="h-3.5 w-3.5" />
                                </button>
                                <button type="button" onClick={() => setMode('confirm')} aria-label={`Delete ${task.title}`} title="Delete" className="shrink-0 rounded-lg p-1 text-zinc-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/30">
                                    <Trash2 className="h-3.5 w-3.5" />
                                </button>
                            </>
                        ) : (
                            <span className="flex shrink-0 items-center gap-1 rounded-md bg-zinc-100 px-1.5 py-0.5 text-[10px] font-bold text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400" title="Given by someone in your team. You can view it, but only they can change it.">
                                <Eye className="h-3 w-3" /> View only
                            </span>
                        )}
                    </div>

                    {task.description && <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400 break-words">{task.description}</p>}

                    <div className="mt-3 flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
                        <span className="flex items-center gap-1.5 text-[11px] font-bold text-zinc-600 dark:text-zinc-300">
                            <span className={`flex h-5 w-5 items-center justify-center rounded-full bg-gradient-to-br ${avatarGradient(task.holderName)} text-[8px] font-black text-white`}>{initials(task.holderName)}</span>
                            To {task.holderName}
                        </span>
                        {!task.mine && <span className="text-[11px] font-semibold text-zinc-500 dark:text-zinc-400">given by {task.assignerName}</span>}
                        {task.isCarriedForward && !done && (
                            <span className="flex items-center gap-1 rounded-md bg-amber-100 px-1.5 py-0.5 text-[10px] font-black text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
                                <Clock className="h-3 w-3" /> Carried from {shortDate(task.assignedDate)}
                            </span>
                        )}
                    </div>

                    <p className="mt-2 text-[10px] font-semibold text-zinc-400 dark:text-zinc-500">
                        Assigned {shortDateTime(task.createdAt)}
                        {done && task.completedAt && <> · Done {shortDateTime(task.completedAt)}</>}
                    </p>

                    {mode === 'confirm' && (
                        <div role="alertdialog" aria-label="Confirm delete" className="mt-3 flex flex-wrap items-center gap-2 border-t border-zinc-100 pt-2.5 dark:border-zinc-800">
                            <p className="flex-1 text-[11px] font-bold text-zinc-700 dark:text-zinc-200">Delete this task for good?</p>
                            <button type="button" onClick={remove} disabled={busy} className="flex items-center gap-1.5 rounded-lg bg-rose-600 px-3 py-1.5 text-[11px] font-black text-white hover:bg-rose-700 disabled:opacity-60">
                                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />} Delete
                            </button>
                            <button type="button" onClick={() => setMode('view')} disabled={busy} aria-label="Cancel" className="rounded-lg border border-zinc-200 p-1.5 text-zinc-500 hover:bg-zinc-100 disabled:opacity-60 dark:border-zinc-700 dark:hover:bg-zinc-800">
                                <X className="h-3.5 w-3.5" />
                            </button>
                        </div>
                    )}
                </>
            )}
        </motion.li>
    );
}

export default function AssignedView({ from, to, onEdit, onDelete }: {
    from: string;
    to: string;
    onEdit: (id: string, title: string, description: string) => Promise<boolean>;
    onDelete: (id: string) => Promise<boolean>;
}) {
    const reduce = !!useReducedMotion();
    const [tasks, setTasks] = useState<AssignedTask[] | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [who, setWho] = useState<Who>('me');
    const [flash, setFlash] = useState<{ ok: boolean; text: string } | null>(null);
    const [remindingAll, setRemindingAll] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const res = await fetch(`/api/task-manager/workspace?scope=assigned&from=${from}&to=${to}`);
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.error || 'Could not load the tasks you assigned');
            setTasks(data.assigned as AssignedTask[]);
            setError(null);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not load the tasks you assigned');
        } finally {
            setLoading(false);
        }
    }, [from, to]);

    useEffect(() => { load(); }, [load]);

    const mineList = useMemo(() => (tasks || []).filter(t => t.mine), [tasks]);
    const teamList = useMemo(() => (tasks || []).filter(t => !t.mine), [tasks]);
    const shown = who === 'me' || teamList.length === 0 ? mineList : teamList;

    const edit = async (id: string, title: string, description: string) => {
        const ok = await onEdit(id, title, description);
        if (ok) load();
        return ok;
    };
    // Owner 2026-10-20: remind the people doing these tasks. The server checks everything again (who gave it, still open,
    // not reminded in the last hour) and says what it skipped.
    const remind = async (ids: string[]) => {
        try {
            const res = await fetch('/api/task-manager/workspace', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'remind_tasks', taskIds: ids }) });
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.error || 'Could not send the reminder');
            const sent = (data.reminded as Array<{ name: string; count: number }>).map(r => `${r.name} (${r.count})`).join(', ');
            const skipped = (data.skipped as Array<{ title: string; why: string }>);
            const tail = skipped.length ? ` Skipped ${skipped.length}: ${skipped.slice(0, 3).map(s => `${s.title} (${s.why})`).join('; ')}${skipped.length > 3 ? '…' : ''}` : '';
            setFlash(sent ? { ok: true, text: `Reminder sent to ${sent}.${tail}` } : { ok: false, text: `Nothing was sent.${tail}` });
        } catch (err) {
            setFlash({ ok: false, text: err instanceof Error ? err.message : 'Could not send the reminder' });
        }
    };
    const overdueMine = useMemo(() => { const today = todayIndia(); return mineList.filter(t => t.status !== 'completed' && t.assignedDate < today); }, [mineList]);
    const remindAllOverdue = async () => {
        if (remindingAll || !overdueMine.length) return;
        setRemindingAll(true);
        await remind(overdueMine.slice(0, 50).map(t => t.id));
        setRemindingAll(false);
    };

    const remove = async (id: string) => {
        const ok = await onDelete(id);
        if (ok) setTasks(t => (t || []).filter(x => x.id !== id));
        return ok;
    };

    return (
        <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
                {teamList.length > 0 ? (
                    <div role="tablist" className="inline-flex gap-1 rounded-2xl border border-zinc-200 bg-zinc-100/80 p-1 dark:border-zinc-800 dark:bg-zinc-900">
                        {([['me', `Given by me`, mineList.length], ['team', 'Given by my team', teamList.length]] as Array<[Who, string, number]>).map(([id, label, count]) => (
                            <button
                                key={id} type="button" role="tab" aria-selected={who === id} onClick={() => setWho(id)}
                                className={`rounded-xl px-3 py-1.5 text-xs font-bold transition-colors ${who === id ? 'bg-white text-zinc-900 shadow-sm dark:bg-zinc-800 dark:text-zinc-100' : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'}`}
                            >
                                {label} <span className="text-[10px] font-black tabular-nums text-zinc-400">{count}</span>
                            </button>
                        ))}
                    </div>
                ) : (
                    <p className="text-xs font-semibold text-zinc-500">Tasks you gave to other people, and how they are going.</p>
                )}
                <div className="flex items-center gap-2">
                {who === 'me' && overdueMine.length > 0 && (
                    <button type="button" onClick={remindAllOverdue} disabled={remindingAll} className="flex items-center gap-1.5 whitespace-nowrap rounded-2xl border border-amber-300 bg-amber-50 px-3 py-1.5 text-[11px] font-black text-amber-800 hover:bg-amber-100 disabled:opacity-60 dark:border-amber-700/50 dark:bg-amber-950/30 dark:text-amber-300">
                        {remindingAll ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Bell className="h-3.5 w-3.5" />} Remind all overdue ({overdueMine.length})
                    </button>
                )}
                <button type="button" onClick={load} disabled={loading} aria-label="Refresh" className="rounded-2xl border border-zinc-200 bg-white p-2 text-zinc-500 hover:text-zinc-800 disabled:opacity-60 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:text-zinc-200">
                    <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
                </button>
                </div>
            </div>

            {flash && (
                <p role="status" className={`flex items-start gap-2 rounded-2xl border px-4 py-2.5 text-xs font-medium ${flash.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-200' : 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200'}`}>
                    <span className="flex-1">{flash.text}</span>
                    <button type="button" onClick={() => setFlash(null)} aria-label="Dismiss" className="shrink-0 opacity-60 hover:opacity-100"><X className="h-3.5 w-3.5" /></button>
                </p>
            )}

            {error && <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-medium text-rose-800 dark:border-rose-900/50 dark:bg-rose-950/30 dark:text-rose-200">{error}</p>}

            {loading && !tasks ? (
                <div className="space-y-2.5" aria-busy="true">{[0, 1, 2].map(i => <div key={i} className="h-24 animate-pulse rounded-2xl bg-zinc-200/70 dark:bg-zinc-800/70" />)}</div>
            ) : shown.length === 0 ? (
                <div className="rounded-3xl border border-dashed border-zinc-300 px-6 py-10 text-center text-xs font-medium text-zinc-500 dark:border-zinc-700">
                    No tasks given to anyone for these dates.
                </div>
            ) : (
                <ul className="grid grid-cols-1 gap-2.5 md:grid-cols-2 xl:grid-cols-3">
                    <AnimatePresence initial={!reduce}>
                        {shown.map(t => <Row key={t.id} task={t} onEdit={edit} onDelete={remove} onRemind={remind} />)}
                    </AnimatePresence>
                </ul>
            )}
        </div>
    );
}
