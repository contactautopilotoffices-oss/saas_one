'use client';

import React, { useEffect, useState } from 'react';
import { Star, X } from 'lucide-react';
import type { OptionField, OptionItem } from '@/backend/lib/candidates/filters';
import { api, qs } from './api';
import { INPUT, OVERLAY } from './ui';

/** The dropdown while typing: what the organisation's own records hold, ranked. Waits for a pause, so typing stays quick. */
function useOptions(orgId: string, field: OptionField, text: string, enabled: boolean): OptionItem[] {
    const [state, setState] = useState<{ key: string; options: OptionItem[] }>({ key: '', options: [] });
    const typed = text.trim();
    const key = enabled && typed ? `${field}:${typed.toLowerCase()}` : '';
    useEffect(() => {
        if (!key) return;
        const ctrl = new AbortController();
        const t = setTimeout(() => {
            void api<{ options: OptionItem[] }>(`/api/candidates/options${qs({ orgId, field, q: typed })}`, { signal: ctrl.signal }).then(res => {
                if (res.ok) setState({ key, options: res.data.options });
            });
        }, 150);
        return () => { clearTimeout(t); ctrl.abort(); };
    }, [key, orgId, field, typed]);
    return key && state.key === key ? state.options : [];
}

interface MenuRow { text: string; before: string; match: string; after: string; meta: string }

function toRow(o: OptionItem, typed: string, showKind: boolean): MenuRow {
    const at = o.text.toLowerCase().indexOf(typed.toLowerCase());
    const count = `${o.count} ${o.count === 1 ? 'candidate' : 'candidates'}`;
    return {
        text: o.text,
        before: at < 0 ? o.text : o.text.slice(0, at),
        match: at < 0 ? '' : o.text.slice(at, at + typed.length),
        after: at < 0 ? '' : o.text.slice(at + typed.length),
        meta: showKind ? `${o.kind} · ${count}` : count,
    };
}

function OptionMenu({ rows, active, label, onPick, onStar }: {
    rows: MenuRow[]; active: number; label: string; onPick: (text: string) => void; onStar?: (text: string) => void;
}) {
    return (
        <ul aria-label={label} className={`${OVERLAY} absolute inset-x-0 top-full z-40 mt-1 max-h-72 overflow-y-auto rounded-xl p-1`}>
            {rows.map((row, i) => (
                <li key={row.text} className={`flex items-center gap-1 rounded-lg ${i === active ? 'bg-muted' : 'hover:bg-muted'}`}>
                    {/* Mouse down, not click: the input keeps focus, so its blur does not take the half-typed word first. */}
                    <button type="button" tabIndex={-1} onMouseDown={e => { e.preventDefault(); onPick(row.text); }} className="flex h-9 min-w-0 flex-1 items-center gap-2 px-2.5 text-left text-sm text-text-primary">
                        <span className="min-w-0 flex-1 truncate">{row.before}<strong className="font-bold">{row.match}</strong>{row.after}</span>
                        {row.meta && <span className="shrink-0 text-xs text-text-tertiary">{row.meta}</span>}
                    </button>
                    {onStar && (
                        <button type="button" tabIndex={-1} onMouseDown={e => { e.preventDefault(); onStar(row.text); }} aria-label={`Add ${row.text} as a compulsory keyword`} title="Add as compulsory"
                            className="mr-1.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface text-primary-dark ring-1 ring-inset ring-border hover:ring-primary">
                            <Star className="h-3.5 w-3.5" aria-hidden />
                        </button>
                    )}
                </li>
            ))}
        </ul>
    );
}

/** Arrow keys, Enter and Escape for an open menu. Returns true when the key was used. */
function menuKey(e: React.KeyboardEvent, rows: MenuRow[], active: number, setActive: (i: number) => void, pick: (text: string) => void, close: () => void): boolean {
    if (e.key === 'Escape') { close(); return true; }
    if (!rows.length) return false;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((active + 1) % rows.length); return true; }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActive((active <= 0 ? rows.length : active) - 1); return true; }
    if (e.key === 'Enter' && rows[active]) { e.preventDefault(); pick(rows[active].text); return true; }
    return false;
}

