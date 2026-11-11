/**
 * Reading details from resumes (owner 2026-11-11, phase 4). Spec block: docs/features/candidate_search.md.
 *
 * One structured model call per stored resume (Control Center job 'candidate_extract', default Claude Haiku 5.5): the
 * text, with emails and phones masked, goes in; a fixed JSON shape comes out (name, employer, designation, location,
 * experience, industry, skills, education, past employers, preferred locations, career break, defence background, a
 * two-sentence summary). Code then:
 *   linked file   -> fills only the candidate's EMPTY fields; what HR typed stays. Skills are merged.
 *   unlinked file -> a new candidate (source "Resume") from the name on the resume and the contacts found earlier,
 *                    through createRecord (so a person who turns up twice is still one candidate).
 * Either way the candidate gets the summary, skills and the resume's text (keyword search), and the profile text is
 * rebuilt so meaning search re-embeds it. The model's answer, model name and token counts stay on the file's row.
 *
 * The worker runs like the text reader: claimed batches, a few calls at a time, one try per file per run, a busy model
 * (429 / overloaded) pauses the run rather than counting as a failure. Needs migration 20261111000002.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import {
  CANDIDATE_RESUME_TEXT_CHARS, EXTRACT_CALL, RESUME_EXTRACT_BATCH, RESUME_EXTRACT_BUDGET_MS, RESUME_EXTRACT_MAX_ATTEMPTS,
  RESUME_EXTRACT_MAX_CHARS, RESUME_EXTRACT_PARALLEL, RESUME_TEXT_STALE_MINUTES,
} from "./config";
import { inferFromEmployers, type InferableField } from "./infer";
import { jobCaller, type JsonCaller } from "./models";
import { createRecord, markInferred, refreshSearchText } from "./records";
import { RESUME_SOURCE, type PastCompany } from "./types";

const TABLE = "candidate_resume_files";
const SAFETY_MS = 3_000;

// The reply --------------------------------------------------------------------------------------------------------------

// Lenient on length (a long answer is trimmed, not thrown away: 3 of 46 replies on the owner's sample were over a
// limit), strict on shape and ranges.
const Str = z.string().nullable().transform((v) => (v ?? "").trim().slice(0, 200) || null);
const Words = (max: number, each: number) => z.array(z.string()).transform((list) => list.map((s) => s.trim().slice(0, each)).filter(Boolean).slice(0, max));
const Reply = z.object({
  fullName: Str,
  currentCompany: Str,
  currentDesignation: Str,
  location: Str,
  totalExperienceMonths: z.number().int().min(0).max(720).nullable().catch(null),
  industry: Str,
  skills: Words(25, 60),
  education: z.object({
    ug: Str,
    pg: Str,
    ppg: Str,
    institute: Str,
    educationType: z.enum(["full_time", "part_time", "correspondence"]).nullable().catch(null),
    degreeYear: z.number().int().min(1950).max(2100).nullable().catch(null),
  }),
  pastCompanies: z
    .array(z.object({ company: z.string(), designation: Str, from: Str, to: Str }))
    .transform((list) => list.map((c) => ({ ...c, company: c.company.trim().slice(0, 200) })).filter((c) => c.company).slice(0, 20)),
  preferredLocations: Words(10, 80),
  careerBreak: z.boolean().nullable().catch(null),
  defenceBackground: z.enum(["army", "navy", "air_force", "paramilitary"]).nullable().catch(null),
  summary: z.string().nullable().transform((v) => (v ?? "").trim().slice(0, 600) || null),
});
export type ExtractedResume = z.infer<typeof Reply>;

/**
 * The API allows at most 16 nullable (union-typed) fields per schema, so text fields are plain strings where "" means
 * unknown (Reply turns "" into null); only numbers, booleans and enums are nullable. A nullable enum must be written as
 * anyOf: the API rejects an enum under a ["string", "null"] type.
 */
