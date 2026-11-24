import { AsyncLocalStorage } from 'node:async_hooks';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';

/**
 * Owner 2026-11-21 ("just perform and give an undo option", option A): while the WhatsApp task assistant carries out a
 * change, every WhatsApp message and app bell that change sends to someone is PARKED for 1 minute instead of going at once.
 * "undo" within that minute cancels them, so the other person never hears about it; after it, a job sends them through
 * the very same code as before (TaskMessagingService.sendMessage keeps its kill switches and Pretend Mode; taskBell its
 * matrix).
 *
 * How: the task assistant runs each change inside `withHold(actorId, …)` (brain/live.ts). TaskMessagingService.sendMessage
 * and taskBell ask `holdIfScoped` first; outside that scope (everything else in the app) they behave exactly as before.
 * Fails open: if the table is missing (migration 20261121000001 not run yet) or the insert fails, the message is sent at
 * once, as before, and undo still reverses the change itself.
 */

export const HOLD_MS = 60_000;
const TABLE = 'task_held_messages';
/** A row still "sending" after this long was cut off mid-send: it is marked failed, never sent twice. */
const STUCK_MS = 5 * 60_000;
const MAX_ATTEMPTS = 3;

export type HeldKind = 'whatsapp' | 'bell';
export interface HeldRow { id: string; actor_id: string; kind: HeldKind; payload: Record<string, unknown>; attempts: number }

const scope = new AsyncLocalStorage<{ actorId: string }>();

/** Run `fn` with messages to other people parked for 1 minute (fire-and-forget sends started inside it are parked too). */
export function withHold<T>(actorId: string, fn: () => Promise<T>): Promise<T> {
    return actorId ? scope.run({ actorId }, fn) : fn();
}

/** True while a change of the task assistant is being carried out (for tests and wording). */
export const holding = (): boolean => !!scope.getStore();

/** Parked → true (the caller must NOT send now). No scope, or the table is not there → false (send now, as before). */
export async function holdIfScoped(kind: HeldKind, payload: Record<string, unknown>, now = Date.now()): Promise<boolean> {
    const s = scope.getStore();
    if (!s) return false;
    try {
        const { error } = await supabaseAdmin.from(TABLE).insert({ actor_id: s.actorId, kind, payload, send_after: new Date(now + HOLD_MS).toISOString(), status: 'held' });
        if (error) { console.warn('[heldMessages] not parked, sending now:', error.message); return false; }
        return true;
    } catch (err) {
        console.warn('[heldMessages] not parked, sending now:', err instanceof Error ? err.message : err);
        return false;
    }
}

/** Is the table there? (Read-only; a missing table means messages go at once, so the bot must not promise a 1-minute wait.) */
let readyCache: { at: number; ok: boolean } | null = null;
export async function holdReady(now = Date.now()): Promise<boolean> {
    if (readyCache && now - readyCache.at < 5 * 60_000) return readyCache.ok;
    let ok = false;
    try { ok = !(await supabaseAdmin.from(TABLE).select('id', { head: true, count: 'exact' }).limit(1)).error; } catch { ok = false; }
    readyCache = { at: now, ok };
    return ok;
}

/**
 * For "undo": cancel this person's messages still parked since `since` (minus 10 s for clock differences), and say who was
 * ALREADY told (people whose app bell went out). Never throws: a failure counts as "nothing cancelled, nobody known".
 */
export async function cancelHeldSince(actorId: string, since: string): Promise<{ cancelled: number; toldUserIds: string[] }> {
    const from = new Date(new Date(since).getTime() - 10_000).toISOString();
    try {
        const { data: cancelled, error } = await supabaseAdmin.from(TABLE)
            .update({ status: 'cancelled', finished_at: new Date().toISOString() })
            .eq('actor_id', actorId).eq('status', 'held').gte('created_at', from).select('id');
        if (error) return { cancelled: 0, toldUserIds: [] };
        const { data: gone } = await supabaseAdmin.from(TABLE).select('payload')
            .eq('actor_id', actorId).eq('kind', 'bell').in('status', ['sending', 'sent']).gte('created_at', from);
        const toldUserIds = [...new Set((gone ?? []).map(r => String((r.payload as { userId?: unknown })?.userId ?? '')).filter(Boolean))];
        return { cancelled: (cancelled ?? []).length, toldUserIds };
    } catch {
        return { cancelled: 0, toldUserIds: [] };
    }
}

