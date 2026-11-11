/**
 * Resumes linked to candidates (phase 2) against the real migrations in PGlite, with a fake bucket and a scripted text
 * reader: reading text in the background, the contacts found, matching by email then phone (both ways), what HR
 * attaches or detaches by hand, "Has resume" in the filter panel, the list and summary, and the sheet upload count.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { after, before, describe, it } from "node:test";

import type { PGlite } from "@electric-sql/pglite";
import type { SupabaseClient } from "@supabase/supabase-js";

import { DocumentError } from "../../backend/lib/hr-assistant/extract-text";
import { filterRecords, resumeFieldAvailability } from "../../backend/lib/candidates/filter-search";
import { EMPTY_FILTERS, filterChips, type SearchFilters } from "../../backend/lib/candidates/filters";
import { createRecord } from "../../backend/lib/candidates/records";
import {
  contactsInText, linkUnmatched, looksLikeResume, processResumeText, processResumeTextAll, setResumeCandidate, sheetCandidatesWithResume,
} from "../../backend/lib/candidates/resume-text";
import {
  confirmResumeUploads, deleteResumeFiles, listResumeFiles, prepareResumeUploads, resumeOpen, resumeSummary, type ResumeListQuery, type ResumeStorage,
} from "../../backend/lib/candidates/resumes";
import type { PreparedUpload } from "../../backend/lib/candidates/types";

import { freshDb } from "./db-stub";
import { pgliteSupabase } from "./pglite-supabase";

const ORG = "00000000-0000-0000-0000-00000000000a";
const USER = "00000000-0000-0000-0000-000000000001";
const USER_INFO = { id: USER, email: "hr@example.com" };
const TODAY = "2026-11-10";
const sha = (seed: string) => createHash("sha256").update(seed).digest("hex");
const f = (patch: Partial<SearchFilters> = {}): SearchFilters => ({ ...EMPTY_FILTERS, ...patch });
const lq = (over: Partial<ResumeListQuery> = {}): ResumeListQuery => ({ from: null, to: null, q: "", device: null, candidateId: null, link: "", page: 1, pageSize: 50, ...over });

/** A bucket in memory. The bytes do not matter: the scripted reader answers by file name. */
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

/** What each file "says". Missing = unsupported type; "" = no text (a scan); "FLAKY" = a read that keeps failing. */
const RESUME_TAIL = "\nExperience: 6 years in commercial leasing\nEducation: MBA\nSkills: negotiation, CRM";
const TEXTS: Record<string, string> = {
  "Asha Resume.pdf": `ASHA RAO\nEmail: Asha@Example.com | Mob: +91 98765 43210\nSenior Leasing Manager${RESUME_TAIL}`,
  "bilal.docx": `Bilal Khan\nContact 9123456780\nLeasing Executive${RESUME_TAIL}`,
  "chitra.pdf": `Chitra Nair, chitra@example.com, phone 98765-43210 (reference: Asha Rao)${RESUME_TAIL}`,
  // The NUL is what two of the owner's PDFs carried; Postgres refuses it, so the reader must drop it.
  "nobody.pdf": `Zed Alam — zed@nowhere.com — 9000000001\u0000${RESUME_TAIL}`,
  "scan.pdf": "",
  "flaky.pdf": "FLAKY",
  "GET_JD_Digital.pdf": "Job Description\nJob Title: Digital Foundation Lead\nAbout the company: we build offices.\nWe are looking for a leader. Responsibilities: own the roadmap. Requirements: 8+ years. Apply now at careers@example.com",
};

const reader = async (_bytes: Uint8Array, fileName: string): Promise<string> => {
  const text = TEXTS[fileName];
  if (text === undefined) throw new DocumentError(`Unsupported file type ".doc". Use .pdf, .docx.`);
  if (text === "") throw new DocumentError("No text found in this file. Scanned PDFs need to be converted to text (OCR) first.");
  if (text === "FLAKY") throw new Error("socket hang up");
  return text;
};

describe("contacts in a resume's text", () => {
  it("finds emails (lower case, once each) and Indian mobiles in the ways resumes write them", () => {
    const { emails, phones } = contactsInText(
      "Mail: Asha.Rao@Example.com, asha.rao@example.com\nPhone: +91 98765 43210 / 098765-43210, landline 022 2345 6789, PIN 400001, ref 9123456780",
    );
    assert.deepEqual(emails, ["asha.rao@example.com"]);
    assert.deepEqual(phones, ["9876543210", "9123456780"]);
  });
  it("ignores numbers that are not a 10-digit mobile and digits glued to longer numbers", () => {
    assert.deepEqual(contactsInText("Order 123456789012, account 5551234567, emp id 19876543210").phones, []);
    assert.deepEqual(contactsInText("no contacts here").emails, []);
  });
  it("keeps at most ten of each", () => {
    const many = Array.from({ length: 15 }, (_, i) => `p${i}@x.com`).join(" ");
    assert.equal(contactsInText(many).emails.length, 10);
  });
});

