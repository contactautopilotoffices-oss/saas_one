/**
 * The job application form (owner 2026-11-24, from the 23 Nov HR meeting: "outreach should carry the job application
 * form link so more candidate data is captured"; "the form should be the same as the template shared, for active and
 * passive outreach"; migration 20261124000002).
 *
 *   - The questions are HR's (Recruitment → Outreach → Application form; outreach-settings.ts).
 *   - A link is "personal" (one per candidate and position; it goes in that candidate's WhatsApp or email) or "open"
 *     (one per position, for job postings). The link is the only key: it opens the form and accepts an application,
 *     and shows nothing about anyone (a personal link greets the person by first name only).
 *   - A submitted form becomes a record (createRecord: matched to the person by email, then mobile, else a new person),
 *     is added to the position's pipeline when the link names one, keeps the answers and the resume file, and writes a
 *     line in the candidate's history.
 *
 * Nobody is shortlisted or rejected by a form: HR reads it like any other record.
 */
import { randomBytes } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import { recordAction, type Actor } from "./actions";
import { BriefAttachmentSchema } from "./outreach-settings";
import { briefDownloadUrl } from "./assignment-brief-storage";
import { RESUME_BUCKET } from "./config";
import { parseEmail, parsePhone } from "./normalize";
import { DEFAULT_OUTREACH, REQUIRED_TARGETS, type ApplicationField, type ApplicationFormConfig, type ApplicationTarget, type OutreachSettings } from "./outreach-settings";
import { addMembers } from "./positions";
import { CandidateActionError, createRecord, updateRecord } from "./records";
import { loadRecruitmentConfig } from "./requisitions";
import { ownQuestions, questionsFor } from "./screening-questions";

const LINKS = "recruitment_application_links";
const APPLICATIONS = "recruitment_applications";
const SCREENINGS = "recruitment_screenings";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN = /^[A-Za-z0-9_-]{32,64}$/;
export const APPLY_MIGRATION_MESSAGE = "The application form needs a database update first: run 20261124000002_recruitment_outreach.sql in Supabase.";
/** The resume upload's limit (Vercel refuses request bodies over 4.5 MB). */
export const MAX_RESUME_BYTES = 4 * 1024 * 1024;
const RESUME_TYPES: Record<string, string> = {
  "application/pdf": "pdf",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
};
/** The record's source for applications, so they can be found in Search and Candidates. */
export const APPLICATION_SOURCE = "Job application form";

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || "").replace(/\/$/, "");
export const applicationUrl = (token: string, base = APP_URL) => `${base}/apply/${token}`;

const missing = (error: { code?: string; message?: string } | null | undefined) =>
  Boolean(error) && (["42P01", "42703", "PGRST205", "PGRST204"].includes(error?.code ?? "") || /recruitment_application|does not exist|schema cache/i.test(error?.message ?? ""));
function fail(what: string, error: { code?: string; message?: string }): never {
  if (missing(error)) throw new CandidateActionError(503, APPLY_MIGRATION_MESSAGE);
  console.error(`[candidates] applications: ${what}`, error);
  throw new CandidateActionError(500, `Couldn't ${what}. Please try again.`);
}

/** Someone acting for the system (an applicant, or automatic outreach): no user id in the history. */
export const systemActor = (name: string, id: string | null = null): Actor => ({ id: id as string, name });

// Links ---------------------------------------------------------------------------------------------------------------

export interface ApplicationLink { id: string; token: string; kind: "personal" | "open"; positionId: string | null; url: string }
const newToken = () => randomBytes(24).toString("base64url");
const toLink = (row: { id: string; token: string; kind: "personal" | "open"; position_id: string | null }): ApplicationLink =>
  ({ id: row.id, token: row.token, kind: row.kind, positionId: row.position_id ?? null, url: applicationUrl(row.token) });

/** The candidate's own link for this position (made once, then reused). */
export async function personalLink(client: SupabaseClient, orgId: string, a: { candidateId: string; applicationId: string | null; positionId: string | null; createdBy: string | null }): Promise<ApplicationLink> {
  const find = async () => {
    let q = client.from(LINKS).select("id, token, kind, position_id").eq("organization_id", orgId).eq("kind", "personal").eq("candidate_id", a.candidateId);
    q = a.positionId ? q.eq("position_id", a.positionId) : q.is("position_id", null);
    const { data, error } = await q.limit(1);
    if (error) fail("make the application link", error);
    return ((data ?? []) as { id: string; token: string; kind: "personal"; position_id: string | null }[])[0] ?? null;
  };
  const found = await find();
  if (found) return toLink(found);
  const { data, error } = await client.from(LINKS).insert({
    organization_id: orgId, token: newToken(), kind: "personal", candidate_id: a.candidateId, application_id: a.applicationId, position_id: a.positionId, created_by: a.createdBy,
  }).select("id, token, kind, position_id").single();
  if (error) {
    // Made by another send at the same moment: use that one.
    if ((error as { code?: string }).code === "23505") { const again = await find(); if (again) return toLink(again); }
    fail("make the application link", error);
  }
  return toLink(data as { id: string; token: string; kind: "personal"; position_id: string | null });
}

