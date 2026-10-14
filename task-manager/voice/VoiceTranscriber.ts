/**
 * Voice Note Intake — step 2: speech to text (Groq Whisper).
 *
 * Takes audio BYTES (downloading is the caller's job) and returns text or a typed failure. Never throws.
 * Raw fetch + FormData, the same pattern as backend/lib/coaching/whisper.ts, so no SDK and no new library.
 * Dedicated key GROQ_VOICE_API_KEY: the shared GROQ_API_KEY's free quota is already used by other features.
 * Never logs what was said — only model names, status codes and reasons.
 * Plan + Agent Spec Block: docs/VOICE_NOTE_INTAKE_PLAN.md
 */

export const GROQ_TRANSCRIBE_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';

/** large-v3 first (better on Hindi / Hinglish), turbo if it errors or is rate-limited (Groq limits are per model). */
export const VOICE_TRANSCRIBE_MODELS: readonly string[] = ['whisper-large-v3', 'whisper-large-v3-turbo'];

export const MAX_AUDIO_SECONDS = 120;
export const MAX_AUDIO_BYTES = 10 * 1024 * 1024;
// Groq answers a 2-minute note in seconds. 20 s per model keeps the whole voice turn inside the webhook's 120 s limit.
const TIMEOUT_MS = 20_000;

/**
 * Whisper's `prompt` steers style, not content. A short Hinglish line in Roman script nudges Hindi speech towards
 * Roman letters and keeps task words ("task", "done", "assign") in English.
 */
const STYLE_PROMPT = 'Haan, Rahul ko kal subah AC filter check ka task assign kar do. Mera task done ho gaya. What are my tasks today?';

/** What Groq accepts, by the mime type the provider sends (WhatsApp voice notes are "audio/ogg; codecs=opus"). */
const EXTENSIONS: Record<string, string> = {
    'audio/ogg': 'ogg', 'audio/opus': 'ogg', 'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/mp4': 'm4a', 'audio/m4a': 'm4a',
    'audio/x-m4a': 'm4a', 'audio/aac': 'm4a', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/wave': 'wav', 'audio/webm': 'webm', 'audio/flac': 'flac',
};

export function audioExtension(mimeType: string | null | undefined): string | null {
    const base = String(mimeType || '').toLowerCase().split(';')[0].trim();
    return EXTENSIONS[base] ?? null;
}

/**
 * Length of an Ogg Opus file in seconds, read from the bytes (no decoding): the last page's granule position minus the
 * pre-skip, at Opus's fixed 48 kHz. Lets a too-long note be refused BEFORE it costs any quota. null = cannot tell.
 */
export function oggOpusDurationSeconds(buf: Buffer): number | null {
    try {
        if (buf.length < 47 || buf.toString('latin1', 0, 4) !== 'OggS') return null;
        const head = buf.indexOf('OpusHead', 0, 'latin1');
        if (head < 0 || head + 12 > buf.length) return null;
        const preSkip = buf.readUInt16LE(head + 10);
        for (let i = buf.lastIndexOf('OggS', buf.length - 1, 'latin1'); i >= 0; i = buf.lastIndexOf('OggS', i - 1, 'latin1')) {
            if (i + 14 > buf.length) continue;
            const granule = buf.readBigInt64LE(i + 6);
            if (granule >= BigInt(0)) return Math.max(0, Number(granule) - preSkip) / 48_000; // -1 = no packet ends on this page
            if (i === 0) break;
        }
        return null;
    } catch {
        return null;
    }
}

/** Whisper's well-known inventions on silence or noise: treat as "nothing was said". */
const SILENCE_PHRASES = new Set(['thank you', 'thanks for watching', 'thank you for watching', 'subtitles by the amara org community', 'you']);
const NO_SPEECH_PROB = 0.6;

export type TranscribeFailure = 'no_key' | 'unsupported_format' | 'too_large' | 'too_long' | 'silent' | 'rate_limited' | 'failed';

export type TranscribeResult =
    | { ok: true; text: string; language: string | null; durationSec: number | null; model: string; failures: Array<{ model: string; error: string }> }
    | { ok: false; reason: TranscribeFailure; detail: string; failures: Array<{ model: string; error: string }> };

