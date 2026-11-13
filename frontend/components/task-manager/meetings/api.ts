'use client';

/** Owner 2026-10-29 — Meeting Notes → Tasks (Tech dashboard "Meetings" tab). The server decides everything. */

export type MeetingStatus = 'recording' | 'uploaded' | 'transcribing' | 'identifying' | 'extracting' | 'ready' | 'failed' | 'discarded';
export const PROCESSING: MeetingStatus[] = ['uploaded', 'transcribing', 'identifying', 'extracting'];

/** `voiceReady` (LiveVoice ID): the person has set up their voice, so it can be recognised in meetings */
export interface MeetingPerson { id: string; name: string; department: string | null; voiceReady?: boolean }

export interface MeetingListItem {
    id: string; title: string; meetingDate: string; status: MeetingStatus; error: string | null; confidential: boolean;
    durationSeconds: number | null; createdAt: string; createdByName: string; mine: boolean; peopleCount: number;
    tasks: { total: number; sent: number };
}

/** `speakerUserId` set = the voice was recognised and `speaker` is the person's name; `voiceLabel` = "Speaker 2" as heard */
export interface TranscriptLine { speaker: string | null; start: number; end: number; text: string; speakerUserId?: string | null; voiceLabel?: string | null }

/** LiveVoice ID: what happened to voice naming for this meeting (null for meetings from before it existed) */
export interface VoiceSummary { state: 'pending' | 'done' | 'skipped'; reason: string | null; matched: number; voices: number }

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
    recording?: { missingPieces: number; missingSeconds: number; autoFinished: boolean } | null;
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
    recording: 'Recording', uploaded: 'Processing', transcribing: 'Turning speech into text', identifying: 'Recognising voices', extracting: 'Writing notes and tasks',
    ready: 'Ready', failed: 'Failed', discarded: 'Deleted',
};
