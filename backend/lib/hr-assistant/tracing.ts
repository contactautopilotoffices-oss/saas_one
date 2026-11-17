/**
 * Step tracing hooks. LangSmith was left out on purpose (no new dependency), so these
 * are pass-throughs; every question is still recorded in hr_assistant_logs.
 * The call sites are kept so a tracer can be dropped in here later without touching ask.ts.
 */

type RunType = "chain" | "llm" | "retriever" | "tool";

export function isTracingEnabled(): boolean {
  return false;
}

export function traced<Fn extends (...args: never[]) => Promise<unknown>>(
  _name: string,
  _runType: RunType,
  fn: Fn,
): Fn {
  return fn;
}

export async function flushTraces(): Promise<void> {}
