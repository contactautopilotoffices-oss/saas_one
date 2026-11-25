'use client';

/**
 * Owner 2026-11-24 — the page behind /meet/<id>/notes: where the online meeting sends people after the call.
 * The Meeting Assistant is a tab inside several dashboards, so this page shows the same notes screen (MeetingReview)
 * on its own. Which Meeting Assistant the meeting belongs to comes from the join info; someone who cannot see that
 * Meeting Assistant (an attendee from another team) is told the notes are with the organiser.
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import MeetingReview from './MeetingReview';
import { call, type MeetingSpace } from './api';

type JoinInfo = { meeting: { id: string; title: string; space?: MeetingSpace; canSeeNotes?: boolean } };

export default function MeetingNotesPage({ meetingId }: { meetingId: string }) {
    const router = useRouter();
    const [info, setInfo] = useState<JoinInfo['meeting'] | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let live = true;
        void call<JoinInfo>(`/api/task-manager/meetings/${encodeURIComponent(meetingId)}/join`).then(r => {
            if (!live) return;
            if (!r.ok) { setError(r.error); return; }
            setInfo(r.meeting);
        });
        return () => { live = false; };
    }, [meetingId]);

    const back = () => router.push('/');

    return (
        <main data-meeting-surface className="min-h-screen bg-zinc-50 px-4 py-6 text-zinc-900 sm:py-10 dark:bg-zinc-950 dark:text-zinc-100">
            {!info && !error && (
                <p className="mx-auto flex max-w-4xl items-center gap-2 text-sm font-semibold text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading the meeting…</p>
            )}
            {error && <p className="mx-auto max-w-4xl rounded-xl bg-red-50 px-3 py-2 text-sm font-semibold text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</p>}
            {info && info.space && info.canSeeNotes !== false ? (
                <MeetingReview space={info.space} meetingId={meetingId} onBack={back} backLabel="Go to the app"
                    onContinueRecording={() => undefined} />
            ) : info ? (
                <div className="mx-auto max-w-md space-y-3 rounded-3xl border border-zinc-200 bg-white p-6 text-center dark:border-white/10 dark:bg-zinc-900">
                    <h1 className="text-lg font-black">{info.title}</h1>
                    <p className="text-sm text-zinc-500">The notes are made from the recording after the call. The organiser will find them in their Meeting Assistant.</p>
                    <button type="button" onClick={back} className="rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-black text-white hover:bg-indigo-500">Go to the app</button>
                </div>
            ) : null}
        </main>
    );
}
