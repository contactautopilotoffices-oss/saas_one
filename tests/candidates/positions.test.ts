/** Positions and their pipelines (owner 2026-11-15): saving, adding people once, moving between stages, closing. */
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import type { PGlite } from "@electric-sql/pglite";
import type { SupabaseClient } from "@supabase/supabase-js";

import { listActions, resetHistoryCheck } from "../../backend/lib/candidates/actions";
import { EMPTY_FILTERS } from "../../backend/lib/candidates/filters";
import { addMembers, createPosition, deletePosition, getPosition, listMembers, listMemberships, listPositions, moveMember, removeMember, updatePosition } from "../../backend/lib/candidates/positions";
import { createRecord } from "../../backend/lib/candidates/records";

import { freshDb, POSITION_DETAILS_MIGRATION } from "./db-stub";
import { pgliteSupabase } from "./pglite-supabase";

const ORG = "00000000-0000-0000-0000-00000000000a";
const USER = "00000000-0000-0000-0000-000000000001";
const ME = { id: USER, name: "Shwetha" };

describe("positions and pipelines", () => {
  let db: PGlite;
  let client: SupabaseClient;
  let asha: { id: string; candidateId: string };
  let ashaAgain: { id: string; candidateId: string };
  let bilal: { id: string; candidateId: string };

  before(async () => {
    db = await freshDb();
    await db.query("insert into public.organizations (id) values ($1)", [ORG]);
    await db.query("insert into auth.users (id) values ($1)", [USER]);
    client = pgliteSupabase(db);
    const add = async (fields: Record<string, unknown>) => {
      const { record } = await createRecord(client, ORG, USER, fields);
      return { id: record.id, candidateId: record.candidateId };
    };
    asha = await add({ fullName: "Asha", email: "asha@example.com", role: "MEP Supervisor", location: "Bengaluru" });
    // The same person, a second sourcing record (same email): one row per PERSON in a position.
    ashaAgain = await add({ fullName: "Asha", email: "asha@example.com", role: "Technical Executive" });
    bilal = await add({ fullName: "Bilal", role: "BMS Operator", location: "Bengaluru" });
    assert.equal(ashaAgain.candidateId, asha.candidateId);
  });
  beforeEach(() => resetHistoryCheck());
  after(async () => {
    await db.close();
  });

  it("saves a job description as a position with its filters, and lists open ones first", async () => {
    const saved = await createPosition(client, ORG, ME, {
      title: "Sr Technical Executive", location: "SS Plaza, Bengaluru", jdText: "MEP ...", jdFileName: "Sr_TE.pdf",
      filters: { ...EMPTY_FILTERS, keywords: [{ text: "MEP", required: true, alts: ["HVAC"] }], locations: ["Bengaluru"] },
      prefer: { roles: ["Technical Executive"] },
    });
    assert.equal(saved.status, "open");
    assert.equal(saved.targetDays, 21);
    assert.deepEqual(saved.filters.keywords, [{ text: "MEP", required: true, alts: ["HVAC"] }]);
    await assert.rejects(createPosition(client, ORG, ME, { title: "  " }), /title/);
    const full = await getPosition(client, ORG, saved.id);
    assert.equal(full.jdText, "MEP ...");
    const open = await listPositions(client, ORG, "open");
    assert.deepEqual(open.map((p) => p.title), ["Sr Technical Executive"]);
    assert.equal(open[0].jdText, undefined);
  });

  it("adds each person once, moves them with a remark where required, and keeps every move in history", async () => {
    const [position] = await listPositions(client, ORG, "open");
    assert.deepEqual(await addMembers(client, ORG, ME, position.id, [asha.id, ashaAgain.id, bilal.id]), { added: 2, skipped: 0 });
    assert.deepEqual(await addMembers(client, ORG, ME, position.id, [asha.id]), { added: 0, skipped: 1 });
    await assert.rejects(addMembers(client, ORG, ME, position.id, []), /at least one/);

    let members = await listMembers(client, ORG, position.id);
    assert.deepEqual(members.map((m) => [m.record?.fullName, m.stage]).sort(), [["Asha", "sourced"], ["Bilal", "sourced"]]);
    const ashaMember = members.find((m) => m.candidateId === asha.candidateId)!;

    // Owner 2026-11-19: the built-in list (the HR tracker's statuses); "remark needed" stages are tested in stages.test.ts.
    await assert.rejects(moveMember(client, ORG, ME, position.id, ashaMember.id, "hired", "x"), /stage does not exist/);
    await assert.rejects(moveMember(client, ORG, ME, position.id, ashaMember.id, "screening", null), /stage does not exist/);
    const moved = await moveMember(client, ORG, ME, position.id, ashaMember.id, "screening_pending", null);
    assert.equal(moved.stage, "screening_pending");
    const parked = await moveMember(client, ORG, ME, position.id, ashaMember.id, "on_hold", "Prefers the Noida role.");
    assert.deepEqual([parked.stage, parked.remark], ["on_hold", "Prefers the Noida role."]);

    const counted = await getPosition(client, ORG, position.id);
    assert.equal(counted.counts.on_hold, 1);
    assert.equal(counted.counts.sourced, 1);

    const history = await listActions(client, ORG, asha.candidateId);
    assert.deepEqual(history.map((a) => [a.action, a.toValue, a.remark]).slice(0, 3), [
      ["stage_change", "On hold", "Prefers the Noida role."],
      ["stage_change", "Screening Pending", null],
      ["added_to_position", "Sr Technical Executive", null],
    ]);
    assert.equal(history[0].positionId, position.id);

    await removeMember(client, ORG, ME, position.id, ashaMember.id, "Duplicate entry");
    members = await listMembers(client, ORG, position.id);
    assert.deepEqual(members.map((m) => m.record?.fullName), ["Bilal"]);
    // Removed, then added again: a new live row (the old one is kept, marked deleted).
    assert.deepEqual(await addMembers(client, ORG, ME, position.id, [asha.id]), { added: 1, skipped: 0 });
  });

  it("closes and reopens a position, and refuses other statuses", async () => {
    const [position] = await listPositions(client, ORG, "open");
    const closed = await updatePosition(client, ORG, position.id, { status: "closed" });
    assert.equal(closed.status, "closed");
    assert.ok(closed.closedAt);
    assert.deepEqual(await listPositions(client, ORG, "open"), []);
    assert.equal((await listPositions(client, ORG, "closed")).length, 1);
    await assert.rejects(updatePosition(client, ORG, position.id, { status: "paused" }), /open or closed/);
    const reopened = await updatePosition(client, ORG, position.id, { status: "open", targetDays: 30, title: "Sr Technical Executive (SS Plaza)" });
    assert.deepEqual([reopened.status, reopened.closedAt, reopened.targetDays, reopened.title], ["open", null, 30, "Sr Technical Executive (SS Plaza)"]);
  });

  it("keeps the job's details (owner 2026-11-16) and refuses values outside the lists", async () => {
    await db.exec(POSITION_DETAILS_MIGRATION); // safe to re-run
    const saved = await createPosition(client, ORG, ME, {
      title: "Assistant Manager – Business Development", department: "Business Development", location: "Noida",
      designation: "Manager M2", employmentType: "full_time", openings: 2, hiringManager: "Lohitaksha", priority: "high",
      education: "MBA preferred", budgetMinInhand: 60000, budgetMaxInhand: 75000, summary: "Drives enterprise client acquisition for managed offices across Delhi NCR.",
    });
    assert.deepEqual(
      [saved.designation, saved.employmentType, saved.openings, saved.hiringManager, saved.priority, saved.education, saved.budgetMinInhand, saved.budgetMaxInhand],
      ["Manager M2", "full_time", 2, "Lohitaksha", "high", "MBA preferred", 60000, 75000],
    );
    assert.match(saved.summary ?? "", /enterprise client/);
    // The list and the single read carry them; a bare position has the defaults.
    const listed = (await listPositions(client, ORG, "open")).find((p) => p.id === saved.id)!;
    assert.deepEqual([listed.openings, listed.priority, listed.employmentType], [2, "high", "full_time"]);
    const bare = await createPosition(client, ORG, ME, { title: "Bare" });
    assert.deepEqual([bare.openings, bare.priority, bare.employmentType, bare.budgetMaxInhand, bare.summary], [1, "normal", null, null, null]);
    // An edit changes only what it names.
    const edited = await updatePosition(client, ORG, saved.id, { openings: 3, hiringManager: null });
    assert.deepEqual([edited.openings, edited.hiringManager, edited.priority, edited.budgetMaxInhand], [3, null, "high", 75000]);
    await assert.rejects(createPosition(client, ORG, ME, { title: "x", employmentType: "gig" }), /Employment type/);
    await assert.rejects(createPosition(client, ORG, ME, { title: "x", priority: "asap" }), /Priority/);
    await assert.rejects(createPosition(client, ORG, ME, { title: "x", budgetMinInhand: 90000, budgetMaxInhand: 60000 }), /minimum is above/);
    await assert.rejects(createPosition(client, ORG, ME, { title: "x", openings: 0 }), /At least one/);
  });

  it("deletes a position: gone from the lists and from the person, its people taken out with a history entry, nothing erased", async () => {
    const doomed = await createPosition(client, ORG, ME, { title: "Doomed role" });
    assert.deepEqual(await addMembers(client, ORG, ME, doomed.id, [bilal.id]), { added: 1, skipped: 0 });
    assert.ok((await listMemberships(client, ORG, bilal.candidateId)).some((m) => m.position.id === doomed.id));

    assert.deepEqual(await deletePosition(client, ORG, ME, doomed.id), { removed: 1 });
    assert.ok(!(await listPositions(client, ORG, "all")).some((p) => p.id === doomed.id));
    await assert.rejects(getPosition(client, ORG, doomed.id), /no longer exists/);
    await assert.rejects(deletePosition(client, ORG, ME, doomed.id), /no longer exists/);
    assert.ok(!(await listMemberships(client, ORG, bilal.candidateId)).some((m) => m.position.id === doomed.id));

    const [entry] = await listActions(client, ORG, bilal.candidateId);
    assert.deepEqual([entry.action, entry.fromValue, entry.remark, entry.positionId], ["removed_from_position", "Sourced", 'Position "Doomed role" was deleted.', doomed.id]);
    const [row] = (await db.query<{ deleted_at: unknown }>("select deleted_at from public.candidate_positions where id = $1", [doomed.id])).rows;
    assert.ok(row.deleted_at, "the row is kept, marked deleted");
  });
});
