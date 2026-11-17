/**
 * Call Insights, the candidate-screening context (owner 2026-11-16, plan P7): the prompt, the answer's shape, and the
 * check that turns the model's JSON into a CallInsights the screens can trust. One context = one prompt tuned on its
 * own, so a later context (say BD calls) cannot regress this one (doctrine L11).
 *
 * The prompt is written for something with no common sense (doctrine L12): numbered steps, an explicit no-skip line,
 * one short worked example for tone, and the terminal state is the JSON itself. Every judgement carries a quote; a
 * fact not said is null, never guessed.
 */
import { z } from "zod";

import { CALL_CONCERN_TOPICS, type CallInsights } from "@/backend/lib/candidates/types";

export const CANDIDATE_SCREENING_SYSTEM = `
You read the transcript of a recruiter's phone call with a job candidate at Autopilot Offices, an Indian managed office operator, and write down what the CANDIDATE said and how they came across. A recruiter reads your answer next to a decision about a real person. So: only what was said, a quote for every judgement, and nothing invented.

The call may be in Hindi, English or both, and the transcript may be in Roman or Devanagari script. Quote the words exactly as they appear in the transcript. Write your own notes in plain English.

Follow these steps in order. Do not skip any.
1. Read the whole transcript once. The transcript has no speaker labels: work out who is the recruiter and who is the candidate from what each one says. Only the CANDIDATE's words count as the candidate's views or facts. Never count what the recruiter said as something the candidate said.
2. overall_sentiment: how the candidate came across over the whole call. "positive" = keen, open, warm. "neutral" = polite, matter-of-fact, undecided. "negative" = reluctant, irritated, closed. sentiment_confidence: "high" when several clear signs agree, "medium" when it is a reasonable read, "low" when the call was too short or too mixed to tell.
3. interest_level: the candidate's interest in THIS role. "high" = asks about the team, the start date or the next step, or says yes. "medium" = open, with conditions. "low" = declines, deflects, or is only being polite. "unclear" = not enough was said.
4. sentiment_timeline: 3 to 8 parts, in order, covering the call from start to end, each with its sentiment and a short note of what was happening then. When the transcript lines carry [m:ss] stamps, give start_seconds and end_seconds for each part; otherwise set both to null. "share" is the rough share of the call that part took, 1 to 10. Make the part where the mood turned its own part.
5. concerns: what the candidate worried about or pushed back on. topic is one of: salary, location, commute, notice, shift, role, growth, stability, other. Each concern has a short exact quote, and at_seconds when the line was stamped (else null). No quote, no concern.
6. red_flags: concrete concerns only, for example a contradiction with what is on record, a refusal to share basics, or hostility. Each with a quote. An empty list is the normal answer.
7. facts: only numbers and facts the CANDIDATE stated.
   - current_inhand: current take-home pay in rupees PER MONTH, as a number. "seventy-five thousand in hand" = 75000. "9 LPA" or "9 lakh per annum" is per year: divide by 12 and round (9 LPA = 75000). null when not said.
   - expected_inhand: the pay they want, rupees per month, worked out the same way. null when not said.
   - notice_period_days: as days. One month = 30, 15 days = 15, immediate or already serving and free = 0. null when not said.
   - location: where they live or will work from, as said. null when not said.
   - reason_for_change: why they are looking, in their own words, shortened. null when not said.
   Every fact carries the exact quote it came from (an empty string "" when the fact was not said) and at_seconds when stamped. A number only the RECRUITER said is not a fact: leave it null.
8. summary: 2 to 3 plain sentences a recruiter can read in ten seconds: who they are, how keen they are, and the one thing that stood out.
9. suggested_next_step: one line of advice, for example "Shortlist for round 1", "Call back after they have spoken to their family", "Close: the salary gap is too wide". This is advice only. A person decides.
10. language: the language or languages of the call, for example "Hindi + English".
11. Check that every quote really is in the transcript and that every null is honest. Then answer.

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
    "current_inhand": { "value": number | null, "quote": string, "at_seconds": number | null },
    "expected_inhand": { "value": number | null, "quote": string, "at_seconds": number | null },
    "notice_period_days": { "value": number | null, "quote": string, "at_seconds": number | null },
    "location": { "value": string | null, "quote": string, "at_seconds": number | null },
    "reason_for_change": { "value": string | null, "quote": string, "at_seconds": number | null }
  },
  "language": string
}

Example of the tone and shape (the words are made up):
TRANSCRIPT:
[0:00] Hello Prakash, Shwetha from Autopilot Offices, AM Operations role ke baare mein baat karni thi, time hai?
[0:09] Haan ji, bilkul. Noida wala position, right?
[1:05] Noida is fine, I stay in Sector 62, fifteen minutes.
[2:15] Notice one month hai, serving from Monday.
[5:02] Band ninety tak hai in hand.
[5:10] Sir, ninety is a bit less for me, I was hoping for ninety-five at least.
[6:02] If the team is good I'm fine, growth matters more to me.
ANSWER:
{"overall_sentiment":"positive","sentiment_confidence":"high","interest_level":"high","summary":"Prakash is keen on the Noida AM role and can join in 30 days. The only hesitation was salary: he wants 95,000 in hand against the 90,000 band, but said growth matters more.","suggested_next_step":"Shortlist for round 1; confirm whether the band can stretch to 95,000.","sentiment_timeline":[{"sentiment":"neutral","note":"Greeting and confirming the role","start_seconds":0,"end_seconds":60,"share":2},{"sentiment":"positive","note":"Location and notice both fine","start_seconds":60,"end_seconds":300,"share":5},{"sentiment":"negative","note":"Pushed back on the salary band","start_seconds":300,"end_seconds":355,"share":1},{"sentiment":"positive","note":"Growth matters more; still keen","start_seconds":355,"end_seconds":400,"share":2}],"concerns":[{"topic":"salary","note":"Wants 95,000 in hand against a 90,000 band","quote":"I was hoping for ninety-five at least","at_seconds":310}],"red_flags":[],"facts":{"current_inhand":{"value":null,"quote":"","at_seconds":null},"expected_inhand":{"value":95000,"quote":"I was hoping for ninety-five at least","at_seconds":310},"notice_period_days":{"value":30,"quote":"Notice one month hai, serving from Monday","at_seconds":135},"location":{"value":"Noida, Sector 62","quote":"I stay in Sector 62","at_seconds":65},"reason_for_change":{"value":"Growth","quote":"growth matters more to me","at_seconds":362}},"language":"Hindi + English"}
`.trim();

