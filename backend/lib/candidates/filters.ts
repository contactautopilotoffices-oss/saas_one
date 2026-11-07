/**
 * Candidate Search filters (owner 2026-11-06): the Naukri-style filter panel. Filtering runs straight on the database
 * without any AI, so results change as HR clicks; AI only reads a job description into these filters and, on request,
 * ranks what they matched. Pure and type-only imports, so the Tech console tab and the server share one definition.
 *
 * Owner 2026-11-07 (option A): the filters resumes will feed (education, industry, preferred location, career break,
 * defence background, currently serving notice) are built and shown greyed out until records hold that data
 * (migration 20261107000001, then resumes). Gender, age and disability are shown greyed out with no data stored: they
 * need HR / legal sign-off first.
 */
import type { Preferences, SearchSpec } from "./query-spec";
import { STATUS_LABELS, type CandidateRecord, type RecordStatus } from "./types";

export const NOTICE_BUCKETS = [
  { id: "15", label: "0-15 days", min: 0, max: 15 },
  { id: "30", label: "1 month", min: 16, max: 30 },
  { id: "60", label: "2 months", min: 31, max: 60 },
  { id: "90", label: "3 months", min: 61, max: 90 },
  { id: "more", label: "More than 3 months", min: 91, max: null },
] as const;
export type NoticeBucket = (typeof NOTICE_BUCKETS)[number]["id"];

export const SOURCED_MONTHS = [3, 6, 12] as const;
export type SourcedMonths = (typeof SOURCED_MONTHS)[number];

export const SORTS = ["recent", "experience", "notice"] as const;
export type FilterSort = (typeof SORTS)[number];
export const SORT_LABELS: Record<FilterSort, string> = {
  recent: "Recently sourced",
  experience: "Most experience",
  notice: "Shortest notice",
};

export const EDUCATION_LEVELS = [
  { id: "ug", label: "UG", column: "ug_qualification", options: ["B.Arch", "B.E./B.Tech", "B.Com", "BBA", "BA", "B.Sc", "LLB", "Diploma"] },
  { id: "pg", label: "PG", column: "pg_qualification", options: ["MBA", "PGDM", "LLM", "M.Arch", "M.Tech", "M.Com"] },
  { id: "ppg", label: "PPG/Doctorate", column: "ppg_qualification", options: ["PhD", "LLD"] },
] as const;
export type EducationLevel = (typeof EDUCATION_LEVELS)[number]["id"];
export type EducationMode = "any" | "specific" | "none";
/** Stored as the qualification when a CV shows none. NULL means not known. */
export const NO_QUALIFICATION = "none";

export const EDUCATION_TYPES = [
  { id: "full_time", label: "Full time" },
  { id: "part_time", label: "Part time" },
  { id: "correspondence", label: "Correspondence" },
] as const;
export type EducationType = (typeof EDUCATION_TYPES)[number]["id"];

export const DEFENCE_OPTIONS = [
  { id: "army", label: "Army" },
  { id: "navy", label: "Navy" },
  { id: "air_force", label: "Air Force" },
  { id: "paramilitary", label: "Other paramilitary forces" },
] as const;
export type DefenceBackground = (typeof DEFENCE_OPTIONS)[number]["id"];

export interface KeywordToken {
  text: string;
  /** Starred: every starred keyword must be on the record. The rest: at least one of them. */
  required: boolean;
}

export interface SearchFilters {
  keywords: KeywordToken[];
  excludes: string[];
  locations: string[];
  /** Also candidates who would move to the locations above (or to `preferredLocations`, when set). */
  relocate: boolean;
  /** "Change preferred location": the places to match against what candidates would move to. */
  preferredLocations: string[];
  expBasis: "total" | "relevant";
  /** Years. */
  expMin: number | null;
  expMax: number | null;
  notice: NoticeBucket[];
  /** "Currently serving notice", alongside the notice periods. */
  servingNotice: boolean;
  salaryBasis: "current" | "expected";
  /** The numbers below are lacs a year ("year") or ₹ thousands a month ("month"). */
  salaryUnit: "year" | "month";
  salaryMin: number | null;
  salaryMax: number | null;
  /** The salary filter lets through records with no salary. */
  includeNoSalary: boolean;
  role: string;
  company: string;
  designation: string;
  industry: string;
  status: RecordStatus | "";
  /** From a job description ("no rejected ones"). */
  excludeStatuses: RecordStatus[];
  sourcedMonths: SourcedMonths | null;
  /** YYYY-MM-DD, from a job description. */
  sourcedAfter: string | null;
  sourcedBefore: string | null;
  education: Record<EducationLevel, { mode: EducationMode; picks: string[] }>;
  institute: string;
  educationTypes: EducationType[];
  degreeYearFrom: number | null;
  degreeYearTo: number | null;
  careerBreak: boolean;
  /** "" = no filter, "any" = any defence background. */
  defence: DefenceBackground | "any" | "";
  /** Show records that are blank on a field a filter uses. */
  includeBlank: boolean;
  sort: FilterSort;
}

