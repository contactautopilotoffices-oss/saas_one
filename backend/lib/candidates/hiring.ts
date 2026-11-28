/**
 * The hiring flow after an interview is booked (owner 2026-11-21, "go on with all the steps"; migration
 * 20261121000003). The Recruitment Module spec, followed as written where the owner did not decide otherwise:
 *
 *   Stage 6, interviews  : mark done / no-show / cancelled; reschedule (everyone told, T07); reminders 24 h and 2 h
 *                          before (A10, T06); the person who booked it is asked to mark it once its time has passed,
 *                          and the HR Head the next day (A12).
 *   Scorecards           : one per interviewer, filled from a one-time link (no login: "the approval and feedback screens
 *                          are used mostly on phones"); ratings 1-5 per skill, overall, proceed / hold / reject, comments
 *                          required to reject; a panel member sees the others' ratings only after submitting (spec rule);
 *                          chasers at 24 h and 48 h after the interview, the HR Head at 72 h (A11).
 *   Stage 7-8, selection : the combined scorecard; select with the offer CTC (rupees per year, as the request's band);
 *     and the offer        the variance above the band shown; approval by the HR Head, and the Director above the band
 *                          (A14, A15; nobody approves an offer they proposed); the letter from HR's template, release
 *                          blocked while a blank is unfilled (scenario 16) and until every approval is in (scenario 15);
 *                          released by a person (T10); accepted or declined with a reason; chasers (A16, A17).
 *   Stage 9, joining     : weekly contact reminder to the recruiter (A18), HR told 7 days before; joined closes the
 *                          position when every opening is filled (A19); dropped reopens it and alerts the HR Head and
 *                          the Director (A20).
 *
 * Every message is an email (WhatsApp is parked by the owner). Nothing here decides who is hired: people do.
 */
import { randomBytes } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { recordAction, type Actor } from "./actions";
import { audit, logMessage } from "./audit";
import { parsePhone } from "./normalize";
import { withinSendingHours } from "./outreach";
import { guidelinesLine, whatsappParams, type OfferConfig } from "./outreach-settings";
import { CandidateActionError } from "./records";
import { activeRoles, headOfDepartment, HR_ROLES, loadRecruitmentConfig } from "./requisitions";
import { findStage } from "./stage-list";
import { loadStages } from "./stages";
import { moveMember } from "./positions";
import {
  INTERVIEW_STATUS_LABELS, RECOMMENDATIONS, SCORECARD_SKILLS,
  type InterviewStatus, type Offer, type OfferHandover, type OfferStatus, type RecruitmentConfig, type Scorecard,
} from "./types";

export const HIRING_FLOW_MIGRATION_MESSAGE = "This needs a database update first: run 20261121000003_recruitment_hiring_flow.sql in Supabase.";
const INTERVIEWS = "recruitment_interviews";
const CARDS = "recruitment_scorecards";
const OFFERS = "recruitment_offers";
const EVENTS = "recruitment_offer_events";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HOUR = 3_600_000;
const DAY = 86_400_000;

export const missingFlow = (error: { code?: string; message?: string } | null | undefined) =>
  Boolean(error) && (["42P01", "42703", "PGRST205", "PGRST204"].includes(error?.code ?? "") || /recruitment_(interviews|scorecards|offers|offer_events)|does not exist|schema cache/i.test(error?.message ?? ""));
function fail(what: string, error: { code?: string; message?: string }): never {
  if (/hod_approver_id|approval_revision/.test(error.message ?? "")) throw new CandidateActionError(503, "Apply the recruitment selection gates migration before using offers.");
  if (missingFlow(error)) throw new CandidateActionError(503, HIRING_FLOW_MIGRATION_MESSAGE);
  console.error(`[candidates] hiring: ${what}`, error);
  throw new CandidateActionError(500, `Couldn't ${what}. Please try again.`);
}
const iso = (v: unknown): string | null => (v === null || v === undefined ? null : v instanceof Date ? v.toISOString() : String(v));
const num = (v: unknown): number | null => (v === null || v === undefined || v === "" ? null : Number(v));
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
const firstName = (name: string | null | undefined) => (name ?? "").trim().split(/\s+/)[0] || "there";
export const lpa = (v: number | null) => (v === null ? "—" : `₹${(v / 100_000).toLocaleString("en-IN", { maximumFractionDigits: 2 })} LPA`);

/** India time "2026-11-21T11:00" as an instant, and back. */
export const istToInstant = (local: string) => new Date(`${local}:00+05:30`);
export function instantToIst(d: Date): string {
  const t = new Date(d.getTime() + 5.5 * HOUR);
  return t.toISOString().slice(0, 16);
}
export function istText(d: Date): string {
  const t = new Date(d.getTime() + 5.5 * HOUR);
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const h = t.getUTCHours();
  const m = String(t.getUTCMinutes()).padStart(2, "0");
  return `${days[t.getUTCDay()]}, ${t.getUTCDate()} ${months[t.getUTCMonth()]} ${t.getUTCFullYear()} at ${h % 12 || 12}:${m} ${h < 12 ? "am" : "pm"} (IST)`;
}

type OfferEmailAttachment = { filename: string; content: Buffer; contentType: string };

export interface FlowDeps {
  sendEmail: (to: string, subject: string, html: string, attachments?: OfferEmailAttachment[]) => Promise<void>;
  /** A one-time link for an interviewer's scorecard (email_action_tokens), or null when links are not available. */
  scorecardLink: (orgId: string, card: { id: string; userId: string; interviewId: string; expiresAt: Date }, payload: Record<string, unknown>) => Promise<string | null>;
  appUrl: string;
  now?: () => Date;
  /** Owner 2026-11-24: the WhatsApp interview reminder (AiSensy); none in tests unless a fake is passed. */
  sendWhatsApp?: (o: { phone: string; campaignName: string; templateParams: string[]; userName?: string }) => Promise<{ success: boolean; error?: string }>;
  /** Owner 2026-11-24: an offer approver's one-time decision link (no login: the hiring manager approves from email). */
  offerDecisionLink?: (orgId: string, offerId: string, approverId: string, level: OfferLevel, summary: OfferLinkSummary) => Promise<string | null>;
  /** Stops the unused decision links of an offer (before the next level's link goes out). */
  revokeOfferLinks?: (offerId: string) => Promise<void>;
  /** The bell in the app (NotificationService); none in tests unless a fake is passed. */
  notifyInApp?: (userIds: string[], n: { organizationId: string; title: string; message: string }) => Promise<void>;
}

/** Owner 2026-11-24: who approves an offer's annexure, in order. */
export type OfferLevel = NonNullable<Offer["currentLevel"]>;
export const OFFER_LEVEL_LABELS: Record<OfferLevel, string> = { hiring_manager: "Hiring manager", hod: "department head", hr_head: "HR Head", director: "Director" };
export const OFFER_ENTITY = "recruitment_offer";
/** What the approver's decision page shows (kept on the token). */
export interface OfferLinkSummary {
  approvalRevision?: number;
  candidateName: string; role: string | null; ctc: number; bandMin: number | null; bandMax: number | null; joiningDate: string | null;
  proposedBy: string | null; note: string | null; breakup: Record<string, number>;
  /** The breakup grouped by HR's rows, with the totals. */
  groups?: ReturnType<typeof breakupGroups>;
}

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || "").replace(/\/$/, "");
export const SCORECARD_ENTITY = "recruitment_scorecard";

export function defaultFlowDeps(): FlowDeps {
  return {
    async sendEmail(to, subject, html, attachments) {
      const { EmailService } = await import("@/backend/services/EmailService");
      if (!await EmailService.sendEmail({ to, subject, html, attachments })) throw new Error("Email delivery failed.");
    },
    async scorecardLink(orgId, card, payload) {
      if (!APP_URL) return null;
      const { issueEmailActionToken } = await import("@/backend/lib/emailActions/tokens");
      const ttlHours = Math.max(24, Math.ceil((card.expiresAt.getTime() - Date.now()) / HOUR));
      const raw = await issueEmailActionToken({ organizationId: orgId, userId: card.userId, entityType: SCORECARD_ENTITY, entityId: card.id, action: "submit", payload, ttlHours });
      return raw ? `${APP_URL}/api/candidates/scorecards/${raw}` : null;
    },
    appUrl: APP_URL,
    async sendWhatsApp(o) {
      const { AiSensyService } = await import("@/backend/services/AiSensyService");
      return AiSensyService.sendTemplate(o);
    },
    async offerDecisionLink(orgId, offerId, approverId, level, summary) {
      if (!APP_URL) return null;
      const { issueEmailActionToken } = await import("@/backend/lib/emailActions/tokens");
      const raw = await issueEmailActionToken({ organizationId: orgId, userId: approverId, entityType: OFFER_ENTITY, entityId: offerId, action: "decide", payload: { level, summary } });
      return raw ? `${APP_URL}/api/recruitment/offers/act/${raw}` : null;
    },
    async notifyInApp(userIds, n) {
      const { NotificationService } = await import("@/backend/services/NotificationService");
      await NotificationService.sendToMany(userIds, { organizationId: n.organizationId, type: "recruitment_update", title: n.title.slice(0, 120), message: n.message.slice(0, 500), deepLink: "/hr-tickets" });
    },
    async revokeOfferLinks(offerId) {
      const { revokeTokensForEntity } = await import("@/backend/lib/emailActions/tokens");
      await revokeTokensForEntity(OFFER_ENTITY, offerId);
    },
  };
}

function mail(heading: string, rows: [string, string][], button: { href: string; label: string } | null, footer: string | null): string {
  return `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;color:#0f172a;line-height:1.5">
    <p style="font-size:17px;font-weight:600">${esc(heading)}</p>
    ${rows.length ? `<table style="border-collapse:collapse;font-size:14px">${rows.map(([k, v]) => `<tr><td style="padding:4px 12px 4px 0;color:#64748b;vertical-align:top">${esc(k)}</td><td style="padding:4px 0">${esc(v)}</td></tr>`).join("")}</table>` : ""}
    ${button ? `<p style="margin-top:16px"><a href="${esc(button.href)}" style="display:inline-block;background:#1e293b;color:#fff;padding:11px 22px;border-radius:10px;text-decoration:none;font-weight:bold">${esc(button.label)}</a></p>` : ""}
    ${footer ? `<p style="color:#64748b;font-size:13px">${esc(footer)}</p>` : ""}</div>`;
}
async function send(deps: FlowDeps, to: (string | null | undefined)[], subject: string, html: string, attachments?: OfferEmailAttachment[]): Promise<number> {
  let sent = 0;
  for (const email of [...new Set(to.map((e) => (e ?? "").trim().toLowerCase()).filter(Boolean))]) {
    try { await deps.sendEmail(email, subject, html, attachments); sent += 1; } catch (error) { console.error("[candidates] hiring email failed", error); }
  }
  return sent;
}
async function emailsOf(client: SupabaseClient, ids: (string | null | undefined)[]): Promise<Map<string, { name: string | null; email: string | null }>> {
  const wanted = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  const out = new Map<string, { name: string | null; email: string | null }>();
  if (!wanted.length) return out;
  const { data } = await client.from("users").select("id, full_name, email").in("id", wanted);
  for (const u of (data ?? []) as { id: string; full_name: string | null; email: string | null }[]) out.set(u.id, { name: u.full_name, email: u.email });
  return out;
}
const hrHeads = (c: RecruitmentConfig) => [c.hrHead.userId, c.hrHead.backupUserId].filter((id): id is string => Boolean(id));
const directors = (c: RecruitmentConfig) => [c.director.userId, c.director.backupUserId].filter((id): id is string => Boolean(id));

// Stage 6: the interview's follow-up ------------------------------------------------------------------------------------

interface InterviewRow {
  id: string; organization_id: string; candidate_id: string; application_id: string | null; position_id: string | null; round: string | null;
  at: string; at_local: string; mode: string | null; venue: string | null; interviewer_ids: string[]; join_path: string | null; status: InterviewStatus;
  status_reason: string | null; reminded_24_at: string | null; reminded_2_at: string | null; nudged_at: string | null; escalated_at: string | null; created_by: string | null;
}
const INTERVIEW_COLUMNS = "id, organization_id, candidate_id, application_id, position_id, round, at, at_local, mode, venue, interviewer_ids, join_path, status, status_reason, reminded_24_at, reminded_2_at, nudged_at, escalated_at, created_by";

/** Files a booked interview (scheduleInterview) and makes a scorecard per interviewer. Before the migration: nothing, quietly. */
export async function fileInterview(client: SupabaseClient, orgId: string, by: Actor, row: {
  id: string; candidateId: string; applicationId: string | null; positionId: string; round: string; atLocal: string; mode: string; venue: string | null;
  interviewers: { id: string; name: string }[]; joinPath: string | null;
  /** Owner 2026-11-24 (migration 20261124000003): the interview page's key; left out before the migration. */
  publicToken?: string | null;
}): Promise<Map<string, string>> {
  const cards = new Map<string, string>();
  const values: Record<string, unknown> = {
    id: row.id, organization_id: orgId, candidate_id: row.candidateId, application_id: row.applicationId, position_id: row.positionId, round: row.round,
    at: istToInstant(row.atLocal).toISOString(), at_local: row.atLocal, mode: row.mode, venue: row.venue, interviewer_ids: row.interviewers.map((p) => p.id),
    join_path: row.joinPath, created_by: by.id,
  };
  let { error } = await client.from(INTERVIEWS).insert(row.publicToken ? { ...values, public_token: row.publicToken } : values);
  if (error && row.publicToken && /public_token/.test(error.message ?? "")) ({ error } = await client.from(INTERVIEWS).insert(values));
  if (error) {
    if (!missingFlow(error)) console.error("[candidates] hiring: the interview was not filed", error);
    return cards;
  }
  for (const p of row.interviewers) {
    const { data, error: cardError } = await client.from(CARDS).insert({ organization_id: orgId, interview_id: row.id, panel_user_id: p.id, panel_name: p.name }).select("id").single();
    if (cardError) console.error("[candidates] hiring: a scorecard was not made", cardError);
    else cards.set(p.id, (data as { id: string }).id);
  }
  return cards;
}

