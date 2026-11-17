/**
 * Details read from resumes (phase 4) against the real migrations in PGlite, with a scripted model: the reply shape,
 * masking, filling only empty fields, creating a candidate from an unmatched resume, resume text in keyword search,
 * the summary in the profile text, token accounting, retries, and the pause on a busy model.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { after, before, describe, it } from "node:test";

import type { PGlite } from "@electric-sql/pglite";
import type { SupabaseClient } from "@supabase/supabase-js";

import { filterRecords } from "../../backend/lib/candidates/filter-search";
import { EMPTY_FILTERS, type SearchFilters } from "../../backend/lib/candidates/filters";
import type { JsonCaller, JsonRequest } from "../../backend/lib/candidates/models";
import { createRecord } from "../../backend/lib/candidates/records";
import {
  EXTRACT_JSON_SCHEMA, extractResume, maskContacts, nameFromFileName, parseExtractReply, processResumeExtraction, processResumeExtractionAll,
  type ExtractedResume,
} from "../../backend/lib/candidates/resume-extract";
import { processResumeText } from "../../backend/lib/candidates/resume-text";
import { confirmResumeUploads, listResumeFiles, prepareResumeUploads, resumeSummary, type ResumeListQuery, type ResumeStorage } from "../../backend/lib/candidates/resumes";
import type { PreparedUpload } from "../../backend/lib/candidates/types";
import { AI_JOBS } from "../../task-manager/ai/aiCatalog";

import { freshDb } from "./db-stub";
import { pgliteSupabase } from "./pglite-supabase";

const ORG = "00000000-0000-0000-0000-00000000000a";
const USER = "00000000-0000-0000-0000-000000000001";
const USER_INFO = { id: USER, email: "hr@example.com" };
const TODAY = "2026-11-11";
const sha = (seed: string) => createHash("sha256").update(seed).digest("hex");
const f = (patch: Partial<SearchFilters> = {}): SearchFilters => ({ ...EMPTY_FILTERS, ...patch });
const lq = (over: Partial<ResumeListQuery> = {}): ResumeListQuery => ({ from: null, to: null, q: "", device: null, candidateId: null, link: "", page: 1, pageSize: 50, ...over });

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
    async download(path) { return objects.has(path) ? { data: new Blob([new Uint8Array([1])]), error: null } : { data: null, error: { message: "Object not found" } }; },
  };
  return { storage, objects };
}

const TEXTS: Record<string, string> = {
  "asha.pdf": "ASHA RAO\nasha@example.com | +91 98765 43210\nSenior Leasing Manager, Harbour Realty (2021 - present)\nLeasing Executive, Skyward (2018 - 2021)\nEducation: MBA Marketing, University of Mumbai, 2018; B.Com\nSkills: Commercial leasing, Negotiation, CRM, Salesforce\nExperience: 8 years",
  "zed.pdf": "ZED ALAM\nzed@nowhere.com | 9000000001\nFacility Executive at Northgate Workspaces, Pune (2022 - present)\nSkills: BMS, HVAC, Fire systems, Honeywell\nEducation: B.E. Mechanical, Pune University, 2019\nExperience: 4 years",
  "flaky.pdf": "FLAKY person\nflaky@example.com 9111111111\nExperience: 2 years. Skills: typing. Education: B.A.",
};

const reply = (over: Partial<ExtractedResume> = {}): string => JSON.stringify({
  fullName: null, currentCompany: null, currentDesignation: null, location: null, totalExperienceMonths: null, industry: null, skills: [],
  education: { ug: null, pg: null, ppg: null, institute: null, educationType: null, degreeYear: null },
  pastCompanies: [], preferredLocations: [], careerBreak: null, defenceBackground: null, summary: null,
  ...over,
});

const ANSWERS: Record<string, string> = {
  "ASHA RAO": reply({
    fullName: "Asha Rao", currentCompany: "Harbour Realty Ltd", currentDesignation: "Senior Leasing Manager", location: "Navi Mumbai", totalExperienceMonths: 96,
    industry: "Real estate", skills: ["Commercial leasing", "Negotiation", "CRM", "Salesforce"],
    education: { ug: "B.Com", pg: "MBA Marketing", ppg: null, institute: "University of Mumbai", educationType: null, degreeYear: 2018 },
    pastCompanies: [{ company: "Harbour Realty", designation: "Senior Leasing Manager", from: "2021", to: null }, { company: "Skyward", designation: "Leasing Executive", from: "2018", to: "2021" }],
    preferredLocations: ["Pune"], careerBreak: null, defenceBackground: null, summary: "Leasing manager with eight years in commercial real estate across Mumbai. Strong negotiator with a Salesforce habit.",
  }),
  "ZED ALAM": reply({
    fullName: "Zed Alam", currentCompany: "Northgate Workspaces", currentDesignation: "Facility Executive", location: "Pune", totalExperienceMonths: 48,
    industry: "Coworking", skills: ["BMS", "HVAC", "Fire systems", "Honeywell"],
    education: { ug: "B.E. Mechanical", pg: null, ppg: null, institute: "Pune University", educationType: null, degreeYear: 2019 },
    pastCompanies: [{ company: "Northgate Workspaces", designation: "Facility Executive", from: "2022", to: null }],
    preferredLocations: [], careerBreak: false, defenceBackground: null, summary: "Facility executive with four years in coworking operations in Pune. Hands-on with BMS, HVAC and fire systems.",
  }),
};

/** Answers by the name at the top of the masked text; "FLAKY" fails in a configurable way. */
let flakyMode: "error" | "busy" | "ok" = "error";
const calls: JsonRequest[] = [];
const caller: JsonCaller = async (req) => {
  calls.push(req);
  const head = req.user.split("\n")[2] ?? "";
  if (head.startsWith("FLAKY")) {
    if (flakyMode === "busy") throw new Error("candidate-search:extract: no model answered (anthropic:claude-haiku-5-5: Claude 429 rate limited)");
    if (flakyMode === "error") throw new Error("socket hang up");
    return { text: reply({ fullName: "Flaky Person", skills: ["Typing"] }), model: "test", usage: { input: 10, output: 5 } };
  }
  const text = ANSWERS[head.trim()];
  if (!text) throw new Error(`no scripted answer for "${head}"`);
  return { text, model: "anthropic:claude-haiku-5-5", usage: { input: 900, output: 300 } };
};

