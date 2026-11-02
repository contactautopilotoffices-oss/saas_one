/**
 * Turn messy spreadsheet cells into clean values. Pure functions (no I/O), unit-tested in tests/candidates.
 * Every parser returns { value, issue? }: value is null when the cell is empty or unreadable, and `issue` explains
 * anything HR should look at (the row is still imported; the original cell is kept in candidate_sheet_rows).
 */
import { RECORD_STATUSES, type RecordStatus } from "./types";

export interface Parsed<T> {
  value: T | null;
  issue?: string;
}

// NoInfer: T comes from the caller's declared return type, so ok(null) / flag(null, ...) fit Parsed<number> too.
const ok = <T>(value: NoInfer<T> | null): Parsed<T> => ({ value });
const flag = <T>(value: NoInfer<T> | null, issue: string): Parsed<T> => ({ value, issue });

/** Trim, collapse inner whitespace; empty / "-" / "NA" / "N/A" / "nil" become null. */
export function cleanText(input: unknown): string | null {
  if (input === null || input === undefined) return null;
  const text = String(input).replace(/\s+/g, " ").trim();
  if (!text || /^(-+|n\/?a|nil|null|none|\.)$/i.test(text)) return null;
  return text;
}

const NUMBER = String.raw`(\d+(?:\.\d+)?)`;

/**
 * Experience in months. "4 Yrs" -> 48, "4.5 years" -> 54, "4 yrs 6 months" / "4y 6m" -> 54, "6 months" -> 6,
 * "Fresher" -> 0, a bare number is years ("4" -> 48). A range "4-5 yrs" keeps the lower end and is flagged.
 */
export function parseExperienceMonths(input: unknown, label = "Experience"): Parsed<number> {
  if (typeof input === "number" && Number.isFinite(input)) {
    return input < 0 || input > 60 ? flag(null, `${label} "${input}" is not a number of years`) : ok(Math.round(input * 12));
  }
  const text = cleanText(input)?.toLowerCase();
  if (!text) return ok(null);
  if (/^(fresher|fresh|nil exp|no exp(erience)?|0)$/.test(text)) return ok(0);

  const range = new RegExp(`^${NUMBER}\\s*(?:-|to)\\s*${NUMBER}\\s*(y|yr|yrs|year|years)?\\b`).exec(text);
  if (range) {
    const low = Math.round(Number(range[1]) * 12);
    return flag(low, `${label} "${text}" is a range; used the lower end`);
  }

  const years = new RegExp(`${NUMBER}\\s*\\+?\\s*(?:y|yr|yrs|year|years)\\b`).exec(text);
  const months = new RegExp(`${NUMBER}\\s*(?:m|mo|mos|mon|month|months)\\b`).exec(text);
  if (years || months) {
    const total = Math.round((years ? Number(years[1]) * 12 : 0) + (months ? Number(months[1]) : 0));
    return total > 720 ? flag(null, `${label} "${text}" is too large`) : ok(total);
  }

  const bare = new RegExp(`^${NUMBER}\\s*\\+?$`).exec(text);
  if (bare) {
    const value = Number(bare[1]);
    return value > 60 ? flag(null, `${label} "${text}" is not a number of years`) : ok(Math.round(value * 12));
  }
  return flag(null, `${label} "${text}" could not be read`);
}

/**
 * Notice period in days. "15 Days" -> 15, "Immediate" -> 0, "1 month" -> 30, "2 months" -> 60, "1 week" -> 7,
 * bare number = days. A range "15-30 days" keeps the upper end (safer for a "notice under N days" filter) and is flagged.
 */
