'use client';

import React, { useMemo, useState } from 'react';
import {
    DndContext, DragOverlay, KeyboardSensor, MouseSensor, TouchSensor,
    pointerWithin, rectIntersection, useDraggable, useDroppable, useSensor, useSensors,
    type CollisionDetection, type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core';
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from 'framer-motion';
import { Check, Clock, GripVertical, Loader2, Lock, MoveRight, Plus, Trash2, Unlock } from 'lucide-react';
import { COLUMNS, ColumnDef, EASE, Status, WAssignable, WTask, avatarGradient, initials, shortDate } from './types';
import GiveTo from './GiveTo';

/** What the card needs to offer "Give to…": the teammates I may give work to, and the action. */
interface GiveProps { people: WAssignable[]; onGive: (taskId: string, userId: string, name: string) => Promise<boolean> }

/** The pointer decides the target column; if it is between columns, fall back to overlap. */
const collision: CollisionDetection = args => {
    const hits = pointerWithin(args);
    return hits.length > 0 ? hits : rectIntersection(args);
};

/* ── The card's look. Used for the real card AND the ghost that follows the cursor. ─────────────── */
function CardBody({ task, meId, floating = false, give, onDelete, onLock }: { task: WTask; meId: string; floating?: boolean; give?: GiveProps; onDelete?: (id: string) => void; onLock?: (id: string, locked: boolean) => void }) {
    const done = task.status === 'completed';
    const carried = task.isCarriedForward;
    const mine = task.ownerId === meId;

    return (
        <div
            className={[
                'relative overflow-hidden rounded-2xl border p-3.5 transition-shadow duration-200',
                carried
                    ? 'border-amber-300/70 bg-amber-50/70 dark:border-amber-700/40 dark:bg-amber-950/20'
                    : 'border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900',
                floating ? 'shadow-2xl shadow-indigo-500/20 ring-1 ring-indigo-400/40' : 'shadow-xs hover:shadow-md',
                task.canChange ? 'cursor-grab active:cursor-grabbing' : 'cursor-default',
            ].join(' ')}
        >
            {carried && <span className="absolute inset-y-0 left-0 w-1 bg-amber-400" aria-hidden="true" />}

            <div className="flex items-start gap-2">
                <p className={`min-w-0 flex-1 text-[13px] font-bold leading-snug break-words ${done ? 'text-zinc-400 line-through decoration-zinc-300 dark:decoration-zinc-600' : 'text-zinc-900 dark:text-zinc-100'}`}>
                    {task.title}
                </p>
                {done ? (
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white"><Check className="h-3 w-3" strokeWidth={3} /></span>
                ) : task.canChange ? (
                    <GripVertical className="mt-0.5 h-4 w-4 shrink-0 text-zinc-300 dark:text-zinc-600" aria-hidden="true" />
                ) : null}
                {!floating && onLock && task.canLock && (
                    <button
                        type="button" aria-pressed={!!task.locked} aria-label={task.locked ? `Unlock ${task.title}` : `Lock ${task.title}`}
                        title={task.locked ? 'Locked: comes back every working day (Mon to Sat). Click to unlock.' : 'Lock: bring this task back every working day (Mon to Sat)'}
                        onClick={e => { e.stopPropagation(); onLock(task.id, !task.locked); }}
                        onMouseDown={e => e.stopPropagation()} onTouchStart={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}
                        className={`-mt-0.5 shrink-0 cursor-pointer rounded-lg p-1 transition-colors ${task.locked ? 'bg-indigo-50 text-indigo-600 dark:bg-indigo-950/60 dark:text-indigo-300' : 'text-zinc-300 hover:bg-indigo-50 hover:text-indigo-600 dark:text-zinc-600 dark:hover:bg-indigo-950/30'}`}
                    >{task.locked ? <Lock className="h-3.5 w-3.5" /> : <Unlock className="h-3.5 w-3.5" />}</button>
                )}
                {!floating && onDelete && (
                    <button
                        type="button" aria-label={`Delete ${task.title}`} disabled={!!task.locked}
                        title={task.locked ? 'Unlock this task to delete it' : 'Delete task'}
                        onClick={e => { e.stopPropagation(); if (!task.locked) onDelete(task.id); }}
                        onMouseDown={e => e.stopPropagation()} onTouchStart={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}
                        className="-mr-1 -mt-0.5 shrink-0 cursor-pointer rounded-lg p-1 text-zinc-300 transition-colors hover:bg-rose-50 hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-zinc-300 dark:text-zinc-600 dark:hover:bg-rose-950/30"
                    ><Trash2 className="h-3.5 w-3.5" /></button>
                )}
            </div>

            {task.description && (
                <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400 break-words">{task.description}</p>
            )}

            <div className="mt-3 flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
                <span className="flex items-center gap-1.5 text-[11px] font-bold text-zinc-600 dark:text-zinc-300">
                    <span className={`flex h-5 w-5 items-center justify-center rounded-full bg-gradient-to-br ${avatarGradient(task.ownerName)} text-[8px] font-black text-white`}>
                        {initials(task.ownerName)}
                    </span>
                    {mine ? 'You' : task.ownerName.split(' ')[0]}
                </span>
                {task.locked && (
                    <span className="rounded-md bg-indigo-50 px-1.5 py-0.5 text-[10px] font-black text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300">Daily</span>
                )}
                {task.meta && (
                    <>
                        <span className="text-[11px] font-semibold text-zinc-500 dark:text-zinc-400">from {task.meta.from}</span>
                        <span className="rounded-md bg-indigo-50 px-1.5 py-0.5 text-[10px] font-black text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300">{task.meta.department}</span>
                    </>
                )}
                {carried && (
                    <span className="flex items-center gap-1 rounded-md bg-amber-100 px-1.5 py-0.5 text-[10px] font-black text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
                        <Clock className="h-3 w-3" /> Carried from {shortDate(task.assignedDate)}
                    </span>
                )}
            </div>

            {!floating && give && task.canHandOver && give.people.length > 0 && (
                <GiveTo
                    taskTitle={task.title}
                    people={give.people}
                    onGive={(userId, name) => give.onGive(task.id, userId, name)}
                />
            )}
        </div>
    );
}

/* ── One draggable card ──────────────────────────────────────────────────────────────────────── */
function TaskCard({ task, meId, onMove, reduce, give, onDelete, onLock }: { task: WTask; meId: string; onMove: (id: string, s: Status) => void; reduce: boolean; give?: GiveProps; onDelete: (id: string) => void; onLock?: (id: string, locked: boolean) => void }) {
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
            <CardBody task={task} meId={meId} give={give} onDelete={onDelete} onLock={onLock} />
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
function Column({ def, tasks, meId, onMove, onQuickAdd, onDelete, onLock, reduce, dragging, give }: {
    def: ColumnDef; tasks: WTask[]; meId: string; onMove: (id: string, s: Status) => void;
    onQuickAdd?: (title: string) => Promise<boolean>; onDelete: (id: string) => void; onLock?: (id: string, locked: boolean) => void; reduce: boolean; dragging: boolean; give?: GiveProps;
}) {
    const { setNodeRef, isOver } = useDroppable({ id: def.id });

    return (
        <section
            aria-label={def.label}
            className="flex min-h-[240px] flex-col rounded-3xl border border-zinc-200 bg-zinc-50/80 p-3 dark:border-zinc-800 dark:bg-zinc-900/40"
        >
            <header className="mb-3 flex items-center gap-2 px-1">
                <span className={`h-2.5 w-2.5 rounded-full ${def.dot}`} />
                <h3 className="text-xs font-black tracking-wide text-zinc-800 dark:text-zinc-100">{def.label}</h3>
                <span className={`ml-auto rounded-full px-2 py-0.5 text-[11px] font-black tabular-nums ${def.pill}`}>{tasks.length}</span>
            </header>

            <div
                ref={setNodeRef}
                className={`flex-1 space-y-2.5 rounded-2xl p-1 transition-all duration-200 ${isOver ? `ring-2 ring-offset-0 ${def.glow}` : dragging ? 'ring-1 ring-dashed ring-zinc-300 dark:ring-zinc-700' : ''}`}
            >
                <AnimatePresence initial={false}>
                    {tasks.map(t => <TaskCard key={t.id} task={t} meId={meId} onMove={onMove} reduce={reduce} give={give} onDelete={onDelete} onLock={onLock} />)}
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
export default function Board({ tasks, meId, onMove, onQuickAdd, onDelete, onLock, give, instant = false }: {
    tasks: WTask[]; meId: string; onMove: (id: string, s: Status) => void; onQuickAdd?: (title: string) => Promise<boolean>; onDelete: (id: string) => void; onLock?: (id: string, locked: boolean) => void; give?: GiveProps;
    /** No entrance animation (used where the screen is revisited often). */
    instant?: boolean;
}) {
    const reduce = !!useReducedMotion() || instant;
    const [activeId, setActiveId] = useState<string | null>(null);

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
            <LayoutGroup id="procurement-board">
                <motion.div
                    className="grid grid-cols-1 gap-4 md:grid-cols-3"
                    initial={reduce ? false : 'hidden'}
                    animate="show"
                    variants={{ show: { transition: { staggerChildren: 0.09, delayChildren: 0.1 } } }}
                >
                    {COLUMNS.map(def => (
                        <motion.div
                            key={def.id}
                            variants={{ hidden: { opacity: 0, y: 18 }, show: { opacity: 1, y: 0, transition: { duration: 0.7, ease: EASE } } }}
                        >
                            <Column def={def} tasks={byStatus[def.id]} meId={meId} onMove={onMove} onQuickAdd={onQuickAdd} onDelete={onDelete} onLock={onLock} reduce={reduce} dragging={!!active} give={give} />
                        </motion.div>
                    ))}
                </motion.div>
            </LayoutGroup>

            <DragOverlay dropAnimation={{ duration: 240, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' }}>
                {active ? <div className="rotate-[1.5deg] scale-[1.03]"><CardBody task={active} meId={meId} floating /></div> : null}
            </DragOverlay>
        </DndContext>
    );
}
