import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { botSwitchOn } from './BotSwitches';

/**
 * "Never silent" — Phase 1 of docs/WHATSAPP_BOT_PRODUCTION_PLAN.md.
 *
 * A small ledger of incoming WhatsApp messages that a Task Manager route took, so we know which ones never got a reply.
 * Switch: "Never silent" in the Task Access panel (or env WHATSAPP_NEVER_SILENT_ENABLED=true). OFF by default → every
 * function here returns at once and nothing is written.
 * Stores NO message text: only the provider message id, the phone number and times.
 * Every function swallows its errors: a missing table or a failed write must never break the webhook or a send.
 */

export const LEDGER_TABLE = 'whatsapp_inbound_ledger';
export type LedgerRoute = 'task_import' | 'smart_chat' | 'task_router';

/** The "Never silent" switch (settings, cached 30 s; env forces it ON). */
export const neverSilentEnabled = () => botSwitchOn('neverSilent');

/** Last 10 digits, so "+91 98765 43210", "919876543210" and "9876543210" are the same person. */
export const phoneKey = (phone: string) => String(phone || '').replace(/\D/g, '').slice(-10);

const warn = (what: string, err: unknown) =>
    console.warn(`[InboundLedger] ${what} skipped:`, err instanceof Error ? err.message : (err as { message?: string })?.message || err);

/** 'new' = first time seen; 'duplicate' = this message id is already in the ledger; 'unknown' = could not tell (switch OFF, no id, error). */
export type InboundSeen = 'new' | 'duplicate' | 'unknown';

/** Is the "message_type" column there yet? (migration 20261013000001; until applied, rows are written without it.) */
let typeColumn = true;

/**
 * A message arrived. Call BEFORE any route runs, so a reply sent during routing finds the row.
 * The SAME write also tells whether WhatsApp / AiSensy delivered this message id before (a re-delivery can come hours
 * later; 2026-10-12 Lohit got a reply to nothing). The caller drops a 'duplicate'. Only 'duplicate' is ever acted on:
 * any doubt → 'unknown' → handled as before. `messageType` is the provider's kind (text / audio / button …), never content.
 */
export async function recordInbound(messageId: string | null | undefined, phone: string | null | undefined, messageType?: string | null): Promise<InboundSeen> {
    if (!messageId || !phone || phoneKey(phone).length < 10) return 'unknown';
    if (!(await neverSilentEnabled())) return 'unknown';
    const row: Record<string, string> = { message_id: messageId, phone, phone_key: phoneKey(phone) };
    const type = messageType ? String(messageType).slice(0, 40) : null;
    try {
        const write = (withType: boolean) => supabaseAdmin.from(LEDGER_TABLE)
            .upsert(withType && type ? { ...row, message_type: type } : row, { onConflict: 'message_id', ignoreDuplicates: true })
            .select('message_id');
        let { data, error } = await write(typeColumn);
        if (error && typeColumn && /message_type/.test(error.message || '')) { typeColumn = false; ({ data, error } = await write(false)); }
        if (error) { warn('record', error); return 'unknown'; }
        // With ignoreDuplicates, an id already in the table is skipped and NOT returned.
        return Array.isArray(data) && data.length === 0 ? 'duplicate' : Array.isArray(data) ? 'new' : 'unknown';
    } catch (err) { warn('record', err); return 'unknown'; }
}

/** A Task Manager route took the message: observe eligible Smart-chat turns and let the watchdog expect a reply. */
export async function markRoute(messageId: string | null | undefined, route: LedgerRoute, phone?: string | null, text?: string | null): Promise<void> {
    if (!messageId) return;
    if (route === 'smart_chat') {
        try { const { beginObservation } = await import('./BotLearningService'); await beginObservation({ messageId, phone, text }); } catch { /* learning must never break routing */ }
    }
    if (!(await neverSilentEnabled())) return;
    try {
        const { error } = await supabaseAdmin.from(LEDGER_TABLE).update({ route }).eq('message_id', messageId).is('route', null);
        if (error) warn('route', error);
    } catch (err) { warn('route', err); }
}

/**
 * The bot sent something to this phone: every message from them in the last hour that was still waiting now counts as
 * answered. Fire-and-forget from the outbox; never awaited in a way that could slow or fail a send.
 */
export async function markReplied(phone: string | null | undefined): Promise<void> {
    if (!phone || !(await neverSilentEnabled())) return;
    const key = phoneKey(phone);
    if (key.length < 10) return;
    try {
        const now = new Date();
        const { error } = await supabaseAdmin.from(LEDGER_TABLE).update({ replied_at: now.toISOString() })
            .eq('phone_key', key).is('replied_at', null)
            .lte('received_at', now.toISOString()).gte('received_at', new Date(now.getTime() - 60 * 60_000).toISOString());
        if (error) warn('reply stamp', error);
    } catch (err) { warn('reply stamp', err); }
}
