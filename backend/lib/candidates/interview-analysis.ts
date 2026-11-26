import { hasInterviewConsent } from './interview-consent';
/**
 * Links completed Recruitment interviews (`meeting_notes` with `purpose = 'interview'`) into `call_analyses`
 * so every recorded video or in-person interview automatically gets Call Insights: sentiment, interest,
 * topic-by-topic answer evaluation, not-covered must-haves, next-round questions, concerns, red flags, and facts.
 */
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

import { CALLS_TABLE, isStale, runCallAnalysis, type CallAudioStorage, type PipelineDeps } from "@/backend/lib/callInsights/pipeline";
import { CALL_TRANSCRIPT_MAX_CHARS } from "./config";

const NO_AUDIO_STORAGE: CallAudioStorage = {
  download: async () => ({ data: null, error: { message: "Interview analyses read the meeting transcript directly." } }),
};
import type { CallAnalysis, CallInsights, CallRound, CallSegment, InterviewAnalysis } from "./types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STALE_MESSAGE = "The analysis was cut off before it finished. Retry it.";

let meetingMissingAt = 0;
let roundMissingAt = 0;
const RECHECK_MS = 5 * 60 * 1000;
export const meetingLinkKnownMissing = () => Date.now() - meetingMissingAt < RECHECK_MS;
const meetingLinkError = (error: { code?: string; message?: string } | null | undefined) =>
  Boolean(error) && (/meeting_id/.test(error?.message ?? "") || ["42703", "PGRST204"].includes(error?.code ?? "") && /meeting_id/.test(error?.message ?? ""));
const roundError = (error: { message?: string } | null | undefined) => Boolean(error) && /call_round/.test(error?.message ?? "");

/** Tests only. */
export function resetInterviewAnalysisChecks(): void {
  meetingMissingAt = 0;
  roundMissingAt = 0;
}

/** Maps a Recruitment interview round label (e.g. "L1", "Round 2", "HR") onto `call_analyses.call_round`. */
export function mapInterviewRoundToCallRound(round: string | null | undefined): CallRound {
  const s = (round ?? "").trim();
  if (/screen/i.test(s)) return "screening";
  if (/\b(hr|offer|salary|final)\b/i.test(s)) return "hr_offer";
  if (/\b(l3|round\s*3|director)\b/i.test(s)) return "round_3";
  if (/\b(l2|round\s*2)\b/i.test(s)) return "round_2";
  return "round_1";
}

/** Converts `meeting_notes.transcript` lines (`{ speaker, start, end, text }`) into Call Insights segments + text. */
export function segmentsFromMeetingTranscript(lines: unknown): { segments: CallSegment[]; text: string } {
  if (!Array.isArray(lines)) return { segments: [], text: "" };
  const segments: CallSegment[] = [];
  for (const raw of lines) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as { speaker?: unknown; start?: unknown; end?: unknown; text?: unknown };
    const cleanText = typeof item.text === "string" ? item.text.replace(/\s+/g, " ").trim() : "";
    if (!cleanText) continue;
    const speaker = typeof item.speaker === "string" ? item.speaker.replace(/\s+/g, " ").trim() : "";
    const start = typeof item.start === "number" && Number.isFinite(item.start) ? Math.max(0, item.start) : 0;
    const end = typeof item.end === "number" && Number.isFinite(item.end) ? Math.max(start, item.end) : start;
    segments.push({ start, end, text: speaker ? `${speaker}: ${cleanText}` : cleanText });
  }
  const text = segments.map((s) => s.text).join("\n").slice(0, CALL_TRANSCRIPT_MAX_CHARS);
  return { segments, text };
}

interface AnalysisRow {
  id: string;
  meeting_id: string;
  call_round?: CallRound | null;
  status: CallAnalysis["status"];
  error: string | null;
  language: string | null;
  duration_seconds: number | null;
  result: CallInsights | null;
  applied_facts: CallAnalysis["appliedFacts"] | null;
  model: string | null;
  tokens_in: number | null;
  tokens_out: number | null;
  updated_at: string | Date;
}

