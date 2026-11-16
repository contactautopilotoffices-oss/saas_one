'use client';

import React, { useEffect, useState } from 'react';
import { CheckCircle2, CloudUpload, Loader2, WifiOff } from 'lucide-react';
import type { MeetingSpace } from './api';
import { pendingMeetings, type PendingMeeting } from './pieceStore';
import { getUploader, type UploadProgress } from './uploader';

/**
 * Owner 2026-11-13: the recovery banner. Audio pieces a previous page left on this phone (the tab was closed, the phone
 * died, the signal went) are uploaded from here, with the meeting's name and a live count, the moment the Meeting
 * Assistant is opened again. Shown above the meeting list, and on a meeting that is still open for recording (where
 * "Finish and make notes" waits for it). Rows disappear when their pieces are up, or when the server says the meeting
 * no longer takes audio.
 *
 * `onlyMeetingId`: show just that meeting (the review screen). `onPendingChange`: how many pieces are still waiting
 * for that meeting, so the caller can hold the Finish button.
 */
export default function PendingUploads({ space, onlyMeetingId, onOpen, onPendingChange }: {
    space: MeetingSpace;
    onlyMeetingId?: string;
    onOpen?: (meetingId: string) => void;
    onPendingChange?: (pending: number) => void;
}) {
    const [rows, setRows] = useState<Array<PendingMeeting & { up: UploadProgress }>>([]);

    useEffect(() => {
        let live = true;
        const offs: Array<() => void> = [];
        void pendingMeetings().then(list => {
            if (!live) return;
            const mine = list.filter(m => m.space === space && (!onlyMeetingId || m.meetingId === onlyMeetingId));
            setRows(mine.map(m => ({ ...m, up: getUploader(m.meetingId, m.space).progress() })));
            for (const m of mine) {
                const u = getUploader(m.meetingId, m.space);
                offs.push(u.subscribe(p => {
                    if (!live) return;
                    setRows(rs => rs.map(r => (r.meetingId === m.meetingId ? { ...r, up: p } : r)));
                }));
                u.kick();
            }
            if (onlyMeetingId && !mine.length) onPendingChange?.(0);
        });
        return () => { live = false; offs.forEach(f => f()); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [space, onlyMeetingId]);

    useEffect(() => {
        if (!onlyMeetingId) return;
        const r = rows.find(x => x.meetingId === onlyMeetingId);
        onPendingChange?.(r ? r.up.pending : 0);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [rows, onlyMeetingId]);

    const shown = rows.filter(r => r.up.state !== 'closed');
    if (!shown.length) return null;

    return (
        <div className="space-y-2">
            {shown.map(r => {
                const done = r.up.pending === 0 && r.up.state !== 'idle';
                const trouble = r.up.state === 'offline' || r.up.state === 'retrying';
                return (
                    <div key={r.meetingId} role="status"
                        className={`flex flex-wrap items-center gap-3 rounded-2xl border px-4 py-3 text-sm ${done
                            ? 'border-emerald-200 bg-emerald-50/70 dark:border-emerald-900 dark:bg-emerald-950/20'
                            : 'border-amber-200 bg-amber-50/70 dark:border-amber-900 dark:bg-amber-950/20'}`}>
                        {done ? <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" />
                            : trouble ? <WifiOff className="h-5 w-5 shrink-0 text-amber-600" />
                                : <Loader2 className="h-5 w-5 shrink-0 animate-spin text-amber-600" />}
                        <div className="min-w-0 flex-1">
                            <p className="truncate font-bold text-zinc-800 dark:text-zinc-200">
                                <CloudUpload className="mr-1 inline h-3.5 w-3.5 text-zinc-500" />
                                {done ? `${r.title}: the audio from this phone has been uploaded.` : `${r.title}: ${r.up.pending} piece${r.up.pending === 1 ? '' : 's'} of audio still on this phone`}
                            </p>
                            <p className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">
                                {done ? 'Open the meeting and press "Finish and make notes" if you have not already.'
                                    : r.up.state === 'offline' ? 'No connection. Uploading resumes by itself when the phone is back online — keep the app open.'
                                        : r.up.state === 'retrying' ? 'The upload is having trouble; trying again. Keep the app open.'
                                            : 'Uploading now. Keep the app open until this disappears.'}
                            </p>
                        </div>
                        {onOpen && !onlyMeetingId && (
                            <button type="button" onClick={() => onOpen(r.meetingId)} className="rounded-xl border border-zinc-300 bg-white px-3 py-1.5 text-xs font-bold text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800">
                                Open
                            </button>
                        )}
                    </div>
                );
            })}
        </div>
    );
}