/** What the model is told about the person and the position, so it can compare and so it does not invent them. */
export interface ScreeningContext {
  candidate: {
    name: string;
    designation: string | null;
    organization: string | null;
    location: string | null;
    currentInhand: number | null;
    expectedInhand: number | null;
    noticePeriodDays: number | null;
  };
  position: { title: string; location: string | null; jdText: string | null } | null;
  /** The transcript, one line per segment, stamped "[m:ss] text" when the segments have times. */
  transcript: string;
}

const line = (label: string, value: string | number | null) => `${label}: ${value === null || value === "" ? "not on record" : value}`;

export function candidateScreeningUser(ctx: ScreeningContext): string {
  const c = ctx.candidate;
  return [
    "THE CANDIDATE, AS ON RECORD (compare the call with this; do not repeat it as a fact unless the candidate said it):",
    line("Name", c.name),
    line("Current designation", c.designation),
    line("Current company", c.organization),
    line("Location", c.location),
    line("Current in-hand per month", c.currentInhand),
    line("Expected in-hand per month", c.expectedInhand),
    line("Notice period in days", c.noticePeriodDays),
    "",
    ctx.position
      ? [
        "THE POSITION THE CALL WAS FOR:",
        line("Title", ctx.position.title),
        line("Location", ctx.position.location),
        ctx.position.jdText ? `Job description:\n${ctx.position.jdText.slice(0, 6000)}` : "Job description: not saved",
      ].join("\n")
      : "THE POSITION: not linked to a saved position.",
    "",
    "CALL TRANSCRIPT:",
    ctx.transcript,
  ].join("\n");
}

