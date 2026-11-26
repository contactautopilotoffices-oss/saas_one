// Screening questions are for HR calls only. Historical candidate answers remain readable.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Actor } from "./actions";
import { screeningForm } from "./applications";
import type { ApplicationField } from "./outreach-settings";
import { CandidateActionError } from "./records";
import { loadRecruitmentConfig } from "./requisitions";
import { questionsFor } from "./screening-questions";
const SCREENINGS = "recruitment_screenings";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export type ScreeningSender = (o: { phone: string; campaignName: string; templateParams: string[]; userName?: string }) => Promise<{ success: boolean; error?: string; providerReference?: string }>;
export const defaultScreeningSender: ScreeningSender = async (o) => {
  const { AiSensyService } = await import("@/backend/services/AiSensyService");
  return AiSensyService.sendTemplate(o);
};

export interface ScreeningResult { status: "sent" | "failed" | "skipped"; note: string | null }
// Legacy callers cannot restart sends or reminders from an older saved configuration.
export async function startScreening(_client: SupabaseClient, _orgId: string, _by: Actor, _a: { positionId: string; candidateId: string; applicationId: string | null; memberId?: string | null }, _send?: ScreeningSender): Promise<ScreeningResult> {
  return { status: "skipped", note: "Screening questions are for internal HR use only." };
}
export async function onStageMove(_client: SupabaseClient, _orgId: string, _by: Actor, _positionId: string, _member: { id: string; candidateId: string; applicationId: string | null; stage: string }, _send?: ScreeningSender): Promise<ScreeningResult | null> { return null; }
export async function runScreeningJobs(_client: SupabaseClient, _orgId: string, _send?: ScreeningSender, _now?: Date): Promise<{ chased: number; noResponse: number }> { return { chased: 0, noResponse: 0 }; }

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
