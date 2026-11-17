/**
 * A candidate's calls (owner 2026-11-16, plan P3; migration 20261116000001, table call_analyses).
 *
 * The recruiter calls on a normal phone and records it. On the candidate's panel they upload the recording (the
 * browser sends the bytes straight to the private bucket with a one-time link, like resumes) or paste a transcript.
 * The pipeline (backend/lib/callInsights/pipeline.ts) transcribes and reads it; HR then sees the sentiment, the
 * concerns and the facts heard, each with a quote, and clicks "Apply" on a fact to put it on the record. Nothing on
 * the record changes by itself, and no status ever changes from a call.
 *
 * Every upload is a `call_logged` entry in the candidate's history; every applied fact a `field_edit` from the call.
 * Access is the caller's job (requireCandidateAccess); everything here runs with the service role.
 */
import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { CALLS_TABLE, isStale } from "@/backend/lib/callInsights/pipeline";

import { recordAction, type Actor } from "./actions";
import { callFileExtension, callFileType } from "./call-files";
import { CALL_BUCKET, CALL_LINK_SECONDS, CALL_LIST_LIMIT, CALL_TRANSCRIPT_MAX_CHARS, CALL_TRANSCRIPT_MIN_CHARS, MAX_CALL_BYTES } from "./config";
import { CandidateActionError, getRecord, updateRecord } from "./records";
import { CALL_FACT_KEYS, CALL_FACT_LABELS, CALL_ROUND_LABELS, CALL_ROUNDS, type CallAnalysis, type CallRound, type CallFactKey, type CallInsights, type CallSegment, type CandidateRecord, type PreparedCall } from "./types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const CALLS_MIGRATION_MESSAGE = "This needs a database update first: run 20261116000001_call_analyses.sql in Supabase.";
const STALE_MESSAGE = "The analysis was cut off before it finished. Retry it.";

type StorageResult<T> = Promise<{ data: T | null; error: { message: string } | null }>;

/** The slice of storage.from(CALL_BUCKET) this module uses; the tests pass a fake. */
export interface CallStorage {
  createSignedUploadUrl(path: string, options?: { upsert: boolean }): StorageResult<{ signedUrl: string; token: string; path: string }>;
  createSignedUrl(path: string, expiresIn: number, options?: { download?: string | boolean }): StorageResult<{ signedUrl: string }>;
  list(path?: string, options?: { search?: string; limit?: number }): StorageResult<{ name: string; metadata: Record<string, unknown> | null }[]>;
  remove(paths: string[]): StorageResult<unknown>;
  download(path: string): StorageResult<Blob>;
}

export function callStorage(client: SupabaseClient): CallStorage {
  return client.storage.from(CALL_BUCKET);
}

interface CallRow {
  id: string;
  candidate_id: string;
  application_id: string | null;
  position_id: string | null;
  input_kind: "audio" | "transcript";
  file_name: string | null;
  file_type: string | null;
  file_size: number | string | null;
  storage_path: string | null;
  called_on: string | Date | null;
  consent_confirmed: boolean;
  status: CallAnalysis["status"];
  error: string | null;
  attempts: number;
  language: string | null;
  duration_seconds: number | null;
  result: CallInsights | null;
  model: string | null;
  tokens_in: number | null;
  tokens_out: number | null;
  applied_facts: CallAnalysis["appliedFacts"] | null;
  created_by_name: string | null;
  created_at: string | Date;
  updated_at: string | Date;
  transcript_text?: string | null;
  segments?: CallSegment[] | null;
  /** Absent before migration 20261117000001. */
  call_round?: CallRound | null;
}

const COLUMNS =
  "id, candidate_id, application_id, position_id, input_kind, file_name, file_type, file_size, storage_path, called_on, consent_confirmed, status, error, attempts, " +
  "language, duration_seconds, result, model, tokens_in, tokens_out, applied_facts, created_by_name, created_at, updated_at";
const FULL_COLUMNS = `${COLUMNS}, transcript_text, segments`;