/** The payload a scorecard link carries (the page renders from it). */
export interface ScorecardPayload { scorecardId: string; interviewId: string; candidate: string; role: string | null; round: string | null; when: string; panelName: string | null; designation: string | null }

/** The scorecard links for an interview's interviewers, for their invite (one per person; userId -> link). */
export async function scorecardLinks(client: SupabaseClient, orgId: string, deps: FlowDeps, interviewId: string, cards: Map<string, string>, context: Omit<ScorecardPayload, "scorecardId" | "interviewId" | "panelName">, names: Map<string, string>, at: Date): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const [userId, cardId] of cards) {
    const link = await deps.scorecardLink(orgId, { id: cardId, userId, interviewId, expiresAt: new Date(at.getTime() + 7 * DAY) }, { scorecardId: cardId, interviewId, panelName: names.get(userId) ?? null, ...context });
    if (link) out.set(userId, link);
  }
  return out;
}

async function loadInterview(client: SupabaseClient, orgId: string, id: unknown): Promise<InterviewRow> {
  if (typeof id !== "string" || !UUID.test(id)) throw new CandidateActionError(404, "That interview is no longer there.");
  const { data, error } = await client.from(INTERVIEWS).select(INTERVIEW_COLUMNS).eq("organization_id", orgId).eq("id", id).maybeSingle();
  if (error) fail("load the interview", error);
  if (!data) throw new CandidateActionError(404, "That interview was booked before the update that lets it be marked. Book it again to follow it up.");
  return data as unknown as InterviewRow;
}