const NO_EDUCATION = { mode: "any" as EducationMode, picks: [] as string[] };

export const EMPTY_FILTERS: SearchFilters = {
  keywords: [],
  excludes: [],
  locations: [],
  relocate: true,
  preferredLocations: [],
  expBasis: "total",
  expMin: null,
  expMax: null,
  notice: [],
  servingNotice: false,
  salaryBasis: "expected",
  salaryUnit: "year",
  salaryMin: null,
  salaryMax: null,
  includeNoSalary: false,
  role: "",
  company: "",
  designation: "",
  industry: "",
  status: "",
  excludeStatuses: [],
  sourcedMonths: null,
  sourcedAfter: null,
  sourcedBefore: null,
  education: { ug: NO_EDUCATION, pg: NO_EDUCATION, ppg: NO_EDUCATION },
  institute: "",
  educationTypes: [],
  degreeYearFrom: null,
  degreeYearTo: null,
  careerBreak: false,
  defence: "",
  includeBlank: false,
  sort: "recent",
};

// The fields resumes will fill ---------------------------------------------------------------------------------------
export const RESUME_FIELDS = [
  "industry", "preferredLocations", "ug", "pg", "ppg", "institute", "educationType", "degreeYear", "careerBreak", "defence", "servingNotice",
] as const;
export type ResumeField = (typeof RESUME_FIELDS)[number];

/** The candidate_records column that holds each one (migration 20261107000001). */
export const RESUME_FIELD_COLUMNS: Record<ResumeField, string> = {
  industry: "industry",
  preferredLocations: "preferred_text",
  ug: "ug_qualification",
  pg: "pg_qualification",
  ppg: "ppg_qualification",
  institute: "institute",
  educationType: "education_type",
  degreeYear: "degree_year",
  careerBreak: "career_break",
  defence: "defence_background",
  servingNotice: "serving_notice",
};

/** GET /api/candidates/filter-fields: which of those filters have data yet. A filter with none is shown greyed out. */
export interface FieldAvailability {
  /** False until migration 20261107000001 is applied. */
  applied: boolean;
  /** Records holding a value, per field. */
  counts: Record<ResumeField, number>;
}

/** The filters with the resume fields switched off: what runs before migration 20261107000001 is applied. */
export function withoutResumeFields(f: SearchFilters): SearchFilters {
  return {
    ...f,
    relocate: false,
    preferredLocations: [],
    servingNotice: false,
    industry: "",
    education: EMPTY_FILTERS.education,
    institute: "",
    educationTypes: [],
    degreeYearFrom: null,
    degreeYearTo: null,
    careerBreak: false,
    defence: "",
  };
}

// ---------------------------------------------------------------------------------------------------------------------

/** The salary filter in the stored unit: rupees a month, in hand. Null when no salary filter is set. */
export function salaryRupees(f: SearchFilters): { column: "current_inhand" | "expected_inhand"; min: number | null; max: number | null } | null {
  if (f.salaryMin === null && f.salaryMax === null) return null;
  const perUnit = f.salaryUnit === "year" ? 100_000 / 12 : 1000;
  const rupees = (v: number | null) => (v === null ? null : Math.round(v * perUnit));
  return {
    column: f.salaryBasis === "current" ? "current_inhand" : "expected_inhand",
    min: rupees(f.salaryMin),
    max: rupees(f.salaryMax),
  };
}

export function sourcedSince(months: SourcedMonths, today: string): string {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - months);
  return d.toISOString().slice(0, 10);
}

