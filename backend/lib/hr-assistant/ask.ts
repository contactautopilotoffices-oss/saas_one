/**
 * The ask pipeline: plan -> (HR questions only) input guard + retrieve -> answer -> output guard -> log.
 *
 * Small talk, off-topic and jailbreak messages get a short reply from the planner and never
 * search the policies or call the safety model (see planner.ts), which also keeps token use
 * low. Only HR questions run the guards and retrieve -> answer. The last few chat turns are
 * passed along so follow-ups ("and sick leave?") work.
 *
 * `ask` takes its dependencies as arguments so tests can swap in fakes;
 * `createHrAssistant` wires up the real Groq / Gemini / Supabase ones.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { ANSWER_MODELS, NO_CONTEXT_MESSAGE, REFUSAL_MESSAGE, SYSTEM_PROMPT } from "./config";
import { checkInput, checkOutput, type GuardResult } from "./guardrails";
import { chatWithFallback } from "./llm";
import { cannedReply, formatHistory, planWithModel, quickIntent, type ChatTurn, type Intent, type Plan } from "./planner";
import { retrievePolicyChunks, type PolicyChunk } from "./retrieve";
import { traced } from "./tracing";

export type BlockedStage = "input" | "output";

export interface AskResult {
  answer: string;
  blocked: BlockedStage | null;
  sources: PolicyChunk[];
  /** What the planner decided this message was. */
  intent: Intent;
}

export interface AskLogEntry {
  question: string;
  answer: string;
  blockedStage: BlockedStage | null;
  blockReason: string | null;
  latencyMs: number;
}

export interface AskDeps {
  checkInput(question: string): Promise<GuardResult>;
  checkOutput(answer: string): Promise<GuardResult>;
  retrieve(query: string): Promise<PolicyChunk[]>;
  /** The planner model. Optional: without it every message is treated as an HR question. */
  plan?(question: string, history: readonly ChatTurn[]): Promise<Plan>;
  generate(question: string, chunks: PolicyChunk[], history: readonly ChatTurn[]): Promise<string>;
  log?(entry: AskLogEntry): Promise<void>;
}

export function buildUserMessage(
  question: string,
  chunks: PolicyChunk[],
  history: readonly ChatTurn[] = [],
): string {
  const excerpts = chunks.map((chunk) => chunk.content).join("\n\n---\n\n");
  const context = formatHistory(history);
  const conversation = context ? `<recent_conversation>\n${context}\n</recent_conversation>\n\n` : "";
  // The tag is named "company_hr_policy" (not "excerpts"): the model tends to echo the tag name.
  return `<company_hr_policy>\n${excerpts}\n</company_hr_policy>\n\n${conversation}Question: ${question}`;
}

export async function generateAnswer(
  question: string,
  chunks: PolicyChunk[],
  history: readonly ChatTurn[] = [],
): Promise<string> {
  return chatWithFallback("answer", ANSWER_MODELS, {
    system: SYSTEM_PROMPT,
    user: buildUserMessage(question, chunks, history),
  });
}

export async function ask(question: string, deps: AskDeps, history: readonly ChatTurn[] = []): Promise<AskResult> {
  const startedAt = Date.now();

  const finish = async (
    result: AskResult,
    blockReason: string | null = null,
  ): Promise<AskResult> => {
    try {
      await deps.log?.({
        question,
        answer: result.answer,
        blockedStage: result.blocked,
        blockReason,
        latencyMs: Date.now() - startedAt,
      });
    } catch (error) {
      // Logging must never break the answer.
      console.error("[hr-assistant] failed to write log", error);
    }
    return result;
  };

  // 1. Obvious small talk ("hi", "thanks", "who are you?"): instant reply, no AI calls at all.
  const quick = quickIntent(question);
  if (quick && quick !== "hr_question") {
    return finish({ answer: cannedReply(quick, history), blocked: null, sources: [], intent: quick });
  }

  // 2. One planner call decides what this is (and writes small-talk replies).
  const plan: Plan = deps.plan
    ? await deps.plan(question, history)
    : { intent: "hr_question", reply: "", searchQuery: question };
  const { intent } = plan;

  if (intent === "jailbreak") {
    return finish({ answer: cannedReply("jailbreak"), blocked: "input", sources: [], intent }, "planner: jailbreak");
  }
  if (intent !== "hr_question") {
    // Small talk / off-topic: the planner's own short reply, or a fixed wording. No search, no guards.
    return finish({ answer: plan.reply || cannedReply(intent, history), blocked: null, sources: [], intent });
  }

  // 3. HR question: the safety check and the policy search run in parallel. The search result is
  //    settled into a value so a failure can't become an unhandled rejection while the guard runs.
  const search = deps.retrieve(plan.searchQuery || question).then(
    (chunks) => ({ chunks, error: null as unknown }),
    (error: unknown) => ({ chunks: [] as PolicyChunk[], error }),
  );
  const inputGuard = await deps.checkInput(question);
  if (!inputGuard.safe) {
    const answer = inputGuard.category === "prompt_injection" ? cannedReply("jailbreak") : REFUSAL_MESSAGE;
    return finish({ answer, blocked: "input", sources: [], intent }, inputGuard.reason);
  }

  // 4. Answer from the policy excerpts, then check the answer.
  const { chunks, error } = await search;
  if (error) throw error;
  if (chunks.length === 0) {
    return finish({ answer: NO_CONTEXT_MESSAGE, blocked: null, sources: [], intent });
  }

  const answer = (await deps.generate(question, chunks, history)) || NO_CONTEXT_MESSAGE;

  const outputGuard = await deps.checkOutput(answer);
  if (!outputGuard.safe) {
    return finish({ answer: REFUSAL_MESSAGE, blocked: "output", sources: [], intent }, outputGuard.reason);
  }

  return finish({ answer, blocked: null, sources: chunks, intent });
}

interface CreateOptions {
  /** A Supabase client. With a user session, RLS applies; with service role, it doesn't. */
  supabase: SupabaseClient;
  /** When set, each question is written to hr_assistant_logs for this user. */
  userId?: string;
}

/**
 * Real dependencies: Groq guardrails + answers, Gemini embeddings, Supabase search + logs.
 * Each step shows up as its own LangSmith run when tracing is enabled.
 */
export function createHrAssistantDeps({ supabase, userId }: CreateOptions): AskDeps {
  return {
    checkInput: traced("input_guard", "llm", checkInput),
    checkOutput: traced("output_guard", "llm", checkOutput),
    retrieve: traced("retrieve_policy", "retriever", (query: string) =>
      retrievePolicyChunks(supabase, query),
    ),
    generate: traced("generate_answer", "llm", generateAnswer),
    plan: traced("planner", "llm", planWithModel),
    log: userId
      ? async (entry) => {
          const { error } = await supabase.from("hr_assistant_logs").insert({
            user_id: userId,
            question: entry.question,
            answer: entry.answer,
            blocked_stage: entry.blockedStage,
            block_reason: entry.blockReason,
            latency_ms: entry.latencyMs,
          });
          if (error) throw error;
        }
      : undefined,
  };
}

export function askHrAssistant(
  question: string,
  options: CreateOptions,
  history: readonly ChatTurn[] = [],
): Promise<AskResult> {
  const deps = createHrAssistantDeps(options);
  return traced("hr_assistant", "chain", (q: string) => ask(q, deps, history))(question);
}
