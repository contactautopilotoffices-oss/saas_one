'use client';

import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Loader2, X } from 'lucide-react';
import { EASE, WAssignable, avatarGradient, initials } from './types';

/**
 * "New task" dialog. People are shown as faces to tap (not a dropdown), the first being "me".
 * Only people the server says this person may assign to are offered.
 */
export default function TaskDialog({ open, assignable, defaultTarget, date, onClose, onSubmit }: {
    open: boolean;
    assignable: WAssignable[];
    defaultTarget: string | null;
    date: string;
    onClose: () => void;
    onSubmit: (input: { targetUserId: string; title: string; description: string; date: string }) => Promise<boolean>;
}) {
    const [target, setTarget] = useState('');
    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [when, setWhen] = useState(date);
    const [busy, setBusy] = useState(false);
    const titleRef = useRef<HTMLInputElement>(null);

    // Reset every time it opens
    useEffect(() => {
        if (!open) return;
        setTarget(defaultTarget || assignable.find(a => a.isMe)?.userId || assignable[0]?.userId || '');
        setTitle(''); setDescription(''); setWhen(date); setBusy(false);
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

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!title.trim() || !target || busy) return;
        setBusy(true);
        const ok = await onSubmit({ targetUserId: target, title: title.trim(), description: description.trim(), date: when });
        setBusy(false);
        if (ok) onClose();
    };

    const field = 'mt-1.5 w-full rounded-xl border border-zinc-300 bg-white px-3.5 py-2.5 text-sm text-zinc-900 outline-none transition-colors placeholder:text-zinc-400 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100';
    const label = 'text-[10px] font-black uppercase tracking-widest text-zinc-500';

    return (
        <AnimatePresence>
            {open && (
                <motion.div className="fixed inset-0 z-50 flex items-center justify-center p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
                    <div className="absolute inset-0 bg-zinc-950/50 backdrop-blur-[2px]" onClick={onClose} aria-hidden="true" />
                    <motion.form
                        onSubmit={submit}
                        role="dialog" aria-modal="true" aria-labelledby="task-dialog-title"
                        className="relative w-full max-w-md space-y-5 rounded-3xl border border-zinc-200 bg-white p-6 shadow-2xl dark:border-zinc-800 dark:bg-zinc-900"
                        initial={{ opacity: 0, scale: 0.94, y: 12 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96, y: 8 }}
                        transition={{ duration: 0.4, ease: EASE }}
                    >
                        <div className="flex items-center justify-between">
                            <h3 id="task-dialog-title" className="text-lg font-black text-zinc-900 dark:text-zinc-100">New task</h3>
                            <button type="button" onClick={onClose} aria-label="Close" className="rounded-full p-2 text-zinc-500 transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800"><X className="h-5 w-5" /></button>
                        </div>

                        {assignable.length > 1 && (
                            <div>
                                <p className={label}>For</p>
                                <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Who is this task for">
                                    {assignable.map(a => {
                                        const on = a.userId === target;
                                        return (
                                            <button
                                                key={a.userId} type="button" onClick={() => setTarget(a.userId)} aria-pressed={on}
                                                className={`flex items-center gap-2 rounded-full border py-1 pl-1 pr-3 text-xs font-bold transition-all ${on ? 'border-indigo-500 bg-indigo-50 text-indigo-800 shadow-sm dark:bg-indigo-950/50 dark:text-indigo-200' : 'border-zinc-200 text-zinc-600 hover:border-zinc-300 dark:border-zinc-700 dark:text-zinc-300'}`}
                                            >
                                                <span className={`flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-br ${avatarGradient(a.name)} text-[9px] font-black text-white`}>{initials(a.name)}</span>
                                                {a.isMe ? 'Me' : a.name.split(' ')[0]}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        )}

                        <label className="block">
                            <span className={label}>Task</span>
                            <input id="task-title" ref={titleRef} required maxLength={200} value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Call vendor for quotation" className={field} />
                        </label>

                        <label className="block">
                            <span className={label}>Details (optional)</span>
                            <textarea id="task-details" rows={3} maxLength={1000} value={description} onChange={e => setDescription(e.target.value)} placeholder="Site, vendor, anything useful" className={`${field} resize-none`} />
                        </label>

                        <label className="block">
                            <span className={label}>Date</span>
                            <input id="task-date" type="date" value={when} onChange={e => setWhen(e.target.value || date)} className={field} />
                        </label>

                        <div className="flex gap-2 pt-1">
                            <button type="button" onClick={onClose} className="flex-1 rounded-xl border border-zinc-300 px-4 py-2.5 text-sm font-bold text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800">Cancel</button>
                            <button type="submit" disabled={busy || !title.trim() || !target} className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-black text-white transition-colors hover:bg-indigo-700 disabled:opacity-50">
                                {busy && <Loader2 className="h-4 w-4 animate-spin" />} {busy ? 'Adding' : 'Add task'}
                            </button>
                        </div>
                    </motion.form>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