function range(min: number | string | null, max: number | string | null, unit: string): string {
  if (min !== null && max !== null) return `${min}${unit} to ${max}${unit}`;
  return min !== null ? `${min}${unit} or more` : `up to ${max}${unit}`;
}

export interface FilterChip {
  id: string;
  label: string;
  /** Applying this removes the filter. */
  clear: Partial<SearchFilters>;
}

/** The filters in words, for the "What the search understood" card. Keywords and exclusions are shown beside these. */
export function filterChips(f: SearchFilters): FilterChip[] {
  const chips: FilterChip[] = [];
  const add = (id: string, label: string, clear: Partial<SearchFilters>) => chips.push({ id, label, clear });
  if (f.locations.length) add("location", `Location: ${f.locations.join(" / ")}`, { locations: [] });
  if (f.preferredLocations.length) add("preferred", `Would move to: ${f.preferredLocations.join(" / ")}`, { preferredLocations: [] });
  if (f.expMin !== null || f.expMax !== null) {
    add("experience", `${f.expBasis === "total" ? "Total" : "Relevant"} exp ${range(f.expMin, f.expMax, " yrs")}`, { expMin: null, expMax: null });
  }
  if (f.notice.length || f.servingNotice) {
    const parts = [...NOTICE_BUCKETS.filter((b) => f.notice.includes(b.id)).map((b) => b.label), ...(f.servingNotice ? ["Currently serving"] : [])];
    add("notice", `Notice: ${parts.join(" / ")}`, { notice: [], servingNotice: false });
  }
  if (f.salaryMin !== null || f.salaryMax !== null) {
    const year = f.salaryUnit === "year";
    const money = (v: number | null) => (v === null ? null : `₹${v}`);
    add("salary", `${f.salaryBasis === "current" ? "Current" : "Expected"} ${range(money(f.salaryMin), money(f.salaryMax), year ? "L" : "K")} ${year ? "a year" : "a month"}`, { salaryMin: null, salaryMax: null });
  }
  if (f.role.trim()) add("role", `Role: ${f.role.trim()}`, { role: "" });
  if (f.company.trim()) add("company", `Company: ${f.company.trim()}`, { company: "" });
  if (f.designation.trim()) add("designation", `Designation: ${f.designation.trim()}`, { designation: "" });
  if (f.industry.trim()) add("industry", `Industry: ${f.industry.trim()}`, { industry: "" });
  if (f.status) add("status", `Status: ${STATUS_LABELS[f.status]}`, { status: "" });
  if (f.excludeStatuses.length) add("not-status", `Not: ${f.excludeStatuses.map((s) => STATUS_LABELS[s]).join(" / ")}`, { excludeStatuses: [] });
  if (f.sourcedMonths) add("sourced", `Sourced in last ${f.sourcedMonths === 12 ? "year" : `${f.sourcedMonths} months`}`, { sourcedMonths: null });
  if (f.sourcedAfter) add("sourced-after", `Sourced from ${f.sourcedAfter}`, { sourcedAfter: null });
  if (f.sourcedBefore) add("sourced-before", `Sourced until ${f.sourcedBefore}`, { sourcedBefore: null });
  for (const level of EDUCATION_LEVELS) {
    const e = f.education[level.id];
    const clear = { education: { ...f.education, [level.id]: { mode: "any", picks: [] } } } as Partial<SearchFilters>;
    if (e.mode === "none") add(level.id, `No ${level.label} qualification`, clear);
    else if (e.mode === "specific" && e.picks.length) add(level.id, `${level.label}: ${e.picks.join(" / ")}`, clear);
  }
  if (f.institute.trim()) add("institute", `Institute: ${f.institute.trim()}`, { institute: "" });
  if (f.educationTypes.length) {
    add("education-type", `Education: ${EDUCATION_TYPES.filter((t) => f.educationTypes.includes(t.id)).map((t) => t.label).join(" / ")}`, { educationTypes: [] });
  }
  if (f.degreeYearFrom !== null || f.degreeYearTo !== null) add("degree-year", `Degree year ${range(f.degreeYearFrom, f.degreeYearTo, "")}`, { degreeYearFrom: null, degreeYearTo: null });
  if (f.careerBreak) add("career-break", "Returning after a career break", { careerBreak: false });
  if (f.defence) {
    const label = f.defence === "any" ? "Defence background" : `Defence: ${DEFENCE_OPTIONS.find((d) => d.id === f.defence)?.label}`;
    add("defence", label, { defence: "" });
  }
  return chips;
}

