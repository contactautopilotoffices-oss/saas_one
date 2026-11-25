/**
 * The assignment stage and the documents request (owner 2026-11-24, from the 23 Nov HR meeting; migration
 * 20261124000004):
 *   Assignment: HR sends the details, guidelines, a Drive link and a deadline (from a ready-made assignment of the
 *   department, or written fresh). The candidate gets a WhatsApp (hr_candidate_assignment_v1) with their own link, and
 *   submits a link, notes and/or a file there. The position's stakeholders are told it went out. On submit an AI score
 *   against the JD is made (assignment-score.ts): HR sees it, the hiring manager never does.
 *   Documents: after selection HR asks for the documents (salary slips and the like) through the candidate's own link
 *   (hr_candidate_documents_v1); the files go straight into the system and HR marks each verified or rejected.
 *
 * Blacklisted or removed people get nothing. The WhatsApp sender is injected, so no test sends a message.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { recordAction, type Actor } from "./actions";
import { istDue, kindLink } from "./applications";
import { logMessage } from "./audit";
import { RESUME_BUCKET } from "./config";
import { parsePhone } from "./normalize";
import { whatsappParams, type OutreachSettings } from "./outreach-settings";
import { CandidateActionError } from "./records";
import { loadRecruitmentConfig } from "./requisitions";
import { defaultScreeningSender, type ScreeningSender } from "./screening";
import { alertPositionStakeholders } from "./stakeholders";

const ASSIGNMENTS = "recruitment_assignments";
const DOCUMENTS = "recruitment_documents";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const ASSIGNMENT_MIGRATION_MESSAGE = "Assignments and documents need a database update first: run 20261124000004_recruitment_assignment_loi_audit.sql in Supabase.";
const missing = (error: { code?: string; message?: string } | null | undefined) =>
  Boolean(error) && (["42P01", "42703", "PGRST205", "PGRST204"].includes(error?.code ?? "") || /recruitment_assignments|recruitment_documents|does not exist|schema cache/i.test(error?.message ?? "") || (error?.code === "23514" && /kind_check/.test(error?.message ?? "")));

export type Sender = ScreeningSender;
export interface Deps { send?: Sender; alert?: typeof alertPositionStakeholders }

interface Person { candidateId: string; fullName: string; phoneKey: string | null; blocked: boolean; role: string | null; location: string | null }
async function person(client: SupabaseClient, orgId: string, candidateId: string, positionId: string | null): Promise<Person> {
  const [{ data: c }, { data: p }] = await Promise.all([
    client.from("candidates").select("id, full_name, phone, blacklisted_at, removed_at").eq("organization_id", orgId).eq("id", candidateId).maybeSingle(),
    positionId ? client.from("candidate_positions").select("title, location").eq("organization_id", orgId).eq("id", positionId).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  if (!c) throw new CandidateActionError(404, "Candidate not found.");
  const row = c as { full_name?: string | null; phone?: string | null; blacklisted_at?: string | null; removed_at?: string | null };
  const pos = p as { title?: string; location?: string | null } | null;
  return { candidateId, fullName: (row.full_name ?? "").trim(), phoneKey: parsePhone(row.phone ?? "").key, blocked: Boolean(row.blacklisted_at || row.removed_at), role: pos?.title ?? null, location: pos?.location ?? null };
}

async function whatsapp(settings: OutreachSettings, templateId: string, p: Person, values: Record<string, string | null>, send: Sender): Promise<{ ok: boolean; note: string | null }> {
  const t = settings.templates.find((x) => x.id === templateId && x.channel === "whatsapp");
  if (!t) return { ok: false, note: "The WhatsApp template is missing (Recruitment → Outreach)." };
  if (!p.phoneKey) return { ok: false, note: "No valid Indian mobile number on record." };
  const { params, gaps } = whatsappParams(t, { first_name: p.fullName.split(/\s+/)[0] || null, full_name: p.fullName || null, company: settings.companyName, role: p.role, location: p.location, ...values });
  if (gaps.length) return { ok: false, note: `Nothing to fill ${gaps.map((g) => `{{${g}}}`).join(", ")}.` };
  try {
    const r = await send({ phone: `91${p.phoneKey}`, campaignName: t.campaign ?? "", templateParams: params, userName: p.fullName || undefined });
    return r.success ? { ok: true, note: null } : { ok: false, note: `WhatsApp did not accept the message: ${(r.error ?? "unknown error").slice(0, 200)}` };
  } catch (e) {
    return { ok: false, note: `WhatsApp did not accept the message: ${e instanceof Error ? e.message.slice(0, 200) : "unknown error"}` };
  }
}

const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

// Assignments -----------------------------------------------------------------------------------------------------------

export interface AssignmentInput { applicationId: string | null; candidateId: string; positionId: string; title: unknown; brief: unknown; guidelines?: unknown; driveLink?: unknown; dueAt?: unknown }

export interface AssignmentView {
  id: string; positionId: string; positionTitle: string | null; title: string; brief: string; guidelines: string | null; driveLink: string | null;
  dueAt: string | null; status: "sent" | "submitted" | "cancelled"; sendError: string | null; sentBy: string | null; sentAt: string;
  submittedAt: string | null; submissionLink: string | null; submissionNote: string | null; fileName: string | null; hasFile: boolean;
  /** HR only: the API leaves these out for anyone else. */
  ai: { status: string | null; score: number | null; summary: string | null; strengths: string[]; gaps: string[]; model: string | null; error: string | null } | null;
  late: boolean;
}