const str = { type: "string" };
const nullable = (type: string) => ({ type: [type, "null"] });
const nullableEnum = (values: string[]) => ({ anyOf: [{ type: "string", enum: values }, { type: "null" }] });
export const EXTRACT_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    fullName: str,
    currentCompany: str,
    currentDesignation: str,
    location: str,
    totalExperienceMonths: nullable("integer"),
    industry: str,
    skills: { type: "array", items: { type: "string" } },
    education: {
      type: "object",
      properties: {
        ug: str,
        pg: str,
        ppg: str,
        institute: str,
        educationType: nullableEnum(["full_time", "part_time", "correspondence"]),
        degreeYear: nullable("integer"),
      },
      required: ["ug", "pg", "ppg", "institute", "educationType", "degreeYear"],
      additionalProperties: false,
    },
    pastCompanies: {
      type: "array",
      items: {
        type: "object",
        properties: { company: str, designation: str, from: str, to: str },
        required: ["company", "designation", "from", "to"],
        additionalProperties: false,
      },
    },
    preferredLocations: { type: "array", items: { type: "string" } },
    careerBreak: nullable("boolean"),
    defenceBackground: nullableEnum(["army", "navy", "air_force", "paramilitary"]),
    summary: str,
  },
  required: [
    "fullName", "currentCompany", "currentDesignation", "location", "totalExperienceMonths", "industry", "skills", "education",
    "pastCompanies", "preferredLocations", "careerBreak", "defenceBackground", "summary",
  ],
  additionalProperties: false,
};

export const EXTRACT_SYSTEM = `You read one resume for a recruiter at an Indian coworking and facility-management company and fill a JSON form. You only fill the JSON; you never answer in words. Email addresses and phone numbers were replaced with <email> and <phone> before you saw the text; do not try to recover them.

Follow these steps in order. Do not skip any step.
1. Find the person's full name as written at the top of the resume.
2. Find the current (or most recent) employer and designation, and the city the person lives or works in.
3. Add up total work experience in months from the dates given; when the resume states a total ("6+ years"), use that. Null when it cannot be told.
4. List every employer with its designation and dates (YYYY-MM when known, else YYYY), most recent first.
5. Education: the undergraduate degree (ug, e.g. "B.Com", "B.E. Civil"), postgraduate (pg, e.g. "MBA"), and post-postgraduate (ppg, e.g. "PhD"); the institute of the highest degree; full_time, part_time or correspondence only when stated; the year of the highest degree. Null for anything the resume does not give.
6. Industry: the sector of the current employer in two or three words ("Real estate", "Coworking", "Facility management", "IT services").
7. Skills: up to 25 short skills, tools, systems and certifications as written on the resume. No sentences.
8. Preferred locations: only cities the resume names as preferred or willing to relocate to.
9. Career break: true only when the resume says so (a gap explained as a break). Defence background only when the resume says the person served (army, navy, air_force, paramilitary). Otherwise null.
10. Summary: two sentences a recruiter would read first: what the person does, for how many years, where, and the standout strength. No name, no contact details.
11. Never invent. Anything the resume does not say is an empty string "" for text, null for numbers and yes/no fields, or an empty list. Do not guess a company from an email domain or a file name.
12. Reply with the JSON object only.

Example resume (shortened): "ROHAN MEHTA · Mumbai · <email> · <phone> · Facility Executive, Northgate Workspaces (Jan 2022 - present) · Technician, Sigma Services (2019 - 2021) · B.E. Mechanical, Mumbai University, 2019 · Skills: BMS, HVAC, Fire systems, MS Excel · Open to relocating to Pune"
Example reply: {"fullName":"Rohan Mehta","currentCompany":"Northgate Workspaces","currentDesignation":"Facility Executive","location":"Mumbai","totalExperienceMonths":82,"industry":"Coworking","skills":["BMS","HVAC","Fire systems","MS Excel"],"education":{"ug":"B.E. Mechanical","pg":"","ppg":"","institute":"Mumbai University","educationType":null,"degreeYear":2019},"pastCompanies":[{"company":"Northgate Workspaces","designation":"Facility Executive","from":"2022-01","to":""},{"company":"Sigma Services","designation":"Technician","from":"2019","to":"2021"}],"preferredLocations":["Pune"],"careerBreak":null,"defenceBackground":null,"summary":"Facility executive with about seven years across coworking and building services, based in Mumbai. Strong on BMS, HVAC and fire systems."}`;

export function parseExtractReply(text: string): ExtractedResume | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = Reply.safeParse(JSON.parse(text.slice(start, end + 1)));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Emails and phone numbers never reach the model (the code already has them from the text reader). */
export function maskContacts(text: string): string {
  return text
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)*\.[A-Z]{2,}/gi, "<email>")
    .replace(/(?<!\d)(?:\+?91[\s.-]*)?(?:\(?0\)?[\s.-]*)?[6-9](?:[\s.-]?\d){9}(?!\d)/g, "<phone>");
}

