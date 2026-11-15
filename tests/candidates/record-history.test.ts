/** Editing a record with history (owner 2026-11-15): the "Others" remark rule, what gets recorded, and the panel's blacklist entry. */
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import type { PGlite } from "@electric-sql/pglite";
import type { SupabaseClient } from "@supabase/supabase-js";

import { addRemark, changeRecordWithHistory, listActions, resetHistoryCheck, setBlacklist } from "../../backend/lib/candidates/actions";
import { getFullRecord, resetBlacklistColumnCheck, resetResumeColumnsCheck } from "../../backend/lib/candidates/filter-search";
import { createRecord } from "../../backend/lib/candidates/records";

import { freshDb } from "./db-stub";
import { pgliteSupabase } from "./pglite-supabase";

const ORG = "00000000-0000-0000-0000-00000000000a";
const USER = "00000000-0000-0000-0000-000000000001";
const ME = { id: USER, name: "Shwetha" };

describe("record edits with history", () => {
  let db: PGlite;
  let client: SupabaseClient;
  let asha: { id: string; candidateId: string };

  before(async () => {
    db = await freshDb();
    await db.query("insert into public.organizations (id) values ($1)", [ORG]);
    await db.query("insert into auth.users (id) values ($1)", [USER]);
    client = pgliteSupabase(db);
    const { record } = await createRecord(client, ORG, USER, { fullName: "Asha", role: "BMS Operator", location: "Thane", remark: "first call done" });
    asha = { id: record.id, candidateId: record.candidateId };
  });
  beforeEach(() => { resetHistoryCheck(); resetBlacklistColumnCheck(); resetResumeColumnsCheck(); });
  after(async () => {
    await db.close();
  });

  it("refuses Others without a remark, and records it with one", async () => {
    await assert.rejects(changeRecordWithHistory(client, ORG, ME, asha.id, { status: "others" }), /remark is required/);
    const saved = await changeRecordWithHistory(client, ORG, ME, asha.id, { status: "others", actionRemark: "Wants the Bengaluru role instead." });
    assert.equal(saved.status, "others");
    const [latest] = await listActions(client, ORG, asha.candidateId);
    assert.deepEqual([latest.action, latest.fromValue, latest.toValue, latest.remark, latest.byName], ["status_change", "new", "others", "Wants the Bengaluru role instead.", "Shwetha"]);
  });

  it("takes the record's own remark as the reason when it changes in the same edit", async () => {
    await changeRecordWithHistory(client, ORG, ME, asha.id, { status: "shortlisted" });
    const saved = await changeRecordWithHistory(client, ORG, ME, asha.id, { status: "others", remark: "Moved to another requirement" });
    assert.equal(saved.remark, "Moved to another requirement");
    const [latest] = await listActions(client, ORG, asha.candidateId);
    assert.equal(latest.remark, "Moved to another requirement");
  });

  it("changes any other status without a remark, and records field edits by name", async () => {
    await changeRecordWithHistory(client, ORG, ME, asha.id, { status: "interview" });
    await changeRecordWithHistory(client, ORG, ME, asha.id, { noticePeriodDays: 30, expectedInhand: 42000 });
    const history = await listActions(client, ORG, asha.candidateId);
    assert.equal(history[0].action, "field_edit");
    assert.deepEqual(history[0].meta.fields, ["noticePeriodDays", "expectedInhand"]);
    assert.deepEqual([history[1].action, history[1].toValue, history[1].remark], ["status_change", "interview", null]);
  });

  it("adds a remark on its own and refuses an empty one", async () => {
    await assert.rejects(addRemark(client, ORG, ME, asha.id, "   "), /Type the remark/);
    await addRemark(client, ORG, ME, asha.id, "Called, will revert by Friday.");
    const [latest] = await listActions(client, ORG, asha.candidateId);
    assert.deepEqual([latest.action, latest.remark], ["remark", "Called, will revert by Friday."]);
  });

  it("the panel's record carries the blacklist entry", async () => {
    assert.equal((await getFullRecord(client, ORG, asha.id)).blacklist, null);
    await setBlacklist(client, ORG, ME, asha.candidateId, { reason: "misconduct" });
    const full = await getFullRecord(client, ORG, asha.id);
    assert.equal(full.blacklisted, true);
    assert.equal(full.blacklist?.reason, "misconduct");
    assert.equal(full.blacklist?.byName, null); // no users row in the test database: the name is left out, never invented
  });
});
