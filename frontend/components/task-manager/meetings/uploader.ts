'use client';

import { createClient } from '@/frontend/utils/supabase/client';
import { call, meetingUrl, type MeetingSpace } from './api';
import { forgetMeeting, pendingPieces, removePiece, type StoredPiece } from './pieceStore';

/**
 * Owner 2026-11-13: uploads a meeting's audio pieces from the phone's safety copy (pieceStore.ts) to private storage,
 * in order, and never gives up while the page is open.
 *
 * What changed from the first version (inside MeetingRecorder):
 *   - Every request has a time limit. A request that hangs on a weak 5G link used to block the upload for ever ("Saving
 *     the last pieces…" for 18 minutes); now it is dropped and tried again.
 *   - One piece needs ONE round trip: upload links come from our API twenty at a time and are kept until used, so a
 *     retry is a single PUT to storage and does not depend on our server being reachable.
 *   - The moment the connection comes back (`online`), the next try starts; waits between tries are short (max 15 s).
 *   - A piece is removed from the phone only after storage has confirmed it.
 *   - One uploader per meeting, shared by the recorder and the recovery banner, so two screens never upload the same
 *     piece twice. `stop()` only pauses it (the pieces stay on the phone); `kick()` starts it again.
 *   - If the server says the meeting no longer takes audio (finished, deleted), the leftover pieces are removed and the
 *     uploader closes — late audio must never be pushed into a meeting that has moved on.
 */

const URL_BATCH = 20;
/** A signed upload link is good for 2 hours; stop using it well before that. */
const URL_SAFE_MS = 90 * 60 * 1000;
const URL_CALL_TIMEOUT_MS = 20_000;
/** Time allowed for one PUT: a base plus 1 s per 10 KB (a 15-second piece is ~45 KB; a 100 MB file gets the 10-minute cap). */
const PUT_BASE_MS = 30_000;
const PUT_MS_PER_BYTE = 1 / 10;
const PUT_MAX_MS = 10 * 60 * 1000;
const RETRY_MIN_MS = 2_000;
const RETRY_MAX_MS = 15_000;

export type UploadState = 'idle' | 'uploading' | 'retrying' | 'offline' | 'done' | 'closed';

export interface UploadProgress {
    /** Pieces on this phone the server has not confirmed yet */
    pending: number;
    /** Pieces confirmed since this uploader was made */
    uploaded: number;
    state: UploadState;
    /** While retrying: what went wrong last time, in plain words */
    problem: string | null;
    /** When the last piece got through (null: none yet) */
    lastOkAt: number | null;
    /** When the trouble started (null: none) */
    failingSince: number | null;
    /** Set once the server said this meeting no longer takes audio */
    closed: 'finished' | 'gone' | null;
}

export interface Uploader {
    /** A piece already saved to the phone: upload it (in order). */
    add(piece: StoredPiece): void;
    /** Start, or carry on, uploading whatever is pending (also what an earlier page left on the phone). */
    kick(): void;
    /** Resolves when nothing is pending, the uploader was closed by the server, or `stop()` was called. */
    wait(): Promise<void>;
    /** Pause (the page is going away). Pieces stay on the phone; `kick()` resumes. */
    stop(): void;
    /** Throw away every piece of this meeting, on the phone and in memory (Start over / Delete meeting). */
    clear(): Promise<void>;
    subscribe(fn: (p: UploadProgress) => void): () => void;
    progress(): UploadProgress;
}

type UploadLink = { signedUrl: string; path: string; token: string; bucket: string; contentType: string; until: number };

class Closed extends Error { constructor(public readonly why: 'finished' | 'gone') { super(why); } }

const uploaders = new Map<string, Uploader>();
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

/** The one uploader for a meeting (made on first use). */
export function getUploader(meetingId: string, space: MeetingSpace): Uploader {
    let u = uploaders.get(meetingId);
    if (!u) { u = makeUploader(meetingId, space); uploaders.set(meetingId, u); }
    return u;
}

