'use client';

import React, { useMemo, useState } from 'react';
import {
    DndContext, DragOverlay, KeyboardSensor, MouseSensor, TouchSensor,
    pointerWithin, rectIntersection, useDraggable, useDroppable, useSensor, useSensors,
    type CollisionDetection, type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core';
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from 'framer-motion';
import { Check, Eye, Loader2, Lock, MoveRight, Plus, StickyNote, Trash2, Unlock } from 'lucide-react';
import { COLUMNS, ColumnDef, EASE, Status, WAssignable, WTask, avatarGradient, initials, shortDate } from './types';
import TaskView from './TaskView';
import PendingOn from './PendingOn';

/** What the task window needs to offer "Give to…": the teammates I may give work to, and the actions. */
interface GiveProps {
    people: WAssignable[];
    onGive: (taskId: string, userId: string, name: string) => Promise<boolean>;
    /** Owner 2026-10-21: give to one or more people with an optional note. */
    onGiveMany?: (taskId: string, people: WAssignable[], note: string) => Promise<boolean>;
    /** Owner 2026-10-21: add a note to a task. */
    onAddNote?: (taskId: string, note: string) => Promise<boolean>;
}

/** "Pending on…" (owner 2026-10-19): colleagues I can tell that one of my tasks is waiting on them. */
export interface PendingProps { people: Array<{ userId: string; name: string }>; onFlag: (taskId: string, userId: string, name: string) => Promise<boolean> }

/**
 * How a card looks (owner 2026-10-19, simplified 2026-10-21): white card, a thin coloured strip on the left
 * (carried forward = amber, handed over = sky, given by someone = violet). Carried forward wins.
 */
function cardTone(task: WTask): { box: string; bar: string | null } {
    const box = task.status === 'completed'
        ? 'border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/60'
        : 'border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900';
    if (task.isCarriedForward) return { box, bar: 'bg-amber-400' };
    if (task.handedOverByName) return { box, bar: 'bg-sky-400' };
    if (task.assignedByName) return { box, bar: 'bg-violet-400' };
    return { box, bar: null };
}

/** The pointer decides the target column; if it is between columns, fall back to overlap. */
const collision: CollisionDetection = args => {
    const hits = pointerWithin(args);
    return hits.length > 0 ? hits : rectIntersection(args);
};

/** The notes on a card: "Remark: ..." lines without the prefix; the hand-over trail ("Given by ...") stays in the window. */
function cardNotes(description: string | null): string {
    return String(description || '').split('\n').map(l => l.trim())
        .filter(l => l && !l.startsWith('Given by '))
        .map(l => l.replace(/^Remark:\s*/i, '')).join(' · ');
}

const firstName = (name: string) => name.split(' ')[0];

/** Stops a press on a small button from starting a drag of the card. */
const noDrag = {
    onMouseDown: (e: React.SyntheticEvent) => e.stopPropagation(),
    onTouchStart: (e: React.SyntheticEvent) => e.stopPropagation(),
    onPointerDown: (e: React.SyntheticEvent) => e.stopPropagation(),
    onKeyDown: (e: React.SyntheticEvent) => e.stopPropagation(),
};

/* ── The card's look. Used for the real card AND the ghost that follows the cursor. ─────────────── */
function CardBody({ task, meId, floating = false, pending, onDelete, onLock, onView }: { task: WTask; meId: string; floating?: boolean; pending?: PendingProps; onDelete?: (id: string) => void; onLock?: (id: string, locked: boolean) => void; onView?: (id: string) => void }) {
    const done = task.status === 'completed';
    const mine = task.ownerId === meId;
    const tone = cardTone(task);
    const canDelete = task.canDelete !== false;
    const notes = cardNotes(task.description);
    const from = task.handedOverByName || task.assignedByName;
    const showLock = !floating && !!onLock && task.canLock;
    const showDelete = !floating && !!onDelete && canDelete;
    const showView = !floating && !!onView;
    const showPending = !floating && !!pending && mine && !done && pending.people.length > 0;
    const hasChips = !mine || task.locked || !!task.meta || task.isCarriedForward || !!from;

    return (
        <div
            className={[
                'relative overflow-hidden rounded-xl border py-3 pl-3.5 pr-3 transition-shadow duration-200',
                tone.box,
                floating ? 'shadow-2xl shadow-indigo-500/20 ring-1 ring-indigo-400/40' : 'shadow-xs hover:shadow-md',
                task.canChange ? 'cursor-grab active:cursor-grabbing' : 'cursor-default',
            ].join(' ')}
        >
            {tone.bar && <span className={`absolute inset-y-0 left-0 w-[3px] ${tone.bar}`} aria-hidden="true" />}

            {/* Title: the full width, breaks only between words (a long link may still wrap so it never spills out) */}
            <p className={`text-[15px] font-bold leading-snug [overflow-wrap:break-word] ${done ? 'text-zinc-500 dark:text-zinc-400' : 'text-zinc-900 dark:text-zinc-50'}`}>
                {done && <Check className="-mt-0.5 mr-1.5 inline h-4 w-4 text-emerald-600" strokeWidth={3} aria-label="Done" />}
                {task.title}
            </p>

            {notes && (
                <p className="mt-1 flex gap-1.5 text-[13px] leading-snug text-zinc-600 dark:text-zinc-300">
                    <StickyNote className="mt-[2px] h-3.5 w-3.5 shrink-0 text-zinc-400" aria-hidden="true" />
                    <span className="line-clamp-2 min-w-0 [overflow-wrap:break-word]">{notes}</span>
                </p>
            )}

            {hasChips && (
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    {!mine && (
                        <span className="flex items-center gap-1.5 text-xs font-bold text-zinc-700 dark:text-zinc-200">
                            <span className={`flex h-5 w-5 items-center justify-center rounded-full bg-gradient-to-br ${avatarGradient(task.ownerName)} text-[8px] font-black text-white`}>
                                {initials(task.ownerName)}
                            </span>
                            {firstName(task.ownerName)}
                        </span>
                    )}
                    {task.isCarriedForward && (
                        <span title={`Carried forward from ${shortDate(task.assignedDate)}`} className="whitespace-nowrap rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-900 dark:bg-amber-900/40 dark:text-amber-200">From {shortDate(task.assignedDate)}</span>
                    )}
                    {from && (
                        <span title={task.handedOverByName ? `Handed over by ${from}` : `Assigned by ${from}`} className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-bold ${task.handedOverByName ? 'bg-sky-100 text-sky-900 dark:bg-sky-900/40 dark:text-sky-200' : 'bg-violet-100 text-violet-900 dark:bg-violet-900/40 dark:text-violet-200'}`}>From {firstName(from)}</span>
                    )}
                    {task.locked && (
                        <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-bold text-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-200">Daily</span>
                    )}
                    {task.meta && (
                        <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-bold text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">{task.meta.department} · {task.meta.from}</span>
                    )}
                </div>
            )}

            {/* Bottom row: View / Assign, Pending on..., then the small lock and delete buttons. Wraps on narrow cards. */}
            {(showView || showPending || showLock || showDelete) && (
                <div className="mt-2.5 flex flex-wrap items-center gap-x-1 gap-y-1 border-t border-zinc-100 pt-2 dark:border-zinc-800">
                    {/* Owner 2026-10-21: only this button opens the task window; the card itself still drags. */}
                    {showView && (
                        <button
                            type="button" aria-label={`View or assign ${task.title}`}
                            onClick={e => { e.stopPropagation(); onView!(task.id); }}
                            {...noDrag}
                            className="-ml-1.5 flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-lg px-1.5 py-1 text-[13px] font-bold text-indigo-700 transition-colors hover:bg-indigo-50 dark:text-indigo-300 dark:hover:bg-indigo-950/40"
                        ><Eye className="h-4 w-4" aria-hidden="true" />{done ? 'View' : 'View / Assign'}</button>
                    )}
                    {showPending && (
                        <PendingOn
                            taskTitle={task.title}
                            people={pending!.people}
                            onFlag={(userId, name) => pending!.onFlag(task.id, userId, name)}
                        />
                    )}
                    <span className="ml-auto flex items-center">
                        {showLock && (
                            <button
                                type="button" aria-pressed={!!task.locked} aria-label={task.locked ? `Unlock ${task.title}` : `Lock ${task.title}`}
                                title={task.locked ? 'Locked: comes back every working day (Mon to Sat). Click to unlock.' : 'Lock: bring this task back every working day (Mon to Sat)'}
                                onClick={e => { e.stopPropagation(); onLock!(task.id, !task.locked); }}
                                {...noDrag}
                                className={`cursor-pointer rounded-lg p-1.5 transition-colors ${task.locked ? 'bg-indigo-50 text-indigo-600 dark:bg-indigo-950/60 dark:text-indigo-300' : 'text-zinc-400 hover:bg-indigo-50 hover:text-indigo-600 dark:text-zinc-500 dark:hover:bg-indigo-950/30'}`}
                            >{task.locked ? <Lock className="h-4 w-4" /> : <Unlock className="h-4 w-4" />}</button>
                        )}
                        {showDelete && (
                            <button
                                type="button" aria-label={`Delete ${task.title}`} disabled={!!task.locked}
                                title={task.locked ? 'Unlock this task to delete it' : 'Delete task'}
                                onClick={e => { e.stopPropagation(); if (!task.locked) onDelete!(task.id); }}
                                {...noDrag}
                                className="cursor-pointer rounded-lg p-1.5 text-zinc-400 transition-colors hover:bg-rose-50 hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-zinc-400 dark:text-zinc-500 dark:hover:bg-rose-950/30"
                            ><Trash2 className="h-4 w-4" /></button>
                        )}
                    </span>
                </div>
            )}
        </div>
    );
}

/* ── One draggable card ──────────────────────────────────────────────────────────────────────── */
function TaskCard({ task, meId, onMove, reduce, pending, onDelete, onLock, onView }: { task: WTask; meId: string; onMove: (id: string, s: Status) => void; reduce: boolean; pending?: PendingProps; onDelete: (id: string) => void; onLock?: (id: string, locked: boolean) => void; onView?: (id: string) => void }) {
    const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: task.id, disabled: !task.canChange });
    const index = COLUMNS.findIndex(c => c.id === task.status);

    // Keyboard: focus a card, then ← / → moves it between columns (Space or Enter picks it up for arrow-dragging too).
    const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
        (listeners as Record<string, ((ev: React.KeyboardEvent<HTMLDivElement>) => void) | undefined> | undefined)?.onKeyDown?.(e);
        if (!task.canChange || e.defaultPrevented) return;
        if (e.key === 'ArrowRight' && index < COLUMNS.length - 1) { e.preventDefault(); onMove(task.id, COLUMNS[index + 1].id); }
        if (e.key === 'ArrowLeft' && index > 0) { e.preventDefault(); onMove(task.id, COLUMNS[index - 1].id); }
    };

    return (
        <motion.div
            ref={setNodeRef}
            layout={!reduce}
            layoutId={reduce ? undefined : task.id}
            initial={reduce ? false : { opacity: 0, y: 10, scale: 0.98 }}
            animate={{ opacity: isDragging ? 0.3 : 1, y: 0, scale: 1 }}
            exit={reduce ? undefined : { opacity: 0, scale: 0.96 }}
            whileHover={!reduce && task.canChange && !isDragging ? { y: -2 } : undefined}
            transition={{ type: 'spring', stiffness: 420, damping: 34 }}
            {...attributes}
            {...listeners}
            onKeyDown={onKeyDown}
            aria-label={`${task.title}. ${COLUMNS[index]?.label}. ${task.canChange ? 'Drag, or press the left and right arrow keys, to move it.' : 'You cannot move this task.'}`}
            className="rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-50 dark:focus-visible:ring-offset-zinc-950 touch-manipulation"
        >
            <CardBody task={task} meId={meId} pending={pending} onDelete={onDelete} onLock={onLock} onView={onView} />
        </motion.div>
    );
}

/* ── "+ Add a task" at the bottom of To do ───────────────────────────────────────────────────── */
function QuickAdd({ onAdd }: { onAdd: (title: string) => Promise<boolean> }) {
    const [value, setValue] = useState('');
    const [busy, setBusy] = useState(false);

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        const title = value.trim();
        if (!title || busy) return;
        setBusy(true);
        const ok = await onAdd(title);
        setBusy(false);
        if (ok) setValue('');
    };

    return (
        <form onSubmit={submit} className="mt-1 flex items-center gap-2 rounded-2xl border border-dashed border-zinc-300 bg-white/60 px-3 py-2 transition-colors focus-within:border-indigo-400 focus-within:bg-white dark:border-zinc-700 dark:bg-zinc-900/40 dark:focus-within:border-indigo-500">
            <Plus className="h-4 w-4 shrink-0 text-zinc-400" aria-hidden="true" />
            <input
                id="quick-add-task"
                value={value}
                onChange={e => setValue(e.target.value)}
                maxLength={200}
                placeholder="Add a task for yourself"
                aria-label="Add a task for yourself"
                className="min-w-0 flex-1 bg-transparent text-xs font-semibold text-zinc-900 placeholder:text-zinc-400 outline-none dark:text-zinc-100"
            />
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin text-zinc-400" /> : value.trim() && <kbd className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-bold text-zinc-500 dark:bg-zinc-800">Enter</kbd>}
        </form>
    );
}

/* ── One column (a drop target) ──────────────────────────────────────────────────────────────── */
function Column({ def, tasks, meId, onMove, onQuickAdd, onDelete, onLock, reduce, dragging, pending, onView }: {
    def: ColumnDef; tasks: WTask[]; meId: string; onMove: (id: string, s: Status) => void;
    onQuickAdd?: (title: string) => Promise<boolean>; onDelete: (id: string) => void; onLock?: (id: string, locked: boolean) => void; reduce: boolean; dragging: boolean; pending?: PendingProps; onView?: (id: string) => void;
}) {
    const { setNodeRef, isOver } = useDroppable({ id: def.id });

    return (
        <section
            aria-label={def.label}
            className="flex min-h-[240px] max-h-[75dvh] flex-col rounded-2xl border border-zinc-200 bg-zinc-50/80 p-2.5 sm:p-3 @[600px]:max-h-[calc(100dvh-180px)] dark:border-zinc-800 dark:bg-zinc-900/40"
        >
            <header className="mb-3 flex items-center gap-2 px-1">
                <span className={`h-2.5 w-2.5 rounded-full ${def.dot}`} />
                <h3 className="text-sm font-black text-zinc-800 dark:text-zinc-100">{def.label}</h3>
                <span className={`ml-auto rounded-full px-2 py-0.5 text-[11px] font-black tabular-nums ${def.pill}`}>{tasks.length}</span>
            </header>

            <div
                ref={setNodeRef}
                className={`min-h-0 flex-1 space-y-2.5 overflow-y-auto rounded-2xl p-1 transition-all duration-200 ${isOver ? `ring-2 ring-offset-0 ${def.glow}` : dragging ? 'ring-1 ring-dashed ring-zinc-300 dark:ring-zinc-700' : ''}`}
            >
                <AnimatePresence initial={false}>
                    {tasks.map(t => <TaskCard key={t.id} task={t} meId={meId} onMove={onMove} reduce={reduce} pending={pending} onDelete={onDelete} onLock={onLock} onView={onView} />)}
                </AnimatePresence>

                {tasks.length === 0 && (
                    <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-zinc-300 px-4 py-8 text-center dark:border-zinc-700">
                        <MoveRight className={`h-4 w-4 transition-colors ${isOver ? 'text-indigo-500' : 'text-zinc-300 dark:text-zinc-600'}`} aria-hidden="true" />
                        <p className="max-w-[180px] text-[11px] font-medium leading-relaxed text-zinc-400">{isOver ? 'Release to drop here' : def.empty}</p>
                    </div>
                )}

                {def.id === 'pending' && onQuickAdd && <QuickAdd onAdd={onQuickAdd} />}
            </div>
        </section>
    );
}

/* ── The board ───────────────────────────────────────────────────────────────────────────────── */
export default function Board({ tasks, meId, onMove, onQuickAdd, onDelete, onLock, give, pending, instant = false }: {
    tasks: WTask[]; meId: string; onMove: (id: string, s: Status) => void; onQuickAdd?: (title: string) => Promise<boolean>; onDelete: (id: string) => void; onLock?: (id: string, locked: boolean) => void; give?: GiveProps; pending?: PendingProps;
    /** No entrance animation (used where the screen is revisited often). */
    instant?: boolean;
}) {
    const reduce = !!useReducedMotion() || instant;
    const [activeId, setActiveId] = useState<string | null>(null);
    // Owner 2026-10-21: the task window, opened only by a card's "View / Assign" button.
    const [viewId, setViewId] = useState<string | null>(null);
    const viewing = viewId ? tasks.find(t => t.id === viewId) || null : null;   // gone (given away, deleted) → closes
    const giveMany = give && (give.onGiveMany ?? (async (taskId: string, people: WAssignable[]) => people.length === 1 && give.onGive(taskId, people[0].userId, people[0].name)));

    const sensors = useSensors(
        useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),   // a click is not a drag
        useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }), // press and hold on phones so scrolling still works
        useSensor(KeyboardSensor),
    );

    const byStatus = useMemo(() => {
        const map: Record<Status, WTask[]> = { pending: [], in_progress: [], completed: [] };
        // carried-forward first, so old work is never buried
        [...tasks].sort((a, b) => Number(b.isCarriedForward) - Number(a.isCarriedForward)).forEach(t => map[t.status].push(t));
        return map;
    }, [tasks]);

    const active = activeId ? tasks.find(t => t.id === activeId) || null : null;

    const onDragStart = (e: DragStartEvent) => setActiveId(String(e.active.id));
    const onDragEnd = (e: DragEndEvent) => {
        setActiveId(null);
        const target = e.over?.id as Status | undefined;
        const task = tasks.find(t => t.id === e.active.id);
        if (task && target && target !== task.status) onMove(task.id, target);
    };

    return (
        <DndContext
            id="procurement-task-board"
            sensors={sensors}
            collisionDetection={collision}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            onDragCancel={() => setActiveId(null)}
        >
            {/* Owner 2026-10-21: the layout follows the space the board really has (not the window), so cards never get too
                narrow: 1 column below 600px, 2 below 940px, 3 above. */}
            <div className="@container">
            <LayoutGroup id="procurement-board">
                <motion.div
                    className="grid grid-cols-1 gap-3 @[600px]:grid-cols-2 @[600px]:gap-4 @[940px]:grid-cols-3"
                    initial={reduce ? false : 'hidden'}
                    animate="show"
                    variants={{ show: { transition: { staggerChildren: 0.09, delayChildren: 0.1 } } }}
                >
                    {COLUMNS.map(def => (
                        <motion.div
                            key={def.id}
                            variants={{ hidden: { opacity: 0, y: 18 }, show: { opacity: 1, y: 0, transition: { duration: 0.7, ease: EASE } } }}
                        >
                            <Column def={def} tasks={byStatus[def.id]} meId={meId} onMove={onMove} onQuickAdd={onQuickAdd} onDelete={onDelete} onLock={onLock} reduce={reduce} dragging={!!active} pending={pending} onView={setViewId} />
                        </motion.div>
                    ))}
                </motion.div>
            </LayoutGroup>
            </div>

            <DragOverlay dropAnimation={{ duration: 240, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' }}>
                {active ? <div className="rotate-[1.5deg] scale-[1.03]"><CardBody task={active} meId={meId} floating /></div> : null}
            </DragOverlay>

            <TaskView
                task={viewing}
                meId={meId}
                onClose={() => setViewId(null)}
                onMove={onMove}
                actions={give ? { people: give.people, onGive: giveMany, onAddNote: give.onAddNote } : undefined}
            />
        </DndContext>
    );
}
