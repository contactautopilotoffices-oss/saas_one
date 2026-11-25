/**
 * Screening (owner 2026-11-24, from the 23 Nov HR meeting; migration 20261124000003):
 *   "When a candidate moves to screening, a WhatsApp message with the screening questions should go out" — the
 *   message names the HR person, and carries the candidate's own link to HR's screening questions (Recruitment →
 *   Outreach → Screening). Their answers fill the record. No answer: a reminder at 24 h and 48 h (in working hours),
 *   then "No response" (the stage HR picked) after the time HR set.
 *   On the HR side the candidate's Calls tab shows the job description, the questions and the answers beside the call
 *   upload (option A: the call is recorded on the phone and uploaded; a calling service comes later).
 *
 * One screening per person and position. Blacklisted people get nothing. The WhatsApp sender is injected, so no test
 * sends a message.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { recordAction, type Actor } from "./actions";
import { screeningForm, screeningLink, systemActor } from "./applications";
import { markContacted } from "./audit";
import { parsePhone } from "./normalize";
import { whatsappParams, type ApplicationField, type OutreachSettings } from "./outreach-settings";
import { withinSendingHours } from "./outreach";
import { moveMember } from "./positions";
import { CandidateActionError } from "./records";
import { loadRecruitmentConfig } from "./requisitions";
import { questionsFor } from "./screening-questions";

const SCREENINGS = "recruitment_screenings";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const SCREENING_MIGRATION_MESSAGE = "Screening needs a database update first: run 20261124000003_recruitment_screening_rsvp.sql in Supabase.";
const HOUR = 3_600_000;

export type ScreeningSender = (o: { phone: string; campaignName: string; templateParams: string[]; userName?: string }) => Promise<{ success: boolean; error?: string; providerReference?: string }>;
export const defaultScreeningSender: ScreeningSender = async (o) => {
  const { AiSensyService } = await import("@/backend/services/AiSensyService");
  return AiSensyService.sendTemplate(o);
};

const missing = (error: { code?: string; message?: string } | null | undefined) =>
  Boolean(error) && (["42P01", "42703", "PGRST205", "PGRST204"].includes(error?.code ?? "") || /recruitment_screening|does not exist|schema cache/i.test(error?.message ?? "") || (error?.code === "23514" && /kind_check/.test(error?.message ?? "")));

export interface ScreeningResult { status: "sent" | "failed" | "skipped"; note: string | null }

interface PersonCtx { fullName: string; phoneKey: string | null; blacklisted: boolean; role: string | null; location: string | null }
async function context(client: SupabaseClient, orgId: string, candidateId: string, positionId: string): Promise<PersonCtx> {
  const [{ data: person }, { data: pos }] = await Promise.all([
    client.from("candidates").select("full_name, phone, blacklisted_at").eq("organization_id", orgId).eq("id", candidateId).maybeSingle(),
    client.from("candidate_positions").select("title, location").eq("organization_id", orgId).eq("id", positionId).maybeSingle(),
  ]);
  const p = person as { full_name?: string | null; phone?: string | null; blacklisted_at?: string | null } | null;
  const q = pos as { title?: string; location?: string | null } | null;
  return { fullName: (p?.full_name ?? "").trim(), phoneKey: parsePhone(p?.phone ?? "").key, blacklisted: Boolean(p?.blacklisted_at), role: q?.title ?? null, location: q?.location ?? null };
}

async function sendQuestions(settings: OutreachSettings, ctx: PersonCtx, senderName: string | null, link: string, send: ScreeningSender): Promise<{ ok: boolean; note: string | null }> {
  const t = settings.templates.find((x) => x.id === settings.screening.whatsappTemplateId && x.channel === "whatsapp");
  if (!t) return { ok: false, note: "The screening WhatsApp template is missing (Outreach → Screening)." };
  if (!ctx.phoneKey) return { ok: false, note: "No valid Indian mobile number on record." };
  const { params, gaps } = whatsappParams(t, {
    first_name: ctx.fullName.split(/\s+/)[0] || null, full_name: ctx.fullName || null, recruiter_name: senderName, company: settings.companyName,
    role: ctx.role, location: ctx.location, screening_link: link, company_profile: settings.companyProfileUrl || null,
  });
  if (gaps.length) return { ok: false, note: `Nothing to fill ${gaps.map((g) => `{{${g}}}`).join(", ")}${gaps.includes("location") ? ": give the position a location" : ""}.` };
  try {
    const r = await send({ phone: `91${ctx.phoneKey}`, campaignName: t.campaign ?? "", templateParams: params, userName: ctx.fullName || undefined });
    return r.success ? { ok: true, note: null } : { ok: false, note: `WhatsApp did not accept the message: ${(r.error ?? "unknown error").slice(0, 200)}` };
  } catch (e) {
    return { ok: false, note: `WhatsApp did not accept the message: ${e instanceof Error ? e.message.slice(0, 200) : "unknown error"}` };
  }
}

/**
 * Sends the screening questions to the person in this position, once. Called when HR moves someone to the screening
 * stage (and from the Calls tab's "Send"). Returns what happened, in words for HR; never throws for a send problem.
 */
