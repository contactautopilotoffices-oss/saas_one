/**
 * Owner 2026-11-03: records are prepared for meaning search in the background with Jina; a busy service pauses and
 * retries instead of showing HR an error. Runs the real migrations in PGlite; the embedder and fetch are stubs.
 */
import assert from "node:assert/strict";
import { after, afterEach, before, describe, it } from "node:test";

import type { PGlite } from "@electric-sql/pglite";
import type { SupabaseClient } from "@supabase/supabase-js";

import { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL } from "../../backend/lib/candidates/config";
import { EmbedError, geminiEmbeddings, jinaEmbeddings } from "../../backend/lib/candidates/embeddings";
import { indexAllOrganisations, indexOrganisation, type Embedder } from "../../backend/lib/candidates/indexing";
import { createRecord, updateRecord } from "../../backend/lib/candidates/records";
import { listSheets } from "../../backend/lib/candidates/sheets";

import { freshDb, vec } from "./db-stub";
import { pgliteSupabase } from "./pglite-supabase";

const ORG = "00000000-0000-0000-0000-00000000000a";
const OTHER_ORG = "00000000-0000-0000-0000-00000000000b";
const USER = "00000000-0000-0000-0000-000000000001";
const noSleep = async () => {};
const ok: Embedder = async (texts) => texts.map(() => [1, 0.05, 0.05]);
const busy: Embedder = async () => {
  throw new EmbedError("Jina embeddings failed (429): rate limit", true);
};

