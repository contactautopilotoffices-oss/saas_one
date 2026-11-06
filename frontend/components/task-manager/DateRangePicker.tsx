"use client";

import React from 'react';
import { Calendar } from 'lucide-react';

/**
 * One date-range picker for every task screen (owner 2026-10-15): quick picks plus a custom from–to, at most 31 days.
 * Dates are the viewer's local calendar days (YYYY-MM-DD).
 */

export interface DateRange { from: string; to: string }
export const MAX_RANGE_DAYS = 31;
/** "All time" (owner 2026-10-15): from this day to today; the only range longer than 31 days. Same value as the server. */
export const ALL_TIME_FROM = '2000-01-01';

const pad = (n: number) => String(n).padStart(2, '0');
export const localDay = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const shiftDay = (iso: string, days: number) => { const d = new Date(`${iso}T12:00:00`); d.setDate(d.getDate() + days); return localDay(d); };
export const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T12:00:00`) - Date.parse(`${from}T12:00:00`)) / 86_400_000);
export const todayRange = (): DateRange => { const t = localDay(); return { from: t, to: t }; };
export const isSingleDay = (r: DateRange) => r.from === r.to;

type Preset = 'today' | 'yesterday' | 'last7' | 'week' | 'month' | 'all' | 'custom';
function presetRange(p: Exclude<Preset, 'custom'>): DateRange {
    const t = localDay();
    if (p === 'today') return { from: t, to: t };
    if (p === 'yesterday') { const y = shiftDay(t, -1); return { from: y, to: y }; }
    if (p === 'last7') return { from: shiftDay(t, -6), to: t };
    if (p === 'all') return { from: ALL_TIME_FROM, to: t };
    if (p === 'week') { const d = new Date(`${t}T12:00:00`); const back = (d.getDay() + 6) % 7; return { from: shiftDay(t, -back), to: t }; }   // Monday → today
    return { from: `${t.slice(0, 8)}01`, to: t };                                                                                          // 1st → today
}
function presetOf(r: DateRange): Preset {
    if (r.from === ALL_TIME_FROM) return 'all';
    for (const p of ['today', 'yesterday', 'last7', 'week', 'month'] as const) { const x = presetRange(p); if (x.from === r.from && x.to === r.to) return p; }
    return 'custom';
}

/** Keep a range valid: from ≤ to, at most MAX_RANGE_DAYS days (the start moves). */
export function clampRange(r: DateRange): DateRange {
    let { from, to } = r;
    if (from > to) [from, to] = [to, from];
    if (from === ALL_TIME_FROM) return { from, to };
    if (daysBetween(from, to) > MAX_RANGE_DAYS - 1) from = shiftDay(to, -(MAX_RANGE_DAYS - 1));
    return { from, to };
}

export const rangeLabel = (r: DateRange) => {
    const f = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    if (r.from === ALL_TIME_FROM) return 'All time';
    return isSingleDay(r) ? f(r.from) : `${f(r.from)} – ${f(r.to)}`;
};

/**
 * A date typed into one box wins; the other box moves if needed (owner 2026-10-15): the range stays in order and at most
 * 31 days. Coming from "All time" (no real start), the other box starts 30 days away.
 */
export function editRange(current: DateRange, side: 'from' | 'to', day: string): DateRange {
    const allTime = current.from === ALL_TIME_FROM;
    const span = MAX_RANGE_DAYS - 1;
    if (side === 'from') {
        let to = allTime ? shiftDay(day, span) : current.to;
        if (to < day || daysBetween(day, to) > span) to = shiftDay(day, span);
        if (to > localDay()) to = localDay() < day ? day : localDay();
        return { from: day, to };
    }
    let from = allTime ? shiftDay(day, -span) : current.from;
    if (from > day || daysBetween(from, day) > span) from = shiftDay(day, -span);
    return { from, to: day };
}

export default function DateRangePicker({ value, onChange, className = '' }: { value: DateRange; onChange: (r: DateRange) => void; className?: string }) {
    // Owner 2026-10-15: no "Custom" in the menu. The two date boxes always sit beside it; typing a date makes a custom range,
    // and the menu then only SHOWS "Custom dates" (it cannot be picked). "All time" leaves the boxes blank.
    const preset = presetOf(value);
    const allTime = preset === 'all';
    const input = 'bg-transparent border-none text-zinc-700 dark:text-zinc-200 text-xs font-medium focus:outline-none cursor-pointer';
    return (
        <div className={`flex flex-wrap items-center gap-1 bg-white dark:bg-zinc-900 px-2 py-1 rounded-lg border border-zinc-200 dark:border-zinc-800 text-xs shadow-xs ${className}`} role="group" aria-label="Date range">
            <Calendar className="w-3 h-3 text-zinc-400 flex-shrink-0" />
            <select aria-label="Quick range" value={preset} onChange={e => { const p = e.target.value as Preset; if (p !== 'custom') onChange(presetRange(p)); }}
                className={`${input} font-semibold pr-1`}>
                <option value="today">Today</option>
                <option value="yesterday">Yesterday</option>
                <option value="last7">Last 7 days</option>
                <option value="week">This week</option>
                <option value="month">This month</option>
                <option value="all">All time</option>
                {preset === 'custom' && <option value="custom" disabled hidden>Custom dates</option>}
            </select>
            <span className="text-zinc-300 dark:text-zinc-600">|</span>
            <input type="date" aria-label="From" value={allTime ? '' : value.from} max={localDay()} onChange={e => e.target.value && onChange(editRange(value, 'from', e.target.value))} className={input} />
            <span className="text-zinc-400">–</span>
            <input type="date" aria-label="To" value={allTime ? '' : value.to} onChange={e => e.target.value && onChange(editRange(value, 'to', e.target.value))} className={input} />
        </div>
    );
}
