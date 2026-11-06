'use client';

import React, { useEffect, useState } from 'react';
import { Check, ChevronRight, Loader2, Lock, Mic, Pencil, Plus, Users } from 'lucide-react';
import MeetingRecorder from './MeetingRecorder';
import MeetingReview from './MeetingReview';
import NewMeeting from './NewMeeting';
import { PROCESSING, STATUS_LABEL, call, clock, meetingUrl, meetingsUrl, niceDate, type MeetingListItem, type MeetingPerson, type MeetingSpace } from './api';

/**
 * Owner 2026-10-29: the Tech dashboard's "Meetings" tab. The Tech team runs the meeting: they record it on one phone,
 * the notes and the task list are written for them, and they press Send to give each task to the right person
 * ("from Autopilot"). Plan: docs/MEETING_TASKS_SPEC.md
 */

type View =
    | { kind: 'list' }
    | { kind: 'new' }
    | { kind: 'record'; id: string; title: string; file: File | null }
    | { kind: 'review'; id: string };

const STATUS_STYLE: Record<string, string> = {
    recording: 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300',
    ready: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
    failed: 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300',
};

export default function MeetingsTab({ space }: { space: MeetingSpace }) {
    const [view, setView] = useState<View>({ kind: 'list' });
    const [meetings, setMeetings] = useState<MeetingListItem[] | null>(null);
    const [people, setPeople] = useState<MeetingPerson[]>([]);
    const [error, setError] = useState<string | null>(null);
    /** The meeting being renamed from the list, and its new name */
    const [renaming, setRenaming] = useState<{ id: string; title: string } | null>(null);
    const [savingName, setSavingName] = useState(false);

    /** Same "rename" action as inside a meeting; the list is updated in place on success */
    const saveName = async () => {
        if (!renaming || !renaming.title.trim() || savingName) return;
        setSavingName(true);
        const r = await call<{ title: string }>(meetingUrl(renaming.id, space), { action: 'rename', title: renaming.title });
        setSavingName(false);
        if (!r.ok) { setError(r.error); return; }
        setMeetings(list => list?.map(x => (x.id === renaming.id ? { ...x, title: r.title } : x)) ?? list);
        setError(null);
        setRenaming(null);
    };

    // (Re)load whenever the list is shown again, e.g. after coming back from a meeting
    useEffect(() => {
        if (view.kind !== 'list') return;
        let live = true;
        void call<{ meetings: MeetingListItem[]; people: MeetingPerson[] }>(meetingsUrl(space)).then(r => {
            if (!live) return;
            if (!r.ok) { setError(r.error); setMeetings(m => m ?? []); return; }
            setError(null);
            setMeetings(r.meetings);
            setPeople(r.people);
        });
        return () => { live = false; };
    }, [view.kind, space]);

    if (view.kind === 'new') {
        return <NewMeeting space={space} people={people} onCancel={() => setView({ kind: 'list' })} onStarted={(id, title, file) => setView({ kind: 'record', id, title, file })} />;
    }
    if (view.kind === 'record') {
        return <MeetingRecorder space={space} meetingId={view.id} title={view.title} file={view.file} onDone={() => setView({ kind: 'review', id: view.id })} onBack={() => setView({ kind: 'review', id: view.id })} onDiscarded={() => setView({ kind: 'list' })} />;
    }
    if (view.kind === 'review') {
        return <MeetingReview space={space} meetingId={view.id} onBack={() => setView({ kind: 'list' })} onContinueRecording={(id, title) => setView({ kind: 'record', id, title, file: null })} />;
    }

    return (
        <div className="mx-auto max-w-4xl space-y-5">
            <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                    <h2 className="text-xl font-black text-zinc-900 dark:text-zinc-100">Meeting Assistant</h2>
                    <p className="text-sm text-zinc-500">Record a meeting on this phone. You get the notes and a task list to send.</p>
                </div>
                <button type="button" onClick={() => setView({ kind: 'new' })} disabled={!!error && !meetings?.length}
                    className="flex items-center gap-2 rounded-2xl bg-red-600 px-5 py-3 text-sm font-black text-white shadow-sm hover:bg-red-700 disabled:opacity-50">
                    <Plus className="h-4 w-4" /> New meeting
                </button>
            </div>

            {error && <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">{error}</p>}

            {meetings === null ? (
                <p className="flex items-center gap-2 text-sm font-semibold text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>
            ) : meetings.length === 0 && !error ? (
                <div className="rounded-3xl border border-dashed border-zinc-300 p-10 text-center dark:border-zinc-700">
                    <Mic className="mx-auto h-8 w-8 text-zinc-300" />
                    <p className="mt-3 text-sm font-semibold text-zinc-600 dark:text-zinc-300">No meetings yet.</p>
                    <p className="text-xs text-zinc-500">Press &ldquo;New meeting&rdquo; when the next one starts.</p>
                </div>
            ) : (
                <ul className="space-y-2">
                    {meetings.map(m => renaming?.id === m.id ? (
                        // Owner 2026-10-30: rename straight from the list
                        <li key={m.id}>
                            <form onSubmit={e => { e.preventDefault(); void saveName(); }}
                                className="flex flex-wrap items-center gap-2 rounded-2xl border border-indigo-300 bg-white p-3 shadow-sm dark:border-indigo-700 dark:bg-zinc-900">
                                <input autoFocus value={renaming.title} maxLength={150} aria-label="Meeting name"
                                    onChange={e => setRenaming({ id: m.id, title: e.target.value })}
                                    onKeyDown={e => { if (e.key === 'Escape') setRenaming(null); }}
                                    className="min-w-0 flex-1 rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm font-bold text-zinc-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100" />
                                <button type="submit" disabled={savingName || !renaming.title.trim()}
                                    className="flex h-9 items-center gap-1 rounded-xl bg-indigo-600 px-3 text-xs font-black text-white hover:bg-indigo-700 disabled:opacity-40">
                                    {savingName ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Save
                                </button>
                                <button type="button" onClick={() => setRenaming(null)} className="h-9 rounded-xl px-3 text-xs font-bold text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800">Cancel</button>
                            </form>
                        </li>
                    ) : (
                        <li key={m.id} className="flex items-stretch rounded-2xl border border-zinc-200 bg-white shadow-sm transition-colors hover:border-indigo-300 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-indigo-700">
                            <button type="button" onClick={() => setRenaming({ id: m.id, title: m.title })} aria-label={`Rename ${m.title}`} title="Rename"
                                className="order-last flex w-11 shrink-0 items-center justify-center rounded-r-2xl border-l border-zinc-100 text-zinc-400 hover:bg-zinc-50 hover:text-zinc-700 dark:border-zinc-800 dark:hover:bg-zinc-800 dark:hover:text-zinc-200">
                                <Pencil className="h-4 w-4" />
                            </button>
                            <button type="button" onClick={() => setView({ kind: 'review', id: m.id })}
                                className="flex min-w-0 flex-1 items-center gap-4 rounded-l-2xl p-4 text-left">
                                <div className="min-w-0 flex-1">
                                    <p className="flex items-center gap-1.5 truncate text-sm font-black text-zinc-900 dark:text-zinc-100">
                                        {m.confidential && <Lock className="h-3.5 w-3.5 shrink-0 text-zinc-400" aria-label="Confidential" />}
                                        <span className="truncate">{m.title}</span>
                                    </p>
                                    <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs font-semibold text-zinc-500">
                                        <span>{niceDate(m.meetingDate)}</span>
                                        {m.durationSeconds ? <span>· {clock(m.durationSeconds)}</span> : null}
                                        <span className="flex items-center gap-1">· <Users className="h-3 w-3" /> {m.peopleCount}</span>
                                        <span>· by {m.mine ? 'you' : m.createdByName}</span>
                                    </p>
                                </div>
                                <div className="flex shrink-0 flex-col items-end gap-1">
                                    <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-black ${STATUS_STYLE[m.status] || 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300'}`}>
                                        {PROCESSING.includes(m.status) ? 'Processing' : STATUS_LABEL[m.status]}
                                    </span>
                                    {m.status === 'ready' && <span className="text-[11px] font-semibold text-zinc-500">{m.tasks.sent}/{m.tasks.total} tasks sent</span>}
                                </div>
                                <ChevronRight className="h-4 w-4 shrink-0 text-zinc-400" />
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