describe("is it a resume?", () => {
  const judge = (text: string) => looksLikeResume(text, contactsInText(text));
  it("accepts a resume with contact details and a few resume words, even one that lists responsibilities", () => {
    assert.deepEqual(judge("Vineet Rawat, vineet@x.com, 9876543210. Experience: 5 years. Key responsibilities: admin. Education: B.Com. Skills: Excel"), { verdict: "resume", reason: null });
  });
  it("reads design-template headings that come out letter-spaced (seen on the owner's sample)", () => {
    const canva = "F I N A N C I A L  M A R K E T S  S T U D E N T\nA N S H I  S H E T H\nS K I L L S\nMS Excel\nE D U C A T I O N\nJai Hind College\n9876543210\nanshi@example.com\nL A N G U A G E\nEnglish";
    assert.deepEqual(judge(canva), { verdict: "resume", reason: null });
  });
  it("accepts a resume with both an email and a mobile and nothing document-like, even with few headings", () => {
    assert.equal(judge("Rohan Mehta\nrohan@example.com | 98765 43210\nProfile: facility operations, 4 years at Northgate").verdict, "resume");
  });
  it("accepts a resume without contact details when it clearly reads like one", () => {
    assert.equal(judge("Curriculum Vitae. Objective: … Education: … Experience: … Skills: … Declaration: the above is true").verdict, "resume");
  });
  it("keeps a designer's portfolio as another document instead of removing it", () => {
    const portfolio = judge("Design vision: a refined monochromatic palette. Case study: billboard campaign. Typography and colour palette explorations. Mockups of the watch range.");
    assert.equal(portfolio.verdict, "other");
    assert.match(portfolio.reason ?? "", /reads like a portfolio/);
  });
  it("removes a job description, an invoice and a page with nothing resume-like, and says why", () => {
    const jd = judge("Job Description. We are looking for a Facility Manager. Responsibilities: … Requirements: … Apply now to hr@x.com");
    assert.equal(jd.verdict, "reject");
    assert.match(jd.reason ?? "", /^Not a resume: .*reads like a job description$/);
    const invoice = judge("Tax Invoice No. 1023. GSTIN 27AAAAA. Bill to: Autopilot. Total amount: 45,000. Contact 9876543210");
    assert.match(invoice.reason ?? "", /reads like an invoice or receipt/);
    const bare = judge("Minutes of the meeting held on Monday. Attendees: four. Next steps: none.");
    assert.match(bare.reason ?? "", /no email or phone; does not read like a resume/);
  });
});

