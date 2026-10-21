import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { resolveHrAccess } from "../../backend/lib/hr-assistant/admin";
import {
  createVersion,
  failStaleDocuments,
  ingestDocument,
  INTERRUPTED_MESSAGE,
  policyTitleFromFileName,
  processVersion,
  type HrPolicyVersion,
} from "../../backend/lib/hr-assistant/ingest";
import { FakeSupabase } from "./fake-supabase";

const POLICY = "1. LEAVE POLICY\nEmployees get 20 days of paid annual leave.\n\n".repeat(30);
const fakeEmbed = async (chunks: string[]) => chunks.map(() => [0.1, 0.2, 0.3]);

function quietly<T>(fn: () => Promise<T>): Promise<T> {
  const original = console.error;
  console.error = () => {};
  return fn().finally(() => {
    console.error = original;
  });
}

function makeVersion(overrides: Partial<HrPolicyVersion> = {}): HrPolicyVersion {
  return {
    id: "v-2",
    policy_id: "p-1",
    version: 2,
    name: "Leave_Policy.pdf",
    storage_path: "x/Leave_Policy.pdf",
    mime_type: "application/pdf",
    size_bytes: 1000,
    status: "processing",
    error: null,
    chunk_count: 0,
    uploaded_by: null,
    uploaded_by_email: "hr@acme.test",
    created_at: "2026-10-19T10:00:00Z",
    updated_at: "2026-10-19T10:00:00Z",
    ...overrides,
  };
}

/** A fake DB holding one processing version, whose set-live RPC marks it ready. */
function dbWithVersion(version = makeVersion()) {
  const db = new FakeSupabase({
    hr_set_live_version: (args, fake) => {
      const row = fake.tables.hr_documents.find((d) => d.id === args.p_document_id)!;
      Object.assign(row, { status: "ready", chunk_count: args.p_chunk_count });
      return { data: row, error: null };
    },
  });
  db.tables.hr_documents = [{ ...version }];
  return db;
}

describe("policyTitleFromFileName", () => {
  it("drops the extension", () => {
    assert.equal(policyTitleFromFileName("Leave_Policy.pdf"), "Leave_Policy");
    assert.equal(policyTitleFromFileName("Handbook 2026.DOCX"), "Handbook 2026");
    assert.equal(policyTitleFromFileName("README"), "README");
    assert.equal(policyTitleFromFileName(".pdf"), ".pdf");
  });
});

describe("createVersion", () => {
  it("asks the database for the next version, matching the policy by title", async () => {
    const db = new FakeSupabase({
      hr_create_policy_version: () => ({ data: makeVersion(), error: null }),
    });
    await createVersion(db.asClient(), { name: "Leave_Policy.pdf", uploadedByEmail: "hr@acme.test" });

    assert.equal(db.rpcCalls[0].name, "hr_create_policy_version");
    assert.equal(db.rpcCalls[0].args.p_title, "Leave_Policy");
    assert.equal(db.rpcCalls[0].args.p_policy_id, null);
    assert.equal(db.rpcCalls[0].args.p_uploaded_by_email, "hr@acme.test");
  });

  it("targets a specific policy for 'New version'", async () => {
    const db = new FakeSupabase({
      hr_create_policy_version: () => ({ data: makeVersion(), error: null }),
    });
    await createVersion(db.asClient(), { name: "anything.pdf", policyId: "p-1" });
    assert.equal(db.rpcCalls[0].args.p_policy_id, "p-1");
  });
});

describe("processVersion", () => {
  it("stores the chunks, then makes the version live (only if newer)", async () => {
    const db = dbWithVersion();
    const result = await processVersion(db.asClient(), makeVersion(), POLICY, { embed: fakeEmbed });

    assert.equal(result.status, "ready");
    assert.ok(db.tables.hr_policy_chunks.length > 1);
    assert.ok(db.tables.hr_policy_chunks.every((chunk) => chunk.document_id === "v-2"));
    const setLive = db.rpcCalls.find((call) => call.name === "hr_set_live_version")!;
    assert.deepEqual(setLive.args, {
      p_document_id: "v-2",
      p_chunk_count: db.tables.hr_policy_chunks.length,
      p_only_if_newer: true,
    });
  });

  it("never throws: a failure is recorded on the version and its chunks are removed", async () => {
    const db = dbWithVersion();
    const result = await quietly(() =>
      processVersion(db.asClient(), makeVersion(), POLICY, {
        embed: async () => {
          throw new Error("Gemini is down");
        },
      }),
    );

    assert.equal(result.status, "failed");
    assert.equal(db.tables.hr_documents[0].status, "failed");
    assert.equal(db.tables.hr_documents[0].error, "Gemini is down");
    assert.equal(db.rpcCalls.length, 0, "must not touch the live version");
  });

  it("cleans up stored chunks if making the version live fails", async () => {
    const db = new FakeSupabase({
      hr_set_live_version: () => ({ data: null, error: { message: "deadlock" } }),
    });
    db.tables.hr_documents = [{ ...makeVersion() }];
    const result = await quietly(() =>
      processVersion(db.asClient(), makeVersion(), POLICY, { embed: fakeEmbed }),
    );

    assert.equal(result.status, "failed");
    assert.equal(db.tables.hr_policy_chunks.length, 0);
  });
});