describe("background indexing (Jina, pause and retry)", () => {
  let db: PGlite;
  let client: SupabaseClient;
  const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;
  const waiting = async (org = ORG) =>
    (await q<{ n: number }>("select count(*)::int as n from public.candidate_pending_embeddings($1, $2, 500)", [org, EMBEDDING_MODEL]))[0].n;
  const unpause = (org = ORG) => q("update public.candidate_index_state set paused_until = now() - interval '1 second' where organization_id = $1", [org]);

  before(async () => {
    db = await freshDb();
    await q("insert into public.organizations (id) values ($1), ($2)", [ORG, OTHER_ORG]);
    await q("insert into auth.users (id) values ($1)", [USER]);
    client = pgliteSupabase(db);
    for (let i = 0; i < 5; i++) await createRecord(client, ORG, USER, { fullName: `P${i}`, email: `p${i}@x.com`, role: `Role ${i}` });
    await createRecord(client, OTHER_ORG, USER, { fullName: "Other", email: "o@x.com", role: "BMS" });
  });
  after(async () => {
    await db.close();
  });

  it("pauses on a busy service without failing, and resumes after the pause", async () => {
    const first = await indexOrganisation(client, ORG, { embed: busy, sleep: noSleep });
    assert.deepEqual(first, { indexed: 0, remaining: 5, waiting: false });
    const [state] = await q<{ failures: number; paused: boolean; last_error: string; lease_until: string | null }>(
      "select failures, paused_until > now() as paused, last_error, lease_until from public.candidate_index_state where organization_id = $1",
      [ORG],
    );
    assert.deepEqual([state.failures, state.paused, state.lease_until], [1, true, null]);
    assert.match(state.last_error, /429/);

    const whilePaused = await indexOrganisation(client, ORG, { embed: ok, sleep: noSleep });
    assert.equal(whilePaused.waiting, true, "a paused organisation is left alone");
    assert.equal(whilePaused.indexed, 0);

    await indexOrganisation(client, ORG, { embed: busy, sleep: noSleep }); // still paused: no second failure counted
    await unpause();
    await indexOrganisation(client, ORG, { embed: busy, sleep: noSleep });
    const [longer] = await q<{ failures: number; minutes: number }>(
      "select failures, round(extract(epoch from paused_until - now()) / 60)::int as minutes from public.candidate_index_state where organization_id = $1",
      [ORG],
    );
    assert.deepEqual([longer.failures, longer.minutes], [2, 2], "second pause is 2 minutes");

    await unpause();
    const resumed = await indexOrganisation(client, ORG, { embed: ok, sleep: noSleep });
    assert.deepEqual(resumed, { indexed: 5, remaining: 0, waiting: false });
    const [cleared] = await q<{ failures: number; paused_until: string | null }>(
      "select failures, paused_until from public.candidate_index_state where organization_id = $1",
      [ORG],
    );
    assert.deepEqual([cleared.failures, cleared.paused_until], [0, null]);
    const [row] = await q<{ embedding_model: string }>("select distinct embedding_model from public.candidate_applications where organization_id = $1", [ORG]);
    assert.equal(row.embedding_model, EMBEDDING_MODEL);
  });

  it("never lets two runs work on the same organisation", async () => {
    await q("update public.candidate_index_state set lease_until = now() + interval '1 minute' where organization_id = $1", [ORG]);
    const blocked = await indexOrganisation(client, ORG, { embed: ok, sleep: noSleep });
    assert.equal(blocked.waiting, true);
    await q("update public.candidate_index_state set lease_until = null where organization_id = $1", [ORG]);
  });

  it("sets aside a record whose text the service keeps rejecting, and retries it when the text changes", async () => {
    const { record } = await createRecord(client, ORG, USER, { fullName: "Bad Text", email: "bad@x.com", role: "REJECT ME" });
    await createRecord(client, ORG, USER, { fullName: "Good Text", email: "good@x.com", role: "Fine" });
    const picky: Embedder = async (texts) => {
      if (texts.some((t) => t.includes("REJECT ME"))) throw new EmbedError("Jina embeddings failed (400): bad input", false);
      return texts.map(() => [1, 0.05, 0.05]);
    };

    const r1 = await indexOrganisation(client, ORG, { embed: picky, sleep: noSleep });
    assert.equal(r1.indexed, 1, "the good record is stored even though its batch was rejected");
    assert.equal(r1.waiting, false);
    for (let i = 0; i < 2; i++) await indexOrganisation(client, ORG, { embed: picky, sleep: noSleep });
    const [bad] = await q<{ embed_attempts: number; set_aside: boolean }>(
      "select embed_attempts, embed_failed_at is not null as set_aside from public.candidate_applications where id = $1",
      [record.id],
    );
    assert.deepEqual([bad.embed_attempts, bad.set_aside], [3, true]);
    assert.equal(await waiting(), 0, "a set-aside record no longer counts as waiting");

    const sheets = await listSheets(client, ORG, false);
    assert.equal(sheets.pendingIndexTotal, 0, "progress treats it as done");

    await updateRecord(client, ORG, USER, record.id, { role: "Now fine" });
    const [reset] = await q<{ embed_attempts: number; embed_failed_at: string | null }>(
      "select embed_attempts, embed_failed_at from public.candidate_applications where id = $1",
      [record.id],
    );
    assert.deepEqual([reset.embed_attempts, reset.embed_failed_at], [0, null], "new text, fresh start");
    assert.equal(await waiting(), 1);
    assert.equal((await indexOrganisation(client, ORG, { embed: picky, sleep: noSleep })).indexed, 1);
  });

  it("re-embeds records stored with another model, and search never compares vectors of different models", async () => {
    await q("update public.candidate_applications set embedding_model = 'some-older-model', embedding = $2 where organization_id = $1", [ORG, vec(1)]);
    assert.equal(await waiting(), 7);
    const progress = await listSheets(client, ORG, false);
    assert.equal(progress.pendingIndexTotal, 7, "old-model records show as being prepared");

    const search = async (model: string | null) =>
      q<{ semantic_rank: number | null }>(
        "select semantic_rank from public.hybrid_search_candidates($1, '{}'::jsonb, '{}'::jsonb, '', $2, 30, 50, $3)",
        [ORG, vec(1), model],
      );
    assert.ok((await search(EMBEDDING_MODEL)).every((r) => r.semantic_rank === null), "vectors of another model are ignored");
    assert.ok((await search(null)).some((r) => r.semantic_rank !== null), "without a model the old behaviour stays");

    assert.equal((await indexOrganisation(client, ORG, { embed: ok, sleep: noSleep })).indexed, 7);
    assert.ok((await search(EMBEDDING_MODEL)).some((r) => r.semantic_rank !== null));
  });

  it("the cron goes through every organisation with work that is not paused", async () => {
    assert.equal(await waiting(OTHER_ORG), 1);
    const state = await q("select 1 from public.candidate_index_state where organization_id = $1", [OTHER_ORG]);
    assert.equal(state.length, 0);
    const result = await indexAllOrganisations(client, { embed: ok, sleep: noSleep });
    assert.deepEqual(result, { organisations: 1, indexed: 1 }, "ORG has nothing left; OTHER_ORG is done");

    await createRecord(client, OTHER_ORG, USER, { fullName: "Other 2", email: "o2@x.com", role: "HK" });
    await indexOrganisation(client, OTHER_ORG, { embed: busy, sleep: noSleep });
    assert.deepEqual(await indexAllOrganisations(client, { embed: ok, sleep: noSleep }), { organisations: 0, indexed: 0 }, "paused: skipped");
  });

  it("stops starting new work when the time budget is nearly used", async () => {
    await unpause(OTHER_ORG);
    let t = 0;
    const result = await indexOrganisation(client, OTHER_ORG, { embed: ok, sleep: noSleep, budgetMs: 5_000, now: () => (t += 1) });
    assert.equal(result.indexed, 0, "5 s budget is under the safety margin");
    assert.equal(await waiting(OTHER_ORG), 1);
  });
});