/** Sends an assignment: makes the row and the candidate's link, sends the WhatsApp, tells the stakeholders. */
export async function sendAssignment(client: SupabaseClient, orgId: string, by: Actor, input: AssignmentInput, deps: Deps = {}): Promise<{ id: string; sent: boolean; note: string | null }> {
  const title = text(input.title, 200);
  const brief = text(input.brief, 8000);
  if (!title || !brief) throw new CandidateActionError(400, "Give the assignment a title and a brief.");
  const driveLink = text(input.driveLink, 500);
  if (driveLink && !/^https?:\/\/\S+$/i.test(driveLink)) throw new CandidateActionError(400, "The Drive link must start with https://.");
  const due = typeof input.dueAt === "string" && input.dueAt ? new Date(input.dueAt) : null;
  if (due && (Number.isNaN(due.getTime()) || due.getTime() < Date.now())) throw new CandidateActionError(400, "Pick a deadline in the future.");
  if (!UUID.test(input.positionId) || !UUID.test(input.candidateId)) throw new CandidateActionError(400, "Pick the candidate and the position.");

  const { data: member } = await client.from("candidate_position_members").select("id").eq("organization_id", orgId).eq("position_id", input.positionId).eq("candidate_id", input.candidateId).is("deleted_at", null).maybeSingle();
  if (!member) throw new CandidateActionError(400, "This person is not in that position.");
  const p = await person(client, orgId, input.candidateId, input.positionId);
  if (p.blocked) throw new CandidateActionError(409, "This person is blacklisted or their data was removed. Nothing goes to them.");
  const { data: open } = await client.from(ASSIGNMENTS).select("id").eq("organization_id", orgId).eq("candidate_id", input.candidateId).eq("position_id", input.positionId).eq("status", "sent").limit(1);
  if ((open ?? []).length) throw new CandidateActionError(409, "An assignment is already waiting for this person in this position. Cancel it first to send another.");

  const settings = (await loadRecruitmentConfig(client, orgId)).outreach;
  let link;
  try {
    link = await kindLink(client, orgId, "assignment", { candidateId: input.candidateId, applicationId: input.applicationId, positionId: input.positionId, createdBy: by.id ?? null });
  } catch (e) {
    if (e instanceof CandidateActionError && e.status === 503) throw new CandidateActionError(503, ASSIGNMENT_MIGRATION_MESSAGE);
    throw e;
  }
  const { data: row, error } = await client.from(ASSIGNMENTS).insert({
    organization_id: orgId, candidate_id: input.candidateId, application_id: input.applicationId, position_id: input.positionId, link_id: link.id,
    title, brief, guidelines: text(input.guidelines, 4000) || null, drive_link: driveLink || null, due_at: due?.toISOString() ?? null,
    sent_by: by.id ?? null, sent_by_name: by.name,
  }).select("id").single();
  if (error) {
    await client.from("recruitment_application_links").update({ disabled_at: new Date().toISOString() }).eq("id", link.id);
    if (missing(error)) throw new CandidateActionError(503, ASSIGNMENT_MIGRATION_MESSAGE);
    throw new CandidateActionError(500, "The assignment could not be saved. Try again.");
  }
  const id = (row as { id: string }).id;
  const sent = await whatsapp(settings, settings.assignment.whatsappTemplateId, p, { assignment_title: title, due_date: due ? istDue(due) : "the date in the brief", assignment_link: link.url }, deps.send ?? defaultScreeningSender);
  await client.from(ASSIGNMENTS).update({ send_error: sent.ok ? null : sent.note }).eq("id", id);
  await logMessage(client, orgId, { candidateId: input.candidateId, channel: "whatsapp", kind: "assignment", ok: sent.ok, error: sent.note, by: by.name });
  await recordAction(client, orgId, by, {
    candidateId: input.candidateId, applicationId: input.applicationId, positionId: input.positionId, action: sent.ok ? "outreach_sent" : "remark",
    toValue: sent.ok ? `WhatsApp: assignment "${title}"` : `Assignment "${title}" saved; the WhatsApp did not go (${sent.note})`, meta: { kind: "assignment_sent", assignmentId: id },
  });
  try {
    await (deps.alert ?? alertPositionStakeholders)(orgId, input.positionId, {
      title: `Assignment sent: ${p.fullName || "a candidate"}${p.role ? ` (${p.role})` : ""}`,
      message: `${by.name} sent the assignment "${title}" to ${p.fullName || "a candidate"} for ${p.role ?? "the position"}${due ? `, due ${istDue(due)}` : ""}.`,
      exceptUserIds: [by.id],
    });
  } catch (e) {
    console.error("[candidates] assignment stakeholder alert failed", e);
  }
  return { id, sent: sent.ok, note: sent.ok ? null : `The assignment is saved, but ${sent.note?.replace(/^./, (c) => c.toLowerCase())} You can copy the link from the assignment and share it yourself.` };
}