const educationFiltered = (f: SearchFilters) =>
  EDUCATION_LEVELS.some((l) => f.education[l.id].mode === "none" || (f.education[l.id].mode === "specific" && f.education[l.id].picks.length > 0));

/** Filters on columns that can be empty: only these can hide a record for being blank. */
export function hasBlankableFilter(f: SearchFilters): boolean {
  return (
    f.locations.length > 0 || f.expMin !== null || f.expMax !== null || f.notice.length > 0 || f.servingNotice ||
    ((f.salaryMin !== null || f.salaryMax !== null) && !f.includeNoSalary) ||
    !!f.role.trim() || !!f.company.trim() || !!f.designation.trim() || !!f.industry.trim() ||
    f.sourcedMonths !== null || f.sourcedAfter !== null || f.sourcedBefore !== null ||
    educationFiltered(f) || !!f.institute.trim() || f.educationTypes.length > 0 || f.degreeYearFrom !== null || f.degreeYearTo !== null
  );
}

export function hasActiveFilter(f: SearchFilters): boolean {
  return f.keywords.length > 0 || f.excludes.length > 0 || filterChips(f).length > 0;
}

/** A plain sentence, so a search made by clicking reads the same as one the AI understood. */
export function describeFilters(f: SearchFilters): string {
  let line = f.keywords.length ? `Candidates with ${f.keywords.map((k) => k.text).join(", ")}` : "Candidates";
  if (f.locations.length) line += ` in ${f.locations.join(" or ")}`;
  const rest = filterChips(f).filter((c) => c.id !== "location").map((c) => c.label.charAt(0).toLowerCase() + c.label.slice(1));
  if (rest.length) line += `, ${rest.join(", ")}`;
  if (f.excludes.length) line += `, leaving out ${f.excludes.join(" and ")}`;
  return `${line}.`;
}

/** Why a record shown through "blank details" did not strictly match: the filtered fields it has no value for. */
export function blankFields(r: CandidateRecord, f: SearchFilters): string[] {
  const out: string[] = [];
  if (f.locations.length && r.location === null) out.push("location");
  if (f.expMin !== null || f.expMax !== null) {
    if ((f.expBasis === "total" ? r.totalExpMonths : r.relevantExpMonths) === null) out.push("experience");
  }
  if ((f.notice.length || f.servingNotice) && r.noticePeriodDays === null) out.push("notice period");
  const salary = salaryRupees(f);
  if (salary && (salary.column === "current_inhand" ? r.currentInhand : r.expectedInhand) === null) out.push("salary");
  if (f.role.trim() && r.role === null) out.push("role");
  if (f.company.trim() && r.currentOrganization === null) out.push("company");
  if (f.designation.trim() && r.currentDesignation === null) out.push("designation");
  if ((f.sourcedMonths || f.sourcedAfter || f.sourcedBefore) && r.sourcingDate === null) out.push("sourcing date");
  const x = r.extras;
  if (x) {
    if (f.industry.trim() && x.industry === null) out.push("industry");
    const education = EDUCATION_LEVELS.some((l) => {
      const e = f.education[l.id];
      const value = l.id === "ug" ? x.ugQualification : l.id === "pg" ? x.pgQualification : x.ppgQualification;
      return (e.mode === "none" || (e.mode === "specific" && e.picks.length > 0)) && value === null;
    });
    if (education) out.push("education");
    if (f.institute.trim() && x.institute === null) out.push("institute");
    if (f.educationTypes.length && x.educationType === null) out.push("education type");
    if ((f.degreeYearFrom !== null || f.degreeYearTo !== null) && x.degreeYear === null) out.push("degree year");
  }
  return out;
}

