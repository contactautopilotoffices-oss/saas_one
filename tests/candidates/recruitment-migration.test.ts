/**
 * Migration 20261115000002 (owner 2026-11-15): the "Others" status, the blacklist hidden from every search path,
 * positions and their members, and the insert-only history. Against the real migrations in PGlite.
 */
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import type { PGlite } from "@electric-sql/pglite";
import type { SupabaseClient } from "@supabase/supabase-js";

import { clearBlacklist, listActions, loadBlacklist, recordAction, resetHistoryCheck, setBlacklist } from "../../backend/lib/candidates/actions";
import { filterOptions, filterRecords, keywordCounts, resetBlacklistColumnCheck } from "../../backend/lib/candidates/filter-search";
import { EMPTY_FILTERS, type SearchFilters } from "../../backend/lib/candidates/filters";
import { createRecord, listRecords, resetListBlacklistCheck, updateRecord } from "../../backend/lib/candidates/records";

import { freshDb, RECRUITMENT_MIGRATION } from "./db-stub";
import { pgliteSupabase } from "./pglite-supabase";

const ORG = "00000000-0000-0000-0000-00000000000a";
const USER = "00000000-0000-0000-0000-000000000001";
const TODAY = "2026-11-15";
const ME = { id: USER, name: "Roohi" };

const f = (patch: Partial<SearchFilters> = {}): SearchFilters => ({ ...EMPTY_FILTERS, ...patch });