export function parseNoticeDays(input: unknown): Parsed<number> {
  if (typeof input === "number" && Number.isFinite(input)) {
    return input < 0 || input > 365 ? flag(null, `Notice period "${input}" is out of range`) : ok(Math.round(input));
  }
  const text = cleanText(input)?.toLowerCase();
  if (!text) return ok(null);
  if (/immediate|joining now|available now|^0\s*(days?)?$/.test(text)) return ok(0);
  if (/serving/.test(text)) {
    const days = /(\d+)\s*(?:d|day|days)\b/.exec(text);
    return flag(days ? Number(days[1]) : null, `Notice period "${text}": serving notice; check the date`);
  }

  const unitDays = (unit: string | undefined): number =>
    !unit ? 1 : /^w/.test(unit) ? 7 : /^m/.test(unit) ? 30 : 1;

  const range = new RegExp(`^${NUMBER}\\s*(?:-|to)\\s*${NUMBER}\\s*(d|day|days|w|wk|week|weeks|m|mon|month|months)?\\b`).exec(text);
  if (range) {
    const high = Math.round(Number(range[2]) * unitDays(range[3]));
    return flag(Math.min(high, 365), `Notice period "${text}" is a range; used the upper end`);
  }
  const single = new RegExp(`^${NUMBER}\\s*(d|day|days|w|wk|week|weeks|m|mon|month|months)?\\b`).exec(text);
  if (single) {
    const days = Math.round(Number(single[1]) * unitDays(single[2]));
    return days > 365 ? flag(null, `Notice period "${text}" is out of range`) : ok(days);
  }
  return flag(null, `Notice period "${text}" could not be read`);
}

/**
 * Rupees per month, in hand (owner 2026-11-02). "35K" / "35k" / "35 K" -> 35000, "35,000" -> 35000, "₹ 35000" -> 35000.
 * Lakh amounts ("3.5 L", "3.5 LPA", "4 lakh") are taken as PER YEAR and divided by 12 (flagged).
 * A bare small number ("35") is taken as thousands (flagged); a bare number of 2 lakh or more is taken as per year (flagged).
 */
export function parseRupeesMonthly(input: unknown, label = "Salary"): Parsed<number> {
  if (typeof input === "number" && Number.isFinite(input)) return interpretBareAmount(input, String(input), label);
  const raw = cleanText(input);
  if (!raw) return ok(null);
  const text = raw.toLowerCase().replace(/₹|rs\.?|inr|\/-|per month|p\.?m\.?|monthly|in ?hand/g, " ").replace(/,/g, "").trim();
  if (!text) return flag(null, `${label} "${raw}" could not be read`);

  const lakh = new RegExp(`^${NUMBER}\\s*(?:l|lac|lacs|lakh|lakhs|lpa)\\b`).exec(text);
  if (lakh) {
    return flag(Math.round((Number(lakh[1]) * 100_000) / 12), `${label} "${raw}" read as per year and divided by 12`);
  }
  const thousand = new RegExp(`^${NUMBER}\\s*k\\b`).exec(text);
  if (thousand) return ok(Math.round(Number(thousand[1]) * 1000));

  const bare = new RegExp(`^${NUMBER}$`).exec(text);
  if (bare) return interpretBareAmount(Number(bare[1]), raw, label);

  // "35K-40K": keep the first amount.
  const range = new RegExp(`^${NUMBER}\\s*(k)?\\s*(?:-|to)\\s*${NUMBER}\\s*(k)?$`).exec(text);
  if (range) {
    const first = Number(range[1]) * (range[2] || range[4] ? 1000 : 1);
    return flag(Math.round(first), `${label} "${raw}" is a range; used the first amount`);
  }
  return flag(null, `${label} "${raw}" could not be read`);
}

function interpretBareAmount(value: number, raw: string, label: string): Parsed<number> {
  if (value < 0) return flag(null, `${label} "${raw}" is negative`);
  if (value === 0) return ok(0);
  if (value < 1000) return flag(Math.round(value * 1000), `${label} "${raw}" read as thousands`);
  if (value >= 200_000) return flag(Math.round(value / 12), `${label} "${raw}" read as per year and divided by 12`);
  return ok(Math.round(value));
}

/**
 * A date as YYYY-MM-DD. Accepts JS Dates, Excel serial numbers, "30-06-2026" / "30/06/2026" / "30.06.2026" (day first,
 * as written in India), "2026-06-30" and "30 Jun 2026".
 */