async function interviewContext(client: SupabaseClient, orgId: string, row: InterviewRow) {
  const [{ data: person }, { data: pos }] = await Promise.all([
    client.from("candidates").select("full_name, email, blacklisted_at").eq("organization_id", orgId).eq("id", row.candidate_id).maybeSingle(),
    row.position_id ? client.from("candidate_positions").select("title").eq("organization_id", orgId).eq("id", row.position_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const people = await emailsOf(client, [...row.interviewer_ids, row.created_by]);
  return {
    // A blacklisted person gets nothing (spec: "do not contact" receives no messages): no email address, so reminders,
    // reschedules and cancellations go to the panel only.
    candidate: {
      name: (person as { full_name?: string } | null)?.full_name ?? "the candidate",
      email: (person as { blacklisted_at?: string | null } | null)?.blacklisted_at ? null : ((person as { email?: string | null } | null)?.email ?? null),
    },
    role: (pos as { title?: string } | null)?.title ?? null,
    panel: row.interviewer_ids.map((id) => people.get(id)).filter(Boolean) as { name: string | null; email: string | null }[],
    booker: row.created_by ? people.get(row.created_by) ?? null : null,
  };
}

const StatusInput = z.object({ status: z.enum(["done", "no_show", "cancelled"]), reason: z.string().trim().max(500).optional(), notify: z.boolean().optional() });

/** Marks an interview done, no-show or cancelled (a cancellation tells the candidate and the panel unless notify is false). */
export async function setInterviewStatus(client: SupabaseClient, orgId: string, by: Actor, id: string, body: unknown, deps: FlowDeps): Promise<{ status: InterviewStatus; told: number }> {
  const parsed = StatusInput.safeParse(body ?? {});
  if (!parsed.success) throw new CandidateActionError(400, "Pick done, no-show or cancelled.");
  const row = await loadInterview(client, orgId, id);
  const { status } = parsed.data;
  const reason = parsed.data.reason || null;
  if (status === "no_show" && !reason) { /* a no-show needs no reason; kept optional */ }
  const now = (deps.now?.() ?? new Date()).toISOString();
  const { error } = await client.from(INTERVIEWS).update({ status, status_reason: reason, status_at: now, status_by_name: by.name, updated_at: now }).eq("organization_id", orgId).eq("id", row.id);
  if (error) fail("save the interview", error);
  await recordAction(client, orgId, by, {
    candidateId: row.candidate_id, applicationId: row.application_id, positionId: row.position_id, action: "remark",
    toValue: `Interview ${row.round ?? ""}: ${INTERVIEW_STATUS_LABELS[status]}`.replace(/\s+:/, ":"), remark: reason, meta: { kind: "interview_status", interviewId: row.id, status },
  });
  let told = 0;
  if (status === "cancelled" && parsed.data.notify !== false) {
    const ctx = await interviewContext(client, orgId, row);
    const when = istText(new Date(row.at));
    const html = mail(`The ${row.round ?? ""} interview for ${ctx.role ?? "the role"} on ${when} is cancelled`.replace(/\s+/g, " "), [["Candidate", ctx.candidate.name], ...(reason ? [["Reason", reason] as [string, string]] : [])], null, "The recruiter will be in touch about a new time.");
    told = await send(deps, [ctx.candidate.email, ...ctx.panel.map((p) => p.email)], `Interview cancelled · ${ctx.role ?? ""} · ${when}`, html);
  }
  return { status, told };
}

const RescheduleInput = z.object({ at: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "Pick the new date and time."), reason: z.string().trim().max(500).optional(), notify: z.boolean().optional() });

/** Moves an interview to a new time: the reminders start again, and the candidate and the panel are told (T07). */
export async function rescheduleInterview(client: SupabaseClient, orgId: string, by: Actor, id: string, body: unknown, deps: FlowDeps): Promise<{ at: string; told: number }> {
  const parsed = RescheduleInput.safeParse(body ?? {});
  if (!parsed.success) throw new CandidateActionError(400, parsed.error.issues[0]?.message ?? "Pick the new date and time.");
  const row = await loadInterview(client, orgId, id);
  if (row.status === "done") throw new CandidateActionError(409, "This interview is marked done. Book a new one instead.");
  const when = istToInstant(parsed.data.at);
  const now = deps.now?.() ?? new Date();
  if (!Number.isFinite(when.getTime()) || when.getTime() < now.getTime() - 10 * 60_000) throw new CandidateActionError(400, "The new time is in the past.");
  const { error } = await client.from(INTERVIEWS).update({
    at: when.toISOString(), at_local: parsed.data.at, status: "scheduled", status_reason: null, reminded_24_at: null, reminded_2_at: null, nudged_at: null, escalated_at: null, updated_at: now.toISOString(),
  }).eq("organization_id", orgId).eq("id", row.id);
  if (error) fail("move the interview", error);
  await recordAction(client, orgId, by, {
    candidateId: row.candidate_id, applicationId: row.application_id, positionId: row.position_id, action: "remark",
    toValue: `Interview ${row.round ?? ""} moved to ${istText(when)}`.replace(/\s+/g, " "), remark: parsed.data.reason || null, meta: { kind: "interview_rescheduled", interviewId: row.id, at: parsed.data.at, from: row.at_local },
  });
  let told = 0;
  if (parsed.data.notify !== false) {
    const ctx = await interviewContext(client, orgId, row);
    const link = row.join_path ? `${deps.appUrl}${row.join_path}` : null;
    const html = mail(`New time for the ${row.round ?? ""} interview for ${ctx.role ?? "the role"}`.replace(/\s+/g, " "),
      [["Candidate", ctx.candidate.name], ["Was", istText(new Date(row.at))], ["Now", istText(when)], ...(row.mode === "online" ? [] : [["Where", row.venue ?? "Our office"] as [string, string]]), ...(parsed.data.reason ? [["Why", parsed.data.reason] as [string, string]] : [])],
      link ? { href: link, label: "Join the video call" } : null, null);
    told = await send(deps, [ctx.candidate.email, ...ctx.panel.map((p) => p.email)], `Interview moved · ${ctx.role ?? ""} · ${istText(when)}`, html);
  }
  return { at: parsed.data.at, told };
}

/** Each interview's status and scorecards, for the Interviews tab (HR sees every scorecard). */
export async function interviewExtras(client: SupabaseClient, orgId: string, ids: string[]): Promise<Map<string, { status: InterviewStatus; statusReason: string | null; scorecards: Scorecard[]; rsvp: "yes" | "no" | null; rsvpNote: string | null }>> {
  const out = new Map<string, { status: InterviewStatus; statusReason: string | null; scorecards: Scorecard[]; rsvp: "yes" | "no" | null; rsvpNote: string | null }>();
  if (!ids.length) return out;
  const read = (columns: string) => client.from(INTERVIEWS).select(columns).eq("organization_id", orgId).in("id", ids);
  const [first, cards] = await Promise.all([
    read("id, status, status_reason, rsvp, rsvp_note"),
    client.from(CARDS).select("id, interview_id, panel_name, ratings, overall, recommendation, comments, submitted_at").eq("organization_id", orgId).in("interview_id", ids),
  ]);
  // Before migration 20261124000003 there is no RSVP: read without it.
  const rows = first.error && /rsvp/.test(first.error.message ?? "") ? await read("id, status, status_reason") : first;
  if (rows.error) return out;
  for (const r of (rows.data ?? []) as unknown as { id: string; status: InterviewStatus; status_reason: string | null; rsvp?: "yes" | "no" | null; rsvp_note?: string | null }[]) {
    out.set(r.id, { status: r.status, statusReason: r.status_reason, scorecards: [], rsvp: r.rsvp ?? null, rsvpNote: r.rsvp_note ?? null });
  }
  for (const c of ((cards.error ? [] : cards.data) ?? []) as Record<string, unknown>[]) out.get(c.interview_id as string)?.scorecards.push(toScorecard(c));
  return out;
}

// Scorecards -----------------------------------------------------------------------------------------------------------

const toScorecard = (c: Record<string, unknown>): Scorecard => ({
  id: c.id as string, interviewId: c.interview_id as string, panelName: (c.panel_name as string | null) ?? null, ratings: (c.ratings as Record<string, number>) ?? {},
  overall: num(c.overall), recommendation: (c.recommendation as Scorecard["recommendation"]) ?? null, comments: (c.comments as string | null) ?? null, submittedAt: iso(c.submitted_at),
});

export async function getScorecard(client: SupabaseClient, id: string): Promise<Scorecard & { organizationId: string; panelUserId: string | null }> {
  const { data, error } = await client.from(CARDS).select("id, organization_id, interview_id, panel_user_id, panel_name, ratings, overall, recommendation, comments, submitted_at").eq("id", id).maybeSingle();
  if (error) fail("load the scorecard", error);
  if (!data) throw new CandidateActionError(404, "That scorecard is no longer there.");
  const d = data as { organization_id: string; panel_user_id: string | null };
  return { ...toScorecard(data as Record<string, unknown>), organizationId: d.organization_id, panelUserId: d.panel_user_id };
}

export async function shareScorecard(client: SupabaseClient, orgId: string, id: unknown, action: unknown, deps: FlowDeps) {
  if (typeof id !== "string" || !UUID.test(id) || (action !== "copy" && action !== "email")) throw new CandidateActionError(400, "Choose a scorecard and how to share it.");
  const card = await getScorecard(client, id);
  if (card.organizationId !== orgId) throw new CandidateActionError(404, "That scorecard is no longer there.");
  if (card.submittedAt) throw new CandidateActionError(409, "This scorecard was already submitted.");
  const row = await loadInterview(client, orgId, card.interviewId);
  if (row.status === "cancelled" || row.status === "no_show") throw new CandidateActionError(409, "This interview did not take place.");
  if (!card.panelUserId || !row.interviewer_ids.includes(card.panelUserId)) throw new CandidateActionError(409, "This interviewer is no longer assigned.");
  const email = action === "email" ? (await emailsOf(client, [card.panelUserId])).get(card.panelUserId)?.email : null;
  if (action === "email" && !email) throw new CandidateActionError(409, "This interviewer has no email address. Use Copy link instead.");
  const ctx = await interviewContext(client, orgId, row);
  const when = istText(new Date(row.at));
  const expiresAt = new Date(Math.max(new Date(row.at).getTime(), (deps.now?.() ?? new Date()).getTime()) + 7 * DAY);
  const link = await deps.scorecardLink(orgId, { id, userId: card.panelUserId, interviewId: row.id, expiresAt }, {
    scorecardId: id, interviewId: row.id, candidate: ctx.candidate.name, role: ctx.role, round: row.round, when, panelName: card.panelName, designation: null,
  });
  if (!link) throw new CandidateActionError(503, "Could not create the scorecard link. Please try again.");
  if (!email) return { url: link };
  const sent = await send(deps, [email], `Interview scorecard: ${ctx.candidate.name} · ${row.round ?? "Interview"} · ${when}`,
    mail(`Your interview feedback for ${ctx.candidate.name}`, [["Role", ctx.role ?? "—"], ["Interview", when]], { href: link, label: "Open your scorecard" }, "Feedback is optional. This link is personal to you."));
  if (!sent) throw new CandidateActionError(502, "Could not send the scorecard email. Retry or copy the link.");
  return { email };
}

const ScoreInput = z.object({
  ratings: z.record(z.string(), z.number().int().min(1).max(5)),
  overall: z.number().int().min(1, "Give the overall rating.").max(5),
  recommendation: z.enum(RECOMMENDATIONS, { message: "Pick proceed, hold or reject." }),
  comments: z.string().trim().max(3000).optional(),
});

/** One interviewer's scorecard, once. Comments are required to reject. Returns the others' submitted cards (now visible). */
export async function submitScorecard(client: SupabaseClient, id: string, body: unknown, now = new Date()): Promise<{ card: Scorecard; others: Scorecard[] }> {
  const parsed = ScoreInput.safeParse(body ?? {});
  if (!parsed.success) throw new CandidateActionError(400, parsed.error.issues[0]?.message ?? "Fill in the ratings.");
  const s = parsed.data;
  const missing = SCORECARD_SKILLS.filter((k) => !s.ratings[k]);
  if (missing.length) throw new CandidateActionError(400, `Rate ${missing.join(", ")}.`);
  if (s.recommendation === "reject" && !s.comments) throw new CandidateActionError(400, "Comments are required to reject.");
  const card = await getScorecard(client, id);
  if (card.submittedAt) throw new CandidateActionError(409, "This scorecard was already submitted.");
  const { data: saved, error } = await client.from(CARDS).update({ ratings: s.ratings, overall: s.overall, recommendation: s.recommendation, comments: s.comments || null, submitted_at: now.toISOString() }).eq("id", id).is("submitted_at", null).select("id").maybeSingle();
  if (error) fail("save the scorecard", error);
  if (!saved) throw new CandidateActionError(409, "This scorecard was already submitted.");
  const { data: row } = await client.from(INTERVIEWS).select("candidate_id, application_id, position_id, round").eq("id", card.interviewId).maybeSingle();
  if (row && card.panelUserId) {
    const r = row as { candidate_id: string; application_id: string | null; position_id: string | null; round: string | null };
    await recordAction(client, card.organizationId, { id: card.panelUserId, name: card.panelName }, {
      candidateId: r.candidate_id, applicationId: r.application_id, positionId: r.position_id, action: "remark",
      toValue: `Scorecard ${r.round ?? ""}: ${s.overall}/5, ${s.recommendation}`.replace(/\s+:/, ":"), remark: s.comments || null, meta: { kind: "scorecard", interviewId: card.interviewId, scorecardId: id, round: r.round, rating: s.overall, recommendation: s.recommendation },
    }).catch((e) => console.error("[candidates] scorecard history not written", e));
  }
  const { data: others } = await client.from(CARDS).select("id, interview_id, panel_name, ratings, overall, recommendation, comments, submitted_at").eq("interview_id", card.interviewId).neq("id", id).not("submitted_at", "is", null);
  return { card: { ...card, ...toScorecard({ ...s, id, interview_id: card.interviewId, panel_name: card.panelName, submitted_at: now.toISOString() }) }, others: ((others ?? []) as Record<string, unknown>[]).map(toScorecard) };
}

// The reminders job (A10, A11, A12) -------------------------------------------------------------------------------------

/** Interview reminders 24 h and 2 h before; the booker asked to mark it after its time; the HR Head the next day; scorecard chasers. */
export async function runInterviewJobs(client: SupabaseClient, orgId: string, deps: FlowDeps, now = deps.now?.() ?? new Date()): Promise<{ reminders: number; nudges: number; chasers: number }> {
  let reminders = 0, nudges = 0, chasers = 0;
  const { data, error } = await client.from(INTERVIEWS).select(INTERVIEW_COLUMNS).eq("organization_id", orgId).eq("status", "scheduled")
    .gte("at", new Date(now.getTime() - 3 * DAY).toISOString()).lte("at", new Date(now.getTime() + DAY).toISOString());
  if (error) return { reminders, nudges, chasers };
  const config = await loadRecruitmentConfig(client, orgId);
  for (const row of (data ?? []) as unknown as InterviewRow[]) {
    const at = new Date(row.at).getTime();
    const until = at - now.getTime();
    const stamp = async (column: string) => client.from(INTERVIEWS).update({ [column]: now.toISOString() }).eq("id", row.id);
    if (until > 0 && until <= 2 * HOUR && !row.reminded_2_at) {
      await remind(client, orgId, deps, row, "in about 2 hours"); await stamp("reminded_2_at"); if (!row.reminded_24_at) await stamp("reminded_24_at"); reminders += 1;
    } else if (until > 2 * HOUR && until <= 24 * HOUR && !row.reminded_24_at) {
      await remind(client, orgId, deps, row, "tomorrow"); await stamp("reminded_24_at"); reminders += 1;
    } else if (until < -HOUR && !row.nudged_at) {
      const ctx = await interviewContext(client, orgId, row);
      await send(deps, [ctx.booker?.email], `Mark the interview: ${ctx.candidate.name} · ${row.round ?? ""}`, mail(`Did the interview with ${ctx.candidate.name} happen?`, [["Round", row.round ?? "—"], ["Was at", istText(new Date(at))], ["Role", ctx.role ?? "—"]], { href: `${deps.appUrl}/hr-tickets`, label: "Open Recruitment" }, "Open the candidate's Interviews tab and mark it done, no-show or cancelled."));
      await stamp("nudged_at"); nudges += 1;
    } else if (until < -DAY && !row.escalated_at) {
      const ctx = await interviewContext(client, orgId, row);
      const heads = await emailsOf(client, hrHeads(config));
      await send(deps, [...heads.values()].map((p) => p.email), `Not marked for a day: interview with ${ctx.candidate.name}`, mail(`The ${row.round ?? ""} interview with ${ctx.candidate.name} is still not marked done, no-show or cancelled.`, [["Was at", istText(new Date(at))], ["Booked by", ctx.booker?.name ?? "—"], ["Role", ctx.role ?? "—"]], null, null));
      await stamp("escalated_at"); nudges += 1;
    }
  }
  reminders += await whatsappReminders(client, orgId, deps, (data ?? []) as unknown as InterviewRow[], now);
  // Scorecard chasers: past interviews with cards still empty: 24 h, 48 h, then the HR Head at 72 h.
  const { data: cards } = await client.from(CARDS).select("id, interview_id, panel_user_id, panel_name, chased_24_at, chased_48_at, escalated_at").eq("organization_id", orgId).is("submitted_at", null);
  const pending = (cards ?? []) as { id: string; interview_id: string; panel_user_id: string | null; panel_name: string | null; chased_24_at: string | null; chased_48_at: string | null; escalated_at: string | null }[];
  if (pending.length) {
    const { data: ivs } = await client.from(INTERVIEWS).select(INTERVIEW_COLUMNS).in("id", [...new Set(pending.map((c) => c.interview_id))]).neq("status", "cancelled").neq("status", "no_show");
    const byId = new Map(((ivs ?? []) as unknown as InterviewRow[]).map((r) => [r.id, r]));
    for (const card of pending) {
      const row = byId.get(card.interview_id);
      if (!row) continue;
      const since = now.getTime() - new Date(row.at).getTime();
      const step = since >= 72 * HOUR && !card.escalated_at ? "escalated_at" : since >= 48 * HOUR && !card.chased_48_at ? "chased_48_at" : since >= 24 * HOUR && !card.chased_24_at ? "chased_24_at" : null;
      if (!step) continue;
      const ctx = await interviewContext(client, orgId, row);
      if (step === "escalated_at") {
        const heads = await emailsOf(client, hrHeads(config));
        await send(deps, [...heads.values()].map((p) => p.email), `Scorecard missing for 3 days: ${card.panel_name ?? "an interviewer"} · ${ctx.candidate.name}`, mail(`${card.panel_name ?? "An interviewer"} has not filled the scorecard for ${ctx.candidate.name} (${row.round ?? "interview"}, ${istText(new Date(row.at))}).`, [], null, null));
      } else if (card.panel_user_id) {
        const person = (await emailsOf(client, [card.panel_user_id])).get(card.panel_user_id);
        const link = await deps.scorecardLink(orgId, { id: card.id, userId: card.panel_user_id, interviewId: row.id, expiresAt: new Date(now.getTime() + 7 * DAY) }, { scorecardId: card.id, interviewId: row.id, candidate: ctx.candidate.name, role: ctx.role, round: row.round, when: istText(new Date(row.at)), panelName: card.panel_name, designation: null });
        await send(deps, [person?.email], `Reminder: your scorecard for ${ctx.candidate.name}`, mail(`Please fill in your scorecard for ${ctx.candidate.name}`, [["Round", row.round ?? "—"], ["Interview", istText(new Date(row.at))], ["Role", ctx.role ?? "—"]], link ? { href: link, label: "Fill the scorecard" } : null, "It takes two minutes. You see the other interviewers' ratings after you submit yours."));
      }
      await client.from(CARDS).update({ [step]: now.toISOString() }).eq("id", card.id);
      chasers += 1;
    }
  }
  return { reminders, nudges, chasers };
}

/** The interview page's token (migration 20261124000003), or null before it. */
async function pageToken(client: SupabaseClient, id: string): Promise<string | null> {
  const { data, error } = await client.from(INTERVIEWS).select("public_token").eq("id", id).maybeSingle();
  return error ? null : ((data as { public_token?: string | null } | null)?.public_token ?? null);
}

async function remind(client: SupabaseClient, orgId: string, deps: FlowDeps, row: InterviewRow, when: string): Promise<void> {
  const ctx = await interviewContext(client, orgId, row);
  const link = row.join_path ? `${deps.appUrl}${row.join_path}` : null;
  // Owner 2026-11-24: the guidelines, and the page where the candidate confirms they will attend.
  const settings = (await loadRecruitmentConfig(client, orgId)).outreach;
  const guidelines = row.mode === "online" ? settings.interview.guidelinesOnline : settings.interview.guidelinesInPerson;
  const token = await pageToken(client, row.id);
  const page = token ? `${deps.appUrl}/interview/${token}` : null;
  const rows: [string, string][] = [["When", istText(new Date(row.at))], ["Round", row.round ?? "—"], ["Role", ctx.role ?? "—"], ...(row.mode === "online" ? [] : [["Where", row.venue ?? "Our office"] as [string, string]])];
  const forCandidate: [string, string][] = [...rows, ...(guidelines.length ? [["Please", guidelines.join(" · ")] as [string, string]] : []), ...(page ? [["Will you attend? Tell us here", page] as [string, string]] : [])];
  await send(deps, [ctx.candidate.email], `Reminder: your interview ${when} · ${ctx.role ?? ""}`, mail(`Hello ${firstName(ctx.candidate.name)}, a reminder of your interview ${when}.`, forCandidate, link ? { href: link, label: "Join the video call" } : page ? { href: page, label: "Confirm you will attend" } : null, row.mode === "online" ? "Open the link a few minutes early; you will be let in when the interview starts." : null));
  await send(deps, ctx.panel.map((p) => p.email), `Reminder: interview with ${ctx.candidate.name} ${when}`, mail(`Interview with ${ctx.candidate.name} ${when}`, rows, link ? { href: link, label: "Join the video call" } : null, null));
}

/**
 * Owner 2026-11-24: the WhatsApp reminder (HR's reminder template: the guidelines and the page with Yes / No), once, in
 * the day before the interview and in working hours. Stamped before sending, so it never goes twice.
 */
async function whatsappReminders(client: SupabaseClient, orgId: string, deps: FlowDeps, rows: InterviewRow[], now: Date): Promise<number> {
  if (!deps.sendWhatsApp || !withinSendingHours(now)) return 0;
  const soon = rows.filter((r) => { const until = new Date(r.at).getTime() - now.getTime(); return until > HOUR && until <= DAY; });
  if (!soon.length) return 0;
  const settings = (await loadRecruitmentConfig(client, orgId)).outreach;
  const t = settings.interview.reminderTemplateId ? settings.templates.find((x) => x.id === settings.interview.reminderTemplateId && x.channel === "whatsapp") : undefined;
  if (!t) return 0;
  const { data, error } = await client.from(INTERVIEWS).select("id, public_token, wa_reminded_at, rsvp").in("id", soon.map((r) => r.id));
  if (error) return 0;
  const extra = new Map(((data ?? []) as { id: string; public_token: string | null; wa_reminded_at: string | null; rsvp: string | null }[]).map((r) => [r.id, r]));
  let sent = 0;
  for (const row of soon) {
    const x = extra.get(row.id);
    // Not when they already said they cannot come.
    if (!x?.public_token || x.wa_reminded_at || x.rsvp === "no") continue;
    const { data: person } = await client.from("candidates").select("full_name, phone, blacklisted_at").eq("organization_id", orgId).eq("id", row.candidate_id).maybeSingle();
    const p = person as { full_name?: string | null; phone?: string | null; blacklisted_at?: string | null } | null;
    const phone = parsePhone(p?.phone ?? "").key;
    if (!p || p.blacklisted_at || !phone) continue;
    const { data: stamped } = await client.from(INTERVIEWS).update({ wa_reminded_at: now.toISOString() }).eq("id", row.id).is("wa_reminded_at", null).select("id");
    if (!(stamped ?? []).length) continue;
    const { data: pos } = row.position_id ? await client.from("candidate_positions").select("title, location").eq("id", row.position_id).maybeSingle() : { data: null };
    const guidelines = row.mode === "online" ? settings.interview.guidelinesOnline : settings.interview.guidelinesInPerson;
    const { params, gaps } = whatsappParams(t, {
      first_name: firstName(p.full_name ?? ""), full_name: p.full_name ?? null, round: row.round, role: (pos as { title?: string } | null)?.title ?? null,
      location: row.mode === "online" ? null : row.venue, company: settings.companyName, company_profile: settings.companyProfileUrl || null,
      interview_time: istText(new Date(row.at)), interview_page: `${deps.appUrl}/interview/${x.public_token}`, guidelines: guidelinesLine(guidelines) || null,
    });
    if (gaps.length) continue;
    try {
      const r = await deps.sendWhatsApp({ phone: `91${phone}`, campaignName: t.campaign ?? "", templateParams: params, userName: p.full_name ?? undefined });
      if (r.success) sent += 1;
      else console.error("[candidates] interview WhatsApp reminder refused", r.error);
    } catch (e) {
      console.error("[candidates] interview WhatsApp reminder failed", e);
    }
  }
  return sent;
}

/** Organisations with interviews or offers the hourly job looks at. */
export async function organisationsWithFlow(client: SupabaseClient, now = new Date()): Promise<string[]> {
  const [ivs, offers, cards] = await Promise.all([
    client.from(INTERVIEWS).select("organization_id").eq("status", "scheduled").gte("at", new Date(now.getTime() - 3 * DAY).toISOString()).lte("at", new Date(now.getTime() + DAY).toISOString()).limit(2000),
    client.from(OFFERS).select("organization_id").in("status", ["pending", "approved", "released", "accepted"]).limit(2000),
    client.from(CARDS).select("organization_id").is("submitted_at", null).limit(2000),
  ]);
  const rows = [...((ivs.error ? [] : ivs.data) ?? []), ...((offers.error ? [] : offers.data) ?? []), ...((cards.error ? [] : cards.data) ?? [])] as { organization_id: string }[];
  return [...new Set(rows.map((r) => r.organization_id))];
}

// Stages 7-8: selection and the offer -----------------------------------------------------------------------------------

export const DEFAULT_OFFER_LETTER = `Dear {{candidate_name}},

We are pleased to offer you the position of {{role}} at {{company}}, based at {{location}}.

Your annual cost to company will be {{ctc}}. Your date of joining will be {{joining_date}}.

Please confirm your acceptance by replying to this email.

Warm regards,
{{recruiter_name}}
{{company}}`;

const OFFER_COLUMNS = "id, candidate_id, application_id, position_id, requisition_id, proposed_ctc, band_min, band_max, breakup, joining_date, status, current_level, current_approver_id, approval_revision, hod_approver_id, level_entered_at, needs_director, letter, released_at, response_at, response_reason, joined_at, dropped_reason, last_contact_at, notices, selected_note, created_by, created_by_name, created_at, updated_at";

/** Owner 2026-11-24 (migration 20261124000004): the LOI page's token and who recorded the answer. Read when there. */
const OFFER_EXTRA = ", public_token, responded_via";
const OFFER_FILES = ", letter_file_name, letter_release_started_at, approval_submitted_by";
const filesMissing = (error: { message?: string } | null | undefined) => /letter_file_name|letter_pdf_base64|letter_release_started_at|approval_submitted_by/.test(error?.message ?? "");
const OFFER_FILE_MIGRATION = "Apply the recruitment documents and offer letter migration before uploading an offer PDF.";
const canApproveOffer = (row: Record<string, unknown>, userId: string) => row.created_by !== userId && row.approval_submitted_by !== userId;
const extrasMissing = (error: { message?: string } | null | undefined) => /public_token|responded_via/.test(error?.message ?? "");
async function withExtras<T extends { error: { code?: string; message?: string } | null }>(run: (columns: string) => PromiseLike<T>): Promise<T> {
  let result = await run(OFFER_COLUMNS + OFFER_EXTRA + OFFER_FILES);
  if (filesMissing(result.error)) result = await run(OFFER_COLUMNS + OFFER_EXTRA);
  if (extrasMissing(result.error)) result = await run(OFFER_COLUMNS);
  return result;
}
export const offerPageUrl = (token: string, base = APP_URL) => `${base}/offer/${token}`;

/** The breakup grouped by HR's rows (earnings and deductions per month, benefits per year); unknown rows under "other". */
export function breakupGroups(breakup: Record<string, number>, cfg: Pick<OfferConfig, "earnings" | "deductions" | "benefits">) {
  const pick = (labels: string[]) => labels.filter((l) => breakup[l] !== undefined && breakup[l] !== null).map((l) => [l, Number(breakup[l])] as [string, number]);
  const known = new Set([...cfg.earnings, ...cfg.deductions, ...cfg.benefits]);
  const earnings = pick(cfg.earnings);
  const deductions = pick(cfg.deductions);
  const benefits = pick(cfg.benefits);
  const other = Object.entries(breakup).filter(([k]) => !known.has(k)).map(([k, v]) => [k, Number(v)] as [string, number]);
  const sum = (rows: [string, number][]) => rows.reduce((t, [, v]) => t + (Number.isFinite(v) ? v : 0), 0);
  const gross = sum(earnings);
  const totalDeductions = sum(deductions);
  return { earnings, deductions, benefits, other, gross, totalDeductions, net: gross - totalDeductions, benefitsTotal: sum(benefits) };
}
const inr = (v: number) => `₹${Math.round(v).toLocaleString("en-IN")}`;
function breakupHtml(breakup: Record<string, number>, cfg: Pick<OfferConfig, "earnings" | "deductions" | "benefits">): string {
  const g = breakupGroups(breakup, cfg);
  if (!g.earnings.length && !g.deductions.length && !g.benefits.length && !g.other.length) return "";
  const rows = (title: string, list: [string, number][], total: [string, number] | null) => list.length
    ? `<tr><td colspan="2" style="padding:10px 0 4px;font-weight:bold">${esc(title)}</td></tr>${list.map(([k, v]) => `<tr><td style="padding:3px 16px 3px 0;color:#475569">${esc(k)}</td><td style="padding:3px 0;text-align:right">${inr(v)}</td></tr>`).join("")}${total ? `<tr><td style="padding:3px 16px 3px 0;font-weight:bold">${esc(total[0])}</td><td style="padding:3px 0;text-align:right;font-weight:bold">${inr(total[1])}</td></tr>` : ""}`
    : "";
  return `<table style="border-collapse:collapse;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;font-size:14px;margin:12px 0">
    ${rows("Earnings (per month)", g.earnings, ["Gross per month", g.gross])}${rows("Deductions (per month)", g.deductions, ["Net per month (estimated)", g.net])}${rows("Benefits (per year)", g.benefits, null)}${rows("Other", g.other, null)}</table>`;
}

/** Blanks left in a letter: placeholders not filled, and "{{…}}" HR typed. */
export const letterGaps = (letter: string | null) => [...new Set((letter ?? "").match(/\{\{[^}]*\}\}/g) ?? [])];

async function toOffers(client: SupabaseClient, orgId: string, rows: Record<string, unknown>[], viewer?: { userId: string; config: RecruitmentConfig }): Promise<Offer[]> {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id as string);
  const [people, positions, reqs, events, names] = await Promise.all([
    client.from("candidates").select("id, full_name").in("id", [...new Set(rows.map((r) => r.candidate_id as string))]),
    client.from("candidate_positions").select("id, title").eq("organization_id", orgId).in("id", [...new Set(rows.map((r) => r.position_id as string).filter(Boolean))]),
    client.from("recruitment_requisitions").select("id, requisition_no").eq("organization_id", orgId).in("id", [...new Set(rows.map((r) => r.requisition_id as string).filter(Boolean))]),
    client.from(EVENTS).select("offer_id, action, level, reason, by_name, created_at").eq("organization_id", orgId).in("offer_id", ids).order("created_at", { ascending: false }),
    emailsOf(client, rows.map((r) => r.current_approver_id as string | null)),
  ]);
  const nameOf = new Map(((people.data ?? []) as { id: string; full_name: string }[]).map((p) => [p.id, p.full_name]));
  const titleOf = new Map(((positions.data ?? []) as { id: string; title: string }[]).map((p) => [p.id, p.title]));
  const reqNo = new Map(((reqs.data ?? []) as { id: string; requisition_no: string | null }[]).map((p) => [p.id, p.requisition_no]));
  const eventsOf = new Map<string, Offer["events"]>();
  for (const e of (events.data ?? []) as Record<string, unknown>[]) {
    const list = eventsOf.get(e.offer_id as string) ?? [];
    list.push({ action: e.action as string, level: (e.level as string | null) ?? null, reason: (e.reason as string | null) ?? null, byName: (e.by_name as string | null) ?? null, at: iso(e.created_at) ?? "" });
    eventsOf.set(e.offer_id as string, list);
  }
  return rows.map((r) => {
    const ctc = Number(r.proposed_ctc);
    const max = num(r.band_max);
    const level = (r.current_level as Offer["currentLevel"]) ?? null;
    const approvers = viewer && level ? ((level === "hiring_manager" || level === "hod") ? [r.current_approver_id as string].filter(Boolean) : level === "hr_head" ? hrHeads(viewer.config) : directors(viewer.config)) : [];
    return {
      id: r.id as string, candidateId: r.candidate_id as string, candidateName: nameOf.get(r.candidate_id as string) ?? "Candidate",
      applicationId: (r.application_id as string | null) ?? null, positionId: (r.position_id as string | null) ?? null,
      positionTitle: r.position_id ? titleOf.get(r.position_id as string) ?? null : null, requisitionNo: r.requisition_id ? reqNo.get(r.requisition_id as string) ?? null : null,
      proposedCtc: ctc, bandMin: num(r.band_min), bandMax: max, variancePct: max && ctc > max ? Math.round(((ctc - max) / max) * 1000) / 10 : null,
      breakup: (r.breakup as Record<string, number>) ?? {}, joiningDate: iso(r.joining_date)?.slice(0, 10) ?? null, status: r.status as OfferStatus,
      approvalRevision: Number(r.approval_revision), currentLevel: level, currentApproverName: r.current_approver_id ? names.get(r.current_approver_id as string)?.name ?? null : null, needsDirector: Boolean(r.needs_director),
      letter: (r.letter as string | null) ?? null, letterFileName: (r.letter_file_name as string | null) ?? null, letterGaps: letterGaps(r.letter as string | null), releasedAt: iso(r.released_at), responseAt: iso(r.response_at),
      responseReason: (r.response_reason as string | null) ?? null, joinedAt: iso(r.joined_at), droppedReason: (r.dropped_reason as string | null) ?? null,
      lastContactAt: iso(r.last_contact_at), selectedNote: (r.selected_note as string | null) ?? null, createdByName: (r.created_by_name as string | null) ?? null,
      createdAt: iso(r.created_at) ?? "", events: eventsOf.get(r.id as string) ?? [],
      canDecide: viewer ? r.status === "pending" && approvers.includes(viewer.userId) && canApproveOffer(r, viewer.userId) : undefined,
      publicUrl: r.public_token ? offerPageUrl(r.public_token as string) : null,
      respondedVia: (r.responded_via as Offer["respondedVia"]) ?? null,
    };
  });
}