/** Cancels a waiting assignment and switches its link off. */
export async function cancelAssignment(client: SupabaseClient, orgId: string, by: Actor, id: string): Promise<void> {
  const { data, error } = await client.from(ASSIGNMENTS).update({ status: "cancelled" }).eq("organization_id", orgId).eq("id", id).eq("status", "sent").select("id, link_id, candidate_id, application_id, position_id, title");
  if (error) throw new CandidateActionError(500, "The assignment could not be cancelled.");
  const row = ((data ?? []) as { id: string; link_id: string | null; candidate_id: string; application_id: string | null; position_id: string; title: string }[])[0];
  if (!row) throw new CandidateActionError(409, "Only an assignment still waiting can be cancelled.");
  if (row.link_id) await client.from("recruitment_application_links").update({ disabled_at: new Date().toISOString() }).eq("id", row.link_id);
  await recordAction(client, orgId, by, { candidateId: row.candidate_id, applicationId: row.application_id, positionId: row.position_id, action: "remark", toValue: `Cancelled the assignment "${row.title}"`, meta: { kind: "assignment_cancelled", assignmentId: row.id } });
}

/** A candidate's assignments, newest first. `withAi` only for HR (the hiring manager never sees the AI's view). */
export async function listAssignments(client: SupabaseClient, orgId: string, candidateId: string, opts: { withAi: boolean; positionIds?: string[] }): Promise<AssignmentView[]> {
  if (!UUID.test(candidateId)) return [];
  let q = client.from(ASSIGNMENTS).select("id, position_id, title, brief, guidelines, drive_link, due_at, status, send_error, sent_by_name, sent_at, submitted_at, submission_link, submission_note, file_path, file_name, ai_status, ai_score, ai_summary, ai_strengths, ai_gaps, ai_model, ai_error")
    .eq("organization_id", orgId).eq("candidate_id", candidateId);
  if (opts.positionIds) q = q.in("position_id", opts.positionIds.length ? opts.positionIds : ["00000000-0000-0000-0000-000000000000"]);
  const { data, error } = await q.order("sent_at", { ascending: false }).limit(50);
  if (error) { if (missing(error)) return []; throw new CandidateActionError(500, "Couldn't load the assignments."); }
  const rows = (data ?? []) as Record<string, unknown>[];
  const posIds = [...new Set(rows.map((r) => r.position_id as string))];
  const { data: pos } = posIds.length ? await client.from("candidate_positions").select("id, title").eq("organization_id", orgId).in("id", posIds) : { data: [] };
  const titles = new Map(((pos ?? []) as { id: string; title: string }[]).map((p) => [p.id, p.title]));
  const now = Date.now();
  return rows.map((r) => ({
    id: r.id as string, positionId: r.position_id as string, positionTitle: titles.get(r.position_id as string) ?? null, title: r.title as string, brief: r.brief as string,
    guidelines: (r.guidelines as string | null) ?? null, driveLink: (r.drive_link as string | null) ?? null, dueAt: (r.due_at as string | null) ?? null,
    status: r.status as AssignmentView["status"], sendError: (r.send_error as string | null) ?? null, sentBy: (r.sent_by_name as string | null) ?? null, sentAt: String(r.sent_at),
    submittedAt: (r.submitted_at as string | null) ?? null, submissionLink: (r.submission_link as string | null) ?? null, submissionNote: (r.submission_note as string | null) ?? null,
    fileName: (r.file_name as string | null) ?? null, hasFile: Boolean(r.file_path),
    ai: opts.withAi ? { status: (r.ai_status as string | null) ?? null, score: (r.ai_score as number | null) ?? null, summary: (r.ai_summary as string | null) ?? null, strengths: (r.ai_strengths as string[] | null) ?? [], gaps: (r.ai_gaps as string[] | null) ?? [], model: (r.ai_model as string | null) ?? null, error: (r.ai_error as string | null) ?? null } : null,
    late: r.status === "sent" ? Boolean(r.due_at && new Date(String(r.due_at)).getTime() < now) : Boolean(r.submitted_at && r.due_at && new Date(String(r.submitted_at)) > new Date(String(r.due_at))),
  }));
}

