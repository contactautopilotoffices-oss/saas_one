import { hasInterviewConsent, saveInterviewConsent } from './interview-consent';
/**
 * The interview page (owner 2026-11-24, from the 23 Nov HR meeting; migration 20261124000003): /interview/<token>.
 *   "Interview invites should include position, location, JD, company profile and interview link"; "reminders should
 *   carry guidelines (earphones, quiet place, formal dress) and an RSVP yes/no option".
 * One page per interview, linked from the WhatsApp invite and reminder and the emails: the role, when, how to join (the
 * video link) or where to come, HR's guidelines, the job description, the company profile link, and "Will you attend?
 * Yes / No". A "No" tells the person who booked it, so they can find a new time. No sign-in: the token is the only key,
 * and the page shows nothing but this interview.
 */
import { randomBytes } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import { recordAction } from "./actions";
import { systemActor } from "./applications";
import { CandidateActionError } from "./records";
import { loadRecruitmentConfig } from "./requisitions";

const INTERVIEWS = "recruitment_interviews";
const TOKEN = /^[A-Za-z0-9_-]{32,64}$/;
const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || "").replace(/\/$/, "");

export const newInterviewToken = () => randomBytes(24).toString("base64url");
export const interviewPageUrl = (token: string, base = APP_URL) => `${base}/interview/${token}`;

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "Fri, 28 Nov 2026 at 11:00 am (IST)". */
export function istWhen(at: Date): string {
  const d = new Date(at.getTime() + 330 * 60_000);
  const h = d.getUTCHours();
  return `${DAYS[d.getUTCDay()]}, ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()} at ${h % 12 || 12}:${String(d.getUTCMinutes()).padStart(2, "0")} ${h < 12 ? "am" : "pm"} (IST)`;
}

export interface PublicInterview {
  companyName: string;
  companyProfileUrl: string | null;
  firstName: string | null;
  role: string | null;
  location: string | null;
  round: string | null;
  when: string;
  online: boolean;
  joinUrl: string | null;
  venue: string | null;
  guidelines: string[];
  jd: string | null;
  status: "scheduled" | "done" | "no_show" | "cancelled";
  /** The time has passed (the answer can no longer change). */
  past: boolean;
  rsvp: "yes" | "no" | null;
  analysisConsent?: boolean;
}

interface Row {
  id: string; organization_id: string; candidate_id: string; application_id: string | null; position_id: string | null; round: string | null; at: string;
  mode: string | null; venue: string | null; join_path: string | null; status: PublicInterview["status"]; rsvp: "yes" | "no" | null; created_by: string | null;
}
async function byToken(client: SupabaseClient, token: string): Promise<Row | null> {
  if (!TOKEN.test(token)) return null;
  const { data, error } = await client.from(INTERVIEWS).select("id, organization_id, candidate_id, application_id, position_id, round, at, mode, venue, join_path, status, rsvp, created_by").eq("public_token", token).maybeSingle();
  if (error) {
    if (/public_token|rsvp|does not exist|schema cache/.test(error.message ?? "")) return null;
    throw new CandidateActionError(500, "The interview page could not be opened. Please try again.");
  }
  return data as unknown as Row | null;
}

async function onlineMeeting(db: SupabaseClient, row: Row) {
  if (row.mode !== 'online' || row.status !== 'scheduled') return null;
  const { data, error } = await db.from('candidate_actions').select('meta').eq('organization_id', row.organization_id)
    .eq('candidate_id', row.candidate_id).eq('action', 'remark').contains('meta', { kind: 'interview', interviewId: row.id }).maybeSingle();
  return !error && typeof data?.meta?.meetingId === 'string' ? data.meta.meetingId as string : null;
}

export async function consentFromInvite(db: SupabaseClient, token: string, now = new Date()) {
  const row = await byToken(db, token);
  if (!row || new Date(row.at).getTime() + 3 * 3600000 < now.getTime()) throw new CandidateActionError(409, 'This interview is no longer open.');
  const meetingId = await onlineMeeting(db, row);
  if (!meetingId) throw new CandidateActionError(409, 'This interview is no longer available for analysis consent.');
  await saveInterviewConsent(db, row.organization_id, row.candidate_id, meetingId);
}

