/**
 * Call Insights, step 1 (owner 2026-11-16, plan P7): a recording to a transcript with time stamps. Reuses the
 * meetings' Groq Whisper client (task-manager/meetings/MeetingTranscriber.ts: verbose_json, one segment per sentence,
 * large-v3 first because it is better on Hindi / Hinglish). The models come from the Control Center job
 * 'call_transcribe' (docs/AI_MODELS.md); with nothing saved they are exactly today's (CALL_TRANSCRIBE_MODELS).
 * Never throws: a failure comes back as a sentence HR can read.
 */
import { CALL_TRANSCRIBE_MODELS } from "@/backend/lib/candidates/config";
import type { CallSegment } from "@/backend/lib/candidates/types";
import { transcribeWithWhisper, type AudioFile, type WhisperResult } from "@/task-manager/meetings/MeetingTranscriber";

export type TranscribeFn = (files: AudioFile[], deps?: { models?: readonly string[] }) => Promise<WhisperResult>;

export interface TranscribeDeps {
  transcribe?: TranscribeFn;
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
  no_key: "Transcription is not set up on the server (GROQ_VOICE_API_KEY). Paste the transcript instead.",
  unsupported_format: "This recording's format is not supported. Use mp3, m4a, wav, ogg or webm.",
  too_large: "The recording is larger than the transcription service allows (25 MB).",
  silent: "No speech was found in the recording.",
  rate_limited: "The transcription service is busy. Retry in a minute.",
};

export async function transcribeCall(file: AudioFile, deps: TranscribeDeps = {}): Promise<CallTranscript> {
  const run = deps.transcribe ?? transcribeWithWhisper;
  const models = deps.models ?? (await transcribeChain());
  const result = await run([file], { models });
  if (!result.ok) {
    const why = REASONS[result.reason] ?? `The transcription failed (${result.detail.slice(0, 160)}).`;
    return { ok: false, error: why };
  }
  const segments: CallSegment[] = result.lines
    .map((l) => ({ start: Math.max(0, l.start), end: Math.max(0, l.end), text: l.text.trim() }))
    .filter((s) => s.text);
  if (!segments.length) return { ok: false, error: REASONS.silent };
  const text = segments.map((s) => s.text).join(" ");
  const last = segments[segments.length - 1];
  return { ok: true, segments, text, model: result.model, durationSeconds: last.end > 0 ? Math.round(last.end) : null };
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