export async function startScreening(client: SupabaseClient, orgId: string, by: Actor, a: { positionId: string; candidateId: string; applicationId: string | null; memberId?: string | null }, send: ScreeningSender = defaultScreeningSender): Promise<ScreeningResult> {
  const settings = (await loadRecruitmentConfig(client, orgId)).outreach;
  const ctx = await context(client, orgId, a.candidateId, a.positionId);
  if (ctx.blacklisted) return { status: "skipped", note: "This person is blacklisted. No message goes to them." };

  // Claim the screening first (one per person and position), so a double move sends once.
  const { data: claimed, error } = await client.from(SCREENINGS).insert({
    organization_id: orgId, candidate_id: a.candidateId, application_id: a.applicationId, position_id: a.positionId, member_id: a.memberId ?? null,
    status: "sending", sent_by: by.id ?? null, sent_by_name: by.name,
  }).select("id").single();
  if (error) {
    if ((error as { code?: string }).code === "23505") return { status: "skipped", note: "The screening questions were already sent for this position." };
    if (missing(error)) return { status: "skipped", note: SCREENING_MIGRATION_MESSAGE };
    console.error("[candidates] screening: could not start", error);
    return { status: "failed", note: "The screening could not be started. Try again." };
  }
  const id = (claimed as { id: string }).id;
  let linkUrl: string;
  try {
    const link = await screeningLink(client, orgId, { candidateId: a.candidateId, applicationId: a.applicationId, positionId: a.positionId, createdBy: by.id ?? null });
    await client.from(SCREENINGS).update({ link_id: link.id }).eq("id", id);
    linkUrl = link.url;
  } catch (e) {
    await client.from(SCREENINGS).update({ status: "failed", error: "The screening link could not be made." }).eq("id", id);
    if (e instanceof CandidateActionError && e.status === 503) return { status: "skipped", note: SCREENING_MIGRATION_MESSAGE };
    return { status: "failed", note: "The screening link could not be made. Try again." };
  }
  const sent = await sendQuestions(settings, ctx, by.name, linkUrl, send);
  const now = new Date().toISOString();
  await client.from(SCREENINGS).update(sent.ok ? { status: "sent", sent_at: now, error: null } : { status: "failed", error: sent.note }).eq("id", id);
  if (sent.ok) {
    await markContacted(client, orgId, a.candidateId);
    await recordAction(client, orgId, by, {
      candidateId: a.candidateId, applicationId: a.applicationId, positionId: a.positionId, action: "outreach_sent",
      toValue: "WhatsApp: screening questions", meta: { kind: "screening", screeningId: id, channel: "whatsapp" },
    });
  }
  return sent.ok ? { status: "sent", note: null } : { status: "failed", note: sent.note };
}