describe("the reply and the masking", () => {
  it("keeps the Control Center job and a valid JSON schema", () => {
    assert.ok(AI_JOBS.some((job) => job.key === "candidate_extract"));
    assert.equal((EXTRACT_JSON_SCHEMA as { additionalProperties: boolean }).additionalProperties, false);
  });
  it("masks emails and phones before the model sees the text", () => {
    assert.equal(maskContacts("Asha asha@example.com +91 98765 43210 and 022 2345 6789"), "Asha <email> <phone> and 022 2345 6789");
  });
  it("parses a good reply, trims a long one and refuses a malformed one", () => {
    const good = parseExtractReply(`Sure: ${ANSWERS["ZED ALAM"]}`);
    assert.equal(good?.currentCompany, "Northgate Workspaces");
    assert.equal(parseExtractReply("{}"), null);
    assert.equal(parseExtractReply(reply({ skills: "BMS" as unknown as string[] })), null);
    // Out-of-range or over-long values are dropped or trimmed, not the whole reply (3 of 46 sample replies did this).
    const trimmed = parseExtractReply(reply({ totalExperienceMonths: 9999, skills: Array.from({ length: 30 }, (_, i) => `skill ${i}`), summary: "x".repeat(700) }));
    assert.equal(trimmed?.totalExperienceMonths, null);
    assert.equal(trimmed?.skills.length, 25);
    assert.equal(trimmed?.summary?.length, 600);
  });
  it("reads a person's name from a file name, not from a portal's number", () => {
    assert.equal(nameFromFileName("Varad_Jadhav_Resume - Varad Jadhav.pdf"), "Varad Jadhav");
    assert.equal(nameFromFileName("Naukri_HarshWardhan[2y_8m].pdf"), "Harshwardhan");
    assert.equal(nameFromFileName("PoojaSharma_Resume (1).pdf"), "Poojasharma");
    assert.equal(nameFromFileName("1779111418095.pdf"), null);
  });
  it("extractResume returns the parsed answer, the model and the tokens", async () => {
    const out = await extractResume(TEXTS["zed.pdf"], caller);
    assert.equal(out.data.fullName, "Zed Alam");
    assert.deepEqual(out.usage, { input: 900, output: 300 });
    assert.match(calls[calls.length - 1].user, /<email>/);
    assert.doesNotMatch(calls[calls.length - 1].user, /9000000001/);
  });
});

