'use client';

import React, { useState } from 'react';
import { CalendarDays, ChevronDown } from 'lucide-react';
import { localDay, shiftDay } from '../DateRangePicker';
import MonthCalendar, { niceDay } from './MonthCalendar';
import { ResponsivePopover } from './Sheet';

/** "Today", "Tomorrow" or "Mon 26 Oct". */
export const dueLabel = (iso: string) => (iso === localDay() ? 'Today' : iso === shiftDay(localDay(), 1) ? 'Tomorrow' : niceDay(iso));

const nextMonday = () => { const t = localDay(); const dow = new Date(`${t}T12:00:00`).getDay(); return shiftDay(t, ((8 - dow) % 7) || 7); };

const chip = (on: boolean) => `min-h-9 rounded-full px-3 text-[13px] font-semibold ${on ? 'border border-indigo-500 bg-indigo-50 text-indigo-900 dark:bg-indigo-950/50 dark:text-indigo-200' : 'border border-zinc-200 text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800'}`;

/** The day a new task is for: quick picks plus a one-month calendar. Past days are off. */
export default function DueDatePicker({ value, onChange, id }: { value: string; onChange: (iso: string) => void; id?: string }) {
    const [open, setOpen] = useState(false);
    const today = localDay();
    const presets: Array<[string, string]> = [['Today', today], ['Tomorrow', shiftDay(today, 1)], ['Next Monday', nextMonday()]];
    return (
        <div className="relative">
            <button id={id} type="button" onClick={() => setOpen(o => !o)} aria-haspopup="dialog" aria-expanded={open}
                className={`flex min-h-11 w-full items-center gap-2 rounded-xl border bg-white px-3 text-sm font-semibold text-zinc-900 shadow-[0_1px_2px_rgba(24,24,27,0.04)] transition-colors dark:bg-zinc-900 dark:text-zinc-100 ${open ? 'border-indigo-500 ring-[3px] ring-indigo-100 dark:ring-indigo-950' : 'border-zinc-200 hover:border-zinc-300 dark:border-zinc-700 dark:hover:border-zinc-600'}`}>
                <CalendarDays className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
                <span className="flex-1 text-left">{dueLabel(value)}</span>
                <ChevronDown className="h-3.5 w-3.5 text-zinc-500" />
            </button>
            <ResponsivePopover open={open} onClose={() => setOpen(false)} title="Choose a date" align="right"
                footer={
                    <div className="flex items-center justify-between">
                        <span className="text-[13px] text-zinc-600 dark:text-zinc-400">Due {niceDay(value)}</span>
                        <button type="button" onClick={() => setOpen(false)} className="min-h-9 rounded-xl bg-indigo-600 px-4 text-sm font-bold text-white hover:bg-indigo-700">Done</button>
                    </div>
                }>
                <div className="space-y-3">
                    <div className="flex flex-wrap gap-1.5">
                        {presets.map(([label, iso]) => (
                            <button key={label} type="button" aria-pressed={value === iso} onClick={() => onChange(iso)} className={chip(value === iso)}>{label}</button>
                        ))}
                    </div>
                    <MonthCalendar from={value} onPick={onChange} isDisabled={iso => iso < today} minMonth={today.slice(0, 7)} />
                </div>
            </ResponsivePopover>
        </div>
    );
}

/** The phone version inside the Assign panel: three big choices, and the calendar opens right below "Pick a date". */
export function DueDateChoices({ value, onChange }: { value: string; onChange: (iso: string) => void }) {
    const today = localDay();
    const tomorrow = shiftDay(today, 1);
    const custom = value !== today && value !== tomorrow;
    const [picking, setPicking] = useState(custom);
    const big = (on: boolean) => `min-h-11 flex-1 rounded-xl px-2 text-sm font-semibold ${on ? 'border border-indigo-500 bg-indigo-50 text-indigo-900 dark:bg-indigo-950/50 dark:text-indigo-200' : 'border border-zinc-200 text-zinc-700 dark:border-zinc-700 dark:text-zinc-300'}`;
    return (
        <div className="space-y-2">
            <div className="flex gap-2">
                <button type="button" aria-pressed={!picking && value === today} onClick={() => { setPicking(false); onChange(today); }} className={big(!picking && value === today)}>Today</button>
                <button type="button" aria-pressed={!picking && value === tomorrow} onClick={() => { setPicking(false); onChange(tomorrow); }} className={big(!picking && value === tomorrow)}>Tomorrow</button>
                <button type="button" aria-pressed={picking} onClick={() => { if (!picking) onChange(tomorrow); setPicking(true); }} className={big(picking)}>{picking ? niceDay(value) : 'Pick a date'}</button>
            </div>
            {picking && (
                <div className="rounded-2xl border border-zinc-200 p-3 dark:border-zinc-700">
                    <MonthCalendar from={value} onPick={onChange} isDisabled={iso => iso < today} minMonth={today.slice(0, 7)} />
                </div>
            )}
        </div>
    );
}
