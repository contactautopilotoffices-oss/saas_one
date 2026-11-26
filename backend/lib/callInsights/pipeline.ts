import { callMayRun } from '@/backend/lib/candidates/interview-consent';
/**
 * Call Insights, the pipeline (owner 2026-11-16, plan P3 + P7): one uploaded call from 'uploaded' to 'done'.
 *
 *   claim -> (audio only) download + transcribe -> read the call -> save the result
 *
 * A WORKFLOW, not an agent (doctrine L1): the pathway is known ahead of time and has few edge cases. One structured
 * model call, no tools. Idempotent: the row is claimed with a conditional update, so two runs of the same call (the
 * confirm route and a retry, say) cannot both work on it; a run that died leaves the row at transcribing / analysing,
 * which the screens show as failed after CALL_STALE_MINUTES and a retry claims again. Everything the model writes is
 * advisory: the pipeline never touches the candidate's record or status.
 *
 * Telemetry (doctrine L14): withAgentRun around the two steps, with the tokens the provider reported; a failure is
 * recorded as a failed run. The recorder can never change the outcome (instrument.ts).
 *
 * Agent Spec: docs/agents/call-insights-spec.md.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { CALL_ANALYSE_MAX_CHARS, CALL_STALE_MINUTES } from "@/backend/lib/candidates/config";
import { getPosition } from "@/backend/lib/candidates/positions";
import type { CallRound, CallSegment } from "@/backend/lib/candidates/types";

import { analyseCandidateCall, type Analysed } from "./analyse";
import type { ScreeningContext } from "./contexts/candidateScreening";
import { stampedTranscript, transcribeCall, type CallTranscript } from "./transcribe";

export const CALLS_TABLE = "call_analyses";
export const AGENT_KEY = "call_insights";

/** The slice of storage.from(CALL_BUCKET) the pipeline uses; the tests pass a fake. */
export interface CallAudioStorage {
  download(path: string): Promise<{ data: Blob | null; error: { message: string } | null }>;
}

/** The run recorder (backend/lib/agents/instrument.ts); loaded on first use so the tests can pass a quiet one. */
type WithRun = typeof import("@/backend/lib/agents/instrument").withAgentRun;

export interface PipelineDeps {
  transcribe?: (file: { name: string; mimeType: string; bytes: Buffer }) => Promise<CallTranscript>;
  analyse?: (ctx: ScreeningContext) => Promise<Analysed>;
  withRun?: WithRun;
  now?: () => Date;
}

export type PipelineOutcome = { status: "done" } | { status: "failed"; error: string } | { status: "skipped"; why: string };

interface WorkRow {
  id: string;
  candidate_id: string | null;
  application_id: string | null;
  position_id: string | null;
  input_kind: "audio" | "transcript";
  file_name: string | null;
  file_type: string | null;
  storage_path: string | null;
  status: string;
  transcript_text: string | null;
  segments: CallSegment[] | null;
  updated_at: string | Date;
  /** Absent before migration 20261117000001 (the call is then read as a screening call). */
  call_round?: CallRound | null;
}

const WORK_COLUMNS = "id, candidate_id, application_id, position_id, input_kind, file_name, file_type, storage_path, status, transcript_text, segments, updated_at";

/** A step gave up: the message is what HR reads on the call. */
class CallFailure extends Error {}

/** A working status older than CALL_STALE_MINUTES: the run that owned it is gone. */
export function isStale(status: string, updatedAt: string | Date, now = new Date()): boolean {
  if (status !== "transcribing" && status !== "analysing") return false;
  const at = updatedAt instanceof Date ? updatedAt.getTime() : new Date(updatedAt).getTime();
  return Number.isFinite(at) && now.getTime() - at > CALL_STALE_MINUTES * 60_000;
}

