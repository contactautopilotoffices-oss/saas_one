/**
 * The pipeline's stages as a list HR edits (owner 2026-11-19; migration 20261119000001): the built-in list, the old
 * ten before the migration, the people the migration moves, saving (keys kept on rename, no delete while people are
 * in a stage, hidden stages, "remark needed", two people saving at once) and the history. Against the real migrations.
 */
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import type { PGlite } from "@electric-sql/pglite";
import type { SupabaseClient } from "@supabase/supabase-js";

import { listActions, resetHistoryCheck } from "../../backend/lib/candidates/actions";
import { addMembers, createPosition, listMembers, moveMember } from "../../backend/lib/candidates/positions";
import { createRecord } from "../../backend/lib/candidates/records";
import {
  boardColumns, DEFAULT_STAGES, describeChanges, nextRoundStage, oneLine, parseStageList, reasonNeeded, rejectStageFor, withReason, STAGE_KIND_LABELS, STAGE_KINDS, StageListError, toStageKind, type StageDef, type StageInput,
} from "../../backend/lib/candidates/stage-list";
import { loadStages, saveStages } from "../../backend/lib/candidates/stages";

import { freshDb, STAGES_MIGRATION } from "./db-stub";
import { pgliteSupabase } from "./pglite-supabase";

const ORG = "00000000-0000-0000-0000-00000000000a";
const USER = "00000000-0000-0000-0000-000000000001";
const ME = { id: USER, name: "Roohi" };

const input = (stages: readonly StageDef[]): StageInput[] => stages.map(({ unlisted: _u, ...s }) => { void _u; return s; });

describe("the stage list (pure)", () => {
  it("groups the built-in list into the tracker's rounds, in order", () => {
    assert.deepEqual(boardColumns(DEFAULT_STAGES).map((c) => [c.name, c.stages.length]), [
      ["Sourced", 1], ["Screening", 2], ["L1 · Hiring Manager", 3], ["L2 · Assignment / HOD", 2], ["L3 · Senior Mgmt / HOD", 1],
      ["Director", 1], ["Final", 2], ["Salary discussion", 1], ["Offer", 1], ["Joined", 1],
    ]);
    assert.equal(nextRoundStage(DEFAULT_STAGES, "l1_select")?.key, "l2_pending");
    assert.equal(rejectStageFor(DEFAULT_STAGES, "l1_pending")?.key, "l1_reject");
    // No reject in the round (Director): the first rejected stage of the list.
    assert.equal(rejectStageFor(DEFAULT_STAGES, "director_pending")?.key, "screening_reject");
    assert.equal(nextRoundStage(DEFAULT_STAGES, "backout"), null);
  });

  it("has three types, and reads the old \"selected\" type as Active", () => {
    // Owner 2026-11-20: "In progress" and "Selected" behaved the same, so they are one type, Active.
    assert.deepEqual([...STAGE_KINDS], ["progress", "rejected", "out"]);
    assert.equal(STAGE_KIND_LABELS.progress, "Active");
    assert.equal(toStageKind("selected"), "progress");
    assert.equal(toStageKind("pink"), null);
    const base = input(DEFAULT_STAGES);
    assert.equal(parseStageList([{ ...base[0], kind: "selected" }])[0].kind, "progress");
    assert.ok(DEFAULT_STAGES.every((s) => STAGE_KINDS.includes(s.kind)));
  });

  it("asks a reason to reject, and to move someone back a round (owner 2026-11-21)", () => {
    assert.equal(reasonNeeded(DEFAULT_STAGES, "l1_pending", "l1_reject"), "reject");
    assert.equal(reasonNeeded(DEFAULT_STAGES, "l2_pending", "l1_pending"), "back");
    assert.equal(reasonNeeded(DEFAULT_STAGES, "l1_pending", "l2_pending"), null);
    assert.equal(reasonNeeded(DEFAULT_STAGES, "l1_pending", "backout"), null, "out of the flow is not a round");
    assert.equal(reasonNeeded(DEFAULT_STAGES, "l1_pending", "l1_pending"), null);
    assert.equal(withReason("Salary mismatch", "  asked 40k "), "Salary mismatch — asked 40k");
    assert.equal(withReason("Other", " "), "Other");
  });

  it("refuses a list HR could not work with, in plain words", () => {
    const base = input(DEFAULT_STAGES);
    assert.throws(() => parseStageList([]), /at least one stage/);
    assert.throws(() => parseStageList([...base, { ...base[1], key: null }]), /Two stages are called "Screening Pending"/);
    assert.throws(() => parseStageList(base.map((s) => ({ ...s, kind: "out" }))), /at least one stage on the board/);
    assert.throws(() => parseStageList([{ ...base[0], name: "  " }]), /has no name/);
    assert.throws(() => parseStageList([{ ...base[0], tone: "pink" }]), /colour/);
    assert.throws(() => parseStageList([{ ...base[0], message: "x".repeat(401) }]), StageListError);
    // A WhatsApp parameter is one line: line breaks become spaces.
    assert.equal(parseStageList([{ ...base[0], message: "Line one.\n\nLine  two." }])[0].message, "Line one. Line two.");
    assert.equal(oneLine("a\tb\r\nc"), "a b c");
    // Out of the flow has no column; in the flow without one, the stage is its own column.
    const [out, own] = parseStageList([{ ...base[15], column: "ignored" }, { ...base[0], column: "" }]);
    assert.deepEqual([out.column, own.column], [null, "Sourced"]);
  });

  it("says what a save changed", () => {
    const after = DEFAULT_STAGES.map((s) => (s.key === "backout" ? { ...s, name: "Back out" } : s.key === "on_hold" ? { ...s, hidden: true } : s));
    assert.equal(describeChanges(DEFAULT_STAGES, after), "Renamed Backout → Back out · hid On hold");
    assert.equal(describeChanges(DEFAULT_STAGES, DEFAULT_STAGES), "");
  });
});

