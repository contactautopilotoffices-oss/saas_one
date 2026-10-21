/**
 * Turn technical failures into short messages HR staff can act on.
 *
 * Pure (no server imports), so the server uses it when recording a failed version and the
 * documents page uses it to tidy errors stored before this existed. The raw error still goes
 * to the server log. Messages that are already plain (file too large, needs OCR, ...) pass
 * through unchanged.
 */

export const FRIENDLY_ERRORS = {
  tooManyUploads: "You've uploaded many files at once. Please wait a minute and upload the rest.",
  aiBusy: "The AI service is busy right now. Please upload this file again in a few minutes.",
  aiAccount: "The AI service needs attention. Please contact your admin.",
  network: "Couldn't connect. Please check your internet and try again.",
  generic: "Something went wrong with this file. Please try again.",
} as const;

// Our own upload rate limiter (app/api/hr-assistant/_lib/admin-auth.ts).
const OUR_RATE_LIMIT = /too many requests\. please wait/i;
const AI_BUSY = /\b429\b|quota|rate.?limit|resource_exhausted|too many requests|overloaded|\b503\b/i;
const AI_ACCOUNT = /\b40[123]\b|credit|billing|prepay|api.?key|invalid_api_key|unauthori[sz]ed|permission/i;
const NETWORK = /fetch failed|network|econn|etimedout|enotfound|timed? ?out|aborted|socket/i;
// Signs a message is meant for developers: JSON, HTTP status codes, stack-ish prefixes, or very long.
const TECHNICAL = /[{}]|\(\d{3}\)|\b(error|exception|failed):|\bat \w+ \(|PGRST|\bsql\b/i;

export function friendlyError(raw: string | null | undefined): string {
  const message = (raw ?? "").trim();
  if (!message) return FRIENDLY_ERRORS.generic;
  if (OUR_RATE_LIMIT.test(message)) return FRIENDLY_ERRORS.tooManyUploads;
  if (AI_BUSY.test(message)) return FRIENDLY_ERRORS.aiBusy;
  if (AI_ACCOUNT.test(message)) return FRIENDLY_ERRORS.aiAccount;
  if (NETWORK.test(message)) return FRIENDLY_ERRORS.network;
  if (TECHNICAL.test(message) || message.length > 180) return FRIENDLY_ERRORS.generic;
  return message;
}