export interface ExtractReply {
  data: ExtractedResume;
  model: string;
  usage: { input: number; output: number } | null;
}

/** One model call. Throws when no model answered (the caller decides whether to retry or pause). */
export async function extractResume(text: string, caller: JsonCaller = jobCaller("candidate_extract")): Promise<ExtractReply> {
  const reply = await caller({
    label: "candidate-search:extract",
    system: EXTRACT_SYSTEM,
    user: `Resume text:\n"""\n${maskContacts(text).slice(0, RESUME_EXTRACT_MAX_CHARS)}\n"""`,
    schema: EXTRACT_JSON_SCHEMA,
    ...EXTRACT_CALL,
    accept: (t) => parseExtractReply(t) !== null,
  });
  const data = parseExtractReply(reply.text);
  if (!data) throw new Error("the reply did not have the expected shape");
  return { data, model: reply.model, usage: reply.usage ?? null };
}

// Applying the answer ------------------------------------------------------------------------------------------------------

/** A name from a file like "Varad_Jadhav_Resume - Varad Jadhav.pdf"; null for portal names like "1779111418095.pdf". */
export function nameFromFileName(fileName: string): string | null {
  const stem = fileName.replace(/\.[a-z0-9]+$/i, "");
  const cleaned = stem
    .split(/\s+-\s+/)[0]
    .replace(/\[.*?\]|\(.*?\)/g, " ")
    .replace(/[_\-.]+/g, " ")
    .replace(/\b(resume|cv|curriculum|vitae|naukri|updated|final|new|copy|profile|biodata)\b/gi, " ")
    .replace(/\d+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned || cleaned.length < 3) return null;
  return cleaned.split(" ").slice(0, 4).map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ");
}

interface FileRow {
  id: string;
  file_name: string;
  candidate_id: string | null;
  downloaded_at: string | Date | null;
  resume_text: string | null;
  emails: string[] | null;
  phones: string[] | null;
  uploaded_by: string | null;
  extract_attempts: number | string;
}

const CANDIDATE_COLUMNS =
  "id, current_organization, current_designation, location, total_exp_months, industry, ug_qualification, pg_qualification, " +
  "ppg_qualification, institute, education_type, degree_year, preferred_locations, career_break, defence_background, skills, past_companies";

const unique = (values: string[]) => [...new Map(values.map((v) => [v.toLowerCase(), v])).values()];
const isoDay = (value: string | Date | null) => {
  const t = value instanceof Date ? value.getTime() : value ? new Date(value).getTime() : NaN;
  return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : null;
};

/**
 * Writes the answer to the candidate. Empty fields only; skills merged; the summary and the resume's text always.
 * Returns the candidate, whether one was created, and which fields were filled.
 */