/** Loads interview analyses keyed by `meeting_id`. Returns an empty map before the `meeting_id` migration runs. */
export async function loadInterviewAnalyses(
  client: SupabaseClient,
  orgId: string,
  candidateId: string,
  meetingIds: string[],
  now = new Date(),
): Promise<Map<string, InterviewAnalysis>> {
  const out = new Map<string, InterviewAnalysis>();
  const valid = [...new Set(meetingIds.filter((id) => UUID.test(id)))];
  if (!valid.length || meetingLinkKnownMissing()) return out;

  const baseCols = "id, meeting_id, status, error, language, duration_seconds, result, applied_facts, model, tokens_in, tokens_out, updated_at";
  const cols = Date.now() - roundMissingAt < RECHECK_MS ? baseCols : `${baseCols}, call_round`;
  const read = (selectCols: string) => client
    .from(CALLS_TABLE)
    .select(selectCols)
    .eq("organization_id", orgId)
    .eq("candidate_id", candidateId)
    .in("meeting_id", valid)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  let { data, error } = await read(cols);
  if (roundError(error)) {
    roundMissingAt = Date.now();
    ({ data, error } = await read(baseCols));
  }
  if (meetingLinkError(error)) {
    meetingMissingAt = Date.now();
    return out;
  }
  if (error) {
    console.warn("[candidates] could not load interview analyses:", error.message);
    return out;
  }
  for (const row of (data ?? []) as unknown as AnalysisRow[]) {
    if (!row.meeting_id || out.has(row.meeting_id)) continue;
    const stale = isStale(row.status, row.updated_at, now);
    out.set(row.meeting_id, {
      id: row.id,
      round: row.call_round ?? null,
      status: stale ? "failed" : row.status,
      error: stale ? STALE_MESSAGE : row.error ?? null,
      language: row.language ?? null,
      durationSeconds: row.duration_seconds ?? null,
      result: row.result ?? null,
      appliedFacts: Array.isArray(row.applied_facts) ? row.applied_facts : [],
      model: row.model ?? null,
      tokensIn: row.tokens_in ?? null,
      tokensOut: row.tokens_out ?? null,
    });
  }
  return out;
}

interface ActionRow {
  id: string;
  organization_id: string;
  candidate_id: string;
  application_id: string | null;
  position_id: string | null;
  created_by: string | null;
  created_by_name: string | null;
  meta: Record<string, unknown> | null;
}

async function interviewContextForMeeting(client: SupabaseClient, meetingId: string, orgId?: string) {
  const query = (kind: string) => {
    let q = client.from("candidate_actions")
      .select("id, organization_id, candidate_id, application_id, position_id, created_by, created_by_name, meta")
      .eq("action", "remark")
      .contains("meta", { kind, meetingId })
      .order("created_at", { ascending: false })
      .limit(1);
    if (orgId) q = q.eq("organization_id", orgId);
    return q.maybeSingle();
  };
  const direct = (await query("interview")).data as ActionRow | null;
  if (direct) return { action: direct, round: typeof direct.meta?.round === "string" ? direct.meta.round : null, at: typeof direct.meta?.at === "string" ? direct.meta.at : null, mode: typeof direct.meta?.mode === "string" ? direct.meta.mode : "online" };
  const rec = (await query("interview_recording")).data as ActionRow | null;
  if (!rec) return null;
  const entryId = typeof rec.meta?.entryId === "string" ? rec.meta.entryId : null;
  const parent = entryId
    ? ((await client.from("candidate_actions").select("meta").eq("id", entryId).maybeSingle()).data as { meta?: Record<string, unknown> } | null)
    : null;
  return {
    action: rec,
    round: typeof parent?.meta?.round === "string" ? parent.meta.round : null,
    at: typeof parent?.meta?.at === "string" ? parent.meta.at : null,
    mode: typeof parent?.meta?.mode === "string" ? parent.meta.mode : "in_person",
  };
}

/**
 * Ensures a completed Recruitment interview (`meeting_notes.purpose = 'interview'`) has a `call_analyses` row and
 * runs the Call Insights analyzer on its transcript. Safe and idempotent across concurrent callers.
 */