export interface TranscribeInput { audio: Buffer; mimeType: string | null }

/** The parts of Groq's verbose_json reply we read. Every field is checked before use. */
interface GroqVerboseJson { text?: unknown; language?: unknown; duration?: unknown; segments?: unknown }

export interface TranscribeDeps {
    fetch?: typeof fetch;
    env?: Record<string, string | undefined>;
    models?: readonly string[];
}

export async function transcribeVoiceNote(input: TranscribeInput, deps: TranscribeDeps = {}): Promise<TranscribeResult> {
    const failures: Array<{ model: string; error: string }> = [];
    const fail = (reason: TranscribeFailure, detail: string): TranscribeResult => ({ ok: false, reason, detail, failures });
    try {
        const env = deps.env ?? process.env;
        const doFetch = deps.fetch ?? fetch;
        const apiKey = env.GROQ_VOICE_API_KEY;
        if (!apiKey) return fail('no_key', 'GROQ_VOICE_API_KEY is not configured');

        const ext = audioExtension(input.mimeType);
        if (!ext) return fail('unsupported_format', `unsupported audio type "${String(input.mimeType || 'none').slice(0, 60)}"`);
        if (!Buffer.isBuffer(input.audio) || input.audio.length === 0) return fail('silent', 'empty audio');
        if (input.audio.length > MAX_AUDIO_BYTES) return fail('too_large', `audio is ${input.audio.length} bytes`);
        const known = ext === 'ogg' ? oggOpusDurationSeconds(input.audio) : null;
        if (known !== null && known > MAX_AUDIO_SECONDS) return fail('too_long', `audio is ${Math.round(known)} s`);

        let lastStatus = 0;
        for (const model of deps.models ?? VOICE_TRANSCRIBE_MODELS) {
            lastStatus = 0;
            try {
                const form = new FormData();
                form.append('file', new Blob([input.audio as BlobPart], { type: String(input.mimeType) }), `voice.${ext}`);
                form.append('model', model);
                form.append('response_format', 'verbose_json');
                form.append('temperature', '0');
                form.append('prompt', STYLE_PROMPT);
                const res = await doFetch(GROQ_TRANSCRIBE_URL, {
                    method: 'POST', headers: { Authorization: `Bearer ${apiKey}` }, body: form, signal: AbortSignal.timeout(TIMEOUT_MS),
                });
                if (!res.ok) { lastStatus = res.status; throw new Error(`HTTP ${res.status}`); }
                const j = (await res.json()) as GroqVerboseJson | null;
                const segments: Array<{ no_speech_prob?: unknown }> = Array.isArray(j?.segments) ? j.segments : [];
                const duration = typeof j?.duration === 'number' && Number.isFinite(j.duration) ? j.duration : known;
                if (duration !== null && duration > MAX_AUDIO_SECONDS) return fail('too_long', `audio is ${Math.round(duration)} s`);
                const text = String(j?.text ?? '').replace(/\s+/g, ' ').trim();
                const allNoise = segments.length > 0 && segments.every(s => typeof s?.no_speech_prob === 'number' && s.no_speech_prob > NO_SPEECH_PROB);
                const bare = text.toLowerCase().replace(/[^a-z ]+/g, ' ').replace(/\s+/g, ' ').trim();
                if (!text || allNoise || SILENCE_PHRASES.has(bare)) return fail('silent', 'no speech detected');
                return { ok: true, text, language: typeof j?.language === 'string' ? j.language : null, durationSec: duration, model, failures };
            } catch (err) {
                const error = err instanceof Error ? (err.name === 'TimeoutError' || err.name === 'AbortError' ? 'timed out' : err.message) : String(err);
                failures.push({ model, error });
                console.warn(`[VoiceTranscriber] ${model} failed: ${error}`);
            }
        }
        return fail(lastStatus === 429 ? 'rate_limited' : 'failed', failures.map(f => `${f.model}: ${f.error}`).join('; '));
    } catch (err) {
        return fail('failed', err instanceof Error ? err.message : 'transcription failed');
    }
}
