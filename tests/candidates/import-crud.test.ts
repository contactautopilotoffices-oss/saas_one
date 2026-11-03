/**
 * Import (new / merge / replace), records CRUD, sheets and indexing, run against the real migration in PGlite.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import type { PGlite } from "@electric-sql/pglite";
import type { SupabaseClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";

import { findLiveSheetByName, importSheet } from "../../backend/lib/candidates/import";
import { indexPending } from "../../backend/lib/candidates/indexing";
import { parseSheet } from "../../backend/lib/candidates/parse-sheet";
import { createRecord, deleteRecord, listRecords, restoreRecord, updateRecord } from "../../backend/lib/candidates/records";
import { deleteSheet, listSheets, restoreSheet, sheetIssues } from "../../backend/lib/candidates/sheets";
import type { UploadMode } from "../../backend/lib/candidates/types";

import { freshDb } from "./db-stub";
import { pgliteSupabase } from "./pglite-supabase";

const ORG = "00000000-0000-0000-0000-00000000000a";
const USER = "00000000-0000-0000-0000-0000000000u1".replace("u1", "01");

const HEADERS = ["Sr No.", "Sourcing Date", "Candidate Source", "Candidate Name", "Email ID", "Phone Number", "Current Organization",
  "Location", "Current Designation", "Role", "Total Exp(In)", "Relevant Exp", "Notice Period (In Days)", "Current In Hand",
  "Expected Inhand", "Remark"];
const AMIT = [1, "30-06-2026", "Pratyarth Services", "Amit Babu", "er.babu.amit@gmail.com", 7534855802, "MEP Engineer at Cushman & Wakefield",
  "Noida", "MEP Engineer", "BMS Operator", "4 Yrs", "4 Yrs", "15 Days", "35K", "37K", "Rejected cause budget issue"];
const CHITER = [2, "30-06-2026", "Pratyarth Services", "Chiter Sain Singh", "chitersainsingh53@gmail.com", 9599358284, "BuildMyInfra",
  "Noida", "BMS Operator", "BMS Operator", "5 Yrs", "5 Yrs", "30 Days", "25k", "30k", "Not resposnding"];
const VIGNESH = [3, "30-06-2026", "Pratyarth Services", "Vignesh Pandit Bhoir", "vbhoir868@@gmail.com", 9604560296, "Lodha Group",
  "Thane", "Building Supervisor", "Housekeeping Supervisor", "3 Yrs", "3 Yrs", "15 Days", "25K", "28K", "Not responding"];

function file(rows: unknown[][]): Uint8Array {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([HEADERS, ...rows]), "Sheet1");
  return new Uint8Array(XLSX.write(workbook, { type: "array", bookType: "xlsx" }) as ArrayBuffer);
}

describe("import + CRUD against the real schema", () => {
  let db: PGlite;
  let client: SupabaseClient;
  const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;

  async function upload(name: string, rows: unknown[][], mode: UploadMode = "new") {
    const parsed = parseSheet(file(rows), name);
    const existing = await findLiveSheetByName(client, ORG, name);
    return importSheet(client, { orgId: ORG, userId: USER, userEmail: "hr@x.com", fileName: name, parsed, mode, existing });
  }
  const visible = async () => (await listRecords(client, ORG, { pageSize: 100 })).records;

  before(async () => {
    db = await freshDb();
    await q("insert into public.organizations (id) values ($1)", [ORG]);
    await q("insert into auth.users (id) values ($1)", [USER]);
    client = pgliteSupabase(db);
  });
  after(async () => {
    await db.close();
  });

  let juneId: string;

  it("imports a new sheet: cleans, de-duplicates and makes it live", async () => {
    // Chiter appears twice for the same role: one record, the later row wins, the duplicate is noted.
    const chiterAgain = [...CHITER];
    chiterAgain[14] = "32K";
    const result = await upload("June.xlsx", [AMIT, CHITER, VIGNESH, chiterAgain]);
    juneId = result.sheetId;
    assert.equal(result.mode, "new");
    assert.equal(result.rowsRead, 4);
    assert.equal(result.recordsAdded, 3);
    assert.equal(result.newCandidates, 3);

    const records = await visible();
    assert.equal(records.length, 3);
    const chiter = records.find((r) => r.fullName === "Chiter Sain Singh")!;
    assert.equal(chiter.expectedInhand, 32000);
    assert.equal(chiter.status, "not_responding");
    const amit = records.find((r) => r.fullName === "Amit Babu")!;
    assert.equal(amit.currentOrganization, "Cushman & Wakefield");
    assert.equal(amit.indexed, false);

    const [sheet] = await q<{ status: string; flagged_count: number }>("select status, flagged_count from public.candidate_sheets where id = $1", [juneId]);
    assert.equal(sheet.status, "ready");
    // Amit's organisation split and Vignesh's "@@" email are fixed automatically: shown, but not counted as flagged.
    assert.equal(sheet.flagged_count, 0);
    assert.equal(result.rowsFlagged, 0);
    assert.equal(result.rowsAutoFixed, 3);

    const issues = await sheetIssues(client, ORG, juneId);
    assert.deepEqual(issues.map((i) => i.rowNumber), [2, 4, 5]);
    assert.ok(issues.every((i) => i.issues.length === 0 && i.fixed.length > 0 && !i.skipped && i.applicationId));
    assert.match(issues.find((i) => i.rowNumber === 5)!.fixed.join(), /Same candidate and role as row 3/);
    assert.equal(records.find((r) => r.fullName === "Vignesh Pandit Bhoir")!.email, "vbhoir868@gmail.com");

    const [search] = await q<{ search_text: string }>("select search_text from public.candidate_applications where id = $1", [amit.id]);
    assert.doesNotMatch(search.search_text, /@|7534855802/);
  });

  it("indexes records with a (fake) embedder and reports what is left", async () => {
    const result = await indexPending(client, ORG, { embed: async (texts) => texts.map((_, i) => [1, i, 0]), sleep: async () => {} });
    assert.deepEqual(result, { indexed: 3, remaining: 0, waiting: false });
    assert.ok((await visible()).every((r) => r.indexed));
  });

  it("asks Replace or Merge for the same file name, ignoring case and extension", async () => {
    assert.equal((await findLiveSheetByName(client, ORG, "JUNE.csv"))?.id, juneId);
    await assert.rejects(upload("june.xlsx", [AMIT], "new"), /already exists/);
  });

  it("merges: updates matching records, adds new ones, keeps embeddings whose text did not change", async () => {
    const amitChanged = [...AMIT];
    amitChanged[12] = "30 Days"; // notice changes -> Amit's profile text changes
    const newPerson = [4, "01-07-2026", "Naukri", "Ravi Kumar", "ravi@x.com", 9811111111, "JLL", "Navi Mumbai", "BMS Operator",
      "BMS Operator", "6 Yrs", "6 Yrs", "Immediate", "40K", "45K", ""];
    const result = await upload("june.xlsx", [amitChanged, CHITER, newPerson], "merge");
    assert.equal(result.mode, "merge");
    assert.equal(result.sheetId, juneId);
    assert.equal(result.recordsUpdated, 2);
    assert.equal(result.recordsAdded, 1);
    assert.equal(result.matchedCandidates, 2);

    const records = await visible();
    assert.equal(records.length, 4); // Vignesh was not in the merge file and is kept
    const amit = records.find((r) => r.fullName === "Amit Babu")!;
    assert.equal(amit.noticePeriodDays, 30);
    assert.equal(amit.indexed, false, "changed text loses its embedding");
    assert.equal(records.find((r) => r.fullName === "Chiter Sain Singh")!.indexed, true, "unchanged text keeps its embedding");

    const [sheet] = await q<{ upload_count: number }>("select upload_count from public.candidate_sheets where id = $1", [juneId]);
    assert.equal(sheet.upload_count, 2);
    assert.equal((await sheetIssues(client, ORG, juneId)).length, 1, "issues report shows the latest upload only");
  });

  it("matches people across sheets by email or phone and refreshes their other records", async () => {
    const amitMoved = [...AMIT];
    amitMoved[4] = "ER.BABU.AMIT@GMAIL.COM";
    amitMoved[7] = "Pune";
    amitMoved[9] = "Facility Executive";
    const result = await upload("July.xlsx", [amitMoved]);
    assert.equal(result.newCandidates, 0);
    assert.equal(result.matchedCandidates, 1);

    const amits = (await visible()).filter((r) => r.fullName === "Amit Babu");
    assert.equal(amits.length, 2);
    assert.ok(amits.every((r) => r.location === "Pune"), "person fields are shared");
    assert.equal(new Set(amits.map((r) => r.candidateId)).size, 1);
    const [june] = await q<{ search_text: string }>(
      "select search_text from public.candidate_applications where sheet_id = $1 and candidate_id = $2",
      [juneId, amits[0].candidateId],
    );
    assert.match(june.search_text, /Location: Pune/);
  });

  let julyNewId: string;

  it("replaces: the old sheet goes to Deleted only once the new one is complete", async () => {
    const before = await findLiveSheetByName(client, ORG, "July.xlsx");
    const result = await upload("July.xlsx", [VIGNESH], "replace");
    julyNewId = result.sheetId;
    assert.notEqual(result.sheetId, before?.id);

    const live = await listSheets(client, ORG, false);
    assert.deepEqual(live.sheets.map((s) => s.name).sort(), ["July.xlsx", "june.xlsx"]);
    const deleted = await listSheets(client, ORG, true);
    assert.equal(deleted.sheets.length, 1);
    assert.equal(deleted.sheets[0].id, before?.id);

    const amits = (await visible()).filter((r) => r.fullName === "Amit Babu");
    assert.equal(amits.length, 1, "the replaced sheet's record is hidden; the June record stays");
  });

  it("will not restore a sheet while a newer one with the same name is live", async () => {
    const [old] = (await listSheets(client, ORG, true)).sheets;
    await assert.rejects(restoreSheet(client, ORG, old.id), /newer sheet/);
    await deleteSheet(client, ORG, USER, julyNewId);
    const restored = await restoreSheet(client, ORG, old.id);
    assert.equal(restored.deletedAt, null);
  });

  it("adds a candidate by hand, matching an existing person by phone", async () => {
    const { record, matchedExisting } = await createRecord(client, ORG, USER, {
      fullName: "Chiter Singh",
      phone: "+91 95993 58284",
      role: "Facility Executive",
      noticePeriodDays: 30,
      expectedInhand: 32000,
    });
    assert.equal(matchedExisting, true);
    assert.equal(record.sheetId, null);
    assert.equal(record.fullName, "Chiter Singh");
    assert.equal(record.status, "new");

    const fresh = await createRecord(client, ORG, USER, { fullName: "New Person", email: "new@x.com", totalExpMonths: 24 });
    assert.equal(fresh.matchedExisting, false);
    await assert.rejects(createRecord(client, ORG, USER, { fullName: "  " }), /Full name is required/);
    await assert.rejects(createRecord(client, ORG, USER, { fullName: "X", noticePeriodDays: 999 }), /noticePeriodDays/);
  });

  it("edits a record; person fields change every record of that person", async () => {
    const chiter = (await visible()).find((r) => r.sheetId === juneId && r.candidateId && r.role === "BMS Operator" && r.location === "Noida")!;
    const updated = await updateRecord(client, ORG, USER, chiter.id, { location: "Thane", status: "shortlisted" });
    assert.equal(updated.location, "Thane");
    assert.equal(updated.status, "shortlisted");
    const all = (await visible()).filter((r) => r.candidateId === chiter.candidateId);
    assert.ok(all.length >= 2 && all.every((r) => r.location === "Thane"));
    assert.equal(all.find((r) => r.sheetId === null)?.status, "new", "status belongs to the record, not the person");
  });

  it("soft-deletes and restores records; filters and search work on the table", async () => {
    const target = (await visible()).find((r) => r.fullName === "New Person")!;
    await deleteRecord(client, ORG, USER, target.id);
    assert.equal((await visible()).some((r) => r.id === target.id), false);
    const deleted = await listRecords(client, ORG, { deleted: true });
    assert.deepEqual(deleted.records.map((r) => r.id), [target.id]);
    await restoreRecord(client, ORG, USER, target.id);
    assert.equal((await visible()).some((r) => r.id === target.id), true);

    assert.equal((await listRecords(client, ORG, { q: "vignesh" })).total, 1);
    assert.equal((await listRecords(client, ORG, { q: "100%" })).total, 0);
    assert.equal((await listRecords(client, ORG, { sheetId: "manual" })).total, 2);
    assert.equal((await listRecords(client, ORG, { status: "rejected" })).records.every((r) => r.status === "rejected"), true);
  });

  it("will not restore a record whose sheet is deleted", async () => {
    const vignesh = (await visible()).find((r) => r.fullName === "Vignesh Pandit Bhoir" && r.sheetId === juneId)!;
    await deleteRecord(client, ORG, USER, vignesh.id);
    await deleteSheet(client, ORG, USER, juneId);
    await assert.rejects(restoreRecord(client, ORG, USER, vignesh.id), /Restore the sheet instead/);
    await restoreSheet(client, ORG, juneId);
    await restoreRecord(client, ORG, USER, vignesh.id);
  });

  it("searches end to end: spec -> filters -> RRF -> ranking -> log", async () => {
    const parseReply = JSON.stringify({
      summary: "BMS operators with 3+ years relevant experience, notice up to 30 days",
      must: { min_relevant_exp_months: 36, max_notice_days: 30 },
      prefer: { roles: ["BMS Operator"] },
      keywords: ["BMS"],
    });
    const caller = async (req: { user: string }) => {
      if (!req.user.includes("Records (")) return { text: parseReply, model: "anthropic:claude-haiku-5-5" };
      const ids = [...req.user.matchAll(/^(c\d+) \|/gm)].map((m) => m[1]);
      const text = JSON.stringify({ ranking: ids.map((id, i) => ({ id, role: 90 - i * 10, experience: 80, domain: 60, reasons: ["r"], missing: [], summary: "s" })) });
      return { text, model: "anthropic:claude-opus-5-5" };
    };
    const { searchCandidates } = await import("../../backend/lib/candidates/search");
    const response = await searchCandidates(client, ORG, USER, "bms operators 3+ yrs notice under 30 days", 2, {
      caller: caller as never,
      embed: async () => [1, 0, 0],
      today: "2026-11-02",
    });
    assert.equal(response.aiRanked, true);
    assert.ok(response.results.length <= 2);
    assert.ok(response.results.length > 0);
    for (const r of response.results) {
      assert.ok((r.record.relevantExpMonths ?? 0) >= 36, "must-have: experience");
      assert.ok((r.record.noticePeriodDays ?? 999) <= 30, "must-have: notice");
      assert.equal(typeof r.matchPercent, "number");
    }
    assert.deepEqual(response.results.map((r) => r.rank), response.results.map((_, i) => i + 1));
    assert.ok(response.understood.chips.some((c) => c.kind === "must" && /Notice/.test(c.label)));

    const [log] = await q<{ ai_parsed: boolean; ai_ranked: boolean; top_n: number; result_ids: string[]; parse_model: string; rank_model: string }>(
      "select ai_parsed, ai_ranked, top_n, result_ids, parse_model, rank_model from public.candidate_search_logs where id = $1",
      [response.searchId],
    );
    assert.deepEqual([log.ai_parsed, log.ai_ranked, log.top_n, log.result_ids.length], [true, true, 2, response.results.length]);
    assert.deepEqual([log.parse_model, log.rank_model], ["anthropic:claude-haiku-5-5", "anthropic:claude-opus-5-5"], "which model answered is logged");
  });

  it("counts records still waiting for an embedding, for live sheets only", async () => {
    const { pendingIndexTotal, sheets } = await listSheets(client, ORG, false);
    const pending = await q<{ n: number }>(
      `select count(*)::int as n from public.candidate_records r join public.candidate_applications a using (id)
       where r.deleted_at is null and r.sheet_live and a.embedding is null`,
    );
    assert.equal(pendingIndexTotal, pending[0].n);
    assert.ok(sheets.every((s) => s.liveRecordCount >= 0));
  });
});
