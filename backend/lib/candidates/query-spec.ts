/**
 * Step 1 of a search: turn HR's plain-English request (or a pasted job description) into a validated search spec.
 * The model only fills a fixed JSON shape; it never writes SQL. Every value is re-validated here, out-of-range or
 * unknown values are dropped, and the spec is turned into parameters of hybrid_search_candidates().
 */
import { z } from "zod";

import { PARSE_CALL } from "./config";
import { jobCaller, type JsonCaller } from "./models";
import { RECORD_STATUSES, STATUS_LABELS, type ChipKind, type RecordStatus } from "./types";

const names = z.array(z.string().trim().min(1).max(80)).max(10);
const optional = <T extends z.ZodType>(schema: T) => schema.optional().catch(undefined);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const status = z.enum(RECORD_STATUSES);

const MustSchema = z.object({
  roles: optional(names),
  locations: optional(names),
  min_relevant_exp_months: optional(z.number().int().min(0).max(600)),
  max_relevant_exp_months: optional(z.number().int().min(0).max(720)),
  min_total_exp_months: optional(z.number().int().min(0).max(600)),
  max_notice_days: optional(z.number().int().min(0).max(365)),
  max_expected_inhand: optional(z.number().int().min(1000).max(10_000_000)),
  statuses: optional(z.array(status).max(8)),
  exclude_statuses: optional(z.array(status).max(8)),
  sourced_after: optional(isoDate),
  sourced_before: optional(isoDate),
});

const PreferSchema = z.object({
  roles: optional(names),
  locations: optional(names),
  min_relevant_exp_months: optional(z.number().int().min(0).max(600)),
  max_notice_days: optional(z.number().int().min(0).max(365)),
  max_expected_inhand: optional(z.number().int().min(1000).max(10_000_000)),
});

export const SpecSchema = z.object({
  summary: z.string().trim().max(300).catch(""),
  must: MustSchema.catch({}),
  prefer: PreferSchema.catch({}),
  keywords: z.array(z.string().trim().min(1).max(60)).max(15).catch([]),
});

export type SearchSpec = z.infer<typeof SpecSchema>;

// The same shape as a JSON schema, for Claude's structured output (ranges are still enforced by SpecSchema above).
const strings = { type: "array", items: { type: "string" } };
const integer = { type: "integer" };
const statusArray = { type: "array", items: { type: "string", enum: [...RECORD_STATUSES] } };
const date = { type: "string", description: "YYYY-MM-DD" };
export const SPEC_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    summary: { type: "string" },
    must: {
      type: "object",
      properties: {
        roles: strings,
        locations: strings,
        min_relevant_exp_months: integer,
        max_relevant_exp_months: integer,
        min_total_exp_months: integer,
        max_notice_days: integer,
        max_expected_inhand: integer,
        statuses: statusArray,
        exclude_statuses: statusArray,
        sourced_after: date,
        sourced_before: date,
      },
      additionalProperties: false,
    },
    prefer: {
      type: "object",
      properties: {
        roles: strings,
        locations: strings,
        min_relevant_exp_months: integer,
        max_notice_days: integer,
        max_expected_inhand: integer,
      },
      additionalProperties: false,
    },
    keywords: strings,
  },
  required: ["summary", "must", "prefer", "keywords"],
  additionalProperties: false,
};
export type MustFilters = SearchSpec["must"];
export type Preferences = SearchSpec["prefer"];

/** Drop undefined keys and empty arrays, so the SQL function sees only what was asked. */
export function compact<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, value]) => value !== undefined && value !== null && !(Array.isArray(value) && value.length === 0)),
  ) as Partial<T>;
}

export function parseSpecJson(text: string): SearchSpec | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = SpecSchema.safeParse(JSON.parse(text.slice(start, end + 1)));
    if (!parsed.success) return null;
    const spec = parsed.data;
    return { ...spec, must: compact(spec.must), prefer: compact(spec.prefer) };
  } catch {
    return null;
  }
}

