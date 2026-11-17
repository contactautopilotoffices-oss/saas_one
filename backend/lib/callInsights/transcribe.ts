/**
 * Call Insights, step 1 (owner 2026-11-16, plan P7): a recording to a transcript with time stamps. The models come
 * from the Control Center job 'call_transcribe' (docs/AI_MODELS.md); with nothing saved they are exactly today's
 * (CALL_TRANSCRIBE_MODELS), tried in order until one answers.
 *
 *   'sarvam:<model>'  Owner 2026-11-17: the default. Sarvam's BATCH job, reused from the meetings
 *                     (task-manager/meetings/MeetingTranscriber.ts: startSarvamJob / checkSarvamJob), because a call
 *                     is longer than the 30-second quick call the voice notes use. Started, then asked every
 *                     CALL_SARVAM_POLL_MS for at most CALL_SARVAM_WAIT_MS; no key, a failure or no answer in time
 *                     moves on to the next model.
 *   'whisper-…'       Groq Whisper (verbose_json, one segment per sentence), the meetings' client.
 *
 * Never throws: a failure comes back as a sentence HR can read. Never logs what was said.
 */
import { CALL_SARVAM_POLL_MS, CALL_SARVAM_WAIT_MS, CALL_TRANSCRIBE_MODELS } from "@/backend/lib/candidates/config";
import type { CallSegment } from "@/backend/lib/candidates/types";
import {
  checkSarvamJob, meetingAudioExtension, startSarvamJob, transcribeWithWhisper,
  type AudioFile, type SttFailure, type TranscriptLine, type WhisperResult,
} from "@/task-manager/meetings/MeetingTranscriber";
import { SARVAM_PREFIX } from "@/task-manager/voice/VoiceTranscriber";

export type TranscribeFn = (files: AudioFile[], deps?: { models?: readonly string[] }) => Promise<WhisperResult>;

/** Sarvam's batch job; the tests pass fakes. */
export interface SarvamDeps {
  start?: typeof startSarvamJob;
  check?: typeof checkSarvamJob;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  waitMs?: number;
  pollMs?: number;
}

export interface TranscribeDeps {
  /** Whisper (tests pass a fake). */
  transcribe?: TranscribeFn;
  sarvam?: SarvamDeps;
  /** The chain to use (tests); otherwise the Control Center's choice for 'call_transcribe'. */
  models?: readonly string[];
}

export type CallTranscript =
  | { ok: true; segments: CallSegment[]; text: string; model: string; durationSeconds: number | null }
  | { ok: false; error: string };

/** The transcription chain right now: the saved choice, then today's models; today's alone when settings cannot be read. */
async function transcribeChain(): Promise<readonly string[]> {
  try {
    const { chainFor } = await import("@/task-manager/ai/AiModelSettings");
    const chain = await chainFor("call_transcribe");
    return chain.length ? chain : CALL_TRANSCRIBE_MODELS;
  } catch {
    return CALL_TRANSCRIBE_MODELS;
  }
}

const REASONS: Record<string, string> = {
  no_key: "Transcription is not set up on the server (SARVAM_API_KEY or a Groq key). Paste the transcript instead.",
  unsupported_format: "This recording's format is not supported. Use mp3, m4a, wav, ogg or webm.",
  too_large: "The recording is larger than the transcription service allows (25 MB).",
  silent: "No speech was found in the recording.",
  rate_limited: "The transcription service is busy. Retry in a minute.",
};

type Attempt = { ok: true; lines: TranscriptLine[]; model: string } | { ok: false; reason: SttFailure; detail: string };