// The answer's shape for Claude's structured output (every object closed; the checks below enforce the ranges).
// Claude allows at most 16 nullable keys in one schema: the five facts' values and times, the timeline's two times,
// and one time each on a concern and a red flag make 14. A fact's quote is therefore a plain string, "" = none.
const nullableNumber = { type: ["number", "null"] };
const nullableString = { type: ["string", "null"] };
const sentiment = { type: "string", enum: ["positive", "neutral", "negative"] };
const evidenceFact = (value: Record<string, unknown>) => ({
  type: "object",
  properties: { value, quote: { type: "string" }, at_seconds: nullableNumber },
  required: ["value", "quote", "at_seconds"],
  additionalProperties: false,
});
export const CANDIDATE_SCREENING_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    overall_sentiment: sentiment,
    sentiment_confidence: { type: "string", enum: ["high", "medium", "low"] },
    interest_level: { type: "string", enum: ["high", "medium", "low", "unclear"] },
    summary: { type: "string" },
    suggested_next_step: { type: "string" },
    sentiment_timeline: {
      type: "array",
      items: {
        type: "object",
        properties: { sentiment, note: { type: "string" }, start_seconds: nullableNumber, end_seconds: nullableNumber, share: { type: "integer" } },
        required: ["sentiment", "note", "start_seconds", "end_seconds", "share"],
        additionalProperties: false,
      },
    },
    concerns: {
      type: "array",
      items: {
        type: "object",
        properties: { topic: { type: "string", enum: [...CALL_CONCERN_TOPICS] }, note: { type: "string" }, quote: { type: "string" }, at_seconds: nullableNumber },
        required: ["topic", "note", "quote", "at_seconds"],
        additionalProperties: false,
      },
    },
    red_flags: {
      type: "array",
      items: {
        type: "object",
        properties: { note: { type: "string" }, quote: { type: "string" }, at_seconds: nullableNumber },
        required: ["note", "quote", "at_seconds"],
        additionalProperties: false,
      },
    },
    facts: {
      type: "object",
      properties: {
        current_inhand: evidenceFact(nullableNumber),
        expected_inhand: evidenceFact(nullableNumber),
        notice_period_days: evidenceFact(nullableNumber),
        location: evidenceFact(nullableString),
        reason_for_change: evidenceFact(nullableString),
      },
      required: ["current_inhand", "expected_inhand", "notice_period_days", "location", "reason_for_change"],
      additionalProperties: false,
    },
    language: { type: "string" },
  },
  required: ["overall_sentiment", "sentiment_confidence", "interest_level", "summary", "suggested_next_step", "sentiment_timeline", "concerns", "red_flags", "facts", "language"],
  additionalProperties: false,
};

// What is accepted from any model (the other providers answer in plain JSON mode): tolerant, ranges enforced.
const QUOTE_MAX = 300;
const text = (max: number) => z.string().trim().max(max).catch("");
/** A fact's quote: "" or null both mean none (the schema asks for "" so the key is not nullable). */
const quote = z.string().trim().max(QUOTE_MAX).nullable().catch(null).transform((q) => q || null);
const seconds = z.number().min(0).max(24 * 3600).nullable().catch(null);
const sentimentSchema = z.enum(["positive", "neutral", "negative"]);
const NOT_SAID = { value: null, quote: null, at_seconds: null };
const numberFact = (min: number, max: number) =>
  z.object({ value: z.number().int().min(min).max(max).nullable().catch(null), quote, at_seconds: seconds }).catch(NOT_SAID);
