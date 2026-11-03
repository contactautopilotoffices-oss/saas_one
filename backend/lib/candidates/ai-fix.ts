/**
 * AI fix for flagged sheet rows (owner 2026-11-03). A workflow, not an agent: one structured model call per batch of
 * rows suggests corrected values; HR approves or rejects every change; only approved changes are saved, through the
 * same validation as a hand edit (records.updateRecord). Spec block: docs/features/candidate_search.md.
 *
 *   propose : rows' "needs review" issues + the cells as typed + the values saved now -> model (Control Center job
 *             'candidate_fix') -> each suggestion is converted to the record's units and re-validated in code; anything
 *             invalid, unchanged or outside the allowed fields is dropped. Logged in candidate_fix_logs.
 *   apply   : HR's approved changes per row -> updateRecord -> the row's issues are marked resolved
 *             (candidate_resolve_row_issues) and the sheet's flagged count is recounted. The log records what was accepted.
 *
 * The model never sees the candidate's name, and sees email / phone only for rows whose problem is about them.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { AI_FIX_CALL } from "./config";
import { jobCaller, type JsonCaller } from "./models";
import { isFixedNote, parseEmail, parsePhone } from "./normalize";
import { fieldForHeader } from "./parse-sheet";
import { CandidateActionError, getRecordRows, rpcFail, toRecord, updateRecord, validateInput } from "./records";
import { getSheet } from "./sheets";
import {
  AI_FIX_FIELDS,
  type AiFixApplyResponse,
  type AiFixApproval,
  type AiFixChange,
  type AiFixField,
  type AiFixProposal,
  type AiFixResponse,
  type CandidateRecord,
} from "./types";

const NUMERIC_FIELDS = new Set<AiFixField>(["totalExpMonths", "relevantExpMonths", "noticePeriodDays", "currentInhand", "expectedInhand"]);
const CONTACT_FIELDS = new Set<AiFixField>(["email", "phone"]);
const MAX_CHANGES_PER_ROW = 6;

export const AI_FIX_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    rows: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          changes: {
            type: "array",
            items: {
              type: "object",
              properties: {
                field: { type: "string", enum: [...AI_FIX_FIELDS] },
                value: { type: "string" },
                reason: { type: "string" },
              },
              required: ["field", "value", "reason"],
              additionalProperties: false,
            },
          },
          cannot_fix: { type: "array", items: { type: "string" } },
        },
        required: ["id", "changes", "cannot_fix"],
        additionalProperties: false,
      },
    },
  },
  required: ["rows"],
  additionalProperties: false,
};

const AiChange = z.object({ field: z.string(), value: z.union([z.string(), z.number()]).transform(String), reason: z.string().max(300).catch("") });
const AiRow = z.object({
  id: z.string(),
  changes: z.array(z.unknown()).catch([]),
  cannot_fix: z.array(z.string().max(300)).max(6).catch([]),
});
const AiReply = z.object({ rows: z.array(z.unknown()) });

export const AI_FIX_SYSTEM = `You fix data-entry problems in rows of a recruitment sourcing sheet from India. Each row was already imported, but some cells could not be read cleanly. You suggest corrected values; a recruiter approves or rejects every suggestion before anything is saved.

Fields and units (use exactly these):
- email, phone, currentOrganization, currentDesignation, location, role, candidateSource: text. phone = one 10-digit Indian mobile number.
- totalExpMonths, relevantExpMonths: whole MONTHS ("4 yrs" = "48", "6 months" = "6").
- noticePeriodDays: whole DAYS ("1 month" = "30", immediate = "0").
- currentInhand, expectedInhand: whole RUPEES PER MONTH in hand ("35K" = "35000"; lakh / LPA amounts are per year: "4 LPA" = "33333").
- sourcingDate: YYYY-MM-DD.
- To clear a value that is clearly wrong, use "" (empty string).

Follow these steps in order for EVERY row. Do not skip any row or step.
1. Read the row's "Needs review" problems, its cells as typed in the sheet, and the values saved now.
2. For each problem, decide whether the row's own cells show the right value. Typical causes: a value typed in the wrong column (the columns shifted), an ambiguous unit, a typo, total and relevant experience swapped.
3. If the cells clearly show the right value, add a change: the field, the corrected value in the units above, and a reason of at most 15 words that quotes the cell you used.
4. If they do not, do NOT guess: add the problem to cannot_fix in a few words saying what the recruiter must check (e.g. "Relevant experience says 'yes'; ask the candidate").
5. Never change a field that is not part of a listed problem. Never invent a number, company, email or phone that is not in the cells. Never change the candidate's name.
Use the row ids exactly as given.

Reply with JSON only: {"rows": [{"id": "r1", "changes": [{"field": "...", "value": "...", "reason": "..."}], "cannot_fix": []}, ...]} with one entry per row.

Example row:
r1
Needs review: Relevant experience "35 k" could not be read; Current in-hand "4 Yrs" could not be read
Cells: Total Exp(In): 4 Yrs | Relevant Exp: 35 k | Current In Hand: 4 Yrs | Expected Inhand: 38K
Saved now: totalExpMonths: 48 | relevantExpMonths: (empty) | currentInhand: (empty) | expectedInhand: 38000
Example entry: {"id": "r1", "changes": [{"field": "relevantExpMonths", "value": "48", "reason": "\\"4 Yrs\\" sits under Current In Hand; the columns shifted"}, {"field": "currentInhand", "value": "35000", "reason": "\\"35 k\\" under Relevant Exp is the in-hand salary"}], "cannot_fix": []}`;

interface FixRow {
  rowNumber: number;
  applicationId: string;
  issues: string[];
  raw: Record<string, string>;
  record: CandidateRecord;
}

function shown(value: string | number | null): string {
  return value === null || value === "" ? "(empty)" : String(value);
}

/** One row as the model sees it: no name; email / phone only when a problem is about them. */
export function fixRowPrompt(id: string, row: FixRow): string {
  const contactIssue = row.issues.some((issue) => /^(email|phone)/i.test(issue));
  const cells = Object.entries(row.raw)
    .filter(([header]) => {
      const field = fieldForHeader(header);
      if (field === "fullName") return false;
      if ((field === "email" || field === "phone") && !contactIssue) return false;
      return !/^(srno|sno|slno|serialno)$/.test(header.toLowerCase().replace(/[^a-z0-9]/g, ""));
    })
    .map(([header, value]) => `${header}: ${value}`);
  const saved = AI_FIX_FIELDS.filter((field) => contactIssue || !CONTACT_FIELDS.has(field)).map(
    (field) => `${field}: ${shown(row.record[field] as string | number | null)}`,
  );
  return `${id}\nNeeds review: ${row.issues.join("; ")}\nCells: ${cells.join(" | ")}\nSaved now: ${saved.join(" | ")}`;
}