describe("details read into candidates", () => {
  let db: PGlite;
  let client: SupabaseClient;
  let store: ReturnType<typeof fakeStorage>;
  const files: Record<string, string> = {};
  let asha: string;

  const reader = async (_bytes: Uint8Array, name: string) => TEXTS[name];
  const fileRow = async (name: string) =>
    (await db.query<{ extract_status: string; extract_error: string | null; extract_attempts: number; tokens_in: number | null; extract_model: string | null; candidate_id: string | null; match_reason: string | null }>(
      "select extract_status, extract_error, extract_attempts, tokens_in, extract_model, candidate_id, match_reason from public.candidate_resume_files where id = $1", [files[name]],
    )).rows[0];
  const person = async (id: string) =>
    (await db.query<Record<string, unknown>>("select * from public.candidates where id = $1", [id])).rows[0];

  before(async () => {
    db = await freshDb();
    await db.query("insert into public.organizations (id) values ($1)", [ORG]);
    await db.query("insert into auth.users (id) values ($1)", [USER]);
    client = pgliteSupabase(db);
    store = fakeStorage();
    // Asha is on a sheet already, with a location HR typed and no education.
    const { record } = await createRecord(client, ORG, USER, { fullName: "Asha Rao", email: "asha@example.com", location: "Mumbai", role: "Leasing Manager", status: "in_process" });
    asha = record.candidateId;
    const { files: prepared } = await prepareResumeUploads(client, store.storage, ORG, USER_INFO, {
      device: "Roohi Idrishi",
      files: Object.keys(TEXTS).map((name, index) => ({ index, name, size: 1000, sha256: sha(name), modifiedAt: "2026-03-01T00:00:00.000Z" })),
    });
    const sent = prepared.filter((p): p is PreparedUpload & { id: string; signedUrl: string } => p.outcome === "upload");
    for (const p of sent) store.objects.add(p.signedUrl.slice("https://storage.test/upload/".length));
    await confirmResumeUploads(client, store.storage, ORG, sent.map((p) => p.id));
    sent.forEach((p, i) => { files[Object.keys(TEXTS)[i]] = p.id; });
    await processResumeText(client, store.storage, ORG, { read: reader, budgetMs: 30_000 });
  });
  after(async () => {
    await db.close();
  });

  it("fills only the empty fields of a linked candidate and creates a candidate from an unmatched resume", async () => {
    assert.equal((await fileRow("asha.pdf")).candidate_id, asha, "phase 2 linked Asha's resume by email");
    assert.equal((await fileRow("zed.pdf")).candidate_id, null, "nobody matches Zed yet");
    assert.equal((await resumeSummary(client, ORG)).extractPending, 3);

    const result = await processResumeExtraction(client, ORG, { caller, budgetMs: 30_000 });
    assert.deepEqual({ done: result.done, created: result.created, failed: result.failed, paused: result.paused, remaining: result.remaining }, { done: 2, created: 1, failed: 0, paused: false, remaining: 1 });

    const a = await person(asha);
    assert.equal(a.location, "Mumbai", "what HR typed stays");
    assert.equal(a.current_organization, "Harbour Realty Ltd", "an empty field is filled");
    assert.equal(a.pg_qualification, "MBA Marketing");
    assert.equal(a.institute, "University of Mumbai");
    assert.equal(a.degree_year, 2018);
    assert.deepEqual(a.skills, ["Commercial leasing", "Negotiation", "CRM", "Salesforce"]);
    assert.deepEqual(a.preferred_locations, ["Pune"]);
    assert.equal((a.past_companies as unknown[]).length, 2);
    assert.match(a.resume_summary as string, /^Leasing manager/);
    assert.match(a.resume_text as string, /Harbour Realty/);

    const zedFile = await fileRow("zed.pdf");
    assert.equal(zedFile.match_reason, "resume");
    assert.ok(zedFile.candidate_id);
    const z = await person(zedFile.candidate_id as string);
    assert.deepEqual([z.full_name, z.email_key, z.phone_key, z.current_organization, z.location, z.industry], ["Zed Alam", "zed@nowhere.com", "9000000001", "Northgate Workspaces", "Pune", "Coworking"]);
    const zedRecord = (await db.query<{ candidate_source: string; sourcing_date: Date; search_text: string }>("select candidate_source, sourcing_date, search_text from public.candidate_applications where candidate_id = $1", [zedFile.candidate_id])).rows[0];
    assert.equal(zedRecord.candidate_source, "Resume");
    assert.equal(zedRecord.sourcing_date.toISOString().slice(0, 10), "2026-03-01");
    assert.match(zedRecord.search_text, /Summary: Facility executive/);
    assert.match(zedRecord.search_text, /Skills: BMS, HVAC/);

    const ashaFile = await fileRow("asha.pdf");
    assert.deepEqual([ashaFile.extract_status, ashaFile.tokens_in, ashaFile.extract_model], ["done", 900, "anthropic:claude-haiku-5-5"]);
    const listed = (await listResumeFiles(client, ORG, lq({ candidateId: asha }))).files[0];
    assert.equal(listed.extractStatus, "done");
  });

  it("a failing call is retried on later runs, then given up; a busy model pauses the run instead", async () => {
    assert.deepEqual([(await fileRow("flaky.pdf")).extract_status, (await fileRow("flaky.pdf")).extract_attempts], ["pending", 1]);
    flakyMode = "busy";
    const paused = await processResumeExtraction(client, ORG, { caller, budgetMs: 30_000 });
    assert.deepEqual([paused.paused, paused.done, paused.remaining], [true, 0, 1]);
    assert.equal((await fileRow("flaky.pdf")).extract_attempts, 1, "a busy model is not the file's fault");
    assert.match((await fileRow("flaky.pdf")).extract_error ?? "", /Model busy/);
    flakyMode = "error";
    await processResumeExtractionAll(client, { caller, budgetMs: 30_000 });
    await processResumeExtraction(client, ORG, { caller, budgetMs: 30_000 });
    assert.deepEqual([(await fileRow("flaky.pdf")).extract_status, (await fileRow("flaky.pdf")).extract_attempts], ["failed", 3]);
  });

  it("the resume's text and skills reach keyword search; the panel shows what was read", async () => {
    const names = async (filters: SearchFilters) => (await filterRecords(client, ORG, filters, 1, 50, TODAY)).records.map((r) => r.fullName).sort();
    assert.deepEqual(await names(f({ keywords: [{ text: "Honeywell", required: true }] })), ["Zed Alam"], "a word only in the resume text");
    assert.deepEqual(await names(f({ keywords: [{ text: "Salesforce", required: true }] })), ["Asha Rao"], "a skill");
    assert.deepEqual(await names(f({ keywords: [{ text: "leasing", required: false }, { text: "hvac", required: false }] })), ["Asha Rao", "Zed Alam"]);
    assert.deepEqual(await names(f({ keywords: [{ text: "leasing", required: true }], excludes: ["salesforce"] })), [], "exclude words look in the resume too");
    const all = await filterRecords(client, ORG, f({ hasResume: "yes" }), 1, 50, TODAY);
    const zed = all.records.find((r) => r.fullName === "Zed Alam");
    assert.deepEqual(zed?.extras?.skills, ["BMS", "HVAC", "Fire systems", "Honeywell"]);
    assert.equal(zed?.extras?.pastCompanies[0]?.company, "Northgate Workspaces");
    assert.match(zed?.extras?.resumeSummary ?? "", /coworking/);
  });
});
