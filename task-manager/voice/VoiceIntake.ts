import { normalizeInbound } from '@/backend/lib/whatsapp/assistant/protocol.mjs';
import { parseConfirmAnswer } from '../TaskGateway';
import type { MediaFetchResult } from '../TaskImportInbound';
import type { LiveIO } from '../brain/live';
import type { TestingConfig } from '../types';
import { clip } from '../brain/text';
import type { CleanupResult } from './VoiceCleanup';
import type { TranscribeFailure, TranscribeInput, TranscribeResult } from './VoiceTranscriber';

/**
 * Voice Note Intake — the WhatsApp side: spot a voice note, download it at once (the link expires), keep the limits,
 * turn it into tidy text, show it back ("🎙️ I heard …") and wait for YES. Plan: docs/VOICE_NOTE_INTAKE_PLAN.md
 *
 * `claimVoiceNote(body)` is called by the webhook (wiring is Phase 4):
 *   • pass     → not ours; the webhook carries on EXACTLY as before.
 *   • handled  → ours; run `background` after the webhook has answered.
 *   • rewrite  → the person said YES to a voice note; carry on with `body` = that text, as if they had typed it.
 * Switch OFF (VOICE_NOTES_ENABLED), an unknown number, or any error before a message is claimed → pass.
 * Nothing here logs what was said. The transcript is kept only in the pending row (10 min) and the audit row.
 */

export const PENDING_TTL_MIN = 10;
/** The state row lives as long as the rate-limit window, so the hourly count survives between notes. */
export const STATE_TTL_MIN = 60;
export const MAX_NOTES_PER_HOUR = 20;
const HOUR_MS = 60 * 60 * 1000;
/**
 * The webhook's background work must finish inside its 120 s limit. The brain can take ~60 s at worst (two calls, each
 * with a fallback model) plus carrying out and replying, so it is only tried while under 30 s have passed; otherwise the
 * single "I heard … YES?" send. Normal runs take a few seconds.
 */
export const BRAIN_BUDGET_MS = 30_000;
const KEEP_IDS = 10;

// ── what the sender sees ─────────────────────────────────────────────────────

export const VOICE_TEXT = {
    tooLong: '🎙️ That voice note is longer than 2 minutes. Please send a shorter one, or type your message.',
    silent: "🎙️ I couldn't hear anything in that voice note. Please try again, or type your message.",
    busy: '🎙️ Voice notes are busy right now. Please type your message, or try again in a few minutes.',
    failed: "🎙️ Sorry, I couldn't process that voice note just now. Please try again, or type your message.",
    hourlyLimit: "🎙️ You've sent a lot of voice notes this hour. Please type your message for now.",
    cancelled: 'Okay, cancelled. Send a new voice note or type your message.',
    /** Put above the brain's own reply (its confirm question, or the answer to a read) — one YES at most. */
    heardLine: (text: string) => `🎙️ I heard: "${text}"`,
    heard: (text: string, unclear: boolean) =>
        `🎙️ I heard: "${text}"\n\n${unclear ? "Some words weren't clear. If this is wrong, reply NO and type it instead.\n\n" : ''}Reply *YES* to go ahead, or *NO* to cancel.`,
} as const;

export function failureText(reason: TranscribeFailure | 'download'): string {
    if (reason === 'too_long' || reason === 'too_large') return VOICE_TEXT.tooLong;
    if (reason === 'silent') return VOICE_TEXT.silent;
    if (reason === 'rate_limited') return VOICE_TEXT.busy;
    return VOICE_TEXT.failed;
}

// ── reading the AiSensy payload ──────────────────────────────────────────────

export interface VoiceNoteRef { phone: string; messageId: string; audioUrl: string; mimeType: string | null }
export interface TextRef { phone: string; messageId: string; text: string; projectId?: string; inboundAt?: string }

/**
 * A plain text body as the shared parser reads it. Carries the YES message's project id and time, so the confirmed text
 * is routed exactly like the same words typed (the interpreter pilot checks the project id; the queue uses the time).
 */
export interface RewrittenBody { phone: string; messageId: string; text: string; project_id?: string; timestamp?: string }

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const first = (...v: unknown[]): string => v.map(str).find(Boolean) || '';
const VOICE_TYPES = new Set(['audio', 'voice', 'ptt']);