/** What the page shows, or null when the link is unknown. */
export async function publicInterview(client: SupabaseClient, token: string, now = new Date(), appUrl = APP_URL): Promise<PublicInterview | null> {
  const row = await byToken(client, token);
  if (!row) return null;
  const [config, { data: person }, { data: pos }] = await Promise.all([
    loadRecruitmentConfig(client, row.organization_id),
    client.from("candidates").select("full_name").eq("organization_id", row.organization_id).eq("id", row.candidate_id).maybeSingle(),
    row.position_id ? client.from("candidate_positions").select("title, location, summary, jd_text").eq("organization_id", row.organization_id).eq("id", row.position_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const p = pos as { title?: string; location?: string | null; summary?: string | null; jd_text?: string | null } | null;
  const online = row.mode === "online";
  const at = new Date(row.at);
  const meetingId = at.getTime() + 3 * 3600000 >= now.getTime() ? await onlineMeeting(client, row) : null;
  const s = config.outreach;
  return {
    ...(meetingId ? { analysisConsent: await hasInterviewConsent(client, row.organization_id, row.candidate_id, meetingId) } : {}),
    companyName: s.companyName,
    companyProfileUrl: s.companyProfileUrl || null,
    firstName: ((person as { full_name?: string | null } | null)?.full_name ?? "").trim().split(/\s+/)[0] || null,
    role: p?.title ?? null,
    location: p?.location ?? null,
    round: row.round,
    when: istWhen(at),
    online,
    // The video link only while the interview is on the calendar.
    joinUrl: online && row.join_path && row.status === "scheduled" ? `${appUrl}${row.join_path}` : null,
    venue: online ? null : row.venue,
    guidelines: online ? s.interview.guidelinesOnline : s.interview.guidelinesInPerson,
    jd: [p?.summary, p?.jd_text].filter((x): x is string => Boolean(x && x.trim())).join("\n\n").slice(0, 20_000) || null,
    status: row.status,
    past: at.getTime() < now.getTime(),
    rsvp: row.rsvp,
  };
}

/**
 * The candidate's answer. Yes or No (with an optional note), changeable until the interview's time. A "No" emails the
 * person who booked it. Recorded in the candidate's history.
 */
export async function rsvpInterview(client: SupabaseClient, token: string, input: { answer: unknown; note?: unknown }, deps: { sendEmail?: (to: string, subject: string, html: string) => Promise<void>; now?: () => Date } = {}): Promise<"yes" | "no"> {
  const answer = input.answer === "yes" || input.answer === "no" ? input.answer : null;
  if (!answer) throw new CandidateActionError(400, "Choose Yes or No.");
  const note = typeof input.note === "string" ? input.note.trim().slice(0, 500) || null : null;
  const row = await byToken(client, token);
  if (!row) throw new CandidateActionError(404, "This interview link is no longer open.");
  const now = deps.now?.() ?? new Date();
  if (row.status !== "scheduled") throw new CandidateActionError(409, row.status === "cancelled" ? "This interview was cancelled. The recruiter will be in touch." : "This interview is over.");
  if (new Date(row.at).getTime() < now.getTime()) throw new CandidateActionError(409, "The interview time has passed.");
  const { error } = await client.from(INTERVIEWS).update({ rsvp: answer, rsvp_at: now.toISOString(), rsvp_note: note }).eq("id", row.id).eq("status", "scheduled");
  if (error) throw new CandidateActionError(500, "Your answer could not be saved. Please try again.");
  if (row.rsvp === answer) return answer;
  await recordAction(client, row.organization_id, systemActor("Interview page"), {
    candidateId: row.candidate_id, applicationId: row.application_id, positionId: row.position_id, action: "remark",
    toValue: answer === "yes" ? `Confirmed the ${row.round ?? ""} interview`.replace(/\s+/g, " ") : `Cannot attend the ${row.round ?? ""} interview`.replace(/\s+/g, " "), remark: note,
    meta: { kind: "interview_rsvp", interviewId: row.id, rsvp: answer },
  });
  if (answer === "no" && row.created_by && deps.sendEmail) {
    const [{ data: booker }, { data: person }] = await Promise.all([
      client.from("users").select("email").eq("id", row.created_by).maybeSingle(),
      client.from("candidates").select("full_name").eq("id", row.candidate_id).maybeSingle(),
    ]);
    const email = (booker as { email?: string | null } | null)?.email;
    const name = (person as { full_name?: string | null } | null)?.full_name ?? "The candidate";
    const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
    if (email) {
      try {
        await deps.sendEmail(email, `${name} cannot attend the ${row.round ?? ""} interview · ${istWhen(new Date(row.at))}`.replace(/\s+/g, " "),
          `<div style="font-family:Arial,sans-serif;font-size:14px;color:#0f172a"><p><strong>${esc(name)}</strong> said they cannot attend the ${esc(row.round ?? "")} interview on ${esc(istWhen(new Date(row.at)))}.</p>${note ? `<p style="border-left:3px solid #cbd5e1;padding-left:10px">${esc(note)}</p>` : ""}<p>Open the candidate's Interviews tab in Recruitment to reschedule or cancel it.</p></div>`);
      } catch (e) {
        console.error("[candidates] rsvp: the booker was not told", e);
      }
    }
  }
  return answer;
}