describe("Jina client", () => {
  const realFetch = globalThis.fetch;
  const realKey = process.env.JINA_API_KEY;
  afterEach(() => {
    globalThis.fetch = realFetch;
    if (realKey === undefined) delete process.env.JINA_API_KEY;
    else process.env.JINA_API_KEY = realKey;
  });

  const respond = (status: number, body: unknown, seen?: { url: string; init: RequestInit }[]) => {
    globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
      seen?.push({ url: String(url), init: init ?? {} });
      return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
    }) as typeof fetch;
  };
  const vector = () => Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) => i / EMBEDDING_DIMENSIONS);

  it("asks for jina-embeddings-v3 at 768 dims, passage task for records and query task for searches", async () => {
    process.env.JINA_API_KEY = "test-key";
    const seen: { url: string; init: RequestInit }[] = [];
    respond(200, { data: [{ index: 1, embedding: vector() }, { index: 0, embedding: vector().map((v) => -v) }] }, seen);
    const out = await jinaEmbeddings.documents(["a", "b"]);
    assert.equal(out.length, 2);
    assert.ok(out[0][1] < 0, "results are put back in input order");
    const body = JSON.parse(String(seen[0].init.body));
    assert.deepEqual([body.model, body.task, body.dimensions, body.input], ["jina-embeddings-v3", "retrieval.passage", 768, ["a", "b"]]);
    assert.equal((seen[0].init.headers as Record<string, string>).Authorization, "Bearer test-key");

    respond(200, { data: [{ index: 0, embedding: vector() }] }, seen);
    await jinaEmbeddings.query("bms operator");
    assert.equal(JSON.parse(String(seen[1].init.body)).task, "retrieval.query");
  });

  it("calls busy, down, unauthorised and missing-key answers retryable, and rejected input not", async () => {
    delete process.env.JINA_API_KEY;
    await assert.rejects(jinaEmbeddings.documents(["a"]), (e: EmbedError) => e.retryable && /JINA_API_KEY/.test(e.message));
    process.env.JINA_API_KEY = "k";
    for (const [status, retryable] of [[429, true], [503, true], [401, true], [400, false], [422, false]] as const) {
      respond(status, "nope");
      await assert.rejects(jinaEmbeddings.documents(["a"]), (e: EmbedError) => e instanceof EmbedError && e.retryable === retryable, String(status));
    }
    respond(200, { data: [{ index: 0, embedding: [1, 2, 3] }] });
    await assert.rejects(jinaEmbeddings.documents(["a"]), (e: EmbedError) => e.retryable && /dimensions/.test(e.message));
  });
});

describe("Gemini client (the default provider)", () => {
  const realFetch = globalThis.fetch;
  const realKeys = { g: process.env.GEMINI_API_KEY, a: process.env.GOOGLE_AI_API_KEY };
  afterEach(() => {
    globalThis.fetch = realFetch;
    for (const [name, value] of [["GEMINI_API_KEY", realKeys.g], ["GOOGLE_AI_API_KEY", realKeys.a]] as const) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
  const respond = (status: number, body: unknown) => {
    globalThis.fetch = (async () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status })) as typeof fetch;
  };
  const vector = () => Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0.1);

  it("is the default and embeds at 768 dims", async () => {
    const { EMBEDDING_PROVIDER } = await import("../../backend/lib/candidates/config");
    if (!process.env.EMBEDDING_PROVIDER) assert.equal(EMBEDDING_PROVIDER, "gemini");
    process.env.GEMINI_API_KEY = "test-key";
    respond(200, { embeddings: [{ values: vector() }, { values: vector() }] });
    assert.equal((await geminiEmbeddings.documents(["a", "b"])).length, 2);
    respond(200, { embeddings: [{ values: vector() }] });
    assert.equal((await geminiEmbeddings.query("bms")).length, EMBEDDING_DIMENSIONS);
  });

  it("calls a busy or exhausted free tier retryable, a rejected input not, and a missing key retryable", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    for (const [status, retryable] of [[429, true], [503, true], [403, true], [400, false]] as const) {
      respond(status, "nope");
      await assert.rejects(geminiEmbeddings.documents(["a"]), (e: EmbedError) => e instanceof EmbedError && e.retryable === retryable, String(status));
    }
    delete process.env.GEMINI_API_KEY;
    delete process.env.GOOGLE_AI_API_KEY;
    await assert.rejects(geminiEmbeddings.documents(["a"]), (e: EmbedError) => e instanceof EmbedError && e.retryable && /GEMINI_API_KEY/.test(e.message));
  });
});
