/**
 * Candidate Search's model calls. Owner 2026-11-02: the models are picked in the Control Center ("AI models"), like the
 * Task Manager's jobs: 'candidate_parse' (reading the search) and 'candidate_rank' (ranking candidates), each a main
 * model plus up to 3 backups, default Claude Opus 5.5. The chain comes from the Task Manager's chainFor(), which skips
 * models whose key is missing and always ends with the default, so a setting can never stop a search.
 *
 * Per model in the chain, in order, within the step's time budget:
 *   'anthropic:…' -> the official SDK (CLAUDE_API_KEY, the key the Control Center checks; ANTHROPIC_API_KEY as fallback),
 *                    with the reply's JSON schema in output_config and the step's effort
 *   anything else -> the Task Manager's shared transport (task-manager/brain/llm.ts: Groq, Gemini, Engy), JSON mode
 * The next model is tried on an error, a timeout, or a reply that does not pass the step's `accept` check.
 */
import Anthropic from "@anthropic-ai/sdk";

import type { AiJob } from "@/task-manager/ai/aiCatalog";

export interface JsonRequest {
  /** Short name for logs. */
  label: string;
  system: string;
  user: string;
  /** JSON schema for Claude's structured output (every object needs additionalProperties: false). */
  schema: Record<string, unknown>;
  /** Claude effort. */
  effort: "low" | "medium" | "high";
  /** Claude: covers adaptive thinking + the JSON answer. */
  maxTokens: number;
  /** Other providers: the answer only. */
  otherMaxTokens: number;
  /** Per model. */
  timeoutMs: number;
  /** For the whole chain: no new model is started once less than MIN_TRY_MS is left. */
  budgetMs: number;
  /** A reply that fails this moves on to the next model. */
  accept?: (text: string) => boolean;
  /**
   * A PDF sent with the message, pages as the model sees them (owner 2026-11-11: scanned resumes). Claude only: the
   * other providers in a chain are skipped for a request that carries one.
   */
  document?: { mediaType: "application/pdf"; base64: string };
}

export interface JsonReply {
  text: string;
  /** The model that answered, as the Control Center names it (e.g. "anthropic:claude-opus-5-5"). */
  model: string;
  /** Tokens billed, when the provider reports them (Claude does); doctrine L14. */
  usage?: { input: number; output: number };
}

export type JsonCaller = (req: JsonRequest) => Promise<JsonReply>;

/** A provider answers with the text, or the text plus its token counts. */
export type ProviderReply = string | { text: string; usage?: JsonReply["usage"] };

export interface ChainDeps {
  chain: (job: AiJob) => Promise<string[]>;
  claude: (model: string, req: JsonRequest, timeoutMs: number) => Promise<ProviderReply>;
  other: (model: string, req: JsonRequest, timeoutMs: number) => Promise<ProviderReply>;
  now: () => number;
}

const ANTHROPIC = "anthropic:";
const MIN_TRY_MS = 3000;

let client: { key: string; sdk: Anthropic } | null = null;

async function callClaude(model: string, req: JsonRequest, timeoutMs: number): Promise<ProviderReply> {
  const key = (process.env.CLAUDE_API_KEY || process.env.ANTHROPIC_API_KEY || "").trim();
  if (!key) throw new Error("CLAUDE_API_KEY is not set");
  if (client?.key !== key) client = { key, sdk: new Anthropic({ apiKey: key }) };
  const res = await client.sdk.messages.create(
    {
      model,
      max_tokens: req.maxTokens,
      system: req.system,
      output_config: { effort: req.effort, format: { type: "json_schema", schema: req.schema } },
      messages: [{
        role: "user",
        content: req.document
          ? [
            { type: "document", source: { type: "base64", media_type: req.document.mediaType, data: req.document.base64 } },
            { type: "text", text: req.user },
          ]
          : req.user,
      }],
    },
    // No SDK retry: the next model in the chain is the retry.
    { timeout: timeoutMs, maxRetries: 0 },
  );
  if (res.stop_reason === "refusal") throw new Error("Claude declined the request");
  if (res.stop_reason === "max_tokens") throw new Error("Claude ran out of tokens");
  const text = res.content.find((block) => block.type === "text");
  if (!text || text.type !== "text" || !text.text.trim()) throw new Error("Claude returned no answer");
  return { text: text.text, usage: { input: res.usage.input_tokens, output: res.usage.output_tokens } };
}

async function callOther(model: string, req: JsonRequest, timeoutMs: number): Promise<string> {
  const { engyBrainLlm } = await import("@/task-manager/brain/llm");
  const reply = await engyBrainLlm({ timeoutMs }).complete({
    model,
    system: req.system,
    user: req.user,
    maxTokens: req.otherMaxTokens,
    json: true,
  });
  return reply.text;
}

const DEFAULT_DEPS: ChainDeps = {
  chain: async (job) => (await import("@/task-manager/ai/AiModelSettings")).chainFor(job),
  claude: callClaude,
  other: callOther,
  now: Date.now,
};

function reason(error: unknown): string {
  if (error instanceof Anthropic.APIError) return `Claude ${error.status ?? ""} ${error.message}`.trim();
  return error instanceof Error ? error.message : String(error);
}

/** Run the step's chain; the first acceptable reply wins. Throws only when every model failed or time ran out. */
export async function callModels(job: AiJob, req: JsonRequest, deps: Partial<ChainDeps> = {}): Promise<JsonReply> {
  const d = { ...DEFAULT_DEPS, ...deps };
  const chain = await d.chain(job);
  const deadline = d.now() + req.budgetMs;
  const problems: string[] = [];
  for (const model of chain) {
    const left = deadline - d.now();
    if (left < MIN_TRY_MS) {
      problems.push("out of time");
      break;
    }
    const timeoutMs = Math.min(req.timeoutMs, left);
    try {
      if (req.document && !model.startsWith(ANTHROPIC)) throw new Error("this model cannot read a PDF");
      const reply = model.startsWith(ANTHROPIC)
        ? await d.claude(model.slice(ANTHROPIC.length), req, timeoutMs)
        : await d.other(model, req, timeoutMs);
      const text = typeof reply === "string" ? reply : reply.text;
      if (req.accept && !req.accept(text)) throw new Error("the reply did not have the expected shape");
      return { text, model, ...(typeof reply === "string" || !reply.usage ? {} : { usage: reply.usage }) };
    } catch (error) {
      const why = reason(error).slice(0, 160);
      problems.push(`${model}: ${why}`);
      console.warn(`[candidates] ${req.label}: ${model} failed (${why})`);
    }
  }
  throw new Error(`${req.label}: no model answered (${problems.join("; ") || "no model configured"})`);
}

/** The caller for one Control Center job. */
export function jobCaller(job: AiJob): JsonCaller {
  return (req) => callModels(job, req);
}
