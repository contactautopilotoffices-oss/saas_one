'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import type { LabModel } from './useLabModel';
import type { LabTicket, Priority } from './types';
import { PRIORITY_META } from './status';
import { slaSortKey } from './format';

export type StatusTab = 'active' | 'open' | 'assigned' | 'in_progress' | 'closed' | 'waitlist';

export const STATUS_TABS: { id: StatusTab; label: string }[] = [
    { id: 'active', label: 'Active' },
    { id: 'open', label: 'Open' },
    { id: 'assigned', label: 'Assigned' },
    { id: 'in_progress', label: 'In progress' },
    { id: 'closed', label: 'Closed' },
    { id: 'waitlist', label: 'Waitlist' },
];

export type DateFilter = 'today' | '7d' | '30d';
const DATE_LABELS: Record<DateFilter, string> = { today: 'Today', '7d': 'Last 7 days', '30d': 'Last 30 days' };

/** Filter, tab and sort state for every design's Tickets screen. Pure client-side over loaded rows. */
export function useTicketFilters(lab: LabModel, initialTab: StatusTab = 'active') {
    const [tab, setTab] = useState<StatusTab>(initialTab);
    const [mine, setMine] = useState(false);
    const [unassigned, setUnassigned] = useState(false);
    const [category, setCategory] = useState<string | null>(null);
    const [priority, setPriority] = useState<Priority | null>(null);
    const [date, setDate] = useState<DateFilter | null>(null);
    const [raisedBy, setRaisedBy] = useState<string | null>(null);
    const [assignedTo, setAssignedTo] = useState<string | null>(null);
    const [sort, setSort] = useState<'sla' | 'newest'>('sla');
    const [query, setQuery] = useState('');

    const { active, closed, waitlist, all } = lab.tickets;

    const counts: Record<StatusTab, number> = {
        active: active.length,
        open: lab.stats.open,
        assigned: lab.stats.assigned,
        in_progress: lab.stats.inProgress,
        closed: lab.stats.closed,
        waitlist: lab.stats.waitlist,
    };

    const options = useMemo(() => {
        const uniq = (xs: (string | null)[]) => [...new Set(xs.filter((x): x is string => !!x))].sort();
        return {
            categories: uniq(all.map(t => t.category)),
            raisedBy: uniq(all.map(t => t.raisedBy)),
            assignedTo: uniq(all.map(t => t.assignee)),
        };
    }, [all]);

    const rows = useMemo(() => {
        let base: LabTicket[];
        if (tab === 'closed') base = closed;
        else if (tab === 'waitlist') base = waitlist;
        else if (tab === 'active') base = active;
        else base = active.filter(t => t.status === tab);
        const now = lab.now;
        const q = query.trim().toLowerCase();
        const dayMs = 86400000;
        const out = base.filter(t => {
            if (mine && t.assignee !== lab.user.name && t.raisedBy !== lab.user.name) return false;
            if (unassigned && t.assignee) return false;
            if (category && t.category !== category) return false;
            if (priority && t.priority !== priority) return false;
            if (raisedBy && t.raisedBy !== raisedBy) return false;
            if (assignedTo && t.assignee !== assignedTo) return false;
            if (date === 'today' && t.raisedAt.toDateString() !== now.toDateString()) return false;
            if (date === '7d' && now.getTime() - t.raisedAt.getTime() > 7 * dayMs) return false;
            if (date === '30d' && now.getTime() - t.raisedAt.getTime() > 30 * dayMs) return false;
            if (q && !`${t.title} ${t.number} ${t.location ?? ''}`.toLowerCase().includes(q)) return false;
            return true;
        });
        return out.sort((a, b) => (sort === 'sla' ? slaSortKey(a, now) - slaSortKey(b, now) : b.raisedAt.getTime() - a.raisedAt.getTime()));
    }, [tab, active, closed, waitlist, mine, unassigned, category, priority, raisedBy, assignedTo, date, query, sort, lab.now, lab.user.name]);

    const activeFilters = [mine, unassigned, category, priority, date, raisedBy, assignedTo].filter(Boolean).length + (query ? 1 : 0);

    const clear = () => {
        setMine(false); setUnassigned(false); setCategory(null); setPriority(null);
        setDate(null); setRaisedBy(null); setAssignedTo(null); setQuery('');
    };

    return {
        tab, setTab, counts, rows, options, sort, setSort, query, setQuery, activeFilters, clear,
        mine, setMine, unassigned, setUnassigned, category, setCategory, priority, setPriority,
        date, setDate, raisedBy, setRaisedBy, assignedTo, setAssignedTo,
    };
}

export type TicketFilters = ReturnType<typeof useTicketFilters>;

