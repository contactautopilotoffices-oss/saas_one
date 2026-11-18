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
    /** 2026-11-18: the person was already reminded once that this card is waiting (the reminder is never repeated). */
    reminded: z.boolean().optional(),
}).strict();

/** A topic the person closed ("cancel it", "no, leave it"). Never offered or brought up again unless they raise it. */
const closedTopic = z.object({ label: z.string().max(120), at: z.string().max(40) }).strict();

export const threadStateSchema = z.object({
    lang: z.enum(['en', 'hi', 'hinglish']).optional(),
    handles: z.record(z.string().max(8), handleRef).default({}),
    pending: z.union([pendingAsk, pendingConfirm]).nullable().default(null),
    /** Questions asked in a row without the request moving forward. */
    askStreak: z.number().int().min(0).max(20).default(0),
    history: z.array(z.object({ role: z.enum(['user', 'assistant']), text: z.string().max(2000), at: z.string().max(40) }).strict()).max(40).default([]),
    lastActiveAt: z.string().max(40).optional(),
    /**
     * 2026-11-18: a confirmation card that is still waiting while the brain asks about something else. Only ever set
     * while `pending` is a question; when that question is over, the card is the pending item again. A side question
     * no longer throws a card away (the owner's chat: "still waiting" was said about a card code had already dropped).
     */
    parked: pendingConfirm.nullable().default(null),
    /** 2026-11-18: topics the person closed, newest last, kept for a day. */
    closed: z.array(closedTopic).max(10).default([]),
    /**
     * 2026-11-18: was the brain's most recent reply the waiting card itself, or its Yes/Cancel reminder? A bare "yes"
     * confirms the card only then; otherwise the card is shown again first. Missing (threads saved before this change)
     * counts as true, which is how they behaved.
     */
    cardLast: z.boolean().optional(),
    /** 2026-11-18: save counter, so two turns saving at once can never silently overwrite each other (see mergeThreads). */
    rev: z.number().int().min(0).optional(),
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
    const closed = s.closed.filter(c => t - Date.parse(c.at) <= HISTORY_MS);
    const idle = !s.lastActiveAt || t - Date.parse(s.lastActiveAt) > THREAD_IDLE_MS;
    if (idle) return { ...s, history, closed, pending: null, parked: null, cardLast: false, handles: {}, askStreak: 0 };
    const stale = s.pending?.kind === 'confirm' && t - Date.parse(s.pending.at) > CONFIRM_MS;
    const parkedStale = !!s.parked && t - Date.parse(s.parked.at) > CONFIRM_MS;
    return { ...s, history, closed, pending: stale ? null : s.pending, parked: parkedStale ? null : s.parked, ...(stale ? { cardLast: false } : {}) };
}

/** The confirmation card waiting for the person's Yes or Cancel, whether it is in front or behind a question. */
export function waitingCard(s: ThreadState): PendingConfirm | null {
    return s.pending?.kind === 'confirm' ? s.pending : s.parked ?? null;
}

/**
 * Two turns of the same person finished at the same time and both want to save (2026-11-18: three quick messages each
 * ran a turn, and the last save wiped the other two exchanges). `latest` is what is stored now, `base` what this turn
 * started from, `ours` what this turn produced, `turnAt` its time. Nothing is lost: this turn's new exchanges go after
 * the stored ones. This turn's open question, card and closed topics win only where this turn changed them; whatever
 * the other turn changed is kept.
 */
export function mergeThreads(latestRaw: unknown, baseRaw: unknown, ours: ThreadState, turnAt: string): ThreadState {
    const parse = (raw: unknown) => { const p = threadStateSchema.safeParse(raw ?? {}); return p.success ? p.data : { ...EMPTY_THREAD }; };
    const latest = parse(latestRaw);
    const base = parse(baseRaw);
    const key = (h: ThreadState['history'][number]) => `${h.role}|${h.at}|${h.text}`;
    const known = new Set([...base.history, ...latest.history].map(key));
    const fresh = ours.history.filter(h => !known.has(key(h)) && h.at === turnAt);
    const history = [...latest.history, ...fresh].sort((a, b) => a.at.localeCompare(b.at)).slice(-HISTORY_TURNS);
    const closedSeen = new Set<string>();
    const closed = [...latest.closed, ...ours.closed].filter(c => { const k = `${c.label}|${c.at}`; if (closedSeen.has(k)) return false; closedSeen.add(k); return true; }).slice(-10);
    const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
    const changedOpen = !same(ours.pending, base.pending) || !same(ours.parked, base.parked);
    return {
        ...latest,
        lang: ours.lang ?? latest.lang,
        handles: { ...latest.handles, ...ours.handles },
        history,
        closed,
        ...(changedOpen ? { pending: ours.pending, parked: ours.parked, askStreak: ours.askStreak, cardLast: ours.cardLast } : {}),
        lastActiveAt: [latest.lastActiveAt, ours.lastActiveAt].filter((x): x is string => !!x).sort().at(-1),
        rev: latest.rev ?? 0,
    };
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