export async function listOffers(client: SupabaseClient, orgId: string, viewer: { userId: string }, filter: { candidateId?: string } = {}): Promise<Offer[]> {
  const { data, error } = await withExtras((columns) => {
    let q = client.from(OFFERS).select(columns).eq("organization_id", orgId).order("created_at", { ascending: false }).limit(300);
    if (filter.candidateId) q = q.eq("candidate_id", filter.candidateId);
    return q;
  });
  if (error) fail("load the offers", error);
  return toOffers(client, orgId, (data ?? []) as unknown as Record<string, unknown>[], { userId: viewer.userId, config: await loadRecruitmentConfig(client, orgId) });
}

async function loadOffer(client: SupabaseClient, orgId: string, id: unknown): Promise<Record<string, unknown>> {
  if (typeof id !== "string" || !UUID.test(id)) throw new CandidateActionError(404, "That offer is no longer there.");
  const { data, error } = await withExtras((columns) => client.from(OFFERS).select(columns).eq("organization_id", orgId).eq("id", id).maybeSingle());
  if (error) fail("load the offer", error);
  if (!data) throw new CandidateActionError(404, "That offer is no longer there.");
  return data as unknown as Record<string, unknown>;
}
async function event(client: SupabaseClient, orgId: string, offerId: string, by: Actor | null, action: string, level: string | null, reason: string | null) {
  const { error } = await client.from(EVENTS).insert({ organization_id: orgId, offer_id: offerId, action, level, reason, by_user: by?.id ?? null, by_name: by?.name ?? null });
  if (error) fail("record the step", error);
}
async function one(client: SupabaseClient, orgId: string, id: string, userId: string): Promise<Offer> {
  const row = await loadOffer(client, orgId, id);
  return (await toOffers(client, orgId, [row], { userId, config: await loadRecruitmentConfig(client, orgId) }))[0];
}

const OfferInput = z.object({
  applicationId: z.string().regex(UUID, "Pick the candidate."),
  positionId: z.string().regex(UUID, "Pick the position."),
  proposedCtc: z.number({ message: "Give the offer CTC." }).positive("Give the offer CTC.").max(1_000_000_000),
  joiningDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  breakup: z.record(z.string().max(60), z.number().min(0)).optional(),
  note: z.string().trim().max(2000).optional(),
});

/**
 * Stage 7's exit: the candidate is selected with an offer CTC; the offer goes to the HR Head, and also to the Director
 * when the CTC is above the request's band (A14, A15). The proposer never approves their own offer.
 */
