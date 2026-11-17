/**
 * LiveVoice ID — talks to our voice-id service (services/voice-id, hosted free on Hugging Face Spaces).
 *
 *   health()    is the server up? (online / waking / offline / not_configured)
 *   embed()     2 to 5 short clips of ONE person → a voiceprint (192 numbers)
 *   identify()  meeting audio links + who-spoke-when + voiceprints of the people present → who each "Speaker N" is
 *
 * Settings (added by the owner in Vercel, never in code): VOICE_ID_URL, VOICE_ID_SECRET, VOICE_ID_HF_TOKEN (only for a
 * private Space). Never throws: every failure is a typed result. Never logs voiceprints, names or what was said.
 * Plan: docs/LIVEVOICE_ID_PLAN.md
 */

export const VOICEPRINT_DIM = 192;
const HEALTH_TIMEOUT_MS = 8_000;
const EMBED_TIMEOUT_MS = 60_000;
// Inside the meeting step's 280 s lease and the route's 300 s limit, with room for making the signed links
const IDENTIFY_TIMEOUT_MS = 200_000;

export interface VoiceIdDeps { fetch?: typeof fetch; env?: Record<string, string | undefined> }

export type ServerState = 'online' | 'waking' | 'offline' | 'not_configured';
export interface ServerHealth { state: ServerState; detail?: string; model?: string }

interface Config { url: string; secret: string; hfToken: string }

export function voiceIdConfig(env: Record<string, string | undefined> = process.env): Config | null {
    const url = String(env.VOICE_ID_URL ?? '').trim().replace(/\/+$/, '');
    const secret = String(env.VOICE_ID_SECRET ?? '').trim();
    if (!url || !secret || !/^https:\/\//.test(url)) return null;
    return { url, secret, hfToken: String(env.VOICE_ID_HF_TOKEN ?? '').trim() };
}

function headers(c: Config, json: boolean): Record<string, string> {
    return {
        'X-Voice-Id-Secret': c.secret,
        ...(c.hfToken ? { Authorization: `Bearer ${c.hfToken}` } : {}),
        ...(json ? { 'Content-Type': 'application/json' } : {}),
    };
}

const errText = (err: unknown) => (err instanceof Error ? (err.name === 'TimeoutError' || err.name === 'AbortError' ? 'timed out' : err.message) : String(err));

/** A Space that is asleep or starting answers with a web page or 502/503, not our JSON. */
async function readJson(res: Response): Promise<Record<string, unknown> | null> {
    const text = await res.text().catch(() => '');
    try {
        const j = JSON.parse(text);
        return j && typeof j === 'object' ? (j as Record<string, unknown>) : null;
    } catch {
        return null;
    }
}

export async function health(deps: VoiceIdDeps = {}): Promise<ServerHealth> {
    const c = voiceIdConfig(deps.env);
    if (!c) return { state: 'not_configured', detail: 'VOICE_ID_URL and VOICE_ID_SECRET are not set' };
    try {
        const res = await (deps.fetch ?? fetch)(`${c.url}/health`, { headers: headers(c, false), signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS), cache: 'no-store' });
        if (res.status === 401 || res.status === 403 || res.status === 404) {
            return { state: 'offline', detail: `HTTP ${res.status}: check VOICE_ID_URL and VOICE_ID_HF_TOKEN` };
        }
        const j = await readJson(res);
        if (res.ok && j?.ok === true) return { state: 'online', model: typeof j.model === 'string' ? j.model : undefined };
        if (res.ok && j && j.ok === false && j.error) return { state: 'offline', detail: `model failed to load (${String(j.error).slice(0, 60)})` };
        // Not our JSON yet (sleeping / building / loading the model)
        return { state: 'waking', detail: `HTTP ${res.status}` };
    } catch (err) {
        return { state: errText(err) === 'timed out' ? 'waking' : 'offline', detail: errText(err) };
    }
}

// ── enrollment ────────────────────────────────────────────────────────────────

export type ClipProblem = 'too_short' | 'too_long' | 'too_quiet' | 'too_loud' | 'too_much_silence' | null;
export interface ClipReport { seconds: number; rms: number; problem: ClipProblem }

