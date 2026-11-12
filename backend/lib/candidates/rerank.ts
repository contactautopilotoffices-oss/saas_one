/**
 * Step 3 of a search: score the compared records against the request and pick the top N.
 *
 *   AI (evidence only)  : role fit, domain / background, and experience when no minimum was given
 *   code (deterministic): location, notice, salary, and experience when a minimum was given
 *
 * The overall match is the weighted mean of the criteria that apply (config.CRITERION_WEIGHTS), so a search that
 * never mentions salary is not scored on salary. The model sees no name, email or phone: only work facts, under
 * short ids (c1, c2, ...) that are mapped back here, so it cannot invent a record.
 */
import { z } from "zod";

import { CRITERION_LABELS, CRITERION_WEIGHTS, RERANK_CALL } from "./config";
import { jobCaller, type JsonCaller } from "./models";
import { formatMonths } from "./normalize";
import type { SearchSpec } from "./query-spec";
import { formatRupees, formatYears } from "./query-spec";
import { STATUS_LABELS, type CandidateRecord, type CriterionKey, type CriterionScore, type SearchResult } from "./types";

const AiItem = z.object({
  id: z.string(),
  role: z.coerce.number().min(0).max(100).catch(0),
  experience: z.coerce.number().min(0).max(100).catch(0),
  domain: z.coerce.number().min(0).max(100).catch(0),
  reasons: z.array(z.string().max(200)).max(4).catch([]),
  missing: z.array(z.string().max(200)).max(4).catch([]),
  summary: z.string().max(300).catch(""),
});
const AiReply = z.object({ ranking: z.array(z.unknown()) });
type AiScore = z.infer<typeof AiItem>;

/** The reply shape for Claude's structured output (0-100 ranges are still enforced by AiItem). */
export const RERANK_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    ranking: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          role: { type: "integer" },
          experience: { type: "integer" },
          domain: { type: "integer" },
          reasons: { type: "array", items: { type: "string" } },
          missing: { type: "array", items: { type: "string" } },
          summary: { type: "string" },
        },
        required: ["id", "role", "experience", "domain", "reasons", "missing", "summary"],
        additionalProperties: false,
      },
    },
  },
  required: ["ranking"],
  additionalProperties: false,
};

/** One record as the model sees it. */
export function recordLine(id: string, r: CandidateRecord): string {
  const parts: [string, string | null][] = [
    ["role sourced for", r.role],
    ["current designation", r.currentDesignation],
    ["current organisation", r.currentOrganization],
    ["location", r.location],
    ["total experience", formatMonths(r.totalExpMonths)],
    ["relevant experience", formatMonths(r.relevantExpMonths)],
    ["notice", r.noticePeriodDays === null ? null : `${r.noticePeriodDays} days`],
    ["expected in-hand", r.expectedInhand === null ? null : `${formatRupees(r.expectedInhand)}/month`],
    ["status", STATUS_LABELS[r.status]],
    ["remark", r.remark],
  ];
  return `${id} | ${parts.filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join(" | ")}`;
}