/** The position's open link, for job postings (made once, then reused). */
export async function openLink(client: SupabaseClient, orgId: string, positionId: string | null, createdBy: string): Promise<ApplicationLink> {
  if (positionId !== null && !UUID.test(positionId)) throw new CandidateActionError(400, "Choose a position.");
  const find = async () => {
    let q = client.from(LINKS).select("id, token, kind, position_id").eq("organization_id", orgId).eq("kind", "open").is("disabled_at", null);
    q = positionId ? q.eq("position_id", positionId) : q.is("position_id", null);
    const { data, error } = await q.limit(1);
    if (error) fail("make the application link", error);
    return ((data ?? []) as { id: string; token: string; kind: "open"; position_id: string | null }[])[0] ?? null;
  };
  const found = await find();
  if (found) return toLink(found);
  if (positionId) {
    const { data, error } = await client.from("candidate_positions").select("id").eq("organization_id", orgId).eq("id", positionId).is("deleted_at", null).maybeSingle();
    if (error) fail("check the position", error);
    if (!data) throw new CandidateActionError(404, "That position no longer exists.");
  }
  const { data, error } = await client.from(LINKS).insert({ organization_id: orgId, token: newToken(), kind: "open", position_id: positionId, created_by: createdBy }).select("id, token, kind, position_id").single();
  if (error) {
    if ((error as { code?: string }).code === "23505") { const again = await find(); if (again) return toLink(again); }
    fail("make the application link", error);
  }
  return toLink(data as { id: string; token: string; kind: "open"; position_id: string | null });
}

/** Owner 2026-11-24 (migration 20261124000003): the candidate's own link to the screening questions (one per screening). */
export async function screeningLink(client: SupabaseClient, orgId: string, a: { candidateId: string; applicationId: string | null; positionId: string; createdBy: string | null }): Promise<ApplicationLink> {
  const { data, error } = await client.from(LINKS).insert({
    organization_id: orgId, token: newToken(), kind: "screening", candidate_id: a.candidateId, application_id: a.applicationId, position_id: a.positionId, created_by: a.createdBy,
  }).select("id, token, kind, position_id").single();
  if (error) fail("make the screening link", error);
  const row = data as { id: string; token: string; position_id: string | null };
  return { id: row.id, token: row.token, kind: "personal", positionId: row.position_id, url: applicationUrl(row.token) };
}

interface LinkRow {
  id: string; organization_id: string; token: string; kind: "personal" | "open" | "screening" | "assignment" | "documents"; candidate_id: string | null; application_id: string | null;
  position_id: string | null; created_by: string | null; disabled_at: string | null;
}
async function linkByToken(client: SupabaseClient, token: string): Promise<LinkRow | null> {
  if (!TOKEN.test(token)) return null;
  const { data, error } = await client.from(LINKS).select("id, organization_id, token, kind, candidate_id, application_id, position_id, created_by, disabled_at").eq("token", token).maybeSingle();
  if (error) fail("open the form", error);
  const row = data as LinkRow | null;
  return row && !row.disabled_at ? row : null;
}

// The public form ------------------------------------------------------------------------------------------------------

export interface PublicForm {
  form: ApplicationFormConfig;
  companyName: string;
  role: string | null;
  location: string | null;
  /** A personal link greets the person by first name; nothing else about them is shown. */
  firstName: string | null;
  /** Owner 2026-11-24: "screening" for the screening questions (no resume, the person is known); "assignment"; "documents". */
  kind?: "application" | "screening" | "assignment" | "documents";
  /** Owner 2026-11-24: the company profile link HR set, when any. */
  companyProfileUrl?: string | null;
  /** Owner 2026-11-24: the assignment's brief (kind "assignment"). */
  assignment?: { title: string; brief: string; guidelines: string | null; driveLink: string | null; attachmentName?: string; downloadUrl?: string; due: string | null; submitted: boolean } | null;
}

/** Owner 2026-11-24: a link of another kind (assignment, documents) for a known person. */
export async function kindLink(client: SupabaseClient, orgId: string, kind: "assignment" | "documents", a: { candidateId: string; applicationId: string | null; positionId: string | null; createdBy: string | null }): Promise<ApplicationLink> {
  const { data, error } = await client.from(LINKS).insert({
    organization_id: orgId, token: newToken(), kind, candidate_id: a.candidateId, application_id: a.applicationId, position_id: a.positionId, created_by: a.createdBy,
  }).select("id, token, kind, position_id").single();
  if (error) fail(`make the ${kind} link`, error);
  const row = data as { id: string; token: string; position_id: string | null };
  return { id: row.id, token: row.token, kind: "personal", positionId: row.position_id, url: applicationUrl(row.token) };
}

