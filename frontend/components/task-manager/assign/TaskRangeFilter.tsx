'use client';

import React, { useState } from 'react';
import { CalendarDays, Check, ChevronDown } from 'lucide-react';
import { ALL_TIME_FROM, DateRange, MAX_RANGE_DAYS, clampRange, daysBetween, localDay, shiftDay } from '../DateRangePicker';
import MonthCalendar, { niceDay } from './MonthCalendar';
import { ResponsivePopover, useIsDesktop } from './Sheet';

type Mode = 'today' | 'yesterday' | 'last7' | 'all' | 'day' | 'range';

const short = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

function modeOf(r: DateRange): Mode {
    const t = localDay();
    if (r.from === ALL_TIME_FROM) return 'all';
    if (r.from === t && r.to === t) return 'today';
    const y = shiftDay(t, -1);
    if (r.from === y && r.to === y) return 'yesterday';
    if (r.from === shiftDay(t, -6) && r.to === t) return 'last7';
    return r.from === r.to ? 'day' : 'range';
}

export function rangeButtonLabel(r: DateRange): string {
    const mode = modeOf(r);
    if (mode === 'today') return `Today · ${short(r.from)}`;
    if (mode === 'yesterday') return `Yesterday · ${short(r.from)}`;
    if (mode === 'last7') return 'Last 7 days';
    if (mode === 'all') return 'All time';
    return mode === 'day' ? niceDay(r.from) : `${short(r.from)} – ${short(r.to)}`;
}

/**
 * Which days the task list covers: Today, Yesterday, Last 7 days, All time, one custom day or a custom range (at most
 * 31 days, like the server). A card on a computer, a bottom sheet on a phone.
 */