export async function applyExtraction(
  client: SupabaseClient,
  orgId: string,
  file: FileRow,
  data: ExtractedResume,
): Promise<{ candidateId: string; created: boolean; filled: string[] }> {
  let candidateId = file.candidate_id;
  let created = false;
  if (!candidateId) {
    const fullName = data.fullName ?? nameFromFileName(file.file_name) ?? "Unknown (resume)";
    const { record } = await createRecord(client, orgId, file.uploaded_by, {
      fullName,
      email: file.emails?.[0] ?? null,
      phone: file.phones?.[0] ?? null,
      currentOrganization: data.currentCompany,
      currentDesignation: data.currentDesignation,
      location: data.location,
      totalExpMonths: data.totalExperienceMonths,
      candidateSource: RESUME_SOURCE,
      sourcingDate: isoDay(file.downloaded_at),
    });
    candidateId = record.candidateId;
    created = true;
    const at = new Date().toISOString();
    const { error } = await client.from(TABLE).update({ candidate_id: candidateId, match_reason: "resume", matched_at: at, updated_at: at }).eq("id", file.id).eq("organization_id", orgId);
    if (error) throw error;
  }

  const { data: row, error } = await client.from("candidates").select(CANDIDATE_COLUMNS).eq("organization_id", orgId).eq("id", candidateId).maybeSingle();
  if (error) throw error;
  if (!row) throw new Error("the candidate no longer exists");
  const current = row as unknown as Record<string, unknown>;
  const patch: Record<string, unknown> = {};
  const filled: string[] = [];
  const fill = (column: string, value: unknown) => {
    const existing = current[column];
    const empty = existing === null || existing === undefined || existing === "" || (Array.isArray(existing) && existing.length === 0);
    if (!empty || value === null || value === undefined || (Array.isArray(value) && value.length === 0)) return;
    patch[column] = value;
    filled.push(column);
  };
  fill("current_organization", data.currentCompany);
  fill("current_designation", data.currentDesignation);
  fill("location", data.location);
  fill("total_exp_months", data.totalExperienceMonths);
  fill("industry", data.industry);
  fill("ug_qualification", data.education.ug);
  fill("pg_qualification", data.education.pg);
  fill("ppg_qualification", data.education.ppg);
  fill("institute", data.education.institute);
  fill("education_type", data.education.educationType);
  fill("degree_year", data.education.degreeYear);
  fill("preferred_locations", data.preferredLocations);
  fill("career_break", data.careerBreak);
  fill("defence_background", data.defenceBackground);
  fill("past_companies", data.pastCompanies as PastCompany[]);
  const skills = unique([...((current.skills as string[] | null) ?? []), ...data.skills]).slice(0, 40);
  if (skills.length !== ((current.skills as string[] | null) ?? []).length) {
    patch.skills = skills;
    filled.push("skills");
  }
  if (data.summary) patch.resume_summary = data.summary;
  if (file.resume_text) patch.resume_text = file.resume_text.slice(0, CANDIDATE_RESUME_TEXT_CHARS);
  // Owner 2026-11-11: what the reader left empty is worked out from the employers listed, and marked as such.
  const worked = workedOut({ ...current, ...patch });
  Object.assign(patch, worked.patch);
  filled.push(...Object.keys(worked.patch));
  if (Object.keys(patch).length) {
    const { error: upErr } = await client.from("candidates").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", candidateId).eq("organization_id", orgId);
    if (upErr) throw upErr;
  }
  if (worked.fields.length) await markInferred(client, orgId, candidateId, worked.fields);
  await refreshSearchText(client, orgId, [candidateId]);
  return { candidateId, created, filled };
}

/** The empty ones of designation, company and total experience that the person's listed employers can fill. */
function workedOut(person: Record<string, unknown>, now: Date = new Date()): { patch: Record<string, unknown>; fields: InferableField[] } {
  const empty = (value: unknown) => value === null || value === undefined || value === "";
  const from = inferFromEmployers(person.past_companies as PastCompany[] | null, now);
  const patch: Record<string, unknown> = {};
  const fields: InferableField[] = [];
  if (empty(person.current_designation) && from.designation) { patch.current_designation = from.designation; fields.push("currentDesignation"); }
  if (empty(person.current_organization) && from.company) { patch.current_organization = from.company; fields.push("currentOrganization"); }
  if (empty(person.total_exp_months) && from.totalMonths !== null) { patch.total_exp_months = from.totalMonths; fields.push("totalExpMonths"); }
  return { patch, fields };
}

/** People looked at per run of inferMissingDetails. */
const INFER_BATCH = 200;

/**
 * The same working-out for people whose resume was read before it existed (or whose details were cleared since):
 * everyone with resume data and an empty designation, company or total experience. Only empty fields are filled.
 * Cheap when there is nothing to do (one query); never throws. Returns how many people got a value.
 */
export async function inferMissingDetails(client: SupabaseClient, orgId?: string, now: Date = new Date()): Promise<number> {
  let query = client
    .from("candidates")
    .select("id, organization_id, current_designation, current_organization, total_exp_months, past_companies")
    .not("resume_summary", "is", null)
    .or("current_designation.is.null,current_organization.is.null,total_exp_months.is.null")
    .order("id")
    .limit(INFER_BATCH);
  if (orgId) query = query.eq("organization_id", orgId) as unknown as typeof query;
  const { data, error } = await query;
  if (error) {
    if (!extractMigrationMissing(error)) console.error("[candidates] working out details: listing failed", message(error));
    return 0;
  }
  const touched = new Map<string, string[]>();
  let people = 0;
  for (const row of (data ?? []) as unknown as (Record<string, unknown> & { id: string; organization_id: string })[]) {
    const worked = workedOut(row, now);
    if (!worked.fields.length) continue;
    const { error: upErr } = await client.from("candidates").update({ ...worked.patch, updated_at: now.toISOString() }).eq("id", row.id).eq("organization_id", row.organization_id);
    if (upErr) {
      console.error("[candidates] working out details: save failed", message(upErr));
      continue;
    }
    await markInferred(client, row.organization_id, row.id, worked.fields);
    touched.set(row.organization_id, [...(touched.get(row.organization_id) ?? []), row.id]);
    people += 1;
  }
  for (const [org, ids] of touched) await refreshSearchText(client, org, ids);
  if (people) console.info(`[candidates] working out details: ${people} ${people === 1 ? "person" : "people"} got a designation, a company or their total experience from the employers on the resume`);
  return people;
}