export const RERANK_SYSTEM = `You are a careful recruitment screener. You score candidate records against a recruiter's request, using ONLY what each record says.

Follow these steps in order for EVERY record. Do not skip any record or step.
1. role (0-100): how well the role sourced for, current designation and organisation fit the requested job. Same job = 85-100; closely related job (e.g. MEP engineer for a BMS operator post) = 50-80; unrelated = 0-30.
2. experience (0-100): how well the relevant (and total) experience fits the level the request implies. Unknown experience = 40.
3. domain (0-100): how well the background (organisation type, designation, remark) fits the request's industry or domain. Unknown = 40.
4. reasons: up to 2 short facts FROM THE RECORD that support the match (e.g. "5 years as BMS operator at BuildMyInfra").
5. missing: up to 2 things the recruiter must check because the record does not say them (e.g. "HVAC experience not stated"). Mention a past rejection or "not responding" remark here.
6. summary: one sentence, at most 20 words, on the fit.
Never invent skills, certifications, companies or numbers that are not in the record. Never use names, gender, age or religion (they are not given). Use the record ids exactly as given.

Reply with JSON only: {"ranking": [{"id": "c1", "role": 0, "experience": 0, "domain": 0, "reasons": [], "missing": [], "summary": ""}, ...]} with one entry per record.

Example record: c1 | role sourced for: BMS Operator | current designation: BMS Operator | current organisation: BuildMyInfra | location: Noida | total experience: 5 years | relevant experience: 5 years | notice: 30 days | status: Not responding | remark: Not responding
Example entry for a request "BMS operator, 3+ years": {"id": "c1", "role": 95, "experience": 90, "domain": 70, "reasons": ["Current BMS operator at BuildMyInfra", "5 years relevant experience"], "missing": ["Was not responding to earlier calls"], "summary": "Strong direct fit with ample BMS experience; recheck availability."}`;

export function rerankUserPrompt(query: string, spec: SearchSpec, lines: string[]): string {
  return `Recruiter's request: ${query.slice(0, 2500)}
Understood as: ${spec.summary || "(see request)"}

Records (${lines.length}):
${lines.join("\n")}`;
}

export function parseRerankReply(text: string, ids: Set<string>): Map<string, AiScore> {
  const out = new Map<string, AiScore>();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return out;
  try {
    const reply = AiReply.safeParse(JSON.parse(text.slice(start, end + 1)));
    if (!reply.success) return out;
    for (const raw of reply.data.ranking) {
      const item = AiItem.safeParse(raw);
      if (item.success && ids.has(item.data.id) && !out.has(item.data.id)) out.set(item.data.id, item.data);
    }
  } catch {
    /* empty map = AI unavailable */
  }
  return out;
}

// ---------------------------------------------------------------------------
// Deterministic criteria
// ---------------------------------------------------------------------------
const UNKNOWN = 50;

function matchesAny(value: string | null, wanted: string[]): boolean {
  const v = (value ?? "").toLowerCase();
  return wanted.some((w) => v.includes(w.toLowerCase()));
}

/** Location / notice / salary / experience scores that do not need judgement, or undefined when not asked about. */
export function deterministicScores(r: CandidateRecord, spec: SearchSpec): Partial<Record<CriterionKey, number>> {
  const scores: Partial<Record<CriterionKey, number>> = {};
  const locations = [...(spec.must.locations ?? []), ...(spec.prefer.locations ?? [])];
  if (locations.length) scores.location = r.location ? (matchesAny(r.location, locations) ? 100 : 0) : UNKNOWN;

  const maxNotice = spec.must.max_notice_days ?? spec.prefer.max_notice_days;
  if (maxNotice !== undefined) {
    const n = r.noticePeriodDays;
    scores.notice = n === null ? UNKNOWN : n <= maxNotice ? 100 : Math.round(100 * Math.max(0, 1 - (n - maxNotice) / Math.max(maxNotice, 15)));
  }

  const budget = spec.must.max_expected_inhand ?? spec.prefer.max_expected_inhand;
  if (budget !== undefined) {
    const e = r.expectedInhand;
    scores.salary = e === null ? UNKNOWN : e <= budget ? 100 : Math.round(100 * Math.max(0, 1 - (e - budget) / (0.3 * budget)));
  }

  const minExp = spec.must.min_relevant_exp_months ?? spec.prefer.min_relevant_exp_months;
  if (minExp !== undefined) {
    const x = r.relevantExpMonths;
    scores.experience = x === null ? 40 : x >= minExp ? 100 : Math.round((100 * x) / Math.max(minExp, 1));
  }
  return scores;
}

