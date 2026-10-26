'use client';

import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ArrowRightLeft, Check, CircleDot, Loader2, RotateCcw, Send, StickyNote, X } from 'lucide-react';
import { COLUMNS, EASE, Status, WAssignable, WTask, avatarGradient, initials, shortDate, shortDateTime } from './types';

/**
 * Owner 2026-10-21: the task window, opened ONLY by a card's "View / Assign" button (the card itself stays draggable).
 * Shows the whole task (every note in full), moves it between columns, adds a note, and gives it to one or more people
 * with an optional note. The server checks every action again; this window only offers what the board already allows.
 */

export interface TaskViewActions {
    /** Teammates this person may give work to (not themself). */
    people: WAssignable[];
    /** Give to one or more people with an optional note. Absent → no "Give to" section. */
    onGive?: (taskId: string, people: WAssignable[], note: string) => Promise<boolean>;
    /** Add a note to the task. Absent → no "Add note" button. */
    onAddNote?: (taskId: string, note: string) => Promise<boolean>;
}

const STATUS_PILL: Record<Status, string> = {
    pending: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200',
    in_progress: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300',
    completed: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300',
};

/** The two moves that make sense from each column (owner 2026-10-21). "Pending" = back to To do. */
const MOVES: Record<Status, Array<{ to: Status; label: string }>> = {
    pending: [{ to: 'in_progress', label: 'Mark in progress' }, { to: 'completed', label: 'Mark as done' }],
    in_progress: [{ to: 'pending', label: 'Mark as pending' }, { to: 'completed', label: 'Mark as done' }],
    completed: [{ to: 'pending', label: 'Mark as pending' }, { to: 'in_progress', label: 'Mark in progress' }],
};
const MOVE_STYLE: Record<Status, string> = {
    pending: 'border border-zinc-300 bg-white text-zinc-800 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800',
    in_progress: 'bg-indigo-600 text-white hover:bg-indigo-700',
    completed: 'bg-emerald-600 text-white hover:bg-emerald-700',
};
const MOVE_ICON: Record<Status, React.ReactNode> = {
    pending: <RotateCcw className="h-4 w-4" aria-hidden="true" />,
    in_progress: <CircleDot className="h-4 w-4" aria-hidden="true" />,
    completed: <Check className="h-4 w-4" aria-hidden="true" />,
};

/** The task's notes, one per line ("Remark: …" shows without the prefix). */
function notesOf(description: string | null): string[] {
    return String(description || '').split('\n').map(l => l.trim().replace(/^Remark:\s*/i, '')).filter(Boolean);
}

const firstName = (name: string) => name.split(' ')[0];

const noSubscribe = () => () => {};