/**
 * The round column (owner 2026-11-17, migration 20261117000001). Until it is applied, reads and writes go on without
 * it: every read asks for it, and an error naming it is retried once without (remembered for a few minutes).
 */
let roundMissingAt = 0;
const ROUND_RECHECK_MS = 5 * 60 * 1000;
const roundKnownMissing = () => Date.now() - roundMissingAt < ROUND_RECHECK_MS;
const roundError = (error: { message?: string } | null | undefined) => Boolean(error) && /call_round/.test(error?.message ?? "");
const withRound = (columns: string) => (roundKnownMissing() ? columns : `${columns}, call_round`);
/** Tests only. */
export function resetRoundCheck(): void {
  roundMissingAt = 0;
}

function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return typeof value === "string" ? value : "";
}

/** A date column: "2026-11-16" from PostgREST, a Date from PGlite. */
function isoDate(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return typeof value === "string" && value ? value.slice(0, 10) : null;
}

function migrationMissing(error: { code?: string; message?: string } | null | undefined): boolean {
  const code = error?.code ?? "";
  return ["42P01", "42703", "PGRST204", "PGRST205"].includes(code) || /call_analyses.*does not exist|schema cache/i.test(error?.message ?? "");
}

function fail(context: string, error: unknown): never {
  if (migrationMissing(error as { code?: string } | null)) {
    console.error(`[candidates] ${context}: migration 20261116000001 not applied`, error);
    throw new CandidateActionError(503, CALLS_MIGRATION_MESSAGE);
  }
  console.error(`[candidates] ${context}`, error);
  throw new CandidateActionError(500, `Couldn't ${context}. Please try again.`);
}

/**
 * The row in the app's shape. A call left at transcribing / analysing for too long (the run died) is shown as failed
 * with a retry; the row itself is not changed on a read.
 */
