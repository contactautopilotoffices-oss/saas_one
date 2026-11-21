/**
 * Connected trackers (owner 2026-11-21; HRMS meeting item 5; migration 20261121000002): a Google Sheet or Excel share
 * link synced one way into the app. The link rules, the safe download, reading a tab with HR's column matching, and the
 * sync against the real migrations in PGlite: rows in, statuses onto the pipeline, unchanged rows left alone, and an
 * edit made in the app kept when the sheet did not change that cell. No network: the download is a fake.
 */
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import type { PGlite } from "@electric-sql/pglite";
import type { SupabaseClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";

import { resetHistoryCheck } from "../../backend/lib/candidates/actions";
import { createPosition, listMembers } from "../../backend/lib/candidates/positions";
import {
  createTracker, downloadTracker, dueTrackers, listTrackers, previewTracker, readTrackerRows, syncTracker, trackerSource, updateTracker, type FetchLike,
} from "../../backend/lib/candidates/trackers";

import { freshDb } from "./db-stub";
import { pgliteSupabase } from "./pglite-supabase";

const ORG = "00000000-0000-0000-0000-00000000000a";
const USER = "00000000-0000-0000-0000-000000000001";
const ME = { id: USER, name: "Roohi" };
const LINK = "https://docs.google.com/spreadsheets/d/1GXAKUndpZUw0xKg1HQSpMFIBW8AjWKTrQfkapLrZoZc/edit?usp=sharing";
const HEAD = ["Sr. NO", "Candidate Source", "Candidate Name", "Email ID", "Phone Number", "Location", "Role", "Notice Period (In Days)", "Remark", "Status"];

/** A workbook with a title row above the header (as many trackers have), and a second tab. */
function workbook(rows: unknown[][]): Uint8Array {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Closing loop"], ["Task"]]), "Closing Loop");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Standard Tracker"], HEAD, ...rows]), "dashboard Standard Tracker");
  return new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer);
}

/** Google's export: a redirect to googleusercontent.com, then the file. */
function google(bytes: () => Uint8Array): FetchLike {
  return async (url) => {
    if (url.startsWith("https://docs.google.com/")) return new Response(null, { status: 307, headers: { location: "https://doc-0s-sheets.googleusercontent.com/export/abc" } });
    return new Response(bytes() as BodyInit, { status: 200, headers: { "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" } });
  };
}

const AMIT = [1, "Pratyarth Services", "Amit Babu", "er.babu.amit@gmail.com", "7534855802", "Noida", "BMS Operator", "15 Days", "Good profile", "Backed Out"];
const CHITRA = [2, "Shwetha", "Chitra Rao", "chitra@example.com", "9599358284", "Thane", "Pantry Executive", "30 Days", "", "Screening Pending"];
const NONAME = [3, "Shwetha", "", "x@example.com", "9000000000", "Pune", "BMS Operator", "", "", ""];

