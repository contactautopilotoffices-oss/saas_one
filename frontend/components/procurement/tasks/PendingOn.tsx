'use client';

import React, { useState } from 'react';
import { Check, Hourglass, Loader2, X } from 'lucide-react';

/**
 * "Pending on…" (owner 2026-10-19) on one of MY open tasks: pick a colleague, confirm, and they are told this task is
 * waiting on them (in the app and on WhatsApp). The task stays mine and they still cannot see my board.
 * Same shape as "Give to…": everything opens inside the card, and no click here may start a drag.
 */
export default function PendingOn({ taskTitle, people, onFlag }: {
    taskTitle: string;
    people: Array<{ userId: string; name: string }>;
    onFlag: (userId: string, name: string) => Promise<boolean>;
}) {
    const [step, setStep] = useState<'closed' | 'pick' | 'confirm'>('closed');
    const [chosen, setChosen] = useState<{ userId: string; name: string } | null>(null);
    const [busy, setBusy] = useState(false);

    const stop = (e: React.SyntheticEvent) => e.stopPropagation();
    const reset = () => { setStep('closed'); setChosen(null); };

    const confirm = async () => {
        if (!chosen || busy) return;
        setBusy(true);
        await onFlag(chosen.userId, chosen.name);
        setBusy(false);
        reset();
    };

    if (step === 'closed') {
        return (
            <span onMouseDown={stop} onPointerDown={stop} onTouchStart={stop} onKeyDown={stop} onClick={stop}>
                <button
                    type="button"
                    onClick={() => setStep('pick')}
                    className="flex items-center gap-1.5 rounded-lg px-1.5 py-1 text-[11px] font-bold text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-amber-700 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-amber-300"
                    aria-label={`Tell a colleague that "${taskTitle}" is pending on them`}
                >
                    <Hourglass className="h-3.5 w-3.5" aria-hidden="true" /> Pending on…
                </button>
            </span>
        );
    }

    return (
        <div
            className="mt-2 w-full basis-full"
            onMouseDown={stop} onPointerDown={stop} onTouchStart={stop} onKeyDown={stop} onClick={stop}
        >
            {step === 'pick' && (
                <div role="group" aria-label="Choose who this task is pending on">
                    <div className="mb-1.5 flex items-center justify-between">
                        <p className="text-[11px] font-black text-zinc-700 dark:text-zinc-200">Pending on who?</p>
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
                                className="rounded-full border border-zinc-200 bg-white px-2.5 py-1 text-[11px] font-bold text-zinc-700 transition-colors hover:border-amber-300 hover:bg-amber-50 hover:text-amber-800 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-amber-950/40"
                            >
                                {p.name}
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {step === 'confirm' && chosen && (
                <div role="alertdialog" aria-label={`Confirm telling ${chosen.name}`}>
                    <p className="text-[11px] font-bold leading-snug text-zinc-700 dark:text-zinc-200">
                        Tell <span className="text-amber-700 dark:text-amber-300">{chosen.name}</span> this task is pending on them?
                        <span className="block font-medium text-zinc-500 dark:text-zinc-400">The task stays with you. They get a notification and a WhatsApp message.</span>
                    </p>
                    <div className="mt-2 flex items-center gap-2">
                        <button
                            type="button"
                            disabled={busy}
                            onClick={confirm}
                            className="flex items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-1.5 text-[11px] font-black text-white transition-colors hover:bg-amber-700 disabled:opacity-60"
                        >
                            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Notify
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