function toCall(row: CallRow, positions: Map<string, string>, now: Date): CallAnalysis {
  const stale = isStale(row.status, row.updated_at, now);
  return {
    id: row.id,
    candidateId: row.candidate_id,
    applicationId: row.application_id ?? null,
    positionId: row.position_id ?? null,
    positionTitle: row.position_id ? positions.get(row.position_id) ?? null : null,
    round: row.call_round ?? null,
    inputKind: row.input_kind,
    fileName: row.file_name ?? null,
    fileSize: row.file_size === null || row.file_size === undefined ? null : Number(row.file_size) || 0,
    calledOn: isoDate(row.called_on),
    consentConfirmed: Boolean(row.consent_confirmed),
    status: stale ? "failed" : row.status,
    error: stale ? STALE_MESSAGE : row.error ?? null,
    attempts: Number(row.attempts) || 0,
    language: row.language ?? null,
    durationSeconds: row.duration_seconds ?? null,
    ...(row.segments !== undefined ? { segments: row.segments ?? null } : {}),
    ...(row.transcript_text !== undefined ? { transcriptText: row.transcript_text ?? null } : {}),
    result: row.result ?? null,
    model: row.model ?? null,
    tokensIn: row.tokens_in ?? null,
    tokensOut: row.tokens_out ?? null,
    appliedFacts: Array.isArray(row.applied_facts) ? row.applied_facts : [],
    byName: row.created_by_name ?? null,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

/** The titles of these positions (a closed or deleted one still shows its title on an old call). */
async function positionTitles(client: SupabaseClient, orgId: string, ids: (string | null)[]): Promise<Map<string, string>> {
  const wanted = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  const titles = new Map<string, string>();
  if (!wanted.length) return titles;
  const { data } = await client.from("candidate_positions").select("id, title").eq("organization_id", orgId).in("id", wanted);
  for (const row of (data ?? []) as { id: string; title: string }[]) titles.set(row.id, row.title);
  return titles;
}

async function loadRow(client: SupabaseClient, orgId: string, id: string, columns = COLUMNS): Promise<CallRow> {
  if (!UUID.test(id)) throw new CandidateActionError(404, "That call no longer exists.");
  const read = (cols: string) => client.from(CALLS_TABLE).select(cols).eq("organization_id", orgId).eq("id", id).is("deleted_at", null).maybeSingle();
  let { data, error } = await read(withRound(columns));
  if (roundError(error)) { roundMissingAt = Date.now(); ({ data, error } = await read(columns)); }
  if (error) fail("load the call", error);
  if (!data) throw new CandidateActionError(404, "That call no longer exists.");
  return data as unknown as CallRow;
}

/** The candidate's calls, newest first (without transcripts). */
export async function listCalls(client: SupabaseClient, orgId: string, candidateId: string, now = new Date()): Promise<CallAnalysis[]> {
  const read = (cols: string) => client
    .from(CALLS_TABLE)
    .select(cols)
    .eq("organization_id", orgId)
    .eq("candidate_id", candidateId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(CALL_LIST_LIMIT);
  let { data, error } = await read(withRound(COLUMNS));
  if (roundError(error)) { roundMissingAt = Date.now(); ({ data, error } = await read(COLUMNS)); }
  if (error) fail("load the calls", error);
  const rows = (data ?? []) as unknown as CallRow[];
  const titles = await positionTitles(client, orgId, rows.map((r) => r.position_id));
  return rows.map((row) => toCall(row, titles, now));
}

/** One call with its transcript. */
export async function getCall(client: SupabaseClient, orgId: string, id: string, now = new Date()): Promise<CallAnalysis> {
  const row = await loadRow(client, orgId, id, FULL_COLUMNS);
  return toCall(row, await positionTitles(client, orgId, [row.position_id]), now);
}

// Adding a call --------------------------------------------------------------------------------------------------------

const PrepareInput = z.object({
  applicationId: z.string().regex(UUID),
  positionId: z.string().regex(UUID).nullish(),
  calledOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  consent: z.boolean().optional(),
  file: z.object({ name: z.string().trim().min(1).max(255), size: z.number().int().min(1) }).optional(),
  transcript: z.string().max(CALL_TRANSCRIPT_MAX_CHARS * 4).optional(),
  /** Owner 2026-11-17: which round the call was for (the screen fills it in from the stage in the position). */
  round: z.enum(CALL_ROUNDS).nullish(),
});

/**
 * Starts a call: with `file`, a row at 'uploading' and the one-time link the browser sends the bytes to (then
 * confirmCall); with `transcript`, a row at 'uploaded' ready for the pipeline. A recording needs the consent tick.
 */
export async function prepareCall(client: SupabaseClient, storage: CallStorage, orgId: string, by: Actor, input: unknown): Promise<PreparedCall> {
  const parsed = PrepareInput.safeParse(input ?? {});
  if (!parsed.success) throw new CandidateActionError(400, "Send the record (applicationId) and either a file (name, size) or a transcript.");
  const { applicationId, positionId, calledOn, consent, file, transcript, round } = parsed.data;
  if (!file && transcript === undefined) throw new CandidateActionError(400, "Choose a recording or paste the transcript.");

  const record = await getRecord(client, orgId, applicationId);
  let position: { id: string; title: string } | null = null;
  if (positionId) {
    const { data, error } = await client.from("candidate_positions").select("id, title").eq("organization_id", orgId).eq("id", positionId).is("deleted_at", null).maybeSingle();
    if (error) fail("check the position", error);
    if (!data) throw new CandidateActionError(400, "That position no longer exists.");
    position = data as { id: string; title: string };
  }

  const now = new Date().toISOString();
  const id = randomUUID();
  const base = {
    id,
    organization_id: orgId,
    subject_type: "candidate",
    candidate_id: record.candidateId,
    application_id: record.id,
    position_id: position?.id ?? null,
    called_on: calledOn ?? null,
    consent_confirmed: consent === true,
    created_by: by.id,
    created_by_name: by.name,
    created_at: now,
    updated_at: now,
    ...(round && !roundKnownMissing() ? { call_round: round } : {}),
  };
  /** The insert, again without the round when its column is not there yet (migration 20261117000001). */
  const insert = async (values: Record<string, unknown>) => {
    let { error } = await client.from(CALLS_TABLE).insert(values);
    if (roundError(error)) {
      roundMissingAt = Date.now();
      const { call_round: _dropped, ...rest } = values;
      void _dropped;
      ({ error } = await client.from(CALLS_TABLE).insert(rest));
    }
    return { error };
  };

  if (file) {
    const contentType = callFileType(file.name);
    if (!contentType) throw new CandidateActionError(400, "That is not a recording we can read. Use mp3, m4a, wav, ogg or webm.");
    if (file.size > MAX_CALL_BYTES) throw new CandidateActionError(400, `The recording is larger than ${MAX_CALL_BYTES / 1024 / 1024} MB. Export it at a lower quality and try again.`);
    if (consent !== true) throw new CandidateActionError(400, "Confirm the candidate was told the call is recorded.");
    const path = `${orgId}/${id}${callFileExtension(file.name)}`;
    const { error } = await insert({ ...base, input_kind: "audio", file_name: file.name, file_type: contentType, file_size: file.size, storage_path: path, status: "uploading" });
    if (error) fail("start the upload", error);
    const { data: link, error: linkErr } = await storage.createSignedUploadUrl(path, { upsert: true });
    if (linkErr || !link) {
      console.error("[candidates] call upload link failed", linkErr?.message);
      await client.from(CALLS_TABLE).delete().eq("id", id).eq("organization_id", orgId);
      if (/not found/i.test(linkErr?.message ?? "")) throw new CandidateActionError(503, CALLS_MIGRATION_MESSAGE);
      throw new CandidateActionError(500, "Couldn't prepare the upload. Please try again.");
    }
    return { call: await getCall(client, orgId, id), upload: { signedUrl: link.signedUrl, contentType } };
  }

  const text = (transcript ?? "").replace(/\r\n/g, "\n").trim();
  if (text.length < CALL_TRANSCRIPT_MIN_CHARS) throw new CandidateActionError(400, "Paste the whole transcript: at least a few lines.");
  const { error } = await insert({ ...base, input_kind: "transcript", file_name: null, status: "uploaded", transcript_text: text.slice(0, CALL_TRANSCRIPT_MAX_CHARS) });
  if (error) fail("save the transcript", error);
  await logCall(client, orgId, by, { ...base, call_round: round ?? null, position_title: position?.title ?? null }, "Transcript pasted");
  return { call: await getCall(client, orgId, id), upload: null };
}

async function logCall(client: SupabaseClient, orgId: string, by: Actor, call: { id: string; candidate_id: string; application_id: string | null; position_id: string | null; called_on: string | null; position_title?: string | null; call_round?: CallRound | null }, what: string): Promise<void> {
  await recordAction(client, orgId, by, {
    candidateId: call.candidate_id,
    applicationId: call.application_id,
    positionId: call.position_id,
    action: "call_logged",
    toValue: what,
    meta: { callId: call.id, calledOn: call.called_on, position: call.position_title ?? null, round: call.call_round ? CALL_ROUND_LABELS[call.call_round] : null },
  });
}

/** The browser says the recording arrived: the object is looked for in storage before the row becomes 'uploaded'. */
export async function confirmCall(client: SupabaseClient, storage: CallStorage, orgId: string, by: Actor, id: string): Promise<CallAnalysis> {
  const row = await loadRow(client, orgId, id);
  if (row.status !== "uploading") return toCall(row, await positionTitles(client, orgId, [row.position_id]), new Date());
  if (!row.storage_path) throw new CandidateActionError(409, "This call has no recording to confirm.");
  const objectName = row.storage_path.slice(orgId.length + 1);
  const { data: objects, error: listErr } = await storage.list(orgId, { search: row.id, limit: 5 });
  const stored = (objects ?? []).find((o) => o.name === objectName);
  if (listErr || !stored) {
    if (listErr) console.error("[candidates] call confirm: storage list failed", listErr.message);
    throw new CandidateActionError(409, "The recording did not arrive. Upload it again.");
  }
  const size = Number(stored.metadata?.size) || Number(row.file_size) || 0;
  const { error } = await client
    .from(CALLS_TABLE)
    .update({ status: "uploaded", file_size: size > 0 ? size : row.file_size, updated_at: new Date().toISOString() })
    .eq("id", row.id)
    .eq("organization_id", orgId)
    .eq("status", "uploading");
  if (error) fail("finish the upload", error);
  const titles = await positionTitles(client, orgId, [row.position_id]);
  await logCall(client, orgId, by, { ...row, called_on: isoDate(row.called_on), position_title: row.position_id ? titles.get(row.position_id) ?? null : null }, `Recording · ${row.file_name ?? "call"}`);
  return getCall(client, orgId, id);
}

/**
 * Runs the pipeline again: after a failure, after a run that was cut off, or on a finished call to read it afresh.
 * The transcript is kept, so a recording is never transcribed twice. The route starts the pipeline after this.
 */
/**
 * Which round the call was for, changed after it was added (owner 2026-11-17). The call keeps its reading until HR
 * reads it again (the screen offers that), so a change never re-runs the model by itself.
 */
export async function setCallRound(client: SupabaseClient, orgId: string, id: string, roundInput: unknown): Promise<CallAnalysis> {
  if (typeof roundInput !== "string" || !(CALL_ROUNDS as readonly string[]).includes(roundInput)) throw new CandidateActionError(400, "Pick the round from the list.");
  const row = await loadRow(client, orgId, id);
  const { error } = await client.from(CALLS_TABLE).update({ call_round: roundInput, updated_at: new Date().toISOString() }).eq("id", row.id).eq("organization_id", orgId);
  if (roundError(error)) { roundMissingAt = Date.now(); throw new CandidateActionError(503, "This needs a database update first: run 20261117000001_call_rounds.sql in Supabase."); }
  if (error) fail("change the round", error);
  return getCall(client, orgId, id);
}

export async function retryCall(client: SupabaseClient, orgId: string, id: string, now = new Date()): Promise<CallAnalysis> {
  const row = await loadRow(client, orgId, id);
  if (row.status === "uploading") throw new CandidateActionError(409, "The recording has not finished uploading.");
  if ((row.status === "transcribing" || row.status === "analysing") && !isStale(row.status, row.updated_at, now)) {
    throw new CandidateActionError(409, "This call is still being read. Give it a minute.");
  }
  const { error } = await client.from(CALLS_TABLE).update({ status: "uploaded", error: null, updated_at: now.toISOString() }).eq("id", row.id).eq("organization_id", orgId).eq("status", row.status);
  if (error) fail("retry the call", error);
  return getCall(client, orgId, id, now);
}

// Applying facts -------------------------------------------------------------------------------------------------------

const ApplyInput = z.object({ keys: z.array(z.enum(CALL_FACT_KEYS)).min(1).max(CALL_FACT_KEYS.length) });

/**
 * Puts facts heard on the call onto the record, one click per fact (owner 2026-11-16: nothing is applied by itself).
 * Pay, notice and location go to their fields (a `field_edit` from the call in the history); the reason for change
 * has no field and is kept as a remark. A fact already applied from this call is skipped.
 */
export async function applyCallFacts(client: SupabaseClient, orgId: string, by: Actor, id: string, input: unknown): Promise<{ call: CallAnalysis; record: CandidateRecord | null }> {
  const parsed = ApplyInput.safeParse(input ?? {});
  if (!parsed.success) throw new CandidateActionError(400, "Say which facts to apply.");
  const row = await loadRow(client, orgId, id);
  if (row.status !== "done" || !row.result) throw new CandidateActionError(409, "This call has not been read yet.");
  if (!row.application_id) throw new CandidateActionError(409, "This candidate's record was deleted, so the facts cannot be applied.");
  const applied = new Set((Array.isArray(row.applied_facts) ? row.applied_facts : []).map((a) => a.key));
  const keys = [...new Set(parsed.data.keys)].filter((k) => !applied.has(k));
  if (!keys.length) throw new CandidateActionError(409, "Already applied.");

  const facts = row.result.facts;
  const fields: Record<string, unknown> = {};
  let reason: string | null = null;
  for (const key of keys) {
    const value = facts[key]?.value ?? null;
    if (value === null || value === undefined || value === "") throw new CandidateActionError(400, `${CALL_FACT_LABELS[key]} was not said on the call.`);
    if (key === "reasonForChange") reason = String(value);
    else fields[key] = value;
  }

  let record: CandidateRecord | null = null;
  const common = { candidateId: row.candidate_id, applicationId: row.application_id, positionId: row.position_id };
  if (Object.keys(fields).length) {
    // Owner 2026-11-17: the history keeps the value each fact replaced (from a sheet, say), so an overwrite can always
    // be looked up: changes = [{ field, from, to }], from = null when the field was empty.
    const before = await getRecord(client, orgId, row.application_id);
    record = await updateRecord(client, orgId, by.id, row.application_id, fields);
    // A pay figure said as CTC or with no basis is noted as such (owner 2026-11-17, the CTC fix).
    const basisOf = (field: string) => (field === "currentInhand" || field === "expectedInhand" ? (facts[field] as { basis?: string }).basis : undefined);
    const changes = Object.keys(fields).map((field) => {
      const basis = basisOf(field);
      return { field, from: (before as unknown as Record<string, unknown>)[field] ?? null, to: fields[field], ...(basis === "ctc" || basis === "unclear" ? { basis } : {}) };
    });
    await recordAction(client, orgId, by, {
      ...common, action: "field_edit",
      meta: { fields: Object.keys(fields), changes, source: "call", callId: row.id, calledOn: isoDate(row.called_on) },
    });
  }
  if (reason) {
    const when = isoDate(row.called_on);
    await recordAction(client, orgId, by, { ...common, action: "remark", remark: `Reason for change, from the call${when ? ` on ${when}` : ""}: ${reason}`, meta: { source: "call", callId: row.id } });
  }

  const at = new Date().toISOString();
  const next = [...(Array.isArray(row.applied_facts) ? row.applied_facts : []), ...keys.map((key) => ({ key: key as CallFactKey, at, byName: by.name }))];
  const { error } = await client.from(CALLS_TABLE).update({ applied_facts: next, updated_at: at }).eq("id", row.id).eq("organization_id", orgId);
  if (error) fail("record the applied facts", error);
  return { call: await getCall(client, orgId, id), record };
}

// Playback and removal -------------------------------------------------------------------------------------------------

/** A short-lived link to play the recording (HR only; the route redirects to it). */
export async function callAudioLink(client: SupabaseClient, storage: CallStorage, orgId: string, id: string): Promise<{ url: string; fileName: string }> {
  const row = await loadRow(client, orgId, id);
  if (row.input_kind !== "audio" || !row.storage_path || row.status === "uploading") throw new CandidateActionError(404, "This call has no recording.");
  const { data, error } = await storage.createSignedUrl(row.storage_path, CALL_LINK_SECONDS);
  if (error || !data) {
    console.error("[candidates] call link failed", error?.message);
    throw new CandidateActionError(500, "Couldn't open the recording. Please try again.");
  }
  return { url: data.signedUrl, fileName: row.file_name ?? "call" };
}

/** Removes a call: the row is soft-deleted and the recording's bytes leave the bucket (personal data). */
export async function deleteCall(client: SupabaseClient, storage: CallStorage, orgId: string, id: string): Promise<void> {
  const row = await loadRow(client, orgId, id);
  const { error } = await client.from(CALLS_TABLE).update({ deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", row.id).eq("organization_id", orgId);
  if (error) fail("delete the call", error);
  if (row.storage_path) {
    const { error: rmErr } = await storage.remove([row.storage_path]);
    if (rmErr) console.error("[candidates] call delete: storage remove failed", rmErr.message);
  }
}
