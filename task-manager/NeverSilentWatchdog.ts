import { LEDGER_TABLE, neverSilentEnabled } from './InboundLedger';

/**
 * "Never silent" watchdog — Phase 1 of docs/WHATSAPP_BOT_PRODUCTION_PLAN.md.
 *
 * Runs with the existing 15-minute Task Manager cron (runBotHousekeeping), to save credits; /api/cron/whatsapp-watchdog can
 * run it every minute again by re-adding that cron to vercel.json. A Task Manager message that got NO reply within 2 minutes
 * gets one short apology, so the person is never left waiting in silence. Rules:
 *   • only messages a Task Manager route took (route set), from the last 40 minutes (covers a 15-minute cron with margin);
 *   • each message is claimed once (apology_sent_at), so two cron runs can never both apologise for it;
 *   • at most ONE apology per person per run, and none if they had one in the last 10 minutes (no spam);
 *   • the apology goes through the normal safety gate (kill switches, Pretend Mode). It is plain text, which WhatsApp allows
 *     because the person messaged us minutes ago.
 * It never RE-RUNS the message: re-running a task change could create it twice. The person retries; every change still asks YES.
 */

export const APOLOGY_TEXT = "Sorry, I couldn't finish that. 🙏 Please try again, or reply *tasks* to see your list.";
export const OVERDUE_MS = 2 * 60_000;
export const WINDOW_MS = 40 * 60_000;
export const REPEAT_GAP_MS = 10 * 60_000;
export const KEEP_DAYS = 14;

export interface WatchdogRow { id: string; message_id?: string; phone: string; phone_key: string; received_at: string }

export interface WatchdogIO {
    /** Routed, unanswered, not yet apologised, received between `newerThan` and `olderThan`, oldest first. */
    listOverdue(olderThan: string, newerThan: string): Promise<WatchdogRow[]>;
    /** Phone keys that were sent an apology since `since`. */
    recentApologyKeys(since: string): Promise<Set<string>>;
    /** Stamp apology_sent_at only if the row is STILL unanswered and not apologised. True = this run owns it. */
    claim(id: string): Promise<boolean>;
    /** Same, by provider message id (used right after a crash in the webhook's background work). */
    claimByMessageId(messageId: string): Promise<boolean>;
    send(phone: string, text: string): Promise<boolean>;
    /** Delete rows received before `before`. Returns how many. */
    purge(before: string): Promise<number>;
}

export interface WatchdogResult { enabled: boolean; checked: number; apologised: number; skippedRecent: number; sendFailed: number; purged: number }

export async function runWatchdog(io: WatchdogIO, now = new Date()): Promise<WatchdogResult> {
    const out: WatchdogResult = { enabled: true, checked: 0, apologised: 0, skippedRecent: 0, sendFailed: 0, purged: 0 };
    const iso = (ms: number) => new Date(now.getTime() - ms).toISOString();

    const rows = await io.listOverdue(iso(OVERDUE_MS), iso(WINDOW_MS));
    out.checked = rows.length;
    const quiet = rows.length ? await io.recentApologyKeys(iso(REPEAT_GAP_MS)) : new Set<string>();

    for (const row of rows) {
        if (!(await io.claim(row.id))) continue;            // answered meanwhile, or another run took it
        if (quiet.has(row.phone_key)) { out.skippedRecent++; continue; }
        quiet.add(row.phone_key);                            // one apology per person per run
        try {
            if (row.message_id) { const { promoteApology } = await import('./BotLearningService'); await promoteApology(row.message_id); }
            if (await io.send(row.phone, APOLOGY_TEXT)) out.apologised++; else out.sendFailed++;
        } catch {
            out.sendFailed++;
        }
    }

    try { out.purged = await io.purge(iso(KEEP_DAYS * 24 * 60 * 60_000)); } catch { /* housekeeping only */ }
    return out;
}

/**
 * The webhook's background work crashed: apologise at once instead of waiting for the watchdog.
 * Claims the row first, so the watchdog will not apologise a second time. Never throws.
 */
