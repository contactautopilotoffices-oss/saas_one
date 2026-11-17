/**
 * The candidate's panel opened from the pipeline (owner 2026-11-17): how the person compares with the position, and
 * the interview and feedback notes filed under it (history entries, insert-only, against the real migrations).
 */
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import type { PGlite } from "@electric-sql/pglite";
import type { SupabaseClient } from "@supabase/supabase-js";

import { addPositionNote, addRemark, listActions, resetHistoryCheck } from "../../backend/lib/candidates/actions";
import { EMPTY_FILTERS } from "../../backend/lib/candidates/filters";
import { positionFit } from "../../backend/lib/candidates/position-fit";
import { addMembers, createPosition, listMembers, removeMember } from "../../backend/lib/candidates/positions";
import { createRecord, getRecord } from "../../backend/lib/candidates/records";
import type { CandidateRecord, Position } from "../../backend/lib/candidates/types";

import { freshDb } from "./db-stub";
import { pgliteSupabase } from "./pglite-supabase";

const ORG = "00000000-0000-0000-0000-00000000000a";
const USER = "00000000-0000-0000-0000-000000000001";
const ME = { id: USER, name: "Shwetha" };

describe("the panel from the pipeline", () => {
  let db: PGlite;
  let client: SupabaseClient;
  let position: Position;
  let other: Position;
  let asha: CandidateRecord;

  before(async () => {
    db = await freshDb();
    await db.query("insert into public.organizations (id) values ($1)", [ORG]);
    await db.query("insert into auth.users (id) values ($1)", [USER]);
    client = pgliteSupabase(db);
    const { record } = await createRecord(client, ORG, USER, {
      fullName: "Asha Rao", email: "asha@example.com", location: "Bengaluru", totalExpMonths: 72, noticePeriodDays: 45, expectedInhand: 55000,
    });
    asha = await getRecord(client, ORG, record.id);
    position = await createPosition(client, ORG, ME, {
      title: "Sr Technical Executive", location: "Bengaluru",
      filters: { ...EMPTY_FILTERS, expMin: 4, expMax: 8, notice: ["15", "30"], keywords: [{ text: "MEP", required: true, alts: [] }, { text: "BMS", required: false, alts: [] }] },
      budgetMinInhand: 40000, budgetMaxInhand: 50000, education: "B.E. Electrical",
    });
    other = await createPosition(client, ORG, ME, { title: "Other role" });
    await addMembers(client, ORG, ME, position.id, [asha.id]);
  });
  beforeEach(() => resetHistoryCheck());
  after(async () => {
    await db.close();
  });

  it("compares only what is on record, and lists the must-haves to check", () => {
    const fit = positionFit(asha, position);
    assert.deepEqual(fit.checks.map((c) => [c.key, c.verdict]), [["experience", "meets"], ["notice", "off"], ["salary", "off"], ["location", "meets"]]);
    assert.deepEqual([fit.met, fit.known], [2, 4]);
    assert.equal(fit.checks[0].detail, "6 yrs · wants 4–8 yrs");
    assert.equal(fit.checks[1].detail, "45 days · wants 30 days or less");
    assert.match(fit.checks[2].detail, /₹55,000\/month · budget ₹40,000–₹50,000\/month/);
    assert.deepEqual([fit.mustHaves, fit.education], [["MEP"], "B.E. Electrical"]);

    const unknown = positionFit({ ...asha, totalExpMonths: null, noticePeriodDays: null, expectedInhand: null, location: null, extras: undefined }, position);
    assert.ok(unknown.checks.every((c) => c.verdict === "unknown"));
    assert.deepEqual([unknown.met, unknown.known], [0, 0]);
    // A city they would move to counts.
    const mover = positionFit({ ...asha, location: "Pune", extras: { ...(asha.extras as NonNullable<CandidateRecord["extras"]>), preferredLocations: ["Bengaluru"] } }, position);
    assert.equal(mover.checks.find((c) => c.key === "location")?.verdict, "meets");
    // A position with nothing set has nothing to compare.
    assert.deepEqual(positionFit(asha, other).checks, []);
  });

  it("files an interview and a round's feedback under the position, as history", async () => {
    await addPositionNote(client, ORG, ME, asha.id, { kind: "interview", positionId: position.id, at: "2026-11-20T15:30", mode: "video", interviewer: "Rahul" });
    await addPositionNote(client, ORG, ME, asha.id, { kind: "feedback", positionId: position.id, round: "Round 1 · HR", rating: 4, recommendation: "move_ahead", note: "Strong on HVAC." });
    const [feedback, interview] = await listActions(client, ORG, asha.candidateId);
    assert.deepEqual([interview.action, interview.toValue, interview.positionId, interview.byName], ["remark", "Interview scheduled", position.id, "Shwetha"]);
    assert.deepEqual(interview.meta, { kind: "interview", at: "2026-11-20T15:30", interviewer: "Rahul", mode: "video" });
    assert.deepEqual([feedback.toValue, feedback.remark, feedback.meta.rating, feedback.meta.recommendation], ["Interview feedback", "Strong on HVAC.", 4, "move_ahead"]);
    // The stage is not moved by a note.
    assert.equal((await listMembers(client, ORG, position.id))[0].stage, "sourced");
  });

  it("refuses a note that is incomplete or for a position the person is not in", async () => {
    await assert.rejects(addPositionNote(client, ORG, ME, asha.id, { kind: "interview", positionId: position.id, at: "tomorrow" }), /date and time/);
    await assert.rejects(addPositionNote(client, ORG, ME, asha.id, { kind: "feedback", positionId: position.id, round: "R1", rating: 6, recommendation: "hold", note: "x" }), /5/);
    await assert.rejects(addPositionNote(client, ORG, ME, asha.id, { kind: "feedback", positionId: position.id, round: "R1", rating: 3, recommendation: "hold", note: " " }), /Write the feedback/);
    await assert.rejects(addPositionNote(client, ORG, ME, asha.id, { kind: "offer", positionId: position.id }), /./);
    await assert.rejects(addPositionNote(client, ORG, ME, asha.id, { kind: "feedback", positionId: other.id, round: "R1", rating: 3, recommendation: "hold", note: "x" }), /no longer in that position/);
    await assert.rejects(addPositionNote(client, ORG, ME, asha.id, { kind: "feedback", positionId: "nope", round: "R1", rating: 3, recommendation: "hold", note: "x" }), /uuid/);
  });

  it("files a remark under the position when asked, and only while the person is in it", async () => {
    await addRemark(client, ORG, ME, asha.id, "Called, will confirm by Friday.", position.id);
    const [latest] = await listActions(client, ORG, asha.candidateId);
    assert.deepEqual([latest.remark, latest.positionId], ["Called, will confirm by Friday.", position.id]);
    await addRemark(client, ORG, ME, asha.id, "General note.");
    assert.equal((await listActions(client, ORG, asha.candidateId))[0].positionId, null);
    await assert.rejects(addRemark(client, ORG, ME, asha.id, "x", other.id), /no longer in that position/);

    const [member] = await listMembers(client, ORG, position.id);
    await removeMember(client, ORG, ME, position.id, member.id, null);
    await assert.rejects(addRemark(client, ORG, ME, asha.id, "late", position.id), /no longer in that position/);
  });
});
