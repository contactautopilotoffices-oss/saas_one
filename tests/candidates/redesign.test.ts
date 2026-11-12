/**
 * The server side of the redesign (owner 2026-11-11), against the real migrations in PGlite: resume lines around the
 * search keywords, where a record came from ("From resume" / "Added manually"), the resume fields HR can now correct,
 * "has a resume" in the Candidates table, the full record behind the candidate's panel, the resume's text for that
 * panel, and the uploader's name taken from the login.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { after, before, describe, it } from "node:test";

import type { PGlite } from "@electric-sql/pglite";
import type { SupabaseClient } from "@supabase/supabase-js";

import { filterRecords, getFullRecord } from "../../backend/lib/candidates/filter-search";
import { EMPTY_FILTERS, type SearchFilters } from "../../backend/lib/candidates/filters";
import { createRecord, listRecords, updateRecord } from "../../backend/lib/candidates/records";
import { processResumeText } from "../../backend/lib/candidates/resume-text";
import { confirmResumeUploads, prepareResumeUploads, resumeFileText, uploaderName, type ResumeStorage } from "../../backend/lib/candidates/resumes";
import { markKeywords, resumeSnippet } from "../../backend/lib/candidates/snippet";
import { originLabel, recordOrigin, RESUME_SOURCE, type CandidateRecord, type PreparedUpload } from "../../backend/lib/candidates/types";
import { recordsToCsv, telHref, whatsappHref } from "../../frontend/components/candidates/export-csv";
import { formatDateShort } from "../../frontend/components/candidates/format";

import { freshDb } from "./db-stub";
import { pgliteSupabase } from "./pglite-supabase";

const ORG = "00000000-0000-0000-0000-00000000000a";
const USER = "00000000-0000-0000-0000-000000000001";
const USER_INFO = { id: USER, email: "priya.sharma@example.com" };
const TODAY = "2026-11-11";
const sha = (seed: string) => createHash("sha256").update(seed).digest("hex");
const f = (patch: Partial<SearchFilters> = {}): SearchFilters => ({ ...EMPTY_FILTERS, ...patch });

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

const ASHA_RESUME =
  "ASHA RAO\nasha@example.com | 98765 43210\nSenior Facility Manager\n\nEXPERIENCE\nRan BMS and HVAC operations for a 12-floor commercial tower in Mumbai, " +
  "leading 14 technicians.\nCut unplanned downtime by a third.\n\nEDUCATION\nMBA Operations\n\nSKILLS\nBMS, HVAC, fire systems, vendor management";

describe("resume lines around the keywords", () => {
  it("marks each keyword where it starts a word and keeps the line readable", () => {
    const parts = resumeSnippet(ASHA_RESUME, ["BMS", "hvac"]);
    assert.ok(parts);
    // Every place a keyword stands inside the stretch is marked (here: the experience line and the skills line).
    assert.deepEqual([...new Set(parts.filter((p) => p.hit).map((p) => p.text))], ["BMS", "HVAC"]);
    assert.ok(parts.filter((p) => !p.hit).every((p) => !/\bBMS\b|\bHVAC\b/.test(p.text)), "no keyword is left unmarked");
    const line = parts.map((p) => p.text).join("");
    assert.match(line, /Ran BMS and HVAC operations for a 12-floor commercial tower in Mumbai/);
    assert.ok(line.length <= 240, "one card's worth of text");
    assert.match(line, /^… /, "says that the resume starts earlier");
  });
  it("prefers the stretch that holds the most different keywords", () => {
    const text = `BMS mentioned alone here. ${"filler words ".repeat(40)}Later: fire systems and BMS and vendor management together.`;
    const line = (resumeSnippet(text, ["BMS", "fire systems", "vendor management"]) ?? []).map((p) => p.text).join("");
    assert.match(line, /fire systems and BMS and vendor management/);
  });
  it("does not mark letters inside another word, and gives nothing when no keyword is there", () => {
    assert.equal(resumeSnippet("Handled the Thumbs-up campaign for Colombo.", ["bms", "mba"]), null);
    assert.equal(resumeSnippet("", ["bms"]), null);
    assert.equal(resumeSnippet(ASHA_RESUME, []), null);
    assert.deepEqual((resumeSnippet("An MBA from Mumbai.", ["mba"]) ?? []).filter((p) => p.hit).map((p) => p.text), ["MBA"]);
  });
  it("treats a keyword as words, not as a pattern", () => {
    const parts = resumeSnippet("Skills: C++ (5 yrs), .NET", ["c++", ".net"]);
    assert.deepEqual((parts ?? []).filter((p) => p.hit).map((p) => p.text), ["C++", ".NET"]);
  });
});

describe("where a record came from", () => {
  it("names the sheet, a resume or a person", () => {
    assert.equal(recordOrigin({ sheetId: "s", sheetName: "October leads", candidateSource: "Naukri" }), "sheet");
    assert.equal(originLabel({ sheetId: "s", sheetName: "October leads", candidateSource: "Naukri" }), "October leads");
    assert.equal(originLabel({ sheetId: null, sheetName: null, candidateSource: RESUME_SOURCE }), "From resume");
    assert.equal(originLabel({ sheetId: null, sheetName: null, candidateSource: "Referral" }), "Added manually");
    assert.equal(originLabel({ sheetId: null, sheetName: null, candidateSource: null }), "Added manually");
  });
});

describe("the redesign's server side", () => {
  let db: PGlite;
  let client: SupabaseClient;
  let store: ReturnType<typeof fakeStorage>;
  let asha: { id: string; candidateId: string };
  let zed: { id: string; candidateId: string };
  let dev: { id: string; candidateId: string };
  let fileId: string;

  before(async () => {
    db = await freshDb();
    await db.query("insert into public.organizations (id) values ($1)", [ORG]);
    await db.query("insert into auth.users (id) values ($1)", [USER]);
    client = pgliteSupabase(db);
    store = fakeStorage();
    const add = async (body: Record<string, unknown>) => {
      const { record } = await createRecord(client, ORG, USER, body);
      return { id: record.id, candidateId: record.candidateId };
    };
    asha = await add({ fullName: "Asha Rao", email: "asha@example.com", role: "Facility Manager", candidateSource: "Referral" });
    zed = await add({ fullName: "Zed Alam", email: "zed@example.com", candidateSource: RESUME_SOURCE });
    dev = await add({ fullName: "Dev Patel", phone: "9123456780" });

    // Asha's resume: uploaded, read, matched by email.
    const { files } = await prepareResumeUploads(client, store.storage, ORG, USER_INFO, {
      device: "Priya Sharma", files: [{ index: 0, name: "Asha_Rao_Resume.pdf", size: 1000, sha256: sha("asha") }],
    });
    const sent = files[0] as PreparedUpload & { id: string; signedUrl: string };
    store.objects.add(sent.signedUrl.slice("https://storage.test/upload/".length));
    await confirmResumeUploads(client, store.storage, ORG, [sent.id]);
    fileId = sent.id;
    await processResumeText(client, store.storage, ORG, { read: async () => ASHA_RESUME, budgetMs: 30_000 });
    // What the details reader leaves on the person (phase 4).
    await db.query("update public.candidates set resume_text = $1, resume_summary = $2 where id = $3", [ASHA_RESUME, "Facility manager with eight years in commercial real estate.", asha.candidateId]);
  });
  after(async () => {
    await db.close();
  });

  it("a keyword search returns the resume lines around the keywords, only for candidates whose resume holds them", async () => {
    const found = await filterRecords(client, ORG, f({ keywords: [{ text: "BMS", required: true }] }), 1, 20, TODAY);
    assert.deepEqual(found.records.map((r) => r.fullName), ["Asha Rao"]);
    const parts = found.records[0].resumeSnippet ?? [];
    assert.deepEqual([...new Set(parts.filter((p) => p.hit).map((p) => p.text.toUpperCase()))], ["BMS"]);
    assert.match(parts.map((p) => p.text).join(""), /Ran BMS and HVAC operations/);
    assert.equal(found.records[0].hasResume, true);

    const all = await filterRecords(client, ORG, f(), 1, 20, TODAY);
    assert.ok(all.records.every((r) => r.resumeSnippet === undefined), "no keywords, no lines");
    // A keyword found on the record but not in a resume: the candidate is listed, with no lines.
    const byName = await filterRecords(client, ORG, f({ keywords: [{ text: "Zed", required: true }] }), 1, 20, TODAY);
    assert.deepEqual(byName.records.map((r) => [r.fullName, r.resumeSnippet]), [["Zed Alam", undefined]]);
  });

  it("the Candidates table knows who has a resume and tells typed-in records from resume-made ones", async () => {
    const all = await listRecords(client, ORG, {});
    assert.deepEqual(
      all.records.map((r) => [r.fullName, r.hasResume, originLabel(r)]).sort(),
      [["Asha Rao", true, "Added manually"], ["Dev Patel", false, "Added manually"], ["Zed Alam", false, "From resume"]],
    );
    assert.deepEqual((await listRecords(client, ORG, { sheetId: "manual" })).records.map((r) => r.fullName).sort(), ["Asha Rao", "Dev Patel"]);
    assert.deepEqual((await listRecords(client, ORG, { sheetId: "resume" })).records.map((r) => r.fullName), ["Zed Alam"]);
  });

  it("HR can correct what a resume filled in: industry, education, skills and where they would move", async () => {
    await updateRecord(client, ORG, USER, asha.id, {
      industry: " Real  estate ", ugQualification: "B.Com", pgQualification: "MBA", institute: "University of Mumbai", educationType: "full_time", degreeYear: 2018,
      skills: ["BMS", " hvac ", "bms", ""], preferredLocations: ["Pune", "Pune", "Thane"],
    });
    const full = await getFullRecord(client, ORG, asha.id);
    assert.deepEqual(
      [full.extras?.industry, full.extras?.ugQualification, full.extras?.pgQualification, full.extras?.institute, full.extras?.educationType, full.extras?.degreeYear],
      ["Real estate", "B.Com", "MBA", "University of Mumbai", "full_time", 2018],
    );
    assert.deepEqual(full.extras?.skills, ["BMS", "hvac"], "trimmed, blanks and repeats dropped");
    assert.deepEqual(full.extras?.preferredLocations, ["Pune", "Thane"]);
    assert.equal(full.extras?.resumeSummary, "Facility manager with eight years in commercial real estate.", "the panel's record carries the resume summary too");
    assert.equal(full.hasResume, true);

    // A value can be cleared; a bad one is refused with the field's name.
    await updateRecord(client, ORG, USER, asha.id, { institute: null, skills: [] });
    const cleared = await getFullRecord(client, ORG, asha.id);
    assert.deepEqual([cleared.extras?.institute, cleared.extras?.skills], [null, []]);
    await assert.rejects(updateRecord(client, ORG, USER, asha.id, { degreeYear: 1800 }), /degreeYear/);
    await assert.rejects(updateRecord(client, ORG, USER, asha.id, { educationType: "weekend" }), /educationType/);
    // The fields belong to the person: a second record of the same person shows them.
    const second = await createRecord(client, ORG, USER, { fullName: "Asha Rao", email: "asha@example.com", role: "Leasing Manager" });
    assert.equal(second.matchedExisting, true);
    assert.equal((await getFullRecord(client, ORG, second.record.id)).extras?.pgQualification, "MBA", "adding a record does not blank what is known");
  });

  it("the full record of a candidate with nothing from a resume is still complete", async () => {
    const full = await getFullRecord(client, ORG, dev.id);
    assert.deepEqual([full.fullName, full.hasResume, full.extras?.skills, full.extras?.industry], ["Dev Patel", false, [], null]);
    await assert.rejects(getFullRecord(client, ORG, "00000000-0000-0000-0000-0000000000ff"), /no longer exists/);
    assert.ok(zed.candidateId);
  });

  it("the candidate's panel can read the resume's text", async () => {
    const read = await resumeFileText(client, ORG, fileId);
    assert.deepEqual([read.fileName, read.fromScan], ["Asha_Rao_Resume.pdf", false]);
    assert.match(read.text, /Ran BMS and HVAC operations/);
    await assert.rejects(resumeFileText(client, "00000000-0000-0000-0000-00000000000b", fileId), /no longer here/, "another organisation's file is not readable");
  });

  it("uploads are filed under the signed-in person's name, from the profile or else the email", async () => {
    await db.exec("create table if not exists public.users (id uuid primary key, full_name text)");
    await db.query("insert into public.users (id, full_name) values ($1, $2)", [USER, "  Priya   Sharma "]);
    assert.equal(await uploaderName(client, USER_INFO), "Priya Sharma");
    const stranger = { id: "00000000-0000-0000-0000-000000000002", email: "karan.mehta@example.com" };
    assert.equal(await uploaderName(client, stranger), "karan.mehta");
    assert.equal(await uploaderName(client, { id: stranger.id, email: null }), null);
  });
});

describe("the resume's text in the candidate's panel", () => {
  it("marks every keyword and keeps the text exactly as it was read, line breaks included", () => {
    const text = "ASHA RAO\n\nEXPERIENCE\nRan BMS and HVAC.\nfire\nsystems audits";
    const parts = markKeywords(text, ["bms", "fire systems"]);
    assert.equal(parts.map((p) => p.text).join(""), text, "nothing is added, dropped or re-spaced");
    assert.deepEqual(parts.filter((p) => p.hit).map((p) => p.text), ["BMS", "fire\nsystems"], "a keyword split over a line break is still found");
  });
  it("gives the plain text back when there is nothing to mark", () => {
    assert.deepEqual(markKeywords("Just text.", []), [{ text: "Just text." }]);
    assert.deepEqual(markKeywords("Just text.", ["bms"]), [{ text: "Just text." }]);
    assert.deepEqual(markKeywords("", ["bms"]), []);
  });
});

describe("exporting the ticked candidates", () => {
  const base: CandidateRecord = {
    id: "r1", candidateId: "c1", sheetId: null, sheetName: null, sourceRow: null, fullName: "Asha Rao", email: "asha@example.com", phone: "+91 98200 00000",
    currentOrganization: "Harbour Realty, Mumbai", currentDesignation: "Senior Facility Manager", location: "Navi Mumbai", totalExpMonths: 96, role: "Facility Manager",
    candidateSource: RESUME_SOURCE, sourcingDate: "2026-11-02", relevantExpMonths: 72, noticePeriodDays: 30, currentInhand: 82000, expectedInhand: 95000,
    remark: 'Said "open to a counter offer"\nWants hybrid', status: "in_process", indexed: true, createdAt: "2026-11-02T00:00:00Z", updatedAt: "2026-11-11T00:00:00Z", deletedAt: null, hasResume: true,
  };
  it("writes one row per candidate, quoting commas, quotes and line breaks", () => {
    const [header, row, ...rest] = recordsToCsv([base]).split("\r\n");
    assert.match(header, /^Name,Email,Phone,Current company,/);
    assert.ok(row.includes('"Harbour Realty, Mumbai"'));
    assert.ok(row.includes("8 yrs,6 yrs,30 days,82000,95000,Facility Manager,In process,Resume,2026-11-02,From resume,Yes"));
    assert.ok(row.includes('"Said ""open to a counter offer""'), "a quote inside a cell is doubled");
    assert.equal(rest.length, 0, "one candidate, one row");
    assert.ok(row.endsWith('Wants hybrid"'), "the remark's line break stays inside its quoted cell");
  });
  it("never lets a cell run as a formula in Excel", () => {
    const csv = recordsToCsv([{ ...base, fullName: "=HYPERLINK(\"http://x\")", remark: "@SUM(A1)", currentOrganization: "-2+3" }]);
    const row = csv.split("\r\n")[1];
    assert.ok(row.startsWith("\"'=HYPERLINK("), "a name that starts like a formula gets an apostrophe in front");
    assert.ok(row.includes("'-2+3"));
    assert.ok(row.includes("'@SUM(A1)"));
    assert.ok(row.includes("'+91 98200 00000"), "so does a number with a country code, which Excel would otherwise calculate");
  });
  it("builds the call and WhatsApp links from a number as HR typed it", () => {
    assert.equal(telHref("+91 98200-00000"), "tel:+919820000000");
    assert.equal(whatsappHref("98200 00000"), "https://wa.me/919820000000");
    assert.equal(whatsappHref("098200 00000"), "https://wa.me/919820000000");
    assert.equal(whatsappHref("+91 98200 00000"), "https://wa.me/919820000000");
    assert.equal(whatsappHref("022 2345"), null, "a short landline is not a WhatsApp number");
  });
  it("shows a date without its year only when it is this year", () => {
    const now = new Date("2026-11-11T10:00:00Z");
    assert.equal(formatDateShort("2026-11-05T10:00:00Z", now), "5 Nov");
    assert.equal(formatDateShort("2025-11-05T10:00:00Z", now), "5 Nov 2025");
    assert.equal(formatDateShort(null, now), "—");
  });
});