/** The screening's place in the pipeline: when someone moves to HR's screening stage, the questions go (if switched on). */
export async function onStageMove(client: SupabaseClient, orgId: string, by: Actor, positionId: string, member: { id: string; candidateId: string; applicationId: string | null; stage: string }, send?: ScreeningSender): Promise<ScreeningResult | null> {
  const settings = (await loadRecruitmentConfig(client, orgId)).outreach.screening;
  if (!settings.enabled || member.stage !== settings.stageKey) return null;
  return startScreening(client, orgId, by, { positionId, candidateId: member.candidateId, applicationId: member.applicationId, memberId: member.id }, send);
}

// The reminders job ----------------------------------------------------------------------------------------------------

/**
 * For the hourly job: each screening still waiting gets a reminder at 24 h and 48 h (in working hours), and after the
 * time HR set it is "No response" (the person moves to HR's no-response stage, if they are still at screening).
 */
export async function runScreeningJobs(client: SupabaseClient, orgId: string, send: ScreeningSender = defaultScreeningSender, now = new Date()): Promise<{ chased: number; noResponse: number }> {
  let chased = 0;
  let noResponse = 0;
  const { data, error } = await client.from(SCREENINGS).select("id, candidate_id, application_id, position_id, member_id, link_id, sent_at, sent_by, sent_by_name, chased_24_at, chased_48_at").eq("organization_id", orgId).eq("status", "sent").limit(500);
  if (error) { if (!missing(error)) console.error("[candidates] screening jobs: read failed", error); return { chased, noResponse }; }
  const settings = (await loadRecruitmentConfig(client, orgId)).outreach;
  for (const row of (data ?? []) as { id: string; candidate_id: string; application_id: string | null; position_id: string; member_id: string | null; link_id: string | null; sent_at: string; sent_by: string | null; sent_by_name: string | null; chased_24_at: string | null; chased_48_at: string | null }[]) {
    const hours = (now.getTime() - new Date(row.sent_at).getTime()) / HOUR;
    if (hours >= settings.screening.noResponseAfterHours) {
      const { data: claimed } = await client.from(SCREENINGS).update({ status: "no_response", no_response_at: now.toISOString() }).eq("id", row.id).eq("status", "sent").select("id");
      if (!(claimed ?? []).length) continue;
      noResponse += 1;
      const by = systemActor("Screening: no answer", row.sent_by);
      await recordAction(client, orgId, by, {
        candidateId: row.candidate_id, applicationId: row.application_id, positionId: row.position_id, action: "remark",
        toValue: `No answer to the screening questions in ${settings.screening.noResponseAfterHours} hours`, meta: { kind: "screening_no_response", screeningId: row.id },
      });
      if (settings.screening.noResponseStageKey && row.member_id && row.sent_by) {
        const { data: member } = await client.from("candidate_position_members").select("stage").eq("organization_id", orgId).eq("id", row.member_id).is("deleted_at", null).maybeSingle();
        if ((member as { stage?: string } | null)?.stage === settings.screening.stageKey) {
          try {
            await moveMember(client, orgId, { id: row.sent_by, name: "Automatic (no answer to screening)" }, row.position_id, row.member_id, settings.screening.noResponseStageKey, `No answer to the screening questions in ${settings.screening.noResponseAfterHours} hours.`);
          } catch (e) {
            console.error("[candidates] screening: could not move to no response", e);
          }
        }
      }
      continue;
    }
    const step = hours >= 48 && !row.chased_48_at ? "chased_48_at" : hours >= 24 && !row.chased_24_at ? "chased_24_at" : null;
    if (!step || !withinSendingHours(now) || !row.link_id) continue;
    const { data: link } = await client.from("recruitment_application_links").select("token").eq("id", row.link_id).maybeSingle();
    const token = (link as { token?: string } | null)?.token;
    if (!token) continue;
    // Stamped before the send: a reminder never goes twice, even if the send is slow.
    const { data: stamped } = await client.from(SCREENINGS).update({ [step]: now.toISOString(), ...(step === "chased_48_at" && !row.chased_24_at ? { chased_24_at: now.toISOString() } : {}) }).eq("id", row.id).is(step, null).select("id");
    if (!(stamped ?? []).length) continue;
    const ctx = await context(client, orgId, row.candidate_id, row.position_id);
    if (ctx.blacklisted) continue;
    const { applicationUrl } = await import("./applications");
    const r = await sendQuestions(settings, ctx, row.sent_by_name, applicationUrl(token), send);
    if (r.ok) chased += 1;
  }
  return { chased, noResponse };
}