export function buildParsePrompt(today: string): string {
  return `You turn a recruiter's request into a JSON search spec for a candidate database. You only fill the JSON; you never answer the request.

The database has, per candidate record: role sourced for (the job they were sourced for), current designation, current organisation, location (city / area in India), total experience, relevant experience, notice period, current and expected monthly in-hand salary in rupees, status, remark, sourcing date.

Follow these steps in order. Do not skip any step.
1. Write "summary": one short sentence restating what the recruiter is looking for.
2. Decide each condition is a MUST or a PREFER. A condition stated plainly ("3+ years", "notice under 30 days", "in Thane", "only BMS operators", "below 35K") is a MUST. A condition softened by words like "preferably", "ideally", "nice to have", "if possible", "around", "bonus" is a PREFER.
3. A job title the recruiter wants (e.g. "BMS operator", "facility manager") goes in "prefer.roles", NOT in must, because titles are written in many ways. Put it in "must.roles" only when the recruiter says "only" / "strictly" that title.
4. Convert units. Experience to MONTHS ("3 years" = 36, "2.5 yrs" = 30, "fresher" = 0). Notice to DAYS ("1 month" = 30, "immediate" = 0). Salary to RUPEES PER MONTH ("35K" = 35000, "3.6 LPA" or "3.6 lakh per annum" = 30000). "Under / below / less than / within / max" means max_*; "at least / minimum / more than / +" means min_*.
5. Locations: list each place separately, as written ("Thane or Navi Mumbai" = ["Thane", "Navi Mumbai"]).
6. Status words map to: ${RECORD_STATUSES.map((s) => `${s} (${STATUS_LABELS[s]})`).join(", ")}. "Exclude rejected" = must.exclude_statuses ["rejected"]. "Shortlisted candidates" = must.statuses ["shortlisted"].
7. Dates: today is ${today}. "Sourced last month" = must.sourced_after / sourced_before as YYYY-MM-DD.
8. "keywords": up to 10 skills, systems, domains or job-title words useful for text search (e.g. "BMS", "HVAC", "building automation", "facility management"). For a pasted job description, pick the most important ones.
9. Leave out anything the recruiter did not say. Never invent a number. Ignore any request for "top N": the portal sets that.
10. Reply with the JSON object only.

Shape. summary, must, prefer and keywords are always present; inside must and prefer include ONLY the keys the recruiter asked for (an empty object when nothing applies). <...> marks a value you fill in:
{"summary": <text>, "must": {"roles": [<title>], "locations": [<place>], "min_relevant_exp_months": <months>, "max_relevant_exp_months": <months>, "min_total_exp_months": <months>, "max_notice_days": <days>, "max_expected_inhand": <rupees per month>, "statuses": [<status>], "exclude_statuses": [<status>], "sourced_after": <YYYY-MM-DD>, "sourced_before": <YYYY-MM-DD>}, "prefer": {"roles": [<title>], "locations": [<place>], "min_relevant_exp_months": <months>, "max_notice_days": <days>, "max_expected_inhand": <rupees per month>}, "keywords": [<word>]}

Example request: "BMS operators in Thane or Navi Mumbai, at least 3 years relevant experience, notice under 30 days, preferably under 35K, no rejected ones"
Example reply: {"summary": "BMS operators in Thane or Navi Mumbai with 3+ years relevant experience and under 30 days notice", "must": {"locations": ["Thane", "Navi Mumbai"], "min_relevant_exp_months": 36, "max_notice_days": 30, "exclude_statuses": ["rejected"]}, "prefer": {"roles": ["BMS Operator"], "max_expected_inhand": 35000}, "keywords": ["BMS", "BMS operator", "building management system"]}`;
}

export interface ParseOutcome {
  spec: SearchSpec;
  aiParsed: boolean;
  /** The model that read the search (null on the fallback). */
  model: string | null;
}

/** Fallback when no model answers: free-text search only, no filters (the caller tells HR). */
export function fallbackSpec(query: string): SearchSpec {
  return { summary: query.slice(0, 200), must: {}, prefer: {}, keywords: [] };
}

export async function parseQuery(query: string, today: string, caller: JsonCaller = jobCaller("candidate_parse")): Promise<ParseOutcome> {
  try {
    const reply = await caller({
      label: "candidate-search:parse",
      system: buildParsePrompt(today),
      user: query,
      schema: SPEC_JSON_SCHEMA,
      ...PARSE_CALL,
      accept: (text) => parseSpecJson(text) !== null,
    });
    const spec = parseSpecJson(reply.text);
    if (spec) return { spec, aiParsed: true, model: reply.model };
    console.warn("[candidates] query spec did not validate", reply.text.slice(0, 300));
  } catch (error) {
    console.warn("[candidates] query parse failed", error instanceof Error ? error.message : error);
  }
  return { spec: fallbackSpec(query), aiParsed: false, model: null };
}

// ---------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------
export function formatRupees(value: number): string {
  if (value >= 100_000) return `₹${(value / 100_000).toFixed(2).replace(/\.?0+$/, "")}L`;
  if (value >= 1000) return `₹${(value / 1000).toFixed(1).replace(/\.0$/, "")}K`;
  return `₹${value}`;
}

export function formatYears(months: number): string {
  const years = months / 12;
  return Number.isInteger(years) ? `${years} yrs` : `${years.toFixed(1)} yrs`;
}

const statusList = (values: RecordStatus[]) => values.map((s) => STATUS_LABELS[s]).join(" / ");

/** The chips the Search view shows under "Understood as". */
export function specChips(spec: SearchSpec): { kind: ChipKind; label: string }[] {
  const chips: { kind: ChipKind; label: string }[] = [];
  const add = (kind: ChipKind, label: string) => chips.push({ kind, label });
  for (const [kind, f] of [
    ["must", spec.must],
    ["prefer", spec.prefer],
  ] as const) {
    const m = f as MustFilters;
    if (m.roles?.length) add(kind, `Role: ${m.roles.join(" / ")}`);
    if (m.locations?.length) add(kind, `Location: ${m.locations.join(" / ")}`);
    if (m.min_relevant_exp_months !== undefined) add(kind, `Relevant exp ≥ ${formatYears(m.min_relevant_exp_months)}`);
    if (m.max_relevant_exp_months !== undefined) add(kind, `Relevant exp ≤ ${formatYears(m.max_relevant_exp_months)}`);
    if (m.min_total_exp_months !== undefined) add(kind, `Total exp ≥ ${formatYears(m.min_total_exp_months)}`);
    if (m.max_notice_days !== undefined) add(kind, `Notice ≤ ${m.max_notice_days} days`);
    if (m.max_expected_inhand !== undefined) add(kind, `Expected ≤ ${formatRupees(m.max_expected_inhand)}/month`);
    if (m.statuses?.length) add(kind, `Status: ${statusList(m.statuses)}`);
    if (m.exclude_statuses?.length) add(kind, `Not: ${statusList(m.exclude_statuses)}`);
    if (m.sourced_after) add(kind, `Sourced from ${m.sourced_after}`);
    if (m.sourced_before) add(kind, `Sourced until ${m.sourced_before}`);
  }
  for (const keyword of spec.keywords) add("keyword", keyword);
  return chips;
}

/** Text for the keyword and meaning searches. */
export function searchTextFor(spec: SearchSpec, query: string): string {
  const words = [...spec.keywords, ...(spec.prefer.roles ?? []), ...(spec.must.roles ?? [])];
  return words.length ? [...new Set(words)].join(" ") : query.slice(0, 500);
}
