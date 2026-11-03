/**
 * Runs the real Candidate Search migration in in-memory Postgres (PGlite); see db-stub.ts for the vector stub.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import type { PGlite } from "@electric-sql/pglite";

import { AI_MODELS_MIGRATION, freshDb, MIGRATION, vec } from "./db-stub";

const ORG = "00000000-0000-0000-0000-00000000000a";
const OTHER_ORG = "00000000-0000-0000-0000-00000000000b";

describe("candidate_search migration", () => {
  let db: PGlite;

  const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;

  async function sheet(name: string, status = "ready", org = ORG): Promise<string> {
    const [row] = await q<{ id: string }>(
      "insert into public.candidate_sheets (organization_id, name, name_key, status) values ($1, $2, lower($2), $3) returning id",
      [org, name, status],
    );
    return row.id;
  }
  async function person(name: string, location: string, designation: string, org = ORG): Promise<string> {
    const [row] = await q<{ id: string }>(
      "insert into public.candidates (organization_id, full_name, location, current_designation, total_exp_months) values ($1, $2, $3, $4, 60) returning id",
      [org, name, location, designation],
    );
    return row.id;
  }
  async function record(
    candidateId: string,
    sheetId: string | null,
    f: { role: string; rel: number; notice: number; expected: number; text: string; status?: string },
    org = ORG,
  ): Promise<string> {
    const [row] = await q<{ id: string }>(
      `insert into public.candidate_applications
         (organization_id, candidate_id, sheet_id, role, relevant_exp_months, notice_period_days, expected_inhand, search_text, status)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id`,
      [org, candidateId, sheetId, f.role, f.rel, f.notice, f.expected, f.text, f.status ?? "new"],
    );
    return row.id;
  }
  async function search(filters: object = {}, text = "", embedding: string | null = null, prefs: object = {}) {
    return q<{ application_id: string; matching_count: number; keyword_rank: number | null; semantic_rank: number | null }>(
      "select * from public.hybrid_search_candidates($1, $2, $3, $4, $5, 30)",
      [ORG, JSON.stringify(filters), JSON.stringify(prefs), text, embedding],
    );
  }

  let s1: string;
  let a1: string;
  let a2: string;
  let a3: string;
  let manual: string;

  before(async () => {
    db = await freshDb();
    await q("insert into public.organizations (id) values ($1), ($2)", [ORG, OTHER_ORG]);

    s1 = await sheet("June");
    const amit = await person("Amit", "Noida", "MEP Engineer");
    const chiter = await person("Chiter", "Noida", "BMS Operator");
    const vignesh = await person("Vignesh", "Thane", "Building Supervisor");
    a1 = await record(amit, s1, { role: "BMS Operator", rel: 48, notice: 15, expected: 37000, text: "Role sourced for: BMS Operator\nCurrent designation: MEP Engineer", status: "rejected" });
    a2 = await record(chiter, s1, { role: "BMS Operator", rel: 60, notice: 30, expected: 30000, text: "Role sourced for: BMS Operator\nCurrent designation: BMS Operator" });
    a3 = await record(vignesh, s1, { role: "Housekeeping Supervisor", rel: 36, notice: 15, expected: 28000, text: "Role sourced for: Housekeeping Supervisor\nCurrent designation: Building Supervisor" });
    manual = await record(chiter, null, { role: "Facility Executive", rel: 24, notice: 60, expected: 45000, text: "Role sourced for: Facility Executive" });

    const otherSheet = await sheet("June", "ready", OTHER_ORG);
    const outsider = await person("Outsider", "Thane", "BMS Operator", OTHER_ORG);
    await record(outsider, otherSheet, { role: "BMS Operator", rel: 120, notice: 0, expected: 10000, text: "BMS Operator" }, OTHER_ORG);
  });

  after(async () => {
    await db.close();
  });

  const ids = (rows: { application_id: string }[]) => rows.map((r) => r.application_id).sort();

  it("is idempotent", async () => {
    await db.exec(MIGRATION);
  });

  it("returns only this organisation's visible records", async () => {
    const rows = await search();
    assert.deepEqual(ids(rows), [a1, a2, a3, manual].sort());
    assert.equal(rows[0].matching_count, 4);
  });

  it("applies each must-have filter, excluding missing values", async () => {
    assert.deepEqual(ids(await search({ min_relevant_exp_months: 50 })), [a2]);
    assert.deepEqual(ids(await search({ max_notice_days: 20 })), [a1, a3].sort());
    assert.deepEqual(ids(await search({ locations: ["thane"] })), [a3]);
    assert.deepEqual(ids(await search({ roles: ["bms operator"] })), [a1, a2, manual].sort()); // manual: Chiter's designation
    assert.deepEqual(ids(await search({ max_expected_inhand: 30000 })), [a2, a3].sort());
    assert.deepEqual(ids(await search({ exclude_statuses: ["rejected"] })), [a2, a3, manual].sort());
    assert.deepEqual(ids(await search({ statuses: ["rejected"] })), [a1]);
    assert.deepEqual(ids(await search({ min_relevant_exp_months: 36, max_notice_days: 30, roles: ["BMS"] })), [a1, a2].sort());
    const none = await search({ min_relevant_exp_months: 600 });
    assert.equal(none.length, 0);
  });

  it("treats % and _ in a filter as plain text", async () => {
    assert.equal((await search({ roles: ["%"] })).length, 0);
  });

  it("ranks keyword matches first", async () => {
    const rows = await search({}, "housekeeping");
    assert.equal(rows[0].application_id, a3);
    assert.equal(rows[0].keyword_rank, 1);
  });

  it("stores embeddings only when the text still matches, and ranks by meaning", async () => {
    const [{ candidate_set_embeddings: stale }] = await q<{ candidate_set_embeddings: number }>(
      "select public.candidate_set_embeddings($1, 'm')",
      [JSON.stringify([{ id: a1, embedding: vec(0), search_text: "old text" }])],
    );
    assert.equal(stale, 0);

    const texts = await q<{ id: string; search_text: string }>("select id, search_text from public.candidate_applications where id = any($1)", [[a1, a2, a3]]);
    const axis: Record<string, number> = { [a1]: 0, [a2]: 1, [a3]: 2 };
    const [{ candidate_set_embeddings: stored }] = await q<{ candidate_set_embeddings: number }>(
      "select public.candidate_set_embeddings($1, 'm')",
      [JSON.stringify(texts.map((t) => ({ id: t.id, search_text: t.search_text, embedding: vec(axis[t.id]) })))],
    );
    assert.equal(stored, 3);

    const rows = await search({}, "", vec(2));
    const top = rows.find((r) => r.semantic_rank === 1);
    assert.equal(top?.application_id, a3);
  });

  it("orders the structured list by preferences met", async () => {
    const rows = await q<{ application_id: string; structured_rank: number }>(
      "select application_id, structured_rank from public.hybrid_search_candidates($1, '{}', $2, '', null, 30)",
      [ORG, JSON.stringify({ locations: ["Thane"] })],
    );
    assert.equal(rows.find((r) => r.structured_rank === 1)?.application_id, a3);
  });

  it("hides soft-deleted records, and every record of a deleted or unfinished sheet", async () => {
    await q("update public.candidate_applications set deleted_at = now() where id = $1", [a1]);
    assert.deepEqual(ids(await search()), [a2, a3, manual].sort());
    await q("update public.candidate_applications set deleted_at = null where id = $1", [a1]);

    await q("update public.candidate_sheets set deleted_at = now() where id = $1", [s1]);
    assert.deepEqual(ids(await search()), [manual]); // the hand-added record of the same person stays
    const view = await q<{ id: string; sheet_live: boolean }>("select id, sheet_live from public.candidate_records where id = $1", [a2]);
    assert.equal(view[0].sheet_live, false);
    await q("update public.candidate_sheets set deleted_at = null where id = $1", [s1]);

    await q("update public.candidate_sheets set status = 'importing' where id = $1", [s1]);
    assert.deepEqual(ids(await search()), [manual]);
    await q("update public.candidate_sheets set status = 'ready' where id = $1", [s1]);
  });

  it("allows one live sheet per name, and Replace swaps them in one step", async () => {
    await assert.rejects(sheet("june"), /duplicate key|unique/i);

    const s2 = await sheet("June", "importing");
    const [finished] = await q<{ id: string; status: string }>("select * from public.candidate_finish_sheet($1, $2, null)", [s2, s1]);
    assert.equal(finished.status, "ready");
    const [old] = await q<{ deleted_at: string | null }>("select deleted_at from public.candidate_sheets where id = $1", [s1]);
    assert.ok(old.deleted_at);
    assert.deepEqual(ids(await search()), [manual]);

    // undo for the next test
    await q("update public.candidate_sheets set deleted_at = now() where id = $1", [s2]);
    await q("update public.candidate_sheets set deleted_at = null where id = $1", [s1]);
  });

  it("counts records and records waiting for an embedding per sheet", async () => {
    const stats = await q<{ sheet_id: string | null; live_count: number; pending_count: number }>(
      "select * from public.candidate_index_stats($1)",
      [ORG],
    );
    const bySheet = Object.fromEntries(stats.map((s) => [s.sheet_id ?? "manual", [s.live_count, s.pending_count]]));
    assert.deepEqual(bySheet[s1], [3, 0]);
    assert.deepEqual(bySheet.manual, [1, 1]);
  });

  it("builds a lower-case lookup text for the table search", async () => {
    const [row] = await q<{ lookup_text: string }>("select lookup_text from public.candidate_records where id = $1", [a3]);
    assert.match(row.lookup_text, /vignesh .*thane.*housekeeping supervisor/);
  });

  it("lets the Control Center save the two Candidate Search jobs, and still rejects unknown jobs", async () => {
    await q("insert into public.task_manager_ai_models (job, models) values ('candidate_parse', $1), ('candidate_rank', $1)", [["anthropic:claude-haiku-5-5"]]);
    await q("insert into public.task_manager_ai_models (job, models) values ('wa_reply', $1)", [["glm-5.3-flash"]]);
    await assert.rejects(q("insert into public.task_manager_ai_models (job, models) values ('bogus_job', $1)", [["x"]]), /check/i);
    await db.exec(AI_MODELS_MIGRATION); // safe to re-run
    const [{ n }] = await q<{ n: number }>("select count(*)::int as n from public.task_manager_ai_models");
    assert.equal(n, 3, "re-running keeps every saved row");
  });

  it("rejects out-of-range values and unknown statuses", async () => {
    const p = await person("X", "Pune", "Tech");
    await assert.rejects(record(p, null, { role: "r", rel: 1000, notice: 1, expected: 1, text: "" }), /check/i);
    await assert.rejects(record(p, null, { role: "r", rel: 1, notice: 1, expected: 1, text: "", status: "maybe" }), /check/i);
  });
});
