/**
 * Call Insights, the interview-round context (owner 2026-11-17: "there will also be further rounds with the
 * candidate"). Its own prompt, so tuning it cannot regress the screening context (doctrine L11). It reads everything
 * the screening prompt reads (sentiment, interest, concerns, red flags, the facts, with the same pay rule), and also:
 *   answers              : each topic the interviewer asked about, how the answer covered it (clear / partial / weak),
 *                          with the quote; judged on WHAT was said (relevance, specifics, correctness), never on how
 *                          it was said (accent, fluency, grammar, nerves, confidence), which a transcript cannot show
 *                          fairly and which the owner ruled out;
 *   not_covered          : the position's must-haves that never came up;
 *   next_round_questions : 3 to 5 questions that would fill the gaps.
 * The answer's shape is the screening shape plus those three lists (14 + 1 nullable keys, under Claude's 16).
 */
import { z } from "zod";

import { ANSWER_VERDICTS, type CallInsights } from "@/backend/lib/candidates/types";

import { CANDIDATE_SCREENING_SCHEMA, FACTS_STEP, parseCandidateScreening } from "./candidateScreening";

export const CANDIDATE_INTERVIEW_SYSTEM = `
You read the transcript of an interview round between an interviewer at Autopilot Offices, an Indian managed office operator, and a job candidate, and write down what the CANDIDATE said, how their answers covered what the role needs, and what the next round should check. A recruiter reads your answer next to a decision about a real person. So: only what was said, a quote for every judgement, and nothing invented.

The call may be in Hindi, English or both, and the transcript may be in Roman or Devanagari script. Quote the words exactly as they appear in the transcript. Write your own notes in plain English.

Judge the CONTENT of answers only: did the answer address the question, did it give specifics (a real project, numbers, tools, steps), was it correct as far as the transcript shows. Never judge or mention accent, fluency, grammar, nervousness, confidence, tone, personality, age, gender or background. A short or hesitant answer that is correct is a correct answer.

Follow these steps in order. Do not skip any.
1. Read the whole transcript once. Speaker names or labels may appear before a line, or there may be no labels: work out who is the interviewer and who is the candidate from what each one says. Only the CANDIDATE's words count as their answers, views or facts.
2. answers: one entry per topic the interviewer asked about (a skill, a tool, a past project, a situation), at most 10, in the order asked. topic is a few words ("SQL joins", "Power BI dashboards", "handling an escalation"). verdict: "clear" = answered the question with specifics; "partial" = on topic but thin, vague or missing a key part; "weak" = did not answer, said they do not know, or the answer was wrong. note is one short sentence on why. Each answer has a short exact quote from the candidate and at_seconds when the line was stamped (else null). No quote, no answer entry.
3. not_covered: the position's must-haves (listed under THE POSITION) that never came up in the interview, as short names. An empty list when all came up or none are listed.
4. next_round_questions: 3 to 5 specific questions for the next round that would check the weak or partial answers and the must-haves not covered. Plain questions an interviewer can read out.
5. overall_sentiment, sentiment_confidence, interest_level, sentiment_timeline, concerns and red_flags exactly as for a screening call: overall_sentiment is how keen and open the candidate came across ("positive" | "neutral" | "negative"); interest_level is interest in THIS role ("high" | "medium" | "low" | "unclear"); 3 to 8 timeline parts in order with start_seconds and end_seconds when the lines are stamped (else null) and "share" 1 to 10; concerns with topic one of salary, location, commute, notice, shift, role, growth, stability, other, each with a quote; red_flags only for concrete problems (a contradiction with the record, a refusal to share basics, hostility), each with a quote. A weak answer is not a red flag.
6. ${FACTS_STEP}
7. summary: 2 to 3 plain sentences: what the round covered, where the answers were strong, and the main gap.
8. suggested_next_step: one line of advice, for example "Move to round 2; check SQL with a live exercise", "Close: core skills not shown". This is advice only. A person decides.
9. language: the language or languages of the call.
10. Check that every quote really is in the transcript, that no note judges delivery or personality, and that every null is honest. Then answer.

Return ONLY a JSON object with exactly these keys:
{
  "overall_sentiment": "positive" | "neutral" | "negative",
  "sentiment_confidence": "high" | "medium" | "low",
  "interest_level": "high" | "medium" | "low" | "unclear",
  "summary": string,
  "suggested_next_step": string,
  "sentiment_timeline": [ { "sentiment": "positive" | "neutral" | "negative", "note": string, "start_seconds": number | null, "end_seconds": number | null, "share": number } ],
  "concerns": [ { "topic": string, "note": string, "quote": string, "at_seconds": number | null } ],
  "red_flags": [ { "note": string, "quote": string, "at_seconds": number | null } ],
  "facts": {
    "current_inhand": { "value": number | null, "pay_basis": "in_hand" | "ctc" | "unclear", "quote": string, "at_seconds": number | null },
    "expected_inhand": { "value": number | null, "pay_basis": "in_hand" | "ctc" | "unclear", "quote": string, "at_seconds": number | null },
    "notice_period_days": { "value": number | null, "quote": string, "at_seconds": number | null },
    "location": { "value": string | null, "quote": string, "at_seconds": number | null },
    "reason_for_change": { "value": string | null, "quote": string, "at_seconds": number | null }
  },
  "language": string,
  "answers": [ { "topic": string, "verdict": "clear" | "partial" | "weak", "note": string, "quote": string, "at_seconds": number | null } ],
  "not_covered": [ string ],
  "next_round_questions": [ string ]
}

Example of the tone for the three interview lists (the words are made up; the other keys are as for any call):
TRANSCRIPT:
[4:05] Tell me about a dashboard you built.
[4:12] I built a sales dashboard in Power BI with DAX measures for month-on-month growth, refreshed daily from SQL Server.
[6:31] How would you join orders with customers and keep customers with no orders?
[6:40] Complex queries take me some time, I usually look it up.
ANSWER (part):
"answers":[{"topic":"Power BI dashboards","verdict":"clear","note":"Described a real sales dashboard with DAX measures and a daily refresh.","quote":"I built a sales dashboard in Power BI with DAX measures","at_seconds":252},{"topic":"SQL joins","verdict":"weak","note":"Did not say which join keeps customers without orders.","quote":"Complex queries take me some time, I usually look it up.","at_seconds":400}],
"not_covered":["Python"],
"next_round_questions":["Write a query that lists every customer with their order count, including customers with no orders.","Which Python libraries have you used for data cleaning, and on what data?"]
`.trim();