export type EmbedResult =
    | { ok: true; voiceprint: number[]; clipAgreement: number; model: string; revision: string | null; clips: ClipReport[] }
    | { ok: false; reason: string; detail?: string; clips?: ClipReport[]; clipAgreement?: number };

export async function embed(clipsBase64: string[], deps: VoiceIdDeps = {}): Promise<EmbedResult> {
    const c = voiceIdConfig(deps.env);
    if (!c) return { ok: false, reason: 'not_configured' };
    try {
        const res = await (deps.fetch ?? fetch)(`${c.url}/embed`, {
            method: 'POST', headers: headers(c, true), body: JSON.stringify({ clips: clipsBase64 }), signal: AbortSignal.timeout(EMBED_TIMEOUT_MS),
        });
        const j = await readJson(res);
        if (!j) return { ok: false, reason: 'server_unavailable', detail: `HTTP ${res.status}` };
        const clips = Array.isArray(j.clips) ? (j.clips as ClipReport[]) : undefined;
        if (!res.ok || j.ok !== true) {
            return { ok: false, reason: String(j.reason ?? `http_${res.status}`), detail: typeof j.detail === 'string' ? j.detail : undefined, clips,
                clipAgreement: typeof j.clip_agreement === 'number' ? j.clip_agreement : undefined };
        }
        const vp = Array.isArray(j.voiceprint) ? (j.voiceprint as unknown[]).map(Number) : [];
        if (vp.length !== VOICEPRINT_DIM || vp.some(x => !Number.isFinite(x))) return { ok: false, reason: 'bad_reply' };
        return {
            ok: true, voiceprint: vp, clipAgreement: Number(j.clip_agreement) || 0, model: String(j.model ?? 'unknown'),
            revision: typeof j.revision === 'string' ? j.revision : null, clips: clips ?? [],
        };
    } catch (err) {
        return { ok: false, reason: errText(err) === 'timed out' ? 'server_unavailable' : 'failed', detail: errText(err) };
    }
}

// ── meeting identification ────────────────────────────────────────────────────

export interface VoiceSegment { file: number; start: number; end: number; speaker: string }
export type SpeakerReason = 'matched' | 'below_threshold' | 'too_close' | 'no_candidate' | 'not_enough_speech';
export interface SpeakerResult {
    speaker: string; match: string | null; score: number | null; second: number | null;
    seconds_used: number; segments_used: number; reason: SpeakerReason;
}

export type IdentifyResult =
    | { ok: true; speakers: SpeakerResult[]; model: string; threshold: number; margin: number; timingMs: number }
    | { ok: false; reason: string; detail?: string; retryable: boolean };

export async function identify(input: {
    files: string[][];
    segments: VoiceSegment[];
    candidates: Array<{ id: string; voiceprint: number[] }>;
}, deps: VoiceIdDeps = {}): Promise<IdentifyResult> {
    const c = voiceIdConfig(deps.env);
    if (!c) return { ok: false, reason: 'not_configured', retryable: false };
    try {
        const res = await (deps.fetch ?? fetch)(`${c.url}/identify`, {
            method: 'POST', headers: headers(c, true), signal: AbortSignal.timeout(IDENTIFY_TIMEOUT_MS),
            body: JSON.stringify({ files: input.files.map(urls => ({ urls })), segments: input.segments, candidates: input.candidates }),
        });
        const j = await readJson(res);
        // Asleep / starting / overloaded: worth trying again on a later poll
        if (!j) return { ok: false, reason: 'server_unavailable', detail: `HTTP ${res.status}`, retryable: true };
        if (!res.ok || j.ok !== true) {
            return { ok: false, reason: String(j.reason ?? `http_${res.status}`), detail: typeof j.detail === 'string' ? j.detail : undefined,
                retryable: res.status === 503 || res.status === 502 };
        }
        const speakers = (Array.isArray(j.speakers) ? j.speakers : []) as SpeakerResult[];
        return {
            ok: true, speakers, model: String(j.model ?? 'unknown'), threshold: Number(j.threshold) || 0, margin: Number(j.margin) || 0,
            timingMs: Number(j.timing_ms) || 0,
        };
    } catch (err) {
        return { ok: false, reason: errText(err) === 'timed out' ? 'timed_out' : 'failed', detail: errText(err), retryable: true };
    }
}
