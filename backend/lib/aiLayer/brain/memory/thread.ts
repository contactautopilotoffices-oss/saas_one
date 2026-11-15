/**
 * The thread: everything the brain holds about one person's conversation, across channels. One per person per org.
 *
 * The state is stored as one JSON document and is NEVER trusted: it is re-parsed on every load, a proposal in it is
 * re-validated against the person's current access before it runs, and handles in it only ever point at records the
 * person was shown in this thread. Pure (the stores that read and write it live in server.ts).
 */
import { z } from 'zod';
import type { AttachmentRef, HandleKind, HandleRef } from '../types';

export const THREAD_IDLE_MS = 2 * 3600_000;       // after 2 quiet hours: open question, proposal and handles are dropped
export const HISTORY_MS = 24 * 3600_000;          // turns older than a day are not shown to the model
export const HISTORY_TURNS = 16;                  // 8 exchanges
export const CONFIRM_MS = 30 * 60_000;            // a proposal waits this long for its Yes

const handleRef = z.object({ kind: z.enum(['ticket', 'room', 'task', 'booking', 'attachment', 'person']), id: z.string().max(80), label: z.string().max(160), propertyId: z.string().uuid().nullish() }).strict();

const pendingAsk = z.object({ kind: z.literal('ask'), question: z.string().max(500), options: z.array(z.string().max(160)).max(8), at: z.string().max(40) }).strict();
const pendingConfirm = z.object({
    kind: z.literal('confirm'), opId: z.string().uuid(), skillId: z.string().max(64), payload: z.unknown(), card: z.string().max(2000),
    /** Fingerprint of what the person could do when the card was shown. A different one at Yes cancels the proposal. */
    scope: z.string().max(80), at: z.string().max(40),
}).strict();

export const threadStateSchema = z.object({
    lang: z.enum(['en', 'hi', 'hinglish']).optional(),
    handles: z.record(z.string().max(8), handleRef).default({}),
    pending: z.union([pendingAsk, pendingConfirm]).nullable().default(null),
    /** Questions asked in a row without the request moving forward. */
    askStreak: z.number().int().min(0).max(20).default(0),
    history: z.array(z.object({ role: z.enum(['user', 'assistant']), text: z.string().max(2000), at: z.string().max(40) }).strict()).max(40).default([]),
    lastActiveAt: z.string().max(40).optional(),
}).strict();

export type ThreadState = z.infer<typeof threadStateSchema>;
export type PendingConfirm = z.infer<typeof pendingConfirm>;
export const EMPTY_THREAD: ThreadState = threadStateSchema.parse({});

/** What was stored, cleaned up for this moment: unparseable → empty; idle too long → no pending and no handles. */
export function openThread(raw: unknown, now: Date): ThreadState {
    const parsed = threadStateSchema.safeParse(raw ?? {});
    if (!parsed.success) return { ...EMPTY_THREAD };
    const s = parsed.data;
    const t = now.getTime();
    const history = s.history.filter(h => t - Date.parse(h.at) <= HISTORY_MS).slice(-HISTORY_TURNS);
    const idle = !s.lastActiveAt || t - Date.parse(s.lastActiveAt) > THREAD_IDLE_MS;
    if (idle) return { ...s, history, pending: null, handles: {}, askStreak: 0 };
    const stale = s.pending?.kind === 'confirm' && t - Date.parse(s.pending.at) > CONFIRM_MS;
    return { ...s, history, pending: stale ? null : s.pending };
}

const PREFIX: Record<HandleKind, string> = { ticket: 'T', room: 'R', task: 'K', booking: 'B', attachment: 'A', person: 'P' };
const MAX_HANDLES = 60;

/** Handles for one turn, on top of the ones the thread already has. The same record always gets the same handle. */
export function handleBook(existing: Record<string, HandleRef>) {
    const handles: Record<string, HandleRef> = { ...existing };
    const issue = (kind: HandleKind, id: string, label: string, propertyId?: string | null): string => {
        for (const [h, ref] of Object.entries(handles)) if (ref.kind === kind && ref.id === id) { handles[h] = { ...ref, label, propertyId: propertyId ?? ref.propertyId ?? null }; return h; }
        const prefix = PREFIX[kind];
        const used = Object.keys(handles).filter(h => h.startsWith(prefix)).map(h => Number(h.slice(1))).filter(Number.isFinite);
        const h = `${prefix}${(used.length ? Math.max(...used) : 0) + 1}`;
        handles[h] = { kind, id, label: label.slice(0, 160), propertyId: propertyId ?? null };
        return h;
    };
    const resolve = (handle: string | null | undefined, kind: HandleKind): HandleRef | null => {
        if (!handle) return null;
        const ref = handles[handle.trim().toUpperCase()];
        return ref && ref.kind === kind ? ref : null;
    };
    /** Keeps the newest handles when a long conversation has collected too many. */
    const snapshot = (): Record<string, HandleRef> => Object.fromEntries(Object.entries(handles).filter(([, r]) => r.kind !== 'attachment').slice(-MAX_HANDLES));
    return { issue, resolve, snapshot, all: () => handles };
}

/** Open files are shown to the model under the handle stored on their row (A1, A2…), never under a path or URL. */
export function attachmentLine(a: AttachmentRef): string {
    const what = a.kind === 'image' ? 'photo' : a.kind;
    return `${a.handle} ${what}, received ${a.receivedAt.slice(11, 16)} UTC, ${a.caption ? `caption "${a.caption.replace(/\s+/g, ' ').slice(0, 80)}"` : 'no caption'}`;
}