/** A suggested value in the record's units, or undefined when it is not usable. */
export function convertValue(field: AiFixField, value: string): string | number | null | undefined {
  const text = value.trim();
  if (!text || /^(null|none|n\/a)$/i.test(text)) return null;
  if (NUMERIC_FIELDS.has(field)) {
    const n = Number(text.replace(/[₹,\s]/g, ""));
    return Number.isFinite(n) && n >= 0 ? Math.round(n) : undefined;
  }
  if (field === "sourcingDate") return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : undefined;
  if (field === "email") return parseEmail(text).key ? text : undefined;
  if (field === "phone") return parsePhone(text).key && !parsePhone(text).extra ? text : undefined;
  return text;
}

/** Validate one suggested change the way a hand edit is validated. Returns the change, or null to drop it. */
export function checkChange(raw: unknown, record: CandidateRecord): AiFixChange | null {
  const parsed = AiChange.safeParse(raw);
  if (!parsed.success) return null;
  const field = parsed.data.field as AiFixField;
  if (!(AI_FIX_FIELDS as readonly string[]).includes(field)) return null;
  const proposed = convertValue(field, parsed.data.value);
  if (proposed === undefined) return null;
  try {
    validateInput({ [field]: proposed }, true);
  } catch {
    return null;
  }
  const current = (record[field] as string | number | null) ?? null;
  if (String(current ?? "") === String(proposed ?? "")) return null;
  return { field, current, proposed, reason: parsed.data.reason.trim() || "Suggested from the row's cells" };
}