export async function apologiseNow(io: WatchdogIO, messageId: string | null | undefined, phone: string | null | undefined): Promise<boolean> {
    if (!messageId || !phone) return false;
    try {
        if (!(await io.claimByMessageId(messageId))) return false;
        return await io.send(phone, APOLOGY_TEXT);
    } catch {
        return false;
    }
}

/** The real wiring (Supabase + the gated outbox). */
export async function defaultWatchdogIO(): Promise<WatchdogIO> {
    const { supabaseAdmin } = await import('@/backend/lib/supabase/admin');
    const { TaskMessagingService } = await import('./TaskMessagingService');
    const table = () => supabaseAdmin.from(LEDGER_TABLE);
    const stamp = () => ({ apology_sent_at: new Date().toISOString() });
    return {
        async listOverdue(olderThan, newerThan) {
            const { data, error } = await table().select('id, message_id, phone, phone_key, received_at')
                .not('route', 'is', null).is('replied_at', null).is('apology_sent_at', null)
                .lt('received_at', olderThan).gte('received_at', newerThan)
                .order('received_at', { ascending: true }).limit(200);
            if (error) throw error;
            return (data || []) as WatchdogRow[];
        },
        async recentApologyKeys(since) {
            const { data, error } = await table().select('phone_key').gte('apology_sent_at', since);
            if (error) throw error;
            return new Set((data || []).map(r => r.phone_key as string));
        },
        async claim(id) {
            const { data, error } = await table().update(stamp()).eq('id', id).is('replied_at', null).is('apology_sent_at', null).select('id');
            if (error) throw error;
            return (data || []).length === 1;
        },
        async claimByMessageId(messageId) {
            const { data, error } = await table().update(stamp()).eq('message_id', messageId).is('replied_at', null).is('apology_sent_at', null).select('id');
            if (error) throw error;
            return (data || []).length === 1;
        },
        send: (phone, text) => TaskMessagingService.sendFreeformReply(phone, text),
        async purge(before) {
            const { data, error } = await table().delete().lt('received_at', before).select('id');
            if (error) throw error;
            return (data || []).length;
        },
    };
}

/** Called from the webhook when a Task Manager background job throws. No-op while the switch is OFF. */
export async function apologiseAfterCrash(messageId: string | null | undefined, phone: string | null | undefined): Promise<void> {
    if (!(await neverSilentEnabled())) return;
    try { const sent = await apologiseNow(await defaultWatchdogIO(), messageId, phone); if (sent) { const { promoteApology } = await import('./BotLearningService'); await promoteApology(messageId); } } catch { /* never throws */ }
}

/**
 * Bot housekeeping, called by the existing 15-minute Task Manager cron (no extra cron, no extra credits):
 *   • "Never silent" ON        → run the watchdog;
 *   • "Conversation memory" ON → delete memories whose 24 hours are over.
 * Each part checks its own switch and does nothing while it is OFF. Never throws.
 */
export async function runBotHousekeeping(): Promise<{ watchdog: WatchdogResult | null; memoryPurged: number | null; phase5: unknown }> {
    const out: { watchdog: WatchdogResult | null; memoryPurged: number | null; phase5: unknown } = { watchdog: null, memoryPurged: null, phase5: null };
    try {
        const { memoryEnabled, purgeExpiredMemory } = await import('./ConversationMemory');
        if (await memoryEnabled()) out.memoryPurged = await purgeExpiredMemory();
    } catch (err) { console.warn('[BotHousekeeping] memory purge skipped:', err instanceof Error ? err.message : err); }
    try {
        if (await neverSilentEnabled()) {
            out.watchdog = await runWatchdog(await defaultWatchdogIO());
            if (out.watchdog.apologised || out.watchdog.sendFailed) console.info('[WhatsAppWatchdog]', JSON.stringify(out.watchdog));
        }
    } catch (err) { console.warn('[BotHousekeeping] watchdog skipped:', err instanceof Error ? err.message : err); }
    try { const { runPhase5Housekeeping } = await import('./BotLearningHousekeeping'); out.phase5 = await runPhase5Housekeeping(); }
    catch (err) { console.warn('[BotHousekeeping] Phase 5 skipped:', err instanceof Error ? err.message : err); }
    return out;
}
