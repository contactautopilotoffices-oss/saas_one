/**
 * "Already in the database" (owner 2026-11-16; migration 20261116000004). The rule: a CV and the sheet row of the same
 * person are one sourcing and link quietly. A flag means the person came a SECOND time: a second CV for someone who
 * already had one (HR then updates the CV or deletes the copy), or a sheet row for someone already in another sheet or
 * entered by hand. Notes written under the first rule are hidden. Against the real migrations in PGlite.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { after, before, beforeEach, describe, it } from "node:test";

import type { PGlite } from "@electric-sql/pglite";
import type { SupabaseClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";

import { listActions, resetHistoryCheck } from "../../backend/lib/candidates/actions";
import { findLiveSheetByName, importSheet } from "../../backend/lib/candidates/import";
import { knownNote, resetKnownFlagCheck } from "../../backend/lib/candidates/known";
import { parseSheet } from "../../backend/lib/candidates/parse-sheet";
import { createRecord } from "../../backend/lib/candidates/records";
import { processResumeText } from "../../backend/lib/candidates/resume-text";
import { confirmResumeUploads, dismissRepeat, listRepeats, listResumeFiles, parseResumeQuery, prepareResumeUploads, resolveDuplicate, type ResumeStorage } from "../../backend/lib/candidates/resumes";

import { freshDb, SOURCING_MIGRATION } from "./db-stub";
import { pgliteSupabase } from "./pglite-supabase";

const ORG = "00000000-0000-0000-0000-00000000000a";
const USER = "00000000-0000-0000-0000-000000000001";
const HR = { id: USER, email: "hr@x.com" };
const ME = { id: USER, name: "Roohi" };
const USER2 = "00000000-0000-0000-0000-000000000002";
const HR2 = { id: USER2, email: "shwetha@x.com" };
const sha = (name: string) => createHash("sha256").update(name).digest("hex");
const tick = () => new Promise((r) => setTimeout(r, 5));

const HEADERS = ["Sr No.", "Sourcing Date", "Candidate Source", "Candidate Name", "Email ID", "Phone Number", "Current Organization",
  "Location", "Current Designation", "Role", "Total Exp(In)", "Relevant Exp", "Notice Period (In Days)", "Current In Hand",
  "Expected Inhand", "Remark"];
const ASHA_ROW = [1, "16-11-2026", "Naukri", "Asha Rao", "asha@example.com", 9876543210, "Prestige", "Bengaluru", "MEP Supervisor", "Technical Executive", "6 Yrs", "5 Yrs", "30 Days", "40K", "45K", ""];
const BILAL_ROW = [2, "16-11-2026", "Naukri", "Bilal Khan", "bilal@example.com", 9123456780, "Brigade", "Bengaluru", "Technician", "Technical Executive", "4 Yrs", "4 Yrs", "15 Days", "30K", "35K", ""];
const ZED_ROW = [3, "16-11-2026", "Naukri", "Zed Alam", "zed@nowhere.com", 9000000001, "Sobha", "Bengaluru", "Technician", "Technical Executive", "3 Yrs", "3 Yrs", "15 Days", "25K", "30K", ""];

function sheet(rows: unknown[][]): Uint8Array {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([HEADERS, ...rows]), "Sheet1");
  return new Uint8Array(XLSX.write(workbook, { type: "array", bookType: "xlsx" }) as ArrayBuffer);
}

function fakeStorage() {
  const objects = new Set<string>();
  const storage: ResumeStorage = {
    async createSignedUploadUrl(path) { return { data: { signedUrl: `https://storage.test/upload/${path}`, token: "t", path }, error: null }; },
    async createSignedUrl(path) { return { data: { signedUrl: `https://storage.test/get/${path}` }, error: null }; },
    async createSignedUrls(paths) { return { data: paths.map((p) => ({ path: p, signedUrl: `https://storage.test/get/${p}`, error: null })), error: null }; },
    async list(prefix, options) {
      return { data: [...objects].filter((p) => p.startsWith(`${prefix}/`) && (!options?.search || p.includes(options.search))).map((p) => ({ name: p.slice((prefix ?? "").length + 1), metadata: { size: 1000 } })), error: null };
    },
    async remove(paths) { for (const p of paths) objects.delete(p); return { data: [], error: null }; },
    async download(path) { return objects.has(path) ? { data: new Blob([new Uint8Array([1, 2, 3])]), error: null } : { data: null, error: { message: "Object not found" } }; },
  };
  return { storage, objects };
}

const ASHA_CV = "ASHA RAO\nEmail: asha@example.com | Mob: +91 98765 43210\nMEP Supervisor\nExperience: 6 years in facilities";
const TEXTS: Record<string, string> = {
  "Asha CV.pdf": ASHA_CV,
  "Asha CV updated.pdf": `${ASHA_CV}\nUpdated November`,
  "Asha CV again.pdf": `${ASHA_CV}\nSent again`,
  "Someone new.pdf": "Zed Alam\nzed@nowhere.com\n9000000001\nTechnician\nExperience: 3 years",
};
const reader = async (_bytes: Uint8Array, fileName: string): Promise<string> => TEXTS[fileName] ?? "";

describe("already in the database: only a person who came a second time", () => {
  let db: PGlite;
  let client: SupabaseClient;
  let asha: { id: string; candidateId: string };
  const store = fakeStorage();
  const q = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;
  const upload = async (name: string, device = "Roohi") => {
    const prepared = await prepareResumeUploads(client, store.storage, ORG, HR, { device, files: [{ index: 0, name, size: 1000, sha256: sha(name) }] });
    const f = prepared.files[0];
    assert.equal(f.outcome, "upload");
    store.objects.add(`${ORG}/${f.id}.pdf`);
    await confirmResumeUploads(client, store.storage, ORG, [f.id]);
    await processResumeText(client, store.storage, ORG, { read: reader, budgetMs: 30_000 });
    await tick();
    return f.id as string;
  };
  const pending = async () => (await listResumeFiles(client, ORG, parseResumeQuery(new URLSearchParams({ link: "duplicate" })))).files;

  before(async () => {
    db = await freshDb();
    await db.query("insert into public.organizations (id) values ($1)", [ORG]);
    await db.query("insert into auth.users (id) values ($1), ($2)", [USER, USER2]);
    client = pgliteSupabase(db);
    // Asha is on the team's own tracker (entered by hand here) with no CV yet.
    const { record } = await createRecord(client, ORG, USER, { fullName: "Asha Rao", email: "asha@example.com", phone: "9876543210", role: "MEP Supervisor", candidateSource: "Naukri", sourcingDate: "2026-11-09" });
    asha = { id: record.id, candidateId: record.candidateId };
  });
  beforeEach(() => { resetHistoryCheck(); resetKnownFlagCheck(); });
  after(async () => {
    await db.close();
  });

  it("is safe to re-run and knows its own values", async () => {
    await db.exec(SOURCING_MIGRATION);
    const [{ ok }] = await q<{ ok: boolean }>("select exists (select 1 from pg_constraint where conname = 'candidate_actions_action_check' and pg_get_constraintdef(oid) like '%duplicate_flagged%') as ok");
    assert.equal(ok, true);
    await assert.rejects(q("insert into public.candidate_sheets (organization_id, name, name_key, source_kind) values ($1, 'x', 'x', 'friend')", [ORG]), /source_kind_check/);
    await assert.rejects(q("update public.candidate_resume_files set duplicate_state = 'maybe' where organization_id = $1", [ORG]).then(async () => {
      await q("insert into public.candidate_resume_files (organization_id, sha256, file_name, file_type, file_size, storage_path, status, duplicate_state) values ($1, 'x', 'x', 'x', 1, 'x', 'ready', 'maybe')", [ORG]);
    }), /duplicate_state_check/);
  });

  it("words the note without naming where the copy came from", () => {
    assert.equal(knownNote({ at: "2026-11-09", from: "June.xlsx", byName: "Shwetha", sheetId: null }), "Already in the database: sourced 2026-11-09 from June.xlsx by Shwetha");
    assert.equal(knownNote(undefined), "Already in the database");
  });

  it("does not flag a CV that meets its own row", async () => {
    await upload("Asha CV.pdf");
    assert.deepEqual(await pending(), []);
    assert.equal((await listActions(client, ORG, asha.candidateId)).filter((a) => a.action === "duplicate_flagged").length, 0);
    const [file] = (await listResumeFiles(client, ORG, parseResumeQuery(new URLSearchParams({ candidateId: asha.candidateId })))).files;
    assert.deepEqual([file.fileName, file.duplicateState, file.alreadyKnown], ["Asha CV.pdf", null, null]);
  });

  it("flags a second CV, says which CV was on file, and lets HR update the CV", async () => {
    const second = await upload("Asha CV updated.pdf", "Shwetha");
    const [dupe] = await pending();
    assert.deepEqual([dupe.id, dupe.candidateId, dupe.duplicateState], [second, asha.candidateId, "pending"]);
    assert.equal(dupe.alreadyKnown?.previous?.fileName, "Asha CV.pdf");
    assert.equal(dupe.alreadyKnown?.previous?.uploadedBy, "Roohi");
    assert.equal(dupe.alreadyKnown?.sourcedFrom, "added by hand");

    const flag = (await listActions(client, ORG, asha.candidateId)).find((a) => a.action === "duplicate_flagged")!;
    assert.deepEqual([flag.byName, flag.meta.source, flag.meta.fileName, flag.meta.rule], ["Shwetha", "resume", "Asha CV updated.pdf", 2]);
    assert.equal((flag.meta.previous as { fileName: string }).fileName, "Asha CV.pdf");
    assert.equal(flag.meta.sourceKind, undefined, "the note does not say where the copy came from");

    await resolveDuplicate(client, store.storage, ORG, ME, second, "update");
    assert.deepEqual(await pending(), []);
    // The panel lists the newest upload first: the updated CV is the one shown; the earlier one is kept.
    const files = (await listResumeFiles(client, ORG, parseResumeQuery(new URLSearchParams({ candidateId: asha.candidateId })))).files;
    assert.deepEqual(files.map((f) => [f.fileName, f.duplicateState]), [["Asha CV updated.pdf", "updated"], ["Asha CV.pdf", null]]);
    const [updated] = await listActions(client, ORG, asha.candidateId);
    assert.deepEqual([updated.action, updated.toValue, updated.byName], ["resume_attached", "CV updated: Asha CV updated.pdf", "Roohi"]);
    await assert.rejects(resolveDuplicate(client, store.storage, ORG, ME, second, "update"), /no longer waiting/);
  });

  it("deletes a second CV when HR keeps the one on file", async () => {
    const third = await upload("Asha CV again.pdf");
    assert.equal((await pending())[0]?.id, third);
    assert.equal((await pending())[0]?.alreadyKnown?.previous?.fileName, "Asha CV updated.pdf", "the CV on file is the latest one before it");
    await assert.rejects(resolveDuplicate(client, store.storage, ORG, ME, third, "merge"), /update" or "delete/);
    await resolveDuplicate(client, store.storage, ORG, ME, third, "delete");
    assert.deepEqual(await pending(), []);
    assert.equal((await q<{ n: number }>("select count(*)::int as n from public.candidate_resume_files where id = $1", [third]))[0].n, 0);
    assert.equal(store.objects.has(`${ORG}/${third}.pdf`), false);
    const [note] = await listActions(client, ORG, asha.candidateId);
    assert.deepEqual([note.action, note.remark], ["remark", "Second CV deleted (Asha CV again.pdf); the CV on file was kept."]);
  });

  it("names whose copy a same-bytes re-upload is", async () => {
    const again = await prepareResumeUploads(client, store.storage, ORG, HR, { device: "Shwetha", files: [{ index: 0, name: "copy.pdf", size: 1000, sha256: sha("Asha CV.pdf") }] });
    assert.equal(again.files[0].outcome, "duplicate");
    assert.deepEqual([again.files[0].existing?.fileName, again.files[0].existing?.candidateName, again.files[0].existing?.uploadedBy], ["Asha CV.pdf", "Asha Rao", "Roohi"]);
    // The person who uploaded it first, running their folder again: a safe retry, not noted.
    assert.equal((await listRepeats(client, ORG)).total, 0);
  });

  it("notes the same CV uploaded again by someone else, once, until dismissed", async () => {
    const before = (await listActions(client, ORG, asha.candidateId)).filter((a) => a.meta.source === "same_file").length;
    const again = () => prepareResumeUploads(client, store.storage, ORG, HR2, { device: "Shwetha", files: [{ index: 0, name: "Asha.pdf", size: 1000, sha256: sha("Asha CV.pdf") }] });
    assert.equal((await again()).files[0].outcome, "duplicate");
    let { repeats, total } = await listRepeats(client, ORG);
    assert.equal(total, 1);
    assert.deepEqual([repeats[0].fileName, repeats[0].candidateName, repeats[0].againBy, repeats[0].firstBy], ["Asha CV.pdf", "Asha Rao", "Shwetha", "Roohi"]);
    const flags = (await listActions(client, ORG, asha.candidateId)).filter((a) => a.meta.source === "same_file");
    assert.equal(flags.length, before + 1);
    assert.deepEqual([flags[0].action, flags[0].byName, flags[0].meta.fileName, flags[0].meta.firstBy, flags[0].meta.rule], ["duplicate_flagged", "Shwetha", "Asha CV.pdf", "Roohi", 2]);

    // Uploading it once more while the entry is open adds nothing.
    await again();
    assert.equal((await listRepeats(client, ORG)).total, 1);
    assert.equal((await listActions(client, ORG, asha.candidateId)).filter((a) => a.meta.source === "same_file").length, before + 1);

    await dismissRepeat(client, ORG, USER, repeats[0].id);
    ({ repeats, total } = await listRepeats(client, ORG));
    assert.deepEqual([repeats, total], [[], 0]);
    await assert.rejects(dismissRepeat(client, ORG, USER, repeats[0]?.id ?? "00000000-0000-0000-0000-0000000000ff"), /already dismissed/);
    await assert.rejects(dismissRepeat(client, ORG, USER, "nope"), /uuid/);
  });

  it("accepts Naukri as where an upload came from", async () => {
    await q("insert into public.candidate_sheets (organization_id, name, name_key, source_kind) values ($1, 'n', 'n', 'naukri')", [ORG]);
    const prepared = await prepareResumeUploads(client, store.storage, ORG, HR, { device: "Roohi", source: { kind: "naukri", name: null }, files: [{ index: 0, name: "naukri.pdf", size: 1000, sha256: sha("naukri.pdf") }] });
    const [row] = await q<{ source_kind: string }>("select source_kind from public.candidate_resume_files where id = $1", [prepared.files[0].id]);
    assert.equal(row.source_kind, "naukri");
  });

  it("hides notes written under the first rule", async () => {
    await q("insert into public.candidate_actions (organization_id, candidate_id, action, to_value, meta) values ($1, $2, 'duplicate_flagged', 'Already in the database', '{\"source\":\"resume\"}')", [ORG, asha.candidateId]);
    const flags = (await listActions(client, ORG, asha.candidateId)).filter((a) => a.action === "duplicate_flagged");
    assert.ok(flags.length >= 1 && flags.every((a) => a.meta.rule === 2));
  });

  it("flags a sheet row only for someone already in another sheet or entered by hand; a CV-made person is a pairing", async () => {
    // Zed came in only through his CV ("Someone new.pdf" made no candidate here, so make him the way a CV does).
    await createRecord(client, ORG, USER, { fullName: "Zed Alam", email: "zed@nowhere.com", phone: "9000000001", candidateSource: "Resume" });
    const importIt = async (name: string, rows: unknown[][], mode: "new" | "replace" = "new") =>
      importSheet(client, { orgId: ORG, userId: USER, userEmail: "hr@x.com", userName: "Roohi", fileName: name, parsed: parseSheet(sheet(rows), name), mode, existing: await findLiveSheetByName(client, ORG, name) });

    const first = await importIt("Nov tracker.xlsx", [ASHA_ROW, BILAL_ROW, ZED_ROW]);
    assert.deepEqual([first.newCandidates, first.matchedCandidates, first.alreadyKnownRows], [1, 2, 1], "Asha only: Zed's row meets his own CV");
    const rows = await q<{ row_number: number; issues: string[] }>("select row_number, issues from public.candidate_sheet_rows where sheet_id = $1 order by row_number", [first.sheetId]);
    assert.match(rows[0].issues.join(" | "), /^Fixed: Already in the database: sourced 2026-11-\d\d from added by hand/);
    assert.doesNotMatch(rows[0].issues.join(" | "), /via|vendor/);
    assert.deepEqual([rows[1].issues, rows[2].issues], [[], []]);

    const flag = (await listActions(client, ORG, asha.candidateId)).find((a) => a.action === "duplicate_flagged" && a.meta.source === "sheet")!;
    assert.deepEqual([flag.byName, flag.meta.sheetName, flag.meta.rows, flag.meta.rule], ["Roohi", "Nov tracker.xlsx", [2], 2]);

    // The same sheet again as a replace: Bilal was first sourced from it, so he is still not "already there".
    const replaced = await importIt("Nov tracker.xlsx", [ASHA_ROW, BILAL_ROW, ZED_ROW], "replace");
    assert.deepEqual([replaced.newCandidates, replaced.alreadyKnownRows], [0, 1]);
    // A second, different sheet with Bilal: now he is in another sheet.
    const other = await importIt("Dec tracker.xlsx", [BILAL_ROW]);
    assert.equal(other.alreadyKnownRows, 1);
  });
});
