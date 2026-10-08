'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { Check, ChevronDown, Search } from 'lucide-react';

export interface SearchableOption { value: string; label: string; description?: string; searchText?: string }
export default function SearchableSelect({ label, value, options, onChange, disabled = false, placeholder, emptyMessage = 'No matches found.' }: {
    label: string; value: string; options: SearchableOption[]; onChange: (value: string) => void;
    disabled?: boolean; placeholder?: string; emptyMessage?: string;
}) {
    const id = useId();
    const root = useRef<HTMLDivElement>(null); const trigger = useRef<HTMLButtonElement>(null); const input = useRef<HTMLInputElement>(null);
    const [open, setOpen] = useState(false); const [search, setSearch] = useState(''); const [active, setActive] = useState(-1);
    const selected = options.find(option => option.value === value);
    const matches = options.filter(option => `${option.label} ${option.description || ''} ${option.searchText || ''}`.toLowerCase().includes(search.trim().toLowerCase()));
    const close = (restoreFocus = false) => { setOpen(false); setSearch(''); setActive(-1); if (restoreFocus) trigger.current?.focus(); };
    const choose = (next: string) => { onChange(next); close(true); };
    useEffect(() => {
        if (!open) return;
        input.current?.focus();
        const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) { setOpen(false); setSearch(''); setActive(-1); } };
        document.addEventListener('pointerdown', outside);
        return () => document.removeEventListener('pointerdown', outside);
    }, [open]);
    useEffect(() => { if (disabled) { setOpen(false); setSearch(''); setActive(-1); } }, [disabled]);
    useEffect(() => { document.getElementById(`${id}-option-${active}`)?.scrollIntoView({ block: 'nearest' }); }, [active, id]);
    return <div ref={root} className="relative min-w-0">
        <label id={`${id}-label`} className="pc-field-label" htmlFor={`${id}-trigger`}>{label}</label>
        <button ref={trigger} id={`${id}-trigger`} type="button" role="combobox" aria-labelledby={`${id}-label`} aria-expanded={open} aria-haspopup="listbox" aria-controls={`${id}-list`} disabled={disabled}
            className={`pc-select-trigger ${open ? 'pc-select-open' : ''}`} onClick={() => { if (open) close(); else setOpen(true); }}
            onKeyDown={event => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setOpen(true); setActive(0); } }}>
            <span className="min-w-0 text-left"><span className={`block truncate ${selected ? '' : 'text-text-secondary'}`}>{selected?.label || placeholder || `Select ${label.toLowerCase()}`}</span>{selected?.description && <span className="block truncate text-xs text-text-secondary mt-0.5">{selected.description}</span>}</span>
            <ChevronDown size={16} className={`shrink-0 text-text-secondary transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
        {open && <div className="pc-select-menu">
            <div className="flex items-center gap-2 border-b border-border px-3 py-2.5"><Search size={16} className="shrink-0 text-text-tertiary" /><input ref={input} value={search} aria-label={`Search ${label.toLowerCase()}`} placeholder={`Search ${label.toLowerCase()}…`} aria-controls={`${id}-list`} aria-activedescendant={active >= 0 ? `${id}-option-${active}` : undefined} className="w-full min-w-0 bg-transparent text-sm outline-none" onChange={event => { setSearch(event.target.value); setActive(-1); }}
                onKeyDown={event => {
                    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) { event.preventDefault(); if (!matches.length) return; setActive(previous => event.key === 'Home' ? 0 : event.key === 'End' ? matches.length - 1 : event.key === 'ArrowDown' ? (previous + 1) % matches.length : previous <= 0 ? matches.length - 1 : previous - 1); }
                    if (event.key === 'Enter') { event.preventDefault(); const option = matches[active >= 0 ? active : 0]; if (option) choose(option.value); }
                    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); }
                    if (event.key === 'Tab') close();
                }} /></div>
            <div id={`${id}-list`} role="listbox" aria-labelledby={`${id}-label`} className="max-h-60 overflow-y-auto p-1.5">
                {matches.map((option, index) => <div key={option.value} id={`${id}-option-${index}`} role="option" aria-selected={option.value === value} className={`pc-select-option ${active === index || option.value === value ? 'bg-primary/10' : ''}`} onPointerMove={() => setActive(index)} onClick={() => choose(option.value)}>
                    <span className="min-w-0"><span className="block break-words font-medium">{option.label}</span>{option.description && <span className="block break-words text-xs text-text-secondary mt-0.5">{option.description}</span>}</span>{option.value === value && <Check size={16} className="shrink-0 text-primary" />}
                </div>)}
                {!matches.length && <p role="status" className="p-4 text-sm text-text-secondary text-center">{emptyMessage}</p>}
            </div>
        </div>}
    </div>;
}