describe("ingestDocument", () => {
  it("creates and indexes in one go, and throws if indexing fails", async () => {
    const db = new FakeSupabase({
      hr_create_policy_version: (_args, fake) => {
        const row = makeVersion();
        fake.tables.hr_documents = [{ ...row }];
        return { data: row, error: null };
      },
      hr_set_live_version: () => ({ data: makeVersion({ status: "ready" }), error: null }),
    });
    const version = await ingestDocument(
      db.asClient(),
      { name: "Leave_Policy.pdf", text: POLICY },
      { embed: fakeEmbed },
    );
    assert.equal(version.status, "ready");

    await assert.rejects(
      quietly(() =>
        ingestDocument(db.asClient(), { name: "Leave_Policy.pdf", text: "   " }, { embed: fakeEmbed }),
      ),
      /no text/,
    );
  });
});

describe("failStaleDocuments", () => {
  it("fails only versions stuck in processing for more than 5 minutes", async () => {
    const db = new FakeSupabase();
    const now = new Date("2026-10-19T12:00:00Z");
    const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000).toISOString();
    db.tables.hr_documents = [
      { id: "stuck", status: "processing", updated_at: minutesAgo(6), error: null },
      { id: "fresh", status: "processing", updated_at: minutesAgo(1), error: null },
      { id: "done", status: "ready", updated_at: minutesAgo(60), error: null },
    ];

    await failStaleDocuments(db.asClient(), now);

    const byId = Object.fromEntries(db.tables.hr_documents.map((d) => [d.id, d]));
    assert.equal(byId.stuck.status, "failed");
    assert.equal(byId.stuck.error, INTERRUPTED_MESSAGE);
    assert.equal(byId.fresh.status, "processing");
    assert.equal(byId.done.status, "ready");
  });
});

describe("resolveHrAccess", () => {
  const facts = (orgRoles: string[], propertyRoles: string[] = [], isMasterAdmin = false) => ({
    isMasterAdmin,
    orgRoles,
    propertyRoles,
  });

  it("makes HR roles, org super admins and master admins HR admins", () => {
    for (const role of ["hr", "hr_head", "hr_manager", "hr_ops", "org_super_admin"]) {
      assert.deepEqual(resolveHrAccess(facts([role])), { canUse: true, isAdmin: true }, role);
    }
    assert.deepEqual(resolveHrAccess(facts([], [], true)), { canUse: true, isAdmin: true });
  });

  it("lets staff chat but not manage documents", () => {
    assert.deepEqual(resolveHrAccess(facts(["procurement"])), { canUse: true, isAdmin: false });
    assert.deepEqual(resolveHrAccess(facts([], ["mst"])), { canUse: true, isAdmin: false });
    // A property-level HR-looking role doesn't grant admin rights.
    assert.deepEqual(resolveHrAccess(facts([], ["hr"])), { canUse: true, isAdmin: false });
  });

  it("keeps tenants, vendors and users without roles out", () => {
    for (const role of ["tenant", "tenant_user", "super_tenant", "vendor", "maintenance_vendor", "client", "resident"]) {
      assert.deepEqual(resolveHrAccess(facts([], [role])), { canUse: false, isAdmin: false }, role);
    }
    assert.deepEqual(resolveHrAccess(facts([])), { canUse: false, isAdmin: false });
  });

  it("lets someone with both an external and a staff role chat", () => {
    assert.deepEqual(resolveHrAccess(facts([], ["tenant", "staff"])), { canUse: true, isAdmin: false });
  });
});
