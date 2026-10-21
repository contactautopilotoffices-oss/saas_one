/** Runs the real migration in in-memory Postgres (PGlite + pgvector). */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { after, before, describe, it } from "node:test";

import { PGlite, type Extension } from "@electric-sql/pglite";

// PGlite >= 0.5 ships pgvector as a separate package that isn't installed here yet.
// Without it this suite is skipped; `npm i -D @electric-sql/pglite-pgvector` turns it on.
const PGVECTOR_PACKAGE = "@electric-sql/pglite-pgvector";
function isInstalled(name: string): boolean {
  try {
    createRequire(path.join(process.cwd(), "package.json")).resolve(name);
    return true;
  } catch {
    return false;
  }
}
const HAS_PGVECTOR = isInstalled(PGVECTOR_PACKAGE);

const MIGRATION = readFileSync(
  path.join("supabase", "migrations", "20261019000001_hr_assistant.sql"),
  "utf8",
);
const HYBRID_MIGRATION = readFileSync(
  path.join("supabase", "migrations", "20261020000001_hr_assistant_hybrid_search.sql"),
  "utf8",
);

// Minimal stand-ins for what Supabase provides out of the box.
const SUPABASE_STUBS = `
  create schema if not exists extensions;
  create schema if not exists auth;
  create table if not exists auth.users (id uuid primary key);
  create or replace function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
  do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
  do $$ begin create role anon; exception when duplicate_object then null; end $$;
  create schema if not exists storage;
  create table if not exists storage.buckets (id text primary key, name text not null, public boolean);
`;

/** A 768-dim vector pointing mostly along `axis`. */
function vectorLiteral(axis: number): string {
  const values = Array.from({ length: 768 }, (_, i) => (i === axis ? 1 : 0.01));
  return `[${values.join(",")}]`;
}

interface VersionRow {
  id: string;
  policy_id: string;
  version: number;
  status: string;
  chunk_count: number;
}

