/**
 * The position form's draft (owner 2026-11-16), pure: shared by the browser (PositionForm.tsx), the read route and
 * the tests. Nothing here talks to a model or a database.
 *
 *   draftFromReads    : the search spec the JD reader produced + the job details the position reader produced -> a draft
 *   draftFromPosition : a saved position -> the draft to edit it
 *   filtersFromDraft  : the draft's requirements -> the SearchFilters the position runs with
 */
import { EMPTY_FILTERS, NOTICE_BUCKETS, type KeywordToken, type SearchFilters } from "./filters";
import type { Preferences, SearchSpec } from "./query-spec";
import type { EmploymentType, Position, PositionDraft } from "./types";

/** What the position reader (position-reader.ts) returns for the job's own details. */
export interface PositionDetails {
  title: string | null;
  department: string | null;
  designation: string | null;
  employmentType: EmploymentType | null;
  openings: number | null;
  education: string | null;
  budgetMinInhand: number | null;
  budgetMaxInhand: number | null;
  summary: string | null;
  tools: string[];
}

export const EMPTY_DETAILS: PositionDetails = {
  title: null, department: null, designation: null, employmentType: null, openings: null, education: null,
  budgetMinInhand: null, budgetMaxInhand: null, summary: null, tools: [],
};

export function emptyDraft(): PositionDraft {
  return {
    title: "", department: null, designation: null, location: null, employmentType: null, openings: 1, hiringManager: null,
    priority: "normal", targetDays: 21, education: null, budgetMinInhand: null, budgetMaxInhand: null, summary: null,
    expMinYears: null, expMaxYears: null, noticeMaxDays: null, mustHaves: [], niceToHaves: [], tools: [], prefer: {},
    jdText: "", jdFileName: null,
  };
}

const years = (months: number | undefined | null): number | null => (months === undefined || months === null ? null : Math.round((months / 12) * 10) / 10);

const unique = (items: string[]): string[] => {
  const seen = new Set<string>();
  return items.map((t) => t.trim()).filter((t) => t && !seen.has(t.toLowerCase()) && seen.add(t.toLowerCase()));
};

/** The draft from what the two readers found in a JD. The title falls back to the preferred role, then the file name. */
export function draftFromReads(spec: SearchSpec, details: PositionDetails, jdText: string, jdFileName: string | null): PositionDraft {
  const must = spec.must;
  const fromFile = jdFileName ? jdFileName.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim() : "";
  const mustHaves = (must.skill_groups ?? []).map((group) => ({ text: group[0], alts: unique(group.slice(1)) })).filter((g) => g.text);
  const taken = new Set(mustHaves.flatMap((g) => [g.text, ...g.alts]).map((t) => t.toLowerCase()));
  const tools = unique(details.tools).filter((t) => !taken.has(t.toLowerCase()));
  const toolSet = new Set(tools.map((t) => t.toLowerCase()));
  return {
    ...emptyDraft(),
    title: details.title?.trim() || spec.prefer.roles?.[0] || must.roles?.[0] || fromFile,
    department: details.department,
    designation: details.designation,
    location: must.locations?.[0] ?? spec.prefer.locations?.[0] ?? null,
    employmentType: details.employmentType,
    openings: details.openings ?? 1,
    education: details.education,
    budgetMinInhand: details.budgetMinInhand,
    budgetMaxInhand: details.budgetMaxInhand ?? must.max_expected_inhand ?? spec.prefer.max_expected_inhand ?? null,
    summary: details.summary,
    expMinYears: years(must.min_total_exp_months ?? must.min_relevant_exp_months ?? spec.prefer.min_relevant_exp_months),
    expMaxYears: years(must.max_total_exp_months ?? must.max_relevant_exp_months),
    noticeMaxDays: must.max_notice_days ?? spec.prefer.max_notice_days ?? null,
    mustHaves,
    niceToHaves: unique(spec.keywords).filter((k) => !taken.has(k.toLowerCase()) && !toolSet.has(k.toLowerCase())),
    tools,
    prefer: spec.prefer,
    jdText,
    jdFileName,
  };
}

/** The draft to edit a saved position: its details, and its requirements read back out of its filters. */
export function draftFromPosition(p: Position): PositionDraft {
  const f = p.filters;
  const keywords = f.keywords ?? [];
  const noticeMax = (f.notice ?? []).reduce<number | null>((max, id) => {
    const bucket = NOTICE_BUCKETS.find((b) => b.id === id);
    const top = bucket?.max ?? null;
    return top === null ? max : Math.max(max ?? 0, top);
  }, null);
  const monthly = f.salaryUnit === "month" ? 1000 : f.salaryUnit === "year" ? 100_000 / 12 : null;
  const toMonth = (v: number | null | undefined) => (v === null || v === undefined || monthly === null ? null : Math.round(v * monthly));
  return {
    title: p.title,
    department: p.department,
    designation: p.designation,
    location: p.location ?? f.locations?.[0] ?? null,
    employmentType: p.employmentType,
    openings: p.openings,
    hiringManager: p.hiringManager,
    priority: p.priority,
    targetDays: p.targetDays,
    education: p.education,
    budgetMinInhand: p.budgetMinInhand ?? (f.salaryBasis === "expected" ? toMonth(f.salaryMin) : null),
    budgetMaxInhand: p.budgetMaxInhand ?? (f.salaryBasis === "expected" ? toMonth(f.salaryMax) : null),
    summary: p.summary,
    expMinYears: f.expMin ?? null,
    expMaxYears: f.expMax ?? null,
    noticeMaxDays: noticeMax,
    mustHaves: keywords.filter((k) => k.required).map((k) => ({ text: k.text, alts: unique(k.alts ?? []) })),
    niceToHaves: keywords.filter((k) => !k.required).map((k) => k.text),
    tools: [],
    prefer: p.prefer ?? {},
    jdText: p.jdText ?? "",
    jdFileName: p.jdFileName,
  };
}

/** The search a position runs with: its must-haves starred, the rest plain, and the ranges as filters. */
export function filtersFromDraft(d: PositionDraft): SearchFilters {
  const keywords: KeywordToken[] = [];
  const seen = new Set<string>();
  const add = (text: string, required: boolean, alts: string[] = []) => {
    const t = text.trim();
    if (!t || seen.has(t.toLowerCase())) return;
    seen.add(t.toLowerCase());
    keywords.push(alts.length ? { text: t, required, alts } : { text: t, required });
  };
  for (const g of d.mustHaves) add(g.text, true, unique(g.alts));
  for (const t of d.niceToHaves) add(t, false);
  for (const t of d.tools) add(t, false);
  const notice = d.noticeMaxDays === null ? [] : NOTICE_BUCKETS.filter((b) => b.max !== null && b.max <= Math.max(15, d.noticeMaxDays as number)).map((b) => b.id);
  return {
    ...EMPTY_FILTERS,
    keywords,
    locations: d.location ? [d.location] : [],
    expBasis: "total",
    expMin: d.expMinYears,
    expMax: d.expMaxYears,
    notice,
    salaryBasis: "expected",
    salaryUnit: "month",
    salaryMin: null,
    salaryMax: d.budgetMaxInhand === null ? null : Math.round(d.budgetMaxInhand / 1000),
    includeNoSalary: true,
  };
}

/** The preferences a position keeps: its title as the preferred role, plus what the JD reader preferred. */
export function preferFromDraft(d: PositionDraft): Preferences {
  const roles = unique([d.title, ...(d.prefer.roles ?? [])]);
  return { ...d.prefer, ...(roles.length ? { roles } : {}) };
}
