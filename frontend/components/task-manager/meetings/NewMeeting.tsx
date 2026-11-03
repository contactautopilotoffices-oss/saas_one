'use client';

import React, { useMemo, useRef, useState } from 'react';
import { Check, Loader2, Lock, Mic, Plus, Search, Upload, X } from 'lucide-react';
import { call, meetingsUrl, type MeetingPerson, type MeetingSpace } from './api';

/**
 * Owner 2026-10-29: start a meeting — its name, who is present (anyone in the Task Manager, from every department, plus
 * names typed in by hand), and whether it is confidential. Then record, or upload a recording made with another app.
 */
export default function NewMeeting({ space, people, onStarted, onCancel }: {
    space: MeetingSpace;
    people: MeetingPerson[];
    onStarted: (id: string, title: string, file: File | null) => void;
    onCancel: () => void;
}) {
    const today = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
    const [title, setTitle] = useState(`Meeting – ${today}`);
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [extra, setExtra] = useState<string[]>([]);
    const [typed, setTyped] = useState('');
    const [query, setQuery] = useState('');
    const [confidential, setConfidential] = useState(false);
    const [busy, setBusy] = useState<'record' | 'upload' | null>(null);
    const [error, setError] = useState<string | null>(null);
    const fileInput = useRef<HTMLInputElement>(null);

    const shown = useMemo(() => {
        const q = query.trim().toLowerCase();
        const list = q ? people.filter(p => p.name.toLowerCase().includes(q) || (p.department || '').toLowerCase().includes(q)) : people;
        return list.slice(0, 200);
    }, [people, query]);
    const nameOf = useMemo(() => new Map(people.map(p => [p.id, p.name])), [people]);

    const toggle = (id: string) => setSelected(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
    const addTyped = () => {
        const n = typed.replace(/\s+/g, ' ').trim();
        if (!n || n.length > 80) return;
        setExtra(e => (e.some(x => x.toLowerCase() === n.toLowerCase()) ? e : [...e, n]));
        setTyped('');
    };

    const start = async (file: File | null) => {
        if (busy) return;
        setError(null);
        setBusy(file ? 'upload' : 'record');
        const r = await call<{ id: string }>(meetingsUrl(space), { title, attendeeIds: [...selected], extraNames: extra, confidential });
        setBusy(null);
        if (!r.ok) { setError(r.error); return; }
        onStarted(r.id, title.trim(), file);
    };

    const count = selected.size + extra.length;

    return (
        <div className="mx-auto max-w-2xl space-y-5 rounded-3xl border border-zinc-200 bg-white p-5 shadow-sm sm:p-6 dark:border-zinc-800 dark:bg-zinc-900">
            <div className="flex items-center justify-between gap-3">
                <h2 className="text-lg font-black text-zinc-900 dark:text-zinc-100">New meeting</h2>
                <button type="button" onClick={onCancel} aria-label="Close" className="rounded-full p-2 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"><X className="h-5 w-5" /></button>
            </div>

            <label className="block">
                <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Meeting name</span>
                <input value={title} onChange={e => setTitle(e.target.value)} maxLength={150}
                    className="mt-1.5 w-full rounded-xl border border-zinc-300 bg-white px-3.5 py-2.5 text-sm text-zinc-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100" />
            </label>

            <div>
                <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Who is present{count ? ` (${count})` : ''}</span>
                {count > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                        {[...selected].map(id => (
                            <button key={id} type="button" onClick={() => toggle(id)} className="flex items-center gap-1 rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-bold text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300">
                                {nameOf.get(id)} <X className="h-3 w-3" />
                            </button>
                        ))}
                        {extra.map(n => (
                            <button key={n} type="button" onClick={() => setExtra(e => e.filter(x => x !== n))} className="flex items-center gap-1 rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-bold text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                                {n} <span className="font-semibold text-zinc-400">(typed)</span> <X className="h-3 w-3" />
                            </button>
                        ))}
                    </div>
                )}
                <div className="relative mt-2">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                    <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search people or departments"
                        className="w-full rounded-xl border border-zinc-300 bg-white py-2.5 pl-9 pr-3 text-sm text-zinc-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100" />
                </div>
                <div className="mt-2 max-h-60 overflow-y-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
                    {shown.length === 0 && <p className="p-3 text-xs font-semibold text-zinc-500">Nobody matches. Type the name below to add it.</p>}
                    {shown.map(p => {
                        const on = selected.has(p.id);
                        return (
                            <button key={p.id} type="button" onClick={() => toggle(p.id)} aria-pressed={on}
                                className={`flex w-full items-center gap-3 border-b border-zinc-100 px-3 py-2 text-left last:border-0 dark:border-zinc-800 ${on ? 'bg-indigo-50/60 dark:bg-indigo-950/30' : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/50'}`}>
                                <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border ${on ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-zinc-300 dark:border-zinc-600'}`}>{on && <Check className="h-3.5 w-3.5" strokeWidth={3} />}</span>
                                <span className="min-w-0 flex-1 truncate text-sm font-semibold text-zinc-800 dark:text-zinc-200">{p.name}</span>
                                <span className="shrink-0 text-[11px] font-semibold text-zinc-400">{p.department || ''}</span>
                            </button>
                        );
                    })}
                </div>
                <div className="mt-2 flex gap-2">
                    <input value={typed} onChange={e => setTyped(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTyped(); } }}
                        placeholder="Someone not in the list? Type their name" maxLength={80}
                        className="min-w-0 flex-1 rounded-xl border border-zinc-300 bg-white px-3.5 py-2.5 text-sm text-zinc-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100" />
                    <button type="button" onClick={addTyped} disabled={!typed.trim()} className="flex items-center gap-1 rounded-xl border border-zinc-300 px-3.5 text-sm font-bold text-zinc-700 hover:bg-zinc-50 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800">
                        <Plus className="h-4 w-4" /> Add
                    </button>
                </div>
                <p className="mt-1.5 text-[11px] text-zinc-500">Typed names help the notes get names right, but tasks can only be sent to people in the Task Manager.</p>
            </div>

            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
                <input type="checkbox" checked={confidential} onChange={e => setConfidential(e.target.checked)} className="mt-0.5 h-4 w-4 accent-indigo-600" />
                <span>
                    <span className="flex items-center gap-1.5 text-sm font-bold text-zinc-800 dark:text-zinc-200"><Lock className="h-3.5 w-3.5" /> Confidential</span>
                    <span className="text-xs text-zinc-500">Only you will be able to open this meeting&apos;s notes and transcript.</span>
                </span>
            </label>

            <p className="rounded-xl bg-zinc-50 px-3 py-2.5 text-xs font-semibold text-zinc-600 dark:bg-zinc-800/60 dark:text-zinc-300">
                Tell everyone the meeting is being recorded. The audio is deleted as soon as it has been turned into text; only the text is kept.
            </p>

            {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm font-semibold text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</p>}

            <div className="flex flex-col gap-2 sm:flex-row">
                <button type="button" onClick={() => void start(null)} disabled={!!busy || !title.trim()}
                    className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-red-600 px-5 py-3 text-sm font-black text-white hover:bg-red-700 disabled:opacity-50">
                    {busy === 'record' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mic className="h-4 w-4" />} Start recording
                </button>
                <button type="button" onClick={() => fileInput.current?.click()} disabled={!!busy || !title.trim()}
                    className="flex flex-1 items-center justify-center gap-2 rounded-2xl border border-zinc-300 px-5 py-3 text-sm font-bold text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800">
                    {busy === 'upload' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} Upload a recording
                </button>
                <input ref={fileInput} type="file" accept="audio/*,.m4a,.mp3,.wav,.ogg,.webm,.aac" className="hidden"
                    onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void start(f); }} />
            </div>
        </div>
    );
}
