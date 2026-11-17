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
/** `auto` (2026-11-02) = a scheduled / automatic message (digest, reminder, alert), not a reply in the conversation. */
export interface Turn { who: Speaker; text: string; at: string; auto?: boolean }

/** 2026-11-02: at most this many automatic messages are shown to the AI (the newest), so they never crowd out the real chat. */
export const MAX_AUTO_SHOWN = 2;
const AUTO_CHARS = 160;      // an automatic message, as stored: one short line

/**
 * 2026-11-02: the bot's reply as the AI should remember it. Replies are usually "a sentence, a long inserted list, a question";
 * cutting the raw text at 300 characters lost the question at the end (the part that matters most). Lists become one short
 * bracket ("[Carpet PO; Kone AMC; +3 more]") and section headings go, so the sentences and the question always fit.
 * Pure, never throws.
 */
const ITEM = /^(?:[•\-*▪◦]|\d{1,2}[.)])\s+/;
const HEADING = /^[^\p{L}\p{N}]{0,4}\*[^*]{1,60}\*(?:\s*\(\d+\))?\s*:?$/u;
export function compactBotText(raw: string, max = PROMPT_CHARS): string {
    const segments = String(raw ?? '').split(/\n+/).flatMap(line => line.split(/\s+(?=•\s)/)).map(s => s.trim()).filter(Boolean);
    const parts: Array<{ text: string } | { items: string[] }> = [];
    for (const seg of segments) {
        if (HEADING.test(seg)) continue;                                   // "🔄 *Carry forward tasks*"
        if (ITEM.test(seg)) {
            const item = seg.replace(ITEM, '').replace(/\s+/g, ' ').trim();
            const lastPart = parts[parts.length - 1];
            if (lastPart && 'items' in lastPart) lastPart.items.push(item); else parts.push({ items: [item] });
        } else parts.push({ text: seg.replace(/\s+/g, ' ') });
    }
    const render = (short: boolean) => parts.map(p => {
        if ('text' in p) return p.text;
        if (short) return `[${p.items.length} item${p.items.length === 1 ? '' : 's'}]`;
        const shown = p.items.slice(0, 3).map(i => (i.length > 40 ? `${i.slice(0, 39)}…` : i));
        return `[${shown.join('; ')}${p.items.length > 3 ? `; +${p.items.length - 3} more` : ''}]`;
    }).join(' ').trim();
    let out = render(false);
    if (out.length > max) out = render(true);
    if (out.length > max) {
        // Still too long: keep the start and the end (the question), drop the middle.
        const keepEnd = Math.min(140, Math.floor(max / 2));
        out = `${out.slice(0, max - keepEnd - 2).trimEnd()} … ${out.slice(-keepEnd).trimStart()}`;
    }
    return out;
}

/** 2026-11-02: an automatic message as one short line, marked as such for the AI. */
export const autoLine = (raw: string): string => `(automatic message) ${compactBotText(raw, AUTO_CHARS)}`;

/** The "Conversation memory" switch (settings, cached 30 s; env forces it ON). */
export const memoryEnabled = () => botSwitchOn('conversationMemory');

const oneLine = (s: unknown, max: number) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const warn = (what: string, err: unknown) =>
    console.warn(`[ConversationMemory] ${what} skipped:`, err instanceof Error ? err.message : (err as { message?: string })?.message || err);

/**
 * Add one message to the person's memory. `at` = when it happened (for a person's message: when it ARRIVED, so a reply that
 * was sent while it was still being routed is ordered after it).
 */
export async function appendTurn(phone: string | null | undefined, who: Speaker, text: string | null | undefined, at: string = new Date().toISOString(), opts: { auto?: boolean } = {}): Promise<void> {
    if (!phone || !(await memoryEnabled())) return;
    const key = phoneKey(phone);
    // 2026-11-02: the bot's replies are stored compacted (lists shortened, the question kept); automatic messages as one line.
    const clean = who === 'bot'
        ? oneLine(opts.auto ? autoLine(String(text ?? '')) : compactBotText(String(text ?? '')), STORE_CHARS)
        : oneLine(text, STORE_CHARS);
    if (key.length < 10 || !clean) return;
    try {
        const turn: Turn = { who, text: clean, at, ...(who === 'bot' && opts.auto ? { auto: true } : {}) };
        const { error } = await supabaseAdmin.rpc('whatsapp_memory_append', { p_phone_key: key, p_turn: turn, p_keep: KEEP_TURNS });
        if (error) warn('append', error);
    } catch (err) { warn('append', err); }
}

/** Pure: the stored turns → lines for the AI, oldest first ("Person: …" / "Assistant: …"). */
export function toTranscript(turns: unknown, limit = KEEP_TURNS): string[] {
    if (!Array.isArray(turns)) return [];
    const sorted = turns
        .filter((t): t is Turn => !!t && typeof t === 'object' && (t.who === 'person' || t.who === 'bot') && typeof t.text === 'string' && typeof t.at === 'string')
        .sort((a, b) => a.at.localeCompare(b.at));
    // 2026-11-02: only the newest MAX_AUTO_SHOWN automatic messages stay (a morning digest + reminders must not fill the window).
    const autos = sorted.filter(t => t.auto);
    const dropped = new Set(autos.slice(0, Math.max(0, autos.length - MAX_AUTO_SHOWN)));
    return sorted
        .filter(t => !dropped.has(t))
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