/** One organisation at most once in a while: the summary route asks on every page load. True when it is this call's turn. */
const lastInferAt = new Map<string, number>();
export async function inferMissingDetailsSometimes(client: SupabaseClient, orgId: string, everyMs = 5 * 60 * 1000): Promise<boolean> {
  const last = lastInferAt.get(orgId) ?? 0;
  if (Date.now() - last < everyMs) return false;
  lastInferAt.set(orgId, Date.now());
  await inferMissingDetails(client, orgId);
  return true;
}

// The worker ------------------------------------------------------------------------------------------------------------

export interface ResumeExtractOptions {
  budgetMs?: number;
  caller?: JsonCaller;
  now?: () => number;
}

export interface ResumeExtractResult {
  done: number;
  created: number;
  failed: number;
  /** The model was busy (429 / overloaded): the run stopped early and the files wait for the next one. */
  paused: boolean;
  remaining: number;
}

/** A model that is rate-limited or overloaded: wait, do not count a failure. Shared with the scan reader. */
export const modelBusy = (message: string) => /\b(429|529|503|rate.?limit|overloaded|too many requests)\b/i.test(message);
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function extractMigrationMissing(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  return ["42703", "42P01", "PGRST204", "PGRST205"].includes(error.code ?? "") || /does not exist|schema cache/i.test(error.message ?? "");
}

let warnedMissing = false;
function warnMissing(error: unknown) {
  if (warnedMissing) return;
  warnedMissing = true;
  console.error("[candidates] reading resume details needs migration 20261111000002_candidate_resume_extraction.sql", message(error));
}

/** One organisation, within the time budget. Never throws. */
export async function processResumeExtraction(client: SupabaseClient, orgId: string, options: ResumeExtractOptions = {}): Promise<ResumeExtractResult> {
  const now = options.now ?? Date.now;
  const caller = options.caller ?? jobCaller("candidate_extract");
  const deadline = now() + (options.budgetMs ?? RESUME_EXTRACT_BUDGET_MS.afterUpload);
  const result: ResumeExtractResult = { done: 0, created: 0, failed: 0, paused: false, remaining: -1 };

  const stale = new Date(now() - RESUME_TEXT_STALE_MINUTES * 60_000).toISOString();
  const reset = await client.from(TABLE).update({ extract_status: "pending" }).eq("organization_id", orgId).eq("extract_status", "working").lt("updated_at", stale);
  if (reset.error) {
    if (extractMigrationMissing(reset.error)) warnMissing(reset.error);
    else console.error("[candidates] resume details: reset failed", message(reset.error));
    return result;
  }

  const attempted = new Set<string>();
  while (now() < deadline - SAFETY_MS && !result.paused) {
    let list = client
      .from(TABLE)
      .select("id")
      .eq("organization_id", orgId)
      .eq("status", "ready")
      .eq("text_status", "ready")
      .eq("extract_status", "pending")
      .not("resume_text", "is", null)
      .order("created_at")
      .limit(RESUME_EXTRACT_BATCH);
    if (attempted.size) list = list.not("id", "in", `(${[...attempted].join(",")})`) as unknown as typeof list;
    const waiting = await list;
    if (waiting.error) {
      console.error("[candidates] resume details: listing failed", message(waiting.error));
      break;
    }
    const ids = (waiting.data ?? []).map((r) => r.id as string);
    if (!ids.length) break;
    const claimed = await client
      .from(TABLE)
      .update({ extract_status: "working", updated_at: new Date(now()).toISOString() })
      .eq("organization_id", orgId)
      .eq("extract_status", "pending")
      .in("id", ids)
      .select("id, file_name, candidate_id, downloaded_at, resume_text, emails, phones, uploaded_by, extract_attempts");
    if (claimed.error) {
      console.error("[candidates] resume details: claim failed", message(claimed.error));
      break;
    }
    const rows = (claimed.data ?? []) as unknown as FileRow[];
    if (!rows.length) break;

    let next = 0;
    const lane = async () => {
      while (next < rows.length) {
        const row = rows[next];
        next += 1;
        attempted.add(row.id);
        if (result.paused || now() >= deadline - SAFETY_MS) {
          await client.from(TABLE).update({ extract_status: "pending" }).eq("id", row.id).eq("extract_status", "working");
          continue;
        }
        await extractOne(client, orgId, row, caller, now, result);
      }
    };
    await Promise.all(Array.from({ length: Math.min(RESUME_EXTRACT_PARALLEL, rows.length) }, lane));
  }

  const remaining = await client
    .from(TABLE)
    .select("id", { count: "exact", head: true })
    .eq("organization_id", orgId)
    .eq("status", "ready")
    .eq("text_status", "ready")
    .or("extract_status.eq.pending,extract_status.eq.working");
  result.remaining = remaining.error ? -1 : remaining.count ?? 0;
  return result;
}