/** The candidate's link for a waiting assignment (to share by hand when the WhatsApp did not go). */
export async function assignmentLinkUrl(client: SupabaseClient, orgId: string, id: string): Promise<string> {
  const { data } = await client.from(ASSIGNMENTS).select("link_id, status").eq("organization_id", orgId).eq("id", id).maybeSingle();
  const row = data as { link_id: string | null; status: string } | null;
  if (!row?.link_id || row.status !== "sent") throw new CandidateActionError(404, "This assignment has no open link.");
  const { data: link } = await client.from("recruitment_application_links").select("token").eq("id", row.link_id).maybeSingle();
  const { applicationUrl } = await import("./applications");
  return applicationUrl((link as { token: string }).token);
}

/** A signed link to the submitted file (10 minutes). */
export async function assignmentFileUrl(client: SupabaseClient, orgId: string, id: string): Promise<string> {
  const { data } = await client.from(ASSIGNMENTS).select("file_path").eq("organization_id", orgId).eq("id", id).maybeSingle();
  const path = (data as { file_path?: string | null } | null)?.file_path;
  if (!path) throw new CandidateActionError(404, "No file was submitted.");
  const { data: signed, error } = await client.storage.from(RESUME_BUCKET).createSignedUrl(path, 600);
  if (error || !signed) throw new CandidateActionError(500, "Couldn't open the file.");
  return signed.signedUrl;
}

// Documents -------------------------------------------------------------------------------------------------------------

export interface DocumentView { id: string; item: string; fileName: string | null; status: "uploaded" | "verified" | "rejected"; reviewNote: string | null; reviewedBy: string | null; uploadedAt: string }