export async function ensureInterviewAnalysis(
  client: SupabaseClient,
  meetingId: string,
  opts: { orgId?: string; retry?: boolean; pipeline?: PipelineDeps; now?: () => Date } = {},
): Promise<{ id: string; status: string } | null> {
  if (!UUID.test(meetingId) || meetingLinkKnownMissing()) return null;
  const now = opts.now ?? (() => new Date());

  const { data: meeting, error: mErr } = await client
    .from("meeting_notes")
    .select("id, purpose, status, transcript, duration_seconds, stt, meeting_date")
    .eq("id", meetingId)
    .maybeSingle();
  if (mErr || !meeting) return null;
  const m = meeting as {
    id: string;
    purpose?: string | null;
    status: string;
    transcript?: unknown;
    duration_seconds?: number | null;
    stt?: Record<string, unknown> | null;
    meeting_date?: string | null;
  };
  if (m.purpose !== "interview" || m.status !== "ready") return null;

  const ctx = await interviewContextForMeeting(client, meetingId, opts.orgId);
  if (!ctx) return null;
  const { action, round, at, mode } = ctx;
  const confirmed = await hasInterviewConsent(client, action.organization_id, action.candidate_id, meetingId);
  if (!confirmed) return null;
  const { segments, text } = segmentsFromMeetingTranscript(m.transcript);
  if (!segments.length || !text) return null;

  const findExisting = () => client
    .from(CALLS_TABLE)
    .select("id, organization_id, candidate_id, status, updated_at")
    .eq("meeting_id", meetingId)
    .is("deleted_at", null)
    .maybeSingle();

  const existingRes = await findExisting();
  if (meetingLinkError(existingRes.error)) {
    meetingMissingAt = Date.now();
    return null;
  }
  const existing = existingRes.data as { id: string; organization_id: string; candidate_id: string; status: string; updated_at: string } | null;
  if (existing) {
    if (existing.organization_id !== action.organization_id || existing.candidate_id !== action.candidate_id) return null;
    const stale = isStale(existing.status, existing.updated_at, now());
    if (existing.status === "done") return { id: existing.id, status: "done" };
    if (!opts.retry && !stale && ["uploaded", "transcribing", "analysing"].includes(existing.status)) {
      return { id: existing.id, status: existing.status };
    }
    if (opts.retry || stale || existing.status === "failed") {
      await client
        .from(CALLS_TABLE)
        .update({ status: "uploaded", consent_confirmed: confirmed, error: null, transcript_text: text, segments, updated_at: now().toISOString() })
        .eq("id", existing.id)
        .eq("organization_id", existing.organization_id);
      const outcome = await runCallAnalysis(client, NO_AUDIO_STORAGE, existing.organization_id, existing.id, opts.pipeline);
      return { id: existing.id, status: outcome.status === "done" ? "done" : outcome.status === "failed" ? "failed" : existing.status };
    }
    return { id: existing.id, status: existing.status };
  }

  const calledOnRaw = at ?? m.meeting_date ?? null;
  const calledOn = typeof calledOnRaw === "string" && /^\d{4}-\d{2}-\d{2}/.test(calledOnRaw) ? calledOnRaw.slice(0, 10) : null;
  const fileName = `${mode === "in_person" ? "In-person interview" : "Video interview"}${round ? ` · ${round}` : ""}`;
  const provider = typeof m.stt?.provider === "string" ? m.stt.provider : null;
  const ts = now().toISOString();
  const id = randomUUID();
  const callRound = mapInterviewRoundToCallRound(round);

  const row: Record<string, unknown> = {
    id,
    organization_id: action.organization_id,
    subject_type: "candidate",
    candidate_id: action.candidate_id,
    application_id: action.application_id,
    position_id: action.position_id,
    input_kind: "transcript",
    file_name: fileName.slice(0, 255),
    called_on: calledOn,
    consent_confirmed: confirmed,
    status: "uploaded",
    transcript_text: text,
    segments,
    duration_seconds: typeof m.duration_seconds === "number" ? m.duration_seconds : null,
    transcribe_model: provider,
    meeting_id: meetingId,
    created_by: action.created_by,
    created_by_name: action.created_by_name,
    created_at: ts,
    updated_at: ts,
    ...(Date.now() - roundMissingAt >= RECHECK_MS ? { call_round: callRound } : {}),
  };

  let { error: insErr } = await client.from(CALLS_TABLE).insert(row);
  if (roundError(insErr)) {
    roundMissingAt = Date.now();
    const { call_round: _drop, ...withoutRound } = row;
    void _drop;
    ({ error: insErr } = await client.from(CALLS_TABLE).insert(withoutRound));
  }
  if (meetingLinkError(insErr)) {
    meetingMissingAt = Date.now();
    return null;
  }
  if (insErr?.code === "23505") {
    const raced = (await findExisting()).data as { id: string; status: string } | null;
    return raced ? { id: raced.id, status: raced.status } : null;
  }
  if (insErr) {
    console.warn("[candidates] could not queue interview analysis:", insErr.message);
    return null;
  }

  const outcome = await runCallAnalysis(client, NO_AUDIO_STORAGE, action.organization_id, id, opts.pipeline);
  return { id, status: outcome.status === "done" ? "done" : outcome.status === "failed" ? "failed" : "uploaded" };
}