export default function TaskView({ task, meId, onClose, onMove, actions }: {
    task: WTask | null;
    meId: string;
    onClose: () => void;
    onMove: (id: string, s: Status) => void;
    actions?: TaskViewActions;
}) {
    const reduce = !!useReducedMotion();
    const mounted = useSyncExternalStore(noSubscribe, () => true, () => false);   // the portal needs the browser
    const openId = task?.id ?? null;

    useEffect(() => {
        if (!openId) return;
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [openId, onClose]);

    if (!mounted) return null;

    return createPortal(
        <AnimatePresence>
            {task && (
                <motion.div
                    key="task-view"
                    className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-zinc-950/45 p-4 pt-[8vh] backdrop-blur-[2px]"
                    initial={reduce ? false : { opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}
                    onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}
                >
                    <motion.div
                        role="dialog" aria-modal="true" aria-labelledby="task-view-title"
                        className="w-full max-w-lg overflow-hidden rounded-3xl bg-white shadow-2xl dark:bg-zinc-900"
                        initial={reduce ? false : { opacity: 0, y: 14, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8, scale: 0.98 }}
                        transition={{ duration: 0.28, ease: EASE }}
                    >
                        {/* keyed by task: a fresh window (no leftover picks or notes) for every task */}
                        <TaskViewBody key={task.id} task={task} meId={meId} onClose={onClose} onMove={onMove} actions={actions} />
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>,
        document.body,
    );
}

function TaskViewBody({ task, meId, onClose, onMove, actions }: {
    task: WTask;
    meId: string;
    onClose: () => void;
    onMove: (id: string, s: Status) => void;
    actions?: TaskViewActions;
}) {
    const [picked, setPicked] = useState<WAssignable[]>([]);
    const [note, setNote] = useState('');
    const [giving, setGiving] = useState(false);
    const [adding, setAdding] = useState(false);
    const [newNote, setNewNote] = useState('');
    const [saving, setSaving] = useState(false);
    const mine = task.ownerId === meId;
    const notes = notesOf(task.description);
    const canGive = !!(task && actions?.onGive && task.canHandOver && task.status !== 'completed' && actions.people.length > 0);
    const canAddNote = !!(task && actions?.onAddNote);
    const column = task ? COLUMNS.find(c => c.id === task.status) : undefined;
    const toggle = (p: WAssignable) => setPicked(list => (list.some(x => x.userId === p.userId) ? list.filter(x => x.userId !== p.userId) : [...list, p]));

    const give = async () => {
        if (!task || !actions?.onGive || picked.length === 0 || giving) return;
        setGiving(true);
        const ok = await actions.onGive(task.id, picked, note.trim());
        setGiving(false);
        if (ok) onClose();       // the task has left this person's list
    };
    const saveNote = async () => {
        if (!task || !actions?.onAddNote || !newNote.trim() || saving) return;
        setSaving(true);
        const ok = await actions.onAddNote(task.id, newNote.trim());
        setSaving(false);
        if (ok) { setAdding(false); setNewNote(''); }
    };

    const giveLabel = picked.length === 0 ? 'Give' : picked.length === 1 ? `Give to ${firstName(picked[0].name)}` : `Give to ${picked.length} people`;
    const giveHint = picked.length === 0 ? 'Choose who gets it first.'
        : picked.length === 1 ? `It moves to ${firstName(picked[0].name)}'s list${note.trim() ? ', with your note' : ''}.`
        : `Each person gets their own copy${note.trim() ? ' with your note' : ''}, and it leaves your list.`;

    return (
                    <>
                        <header className={`border-b border-zinc-200 px-6 pb-4 pt-5 dark:border-zinc-800 ${task.isCarriedForward ? 'bg-amber-50 dark:bg-amber-950/20' : task.handedOverByName ? 'bg-sky-50 dark:bg-sky-950/20' : task.assignedByName ? 'bg-violet-50 dark:bg-violet-950/20' : 'bg-zinc-50 dark:bg-zinc-900'}`}>
                            <div className="flex items-start gap-3">
                                <div className="min-w-0 flex-1 space-y-2">
                                    <span className={`inline-block rounded-full px-2.5 py-0.5 text-[11px] font-black ${STATUS_PILL[task.status]}`}>{column?.label ?? task.status}</span>
                                    <h2 id="task-view-title" className="break-words text-xl font-black leading-snug text-zinc-900 dark:text-zinc-50">{task.title}</h2>
                                </div>
                                <button type="button" onClick={onClose} aria-label="Close" className="rounded-xl bg-black/5 p-2 text-zinc-600 transition-colors hover:bg-black/10 dark:bg-white/10 dark:text-zinc-300 dark:hover:bg-white/15">
                                    <X className="h-4 w-4" />
                                </button>
                            </div>
                        </header>

                        <div className="space-y-5 px-6 pb-6 pt-5">
                            {/* Notes, in full */}
                            <section aria-labelledby="task-view-notes" className="space-y-2">
                                <div className="flex items-center justify-between gap-2">
                                    <h3 id="task-view-notes" className="text-[11px] font-black uppercase tracking-widest text-zinc-500 dark:text-zinc-400">Notes</h3>
                                    {canAddNote && !adding && (
                                        <button type="button" onClick={() => setAdding(true)} className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-bold text-indigo-700 hover:bg-indigo-50 dark:text-indigo-300 dark:hover:bg-indigo-950/40">
                                            <StickyNote className="h-3.5 w-3.5" aria-hidden="true" /> Add note
                                        </button>
                                    )}
                                </div>
                                {notes.length > 0 ? (
                                    <ul className="space-y-2">
                                        {notes.map((n, i) => (
                                            <li key={i} className="whitespace-pre-wrap break-words rounded-xl bg-zinc-100 px-3 py-2.5 text-sm leading-relaxed text-zinc-800 dark:bg-zinc-800 dark:text-zinc-100">{n}</li>
                                        ))}
                                    </ul>
                                ) : !adding && <p className="text-sm text-zinc-500 dark:text-zinc-400">No notes on this task.</p>}
                                {adding && (
                                    <div className="space-y-2">
                                        <label htmlFor="task-view-new-note" className="sr-only">New note</label>
                                        <textarea
                                            id="task-view-new-note" value={newNote} onChange={e => setNewNote(e.target.value)} maxLength={300} rows={2} autoFocus
                                            placeholder="Type the note"
                                            className="w-full resize-y rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-indigo-400 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                                        />
                                        <div className="flex gap-2">
                                            <button type="button" onClick={saveNote} disabled={saving || !newNote.trim()} className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-black text-white hover:bg-indigo-700 disabled:opacity-50">
                                                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Save note
                                            </button>
                                            <button type="button" onClick={() => { setAdding(false); setNewNote(''); }} disabled={saving} className="rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-bold text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800">Cancel</button>
                                        </div>
                                    </div>
                                )}
                            </section>

                            {/* Give to one or more people, with an optional note (always visible) */}
                            {canGive && (
                                <section aria-labelledby="task-view-give" className="space-y-3 rounded-2xl border border-indigo-100 bg-indigo-50/50 p-4 dark:border-indigo-900/50 dark:bg-indigo-950/20">
                                    <div className="flex items-baseline justify-between gap-2">
                                        <h3 id="task-view-give" className="text-[11px] font-black uppercase tracking-widest text-indigo-800 dark:text-indigo-300">Give to</h3>
                                        <span className="text-[11px] font-semibold text-zinc-600 dark:text-zinc-400">Pick one or more people</span>
                                    </div>
                                    <div className="flex flex-wrap gap-2">
                                        {actions!.people.map(p => {
                                            const on = picked.some(x => x.userId === p.userId);
                                            return (
                                                <button
                                                    key={p.userId} type="button" aria-pressed={on} onClick={() => toggle(p)}
                                                    className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition-colors ${on ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-zinc-300 bg-white text-zinc-800 hover:border-indigo-300 hover:bg-indigo-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-indigo-950/40'}`}
                                                >
                                                    {on && <Check className="h-3.5 w-3.5" aria-hidden="true" />}{p.name}
                                                </button>
                                            );
                                        })}
                                    </div>
                                    <div className="space-y-1.5">
                                        <label htmlFor="task-view-give-note" className="text-xs font-black text-zinc-700 dark:text-zinc-200">Note <span className="font-semibold text-zinc-500">(optional)</span></label>
                                        <textarea
                                            id="task-view-give-note" value={note} onChange={e => setNote(e.target.value)} maxLength={300} rows={2}
                                            placeholder="For example: call the vendor before 3pm"
                                            className="w-full resize-y rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-indigo-400 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                                        />
                                    </div>
                                    <div className="flex flex-wrap items-center gap-3">
                                        <button
                                            type="button" onClick={give} disabled={picked.length === 0 || giving}
                                            className="flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-black text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-zinc-200 disabled:text-zinc-500 dark:disabled:bg-zinc-800"
                                        >
                                            {giving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" aria-hidden="true" />} {giveLabel}
                                        </button>
                                        <span className="text-xs text-zinc-600 dark:text-zinc-400">{giveHint}</span>
                                    </div>
                                </section>
                            )}

                            {/* Details */}
                            <dl className="grid grid-cols-[120px_1fr] gap-x-3 gap-y-2.5 text-sm">
                                <dt className="font-semibold text-zinc-500 dark:text-zinc-400">Holder</dt>
                                <dd className="flex items-center gap-2 font-bold text-zinc-900 dark:text-zinc-100">
                                    <span className={`flex h-5 w-5 items-center justify-center rounded-full bg-gradient-to-br ${avatarGradient(task.ownerName)} text-[8px] font-black text-white`}>{initials(task.ownerName)}</span>
                                    {mine ? `${task.ownerName} (you)` : task.ownerName}
                                </dd>
                                {(task.handedOverByName || task.assignedByName) && (<>
                                    <dt className="font-semibold text-zinc-500 dark:text-zinc-400">{task.handedOverByName ? 'Handed over by' : 'Given by'}</dt>
                                    <dd className="flex items-center gap-1.5 font-bold text-zinc-900 dark:text-zinc-100"><ArrowRightLeft className="h-3.5 w-3.5 text-zinc-400" aria-hidden="true" />{task.handedOverByName || task.assignedByName}</dd>
                                </>)}
                                {task.createdAt && (<>
                                    <dt className="font-semibold text-zinc-500 dark:text-zinc-400">Assigned</dt>
                                    <dd className="font-bold text-zinc-900 dark:text-zinc-100">{shortDateTime(task.createdAt)}</dd>
                                </>)}
                                <dt className="font-semibold text-zinc-500 dark:text-zinc-400">Task date</dt>
                                <dd className="font-bold text-zinc-900 dark:text-zinc-100">{shortDate(task.assignedDate)}{task.isCarriedForward ? ' (carried forward)' : ''}</dd>
                                {task.status === 'completed' && task.completedAt && (<>
                                    <dt className="font-semibold text-zinc-500 dark:text-zinc-400">Done</dt>
                                    <dd className="font-bold text-zinc-900 dark:text-zinc-100">{shortDateTime(task.completedAt)}</dd>
                                </>)}
                            </dl>

                            {/* Move it (the two moves that make sense from its column) */}
                            {task.canChange && (
                                <div className="flex flex-wrap gap-2 border-t border-zinc-100 pt-4 dark:border-zinc-800">
                                    {MOVES[task.status].map(m => (
                                        <button key={m.to} type="button" onClick={() => onMove(task.id, m.to)} className={`flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-black transition-colors ${MOVE_STYLE[m.to]}`}>
                                            {MOVE_ICON[m.to]} {m.label}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    </>
    );
}