/** The assignment page's form: a link to the work, notes, and a file (at least one of them). */
export const ASSIGNMENT_FORM_FIELDS: ApplicationField[] = [
  { id: "submission_link", label: "Link to your work (Drive, Behance, GitHub…)", type: "text", required: false, target: null },
  { id: "notes", label: "Notes for the reviewer", type: "textarea", required: false, target: null },
  { id: "work_file", label: "Your file", type: "file", required: false, help: "PDF, Word, PowerPoint, Excel, image or ZIP, up to 4 MB", target: null },
];
/** The documents page's form: one file per document HR asks for. */
export const documentFields = (items: string[]): ApplicationField[] => items.map((label, i) => ({ id: `doc_${i + 1}`, label, type: "file" as const, required: false, help: "PDF or image, up to 4 MB", target: null }));

/**
 * The screening questions as a form (the same page and checks as the application form). Owner 2026-11-25: with the
 * position's own questions (drafted from its JD and saved by HR) after the standard ones, when it has any.
 */
export const screeningForm = (s: OutreachSettings, own: ApplicationField[] | null = null): ApplicationFormConfig => ({
  title: "Screening questions",
  intro: s.screening.intro,
  fields: questionsFor(s, own),
  consentText: s.applicationForm.consentText,
  thanks: "Thank you. Your answers have reached our recruitment team; we will call you shortly.",
});