describe("stages before and after the migration", () => {
  let db: PGlite;
  let client: SupabaseClient;
  let positionId: string;
  const people: Record<string, string> = {};

  before(async () => {
    db = await freshDb({ stages: false });
    await db.query("insert into public.organizations (id) values ($1)", [ORG]);
    await db.query("insert into auth.users (id) values ($1)", [USER]);
    client = pgliteSupabase(db);
    positionId = (await createPosition(client, ORG, ME, { title: "Assistant Manager – Accounts", location: "Vadodara" })).id;
    for (const name of ["Aarti", "Bhavin", "Chirag", "Disha"]) {
      const { record } = await createRecord(client, ORG, USER, { fullName: name, role: "Accountant" });
      await addMembers(client, ORG, ME, positionId, [record.id]);
      people[name] = record.candidateId;
    }
  });
  beforeEach(() => resetHistoryCheck());
  after(async () => {
    await db.close();
  });

  it("keeps the earlier ten stages until the migration, and cannot edit them", async () => {
    const list = await loadStages(client, ORG);
    assert.equal(list.source, "legacy");
    assert.equal(list.stages.length, 10);
    const members = await listMembers(client, ORG, positionId);
    const member = (name: string) => members.find((m) => m.candidateId === people[name])!;
    assert.deepEqual(members.map((m) => m.stage), ["sourced", "sourced", "sourced", "sourced"]);
    await moveMember(client, ORG, ME, positionId, member("Aarti").id, "shortlisted", null);
    await moveMember(client, ORG, ME, positionId, member("Bhavin").id, "screening", null);
    await assert.rejects(moveMember(client, ORG, ME, positionId, member("Chirag").id, "others", ""), /remark is required/);
    await moveMember(client, ORG, ME, positionId, member("Chirag").id, "others", "Wants Surat");
    await assert.rejects(saveStages(client, ORG, ME, { stages: input(list.stages), version: null }), /database update first/);
  });

  it("moves people to the new names, keeps Others as a stage still shown, and is safe to re-run", async () => {
    await db.exec(STAGES_MIGRATION);
    await db.exec(STAGES_MIGRATION);
    const stageOf = async (name: string) => (await listMembers(client, ORG, positionId)).find((m) => m.candidateId === people[name])!.stage;
    assert.deepEqual([await stageOf("Aarti"), await stageOf("Bhavin"), await stageOf("Chirag"), await stageOf("Disha")], ["l1_pending", "screening_pending", "others", "sourced"]);
    const list = await loadStages(client, ORG, { detail: true });
    assert.equal(list.source, "default");
    assert.equal(list.version, null);
    const others = list.stages.find((s) => s.key === "others")!;
    assert.deepEqual([others.unlisted, others.kind, others.needsRemark, list.counts?.others], [true, "out", true, 1]);
    assert.deepEqual([list.counts?.l1_pending, list.counts?.sourced, list.counts?.joined], [1, 1, 0]);
    assert.deepEqual(list.changes, []);
    // The database now takes any stage key, and only keys.
    await assert.rejects(db.query("update public.candidate_position_members set stage = 'L1 Pending'"), /stage_key_check/);
  });

  it("saves HR's list: renames keep everyone, new stages get a key, hidden stages take nobody new", async () => {
    const list = await loadStages(client, ORG, { detail: true });
    const edited = input(list.stages)
      .map((s) => (s.key === "l1_pending" ? { ...s, name: "L1 Interview Pending" } : s))
      .map((s) => (s.key === "backout" ? { ...s, hidden: true } : s))
      .map((s) => (s.key === "screening_reject" ? { ...s, needsRemark: true } : s));
    edited.splice(10, 0, { key: null, name: "L4 Pending", column: "L4 · CFO", kind: "progress", tone: "amber", whatsapp: true, message: "You have been selected for the\nCFO round.", needsRemark: false, hidden: false });
    const saved = await saveStages(client, ORG, ME, { stages: edited, version: list.version });
    assert.equal(saved.source, "saved");
    const l4 = saved.stages.find((s) => s.name === "L4 Pending")!;
    assert.match(l4.key, /^l4_pending_[0-9a-f]{6}$/);
    assert.equal(l4.message, "You have been selected for the CFO round.");
    assert.ok(boardColumns(saved.stages).some((c) => c.name === "L4 · CFO"));
    const summary = saved.changes?.[0].summary ?? "";
    for (const part of ["added L4 Pending", "renamed L1 Pending → L1 Interview Pending", "hid Backout", "Screening Reject: remark needed"]) assert.ok(summary.toLowerCase().includes(part.toLowerCase()), summary);
    assert.equal(saved.changes?.[0].byName, "Roohi");

    const members = await listMembers(client, ORG, positionId);
    const aarti = members.find((m) => m.candidateId === people.Aarti)!;
    assert.equal(aarti.stage, "l1_pending", "a rename never moves anyone");
    const disha = members.find((m) => m.candidateId === people.Disha)!;
    await assert.rejects(moveMember(client, ORG, ME, positionId, disha.id, "backout", "x"), /hidden/);
    await assert.rejects(moveMember(client, ORG, ME, positionId, disha.id, "screening_reject", ""), /remark is required/);
    await moveMember(client, ORG, ME, positionId, disha.id, l4.key, null);
    const [entry] = await listActions(client, ORG, people.Disha);
    assert.deepEqual([entry.fromValue, entry.toValue], ["Sourced", "L4 Pending"]);
  });

  it("refuses to delete a stage people are in, and a save made on an old copy", async () => {
    const list = await loadStages(client, ORG, { detail: true });
    const withoutL1 = input(list.stages).filter((s) => s.key !== "l1_pending");
    await assert.rejects(saveStages(client, ORG, ME, { stages: withoutL1, version: list.version }), /People are still in L1 Interview Pending \(1 person\)/);
    // An empty stage goes; the key is kept in the table (never reused).
    const withoutJoined = input(list.stages).filter((s) => s.key !== "joined");
    const saved = await saveStages(client, ORG, ME, { stages: withoutJoined, version: list.version });
    assert.ok(!saved.stages.some((s) => s.key === "joined"));
    assert.match(saved.changes?.[0].summary ?? "", /Deleted Joined/);
    const [{ n }] = (await db.query<{ n: number }>("select count(*)::int as n from public.recruitment_stages where key = 'joined' and deleted_at is not null")).rows;
    assert.equal(n, 1);
    // Someone saved in between: the older copy is refused.
    await assert.rejects(saveStages(client, ORG, ME, { stages: withoutJoined, version: list.version }), /Someone else changed the stages/);
    // Nothing changed: nothing is written.
    const again = await saveStages(client, ORG, ME, { stages: input(saved.stages), version: saved.version });
    assert.equal(again.changes?.length, saved.changes?.length);
    // The history is insert-only.
    await assert.rejects(db.query("delete from public.recruitment_stage_changes"), /insert-only/);
  });

  it("starts new people at the list's first stage", async () => {
    const list = await loadStages(client, ORG, { detail: true });
    const stages = input(list.stages);
    const first = stages.findIndex((s) => s.key === "screening_pending");
    const [moved] = stages.splice(first, 1);
    stages.unshift(moved);
    await saveStages(client, ORG, ME, { stages, version: list.version });
    const { record } = await createRecord(client, ORG, USER, { fullName: "Esha", role: "Accountant" });
    await addMembers(client, ORG, ME, positionId, [record.id]);
    const esha = (await listMembers(client, ORG, positionId)).find((m) => m.candidateId === record.candidateId)!;
    assert.equal(esha.stage, "screening_pending");

    // Owner 2026-11-21 (spec): rejecting needs a reason; so does moving back a round; moving forward does not.
    const { stages: now } = await loadStages(client, ORG);
    const reject = rejectStageFor(now, "screening_pending")!;
    await assert.rejects(moveMember(client, ORG, ME, positionId, esha.id, reject.key, null), /reason|remark is required/);
    const next = nextRoundStage(now, "screening_pending")!;
    await moveMember(client, ORG, ME, positionId, esha.id, next.key, null);
    await assert.rejects(moveMember(client, ORG, ME, positionId, esha.id, "screening_pending", null), /needs a reason/);
    await moveMember(client, ORG, ME, positionId, esha.id, "screening_pending", "Interviewer asked for a second screening.");
    const rejected = await moveMember(client, ORG, ME, positionId, esha.id, reject.key, "Salary mismatch");
    assert.equal(rejected.stage, reject.key);
  });
});