describe("recruitment migration: Others, blacklist, positions, history", () => {
  let db: PGlite;
  let client: SupabaseClient;
  let asha: { id: string; candidateId: string };
  let bilal: { id: string; candidateId: string };
  const q = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;
  const names = async (filters: SearchFilters) => (await filterRecords(client, ORG, filters, 1, 50, TODAY)).records.map((r) => r.fullName).sort();

  before(async () => {
    db = await freshDb();
    await db.query("insert into public.organizations (id) values ($1)", [ORG]);
    await db.query("insert into auth.users (id) values ($1)", [USER]);
    client = pgliteSupabase(db);
    const add = async (fullName: string, fields: Record<string, unknown>) => {
      const { record } = await createRecord(client, ORG, USER, { fullName, ...fields });
      return { id: record.id, candidateId: record.candidateId };
    };
    asha = await add("Asha", { role: "BMS Operator", currentDesignation: "BMS Operator", location: "Thane", remark: "bms" });
    bilal = await add("Bilal", { role: "BMS Operator", currentDesignation: "Technician", location: "Thane", remark: "bms" });
    await add("Chitra", { role: "Leasing Manager", location: "Mumbai", remark: "leasing" });
  });
  beforeEach(() => { resetBlacklistColumnCheck(); resetHistoryCheck(); resetListBlacklistCheck(); });
  after(async () => {
    await db.close();
  });

  it("is safe to re-run", async () => {
    await db.exec(RECRUITMENT_MIGRATION);
    const [{ n }] = await q<{ n: number }>("select count(*)::int as n from pg_proc where proname = 'hybrid_search_candidates'");
    assert.equal(n, 1);
  });

  it("accepts the Others status and still rejects unknown ones", async () => {
    const saved = await updateRecord(client, ORG, USER, asha.id, { status: "others" });
    assert.equal(saved.status, "others");
    await assert.rejects(q("update public.candidate_applications set status = 'maybe' where id = $1", [asha.id]), /status_check/);
    await updateRecord(client, ORG, USER, asha.id, { status: "new" });
  });

  it("hides a blacklisted person from the list, the counts, the dropdown and the free-text search, unless asked", async () => {
    assert.deepEqual(await names(f({ keywords: [{ text: "bms", required: true }] })), ["Asha", "Bilal"]);
    const entry = await setBlacklist(client, ORG, ME, bilal.candidateId, { reason: "did_not_join", remark: "Accepted on 1 Nov, never came." });
    assert.equal(entry.reason, "did_not_join");
    assert.equal(entry.byName, "Roohi");

    assert.deepEqual(await names(f({ keywords: [{ text: "bms", required: true }] })), ["Asha"]);
    assert.deepEqual(await names(f()), ["Asha", "Chitra"]);
    assert.deepEqual((await keywordCounts(client, ORG, ["bms"], TODAY))[0].count, 1);
    const option = (await filterOptions(client, ORG, "keyword", "bms oper", TODAY)).find((o) => o.text === "BMS Operator");
    assert.equal(option?.count, 1);
    const rows = await q<{ application_id: string; matching_count: number }>("select * from public.hybrid_search_candidates($1, '{}', '{}', 'bms', null, 30)", [ORG]);
    assert.ok(!rows.some((r) => r.application_id === bilal.id));
    assert.equal(rows[0]?.matching_count, 2);

    // Asked for: back in the list, and marked.
    const shown = await filterRecords(client, ORG, f({ showBlacklisted: true }), 1, 50, TODAY);
    assert.deepEqual(shown.records.map((r) => [r.fullName, r.blacklisted]).sort(), [["Asha", false], ["Bilal", true], ["Chitra", false]]);

    // The Candidates table: hidden by default, alone on request, everyone with "all".
    assert.deepEqual((await listRecords(client, ORG, {})).records.map((r) => r.fullName).sort(), ["Asha", "Chitra"]);
    assert.deepEqual((await listRecords(client, ORG, { blacklisted: "only" })).records.map((r) => [r.fullName, r.blacklisted]), [["Bilal", true]]);
    assert.equal((await listRecords(client, ORG, { blacklisted: "all" })).total, 3);

    // Undone by any HR user, with the reason kept in history.
    await clearBlacklist(client, ORG, ME, bilal.candidateId, "Confirmed it was a different Bilal.");
    assert.equal(await loadBlacklist(client, ORG, bilal.candidateId), null);
    assert.deepEqual(await names(f({ keywords: [{ text: "bms", required: true }] })), ["Asha", "Bilal"]);
    const history = await listActions(client, ORG, bilal.candidateId);
    assert.deepEqual(history.map((a) => [a.action, a.toValue ?? a.fromValue, a.byName]), [["unblacklist", "did_not_join", "Roohi"], ["blacklist", "did_not_join", "Roohi"]]);
    assert.equal(history[1].remark, "Accepted on 1 Nov, never came.");
  });

  it("refuses a blacklist without a reason from the list", async () => {
    await assert.rejects(setBlacklist(client, ORG, ME, asha.candidateId, { reason: "dislike" }), /reason/);
    await assert.rejects(setBlacklist(client, ORG, ME, asha.candidateId, {}), /reason/);
  });

  it("keeps history insert-only", async () => {
    await recordAction(client, ORG, ME, { candidateId: asha.candidateId, applicationId: asha.id, action: "status_change", fromValue: "new", toValue: "others", remark: "Moved to the Bengaluru requirement." });
    const [row] = await q<{ id: string }>("select id from public.candidate_actions where candidate_id = $1 order by created_at desc limit 1", [asha.candidateId]);
    await assert.rejects(q("update public.candidate_actions set remark = 'x' where id = $1", [row.id]), /insert-only/);
    await assert.rejects(q("delete from public.candidate_actions where id = $1", [row.id]), /insert-only/);
    const history = await listActions(client, ORG, asha.candidateId);
    assert.equal(history[0].action, "status_change");
    assert.equal(history[0].toValue, "others");
  });

  it("holds positions and one live member per person per position", async () => {
    const [pos] = await q<{ id: string }>(
      "insert into public.candidate_positions (organization_id, title, location, jd_text, filters, created_by) values ($1, 'Sr Technical Executive', 'Bengaluru', 'MEP ...', '{\"keywords\":[]}', $2) returning id",
      [ORG, USER],
    );
    await q("insert into public.candidate_position_members (organization_id, position_id, candidate_id, application_id, added_by) values ($1, $2, $3, $4, $5)", [ORG, pos.id, asha.candidateId, asha.id, USER]);
    await assert.rejects(
      q("insert into public.candidate_position_members (organization_id, position_id, candidate_id) values ($1, $2, $3)", [ORG, pos.id, asha.candidateId]),
      /one_per_position/,
    );
    // Owner 2026-11-19 (migration 20261119000001): any stage key of HR's list, but only a key.
    await assert.rejects(q("update public.candidate_position_members set stage = 'Hired!' where position_id = $1", [pos.id]), /stage_key_check/);
    await q("update public.candidate_position_members set stage = 'others', remark = 'Moved to another role' where position_id = $1", [pos.id]);
    const [m] = await q<{ stage: string }>("select stage from public.candidate_position_members where position_id = $1", [pos.id]);
    assert.equal(m.stage, "others");
  });
});