/** What the filters ask for, in the shape the AI ranking's code-computed scores read. */
export function specFromFilters(f: SearchFilters, prefer: Preferences = {}): SearchSpec {
  const must: SearchSpec["must"] = {};
  if (f.locations.length) must.locations = f.locations;
  if (f.expBasis === "relevant") {
    if (f.expMin !== null) must.min_relevant_exp_months = Math.round(f.expMin * 12);
    if (f.expMax !== null) must.max_relevant_exp_months = Math.round(f.expMax * 12);
  } else if (f.expMin !== null) {
    must.min_total_exp_months = Math.round(f.expMin * 12);
  }
  if (f.notice.length && !f.notice.includes("more")) {
    must.max_notice_days = Math.max(...NOTICE_BUCKETS.filter((b) => f.notice.includes(b.id)).map((b) => b.max as number));
  }
  const salary = salaryRupees(f);
  if (salary?.column === "expected_inhand" && salary.max !== null) must.max_expected_inhand = salary.max;
  if (f.status) must.statuses = [f.status];
  if (f.excludeStatuses.length) must.exclude_statuses = f.excludeStatuses;
  return { summary: describeFilters(f), must, prefer, keywords: f.keywords.map((k) => k.text) };
}

/** The notice filter for "up to N days": every bucket that starts within it. */
export function noticeBucketsUpTo(days: number): NoticeBucket[] {
  return NOTICE_BUCKETS.filter((b) => b.min <= days).map((b) => b.id);
}

/** One preference the AI read from a job description: it steers the ranking and never filters. */
export interface PreferredItem {
  key: keyof Preferences;
  label: string;
}

/** A job description read by the AI, as filter values. Anything else stays as it was. */
export function filtersFromSpec(spec: SearchSpec): Partial<SearchFilters> {
  const m = spec.must;
  const out: Partial<SearchFilters> = {
    keywords: [
      ...(m.roles ?? []).map((text) => ({ text, required: true })),
      ...spec.keywords.map((text) => ({ text, required: false })),
    ].filter((k, i, all) => all.findIndex((x) => x.text.toLowerCase() === k.text.toLowerCase()) === i),
    excludes: [],
    locations: m.locations ?? [],
    excludeStatuses: m.exclude_statuses ?? [],
    status: m.statuses?.length === 1 ? m.statuses[0] : "",
    sourcedAfter: m.sourced_after ?? null,
    sourcedBefore: m.sourced_before ?? null,
    notice: m.max_notice_days === undefined ? [] : noticeBucketsUpTo(m.max_notice_days),
    expMin: null,
    expMax: null,
    salaryMin: null,
    salaryMax: null,
  };
  const years = (months: number) => Math.round((months / 12) * 10) / 10;
  if (m.min_relevant_exp_months !== undefined || m.max_relevant_exp_months !== undefined) {
    out.expBasis = "relevant";
    out.expMin = m.min_relevant_exp_months === undefined ? null : years(m.min_relevant_exp_months);
    out.expMax = m.max_relevant_exp_months === undefined ? null : years(m.max_relevant_exp_months);
  } else if (m.min_total_exp_months !== undefined) {
    out.expBasis = "total";
    out.expMin = years(m.min_total_exp_months);
  }
  if (m.max_expected_inhand !== undefined) {
    out.salaryBasis = "expected";
    out.salaryUnit = "month";
    out.salaryMax = Math.round(m.max_expected_inhand / 100) / 10;
  }
  return out;
}

// API shapes ---------------------------------------------------------------------------------------------------------

/** POST /api/candidates/filter */
export interface FilterResponse {
  records: CandidateRecord[];
  total: number;
  /** Records hidden (or, with includeBlank, shown) only because a filtered field is blank. */
  blankCount: number;
  page: number;
  pageSize: number;
  /** False before migration 20261107000001: the resume filters were left out of this answer. */
  resumeFields: boolean;
}

export type OptionField = "keyword" | "location" | "role" | "company" | "designation" | "industry" | "institute";

/** GET /api/candidates/options: what the dropdown offers while HR types, from the organisation's own records. */
export interface OptionItem {
  text: string;
  /** Role, Designation, Company or Location. */
  kind: string;
  count: number;
}

/** POST /api/candidates/understand: a job description read into filters. */
export interface UnderstandResponse {
  filters: Partial<SearchFilters>;
  prefer: Preferences;
  preferred: PreferredItem[];
  /** The job description, kept for the AI ranking. */
  summary: string;
  aiParsed: boolean;
  notices: string[];
}

/** POST /api/candidates/suggest-keywords */
export interface KeywordSuggestion {
  text: string;
  count: number;
}
