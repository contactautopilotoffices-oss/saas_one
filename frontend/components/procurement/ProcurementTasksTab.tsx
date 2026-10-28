'use client';

import React, { useMemo, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { AlertTriangle, Bell, CheckCircle2, ClipboardList, LayoutGrid, Lock, Plus, RefreshCw, Send, UserCheck, Users, X } from 'lucide-react';
import { EASE, Status, WTask, todayIST } from './tasks/types';
import { DateRange } from '@/frontend/components/task-manager/DateRangePicker';
import TaskRangeFilter from '@/frontend/components/task-manager/assign/TaskRangeFilter';
import { useWorkspace } from './tasks/useWorkspace';
import StatCards from './tasks/StatCards';
import Board from './tasks/Board';
import TeamView from './tasks/TeamView';
import TaskDialog from './tasks/TaskDialog';
import RemarkDialog from './tasks/RemarkDialog';
import NotificationsView from './tasks/NotificationsView';
import SuperuserPanel from './tasks/SuperuserPanel';
import AssignedView from './tasks/AssignedView';
import CrossDeptPanel, { IncomingList } from './tasks/CrossDeptPanel';
import { useCollaboration } from './tasks/useCollaboration';

/**
 * Procurement "Tasks" tab: a drag-and-drop board and a team view.
 * Every rule (who sees, assigns or moves what) is enforced by the server using the logged-in user;
 * this screen only shows what the server returns and offers the actions it allows.
 */

type View = 'board' | 'team' | 'assigned' | 'notifications' | 'superuser';
/** Owner 2026-10-26: the Send tab has two sides — your manager (superuser) and other departments. */
type SendTo = 'manager' | 'departments';
type Filter = 'all' | 'today' | 'carried';

const FILTERS: ReadonlyArray<{ id: Filter; label: string }> = [
    { id: 'all', label: 'All' },
    { id: 'today', label: 'Today' },
    { id: 'carried', label: 'Carried forward' },
];

/** A pill that glides to whichever option is active. */
function Segmented<T extends string>({ id, value, options, onChange, size = 'md' }: {
    id: string; value: T; options: ReadonlyArray<{ id: T; label: string; icon?: React.ReactNode; count?: number }>; onChange: (v: T) => void; size?: 'sm' | 'md';
}) {
    const reduce = !!useReducedMotion();
    return (
        <div role="tablist" className="inline-flex max-w-full flex-wrap gap-1 rounded-2xl border border-zinc-200 bg-zinc-100/80 p-1 dark:border-zinc-800 dark:bg-zinc-900">
            {options.map(o => {
                const on = o.id === value;
                return (
                    <button
                        key={o.id} role="tab" aria-selected={on} type="button" onClick={() => onChange(o.id)}
                        className={`relative flex items-center gap-1.5 rounded-xl font-bold transition-colors ${size === 'sm' ? 'px-3 py-1.5 text-xs' : 'px-3.5 py-2 text-xs'} ${on ? 'text-zinc-900 dark:text-zinc-100' : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'}`}
                    >
                        {on && (
                            <motion.span
                                layoutId={`seg-${id}`}
                                className="absolute inset-0 rounded-xl bg-white shadow-sm dark:bg-zinc-800"
                                transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 500, damping: 38 }}
                            />
                        )}
                        <span className="relative flex items-center gap-1.5">{o.icon}{o.label}{typeof o.count === 'number' && <span className="text-[10px] font-black tabular-nums text-zinc-400">{o.count}</span>}</span>
                    </button>
                );
            })}
        </div>
    );
}

function Skeleton() {
    const bar = 'animate-pulse rounded-2xl bg-zinc-200/70 dark:bg-zinc-800/70';
    return (
        <div className="@container space-y-5" aria-busy="true" aria-label="Loading tasks">
            <div className={`${bar} h-12 w-64`} />
            <div className="grid grid-cols-2 gap-3 @2xl:grid-cols-4 @5xl:grid-cols-5">{[0, 1, 2, 3, 4].map(i => <div key={i} className={`${bar} h-24`} />)}</div>
            <div className="grid grid-cols-1 gap-4 @4xl:grid-cols-3">{[0, 1, 2].map(i => <div key={i} className={`${bar} h-72`} />)}</div>
        </div>
    );
}