export interface Token { text: string; required?: boolean }

/** A box that turns what is typed into chips, with the dropdown under it. Enter, a comma or leaving the box adds a chip. */
export function TokenField({
    id, orgId, field, tokens, onAdd, onRemove, onToggle, placeholder, icon, panel, focusRef, compact,
}: {
    id: string;
    orgId: string;
    field: OptionField;
    tokens: Token[];
    onAdd: (texts: string[], required: boolean) => void;
    onRemove: (text: string) => void;
    /** Given for keywords: a star on each chip makes it compulsory. */
    onToggle?: (text: string) => void;
    placeholder: string;
    icon?: React.ReactNode;
    /** Shown under the box while it has focus and nothing is typed (the AI suggestions). */
    panel?: React.ReactNode;
    focusRef?: React.RefObject<HTMLInputElement | null>;
    compact?: boolean;
}) {
    const [input, setInput] = useState('');
    const [focused, setFocused] = useState(false);
    const [closed, setClosed] = useState(false);
    const [active, setActive] = useState(-1);
    const options = useOptions(orgId, field, input, focused);
    const typed = input.trim();
    const taken = new Set(tokens.map(t => t.text.toLowerCase()));
    const rows = closed ? [] : options.filter(o => !taken.has(o.text.toLowerCase())).map(o => toRow(o, typed, field === 'keyword'));
    if (!closed && typed && !taken.has(typed.toLowerCase()) && !options.some(o => o.text.toLowerCase() === typed.toLowerCase())) {
        rows.push({ text: typed, before: 'Add "', match: typed, after: '"', meta: '' });
    }

    const add = (texts: string[], required = false) => {
        const fresh = texts.map(t => t.trim()).filter((t, i, all) => t && !taken.has(t.toLowerCase()) && all.findIndex(x => x.toLowerCase() === t.toLowerCase()) === i);
        if (fresh.length) onAdd(fresh, required);
        setActive(-1);
    };
    const pick = (text: string, required = false) => { add([text], required); setInput(''); };

    return (
        <div className="relative min-w-0">
            <div className={`flex flex-wrap items-center gap-1.5 rounded-xl border border-border bg-surface transition-[border-color,box-shadow] focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20 ${compact ? 'min-h-10 px-2 py-1' : 'min-h-11 px-2.5 py-1.5'}`}>
                {icon}
                {tokens.map(t => (
                    <span key={t.text} className={`inline-flex max-w-full items-center gap-0.5 rounded-full py-0.5 text-[13px] font-semibold text-text-primary ring-1 ring-inset ${onToggle ? 'pl-1 pr-1' : 'pl-2.5 pr-1'} ${t.required ? 'bg-primary/15 ring-primary/40' : 'bg-muted ring-border'}`}>
                        {onToggle && (
                            <button type="button" onClick={() => onToggle(t.text)} aria-pressed={!!t.required} aria-label={t.required ? `Make ${t.text} optional` : `Make ${t.text} compulsory`} title={t.required ? 'Compulsory. Click to make it optional.' : 'Click to make it compulsory.'}
                                className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${t.required ? 'text-primary-dark' : 'text-text-tertiary hover:text-text-primary'}`}>
                                <Star className={`h-3.5 w-3.5 ${t.required ? 'fill-current' : ''}`} aria-hidden />
                            </button>
                        )}
                        <span className="min-w-0 truncate">{t.text}</span>
                        <button type="button" onClick={() => onRemove(t.text)} aria-label={`Remove ${t.text}`} className="inline-flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full text-text-tertiary hover:text-text-primary">
                            <X className="h-3 w-3" aria-hidden />
                        </button>
                    </span>
                ))}
                <input
                    ref={focusRef}
                    id={id}
                    type="text"
                    autoComplete="off"
                    value={input}
                    placeholder={placeholder}
                    onFocus={() => setFocused(true)}
                    onBlur={() => { setFocused(false); add([input]); setInput(''); }}
                    onChange={e => {
                        setClosed(false);
                        setActive(-1);
                        const value = e.target.value;
                        if (!value.includes(',')) { setInput(value); return; }
                        const parts = value.split(',');
                        const rest = parts.pop() ?? '';
                        add(parts);
                        setInput(rest.trimStart());
                    }}
                    onKeyDown={e => {
                        if (menuKey(e, rows, active, setActive, pick, () => setClosed(true))) return;
                        if (e.key === 'Enter') { e.preventDefault(); pick(input); }
                        else if (e.key === 'Backspace' && !input && tokens.length) onRemove(tokens[tokens.length - 1].text);
                    }}
                    className="h-7 min-w-[120px] flex-1 border-0 bg-transparent text-base text-text-primary outline-none placeholder:text-text-tertiary sm:text-sm"
                />
            </div>
            {focused && rows.length > 0 && <OptionMenu rows={rows} active={active} label={`${field} suggestions`} onPick={pick} onStar={onToggle ? text => pick(text, true) : undefined} />}
            {focused && !typed && panel}
        </div>
    );
}

/** One text box with the dropdown under it; what is typed filters as it is typed. */
export function OptionInput({ id, orgId, field, value, onChange, placeholder }: {
    id: string; orgId: string; field: OptionField; value: string; onChange: (value: string) => void; placeholder: string;
}) {
    const [focused, setFocused] = useState(false);
    const [active, setActive] = useState(-1);
    const [closed, setClosed] = useState(false);
    const options = useOptions(orgId, field, value, focused);
    const typed = value.trim();
    const rows = closed || (options.length === 1 && options[0].text.toLowerCase() === typed.toLowerCase()) ? [] : options.map(o => toRow(o, typed, false));
    const pick = (text: string) => { onChange(text); setClosed(true); setActive(-1); };
    return (
        <div className="relative min-w-0">
            <input
                id={id}
                type="text"
                autoComplete="off"
                value={value}
                placeholder={placeholder}
                onFocus={() => { setFocused(true); setClosed(false); }}
                onBlur={() => setFocused(false)}
                onChange={e => { onChange(e.target.value); setClosed(false); setActive(-1); }}
                onKeyDown={e => { menuKey(e, rows, active, setActive, pick, () => setClosed(true)); }}
                className={INPUT}
            />
            {focused && rows.length > 0 && <OptionMenu rows={rows} active={active} label={`${field} suggestions`} onPick={pick} />}
        </div>
    );
}

/** A number box that keeps what is being typed ("2.") and hands the parent a number, or null when empty. */
export function NumberInput({ value, onChange, label, placeholder }: {
    value: number | null; onChange: (value: number | null) => void; label: string; placeholder: string;
}) {
    const [text, setText] = useState(value === null ? '' : String(value));
    const [seen, setSeen] = useState(value);
    // Changed from outside (Clear all, a job description): show the new value. Typing never reaches here.
    if (value !== seen) {
        setSeen(value);
        setText(value === null ? '' : String(value));
    }
    return (
        <input
            type="number"
            min={0}
            step="any"
            inputMode="decimal"
            aria-label={label}
            placeholder={placeholder}
            value={text}
            onChange={e => {
                const raw = e.target.value;
                setText(raw);
                const n = raw.trim() === '' ? null : Number(raw);
                const next = n === null || (Number.isFinite(n) && n >= 0) ? n : null;
                setSeen(next);
                onChange(next);
            }}
            className={`${INPUT} flex-1 px-2.5 tabular-nums`}
        />
    );
}
