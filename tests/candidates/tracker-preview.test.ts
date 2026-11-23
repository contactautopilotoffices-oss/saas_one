import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { PGlite } from "@electric-sql/pglite";
import type { SupabaseClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";
import { createRecord } from "../../backend/lib/candidates/records";
import { createPosition } from "../../backend/lib/candidates/positions";
import { createTracker, deleteTracker, dueTrackers, listTrackers, previewTrackerImport, savedTrackerValues, syncTracker, updateTracker, type FetchLike } from "../../backend/lib/candidates/trackers";
import type { TrackerColumnTarget, TrackerImportPreview } from "../../backend/lib/candidates/types";
import { freshDb, TRACKER_PREVIEW_MIGRATION } from "./db-stub";
import { pgliteSupabase } from "./pglite-supabase";

const ORG = "00000000-0000-0000-0000-00000000000a";
const OTHER = "00000000-0000-0000-0000-00000000000b";
const USER = "00000000-0000-0000-0000-000000000001";
const ME = { id: USER, name: "HR" };
const MAP: Record<string, TrackerColumnTarget> = { Name: "fullName", Email: "email", Phone: "phone", Role: "role", Location: "location", "Agency rating": "extra", Secret: null };
const config = (name: string) => ({ name, url: "https://docs.google.com/spreadsheets/d/1234567890123456789012345/edit", tab: "Tracker", headerRow: 1, columnMap: MAP });
function file(rows: unknown[][]): FetchLike {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "Tracker");
  const bytes = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  return async () => new Response(bytes, { headers: { "content-type": "application/octet-stream" } });
}
const options = (preview: TrackerImportPreview, fetchImpl: FetchLike, selectedRows = preview.rows.filter(r => r.selected).map(r => r.rowNumber)) => ({ trigger: "manual" as const, by: ME, fetchImpl, reviewToken: preview.token, selectedRows });