function LockScreen({ message }: { message: string }) {
    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, ease: EASE }}
            className="mx-auto mt-8 max-w-md space-y-3 rounded-3xl border border-zinc-200 bg-white p-8 text-center shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
        >
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-indigo-200/60 bg-indigo-50 dark:border-indigo-800/40 dark:bg-indigo-950/60">
                <Lock className="h-6 w-6 text-indigo-600 dark:text-indigo-300" />
            </div>
            <h3 className="text-base font-black text-zinc-900 dark:text-zinc-100">Task Manager is not available yet</h3>
            <p className="text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">{message}</p>
            <p className="text-xs text-zinc-500">This tab opens as soon as it is switched on for your team and your kickoff is done.</p>
        </motion.div>
    );
}

export default function ProcurementTasksTab({ departmentName = 'Procurement' }: { departmentName?: string }) {
    const reduce = !!useReducedMotion();
    // Owner 2026-10-15: a date RANGE (at most 31 days). New tasks go on the day shown, or today when several days are shown.
    const [range, setRange] = useState<DateRange>(() => ({ from: todayIST(), to: todayIST() }));
    const date = range.from === range.to ? range.from : todayIST();
    const [view, setView] = useState<View>('board');
    const [filter, setFilter] = useState<Filter>('all');
    const [dialog, setDialog] = useState<{ open: boolean; target: string | null; followUp?: { id: string; title: string } | null }>({ open: false, target: null });
    // Owner 2026-10-26: the optional remark box, only when someone asks for it
    const [remarkFor, setRemarkFor] = useState<string | null>(null);
    // Owner 2026-10-28: "Remark on completion" — the task waiting for its comment box before it is marked done
    const [completingId, setCompletingId] = useState<string | null>(null);
    const [sendTo, setSendTo] = useState<SendTo | null>(null);
    // Owner 2026-10-26: cross-department collaboration (support requests waiting for me show on the board too)
    const collab = useCollaboration(true);

    const { ws, ok, loading, refreshing, error, toasts, dismissToast, toast, reload, moveTask, addTask, addTasks, giveTask, deleteTask, setLocked, flagDependency, editTask, giveMany, addNote, addRemark, checkDuplicates, uploadFiles, listAttachments, removeAttachment, editNote } = useWorkspace(range.from, departmentName, range.to);

    // The board shows only MY tasks; the Team tab is where other people's tasks live.
    const mine: WTask[] = useMemo(() => (ok ? ok.tasks.filter(t => t.ownerId === ok.actor.userId) : []), [ok]);

    const filtered: WTask[] = useMemo(() => {
        if (!ok) return [];
        return mine.filter(t => {
            if (filter === 'today') return !t.isCarriedForward;
            if (filter === 'carried') return t.isCarriedForward;
            return true;
        });
    }, [ok, mine, filter]);

    const counts = useMemo(() => ({
        todo: filtered.filter(t => t.status === 'pending').length,
        doing: filtered.filter(t => t.status === 'in_progress').length,
        done: filtered.filter(t => t.status === 'completed').length,
        carried: filtered.filter(t => t.isCarriedForward).length,
    }), [filtered]);

    const filterCounts = useMemo(() => {
        const all = mine;
        return {
            all: all.length,
            today: all.filter(t => !t.isCarriedForward).length,
            carried: all.filter(t => t.isCarriedForward).length,
        };
    }, [mine]);

    if (loading && !ws) return <Skeleton />;
    if (ws && (ws.state === 'locked' || ws.state === 'no_profile')) return <LockScreen message={ws.message} />;
    if (!ok) {
        return (
            <div className="flex items-center gap-2 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800 dark:border-rose-900/50 dark:bg-rose-950/30 dark:text-rose-200">
                <AlertTriangle className="h-4 w-4 shrink-0" /> {error || 'Could not load tasks'}
                <button type="button" onClick={reload} className="ml-auto rounded-lg border border-rose-300 px-3 py-1 text-xs font-bold hover:bg-rose-100 dark:border-rose-800 dark:hover:bg-rose-900/40">Try again</button>
            </div>
        );
    }

    const meId = ok.actor.userId;
    // Working with a superuser: only for a team whose switch is ON and when there is someone to work with.
    const superCollab = ok.superuserCollab?.enabled && ok.superuserCollab.superusers.length ? ok.superuserCollab : null;
    // Owner 2026-10-27: "Work with other departments" OFF for my team → no "Other departments" side (and no Send tab at all
    // when there is no manager side either). Requests already waiting still show at the top of To do.
    const crossDeptOn = collab.data?.enabled !== false;
    const sendVisible = !!superCollab || crossDeptOn;
    const side: SendTo = !crossDeptOn ? 'manager' : sendTo ?? (superCollab ? 'manager' : 'departments');
    // Owner 2026-10-26: support requests from other departments sit at the top of To do until answered
    const incoming = collab.data?.incoming.length ? (
        <IncomingList compact incoming={collab.data.incoming} respond={collab.respond}
            flash={(kind, text) => toast(kind === 'ok' ? 'success' : 'error', text)}
            onDone={async accepted => { await collab.reload(); if (accepted) await reload(); }} />
    ) : null;
    const openDialog = (target: string | null) => setDialog({ open: true, target });
    const quickAdd = (title: string) => addTask({ targetUserId: meId, title, date });
    // "Give to…": the teammates the server says I may give work to (never myself)
    // Owner 2026-10-26: the task window also edits (name, details, date, person), makes follow-ups and holds files.
    const give = {
        people: ok.assignable.filter(a => !a.isMe), onGive: giveTask, onGiveMany: giveMany, onAddNote: addNote,
        extra: {
            onEdit: editTask, editPeople: ok.assignable, listFiles: listAttachments, uploadFiles, removeFile: removeAttachment, onEditNote: editNote, dueDates: ok.features?.dueDates === true,
            onFollowUp: (task: WTask) => setDialog({ open: true, target: task.ownerId, followUp: { id: task.id, title: task.title } }),
        },
    };
    const remarkTask = remarkFor ? ok.tasks.find(t => t.id === remarkFor) || null : null;
    const remarkMode = ok.features?.completionRemark ?? 'ask';
    const completingTask = completingId ? ok.tasks.find(t => t.id === completingId) || null : null;
    // Every way of marking one of MY tasks done (drag, arrow keys, the task window) asks first, unless switched off
    const move = (taskId: string, status: Status) => {
        const t = ok.tasks.find(x => x.id === taskId);
        if (status === 'completed' && remarkMode !== 'off' && t && t.ownerId === meId && t.status !== 'completed') { setCompletingId(taskId); return; }
        void moveTask(taskId, status);
    };
    // Owner 2026-10-19: "Pending on…" a colleague (they are told; they still cannot see my board).
    const pending = { people: ok.dependencyPeople || [], onFlag: flagDependency };

    // Owner 2026-10-22: `@container` — the board lays itself out by the space it actually has (sidebar or not, any
    // screen, any console), not by the browser window, so it looks the same at 100% everywhere.
    return (
        <div className="@container relative space-y-5">
            {/* refresh indicator */}
            <AnimatePresence>
                {refreshing && (
                    <motion.div className="absolute inset-x-0 -top-2 h-0.5 overflow-hidden rounded-full bg-indigo-100 dark:bg-indigo-950" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                        <motion.div className="h-full w-1/3 rounded-full bg-indigo-500" animate={{ x: ['-100%', '300%'] }} transition={{ duration: 1.1, repeat: Infinity, ease: 'easeInOut' }} />
                    </motion.div>
                )}
            </AnimatePresence>

            {/* header */}
            <motion.div
                className="flex flex-col gap-3 @3xl:flex-row @3xl:items-center @3xl:justify-between"
                initial={reduce ? false : { opacity: 0, y: -16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, ease: EASE }}
            >
                <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-indigo-700 text-white shadow-md shadow-indigo-500/20">
                        <ClipboardList className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                        <h2 className="flex flex-wrap items-center gap-2 text-lg font-black leading-tight text-zinc-900 dark:text-zinc-100">
                            Tasks
                            {ok.teamSharing && <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300">Team sharing</span>}
                        </h2>
                        <p className="truncate text-xs text-zinc-500">{ok.actor.name}{ok.actor.departmentName ? ` · ${ok.actor.departmentName}` : ''}</p>
                    </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                    {/* Owner 2026-10-26: the same date filter as the superadmin console (quick picks, one day or a range of up to 31 days) */}
                    <TaskRangeFilter value={range} onChange={setRange} align="right" />
                    <button type="button" onClick={reload} disabled={refreshing} aria-label="Refresh" className="rounded-2xl border border-zinc-200 bg-white p-2.5 text-zinc-500 transition-colors hover:text-zinc-800 disabled:opacity-60 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:text-zinc-200">
                        <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
                    </button>
                    <button type="button" onClick={() => openDialog(null)} className="flex items-center gap-1.5 rounded-2xl bg-indigo-600 px-4 py-2.5 text-xs font-black text-white shadow-md shadow-indigo-500/20 transition-all hover:bg-indigo-700 hover:shadow-lg active:scale-[0.98]">
                        <Plus className="h-4 w-4" /> New task
                    </button>
                </div>
            </motion.div>

            {error && (
                <div className="flex items-center gap-2 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-medium text-rose-800 dark:border-rose-900/50 dark:bg-rose-950/30 dark:text-rose-200">
                    <AlertTriangle className="h-4 w-4" /> {error}
                </div>
            )}

            {(view === 'board' || view === 'team') && <StatCards counts={counts} />}

            {/* toolbar */}
            <div className="flex flex-wrap items-center justify-between gap-3">
                <Segmented
                    id="view" value={view} onChange={setView}
                    options={[
                        { id: 'board' as View, label: 'Board', icon: <LayoutGrid className="h-3.5 w-3.5" /> },
                        { id: 'team' as View, label: 'Team', icon: <Users className="h-3.5 w-3.5" /> },
                        ...(ok.features?.assignedTab ? [{ id: 'assigned' as View, label: 'Assigned by me', icon: <UserCheck className="h-3.5 w-3.5" /> }] : []),
                        { id: 'notifications' as View, label: 'Notifications', icon: <Bell className="h-3.5 w-3.5" /> },
                        ...(sendVisible ? [{ id: 'superuser' as View, label: 'Send', icon: <Send className="h-3.5 w-3.5" />, ...(collab.data?.incoming.length ? { count: collab.data.incoming.length } : {}) }] : []),
                    ]}
                />
                {view === 'board' && (
                    <Segmented
                        id="filter" value={filter} onChange={setFilter} size="sm"
                        options={FILTERS.map(f => ({ ...f, count: filterCounts[f.id] }))}
                    />
                )}
            </div>

            {/* content */}
            <AnimatePresence mode="wait" initial={false}>
                <motion.div key={view} initial={reduce ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={reduce ? undefined : { opacity: 0, y: -6 }} transition={{ duration: 0.3, ease: EASE }}>
                    {view === 'board' && <Board tasks={filtered} meId={meId} onMove={move} onQuickAdd={quickAdd} onDelete={deleteTask} onLock={setLocked} give={give} pending={pending} onRemark={setRemarkFor} topOfTodo={incoming} />}
                    {view === 'assigned' && ok.features?.assignedTab && (
                        <AssignedView from={range.from} to={range.to} onEdit={editTask} onDelete={deleteTask} meId={meId}
                            actions={{ ...give.extra, onAddNote: addNote }}
                            onFollowUp={t => setDialog({ open: true, target: t.holderId, followUp: { id: t.id, title: t.title } })} />
                    )}
                    {view === 'team' && <TeamView members={ok.members} tasks={ok.tasks} assignable={ok.assignable} onAssign={openDialog} />}
                    {view === 'notifications' && <NotificationsView departmentName={departmentName} />}
                    {view === 'superuser' && sendVisible && (
                        <div className="space-y-4">
                            {superCollab && crossDeptOn && (
                                <Segmented
                                    id="send-to" value={side} onChange={setSendTo} size="sm"
                                    options={[{ id: 'manager' as SendTo, label: 'Your manager' }, { id: 'departments' as SendTo, label: 'Other departments' }]}
                                />
                            )}
                            {side === 'manager' && superCollab ? (
                                <SuperuserPanel
                                    onAddTask={(recipientId, title) => addTask({ targetUserId: recipientId, title, date })}
                                    onDeleteTask={deleteTask}
                                    onChanged={reload}
                                />
                            ) : (
                                <CrossDeptPanel collab={collab} me={{ name: ok.actor.name, department: ok.actor.departmentName }} uploadFiles={uploadFiles} onChanged={reload} dueDates={ok.features?.dueDates === true} />
                            )}
                        </div>
                    )}
                </motion.div>
            </AnimatePresence>

            <TaskDialog
                open={dialog.open}
                assignable={ok.assignable}
                defaultTarget={dialog.target}
                date={date}
                followUp={dialog.followUp}
                onClose={() => setDialog({ open: false, target: null })}
                onSubmit={input => addTasks(input)}
                onCheckDuplicates={checkDuplicates}
                dueDates={ok.features?.dueDates === true}
            />

            <RemarkDialog task={remarkTask} onClose={() => setRemarkFor(null)} onSave={addRemark} />
            <RemarkDialog
                task={completingTask} completing={remarkMode === 'required' ? 'required' : 'ask'} onClose={() => setCompletingId(null)}
                onSkip={id => void moveTask(id, 'completed')}
                onSave={async (id, remark) => { await moveTask(id, 'completed', remark); return true; }}
            />

            {/* toasts */}
            <div className="pointer-events-none fixed bottom-5 right-5 z-[60] flex w-[calc(100%-2.5rem)] max-w-sm flex-col gap-2" aria-live="polite">
                <AnimatePresence>
                    {toasts.map(t => (
                        <motion.div
                            key={t.id} layout
                            initial={{ opacity: 0, y: 20, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, x: 40 }} transition={{ duration: 0.35, ease: EASE }}
                            className={`pointer-events-auto flex items-center gap-2.5 rounded-2xl border px-4 py-3 text-xs font-bold shadow-xl ${t.kind === 'success'
                                ? 'border-emerald-200 bg-white text-emerald-800 dark:border-emerald-900/60 dark:bg-zinc-900 dark:text-emerald-300'
                                : 'border-rose-200 bg-white text-rose-800 dark:border-rose-900/60 dark:bg-zinc-900 dark:text-rose-300'}`}
                        >
                            {t.kind === 'success' ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <AlertTriangle className="h-4 w-4 shrink-0" />}
                            <span className="flex-1">{t.text}</span>
                            {t.action && (
                                <button type="button" onClick={() => { setRemarkFor(t.action!.taskId); dismissToast(t.id); }} className="shrink-0 rounded-lg bg-emerald-600 px-2.5 py-1 text-[11px] font-black text-white hover:bg-emerald-700">{t.action.label}</button>
                            )}
                            <button type="button" onClick={() => dismissToast(t.id)} aria-label="Dismiss" className="opacity-60 hover:opacity-100"><X className="h-3.5 w-3.5" /></button>
                        </motion.div>
                    ))}
                </AnimatePresence>
            </div>
        </div>
    );
}
