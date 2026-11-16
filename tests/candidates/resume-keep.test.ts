/**
 * Needs attention (owner 2026-11-15): "This is a resume" on a document kept aside, and "Allow re-upload" on a file
 * removed as not a resume. Against the real migrations in PGlite with a fake storage.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { after, before, describe, it } from "node:test";

import type { PGlite } from "@electric-sql/pglite";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createRecord } from "../../backend/lib/candidates/records";
import { allowReupload, markAsResume, processResumeText } from "../../backend/lib/candidates/resume-text";
import { confirmResumeUploads, prepareResumeUploads, type ResumeStorage } from "../../backend/lib/candidates/resumes";
import type { PreparedUpload } from "../../backend/lib/candidates/types";

import { freshDb } from "./db-stub";
import { pgliteSupabase } from "./pglite-supabase";

const ORG = "00000000-0000-0000-0000-00000000000a";
const USER = "00000000-0000-0000-0000-000000000001";
const USER_INFO = { id: USER, email: "roohi@example.com" };
const sha = (seed: string) => createHash("sha256").update(seed).digest("hex");

function fakeStorage() {
  const objects = new Set<string>();
  const storage: ResumeStorage = {
    async createSignedUploadUrl(path) {
      return { data: { signedUrl: `https://storage.test/upload/${path}`, token: "t", path }, error: null };
    },
    async createSignedUrl(path) {
      return objects.has(path) ? { data: { signedUrl: `https://storage.test/get/${path}` }, error: null } : { data: null, error: { message: "Object not found" } };
    },
    async createSignedUrls(paths) {
      return { data: paths.map((p) => ({ path: p, signedUrl: `https://storage.test/get/${p}`, error: null })), error: null };
    },
    async list(prefix, options) {
      return { data: [...objects].filter((p) => p.startsWith(`${prefix}/`) && (!options?.search || p.includes(options.search))).map((p) => ({ name: p.slice((prefix ?? "").length + 1), metadata: { size: 1000 } })), error: null };
    },
    async remove(paths) {
      for (const p of paths) objects.delete(p);
      return { data: [], error: null };
    },
    async download(path) {
      return objects.has(path) ? { data: new Blob([new Uint8Array([1, 2, 3])]), error: null } : { data: null, error: { message: "Object not found" } };
    },
  };
  return { storage, objects };
}

// A portfolio: no resume words, so the check keeps it aside. A job description: removed. Both carry a contact.
const PORTFOLIO = "Portfolio of selected works. Gallery, exhibition, client projects 2020-2026. deepak@example.com 9876543210";
const JD = "Job description: we are hiring a Sr Technical Executive. The ideal candidate has MEP experience. Openings in Bengaluru. hr@example.com";

describe("Needs attention: This is a resume, Allow re-upload", () => {
  let db: PGlite;
  let client: SupabaseClient;
  let store: ReturnType<typeof fakeStorage>;
  const texts = new Map<string, string>();
  const read = async (_data: Uint8Array, fileName: string) => texts.get(fileName) ?? "";
  const q = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;

  async function upload(name: string, seed: string): Promise<string> {
    const { files } = await prepareResumeUploads(client, store.storage, ORG, USER_INFO, { device: "Roohi's laptop", files: [{ index: 0, name, size: 1000, sha256: sha(seed) }] });
    const sent = files[0] as PreparedUpload & { id: string; signedUrl: string };
    assert.equal(sent.outcome, "upload", `${name} should be accepted for upload`);
    store.objects.add(sent.signedUrl.slice("https://storage.test/upload/".length));
    await confirmResumeUploads(client, store.storage, ORG, [sent.id]);
    await processResumeText(client, store.storage, ORG, { read, budgetMs: 30_000 });
    return sent.id;
  }

  before(async () => {
    db = await freshDb();
    await db.query("insert into public.organizations (id) values ($1)", [ORG]);
    await db.query("insert into auth.users (id) values ($1)", [USER]);
    client = pgliteSupabase(db);
    store = fakeStorage();
    await createRecord(client, ORG, USER, { fullName: "Deepak", email: "deepak@example.com", role: "Designer" });
  });
  after(async () => {
    await db.close();
  });

  it("marks a kept-aside document as a resume: linked by its contact at once, details queued, never judged again", async () => {
    texts.set("Profile_Deepak.pdf", PORTFOLIO);
    const id = await upload("Profile_Deepak.pdf", "deepak");
    // Put the file where the check leaves a portfolio (the check itself has its own tests): kept aside, not matched.
    await db.query("update public.candidate_resume_files set status = 'other', text_error = 'Other document (kept, not matched): reads like a portfolio', candidate_id = null, match_reason = null, matched_at = null, extract_status = 'skipped' where id = $1", [id]);
    let [row] = await q<{ status: string; candidate_id: string | null; extract_status: string }>("select status, candidate_id, extract_status from public.candidate_resume_files where id = $1", [id]);
    assert.deepEqual([row.status, row.candidate_id, row.extract_status], ["other", null, "skipped"]);

    await markAsResume(client, ORG, id);
    [row] = await q("select status, candidate_id, extract_status from public.candidate_resume_files where id = $1", [id]);
    assert.equal(row.status, "ready");
    assert.ok(row.candidate_id, "linked to Deepak by his email");
    assert.equal(row.extract_status, "pending");
    const [{ keep }] = await q<{ keep: boolean }>("select keep_as_resume as keep from public.candidate_resume_files where id = $1", [id]);
    assert.equal(keep, true);

    // Read again later (a re-run): the verdict is not revisited.
    await db.query("update public.candidate_resume_files set text_status = 'pending' where id = $1", [id]);
    await processResumeText(client, store.storage, ORG, { read, budgetMs: 30_000 });
    [row] = await q("select status, candidate_id, extract_status from public.candidate_resume_files where id = $1", [id]);
    assert.equal(row.status, "ready");

    await assert.rejects(markAsResume(client, ORG, id), /Only a document kept aside/);
  });

  it("lets a removed file be uploaded again, and keeps it as a resume the second time", async () => {
    texts.set("Sr_TE_JD.pdf", JD);
    const id = await upload("Sr_TE_JD.pdf", "jd");
    let [row] = await q<{ status: string; text_error: string | null }>("select status, text_error from public.candidate_resume_files where id = $1", [id]);
    assert.equal(row.status, "rejected");
    assert.match(row.text_error ?? "", /job description/);

    // The same file again: a duplicate, as before.
    const again = await prepareResumeUploads(client, store.storage, ORG, USER_INFO, { device: "Roohi's laptop", files: [{ index: 0, name: "Sr_TE_JD.pdf", size: 1000, sha256: sha("jd") }] });
    assert.equal(again.files[0].outcome, "duplicate");

    await assert.rejects(allowReupload(client, ORG, "00000000-0000-0000-0000-00000000dead"), /no longer here/);
    await allowReupload(client, ORG, id);
    const back = await upload("Sr_TE_JD.pdf", "jd");
    assert.equal(back, id, "the same row is reused");
    [row] = await q("select status, text_error from public.candidate_resume_files where id = $1", [id]);
    assert.deepEqual([row.status, row.text_error], ["ready", null]);
    await assert.rejects(allowReupload(client, ORG, id), /Only a file removed/);
  });
});