export function parseFixReply(text: string, ids: Map<string, FixRow>): Map<string, { changes: AiFixChange[]; cannotFix: string[] }> {
  const out = new Map<string, { changes: AiFixChange[]; cannotFix: string[] }>();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return out;
  try {
    const reply = AiReply.safeParse(JSON.parse(text.slice(start, end + 1)));
    if (!reply.success) return out;
    for (const rawRow of reply.data.rows) {
      const item = AiRow.safeParse(rawRow);
      if (!item.success) continue;
      const row = ids.get(item.data.id);
      if (!row || out.has(item.data.id)) continue;
      const changes: AiFixChange[] = [];
      for (const rawChange of item.data.changes) {
        const change = checkChange(rawChange, row.record);
        if (change && !changes.some((c) => c.field === change.field)) changes.push(change);
        if (changes.length >= MAX_CHANGES_PER_ROW) break;
      }
      out.set(item.data.id, { changes, cannotFix: item.data.cannot_fix.map((s) => s.trim()).filter(Boolean) });
    }
  } catch {
    /* empty map = AI unavailable */
  }
  return out;
}

/** The sheet's latest-upload rows asked for, with their record; rows that cannot be fixed here are returned apart. */
async function loadFixRows(
  client: SupabaseClient,
  orgId: string,
  sheetId: string,
  rowNumbers: number[],
): Promise<{ rows: FixRow[]; notFixable: number[]; uploadNo: number }> {
  const sheet = await getSheet(client, orgId, sheetId);
  if (sheet.deleted_at) throw new CandidateActionError(409, "This sheet is deleted. Restore it first.");
  const { data, error } = await client
    .from("candidate_sheet_rows")
    .select("row_number, issues, raw, skipped, application_id")
    .eq("sheet_id", sheet.id)
    .eq("upload_no", sheet.upload_count)
    .in("row_number", rowNumbers);
  if (error) {
    console.error("[candidates] ai-fix: load rows", error);
    throw new CandidateActionError(500, "Couldn't load the rows. Please try again.");
  }
  const sheetRows = (data ?? []) as { row_number: number; issues: string[]; raw: Record<string, string>; skipped: boolean; application_id: string | null }[];
  const records = new Map(
    (await getRecordRows(client, orgId, sheetRows.map((r) => r.application_id).filter((id): id is string => Boolean(id))))
      .filter((r) => !r.deleted_at && r.sheet_live)
      .map((r) => [r.id, toRecord(r)]),
  );

  const rows: FixRow[] = [];
  const found = new Set<number>();
  for (const r of sheetRows) {
    found.add(r.row_number);
    const issues = r.issues.filter((issue) => !isFixedNote(issue));
    const record = r.application_id ? records.get(r.application_id) : undefined;
    if (r.skipped || !record || !issues.length) continue;
    rows.push({ rowNumber: r.row_number, applicationId: record.id, issues, raw: r.raw, record });
  }
  const fixable = new Set(rows.map((r) => r.rowNumber));
  const notFixable = rowNumbers.filter((n) => !fixable.has(n) || !found.has(n));
  return { rows: rows.sort((a, b) => a.rowNumber - b.rowNumber), notFixable, uploadNo: sheet.upload_count };
}

/** Ask the model for fixes for these rows (at most AI_FIX_BATCH; the route checks). Nothing is saved here. */
export async function proposeFixes(
  client: SupabaseClient,
  args: { orgId: string; userId: string; sheetId: string; rowNumbers: number[]; today: string },
  caller: JsonCaller = jobCaller("candidate_fix"),
): Promise<AiFixResponse> {
  const { rows, notFixable } = await loadFixRows(client, args.orgId, args.sheetId, args.rowNumbers);
  if (!rows.length) return { proposals: [], logId: null, model: null, notFixable };

  const ids = new Map(rows.map((row, i) => [`r${i + 1}`, row]));
  const enough = Math.ceil(rows.length * 0.8);
  const started = Date.now();
  let answer = new Map<string, { changes: AiFixChange[]; cannotFix: string[] }>();
  let model: string | null = null;
  let failure: string | null = null;
  try {
    const reply = await caller({
      label: "candidate-search:ai-fix",
      system: AI_FIX_SYSTEM,
      user: `Today: ${args.today}\n\nRows (${rows.length}):\n\n${[...ids].map(([id, row]) => fixRowPrompt(id, row)).join("\n\n")}`,
      schema: AI_FIX_JSON_SCHEMA,
      ...AI_FIX_CALL,
      accept: (text) => parseFixReply(text, ids).size >= enough,
    });
    answer = parseFixReply(reply.text, ids);
    model = reply.model;
  } catch (error) {
    failure = error instanceof Error ? error.message.slice(0, 500) : String(error);
    console.warn("[candidates] ai-fix failed", failure);
  }

  const proposals: AiFixProposal[] = [...ids].map(([id, row]) => {
    const got = answer.get(id);
    return {
      rowNumber: row.rowNumber,
      applicationId: row.applicationId,
      fullName: row.record.fullName,
      issues: row.issues,
      changes: got?.changes ?? [],
      cannotFix: got ? got.cannotFix : ["The AI did not answer for this row"],
    };
  });

  const { data: log, error: logError } = await client
    .from("candidate_fix_logs")
    .insert({
      organization_id: args.orgId,
      sheet_id: args.sheetId,
      user_id: args.userId,
      row_numbers: rows.map((r) => r.rowNumber),
      model,
      proposed_count: proposals.reduce((n, p) => n + p.changes.length, 0),
      cannot_fix_count: proposals.reduce((n, p) => n + p.cannotFix.length, 0),
      answered_rows: answer.size,
      proposals: { rows: proposals },
      fix_ms: Date.now() - started,
      error: failure,
    })
    .select("id")
    .single();
  if (logError) rpcFail("save the AI fix log", logError);

  if (failure) throw new CandidateActionError(503, "The AI fix could not answer right now. Please try again in a minute.");
  return { proposals, logId: (log?.id as string | undefined) ?? null, model, notFixable };
}

