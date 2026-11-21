/**
 * Interviews (owner 2026-11-19; HRMS meeting: "FMS meeting integration … generate meeting links directly within the
 * platform, with interviews recorded and auto-transcribed natively", "both physical and online meeting scheduling in
 * one flow", "invites should also be sent to the respective hiring managers"; migration 20261119000002).
 *
 * "Schedule interview" on a candidate in a position (owner 2026-11-19: online or in person, no hybrid):
 *   online    : makes the Meeting Assistant's online meeting (HR space, one link for everyone: the interviewers picked
 *               go straight in, the candidate waits to be let in; recorded in a team member's browser and written up
 *               as notes, tasks not looked for). HR joins it from the candidate's Interviews tab.
 *   in person : no call; the venue is in the invite. "Record interview" in the Interviews tab makes a recording (the
 *               Meeting Assistant's phone/laptop recorder) when the interview starts (startInterviewRecording).
 * Owner 2026-11-19: "it must be within the recruitment tab": these meetings are marked purpose "interview" and are not
 * listed in the Meeting Assistant.
 * The interview is a history entry under the position (`remark`, meta.kind "interview", as since 2026-11-17), with the
 * meeting it made. Optionally the person is moved to a stage. Then, only when HR ticked them, the invites: the
 * candidate on WhatsApp (Meta template candidate_interview_invite_v1, recorded in candidate_outreach) and by email,
 * and each interviewer by email (the same link). Scheduling is HR's click; nothing is sent on its own. A blacklisted
 * person is never messaged. A send that fails never undoes the interview: the form says what went and what did not.
 *
 * The notes of the call are shown on the candidate (listInterviews reads the meeting's summary).
 * Everything that reaches the outside (the meeting, WhatsApp, email) is passed in `deps`, so tests use fakes.
 */
import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { assertInPosition, listActions, loadBlacklist, recordAction, REMARK_MAX, type Actor } from "./actions";
import { parsePhone } from "./normalize";
import { campaignFor, maskPhone, withinSendingHours } from "./outreach";
import { moveMember } from "./positions";
import { CandidateActionError, getRecord } from "./records";
import { INTERVIEW_MODES, type Interview, type InterviewMode, type InterviewSend } from "./types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const INTERVIEWS_MIGRATION_MESSAGE = "The WhatsApp invite needs a database update first: run 20261119000002_recruitment_interviews.sql in Supabase.";

export interface InterviewDeps {
  /** Makes the meeting (MeetingService.create in the HR space): the video call, or a recording that starts now. Throws a sentence the form can show. */
  createMeeting: (userId: string, input: { title: string; attendeeIds: string[]; extraNames: string[]; kind: "online" | "room"; scheduledFor?: string }) => Promise<{ id: string; joinPath: string | null }>;
  /** The Task Manager people the interviewers are picked from (the Meeting Assistant's list). */
  people: () => Promise<{ id: string; name: string; department?: string | null }[]>;
  sendWhatsApp: (o: { phone: string; campaignName: string; templateParams: string[]; userName?: string }) => Promise<{ success: boolean; error?: string; providerReference?: string }>;
  sendEmail: (to: string, subject: string, html: string) => Promise<void>;
  /** Where the app is ("https://…"), for the link in the messages. */
  appUrl: string;
  now?: () => Date;
}

export function defaultInterviewDeps(appUrl: string): InterviewDeps {
  return {
    async createMeeting(userId, input) {
      const { MeetingService, MeetingError } = await import("@/task-manager/meetings/MeetingService");
      try {
        return await MeetingService.create(userId, { ...input, findTasks: false, purpose: "interview" }, "hr");
      } catch (error) {
        if (error instanceof MeetingError) throw new CandidateActionError(error.status >= 500 ? 503 : 400, error.message);
        throw error;
      }
    },
    async people() {
      const { MeetingService } = await import("@/task-manager/meetings/MeetingService");
      return MeetingService.people();
    },
    async sendWhatsApp(o) {
      const { AiSensyService } = await import("@/backend/services/AiSensyService");
      return AiSensyService.sendTemplate(o);
    },
    async sendEmail(to, subject, html) {
      const { EmailService } = await import("@/backend/services/EmailService");
      await EmailService.sendEmail({ to, subject, html });
    },
    appUrl: (process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || appUrl).replace(/\/$/, ""),
  };
}

