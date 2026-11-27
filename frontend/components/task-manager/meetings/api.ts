'use client';

/** Owner 2026-10-29 — Meeting Notes → Tasks (Tech dashboard "Meetings" tab). The server decides everything. */

/** Owner 2026-11-18: 'scheduled' and 'live' are online meetings (video calls) before and during the call */
export type MeetingStatus = 'scheduled' | 'live' | 'recording' | 'uploaded' | 'transcribing' | 'identifying' | 'extracting' | 'ready' | 'failed' | 'discarded';
/** Owner 2026-11-18: 'room' = recorded on a phone in the room; 'online' = a video call with its own link */
export type MeetingKind = 'room' | 'online';
export const PROCESSING: MeetingStatus[] = ['uploaded', 'transcribing', 'identifying', 'extracting'];

/** `voiceReady` (LiveVoice ID): the person has set up their voice, so it can be recognised in meetings */
export interface MeetingPerson { id: string; name: string; department: string | null; voiceReady?: boolean }

export interface MeetingListItem {
    id: string; title: string; meetingDate: string; status: MeetingStatus; error: string | null; confidential: boolean;
    durationSeconds: number | null; createdAt: string; createdByName: string; mine: boolean; peopleCount: number;
    tasks: { total: number; sent: number };
    /** Absent from servers before 2026-11-18 (= 'room') */
    kind?: MeetingKind; scheduledFor?: string | null;
}

/** `speakerUserId` set = the voice was recognised and `speaker` is the person's name; `voiceLabel` = "Speaker 2" as heard */
export interface TranscriptLine { speaker: string | null; start: number; end: number; text: string; speakerUserId?: string | null; voiceLabel?: string | null }

/** LiveVoice ID: what happened to voice naming for this meeting (null for meetings from before it existed) */
export interface VoiceSummary { state: 'pending' | 'done' | 'skipped'; reason: string | null; matched: number; voices: number }

/** Optional contact details for typed external guests (stored on online meetings). */
export interface ExternalContact { name: string; phone?: string | null; email?: string | null }

export interface MeetingDetail {
    id: string; title: string; meetingDate: string; status: MeetingStatus; error: string | null; confidential: boolean;
    durationSeconds: number | null; mine: boolean; createdAt: string;
    attendees: Array<{ id: string; name: string }>; extraNames: string[];
    transcript: TranscriptLine[];
    summary: { summary: string; notes: Array<{ topic: string; points: string[] }>; decisions: string[]; openQuestions: string[] } | null;
    provider: string | null; canRetry: boolean;
    /** Last "Send notes on WhatsApp" */
    notesSentAt: string | null; notesSentCount: number | null;
    voice: VoiceSummary | null;
    /** Owner 2026-11-13: about the recording itself — pieces that never arrived, or nobody pressed Finish (null: not known) */
    recording?: { missingPieces: number; missingSeconds: number; autoFinished: boolean; elapsedSeconds: number; segments: number } | null;
    /** Owner 2026-11-18: online meetings — the link, the call's times and problems (the video is never recorded) */
    kind?: MeetingKind; scheduledFor?: string | null;
    online?: {
        joinPath: string; startedAt: string | null; endedAt: string | null; problem: string | null; joinedCount: number; guests?: GuestsView;
        externalContacts?: ExternalContact[]; linkSentAt?: string | null; linkSentCount?: number | null;
    } | null;
    /** Owner 2026-11-19: false when "Find tasks in this meeting" was unticked */
    findTasks?: boolean;
}

export interface MeetingTask {
    /** `ownerName` is the name as heard; `ownerUserIds` / `ownerNames` are the people it is for (one or several) */
    id: string; title: string; note: string | null; ownerName: string | null; ownerUserIds: string[]; ownerNames: string[];
    dueDate: string | null; dueTime: string | null; quote: string | null; quoteAtSeconds: number | null; quoteFound: boolean | null;
    source: 'ai' | 'manual'; status: 'draft' | 'sending' | 'sent' | 'deleted'; sentAt: string | null; error: string | null;
    /** Owner 2026-11-02: who it went out as — "Autopilot" or "Name (Department)"; null = not sent, or no longer known */
    sentAs: string | null;
    /** LiveVoice ID: who asked for it, when voices were recognised */
    askedByUserId?: string | null; askedByName?: string | null;
}

/** Owner 2026-10-29: who the tasks are sent from */
export type SendAs = 'autopilot' | 'me';

/** `details` (owner 2026-11-13): extra facts with some errors, e.g. how many pieces are missing (`PIECES_MISSING`) */
export type Result<T = Record<string, unknown>> = ({ ok: true } & T) | { ok: false; error: string; code?: string; details?: Record<string, unknown> };

export const OFFLINE_ERROR = 'Could not reach the server. Please check the connection and try again.';

/**
 * One call to the Meeting Assistant API. `timeoutMs` (owner 2026-11-13): a request that hangs on a bad mobile link is
 * given up after this long, so the caller can try again instead of waiting forever (the recorder passes it on every
 * call; a hung upload used to look like "Saving the last pieces…" for ever).
 */
export async function call<T = Record<string, unknown>>(url: string, body?: Record<string, unknown>, opts: { timeoutMs?: number } = {}): Promise<Result<T>> {
    const ctl = opts.timeoutMs ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => ctl.abort(), opts.timeoutMs) : null;
    try {
        const res = await fetch(url, body
            ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctl?.signal }
            : { cache: 'no-store', signal: ctl?.signal });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success) return { ok: false, error: data.error || 'That did not work', code: data.code, details: data.details };
        return { ok: true, ...(data as T) };
    } catch {
        return { ok: false, error: OFFLINE_ERROR, code: 'OFFLINE' };
    } finally {
        if (timer) clearTimeout(timer);
    }
}

/** Owner 2026-10-29: which dashboard the Meeting Assistant is in — each has its own meetings */
export type MeetingSpace = 'tech' | 'hr' | 'admin' | 'procurement' | 'design' | 'operations';
export const meetingsUrl = (space: MeetingSpace) => `/api/task-manager/meetings?space=${space}`;
export const meetingUrl = (id: string, space: MeetingSpace) => `/api/task-manager/meetings/${encodeURIComponent(id)}?space=${space}`;

export function clock(seconds: number | null | undefined): string {
    const s = Math.max(0, Math.floor(seconds ?? 0));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

export function niceDate(date: string): string {
    const d = new Date(`${date}T00:00:00`);
    return Number.isNaN(d.getTime()) ? date : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

export const STATUS_LABEL: Record<MeetingStatus, string> = {
    scheduled: 'Scheduled', live: 'Live now',
    recording: 'Recording', uploaded: 'Processing', transcribing: 'Turning speech into text', identifying: 'Recognising voices', extracting: 'Writing notes and tasks',
    ready: 'Ready', failed: 'Failed', discarded: 'Deleted',
};

/** Owner 2026-11-18: the full link to an online meeting, to copy and share */
export const joinLink = (path: string) => (typeof window === 'undefined' ? path : `${window.location.origin}${path}`);

/** "18 Nov, 3:30 pm" in the viewer's own time */
export function niceDateTime(iso: string | null | undefined): string {
    if (!iso) return '';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

/**
 * Stage 2 (owner 2026-11-18): people without a login. `path` is the meeting's one link (owner 2026-11-18: always on,
 * for everyone); anyone who may join can let the people waiting in, or refuse them.
 */
export interface GuestsView {
    path: string | null;
    list: Array<{ id: string; name: string; state: 'waiting' | 'admitted' | 'denied' | 'removed'; askedAt: string }>;
}
