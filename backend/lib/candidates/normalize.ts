/**
 * Turn messy spreadsheet cells into clean values. Pure functions (no I/O), unit-tested in tests/candidates.
 * Every parser returns { value, issue?, note?, text? }: value is null when the cell is empty or unreadable.
 *   issue : HR should look at it ("needs review"; counted as a flagged row).
 *   note  : a routine reading that was applied automatically ("fixed automatically"; shown, not counted).
 *   text  : the cell is an answer, not a number ("Negotiable"): the value stays empty and the text goes to the remark.
 * The row is imported either way; the original cell is kept in candidate_sheet_rows.
 */
import { RECORD_STATUSES, type RecordStatus } from "./types";

export interface Parsed<T> {
  value: T | null;
  issue?: string;
  note?: string;
  text?: string;
}

/**
 * Issues and notes share candidate_sheet_rows.issues; a note starts with this prefix. A "needs review" issue that HR
 * resolved (by hand or by approving an AI fix) is rewritten with the prefix too, so it stops counting as flagged.
 */
export const FIXED_PREFIX = "Fixed: ";
export const isFixedNote = (issue: string): boolean => issue.startsWith(FIXED_PREFIX);

// NoInfer: T comes from the caller's declared return type, so ok(null) / flag(null, ...) fit Parsed<number> too.
const ok = <T>(value: NoInfer<T> | null): Parsed<T> => ({ value });
const flag = <T>(value: NoInfer<T> | null, issue: string): Parsed<T> => ({ value, issue });
const fixed = <T>(value: NoInfer<T> | null, note: string): Parsed<T> => ({ value, note });
const answer = <T>(raw: string, label: string): Parsed<T> => ({ value: null, text: raw, note: `${label} "${raw}" is not an amount; kept in the remark` });

/** A cell that answers the question in words instead of a number ("Negotiable", "As per company norms"). */
const TEXT_ANSWER = /negotiable|\bnego\b|as per (company|co\.?|org(ani[sz]ation)?)?\s*(norms?|polic(y|ies)|standards?)|company (norms?|polic(y|ies))|best in (the )?industry|\bdiscuss|^open$/i;

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
    return fixed(low, `${label} "${text}" is a range; used the lower end`);
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

/** "immediate", also as typed in a hurry: "immedaite", "imidiate", "immediately". */
const IMMEDIATE = /\bim+e?d[ia]+t|\bim+id[ia]+t|joining now|available now|^0\s*(days?)?$/;
const MONTH_DAY = /(\d{1,2})(?:st|nd|rd|th)?[\s\-/.,]*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?(?:[\s,\-/.]+(\d{4}|\d{2})\b)?/;
const NUMERIC_DATE = /\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})\b/;
const DAY_MS = 86_400_000;

/**
 * A last working day written in the notice column ("21st july - lwd", "30th Jul LWD", "21/07/2026", or an Excel date
 * such as 46235) as days from `ref` (the sourcing date, else today). A date with no year takes ref's year, or the next
 * year when that would put it more than 2 months before ref.
 */
function noticeFromLastDay(input: unknown, raw: string, ref: string | null): Parsed<number> | null {
  const today = ref ?? new Date().toISOString().slice(0, 10);
  const refLabel = ref ? "the sourcing date" : "today";
  let iso: string | null = null;
  if (typeof input === "number") {
    iso = parseDate(input).value;
  } else {
    const text = raw.toLowerCase();
    const named = MONTH_DAY.exec(text);
    const numeric = NUMERIC_DATE.exec(text);
    if (named) {
      const month = MONTHS.indexOf(named[2]) + 1;
      const refYear = Number(today.slice(0, 4));
      let year = named[3] ? (named[3].length === 2 ? 2000 + Number(named[3]) : Number(named[3])) : refYear;
      let date = validDate(year, month, Number(named[1]), raw).value;
      if (date && !named[3] && Date.parse(date) < Date.parse(today) - 60 * DAY_MS) {
        year += 1;
        date = validDate(year, month, Number(named[1]), raw).value;
      }
      iso = date;
    } else if (numeric) {
      iso = parseDate(numeric[0]).value;
    }
  }
  if (!iso) return null;
  const days = Math.round((Date.parse(iso) - Date.parse(today)) / DAY_MS);
  if (days > 365) return flag(null, `Notice period "${raw}": last working day ${iso} is more than a year after ${refLabel}`);
  if (days < 0) return fixed(0, `Notice period "${raw}": last working day ${iso} is before ${refLabel}; read as immediate`);
  return fixed(days, `Notice period "${raw}" read as last working day ${iso}: ${days} days from ${refLabel}`);
}

/**
 * Notice period in days. "15 Days" -> 15, "Immediate" -> 0, "1 month" -> 30, "2 months" -> 60, "1 week" -> 7,
 * bare number = days. A range "15-30 days" keeps the upper end (safer for a "notice under N days" filter).
 * A last working day ("21st july - lwd", or an Excel date) is counted from `ref` (YYYY-MM-DD: the sourcing date).
 * "Negotiable" / "As per company norms" leave it empty and go to the remark.
 */