const Input = z.object({
  applicationId: z.string().regex(UUID, "Pick the candidate."),
  positionId: z.string().regex(UUID, "Pick the position."),
  round: z.string().trim().min(1, "Say which round, e.g. L1.").max(60, "Keep the round under 60 characters."),
  /** India time from the form: "2026-11-21T11:00". */
  at: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "Pick the date and time of the interview."),
  mode: z.enum(INTERVIEW_MODES),
  venue: z.string().trim().max(200).optional(),
  interviewerIds: z.array(z.string().regex(UUID)).max(10, "Up to 10 interviewers.").default([]),
  note: z.string().trim().max(REMARK_MAX).optional(),
  /** A stage to move the person to as well (optional). */
  moveTo: z.string().max(40).optional(),
  notify: z.object({ whatsapp: z.boolean().default(false), email: z.boolean().default(false), interviewers: z.boolean().default(false) }).default({ whatsapp: false, email: false, interviewers: false }),
});

/** "2026-11-21T11:00" (India time) as an instant. */
export function istInstant(local: string): Date {
  return new Date(`${local}:00+05:30`);
}

/** "Fri, 21 Nov 2026 at 11:00 am (IST)". */
export function istLabel(local: string): string {
  // Built by hand: the runtime's own date formatting differs between machines (commas, "am" or "AM").
  const d = new Date(istInstant(local).getTime() + 330 * 60_000);
  const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const h = d.getUTCHours();
  const time = `${h % 12 || 12}:${String(d.getUTCMinutes()).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
  return `${DAYS[d.getUTCDay()]}, ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()} at ${time} (IST)`;
}

const esc = (s: string | null | undefined) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
const firstName = (name: string) => name.trim().split(/\s+/)[0] || "there";
/** A WhatsApp template parameter is one line. */
const param = (s: string) => s.replace(/[\r\n\t]+/g, " ").replace(/\s{2,}/g, " ").trim();

function emailHtml(heading: string, rows: [string, string][], link: string | null, footer: string): string {
  const table = rows.map(([k, v]) => `<tr><td style="padding:4px 14px 4px 0;color:#64748b;vertical-align:top">${esc(k)}</td><td style="padding:4px 0">${esc(v)}</td></tr>`).join("");
  const button = link ? `<p style="margin:18px 0"><a href="${esc(link)}" style="background:#4f46e5;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600">Join the video call</a></p><p style="font-size:12px;color:#64748b">Or open: ${esc(link)}</p>` : "";
  return `<div style="font-family:Arial,sans-serif;font-size:14px;color:#0f172a"><p style="font-size:16px;font-weight:600">${esc(heading)}</p><table style="border-collapse:collapse;font-size:14px">${table}</table>${button}<p style="font-size:12px;color:#64748b;margin-top:18px">${esc(footer)}</p></div>`;
}

/**
 * Schedules one interview. Returns it, and what was sent. Throws (and makes nothing) when the form is incomplete, the
 * person is not in the position, or the video call cannot be made.
 */
export async function scheduleInterview(client: SupabaseClient, orgId: string, by: Actor, body: unknown, deps: InterviewDeps): Promise<{ interview: Interview; sent: InterviewSend[] }> {
  const parsed = Input.safeParse(body ?? {});
  if (!parsed.success) throw new CandidateActionError(400, parsed.error.issues[0]?.message ?? "Check the form.");
  const input = parsed.data;
  const now = deps.now?.() ?? new Date();
  const when = istInstant(input.at);
  if (!Number.isFinite(when.getTime())) throw new CandidateActionError(400, "Pick a real date and time.");
  if (when.getTime() < now.getTime() - 10 * 60_000) throw new CandidateActionError(400, "The interview time is in the past.");
  if (when.getTime() > now.getTime() + 366 * 86_400_000) throw new CandidateActionError(400, "The interview is more than a year away.");
  const online = input.mode === "online";
  const venue = input.venue || null;

  const record = await getRecord(client, orgId, input.applicationId);
  const positionId = await assertInPosition(client, orgId, record.candidateId, input.positionId);
  const { data: pos, error: posErr } = await client.from("candidate_positions").select("title").eq("organization_id", orgId).eq("id", positionId).is("deleted_at", null).maybeSingle();
  if (posErr) throw new CandidateActionError(500, "Couldn't load the position. Please try again.");
  if (!pos) throw new CandidateActionError(400, "That position no longer exists.");
  const role = (pos as { title: string }).title;

  // The interviewers: only people on the Task Manager's list (the meeting's own check is the same).
  const everyone = input.interviewerIds.length ? await deps.people() : [];
  const interviewers = [...new Set(input.interviewerIds.map((id) => id.toLowerCase()))].map((id) => everyone.find((p) => p.id.toLowerCase() === id)).filter((p): p is NonNullable<typeof p> => !!p);

  let meeting: { id: string; joinPath: string | null } | null = null;
  if (online) {
    meeting = await deps.createMeeting(by.id, {
      title: `Interview: ${record.fullName} · ${input.round} · ${role}`.slice(0, 150),
      attendeeIds: interviewers.map((p) => p.id),
      extraNames: [record.fullName],
      kind: "online",
      scheduledFor: when.toISOString(),
    });
  }
  const joinUrl = meeting?.joinPath ? `${deps.appUrl}${meeting.joinPath}` : null;
  const interviewId = randomUUID();
  const names = interviewers.map((p) => p.name).join(", ") || null;

  await recordAction(client, orgId, by, {
    candidateId: record.candidateId, applicationId: record.id, positionId, action: "remark",
    toValue: "Interview scheduled", remark: input.note || null,
    meta: {
      kind: "interview", interviewId, at: input.at, mode: input.mode, round: input.round, venue,
      interviewer: names, interviewerIds: interviewers.map((p) => p.id), meetingId: meeting?.id ?? null, joinPath: meeting?.joinPath ?? null,
    },
  });
  if (input.moveTo) await moveMember(client, orgId, by, positionId, await memberId(client, orgId, positionId, record.candidateId), input.moveTo, null);

  // The invites, only those HR ticked.
  const sent: InterviewSend[] = [];
  const label = istLabel(input.at);
  const blacklisted = Boolean(await loadBlacklist(client, orgId, record.candidateId));
  const where = online ? `Join the video call here: ${joinUrl}` : `Please come to: ${venue ?? "our office"}`;

  if (input.notify.whatsapp) {
    sent.push(await inviteOnWhatsApp(client, orgId, by, deps, { record, positionId, role, interviewId, round: input.round, label, where, blacklisted, now }));
  }
  if (input.notify.email) {
    if (blacklisted) sent.push({ to: "candidate", channel: "email", name: record.fullName, ok: false, note: "This person is blacklisted. No message goes to them." });
    else if (!record.email) sent.push({ to: "candidate", channel: "email", name: record.fullName, ok: false, note: "No email address on record." });
    else {
      const html = emailHtml(`Hello ${firstName(record.fullName)}, your ${input.round} interview for the ${role} role at Autopilot Offices`,
        [["When", label], ["How", online ? "Video call" : "In person"], ...(venue && !online ? [["Where", venue] as [string, string]] : [])],
        joinUrl, online ? "Open the link a few minutes early. You will be let in when the interview starts. This call will be recorded." : "If this time does not suit you, please tell the recruiter who called you.");
      sent.push(await tryEmail(deps, record.email, `Interview for ${role} at Autopilot Offices · ${label}`, html, { to: "candidate", name: record.fullName }));
    }
  }
  if (input.notify.interviewers && interviewers.length) {
    const { data } = await client.from("users").select("id, email").in("id", interviewers.map((p) => p.id));
    const emails = new Map(((data ?? []) as { id: string; email: string | null }[]).map((u) => [u.id, u.email]));
    const about = [record.currentDesignation, record.currentOrganization].filter(Boolean).join(" at ");
    for (const p of interviewers) {
      const email = emails.get(p.id);
      if (!email) { sent.push({ to: "interviewer", channel: "email", name: p.name, ok: false, note: "No email address on their account." }); continue; }
      const html = emailHtml(`Interview: ${record.fullName} for ${role}`,
        [["Round", input.round], ["When", label], ["How", online ? "Video call" : "In person"],
          ...(venue && !online ? [["Where", venue] as [string, string]] : []), ...(about ? [["Candidate", about] as [string, string]] : []), ...(names ? [["Interviewers", names] as [string, string]] : []),
          ...(input.note ? [["Note", input.note] as [string, string]] : []), ["Scheduled by", by.name ?? "HR"]],
        joinUrl, online ? "You go straight in with your login; the candidate waits until someone in the call lets them in. The call is recorded and the notes appear on the candidate's profile." : "HR records the interview from the Recruitment module; the notes appear on the candidate's profile.");
      sent.push(await tryEmail(deps, email, `Interview: ${record.fullName} · ${input.round} · ${label}`, html, { to: "interviewer", name: p.name }));
    }
  }

  const [interview] = (await listInterviews(client, orgId, record.candidateId, deps.appUrl)).filter((i) => i.meetingId === (meeting?.id ?? null) && i.at === input.at);
  return { interview, sent };
}

async function memberId(client: SupabaseClient, orgId: string, positionId: string, candidateId: string): Promise<string> {
  const { data } = await client.from("candidate_position_members").select("id").eq("organization_id", orgId).eq("position_id", positionId).eq("candidate_id", candidateId).is("deleted_at", null).maybeSingle();
  if (!data) throw new CandidateActionError(400, "This person is no longer in that position.");
  return (data as { id: string }).id;
}

async function tryEmail(deps: InterviewDeps, to: string, subject: string, html: string, who: { to: InterviewSend["to"]; name: string }): Promise<InterviewSend> {
  try {
    await deps.sendEmail(to, subject, html);
    return { ...who, channel: "email", ok: true, note: null };
  } catch (error) {
    console.error("[candidates] interview email failed", error);
    return { ...who, channel: "email", ok: false, note: "The email could not be sent." };
  }
}

/** The candidate's WhatsApp invite: the same checks and record as the other candidate messages (outreach.ts). */
async function inviteOnWhatsApp(client: SupabaseClient, orgId: string, by: Actor, deps: InterviewDeps, a: {
  record: { id: string; candidateId: string; fullName: string; phone: string | null }; positionId: string; role: string; interviewId: string; round: string; label: string; where: string; blacklisted: boolean; now: Date;
}): Promise<InterviewSend> {
  const out = (ok: boolean, note: string | null): InterviewSend => ({ to: "candidate", channel: "whatsapp", name: a.record.fullName, ok, note });
  if (a.blacklisted) return out(false, "This person is blacklisted. No message goes to them.");
  const phone = a.record.phone ? parsePhone(a.record.phone).key : null;
  if (!phone) return out(false, "No valid Indian mobile number on record.");
  // The invite is recorded with its interview: refuse before sending when that column is not there yet.
  const probe = await client.from("candidate_outreach").select("interview_id").limit(1);
  if (probe.error) return out(false, INTERVIEWS_MIGRATION_MESSAGE);

  const campaign = campaignFor("interview_invite");
  const destination = `91${phone}`;
  const result = await deps.sendWhatsApp({
    phone: destination, campaignName: campaign, userName: a.record.fullName,
    templateParams: [firstName(a.record.fullName), param(a.round), param(a.role), param(a.label), param(a.where)],
  });
  const { data: saved, error } = await client.from("candidate_outreach").insert({
    organization_id: orgId, candidate_id: a.record.candidateId, application_id: a.record.id, position_id: a.positionId,
    kind: "interview_invite", channel: "whatsapp", phone: destination, campaign, role_title: a.role, interview_id: a.interviewId,
    message: param(a.where), status: result.success ? "sent" : "failed",
    error: result.success ? null : (result.error ?? "WhatsApp did not accept the message").slice(0, 500),
    provider_message_id: result.providerReference ?? null, created_by: by.id, created_by_name: by.name,
  }).select("id").single();
  if (error) console.error("[candidates] interview invite: the send was not recorded", error);
  if (!result.success) return out(false, `WhatsApp did not accept the message: ${(result.error ?? "unknown error").slice(0, 200)}`);
  await recordAction(client, orgId, by, {
    candidateId: a.record.candidateId, applicationId: a.record.id, positionId: a.positionId, action: "outreach_sent",
    toValue: `Interview invite: ${a.round}`,
    meta: { kind: "interview_invite", channel: "whatsapp", campaign, position: a.role, phone: maskPhone(phone), outreachId: (saved as { id: string } | null)?.id ?? null, interviewId: a.interviewId },
  });
  return out(true, withinSendingHours(a.now) ? null : "Sent outside 9 am – 7 pm IST.");
}

/** The interviews scheduled for a person, newest first, each with its meeting's notes once they are written. */
export async function listInterviews(client: SupabaseClient, orgId: string, candidateId: string, appUrl: string): Promise<Interview[]> {
  const all = await listActions(client, orgId, candidateId);
  const actions = all.filter((a) => a.action === "remark" && a.meta.kind === "interview");
  // An in-person interview's recording (startInterviewRecording): the latest one per interview (the list is newest first).
  const recordingOf = new Map<string, string>();
  for (const a of all) {
    if (a.action === "remark" && a.meta.kind === "interview_recording" && typeof a.meta.entryId === "string" && typeof a.meta.meetingId === "string" && !recordingOf.has(a.meta.entryId)) {
      recordingOf.set(a.meta.entryId, a.meta.meetingId);
    }
  }
  const meetingOf = (a: (typeof actions)[number]): string | null => (typeof a.meta.meetingId === "string" && a.meta.meetingId ? a.meta.meetingId : recordingOf.get(a.id) ?? null);
  const meetingIds = [...new Set(actions.map(meetingOf).filter((id): id is string => typeof id === "string" && UUID.test(id)))];
  const positionIds = [...new Set(actions.map((a) => a.positionId).filter((id): id is string => !!id))];
  const [meetings, positions] = await Promise.all([
    meetingIds.length ? client.from("meeting_notes").select("id, status, summary").in("id", meetingIds) : Promise.resolve({ data: [], error: null }),
    positionIds.length ? client.from("candidate_positions").select("id, title").eq("organization_id", orgId).in("id", positionIds) : Promise.resolve({ data: [], error: null }),
  ]);
  const byMeeting = new Map(((meetings.data ?? []) as { id: string; status: string; summary: { summary?: string; decisions?: string[]; openQuestions?: string[] } | null }[]).map((m) => [m.id, m]));
  const titles = new Map(((positions.data ?? []) as { id: string; title: string }[]).map((p) => [p.id, p.title]));
  const text = (v: unknown) => (typeof v === "string" && v ? v : null);
  return actions.map((a) => {
    const meetingId = meetingOf(a);
    const m = meetingId ? byMeeting.get(meetingId) : undefined;
    const joinPath = text(a.meta.joinPath);
    return {
      id: a.id,
      positionId: a.positionId,
      positionTitle: a.positionId ? titles.get(a.positionId) ?? null : null,
      round: text(a.meta.round),
      at: text(a.meta.at) ?? "",
      mode: text(a.meta.mode),
      venue: text(a.meta.venue),
      interviewers: text(a.meta.interviewer),
      note: a.remark,
      meetingId,
      joinUrl: joinPath ? `${appUrl.replace(/\/$/, "")}${joinPath}` : null,
      meeting: m ? {
        status: m.status,
        summary: m.status === "ready" && m.summary ? { summary: m.summary.summary ?? "", decisions: m.summary.decisions ?? [], openQuestions: m.summary.openQuestions ?? [] } : null,
      } : meetingId ? { status: "deleted", summary: null } : null,
      byName: a.byName,
      createdAt: a.at,
    };
  });
}

export const isInterviewMode = (v: unknown): v is InterviewMode => typeof v === "string" && (INTERVIEW_MODES as readonly string[]).includes(v);

/**
 * "Record interview" on an in-person interview (owner 2026-11-19): makes its recording (a Meeting Assistant recording
 * in the HR space, not listed there) with the interviewers and the candidate as the people present, and files it under
 * the interview. A recording still going is handed back instead of starting a second one.
 */
export async function startInterviewRecording(client: SupabaseClient, orgId: string, by: Actor, body: unknown, deps: Pick<InterviewDeps, "createMeeting">): Promise<{ meetingId: string; title: string }> {
  const parsed = z.object({ interviewId: z.string().regex(UUID), candidateId: z.string().regex(UUID) }).safeParse(body ?? {});
  if (!parsed.success) throw new CandidateActionError(400, "Pick the interview to record.");
  const interviewId = parsed.data.interviewId.toLowerCase();
  const candidateId = parsed.data.candidateId.toLowerCase();
  const entry = (await listActions(client, orgId, candidateId)).find((a) => a.id === interviewId && a.action === "remark" && a.meta.kind === "interview");
  if (!entry) throw new CandidateActionError(404, "That interview is no longer there.");
  if (entry.meta.mode === "online") throw new CandidateActionError(400, "An online interview is recorded in its video call: use Join call.");
  const interview = (await listInterviews(client, orgId, candidateId, "")).find((i) => i.id === interviewId)!;
  const name = await candidateName(client, orgId, candidateId);
  const title = `Interview: ${name} · ${interview.round ?? "Interview"}${interview.positionTitle ? ` · ${interview.positionTitle}` : ""}`.slice(0, 150);
  if (interview.meetingId && interview.meeting?.status === "recording") return { meetingId: interview.meetingId, title };
  if (interview.meetingId && interview.meeting && !["failed", "deleted", "discarded"].includes(interview.meeting.status)) {
    throw new CandidateActionError(409, "This interview was already recorded. Its notes show in the Interviews tab.");
  }
  const attendeeIds = Array.isArray(entry.meta.interviewerIds) ? entry.meta.interviewerIds.filter((id): id is string => typeof id === "string") : [];
  const meeting = await deps.createMeeting(by.id, { title, attendeeIds, extraNames: [name], kind: "room" });
  await recordAction(client, orgId, by, {
    candidateId: entry.candidateId, applicationId: entry.applicationId, positionId: entry.positionId, action: "remark",
    toValue: "Interview recording started", remark: null, meta: { kind: "interview_recording", entryId: interviewId, meetingId: meeting.id },
  });
  return { meetingId: meeting.id, title };
}

async function candidateName(client: SupabaseClient, orgId: string, candidateId: string): Promise<string> {
  const { data } = await client.from("candidates").select("full_name").eq("organization_id", orgId).eq("id", candidateId).maybeSingle();
  return ((data as { full_name: string | null } | null)?.full_name ?? "Candidate").trim() || "Candidate";
}
