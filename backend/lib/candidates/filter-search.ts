/**
 * The filter panel's server side (owner 2026-11-06): filtering, the typing dropdown and reading a job description.
 * Runs on the candidate_records view with no AI and no embedding, so a click answers at once.
 *
 * The resume filters (owner 2026-11-07) read the candidate_filter_records view of migration 20261107000001: the
 * same rows as candidate_records plus the resume columns. Until it is applied, the search runs on candidate_records
 * without them, so it never breaks.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import {
  DEFENCE_OPTIONS, EDUCATION_LEVELS, EDUCATION_TYPES, EMPTY_FILTERS, filtersFromSpec, hasBlankableFilter, NO_QUALIFICATION,
  NOTICE_BUCKETS, RESUME_FIELD_COLUMNS, RESUME_FIELDS, salaryRupees, SORTS, SOURCED_MONTHS, sourcedSince, withoutResumeFields,
  type FieldAvailability, type FilterResponse, type OptionField, type OptionItem, type PreferredItem, type ResumeField, type SearchFilters,
} from "./filters";
import { specChips, type Preferences, type SearchSpec } from "./query-spec";
import { attachInferred, CandidateActionError, getRecord, markResumes, RECORD_COLUMNS, RESUME_COLUMNS, toRecord, type RecordRow } from "./records";
import { resumeSnippet } from "./snippet";
import { RECORD_STATUSES, type CandidateRecord } from "./types";

const word = z.string().trim().min(1).max(60);
const name = z.string().trim().max(80);
const number = z.number().min(0).max(1000).nullable();
const year = z.number().int().min(1950).max(2100).nullable();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable();
const educationLevel = z.object({ mode: z.enum(["any", "specific", "none"]), picks: z.array(word).max(20) });

const FiltersSchema = z.object({
  keywords: z.array(z.object({ text: word, required: z.boolean() })).max(20),
  excludes: z.array(word).max(20),
  locations: z.array(word).max(20),
  relocate: z.boolean(),
  preferredLocations: z.array(word).max(20),
  expBasis: z.enum(["total", "relevant"]),
  expMin: number,
  expMax: number,
  notice: z.array(z.enum(NOTICE_BUCKETS.map((b) => b.id) as [string, ...string[]])).max(NOTICE_BUCKETS.length),
  servingNotice: z.boolean(),
  salaryBasis: z.enum(["current", "expected"]),
  salaryUnit: z.enum(["year", "month"]),
  salaryMin: number,
  salaryMax: number,
  includeNoSalary: z.boolean(),
  role: name,
  company: name,
  designation: name,
  industry: name,
  status: z.enum(["", ...RECORD_STATUSES]),
  excludeStatuses: z.array(z.enum(RECORD_STATUSES)).max(RECORD_STATUSES.length),
  sourcedMonths: z.union([...SOURCED_MONTHS.map((m) => z.literal(m)), z.null()] as unknown as [z.ZodLiteral<3>, z.ZodLiteral<6>, z.ZodLiteral<12>, z.ZodNull]),
  sourcedAfter: isoDate,
  sourcedBefore: isoDate,
  education: z.object({ ug: educationLevel, pg: educationLevel, ppg: educationLevel }),
  institute: name,
  educationTypes: z.array(z.enum(EDUCATION_TYPES.map((t) => t.id) as [string, ...string[]])).max(EDUCATION_TYPES.length),
  degreeYearFrom: year,
  degreeYearTo: year,
  careerBreak: z.boolean(),
  defence: z.enum(["", "any", ...DEFENCE_OPTIONS.map((d) => d.id)]),
  hasResume: z.enum(["", "yes", "no"]),
  includeBlank: z.boolean(),
  sort: z.enum(SORTS),
});

export function parseFilters(value: unknown): SearchFilters {
  const given = (value ?? {}) as Partial<SearchFilters>;
  const parsed = FiltersSchema.safeParse({
    ...EMPTY_FILTERS,
    ...given,
    education: { ...EMPTY_FILTERS.education, ...(given.education ?? {}) },
  });
  if (!parsed.success) throw new CandidateActionError(400, "Those filters are not valid. Please check them and try again.");
  return parsed.data as SearchFilters;
}

/** LIKE pattern for "contains", with the user's % and _ taken literally. */
function contains(text: string): string {
  return `%${text.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/** A value inside an or() filter: quoted, so commas and brackets in what HR typed cannot change the filter. */
function quoted(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

const ilike = (column: string, text: string) => `${column}.ilike.${quoted(contains(text))}`;

function between(column: string, min: number | null, max: number | null): string {
  if (min !== null && max !== null) return `and(${column}.gte.${min},${column}.lte.${max})`;
  return min !== null ? `${column}.gte.${min}` : `${column}.lte.${max}`;
}

/** The subset of a supabase-js filter builder used here. */
interface Filterable<T> {
  or(filters: string): T;
  ilike(column: string, pattern: string): T;
  eq(column: string, value: string): T;
  not(column: string, operator: string, value: string): T;
}

/**
 * Every filter, ANDed. With `allowBlank`, a record with no value for a filtered column passes that filter (a sheet row
 * is often incomplete; HR chooses to see those through "more have blank details"). Call with `withoutResumeFields(f)`
 * before migration 20261107000001.
 */
export function applyFilters<T extends Filterable<T>>(query: T, f: SearchFilters, allowBlank: boolean, today: string, resumeText = false): T {
  let q = query;
  const either = (column: string, terms: string[], blankOk = allowBlank) => {
    q = q.or((blankOk ? [`${column}.is.null`, ...terms] : terms).join(","));
  };

  // Keywords are checked on the text HR can see on a record, so a match is always explainable; with phase 4's view
  // (resumeText) a word that is only in the resume's text counts too (full-text search, whole words).
  const keywordTerms = (k: string) => (resumeText ? [ilike("lookup_text", k), `resume_fts.plfts.${quoted(k)}`] : [ilike("lookup_text", k)]);
  for (const k of f.keywords.filter((k) => k.required)) q = q.or(keywordTerms(k.text).join(","));
  const optional = f.keywords.filter((k) => !k.required);
  if (optional.length) q = q.or(optional.flatMap((k) => keywordTerms(k.text)).join(","));
  for (const word of f.excludes) {
    q = q.not("lookup_text", "ilike", contains(word));
    if (resumeText) q = q.not("resume_fts", "plfts", word);
  }

  // Location: where they are, or (ticked) where they would move to. "Change preferred location" names other places.
  const moveTo = f.preferredLocations.length ? f.preferredLocations : f.locations;
  const moving = f.relocate ? moveTo.map((l) => ilike("preferred_text", l)) : [];
  if (f.locations.length) either("location", [...f.locations.map((l) => ilike("location", l)), ...moving]);
  else if (moving.length) q = q.or(moving.join(","));

  if (f.expMin !== null || f.expMax !== null) {
    const toMonths = (v: number | null) => (v === null ? null : Math.round(v * 12));
    const column = f.expBasis === "total" ? "total_exp_months" : "relevant_exp_months";
    either(column, [between(column, toMonths(f.expMin), toMonths(f.expMax))]);
  }
  if (f.notice.length || f.servingNotice) {
    const terms = NOTICE_BUCKETS.filter((b) => f.notice.includes(b.id)).map((b) => between("notice_period_days", b.min, b.max));
    if (f.servingNotice) terms.push("serving_notice.is.true");
    either("notice_period_days", terms);
  }
  const salary = salaryRupees(f);
  if (salary) either(salary.column, [between(salary.column, salary.min, salary.max)], allowBlank || f.includeNoSalary);
  if (f.role.trim()) either("role", [ilike("role", f.role.trim())]);
  if (f.company.trim()) either("current_organization", [ilike("current_organization", f.company.trim())]);
  if (f.designation.trim()) either("current_designation", [ilike("current_designation", f.designation.trim())]);
  if (f.industry.trim()) either("industry", [ilike("industry", f.industry.trim())]);

  if (f.status) q = q.eq("status", f.status);
  if (f.excludeStatuses.length) q = q.not("status", "in", `(${f.excludeStatuses.join(",")})`);

  const dates: string[] = [];
  const after = [f.sourcedMonths ? sourcedSince(f.sourcedMonths, today) : null, f.sourcedAfter].filter((d): d is string => !!d).sort().pop();
  if (after) dates.push(`sourcing_date.gte.${after}`);
  if (f.sourcedBefore) dates.push(`sourcing_date.lte.${f.sourcedBefore}`);
  if (dates.length) either("sourcing_date", [dates.length > 1 ? `and(${dates.join(",")})` : dates[0]]);

  for (const level of EDUCATION_LEVELS) {
    const e = f.education[level.id];
    if (e.mode === "none") either(level.column, [`${level.column}.ilike.${quoted(NO_QUALIFICATION)}`]);
    else if (e.mode === "specific" && e.picks.length) either(level.column, e.picks.map((p) => ilike(level.column, p)));
  }
  if (f.institute.trim()) either("institute", [ilike("institute", f.institute.trim())]);
  if (f.educationTypes.length) either("education_type", [`education_type.in.(${f.educationTypes.join(",")})`]);
  if (f.degreeYearFrom !== null || f.degreeYearTo !== null) either("degree_year", [between("degree_year", f.degreeYearFrom, f.degreeYearTo)]);
  // Not knowing about a career break or a defence background is not the same as a blank: these never let blanks through.
  if (f.careerBreak) q = q.or("career_break.is.true");
  if (f.defence === "any") q = q.or("defence_background.not.is.null");
  else if (f.defence) q = q.eq("defence_background", f.defence);
  // Phase 2: has_resume is never blank (true or false for every record).
  if (f.hasResume) q = q.eq("has_resume", f.hasResume === "yes" ? "true" : "false");
  return q;
}

const SORT_COLUMNS: Record<SearchFilters["sort"], { column: string; ascending: boolean }> = {
  recent: { column: "sourcing_date", ascending: false },
  added: { column: "created_at", ascending: false },
  updated: { column: "updated_at", ascending: false },
  name: { column: "full_name", ascending: true },
  experience: { column: "total_exp_months", ascending: false },
  relevant: { column: "relevant_exp_months", ascending: false },
  notice: { column: "notice_period_days", ascending: true },
  salary: { column: "expected_inhand", ascending: true },
};

/** candidate_records plus the resume columns (migration 20261107000001). */
const FILTER_VIEW = "candidate_filter_records";

function visible(client: SupabaseClient, orgId: string, columns: string, options?: { count: "exact"; head?: boolean }, view = "candidate_records") {
  return client.from(view).select(columns, options).eq("organization_id", orgId).eq("sheet_live", true).is("deleted_at", null);
}

function failed(error: { message?: string; code?: string }): never {
  console.error("[candidates] filter failed", error);
  throw new CandidateActionError(500, "Couldn't load candidates. Please try again.");
}

/** The resume view or its columns are not there yet (migration 20261107000001 not applied). */
export function isMissingResumeView(error: { message?: string; code?: string } | null): boolean {
  if (!error) return false;
  return ["42P01", "42703", "PGRST205", "PGRST204"].includes(error.code ?? "") ||
    /does not exist|schema cache/i.test(error.message ?? "");
}

/** Remembered for a few minutes, so a database without the migration is not asked twice per click. */
const RECHECK_MS = 5 * 60 * 1000;
let resumeColumnsMissingAt = 0;
const resumeColumnsKnownMissing = (now: number) => now - resumeColumnsMissingAt < RECHECK_MS;

/** Tests only. */
export function resetResumeColumnsCheck(): void {
  resumeColumnsMissingAt = 0;
}

async function countMatching(client: SupabaseClient, orgId: string, f: SearchFilters, allowBlank: boolean, today: string, view: string): Promise<number> {
  const { count, error } = await applyFilters(visible(client, orgId, "id", { count: "exact", head: true }, view), f, allowBlank, today, view === FILTER_VIEW);
  if (error) failed(error);
  return count ?? 0;
}

export async function filterRecords(
  client: SupabaseClient,
  orgId: string,
  given: SearchFilters,
  page: number,
  pageSize: number,
  today = new Date().toISOString().slice(0, 10),
): Promise<FilterResponse> {
  const size = Math.min(100, Math.max(1, Math.floor(pageSize) || 20));
  // "Show more" walks a page at a time, so this is far past real use; it stops a very deep, slow offset.
  const current = Math.min(1000, Math.max(1, Math.floor(page) || 1));
  const from = (current - 1) * size;
  const sort = SORT_COLUMNS[given.sort];

  const run = (f: SearchFilters, columns: string, view: string) =>
    applyFilters(visible(client, orgId, columns, { count: "exact" }, view), f, f.includeBlank, today, view === FILTER_VIEW)
      .order(sort.column, { ascending: sort.ascending, nullsFirst: false })
      .order("id")
      .range(from, from + size - 1);

  let resumeFields = !resumeColumnsKnownMissing(Date.now());
  let f = resumeFields ? given : withoutResumeFields(given);
  let { data, error, count } = resumeFields
    ? await run(f, `${RECORD_COLUMNS}, ${RESUME_COLUMNS}`, FILTER_VIEW)
    : await run(f, RECORD_COLUMNS, "candidate_records");
  if (resumeFields && isMissingResumeView(error)) {
    resumeColumnsMissingAt = Date.now();
    resumeFields = false;
    f = withoutResumeFields(given);
    ({ data, error, count } = await run(f, RECORD_COLUMNS, "candidate_records"));
  }
  if (error) failed(error);

  const total = count ?? 0;
  const blankable = hasBlankableFilter(f);
  const other = blankable ? await countMatching(client, orgId, f, !f.includeBlank, today, resumeFields ? FILTER_VIEW : "candidate_records") : 0;
  const records = ((data ?? []) as unknown as RecordRow[]).map(toRecord);
  if (resumeFields && f.keywords.length) await attachSnippets(client, orgId, records, f.keywords.map((k) => k.text));
  if (resumeFields) await attachInferred(client, orgId, records);
  return {
    records,
    total,
    blankCount: blankable ? Math.abs(other - total) : 0,
    page: current,
    pageSize: size,
    resumeFields,
  };
}

/**
 * How many visible records carry each of these keywords, each counted on its own exactly as the list would match it
 * (keyword-suggest.ts shows the number beside a suggested term). A keyword that could not be counted gets null; this
 * never throws.
 */
export async function keywordCounts(client: SupabaseClient, orgId: string, terms: string[], today = new Date().toISOString().slice(0, 10)): Promise<{ text: string; count: number | null }[]> {
  const resumeFields = !resumeColumnsKnownMissing(Date.now());
  const view = resumeFields ? FILTER_VIEW : "candidate_records";
  return Promise.all(terms.map(async (text) => {
    const f: SearchFilters = { ...EMPTY_FILTERS, keywords: [{ text, required: true }] };
    const { count, error } = await applyFilters(visible(client, orgId, "id", { count: "exact", head: true }, view), resumeFields ? f : withoutResumeFields(f), true, today, resumeFields);
    if (error && resumeFields && isMissingResumeView(error)) resumeColumnsMissingAt = Date.now();
    return { text, count: error ? null : count ?? 0 };
  }));
}

/**
 * Owner 2026-11-11: each result shows the lines of its resume around the keywords. One read of the page's resume
 * texts; a candidate with no resume, or whose resume does not hold the words (they matched on the sheet), gets none.
 * Never fails a search: before migration 20261111000002 there is no text to read and the cards go without.
 */
async function attachSnippets(client: SupabaseClient, orgId: string, records: CandidateRecord[], keywords: string[]): Promise<void> {
  const ids = [...new Set(records.filter((r) => r.hasResume !== false).map((r) => r.candidateId))];
  if (!ids.length) return;
  const { data, error } = await client.from("candidates").select("id, resume_text").eq("organization_id", orgId).in("id", ids);
  if (error) return;
  const texts = new Map((data ?? []).map((row) => [row.id as string, row.resume_text as string | null]));
  for (const record of records) {
    const snippet = resumeSnippet(texts.get(record.candidateId), keywords);
    if (snippet) record.resumeSnippet = snippet;
  }
}

/**
 * One record with everything the candidate's panel shows (the resume fields and "has a resume"), wherever it was
 * opened from: the Candidates table lists records without them. Falls back to the plain record before the migrations.
 */
export async function getFullRecord(client: SupabaseClient, orgId: string, id: string): Promise<CandidateRecord> {
  if (!resumeColumnsKnownMissing(Date.now())) {
    const { data, error } = await client.from(FILTER_VIEW).select(`${RECORD_COLUMNS}, ${RESUME_COLUMNS}`).eq("organization_id", orgId).eq("id", id).maybeSingle();
    if (!error && data) {
      const full = toRecord(data as unknown as RecordRow);
      await attachInferred(client, orgId, [full]);
      return full;
    }
    if (error && !isMissingResumeView(error)) failed(error);
    if (error) resumeColumnsMissingAt = Date.now();
  }
  const record = await getRecord(client, orgId, id);
  await markResumes(client, orgId, [record]);
  return record;
}

/** Which resume filters have data yet, so the panel greys out the rest. */
export async function resumeFieldAvailability(client: SupabaseClient, orgId: string): Promise<FieldAvailability> {
  const empty = Object.fromEntries(RESUME_FIELDS.map((field) => [field, 0])) as Record<ResumeField, number>;
  const counted = await Promise.all(RESUME_FIELDS.map(async (field) => {
    const column = RESUME_FIELD_COLUMNS[field];
    const base = visible(client, orgId, "id", { count: "exact", head: true }, FILTER_VIEW);
    // hasResume counts the records that have one (the column itself is never null).
    const { count, error } = await (field === "preferredLocations" ? base.neq(column, "") : field === "hasResume" ? base.eq(column, true) : base.not(column, "is", null));
    return { field, count: count ?? 0, error };
  }));
  const problem = counted.find((c) => c.error)?.error ?? null;
  if (isMissingResumeView(problem)) {
    resumeColumnsMissingAt = Date.now();
    return { applied: false, counts: empty };
  }
  if (problem) failed(problem);
  resumeColumnsMissingAt = 0;
  return { applied: true, counts: { ...empty, ...Object.fromEntries(counted.map((c) => [c.field, c.count])) } };
}

// The typing dropdown --------------------------------------------------------------------------------------------------
const OPTION_COLUMNS: Record<Exclude<OptionField, "keyword">, { column: string; kind: string; view?: string }> = {
  role: { column: "role", kind: "Role" },
  designation: { column: "current_designation", kind: "Designation" },
  company: { column: "current_organization", kind: "Company" },
  location: { column: "location", kind: "Location" },
  industry: { column: "industry", kind: "Industry", view: FILTER_VIEW },
  institute: { column: "institute", kind: "Institute", view: FILTER_VIEW },
};
/** What the keyword box offers: the columns every database has. */
const KEYWORD_SOURCES = ["role", "designation", "company", "location"] as const;
/** Rows read per column for one keystroke: enough to rank the common spellings, bounded however large the org gets. */
const OPTION_SCAN = 1000;
const OPTION_LIMIT = 7;

export function isOptionField(value: unknown): value is OptionField {
  return value === "keyword" || (typeof value === "string" && Object.hasOwn(OPTION_COLUMNS, value));
}

export async function filterOptions(client: SupabaseClient, orgId: string, field: OptionField, text: string): Promise<OptionItem[]> {
  const typed = text.trim().slice(0, 60);
  if (!typed) return [];
  const sources = field === "keyword" ? KEYWORD_SOURCES.map((k) => OPTION_COLUMNS[k]) : [OPTION_COLUMNS[field]];
  const lists = await Promise.all(sources.map(async ({ column, kind, view }) => {
    const { data, error } = await visible(client, orgId, column, undefined, view).ilike(column, contains(typed)).limit(OPTION_SCAN);
    if (view && isMissingResumeView(error)) return [];
    if (error) failed(error);
    const tally = new Map<string, OptionItem>();
    for (const row of (data ?? []) as unknown as Record<string, string | null>[]) {
      const value = row[column]?.trim();
      if (!value) continue;
      const key = value.toLowerCase();
      const seen = tally.get(key);
      if (seen) seen.count += 1;
      else tally.set(key, { text: value, kind, count: 1 });
    }
    return [...tally.values()];
  }));
  const low = typed.toLowerCase();
  const place = (o: OptionItem) => {
    const t = o.text.toLowerCase();
    return t.startsWith(low) ? 0 : t.includes(` ${low}`) ? 1 : 2;
  };
  const unique = new Map<string, OptionItem>();
  for (const item of lists.flat().sort((a, b) => place(a) - place(b) || b.count - a.count)) {
    if (!unique.has(item.text.toLowerCase())) unique.set(item.text.toLowerCase(), item);
  }
  return [...unique.values()].slice(0, OPTION_LIMIT);
}

// Reading a job description --------------------------------------------------------------------------------------------
/** The preferences as removable items. A preference never filters; the ranking reads it. */
export function preferredItems(prefer: Preferences): PreferredItem[] {
  const out: PreferredItem[] = [];
  for (const key of Object.keys(prefer) as (keyof Preferences)[]) {
    if (prefer[key] === undefined) continue;
    const chips = specChips({ summary: "", must: {}, prefer: { [key]: prefer[key] }, keywords: [] });
    if (chips[0]) out.push({ key, label: chips[0].label });
  }
  return out;
}

export function understoodFilters(spec: SearchSpec) {
  return { filters: filtersFromSpec(spec), prefer: spec.prefer, preferred: preferredItems(spec.prefer) };
}
