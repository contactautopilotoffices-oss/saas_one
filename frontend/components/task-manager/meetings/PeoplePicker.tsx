'use client';

import React, { useMemo, useState } from 'react';
import { AudioLines, Check, Plus, Search, X } from 'lucide-react';
import type { MeetingPerson } from './api';

/**
 * Owner 2026-11-13: "who is present" — the same picker in three places: starting a meeting (NewMeeting), adding
 * someone who walked in while recording (MeetingRecorder) and correcting the list afterwards (MeetingReview).
 * Anyone in the Task Manager (searched by name or department) plus names typed in by hand. The caller owns the state.
 */
const field = 'w-full rounded-xl border border-zinc-300 bg-white px-3.5 py-2.5 text-sm text-zinc-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100';

export default function PeoplePicker({ people, selected, extra, onToggle, onExtraChange, voiceOn = false, listClassName = 'max-h-60' }: {
    people: MeetingPerson[];
    selected: Set<string>;
    extra: string[];
    onToggle: (id: string) => void;
    onExtraChange: (names: string[]) => void;
    /** LiveVoice ID: show the "Voice ready" marks */
    voiceOn?: boolean;
    listClassName?: string;
}) {
    const [typed, setTyped] = useState('');
    const [query, setQuery] = useState('');

    const shown = useMemo(() => {
        const q = query.trim().toLowerCase();
        const list = q ? people.filter(p => p.name.toLowerCase().includes(q) || (p.department || '').toLowerCase().includes(q)) : people;
        return list.slice(0, 200);
    }, [people, query]);
    const nameOf = useMemo(() => new Map(people.map(p => [p.id, p.name])), [people]);
    const voiceReadyOf = useMemo(() => new Set(people.filter(p => p.voiceReady).map(p => p.id)), [people]);

    const addTyped = () => {
        const n = typed.replace(/\s+/g, ' ').trim();
        if (!n || n.length > 80) return;
        if (!extra.some(x => x.toLowerCase() === n.toLowerCase())) onExtraChange([...extra, n]);
        setTyped('');
    };
    const count = selected.size + extra.length;

    return (
        <div>
            <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Who is present{count ? ` (${count})` : ''}</span>
            {count > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                    {[...selected].map(id => (
                        <button key={id} type="button" onClick={() => onToggle(id)} className="flex items-center gap-1 rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-bold text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300">
                            {voiceOn && voiceReadyOf.has(id) && <AudioLines className="h-3 w-3" aria-label="Voice ready" />}
                            {nameOf.get(id) || 'Former employee'} <X className="h-3 w-3" />
                        </button>
                    ))}
                    {extra.map(n => (
                        <button key={n} type="button" onClick={() => onExtraChange(extra.filter(x => x !== n))} className="flex items-center gap-1 rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-bold text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                            {n} <span className="font-semibold text-zinc-400">(typed)</span> <X className="h-3 w-3" />
                        </button>
                    ))}
                </div>
            )}
            <div className="relative mt-2">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search people or departments" className={`${field} pl-9`} />
            </div>
            <div className={`mt-2 overflow-y-auto rounded-xl border border-zinc-200 dark:border-zinc-800 ${listClassName}`}>
                {shown.length === 0 && <p className="p-3 text-xs font-semibold text-zinc-500">Nobody matches. Type the name below to add it.</p>}
                {shown.map(p => {
                    const on = selected.has(p.id);
                    return (
                        <button key={p.id} type="button" onClick={() => onToggle(p.id)} aria-pressed={on}
                            className={`flex w-full items-center gap-3 border-b border-zinc-100 px-3 py-2 text-left last:border-0 dark:border-zinc-800 ${on ? 'bg-indigo-50/60 dark:bg-indigo-950/30' : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/50'}`}>
                            <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border ${on ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-zinc-300 dark:border-zinc-600'}`}>{on && <Check className="h-3.5 w-3.5" strokeWidth={3} />}</span>
                            <span className="min-w-0 flex-1 truncate text-sm font-semibold text-zinc-800 dark:text-zinc-200">{p.name}</span>
                            {voiceOn && p.voiceReady && (
                                <span className="flex shrink-0 items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-black text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">
                                    <AudioLines className="h-3 w-3" /> Voice ready
                                </span>
                            )}
                            <span className="shrink-0 text-[11px] font-semibold text-zinc-400">{p.department || ''}</span>
                        </button>
                    );
                })}
            </div>
            <div className="mt-2 flex gap-2">
                <input value={typed} onChange={e => setTyped(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTyped(); } }}
                    placeholder="Someone not in the list? Type their name" maxLength={80} className={`${field} min-w-0 flex-1`} />
                <button type="button" onClick={addTyped} disabled={!typed.trim()} className="flex items-center gap-1 rounded-xl border border-zinc-300 px-3.5 text-sm font-bold text-zinc-700 hover:bg-zinc-50 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800">
                    <Plus className="h-4 w-4" /> Add
                </button>
            </div>
            <p className="mt-1.5 text-[11px] text-zinc-500">Typed names help the notes get names right, but tasks can only be sent to people in the Task Manager.</p>
        </div>
    );
}