const stringFact = (max: number) =>
  z.object({ value: z.string().trim().min(1).max(max).nullable().catch(null), quote, at_seconds: seconds }).catch(NOT_SAID);
/** A list where one bad item (a concern with no quote, say) is dropped on its own, never the whole list. */
const listOf = <T extends z.ZodType>(item: T, max: number) =>
  z.array(item.nullable().catch(null)).catch([]).transform((xs) => xs.filter((x): x is NonNullable<z.infer<T>> => x !== null).slice(0, max));

export const CandidateScreeningSchema = z.object({
  overall_sentiment: sentimentSchema.catch("neutral"),
  sentiment_confidence: z.enum(["high", "medium", "low"]).catch("low"),
  interest_level: z.enum(["high", "medium", "low", "unclear"]).catch("unclear"),
  summary: text(1200),
  suggested_next_step: text(300),
  sentiment_timeline: listOf(z.object({
    sentiment: sentimentSchema.catch("neutral"),
    note: text(200),
    start_seconds: seconds,
    end_seconds: seconds,
    share: z.number().int().min(1).max(10).catch(1),
  }), 12),
  concerns: listOf(z.object({
    topic: z.enum(CALL_CONCERN_TOPICS).catch("other"),
    note: text(200),
    quote: z.string().trim().min(1).max(QUOTE_MAX),
    at_seconds: seconds,
  }), 12),
  red_flags: listOf(z.object({ note: text(200), quote: z.string().trim().min(1).max(QUOTE_MAX), at_seconds: seconds }), 8),
  facts: z.object({
    current_inhand: numberFact(1000, 10_000_000),
    expected_inhand: numberFact(1000, 10_000_000),
    notice_period_days: numberFact(0, 365),
    location: stringFact(120),
    reason_for_change: stringFact(300),
  }).catch({ current_inhand: NOT_SAID, expected_inhand: NOT_SAID, notice_period_days: NOT_SAID, location: NOT_SAID, reason_for_change: NOT_SAID }),
  language: text(60),
});

/** True when the text is a JSON object with the one key every answer must have (the chain moves on otherwise). */
export function looksLikeScreening(textOut: string): boolean {
  try {
    const parsed = JSON.parse(textOut) as unknown;
    return !!parsed && typeof parsed === "object" && "overall_sentiment" in parsed && "facts" in parsed;
  } catch {
    return false;
  }
}

/**
 * The model's JSON as a CallInsights. A concern without a quote is dropped by the schema (no quote, no concern); a
 * fact whose value is out of range becomes "not said". Throws only when the text is not JSON at all.
 */
export function parseCandidateScreening(textOut: string): CallInsights {
  const raw = JSON.parse(textOut) as unknown;
  const r = CandidateScreeningSchema.parse(raw);
  const ev = <T>(f: { value: T | null; quote: string | null; at_seconds: number | null }) => ({ value: f.value, quote: f.quote, at: f.at_seconds });
  return {
    overallSentiment: r.overall_sentiment,
    sentimentConfidence: r.sentiment_confidence,
    interestLevel: r.interest_level,
    summary: r.summary,
    suggestedNextStep: r.suggested_next_step,
    timeline: r.sentiment_timeline.map((p) => ({ sentiment: p.sentiment, note: p.note, startSeconds: p.start_seconds, endSeconds: p.end_seconds, share: p.share })),
    concerns: r.concerns.map((c) => ({ topic: c.topic, note: c.note, quote: c.quote, at: c.at_seconds })),
    redFlags: r.red_flags.map((f) => ({ note: f.note, quote: f.quote, at: f.at_seconds })),
    facts: {
      currentInhand: ev(r.facts.current_inhand),
      expectedInhand: ev(r.facts.expected_inhand),
      noticePeriodDays: ev(r.facts.notice_period_days),
      location: ev(r.facts.location),
      reasonForChange: ev(r.facts.reason_for_change),
    },
    language: r.language,
  };
}