export async function createOffer(client: SupabaseClient, orgId: string, by: Actor, body: unknown, deps: FlowDeps): Promise<Offer> {
  const parsed = OfferInput.safeParse(body ?? {});
  if (!parsed.success) throw new CandidateActionError(400, parsed.error.issues[0]?.message ?? "Check the offer.");
  const o = parsed.data;
  const { data: app } = await client.from("candidate_applications").select("id, candidate_id").eq("organization_id", orgId).eq("id", o.applicationId).is("deleted_at", null).maybeSingle();
  if (!app) throw new CandidateActionError(404, "That candidate record is no longer there.");
  const candidateId = (app as { candidate_id: string }).candidate_id;
  const { data: member } = await client.from("candidate_position_members").select("id").eq("organization_id", orgId).eq("position_id", o.positionId).eq("candidate_id", candidateId).is("deleted_at", null).maybeSingle();
  if (!member) throw new CandidateActionError(400, "Add the person to the position first.");
  const { data: req, error: reqError } = await client.from("recruitment_requisitions").select("id, department, budget_min_ctc, budget_max_ctc, raised_by").eq("organization_id", orgId).eq("position_id", o.positionId).is("deleted_at", null).maybeSingle();
  if (reqError) fail("load the hiring request", reqError);
  const r = req as { id: string; department: string | null; budget_min_ctc: number | null; budget_max_ctc: number | null; raised_by: string | null } | null;
  const bandMax = num(r?.budget_max_ctc);
  const config = await loadRecruitmentConfig(client, orgId);
  const position = await client.from("candidate_positions").select("department").eq("organization_id", orgId).eq("id", o.positionId).single();
  if (position.error) fail("load the position department", position.error);
  const hod = headOfDepartment(config, r?.department || position.data.department);
  const chain = firstApprover(config, by.id, r?.raised_by ?? null, hod, o.proposedCtc, bandMax);
  if (!chain) throw new CandidateActionError(409, "Nobody can approve this offer: set the HR Head and Director in the Tech dashboard → HR Configs.");
  const { level, approverId, needsDirector } = chain;
  const now = (deps.now?.() ?? new Date()).toISOString();
  const { data, error } = await client.from(OFFERS).insert({
    organization_id: orgId, candidate_id: candidateId, application_id: o.applicationId, position_id: o.positionId, requisition_id: r?.id ?? null,
    proposed_ctc: o.proposedCtc, band_min: num(r?.budget_min_ctc), band_max: bandMax, breakup: o.breakup ?? {}, joining_date: o.joiningDate ?? null,
    status: "pending", hod_approver_id: hod, current_level: level, current_approver_id: approverId, level_entered_at: now, needs_director: needsDirector,
    selected_note: o.note || null, created_by: by.id, created_by_name: by.name, created_at: now, updated_at: now,
  }).select("id").single();
  if (error) {
    if (error.code === "P4201") throw new CandidateActionError(409, error.message);
    if (error.code === "23505") throw new CandidateActionError(409, "This person already has an open offer for this position.");
    fail("make the offer", error);
  }
  const id = (data as { id: string }).id;
  await event(client, orgId, id, by, "proposed", null, o.note || null);
  await recordAction(client, orgId, by, { candidateId, applicationId: o.applicationId, positionId: o.positionId, action: "remark", toValue: `Selected: offer ${lpa(o.proposedCtc)} proposed`, remark: o.note || null, meta: { kind: "offer", offerId: id } });
  const offer = await one(client, orgId, id, by.id);
  await tellApprover(client, orgId, deps, offer, approverId, level);
  return offer;
}

/** A configured department head reviews the annexure before the Director. The proposer cannot approve. */
function firstApprover(config: RecruitmentConfig, proposerId: string | null, raiserId: string | null, hod: string | null, ctc: number, bandMax: number | null, revisedBy: string | null = null): { level: OfferLevel; approverId: string; needsDirector: boolean } | null {
  const cfg = config.outreach.offer;
  const available = (id: string) => id !== proposerId && id !== revisedBy;
  const hm = cfg.hiringManagerApproves && raiserId && available(raiserId) ? raiserId : null;
  const hr = hrHeads(config).find(available) ?? null;
  const director = directors(config).find(available) ?? null;
  const needsDirector = Boolean(hod) || (bandMax !== null && ctc > bandMax) || (cfg.directorAlways && Boolean(director));
  if (hod && !director) throw new CandidateActionError(409, "Set an independent Director for department annexure approval.");
  if (hm) return { level: "hiring_manager", approverId: hm, needsDirector };
  if (hod && available(hod)) return { level: "hod", approverId: hod, needsDirector };
  if (hr) return { level: "hr_head", approverId: hr, needsDirector };
  if (director) return { level: "director", approverId: director, needsDirector };
  return null;
}

/** The approver after this level, or null when every approval is in. */
function nextApprover(level: OfferLevel, row: Record<string, unknown>, config: RecruitmentConfig): { level: OfferLevel; approverId: string } | null {
  if (level === "hiring_manager") {
    const hod = row.hod_approver_id as string | null;
    if (hod && canApproveOffer(row, hod) && hod !== row.current_approver_id) return { level: "hod", approverId: hod };
    const hr = hrHeads(config).find((id) => canApproveOffer(row, id));
    if (hr && (!hod || !canApproveOffer(row, hod))) return { level: "hr_head", approverId: hr };
  }
  if (level !== "director" && row.needs_director) {
    const d = directors(config).find((id) => canApproveOffer(row, id));
    if (!d) throw new CandidateActionError(409, "This offer needs the Director, and no Director is set in HR Configs.");
    return { level: "director", approverId: d };
  }
  return null;
}

async function tellApprover(client: SupabaseClient, orgId: string, deps: FlowDeps, offer: Offer, approverId: string, level: OfferLevel, reminder = false) {
  const who = (await emailsOf(client, [approverId])).get(approverId);
  const config = await loadRecruitmentConfig(client, orgId);
  const summary: OfferLinkSummary = { approvalRevision: offer.approvalRevision, candidateName: offer.candidateName, role: offer.positionTitle, ctc: offer.proposedCtc, bandMin: offer.bandMin, bandMax: offer.bandMax, joiningDate: offer.joiningDate, proposedBy: offer.createdByName, note: offer.selectedNote, breakup: offer.breakup, groups: breakupGroups(offer.breakup, config.outreach.offer) };
  let link: string | null = null;
  try { link = (await deps.offerDecisionLink?.(orgId, offer.id, approverId, level, summary)) ?? null; } catch (error) { console.error("[candidates] offer decision link failed", error); }
  const html = mail(
    `Hello ${firstName(who?.name)}, an offer needs your approval as ${OFFER_LEVEL_LABELS[level]}. The candidate sees nothing until every approval is in.`,
    [["Candidate", offer.candidateName], ["Role", offer.positionTitle ?? "—"], ["Offer CTC", lpa(offer.proposedCtc)], ["Budget band", `${lpa(offer.bandMin)} to ${lpa(offer.bandMax)}`],
      ...(offer.variancePct ? [["Above the band by", `${offer.variancePct}%`] as [string, string]] : []), ["Joining", offer.joiningDate ?? "—"], ["Proposed by", offer.createdByName ?? "—"]],
    link ? { href: link, label: "Approve or send back" } : { href: `${deps.appUrl}/hr-tickets`, label: "Open Recruitment → Offers" },
    link ? "The button works once and needs no login." : null);
  await send(deps, [who?.email], `${reminder ? "Reminder: " : ""}Offer to approve: ${offer.candidateName} · ${offer.positionTitle ?? ""}`, html.replace(/<\/table>/, `</table>${breakupHtml(offer.breakup, config.outreach.offer)}`));
}

const DecideInput = z.object({ approvalRevision: z.number().int().positive().optional(), expectedLevel: z.enum(["hiring_manager", "hod", "hr_head", "director"]).optional(), decision: z.enum(["approve", "reject", "revise"]), reason: z.string().trim().max(2000).optional() });

/** HR Head, then (above the band) the Director: approve, reject, or ask for a revision (with a reason). */
export async function decideOffer(client: SupabaseClient, orgId: string, by: Actor, id: string, body: unknown, deps: FlowDeps): Promise<Offer> {
  const parsed = DecideInput.safeParse(body ?? {});
  if (!parsed.success) throw new CandidateActionError(400, "Approve, reject or ask for a revision.");
  const { decision } = parsed.data;
  const reason = parsed.data.reason || null;
  const row = await loadOffer(client, orgId, id);
  if (row.status !== "pending") throw new CandidateActionError(409, "This offer is not waiting for approval.");
  const config = await loadRecruitmentConfig(client, orgId);
  const level = row.current_level as OfferLevel;
  if (!canApproveOffer(row, by.id)) throw new CandidateActionError(403, "An offer cannot be approved by the person who proposed or revised it.");
  if ((parsed.data.approvalRevision !== undefined && parsed.data.approvalRevision !== row.approval_revision) ||
      (parsed.data.expectedLevel && parsed.data.expectedLevel !== level)) {
    throw new CandidateActionError(409, "The annexure or approval step changed. Review the latest offer.");
  }
  const allowed = (level === "hiring_manager" || level === "hod") ? [row.current_approver_id as string] : level === "hr_head" ? hrHeads(config) : directors(config);
  if (!allowed.includes(by.id)) throw new CandidateActionError(403, level === "hiring_manager" ? "Only the hiring manager who raised the request can decide on this offer now." : `Only the ${OFFER_LEVEL_LABELS[level]} (or their backup) can decide on this offer now.`);
  if (decision !== "approve" && !reason) throw new CandidateActionError(400, decision === "reject" ? "Give the reason for rejecting." : "Say what to revise.");
  const now = (deps.now?.() ?? new Date()).toISOString();
  const update = async (values: Record<string, unknown>) => {
    const result = await client.from(OFFERS).update({ ...values, updated_at: now })
      .eq("organization_id", orgId).eq("id", id).eq("status", "pending").eq("current_level", level)
      .eq("approval_revision", row.approval_revision).select("id");
    if (!result.error && !result.data?.length) throw new CandidateActionError(409, "The offer changed. Review the latest approval step.");
    if (!result.error) await deps.revokeOfferLinks?.(id).catch((error) => console.error("[candidates] revoking decided offer links failed", error));
    return result;
  };
  if (decision !== "approve") {
    const { error } = await update({ status: "rejected", current_level: null, current_approver_id: null, response_reason: reason });
    if (error) fail("record the decision", error);
    await event(client, orgId, row.id as string, by, decision === "reject" ? "rejected" : "revise", level, reason);
    const offer = await one(client, orgId, row.id as string, by.id);
    const proposerId = (row.approval_submitted_by ?? row.created_by) as string;
    const proposer = (await emailsOf(client, [proposerId])).get(proposerId);
    await send(deps, [proposer?.email], `Offer ${decision === "reject" ? "not approved" : "to revise"}: ${offer.candidateName}`, mail(`The offer for ${offer.candidateName} was ${decision === "reject" ? "not approved" : "sent back for a revision"} by ${by.name ?? OFFER_LEVEL_LABELS[level]}.`, [["Why", reason ?? "—"]], { href: `${deps.appUrl}/recruitment?view=offers`, label: "Open Recruitment → Offers" }, "Open All offers and choose Revise offer to edit and resubmit the original offer."));
    return offer;
  }
  const next = nextApprover(level, row, config);
  if (next) {
    const { error } = await update({ current_level: next.level, current_approver_id: next.approverId, level_entered_at: now });
    if (error) fail(`pass the offer to the ${OFFER_LEVEL_LABELS[next.level]}`, error);
    const aboveBand = num(row.band_max) !== null && Number(row.proposed_ctc) > (num(row.band_max) as number);
    await event(client, orgId, row.id as string, by, "approved", level, reason ?? (next.level === "director" ? (aboveBand ? "Above the band: the Director approves too" : "The Director approves every offer") : null));
    const offer = await one(client, orgId, row.id as string, by.id);
    await tellApprover(client, orgId, deps, offer, next.approverId, next.level);
    return offer;
  }
  // Every approval is in: the letter is drafted from HR's template, held for release by HR (A16).
  const offer0 = (await toOffers(client, orgId, [row]))[0];
  const letter = await draftLetter(client, orgId, offer0, config);
  const { error } = await update({ status: "approved", current_level: null, current_approver_id: null, letter });
  if (error) fail("approve the offer", error);
  await event(client, orgId, row.id as string, by, "approved", level, reason);
  const offer = await one(client, orgId, row.id as string, by.id);
  const proposerId = (row.approval_submitted_by ?? row.created_by) as string;
  const proposer = (await emailsOf(client, [proposerId])).get(proposerId);
  await send(deps, [proposer?.email], `Offer approved: ${offer.candidateName} · release it`, mail(`The offer for ${offer.candidateName} is approved. Check the letter and release it.`, [["Offer CTC", lpa(offer.proposedCtc)], ["Joining", offer.joiningDate ?? "—"]], { href: `${deps.appUrl}/hr-tickets`, label: "Open Recruitment → Offers" }, offer.letterGaps.length ? `The letter still has blanks: ${offer.letterGaps.join(", ")}.` : null));
  return offer;
}

/** HR's template with this offer's details; a detail the app does not have is left as its {{blank}} (release is blocked). */
async function draftLetter(client: SupabaseClient, orgId: string, offer: Offer, config: RecruitmentConfig): Promise<string> {
  const { data: pos } = offer.positionId ? await client.from("candidate_positions").select("location, recruiter_id").eq("id", offer.positionId).maybeSingle() : { data: null };
  const p = pos as { location: string | null; recruiter_id: string | null } | null;
  const recruiter = p?.recruiter_id ? (await emailsOf(client, [p.recruiter_id])).get(p.recruiter_id)?.name ?? null : null;
  const values: Record<string, string | null> = {
    candidate_name: offer.candidateName, role: offer.positionTitle, company: "Autopilot Offices", location: p?.location ?? null,
    ctc: lpa(offer.proposedCtc), joining_date: offer.joiningDate, recruiter_name: recruiter,
  };
  return (config.offerLetter || DEFAULT_OFFER_LETTER).replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (all, key: string) => values[key] ?? all);
}

