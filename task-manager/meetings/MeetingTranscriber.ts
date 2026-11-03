import { GROQ_TRANSCRIBE_URL } from '../voice/VoiceTranscriber';

/**
 * Meeting Notes — speech to text for a whole meeting (up to ~1 hour, 3–10 people, one phone on the table).
 *
 * Primary: Sarvam batch speech-to-text (SARVAM_API_KEY) — handles Hinglish, labels speakers ("Speaker 1", "Speaker 2"),
 * takes a 2-hour file as one job. It is ASYNCHRONOUS: `startSarvamJob` uploads and starts, `checkSarvamJob` is called
 * again on later polls until the job is done.
 * Backup: Groq Whisper (GROQ_VOICE_API_KEY, the voice-note key) — synchronous, no speaker labels.
 *
 * Takes audio BYTES (reading them from storage is the caller's job). Never throws: every failure is a typed result.
 * Never logs what was said — only provider names, status codes and reasons.
 * Plan + Agent Spec Block: docs/MEETING_TASKS_SPEC.md
 */

export const SARVAM_BASE = 'https://api.sarvam.ai/speech-to-text/job/v1';
/** saaras:v4 is Sarvam's recommended model; it is also the only one that takes `keyterms` (we pass the names present). */
export const SARVAM_MODEL = 'saaras:v4';
/** 'translit' = everything in Roman letters (owner 2026-10-09: Hindi written in Roman script). */
export const SARVAM_MODE = 'translit';
/** 'unknown' = Sarvam detects the language (meetings switch between English and Hindi). */
export const SARVAM_LANGUAGE = 'unknown';
export const SARVAM_MAX_FILES = 20;
export const SARVAM_MAX_KEYTERMS = 50;

export const MEETING_WHISPER_MODELS: readonly string[] = ['whisper-large-v3', 'whisper-large-v3-turbo'];
/** Groq's per-request file limit. A 1-hour recording at the recorder's 24 kbps is ~11 MB. */
export const WHISPER_MAX_BYTES = 25 * 1024 * 1024;
const WHISPER_TIMEOUT_MS = 150_000;
const SARVAM_TIMEOUT_MS = 60_000;

export interface TranscriptLine { speaker: string | null; start: number; end: number; text: string }
/** One continuous recording. A meeting has more than one only if the recording was restarted (or a file was uploaded). */
export interface AudioFile { name: string; mimeType: string; bytes: Buffer }

export type SttFailure = 'no_key' | 'unsupported_format' | 'too_large' | 'too_many_files' | 'silent' | 'rate_limited' | 'failed';
type Failures = Array<{ step: string; error: string }>;

export interface SttDeps { fetch?: typeof fetch; env?: Record<string, string | undefined> }

const EXTENSIONS: Record<string, string> = {
    'audio/webm': 'webm', 'video/webm': 'webm', 'audio/ogg': 'ogg', 'audio/opus': 'ogg', 'audio/mp4': 'm4a', 'video/mp4': 'mp4',
    'audio/m4a': 'm4a', 'audio/x-m4a': 'm4a', 'audio/aac': 'm4a', 'audio/mpeg': 'mp3', 'audio/mp3': 'mp3',
    'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/wave': 'wav', 'audio/flac': 'flac',
};
export const baseMime = (m: string | null | undefined) => String(m || '').toLowerCase().split(';')[0].trim();
export function meetingAudioExtension(mimeType: string | null | undefined): string | null {
    return EXTENSIONS[baseMime(mimeType)] ?? null;
}

