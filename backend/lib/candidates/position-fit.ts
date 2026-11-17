/**
 * How a person compares with the position they are in (owner 2026-11-17): the panel opened from the pipeline shows
 * it. Pure and shared by the browser and the tests. Only facts on record are compared; a fact missing on either side
 * is "not known", never a pass or a fail. Must-haves are listed for HR to check in the resume, not guessed.
 */
import { draftFromPosition } from "./position-draft";
import type { CandidateRecord, Position } from "./types";

export type FitVerdict = "meets" | "off" | "unknown";

export interface FitCheck {
  key: "experience" | "notice" | "salary" | "location";
  label: string;
  verdict: FitVerdict;
  /** "6 yrs · wants 4–8 yrs" */
  detail: string;
}

export interface PositionFit {
  checks: FitCheck[];
  met: number;
  known: number;
  /** The position's must-haves, to check in the resume. */
  mustHaves: string[];
  education: string | null;
}

const years = (months: number) => {
  const y = months / 12;
  return `${Number.isInteger(y) ? y : y.toFixed(1)} yrs`;
};
const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

function range(min: number | null, max: number | null, unit: (n: number) => string): string | null {
  if (min !== null && max !== null) return `${unit(min)}–${unit(max)}`;
  if (min !== null) return `${unit(min)}+`;
  if (max !== null) return `up to ${unit(max)}`;
  return null;
}

export function positionFit(record: CandidateRecord, position: Position): PositionFit {
  const d = draftFromPosition(position);
  const checks: FitCheck[] = [];

  // Experience (total), against the years the position asks for.
  const wantExp = d.expMinYears !== null && d.expMaxYears !== null ? `${d.expMinYears}–${d.expMaxYears} yrs` : range(d.expMinYears, d.expMaxYears, (n) => `${n} yrs`);
  if (wantExp) {
    const has = record.totalExpMonths;
    const verdict: FitVerdict = has === null ? "unknown"
      : (d.expMinYears !== null && has < d.expMinYears * 12) || (d.expMaxYears !== null && has > d.expMaxYears * 12) ? "off" : "meets";
    checks.push({ key: "experience", label: "Experience", verdict, detail: `${has === null ? "not on record" : years(has)} · wants ${wantExp}` });
  }

  // Notice, against the longest the position accepts.
  if (d.noticeMaxDays !== null) {
    const has = record.noticePeriodDays;
    const verdict: FitVerdict = has === null ? "unknown" : has <= d.noticeMaxDays ? "meets" : "off";
    checks.push({ key: "notice", label: "Notice", verdict, detail: `${has === null ? "not on record" : `${has} days`} · wants ${d.noticeMaxDays} days or less` });
  }

  // Expected in-hand, against the budget. Under the budget is a fit; over the top is not.
  const budget = range(d.budgetMinInhand, d.budgetMaxInhand, inr);
  if (budget) {
    const has = record.expectedInhand;
    const verdict: FitVerdict = has === null ? "unknown" : d.budgetMaxInhand !== null && has > d.budgetMaxInhand ? "off" : "meets";
    checks.push({ key: "salary", label: "Expected in-hand", verdict, detail: `${has === null ? "not on record" : `${inr(has)}/month`} · budget ${budget}/month` });
  }

  // Location: where they are, or a city they would move to, names the position's city.
  if (d.location) {
    const want = norm(d.location);
    const places = [record.location, ...(record.extras?.preferredLocations ?? [])].filter((p): p is string => Boolean(p && p.trim()));
    const verdict: FitVerdict = !places.length ? "unknown"
      : places.some((p) => { const n = norm(p); return n.includes(want) || want.includes(n); }) ? "meets" : "off";
    const would = record.extras?.preferredLocations?.length ? ` (would move to ${record.extras.preferredLocations.join(", ")})` : "";
    checks.push({ key: "location", label: "Location", verdict, detail: `${record.location ?? "not on record"}${would} · job in ${d.location}` });
  }

  const known = checks.filter((c) => c.verdict !== "unknown").length;
  return {
    checks,
    met: checks.filter((c) => c.verdict === "meets").length,
    known,
    mustHaves: d.mustHaves.map((m) => m.text),
    education: d.education,
  };
}