/** What the public page shows for a link, or null when the link is unknown or switched off. Marks the link opened. */
export async function publicForm(client: SupabaseClient, token: string, downloadBrief = false): Promise<PublicForm | null> {
  const link = await linkByToken(client, token);
  if (!link) return null;
  const [config, position, person] = await Promise.all([
    loadRecruitmentConfig(client, link.organization_id),
    link.position_id ? client.from("candidate_positions").select("title, location, deleted_at").eq("organization_id", link.organization_id).eq("id", link.position_id).maybeSingle() : Promise.resolve({ data: null }),
    link.candidate_id ? client.from("candidates").select("full_name").eq("organization_id", link.organization_id).eq("id", link.candidate_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const p = position.data as { title?: string; location?: string | null; deleted_at?: string | null } | null;
  if (p?.deleted_at) return null;
  await client.from(LINKS).update({ opened_at: new Date().toISOString() }).eq("id", link.id).is("opened_at", null);
  const name = (person.data as { full_name?: string | null } | null)?.full_name ?? "";
  if (link.kind === "assignment" || link.kind === "documents") return kindForm(client, link, config.outreach, downloadBrief, { role: p?.title ?? null, location: p?.location ?? null, firstName: name.trim().split(/\s+/)[0] || null });
  const screening = link.kind === "screening";
  if (screening) {
    // Answered once: the link does not take a second set.
    const { data: s } = await client.from(SCREENINGS).select("status").eq("link_id", link.id).maybeSingle();
    if ((s as { status?: string } | null)?.status === "answered") return null;
  }
  return {
    form: screening ? screeningForm(config.outreach, await ownQuestions(client, link.organization_id, link.position_id)) : (config.outreach.applicationForm ?? DEFAULT_OUTREACH.applicationForm),
    companyName: config.outreach.companyName,
    role: p?.title ?? null,
    location: p?.location ?? null,
    firstName: name.trim().split(/\s+/)[0] || null,
    kind: screening ? "screening" : "application",
    companyProfileUrl: config.outreach.companyProfileUrl || null,
  };
}

export class FormError extends Error {
  constructor(readonly fieldId: string | null, message: string) { super(message); }
}

/** One answer, checked against its question. Returns the cleaned value ("" / null when left blank). */
function answerOf(field: ApplicationField, raw: unknown): string | number | null {
  const s = typeof raw === "string" ? raw.trim() : typeof raw === "number" ? String(raw) : "";
  if (!s) {
    if (field.required && field.type !== "file") throw new FormError(field.id, `Please answer "${field.label}".`);
    return null;
  }
  switch (field.type) {
    case "email":
      if (!parseEmail(s).key) throw new FormError(field.id, "Enter a valid email address.");
      return s.toLowerCase().slice(0, 200);
    case "phone":
      if (!parsePhone(s).key) throw new FormError(field.id, "Enter a valid 10-digit mobile number.");
      return s.slice(0, 40);
    case "number": {
      const n = Number(s.replace(/[, ]/g, ""));
      if (!Number.isFinite(n) || n < 0 || n > 100_000_000) throw new FormError(field.id, `"${field.label}" must be a number.`);
      return n;
    }
    case "date":
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new FormError(field.id, `"${field.label}" must be a date.`);
      return s;
    case "select":
      if (!(field.options ?? []).includes(s)) throw new FormError(field.id, `Choose one of the options for "${field.label}".`);
      return s;
    case "textarea":
      return s.slice(0, 3000);
    default:
      return s.slice(0, 500);
  }
}

const list = (v: unknown) => String(v ?? "").split(/[,\n;]/).map((x) => x.trim()).filter(Boolean);
const whole = (v: unknown, max: number) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(max, Math.max(0, n)) : null; };

/** The record's fields from the answers (only the questions that fill one). */
export function recordFieldsFrom(form: ApplicationFormConfig, answers: Record<string, string | number | null>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of form.fields) {
    const v = answers[field.id];
    if (!field.target || field.target === "resume" || v === null || v === undefined || v === "") continue;
    const t = field.target as Exclude<ApplicationTarget, "resume">;
    switch (t) {
      case "totalExpYears": out.totalExpMonths = whole(Number(v) * 12, 720); break;
      case "relevantExpYears": out.relevantExpMonths = whole(Number(v) * 12, 720); break;
      case "noticePeriodDays": out.noticePeriodDays = whole(v, 365); break;
      case "currentInhand": out.currentInhand = whole(v, 10_000_000); break;
      case "expectedInhand": out.expectedInhand = whole(v, 10_000_000); break;
      case "skills": out.skills = list(v).slice(0, 40).map((x) => x.slice(0, 60)); break;
      case "preferredLocations": out.preferredLocations = list(v).slice(0, 10).map((x) => x.slice(0, 80)); break;
      default: out[t] = String(v).slice(0, t === "fullName" ? 120 : 200);
    }
  }
  return out;
}

export interface ResumeUpload { name: string; type: string; bytes: Uint8Array }
/** The slice of storage this module uses; the tests pass a fake. */
export interface ApplicationStorage { upload(path: string, bytes: Uint8Array, contentType: string): Promise<{ error: { message: string } | null }> }
const defaultStorage = (client: SupabaseClient): ApplicationStorage => ({
  upload: async (path, bytes, contentType) => client.storage.from(RESUME_BUCKET).upload(path, bytes, { contentType, upsert: false }),
});

/**
 * Accepts a submitted form. Checks every answer against HR's questions (FormError names the question), keeps the
 * answers and the resume, adds or updates the person's record, puts them in the position's pipeline when the link names
 * one, and writes the history. Returns the thank-you text.
 */
export async function submitApplication(
  client: SupabaseClient,
  token: string,
  input: { answers: Record<string, unknown>; consent: boolean; resume: ResumeUpload | null; ip: string | null; userAgent: string | null; files?: Record<string, ResumeUpload> },
  storage?: ApplicationStorage,
): Promise<{ thanks: string; applicationId: string; assignmentId?: string; organizationId?: string }> {
  const link = await linkByToken(client, token);
  if (!link) throw new CandidateActionError(404, "This application link is no longer open.");
  const orgId = link.organization_id;
  const config = await loadRecruitmentConfig(client, orgId);
  if (!input.consent) throw new FormError("consent", "Please agree to the consent statement to apply.");
  if (link.kind === "screening") return submitScreening(client, link, config.outreach, input.answers);
  if (link.kind === "assignment") return submitAssignment(client, link, input.answers, input.files ?? {}, storage ?? defaultStorage(client));
  if (link.kind === "documents") return submitDocuments(client, link, config.outreach, input.files ?? {}, storage ?? defaultStorage(client));
  const form = config.outreach.applicationForm;

  const answers: Record<string, string | number | null> = {};
  for (const field of form.fields) answers[field.id] = answerOf(field, input.answers[field.id]);
  const fileField = form.fields.find((f) => f.type === "file") ?? null;
  if (fileField?.required && !input.resume) throw new FormError(fileField.id, `Please attach your ${fileField.label.toLowerCase()}.`);
  if (input.resume) {
    if (!fileField) throw new FormError(null, "This form does not take a file.");
    if (!RESUME_TYPES[input.resume.type]) throw new FormError(fileField.id, "Attach a PDF or Word file.");
    if (input.resume.bytes.byteLength > MAX_RESUME_BYTES) throw new FormError(fileField.id, "The file is over 4 MB. Attach a smaller one.");
    if (!input.resume.bytes.byteLength) throw new FormError(fileField.id, "The file is empty.");
  }
  const fields = recordFieldsFrom(form, answers);
  for (const target of REQUIRED_TARGETS) if (!fields[target]) throw new FormError(form.fields.find((f) => f.target === target)?.id ?? null, `Please answer "${form.fields.find((f) => f.target === target)?.label ?? target}".`);

  // The role on the record is the position's title, when the link names one.
  let role: string | null = null;
  if (link.position_id) {
    const { data } = await client.from("candidate_positions").select("title").eq("organization_id", orgId).eq("id", link.position_id).maybeSingle();
    role = (data as { title?: string } | null)?.title ?? null;
  }
  const { record } = await createRecord(client, orgId, null, {
    ...fields, candidateSource: APPLICATION_SOURCE, sourcingDate: new Date().toISOString().slice(0, 10), ...(role ? { role } : {}),
  });
  // Owner 2026-11-24 (product safety): when and on what basis the person agreed to us keeping their data.
  await client.from("candidates").update({ consent_at: new Date().toISOString(), consent_basis: "Job application form" }).eq("organization_id", orgId).eq("id", record.candidateId);

  // The answers and the resume, kept as given.
  const { data: saved, error } = await client.from(APPLICATIONS).insert({
    organization_id: orgId, link_id: link.id, position_id: link.position_id, candidate_id: record.candidateId, application_id: record.id,
    answers, consent: true, ip: input.ip?.slice(0, 80) ?? null, user_agent: input.userAgent?.slice(0, 300) ?? null,
  }).select("id").single();
  if (error) fail("save the application", error);
  const applicationRowId = (saved as { id: string }).id;
  if (input.resume) {
    const ext = RESUME_TYPES[input.resume.type];
    const path = `applications/${orgId}/${applicationRowId}.${ext}`;
    const up = await (storage ?? defaultStorage(client)).upload(path, input.resume.bytes, input.resume.type);
    if (up.error) console.error("[candidates] application resume upload failed", up.error);
    else await client.from(APPLICATIONS).update({ resume_path: path, resume_name: input.resume.name.slice(0, 200) }).eq("id", applicationRowId);
  }
  const now = new Date().toISOString();
  const { data: counted } = await client.from(LINKS).select("submissions").eq("id", link.id).maybeSingle();
  await client.from(LINKS).update({ submitted_at: now, submissions: (((counted as { submissions?: number } | null)?.submissions) ?? 0) + 1 }).eq("id", link.id);

  const by = systemActor(APPLICATION_SOURCE, link.created_by);
  if (link.position_id) {
    try {
      await addMembers(client, orgId, by, link.position_id, [record.id]);
    } catch (e) {
      console.error("[candidates] application: could not add to the position", e);
    }
  }
  await recordAction(client, orgId, systemActor(APPLICATION_SOURCE), {
    candidateId: record.candidateId, applicationId: record.id, positionId: link.position_id, action: "remark",
    toValue: `Applied through the job application form${role ? ` for ${role}` : ""}`, meta: { kind: "application_form", applicationFormId: applicationRowId, link: link.kind },
  });
  return { thanks: form.thanks, applicationId: applicationRowId };
}

// Assignments and documents (owner 2026-11-24) -------------------------------------------------------------------------

const ASSIGNMENTS = "recruitment_assignments";
const DOCUMENTS = "recruitment_documents";
const WORK_TYPES: Record<string, string> = {
  ...RESUME_TYPES,
  "application/vnd.ms-powerpoint": "ppt", "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "application/vnd.ms-excel": "xls", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "image/png": "png", "image/jpeg": "jpg", "application/zip": "zip", "application/x-zip-compressed": "zip",
};
const DOC_TYPES: Record<string, string> = { "application/pdf": "pdf", "image/png": "png", "image/jpeg": "jpg" };
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "Mon, 1 Dec 2026 at 6:00 pm (IST)". */
export function istDue(at: Date): string {
  const d = new Date(at.getTime() + 330 * 60_000);
  const h = d.getUTCHours();
  return `${DAYS[d.getUTCDay()]}, ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()} at ${h % 12 || 12}:${String(d.getUTCMinutes()).padStart(2, "0")} ${h < 12 ? "am" : "pm"} (IST)`;
}

async function kindForm(client: SupabaseClient, link: LinkRow, s: OutreachSettings, downloadBrief: boolean, ctx: { role: string | null; location: string | null; firstName: string | null }): Promise<PublicForm | null> {
  const base = { companyName: s.companyName, role: ctx.role, location: ctx.location, firstName: ctx.firstName, companyProfileUrl: s.companyProfileUrl || null };
  if (link.kind === "assignment") {
    const { data } = await client.from(ASSIGNMENTS).select("*").eq("organization_id", link.organization_id).eq("link_id", link.id).maybeSingle();
    const a = data as { title: string; brief: string; guidelines: string | null; drive_link: string | null; brief_attachment?: unknown; due_at: string | null; status: string } | null;
    if (!a || a.status === "cancelled") return null;
    const attachment = BriefAttachmentSchema.safeParse(a.brief_attachment);
    return {
      ...base, kind: "assignment",
      form: { title: "Assignment", intro: "Read the brief, do the work, then submit it here: a link, a file, or both.", fields: ASSIGNMENT_FORM_FIELDS, consentText: s.applicationForm.consentText, thanks: "Thank you. Your assignment has reached our recruitment team; we will be in touch." },
      assignment: { title: a.title, brief: a.brief, guidelines: a.guidelines, driveLink: a.drive_link,
        ...(attachment.success ? { attachmentName: attachment.data.name } : {}),
        ...(downloadBrief && attachment.success ? { downloadUrl: await briefDownloadUrl(client, link.organization_id, attachment.data) } : {}),
        due: a.due_at ? istDue(new Date(a.due_at)) : null, submitted: a.status === "submitted" },
    };
  }
  return {
    ...base, kind: "documents",
    form: { title: "Your documents", intro: "Please upload the documents below so we can prepare your offer. Upload what you have now; you can open this link again to add the rest.", fields: documentFields(s.documents.items), consentText: s.applicationForm.consentText, thanks: "Thank you. Your documents have reached our recruitment team." },
  };
}

async function upload(storage: ApplicationStorage, path: string, file: ResumeUpload): Promise<boolean> {
  const up = await storage.upload(path, file.bytes, file.type);
  if (up.error) console.error("[candidates] upload failed", up.error);
  return !up.error;
}

/** The candidate's assignment: a link, notes and / or a file (at least one); once, until HR asks again. */
async function submitAssignment(client: SupabaseClient, link: LinkRow, raw: Record<string, unknown>, files: Record<string, ResumeUpload>, storage: ApplicationStorage): Promise<{ thanks: string; applicationId: string; assignmentId: string; organizationId: string }> {
  const orgId = link.organization_id;
  const { data, error } = await client.from(ASSIGNMENTS).select("id, status, candidate_id, application_id, position_id").eq("link_id", link.id).maybeSingle();
  if (error) fail("find the assignment", error);
  const a = data as { id: string; status: string; candidate_id: string; application_id: string | null; position_id: string } | null;
  if (!a || a.status === "cancelled") throw new CandidateActionError(404, "This assignment link is no longer open.");
  if (a.status === "submitted") throw new CandidateActionError(409, "This assignment was already submitted. Thank you.");
  const linkText = typeof raw.submission_link === "string" ? raw.submission_link.trim().slice(0, 500) : "";
  if (linkText && !/^https?:\/\/\S+$/i.test(linkText)) throw new FormError("submission_link", "The link must start with https://.");
  const notes = typeof raw.notes === "string" ? raw.notes.trim().slice(0, 5000) : "";
  const file = files.work_file ?? null;
  if (file) {
    if (!WORK_TYPES[file.type]) throw new FormError("work_file", "Attach a PDF, Word, PowerPoint, Excel, image or ZIP file.");
    if (file.bytes.byteLength > MAX_RESUME_BYTES) throw new FormError("work_file", "The file is over 4 MB. Share a link instead.");
  }
  if (!linkText && !notes && !file) throw new FormError("submission_link", "Add a link to your work, a file, or both.");
  const now = new Date().toISOString();
  const { data: claimed, error: claimError } = await client.from(ASSIGNMENTS).update({ status: "submitted", submitted_at: now, submission_link: linkText || null, submission_note: notes || null, ai_status: "pending" }).eq("id", a.id).eq("status", "sent").select("id");
  if (claimError) fail("save the assignment", claimError);
  if (!(claimed ?? []).length) throw new CandidateActionError(409, "This assignment was already submitted. Thank you.");
  if (file) {
    const path = `assignments/${orgId}/${a.id}.${WORK_TYPES[file.type]}`;
    if (await upload(storage, path, file)) await client.from(ASSIGNMENTS).update({ file_path: path, file_name: file.name.slice(0, 200) }).eq("id", a.id);
  }
  await client.from(LINKS).update({ submitted_at: now, submissions: 1 }).eq("id", link.id);
  await recordAction(client, orgId, systemActor("Assignment page"), {
    candidateId: a.candidate_id, applicationId: a.application_id, positionId: a.position_id, action: "remark", toValue: "Submitted the assignment", meta: { kind: "assignment_submitted", assignmentId: a.id },
  });
  return { thanks: "Thank you. Your assignment has reached our recruitment team; we will be in touch.", applicationId: a.id, assignmentId: a.id, organizationId: orgId };
}

/** The candidate's documents: one file per item HR asks for; the link stays open to add the rest. */
async function submitDocuments(client: SupabaseClient, link: LinkRow, settings: OutreachSettings, files: Record<string, ResumeUpload>, storage: ApplicationStorage): Promise<{ thanks: string; applicationId: string }> {
  const orgId = link.organization_id;
  if (!link.candidate_id) throw new CandidateActionError(404, "This link is no longer open.");
  const fields = documentFields(settings.documents.items);
  const given = fields.filter((f) => files[f.id]);
  if (!given.length) throw new FormError(fields[0]?.id ?? null, "Attach at least one document.");
  for (const f of given) {
    const file = files[f.id];
    if (!DOC_TYPES[file.type]) throw new FormError(f.id, `"${f.label}": attach a PDF or an image.`);
    if (file.bytes.byteLength > MAX_RESUME_BYTES) throw new FormError(f.id, `"${f.label}" is over 4 MB.`);
  }
  const { data: offer } = await client.from("recruitment_offers").select("id").eq("organization_id", orgId).eq("candidate_id", link.candidate_id).in("status", ["pending", "approved", "released"]).order("created_at", { ascending: false }).limit(1);
  const offerId = ((offer ?? []) as { id: string }[])[0]?.id ?? null;
  let saved = 0;
  for (const f of given) {
    const file = files[f.id];
    const { data: row, error } = await client.from(DOCUMENTS).insert({ organization_id: orgId, candidate_id: link.candidate_id, position_id: link.position_id, offer_id: offerId, link_id: link.id, item: f.label, file_path: "pending", file_name: file.name.slice(0, 200) }).select("id").single();
    if (error) fail("save the document", error);
    const id = (row as { id: string }).id;
    const path = `documents/${orgId}/${id}.${DOC_TYPES[file.type]}`;
    if (await upload(storage, path, file)) { await client.from(DOCUMENTS).update({ file_path: path }).eq("id", id); saved += 1; }
    else await client.from(DOCUMENTS).update({ status: "rejected", review_note: "The upload failed; ask the candidate to upload it again." }).eq("id", id);
  }
  await client.from(LINKS).update({ submitted_at: new Date().toISOString() }).eq("id", link.id);
  await recordAction(client, orgId, systemActor("Documents page"), {
    candidateId: link.candidate_id, applicationId: link.application_id, positionId: link.position_id, action: "remark", toValue: `Uploaded ${saved} document${saved === 1 ? "" : "s"}`, meta: { kind: "documents_uploaded", items: given.map((f) => f.label) },
  });
  return { thanks: "Thank you. Your documents have reached our recruitment team.", applicationId: link.id };
}

/**
 * Owner 2026-11-24: the screening answers. Checked against HR's screening questions; the answers that fill a field go on
 * the person's record (the one the screening was sent for); the screening is marked answered (once); the history says so.
 */
async function submitScreening(client: SupabaseClient, link: LinkRow, settings: OutreachSettings, raw: Record<string, unknown>): Promise<{ thanks: string; applicationId: string }> {
  const orgId = link.organization_id;
  const { data: s, error } = await client.from(SCREENINGS).select("id, status, application_id, candidate_id, position_id, sent_by, sent_by_name").eq("organization_id", orgId).eq("link_id", link.id).maybeSingle();
  if (error) fail("find the screening", error);
  const row = s as { id: string; status: string; application_id: string | null; candidate_id: string; position_id: string; sent_by: string | null; sent_by_name: string | null } | null;
  if (!row) throw new CandidateActionError(404, "This link is no longer open.");
  if (row.status === "answered") throw new CandidateActionError(409, "These questions were already answered. Thank you.");
  const form = screeningForm(settings, await ownQuestions(client, orgId, row.position_id));
  const answers: Record<string, string | number | null> = {};
  for (const field of form.fields) answers[field.id] = answerOf(field, raw[field.id]);

  // Claimed once: a second submit at the same moment finds it answered.
  const now = new Date().toISOString();
  const { data: claimed, error: claimError } = await client.from(SCREENINGS).update({ status: "answered", answers, answered_at: now }).eq("id", row.id).neq("status", "answered").select("id");
  if (claimError) fail("save the answers", claimError);
  if (!(claimed ?? []).length) throw new CandidateActionError(409, "These questions were already answered. Thank you.");
  await client.from(LINKS).update({ submitted_at: now, submissions: 1 }).eq("id", link.id);

  const fields = recordFieldsFrom(form, answers);
  const applicationId = row.application_id ?? link.application_id;
  if (applicationId && Object.keys(fields).length && row.sent_by) {
    try {
      await updateRecord(client, orgId, row.sent_by, applicationId, fields);
    } catch (e) {
      console.error("[candidates] screening: the record was not updated", e);
    }
  }
  await recordAction(client, orgId, systemActor("Screening questions"), {
    candidateId: row.candidate_id, applicationId, positionId: row.position_id, action: "remark",
    toValue: "Answered the screening questions", meta: { kind: "screening_answered", screeningId: row.id },
  });
  await client.from("candidates").update({ consent_at: now, consent_basis: "Screening questions" }).eq("organization_id", orgId).eq("id", row.candidate_id);
  return { thanks: form.thanks, applicationId: row.id };
}

// For HR: the applications received ---------------------------------------------------------------------------------------

export interface ApplicationEntry {
  id: string; createdAt: string; candidateId: string | null; applicationId: string | null; positionId: string | null; positionTitle: string | null;
  name: string; email: string | null; phone: string | null; answers: Record<string, string | number | null>; hasResume: boolean; resumeName: string | null; via: "personal" | "open" | null;
}

/** The applications received, newest first (Recruitment → Outreach → Applications). */
export async function listApplications(client: SupabaseClient, orgId: string, opts: { positionId?: string | null; page?: number } = {}): Promise<{ applications: ApplicationEntry[]; total: number; form: ApplicationFormConfig }> {
  const page = Math.max(1, Math.min(1000, Math.floor(opts.page ?? 1)));
  let q = client.from(APPLICATIONS).select("id, created_at, candidate_id, application_id, position_id, answers, resume_path, resume_name, link_id", { count: "exact" }).eq("organization_id", orgId);
  if (opts.positionId && UUID.test(opts.positionId)) q = q.eq("position_id", opts.positionId);
  const { data, error, count } = await q.order("created_at", { ascending: false }).range((page - 1) * 30, page * 30 - 1);
  if (error) fail("load the applications", error);
  const rows = (data ?? []) as { id: string; created_at: string; candidate_id: string | null; application_id: string | null; position_id: string | null; answers: Record<string, string | number | null>; resume_path: string | null; resume_name: string | null; link_id: string | null }[];
  const config = await loadRecruitmentConfig(client, orgId);
  const form = config.outreach.applicationForm;
  const positionIds = [...new Set(rows.map((r) => r.position_id).filter((x): x is string => Boolean(x)))];
  const linkIds = [...new Set(rows.map((r) => r.link_id).filter((x): x is string => Boolean(x)))];
  const [titles, links] = await Promise.all([
    positionIds.length ? client.from("candidate_positions").select("id, title").eq("organization_id", orgId).in("id", positionIds) : Promise.resolve({ data: [] }),
    linkIds.length ? client.from(LINKS).select("id, kind").in("id", linkIds) : Promise.resolve({ data: [] }),
  ]);
  const titleOf = new Map(((titles.data ?? []) as { id: string; title: string }[]).map((t) => [t.id, t.title]));
  const kindOf = new Map(((links.data ?? []) as { id: string; kind: "personal" | "open" }[]).map((l) => [l.id, l.kind]));
  const by = (target: ApplicationTarget, answers: Record<string, string | number | null>) => {
    const f = form.fields.find((x) => x.target === target);
    const v = f ? answers[f.id] : null;
    return v === null || v === undefined || v === "" ? null : String(v);
  };
  return {
    form,
    total: count ?? 0,
    applications: rows.map((r) => ({
      id: r.id, createdAt: (r.created_at as unknown) instanceof Date ? (r.created_at as unknown as Date).toISOString() : String(r.created_at), candidateId: r.candidate_id, applicationId: r.application_id,
      positionId: r.position_id, positionTitle: r.position_id ? titleOf.get(r.position_id) ?? null : null,
      name: by("fullName", r.answers) ?? "Applicant", email: by("email", r.answers), phone: by("phone", r.answers), answers: r.answers,
      hasResume: Boolean(r.resume_path), resumeName: r.resume_name, via: r.link_id ? kindOf.get(r.link_id) ?? null : null,
    })),
  };
}

/** A one-time link (10 minutes) to an application's resume file. */
export async function applicationResumeUrl(client: SupabaseClient, orgId: string, id: unknown): Promise<string> {
  if (typeof id !== "string" || !UUID.test(id)) throw new CandidateActionError(404, "That application no longer exists.");
  const { data, error } = await client.from(APPLICATIONS).select("resume_path, resume_name").eq("organization_id", orgId).eq("id", id).maybeSingle();
  if (error) fail("find the resume", error);
  const path = (data as { resume_path?: string | null } | null)?.resume_path;
  if (!path || !path.startsWith(`applications/${orgId}/`)) throw new CandidateActionError(404, "This application has no resume file.");
  const signed = await client.storage.from(RESUME_BUCKET).createSignedUrl(path, 600, { download: (data as { resume_name?: string | null }).resume_name ?? true });
  if (signed.error || !signed.data?.signedUrl) throw new CandidateActionError(502, "Couldn't open the resume. Please try again.");
  return signed.data.signedUrl;
}
