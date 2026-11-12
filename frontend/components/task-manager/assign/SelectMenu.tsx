'use client';

import React, { useEffect, useId, useRef, useState } from 'react';
import { Check, ChevronDown, Search } from 'lucide-react';
import { ResponsivePopover, useIsDesktop } from './Sheet';

export interface MenuOption {
    value: string;
    label: string;
    /** A second, quieter line (e.g. the person's department). */
    sub?: string;
    /** Shown as a small pill on the right (e.g. open tasks). */
    count?: number;
    /** Greyed text, still selectable (e.g. a department switched off). */
    muted?: boolean;
}

const SEARCH_FROM = 8;

/**
 * The Task Manager's dropdown (owner 2026-10-22): a clean button that opens a list with checkmarks and open-task pills,
 * a search box once the list is long, and a bottom sheet on a phone.
 */
export default function SelectMenu({ label, value, options, onChange, placeholder = 'Choose…', emptyText = 'Nothing to choose yet' }: {
    label: string; value: string; options: MenuOption[]; onChange: (value: string) => void; placeholder?: string; emptyText?: string;
}) {
    const id = useId();
    const desktop = useIsDesktop();
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const [active, setActive] = useState(0);
    const listRef = useRef<HTMLDivElement>(null);
    const buttonRef = useRef<HTMLButtonElement>(null);

    const selected = options.find(o => o.value === value);
    const q = query.trim().toLowerCase();
    const shown = q ? options.filter(o => o.label.toLowerCase().includes(q) || o.sub?.toLowerCase().includes(q)) : options;

    useEffect(() => {
        if (!open) return;
        setQuery('');
        setActive(Math.max(0, options.findIndex(o => o.value === value)));
        // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the menu opens
    }, [open]);
    useEffect(() => {
        listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
    }, [active, open]);

    const close = () => { setOpen(false); buttonRef.current?.focus(); };
    const choose = (o: MenuOption) => { onChange(o.value); close(); };
    const onKey = (e: React.KeyboardEvent) => {
        if (e.key === 'ArrowDown') { e.preventDefault(); setActive(i => Math.min(shown.length - 1, i + 1)); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(i => Math.max(0, i - 1)); }
        else if (e.key === 'Enter' && shown[active]) { e.preventDefault(); choose(shown[active]); }
    };

    const pill = (on: boolean) => `shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums ${on ? 'bg-indigo-600 text-white' : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300'}`;

    return (
        <div className="flex flex-col gap-1.5">
            <span id={`${id}-label`} className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">{label}</span>
            <div className="relative">
                <button ref={buttonRef} type="button" onClick={() => setOpen(o => !o)} onKeyDown={e => { if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { e.preventDefault(); setOpen(true); } }}
                    aria-haspopup="listbox" aria-expanded={open} aria-labelledby={`${id}-label ${id}-value`}
                    className={`group flex min-h-11 w-full items-center gap-2 rounded-xl border bg-white px-3 text-left text-sm shadow-[0_1px_2px_rgba(24,24,27,0.04)] transition-colors dark:bg-zinc-900 ${open ? 'border-indigo-500 ring-[3px] ring-indigo-100 dark:ring-indigo-950' : 'border-zinc-200 hover:border-zinc-300 dark:border-zinc-700 dark:hover:border-zinc-600'}`}>
                    <span id={`${id}-value`} className={`min-w-0 flex-1 truncate ${selected ? 'font-semibold text-zinc-900 dark:text-zinc-100' : 'text-zinc-500'}`}>
                        {selected ? selected.label : placeholder}
                    </span>
                    {selected?.count !== undefined && <span className={pill(false)}>{selected.count} open</span>}
                    <ChevronDown className={`h-4 w-4 shrink-0 text-zinc-500 transition-transform ${open ? 'rotate-180' : ''}`} />
                </button>
                <ResponsivePopover open={open} onClose={() => setOpen(false)} title={label} width="anchor">
                    <div className="space-y-1.5" onKeyDown={onKey}>
                        {options.length >= SEARCH_FROM && (
                            <label className="flex items-center gap-2 rounded-lg border border-zinc-200 px-2.5 dark:border-zinc-700">
                                <Search className="h-4 w-4 text-zinc-400" />
                                <span className="sr-only">Search {label}</span>
                                <input autoFocus={desktop} value={query} onChange={e => { setQuery(e.target.value); setActive(0); }} placeholder="Search…"
                                    className="min-h-9 w-full bg-transparent text-sm outline-none" />
                            </label>
                        )}
                        {/* The list takes the keyboard (arrows, Enter) when there is no search box to type in */}
                        <div ref={listRef} role="listbox" aria-label={label} tabIndex={-1} autoFocus={desktop && options.length < SEARCH_FROM}
                            aria-activedescendant={shown[active] ? `${id}-opt-${active}` : undefined} className="max-h-72 overflow-y-auto outline-none sm:max-h-64">
                            {shown.length === 0 && <p className="px-3 py-4 text-center text-sm text-zinc-500">{options.length ? 'No match' : emptyText}</p>}
                            {shown.map((o, i) => {
                                const on = o.value === value;
                                return (
                                    <button key={o.value} type="button" role="option" id={`${id}-opt-${i}`} aria-selected={on} data-index={i} tabIndex={-1}
                                        onClick={() => choose(o)} onMouseEnter={() => setActive(i)}
                                        className={`flex min-h-11 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-sm sm:min-h-10 ${i === active ? 'bg-zinc-100 dark:bg-zinc-800' : ''} ${on ? 'text-indigo-800 dark:text-indigo-200' : o.muted ? 'text-zinc-500' : 'text-zinc-800 dark:text-zinc-200'}`}>
                                        <span className="flex h-4 w-4 shrink-0 items-center justify-center">{on && <Check className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />}</span>
                                        <span className="min-w-0 flex-1">
                                            <span className={`block truncate ${on ? 'font-semibold' : 'font-medium'}`}>{o.label}</span>
                                            {o.sub && <span className="block truncate text-xs text-zinc-500">{o.sub}</span>}
                                        </span>
                                        {o.count !== undefined && <span className={pill(on)}>{o.count}</span>}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                </ResponsivePopover>
            </div>
        </div>
    );
}
