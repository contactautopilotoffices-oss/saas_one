/**
 * Read an uploaded .xlsx / .xls / .csv into cleaned candidate rows. No database access.
 * Columns are matched by name, loosely ("Total Exp(In)", "Total Experience" and "Exp" all mean total experience),
 * so a sheet with extra, missing or reordered columns still imports. Unknown columns are kept in `raw` for audit.
 */
import * as XLSX from "xlsx";

import { MAX_SHEET_ROWS } from "./config";
import {
  cleanText,
  FIXED_PREFIX,
  isFixedNote,
  parseDate,
  parseEmail,
  parseExpectedHike,
  parseExperienceMonths,
  parseNoticeDays,
  parsePhone,
  parseRupeesMonthly,
  splitOrganization,
  statusFromRemark,
  type Parsed,
} from "./normalize";
import type { RecordStatus } from "./types";

export type SheetField =
  | "fullName"
  | "email"
  | "phone"
  | "currentOrganization"
  | "currentDesignation"
  | "location"
  | "totalExp"
  | "role"
  | "candidateSource"
  | "sourcingDate"
  | "relevantExp"
  | "notice"
  | "currentInhand"
  | "expectedInhand"
  | "remark";

/** Header text -> lower-case letters and digits only. "Notice Period (In Days)" -> "noticeperiodindays". */
export function headerKey(header: unknown): string {
  return String(header ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Which field a header means, or null. Order matters: the more specific rules come first. */
export function fieldForHeader(header: unknown): SheetField | null {
  const k = headerKey(header);
  if (!k) return null;
  if (/^(srno|sno|slno|serialno|sr|no|index)$/.test(k)) return null;
  if (k.startsWith("relevant")) return "relevantExp";
  if (k.startsWith("totalexp") || k === "experience" || k === "exp" || k === "totalexperience") return "totalExp";
  if (k.startsWith("notice")) return "notice";
  if (k.startsWith("expected") && /inhand|salary|ctc|pay/.test(k)) return "expectedInhand";
  if (k.startsWith("current") && /inhand|salary|ctc|pay/.test(k)) return "currentInhand";
  if (/^(currentdesignation|designation|currentrole|currenttitle|jobtitle)$/.test(k)) return "currentDesignation";
  if (/^(currentorgani[sz]ation|organi[sz]ation|currentcompany|company|currentemployer|employer)$/.test(k)) {
    return "currentOrganization";
  }
  if (/^(candidatename|name|fullname|nameofcandidate)$/.test(k)) return "fullName";
  if (/^(emailid|email|mailid|emailaddress)$/.test(k)) return "email";
  if (/^(phonenumber|phone|phoneno|mobile|mobileno|mobilenumber|contactno|contactnumber|contact)$/.test(k)) return "phone";
  if (/^(location|currentlocation|city|currentcity)$/.test(k)) return "location";
  if (/^(role|position|appliedfor|roleappliedfor|jobrole|sourcedfor|requirement|profile)$/.test(k)) return "role";
  if (/^(candidatesource|source|sourcedby|sourcingpartner|vendor|agency)$/.test(k)) return "candidateSource";
  if (/^(sourcingdate|date|sourceddate|dateofsourcing)$/.test(k)) return "sourcingDate";
  if (/^(remark|remarks|comment|comments|feedback|status)$/.test(k)) return "remark";
  return null;
}

export interface CleanRow {
  fullName: string;
  email: string | null;
  emailKey: string | null;
  phone: string | null;
  phoneKey: string | null;
  currentOrganization: string | null;
  currentDesignation: string | null;
  location: string | null;
  totalExpMonths: number | null;
  role: string | null;
  candidateSource: string | null;
  sourcingDate: string | null;
  relevantExpMonths: number | null;
  noticePeriodDays: number | null;
  currentInhand: number | null;
  expectedInhand: number | null;
  remark: string | null;
  status: RecordStatus;
}

export interface SheetRow {
  /** Excel row number (1-based, as shown in Excel). */
  rowNumber: number;
  /** Every non-empty cell as text, keyed by its header, exactly as uploaded. */
  raw: Record<string, string>;
  /** null when the row was skipped. */
  clean: CleanRow | null;
  issues: string[];
}

export interface ParsedSheet {
  worksheet: string;
  rows: SheetRow[];
  /** Fields found in the header row. */
  fields: SheetField[];
  warnings: string[];
}

export class SheetError extends Error {
  readonly status = 422;
}

/**
 * Clean one row of cells (already keyed by field). Exported for tests.
 * `issues` holds both kinds: "needs review" problems as written, and automatic fixes prefixed with FIXED_PREFIX.
 * Cells that answer in words ("Negotiable") and extra phone numbers are appended to the remark, so HR still sees them.
 */
export function cleanRow(cells: Partial<Record<SheetField, unknown>>): { clean: CleanRow | null; issues: string[] } {
  const issues: string[] = [];
  const remarkExtras: string[] = [];
  const take = <T>(parsed: Parsed<T>, remarkLabel?: string): T | null => {
    if (parsed.issue) issues.push(parsed.issue);
    if (parsed.note) issues.push(FIXED_PREFIX + parsed.note);
    if (parsed.text && remarkLabel) remarkExtras.push(`${remarkLabel}: ${parsed.text}`);
    return parsed.value;
  };

  const fullName = cleanText(cells.fullName);
  if (!fullName) return { clean: null, issues: ["No candidate name; row skipped"] };

  const email = parseEmail(cells.email);
  take(email);
  const phone = parsePhone(cells.phone);
  take(phone);
  if (phone.extra?.length) remarkExtras.push(`Other phone: ${phone.extra.join(", ")}`);

  const split = splitOrganization(cleanText(cells.currentOrganization), cleanText(cells.currentDesignation));
  if (split.note) issues.push(FIXED_PREFIX + split.note);

  const totalExpMonths = take(parseExperienceMonths(cells.totalExp, "Total experience"));
  const relevantExpMonths = take(parseExperienceMonths(cells.relevantExp, "Relevant experience"));
  if (totalExpMonths !== null && relevantExpMonths !== null && relevantExpMonths > totalExpMonths) {
    issues.push("Relevant experience is more than total experience");
  }
  const sourcingDate = take(parseDate(cells.sourcingDate));
  const noticePeriodDays = take(parseNoticeDays(cells.notice, sourcingDate), "Notice period");
  const currentInhand = take(parseRupeesMonthly(cells.currentInhand, "Current in-hand"), "Current in-hand");
  const expectedInhand = take(
    parseExpectedHike(cells.expectedInhand, currentInhand) ?? parseRupeesMonthly(cells.expectedInhand, "Expected in-hand"),
    "Expected in-hand",
  );

  // The status comes from the remark as HR wrote it, before anything is appended.
  const writtenRemark = cleanText(cells.remark);
  const remark = [writtenRemark, ...remarkExtras].filter(Boolean).join(" | ") || null;

  return {
    issues,
    clean: {
      fullName,
      email: email.value,
      emailKey: email.key,
      phone: phone.value,
      phoneKey: phone.key,
      currentOrganization: split.organization,
      currentDesignation: split.designation,
      location: cleanText(cells.location),
      totalExpMonths,
      role: cleanText(cells.role),
      candidateSource: cleanText(cells.candidateSource),
      sourcingDate,
      relevantExpMonths,
      noticePeriodDays,
      currentInhand,
      expectedInhand,
      remark,
      status: statusFromRemark(writtenRemark),
    },
  };
}

/** A row counts as flagged when it was imported and has at least one "needs review" issue. */
export function needsReview(issues: string[]): boolean {
  return issues.some((issue) => !isFixedNote(issue));
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).trim();
}

/**
 * A header row: it names a candidate-name column and two more known columns. Shared by the sheet upload and the
 * connected trackers (trackers.ts), so both read a repeated header row the same way.
 */
export function isHeaderLine(line: unknown[] | undefined): boolean {
  const known = new Set((line ?? []).map(fieldForHeader).filter(Boolean));
  return known.has("fullName") && known.size >= 3;
}

/** Find the header row (the first of the top 15 rows that is a header row). */
function findHeader(grid: unknown[][]): number | null {
  for (let i = 0; i < Math.min(grid.length, 15); i += 1) {
    if (isHeaderLine(grid[i])) return i;
  }
  return null;
}

/** A header row's column names (blanks named by position) and fields; a field repeated in the row is used once. */
function columnsOf(line: unknown[], warnings: string[]): { headers: string[]; fields: (SheetField | null)[] } {
  const headers = line.map((h, i) => cellText(h) || `Column ${i + 1}`);
  const fields = line.map(fieldForHeader);
  const inRow = new Set<SheetField>();
  fields.forEach((field, i) => {
    if (!field) return;
    if (inRow.has(field)) {
      const warning = `Two columns look like "${headers[i]}"; only the first is used.`;
      if (!warnings.includes(warning)) warnings.push(warning);
      fields[i] = null;
    } else inRow.add(field);
  });
  return { headers, fields };
}

/** "561, 588, 1203 and 4 more" */
function rowList(rowNumbers: number[]): string {
  const shown = rowNumbers.slice(0, 5).join(", ");
  return rowNumbers.length > 5 ? `${shown} and ${rowNumbers.length - 5} more` : shown;
}

/** Parse a workbook. Uses the first worksheet that has a recognisable header row. */
export function parseSheet(data: Uint8Array, fileName: string): ParsedSheet {
  const isCsv = /\.csv$/i.test(fileName);
  let workbook: XLSX.WorkBook;
  try {
    // raw for CSV: keep "30-06-2026" as text instead of letting the reader guess a month-first date.
    workbook = XLSX.read(data, { type: "array", cellDates: false, raw: isCsv, dense: true });
  } catch {
    throw new SheetError("The file could not be read as a spreadsheet.");
  }

  const warnings: string[] = [];
  for (const name of workbook.SheetNames) {
    const grid = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[name], { header: 1, raw: true, defval: null, blankrows: true });
    const headerIndex = findHeader(grid);
    if (headerIndex === null) continue;

    if (workbook.SheetNames.length > 1) warnings.push(`Read the worksheet "${name}"; other worksheets were ignored.`);
    let { headers, fields } = columnsOf(grid[headerIndex] ?? [], warnings);
    const seen = new Set<SheetField>(fields.filter((f): f is SheetField => f !== null));

    // A tracker can repeat its header row further down, sometimes with columns added or moved (owner's Standard
    // Tracker, 2026-11-21). Such a row is not a candidate: the rows below it are read with its columns.
    const repeatedHeaders: number[] = [];
    const rows: SheetRow[] = [];
    for (let r = headerIndex + 1; r < grid.length; r += 1) {
      const line = grid[r] ?? [];
      if (line.every((cell) => cellText(cell) === "")) continue;
      if (isHeaderLine(line)) {
        ({ headers, fields } = columnsOf(line, warnings));
        for (const f of fields) if (f) seen.add(f);
        repeatedHeaders.push(r + 1);
        continue;
      }
      if (rows.length >= MAX_SHEET_ROWS) {
        throw new SheetError(`The sheet has more than ${MAX_SHEET_ROWS.toLocaleString("en-IN")} rows. Split it into smaller files.`);
      }
      const raw: Record<string, string> = {};
      const cells: Partial<Record<SheetField, unknown>> = {};
      line.forEach((cell, c) => {
        const text = cellText(cell);
        if (text) raw[headers[c] ?? `Column ${c + 1}`] = text;
        const field = fields[c];
        if (field) cells[field] = cell;
      });
      const { clean, issues } = cleanRow(cells);
      rows.push({ rowNumber: r + 1, raw, clean, issues });
    }
    if (!rows.length) throw new SheetError("The sheet has a header row but no candidate rows.");
    if (repeatedHeaders.length) {
      const many = repeatedHeaders.length > 1;
      warnings.push(`${many ? "Rows" : "Row"} ${rowList(repeatedHeaders)} ${many ? "repeat" : "repeats"} the column names; read as column names, not as candidates.`);
    }
    return { worksheet: name, rows, fields: [...seen], warnings };
  }
  throw new SheetError(
    'No header row found. The first rows must include a "Candidate Name" column and at least two others (e.g. Role, Location, Total Exp).',
  );
}
