'use client';

import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, Loader2, X } from 'lucide-react';
import { EASE, WTask } from './types';

/**
 * Owner 2026-10-26: the optional remark on a finished task — what was done, or why part of it is still pending. It only
 * opens when someone asks for it ("Add remark" on the message after marking done, or on a finished card), never on its
 * own. Saved like a note; the person who gave the task is told in the app.
 */
export default function RemarkDialog({ task, onClose, onSave, completing, onSkip }: {
    task: WTask | null;
    onClose: () => void;
    onSave: (taskId: string, remark: string) => Promise<boolean>;
    /** Owner 2026-10-28: shown BEFORE marking done — 'ask' offers Skip, 'required' does not. Absent = a finished task. */
    completing?: 'ask' | 'required';
    /** 'ask' only: mark it done without a remark. */
    onSkip?: (taskId: string) => void;
}) {
    useEffect(() => {
        if (!task) return;
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [task, onClose]);

    return (
        <AnimatePresence>
            {task && (
                <motion.div className="fixed inset-0 z-[60] flex items-center justify-center p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
                    <div className="absolute inset-0 bg-zinc-950/50 backdrop-blur-[2px]" onClick={onClose} aria-hidden="true" />
                    {/* keyed by task: an empty box for every task */}
                    <RemarkForm key={task.id} task={task} onClose={onClose} onSave={onSave} completing={completing} onSkip={onSkip} />
                </motion.div>
            )}
        </AnimatePresence>
    );
}

function RemarkForm({ task, onClose, onSave, completing, onSkip }: {
    task: WTask; onClose: () => void; onSave: (taskId: string, remark: string) => Promise<boolean>;
    completing?: 'ask' | 'required'; onSkip?: (taskId: string) => void;
}) {
    const [remark, setRemark] = useState(completing ? '' : task.completionRemark || '');
    const [saving, setSaving] = useState(false);

    const save = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!remark.trim() || saving) return;
        setSaving(true);
        const ok = await onSave(task.id, remark.trim());
        setSaving(false);
        if (ok) onClose();
    };

    return (
                    <motion.form
                        onSubmit={save} role="dialog" aria-modal="true" aria-labelledby="remark-dialog-title"
                        className="relative w-full max-w-md space-y-4 rounded-3xl border border-zinc-200 bg-white p-6 shadow-2xl dark:border-zinc-800 dark:bg-zinc-900"
                        initial={{ opacity: 0, scale: 0.94, y: 12 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96, y: 8 }}
                        transition={{ duration: 0.4, ease: EASE }}
                    >
                        <div className="flex items-start gap-3">
                            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white"><Check className="h-4 w-4" strokeWidth={3} /></span>
                            <div className="min-w-0 flex-1">
                                <h3 id="remark-dialog-title" className="text-lg font-black text-zinc-900 dark:text-zinc-100">{completing ? 'Mark as done' : task.completionRemark ? 'Edit the remark' : 'Add a remark'}</h3>
                                <p className="truncate text-xs font-semibold text-zinc-500">{task.title}</p>
                            </div>
                            <button type="button" onClick={onClose} aria-label="Close" className="rounded-full p-2 text-zinc-500 transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800"><X className="h-5 w-5" /></button>
                        </div>
                        <label className="block">
                            <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500">
                                What was done, or why part of it is pending{completing === 'required' ? '' : <span className="normal-case tracking-normal font-semibold text-zinc-400"> (optional)</span>}
                            </span>
                            <textarea
                                autoFocus value={remark} onChange={e => setRemark(e.target.value)} maxLength={300} rows={4}
                                className="mt-1.5 w-full resize-y rounded-xl border border-zinc-300 bg-white px-3.5 py-2.5 text-sm text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                            />
                        </label>
                        {completing === 'required' && <p className="-mt-2 text-[11px] font-semibold text-zinc-500">Your team asks for a remark before a task is marked done.</p>}
                        <div className="flex gap-2">
                            {completing === 'ask' && onSkip ? (
                                <button type="button" onClick={() => { onSkip(task.id); onClose(); }} disabled={saving} className="flex-1 rounded-xl border border-zinc-300 px-4 py-2.5 text-sm font-bold text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800">Skip</button>
                            ) : (
                                <button type="button" onClick={onClose} disabled={saving} className="flex-1 rounded-xl border border-zinc-300 px-4 py-2.5 text-sm font-bold text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800">{completing ? 'Cancel' : 'Not now'}</button>
                            )}
                            <button type="submit" disabled={saving || !remark.trim()} className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-black text-white hover:bg-emerald-700 disabled:opacity-50">
                                {saving && <Loader2 className="h-4 w-4 animate-spin" />} {completing ? 'Mark as done' : 'Save remark'}
                            </button>
                        </div>
                    </motion.form>
    );
}