const OFFER_PDF_MAX = 4 * 1024 * 1024;
const RELEASE_LEASE_MS = 10 * 60_000;
const releaseInProgress = (row: Record<string, unknown>) => {
  const claim = iso(row.letter_release_started_at);
  return !!claim && Date.now() - Date.parse(claim) < RELEASE_LEASE_MS;
};

function matchReleaseClaim<T extends { eq(column: string, value: string): T; is(column: string, value: null): T }>(query: T, row: Record<string, unknown>): T {
  if (!("letter_release_started_at" in row)) return query;
  const claim = iso(row.letter_release_started_at);
  return claim ? query.eq("letter_release_started_at", claim) : query.is("letter_release_started_at", null);
}

export async function attachOfferPdf(client: SupabaseClient, orgId: string, by: Actor, id: string, name: string, bytes: Buffer): Promise<Offer> {
  const fileName = name.trim();
  if (!/\.pdf$/i.test(fileName) || /[\x00-\x1f\x7f/\\]/.test(fileName) || fileName.length > 180
      || bytes.subarray(0, 5).toString() !== "%PDF-" || bytes.length > OFFER_PDF_MAX) {
    throw new CandidateActionError(400, "Choose an offer letter PDF up to 4 MB, with a valid filename.");
  }
  const row = await loadOffer(client, orgId, id);
  if (!("letter_file_name" in row)) throw new CandidateActionError(503, OFFER_FILE_MIGRATION);
  if (row.status !== "approved" || releaseInProgress(row)) throw new CandidateActionError(409, "Attach the PDF after approval and before release.");
  const update = client.from(OFFERS).update({ letter_file_name: fileName, letter_pdf_base64: bytes.toString("base64"), updated_at: new Date().toISOString() })
    .eq("organization_id", orgId).eq("id", id).eq("status", "approved").eq("approval_revision", row.approval_revision);
  const { data, error } = await matchReleaseClaim(update, row).select("id");
  if (error) fail("attach the offer letter", error);
  if (!data?.length) throw new CandidateActionError(409, "The offer changed. Reload it before attaching the PDF.");
  await event(client, orgId, id, by, "letter_attached", null, fileName);
  return one(client, orgId, id, by.id);
}

async function offerPdf(client: SupabaseClient, orgId: string, row: Record<string, unknown>): Promise<OfferEmailAttachment | null> {
  if (!row.letter_file_name) return null;
  const { data, error } = await client.from(OFFERS).select("letter_file_name, letter_pdf_base64")
    .eq("organization_id", orgId).eq("id", row.id as string).maybeSingle();
  if (error) fail("read the offer PDF", error);
  if (!data?.letter_pdf_base64 || !data?.letter_file_name) throw new CandidateActionError(409, "The attached PDF is unavailable. Upload it again before release.");
  return { filename: data.letter_file_name, content: Buffer.from(data.letter_pdf_base64, "base64"), contentType: "application/pdf" };
}