/** The organisations with screenings waiting (for the hourly job). */
export async function organisationsWithScreenings(client: SupabaseClient): Promise<string[]> {
  const { data, error } = await client.from(SCREENINGS).select("organization_id").eq("status", "sent").limit(2000);
  if (error) return [];
  return [...new Set(((data ?? []) as { organization_id: string }[]).map((r) => r.organization_id))];
}

// For HR: the screening screen -------------------------------------------------------------------------------------------

export type ScreeningStatus = "sending" | "sent" | "failed" | "answered" | "no_response";
export interface ScreeningView {
  positionId: string; positionTitle: string; location: string | null; stage: string | null; jd: string | null;
  /** Owner 2026-11-25: the questions for this position (its own after the standard ones, when it has any). */
  questions?: ApplicationField[];
  screening: { id: string; status: ScreeningStatus; error: string | null; sentAt: string | null; sentByName: string | null; answeredAt: string | null; answers: Record<string, string | number | null> | null } | null;
}

/**
 * Everything HR needs on a screening call, per position the person is in: the job description, the screening status,
 * and the answers. The questions come with it (HR's current list).
 */
export async function screeningViews(client: SupabaseClient, orgId: string, candidateId: unknown): Promise<{ questions: ApplicationField[]; views: ScreeningView[] }> {
  if (typeof candidateId !== "string" || !UUID.test(candidateId)) throw new CandidateActionError(404, "That candidate no longer exists.");
  const settings = (await loadRecruitmentConfig(client, orgId)).outreach;
  const { data: members } = await client.from("candidate_position_members").select("position_id, stage").eq("organization_id", orgId).eq("candidate_id", candidateId).is("deleted_at", null);
  const ms = (members ?? []) as { position_id: string; stage: string | null }[];
  if (!ms.length) return { questions: screeningForm(settings).fields, views: [] };
  const [{ data: positions }, screenings] = await Promise.all([
    client.from("candidate_positions").select("id, title, location, summary, jd_text, screening_fields").eq("organization_id", orgId).in("id", ms.map((m) => m.position_id))
      .then((r) => (r.error ? client.from("candidate_positions").select("id, title, location, summary, jd_text").eq("organization_id", orgId).in("id", ms.map((m) => m.position_id)) : r)),
    client.from(SCREENINGS).select("id, position_id, status, error, sent_at, sent_by_name, answered_at, answers, created_at").eq("organization_id", orgId).eq("candidate_id", candidateId).order("created_at", { ascending: false }),
  ]);
  const rows = (screenings.error ? [] : (screenings.data ?? [])) as { id: string; position_id: string; status: ScreeningStatus; error: string | null; sent_at: string | null; sent_by_name: string | null; answered_at: string | null; answers: Record<string, string | number | null> | null }[];
  const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : typeof v === "string" ? v : null);
  const views = ((positions ?? []) as { id: string; title: string; location: string | null; summary: string | null; jd_text: string | null; screening_fields?: ApplicationField[] | null }[]).map((p) => {
    const s = rows.find((r) => r.position_id === p.id) ?? null;
    return {
      positionId: p.id, positionTitle: p.title, location: p.location, stage: ms.find((m) => m.position_id === p.id)?.stage ?? null,
      jd: [p.summary, p.jd_text].filter((x): x is string => Boolean(x && x.trim())).join("\n\n").slice(0, 20_000) || null,
      // Owner 2026-11-25: this position's questions (its own after the standard ones, when it has any).
      questions: questionsFor(settings, Array.isArray(p.screening_fields) && p.screening_fields.length ? p.screening_fields : null),
      screening: s ? { id: s.id, status: s.status, error: s.error, sentAt: iso(s.sent_at), sentByName: s.sent_by_name, answeredAt: iso(s.answered_at), answers: s.answers } : null,
    };
  });
  return { questions: screeningForm(settings).fields, views };
}