describe("reviewed tracker imports", () => {
  let db: PGlite;
  let client: SupabaseClient;
  const q = async <T>(sql: string, values: unknown[] = []) => (await db.query<T>(sql, values)).rows;
  before(async () => {
    db = await freshDb(); client = pgliteSupabase(db);
    await q("insert into organizations (id) values ($1), ($2)", [ORG, OTHER]);
    await q("insert into auth.users (id) values ($1)", [USER]);
  });
  after(async () => db.close());

  it("previews without importing, defaults to manual, imports selected rows and preserves extras after disconnect", async () => {
    await createRecord(client, ORG, USER, { fullName: "Existing", email: "existing@example.com", location: "Delhi" });
    const conn = await createTracker(client, ORG, ME, config("Reviewed tracker"));
    assert.equal(conn.syncEvery, "manual");
    const fetchImpl = file([Object.keys(MAP), ["Existing", "existing@example.com", "", "Engineer", "Pune", "Gold", "private"], ["New", "new@example.com", "", "Engineer", "Delhi", "Silver", "hidden"], ["", "bad@example.com"], ["Duplicate", "new@example.com", "", "Engineer", "Mumbai", "Bronze"]]);
    const before = (await q<{ n: number }>("select count(*)::int as n from candidates"))[0].n;
    const p = await previewTrackerImport(client, ORG, conn.id, fetchImpl);
    assert.deepEqual([p.newCandidates, p.existingCandidates, p.duplicateRows, p.invalidRows], [1, 1, 1, 1]);
    assert.equal((await q<{ n: number }>("select count(*)::int as n from candidates"))[0].n, before);
    assert.equal((await q("select * from candidate_tracker_syncs")).length, 0);
    assert.deepEqual(p.headers, Object.keys(MAP));
    assert.equal(p.rows[0].raw.Secret, "private", "all columns are visible before import");
    assert.deepEqual(p.rows[0].changes.find(c => c.field === "Location"), { field: "Location", before: "Delhi", after: "Pune" });
    await assert.rejects(syncTracker(client, ORG, conn.id, { trigger: "manual", by: ME, fetchImpl }), /not been reviewed/);
    await assert.rejects(syncTracker(client, ORG, conn.id, options(p, fetchImpl, [3])), /only valid/);
    const imported = await syncTracker(client, ORG, conn.id, options(p, fetchImpl, [2]));
    assert.equal(imported.recordsAdded, 1);
    assert.equal((await q("select id from candidates where email = 'new@example.com'")).length, 0);
    const [saved] = (await listTrackers(client, ORG)).filter(c => c.id === conn.id);
    assert.ok(saved.reviewedAt);
    assert.ok(saved.skippedKeys.includes("new@example.com|engineer"));
    const [app] = await q<{ id: string }>("select id from candidate_applications where sheet_id = $1", [saved.sheetId]);
    const values = await savedTrackerValues(client, ORG, app.id, saved.sheetId);
    assert.equal(values?.["Agency rating"], "Gold");
    assert.equal(values?.Secret, undefined);
    assert.equal(await savedTrackerValues(client, OTHER, app.id, saved.sheetId), null);
    const again = await previewTrackerImport(client, ORG, conn.id, fetchImpl);
    assert.equal(again.rows[0].outcome, "unchanged");
    assert.equal(again.rows[3].selected, false, "skipped row stays excluded");
    await updateTracker(client, ORG, conn.id, { ...config(conn.name), syncEvery: "hourly" });
    await syncTracker(client, ORG, conn.id, { trigger: "schedule", fetchImpl });
    assert.equal((await q("select id from candidates where email = 'new@example.com'")).length, 0);
    const retry = await previewTrackerImport(client, ORG, conn.id, fetchImpl);
    await syncTracker(client, ORG, conn.id, options(retry, fetchImpl, [5]));
    assert.equal((await q("select id from candidates where email = 'new@example.com'")).length, 1);
    await deleteTracker(client, ORG, conn.id);
    assert.equal((await savedTrackerValues(client, ORG, app.id, saved.sheetId))?.["Agency rating"], "Gold");
  });

  it("blocks stale previews, foreign organisations, new columns and automatic import before review", async () => {
    const conn = await createTracker(client, ORG, ME, { ...config("Changes"), syncEvery: "hourly" });
    const rows = [Object.keys(MAP), ["Fresh", "fresh@example.com", "", "Engineer", "Delhi", "Gold"]];
    const original = file(rows);
    const p = await previewTrackerImport(client, ORG, conn.id, original);
    assert.ok(!(await dueTrackers(client)).some(c => c.id === conn.id));
    await assert.rejects(syncTracker(client, ORG, conn.id, { trigger: "schedule", fetchImpl: original }), /before automatic/);
    await assert.rejects(previewTrackerImport(client, OTHER, conn.id, original), /no longer exists/);
    const changed = file([rows[0], [...rows[1].slice(0, 4), "Pune", "Gold"]]);
    await assert.rejects(syncTracker(client, ORG, conn.id, options(p, changed)), /changed/);
    assert.equal((await q("select id from candidates where email = 'fresh@example.com'")).length, 0);
    const extra = file([[...rows[0], "Unexpected column"], [...rows[1], "Keep me"]]);
    await assert.rejects(previewTrackerImport(client, ORG, conn.id, extra), /Unexpected column/);
    await updateTracker(client, ORG, conn.id, { ...config(conn.name), columnMap: { ...MAP, "Unexpected column": "extra" }, syncEvery: "hourly" });
    const reviewed = await previewTrackerImport(client, ORG, conn.id, extra);
    await syncTracker(client, ORG, conn.id, options(reviewed, extra));
    const nextColumn = file([[...rows[0], "Unexpected column", "Another column"], [...rows[1], "Keep me", "Stop"]]);
    await assert.rejects(syncTracker(client, ORG, conn.id, { trigger: "schedule", fetchImpl: nextColumn }), /Another column/);
    assert.equal((await q("select id from candidates where email = 'fresh@example.com'")).length, 1);
  });

  it("shows and rechecks current app changes, keeping fields the sheet did not change", async () => {
    const conn = await createTracker(client, ORG, ME, config("App edits"));
    const rows = [Object.keys(MAP), ["Person", "person@example.com", "", "Engineer", "Delhi", "One"]];
    const fetchImpl = file(rows);
    await syncTracker(client, ORG, conn.id, options(await previewTrackerImport(client, ORG, conn.id, fetchImpl), fetchImpl));
    await q("update candidates set full_name = 'Edited name', location = 'Edited location' where email = 'person@example.com'");
    const changed = file([rows[0], [...rows[1].slice(0, 5), "Two"]]);
    const preview = await previewTrackerImport(client, ORG, conn.id, changed);
    assert.ok(!preview.rows[0].changes.some(c => c.field === "Candidate name" || c.field === "Location"));
    assert.deepEqual(preview.rows[0].changes.find(c => c.field === "Extra: Agency rating"), { field: "Extra: Agency rating", before: "One", after: "Two" });
    await q("update candidates set location = 'Changed after preview' where email = 'person@example.com'");
    await assert.rejects(syncTracker(client, ORG, conn.id, options(preview, changed)), /changed/);
    await syncTracker(client, ORG, conn.id, options(await previewTrackerImport(client, ORG, conn.id, changed), changed));
    assert.deepEqual((await q("select full_name, location from candidates where email = 'person@example.com'"))[0], { full_name: "Edited name", location: "Changed after preview" });
  });

  it("refuses ambiguous contacts, no-contact rows and repeated column names", async () => {
    await createRecord(client, ORG, USER, { fullName: "One", email: "one@example.com", phone: "9876543210" });
    await createRecord(client, ORG, USER, { fullName: "Two", email: "two@example.com", phone: "9876543211" });
    const conn = await createTracker(client, ORG, ME, config("Conflicts"));
    const fetchImpl = file([Object.keys(MAP), ["Conflicting", "one@example.com", "9876543211"], ["No contacts"], ["Phone duplicate", "", "9876543211"]]);
    const p = await previewTrackerImport(client, ORG, conn.id, fetchImpl);
    assert.equal(p.invalidRows, 3);
    assert.ok(p.rows.every(r => !r.selected));
    await assert.rejects(previewTrackerImport(client, ORG, conn.id, file([["Name", "Email", "Email"], ["Person", "x@y.com", "z@y.com"]])), /same name/);
  });

  it("claims the sync once and prevents settings or disconnect changing during it", async () => {
    const conn = await createTracker(client, ORG, ME, config("Lock"));
    const fetchImpl = file([Object.keys(MAP), ["Lock", "lock@example.com"]]);
    const p = await previewTrackerImport(client, ORG, conn.id, fetchImpl);
    let release!: () => void;
    let entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const wait = new Promise<void>(resolve => { release = resolve; });
    const slow: FetchLike = async (url, init) => { entered(); await wait; return fetchImpl(url, init); };
    const first = syncTracker(client, ORG, conn.id, options(p, slow));
    await started;
    try {
      await assert.rejects(syncTracker(client, ORG, conn.id, options(p, fetchImpl)), /already syncing/);
      await assert.rejects(updateTracker(client, ORG, conn.id, { active: false }), /finish syncing/);
      await assert.rejects(deleteTracker(client, ORG, conn.id), /finish syncing/);
    } finally { release(); }
    await first;
    assert.equal((await q("select id from candidates where email = 'lock@example.com'")).length, 1);
  });

  it("keeps snapshots and existing records beyond the database's first 1000 rows", async () => {
    const conn = await createTracker(client, ORG, ME, config("Large"));
    const rows = Array.from({ length: 1002 }, (_, i) => [`Person ${i}`, `large${i}@example.com`, "", "Engineer", "Delhi", "Extra"]);
    const fetchImpl = file([Object.keys(MAP), ...rows]);
    const first = await previewTrackerImport(client, ORG, conn.id, fetchImpl);
    assert.equal(first.newCandidates, 1002);
    assert.equal((await syncTracker(client, ORG, conn.id, options(first, fetchImpl))).recordsAdded, 1002);
    const again = await previewTrackerImport(client, ORG, conn.id, fetchImpl);
    assert.equal(again.changedRows, 0);
    rows[1001][4] = "Mumbai";
    const changed = file([Object.keys(MAP), ...rows]);
    const p = await previewTrackerImport(client, ORG, conn.id, changed);
    assert.equal(p.changedRows, 1);
    const result = await syncTracker(client, ORG, conn.id, options(p, changed));
    assert.deepEqual([result.recordsAdded, result.recordsUpdated], [0, 1]);
  });

  it("does not reapprove edited connections when the migration is rerun, and preserves legacy snapshots", async () => {
    const conn = await createTracker(client, ORG, ME, { ...config("Legacy"), syncEvery: "hourly" });
    const fetchImpl = file([Object.keys(MAP), ["Legacy", "legacy@example.com", "", "Engineer", "Delhi", "Extra"]]);
    await syncTracker(client, ORG, conn.id, options(await previewTrackerImport(client, ORG, conn.id, fetchImpl), fetchImpl));
    await q("update candidate_tracker_rows set cells = cells - '__config' - '__extra' where connection_id = $1", [conn.id]);
    await q("update candidates set full_name = 'App name', location = 'App location' where email = 'legacy@example.com'");
    await syncTracker(client, ORG, conn.id, { trigger: "schedule", fetchImpl });
    assert.deepEqual((await q("select full_name, location from candidates where email = 'legacy@example.com'"))[0], { full_name: "App name", location: "App location" });
    await updateTracker(client, ORG, conn.id, { ...config("Legacy changed"), syncEvery: "hourly" });
    await db.exec(TRACKER_PREVIEW_MIGRATION);
    assert.equal((await listTrackers(client, ORG)).find(c => c.id === conn.id)?.reviewedAt, null);
    assert.ok(!(await dueTrackers(client)).some(c => c.id === conn.id));
  });

  it("retries pending pipeline moves without overwriting app edits made since the rows were imported", async () => {
    await createPosition(client, ORG, ME, { title: "Retry engineer" });
    const conn = await createTracker(client, ORG, ME, { ...config("Pending move"), columnMap: { ...MAP, Status: "extra" }, statusColumn: "Status", statusMap: { Rejected: "backout" } });
    const fetchImpl = file([[...Object.keys(MAP), "Status"], ["Retry", "retry@example.com", "", "Retry engineer", "Delhi", "Gold", "", "Rejected"]]);
    const p = await previewTrackerImport(client, ORG, conn.id, fetchImpl);
    const first = await syncTracker(client, ORG, conn.id, { ...options(p, fetchImpl), now: () => new Date(Date.now() - 60_000) });
    assert.equal(first.stagePending, 1);
    await q("update candidates set location = 'Edited after import' where email = 'retry@example.com'");
    const retry = await previewTrackerImport(client, ORG, conn.id, fetchImpl);
    assert.equal(retry.rows[0].stage, "backout");
    assert.ok(!retry.rows[0].changes.some(c => c.field === "Location"));
    const second = await syncTracker(client, ORG, conn.id, options(retry, fetchImpl));
    assert.deepEqual([second.stageMoves, second.stagePending], [1, 0]);
    assert.equal((await q<{ location: string }>("select location from candidates where email = 'retry@example.com'"))[0].location, "Edited after import");
    assert.equal((await previewTrackerImport(client, ORG, conn.id, fetchImpl)).changedRows, 0);
  });
});
