/**
 * One chat call with backups. Each step (safety check, planner, answer) lists its models in order in config.ts;
 * the first one that answers wins. A model is skipped to the next on ANY failure: rate limit, timeout, error,
 * or an empty reply. Groq is first everywhere; Engy (glm / qwen) is the backup, through the repo's existing
 * Engy connection (COUNCIL_PROVIDER=custom, the same one the WhatsApp task brain uses), so no new key or library.
 *
 * If every model fails, the last error is thrown (a rate-limit error is preferred, so the route can still say
 * "busy"). Callers decide what that means: the safety checks fail closed, the planner falls back to "HR question".
 */
import { resolveProvider } from "@/backend/lib/council/llm";

import { getGroq, isRateLimitError } from "./clients";

export interface ModelStep {
  provider: "groq" | "engy";
  model: string;
  /** gpt-oss reasoning effort (Groq only). Engy models always run with thinking off. */
  reasoningEffort?: "low" | "medium";
}

export interface ChatRequest {
  system: string;
  user: string;
  json?: boolean;
  temperature?: number;
  /** Budget for the reply. gpt-oss counts its short reasoning in this too. */
  maxTokens?: number;
}

const ENGY_TIMEOUT_MS = 15_000;

/** The Engy endpoint and key, or null when it isn't configured. */
export function engyConfig(env: NodeJS.ProcessEnv = process.env): { baseUrl: string; apiKey: string } | null {
  const { spec, apiKey } = resolveProvider({ ...env, COUNCIL_PROVIDER: "custom" });
  if (apiKey && spec.baseUrl) return { baseUrl: spec.baseUrl, apiKey };
  const key = (env.ENGY_API_KEY || env.engy || "").trim();
  return key ? { baseUrl: env.ENGY_BASE_URL || "https://api.engy.ai/v1", apiKey: key } : null;
}

async function callGroq(step: ModelStep, req: ChatRequest): Promise<string> {
  const response = await getGroq().chat.completions.create({
    model: step.model,
    temperature: req.temperature ?? 0,
    ...(req.maxTokens ? { max_tokens: req.maxTokens } : {}),
    ...(step.reasoningEffort ? { reasoning_effort: step.reasoningEffort } : {}),
    ...(req.json ? { response_format: { type: "json_object" as const } } : {}),
    messages: [
      { role: "system", content: req.system },
      { role: "user", content: req.user },
    ],
  });
  return response.choices[0]?.message?.content?.trim() ?? "";
}

async function callEngy(step: ModelStep, req: ChatRequest): Promise<string> {
  const engy = engyConfig();
  if (!engy) throw new Error("Engy is not configured");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ENGY_TIMEOUT_MS);
  try {
    const res = await fetch(`${engy.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${engy.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: step.model,
        temperature: req.temperature ?? 0,
        max_tokens: req.maxTokens ?? 1200,
        // Thinking off: measured on the task brain, a short reply drops from ~2 s to ~0.6 s.
        reasoning_effort: "none",
        ...(req.json ? { response_format: { type: "json_object" } } : {}),
        messages: [
          { role: "system", content: req.system },
          { role: "user", content: req.user },
        ],
      }),
      signal: controller.signal,
    });
    if (!res.ok) throw Object.assign(new Error(`Engy HTTP ${res.status}`), { status: res.status });
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    return data.choices?.[0]?.message?.content?.trim() ?? "";
  } finally {
    clearTimeout(timer);
  }
}

export type ChatCaller = (step: ModelStep, req: ChatRequest) => Promise<string>;

const defaultCaller: ChatCaller = (step, req) => (step.provider === "groq" ? callGroq(step, req) : callEngy(step, req));

/** Try each model in order; return the first non-empty reply. `caller` is injectable for tests. */
export async function chatWithFallback(
  label: string,
  chain: readonly ModelStep[],
  req: ChatRequest,
  caller: ChatCaller = defaultCaller,
): Promise<string> {
  let lastError: unknown = new Error(`${label}: no models configured`);
  let rateLimitError: unknown = null;
  for (const [index, step] of chain.entries()) {
    try {
      const text = await caller(step, req);
      if (!text) throw new Error("empty reply");
      if (index > 0) console.info(`[hr-assistant] ${label}: answered by backup ${step.provider}/${step.model}`);
      return text;
    } catch (error) {
      lastError = error;
      if (isRateLimitError(error)) rateLimitError = error;
      const reason = error instanceof Error ? error.message.slice(0, 120) : String(error);
      console.warn(`[hr-assistant] ${label}: ${step.provider}/${step.model} failed (${reason})`);
    }
  }
  throw rateLimitError ?? lastError;
}
