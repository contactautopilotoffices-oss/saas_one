/** Lazily-created SDK clients, so importing this module never needs env vars. */
import Groq from "groq-sdk";
import { geminiKeys } from "@/backend/lib/llm/providerKeys";

/** One client per key (owner 2026-11-15: the shared Groq keys are used in turn, backend/lib/llm/providerKeys.ts). */
const groqByKey = new Map<string, Groq>();

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}. Add it to your environment (.env.local).`);
  return value;
}

// Fail fast: on a rate limit the SDK would otherwise wait out Groq's retry-after (20 s+) and
// retry silently, leaving the employee staring at "thinking". The route turns a 429 into a
// friendly "busy" message instead.
const GROQ_TIMEOUT_MS = 10_000;

export function getGroq(apiKey: string): Groq {
  let client = groqByKey.get(apiKey);
  if (!client) groqByKey.set(apiKey, (client = new Groq({ apiKey, timeout: GROQ_TIMEOUT_MS, maxRetries: 0 })));
  return client;
}

/** Is this error Groq (or Gemini) saying "too many requests / quota"? */
export function isRateLimitError(error: unknown): boolean {
  const status = (error as { status?: number })?.status;
  const message = error instanceof Error ? error.message : String(error ?? "");
  return status === 429 || /\b429\b|rate.?limit|quota|resource_exhausted/i.test(message);
}

/** The shared Gemini keys are set (GEMINI_API_KEY, _2, _3, or the older GOOGLE_AI_API_KEY). Owner 2026-11-15. */
export function requireGeminiKey(): void {
  if (!geminiKeys().length) throw new Error("Missing GEMINI_API_KEY (or GEMINI_API_KEY_2 / _3). Add it to .env.local.");
}
