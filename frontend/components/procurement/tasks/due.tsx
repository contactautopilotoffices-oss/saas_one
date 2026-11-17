'use client';

import React, { useSyncExternalStore } from 'react';
import { AlarmClock, CalendarClock, CheckCircle2 } from 'lucide-react';
import { TaskDue, DueTone, addDueDays, daysBetween, doneDueStatus, dueLabel, openDueStatus } from '@/task-manager/dueDates';
import type { WTask } from './types';

/**
 * Owner 2026-10-27: due dates on screen — the picker (New task, Edit, Send tab), the countdown on open cards and the
 * on-time / late label on finished ones. Shown only for tasks that have a deadline; older tasks look exactly as before.
 */

/* ── One shared clock for every card (ticks every 30 s), instead of a timer per card ─────────────────── */
const TICK = 30_000;
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | undefined;
function subscribe(cb: () => void) {
    listeners.add(cb);
    if (!timer) timer = setInterval(() => listeners.forEach(l => l()), TICK);
    return () => {
        listeners.delete(cb);
        if (listeners.size === 0 && timer) { clearInterval(timer); timer = undefined; }
    };
}
const snapshot = () => Math.floor(Date.now() / TICK);
export function useNow(): number {
    return useSyncExternalStore(subscribe, snapshot, snapshot) * TICK;
}

/** The card's due tone right now (null = no deadline, or finished). */
export function dueToneOf(task: WTask, now: number): DueTone | null {
    if (!task.due || task.status === 'completed') return null;
    return openDueStatus(task.due, task.assignedDate, now).tone;
}

const TONE_CHIP: Record<DueTone, string> = {
    late: 'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300',
    soon: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
    ok: 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300',
};
const chip = 'flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-black';

/** Countdown (open) or on-time / late (finished). Nothing for a task without a deadline. */
export function DueChips({ task, now }: { task: WTask; now: number }) {
    if (!task.due) return null;
    if (task.status === 'completed') {
        if (!task.completedAt) return null;
        const s = doneDueStatus(task.due, task.completedAt);
        return (
            <span className={`${chip} ${s.onTime ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300' : TONE_CHIP.late}`} title={`Due ${dueLabel(task.due)}`}>
                <CheckCircle2 className="h-3 w-3" aria-hidden="true" /> {s.label}
            </span>
        );
    }
    const s = openDueStatus(task.due, task.assignedDate, now);
    return (
        <>
            <span className={`${chip} ${TONE_CHIP[s.tone]}`} title={`Due ${dueLabel(task.due)}`}>
                {s.tone === 'ok' ? <CalendarClock className="h-3 w-3" aria-hidden="true" /> : <AlarmClock className="h-3 w-3" aria-hidden="true" />} {s.label}
            </span>
            {s.dayOf && <span className={`${chip} bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300`}>Day {s.dayOf.n} of {s.dayOf.total}</span>}
        </>
    );
}

/* ── The picker ──────────────────────────────────────────────────────────────────────────────────────── */

/** What the picker holds: a date, and a time or '' (end of day). null = no deadline. */
export interface DueValue { date: string; time: string }

export const dueValueOf = (due: TaskDue | null | undefined): DueValue | null => (due ? { date: due.date, time: due.time ?? '' } : null);

const QUICK: Array<{ label: string; days: number }> = [
    { label: 'Today', days: 0 },
    { label: 'Tomorrow', days: 1 },
    { label: 'In 2 days', days: 2 },
    { label: 'In a week', days: 7 },
];

/**
 * "Due by (optional)": quick picks counted from the start date, "Pick a date" for anything else, and an optional time.
 * `start` is the task's start date; the deadline cannot be before it (the server checks too).
 */
export function DuePicker({ start, value, onChange, idPrefix }: { start: string; value: DueValue | null; onChange: (v: DueValue | null) => void; idPrefix: string }) {
    const [picking, setPicking] = React.useState(false);
    const quickHit = value ? QUICK.find(q => addDueDays(start, q.days) === value.date) : undefined;
    const custom = !!value && (picking || !quickHit);
    const pill = (on: boolean) => `rounded-full border px-3 py-1.5 text-xs font-bold transition-colors ${on
        ? 'border-indigo-400 bg-indigo-50 text-indigo-800 dark:border-indigo-500 dark:bg-indigo-950/50 dark:text-indigo-200'
        : 'border-zinc-200 text-zinc-600 hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800'}`;
    const field = 'w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none transition-colors focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100';
    const span = value ? daysBetween(start, value.date) + 1 : 0;

    return (
        <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500">
                Due by <span className="normal-case tracking-normal font-semibold text-zinc-400">(optional)</span>
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5" role="radiogroup" aria-label="Due by">
                <button type="button" role="radio" aria-checked={!value} onClick={() => { setPicking(false); onChange(null); }} className={pill(!value)}>No deadline</button>
                {QUICK.map(q => {
                    const on = !!value && !custom && quickHit === q;
                    return (
                        <button key={q.label} type="button" role="radio" aria-checked={on} className={pill(on)}
                            onClick={() => { setPicking(false); onChange({ date: addDueDays(start, q.days), time: value?.time ?? '' }); }}>
                            {q.label}
                        </button>
                    );
                })}
                <button type="button" role="radio" aria-checked={custom} className={pill(custom)}
                    onClick={() => { setPicking(true); onChange({ date: value?.date ?? addDueDays(start, 1), time: value?.time ?? '' }); }}>
                    Pick a date
                </button>
            </div>
            {value && (
                <>
                    <div className="mt-2.5 grid grid-cols-2 gap-2">
                        <label className="block">
                            <span className="sr-only">Due date</span>
                            <input id={`${idPrefix}-due-date`} type="date" min={start} value={value.date} disabled={!custom}
                                onChange={e => e.target.value && onChange({ ...value, date: e.target.value })} className={`${field} disabled:bg-zinc-50 disabled:text-zinc-500 dark:disabled:bg-zinc-800/60`} />
                        </label>
                        <label className="block">
                            <span className="sr-only">Due time (optional)</span>
                            <input id={`${idPrefix}-due-time`} type="time" value={value.time}
                                onChange={e => onChange({ ...value, time: e.target.value })} className={field} />
                        </label>
                    </div>
                    <p className={`mt-1.5 text-xs font-semibold ${value.date < start ? 'text-rose-600' : 'text-zinc-500'}`}>
                        {value.date < start
                            ? 'The due date is before the start date.'
                            : `${dueLabel({ date: value.date, time: value.time || null })} · ${span === 1 ? 'same day' : `takes ${span} days`}. Leave the time empty for end of day.`}
                    </p>
                </>
            )}
        </div>
    );
}

/** What to send to the server: `{ dueDate, dueTime }`. With `clear`, "no deadline" is sent as null (Edit). */
export function dueBody(value: DueValue | null, clear = false): { dueDate?: string | null; dueTime?: string | null } {
    if (value) return { dueDate: value.date, dueTime: value.time || null };
    return clear ? { dueDate: null, dueTime: null } : {};
}