describe("resumes linked to candidates", () => {
  let db: PGlite;
  let client: SupabaseClient;
  let store: ReturnType<typeof fakeStorage>;
  const people: Record<string, string> = {};
  const files: Record<string, string> = {};

  const addPerson = async (fullName: string, fields: Record<string, unknown>) => {
    const { record } = await createRecord(client, ORG, USER, { fullName, ...fields });
    people[fullName.split(" ")[0]] = record.candidateId;
    return record;
  };
  const upload = async (names: string[]) => {
    const { files: prepared } = await prepareResumeUploads(client, store.storage, ORG, USER_INFO, {
      device: "Roohi's laptop",
      files: names.map((name, index) => ({ index, name, size: 1000, sha256: sha(name), modifiedAt: "2026-03-01T00:00:00.000Z" })),
    });
    const sent = prepared.filter((p): p is PreparedUpload & { id: string; signedUrl: string } => p.outcome === "upload");
    for (const p of sent) store.objects.add(p.signedUrl.slice("https://storage.test/upload/".length));
    await confirmResumeUploads(client, store.storage, ORG, sent.map((p) => p.id));
    sent.forEach((p, i) => { files[names[i]] = p.id; });
  };
  const row = async (name: string) =>
    (await db.query<{ text_status: string; text_error: string | null; emails: string[]; phones: string[]; candidate_id: string | null; match_reason: string | null; text_attempts: number }>(
      "select text_status, text_error, emails, phones, candidate_id, match_reason, text_attempts from public.candidate_resume_files where id = $1", [files[name]],
    )).rows[0];
  const withResume = async (hasResume: SearchFilters["hasResume"]) => (await filterRecords(client, ORG, f({ hasResume }), 1, 50, TODAY)).records.map((r) => r.fullName).sort();

  before(async () => {
    db = await freshDb();
    await db.query("insert into public.organizations (id) values ($1)", [ORG]);
    await db.query("insert into auth.users (id) values ($1)", [USER]);
    client = pgliteSupabase(db);
    store = fakeStorage();
    await addPerson("Asha Rao", { email: "asha@example.com", phone: "9876543210", role: "Leasing Manager" });
    await addPerson("Bilal Khan", { phone: "+91 91234 56780", role: "Leasing Executive" });
    await addPerson("Chitra Nair", { email: "chitra@example.com", role: "Sales Manager" });
    await addPerson("Dev Patel", { email: "dev@example.com", role: "BMS Operator" });
    await upload(["Asha Resume.pdf", "bilal.docx", "chitra.pdf", "nobody.pdf", "scan.pdf", "old.doc", "flaky.pdf", "GET_JD_Digital.pdf"]);
  });
  after(async () => {
    await db.close();
  });

  it("reads the text, keeps the contacts and links by email first, then phone", async () => {
    const result = await processResumeText(client, store.storage, ORG, { read: reader, budgetMs: 30_000 });
    assert.deepEqual(
      { read: result.read, unreadable: result.unreadable, scans: result.scans, rejected: result.rejected, other: result.other, linked: result.linked, remaining: result.remaining },
      { read: 4, unreadable: 1, scans: 1, rejected: 1, other: 0, linked: 3, remaining: 1 },
    );
    assert.equal(result.failed, 0, "the first failure of flaky.pdf is a retry, not a give-up");

    // The job description: bytes gone, row kept as 'rejected' with the reason, and never uploaded again.
    const jd = await db.query<{ status: string; text_error: string; resume_text: string | null }>("select status, text_error, resume_text from public.candidate_resume_files where id = $1", [files["GET_JD_Digital.pdf"]]);
    assert.deepEqual([jd.rows[0].status, jd.rows[0].resume_text], ["rejected", null]);
    assert.match(jd.rows[0].text_error, /reads like a job description/);
    assert.equal(store.objects.has(`${ORG}/${files["GET_JD_Digital.pdf"]}.pdf`), false, "its bytes were removed");
    const again = await prepareResumeUploads(client, store.storage, ORG, USER_INFO, { device: "Roohi Idrishi", files: [{ index: 0, name: "GET_JD_Digital.pdf", size: 1000, sha256: sha("GET_JD_Digital.pdf") }] });
    assert.equal(again.files[0].outcome, "duplicate", "the next upload skips it");

    const asha = await row("Asha Resume.pdf");
    assert.deepEqual([asha.text_status, asha.emails, asha.phones, asha.candidate_id, asha.match_reason], ["ready", ["asha@example.com"], ["9876543210"], people.Asha, "both"]);
    const bilal = await row("bilal.docx");
    assert.deepEqual([bilal.candidate_id, bilal.match_reason], [people.Bilal, "phone"]);
    // Chitra's resume also carries Asha's number (a reference): the email decides.
    const chitra = await row("chitra.pdf");
    assert.deepEqual([chitra.candidate_id, chitra.match_reason], [people.Chitra, "email"]);
    const nobody = await row("nobody.pdf");
    assert.deepEqual([nobody.text_status, nobody.candidate_id, nobody.emails], ["ready", null, ["zed@nowhere.com"]]);
    const nobodyText = await db.query<{ resume_text: string }>("select resume_text from public.candidate_resume_files where id = $1", [files["nobody.pdf"]]);
    assert.doesNotMatch(nobodyText.rows[0].resume_text, /\u0000/, "the NUL character was dropped before saving");
    assert.match(nobodyText.rows[0].resume_text, /Experience: 6 years/);

    // A PDF with no text is a scan: it waits for the scan reader (resume-scans.test.ts) instead of being given up on.
    const scan = await row("scan.pdf");
    assert.deepEqual([scan.text_status, scan.text_error], ["scan", null]);
    const old = await row("old.doc");
    assert.equal(old.text_status, "unreadable");
    assert.match(old.text_error ?? "", /Old Word format/);
    const flaky = await row("flaky.pdf");
    assert.deepEqual([flaky.text_status, flaky.text_attempts], ["pending", 1]);
    assert.match(flaky.text_error ?? "", /socket hang up/);
  });

  it("a read that keeps failing is given up after three tries; the cron runs every organisation", async () => {
    const second = await processResumeTextAll(client, { read: reader, budgetMs: 30_000, storage: store.storage });
    assert.deepEqual(second, { organisations: 1, read: 0, linked: 0 });
    assert.equal((await row("Asha Resume.pdf")).candidate_id, people.Asha, "files read side by side all kept their results");
    assert.deepEqual([(await row("flaky.pdf")).text_status, (await row("flaky.pdf")).text_attempts], ["pending", 2]);
    const third = await processResumeText(client, store.storage, ORG, { read: reader, budgetMs: 30_000 });
    assert.equal(third.failed, 1);
    assert.deepEqual([(await row("flaky.pdf")).text_status, (await row("flaky.pdf")).text_attempts], ["failed", 3]);
    assert.equal((await processResumeText(client, store.storage, ORG, { read: reader, budgetMs: 30_000 })).remaining, 0);
    // No text means nothing to read details from: the file leaves the extraction queue (it kept the progress bar at 98%).
    const given = await db.query<{ extract_status: string }>("select extract_status from public.candidate_resume_files where id = $1", [files["flaky.pdf"]]);
    assert.equal(given.rows[0].extract_status, "skipped");
  });

  it("a row left at 'working' by a dead run is read again after a while", async () => {
    await db.query("update public.candidate_resume_files set text_status = 'working', updated_at = now() - interval '1 hour' where id = $1", [files["nobody.pdf"]]);
    const result = await processResumeText(client, store.storage, ORG, { read: reader, budgetMs: 30_000 });
    assert.equal(result.read, 1);
    assert.equal((await row("nobody.pdf")).text_status, "ready");
  });

  it("stands aside when enough other runs are already reading this organisation's files", async () => {
    await db.query("update public.candidate_resume_files set text_status = 'working', updated_at = now() where id = $1", [files["nobody.pdf"]]);
    await db.query("update public.candidate_resume_files set text_status = 'pending' where id = $1", [files["chitra.pdf"]]);
    const held = await processResumeText(client, store.storage, ORG, { read: reader, budgetMs: 30_000, maxInflight: 1 });
    assert.deepEqual([held.waiting, held.read, held.remaining], [true, 0, 2]);
    const went = await processResumeText(client, store.storage, ORG, { read: reader, budgetMs: 30_000, maxInflight: 2 });
    assert.deepEqual([went.waiting, went.read], [false, 1], "under the cap it reads what is pending (not the file another run holds)");
    await db.query("update public.candidate_resume_files set text_status = 'ready' where id = $1", [files["nobody.pdf"]]);
    assert.equal((await row("chitra.pdf")).candidate_id, people.Chitra, "a re-read keeps the link");
  });

  it("a candidate added later gets the resume that was waiting for them", async () => {
    await addPerson("Zed Alam", { email: "ZED@nowhere.com", role: "Leasing Manager" });
    assert.equal(await linkUnmatched(client, ORG), 1);
    assert.deepEqual([(await row("nobody.pdf")).candidate_id, (await row("nobody.pdf")).match_reason], [people.Zed, "email"]);
    assert.equal(await linkUnmatched(client, ORG), 0, "nothing left to link");
  });

  it("detaching by hand stops the automatic match; attaching by hand is remembered as manual", async () => {
    await setResumeCandidate(client, ORG, files["nobody.pdf"], null);
    assert.deepEqual([(await row("nobody.pdf")).candidate_id, (await row("nobody.pdf")).match_reason], [null, "detached"]);
    assert.equal(await linkUnmatched(client, ORG), 0);
    assert.equal((await row("nobody.pdf")).candidate_id, null, "a detached file is left alone");

    await setResumeCandidate(client, ORG, files["scan.pdf"], people.Dev);
    assert.deepEqual([(await row("scan.pdf")).candidate_id, (await row("scan.pdf")).match_reason], [people.Dev, "manual"]);
    await assert.rejects(setResumeCandidate(client, ORG, files["scan.pdf"], "00000000-0000-0000-0000-00000000dead"), /candidate no longer exists/);
    await assert.rejects(setResumeCandidate(client, ORG, "nope", null), /uuid/);
    await assert.rejects(setResumeCandidate(client, ORG, files["scan.pdf"], "nope"), /uuid/);
  });

  it("has_resume reaches the filter panel, as a filter and on each record", async () => {
    assert.deepEqual(await withResume("yes"), ["Asha Rao", "Bilal Khan", "Chitra Nair", "Dev Patel"]);
    assert.deepEqual(await withResume("no"), ["Zed Alam"]);
    const all = await filterRecords(client, ORG, f(), 1, 50, TODAY);
    assert.deepEqual(all.records.map((r) => [r.fullName, r.hasResume]).sort(), [["Asha Rao", true], ["Bilal Khan", true], ["Chitra Nair", true], ["Dev Patel", true], ["Zed Alam", false]]);
    const availability = await resumeFieldAvailability(client, ORG);
    assert.equal(availability.applied, true);
    assert.equal(availability.counts.hasResume, 4);
    assert.deepEqual(filterChips(f({ hasResume: "no" })).map((c) => c.label), ["No resume yet"]);
  });

  it("the list and the summary know about the links", async () => {
    const ofAsha = await listResumeFiles(client, ORG, lq({ candidateId: people.Asha }));
    assert.deepEqual(ofAsha.files.map((x) => [x.fileName, x.candidateName, x.matchReason, x.textStatus]), [["Asha Resume.pdf", "Asha Rao", "both", "ready"]]);
    const unlinked = await listResumeFiles(client, ORG, lq({ link: "unlinked" }));
    assert.deepEqual(unlinked.files.map((x) => x.fileName).sort(), ["flaky.pdf", "nobody.pdf", "old.doc"]);
    assert.equal((await listResumeFiles(client, ORG, lq({ link: "linked" }))).total, 4);
    const s = await resumeSummary(client, ORG);
    assert.deepEqual(
      { total: s.total, linked: s.linked, unlinked: s.unlinked, textPending: s.textPending, scanPending: s.scanPending, unreadable: s.unreadable, rejected: s.rejected, extractPending: s.extractPending },
      // scan.pdf still waits for the scan reader: one text step and one details step to go, so the bar is not finished.
      { total: 7, linked: 4, unlinked: 3, textPending: 1, scanPending: 1, unreadable: 2, rejected: 1, extractPending: 5 },
    );
    const removed = await listResumeFiles(client, ORG, lq({ link: "rejected" }));
    assert.deepEqual(removed.files.map((x) => [x.fileName, x.removed, x.textError?.startsWith("Not a resume")]), [["GET_JD_Digital.pdf", true, true]]);
    assert.ok((await listResumeFiles(client, ORG, lq())).files.every((x) => !x.removed), "removed files stay out of the normal list");
  });

  it("opening a resume: PDFs go to the viewer, .docx becomes a page, the rest downloads", async () => {
    const pdf = await resumeOpen(client, store.storage, ORG, files["Asha Resume.pdf"]);
    assert.equal(pdf.kind, "redirect");
    assert.match((pdf as { url: string }).url, /^https:\/\/storage\.test\/get\//);
    const doc = await resumeOpen(client, store.storage, ORG, files["old.doc"]);
    assert.equal(doc.kind, "redirect");
    // The fake bytes are not a Word file: mammoth cannot read them, and the answer is a plain message, not a crash.
    await assert.rejects(resumeOpen(client, store.storage, ORG, files["bilal.docx"]), /could not be shown as a page/);
  });

  it("counts the candidates of a sheet who have a resume", async () => {
    const sheetId = "00000000-0000-0000-0000-00000000005e";
    await db.query("insert into public.candidate_sheets (id, organization_id, name, name_key, status) values ($1, $2, 'r.xlsx', 'r', 'ready')", [sheetId, ORG]);
    await db.query("update public.candidate_applications set sheet_id = $1 where candidate_id = any($2)", [sheetId, [people.Asha, people.Zed]]);
    assert.equal(await sheetCandidatesWithResume(client, ORG, sheetId), 1);
    assert.equal(await sheetCandidatesWithResume(client, ORG, "00000000-0000-0000-0000-00000000005f"), 0);
  });

  it("deletes several files at once, in this organisation only", async () => {
    const before = await listResumeFiles(client, ORG, lq({ link: "rejected" }));
    const { deleted } = await deleteResumeFiles(client, store.storage, ORG, [files["old.doc"], files["flaky.pdf"], before.files[0].id, "00000000-0000-0000-0000-00000000dead"]);
    assert.equal(deleted, 3);
    assert.equal(store.objects.has(`${ORG}/${files["old.doc"]}.doc`), false);
    assert.deepEqual((await listResumeFiles(client, ORG, lq({ link: "unlinked" }))).files.map((x) => x.fileName), ["nobody.pdf"]);
    assert.equal((await resumeSummary(client, ORG)).rejected, 0);
    await assert.rejects(deleteResumeFiles(client, store.storage, ORG, []), /1 to 200/);
  });
});