export function parseDate(input: unknown): Parsed<string> {
  if (input instanceof Date) return isNaN(input.getTime()) ? flag(null, "Date could not be read") : ok(toIso(input));
  if (typeof input === "number" && Number.isFinite(input)) {
    if (input < 20_000 || input > 80_000) return flag(null, `Date "${input}" could not be read`);
    // Excel serial day 25569 = 1970-01-01
    return ok(toIso(new Date(Math.round((input - 25569) * 86_400_000))));
  }
  const text = cleanText(input);
  if (!text) return ok(null);

  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(text);
  if (m) return validDate(Number(m[1]), Number(m[2]), Number(m[3]), text);
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/.exec(text);
  if (m) {
    const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return validDate(year, Number(m[2]), Number(m[1]), text);
  }
  m = /^(\d{1,2})[\s-]+([a-z]{3,9})[\s-,]+(\d{4})$/i.exec(text);
  if (m) {
    const month = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase()) + 1;
    if (month > 0) return validDate(Number(m[3]), month, Number(m[1]), text);
  }
  return flag(null, `Date "${text}" could not be read`);
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

function validDate(year: number, month: number, day: number, text: string): Parsed<string> {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day || year < 1990 || year > 2100) {
    return flag(null, `Date "${text}" is not a real date`);
  }
  return ok(toIso(date));
}

function toIso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** The email as written (trimmed), and a lower-case key for de-duplication only when it is a valid address. */
export function parseEmail(input: unknown): Parsed<string> & { key: string | null } {
  const text = cleanText(input)?.replace(/\s/g, "") ?? null;
  if (!text) return { value: null, key: null };
  if (!EMAIL.test(text)) return { value: text, key: null, issue: `Email "${text}" is not a valid address` };
  return { value: text, key: text.toLowerCase() };
}

/**
 * The phone as written, and a key = the 10-digit Indian mobile (country code / leading 0 removed) for de-duplication.
 * Numbers that are not a 10-digit mobile starting 6-9 keep their text but get no key.
 */
export function parsePhone(input: unknown): Parsed<string> & { key: string | null } {
  const text = typeof input === "number" ? String(Math.round(input)) : cleanText(input);
  if (!text) return { value: null, key: null };
  let digits = text.replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  if (/^[6-9]\d{9}$/.test(digits)) return { value: text, key: digits };
  return { value: text, key: null, issue: `Phone "${text}" is not a 10-digit mobile number` };
}

/**
 * "MEP Engineer at Cushman & Wakefield" in the organisation column -> organisation "Cushman & Wakefield", and the
 * designation "MEP Engineer" if the designation column is empty. Flagged so HR can check the split.
 */
export function splitOrganization(
  organization: string | null,
  designation: string | null,
): { organization: string | null; designation: string | null; issue?: string } {
  if (!organization) return { organization, designation };
  const m = /^(.{2,60}?)\s+at\s+(.{2,})$/i.exec(organization);
  if (!m) return { organization, designation };
  return {
    organization: m[2].trim(),
    designation: designation ?? m[1].trim(),
    issue: `Organisation "${organization}" split into designation "${m[1].trim()}" and company "${m[2].trim()}"`,
  };
}

/** A status from the remark, so "Rejected cause budget issue" is filterable. The remark itself is kept as written. */
export function statusFromRemark(remark: string | null): RecordStatus {
  const text = (remark ?? "").toLowerCase();
  if (!text) return "new";
  if (/\bjoined\b/.test(text)) return "joined";
  if (/reject|not (fit|suitable|selected)|budget issue|declined/.test(text)) return "rejected";
  // "not res" also catches misspellings like "Not resposnding"
  if (/not\s*res|no response|not picking|not reachable|switched off|unreachable/.test(text)) return "not_responding";
  if (/shortlist|selected/.test(text)) return "shortlisted";
  if (/interview|scheduled/.test(text)) return "interview";
  if (/hold/.test(text)) return "on_hold";
  if (/in process|in-process|follow ?up|discussion|interested/.test(text)) return "in_process";
  return "new";
}

export function isRecordStatus(value: unknown): value is RecordStatus {
  return typeof value === "string" && (RECORD_STATUSES as readonly string[]).includes(value);
}

/** Lower-case file name without its extension: the "same sheet" test (owner 2026-11-02: same file name = same sheet). */
export function sheetNameKey(fileName: string): string {
  return fileName.trim().replace(/\.[^.]+$/, "").replace(/\s+/g, " ").toLowerCase();
}

/** "4 yrs 6 mo" for display and for the search text. */
export function formatMonths(months: number | null): string | null {
  if (months === null || months === undefined) return null;
  const years = Math.floor(months / 12);
  const rest = months % 12;
  if (!years) return `${rest} months`;
  return rest ? `${years} years ${rest} months` : `${years} years`;
}
