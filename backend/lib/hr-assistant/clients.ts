/** Lazily-created SDK clients, so importing this module never needs env vars. */
import Groq from "groq-sdk";

let groq: Groq | undefined;

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}. Add it to your environment (.env.local).`);
  return value;
}

// Fail fast: on a rate limit the SDK would otherwise wait out Groq's retry-after (20 s+) and
// retry silently, leaving the employee staring at "thinking". The route turns a 429 into a
// friendly "busy" message instead.
const GROQ_TIMEOUT_MS = 10_000;

export function getGroq(): Groq {
  return (groq ??= new Groq({ apiKey: requireEnv("GROQ_API_KEY"), timeout: GROQ_TIMEOUT_MS, maxRetries: 0 }));
}

/** Is this error Groq (or Gemini) saying "too many requests / quota"? */
export function isRateLimitError(error: unknown): boolean {
  const status = (error as { status?: number })?.status;
  const message = error instanceof Error ? error.message : String(error ?? "");
  return status === 429 || /\b429\b|rate.?limit|quota|resource_exhausted/i.test(message);
}

/** Same key fallback as the rest of the app (backend/services/aiProcessor.ts uses GOOGLE_AI_API_KEY). */
export function getGeminiApiKey(): string {
  const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY;
  if (!key) throw new Error("Missing GEMINI_API_KEY (or GOOGLE_AI_API_KEY). Add it to .env.local.");
  return key;
}