/** Runs the pipeline on one call. Never throws: the outcome says what happened, and the row says it too. */
export async function runCallAnalysis(client: SupabaseClient, storage: CallAudioStorage, orgId: string, callId: string, deps: PipelineDeps = {}): Promise<PipelineOutcome> {
  const now = deps.now ?? (() => new Date());
  const read = (columns: string) => client.from(CALLS_TABLE).select(columns).eq("organization_id", orgId).eq("id", callId).is("deleted_at", null).maybeSingle();
  // Owner 2026-11-17: the round decides which prompt reads the call; before its migration every call is a screening call.
  let { data, error } = await read(`${WORK_COLUMNS}, call_round`);
  if (error && /call_round/.test(error.message ?? "")) ({ data, error } = await read(WORK_COLUMNS));
  if (error) return { status: "skipped", why: `could not read the call: ${error.message}` };
  const row = data as unknown as WorkRow | null;
  if (!row) return { status: "skipped", why: "no such call" };
  if (row.status === "done" || row.status === "uploading") return { status: "skipped", why: `the call is ${row.status}` };
  if ((row.status === "transcribing" || row.status === "analysing") && !isStale(row.status, row.updated_at, now())) {
    return { status: "skipped", why: "another run is working on it" };
  }

  if (!await callMayRun(client, orgId, callId, row.candidate_id)) return { status: "skipped", why: "Interview analysis consent is missing" };

  // Claim it: only the run whose conditional update lands owns the row from here.
  const hasTranscript = Boolean(row.transcript_text?.trim());
  const first = hasTranscript ? "analysing" : "transcribing";
  const { data: claimed, error: claimErr } = await client
    .from(CALLS_TABLE)
    .update({ status: first, error: null, updated_at: now().toISOString() })
    .eq("id", row.id)
    .eq("organization_id", orgId)
    .eq("status", row.status)
    .select("id, attempts");
  if (claimErr || !claimed?.length) return { status: "skipped", why: "another run claimed it first" };
  const attempts = Number((claimed[0] as { attempts?: unknown }).attempts) || 0;
  await client.from(CALLS_TABLE).update({ attempts: attempts + 1 }).eq("id", row.id).eq("organization_id", orgId);

  const save = (values: Record<string, unknown>) =>
    client.from(CALLS_TABLE).update({ ...values, updated_at: now().toISOString() }).eq("id", row.id).eq("organization_id", orgId);

  try {
    const withRun = deps.withRun ?? (await import("@/backend/lib/agents/instrument")).withAgentRun;
    await withRun(
      { orgId, agentKey: AGENT_KEY, module: null, trigger: "manual" },
      async (step) => {
        let segments = row.segments;
        let text = row.transcript_text;

        if (!hasTranscript) {
          const s = await step("Transcribing the recording", "tool", { fileType: row.file_type, kind: row.input_kind });
          const giveUp = async (why: string): Promise<never> => {
            await s.fail(why);
            throw new CallFailure(why);
          };
          if (row.input_kind !== "audio" || !row.storage_path) await giveUp("There is no recording and no transcript on this call.");
          const { data: blob, error: dlErr } = await storage.download(row.storage_path as string);
          if (dlErr || !blob) await giveUp("The recording could not be read from storage. Upload it again.");
          const file = blob as Blob;
          const bytes = Buffer.from(await file.arrayBuffer());
          const transcribe = deps.transcribe ?? ((f) => transcribeCall(f));
          const t = await transcribe({ name: row.file_name ?? "call", mimeType: row.file_type ?? file.type ?? "audio/mpeg", bytes });
          if (!t.ok) await giveUp(t.error);
          const got = t as Extract<CallTranscript, { ok: true }>;
          segments = got.segments;
          text = got.text;
          await s.ok({ detail: { segments: got.segments.length, model: got.model, seconds: got.durationSeconds } });
          const { error: saveErr } = await save({ transcript_text: got.text, segments: got.segments, duration_seconds: got.durationSeconds, transcribe_model: got.model, status: "analysing" });
          if (saveErr) throw new CallFailure("The transcript could not be saved. Retry.");
        }

        const s2 = await step("Reading the call", "llm");
        const ctx = await screeningContext(client, orgId, row, stampedTranscript(segments ?? null, text, CALL_ANALYSE_MAX_CHARS));
        let analysed: Analysed;
        try {
          analysed = await (deps.analyse ?? analyseCandidateCall)(ctx);
        } catch (err) {
          const why = (err instanceof Error ? err.message : String(err)).slice(0, 200);
          await s2.fail(why);
          throw new CallFailure(`The call could not be read: ${why}. Retry in a minute.`);
        }
        await s2.ok({ detail: { model: analysed.model, sentiment: analysed.result.overallSentiment }, tokens_in: analysed.usage?.input ?? null, tokens_out: analysed.usage?.output ?? null });
        const { error: doneErr } = await save({
          status: "done",
          error: null,
          result: analysed.result,
          model: analysed.model,
          tokens_in: analysed.usage?.input ?? null,
          tokens_out: analysed.usage?.output ?? null,
          language: analysed.result.language || null,
        });
        if (doneErr) throw new CallFailure("The result could not be saved. Retry.");
        return {
          outcome: `${analysed.result.overallSentiment}, interest ${analysed.result.interestLevel}`,
          entityRef: row.id,
          tokensIn: analysed.usage?.input ?? null,
          tokensOut: analysed.usage?.output ?? null,
        };
      },
    );
    return { status: "done" };
  } catch (err) {
    const message = err instanceof CallFailure ? err.message : `Something went wrong: ${(err instanceof Error ? err.message : String(err)).slice(0, 200)}. Retry.`;
    await save({ status: "failed", error: message.slice(0, 500) });
    return { status: "failed", error: message };
  }
}

/** What the model is told about the person and the position. Missing pieces are "not on record", never invented. */
async function screeningContext(client: SupabaseClient, orgId: string, row: WorkRow, transcript: string): Promise<ScreeningContext> {
  let candidate: ScreeningContext["candidate"] = { name: "the candidate", designation: null, organization: null, location: null, currentInhand: null, expectedInhand: null, noticePeriodDays: null };
  if (row.candidate_id) {
    const { data: person } = await client.from("candidates").select("full_name, current_designation, current_organization, location").eq("organization_id", orgId).eq("id", row.candidate_id).maybeSingle();
    const { data: app } = row.application_id
      ? await client.from("candidate_applications").select("current_inhand, expected_inhand, notice_period_days").eq("organization_id", orgId).eq("id", row.application_id).maybeSingle()
      : { data: null };
    const p = (person ?? {}) as Record<string, unknown>;
    const a = (app ?? {}) as Record<string, unknown>;
    const num = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : null);
    candidate = {
      name: (p.full_name as string) || "the candidate",
      designation: (p.current_designation as string | null) ?? null,
      organization: (p.current_organization as string | null) ?? null,
      location: (p.location as string | null) ?? null,
      currentInhand: num(a.current_inhand),
      expectedInhand: num(a.expected_inhand),
      noticePeriodDays: num(a.notice_period_days),
    };
  }
  let position: ScreeningContext["position"] = null;
  if (row.position_id) {
    try {
      const p = await getPosition(client, orgId, row.position_id);
      const mustHaves = (p.filters.keywords ?? []).filter((k) => k.required).map((k) => [k.text, ...(k.alts ?? [])].join(" / "));
      position = { title: p.title, location: p.location, jdText: p.jdText ?? null, mustHaves };
    } catch {
      position = null;
    }
  }
  return { candidate, position, round: row.call_round ?? null, transcript };
}
