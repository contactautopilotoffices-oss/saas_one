import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { phoneKey } from './InboundLedger';
import { botSwitchOn } from './BotSwitches';

/**
 * Conversation memory — Phase 2 of docs/WHATSAPP_BOT_PRODUCTION_PLAN.md.
 *
 * The last 20 messages of each person's WhatsApp chat with the Task Manager bot (their messages AND the bot's), kept for
 * 24 hours after the last message, so the AI can follow the running thread. Approved by the owner on 2026-10-11.
 * Switch: "Conversation memory" in the Task Access panel (or env WHATSAPP_MEMORY_ENABLED=true). OFF by default → every
 * function returns at once, nothing is read or written, and the AI prompt is exactly as before.
 * Privacy: service-role only, never logged, never shown to anyone, deleted after 24 hours.
 * Every function swallows its errors: memory is a help, never a reason for a message to fail.
 */

export const MEMORY_TABLE = 'whatsapp_conversation_memory';
export const KEEP_TURNS = 20;
const STORE_CHARS = 500;     // per message, as stored
const PROMPT_CHARS = 300;    // per message, as shown to the AI

export type Speaker = 'person' | 'bot';
export interface Turn { who: Speaker; text: string; at: string }

/** The "Conversation memory" switch (settings, cached 30 s; env forces it ON). */
export const memoryEnabled = () => botSwitchOn('conversationMemory');

const oneLine = (s: unknown, max: number) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const warn = (what: string, err: unknown) =>
    console.warn(`[ConversationMemory] ${what} skipped:`, err instanceof Error ? err.message : (err as { message?: string })?.message || err);

/**
 * Add one message to the person's memory. `at` = when it happened (for a person's message: when it ARRIVED, so a reply that
 * was sent while it was still being routed is ordered after it).
 */
export async function appendTurn(phone: string | null | undefined, who: Speaker, text: string | null | undefined, at: string = new Date().toISOString()): Promise<void> {
    if (!phone || !(await memoryEnabled())) return;
    const key = phoneKey(phone);
    const clean = oneLine(text, STORE_CHARS);
    if (key.length < 10 || !clean) return;
    try {
        const { error } = await supabaseAdmin.rpc('whatsapp_memory_append', { p_phone_key: key, p_turn: { who, text: clean, at }, p_keep: KEEP_TURNS });
        if (error) warn('append', error);
    } catch (err) { warn('append', err); }
}

/** Pure: the stored turns → lines for the AI, oldest first ("Person: …" / "Assistant: …"). */
export function toTranscript(turns: unknown, limit = KEEP_TURNS): string[] {
    if (!Array.isArray(turns)) return [];
    return turns
        .filter((t): t is Turn => !!t && typeof t === 'object' && (t.who === 'person' || t.who === 'bot') && typeof t.text === 'string' && typeof t.at === 'string')
        .sort((a, b) => a.at.localeCompare(b.at))
        .slice(-limit)
        .map(t => `${t.who === 'person' ? 'Person' : 'Assistant'}: ${oneLine(t.text, PROMPT_CHARS)}`);
}

/** The running conversation for the AI, oldest first. [] when the switch is OFF, nothing is stored, or it has expired. */
export async function readTranscript(phone: string | null | undefined): Promise<string[]> {
    if (!phone || !(await memoryEnabled())) return [];
    const key = phoneKey(phone);
    if (key.length < 10) return [];
    try {
        const { data, error } = await supabaseAdmin.from(MEMORY_TABLE).select('turns, expires_at').eq('phone_key', key).maybeSingle();
        if (error) { warn('read', error); return []; }
        if (!data || new Date(data.expires_at as string).getTime() < Date.now()) return [];
        return toTranscript(data.turns);
    } catch (err) { warn('read', err); return []; }
}

/**
 * Delete EVERY stored memory. Called when an admin switches Conversation memory OFF, so nothing lingers once the 24-hour
 * clean-up stops running. Returns how many rows were deleted (0 when the table is not there yet). Never throws.
 */
export async function clearAllMemory(): Promise<number> {
    try {
        const { data, error } = await supabaseAdmin.from(MEMORY_TABLE).delete().neq('phone_key', '').select('phone_key');
        if (error) { warn('clear', error); return 0; }
        return (data || []).length;
    } catch (err) { warn('clear', err); return 0; }
}

/** Delete memories whose 24 hours are over. Returns how many. */
export async function purgeExpiredMemory(): Promise<number> {
    if (!(await memoryEnabled())) return 0;
    try {
        const { data, error } = await supabaseAdmin.from(MEMORY_TABLE).delete().lt('expires_at', new Date().toISOString()).select('phone_key');
        if (error) { warn('purge', error); return 0; }
        return (data || []).length;
    } catch (err) { warn('purge', err); return 0; }
}
