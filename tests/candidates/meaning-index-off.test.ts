/**
 * Owner 2026-11-12: the meaning-search index is switched off unless CANDIDATE_MEANING_INDEX is "on". Off, nothing is
 * sent to the embedding service and a sheet never shows as "being prepared". Runs the real migrations in PGlite.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import type { PGlite } from "@electric-sql/pglite";
import type { SupabaseClient } from "@supabase/supabase-js";

import { EMBEDDING_MODEL, meaningIndexOn } from "../../backend/lib/candidates/config";
import { indexAllOrganisations, indexOrganisation, indexPending, type Embedder } from "../../backend/lib/candidates/indexing";
import { createRecord } from "../../backend/lib/candidates/records";
import { listSheets } from "../../backend/lib/candidates/sheets";

import { freshDb } from "./db-stub";
import { pgliteSupabase } from "./pglite-supabase";

const ORG = "00000000-0000-0000-0000-00000000000a";
const USER = "00000000-0000-0000-0000-000000000001";

describe("meaning-search index switched off", () => {
  let db: PGlite;
  let client: SupabaseClient;
  let calls = 0;
  const counted: Embedder = async (texts) => { calls += 1; return texts.map(() => [1, 0.05, 0.05]); };
  const waiting = async () =>
    (await db.query<{ n: number }>("select count(*)::int as n from public.candidate_pending_embeddings($1, $2, 500)", [ORG, EMBEDDING_MODEL])).rows[0].n;

  before(async () => {
    delete process.env.CANDIDATE_MEANING_INDEX;
    db = await freshDb();
    await db.query("insert into public.organizations (id) values ($1)", [ORG]);
    await db.query("insert into auth.users (id) values ($1)", [USER]);
    client = pgliteSupabase(db);
    for (let i = 0; i < 4; i++) await createRecord(client, ORG, USER, { fullName: `P${i}`, email: `p${i}@x.com`, role: `Role ${i}` });
  });
  after(async () => {
    delete process.env.CANDIDATE_MEANING_INDEX;
    await db.close();
  });

  it("is off unless the environment says on", () => {
    assert.equal(meaningIndexOn(), false);
    process.env.CANDIDATE_MEANING_INDEX = " ON ";
    assert.equal(meaningIndexOn(), true);
    process.env.CANDIDATE_MEANING_INDEX = "yes";
    assert.equal(meaningIndexOn(), false);
    delete process.env.CANDIDATE_MEANING_INDEX;
  });

  it("off: no run sends anything to the embedding service", async () => {
    assert.equal(await waiting(), 4, "the records have no vectors");
    const none = { indexed: 0, remaining: 0, waiting: false };
    assert.deepEqual(await indexOrganisation(client, ORG, { embed: counted, sleep: async () => {} }), none);
    assert.deepEqual(await indexPending(client, ORG, { embed: counted, sleep: async () => {} }), none);
    assert.deepEqual(await indexAllOrganisations(client, { embed: counted, sleep: async () => {} }), { organisations: 0, indexed: 0 });
    assert.equal(calls, 0);
    assert.equal(await waiting(), 4, "nothing was written");
  });

  it("off: the sheet list shows nothing as being prepared", async () => {
    const { pendingIndexTotal, sheets } = await listSheets(client, ORG, false);
    assert.equal(pendingIndexTotal, 0);
    assert.ok(sheets.every((s) => s.pendingIndexCount === 0));
  });

  it("on again: the work resumes where it stopped", async () => {
    process.env.CANDIDATE_MEANING_INDEX = "on";
    assert.equal((await listSheets(client, ORG, false)).pendingIndexTotal, 4);
    assert.equal((await indexOrganisation(client, ORG, { embed: counted, sleep: async () => {} })).indexed, 4);
    assert.ok(calls > 0);
    assert.equal(await waiting(), 0);
    delete process.env.CANDIDATE_MEANING_INDEX;
  });
});
