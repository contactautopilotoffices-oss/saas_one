/**
 * Owner 2026-11-15: which models the HR assistant's planner and answer steps try, when someone has chosen them in the
 * Tech console (HR Configs → HR AI models). The chosen models are tried first, in the saved order; today's list (config.ts)
 * always follows, so a choice can never leave the assistant without a model. Nothing chosen = today's list, unchanged.
 *
 * The SAFETY CHECK is deliberately not configurable: it runs on a dedicated safeguard model and fails closed
 * (guardrails.ts), and it keeps its own list in config.ts.
 */
import { chosenModels } from "@/task-manager/ai/modelFor";
import type { ModelStep } from "./llm";

/** A catalog id as the step this assistant's own code calls: 'groq:…' is Groq (gpt-oss models think briefly), anything else is Engy. */
export function toStep(id: string): ModelStep {
  if (id.startsWith("groq:")) {
    const model = id.slice("groq:".length);
    return { provider: "groq", model, ...(/gpt-oss/.test(model) ? { reasoningEffort: "low" as const } : {}) };
  }
  return { provider: "engy", model: id };
}

const same = (a: ModelStep, b: ModelStep) => a.provider === b.provider && a.model === b.model;

/** The chosen steps first, then every step of today's list that is not already there. */
export function withChosen(chosen: readonly string[], today: readonly ModelStep[]): readonly ModelStep[] {
  if (!chosen.length) return today;
  const first = chosen.map(toStep);
  return [...first, ...today.filter(t => !first.some(f => same(f, t)))];
}

export async function hrChain(job: "hr_plan" | "hr_answer", today: readonly ModelStep[]): Promise<readonly ModelStep[]> {
  return withChosen(await chosenModels(job), today);
}