/** Dropdown chip used for Category, Priority, Date, Raised by and Assigned to. */
export function FilterMenu<T extends string>({
    label, value, options, onChange, className, style, activeStyle, renderLabel,
}: {
    label: string;
    value: T | null;
    options: T[];
    onChange: (v: T | null) => void;
    className?: string;
    style?: React.CSSProperties;
    activeStyle?: React.CSSProperties;
    renderLabel?: (v: T) => string;
}) {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (!open) return;
        const onDoc = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
        document.addEventListener('mousedown', onDoc);
        document.addEventListener('keydown', onKey);
        return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
    }, [open]);
    const show = (v: T) => (renderLabel ? renderLabel(v) : v);
    return (
        <div ref={ref} className="relative">
            <button
                type="button"
                aria-haspopup="listbox"
                aria-expanded={open}
                onClick={() => setOpen(o => !o)}
                className={`inline-flex items-center gap-1.5 whitespace-nowrap ${className ?? ''}`}
                style={value ? { ...style, ...activeStyle } : style}
            >
                {value ? show(value) : label}
                <ChevronDown className="h-3.5 w-3.5 opacity-70" aria-hidden />
            </button>
            {open && (
                <div
                    role="listbox"
                    aria-label={label}
                    className="absolute left-0 top-[calc(100%+6px)] z-40 max-h-72 min-w-[200px] overflow-auto p-1.5 shadow-xl"
                    style={{ background: 'var(--lab-surface)', border: '1px solid var(--lab-border)', borderRadius: 'var(--lab-radius-sm)', color: 'var(--lab-text)' }}
                    onKeyDown={e => {
                        if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
                        const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('button'));
                        const i = items.indexOf(document.activeElement as HTMLElement);
                        const next = e.key === 'ArrowDown' ? Math.min(items.length - 1, i + 1) : Math.max(0, i - 1);
                        items[next]?.focus();
                        e.preventDefault();
                    }}
                >
                    <MenuOption selected={value === null} onClick={() => { onChange(null); setOpen(false); }}>{`Any ${label.toLowerCase()}`}</MenuOption>
                    {options.length === 0 && <div className="px-3 py-2 text-[13px]" style={{ color: 'var(--lab-text2)' }}>No options yet</div>}
                    {options.map(o => (
                        <MenuOption key={o} selected={value === o} onClick={() => { onChange(o); setOpen(false); }}>{show(o)}</MenuOption>
                    ))}
                </div>
            )}
        </div>
    );
}

function MenuOption({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: React.ReactNode }) {
    return (
        <button
            type="button"
            role="option"
            aria-selected={selected}
            onClick={onClick}
            className="flex min-h-10 w-full items-center justify-between gap-[12px] rounded-lg px-3 text-left text-[13.5px] hover:bg-[var(--lab-tile)] focus-visible:bg-[var(--lab-tile)]"
        >
            <span>{children}</span>
            {selected && <Check className="h-4 w-4" aria-hidden />}
        </button>
    );
}

export const PRIORITY_OPTIONS: Priority[] = ['critical', 'urgent', 'high', 'medium', 'low'];
export const priorityLabel = (p: Priority) => PRIORITY_META[p].label;
export const DATE_OPTIONS: DateFilter[] = ['today', '7d', '30d'];
export const dateLabel = (d: DateFilter) => DATE_LABELS[d];

/**
 * The full set of filter chips (Mine, Unassigned, Category, Priority, Date, Raised by,
 * Assigned to) plus Sort by SLA. Each design passes its own chip styling.
 */
export function FilterChips({ f, chipClass, chipStyle, activeStyle, showSort = true, className }: {
    f: TicketFilters; chipClass: string; chipStyle: React.CSSProperties; activeStyle: React.CSSProperties; showSort?: boolean; className?: string;
}) {
    const toggle = (on: boolean) => (on ? { ...chipStyle, ...activeStyle } : chipStyle);
    return (
        <div className={`flex flex-wrap items-center gap-[8px] ${className ?? ''}`}>
            <button type="button" aria-pressed={f.mine} onClick={() => f.setMine(!f.mine)} className={chipClass} style={toggle(f.mine)}>Mine</button>
            <button type="button" aria-pressed={f.unassigned} onClick={() => f.setUnassigned(!f.unassigned)} className={chipClass} style={toggle(f.unassigned)}>Unassigned</button>
            <FilterMenu label="Category" value={f.category} options={f.options.categories} onChange={f.setCategory} className={chipClass} style={chipStyle} activeStyle={activeStyle} />
            <FilterMenu label="Priority" value={f.priority} options={PRIORITY_OPTIONS} onChange={f.setPriority} className={chipClass} style={chipStyle} activeStyle={activeStyle} renderLabel={priorityLabel} />
            <FilterMenu label="Date" value={f.date} options={DATE_OPTIONS} onChange={f.setDate} className={chipClass} style={chipStyle} activeStyle={activeStyle} renderLabel={dateLabel} />
            <FilterMenu label="Raised by" value={f.raisedBy} options={f.options.raisedBy} onChange={f.setRaisedBy} className={chipClass} style={chipStyle} activeStyle={activeStyle} />
            <FilterMenu label="Assigned to" value={f.assignedTo} options={f.options.assignedTo} onChange={f.setAssignedTo} className={chipClass} style={chipStyle} activeStyle={activeStyle} />
            {showSort && (
                <button
                    type="button"
                    aria-pressed={f.sort === 'sla'}
                    onClick={() => f.setSort(f.sort === 'sla' ? 'newest' : 'sla')}
                    className={chipClass}
                    style={toggle(f.sort === 'sla')}
                >
                    {f.sort === 'sla' ? 'Sort: SLA' : 'Sort: Newest'}
                </button>
            )}
        </div>
    );
}
