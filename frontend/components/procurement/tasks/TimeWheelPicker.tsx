'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Clock, ChevronDown } from 'lucide-react';

/**
 * 12-hour time picker with three snapping wheels (hour, minute, AM/PM).
 * The value in and out is always a 24-hour "HH:mm" string, so callers and the server are unchanged.
 */

const ROW = 36; // px per wheel row; must match the h-9 rows and the 72px (two-row) padding below
const HOURS = Array.from({ length: 12 }, (_, i) => String(i + 1));
const MINUTES = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0'));
const PERIODS = ['AM', 'PM'];

const pad = (n: number) => String(n).padStart(2, '0');

function to12(v: string) {
    const [hRaw, mRaw] = (v || '').split(':');
    let h = parseInt(hRaw, 10);
    let m = parseInt(mRaw, 10);
    if (isNaN(h) || h < 0 || h > 23) h = 9;
    if (isNaN(m) || m < 0 || m > 59) m = 0;
    return { h: h % 12 || 12, m, p: h >= 12 ? 'PM' : 'AM' };
}

function to24(h: number, m: number, p: string) {
    return `${pad((h % 12) + (p === 'PM' ? 12 : 0))}:${pad(m)}`;
}

export function formatTime12(v: string) {
    const t = to12(v);
    return `${t.h}:${pad(t.m)} ${t.p}`;
}

function Wheel({ items, index, onIndex, label, scrollSignal }: {
    items: string[]; index: number; onIndex: (i: number) => void; label: string; scrollSignal: number;
}) {
    const ref = useRef<HTMLDivElement>(null);
    const indexRef = useRef(index);
    indexRef.current = index;

    // Jump to the value on mount, and glide to it when the parent sets it from outside (a preset).
    const first = useRef(true);
    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        el.scrollTo({ top: indexRef.current * ROW, behavior: first.current ? 'auto' : 'smooth' });
        first.current = false;
    }, [scrollSignal]);

    const onScroll = () => {
        const el = ref.current;
        if (!el) return;
        const i = Math.max(0, Math.min(items.length - 1, Math.round(el.scrollTop / ROW)));
        if (i !== indexRef.current) onIndex(i);
    };

    const onKeyDown = (e: React.KeyboardEvent) => {
        if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
        e.preventDefault();
        ref.current?.scrollBy({ top: e.key === 'ArrowDown' ? ROW : -ROW, behavior: 'smooth' });
    };

    return (
        <div
            ref={ref} role="listbox" aria-label={label} tabIndex={0} onScroll={onScroll} onKeyDown={onKeyDown}
            className="relative z-10 h-[180px] snap-y snap-mandatory overflow-y-scroll overscroll-contain py-[72px] [scroll-padding-block:72px] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden focus-visible:outline-none"
        >
            {items.map((x, i) => (
                <button
                    key={x} type="button" role="option" aria-selected={i === index} tabIndex={-1}
                    onClick={() => ref.current?.scrollTo({ top: i * ROW, behavior: 'smooth' })}
                    className={`block h-9 w-full snap-start text-lg tabular-nums transition-colors ${i === index ? 'font-black text-zinc-900 dark:text-zinc-50' : 'font-semibold text-zinc-400 hover:text-zinc-600 dark:text-zinc-500 dark:hover:text-zinc-300'}`}
                >{x}</button>
            ))}
        </div>
    );
}

export default function TimeWheelPicker({ id, value, onChange, disabled, presets, ariaLabel = 'Time' }: {
    id?: string;
    value: string; // "HH:mm", 24-hour
    onChange: (v24: string) => void;
    disabled?: boolean;
    presets?: Array<{ label: string; value: string }>;
    ariaLabel?: string;
}) {
    const [open, setOpen] = useState(false);
    const [scrollSignal, setScrollSignal] = useState(0);
    const rootRef = useRef<HTMLDivElement>(null);
    const t = to12(value);

    useEffect(() => {
        if (!open) return;
        const onDown = (e: MouseEvent) => { if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false); };
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
        document.addEventListener('mousedown', onDown);
        document.addEventListener('keydown', onKey);
        return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
    }, [open]);

    const setPart = (part: 'h' | 'm' | 'p', i: number) => {
        const next = { h: t.h, m: t.m, p: t.p };
        if (part === 'h') next.h = Number(HOURS[i]);
        if (part === 'm') next.m = i;
        if (part === 'p') next.p = PERIODS[i];
        onChange(to24(next.h, next.m, next.p));
    };

    return (
        <div ref={rootRef} className="relative">
            <button
                id={id} type="button" disabled={disabled} aria-label={`${ariaLabel}: ${formatTime12(value)}`} aria-haspopup="dialog" aria-expanded={open}
                onClick={() => setOpen(o => !o)}
                className="flex w-40 items-center gap-2 rounded-xl border border-zinc-300 bg-white px-3 py-2 text-left text-sm font-bold tabular-nums text-zinc-900 outline-none transition-colors hover:border-indigo-400 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
            >
                <Clock className="h-4 w-4 shrink-0 text-zinc-400" aria-hidden="true" />
                <span className="flex-1">{formatTime12(value)}</span>
                <ChevronDown className={`h-4 w-4 shrink-0 text-zinc-400 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
            </button>

            {open && (
                <div role="dialog" aria-label="Choose a time" className="absolute left-0 top-full z-30 mt-2 w-64 space-y-3 rounded-2xl border border-zinc-200 bg-white p-3 shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
                    <p className="text-2xl font-black tabular-nums tracking-tight text-zinc-900 dark:text-zinc-50">{formatTime12(value)}</p>
                    <div className="relative grid grid-cols-[1fr_1fr_0.8fr] gap-1">
                        <div className="pointer-events-none absolute inset-x-0 top-[72px] h-9 rounded-xl bg-indigo-50 dark:bg-indigo-950/60" />
                        <Wheel items={HOURS} index={HOURS.indexOf(String(t.h))} onIndex={i => setPart('h', i)} label="Hour" scrollSignal={scrollSignal} />
                        <Wheel items={MINUTES} index={t.m} onIndex={i => setPart('m', i)} label="Minute" scrollSignal={scrollSignal} />
                        <Wheel items={PERIODS} index={PERIODS.indexOf(t.p)} onIndex={i => setPart('p', i)} label="AM or PM" scrollSignal={scrollSignal} />
                        <div className="pointer-events-none absolute inset-x-0 top-0 z-20 h-[60px] bg-gradient-to-b from-white to-transparent dark:from-zinc-900" />
                        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 h-[60px] bg-gradient-to-t from-white to-transparent dark:from-zinc-900" />
                    </div>
                    {presets && presets.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                            {presets.map(p => (
                                <button
                                    key={p.value} type="button" aria-pressed={p.value === value}
                                    onClick={() => { onChange(p.value); setScrollSignal(s => s + 1); }}
                                    className={`rounded-full border px-2.5 py-1 text-[11px] font-bold transition-colors ${p.value === value ? 'border-indigo-500 bg-indigo-50 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300' : 'border-zinc-200 text-zinc-500 hover:border-indigo-400 hover:text-indigo-600 dark:border-zinc-700'}`}
                                >{p.label} · {formatTime12(p.value)}</button>
                            ))}
                        </div>
                    )}
                    <button type="button" onClick={() => setOpen(false)} className="w-full rounded-xl bg-indigo-600 py-2 text-xs font-black text-white transition-colors hover:bg-indigo-700">Done</button>
                </div>
            )}
        </div>
    );
}