/** One Sarvam batch job for the call: start it, then ask until it is done, it fails, or the wait is over. */
async function viaSarvam(file: AudioFile, model: string, deps: SarvamDeps = {}): Promise<Attempt> {
  const start = deps.start ?? startSarvamJob;
  const check = deps.check ?? checkSarvamJob;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = deps.now ?? Date.now;
  const waitMs = deps.waitMs ?? CALL_SARVAM_WAIT_MS;
  const pollMs = deps.pollMs ?? CALL_SARVAM_POLL_MS;
  // A plain file name: Sarvam keys its upload links by the name, and HR's file names carry spaces and brackets.
  const ext = meetingAudioExtension(file.mimeType);
  const started = await start({ files: [{ ...file, name: `call.${ext ?? "mp3"}` }], names: [], model });
  if (!started.ok) return { ok: false, reason: started.reason, detail: started.detail };
  const deadline = now() + waitMs;
  for (;;) {
    await sleep(pollMs);
    const c = await check({ jobId: started.jobId, files: started.files });
    if (c.state === "done") return { ok: true, lines: c.lines, model: `${SARVAM_PREFIX}${model}` };
    if (c.state === "failed") return { ok: false, reason: /no speech/.test(c.detail) ? "silent" : "failed", detail: c.detail };
    if (now() >= deadline) return { ok: false, reason: "failed", detail: `no answer within ${Math.round(waitMs / 1000)} s` };
  }
}

export async function transcribeCall(file: AudioFile, deps: TranscribeDeps = {}): Promise<CallTranscript> {
  const whisper = deps.transcribe ?? transcribeWithWhisper;
  const models = deps.models ?? (await transcribeChain());
  const failures: Array<{ reason: SttFailure; detail: string }> = [];
  let got: Extract<Attempt, { ok: true }> | null = null;

  for (let i = 0; i < models.length && !got; ) {
    const model = models[i];
    if (model.startsWith(SARVAM_PREFIX)) {
      const r = await viaSarvam(file, model.slice(SARVAM_PREFIX.length), deps.sarvam);
      if (r.ok) got = r;
      else {
        failures.push({ reason: r.reason, detail: r.reason === "no_key" ? r.detail : `sarvam: ${r.detail}` });
        if (r.reason !== "no_key") console.warn(`[callInsights] Sarvam ${model} failed (${r.reason}): ${r.detail.slice(0, 160)}; trying the next model`);
      }
      i += 1;
      continue;
    }
    // The Whisper models next to each other go in one call: the client walks them in order itself.
    let j = i;
    while (j < models.length && !models[j].startsWith(SARVAM_PREFIX)) j += 1;
    const r = await whisper([file], { models: models.slice(i, j) });
    if (r.ok) got = { ok: true, lines: r.lines, model: r.model };
    else failures.push({ reason: r.reason, detail: r.detail });
    i = j;
  }

  if (!got) {
    // The reason HR reads: the last real failure; "not set up" only when no service had a key.
    const real = failures.filter((f) => f.reason !== "no_key");
    const last = real[real.length - 1] ?? failures[failures.length - 1];
    if (!last) return { ok: false, error: REASONS.no_key };
    return { ok: false, error: REASONS[last.reason] ?? `The transcription failed (${last.detail.slice(0, 160)}).` };
  }
  const segments: CallSegment[] = got.lines
    .map((l) => ({ start: Math.max(0, l.start), end: Math.max(0, l.end), text: l.text.trim() }))
    .filter((s) => s.text);
  if (!segments.length) return { ok: false, error: REASONS.silent };
  const text = segments.map((s) => s.text).join(" ");
  const last = segments[segments.length - 1];
  return { ok: true, segments, text, model: got.model, durationSeconds: last.end > 0 ? Math.round(last.end) : null };
}

/** The transcript as the model reads it: one line per segment, "[m:ss] text" when the segments carry times. */
export function stampedTranscript(segments: CallSegment[] | null, text: string | null, maxChars: number): string {
  const lines = segments?.length
    ? segments.map((s) => (s.end > 0 || s.start > 0 ? `[${clock(s.start)}] ${s.text}` : s.text))
    : (text ?? "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const joined = lines.join("\n");
  return joined.length > maxChars ? `${joined.slice(0, maxChars)}\n[cut: the call continues beyond what was read]` : joined;
}

function clock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
