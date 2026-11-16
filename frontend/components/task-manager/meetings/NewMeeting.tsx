'use client';

import React, { useMemo, useRef, useState } from 'react';
import { AudioLines, Loader2, Lock, Mic, Upload, X } from 'lucide-react';
import { call, meetingsUrl, type MeetingPerson, type MeetingSpace } from './api';
import PeoplePicker from './PeoplePicker';
import VoiceServerStatus from '../voice/VoiceServerStatus';
import { useVoiceInfo } from '../voice/voiceApi';

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
    const [confidential, setConfidential] = useState(false);
    const [busy, setBusy] = useState<'record' | 'upload' | null>(null);
    const [error, setError] = useState<string | null>(null);
    const fileInput = useRef<HTMLInputElement>(null);
    // LiveVoice ID (owner 2026-11-02): the people picked here are the voices compared. Shown only when the person
    // starting the meeting has voice recognition ON for their department.
    const voice = useVoiceInfo();
    const voiceOn = voice.info?.meetingVoiceOn === true;

    const toggle = (id: string) => setSelected(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

    const start = async (file: File | null) => {
        if (busy) return;
        setError(null);
        setBusy(file ? 'upload' : 'record');
        const r = await call<{ id: string }>(meetingsUrl(space), { title, attendeeIds: [...selected], extraNames: extra, confidential });
        setBusy(null);
        if (!r.ok) { setError(r.error); return; }
        onStarted(r.id, title.trim(), file);
    };

    const voiceReadyOf = useMemo(() => new Set(people.filter(p => p.voiceReady).map(p => p.id)), [people]);
    const readyPicked = [...selected].filter(id => voiceReadyOf.has(id)).length;

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
                {/* Owner 2026-11-13: the same picker is used to add people during and after the meeting */}
                <PeoplePicker people={people} selected={selected} extra={extra} onToggle={toggle} onExtraChange={setExtra} voiceOn={voiceOn} />

                {voiceOn && (
                    <div className="mt-3 space-y-1.5 rounded-xl border border-emerald-200 bg-emerald-50/50 px-3 py-2.5 dark:border-emerald-900 dark:bg-emerald-950/20">
                        <p className="flex items-center gap-1.5 text-xs font-bold text-emerald-900 dark:text-emerald-200">
                            <AudioLines className="h-3.5 w-3.5" />
                            {selected.size
                                ? `${readyPicked} of ${selected.size} people picked can be recognised by voice.`
                                : 'Pick who is present: people with "Voice ready" will be named in the transcript.'}
                        </p>
                        {selected.size > readyPicked && (
                            <p className="text-[11px] text-emerald-800/80 dark:text-emerald-300/80">The others show as &ldquo;Speaker N&rdquo;. They can set up their voice in Settings → My voice.</p>
                        )}
                        {extra.length > 0 && <p className="text-[11px] text-emerald-800/80 dark:text-emerald-300/80">Typed names cannot be recognised by voice.</p>}
                        <VoiceServerStatus state={voice.info?.server.state ?? null} loading={voice.loading} onRefresh={() => void voice.refresh()} compact />
                    </div>
                )}
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
