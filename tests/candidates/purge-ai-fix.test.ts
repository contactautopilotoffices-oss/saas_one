/**
 * Owner 2026-11-03: permanent delete (sheet / records), "Clear all candidate data", bulk delete, and the AI fix for
 * flagged rows, run against the real migrations in PGlite. The model is a scripted stub.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import type { PGlite } from "@electric-sql/pglite";
import type { SupabaseClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";

import { AI_FIX_JSON_SCHEMA, applyFixes, convertValue, discardRows, fixRowPrompt, proposeFixes } from "../../backend/lib/candidates/ai-fix";
import { findLiveSheetByName, importSheet } from "../../backend/lib/candidates/import";
import type { JsonCaller, JsonRequest } from "../../backend/lib/candidates/models";
import { parseSheet } from "../../backend/lib/candidates/parse-sheet";
import { createRecord, deleteRecords, listRecords, matchingRecordIds, purgeRecords } from "../../backend/lib/candidates/records";
import { clearAllCandidateData, listSheets, purgeSheet, sheetIssues } from "../../backend/lib/candidates/sheets";
import { AI_FIX_FIELDS } from "../../backend/lib/candidates/types";
import { AI_JOBS } from "../../task-manager/ai/aiCatalog";

import { freshDb } from "./db-stub";
import { pgliteSupabase } from "./pglite-supabase";

const ORG = "00000000-0000-0000-0000-00000000000a";
const OTHER_ORG = "00000000-0000-0000-0000-00000000000b";
const USER = "00000000-0000-0000-0000-000000000001";

const HEADERS = ["Sourcing Date", "Candidate Name", "Email ID", "Phone Number", "Current Organization", "Location",
  "Current Designation", "Role", "Total Exp(In)", "Relevant Exp", "Notice Period (In Days)", "Current In Hand", "Expected Inhand", "Remark"];
const AMIT = ["30-06-2026", "Amit Babu", "amit@x.com", 7534855802, "JLL", "Noida", "MEP Engineer", "BMS Operator", "4 Yrs", "4 Yrs", "15 Days", "35K", "37K", ""];
const CHITER = ["30-06-2026", "Chiter Sain Singh", "chiter@x.com", 9599358284, "BuildMyInfra", "Noida", "BMS Operator", "BMS Operator", "5 Yrs", "5 Yrs", "30 Days", "25k", "30k", ""];
const RAVI = ["01-07-2026", "Ravi Kumar", "ravi@x.com", 9811111111, "JLL", "Navi Mumbai", "BMS Operator", "BMS Operator", "6 Yrs", "6 Yrs", "Immediate", "40K", "45K", ""];
// Needs review: relevant experience "yes" (row 2), and an in-hand salary typed under Relevant Exp with the columns shifted (row 3).
const YES = ["02-07-2026", "Sachin Patil", "sachin@x.com", 9822222222, "CBRE", "Mumbai", "Supervisor", "HK Supervisor", "5 Yrs", "yes", "30 Days", "28K", "32K", ""];
const SHIFTED = ["02-07-2026", "Noor Khan", "noor@x.com", 9833333333, "Sodexo", "Bangalore", "Technician", "Sr. Technical Executive", "4 Yrs", "35 k", "15 Days", "4 Yrs", "38K", ""];

function file(rows: unknown[][]): Uint8Array {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([HEADERS, ...rows]), "Sheet1");
  return new Uint8Array(XLSX.write(workbook, { type: "array", bookType: "xlsx" }) as ArrayBuffer);
}

describe("permanent delete, clear all, bulk delete, AI fix", () => {
  let db: PGlite;
  let client: SupabaseClient;
  const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;
  const count = async (table: string, org = ORG) =>
    (await q<{ n: number }>(`select count(*)::int as n from public.${table} where organization_id = $1`, [org]))[0].n;

  async function upload(name: string, rows: unknown[][], org = ORG) {
    const parsed = parseSheet(file(rows), name);
    const existing = await findLiveSheetByName(client, org, name);
    return importSheet(client, { orgId: org, userId: USER, userEmail: "hr@x.com", fileName: name, parsed, mode: "new", existing });
  }

  before(async () => {
    db = await freshDb();
    await q("insert into public.organizations (id) values ($1), ($2)", [ORG, OTHER_ORG]);
    await q("insert into auth.users (id) values ($1)", [USER]);
    client = pgliteSupabase(db);
  });
  after(async () => {
    await db.close();
  });

  it("deletes a sheet permanently: its records and rows go, people with another record stay", async () => {
    const a = await upload("A.xlsx", [AMIT, CHITER]);
    await upload("B.xlsx", [CHITER]);
    assert.equal(await count("candidates"), 2);

    const result = await purgeSheet(client, ORG, a.sheetId);
    assert.deepEqual(result, { sheets: 1, records: 2, people: 1 });
    assert.equal((await q("select 1 from public.candidate_sheets where id = $1", [a.sheetId])).length, 0);
    assert.equal((await q("select 1 from public.candidate_sheet_rows where sheet_id = $1", [a.sheetId])).length, 0);
    const people = await q<{ full_name: string }>("select full_name from public.candidates where organization_id = $1", [ORG]);
    assert.deepEqual(people.map((p) => p.full_name), ["Chiter Sain Singh"], "Amit had no other record; Chiter is in B");
  });

  it("refuses to delete a sheet that is still importing", async () => {
    const [b] = (await listSheets(client, ORG, false)).sheets;
    await q("update public.candidate_sheets set status = 'importing' where id = $1", [b.id]);
    await assert.rejects(purgeSheet(client, ORG, b.id), /still importing/);
    await q("update public.candidate_sheets set status = 'ready' where id = $1", [b.id]);
  });

  it("moves selected or all matching records to deleted, and purges only deleted records", async () => {
    await upload("C.xlsx", [AMIT, RAVI]);
    const ravi = await matchingRecordIds(client, ORG, { q: "ravi" }, 100);
    assert.equal(ravi.length, 1);

    assert.equal(await purgeRecords(client, ORG, ravi).then((r) => r.records), 0, "a live record is not purged");
    assert.equal(await deleteRecords(client, ORG, USER, ravi), 1);
    assert.equal(await deleteRecords(client, ORG, USER, ravi), 0, "already deleted");

    const all = await matchingRecordIds(client, ORG, {}, 100);
    assert.equal(all.length, (await listRecords(client, ORG, { pageSize: 100 })).total);
    assert.equal(await deleteRecords(client, ORG, USER, all), all.length);
    assert.equal((await listRecords(client, ORG, {})).total, 0);

    const purged = await purgeRecords(client, ORG, ravi);
    assert.deepEqual(purged, { records: 1, people: 1 });
    assert.equal((await q("select 1 from public.candidates where full_name = 'Ravi Kumar'")).length, 0);
  });

  it("lists the model job and keeps the JSON schema's fields in step with the allowed fields", () => {
    const job = AI_JOBS.find((j) => j.key === "candidate_fix");
    assert.ok(job);
    assert.equal(job.group, "Candidate Search");
    assert.equal(job.defaults[0], "anthropic:claude-haiku-5-5");
    const items = (AI_FIX_JSON_SCHEMA.properties as { rows: { items: { properties: { changes: { items: { properties: { field: { enum: string[] } } } } } } } })
      .rows.items.properties.changes.items.properties.field.enum;
    assert.deepEqual(items, [...AI_FIX_FIELDS]);
  });

  it("converts suggested values to the record's units and rejects unusable ones", () => {
    assert.equal(convertValue("relevantExpMonths", "48"), 48);
    assert.equal(convertValue("currentInhand", "₹35,000"), 35000);
    assert.equal(convertValue("currentInhand", "abc"), undefined);
    assert.equal(convertValue("noticePeriodDays", ""), null);
    assert.equal(convertValue("sourcingDate", "2026-07-02"), "2026-07-02");
    assert.equal(convertValue("sourcingDate", "02-07-2026"), undefined);
    assert.equal(convertValue("email", "a@@b.com"), "a@@b.com", "repairable: the record's own validation fixes it");
    assert.equal(convertValue("email", "nope"), undefined);
    assert.equal(convertValue("phone", "12345"), undefined);
  });

  let fixSheet: string;

  it("suggests fixes without saving anything, drops invalid suggestions, and logs the call", async () => {
    const d = await upload("D.xlsx", [YES, SHIFTED]);
    fixSheet = d.sheetId;
    assert.equal(d.rowsFlagged, 2);

    const seen: JsonRequest[] = [];
    const caller: JsonCaller = async (req) => {
      seen.push(req);
      return {
        model: "anthropic:claude-haiku-5-5",
        text: JSON.stringify({
          rows: [
            { id: "r1", changes: [{ field: "fullName", value: "X", reason: "not allowed" }], cannot_fix: ["Relevant experience says 'yes'; ask the candidate"] },
            {
              id: "r2",
              changes: [
                { field: "relevantExpMonths", value: "48", reason: "\"4 Yrs\" sits under Current In Hand" },
                { field: "currentInhand", value: "35000", reason: "\"35 k\" under Relevant Exp" },
                { field: "expectedInhand", value: "38000", reason: "same as now: dropped" },
                { field: "noticePeriodDays", value: "999", reason: "out of range: dropped" },
              ],
              cannot_fix: [],
            },
            { id: "r9", changes: [{ field: "location", value: "Pune", reason: "unknown row: dropped" }], cannot_fix: [] },
          ],
        }),
      };
    };
    const res = await proposeFixes(client, { orgId: ORG, userId: USER, sheetId: fixSheet, rowNumbers: [2, 3, 99], today: "2026-11-03" }, caller);

    assert.deepEqual(res.notFixable, [99]);
    assert.equal(res.model, "anthropic:claude-haiku-5-5");
    const [yes, shifted] = res.proposals;
    assert.equal(yes.rowNumber, 2);
    assert.deepEqual(yes.changes, []);
    assert.equal(yes.cannotFix.length, 1);
    assert.deepEqual(shifted.changes.map((c) => [c.field, c.current, c.proposed]), [["relevantExpMonths", null, 48], ["currentInhand", null, 35000]]);

    // The model never sees the name, and sees email / phone only when the problem is about them.
    assert.equal(seen.length, 1);
    assert.doesNotMatch(seen[0].user, /Sachin|Noor|@x\.com|98222/);
    assert.match(seen[0].user, /Relevant Exp: yes/);

    const [log] = await q<{ proposed_count: number; cannot_fix_count: number; answered_rows: number; accepted_count: number | null }>(
      "select proposed_count, cannot_fix_count, answered_rows, accepted_count from public.candidate_fix_logs where id = $1",
      [res.logId],
    );
    assert.deepEqual(log, { proposed_count: 2, cannot_fix_count: 1, answered_rows: 2, accepted_count: null });

    const noor = (await listRecords(client, ORG, { q: "noor" })).records[0];
    assert.equal(noor.relevantExpMonths, null, "nothing saved before HR approves");

    // Apply only the relevant-experience change for row 3; mark row 2 as reviewed with no change.
    const applied = await applyFixes(client, {
      orgId: ORG,
      userId: USER,
      sheetId: fixSheet,
      logId: res.logId,
      approvals: [
        { rowNumber: 3, changes: { relevantExpMonths: 48 } },
        { rowNumber: 2, changes: {} },
      ],
    });
    assert.deepEqual(applied, { applied: 2, failed: [], flaggedCount: 0 });
    const after = (await listRecords(client, ORG, { q: "noor" })).records[0];
    assert.equal(after.relevantExpMonths, 48);
    assert.equal(after.currentInhand, null, "the unticked change was not saved");

    const issues = await sheetIssues(client, ORG, fixSheet);
    const row3 = issues.find((i) => i.rowNumber === 3)!;
    assert.deepEqual(row3.issues, []);
    assert.ok(row3.fixed.every((f) => /\(AI fix approved by HR\)$/.test(f)));
    assert.ok(issues.find((i) => i.rowNumber === 2)!.fixed.some((f) => /\(reviewed by HR\)$/.test(f)));
    const [sheet] = (await listSheets(client, ORG, false)).sheets.filter((s) => s.id === fixSheet);
    assert.equal(sheet.flaggedCount, 0);

    const [logAfter] = await q<{ accepted_count: number; rejected_count: number }>(
      "select accepted_count, rejected_count from public.candidate_fix_logs where id = $1",
      [res.logId],
    );
    assert.deepEqual(logAfter, { accepted_count: 1, rejected_count: 1 });
  });

  it("will not apply to a resolved row, or change a field outside the allowed list", async () => {
    const again = await applyFixes(client, { orgId: ORG, userId: USER, sheetId: fixSheet, logId: null, approvals: [{ rowNumber: 3, changes: { location: "Pune" } }] });
    assert.equal(again.applied, 0);
    assert.match(again.failed[0].error, /no open issues/);
  });

  it("fails clearly when the model does not answer, and still logs the attempt", async () => {
    const e = await upload("E.xlsx", [YES]);
    const failing: JsonCaller = async () => {
      throw new Error("candidate-search:ai-fix: no model answered");
    };
    await assert.rejects(proposeFixes(client, { orgId: ORG, userId: USER, sheetId: e.sheetId, rowNumbers: [2], today: "2026-11-03" }, failing), /could not answer/);
    const [log] = await q<{ error: string }>("select error from public.candidate_fix_logs where sheet_id = $1", [e.sheetId]);
    assert.match(log.error, /no model answered/);
  });

  // Owner 2026-11-12: "mass discard means deleting those rows which the AI could not fix".
  it("deletes flagged rows from View issues: the records move to deleted and the rows leave Needs review", async () => {
    const f = await upload("F.xlsx", [YES, SHIFTED]);
    assert.equal(f.rowsFlagged, 2);
    const live = async () => (await listRecords(client, ORG, { sheetId: f.sheetId, pageSize: 100 })).total;
    const flagged = async () => (await listSheets(client, ORG, false)).sheets.find((s) => s.id === f.sheetId)!.flaggedCount;
    assert.equal(await live(), 2);

    const first = await discardRows(client, { orgId: ORG, userId: USER, sheetId: f.sheetId, rowNumbers: [2, 99] });
    assert.deepEqual(first, { deleted: 1, closed: 1, flaggedCount: 1 }, "row 99 does not exist and is ignored");
    assert.equal(await live(), 1);
    assert.equal(await flagged(), 1);
    const rows = await sheetIssues(client, ORG, f.sheetId);
    const row2 = rows.find((r) => r.rowNumber === 2)!;
    assert.deepEqual(row2.issues, [], "nothing left to review on the deleted row");
    assert.ok(row2.fixed.every((note) => /\(record deleted by HR\)$/.test(note)));
    assert.ok(rows.find((r) => r.rowNumber === 3)!.issues.length > 0, "the other row is untouched");
    const [gone] = await q<{ deleted_by: string | null; n: number }>(
      "select max(deleted_by::text) as deleted_by, count(*)::int as n from public.candidate_applications where sheet_id = $1 and deleted_at is not null", [f.sheetId],
    );
    assert.deepEqual(gone, { deleted_by: USER, n: 1 }, "moved to deleted (restorable), not erased");

    // Again on the same row: nothing more to do.
    assert.deepEqual(await discardRows(client, { orgId: ORG, userId: USER, sheetId: f.sheetId, rowNumbers: [2] }), { deleted: 0, closed: 0, flaggedCount: 1 });

    // A row whose record was deleted in the Candidates tab is closed too, so it does not stay stuck in Needs review.
    const [left] = (await listRecords(client, ORG, { sheetId: f.sheetId, pageSize: 100 })).records;
    await deleteRecords(client, ORG, USER, [left.id]);
    assert.deepEqual(await discardRows(client, { orgId: ORG, userId: USER, sheetId: f.sheetId, rowNumbers: [3] }), { deleted: 0, closed: 1, flaggedCount: 0 });
  });

  it("deletes rows only in the caller's organisation", async () => {
    const g = await upload("G.xlsx", [YES]);
    await assert.rejects(discardRows(client, { orgId: OTHER_ORG, userId: USER, sheetId: g.sheetId, rowNumbers: [2] }));
    assert.equal((await listRecords(client, ORG, { sheetId: g.sheetId, pageSize: 100 })).total, 1);
  });

  it("shows email and phone to the model only when a problem is about them", async () => {
    const record = (await listRecords(client, ORG, { q: "noor" })).records[0];
    const base = { rowNumber: 2, applicationId: record.id, raw: { "Candidate Name": "Noor", "Email ID": "noor@@x", "Phone Number": "98" }, record };
    assert.doesNotMatch(fixRowPrompt("r1", { ...base, issues: ["Relevant experience \"yes\" could not be read"] }), /noor@@x|Phone Number/);
    assert.match(fixRowPrompt("r1", { ...base, issues: ["Email \"noor@@x\" is not a valid address"] }), /Email ID: noor@@x/);
    assert.doesNotMatch(fixRowPrompt("r1", { ...base, issues: ["Email \"noor@@x\" is not a valid address"] }), /Candidate Name|Noor\b/);
  });

  it("clears all candidate data of one organisation only, keeping search history", async () => {
    await upload("Other.xlsx", [AMIT], OTHER_ORG);
    await createRecord(client, ORG, USER, { fullName: "Hand Added", email: "hand@x.com" });
    await q("insert into public.candidate_search_logs (organization_id, query, top_n) values ($1, 'bms', 5)", [ORG]);

    const result = await clearAllCandidateData(client, ORG);
    assert.ok(result.sheets >= 3 && result.records > 0 && result.people > 0);
    for (const table of ["candidate_sheets", "candidates", "candidate_applications", "candidate_fix_logs"]) {
      assert.equal(await count(table), 0, table);
    }
    assert.equal((await q("select 1 from public.candidate_sheet_rows r join public.candidate_sheets s on s.id = r.sheet_id where s.organization_id = $1", [ORG])).length, 0);
    assert.equal(await count("candidate_search_logs"), 1, "search history is kept");
    assert.equal(await count("candidates", OTHER_ORG), 1, "another organisation is untouched");
  });
});