async function extractOne(client: SupabaseClient, orgId: string, row: FileRow, caller: JsonCaller, now: () => number, result: ResumeExtractResult): Promise<void> {
  const at = () => new Date(now()).toISOString();
  const update = (values: Record<string, unknown>) => client.from(TABLE).update({ ...values, updated_at: at() }).eq("id", row.id).eq("organization_id", orgId);
  if (!row.resume_text) {
    await update({ extract_status: "skipped", extract_error: "No text" });
    return;
  }
  let reply: ExtractReply;
  try {
    reply = await extractResume(row.resume_text, caller);
  } catch (error) {
    const why = message(error);
    if (modelBusy(why)) {
      // The model is busy: hand the file back untouched and stop this run; the next one tries again.
      result.paused = true;
      await update({ extract_status: "pending", extract_error: `Model busy: ${why.slice(0, 200)}` });
      return;
    }
    const attempts = (Number(row.extract_attempts) || 0) + 1;
    const givenUp = attempts >= RESUME_EXTRACT_MAX_ATTEMPTS;
    console.error(`[candidates] resume details: ${row.file_name} attempt ${attempts} failed`, why);
    await update({ extract_status: givenUp ? "failed" : "pending", extract_attempts: attempts, extract_error: why.slice(0, 500) });
    if (givenUp) result.failed += 1;
    return;
  }
  try {
    const applied = await applyExtraction(client, orgId, row, reply.data);
    await update({
      extract_status: "done", extract_error: null, extracted: reply.data, extract_model: reply.model, extracted_at: at(),
      tokens_in: reply.usage?.input ?? null, tokens_out: reply.usage?.output ?? null,
    });
    result.done += 1;
    if (applied.created) result.created += 1;
    console.info(`[candidates] resume details: ${row.file_name} -> ${applied.created ? "new candidate" : "filled"} ${applied.filled.join(", ") || "nothing new"} (${reply.model}, ${reply.usage?.input ?? "?"} in / ${reply.usage?.output ?? "?"} out)`);
  } catch (error) {
    const attempts = (Number(row.extract_attempts) || 0) + 1;
    const givenUp = attempts >= RESUME_EXTRACT_MAX_ATTEMPTS;
    console.error(`[candidates] resume details: saving ${row.file_name} failed`, message(error));
    await update({ extract_status: givenUp ? "failed" : "pending", extract_attempts: attempts, extract_error: message(error).slice(0, 500) });
    if (givenUp) result.failed += 1;
  }
}

/** Every organisation with resumes waiting, until the budget is used. Never throws. */
export async function processResumeExtractionAll(client: SupabaseClient, options: ResumeExtractOptions = {}): Promise<{ organisations: number; done: number; created: number }> {
  const now = options.now ?? Date.now;
  const deadline = now() + (options.budgetMs ?? RESUME_EXTRACT_BUDGET_MS.cron);
  const { data, error } = await client.from(TABLE).select("organization_id").eq("status", "ready").eq("text_status", "ready").eq("extract_status", "pending").limit(500);
  if (error) {
    if (extractMigrationMissing(error)) warnMissing(error);
    else console.error("[candidates] resume details: listing organisations failed", message(error));
    return { organisations: 0, done: 0, created: 0 };
  }
  const orgs = [...new Set((data ?? []).map((r) => r.organization_id as string))];
  let organisations = 0;
  let done = 0;
  let created = 0;
  for (const orgId of orgs) {
    const left = deadline - now();
    if (left <= SAFETY_MS * 2) break;
    const result = await processResumeExtraction(client, orgId, { ...options, budgetMs: left });
    organisations += 1;
    done += result.done;
    created += result.created;
    if (result.paused) break;
  }
  return { organisations, done, created };
}