export function offerPdfDownload(file: OfferEmailAttachment): Response {
  const filename = encodeURIComponent(file.filename).replace(/'/g, "%27");
  return new Response(new Uint8Array(file.content), { headers: {
    "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="offer-letter.pdf"; filename*=UTF-8''${filename}`,
    "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
  } });
}

export async function staffOfferPdf(client: SupabaseClient, orgId: string, id: string) {
  return offerPdf(client, orgId, await loadOffer(client, orgId, id));
}
const LetterInput = z.object({ letter: z.string().trim().min(20, "The letter is too short.").max(20_000), joiningDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional() });

/** HR edits the letter (and the joining date) before release. */
export async function editLetter(client: SupabaseClient, orgId: string, by: Actor, id: string, body: unknown): Promise<Offer> {
  const parsed = LetterInput.safeParse(body ?? {});
  if (!parsed.success) throw new CandidateActionError(400, parsed.error.issues[0]?.message ?? "Check the letter.");
  const row = await loadOffer(client, orgId, id);
  if (row.status !== "approved" || releaseInProgress(row)) throw new CandidateActionError(409, "Only an approved offer's letter can be edited before release.");
  const update = client.from(OFFERS).update({ letter: parsed.data.letter, ...(parsed.data.joiningDate !== undefined ? { joining_date: parsed.data.joiningDate } : {}), updated_at: new Date().toISOString() })
    .eq("organization_id", orgId).eq("id", id).eq("status", "approved").eq("approval_revision", row.approval_revision);
  const { data, error } = await matchReleaseClaim(update, row).select("id");
  if (error) fail("save the letter", error);
  if (!data?.length) throw new CandidateActionError(409, "The offer changed. Reload it before saving the letter.");
  await event(client, orgId, row.id as string, by, "letter_edited", null, null);
  return one(client, orgId, row.id as string, by.id);
}

/** Releases the letter to the candidate by email (T10: by a person). Blocked until approved and with no blanks left. */
export async function releaseOffer(client: SupabaseClient, orgId: string, by: Actor, id: string, deps: FlowDeps): Promise<Offer> {
  const row = await loadOffer(client, orgId, id);
  if (row.status === "pending") throw new CandidateActionError(409, "This offer is still waiting for approval: it cannot be released until every approval is in.");
  if (row.status !== "approved") throw new CandidateActionError(409, "Only an approved offer can be released.");
  const gaps = letterGaps(row.letter as string | null);
  if (gaps.length) throw new CandidateActionError(400, `Fill the blanks in the letter first: ${gaps.join(", ")}.`);
  const { data: person } = await client.from("candidates").select("full_name, email, phone, blacklisted_at").eq("organization_id", orgId).eq("id", row.candidate_id as string).maybeSingle();
  if ((person as { blacklisted_at?: string | null } | null)?.blacklisted_at) throw new CandidateActionError(409, "This person is blacklisted. No message goes to them, so the letter cannot be released.");
  const email = (person as { email?: string | null } | null)?.email;
  if (!email) throw new CandidateActionError(400, "The candidate has no email address. Add it to their record, then release.");
  const offer = (await toOffers(client, orgId, [row]))[0];
  const config = await loadRecruitmentConfig(client, orgId);
  if (releaseInProgress(row)) throw new CandidateActionError(409, "This offer is already being released.");
  const claim = "letter_release_started_at" in row ? new Date().toISOString() : null;
  if (claim) {
    const update = client.from(OFFERS).update({ letter_release_started_at: claim }).eq("organization_id", orgId)
      .eq("id", id).eq("status", "approved").eq("approval_revision", row.approval_revision).eq("updated_at", iso(row.updated_at));
    const result = await matchReleaseClaim(update, row).select("id");
    if (result.error) fail("prepare to release the offer", result.error);
    if (!result.data?.length) throw new CandidateActionError(409, "The offer changed or is already being released. Reload it first.");
  }
  let token = (row.public_token as string | null | undefined) ?? null;
  let pageUrl: string | null = null;
  let emailed = false;
  try {
    const attachment = await offerPdf(client, orgId, row);
    if (!token && "public_token" in row) {
      token = randomBytes(24).toString("base64url");
      const { error: tokenError } = await client.from(OFFERS).update({ public_token: token }).eq("organization_id", orgId).eq("id", id);
      if (tokenError) { console.error("[candidates] offer page token not saved", tokenError); token = null; }
    }
    pageUrl = token ? offerPageUrl(token, deps.appUrl || APP_URL) : null;
    const html = `<div style="font-family:Georgia,serif;font-size:15px;line-height:1.6;color:#0f172a;white-space:pre-wrap">${esc(row.letter)}</div>${breakupHtml(offer.breakup, config.outreach.offer)}${pageUrl ? `<p style="margin-top:16px;font-family:system-ui,sans-serif"><a href="${esc(pageUrl)}" style="display:inline-block;background:#1e293b;color:#fff;padding:11px 22px;border-radius:10px;text-decoration:none;font-weight:bold">Accept or decline</a></p>` : ""}`;
    const subject = `Letter of intent: ${offer.positionTitle ?? "your new role"} at ${config.outreach.companyName || "Autopilot Offices"}`;
    emailed = (await send(deps, [email], subject, html, attachment ? [attachment] : undefined)) > 0;
    if (emailed) {
      const now = (deps.now?.() ?? new Date()).toISOString();
      let update = client.from(OFFERS).update({ status: "released", released_at: now, updated_at: now, ...(claim ? { letter_release_started_at: null } : {}) })
        .eq("organization_id", orgId).eq("id", id).eq("status", "approved");
      if (claim) update = update.eq("letter_release_started_at", claim);
      const { error, data } = await update.select("id");
      if (error) fail("record the release", error);
      if (!data?.length) throw new CandidateActionError(409, "Delivery succeeded but the offer state changed. Check the sent email before retrying.");
    }
    await logMessage(client, orgId, { candidateId: row.candidate_id as string, channel: "email", kind: "offer_letter", recipient: email, subject, ok: emailed, error: emailed ? null : "The email could not be sent", by: by.name });
    if (!emailed) throw new CandidateActionError(502, "The email could not be sent. Try again.");
  } finally {
    if (claim && !emailed) {
      const { error } = await client.from(OFFERS).update({ letter_release_started_at: null }).eq("organization_id", orgId).eq("id", id).eq("letter_release_started_at", claim);
      if (error) console.error("[candidates] offer release claim could not be cleared", error);
    }
  }
  if (pageUrl && deps.sendWhatsApp) {
    const t = config.outreach.templates.find((x) => x.id === config.outreach.offer.loiTemplateId && x.channel === "whatsapp");
    const phoneKey = parsePhone((person as { phone?: string | null } | null)?.phone ?? "").key;
    if (t && phoneKey) {
      const { params, gaps } = whatsappParams(t, { first_name: firstName(offer.candidateName), full_name: offer.candidateName, role: offer.positionTitle, company: config.outreach.companyName, loi_link: pageUrl });
      if (!gaps.length) {
        let ok = false;
        let why: string | null = null;
        try { const r = await deps.sendWhatsApp({ phone: `91${phoneKey}`, campaignName: t.campaign ?? "", templateParams: params, userName: offer.candidateName }); ok = r.success; why = r.error ?? null; } catch (e) { why = e instanceof Error ? e.message : "WhatsApp failed"; }
        await logMessage(client, orgId, { candidateId: row.candidate_id as string, channel: "whatsapp", kind: "offer_letter", ok, error: why, by: by.name });
      }
    }
  }
  await event(client, orgId, row.id as string, by, "released", null, null);
  await recordAction(client, orgId, by, { candidateId: row.candidate_id as string, applicationId: (row.application_id as string | null) ?? null, positionId: (row.position_id as string | null) ?? null, action: "remark", toValue: "Offer letter released", remark: null, meta: { kind: "offer_released", offerId: row.id } });
  await moveTo(client, orgId, by, row, "offer", null);
  return one(client, orgId, row.id as string, by.id);
}

/** Moves the person to a stage of this key when the list has it (Offer, Joined); a move it cannot make is left to HR. */
async function moveTo(client: SupabaseClient, orgId: string, by: Actor, row: Record<string, unknown>, key: string, remark: string | null) {
  try {
    const { stages } = await loadStages(client, orgId);
    if (!findStage(stages, key) || !row.position_id) return;
    const { data: member } = await client.from("candidate_position_members").select("id, stage").eq("organization_id", orgId).eq("position_id", row.position_id as string).eq("candidate_id", row.candidate_id as string).is("deleted_at", null).maybeSingle();
    const m = member as { id: string; stage: string } | null;
    if (m && m.stage !== key) await moveMember(client, orgId, by, row.position_id as string, m.id, key, remark);
  } catch (error) {
    console.error("[candidates] hiring: the pipeline move was skipped", error);
  }
}

const ResponseInput = z.object({ response: z.enum(["accepted", "declined"]), reason: z.string().trim().max(2000).optional(), joiningDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() });

/** The candidate's answer, recorded by HR: accepted (with the joining date) or declined (with the reason). */
export async function recordResponse(client: SupabaseClient, orgId: string, by: Actor, id: string, body: unknown, deps?: FlowDeps): Promise<Offer> {
  const row = await loadOffer(client, orgId, id);
  await applyResponse(client, orgId, by, row, body, "hr", deps);
  return one(client, orgId, row.id as string, by.id);
}

/** Records an answer once (a guarded update: a second answer at the same moment finds it answered); an acceptance is handed over. */
async function applyResponse(client: SupabaseClient, orgId: string, by: Actor, row: Record<string, unknown>, body: unknown, via: "hr" | "candidate", deps?: FlowDeps): Promise<void> {
  const parsed = ResponseInput.safeParse(body ?? {});
  if (!parsed.success) throw new CandidateActionError(400, "Accepted or declined?");
  if (row.status !== "released") throw new CandidateActionError(409, row.status === "accepted" || row.status === "declined" ? "This offer was already answered." : "Only a released offer gets an answer.");
  const { response } = parsed.data;
  if (response === "declined" && !parsed.data.reason) throw new CandidateActionError(400, via === "candidate" ? "Please tell us why, in a line." : "Give the reason the offer was declined.");
  const joining = parsed.data.joiningDate ?? (iso(row.joining_date)?.slice(0, 10) ?? null);
  if (response === "accepted" && !joining) throw new CandidateActionError(400, "Give the joining date.");
  const now = new Date().toISOString();
  const values: Record<string, unknown> = { status: response, response_at: now, response_reason: parsed.data.reason || null, ...(response === "accepted" ? { joining_date: joining, last_contact_at: now } : {}), updated_at: now };
  const write = (v: Record<string, unknown>) => client.from(OFFERS).update(v).eq("organization_id", orgId).eq("id", row.id as string).eq("status", "released").select("id");
  let result = await write("responded_via" in row ? { ...values, responded_via: via } : values);
  if (result.error && extrasMissing(result.error)) result = await write(values);
  if (result.error) fail("record the answer", result.error);
  if (!(result.data ?? []).length) throw new CandidateActionError(409, "This offer was already answered.");
  await event(client, orgId, row.id as string, by, response, null, parsed.data.reason || null);
  await recordAction(client, orgId, by, { candidateId: row.candidate_id as string, applicationId: (row.application_id as string | null) ?? null, positionId: (row.position_id as string | null) ?? null, action: "remark", toValue: `${response === "accepted" ? `Offer accepted · joining ${joining}` : "Offer declined"}${via === "candidate" ? " (on the letter-of-intent page)" : ""}`, remark: parsed.data.reason || null, meta: { kind: "offer_response", offerId: row.id, response, via } });
  if (response === "accepted") await handOver(client, orgId, { ...row, joining_date: joining }, deps);
  else if (via === "candidate" && deps) {
    const people = await emailsOf(client, [row.created_by as string]);
    await send(deps, [...people.values()].map((p) => p.email), `Offer declined: ${(await toOffers(client, orgId, [row]))[0].candidateName}`, mail("The candidate declined the letter of intent on its page.", [["Reason", parsed.data.reason ?? "—"]], null, null));
  }
}

// The letter-of-intent page (owner 2026-11-24): /offer/<token>, no login -------------------------------------------------

const PAGE_TOKEN = /^[A-Za-z0-9_-]{32}$/;

export interface PublicOffer {
  companyName: string; firstName: string; role: string | null; location: string | null; letter: string; ctc: string; joiningDate: string | null;
  letterFileName?: string | null;
  breakup: ReturnType<typeof breakupGroups>; status: "open" | "accepted" | "declined" | "closed"; answeredAt: string | null;
}

async function offerByToken(client: SupabaseClient, token: string): Promise<Record<string, unknown> | null> {
  if (!PAGE_TOKEN.test(token)) return null;
  const { data, error } = await withExtras(columns => client.from(OFFERS).select(`organization_id, ${columns}`).eq("public_token", token).maybeSingle());
  if (error) { if (!extrasMissing(error)) console.error("[candidates] offer page: read failed", error); return null; }
  const row = data as Record<string, unknown> | null;
  if (!row) return null;
  const person = await client.from("candidates").select("removed_at").eq("organization_id", row.organization_id as string).eq("id", row.candidate_id as string).maybeSingle();
  return person.error || !person.data || person.data.removed_at ? null : row;
}

const PUBLIC_OFFER_STATUSES = ["released", "accepted", "declined", "joined"];

export async function publicOfferPdf(client: SupabaseClient, token: string) {
  const row = await offerByToken(client, token);
  return row && PUBLIC_OFFER_STATUSES.includes(row.status as string) ? offerPdf(client, row.organization_id as string, row) : null;
}

export async function publicOffer(client: SupabaseClient, token: string): Promise<PublicOffer | null> {
  const row = await offerByToken(client, token);
  if (!row || !PUBLIC_OFFER_STATUSES.includes(row.status as string)) return null;
  const orgId = row.organization_id as string;
  const [config, offer, { data: pos }] = await Promise.all([
    loadRecruitmentConfig(client, orgId),
    toOffers(client, orgId, [row]).then((x) => x[0]),
    row.position_id ? client.from("candidate_positions").select("location").eq("id", row.position_id as string).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  return {
    companyName: config.outreach.companyName, firstName: firstName(offer.candidateName), role: offer.positionTitle, location: (pos as { location?: string | null } | null)?.location ?? null,
    letter: (row.letter as string | null) ?? "", letterFileName: offer.letterFileName, ctc: lpa(offer.proposedCtc), joiningDate: offer.joiningDate, breakup: breakupGroups(offer.breakup, config.outreach.offer),
    status: row.status === "released" ? "open" : row.status === "declined" ? "declined" : row.status === "accepted" || row.status === "joined" ? "accepted" : "closed",
    answeredAt: iso(row.response_at),
  };
}

/** The candidate accepts (with the joining date shown) or declines (with a reason) on the page. Once. */
export async function respondOnPage(client: SupabaseClient, token: string, body: unknown, deps?: FlowDeps): Promise<{ status: "accepted" | "declined" }> {
  const row = await offerByToken(client, token);
  if (!row) throw new CandidateActionError(404, "This letter is no longer open.");
  const b = (body ?? {}) as { response?: unknown; reason?: unknown };
  const response = b.response === "accepted" || b.response === "declined" ? b.response : null;
  if (!response) throw new CandidateActionError(400, "Accept or decline?");
  const reason = typeof b.reason === "string" ? b.reason.trim().slice(0, 1000) : "";
  const { data: person } = await client.from("candidates").select("full_name").eq("id", row.candidate_id as string).maybeSingle();
  const by: Actor = { id: null as unknown as string, name: `${(person as { full_name?: string | null } | null)?.full_name ?? "The candidate"} (letter-of-intent page)` };
  await applyResponse(client, row.organization_id as string, by, row, { response, ...(reason ? { reason } : {}) }, "candidate", deps);
  return { status: response };
}

// Handover to onboarding (owner 2026-11-24) -----------------------------------------------------------------------------

/** An accepted offer is handed to onboarding (HRMS): everything collected, in one place; the HR team is told. Never throws. */
async function handOver(client: SupabaseClient, orgId: string, row: Record<string, unknown>, deps?: FlowDeps): Promise<void> {
  try {
    const candidateId = row.candidate_id as string;
    const [{ data: person }, { data: app }, { data: pos }, { data: docs }] = await Promise.all([
      client.from("candidates").select("full_name, email, phone").eq("id", candidateId).maybeSingle(),
      row.application_id ? client.from("candidate_applications").select("location, current_organization, current_designation").eq("id", row.application_id as string).maybeSingle() : Promise.resolve({ data: null }),
      row.position_id ? client.from("candidate_positions").select("title, department, location").eq("id", row.position_id as string).maybeSingle() : Promise.resolve({ data: null }),
      client.from("recruitment_documents").select("id, item, status, file_name").eq("organization_id", orgId).eq("candidate_id", candidateId),
    ]);
    const p = (person ?? {}) as { full_name?: string; email?: string | null; phone?: string | null };
    const a = (app ?? {}) as { location?: string | null; current_organization?: string | null; current_designation?: string | null };
    const q = (pos ?? {}) as { title?: string; department?: string | null; location?: string | null };
    const snapshot = {
      candidate: { name: p.full_name ?? null, email: p.email ?? null, phone: p.phone ?? null, currentLocation: a.location ?? null, currentOrganization: a.current_organization ?? null, currentDesignation: a.current_designation ?? null },
      role: q.title ?? null, department: q.department ?? null, location: q.location ?? null,
      ctc: Number(row.proposed_ctc), breakup: (row.breakup as Record<string, number>) ?? {}, joiningDate: iso(row.joining_date)?.slice(0, 10) ?? null,
      letter: (row.letter as string | null) ?? null, documents: ((docs ?? []) as { id: string; item: string; status: string; file_name: string | null }[]).map((d) => ({ id: d.id, item: d.item, status: d.status, fileName: d.file_name })),
      applicationId: (row.application_id as string | null) ?? null, positionId: (row.position_id as string | null) ?? null,
    };
    const { error } = await client.from("recruitment_handovers").upsert({
      organization_id: orgId, offer_id: row.id as string, candidate_id: candidateId, position_id: (row.position_id as string | null) ?? null, joining_date: snapshot.joiningDate, snapshot,
    }, { onConflict: "offer_id" });
    if (error) { console.error("[candidates] handover not saved", error.message); return; }
    if (!deps) return;
    const config = await loadRecruitmentConfig(client, orgId);
    const { roles } = await activeRoles(client, orgId).catch(() => ({ roles: [] as { userId: string; role: string }[] }));
    const ids = [...new Set([...hrHeads(config), ...roles.filter((x) => HR_ROLES.includes(x.role.toLowerCase())).map((x) => x.userId)])];
    const people = await emailsOf(client, ids);
    await send(deps, [...people.values()].map((x) => x.email), `Offer accepted, ready for onboarding: ${p.full_name ?? "a candidate"}`, mail(
      `${p.full_name ?? "The candidate"} accepted the offer for ${q.title ?? "the role"}. Their details are ready for onboarding under Recruitment → Offers → Handovers.`,
      [["Joining", snapshot.joiningDate ?? "—"], ["Department", q.department ?? "—"], ["Documents", `${snapshot.documents.filter((d) => d.status === "verified").length} verified of ${snapshot.documents.length}`]], { href: `${deps.appUrl}/hr-tickets`, label: "Open Recruitment → Offers" }, null));
    try {
      await deps.notifyInApp?.(ids, { organizationId: orgId, title: `Ready for onboarding: ${p.full_name ?? "a candidate"}`, message: `Accepted the offer for ${q.title ?? "the role"}; joining ${snapshot.joiningDate ?? "date to confirm"}.` });
    } catch (e) {
      console.error("[candidates] handover in-app alert failed", e);
    }
  } catch (error) {
    console.error("[candidates] handover failed", error);
  }
}

export async function listHandovers(client: SupabaseClient, orgId: string): Promise<OfferHandover[]> {
  const { data, error } = await client.from("recruitment_handovers").select("id, offer_id, candidate_id, joining_date, status, taken_by_name, taken_at, created_at, snapshot").eq("organization_id", orgId).order("created_at", { ascending: false }).limit(200);
  if (error) return [];
  return ((data ?? []) as Record<string, unknown>[]).map((r) => {
    const snap = (r.snapshot ?? {}) as { candidate?: { name?: string }; role?: string | null };
    return {
      id: r.id as string, offerId: r.offer_id as string, candidateName: snap.candidate?.name ?? "Candidate", positionTitle: snap.role ?? null,
      joiningDate: iso(r.joining_date)?.slice(0, 10) ?? null, status: r.status as OfferHandover["status"], takenByName: (r.taken_by_name as string | null) ?? null,
      takenAt: iso(r.taken_at), createdAt: iso(r.created_at) ?? "", snapshot: (r.snapshot as Record<string, unknown>) ?? {},
    };
  });
}

/** Onboarding took it (the HRMS has the person now). */
export async function markHandoverTaken(client: SupabaseClient, orgId: string, by: Actor, id: string): Promise<void> {
  if (!UUID.test(id)) throw new CandidateActionError(404, "Not found.");
  const { data, error } = await client.from("recruitment_handovers").update({ status: "taken", taken_by_name: by.name, taken_at: new Date().toISOString() }).eq("organization_id", orgId).eq("id", id).eq("status", "pending").select("id");
  if (error) fail("record the handover", error);
  if (!(data ?? []).length) throw new CandidateActionError(409, "It was already taken.");
}

// The salary breakup (annexure) -----------------------------------------------------------------------------------------

const BreakupInput = z.object({
  breakup: z.record(z.string().trim().min(1).max(60), z.number().min(0).max(100_000_000)),
  proposedCtc: z.number().positive("Give the offer CTC.").max(1_000_000_000).optional(),
  joiningDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  note: z.string().trim().max(2000).optional(),
  approvalRevision: z.number().int().positive().optional(),
});

/**
 * HR edits the breakup (and the CTC) until release. Any change starts the approval again from the first approver, so
 * nobody approves an annexure the candidate will not see. Logged in the audit log.
 */
export async function editBreakup(client: SupabaseClient, orgId: string, by: Actor, id: string, body: unknown, deps: FlowDeps, revising = false): Promise<Offer> {
  const parsed = BreakupInput.safeParse(body ?? {});
  if (!parsed.success) throw new CandidateActionError(400, parsed.error.issues[0]?.message ?? "Check the breakup.");
  if (Object.keys(parsed.data.breakup).length > 40) throw new CandidateActionError(400, "Too many rows in the breakup.");
  const row = await loadOffer(client, orgId, id);
  const allowed = revising ? ["rejected"] : ["pending", "approved"];
  if (!allowed.includes(row.status as string)) throw new CandidateActionError(409, revising ? "Only a rejected or returned offer can be revised." : "The breakup can be changed only until the offer is released.");
  if (releaseInProgress(row) || (parsed.data.approvalRevision !== undefined && parsed.data.approvalRevision !== row.approval_revision)) {
    throw new CandidateActionError(409, "The offer changed or is being released. Reload the offer.");
  }
  const revisedBy = revising ? by.id : (row.approval_submitted_by as string | null) ?? null;
  if (revising && !("approval_submitted_by" in row) && by.id !== row.created_by) throw new CandidateActionError(503, OFFER_FILE_MIGRATION);
  const ctc = parsed.data.proposedCtc ?? Number(row.proposed_ctc);
  const config = await loadRecruitmentConfig(client, orgId);
  const { data: req } = row.requisition_id ? await client.from("recruitment_requisitions").select("raised_by").eq("organization_id", orgId).eq("id", row.requisition_id as string).maybeSingle() : { data: null };
  const chain = firstApprover(config, row.created_by as string | null, (req as { raised_by?: string | null } | null)?.raised_by ?? null, row.hod_approver_id as string | null, ctc, num(row.band_max), revisedBy);
  if (!chain) throw new CandidateActionError(409, "Nobody can approve this offer: set the HR Head and Director in the Tech dashboard → HR Configs.");
  const now = (deps.now?.() ?? new Date()).toISOString();
  let update = client.from(OFFERS).update({
    approval_revision: Number(row.approval_revision) + 1, breakup: parsed.data.breakup, proposed_ctc: ctc, status: "pending", current_level: chain.level, current_approver_id: chain.approverId, level_entered_at: now,
    needs_director: chain.needsDirector, letter: null, notices: {}, updated_at: now,
    ...("letter_file_name" in row ? { letter_file_name: null, letter_pdf_base64: null, letter_release_started_at: null } : {}),
    ...("public_token" in row ? { public_token: null } : {}),
    ...(revising ? {
      response_reason: null,
      ...("approval_submitted_by" in row ? { approval_submitted_by: by.id } : {}),
      ...(parsed.data.joiningDate !== undefined ? { joining_date: parsed.data.joiningDate } : {}),
      ...(parsed.data.note !== undefined ? { selected_note: parsed.data.note || null } : {}),
    } : {}),
  }).eq("organization_id", orgId).eq("id", row.id as string).eq("status", row.status as string).eq("approval_revision", row.approval_revision);
  update = matchReleaseClaim(update, row);
  const { data: changed, error } = await update.select("id");
  if (error?.code === "23505") throw new CandidateActionError(409, "This person already has an open offer for this position.");
  if (error) fail(revising ? "revise the offer" : "save the breakup", error);
  if (!changed?.length) throw new CandidateActionError(409, "The annexure changed. Reload the offer.");
  await deps.revokeOfferLinks?.(row.id as string).catch((e) => console.error("[candidates] revoking offer links failed", e));
  await event(client, orgId, row.id as string, by, revising ? "resubmitted" : "breakup_edited", null, revising ? "Revised offer sent for approval" : "The breakup changed: approval starts again");
  await audit(client, orgId, by, { action: revising || Number(row.proposed_ctc) !== ctc ? "offer_edit" : "breakup_edit", entityType: "offer", entityId: row.id as string, before: { ctc: Number(row.proposed_ctc), breakup: row.breakup }, after: { ctc, breakup: parsed.data.breakup } });
  const offer = await one(client, orgId, row.id as string, by.id);
  await tellApprover(client, orgId, deps, offer, chain.approverId, chain.level);
  return offer;
}

/** A contact with someone joining (A18: at least once a week until joining). */
export async function logContact(client: SupabaseClient, orgId: string, by: Actor, id: string, noteInput: unknown): Promise<Offer> {
  const row = await loadOffer(client, orgId, id);
  if (row.status !== "accepted") throw new CandidateActionError(409, "Contacts are logged while the person is joining.");
  const note = typeof noteInput === "string" ? noteInput.trim().slice(0, 1000) || null : null;
  const now = new Date().toISOString();
  const { error } = await client.from(OFFERS).update({ last_contact_at: now, updated_at: now }).eq("id", row.id as string);
  if (error) fail("log the contact", error);
  await event(client, orgId, row.id as string, by, "contacted", null, note);
  return one(client, orgId, row.id as string, by.id);
}

/**
 * Stage 9's exit. Joined: the person moves to "Joined", and the position closes once every opening is filled (A19).
 * Dropped: with the reason, the position reopens, and the HR Head and the Director are told (A20).
 */
export async function recordJoining(client: SupabaseClient, orgId: string, by: Actor, id: string, body: unknown, deps: FlowDeps): Promise<Offer> {
  const b = (body ?? {}) as { outcome?: unknown; reason?: unknown };
  const outcome = b.outcome === "joined" || b.outcome === "dropped" ? b.outcome : null;
  if (!outcome) throw new CandidateActionError(400, "Joined or dropped?");
  const reason = typeof b.reason === "string" ? b.reason.trim().slice(0, 2000) || null : null;
  if (outcome === "dropped" && !reason) throw new CandidateActionError(400, "Give the reason the person did not join.");
  const row = await loadOffer(client, orgId, id);
  if (row.status !== "accepted") throw new CandidateActionError(409, "Only an accepted offer can be marked joined or dropped.");
  const now = new Date().toISOString();
  const { error } = await client.from(OFFERS).update(outcome === "joined" ? { status: "joined", joined_at: now, updated_at: now } : { status: "dropped", dropped_reason: reason, updated_at: now }).eq("id", row.id as string);
  if (error) fail("record the joining", error);
  await event(client, orgId, row.id as string, by, outcome, null, reason);
  await recordAction(client, orgId, by, { candidateId: row.candidate_id as string, applicationId: (row.application_id as string | null) ?? null, positionId: (row.position_id as string | null) ?? null, action: "remark", toValue: outcome === "joined" ? "Joined" : "Dropped before joining", remark: reason, meta: { kind: "offer_joining", offerId: row.id, outcome } });
  const positionId = row.position_id as string | null;
  if (outcome === "joined") {
    await moveTo(client, orgId, by, row, "joined", null);
    if (positionId) {
      const [{ data: pos }, { data: joined }] = await Promise.all([
        client.from("candidate_positions").select("openings, status").eq("id", positionId).maybeSingle(),
        client.from(OFFERS).select("id").eq("organization_id", orgId).eq("position_id", positionId).eq("status", "joined"),
      ]);
      const openings = Number((pos as { openings?: number } | null)?.openings) || 1;
      if ((joined ?? []).length >= openings && (pos as { status?: string } | null)?.status === "open") {
        await client.from("candidate_positions").update({ status: "closed", closed_at: now, updated_at: now }).eq("id", positionId);
        await event(client, orgId, row.id as string, by, "position_closed", null, `All ${openings} opening${openings === 1 ? "" : "s"} filled`);
      }
    }
  } else {
    if (positionId) await client.from("candidate_positions").update({ status: "open", closed_at: null, updated_at: now }).eq("id", positionId);
    const config = await loadRecruitmentConfig(client, orgId);
    const people = await emailsOf(client, [...hrHeads(config), ...directors(config)]);
    const offer = (await toOffers(client, orgId, [row]))[0];
    await send(deps, [...people.values()].map((p) => p.email), `Dropped before joining: ${offer.candidateName} · ${offer.positionTitle ?? ""}`, mail(`${offer.candidateName} accepted the offer for ${offer.positionTitle ?? "the role"} but will not join.`, [["Reason", reason ?? "—"], ["Was joining", offer.joiningDate ?? "—"]], null, "The position is open again."));
  }
  return one(client, orgId, row.id as string, by.id);
}

/** The offer chasers (A14-A18): approval reminder at 24 h and escalation at 48 h; the candidate chased at 24/48/72 h after
 *  release and the recruiter and HR Head on day 4; weekly contact while joining; HR told 7 days before joining. */
export async function runOfferJobs(client: SupabaseClient, orgId: string, deps: FlowDeps, now = deps.now?.() ?? new Date()): Promise<number> {
  const { data, error } = await withExtras((columns) => client.from(OFFERS).select(columns).eq("organization_id", orgId).in("status", ["pending", "released", "accepted"]));
  if (error) return 0;
  const rows = (data ?? []) as unknown as Record<string, unknown>[];
  if (!rows.length) return 0;
  const config = await loadRecruitmentConfig(client, orgId);
  const offers = await toOffers(client, orgId, rows);
  let sent = 0;
  for (const [i, row] of rows.entries()) {
    const offer = offers[i];
    const notices = (row.notices as Record<string, string>) ?? {};
    const mark = async (key: string) => { notices[key] = now.toISOString(); await client.from(OFFERS).update({ notices }).eq("id", row.id as string); sent += 1; };
    const ageH = (v: unknown) => (now.getTime() - new Date(String(v)).getTime()) / HOUR;
    if (row.status === "pending" && row.level_entered_at) {
      const key = `${row.current_level}`;
      if (ageH(row.level_entered_at) >= 48 && !notices[`esc_${key}`]) {
        const people = await emailsOf(client, directors(config));
        await send(deps, [...people.values()].map((p) => p.email), `Offer waiting 2 days for approval: ${offer.candidateName}`, mail(`The offer for ${offer.candidateName} (${lpa(offer.proposedCtc)}) has waited 48 hours for ${offer.currentApproverName ?? "the approver"}.`, [], null, null));
        await mark(`esc_${key}`);
      } else if (ageH(row.level_entered_at) >= 24 && !notices[`rem_${key}`] && row.current_approver_id) {
        await tellApprover(client, orgId, deps, offer, row.current_approver_id as string, row.current_level as OfferLevel, true);
        await mark(`rem_${key}`);
      }
    } else if (row.status === "released" && row.released_at) {
      const h = ageH(row.released_at);
      const { data: person } = await client.from("candidates").select("email, blacklisted_at").eq("organization_id", orgId).eq("id", row.candidate_id as string).maybeSingle();
      // Blacklisted: no chaser to the candidate (the HR escalation on day 4 still goes).
      const candidateEmail = (person as { blacklisted_at?: string | null } | null)?.blacklisted_at ? null : (person as { email?: string | null } | null)?.email;
      for (const step of [72, 48, 24]) {
        if (h >= step && !notices[`chase_${step}`]) {
          await send(deps, [candidateEmail],`Reminder: your offer for ${offer.positionTitle ?? "the role"} at Autopilot Offices`, mail(`Hello ${firstName(offer.candidateName)}, we are waiting to hear from you about the offer we sent on ${String(row.released_at).slice(0, 10)}.`, [], null, row.public_token ? `Please accept or decline on your letter's page: ${offerPageUrl(row.public_token as string, deps.appUrl || APP_URL)}` : "Please reply to the offer email to accept, or to tell us if you have questions."));
          for (const s of [24, 48, 72]) if (s <= step) notices[`chase_${s}`] = notices[`chase_${s}`] ?? now.toISOString();
          await mark(`chase_${step}`);
          break;
        }
      }
      if (h >= 96 && !notices.day4) {
        const { data: pos } = offer.positionId ? await client.from("candidate_positions").select("recruiter_id").eq("id", offer.positionId).maybeSingle() : { data: null };
        const people = await emailsOf(client, [(pos as { recruiter_id?: string | null } | null)?.recruiter_id, ...hrHeads(config)]);
        await send(deps, [...people.values()].map((p) => p.email), `No answer for 4 days: offer to ${offer.candidateName}`, mail(`${offer.candidateName} has not answered the offer released on ${String(row.released_at).slice(0, 10)}. Please call them.`, [], null, null));
        await mark("day4");
      }
    } else if (row.status === "accepted") {
      const { data: pos } = offer.positionId ? await client.from("candidate_positions").select("recruiter_id").eq("id", offer.positionId).maybeSingle() : { data: null };
      const recruiterId = (pos as { recruiter_id?: string | null } | null)?.recruiter_id ?? (row.created_by as string | null);
      const weekKey = `week_${Math.floor(now.getTime() / (7 * DAY))}`;
      if (row.last_contact_at && ageH(row.last_contact_at) >= 7 * 24 && !notices[weekKey]) {
        const people = await emailsOf(client, [recruiterId]);
        await send(deps, [...people.values()].map((p) => p.email), `Call ${offer.candidateName} this week (joining ${offer.joiningDate ?? "soon"})`, mail(`It has been a week since anyone spoke to ${offer.candidateName}, who joins as ${offer.positionTitle ?? "—"} on ${offer.joiningDate ?? "—"}.`, [], null, "Log the call on the offer (Recruitment → Offers) so the reminder stops."));
        await mark(weekKey);
      }
      if (row.last_contact_at && ageH(row.last_contact_at) >= 10 * 24 && !notices[`silent_${weekKey}`]) {
        const people = await emailsOf(client, hrHeads(config));
        await send(deps, [...people.values()].map((p) => p.email), `No contact for 10 days: ${offer.candidateName}`, mail(`Nobody has logged a call with ${offer.candidateName} (joining ${offer.joiningDate ?? "—"}) for 10 days.`, [], null, null));
        await mark(`silent_${weekKey}`);
      }
      if (offer.joiningDate) {
        const days = (new Date(`${offer.joiningDate}T00:00:00+05:30`).getTime() - now.getTime()) / DAY;
        if (days <= 7 && days > 0 && !notices.week_before) {
          const { roles } = await activeRoles(client, orgId).catch(() => ({ roles: [] as { userId: string; role: string }[] }));
          const people = await emailsOf(client, [...hrHeads(config), ...roles.filter((x) => HR_ROLES.includes(x.role.toLowerCase())).map((x) => x.userId)]);
          await send(deps, [...people.values()].map((p) => p.email), `Joining in a week: ${offer.candidateName} · ${offer.joiningDate}`, mail(`${offer.candidateName} joins as ${offer.positionTitle ?? "—"} on ${offer.joiningDate}. Please get the onboarding ready.`, [], null, null));
          await mark("week_before");
        }
        if (days <= -1 && !notices.joining_passed) {
          const people = await emailsOf(client, [recruiterId]);
          await send(deps, [...people.values()].map((p) => p.email), `Did ${offer.candidateName} join?`, mail(`${offer.candidateName}'s joining date (${offer.joiningDate}) has passed. Mark them joined or dropped under Recruitment → Offers.`, [], null, null));
          await mark("joining_passed");
        }
      }
    }
  }
  return sent;
}
