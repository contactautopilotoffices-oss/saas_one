/**
 * Which files may be uploaded as call recordings (owner 2026-11-16). Pure, so the browser (the Calls tab's file
 * picker), the server and the tests share it; config.ts re-exports it for the server. Nothing here reads a file's
 * contents.
 */

/** Same as the bucket's file_size_limit in migration 20261116000001: the transcription service's per-request limit. */
export const MAX_CALL_BYTES = 25 * 1024 * 1024;

/**
 * By extension, the type stored and sent to the transcription service. Phone recorders write m4a (iPhone, most
 * Androids), mp3, ogg / opus (WhatsApp, some Androids) or wav; a browser recorder writes webm.
 */
export const CALL_AUDIO_TYPES: Record<string, string> = {
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".oga": "audio/ogg",
  ".opus": "audio/ogg",
  ".webm": "audio/webm",
  ".flac": "audio/flac",
};

/** For the file picker's `accept`. */
export const CALL_AUDIO_ACCEPT = Object.keys(CALL_AUDIO_TYPES).join(",");

export function callFileExtension(name: string): string {
  const m = /\.[a-z0-9]+$/i.exec(name.trim());
  return m ? m[0].toLowerCase() : "";
}

/** The stored type for this file name, or null when it is not a recording we take. */
export function callFileType(name: string): string | null {
  return CALL_AUDIO_TYPES[callFileExtension(name)] ?? null;
}

/** "m:ss" for a time in seconds, as the transcript shows it. */
export function formatClock(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return "";
  const s = Math.max(0, Math.round(seconds));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}
