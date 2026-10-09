'use client';

import React, { useState } from 'react';
import { ArrowRightLeft, Check, Loader2, X } from 'lucide-react';
import { WAssignable } from './types';

/**
 * "Give to…" on a card I hold: pick a teammate, confirm, and the task MOVES to their list (they are told on
 * WhatsApp). Everything opens INSIDE the card, because the card clips anything that floats out of it.
 * Clicks here must never start a drag, so every pointer / key event stops at this wrapper.
 */
export default function GiveTo({ taskTitle, people, onGive }: {
    taskTitle: string;
    people: WAssignable[];
    onGive: (userId: string, name: string) => Promise<boolean>;
}) {
    const [step, setStep] = useState<'closed' | 'pick' | 'confirm'>('closed');
    const [chosen, setChosen] = useState<WAssignable | null>(null);
    const [busy, setBusy] = useState(false);

    const stop = (e: React.SyntheticEvent) => e.stopPropagation();
    const reset = () => { setStep('closed'); setChosen(null); };

    const confirm = async () => {
        if (!chosen || busy) return;
        setBusy(true);
        const ok = await onGive(chosen.userId, chosen.name);
        setBusy(false);
        if (!ok) reset(); // on success the board reloads and this card moves away
    };

    return (
        <div
            className="mt-3 border-t border-zinc-100 pt-2.5 dark:border-zinc-800"
            onMouseDown={stop} onPointerDown={stop} onTouchStart={stop} onKeyDown={stop} onClick={stop}
        >
            {step === 'closed' && (
                <button
                    type="button"
                    onClick={() => setStep('pick')}
                    className="flex items-center gap-1.5 rounded-lg px-1.5 py-1 text-[11px] font-bold text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-indigo-600 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-indigo-300"
                    aria-label={`Give "${taskTitle}" to a teammate`}
                >
                    <ArrowRightLeft className="h-3.5 w-3.5" aria-hidden="true" /> Give to…
                </button>
            )}

            {step === 'pick' && (
                <div role="group" aria-label="Choose a teammate">
                    <div className="mb-1.5 flex items-center justify-between">
                        <p className="text-[11px] font-black text-zinc-700 dark:text-zinc-200">Give to who?</p>
                        <button type="button" onClick={reset} className="rounded-md p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800" aria-label="Cancel">
                            <X className="h-3.5 w-3.5" />
                        </button>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                        {people.map(p => (
                            <button
                                key={p.userId}
                                type="button"
                                onClick={() => { setChosen(p); setStep('confirm'); }}
                                className="rounded-full border border-zinc-200 bg-white px-2.5 py-1 text-[11px] font-bold text-zinc-700 transition-colors hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-indigo-950/40"
                            >
                                {p.name}
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {step === 'confirm' && chosen && (
                <div role="alertdialog" aria-label={`Confirm giving the task to ${chosen.name}`}>
                    <p className="text-[11px] font-bold leading-snug text-zinc-700 dark:text-zinc-200">
                        Give this task to <span className="text-indigo-600 dark:text-indigo-300">{chosen.name}</span>?
                        <span className="block font-medium text-zinc-500 dark:text-zinc-400">It leaves your list, and they get a WhatsApp message.</span>
                    </p>
                    <div className="mt-2 flex items-center gap-2">
                        <button
                            type="button"
                            disabled={busy}
                            onClick={confirm}
                            className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-[11px] font-black text-white transition-colors hover:bg-indigo-700 disabled:opacity-60"
                        >
                            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Give it
                        </button>
                        <button
                            type="button"
                            disabled={busy}
                            onClick={() => setStep('pick')}
                            className="rounded-lg border border-zinc-200 px-3 py-1.5 text-[11px] font-bold text-zinc-600 hover:bg-zinc-100 disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                        >
                            Back
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
