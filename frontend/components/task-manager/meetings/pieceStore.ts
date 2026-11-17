'use client';

import type { MeetingSpace } from './api';

/**
 * Owner 2026-11-13: the phone's own safety copy of a recording (IndexedDB, no library).
 *
 * Before this, every audio piece lived only in the page's memory until it had been uploaded. A reload, a tab iOS threw
 * away, a crash or a long signal drop lost everything not yet uploaded — that is how the FMS Review meeting of 12 Nov
 * was lost. Now every piece is written HERE the moment the microphone hands it over, before any upload is tried, and
 * removed only after the server has confirmed it. Whatever happens to the page, the audio is still on the phone, and
 * the next time the Meeting Assistant is opened the pieces still waiting are uploaded (see uploader.ts).
 *
 * Two stores: `pieces` (one row per audio piece, with the Blob) and `meetings` (name + space of each meeting that has or
 * had pieces here, so the recovery banner can say which meeting the audio belongs to without asking the server).
 * All functions resolve quietly (`null`, `[]`, `false`) when IndexedDB is not available (very old browsers, some private
 * modes): recording then works as before, just without the safety copy, and the screen says so.
 */

const DB_NAME = 'meeting-assistant';
const DB_VERSION = 1;
const PIECES = 'pieces';
const MEETINGS = 'meetings';

export interface StoredPiece {
    /** `${meetingId}/${segment}/${seq}` */
    key: string;
    meetingId: string;
    segment: number;
    seq: number;
    mime: string;
    blob: Blob;
    bytes: number;
    createdAt: number;
}

export interface StoredMeeting {
    meetingId: string;
    space: MeetingSpace;
    title: string;
    updatedAt: number;
}

export interface PendingMeeting extends StoredMeeting { pieces: number; bytes: number }

export const pieceKey = (meetingId: string, segment: number, seq: number) => `${meetingId}/${segment}/${seq}`;

let dbPromise: Promise<IDBDatabase | null> | null = null;

function req<T>(r: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error ?? new Error('IndexedDB request failed'));
    });
}

function done(tx: IDBTransaction): Promise<void> {
    return new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
        tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
    });
}

/** Opens (and on first use creates) the database. Resolves to null where IndexedDB cannot be used. */
export function openStore(): Promise<IDBDatabase | null> {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise<IDBDatabase | null>(resolve => {
        try {
            if (typeof indexedDB === 'undefined') { resolve(null); return; }
            const open = indexedDB.open(DB_NAME, DB_VERSION);
            open.onupgradeneeded = () => {
                const db = open.result;
                if (!db.objectStoreNames.contains(PIECES)) {
                    const pieces = db.createObjectStore(PIECES, { keyPath: 'key' });
                    pieces.createIndex('meetingId', 'meetingId', { unique: false });
                }
                if (!db.objectStoreNames.contains(MEETINGS)) db.createObjectStore(MEETINGS, { keyPath: 'meetingId' });
            };
            open.onsuccess = () => {
                const db = open.result;
                // If another tab upgrades the database, let go of it; the next call opens it again
                db.onversionchange = () => { db.close(); dbPromise = null; };
                resolve(db);
            };
            open.onerror = () => resolve(null);
            open.onblocked = () => resolve(null);
        } catch {
            resolve(null);
        }
    });
    return dbPromise;
}

/** True when the safety copy can be kept on this phone. */
export async function storeAvailable(): Promise<boolean> {
    return (await openStore()) !== null;
}

/**
 * Asks the browser not to throw the safety copy away under storage pressure. Best effort: Chrome and Firefox honour it
 * for installed or often-used sites; Safari decides on its own. Never throws.
 */
export async function requestPersistence(): Promise<void> {
    try {
        const s = navigator.storage as (StorageManager & { persist?: () => Promise<boolean>; persisted?: () => Promise<boolean> }) | undefined;
        if (s?.persisted && s.persist && !(await s.persisted())) await s.persist();
    } catch { /* not supported: nothing to do */ }
}

