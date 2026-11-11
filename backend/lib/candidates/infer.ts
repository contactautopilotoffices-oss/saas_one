/**
 * What can be worked out from the employers a resume lists (owner 2026-11-11): the latest job's designation and
 * company when the resume's reader left them empty, and the total experience from the employment dates. Pure and
 * deterministic: no AI. A value from here is always marked "worked out" where it is shown (candidates.inferred_fields),
 * because it is a reading of the dates, not something the resume states.
 *
 * Never worked out: notice period, salaries and the role sourced for. A resume does not say them.
 */
import type { PastCompany } from "./types";

/** The record fields this file may fill; the names stored in candidates.inferred_fields and sent to the screen. */
export const INFERABLE_FIELDS = ["currentDesignation", "currentOrganization", "totalExpMonths"] as const;
export type InferableField = (typeof INFERABLE_FIELDS)[number];

export interface InferredDetails {
  designation: string | null;
  company: string | null;
  totalMonths: number | null;
}

/** "2021-06" -> months since year 0; "2021" -> January of that year. Null for anything else. */
function monthIndex(value: string | null | undefined): number | null {
  const m = /^(\d{4})(?:-(\d{1,2}))?$/.exec((value ?? "").trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = m[2] ? Number(m[2]) : 1;
  if (year < 1950 || year > 2100 || month < 1 || month > 12) return null;
  return year * 12 + (month - 1);
}

/** Longest career a resume's dates may add up to: past this the dates are wrong, and nothing is claimed. */
const MAX_MONTHS = 600;

export function inferFromEmployers(past: PastCompany[] | null | undefined, now: Date = new Date()): InferredDetails {
  const jobs = (past ?? []).filter((job) => job && typeof job.company === "string" && job.company.trim());
  const none: InferredDetails = { designation: null, company: null, totalMonths: null };
  if (!jobs.length) return none;
  const today = now.getFullYear() * 12 + now.getMonth();
  const dated = jobs.map((job, order) => ({ job, order, from: monthIndex(job.from), to: monthIndex(job.to) }));

  // The latest job: the one still running that started last; else the one that ended last; else the first one listed
  // (resumes list the newest job first).
  const running = dated.filter((d) => d.to === null && d.from !== null).sort((a, b) => (b.from as number) - (a.from as number))[0];
  const ended = dated.filter((d) => d.to !== null).sort((a, b) => (b.to as number) - (a.to as number))[0];
  const latest = running ?? ended ?? dated[0];

  // Total experience: the months covered by the dated jobs, a month worked in two jobs counted once and a gap between
  // jobs not counted. A job with no end date runs to today only if it is the latest one; otherwise its length is unknown.
  const spans: [number, number][] = [];
  for (const d of dated) {
    if (d.from === null || d.from > today) continue;
    let end = d.to;
    if (end === null) {
      if (d !== running) continue;
      end = today;
    }
    end = Math.min(end, today);
    // A job given by years only ("2020" to "2020") is at least part of that year.
    if (end <= d.from) end = d.from + 6;
    spans.push([d.from, end]);
  }
  spans.sort((a, b) => a[0] - b[0]);
  let months = 0;
  let reach = -Infinity;
  for (const [start, end] of spans) {
    const from = Math.max(start, reach);
    if (end > from) months += end - from;
    reach = Math.max(reach, end);
  }

  const text = (value: string | null | undefined) => (typeof value === "string" && value.trim() ? value.trim() : null);
  return {
    designation: text(latest.job.designation),
    company: text(latest.job.company),
    totalMonths: months >= 1 && months <= MAX_MONTHS ? months : null,
  };
}