function makeUploader(meetingId: string, space: MeetingSpace): Uploader {
    const url = meetingUrl(meetingId, space);
    let queue: StoredPiece[] = [];
    let loaded = false;
    let running = false;
    let stopped = false;
    const links = new Map<string, UploadLink>();
    const listeners = new Set<(p: UploadProgress) => void>();
    const waiters = new Set<() => void>();
    let wakeUp: (() => void) | null = null;
    let supabase: ReturnType<typeof createClient> | null = null;
    const progress: UploadProgress = { pending: 0, uploaded: 0, state: 'idle', problem: null, lastOkAt: null, failingSince: null, closed: null };

    const emit = (patch: Partial<UploadProgress>) => {
        Object.assign(progress, patch, { pending: queue.length });
        for (const fn of listeners) fn({ ...progress });
        if (!queue.length || progress.closed || stopped) { for (const w of waiters) w(); waiters.clear(); }
    };

    const onOnline = () => { wakeUp?.(); };
    if (typeof window !== 'undefined') window.addEventListener('online', onOnline);

    /** Waits `ms`, or less if the connection comes back or the uploader is stopped. */
    const pause = async (ms: number) => {
        await new Promise<void>(resolve => {
            const t = setTimeout(resolve, ms);
            wakeUp = () => { clearTimeout(t); resolve(); };
        });
        wakeUp = null;
    };

    const dedupe = (list: StoredPiece[]) => {
        const seen = new Set<string>();
        return list.filter(p => (seen.has(p.key) ? false : (seen.add(p.key), true))).sort((a, b) => a.segment - b.segment || a.seq - b.seq);
    };

    /** The upload link for a piece: from the batch fetched earlier, or a fresh batch of twenty starting at this piece. */
    const linkFor = async (p: StoredPiece): Promise<UploadLink> => {
        const have = links.get(p.key);
        if (have && have.until > Date.now()) return have;
        const r = await call<{ bucket: string; contentType: string; urls: Array<{ seq: number; path: string; token: string; signedUrl: string }> }>(
            url, { action: 'upload_urls', segment: p.segment, from: p.seq, count: URL_BATCH, mimeType: p.mime }, { timeoutMs: URL_CALL_TIMEOUT_MS });
        if (!r.ok) {
            if (r.code === 'FINISHED') throw new Closed('finished');
            if (r.code === 'NOT_FOUND') throw new Closed('gone');
            throw new Error(r.error);
        }
        const until = Date.now() + URL_SAFE_MS;
        for (const u of r.urls) links.set(`${meetingId}/${p.segment}/${u.seq}`, { signedUrl: u.signedUrl, path: u.path, token: u.token, bucket: r.bucket, contentType: r.contentType, until });
        const link = links.get(p.key);
        if (!link) throw new Error('No upload link was given for this piece.');
        return link;
    };

    /** PUT straight to storage with a time limit; the library call (no time limit) is the fallback if storage refuses the plain request. */
    const put = async (p: StoredPiece, link: UploadLink) => {
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), Math.min(PUT_MAX_MS, PUT_BASE_MS + p.bytes * PUT_MS_PER_BYTE));
        try {
            const body = new FormData();
            body.append('cacheControl', '3600');
            body.append('', p.blob);
            const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
            const res = await fetch(link.signedUrl, { method: 'PUT', body, signal: ctl.signal, headers: { apikey: anon, authorization: `Bearer ${anon}`, 'x-upsert': 'true' } });
            if (res.ok) return;
            if (res.status === 401 || res.status === 403) {
                // The plain request was not accepted: let the storage library do it the way it always has
                supabase ??= createClient();
                const { error } = await supabase.storage.from(link.bucket).uploadToSignedUrl(link.path, link.token, p.blob, { contentType: link.contentType, upsert: true });
                if (error) { links.delete(p.key); throw new Error(error.message); }
                return;
            }
            links.delete(p.key);
            throw new Error(`Storage answered ${res.status}`);
        } finally {
            clearTimeout(timer);
        }
    };

    const drain = async () => {
        if (running) return;
        running = true;
        try {
            if (!loaded) {
                queue = dedupe([...(await pendingPieces(meetingId)), ...queue]);
                loaded = true;
            }
            let delay = RETRY_MIN_MS;
            while (!stopped && queue.length && !progress.closed) {
                const p = queue[0];
                emit({ state: 'uploading' });
                try {
                    await put(p, await linkFor(p));
                    await removePiece(p.key);
                    queue.shift();
                    delay = RETRY_MIN_MS;
                    emit({ uploaded: progress.uploaded + 1, lastOkAt: Date.now(), failingSince: null, problem: null, state: queue.length ? 'uploading' : 'done' });
                } catch (err) {
                    if (err instanceof Closed) {
                        queue = [];
                        await forgetMeeting(meetingId);
                        uploaders.delete(meetingId);
                        emit({ state: 'closed', closed: err.why, problem: null });
                        break;
                    }
                    const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
                    emit({ state: offline ? 'offline' : 'retrying', problem: err instanceof Error ? err.message : 'Upload failed', failingSince: progress.failingSince ?? Date.now() });
                    await pause(delay + Math.floor(Math.random() * 1000));
                    delay = Math.min(delay * 2, RETRY_MAX_MS);
                }
            }
            if (!queue.length && !progress.closed) emit({ state: 'done', problem: null, failingSince: null });
        } finally {
            running = false;
            emit({});
        }
    };

    return {
        add(piece) {
            queue = dedupe([...queue, piece]);
            stopped = false;
            emit({});
            void drain();
        },
        kick() {
            stopped = false;
            void drain();
        },
        wait() {
            if (!queue.length && loaded || progress.closed || stopped) return Promise.resolve();
            return new Promise<void>(resolve => { waiters.add(resolve); void drain(); });
        },
        stop() {
            stopped = true;
            wakeUp?.();
            emit({});
        },
        async clear() {
            stopped = true;
            wakeUp?.();
            while (running) await sleep(100);
            queue = [];
            links.clear();
            await forgetMeeting(meetingId);
            uploaders.delete(meetingId);
            if (typeof window !== 'undefined') window.removeEventListener('online', onOnline);
            emit({ state: 'idle', problem: null, failingSince: null });
        },
        subscribe(fn) {
            listeners.add(fn);
            fn({ ...progress, pending: queue.length });
            return () => { listeners.delete(fn); };
        },
        progress() {
            return { ...progress, pending: queue.length };
        },
    };
}