/** Writes one piece. Returns false if it could not be saved (no IndexedDB, storage full). */
export async function savePiece(piece: StoredPiece): Promise<boolean> {
    const db = await openStore();
    if (!db) return false;
    try {
        const tx = db.transaction(PIECES, 'readwrite');
        tx.objectStore(PIECES).put(piece);
        await done(tx);
        return true;
    } catch {
        return false;
    }
}

/** The piece reached the server: remove the safety copy. */
export async function removePiece(key: string): Promise<void> {
    const db = await openStore();
    if (!db) return;
    try {
        const tx = db.transaction(PIECES, 'readwrite');
        tx.objectStore(PIECES).delete(key);
        await done(tx);
    } catch { /* a copy left behind is removed with the meeting later */ }
}

/** Every piece of a meeting still on the phone, in recording order (segment, then piece number). */
export async function pendingPieces(meetingId: string): Promise<StoredPiece[]> {
    const db = await openStore();
    if (!db) return [];
    try {
        const tx = db.transaction(PIECES, 'readonly');
        const rows = await req(tx.objectStore(PIECES).index('meetingId').getAll(IDBKeyRange.only(meetingId))) as StoredPiece[];
        return rows.sort((a, b) => a.segment - b.segment || a.seq - b.seq);
    } catch {
        return [];
    }
}

/** Remembers the meeting's name and space, so the recovery banner can label its pieces. */
export async function rememberMeeting(m: Omit<StoredMeeting, 'updatedAt'>): Promise<void> {
    const db = await openStore();
    if (!db) return;
    try {
        const tx = db.transaction(MEETINGS, 'readwrite');
        tx.objectStore(MEETINGS).put({ ...m, updatedAt: Date.now() } satisfies StoredMeeting);
        await done(tx);
    } catch { /* the banner will say "a meeting" instead of its name */ }
}

/** Removes the meeting's record and every piece of it (finished, deleted, or started over). */
export async function forgetMeeting(meetingId: string): Promise<void> {
    const db = await openStore();
    if (!db) return;
    try {
        const tx = db.transaction([PIECES, MEETINGS], 'readwrite');
        const pieces = tx.objectStore(PIECES);
        const keys = await req(pieces.index('meetingId').getAllKeys(IDBKeyRange.only(meetingId)));
        for (const k of keys) pieces.delete(k);
        tx.objectStore(MEETINGS).delete(meetingId);
        await done(tx);
    } catch { /* tried; nothing else to do */ }
}

/** The meetings that still have pieces on this phone (for the recovery banner), most recent first. */
export async function pendingMeetings(): Promise<PendingMeeting[]> {
    const db = await openStore();
    if (!db) return [];
    try {
        const tx = db.transaction([PIECES, MEETINGS], 'readonly');
        const [pieces, meetings] = await Promise.all([
            req(tx.objectStore(PIECES).getAll()) as Promise<StoredPiece[]>,
            req(tx.objectStore(MEETINGS).getAll()) as Promise<StoredMeeting[]>,
        ]);
        const byMeeting = new Map<string, { pieces: number; bytes: number }>();
        for (const p of pieces) {
            const c = byMeeting.get(p.meetingId) ?? { pieces: 0, bytes: 0 };
            c.pieces++; c.bytes += p.bytes;
            byMeeting.set(p.meetingId, c);
        }
        const known = new Map(meetings.map(m => [m.meetingId, m]));
        return [...byMeeting.entries()].map(([meetingId, c]) => {
            const m = known.get(meetingId);
            return { meetingId, space: m?.space ?? 'tech', title: m?.title ?? 'A meeting', updatedAt: m?.updatedAt ?? 0, ...c };
        }).sort((a, b) => b.updatedAt - a.updatedAt);
    } catch {
        return [];
    }
}