/* eslint-disable @typescript-eslint/no-explicit-any -- provider payloads are untyped; every field read is checked */
function parts(body: unknown): { normalized: any; msg: any; data: any } | null {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
    const b = body as any;
    const data = b.data || b.payload || b;
    const msg = data.messages?.[0] || data.message || {};
    // AiSensy puts a voice note at message_content.url (seen 2026-10-09), which the shared parser reads. Other shapes
    // (audio.url / voice.url) are handed to it the same way TaskImportInbound hands it a document URL.
    const audioUrl = first(msg.audio?.url, data.audio?.url, msg.voice?.url, data.voice?.url);
    const normalized = normalizeInbound(!str(b.mediaUrl) && audioUrl ? { ...b, mediaUrl: audioUrl } : b);
    return normalized ? { normalized, msg, data } : null;
}

/** A voice note, by its audio mime type (exact message_type values vary) or a voice/audio message type. */
export function extractVoiceNote(body: unknown): VoiceNoteRef | null {
    const p = parts(body);
    if (!p?.normalized.mediaUrl) return null;
    const { msg, data } = p;
    const mime = first(msg.message_content?.mimeType, msg.message_content?.mime_type, msg.audio?.mime_type, msg.audio?.mimeType,
        msg.voice?.mime_type, msg.mime_type, msg.mimeType, data.mime_type, data.mimeType).toLowerCase() || null;
    const isVoice = mime ? mime.startsWith('audio/') : VOICE_TYPES.has(String(p.normalized.mediaType || '').toLowerCase());
    if (!isVoice) return null;
    return { phone: p.normalized.phone, messageId: p.normalized.messageId || '', audioUrl: p.normalized.mediaUrl, mimeType: mime };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** A plain text message (no media) — the only kind that can answer a pending voice note. */
export function extractTextReply(body: unknown): TextRef | null {
    const p = parts(body);
    if (!p || p.normalized.mediaUrl || !p.normalized.text) return null;
    const n = p.normalized;
    return { phone: n.phone, messageId: n.messageId || '', text: n.text, ...(n.projectId ? { projectId: n.projectId } : {}), ...(n.inboundAt ? { inboundAt: n.inboundAt } : {}) };
}

/** YES / NO to "I heard …". The shared parser plus the Hindi words and "cancel". Anything else → null. */
export function parseVoiceAnswer(text: string): 'yes' | 'no' | null {
    const shared = parseConfirmAnswer(text);
    if (shared) return shared;
    const t = (text || '').trim().toLowerCase().replace(/[.!\s]+$/g, '');
    if (/^(?:haan|haa|ha|han|hanji|haan ji|ji|ji haan|theek hai|thik hai|sahi hai|correct|bilkul)$/.test(t)) return 'yes';
    if (/^(?:nahi|nahin|nai|na|cancel|mat karo|galat|wrong)$/.test(t)) return 'no';
    return null;
}

// ── state (one row per phone, see VoiceStore) ────────────────────────────────

export interface PendingVoice { text: string; voiceMessageId: string; expiresAt: number }
export interface VoiceState {
    pending: PendingVoice | null;
    /** When each voice note in the last hour arrived (ms) — the hourly limit. */
    recentAt: number[];
    /** Last few voice-note message ids — a repeat delivery is not transcribed twice. */
    recentIds: string[];
    /**
     * The YES / NO that answered the last pending note. AiSensy redelivers a message when the webhook says "retry" (503):
     * the same message id then gets the same answer again, instead of a bare "YES" reaching the old flow or the brain.
     */
    answered: AnsweredVoice | null;
}
export interface AnsweredVoice { messageId: string; result: 'yes' | 'no'; body: RewrittenBody | null; at: number }
const EMPTY: VoiceState = { pending: null, recentAt: [], recentIds: [], answered: null };

export function normalizeVoiceState(data: unknown, now: number): VoiceState {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return { ...EMPTY };
    const d = data as Record<string, unknown>;
    const p = d.pending as Record<string, unknown> | null | undefined;
    const pending = p && typeof p.text === 'string' && p.text && typeof p.expiresAt === 'number' && p.expiresAt > now
        ? { text: p.text, voiceMessageId: typeof p.voiceMessageId === 'string' ? p.voiceMessageId : '', expiresAt: p.expiresAt } : null;
    const a = d.answered as Record<string, unknown> | null | undefined;
    const b = a?.body as Record<string, unknown> | null | undefined;
    const answered: AnsweredVoice | null = a && typeof a.messageId === 'string' && a.messageId && (a.result === 'yes' || a.result === 'no')
        && typeof a.at === 'number' && now - a.at < PENDING_TTL_MIN * 60_000
        ? { messageId: a.messageId, result: a.result, at: a.at,
            body: b && typeof b.phone === 'string' && typeof b.messageId === 'string' && typeof b.text === 'string' ? b as unknown as RewrittenBody : null }
        : null;
    return {
        pending, answered,
        recentAt: Array.isArray(d.recentAt) ? d.recentAt.filter((t): t is number => typeof t === 'number' && now - t < HOUR_MS) : [],
        recentIds: Array.isArray(d.recentIds) ? d.recentIds.filter((s): s is string => typeof s === 'string').slice(-KEEP_IDS) : [],
    };
}

// ── the claim ────────────────────────────────────────────────────────────────

export interface Sender { employeeId: string | null; userId: string | null }

const last10 = (p: string | null | undefined) => String(p || '').replace(/\D/g, '').slice(-10);

/**
 * Live trial switch, voice only: VOICE_NOTES_ALLOWED_PHONES = comma-separated numbers (any formatting). Set → only those
 * numbers get voice notes. Unset / empty → no limit (everyone the system recognises). Same idea as TASK_AI_CHAT_ALLOWED_PHONES,
 * and it does not touch the Task Manager sandbox, which also limits Smart chat and Task Import.
 */
export function passesVoiceAllowlist(allowed: string | undefined, phone: string): boolean {
    const list = String(allowed || '').split(',').map(last10).filter(p => p.length === 10);
    return list.length === 0 || list.includes(last10(phone));
}

/**
 * While the Task Manager SANDBOX is ON (Control Center), only the sandbox numbers get voice notes, the same as Smart chat
 * and Task Import. Sandbox OFF → everyone the system recognises.
 */
export function passesSandbox(config: Pick<TestingConfig, 'enabled' | 'manager' | 'employees'>, phone: string): boolean {
    if (!config.enabled) return true;
    const me = last10(phone);
    return (!!config.manager?.phone && last10(config.manager.phone) === me) || (config.employees || []).some(e => !!e.phone && last10(e.phone) === me);
}

export interface VoiceIO {
    enabled(): boolean | Promise<boolean>;
    /** A registered employee or an approved WhatsApp user; null = unknown number (ignored, nothing spent). */
    recognise(phone: string): Promise<Sender | null>;
    download(url: string): Promise<MediaFetchResult>;
    transcribe(input: TranscribeInput): Promise<TranscribeResult>;
    cleanup(text: string): Promise<CleanupResult>;
    /**
     * Hand the tidy text to the brain (smart chat) with `prefix` above its reply. true = the brain took it and has replied
     * (a change → its own confirm question, so one YES does both; a read → the answer). false = not the brain's.
     */
    tryBrain(input: { phone: string; messageId: string; text: string; prefix: string }): Promise<boolean>;
    getState(phone: string): Promise<unknown>;
    setState(phone: string, state: VoiceState): Promise<void>;
    /** true = sent (or recorded in Pretend Mode); false = the send gate blocked it or the send failed. */
    reply(phone: string, text: string): Promise<boolean>;
    audit(details: Record<string, unknown>, sender: Sender): Promise<void>;
    now(): number;
}

export type VoiceClaim =
    | { kind: 'pass' }
    | { kind: 'handled'; background?: () => Promise<void> }
    | { kind: 'rewrite'; body: RewrittenBody };
const PASS: VoiceClaim = { kind: 'pass' };

export async function claimVoiceNote(body: unknown, io?: VoiceIO): Promise<VoiceClaim> {
    try {
        // Switch OFF (the default): return before loading anything else. The switch is "Voice notes" in the Task Access panel
        // (settings, cached 30 s — no redeploy); env VOICE_NOTES_ENABLED=true still forces it ON.
        if (!io && !(await (await import('../BotSwitches')).botSwitchOn('voiceNotes'))) return PASS;
        const real = io ?? await defaultVoiceIO();
        if (!(await real.enabled())) return PASS;
        const voice = extractVoiceNote(body);
        if (voice) return await claimNote(voice, real);
        const text = extractTextReply(body);
        if (text) return await claimAnswer(text, real);
        return PASS;
    } catch (err) {
        console.warn('[VoiceIntake] not handled, the old flow answers instead:', err instanceof Error ? err.message : 'error');
        return PASS;
    }
}

async function claimNote(voice: VoiceNoteRef, io: VoiceIO): Promise<VoiceClaim> {
    const sender = await io.recognise(voice.phone);
    if (!sender) return PASS;
    const now = io.now();
    const state = normalizeVoiceState(await io.getState(voice.phone).catch(() => null), now);
    if (voice.messageId && state.recentIds.includes(voice.messageId)) return { kind: 'handled' };   // repeat delivery

    const audit = (details: Record<string, unknown>) => io.audit({ messageId: voice.messageId || null, ...details }, sender).catch(() => undefined);
    const recentIds = voice.messageId ? [...state.recentIds, voice.messageId].slice(-KEEP_IDS) : state.recentIds;
    if (state.recentAt.length >= MAX_NOTES_PER_HOUR) {
        await io.setState(voice.phone, { ...state, recentIds });
        return { kind: 'handled', background: async () => { await safeReply(io, voice.phone, VOICE_TEXT.hourlyLimit); await audit({ outcome: 'hourly_limit' }); } };
    }
    // Recorded now, in the quick part, so a second delivery arriving while this one is being transcribed is ignored.
    await io.setState(voice.phone, { ...state, recentAt: [...state.recentAt, now], recentIds });
    return { kind: 'handled', background: () => processNote(voice, sender, io, now) };
}

/** The slow part. Never throws: a problem becomes one friendly reply. */
async function processNote(voice: VoiceNoteRef, sender: Sender, io: VoiceIO, started: number): Promise<void> {
    const audit = (details: Record<string, unknown>) =>
        io.audit({ messageId: voice.messageId || null, ms: io.now() - started, ...details }, sender).catch(() => undefined);
    try {
        const file = await io.download(voice.audioUrl);
        if (!file.ok) {
            await safeReply(io, voice.phone, failureText(file.error === 'file too large' ? 'too_large' : 'download'));
            await audit({ outcome: 'failed', reason: 'download', detail: clip(file.error, 200) });
            return;
        }
        const mimeType = voice.mimeType || (file.contentType.startsWith('audio/') ? file.contentType : 'audio/ogg');
        const heard = await io.transcribe({ audio: file.buffer, mimeType });
        if (!heard.ok) {
            await safeReply(io, voice.phone, failureText(heard.reason));
            await audit({ outcome: heard.reason === 'too_long' || heard.reason === 'too_large' ? 'too_long' : heard.reason === 'silent' ? 'silent' : 'failed', reason: heard.reason, detail: clip(heard.detail, 300) });
            return;
        }
        const tidy = await io.cleanup(heard.text);
        const shown = clip(tidy.text, 1500);

        // One YES at most: clear, tidy words go to the brain, which replies with "I heard" on top (a change → its own
        // confirm question; a read → the answer). Unclear or untidied words, or anything the brain does not take
        // (rooms / tickets, the AI down, not a smart-chat department) → "I heard … YES?" first.
        let route: 'brain' | 'confirm' = 'confirm';
        if (tidy.cleaned && !tidy.unclear && io.now() - started < BRAIN_BUDGET_MS) {
            const took = await io.tryBrain({ phone: voice.phone, messageId: voice.messageId, text: shown, prefix: VOICE_TEXT.heardLine(shown) })
                .catch(() => false);
            if (took) route = 'brain';
        }
        let promptSent: boolean | null = null;
        if (route === 'brain') {
            const latest = normalizeVoiceState(await io.getState(voice.phone).catch(() => null), io.now());
            if (latest.pending) await io.setState(voice.phone, { ...latest, pending: null });   // a newer note replaces an older one
        } else {
            promptSent = await safeReply(io, voice.phone, VOICE_TEXT.heard(shown, tidy.unclear || !tidy.cleaned));
            // Only wait for a YES the person was actually asked for (a blocked send must not capture their next "yes").
            const latest = normalizeVoiceState(await io.getState(voice.phone).catch(() => null), io.now());
            const pending = promptSent ? { text: shown, voiceMessageId: voice.messageId, expiresAt: io.now() + PENDING_TTL_MIN * 60_000 } : null;
            await io.setState(voice.phone, { ...latest, pending });
        }
        // Transcript text is kept here by the owner's decision (plan §2, decision 5); the audio never is.
        await audit({
            outcome: 'transcribed', route, promptSent, rawText: heard.text, text: shown, cleaned: tidy.cleaned, unclear: tidy.unclear, language: tidy.language,
            whisperLanguage: heard.language, durationSec: heard.durationSec, whisperModel: heard.model, cleanupModel: tidy.model,
            tokensIn: tidy.tokensIn, tokensOut: tidy.tokensOut, failures: [...heard.failures, ...tidy.failures].length,
        });
    } catch (err) {
        console.warn('[VoiceIntake] failed while processing a voice note:', err instanceof Error ? err.message : 'error');
        await safeReply(io, voice.phone, VOICE_TEXT.failed);
        await audit({ outcome: 'failed', reason: 'error' });
    }
}

async function claimAnswer(text: TextRef, io: VoiceIO): Promise<VoiceClaim> {
    // One small read; no pending voice note (the usual case) → pass, untouched.
    const now = io.now();
    const raw = await io.getState(text.phone).catch(() => null);
    if (!raw) return PASS;
    const state = normalizeVoiceState(raw, now);
    // A redelivery of the YES / NO we already acted on → exactly the same answer, nothing new sent or stored.
    const done = state.answered;
    if (done && text.messageId && done.messageId === text.messageId) {
        return done.result === 'yes' && done.body ? { kind: 'rewrite', body: done.body } : { kind: 'handled' };
    }
    if (!state.pending) return PASS;
    const sender = await io.recognise(text.phone);
    if (!sender) return PASS;

    const pending = state.pending;
    const audit = (details: Record<string, unknown>) =>
        io.audit({ messageId: text.messageId || null, voiceMessageId: pending.voiceMessageId || null, ...details }, sender).catch(() => undefined);
    const answer = parseVoiceAnswer(text.text);
    // Answered either way: the note is never offered twice. A YES / NO is remembered by its message id (see `answered`).
    const remember = (result: 'yes' | 'no', body: RewrittenBody | null): AnsweredVoice | null =>
        text.messageId ? { messageId: text.messageId, result, body, at: now } : null;
    if (answer === 'yes') {
        const body: RewrittenBody = {
            phone: text.phone, messageId: text.messageId, text: pending.text,
            ...(text.projectId ? { project_id: text.projectId } : {}), ...(text.inboundAt ? { timestamp: text.inboundAt } : {}),
        };
        await io.setState(text.phone, { ...state, pending: null, answered: remember('yes', body) });
        await audit({ outcome: 'confirmed' });
        return { kind: 'rewrite', body };
    }
    if (answer === 'no') {
        await io.setState(text.phone, { ...state, pending: null, answered: remember('no', null) });
        return { kind: 'handled', background: async () => { await safeReply(io, text.phone, VOICE_TEXT.cancelled); await audit({ outcome: 'declined' }); } };
    }
    await io.setState(text.phone, { ...state, pending: null });
    await audit({ outcome: 'dropped' });   // they moved on: their new message is handled normally
    return PASS;
}

async function safeReply(io: VoiceIO, phone: string, text: string): Promise<boolean> {
    try { return await io.reply(phone, text); } catch { console.warn('[VoiceIntake] reply could not be sent'); return false; }
}

// ── the real wiring (loaded lazily so tests never touch the database) ───────

/**
 * The tidy text goes to the brain as a plain text body, exactly what a typed message looks like, with the "I heard" line
 * as its reply prefix. `liveIO` is only passed by tests.
 */
export async function handToBrain(input: { phone: string; messageId: string; text: string; prefix: string }, liveIO?: LiveIO): Promise<boolean> {
    const { claimSmartChat } = await import('../brain/live');
    const claim = await claimSmartChat({ phone: input.phone, messageId: input.messageId, text: input.text }, liveIO, { replyPrefix: input.prefix, via: 'voice' });
    if (!claim.handled) return false;
    if (claim.background) await claim.background();   // never throws: a problem becomes one apology
    return true;
}

/** Minimal slice of the Supabase client the store needs (so the store is testable with a fake). */
export interface VoiceStoreClient {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the Supabase query builder's types are not needed here
    from(table: string): any;
}

/**
 * One `conversation_context` row per phone, keyed `VOICE:<digits>` (precedent: the TEST_CONFIG row). It never touches the
 * sender's real row, so it cannot open a Task Manager conversation (`taskActive`) or overwrite the brain's state.
 */
export function voiceStateKey(phone: string): string { return `VOICE:${String(phone).replace(/\D/g, '')}`; }

export function makeVoiceStore(db: VoiceStoreClient, now: () => number = Date.now) {
    return {
        async get(phone: string): Promise<unknown> {
            const { data, error } = await db.from('conversation_context').select('context_data')
                .eq('phone_number', voiceStateKey(phone)).eq('system', 'TASK_MANAGER').gt('expires_at', new Date(now()).toISOString()).maybeSingle();
            if (error) throw new Error('voice state unavailable');
            return data?.context_data ?? null;
        },
        async set(phone: string, state: VoiceState): Promise<void> {
            const { error } = await db.from('conversation_context').upsert({
                phone_number: voiceStateKey(phone), system: 'TASK_MANAGER', context_type: 'VOICE_CONFIRM', context_data: state,
                expires_at: new Date(now() + STATE_TTL_MIN * 60_000).toISOString(), updated_at: new Date(now()).toISOString(),
            }, { onConflict: 'phone_number,system' });
            if (error) throw new Error('voice state could not be saved');
        },
    };
}

export async function defaultVoiceIO(): Promise<VoiceIO> {
    const { supabaseAdmin } = await import('@/backend/lib/supabase/admin');
    const { TaskDatabaseService } = await import('../TaskDatabaseService');
    const { TaskMessagingService } = await import('../TaskMessagingService');
    const { findWhatsAppUser } = await import('@/backend/lib/whatsapp/assistant/access');
    const { fetchMediaSafely } = await import('../TaskImportInbound');
    const { transcribeVoiceNote } = await import('./VoiceTranscriber');
    const { cleanTranscript } = await import('./VoiceCleanup');
    const { engyBrainLlm } = await import('../brain/llm');
    const store = makeVoiceStore(supabaseAdmin);
    const llm = engyBrainLlm();
    return {
        enabled: async () => (await import('../BotSwitches')).botSwitchOn('voiceNotes'),
        async recognise(phone) {
            if (!passesVoiceAllowlist(process.env.VOICE_NOTES_ALLOWED_PHONES, phone)) return null;   // checked first: no database read
            if (!passesSandbox(await TaskDatabaseService.getTestingConfig(), phone)) return null;
            const employee = await TaskDatabaseService.getEmployeeByPhone(phone);
            if (employee) return { employeeId: employee.id, userId: null };
            const user = await findWhatsAppUser(phone).catch(() => null);
            return user ? { employeeId: null, userId: user.id } : null;
        },
        download: url => fetchMediaSafely(url),
        transcribe: input => transcribeVoiceNote(input),
        cleanup: text => cleanTranscript(text, { llm }),
        tryBrain: input => handToBrain(input),
        getState: phone => store.get(phone),
        setState: (phone, state) => store.set(phone, state),
        reply: (phone, text) => TaskMessagingService.sendFreeformReply(phone, text),
        async audit(details, sender) {
            await TaskDatabaseService.logAudit({ eventType: 'voice_note', actorId: sender.employeeId, details: { ...details, userId: sender.userId } });
        },
        now: () => Date.now(),
    };
}
