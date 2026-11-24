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
import { RESUME_BUCKET } from "./config";
import { parseEmail, parsePhone } from "./normalize";
import { DEFAULT_OUTREACH, REQUIRED_TARGETS, type ApplicationField, type ApplicationFormConfig, type ApplicationTarget } from "./outreach-settings";
import { addMembers } from "./positions";
import { CandidateActionError, createRecord } from "./records";
import { loadRecruitmentConfig } from "./requisitions";

const LINKS = "recruitment_application_links";
const APPLICATIONS = "recruitment_applications";
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

interface LinkRow {
  id: string; organization_id: string; token: string; kind: "personal" | "open"; candidate_id: string | null; application_id: string | null;
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
}

/** What the public page shows for a link, or null when the link is unknown or switched off. Marks the link opened. */
export async function publicForm(client: SupabaseClient, token: string): Promise<PublicForm | null> {
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
  return {
    form: config.outreach.applicationForm ?? DEFAULT_OUTREACH.applicationForm,
    companyName: config.outreach.companyName,
    role: p?.title ?? null,
    location: p?.location ?? null,
    firstName: name.trim().split(/\s+/)[0] || null,
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
  input: { answers: Record<string, unknown>; consent: boolean; resume: ResumeUpload | null; ip: string | null; userAgent: string | null },
  storage?: ApplicationStorage,
): Promise<{ thanks: string; applicationId: string }> {
  const link = await linkByToken(client, token);
  if (!link) throw new CandidateActionError(404, "This application link is no longer open.");
  const orgId = link.organization_id;
  const config = await loadRecruitmentConfig(client, orgId);
  const form = config.outreach.applicationForm;
  if (!input.consent) throw new FormError("consent", "Please agree to the consent statement to apply.");

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