describe("hr_assistant migration", { skip: HAS_PGVECTOR ? false : `${PGVECTOR_PACKAGE} not installed` }, () => {
  let db: PGlite;

  before(async () => {
    const { vector } = (await import(PGVECTOR_PACKAGE)) as { vector: Extension };
    db = new PGlite({ extensions: { vector } });
    await db.exec(SUPABASE_STUBS);
    await db.exec(MIGRATION);
    await db.exec(HYBRID_MIGRATION);
  });

  after(async () => {
    await db.close();
  });

  async function createVersion(name: string, policyId: string | null = null): Promise<VersionRow> {
    const title = name.replace(/\.[^.]+$/, "");
    const { rows } = await db.query<VersionRow>(
      "select * from public.hr_create_policy_version(p_name => $1, p_title => $2, p_policy_id => $3)",
      [name, title, policyId],
    );
    return rows[0];
  }

  async function addChunk(documentId: string, index: number, content: string, axis: number) {
    await db.query(
      `insert into public.hr_policy_chunks (document_id, chunk_index, content, embedding)
       values ($1, $2, $3, $4)`,
      [documentId, index, content, vectorLiteral(axis)],
    );
  }

  async function setLive(id: string, onlyIfNewer = false, chunkCount: number | null = null) {
    const { rows } = await db.query<VersionRow>(
      "select * from public.hr_set_live_version($1, $2, $3)",
      [id, chunkCount, onlyIfNewer],
    );
    return rows[0];
  }

  async function statuses(policyId: string): Promise<Record<number, string>> {
    const { rows } = await db.query<VersionRow>(
      "select version, status from public.hr_documents where policy_id = $1 order by version",
      [policyId],
    );
    return Object.fromEntries(rows.map((row) => [row.version, row.status]));
  }

  async function search(axis: number, count = 10) {
    const { rows } = await db.query<{ source: string; content: string; similarity: number }>(
      "select source, content, similarity from public.match_hr_policy_chunks($1, $2)",
      [vectorLiteral(axis), count],
    );
    return rows;
  }

  it("is idempotent", async () => {
    await db.exec(MIGRATION);
  });

  it("creates the private storage bucket", async () => {
    const { rows } = await db.query<{ public: boolean }>(
      "select public from storage.buckets where id = 'hr-policies'",
    );
    assert.deepEqual(rows, [{ public: false }]);
  });

  describe("versioning", () => {
    it("creates a policy on first upload, then numbers further uploads v2, v3...", async () => {
      const v1 = await createVersion("Leave_Policy.pdf");
      assert.equal(v1.version, 1);
      assert.equal(v1.status, "processing");

      // Same name, different case and extension -> same policy.
      const v2 = await createVersion("leave_policy.docx");
      assert.equal(v2.policy_id, v1.policy_id);
      assert.equal(v2.version, 2);

      // "New version" on a specific policy, whatever the file is called.
      const v3 = await createVersion("Leave rules FINAL.pdf", v1.policy_id);
      assert.equal(v3.policy_id, v1.policy_id);
      assert.equal(v3.version, 3);

      const { rows } = await db.query("select 1 from public.hr_policies");
      assert.equal(rows.length, 1);
    });

    it("rejects a version for a policy that doesn't exist", async () => {
      await assert.rejects(
        createVersion("x.pdf", "00000000-0000-0000-0000-000000000000"),
        /not found/,
      );
    });

    it("makes the new version live and archives the old one, keeping its chunks", async () => {
      const v1 = await createVersion("WFH_Policy.pdf");
      await addChunk(v1.id, 0, "WFH: 2 days per week", 5);
      await setLive(v1.id, true, 1);

      const v2 = await createVersion("WFH_Policy.pdf");
      await addChunk(v2.id, 0, "WFH: 3 days per week", 5);

      // While v2 is indexing, v1 still answers.
      assert.deepEqual((await search(5, 1)).map((r) => r.content), ["WFH: 2 days per week"]);

      const live = await setLive(v2.id, true, 1);
      assert.equal(live.status, "ready");
      assert.equal(live.chunk_count, 1);
      assert.deepEqual(await statuses(v1.policy_id), { 1: "archived", 2: "ready" });

      // Only the live version is searched; v1's chunks are kept for restore.
      assert.deepEqual((await search(5, 1)).map((r) => r.content), ["WFH: 3 days per week"]);
      const { rows } = await db.query("select 1 from public.hr_policy_chunks where document_id = $1", [v1.id]);
      assert.equal(rows.length, 1);
    });

    it("restores an archived version instantly", async () => {
      const v1 = await createVersion("Notice_Policy.pdf");
      await addChunk(v1.id, 0, "Notice: 30 days", 6);
      await setLive(v1.id, true, 1);
      const v2 = await createVersion("Notice_Policy.pdf");
      await addChunk(v2.id, 0, "Notice: 60 days", 6);
      await setLive(v2.id, true, 1);

      await setLive(v1.id); // Restore
      assert.deepEqual(await statuses(v1.policy_id), { 1: "ready", 2: "archived" });
      assert.deepEqual((await search(6, 1)).map((r) => r.content), ["Notice: 30 days"]);
    });

    it("doesn't let a slow older upload override a newer live version", async () => {
      const v1 = await createVersion("Travel_Policy.pdf");
      const v2 = await createVersion("Travel_Policy.pdf");
      await setLive(v2.id, true); // v2 finished first
      const late = await setLive(v1.id, true); // v1 finishes later

      assert.equal(late.status, "archived");
      assert.deepEqual(await statuses(v1.policy_id), { 1: "archived", 2: "ready" });
    });

    it("never makes a failed version live", async () => {
      const v1 = await createVersion("Bonus_Policy.pdf");
      await db.query("update public.hr_documents set status = 'failed' where id = $1", [v1.id]);
      await assert.rejects(setLive(v1.id), /failed version/);
    });

    it("guarantees at most one live version per policy", async () => {
      const v1 = await createVersion("Dress_Code.pdf");
      const v2 = await createVersion("Dress_Code.pdf");
      await setLive(v1.id);
      await assert.rejects(
        db.query("update public.hr_documents set status = 'ready' where id = $1", [v2.id]),
      );
    });
  });

  it("searches only live versions, closest first, with the file name as source", async () => {
    const live = await createVersion("Holidays.pdf");
    await addChunk(live.id, 0, "12 public holidays", 10);
    await addChunk(live.id, 1, "compensatory leave", 11);
    await setLive(live.id);
    const indexing = await createVersion("Holidays.pdf");
    await addChunk(indexing.id, 0, "draft: 14 public holidays", 10);

    const rows = await search(10, 2);
    assert.equal(rows[0].content, "12 public holidays");
    assert.equal(rows[0].source, "Holidays.pdf");
    assert.ok(rows[0].similarity > rows[1].similarity);
    assert.ok(!rows.some((row) => row.content.startsWith("draft")));
  });

  it("deleting a policy deletes its versions and chunks", async () => {
    const v1 = await createVersion("Temp.pdf");
    await addChunk(v1.id, 0, "temp", 20);
    await db.query("delete from public.hr_policies where id = $1", [v1.policy_id]);
    const { rows } = await db.query("select 1 from public.hr_documents where id = $1", [v1.id]);
    const chunks = await db.query("select 1 from public.hr_policy_chunks where document_id = $1", [v1.id]);
    assert.equal(rows.length + chunks.rows.length, 0);
  });

  it("rejects duplicate chunk indexes and unknown statuses", async () => {
    const v1 = await createVersion("Dupes.pdf");
    await addChunk(v1.id, 0, "first", 0);
    await assert.rejects(addChunk(v1.id, 0, "dupe", 0));
    await assert.rejects(
      db.query("update public.hr_documents set status = 'deleted' where id = $1", [v1.id]),
    );
  });

  it("hybrid search ranks an exact keyword match first, even when its vector is far", async () => {
    const v1 = await createVersion("Lop_rules.pdf");
    await db.query(
      `insert into public.hr_policy_chunks (document_id, chunk_index, content, embedding)
       values ($1, 0, 'Loss of pay (LOP) applies when leave is taken without balance.', $2),
              ($1, 1, 'Employees get twenty days of paid annual leave.', $3)`,
      [v1.id, vectorLiteral(7), vectorLiteral(8)],
    );
    await db.query("select public.hr_set_live_version($1, 2)", [v1.id]);
    // The question's vector points at chunk 1, but it names LOP explicitly.
    const { rows } = await db.query<{ content: string }>(
      "select content from public.hybrid_match_hr_policy_chunks($1, $2, 1)",
      ["What is LOP?", vectorLiteral(8)],
    );
    assert.match(rows[0].content, /LOP/);
  });

  it("doesn't let signed-in users call the version functions", async () => {
    const { rows } = await db.query<{ allowed: boolean }>(
      `select has_function_privilege('authenticated',
         'public.hr_set_live_version(uuid, integer, boolean)', 'execute') as allowed`,
    );
    assert.equal(rows[0].allowed, false);
  });

  it("keeps policy text and versions away from signed-in users (server-only reads)", async () => {
    const { rows } = await db.query<{ search: boolean; policies: number }>(
      `select has_function_privilege('authenticated',
         'public.match_hr_policy_chunks(extensions.vector, integer)', 'execute') as search,
       (select count(*)::int from pg_policies
         where tablename in ('hr_documents', 'hr_policy_chunks', 'hr_policies')) as policies`,
    );
    assert.deepEqual(rows[0], { search: false, policies: 0 });
  });

  it("only allows input/output as a blocked stage in logs", async () => {
    await db.query(
      "insert into public.hr_assistant_logs (question, answer, blocked_stage) values ('q', 'a', 'input')",
    );
    await assert.rejects(
      db.query(
        "insert into public.hr_assistant_logs (question, answer, blocked_stage) values ('q', 'a', 'other')",
      ),
    );
  });

  it("has RLS enabled on every table", async () => {
    const { rows } = await db.query<{ relname: string; relrowsecurity: boolean }>(
      `select relname, relrowsecurity from pg_class
       where relname in ('hr_policies', 'hr_documents', 'hr_policy_chunks', 'hr_assistant_logs')
       order by relname`,
    );
    assert.deepEqual(
      rows.map((row) => [row.relname, row.relrowsecurity]),
      [
        ["hr_assistant_logs", true],
        ["hr_documents", true],
        ["hr_policies", true],
        ["hr_policy_chunks", true],
      ],
    );
  });
});