/** Asks the candidate for their documents (one link; they can come back to add the rest). */
export async function requestDocuments(client: SupabaseClient, orgId: string, by: Actor, a: { candidateId: string; applicationId: string | null; positionId: string | null }, deps: Deps = {}): Promise<{ sent: boolean; note: string | null; url: string }> {
  const p = await person(client, orgId, a.candidateId, a.positionId);
  if (p.blocked) throw new CandidateActionError(409, "This person is blacklisted or their data was removed. Nothing goes to them.");
  const settings = (await loadRecruitmentConfig(client, orgId)).outreach;
  if (!settings.documents.items.length) throw new CandidateActionError(400, "List the documents to ask for first (Recruitment → Outreach → Documents).");
  // An earlier documents link for this person is switched off, so only the newest one works.
  await client.from("recruitment_application_links").update({ disabled_at: new Date().toISOString() }).eq("organization_id", orgId).eq("candidate_id", a.candidateId).eq("kind", "documents").is("disabled_at", null);
  let link;
  try {
    link = await kindLink(client, orgId, "documents", { candidateId: a.candidateId, applicationId: a.applicationId, positionId: a.positionId, createdBy: by.id ?? null });
  } catch (e) {
    if (e instanceof CandidateActionError && e.status === 503) throw new CandidateActionError(503, ASSIGNMENT_MIGRATION_MESSAGE);
    throw e;
  }
  const sent = await whatsapp(settings, settings.documents.whatsappTemplateId, p, { documents_link: link.url }, deps.send ?? defaultScreeningSender);
  await logMessage(client, orgId, { candidateId: a.candidateId, channel: "whatsapp", kind: "documents_request", ok: sent.ok, error: sent.note, by: by.name });
  await recordAction(client, orgId, by, {
    candidateId: a.candidateId, applicationId: a.applicationId, positionId: a.positionId, action: sent.ok ? "outreach_sent" : "remark",
    toValue: sent.ok ? "WhatsApp: documents request" : `Documents link made; the WhatsApp did not go (${sent.note})`, meta: { kind: "documents_requested" },
  });
  return { sent: sent.ok, note: sent.note, url: link.url };
}

export async function listDocuments(client: SupabaseClient, orgId: string, candidateId: string): Promise<DocumentView[]> {
  if (!UUID.test(candidateId)) return [];
  const { data, error } = await client.from(DOCUMENTS).select("id, item, file_name, status, review_note, reviewed_by_name, uploaded_at, file_path").eq("organization_id", orgId).eq("candidate_id", candidateId).order("uploaded_at", { ascending: false }).limit(100);
  if (error) { if (missing(error)) return []; throw new CandidateActionError(500, "Couldn't load the documents."); }
  return ((data ?? []) as { id: string; item: string; file_name: string | null; status: DocumentView["status"]; review_note: string | null; reviewed_by_name: string | null; uploaded_at: string; file_path: string }[])
    .filter((d) => d.file_path !== "pending")
    .map((d) => ({ id: d.id, item: d.item, fileName: d.file_name, status: d.status, reviewNote: d.review_note, reviewedBy: d.reviewed_by_name, uploadedAt: d.uploaded_at }));
}

export async function reviewDocument(client: SupabaseClient, orgId: string, by: Actor, id: string, status: unknown, note: unknown): Promise<void> {
  if (status !== "verified" && status !== "rejected") throw new CandidateActionError(400, "Mark it verified or rejected.");
  const reviewNote = text(note, 500);
  if (status === "rejected" && !reviewNote) throw new CandidateActionError(400, "Say why it is rejected, so the candidate can fix it.");
  const { data, error } = await client.from(DOCUMENTS).update({ status, review_note: reviewNote || null, reviewed_by_name: by.name, reviewed_at: new Date().toISOString() }).eq("organization_id", orgId).eq("id", id).select("id, candidate_id, position_id, item");
  if (error) throw new CandidateActionError(500, "The document could not be updated.");
  const row = ((data ?? []) as { id: string; candidate_id: string; position_id: string | null; item: string }[])[0];
  if (!row) throw new CandidateActionError(404, "Document not found.");
  await recordAction(client, orgId, by, { candidateId: row.candidate_id, applicationId: null, positionId: row.position_id, action: "remark", toValue: `${status === "verified" ? "Verified" : "Rejected"} "${row.item}"${reviewNote ? `: ${reviewNote}` : ""}`, meta: { kind: "document_reviewed", documentId: row.id } });
}

export async function documentFileUrl(client: SupabaseClient, orgId: string, id: string): Promise<string> {
  const { data } = await client.from(DOCUMENTS).select("file_path").eq("organization_id", orgId).eq("id", id).maybeSingle();
  const path = (data as { file_path?: string | null } | null)?.file_path;
  if (!path || path === "pending") throw new CandidateActionError(404, "No file.");
  const { data: signed, error } = await client.storage.from(RESUME_BUCKET).createSignedUrl(path, 600);
  if (error || !signed) throw new CandidateActionError(500, "Couldn't open the file.");
  return signed.signedUrl;
}