/**
 * Save HR's approved changes. A row with changes is saved like a hand edit and its issues are marked
 * "AI fix approved by HR"; a row with no changes is marked "reviewed by HR". Rows that fail validation are reported.
 */
export async function applyFixes(
  client: SupabaseClient,
  args: { orgId: string; userId: string; sheetId: string; logId: string | null; approvals: AiFixApproval[] },
): Promise<AiFixApplyResponse> {
  const { rows } = await loadFixRows(client, args.orgId, args.sheetId, args.approvals.map((a) => a.rowNumber));
  const byRow = new Map(rows.map((r) => [r.rowNumber, r]));
  const fixedRows: number[] = [];
  const reviewedRows: number[] = [];
  const failed: AiFixApplyResponse["failed"] = [];
  let accepted = 0;

  for (const approval of args.approvals) {
    const row = byRow.get(approval.rowNumber);
    if (!row) {
      failed.push({ rowNumber: approval.rowNumber, error: "This row has no open issues or its record was deleted." });
      continue;
    }
    const keys = Object.keys(approval.changes ?? {});
    if (keys.some((k) => !(AI_FIX_FIELDS as readonly string[]).includes(k))) {
      failed.push({ rowNumber: approval.rowNumber, error: "Only the suggested fields can be changed here." });
      continue;
    }
    try {
      if (keys.length) {
        await updateRecord(client, args.orgId, args.userId, row.applicationId, approval.changes);
        accepted += keys.length;
        fixedRows.push(row.rowNumber);
      } else reviewedRows.push(row.rowNumber);
    } catch (error) {
      failed.push({ rowNumber: row.rowNumber, error: error instanceof CandidateActionError ? error.message : "Couldn't save this row." });
    }
  }

  let flaggedCount: number | null = null;
  for (const [list, note] of [
    [fixedRows, "AI fix approved by HR"],
    [reviewedRows, "reviewed by HR"],
  ] as const) {
    if (!list.length) continue;
    const { data, error } = await client.rpc("candidate_resolve_row_issues", { p_sheet_id: args.sheetId, p_row_numbers: list, p_note: note });
    if (error) rpcFail("mark the rows as fixed", error);
    flaggedCount = Number(data);
  }
  if (flaggedCount === null) flaggedCount = (await getSheet(client, args.orgId, args.sheetId)).flagged_count;

  if (args.logId) {
    const { data: log } = await client
      .from("candidate_fix_logs")
      .select("proposed_count")
      .eq("id", args.logId)
      .eq("organization_id", args.orgId)
      .maybeSingle();
    if (log) {
      const { error } = await client
        .from("candidate_fix_logs")
        .update({ accepted_count: accepted, rejected_count: Math.max(0, Number(log.proposed_count) - accepted), applied_at: new Date().toISOString() })
        .eq("id", args.logId)
        .eq("organization_id", args.orgId);
      if (error) console.warn("[candidates] ai-fix: could not update the log", error);
    }
  }

  return { applied: fixedRows.length + reviewedRows.length, failed, flaggedCount };
}