export default function TaskRangeFilter({ value, onChange, align = 'left' }: { value: DateRange; onChange: (r: DateRange) => void; align?: 'left' | 'right' }) {
    const desktop = useIsDesktop();
    const [open, setOpen] = useState(false);
    const [mode, setMode] = useState<Mode>(modeOf(value));
    const [draft, setDraft] = useState<DateRange>(value);
    const [pickingEnd, setPickingEnd] = useState(false);
    const today = localDay();

    const openPanel = () => { setMode(modeOf(value)); setDraft(value.from === ALL_TIME_FROM ? { from: today, to: today } : value); setPickingEnd(false); setOpen(true); };
    const close = () => { setOpen(false); setPickingEnd(false); };
    const apply = () => { if (!pickingEnd) onChange(clampRange(draft)); close(); };

    const t = today;
    const OPTIONS: Array<{ id: Mode; label: string; hint: string }> = [
        { id: 'today', label: 'Today', hint: short(t) },
        { id: 'yesterday', label: 'Yesterday', hint: short(shiftDay(t, -1)) },
        { id: 'last7', label: 'Last 7 days', hint: `${short(shiftDay(t, -6))} – ${short(t)}` },
        { id: 'all', label: 'All time', hint: 'Every task' },
        { id: 'day', label: 'Custom day', hint: 'Pick one date' },
        { id: 'range', label: 'Custom range', hint: `Up to ${MAX_RANGE_DAYS} days` },
    ];

    const pick = (id: Mode) => {
        if (id === 'day' || id === 'range') {
            setMode(id);
            setDraft(d => (id === 'day' ? { from: d.from, to: d.from } : d));
            setPickingEnd(false);
            return;
        }
        const ranges: Record<'today' | 'yesterday' | 'last7' | 'all', DateRange> = {
            today: { from: t, to: t },
            yesterday: { from: shiftDay(t, -1), to: shiftDay(t, -1) },
            last7: { from: shiftDay(t, -6), to: t },
            all: { from: ALL_TIME_FROM, to: t },
        };
        onChange(ranges[id]);
        close();
    };

    const pickDay = (iso: string) => {
        if (mode === 'day') { setDraft({ from: iso, to: iso }); return; }
        if (pickingEnd && iso >= draft.from) { setDraft({ from: draft.from, to: iso }); setPickingEnd(false); return; }
        setDraft({ from: iso, to: iso });
        setPickingEnd(true);
    };
    // Future days are never shown; while choosing the end of a range, days past the 31-day limit are off too
    const isDisabled = (iso: string) => iso > today || (pickingEnd && iso > draft.from && daysBetween(draft.from, iso) > MAX_RANGE_DAYS - 1);

    const custom = mode === 'day' || mode === 'range';
    const summary = mode === 'range'
        ? (pickingEnd ? 'pick the last day' : `${short(draft.from)} – ${short(draft.to)} · ${daysBetween(draft.from, draft.to) + 1} day${draft.from === draft.to ? '' : 's'}`)
        : niceDay(draft.from);
    const box = (on: boolean) => `flex flex-1 flex-col rounded-lg px-2.5 py-1.5 ${on ? 'border-[1.5px] border-indigo-500 bg-indigo-50/60 dark:bg-indigo-950/40' : 'border border-zinc-200 dark:border-zinc-700'}`;

    return (
        <div className="relative">
            <button type="button" onClick={() => (open ? close() : openPanel())} aria-haspopup="dialog" aria-expanded={open}
                className={`flex min-h-10 items-center gap-2 whitespace-nowrap rounded-xl border bg-white px-3 text-[13px] font-semibold text-zinc-800 shadow-[0_1px_2px_rgba(24,24,27,0.04)] dark:bg-zinc-900 dark:text-zinc-100 ${open ? 'border-indigo-500 ring-[3px] ring-indigo-100 dark:ring-indigo-950' : 'border-zinc-200 hover:border-zinc-300 dark:border-zinc-700'}`}>
                <CalendarDays className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
                {rangeButtonLabel(value)}
                <ChevronDown className="h-3.5 w-3.5 text-zinc-500" />
            </button>
            <ResponsivePopover open={open} onClose={close} title="Show tasks from" width={custom ? 500 : 200} align={align}
                footer={
                    <div className="flex items-center justify-between gap-3">
                        <span className="min-w-0 text-xs leading-tight text-zinc-600 dark:text-zinc-400">Showing <strong className="block truncate text-zinc-900 sm:inline dark:text-zinc-100">{custom ? summary : rangeButtonLabel(value)}</strong></span>
                        <button type="button" onClick={apply} disabled={pickingEnd}
                            className="min-h-9 shrink-0 rounded-lg bg-indigo-600 px-4 text-[13px] font-bold text-white hover:bg-indigo-700 disabled:opacity-40">Apply</button>
                    </div>
                }>
                <div className="flex flex-col gap-3 sm:flex-row">
                    <div role="radiogroup" aria-label="Date range" className={desktop ? 'flex w-[176px] shrink-0 flex-col' : 'grid grid-cols-2 gap-2'}>
                        {OPTIONS.map(o => {
                            const on = mode === o.id;
                            return (
                                <button key={o.id} type="button" role="radio" aria-checked={on} onClick={() => pick(o.id)}
                                    className={desktop
                                        ? `flex items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left ${on ? 'bg-indigo-50 dark:bg-indigo-950/50' : 'hover:bg-zinc-50 dark:hover:bg-zinc-800'}`
                                        : `flex min-h-12 flex-col items-start justify-center rounded-xl px-3 text-left ${on ? 'border-[1.5px] border-indigo-500 bg-indigo-50 dark:bg-indigo-950/50' : 'border border-zinc-200 dark:border-zinc-700'}`}>
                                    <span className="flex flex-col">
                                        <span className="text-[13px] font-semibold leading-snug">{o.label}</span>
                                        <span className="text-[11px] leading-snug text-zinc-500">{o.hint}</span>
                                    </span>
                                    {desktop && on && <Check className="h-3.5 w-3.5 shrink-0 text-indigo-600" />}
                                </button>
                            );
                        })}
                    </div>
                    {custom && (
                        <div className="flex-1 space-y-3 border-t border-zinc-100 pt-3 sm:border-l sm:border-t-0 sm:pl-4 sm:pt-0 dark:border-zinc-800">
                            <div className="flex gap-2">
                                <div className={box(!pickingEnd)}>
                                    <span className="text-[10px] font-bold tracking-wide text-zinc-500">{mode === 'range' ? 'FROM' : 'DATE'}</span>
                                    <span className="text-[13px] font-bold">{niceDay(draft.from)}</span>
                                </div>
                                {mode === 'range' && (
                                    <div className={box(pickingEnd)}>
                                        <span className="text-[10px] font-bold tracking-wide text-zinc-500">TO</span>
                                        <span className="text-[13px] font-bold">{pickingEnd ? 'Pick a date' : niceDay(draft.to)}</span>
                                    </div>
                                )}
                            </div>
                            <MonthCalendar from={draft.from} to={mode === 'range' && !pickingEnd ? draft.to : null} onPick={pickDay} isDisabled={isDisabled}
                                maxMonth={today.slice(0, 7)} />
                            <p className="text-xs text-zinc-500">
                                {mode === 'day' ? 'Tap a day to see its tasks.' : pickingEnd ? 'Now tap the last day.' : `Tap the first day, then the last day (up to ${MAX_RANGE_DAYS} days).`}
                            </p>
                        </div>
                    )}
                </div>
            </ResponsivePopover>
        </div>
    );
}
