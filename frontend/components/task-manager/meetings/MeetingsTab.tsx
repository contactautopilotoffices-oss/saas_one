'use client';

import React, { useEffect, useState } from 'react';
import { ChevronRight, Loader2, Lock, Mic, Plus, Users } from 'lucide-react';
import MeetingRecorder from './MeetingRecorder';
import MeetingReview from './MeetingReview';
import NewMeeting from './NewMeeting';
import { PROCESSING, STATUS_LABEL, call, clock, meetingsUrl, niceDate, type MeetingListItem, type MeetingPerson, type MeetingSpace } from './api';

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
        return <MeetingRecorder space={space} meetingId={view.id} title={view.title} file={view.file} onDone={() => setView({ kind: 'review', id: view.id })} onBack={() => setView({ kind: 'review', id: view.id })} />;
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
                    {meetings.map(m => (
                        <li key={m.id}>
                            <button type="button" onClick={() => setView({ kind: 'review', id: m.id })}
                                className="flex w-full items-center gap-4 rounded-2xl border border-zinc-200 bg-white p-4 text-left shadow-sm transition-colors hover:border-indigo-300 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-indigo-700">
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
