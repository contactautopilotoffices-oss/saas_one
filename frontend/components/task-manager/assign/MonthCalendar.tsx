'use client';

import React, { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { localDay } from '../DateRangePicker';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

const pad = (n: number) => String(n).padStart(2, '0');
const isoOf = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;
const monthKey = (y: number, m: number) => `${y}-${pad(m + 1)}`;

/** "Thu 22 Oct" */
export const niceDay = (iso: string) =>
    new Date(`${iso}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });

/**
 * One month of days, weeks starting on Monday, every day visible at once (no scrolling). Picks one day, or shows a
 * from–to range when `to` is given. `minMonth` / `maxMonth` (YYYY-MM) stop the arrows.
 */
export default function MonthCalendar({ from, to, onPick, isDisabled, minMonth, maxMonth, size = 'md' }: {
    from: string | null; to?: string | null; onPick: (iso: string) => void; isDisabled?: (iso: string) => boolean;
    minMonth?: string; maxMonth?: string; size?: 'md' | 'lg';
}) {
    const start = new Date(`${from || localDay()}T12:00:00`);
    const [view, setView] = useState({ y: start.getFullYear(), m: start.getMonth() });
    const today = localDay();
    const end = to ?? from;

    const lead = (new Date(view.y, view.m, 1).getDay() + 6) % 7;
    const daysIn = new Date(view.y, view.m + 1, 0).getDate();
    const key = monthKey(view.y, view.m);
    const canPrev = !minMonth || key > minMonth;
    const canNext = !maxMonth || key < maxMonth;
    const shift = (n: number) => setView(v => { const d = new Date(v.y, v.m + n, 1); return { y: d.getFullYear(), m: d.getMonth() }; });

    const cell = size === 'lg' ? 'h-11 text-[15px]' : 'h-9 text-sm';
    const arrow = 'flex h-9 w-9 items-center justify-center rounded-xl border border-zinc-200 bg-white text-zinc-600 disabled:cursor-not-allowed disabled:text-zinc-300 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:disabled:text-zinc-600';

    return (
        <div className="space-y-2">
            <div className="flex items-center justify-between">
                <button type="button" onClick={() => shift(-1)} disabled={!canPrev} aria-label="Previous month" className={arrow}><ChevronLeft className="h-4 w-4" /></button>
                <span className="text-sm font-bold">{MONTHS[view.m]} {view.y}</span>
                <button type="button" onClick={() => shift(1)} disabled={!canNext} aria-label="Next month" className={arrow}><ChevronRight className="h-4 w-4" /></button>
            </div>
            <div className="grid grid-cols-7 gap-y-0.5 text-center">
                {WEEKDAYS.map(w => <span key={w} className="pb-1 text-[11px] font-bold text-zinc-500">{w}</span>)}
                {Array.from({ length: lead }, (_, i) => <span key={`blank-${i}`} aria-hidden="true" />)}
                {Array.from({ length: daysIn }, (_, i) => {
                    const iso = isoOf(view.y, view.m, i + 1);
                    const disabled = !!isDisabled?.(iso);
                    const isEnd = iso === from || iso === end;
                    const inside = !!from && !!end && from !== end && iso > from && iso < end;
                    const look = isEnd ? 'rounded-xl bg-indigo-600 font-bold text-white'
                        : inside ? 'bg-indigo-50 font-semibold text-indigo-900 dark:bg-indigo-950/60 dark:text-indigo-200'
                        : disabled ? 'rounded-xl text-zinc-300 dark:text-zinc-600'
                        : iso === today ? 'rounded-xl font-bold text-indigo-700 ring-[1.5px] ring-inset ring-indigo-300 hover:bg-indigo-50 dark:text-indigo-300 dark:ring-indigo-700 dark:hover:bg-indigo-950/40'
                        : 'rounded-xl text-zinc-800 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800';
                    return (
                        <button key={iso} type="button" disabled={disabled} onClick={() => onPick(iso)} aria-pressed={isEnd || inside}
                            aria-label={`${niceDay(iso)}${iso === today ? ', today' : ''}`}
                            className={`${cell} disabled:cursor-not-allowed ${look}`}>
                            {i + 1}
                        </button>
                    );
                })}
            </div>
        </div>
    );
}
