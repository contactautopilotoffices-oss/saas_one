import { randomUUID } from 'node:crypto';

/**
 * Smart chat — message batching (2026-11-02). Like PharmEasy's Swasth.AI: when a person sends several messages back to back
 * ("Hi" / "Hello" / "Can u help" / "Who are u"), the bot reads ALL of them together and sends ONE reply.
 *
 * How (no new library, no background job; the webhook already waits for the AI today):
 *   1. Each Smart chat text message is written to a small inbox table (whatsapp_smart_chat_inbox).
 *   2. Its webhook waits until the person has been quiet for QUIET_MS (never longer than MAX_WAIT_MS after their first
 *      message). If a NEWER message arrives meanwhile, this webhook stops ("deferred"): the newest one answers for all.
 *   3. The newest webhook claims every waiting message in ONE update (each row can be claimed only once, so two webhooks can
 *      never answer the same message) and the brain reads them as one turn, one line per message.
 *   4. While an earlier turn of the same person is still being answered (claimed, not finished), the next batch waits for it
 *      (at most BUSY_WAIT_MS), so it always sees the state that turn saved (a question it asked, a change it made).
 *
 * Safety: until the migration is applied (or on any database error) every function says 'unavailable' and the caller
 * answers the message alone, exactly as before. The text is blanked when the turn finishes; the conversation memory keeps
 * its own copy as before. Nothing here sends a message.
 */

export const INBOX_TABLE = 'whatsapp_smart_chat_inbox';
/** No new message for this long → answer. People type the next line within ~2 s; much longer feels like a slow bot. */
export const QUIET_MS = 2_500;
/** Never wait longer than this after the first waiting message, even if they keep typing. */
export const MAX_WAIT_MS = 7_000;
/** Wait at most this long for an earlier turn of the same person to finish. */
export const BUSY_WAIT_MS = 25_000;
const POLL_MS = 350;
/** Waiting messages older than this are ignored (a webhook that died long ago). */
const LOOKBACK_MS = 10 * 60_000;
/** A claimed turn not finished after this long is treated as dead (it never blocks for ever). */
const BUSY_STALE_MS = 60_000;
/** After the table is found missing, do not try again for this long (avoids a failing write on every message). */
const RETRY_AFTER_MISSING_MS = 5 * 60_000;

export interface InboxRow { message_id: string; body: string; received_at: string }

export interface InboxIO {
    /** 'ok' | 'missing' (table not there yet) | 'error' (anything else). Never throws. */
    insert(row: { phone: string; message_id: string; body: string; received_at: string }): Promise<'ok' | 'missing' | 'error'>;
    /** Unclaimed messages of this person since `since`, oldest first. null = could not read. */
    waiting(phone: string, since: string): Promise<InboxRow[] | null>;
    /** Is an earlier turn of this person claimed but not finished (claimed after `since`)? Errors → false. */
    busy(phone: string, since: string): Promise<boolean>;
    /** Claim every unclaimed message of this person since `since` (one update). Oldest first. null = could not claim. */
    claim(phone: string, token: string, since: string): Promise<InboxRow[] | null>;
    /** The turn is over: mark the claimed rows finished and blank their text. Never throws. */
    finish(token: string): Promise<void>;
    now(): number;
    sleep(ms: number): Promise<void>;
}

export type BatchOutcome =
    /** Batching is not available: answer this message alone, as before. */
    | { kind: 'unavailable' }
    /** A newer message's webhook answers for all of them (this one's text included). */
    | { kind: 'deferred' }
    /** This webhook answers. `texts` oldest first; call `finish(token)` when the turn is over. */
    | { kind: 'batch'; texts: string[]; messageIds: string[]; token: string };

const phoneKey = (phone: string) => String(phone || '').replace(/\D/g, '');
const iso = (ms: number) => new Date(ms).toISOString();

let missingUntil = 0;
/** False for a few minutes after the table was found missing (the caller then skips batching entirely). */
export function inboxMaybeAvailable(now = Date.now()): boolean { return now >= missingUntil; }
export function resetInboxAvailability(): void { missingUntil = 0; }