const errText = (err: unknown) => (err instanceof Error ? (err.name === 'TimeoutError' || err.name === 'AbortError' ? 'timed out' : err.message) : String(err));
const num = (v: unknown, fallback = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const clean = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim();

/** Joins several recordings into one timeline: each file starts where the previous one ended. */
export function joinFiles(perFile: TranscriptLine[][]): TranscriptLine[] {
    const out: TranscriptLine[] = [];
    let offset = 0;
    for (const lines of perFile) {
        for (const l of lines) out.push({ ...l, start: l.start + offset, end: l.end + offset });
        const last = lines.length ? Math.max(...lines.map(l => l.end)) : 0;
        offset += last;
    }
    return out;
}

// ── Sarvam (primary, asynchronous) ────────────────────────────────────────────

export type SarvamStart =
    | { ok: true; jobId: string; files: string[] }
    | { ok: false; reason: SttFailure; detail: string; failures: Failures };

export interface SarvamStartInput {
    files: AudioFile[];
    /** People present (attendees + typed names). Used as the speaker count hint and as key terms for spelling. */
    names: string[];
}

export async function startSarvamJob(input: SarvamStartInput, deps: SttDeps = {}): Promise<SarvamStart> {
    const failures: Failures = [];
    const fail = (reason: SttFailure, detail: string): SarvamStart => ({ ok: false, reason, detail, failures });
    try {
        const env = deps.env ?? process.env;
        const doFetch = deps.fetch ?? fetch;
        const key = String(env.SARVAM_API_KEY ?? '').trim();
        if (!key) return fail('no_key', 'SARVAM_API_KEY is not configured');
        if (input.files.length === 0) return fail('silent', 'no audio');
        if (input.files.length > SARVAM_MAX_FILES) return fail('too_many_files', `${input.files.length} recordings (max ${SARVAM_MAX_FILES})`);
        for (const f of input.files) if (!meetingAudioExtension(f.mimeType)) return fail('unsupported_format', `unsupported audio type "${baseMime(f.mimeType).slice(0, 40)}"`);

        const headers = { 'api-subscription-key': key, 'Content-Type': 'application/json' };
        const names = [...new Set(input.names.map(clean).filter(n => n.length > 0 && n.length <= 64))].slice(0, SARVAM_MAX_KEYTERMS);
        const speakers = Math.min(20, input.names.length);
        const jobParameters: Record<string, unknown> = {
            model: SARVAM_MODEL, mode: SARVAM_MODE, language_code: SARVAM_LANGUAGE, with_timestamps: true, with_diarization: true,
            ...(speakers >= 2 ? { num_speakers: speakers } : {}),
            ...(names.length ? { keyterms: names } : {}),
        };

        // 1. create the job
        const created = await doFetch(SARVAM_BASE, { method: 'POST', headers, body: JSON.stringify({ job_parameters: jobParameters }), signal: AbortSignal.timeout(SARVAM_TIMEOUT_MS) });
        if (!created.ok) return fail(created.status === 429 ? 'rate_limited' : 'failed', `create job: HTTP ${created.status}`);
        const job = (await created.json().catch(() => null)) as { job_id?: unknown } | null;
        const jobId = typeof job?.job_id === 'string' ? job.job_id : '';
        if (!jobId) return fail('failed', 'create job: no job id');

        // 2. upload links, then the files
        const fileNames = input.files.map(f => f.name);
        const links = await doFetch(`${SARVAM_BASE}/upload-files`, { method: 'POST', headers, body: JSON.stringify({ job_id: jobId, files: fileNames }), signal: AbortSignal.timeout(SARVAM_TIMEOUT_MS) });
        if (!links.ok) return fail(links.status === 429 ? 'rate_limited' : 'failed', `upload links: HTTP ${links.status}`);
        const linkBody = (await links.json().catch(() => null)) as { upload_urls?: Record<string, { file_url?: unknown }>; storage_container_type?: unknown } | null;
        const azure = String(linkBody?.storage_container_type ?? '').startsWith('Azure');
        for (const f of input.files) {
            const url = linkBody?.upload_urls?.[f.name]?.file_url;
            if (typeof url !== 'string' || !/^https:\/\//.test(url)) return fail('failed', `upload links: none for ${f.name}`);
            const put = await doFetch(url, {
                method: 'PUT', body: f.bytes as unknown as BodyInit, signal: AbortSignal.timeout(SARVAM_TIMEOUT_MS * 2),
                headers: { 'Content-Type': baseMime(f.mimeType), ...(azure ? { 'x-ms-blob-type': 'BlockBlob' } : {}) },
            });
            if (!put.ok) return fail('failed', `upload ${f.name}: HTTP ${put.status}`);
        }

        // 3. start
        const started = await doFetch(`${SARVAM_BASE}/${encodeURIComponent(jobId)}/start`, { method: 'POST', headers: { 'api-subscription-key': key }, signal: AbortSignal.timeout(SARVAM_TIMEOUT_MS) });
        if (!started.ok) return fail(started.status === 429 ? 'rate_limited' : 'failed', `start job: HTTP ${started.status}`);
        return { ok: true, jobId, files: fileNames };
    } catch (err) {
        failures.push({ step: 'sarvam', error: errText(err) });
        return fail('failed', errText(err));
    }
}

export type SarvamCheck =
    | { state: 'running' }
    | { state: 'done'; lines: TranscriptLine[] }
    | { state: 'failed'; detail: string };

/** Sarvam's output file: speaker-labelled entries when diarization worked, else timed chunks, else one block of text. */
export function parseSarvamOutput(raw: unknown): TranscriptLine[] {
    const j = (raw && typeof raw === 'object' ? raw : {}) as {
        transcript?: unknown;
        diarized_transcript?: { entries?: Array<{ transcript?: unknown; start_time_seconds?: unknown; end_time_seconds?: unknown; speaker_id?: unknown }> };
        timestamps?: { chunks?: unknown[]; start_time_seconds?: unknown[]; end_time_seconds?: unknown[] };
    };
    const entries = Array.isArray(j.diarized_transcript?.entries) ? j.diarized_transcript!.entries! : [];
    if (entries.length) {
        // Speaker ids are "0", "1", … — shown to people as Speaker 1, Speaker 2, …
        return entries.map(e => {
            const id = Number.parseInt(String(e.speaker_id ?? ''), 10);
            return { speaker: Number.isFinite(id) ? `Speaker ${id + 1}` : null, start: num(e.start_time_seconds), end: num(e.end_time_seconds), text: clean(e.transcript) };
        }).filter(l => l.text);
    }
    const chunks = Array.isArray(j.timestamps?.chunks) ? j.timestamps!.chunks! : [];
    if (chunks.length) {
        const starts = j.timestamps?.start_time_seconds ?? [];
        const ends = j.timestamps?.end_time_seconds ?? [];
        return chunks.map((c, i) => ({ speaker: null, start: num(starts[i]), end: num(ends[i]), text: clean(c) })).filter(l => l.text);
    }
    const text = clean(j.transcript);
    return text ? [{ speaker: null, start: 0, end: 0, text }] : [];
}

export async function checkSarvamJob(input: { jobId: string; files: string[] }, deps: SttDeps = {}): Promise<SarvamCheck> {
    try {
        const env = deps.env ?? process.env;
        const doFetch = deps.fetch ?? fetch;
        const key = String(env.SARVAM_API_KEY ?? '').trim();
        if (!key) return { state: 'failed', detail: 'SARVAM_API_KEY is not configured' };
        const headers = { 'api-subscription-key': key, 'Content-Type': 'application/json' };

        const res = await doFetch(`${SARVAM_BASE}/${encodeURIComponent(input.jobId)}/status`, { headers: { 'api-subscription-key': key }, signal: AbortSignal.timeout(SARVAM_TIMEOUT_MS) });
        if (!res.ok) return res.status >= 500 || res.status === 429 ? { state: 'running' } : { state: 'failed', detail: `status: HTTP ${res.status}` };
        const s = (await res.json().catch(() => null)) as {
            job_state?: unknown; error_message?: unknown;
            job_details?: Array<{ inputs?: Array<{ file_name?: unknown }>; outputs?: Array<{ file_name?: unknown }>; state?: unknown; error_message?: unknown }>;
        } | null;
        const state = String(s?.job_state ?? '');
        if (state === 'Failed') return { state: 'failed', detail: `job failed: ${clean(s?.error_message).slice(0, 200) || 'no reason given'}` };
        if (state !== 'Completed') return { state: 'running' };

        // Input file → its output file, kept in OUR order (the order the recordings were made)
        const details = Array.isArray(s?.job_details) ? s!.job_details! : [];
        const outputFor = new Map<string, string>();
        for (const d of details) {
            const inName = String(d.inputs?.[0]?.file_name ?? '');
            const outName = String(d.outputs?.[0]?.file_name ?? '');
            if (String(d.state ?? '') !== 'Success' || !outName) return { state: 'failed', detail: `file ${inName || '?'} failed: ${clean(d.error_message).slice(0, 200)}` };
            outputFor.set(inName, outName);
        }
        const outputs = input.files.map(f => outputFor.get(f) ?? '');
        if (outputs.some(o => !o)) return { state: 'failed', detail: 'a recording has no result' };

        const dl = await doFetch(`${SARVAM_BASE}/download-files`, { method: 'POST', headers, body: JSON.stringify({ job_id: input.jobId, files: outputs }), signal: AbortSignal.timeout(SARVAM_TIMEOUT_MS) });
        if (!dl.ok) return dl.status >= 500 || dl.status === 429 ? { state: 'running' } : { state: 'failed', detail: `download links: HTTP ${dl.status}` };
        const dlBody = (await dl.json().catch(() => null)) as { download_urls?: Record<string, { file_url?: unknown }> } | null;

        const perFile: TranscriptLine[][] = [];
        for (const out of outputs) {
            const url = dlBody?.download_urls?.[out]?.file_url;
            if (typeof url !== 'string' || !/^https:\/\//.test(url)) return { state: 'failed', detail: `no download link for ${out}` };
            const file = await doFetch(url, { signal: AbortSignal.timeout(SARVAM_TIMEOUT_MS) });
            if (!file.ok) return { state: 'failed', detail: `download ${out}: HTTP ${file.status}` };
            perFile.push(parseSarvamOutput(await file.json().catch(() => null)));
        }
        const lines = joinFiles(perFile);
        return lines.length ? { state: 'done', lines } : { state: 'failed', detail: 'no speech in the result' };
    } catch {
        // A network blip is not a failed job: try again on the next poll
        return { state: 'running' };
    }
}

// ── Whisper (backup, synchronous) ─────────────────────────────────────────────

export type WhisperResult =
    | { ok: true; lines: TranscriptLine[]; model: string; failures: Failures }
    | { ok: false; reason: SttFailure; detail: string; failures: Failures };

interface WhisperVerbose { text?: unknown; segments?: Array<{ start?: unknown; end?: unknown; text?: unknown; no_speech_prob?: unknown }> }

export async function transcribeWithWhisper(files: AudioFile[], deps: SttDeps & { models?: readonly string[] } = {}): Promise<WhisperResult> {
    const failures: Failures = [];
    const fail = (reason: SttFailure, detail: string): WhisperResult => ({ ok: false, reason, detail, failures });
    try {
        const env = deps.env ?? process.env;
        const doFetch = deps.fetch ?? fetch;
        const key = String(env.GROQ_VOICE_API_KEY ?? '').trim();
        if (!key) return fail('no_key', 'GROQ_VOICE_API_KEY is not configured');
        if (files.length === 0) return fail('silent', 'no audio');

        const perFile: TranscriptLine[][] = [];
        let usedModel = '';
        for (const f of files) {
            const ext = meetingAudioExtension(f.mimeType);
            if (!ext) return fail('unsupported_format', `unsupported audio type "${baseMime(f.mimeType).slice(0, 40)}"`);
            if (f.bytes.length > WHISPER_MAX_BYTES) return fail('too_large', `${f.name} is ${f.bytes.length} bytes`);
            let lines: TranscriptLine[] | null = null;
            let lastStatus = 0;
            for (const model of deps.models ?? MEETING_WHISPER_MODELS) {
                try {
                    const form = new FormData();
                    form.append('file', new Blob([f.bytes as BlobPart], { type: baseMime(f.mimeType) }), `meeting.${ext}`);
                    form.append('model', model);
                    form.append('response_format', 'verbose_json');
                    form.append('temperature', '0');
                    const res = await doFetch(GROQ_TRANSCRIBE_URL, { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: form, signal: AbortSignal.timeout(WHISPER_TIMEOUT_MS) });
                    if (!res.ok) { lastStatus = res.status; throw new Error(`HTTP ${res.status}`); }
                    const j = (await res.json()) as WhisperVerbose | null;
                    const segs = Array.isArray(j?.segments) ? j!.segments! : [];
                    lines = segs.length
                        ? segs.filter(s => !(typeof s.no_speech_prob === 'number' && s.no_speech_prob > 0.6))
                            .map(s => ({ speaker: null, start: num(s.start), end: num(s.end), text: clean(s.text) })).filter(l => l.text)
                        : (clean(j?.text) ? [{ speaker: null, start: 0, end: 0, text: clean(j?.text) }] : []);
                    usedModel = model;
                    break;
                } catch (err) {
                    failures.push({ step: `whisper ${model}`, error: errText(err) });
                    console.warn(`[MeetingTranscriber] ${model} failed: ${errText(err)}`);
                }
            }
            if (!lines) return fail(lastStatus === 429 ? 'rate_limited' : 'failed', failures.map(x => `${x.step}: ${x.error}`).join('; '));
            perFile.push(lines);
        }
        const all = joinFiles(perFile);
        return all.length ? { ok: true, lines: all, model: usedModel, failures } : fail('silent', 'no speech detected');
    } catch (err) {
        return fail('failed', errText(err));
    }
}
