'use client';

import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, Check, CornerDownRight, FileText, Loader2, Paperclip, X } from 'lucide-react';
import { ATTACH_ACCEPT, ATTACH_MAX_BYTES, EASE, WAssignable, WDuplicate, avatarGradient, fileSizeLabel, initials, shortDate } from './types';
import { submitsOnEnter, useGrowingTextarea } from './textInput';
import { DuePicker, DueValue, dueBody } from './due';

export interface NewTaskInput {
    targetUserIds: string[];
    title: string;
    description: string;
    date: string;
    followUpOf?: string | null;
    files: File[];
    dueDate?: string | null;
    dueTime?: string | null;
}

const MAX_FILES = 5;

/**
 * "New task" dialog. People are shown as faces to tap (not a dropdown), the first being "me".
 * Only people the server says this person may assign to are offered.
 * Owner 2026-10-26: several people can be picked (each gets their own copy and finishes it separately), files can be
 * attached, it can be a follow-up of another task, and a similar open task is shown before anything is saved.
 */
export default function TaskDialog({ open, assignable, defaultTarget, date, followUp, onClose, onSubmit, onCheckDuplicates, dueDates = false }: {
    open: boolean;
    assignable: WAssignable[];
    defaultTarget: string | null;
    date: string;
    /** Owner 2026-10-26: set when this is "Create follow-up" from another task. */
    followUp?: { id: string; title: string } | null;
    onClose: () => void;
    onSubmit: (input: NewTaskInput) => Promise<boolean>;
    /** Owner 2026-10-26: the "Duplicate task alert". Absent → no check. */
    onCheckDuplicates?: (targetUserIds: string[], title: string) => Promise<WDuplicate[]>;
    /** Owner 2026-10-27: the "Due dates" switch is ON for this person's team. */
    dueDates?: boolean;
}) {
    const [targets, setTargets] = useState<string[]>([]);
    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [when, setWhen] = useState(date);
    const [due, setDue] = useState<DueValue | null>(null);
    const [files, setFiles] = useState<File[]>([]);
    const [fileError, setFileError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [duplicates, setDuplicates] = useState<WDuplicate[] | null>(null);
    const { ref: titleRef, grow: growTitle } = useGrowingTextarea();
    const fileRef = useRef<HTMLInputElement>(null);

    // Reset every time it opens
    useEffect(() => {
        if (!open) return;
        const preset = defaultTarget && assignable.some(a => a.userId === defaultTarget) ? defaultTarget : null;
        const first = preset || assignable.find(a => a.isMe)?.userId || assignable[0]?.userId;
        setTargets(first ? [first] : []);
        setTitle(''); setDescription(''); setWhen(date); setDue(null); setBusy(false);
        setFiles([]); setFileError(null); setDuplicates(null);
        const t = setTimeout(() => titleRef.current?.focus(), 80);
        return () => clearTimeout(t);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [open, onClose]);

    const nameOf = (id: string) => {
        const a = assignable.find(x => x.userId === id);
        return a ? (a.isMe ? 'you' : a.name.split(' ')[0]) : 'someone';
    };
    const toggle = (id: string) => setTargets(list => (list.includes(id) ? list.filter(x => x !== id) : [...list, id]));

    const save = async (forUserIds: string[]) => {
        if (!forUserIds.length) return;
        setBusy(true);
        const ok = await onSubmit({ targetUserIds: forUserIds, title: title.trim(), description: description.trim(), date: when, followUpOf: followUp?.id ?? null, files, ...(dueDates ? dueBody(due) : {}) });
        setBusy(false);
        if (ok) onClose();
    };

    const submit = async (e?: React.FormEvent) => {
        e?.preventDefault();
        if (!title.trim() || targets.length === 0 || busy) return;
        if (onCheckDuplicates) {
            setBusy(true);
            const found = await onCheckDuplicates(targets, title.trim());
            setBusy(false);
            if (found.length) { setDuplicates(found); return; }
        }
        await save(targets);
    };

    const pickFiles = (list: FileList | null) => {
        if (!list) return;
        const picked = Array.from(list);
        const tooBig = picked.filter(f => f.size > ATTACH_MAX_BYTES);
        const ok = picked.filter(f => f.size > 0 && f.size <= ATTACH_MAX_BYTES);
        const next = [...files, ...ok].slice(0, MAX_FILES);
        setFiles(next);
        setFileError(tooBig.length ? `${tooBig.map(f => f.name).join(', ')}: larger than 10 MB` : files.length + ok.length > MAX_FILES ? `At most ${MAX_FILES} files` : null);
        if (fileRef.current) fileRef.current.value = '';
    };

    const field = 'mt-1.5 w-full rounded-xl border border-zinc-300 bg-white px-3.5 py-2.5 text-sm text-zinc-900 outline-none transition-colors placeholder:text-zinc-400 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100';
    const label = 'text-[10px] font-black uppercase tracking-widest text-zinc-500';
    const clashIds = new Set((duplicates || []).map(d => d.userId));
    const clear = targets.filter(id => !clashIds.has(id));

    return (
        <AnimatePresence>
            {open && (
                <motion.div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
                    {/* fixed, not absolute: the window scrolls when it is taller than the screen, and the dimmed
                        background must stay put instead of scrolling away with it */}
                    <div className="fixed inset-0 bg-zinc-950/50 backdrop-blur-[2px]" onClick={onClose} aria-hidden="true" />
                    <motion.form
                        onSubmit={submit}
                        role="dialog" aria-modal="true" aria-labelledby="task-dialog-title"
                        className="relative my-auto w-full max-w-md space-y-5 rounded-3xl border border-zinc-200 bg-white p-6 shadow-2xl dark:border-zinc-800 dark:bg-zinc-900"
                        initial={{ opacity: 0, scale: 0.94, y: 12 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96, y: 8 }}
                        transition={{ duration: 0.4, ease: EASE }}
                    >
                        <div className="flex items-center justify-between">
                            <h3 id="task-dialog-title" className="text-lg font-black text-zinc-900 dark:text-zinc-100">{followUp ? 'Follow-up task' : 'New task'}</h3>
                            <button type="button" onClick={onClose} aria-label="Close" className="rounded-full p-2 text-zinc-500 transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800"><X className="h-5 w-5" /></button>
                        </div>

                        {duplicates ? (
                            /* Owner 2026-10-26: "Duplicate task alert" — nothing is saved until a choice is made */
                            <div className="space-y-4">
                                <div className="flex items-start gap-3 rounded-2xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-800/60 dark:bg-amber-950/30">
                                    <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" aria-hidden="true" />
                                    <div className="space-y-1">
                                        <p className="text-sm font-black text-amber-900 dark:text-amber-200">
                                            {duplicates.length === 1 ? `${duplicates[0].name.split(' ')[0]} already has a similar open task` : 'Some people already have a similar open task'}
                                        </p>
                                        <p className="text-xs font-semibold text-amber-800 dark:text-amber-300">Nothing is saved yet. Check before adding another one.</p>
                                    </div>
                                </div>
                                <ul className="space-y-2">
                                    {duplicates.map(d => (
                                        <li key={d.userId} className="rounded-2xl border border-zinc-200 px-4 py-3 dark:border-zinc-700">
                                            <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500">{d.name}</p>
                                            <p className="mt-1 whitespace-pre-line break-words text-sm font-bold text-zinc-900 dark:text-zinc-100">{d.title ?? 'A similar task is already open.'}</p>
                                            <p className="mt-0.5 text-xs text-zinc-500">Open since {shortDate(d.assignedDate)}</p>
                                        </li>
                                    ))}
                                </ul>
                                <div className="flex flex-col gap-2">
                                    {clear.length > 0 && (
                                        <button type="button" disabled={busy} onClick={() => save(clear)} className="flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-black text-white hover:bg-indigo-700 disabled:opacity-50">
                                            {busy && <Loader2 className="h-4 w-4 animate-spin" />} Add for {clear.map(nameOf).join(', ')} only
                                        </button>
                                    )}
                                    <button type="button" disabled={busy} onClick={() => save(targets)} className="flex items-center justify-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm font-black text-amber-900 hover:bg-amber-100 disabled:opacity-50 dark:border-amber-800/60 dark:bg-amber-950/30 dark:text-amber-200">
                                        {busy && clear.length === 0 && <Loader2 className="h-4 w-4 animate-spin" />} {targets.length === 1 ? 'Add anyway' : 'Add for everyone anyway'}
                                    </button>
                                    <button type="button" disabled={busy} onClick={() => setDuplicates(null)} className="rounded-xl border border-zinc-300 px-4 py-2.5 text-sm font-bold text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800">Go back and edit</button>
                                </div>
                            </div>
                        ) : (<>
                            {followUp && (
                                <p className="flex items-start gap-2 rounded-xl bg-sky-50 px-3 py-2 text-xs font-bold text-sky-800 dark:bg-sky-950/40 dark:text-sky-200">
                                    <CornerDownRight className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                                    <span className="min-w-0 break-words">Follow-up of “{followUp.title}”</span>
                                </p>
                            )}

                            {assignable.length > 1 && (
                                <div>
                                    <p className={label}>
                                        For{targets.length > 1 && <span className="ml-1.5 normal-case tracking-normal text-indigo-700 dark:text-indigo-300">· {targets.length} people, each gets their own copy</span>}
                                    </p>
                                    <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Who is this task for">
                                        {assignable.map(a => {
                                            const on = targets.includes(a.userId);
                                            return (
                                                <button
                                                    key={a.userId} type="button" onClick={() => toggle(a.userId)} aria-pressed={on}
                                                    className={`flex items-center gap-2 rounded-full border py-1 pl-1 pr-3 text-xs font-bold transition-all ${on ? 'border-indigo-500 bg-indigo-50 text-indigo-800 shadow-sm dark:bg-indigo-950/50 dark:text-indigo-200' : 'border-zinc-200 text-zinc-600 hover:border-zinc-300 dark:border-zinc-700 dark:text-zinc-300'}`}
                                                >
                                                    <span className={`flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-br ${avatarGradient(a.name)} text-[9px] font-black text-white`}>{initials(a.name)}</span>
                                                    {a.isMe ? 'Me' : a.name.split(' ')[0]}
                                                    {on && <Check className="h-3.5 w-3.5 text-indigo-600" aria-hidden="true" />}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}

                            <label className="block">
                                <span className={label}>Task</span>
                                {/* Owner 2026-10-26: wraps and grows as you type; Enter adds, Shift+Enter starts a new line */}
                                <textarea
                                    id="task-title" ref={titleRef} required rows={1} maxLength={200} value={title}
                                    onChange={e => { setTitle(e.target.value); growTitle(); }}
                                    onKeyDown={e => { if (submitsOnEnter(e)) { e.preventDefault(); void submit(); } }}
className={`${field} max-h-40 resize-none overflow-y-auto`}
                                />
                            </label>

                            <label className="block">
                                <span className={label}>Note (optional)</span>
                                <textarea id="task-details" rows={3} maxLength={1000} value={description} onChange={e => setDescription(e.target.value)} className={`${field} resize-none`} />
                            </label>

                            <label className="block">
                                <span className={label}>{dueDates ? 'Start date' : 'Date'}</span>
                                <input id="task-date" type="date" value={when} onChange={e => setWhen(e.target.value || date)} className={field} />
                            </label>

                            {dueDates && <DuePicker start={when} value={due} onChange={setDue} idPrefix="task" />}

                            {/* Owner 2026-10-26: documents or screenshots, attached to every copy */}
                            <div>
                                <p className={label}>Files (optional)</p>
                                {files.length > 0 && (
                                    <ul className="mt-2 space-y-1.5">
                                        {files.map((f, i) => (
                                            <li key={`${f.name}-${i}`} className="flex items-center gap-2 rounded-xl border border-zinc-200 px-3 py-2 text-xs font-bold text-zinc-800 dark:border-zinc-700 dark:text-zinc-100">
                                                <FileText className="h-4 w-4 shrink-0 text-indigo-600" aria-hidden="true" />
                                                <span className="min-w-0 flex-1 truncate">{f.name}</span>
                                                <span className="shrink-0 font-semibold text-zinc-500">{fileSizeLabel(f.size)}</span>
                                                <button type="button" aria-label={`Remove ${f.name}`} onClick={() => setFiles(list => list.filter((_, j) => j !== i))} className="shrink-0 rounded-md p-0.5 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"><X className="h-3.5 w-3.5" /></button>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                                {files.length < MAX_FILES && (
                                    <>
                                        <input ref={fileRef} id="task-files" type="file" multiple accept={ATTACH_ACCEPT} className="sr-only" onChange={e => pickFiles(e.target.files)} />
                                        <label htmlFor="task-files" className="mt-2 flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-zinc-300 bg-zinc-50 px-3 py-2.5 text-xs font-bold text-zinc-600 transition-colors hover:border-indigo-300 hover:bg-indigo-50/50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
                                            <Paperclip className="h-4 w-4" aria-hidden="true" /> Attach document or screenshot
                                        </label>
                                    </>
                                )}
                                {fileError && <p className="mt-1.5 text-xs font-semibold text-rose-600">{fileError}</p>}
                            </div>

                            <div className="flex gap-2 pt-1">
                                <button type="button" onClick={onClose} className="flex-1 rounded-xl border border-zinc-300 px-4 py-2.5 text-sm font-bold text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800">Cancel</button>
                                <button type="submit" disabled={busy || !title.trim() || targets.length === 0} className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-black text-white transition-colors hover:bg-indigo-700 disabled:opacity-50">
                                    {busy && <Loader2 className="h-4 w-4 animate-spin" />} {busy ? 'Adding' : targets.length > 1 ? `Add for ${targets.length} people` : 'Add task'}
                                </button>
                            </div>
                        </>)}
                    </motion.form>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
