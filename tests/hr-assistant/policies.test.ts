import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  deletePolicy,
  deleteVersion,
  listPolicies,
  PolicyActionError,
  restoreVersion,
} from "../../backend/lib/hr-assistant/policies";
import { FakeSupabase } from "./fake-supabase";

function seed() {
  const db = new FakeSupabase({
    hr_set_live_version: (args, fake) => {
      const target = fake.tables.hr_documents.find((d) => d.id === args.p_document_id)!;
      for (const row of fake.tables.hr_documents) {
        if (row.policy_id === target.policy_id && row.status === "ready") row.status = "archived";
      }
      target.status = "ready";
      return { data: target, error: null };
    },
  });
  db.tables.hr_policies = [{ id: "p-1", title: "Leave_Policy" }];
  db.tables.hr_documents = [
    { id: "v1", policy_id: "p-1", version: 1, status: "archived", storage_path: "a/v1.pdf" },
    { id: "v2", policy_id: "p-1", version: 2, status: "failed", storage_path: "a/v2.pdf" },
    { id: "v3", policy_id: "p-1", version: 3, status: "ready", storage_path: "a/v3.pdf" },
    { id: "v4", policy_id: "p-1", version: 4, status: "processing", storage_path: "a/v4.pdf" },
  ];
  db.tables.hr_policy_chunks = [
    { id: 1, document_id: "v1" },
    { id: 2, document_id: "v3" },
  ];
  return db;
}

const statusOf = (db: FakeSupabase, id: string) => db.tables.hr_documents.find((d) => d.id === id)?.status;

async function rejectsWith(promise: Promise<unknown>, status: number) {
  await assert.rejects(promise, (error) => error instanceof PolicyActionError && error.status === status);
}

describe("restoreVersion", () => {
  it("makes an archived version live and archives the current one", async () => {
    const db = seed();
    await restoreVersion(db.asClient(), "v1");
    assert.equal(statusOf(db, "v1"), "ready");
    assert.equal(statusOf(db, "v3"), "archived");
  });

  it("refuses failed or still-indexing versions, and unknown ids", async () => {
    const db = seed();
    await rejectsWith(restoreVersion(db.asClient(), "v2"), 409);
    await rejectsWith(restoreVersion(db.asClient(), "v4"), 409);
    await rejectsWith(restoreVersion(db.asClient(), "nope"), 404);
    assert.equal(statusOf(db, "v3"), "ready", "live version untouched");
  });
});

describe("deleteVersion", () => {
  it("deletes an archived version with its chunks and file", async () => {
    const db = seed();
    await deleteVersion(db.asClient(), "v1");
    assert.equal(statusOf(db, "v1"), undefined);
    assert.ok(!db.tables.hr_policy_chunks.some((chunk) => chunk.document_id === "v1"));
    assert.deepEqual(db.removedFiles, ["a/v1.pdf"]);
  });

  it("deletes a failed version", async () => {
    const db = seed();
    await deleteVersion(db.asClient(), "v2");
    assert.equal(statusOf(db, "v2"), undefined);
  });

  it("refuses to delete the live or an indexing version", async () => {
    const db = seed();
    await rejectsWith(deleteVersion(db.asClient(), "v3"), 409);
    await rejectsWith(deleteVersion(db.asClient(), "v4"), 409);
    assert.equal(db.tables.hr_documents.length, 4);
  });
});

describe("deletePolicy", () => {
  it("deletes the policy, every version, every chunk and every file", async () => {
    const db = seed();
    await deletePolicy(db.asClient(), "p-1");
    assert.equal(db.tables.hr_policies.length, 0);
    assert.equal(db.tables.hr_documents.length, 0);
    assert.equal(db.tables.hr_policy_chunks.length, 0);
    assert.deepEqual(db.removedFiles.sort(), ["a/v1.pdf", "a/v2.pdf", "a/v3.pdf", "a/v4.pdf"]);
  });

  it("reports a missing policy as 404", async () => {
    const db = seed();
    await rejectsWith(deletePolicy(db.asClient(), "nope"), 404);
  });
});

describe("listPolicies", () => {
  it("returns versions newest first", async () => {
    const db = new FakeSupabase();
    db.tables.hr_policies = [
      {
        id: "p-1",
        title: "Leave_Policy",
        versions: [
          { id: "a", version: 1 },
          { id: "c", version: 3 },
          { id: "b", version: 2 },
        ],
      },
    ];
    const [policy] = await listPolicies(db.asClient());
    assert.deepEqual(
      policy.versions.map((v) => v.version),
      [3, 2, 1],
    );
  });
});