export function combine(scores: Partial<Record<CriterionKey, number>>): { overall: number; criteria: CriterionScore[] } {
  const keys = (Object.keys(CRITERION_WEIGHTS) as CriterionKey[]).filter((k) => scores[k] !== undefined);
  const totalWeight = keys.reduce((sum, k) => sum + CRITERION_WEIGHTS[k], 0);
  if (!totalWeight) return { overall: 0, criteria: [] };
  const criteria = keys.map((k) => ({
    key: k,
    label: CRITERION_LABELS[k],
    score: Math.round(scores[k]!),
    weight: Math.round((100 * CRITERION_WEIGHTS[k]) / totalWeight),
  }));
  const overall = keys.reduce((sum, k) => sum + scores[k]! * CRITERION_WEIGHTS[k], 0) / totalWeight;
  return { overall: Math.round(overall), criteria };
}

export interface RerankOutcome {
  results: SearchResult[];
  aiRanked: boolean;
  /** The model that ranked (null when the AI ranking was unavailable). */
  model: string | null;
}

/**
 * Score `records` (already in search order) and return the top N. If the model is unavailable, the records keep
 * their search order with the deterministic criteria only and no match percent.
 */
export async function rerank(
  query: string,
  spec: SearchSpec,
  records: CandidateRecord[],
  topN: number,
  caller: JsonCaller = jobCaller("candidate_rank"),
): Promise<RerankOutcome> {
  if (!records.length) return { results: [], aiRanked: false, model: null };
  const ids = records.map((_, i) => `c${i + 1}`);
  const idSet = new Set(ids);
  // The ranking counts as AI-made only if the model scored most of the records; a reply that doesn't goes to the backup.
  const enough = Math.ceil(records.length * 0.8);
  let ai = new Map<string, AiScore>();
  let model: string | null = null;
  try {
    const reply = await caller({
      label: "candidate-search:rerank",
      system: RERANK_SYSTEM,
      user: rerankUserPrompt(query, spec, records.map((r, i) => recordLine(ids[i], r))),
      schema: RERANK_JSON_SCHEMA,
      ...RERANK_CALL,
      accept: (text) => parseRerankReply(text, idSet).size >= enough,
    });
    ai = parseRerankReply(reply.text, idSet);
    model = reply.model;
  } catch (error) {
    console.warn("[candidates] rerank failed", error instanceof Error ? error.message : error);
  }
  const aiRanked = ai.size >= enough;

  const scored = records.map((record, i) => {
    const fixed = deterministicScores(record, spec);
    const fromAi = aiRanked ? ai.get(ids[i]) : undefined;
    const scores: Partial<Record<CriterionKey, number>> = { ...fixed };
    if (fromAi) {
      scores.role = fromAi.role;
      scores.domain = fromAi.domain;
      if (scores.experience === undefined) scores.experience = fromAi.experience;
    }
    const { overall, criteria } = combine(scores);
    const reasons = fromAi?.reasons ?? [];
    const missing = fromAi?.missing ?? [];
    return {
      order: i,
      unscored: aiRanked && !fromAi,
      overall,
      result: {
        rank: 0,
        record,
        matchPercent: aiRanked && fromAi ? overall : null,
        criteria,
        reasons,
        missing,
        summary: fromAi?.summary || (aiRanked ? "The AI did not score this record." : fallbackSummary(record)),
      } satisfies SearchResult,
    };
  });

  if (aiRanked) scored.sort((a, b) => Number(a.unscored) - Number(b.unscored) || b.overall - a.overall || a.order - b.order);
  return {
    aiRanked,
    model: aiRanked ? model : null,
    results: scored.slice(0, topN).map((s, i) => ({ ...s.result, rank: i + 1 })),
  };
}

function fallbackSummary(r: CandidateRecord): string {
  const bits = [r.currentDesignation || r.role, r.relevantExpMonths !== null ? `${formatYears(r.relevantExpMonths)} relevant` : null, r.location];
  return bits.filter(Boolean).join(" · ") || "Matched the search.";
}