export interface ReleaseIO {
    /** Rows whose minute is up, claimed so no other run sends them too. */
    claimDue(now: Date, limit: number): Promise<HeldRow[]>;
    send(row: HeldRow): Promise<boolean>;
    finish(id: string, status: 'sent' | 'failed' | 'held', patch: { attempts: number; last_error?: string | null; send_after?: string }): Promise<void>;
    failStuck(before: Date): Promise<number>;
}

/** Send every parked message whose minute is up. A failed send is tried again next minute, up to 3 times. */
export async function releaseDue(io: ReleaseIO = defaultReleaseIO, now = new Date(), limit = 50): Promise<{ sent: number; failed: number; retried: number; stuck: number }> {
    const stuck = await io.failStuck(new Date(now.getTime() - STUCK_MS)).catch(() => 0);
    const rows = await io.claimDue(now, limit);
    let sent = 0, failed = 0, retried = 0;
    for (const row of rows) {
        const attempts = row.attempts + 1;
        let ok = false; let why: string | null = null;
        try { ok = await io.send(row); } catch (err) { why = err instanceof Error ? err.message : String(err); }
        if (ok) { sent++; await io.finish(row.id, 'sent', { attempts }).catch(() => undefined); continue; }
        if (attempts < MAX_ATTEMPTS) {
            retried++;
            await io.finish(row.id, 'held', { attempts, last_error: why ?? 'not delivered', send_after: new Date(now.getTime() + 60_000).toISOString() }).catch(() => undefined);
        } else {
            failed++;
            await io.finish(row.id, 'failed', { attempts, last_error: why ?? 'not delivered' }).catch(() => undefined);
        }
    }
    return { sent, failed, retried, stuck };
}

export const defaultReleaseIO: ReleaseIO = {
    async claimDue(now, limit) {
        const { data: due, error } = await supabaseAdmin.from(TABLE).select('id')
            .eq('status', 'held').lte('send_after', now.toISOString()).order('send_after', { ascending: true }).limit(limit);
        if (error || !due?.length) return [];
        // Claim: only rows still "held" move to "sending", so two runs at the same moment never send one message twice.
        const { data } = await supabaseAdmin.from(TABLE).update({ status: 'sending' })
            .in('id', due.map(r => r.id as string)).eq('status', 'held').select('id, actor_id, kind, payload, attempts');
        return (data ?? []) as HeldRow[];
    },
    async send(row) {
        const p = row.payload as Record<string, unknown>;
        if (row.kind === 'bell') {
            const { taskBell } = await import('./taskBell');
            await taskBell(p as unknown as Parameters<typeof taskBell>[0]);   // never throws
            return true;
        }
        const { TaskMessagingService } = await import('./TaskMessagingService');
        const options = (p.options ?? undefined) as Parameters<typeof TaskMessagingService.sendMessage>[2];
        return TaskMessagingService.sendMessage(String(p.phone ?? ''), String(p.text ?? ''), options);
    },
    async finish(id, status, patch) {
        await supabaseAdmin.from(TABLE).update({ status, attempts: patch.attempts, last_error: patch.last_error ?? null,
            ...(patch.send_after ? { send_after: patch.send_after } : {}), ...(status === 'held' ? {} : { finished_at: new Date().toISOString() }) }).eq('id', id);
    },
    async failStuck(before) {
        const { data } = await supabaseAdmin.from(TABLE).update({ status: 'failed', last_error: 'cut off while sending', finished_at: new Date().toISOString() })
            .eq('status', 'sending').lt('send_after', before.toISOString()).select('id');
        return (data ?? []).length;
    },
};
