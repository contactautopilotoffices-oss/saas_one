'use client';

/** Owner 2026-10-29 — Meeting Notes → Tasks (Tech dashboard "Meetings" tab). The server decides everything. */

export type MeetingStatus = 'recording' | 'uploaded' | 'transcribing' | 'extracting' | 'ready' | 'failed' | 'discarded';
export const PROCESSING: MeetingStatus[] = ['uploaded', 'transcribing', 'extracting'];

export interface MeetingPerson { id: string; name: string; department: string | null }

export interface MeetingListItem {
    id: string; title: string; meetingDate: string; status: MeetingStatus; error: string | null; confidential: boolean;
    durationSeconds: number | null; createdAt: string; createdByName: string; mine: boolean; peopleCount: number;
    tasks: { total: number; sent: number };
}

export interface TranscriptLine { speaker: string | null; start: number; end: number; text: string }

export interface MeetingDetail {
    id: string; title: string; meetingDate: string; status: MeetingStatus; error: string | null; confidential: boolean;
    durationSeconds: number | null; mine: boolean; createdAt: string;
    attendees: Array<{ id: string; name: string }>; extraNames: string[];
    transcript: TranscriptLine[];
    summary: { summary: string; notes: Array<{ topic: string; points: string[] }>; decisions: string[]; openQuestions: string[] } | null;
    provider: string | null; canRetry: boolean;
    /** Last "Send notes on WhatsApp" */
    notesSentAt: string | null; notesSentCount: number | null;
}

export interface MeetingTask {
    /** `ownerName` is the name as heard; `ownerUserIds` / `ownerNames` are the people it is for (one or several) */
    id: string; title: string; note: string | null; ownerName: string | null; ownerUserIds: string[]; ownerNames: string[];
    dueDate: string | null; dueTime: string | null; quote: string | null; quoteAtSeconds: number | null; quoteFound: boolean | null;
    source: 'ai' | 'manual'; status: 'draft' | 'sending' | 'sent' | 'deleted'; sentAt: string | null; error: string | null;
}

/** Owner 2026-10-29: who the tasks are sent from */
export type SendAs = 'autopilot' | 'me';

export type Result<T = Record<string, unknown>> = ({ ok: true } & T) | { ok: false; error: string; code?: string };

export async function call<T = Record<string, unknown>>(url: string, body?: Record<string, unknown>): Promise<Result<T>> {
    try {
        const res = await fetch(url, body
            ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
            : { cache: 'no-store' });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success) return { ok: false, error: data.error || 'That did not work', code: data.code };
        return { ok: true, ...(data as T) };
    } catch {
        return { ok: false, error: 'Could not reach the server. Please check the connection and try again.' };
    }
}

/** Owner 2026-10-29: which dashboard the Meeting Assistant is in — each has its own meetings */
export type MeetingSpace = 'tech' | 'hr' | 'admin';
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
    recording: 'Recording', uploaded: 'Processing', transcribing: 'Turning speech into text', extracting: 'Writing notes and tasks',
    ready: 'Ready', failed: 'Failed', discarded: 'Deleted',
};