describe("connected trackers", () => {
  let db: PGlite;
  let client: SupabaseClient;
  let positionId: string;
  // Amit is listed twice for the same role (the tracker's duplicates): the last row is used and flagged.
  let sheet: unknown[][] = [AMIT, CHITRA, NONAME, [4, ...AMIT.slice(1)]];
  const fetchSheet = google(() => workbook(sheet));
  const q = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;

  before(async () => {
    db = await freshDb();
    await db.query("insert into public.organizations (id) values ($1)", [ORG]);
    await db.query("insert into auth.users (id) values ($1)", [USER]);
    client = pgliteSupabase(db);
    positionId = (await createPosition(client, ORG, ME, { title: "BMS Operator", location: "Noida" })).id;
  });
  beforeEach(() => resetHistoryCheck());
  after(async () => {
    await db.close();
  });

  it("accepts Google Sheets and Microsoft share links only, and downloads the file", async () => {
    assert.deepEqual(trackerSource(LINK), {
      kind: "google_sheet",
      url: "https://docs.google.com/spreadsheets/d/1GXAKUndpZUw0xKg1HQSpMFIBW8AjWKTrQfkapLrZoZc/edit",
      downloadUrl: "https://docs.google.com/spreadsheets/d/1GXAKUndpZUw0xKg1HQSpMFIBW8AjWKTrQfkapLrZoZc/export?format=xlsx",
    });
    assert.equal(trackerSource("https://contoso.sharepoint.com/:x:/s/hr/EaBcD?e=1").downloadUrl, "https://contoso.sharepoint.com/:x:/s/hr/EaBcD?e=1&download=1");
    assert.match(trackerSource("https://1drv.ms/x/s!AbCdEf").downloadUrl, /^https:\/\/api\.onedrive\.com\/v1\.0\/shares\/u!/);
    assert.throws(() => trackerSource("http://docs.google.com/spreadsheets/d/1GXAKUndpZUw0xKg1HQSpMFIBW8AjWKTrQfkapLrZoZc"), /https/);
    assert.throws(() => trackerSource("https://example.com/tracker.xlsx"), /Only Google Sheets and Excel/);
    assert.throws(() => trackerSource("https://docs.google.com/document/d/abc"), /not a spreadsheet/);

    assert.ok((await downloadTracker(trackerSource(LINK).downloadUrl, fetchSheet)).byteLength > 0, "follows Google's redirect");
    const elsewhere: FetchLike = async () => new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest" } });
    await assert.rejects(downloadTracker(trackerSource(LINK).downloadUrl, elsewhere), /somewhere the app does not read from/);
    const signIn: FetchLike = async () => new Response("<html>Sign in</html>", { status: 200, headers: { "content-type": "text/html" } });
    await assert.rejects(downloadTracker(trackerSource(LINK).downloadUrl, signIn), /Anyone with the link can view/);
  });

  it("reads a tab: finds the header row, guesses the columns, lists the status values", async () => {
    const preview = await previewTracker({ url: LINK }, fetchSheet);
    assert.deepEqual([preview.tabs, preview.tab, preview.headerRow, preview.rowCount], [["Closing Loop", "dashboard Standard Tracker"], "dashboard Standard Tracker", 2, 4]);
    assert.equal(preview.guess["Candidate Name"], "fullName");
    assert.equal(preview.guess["Sr. NO"], null);
    assert.equal(preview.guess.Remark, "remark");
    assert.equal(preview.guess.Status, null, "each field once: Remark took it");
    assert.equal(preview.statusColumnGuess, "Status");
    assert.deepEqual(preview.distinct.Status, ["Backed Out", "Screening Pending"]);

    const rows = readTrackerRows([HEAD, AMIT, NONAME], 1, preview.guess, "Status");
    assert.deepEqual([rows[0].row.clean?.fullName, rows[0].row.clean?.noticePeriodDays, rows[0].status, rows[0].key], ["Amit Babu", 15, "Backed Out", "er.babu.amit@gmail.com|bms operator"]);
    assert.equal(rows[1].row.clean, null, "no name: skipped");

    // The owner's tracker starts its columns again lower down, with "Sourcing Date" added: each part has its own columns.
    const SECOND = ["Sr. No", "Sourcing Date", "Candidate Source", "Candidate Name", "Email ID", "Phone Number", "Role", "Status"];
    const grid = [HEAD, AMIT, [], SECOND, [71, "16-11-2026", "Pratyarth Services", "Bangari Chaitanya", "chaitanya@example.com", "8247052862", "BMS Operator", "Backed Out"]];
    const two = readTrackerRows(grid, 1, preview.guess, "Status");
    assert.equal(two.length, 2, "the second header row is not a candidate");
    assert.deepEqual([two[1].row.clean?.fullName, two[1].row.clean?.candidateSource, two[1].row.clean?.sourcingDate, two[1].status, two[1].row.rowNumber], ["Bangari Chaitanya", "Pratyarth Services", "2026-11-16", "Backed Out", 5]);
  });

  it("refuses settings it could not sync", async () => {
    const base = { name: "Standard Tracker", url: LINK, tab: "dashboard Standard Tracker", headerRow: 2, syncEvery: "hourly" };
    await assert.rejects(createTracker(client, ORG, ME, { ...base, columnMap: { Location: "location" } }), /Candidate name/);
    await assert.rejects(createTracker(client, ORG, ME, { ...base, columnMap: { "Candidate Name": "fullName" }, statusColumn: "Status", statusMap: { "Backed Out": "no_such_stage" } }), /no longer exists/);
    await assert.rejects(createTracker(client, ORG, ME, { ...base, url: "https://example.com/x.xlsx", columnMap: { "Candidate Name": "fullName" } }), /Only Google Sheets/);
  });

  it("syncs one way: rows in, statuses onto the pipeline, unchanged rows left alone, app edits kept", async () => {
    const preview = await previewTracker({ url: LINK }, fetchSheet);
    const tracker = await createTracker(client, ORG, ME, {
      name: "Standard Tracker", url: LINK, tab: preview.tab, headerRow: preview.headerRow, columnMap: preview.guess, syncEvery: "hourly",
      statusColumn: "Status", statusMap: { "Backed Out": "backout", "screening pending": "screening_pending" },
    });
    assert.deepEqual(tracker.statusMap, { "backed out": "backout", "screening pending": "screening_pending" });

    const first = await syncTracker(client, ORG, tracker.id, { trigger: "manual", by: ME, fetchImpl: fetchSheet });
    assert.deepEqual(
      [first.rowsRead, first.rowsChanged, first.rowsSkipped, first.recordsAdded, first.stageMoves, first.rolesWithoutPosition, first.duplicateRows, first.duplicates],
      [4, 2, 1, 2, 1, ["Pantry Executive"], 1, ["Amit Babu (BMS Operator): rows 3, 6"]],
      "Amit is moved in the BMS Operator position; nobody has a Pantry Executive position open",
    );
    const member = () => listMembers(client, ORG, positionId).then((list) => list.find((m) => m.record?.fullName === "Amit Babu"));
    assert.equal((await member())?.stage, "backout");
    const [saved] = await listTrackers(client, ORG);
    assert.deepEqual([saved.lastOk, saved.lastSummary?.rowsChanged, Boolean(saved.sheetId)], [true, 2, true]);
    assert.equal((await q<{ name: string }>("select name from public.candidate_sheets where id = $1", [saved.sheetId]))[0].name, "Standard Tracker", "the rows are in a sheet named after the connection");
    const [flagged] = await q<{ issues: string[] }>("select issues from public.candidate_sheet_rows where sheet_id = $1 and row_number = 6", [saved.sheetId]);
    assert.ok(flagged.issues.some((i) => /Duplicate in the tracker: the same person and role is also in row 3/.test(i)), "flagged for review in the sheet");
    assert.equal((await q<{ flagged_count: number }>("select flagged_count from public.candidate_sheets where id = $1", [saved.sheetId]))[0].flagged_count >= 1, true, "the sheet counts it as flagged");

    const again = await syncTracker(client, ORG, tracker.id, { trigger: "schedule", fetchImpl: fetchSheet });
    assert.deepEqual([again.rowsChanged, again.rowsUnchanged, again.recordsAdded], [0, 2, 0], "nothing changed: nothing imported");

    // HR edits the remark in the app; the sheet then changes only the notice period. The app's remark stays.
    await q("update public.candidate_applications set remark = 'Edited in the app' where sheet_id = $1 and role = 'BMS Operator'", [saved.sheetId]);
    sheet = [[...AMIT.slice(0, 7), "30 Days", ...AMIT.slice(8)], CHITRA, NONAME];
    const third = await syncTracker(client, ORG, tracker.id, { trigger: "manual", by: ME, fetchImpl: fetchSheet });
    assert.deepEqual([third.rowsChanged, third.recordsUpdated, third.stageMoves], [1, 1, 0], "the status did not change, so nobody moves");
    const [amit] = await q<{ remark: string; notice_period_days: number }>("select remark, notice_period_days from public.candidate_applications where sheet_id = $1 and role = 'BMS Operator'", [saved.sheetId]);
    assert.deepEqual(amit, { remark: "Edited in the app", notice_period_days: 30 });

    // The status changes in the sheet: Amit moves.
    sheet = [[...AMIT.slice(0, 7), "30 Days", "Good profile", "Screening Pending"], CHITRA, NONAME];
    const fourth = await syncTracker(client, ORG, tracker.id, { trigger: "manual", by: ME, fetchImpl: fetchSheet });
    assert.equal(fourth.stageMoves, 1);
    assert.equal((await member())?.stage, "screening_pending");
    assert.equal((await q<{ n: number }>("select count(*)::int as n from public.candidate_tracker_syncs where connection_id = $1", [tracker.id]))[0].n, 4, "every sync is in the history");
  });

  it("records a failed sync on the card, and runs on schedule only when due", async () => {
    const [tracker] = await listTrackers(client, ORG);
    const broken: FetchLike = async () => new Response("<html>Sign in</html>", { status: 200, headers: { "content-type": "text/html" } });
    await assert.rejects(syncTracker(client, ORG, tracker.id, { trigger: "manual", by: ME, fetchImpl: broken }), /Anyone with the link/);
    const [failed] = await listTrackers(client, ORG);
    assert.deepEqual([failed.lastOk, /Anyone with the link/.test(failed.lastError ?? ""), failed.syncing], [false, true, false]);

    const last = new Date(failed.lastSyncedAt!);
    assert.equal((await dueTrackers(client, new Date(last.getTime() + 30 * 60_000))).length, 0, "an hourly tracker synced 30 min ago is not due");
    assert.deepEqual((await dueTrackers(client, new Date(last.getTime() + 2 * 3_600_000))).map((d) => d.id), [tracker.id]);
    await updateTracker(client, ORG, tracker.id, { active: false });
    assert.equal((await dueTrackers(client, new Date(last.getTime() + 2 * 3_600_000))).length, 0, "paused: not synced");
  });
});