export async function collectBatch(p: { phone: string; messageId: string | null | undefined; text: string; io: InboxIO }): Promise<BatchOutcome> {
    const { io } = p;
    const phone = phoneKey(p.phone);
    if (!p.messageId || !phone || !inboxMaybeAvailable(io.now())) return { kind: 'unavailable' };
    const mine = p.messageId;
    const written = await io.insert({ phone, message_id: mine, body: p.text, received_at: iso(io.now()) });
    if (written === 'missing') missingUntil = io.now() + RETRY_AFTER_MISSING_MS;
    if (written !== 'ok') return { kind: 'unavailable' };

    const token = randomUUID();
    const started = io.now();
    const claimNow = async (): Promise<BatchOutcome> => {
        const rows = await io.claim(phone, token, iso(io.now() - LOOKBACK_MS));
        if (rows === null) return { kind: 'batch', texts: [p.text], messageIds: [mine], token };   // could not claim: answer this one alone
        // Mine was taken by another webhook a moment ago: nothing left → it answers. Anything this update did take (newer
        // messages) is now ours to answer: their own webhooks will find them claimed and stop.
        if (!rows.length) return { kind: 'deferred' };
        return { kind: 'batch', texts: rows.map(r => r.body), messageIds: rows.map(r => r.message_id), token };
    };

    for (;;) {
        await io.sleep(POLL_MS);
        const rows = await io.waiting(phone, iso(io.now() - LOOKBACK_MS));
        if (rows === null) return claimNow();
        if (!rows.some(r => r.message_id === mine)) return { kind: 'deferred' };          // already claimed by a newer webhook
        const newest = rows[rows.length - 1];
        if (newest.message_id !== mine) return { kind: 'deferred' };                       // a newer message will answer for all
        const now = io.now();
        const waited = now - started;
        if (waited >= BUSY_WAIT_MS) return claimNow();
        if (await io.busy(phone, iso(now - BUSY_STALE_MS))) continue;                     // an earlier turn is still being answered
        const quietFor = now - Date.parse(newest.received_at);
        const sinceFirst = now - Date.parse(rows[0].received_at);
        if (quietFor >= QUIET_MS || sinceFirst >= MAX_WAIT_MS) return claimNow();
    }
}

/** The messages as ONE turn for the brain: one line per message, in the order sent. */
export function joinBatch(texts: string[]): string {
    return texts.map(t => t.trim()).filter(Boolean).join('\n');
}

const MISSING = /does not exist|could not find the table|schema cache|42P01|PGRST205/i;

/** The real inbox (Supabase, service role). Loaded lazily so tests never touch the database. */
export async function defaultInboxIO(): Promise<InboxIO> {
    const { supabaseAdmin } = await import('@/backend/lib/supabase/admin');
    const warn = (what: string, err: unknown) =>
        console.warn(`[SmartChatInbox] ${what}:`, err instanceof Error ? err.message : (err as { message?: string })?.message || err);
    const missing = (err: { code?: string; message?: string } | null) => !!err && (MISSING.test(err.code || '') || MISSING.test(err.message || ''));
    return {
        async insert(row) {
            try {
                const { error } = await supabaseAdmin.from(INBOX_TABLE).upsert(row, { onConflict: 'message_id', ignoreDuplicates: true });
                if (!error) return 'ok';
                if (missing(error)) { warn('inbox table not found (apply the migration); batching is off', error); return 'missing'; }
                warn('insert failed', error); return 'error';
            } catch (err) { warn('insert failed', err); return 'error'; }
        },
        async waiting(phone, since) {
            try {
                const { data, error } = await supabaseAdmin.from(INBOX_TABLE).select('message_id, body, received_at')
                    .eq('phone', phone).is('claimed_by', null).gte('received_at', since).order('received_at', { ascending: true }).limit(20);
                if (error) { warn('read failed', error); return null; }
                return (data ?? []) as InboxRow[];
            } catch (err) { warn('read failed', err); return null; }
        },
        async busy(phone, since) {
            try {
                const { data, error } = await supabaseAdmin.from(INBOX_TABLE).select('message_id')
                    .eq('phone', phone).not('claimed_by', 'is', null).is('done_at', null).gte('claimed_at', since).limit(1);
                if (error) { warn('busy check failed', error); return false; }
                return (data ?? []).length > 0;
            } catch (err) { warn('busy check failed', err); return false; }
        },
        async claim(phone, token, since) {
            try {
                // ONE update: a row already claimed by another webhook no longer matches "claimed_by is null", so it is never
                // claimed twice.
                const { data, error } = await supabaseAdmin.from(INBOX_TABLE).update({ claimed_by: token, claimed_at: new Date().toISOString() })
                    .eq('phone', phone).is('claimed_by', null).gte('received_at', since).select('message_id, body, received_at');
                if (error) { warn('claim failed', error); return null; }
                return ((data ?? []) as InboxRow[]).sort((a, b) => a.received_at.localeCompare(b.received_at));
            } catch (err) { warn('claim failed', err); return null; }
        },
        async finish(token) {
            try {
                const { error } = await supabaseAdmin.from(INBOX_TABLE).update({ done_at: new Date().toISOString(), body: '' }).eq('claimed_by', token);
                if (error) warn('finish failed', error);
            } catch (err) { warn('finish failed', err); }
        },
        now: () => Date.now(),
        sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
    };
}