export function parseNoticeDays(input: unknown, ref: string | null = null): Parsed<number> {
  if (typeof input === "number" && Number.isFinite(input)) {
    // 20,000-80,000 is an Excel date (1954-2119), i.e. a last working day typed as a date.
    if (input >= 20_000 && input <= 80_000) return noticeFromLastDay(input, String(input), ref) ?? flag(null, `Notice period "${input}" is out of range`);
    return input < 0 || input > 365 ? flag(null, `Notice period "${input}" is out of range`) : ok(Math.round(input));
  }
  const raw = cleanText(input);
  const text = raw?.toLowerCase();
  if (!raw || !text) return ok(null);
  if (IMMEDIATE.test(text)) return ok(0);
  if (TEXT_ANSWER.test(text) || /^np\b/.test(text)) {
    return { value: null, text: raw, note: `Notice period "${raw}" is not a number of days; kept in the remark` };
  }
  const lastDay = noticeFromLastDay(input, raw, ref);
  if (lastDay) return lastDay;
  if (/serving/.test(text)) {
    const days = /(\d+)\s*(?:d|day|days)\b/.exec(text);
    return flag(days ? Number(days[1]) : null, `Notice period "${text}": serving notice; check the date`);
  }

  const unitDays = (unit: string | undefined): number =>
    !unit ? 1 : /^w/.test(unit) ? 7 : /^m/.test(unit) ? 30 : 1;

  const range = new RegExp(`^${NUMBER}\\s*(?:-|to)\\s*${NUMBER}\\s*(d|day|days|w|wk|week|weeks|m|mon|month|months)?\\b`).exec(text);
  if (range) {
    const high = Math.round(Number(range[2]) * unitDays(range[3]));
    return fixed(Math.min(high, 365), `Notice period "${text}" is a range; used the upper end`);
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
 * Lakh amounts ("3.5 L", "3.5 LPA", "4 lakh") are taken as PER YEAR and divided by 12 (fixed automatically; flagged
 * under 1.5 lakh, which may have meant per month). A bare number from 5 to 999 ("30 in hand") is thousands (fixed
 * automatically); under 5 ("3.5") it may be lakh per year, so it is flagged. 2 lakh or more is per year (fixed
 * automatically). "Negotiable" / "As per company norms" leave it empty and go to the remark.
 */
export function parseRupeesMonthly(input: unknown, label = "Salary"): Parsed<number> {
  if (typeof input === "number" && Number.isFinite(input)) return interpretBareAmount(input, String(input), label);
  const raw = cleanText(input);
  if (!raw) return ok(null);
  // Words with no amount at all ("Negotiable", or a remark typed in the wrong column).
  if (TEXT_ANSWER.test(raw) || !/\d/.test(raw)) return answer(raw, label);
  // "40 ctc": CTC is not in-hand. Read the amount, say so, and keep the original text in the remark.
  if (/\bctc\b/i.test(raw)) {
    const amount = parseRupeesMonthly(raw.replace(/\bctc\b/gi, " "), label);
    if (amount.value === null) return flag(null, `${label} "${raw}" could not be read`);
    return { value: amount.value, text: raw, note: `${label} "${raw}" is CTC, not in-hand; read as ₹${amount.value.toLocaleString("en-IN")} a month` };
  }
  const text = raw.toLowerCase().replace(/₹|rs\.?|inr|\/-|per month|p\.?m\.?|monthly|in ?hand|\+/g, " ").replace(/,/g, "").trim();
  if (!text) return flag(null, `${label} "${raw}" could not be read`);

  const lakh = new RegExp(`^${NUMBER}\\s*(?:l|lac|lacs|lakh|lakhs|lpa)\\b`).exec(text);
  if (lakh) {
    const monthly = Math.round((Number(lakh[1]) * 100_000) / 12);
    return Number(lakh[1]) < 1.5
      ? flag(monthly, `${label} "${raw}" read as per year and divided by 12; check it was not per month`)
      : fixed(monthly, `${label} "${raw}" read as per year and divided by 12`);
  }
  const thousand = new RegExp(`^${NUMBER}\\s*k\\b`).exec(text);
  if (thousand) return ok(Math.round(Number(thousand[1]) * 1000));

  const bare = new RegExp(`^${NUMBER}$`).exec(text);
  if (bare) return interpretBareAmount(Number(bare[1]), raw, label);

  // "35K-40K": keep the first amount.
  const range = new RegExp(`^${NUMBER}\\s*(k)?\\s*(?:-|to)\\s*${NUMBER}\\s*(k)?$`).exec(text);
  if (range) {
    const first = Number(range[1]) * (range[2] || range[4] ? 1000 : 1);
    return first >= 1000
      ? fixed(Math.round(first), `${label} "${raw}" is a range; used the first amount`)
      : flag(Math.round(first), `${label} "${raw}" is a range with no unit`);
  }
  return flag(null, `${label} "${raw}" could not be read`);
}

/**
 * An expected salary written as a hike over the current one: "30% Hike", "30%-40% Hike", "35%-40%". With the current
 * in-hand known, the expected is current + the lower percentage (fixed automatically); otherwise the text goes to the
 * remark. Returns null when the cell is not a hike.
 */
export function parseExpectedHike(input: unknown, currentInhand: number | null, label = "Expected in-hand"): Parsed<number> | null {
  const raw = cleanText(input);
  if (!raw) return null;
  const m = /^(\d{1,3}(?:\.\d+)?)\s*%?\s*(?:(?:-|to)\s*(\d{1,3}(?:\.\d+)?)\s*%?)?\s*(?:hike|increment|raise|increase|growth)?$/i.exec(raw);
  if (!m || !/%|hike|increment|raise|increase|growth/i.test(raw)) return null;
  const pct = Number(m[1]);
  if (pct <= 0 || pct > 300) return null;
  if (currentInhand === null || currentInhand <= 0) {
    return { value: null, text: raw, note: `${label} "${raw}" is a hike but the current in-hand is not known; kept in the remark` };
  }
  const value = Math.round(currentInhand * (1 + pct / 100));
  return {
    value,
    text: raw,
    note: `${label} "${raw}" read as ${pct}% over the current in-hand: ₹${value.toLocaleString("en-IN")} a month`,
  };
}

function interpretBareAmount(value: number, raw: string, label: string): Parsed<number> {
  if (value < 0) return flag(null, `${label} "${raw}" is negative`);
  if (value === 0) return ok(0);
  if (value < 5) return flag(Math.round(value * 1000), `${label} "${raw}" read as thousands; it may mean lakh per year`);
  if (value < 1000) return fixed(Math.round(value * 1000), `${label} "${raw}" read as thousands`);
  if (value >= 200_000) return fixed(Math.round(value / 12), `${label} "${raw}" read as per year and divided by 12`);
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

/** Typing slips that have one obvious repair: "a@@b.com", "a@b,com", "a@b..com", a trailing dot. */
function repairEmail(text: string): string {
  return text
    .replace(/@{2,}/g, "@")
    .replace(/,(com|in|co\.in|org|net)$/i, ".$1")
    .replace(/\.{2,}/g, ".")
    .replace(/\.+$/, "");
}

/**
 * The email as written (trimmed), and a lower-case key for de-duplication only when it is a valid address.
 * An obvious typing slip ("a@@gmail.com") is repaired when that makes it valid (fixed automatically).
 */
export function parseEmail(input: unknown): Parsed<string> & { key: string | null } {
  const text = cleanText(input)?.replace(/\s/g, "") ?? null;
  if (!text) return { value: null, key: null };
  if (EMAIL.test(text)) return { value: text, key: text.toLowerCase() };
  const repaired = repairEmail(text);
  if (repaired !== text && EMAIL.test(repaired)) {
    return { value: repaired, key: repaired.toLowerCase(), note: `Email "${text}" corrected to "${repaired}"` };
  }
  return { value: text, key: null, issue: `Email "${text}" is not a valid address` };
}

function mobileKey(text: string): string | null {
  let digits = text.replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  return /^[6-9]\d{9}$/.test(digits) ? digits : null;
}

/**
 * The phone as written, and a key = the 10-digit Indian mobile (country code / leading 0 removed) for de-duplication.
 * Numbers that are not a 10-digit mobile starting 6-9 keep their text but get no key.
 * Two numbers in one cell ("98xxxxxxxx / 97xxxxxxxx"): the first mobile is used and the others are returned in
 * `extra` for the remark (fixed automatically).
 */
export function parsePhone(input: unknown): Parsed<string> & { key: string | null; extra?: string[] } {
  const text = typeof input === "number" ? String(Math.round(input)) : cleanText(input);
  if (!text) return { value: null, key: null };
  const key = mobileKey(text);
  if (key) return { value: text, key };

  const parts = text.split(/\s*(?:[/,;|&]|\bor\b)\s*/i).map((p) => p.trim()).filter(Boolean);
  const mobiles = parts.map((p) => ({ text: p, key: mobileKey(p) }));
  const first = mobiles.find((m) => m.key);
  if (parts.length > 1 && first) {
    const extra = mobiles.filter((m) => m !== first).map((m) => m.text);
    return { value: first.text, key: first.key, extra, note: `Phone "${text}" has more than one number; used ${first.text}, the rest kept in the remark` };
  }
  return { value: text, key: null, issue: `Phone "${text}" is not a 10-digit mobile number` };
}

/**
 * "MEP Engineer at Cushman & Wakefield" in the organisation column -> organisation "Cushman & Wakefield", and the
 * designation "MEP Engineer" if the designation column is empty. Flagged so HR can check the split.
 */
export function splitOrganization(
  organization: string | null,
  designation: string | null,
): { organization: string | null; designation: string | null; note?: string } {
  if (!organization) return { organization, designation };
  const m = /^(.{2,60}?)\s+at\s+(.{2,})$/i.exec(organization);
  if (!m) return { organization, designation };
  const company = m[2].trim().replace(/[,.;]+$/, "");
  return {
    organization: company,
    designation: designation ?? m[1].trim(),
    note: `Organisation "${organization}" split into designation "${m[1].trim()}" and company "${company}"`,
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
