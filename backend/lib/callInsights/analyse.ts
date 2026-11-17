/**
 * Call Insights, step 2 (owner 2026-11-16, plan P7): one structured model call per transcript. The model chain is the
 * Control Center job 'call_analyse' (docs/AI_MODELS.md), run through Candidate Search's chain caller (Claude with the
 * JSON schema in output_config; other providers in JSON mode; the next model on an error, a timeout or an answer of
 * the wrong shape). The answer is re-checked here before anyone sees it (candidateScreening.ts).
 */
import { CALL_ANALYSE_CALL } from "@/backend/lib/candidates/config";
import { jobCaller, type JsonCaller } from "@/backend/lib/candidates/models";
import { isInterviewRound, type CallInsights } from "@/backend/lib/candidates/types";

import { CANDIDATE_INTERVIEW_SCHEMA, CANDIDATE_INTERVIEW_SYSTEM, parseCandidateInterview } from "./contexts/candidateInterview";
import { CANDIDATE_SCREENING_SCHEMA, CANDIDATE_SCREENING_SYSTEM, candidateScreeningUser, looksLikeScreening, parseCandidateScreening, type ScreeningContext } from "./contexts/candidateScreening";

export interface Analysed {
  result: CallInsights;
  /** The model that answered, as the Control Center names it. */
  model: string;
  usage: { input: number; output: number } | null;
}

/**
 * Reads one candidate call. Throws when no model answered (the pipeline records that as a failure). An interview round
 * (owner 2026-11-17) uses its own prompt and shape (candidateInterview.ts); a screening call, an HR / offer discussion
 * and a call with no round use the screening prompt. Same job, same model chain.
 */
export async function analyseCandidateCall(ctx: ScreeningContext, deps: { caller?: JsonCaller } = {}): Promise<Analysed> {
  const call = deps.caller ?? jobCaller("call_analyse");
  const interview = isInterviewRound(ctx.round);
  const reply = await call({
    label: interview ? "call analyse (interview)" : "call analyse",
    system: interview ? CANDIDATE_INTERVIEW_SYSTEM : CANDIDATE_SCREENING_SYSTEM,
    user: candidateScreeningUser(ctx),
    schema: interview ? CANDIDATE_INTERVIEW_SCHEMA : CANDIDATE_SCREENING_SCHEMA,
    effort: CALL_ANALYSE_CALL.effort,
    maxTokens: CALL_ANALYSE_CALL.maxTokens,
    otherMaxTokens: CALL_ANALYSE_CALL.otherMaxTokens,
    timeoutMs: CALL_ANALYSE_CALL.timeoutMs,
    budgetMs: CALL_ANALYSE_CALL.budgetMs,
    accept: looksLikeScreening,
  });
  return { result: interview ? parseCandidateInterview(reply.text) : parseCandidateScreening(reply.text), model: reply.model, usage: reply.usage ?? null };
}