// The screening shape plus the three interview lists. One more nullable key (an answer's time): 15 of Claude's 16.
const screeningProps = (CANDIDATE_SCREENING_SCHEMA.properties ?? {}) as Record<string, unknown>;
export const CANDIDATE_INTERVIEW_SCHEMA: Record<string, unknown> = {
  ...CANDIDATE_SCREENING_SCHEMA,
  properties: {
    ...screeningProps,
    answers: {
      type: "array",
      items: {
        type: "object",
        properties: {
          topic: { type: "string" },
          verdict: { type: "string", enum: [...ANSWER_VERDICTS] },
          note: { type: "string" },
          quote: { type: "string" },
          at_seconds: { type: ["number", "null"] },
        },
        required: ["topic", "verdict", "note", "quote", "at_seconds"],
        additionalProperties: false,
      },
    },
    not_covered: { type: "array", items: { type: "string" } },
    next_round_questions: { type: "array", items: { type: "string" } },
  },
  required: [...((CANDIDATE_SCREENING_SCHEMA.required as string[]) ?? []), "answers", "not_covered", "next_round_questions"],
};

const QUOTE_MAX = 300;
const seconds = z.number().min(0).max(24 * 3600).nullable().catch(null);
const InterviewLists = z.object({
  answers: z.array(z.object({
    topic: z.string().trim().min(1).max(80),
    verdict: z.enum(ANSWER_VERDICTS).catch("partial"),
    note: z.string().trim().max(200).catch(""),
    quote: z.string().trim().min(1).max(QUOTE_MAX),
    at_seconds: seconds,
  }).nullable().catch(null)).catch([]),
  not_covered: z.array(z.string().trim().min(1).max(80).nullable().catch(null)).catch([]),
  next_round_questions: z.array(z.string().trim().min(1).max(300).nullable().catch(null)).catch([]),
}).partial();

/**
 * The model's JSON as a CallInsights with the interview lists. The screening part is checked by the screening parser
 * (same rules: no quote, no concern; a pay basis that is not given reads as unclear). An answer with no quote is
 * dropped on its own. Throws only when the text is not JSON at all.
 */
export function parseCandidateInterview(textOut: string): CallInsights {
  const base = parseCandidateScreening(textOut);
  const lists = InterviewLists.parse(JSON.parse(textOut) as unknown);
  return {
    ...base,
    answers: (lists.answers ?? []).filter((a): a is NonNullable<typeof a> => a !== null).slice(0, 10)
      .map((a) => ({ topic: a.topic, verdict: a.verdict, note: a.note, quote: a.quote, at: a.at_seconds })),
    notCovered: (lists.not_covered ?? []).filter((x): x is string => !!x).slice(0, 10),
    nextRoundQuestions: (lists.next_round_questions ?? []).filter((x): x is string => !!x).slice(0, 5),
  };
}
