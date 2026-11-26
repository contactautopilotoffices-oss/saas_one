/**
 * Resume files (owner 2026-11-07, phase 1): get every resume from the team's laptops into one private bucket, one copy
 * each, with the date it was downloaded. No parsing and no AI here; that is phase 2.
 *
 * The browser hashes each file (SHA-256), asks for upload links in batches (prepareResumeUploads), sends the bytes
 * straight to storage with those links, then confirms (confirmResumeUploads), which checks the object really arrived.
 * A file whose hash the organisation already holds is reported as a duplicate and never uploaded again, so running
 * the same folder from another laptop, or again after a dropped connection, is safe.
 *
 * Storage calls go through the small ResumeStorage interface so the tests can pass a fake; the database client is the
 * service-role client, used only after requireCandidateAccess said yes.
 */
import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";
import ExcelJS from "exceljs";
import mammoth from "mammoth";
import { z } from "zod";

import {
  MAX_RESUME_BYTES, RESUME_BATCH, RESUME_BUCKET, RESUME_DELETE_BATCH, RESUME_EXPORT_MAX, RESUME_LINK_BATCH, RESUME_LINK_SECONDS,
  RESUME_LIST_PAGE_SIZE, RESUME_TYPES,
} from "./config";
import { firstSourcing, flagKnownPeople, sourceColumnsMissing } from "./known";
import { CandidateActionError } from "./records";
import { fileExtension } from "./resume-pick";
import { resumeSourceLabel, sourceFromResumeName } from "./resume-source";
import {
  MATCH_REASON_LABELS, SOURCE_KINDS, TEXT_STATUS_LABELS,
  type PreparedUpload, type ResumeConfirmResponse, type ResumeFile, type ResumeFilesResponse, type ResumeLinksResponse,
  type ResumeExtractStatus, type ResumeManifestResponse, type ResumeMatchReason, type ResumeRepeat, type ResumeSummary, type ResumeTextStatus, type SourceKind,
} from "./types";

const TABLE = "candidate_resume_files";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const RESUME_MIGRATION_MESSAGE =
  "This needs a database update first: run 20261107000002_candidate_resume_files.sql and 20261110000001_candidate_resume_links.sql in Supabase.";

type StorageResult<T> = Promise<{ data: T | null; error: { message: string } | null }>;

/** The slice of storage.from(RESUME_BUCKET) this module uses; the tests pass a fake. */
export interface ResumeStorage {
  createSignedUploadUrl(path: string, options?: { upsert: boolean }): StorageResult<{ signedUrl: string; token: string; path: string }>;
  createSignedUrl(path: string, expiresIn: number, options?: { download?: string | boolean }): StorageResult<{ signedUrl: string }>;
  createSignedUrls(paths: string[], expiresIn: number): StorageResult<{ path: string | null; signedUrl: string | null; error: string | null }[]>;
  list(path?: string, options?: { search?: string; limit?: number }): StorageResult<{ name: string; metadata: Record<string, unknown> | null }[]>;
  remove(paths: string[]): StorageResult<unknown>;
  /** The file's bytes (the server reads a resume's text and shows .docx files as a page). */
  download(path: string): StorageResult<Blob>;
}

export function resumeStorage(client: SupabaseClient): ResumeStorage {
  return client.storage.from(RESUME_BUCKET);
}

interface ResumeRow {
  id: string;
  sha256?: string;
  file_name: string;
  file_type: string;
  file_size: number | string;
  storage_path: string;
  /** 'rejected' (20261110000002): not a resume, bytes removed, hash kept. 'other' (20261111000002): kept, never matched. */
  status: "uploading" | "ready" | "rejected" | "other";
  downloaded_at: string | Date | null;
  device_label: string | null;
  folder_path: string | null;
  uploaded_by_email: string | null;
  created_at: string | Date;
  updated_at: string | Date;
  // Migration 20261110000001 (phase 2).
  text_status?: ResumeTextStatus;
  text_error?: string | null;
  candidate_id?: string | null;
  match_reason?: ResumeMatchReason | null;
  // Migration 20261111000002 (phase 4).
  extract_status?: ResumeExtractStatus;
  extract_error?: string | null;
  // Migration 20261116000004 (owner 2026-11-16): where the upload came from, and a second CV of the same person.
  source_kind?: SourceKind | null;
  source_name?: string | null;
  sourced_role?: string | null;
  duplicate_state?: "pending" | "updated" | null;
}

const COLUMNS =
  "id, file_name, file_type, file_size, storage_path, status, downloaded_at, device_label, folder_path, uploaded_by_email, created_at, updated_at, " +
  "text_status, text_error, candidate_id, match_reason, extract_status, extract_error";
/** Read with COLUMNS when migration 20261116000004 is applied; the read is repeated without them when it is not. */
const SOURCE_COLUMNS = ", source_kind, source_name, duplicate_state";

/** Timestamps arrive as strings from PostgREST and as Dates from PGlite (tests). */
function iso(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  return typeof value === "string" && value ? value : null;
}

function toFile(row: ResumeRow, names: Map<string, string> = new Map()): ResumeFile {
  return {
    id: row.id,
    fileName: row.file_name,
    fileType: row.file_type,
    fileSize: Number(row.file_size) || 0,
    downloadedAt: iso(row.downloaded_at),
    deviceLabel: row.device_label,
    folderPath: row.folder_path,
    uploadedByEmail: row.uploaded_by_email,
    createdAt: iso(row.created_at) ?? "",
    removed: row.status === "rejected",
    other: row.status === "other",
    textStatus: row.text_status ?? "pending",
    extractStatus: row.extract_status ?? "pending",
    extractError: row.extract_error ?? null,
    textError: row.text_error ?? null,
    candidateId: row.candidate_id ?? null,
    candidateName: row.candidate_id ? names.get(row.candidate_id) ?? null : null,
    matchReason: row.match_reason ?? null,
    sourceKind: row.source_kind ?? null,
    sourceName: row.source_name ?? null,
    sourcedRole: row.sourced_role ?? null,
    duplicateState: row.duplicate_state ?? null,
    alreadyKnown: null,
  };
}

/**
 * Fills `alreadyKnown` on the second CVs waiting for HR (owner 2026-11-16): how the person was first sourced, and the
 * CV that was on file before this one. Never fails the list.
 */
async function attachAlreadyKnown(client: SupabaseClient, orgId: string, files: ResumeFile[]): Promise<void> {
  const known = files.filter((f) => f.candidateId && f.duplicateState === "pending");
  if (!known.length) return;
  const ids = [...new Set(known.map((f) => f.candidateId as string))];
  try {
    const [first, { data: earlier }] = await Promise.all([
      firstSourcing(client, orgId, ids),
      client.from(TABLE).select("id, candidate_id, file_name, device_label, created_at").eq("organization_id", orgId).eq("status", "ready").in("candidate_id", ids).order("created_at"),
    ]);
    const all = ((earlier ?? []) as { id: string; candidate_id: string; file_name: string; device_label: string | null; created_at: unknown }[])
      .map((r) => ({ ...r, at: iso(r.created_at) ?? "" }));
    for (const f of known) {
      const s = first.get(f.candidateId as string);
      const before = all.filter((r) => r.candidate_id === f.candidateId && r.id !== f.id && (r.at < f.createdAt || (r.at === f.createdAt && r.id < f.id)));
      const prev = before[before.length - 1];
      f.alreadyKnown = {
        sourcedAt: s?.at ?? null,
        sourcedFrom: s?.from ?? null,
        sourcedBy: s?.byName ?? null,
        previous: prev ? { id: prev.id, fileName: prev.file_name, uploadedAt: prev.at || null, uploadedBy: prev.device_label } : null,
      };
    }
  } catch (error) {
    console.error("[candidates] already-known lookup failed", error);
  }
}

/**
 * HR's answer to a second CV (owner 2026-11-16): "update" makes this file the person's CV from now on (the earlier one
 * stays as an older version; the candidate's panel lists the newest upload first), "delete" removes this copy (its
 * bytes and its row). Either way the person's history says so.
 */
export async function resolveDuplicate(client: SupabaseClient, storage: ResumeStorage, orgId: string, by: { id: string; name: string | null }, id: unknown, action: unknown): Promise<void> {
  if (action !== "update" && action !== "delete") throw new CandidateActionError(400, 'Say what to do: "update" or "delete".');
  const row = await getRow(client, orgId, id, false);
  const { data, error } = await client.from(TABLE).select("id, candidate_id, file_name, duplicate_state").eq("organization_id", orgId).eq("id", row.id).maybeSingle();
  if (error) {
    if (sourceColumnsMissing(error)) throw new CandidateActionError(503, "This needs a database update first: run 20261116000004_sourcing_duplicates.sql in Supabase.");
    fail("load the file", error);
  }
  const file = data as { id: string; candidate_id: string | null; file_name: string; duplicate_state: string | null } | null;
  if (!file || file.duplicate_state !== "pending") throw new CandidateActionError(409, "This file is no longer waiting for a decision.");
  const { recordAction } = await import("./actions");
  if (action === "update") {
    const now = new Date().toISOString();
    const { error: upErr } = await client.from(TABLE).update({ duplicate_state: "updated", duplicate_resolved_by: by.id, duplicate_resolved_at: now, updated_at: now }).eq("organization_id", orgId).eq("id", file.id);
    if (upErr) fail("update the CV", upErr);
    if (file.candidate_id) await recordAction(client, orgId, by, { candidateId: file.candidate_id, action: "resume_attached", toValue: `CV updated: ${file.file_name}`, meta: { fileId: file.id, duplicate: "updated" } });
    return;
  }
  await deleteResumeFile(client, storage, orgId, file.id);
  if (file.candidate_id) await recordAction(client, orgId, by, { candidateId: file.candidate_id, action: "remark", remark: `Second CV deleted (${file.file_name}); the CV on file was kept.`, meta: { fileId: file.id, duplicate: "deleted" } });
}

/** The names of these candidates, for the list and the Excel. */
async function candidateNames(client: SupabaseClient, orgId: string, ids: (string | null | undefined)[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  const names = new Map<string, string>();
  for (let i = 0; i < unique.length; i += 200) {
    const { data, error } = await client.from("candidates").select("id, full_name").eq("organization_id", orgId).in("id", unique.slice(i, i + 200));
    if (error) fail("load the candidates", error);
    for (const row of data ?? []) names.set(row.id as string, row.full_name as string);
  }
  return names;
}

function migrationMissing(error: { code?: string; message?: string } | null | undefined): boolean {
  const code = error?.code;
  return code === "42P01" || code === "42703" || code === "PGRST204" || code === "PGRST205" || code === "PGRST202" || code === "42883";
}

function fail(context: string, error: unknown): never {
  if (/sourced_role/.test((error as { message?: string } | null)?.message ?? "")) {
    throw new CandidateActionError(503, "Resume designations need a database update first: run 20261122000001_resume_sourcing.sql in Supabase.");
  }
  if (migrationMissing(error as { code?: string } | null)) {
    console.error(`[candidates] ${context}: migration 20261107000002 not applied`, error);
    throw new CandidateActionError(503, RESUME_MIGRATION_MESSAGE);
  }
  console.error(`[candidates] ${context}`, error);
  throw new CandidateActionError(500, `Couldn't ${context}. Please try again.`);
}

/**
 * Whose uploads these are (owner 2026-11-11: taken from the login, not picked from a list): the person's name in
 * their profile, else the part of their email before the @. "Since your last upload" goes by it.
 */
export async function uploaderName(client: SupabaseClient, user: { id: string; email: string | null }): Promise<string | null> {
  let name: unknown = null;
  try {
    const { data } = await client.from("users").select("full_name").eq("id", user.id).maybeSingle();
    name = (data as { full_name?: unknown } | null)?.full_name ?? null;
  } catch {
    name = null;
  }
  return cleanDevice(name) ?? cleanDevice((user.email ?? "").split("@")[0]);
}

/** The uploader's name as stored: one line, at most 80 characters, or nothing. */
export function cleanDevice(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.replace(/\s+/g, " ").trim().slice(0, 80);
  return v || null;
}

function cleanFolder(value: string | null | undefined): string | null {
  const v = (value ?? "").replace(/\\/g, "/").replace(/\s+/g, " ").trim().slice(0, 400);
  return v || null;
}

/** An ISO date-time, or null when it cannot be read. */
function parseIso(value: string | null | undefined): string | null {
  if (!value) return null;
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

/** The file's modified date, if believable: not before 2000 and not more than a day ahead (laptop clocks drift). */
function toDownloadedAt(value: string | null | undefined): string | null {
  const v = parseIso(value);
  if (!v) return null;
  const t = new Date(v).getTime();
  return t >= Date.UTC(2000, 0, 1) && t <= Date.now() + 86_400_000 ? v : null;
}

/** A file name a browser will save without complaint; keeps the extension. */
export function downloadName(fileName: string, fileType: string): string {
  const ext = fileExtension(fileName) || (fileType === "application/pdf" ? ".pdf" : "");
  const stem = fileName.slice(0, fileName.length - fileExtension(fileName).length);
  const clean = stem.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 150);
  return `${clean || "resume"}${ext}`;
}

function parseIds(value: unknown, max: number): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > max) {
    throw new CandidateActionError(400, `Send 1 to ${max} ids.`);
  }
  const ids = [...new Set(value.map((v) => (typeof v === "string" ? v.toLowerCase() : "")))];
  if (ids.some((id) => !UUID.test(id))) throw new CandidateActionError(400, "Every id must be a uuid.");
  return ids;
}

// Upload ---------------------------------------------------------------------------------------------------------------

const ResumeSourceInput = z.object({ kind: z.enum(SOURCE_KINDS).nullable(), name: z.string().trim().max(120).nullable() });
const SourcedRoleInput = z.string().trim().max(200).nullable();

const PrepareInput = z.object({
  device: z.string().max(200).nullish(),
  /** Owner 2026-11-16: where these resumes came from (optional). */
  source: ResumeSourceInput.nullish(),
  sourcedRole: SourcedRoleInput.optional(),
  files: z
    .array(
      z.object({
        index: z.number().int().min(0).max(100_000),
        name: z.string().min(1).max(255),
        size: z.number().int().min(1),
        sha256: z.string().regex(/^[0-9a-f]{64}$/),
        modifiedAt: z.string().max(40).nullish(),
        folder: z.string().max(1000).nullish(),
        source: ResumeSourceInput.optional(),
        sourcedRole: SourcedRoleInput.optional(),
      }),
    )
    .min(1)
    .max(RESUME_BATCH),
});

/** Postgres: a row with this organisation and content hash is already there. */
const UNIQUE_VIOLATION = "23505";
/** Times a prepare reads the rows and tries its insert; more than one only when someone else stored the same file in between. */
const PREPARE_ROUNDS = 3;

/**
 * One upload link per new file. Files already stored (same hash, any laptop) come back as duplicates; files of another
 * type or over the size limit as rejected. A row left at 'uploading' by an earlier attempt is reused (and the link
 * allows overwriting), so a retry never leaves two rows for one file.
 */
export async function prepareResumeUploads(
  client: SupabaseClient,
  storage: ResumeStorage,
  orgId: string,
  user: { id: string; email: string | null },
  input: unknown,
): Promise<{ files: PreparedUpload[] }> {
  const parsed = PrepareInput.safeParse(input);
  if (!parsed.success) {
    throw new CandidateActionError(400, `Send files (1 to ${RESUME_BATCH}: index, name, size, sha256, modifiedAt, folder) and the device.`);
  }
  const device = cleanDevice(parsed.data.device);
  // Owner 2026-11-11: an upload is always filed under a person ("since your last upload" goes by it). The route takes
  // the name from the login; this only fails for a login with neither a name nor an email.
  if (!device) throw new CandidateActionError(400, "This upload cannot be filed under a name: your profile has no name or email. Ask an administrator.");
  const out: PreparedUpload[] = [];
  const seen = new Set<string>();
  const wanted: typeof parsed.data.files = [];
  for (const f of parsed.data.files) {
    const contentType = RESUME_TYPES[fileExtension(f.name)];
    if (!contentType) {
      out.push({ index: f.index, outcome: "rejected", reason: "Not a PDF or Word file" });
    } else if (f.size > MAX_RESUME_BYTES) {
      out.push({ index: f.index, outcome: "rejected", reason: `Larger than ${MAX_RESUME_BYTES / 1024 / 1024} MB` });
    } else if (seen.has(f.sha256)) {
      out.push({ index: f.index, outcome: "duplicate" });
    } else {
      seen.add(f.sha256);
      wanted.push(f);
    }
  }
  if (!wanted.length) return { files: byIndex(out) };

  // Several people upload at once (owner 2026-11-12). Two of them can prepare the same file in the same instant: both
  // find no row and both insert, and the unique index (organisation + content hash) refuses the second insert whole,
  // which used to fail that person's batch of up to 50 files. The one refused now reads the rows again, finds the
  // other person's row and goes round once more, so nothing of its batch is lost and the file is stored once.
  const now = new Date().toISOString();
  let slots: { index: number; id: string; path: string; contentType: string }[] = [];
  let repeats: Repeat[] = [];
  for (let round = 1; ; round += 1) {
    // Owner 2026-11-15: keep_as_resume (migration 20261115000002) lets a file removed as not a resume come back; before
    // the migration the column is missing and the rows are read without it.
    type ExistingRow = { id: string; sha256: string; status: string; keep_as_resume?: boolean | null; file_name?: string; candidate_id?: string | null; created_at?: unknown; device_label?: string | null; uploaded_by?: string | null };
    const existingQuery = (columns: string) => client.from(TABLE).select(columns).eq("organization_id", orgId).in("sha256", wanted.map((f) => f.sha256));
    let { data: existingRows, error } = await existingQuery("id, sha256, status, keep_as_resume, file_name, candidate_id, created_at, device_label, uploaded_by");
    if (error && /keep_as_resume/.test(error.message ?? "")) ({ data: existingRows, error } = await existingQuery("id, sha256, status, file_name, candidate_id, created_at, device_label, uploaded_by"));
    if (error) fail("prepare the upload", error);
    const existing = new Map(((existingRows ?? []) as unknown as ExistingRow[]).map((r) => [r.sha256, r]));
    // Whose copy it is, so the upload summary can say "already there: Prakash Menon" rather than only a count.
    const names = await candidateNames(client, orgId, [...existing.values()].map((r) => r.candidate_id));

    const inserts: Record<string, unknown>[] = [];
    const duplicates: PreparedUpload[] = [];
    repeats = [];
    slots = [];
    for (const f of wanted) {
      const ext = fileExtension(f.name);
      const contentType = RESUME_TYPES[ext];
      const row = existing.get(f.sha256);
      // Stored already (as a resume or another document), or read earlier and removed: either way the file is not sent
      // again, unless HR allowed the removed file back ("Allow re-upload"): then its row is reused and read afresh.
      const comingBack = row?.status === "rejected" && row.keep_as_resume === true;
      if ((row?.status === "ready" || row?.status === "rejected" || row?.status === "other") && !comingBack) {
        duplicates.push({
          index: f.index,
          outcome: "duplicate",
          id: row.id,
          existing: { fileName: row.file_name ?? f.name, candidateName: row.candidate_id ? names.get(row.candidate_id) ?? null : null, uploadedAt: iso(row.created_at), uploadedBy: row.device_label ?? null },
        });
        // Owner 2026-11-16: a CV someone ELSE uploaded first is noted for HR. The same person re-running their own folder
        // (a retry the screen says is safe) is not.
        if (row.status === "ready" && row.uploaded_by && row.uploaded_by !== user.id) {
          repeats.push({ fileId: row.id, fileName: row.file_name ?? f.name, candidateId: row.candidate_id ?? null, firstAt: iso(row.created_at), firstBy: row.device_label ?? null });
        }
        continue;
      }
      const id = row?.id ?? randomUUID();
      const path = `${orgId}/${id}${ext}`;
      const source = f.source ?? parsed.data.source ?? sourceFromResumeName(f.name);
      const values = {
        file_name: f.name.trim(),
        file_type: contentType,
        file_size: f.size,
        storage_path: path,
        status: "uploading",
        downloaded_at: toDownloadedAt(f.modifiedAt),
        device_label: device,
        folder_path: cleanFolder(f.folder),
        uploaded_by: user.id,
        uploaded_by_email: user.email,
        updated_at: now,
        // An older caller retrying an unfinished upload must not erase an already chosen source.
        ...(!row || f.source !== undefined || parsed.data.source
          ? { source_kind: source.kind, source_name: source.kind ? source.name || null : null } : {}),
        ...(f.sourcedRole !== undefined || parsed.data.sourcedRole !== undefined
          ? { sourced_role: (f.sourcedRole !== undefined ? f.sourcedRole : parsed.data.sourcedRole) || null } : {}),
      };
      if (row) {
        // A removed file coming back is read again from the start (its old verdict and text are gone).
        const reset = comingBack ? { text_status: "pending", text_error: null, text_attempts: 0, resume_text: null, extract_status: "pending", extract_error: null, candidate_id: null, match_reason: null, matched_at: null } : {};
        let { error: upErr } = await client.from(TABLE).update({ ...values, ...reset }).eq("id", id).eq("organization_id", orgId);
        if (upErr && !/sourced_role/.test(upErr.message ?? "") && sourceColumnsMissing(upErr)) ({ error: upErr } = await client.from(TABLE).update({ ...withoutSource(values), ...reset }).eq("id", id).eq("organization_id", orgId));
        if (upErr) fail("prepare the upload", upErr);
      } else {
        inserts.push({ id, organization_id: orgId, sha256: f.sha256, created_at: now, ...values });
      }
      slots.push({ index: f.index, id, path, contentType });
    }
    if (inserts.length) {
      // One statement: either every row is in, or none is, so going round again starts clean.
      let { error: insErr } = await client.from(TABLE).insert(inserts);
      // Before migration 20261116000004 the source columns do not exist: the rows go in without them.
      if (insErr && !/sourced_role/.test(insErr.message ?? "") && sourceColumnsMissing(insErr)) ({ error: insErr } = await client.from(TABLE).insert(inserts.map(withoutSource)));
      if (insErr && (insErr as { code?: string }).code === UNIQUE_VIOLATION && round < PREPARE_ROUNDS) continue;
      if (insErr) fail("prepare the upload", insErr);
    }
    out.push(...duplicates);
    break;
  }
  if (repeats.length) await recordRepeats(client, orgId, { id: user.id, name: device }, repeats);

  await Promise.all(
    slots.map(async (slot) => {
      const { data, error: linkErr } = await storage.createSignedUploadUrl(slot.path, { upsert: true });
      if (linkErr || !data) {
        console.error("[candidates] resume upload link failed", linkErr?.message);
        const missing = /not found/i.test(linkErr?.message ?? "");
        out.push({ index: slot.index, outcome: "rejected", reason: missing ? RESUME_MIGRATION_MESSAGE : "Couldn't prepare the upload. Please try again." });
        return;
      }
      out.push({ index: slot.index, outcome: "upload", id: slot.id, signedUrl: data.signedUrl, contentType: slot.contentType });
    }),
  );
  return { files: byIndex(out) };
}

function byIndex(files: PreparedUpload[]): PreparedUpload[] {
  return [...files].sort((a, b) => a.index - b.index);
}

// The same CV uploaded again by someone else (owner 2026-11-16) -----------------------------------------------------------

const REPEATS = "candidate_resume_repeats";
interface Repeat { fileId: string; fileName: string; candidateId: string | null; firstAt: string | null; firstBy: string | null }

const repeatsMissing = (error: { code?: string; message?: string } | null | undefined) =>
  Boolean(error) && (["42P01", "PGRST205", "42703", "PGRST204"].includes(error?.code ?? "") || /candidate_resume_repeats/.test(error?.message ?? ""));

/**
 * Notes each repeat for HR (one open entry per file and person: the unique index refuses a second) and, for a file
 * linked to a candidate, in the person's history. Never fails the upload: before migration 20261116000004 there is
 * nowhere to note it, and the upload summary still names whose copy it was.
 */
async function recordRepeats(client: SupabaseClient, orgId: string, by: { id: string; name: string | null }, repeats: Repeat[]): Promise<void> {
  try {
    const noted: Repeat[] = [];
    for (const r of repeats) {
      const { error } = await client.from(REPEATS).insert({ organization_id: orgId, file_id: r.fileId, candidate_id: r.candidateId, uploaded_by: by.id, uploaded_by_name: by.name });
      if (!error) { noted.push(r); continue; }
      if ((error as { code?: string }).code === "23505") continue; // already noted and not dismissed yet
      if (repeatsMissing(error)) return;
      throw error;
    }
    await flagKnownPeople(client, orgId, noted.filter((r) => r.candidateId).map((r) => ({
      candidateId: r.candidateId as string,
      by,
      meta: { source: "same_file", fileId: r.fileId, fileName: r.fileName, firstAt: r.firstAt, firstBy: r.firstBy },
    })));
  } catch (error) {
    console.error("[candidates] repeat upload not noted", error);
  }
}

/** The repeats still open, newest first, for the "Already in the database" section. */
export async function listRepeats(client: SupabaseClient, orgId: string, limit = 20): Promise<{ repeats: ResumeRepeat[]; total: number }> {
  const { data, error, count } = await client
    .from(REPEATS)
    .select("id, file_id, candidate_id, uploaded_by_name, created_at", { count: "exact" })
    .eq("organization_id", orgId)
    .is("dismissed_at", null)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) {
    if (repeatsMissing(error)) return { repeats: [], total: 0 };
    fail("load the repeated uploads", error);
  }
  const rows = (data ?? []) as unknown as { id: string; file_id: string; candidate_id: string | null; uploaded_by_name: string | null; created_at: unknown }[];
  const fileIds = [...new Set(rows.map((r) => r.file_id))];
  const files = new Map<string, { file_name: string; created_at: unknown; device_label: string | null }>();
  if (fileIds.length) {
    const { data: fileRows } = await client.from(TABLE).select("id, file_name, created_at, device_label").eq("organization_id", orgId).in("id", fileIds);
    for (const f of (fileRows ?? []) as unknown as { id: string; file_name: string; created_at: unknown; device_label: string | null }[]) files.set(f.id, f);
  }
  const names = await candidateNames(client, orgId, rows.map((r) => r.candidate_id));
  return {
    repeats: rows.map((r) => {
      const f = files.get(r.file_id);
      return {
        id: r.id, fileId: r.file_id, fileName: f?.file_name ?? "file", candidateId: r.candidate_id, candidateName: r.candidate_id ? names.get(r.candidate_id) ?? null : null,
        againBy: r.uploaded_by_name, againAt: iso(r.created_at) ?? "", firstBy: f?.device_label ?? null, firstAt: iso(f?.created_at),
      };
    }),
    total: count ?? rows.length,
  };
}

/** HR has seen the repeat: it leaves the section (the history entry stays). */
export async function dismissRepeat(client: SupabaseClient, orgId: string, userId: string, id: unknown): Promise<void> {
  if (typeof id !== "string" || !UUID.test(id)) throw new CandidateActionError(400, "id must be a uuid.");
  const now = new Date().toISOString();
  const { data, error } = await client.from(REPEATS).update({ dismissed_at: now, dismissed_by: userId }).eq("organization_id", orgId).eq("id", id).is("dismissed_at", null).select("id");
  if (error) {
    if (repeatsMissing(error)) throw new CandidateActionError(503, "This needs a database update first: run 20261116000004_sourcing_duplicates.sql in Supabase.");
    fail("dismiss the entry", error);
  }
  if (!data?.length) throw new CandidateActionError(404, "That entry is already dismissed.");
}

/** The same row without the source columns (migration 20261116000004 not applied). */
function withoutSource<T extends Record<string, unknown>>(row: T): Omit<T, "source_kind" | "source_name"> {
  const { source_kind: _k, source_name: _n, ...rest } = row;
  void _k; void _n;
  return rest;
}

/** The browser says these uploads finished: each object is looked for in storage before its row becomes 'ready'. */
export async function confirmResumeUploads(
  client: SupabaseClient,
  storage: ResumeStorage,
  orgId: string,
  input: unknown,
): Promise<ResumeConfirmResponse> {
  const ids = parseIds(input, RESUME_BATCH);
  const { data, error } = await client.from(TABLE).select("id, status, storage_path, file_size").eq("organization_id", orgId).in("id", ids);
  if (error) fail("finish the upload", error);
  const rows = (data ?? []) as unknown as Pick<ResumeRow, "id" | "status" | "storage_path" | "file_size">[];
  const ready: string[] = [];
  const missing: string[] = [];
  await Promise.all(
    rows.map(async (row) => {
      if (row.status === "ready") {
        ready.push(row.id);
        return;
      }
      const objectName = row.storage_path.slice(orgId.length + 1);
      const { data: objects, error: listErr } = await storage.list(orgId, { search: row.id, limit: 5 });
      const stored = (objects ?? []).find((o) => o.name === objectName);
      if (listErr || !stored) {
        if (listErr) console.error("[candidates] resume confirm: storage list failed", listErr.message);
        missing.push(row.id);
        return;
      }
      const size = Number(stored.metadata?.size) || Number(row.file_size) || 0;
      const { error: upErr } = await client
        .from(TABLE)
        .update({ status: "ready", file_size: size > 0 ? size : row.file_size, updated_at: new Date().toISOString() })
        .eq("id", row.id)
        .eq("organization_id", orgId);
      if (upErr) {
        console.error("[candidates] resume confirm: update failed", upErr);
        missing.push(row.id);
        return;
      }
      ready.push(row.id);
    }),
  );
  const known = new Set(rows.map((r) => r.id));
  for (const id of ids) if (!known.has(id)) missing.push(id);
  return { ready, missing };
}

// Listing --------------------------------------------------------------------------------------------------------------

export interface ResumeListQuery {
  source?: string;
  sourcedRole?: string;
  /** ISO date-times; a file with no download date is left out when either is set. */
  from: string | null;
  to: string | null;
  /** Part of the file name. */
  q: string;
  /** A laptop name, or "none" for files uploaded without one. */
  device: string | null;
  /** Files of one candidate (phase 2). */
  candidateId: string | null;
  /**
   * Linked to a candidate or not (phase 2); "rejected" lists the files removed as not resumes, "other" the kept
   * documents; "duplicate" (owner 2026-11-16) the files that matched a person already in the database.
   */
  link: "" | "linked" | "unlinked" | "rejected" | "other" | "attention" | "duplicate" | "reading";
  page: number;
  pageSize: number;
}

export const NO_DEVICE = "none";

export function parseResumeQuery(params: URLSearchParams): ResumeListQuery {
  const page = Math.max(1, Math.floor(Number(params.get("page")) || 1));
  const pageSize = Math.min(200, Math.max(1, Math.floor(Number(params.get("pageSize")) || RESUME_LIST_PAGE_SIZE)));
  const candidateId = params.get("candidateId");
  const link = params.get("link");
  return {
    from: parseIso(params.get("from")),
    to: parseIso(params.get("to")),
    q: (params.get("q") ?? "").trim().slice(0, 120),
    device: cleanDevice(params.get("device")),
    source: ["naukri", "linkedin", "own", "portal", "vendor", "unknown"].includes(params.get("source") ?? "") ? params.get("source")! : "",
    sourcedRole: (params.get("sourcedRole") ?? "").trim().slice(0, 200),
    candidateId: candidateId && UUID.test(candidateId) ? candidateId.toLowerCase() : null,
    link: link === "linked" || link === "unlinked" || link === "rejected" || link === "other" || link === "attention" || link === "duplicate" || link === "reading" ? link : "",
    page,
    pageSize,
  };
}

interface Filterable<Q> {
  gte(column: string, value: string): Q;
  lte(column: string, value: string): Q;
  ilike(column: string, pattern: string): Q;
  eq(column: string, value: string): Q;
  is(column: string, value: null): Q;
  not(column: string, operator: "is", value: null): Q;
  or(filters: string): Q;
}

function escapeLike(value: string): string {
  return value.replace(/[%_\\]/g, "\\$&");
}

function applyQuery<Q extends Filterable<Q>>(query: Q, q: ResumeListQuery): Q {
  if (q.from) query = query.gte("downloaded_at", q.from);
  if (q.to) query = query.lte("downloaded_at", q.to);
  if (q.q) query = query.ilike("file_name", `%${escapeLike(q.q)}%`);
  if (q.sourcedRole) query = query.ilike("sourced_role", `%${escapeLike(q.sourcedRole)}%`);
  if (q.source === "linkedin") query = query.eq("source_kind", "portal").ilike("source_name", "LinkedIn");
  else if (q.source === "unknown") query = query.is("source_kind", null);
  else if (q.source === "portal") query = query.eq("source_kind", "portal").or("source_name.is.null,source_name.not.ilike.LinkedIn");
  else if (q.source) query = query.eq("source_kind", q.source);
  if (q.device === NO_DEVICE) query = query.is("device_label", null);
  else if (q.device) query = query.eq("device_label", q.device);
  if (q.candidateId) query = query.eq("candidate_id", q.candidateId);
  if (q.link === "linked") query = query.not("candidate_id", "is", null);
  else if (q.link === "unlinked") query = query.is("candidate_id", null);
  // Owner 2026-11-11: the files HR has to look at: text that could not be read, or details that could not.
  else if (q.link === "attention") query = query.or("text_status.eq.unreadable,text_status.eq.failed,extract_status.eq.failed");
  // Owner 2026-11-16: a second CV for a person who already had one, waiting for HR (Update the CV or delete it).
  else if (q.link === "duplicate") query = query.eq("duplicate_state", "pending");
  else if (q.link === "reading") query = query.or("text_status.in.(pending,working,scan,scanning),and(text_status.eq.ready,extract_status.in.(pending,working))");
  return query;
}

/** The rows a query shows: the resumes, or (link = "rejected" / "other") the removed or the kept-aside documents. */
const statusFor = (q: ResumeListQuery) => (q.link === "rejected" || q.link === "other" ? q.link : "ready");

export async function listResumeFiles(client: SupabaseClient, orgId: string, q: ResumeListQuery): Promise<ResumeFilesResponse> {
  const from = (q.page - 1) * q.pageSize;
  // One person's files (the candidate's panel): the newest upload first, so an updated CV is the one shown
  // (owner 2026-11-16). The library: newest download first, as before.
  const run = (columns: string) => {
    const base = applyQuery(client.from(TABLE).select(columns, { count: "exact" }).eq("organization_id", orgId).eq("status", statusFor(q)), q);
    const ordered = q.candidateId
      ? base.order("created_at", { ascending: false })
      : base.order("downloaded_at", { ascending: false, nullsFirst: false }).order("created_at", { ascending: false });
    return ordered.range(from, from + q.pageSize - 1);
  };
  let { data, error, count } = await run(COLUMNS + SOURCE_COLUMNS + ", sourced_role");
  if (error && /sourced_role/.test(error.message ?? "") && !q.sourcedRole) ({ data, error, count } = await run(COLUMNS + SOURCE_COLUMNS));
  if (error && sourceColumnsMissing(error) && !q.source && !q.sourcedRole) ({ data, error, count } = await run(COLUMNS));
  if (error) fail("load the resumes", error);
  const rows = (data ?? []) as unknown as ResumeRow[];
  const names = await candidateNames(client, orgId, rows.map((r) => r.candidate_id));
  const files = rows.map((row) => toFile(row, names));
  await attachAlreadyKnown(client, orgId, files);
  return { files, total: count ?? 0, page: q.page, pageSize: q.pageSize };
}

/** Changes the resume's labels without overwriting the candidate's current job title or original source. */
export async function updateResumeMetadata(client: SupabaseClient, orgId: string, id: string, input: unknown): Promise<void> {
  if (!UUID.test(id)) throw new CandidateActionError(400, "id must be a uuid.");
  const parsed = z.object({ source: ResumeSourceInput, sourcedRole: SourcedRoleInput }).safeParse(input);
  if (!parsed.success) throw new CandidateActionError(400, "Check the source and designation (up to 200 characters).");
  const { source, sourcedRole } = parsed.data;
  const { data, error } = await client.from(TABLE).update({
    source_kind: source.kind, source_name: source.kind ? source.name || null : null,
    sourced_role: sourcedRole || null, updated_at: new Date().toISOString(),
  }).eq("organization_id", orgId).eq("id", id).eq("status", "ready").select("id").maybeSingle();
  if (error) fail("save the resume details", error);
  if (!data) throw new CandidateActionError(404, "That resume is no longer here.");
}

/** Files, bytes and dates per laptop, in all, and how many are linked, unlinked, still being read or unreadable. */
export async function resumeSummary(client: SupabaseClient, orgId: string): Promise<ResumeSummary> {
  const base = () => client.from(TABLE).select("id", { count: "exact", head: true }).eq("organization_id", orgId).eq("status", "ready");
  const ready = () => ({
    not: (...args: Parameters<ReturnType<typeof base>["not"]>) => base().not(...args),
    in: (...args: Parameters<ReturnType<typeof base>["in"]>) => base().in(...args),
    select: (columns: string) => client.from(TABLE).select(columns).eq("organization_id", orgId).eq("status", "ready"),
  });
  const byStatus = (status: string) => client.from(TABLE).select("id", { count: "exact", head: true }).eq("organization_id", orgId).eq("status", status);
  const [{ data, error }, linkedQ, pendingQ, unreadableQ, rejectedQ, otherQ, extractQ, scanQ] = await Promise.all([
    client.rpc("candidate_resume_summary", { p_organization_id: orgId }),
    ready().not("candidate_id", "is", null),
    ready().in("text_status", ["pending", "working", "scan", "scanning"]),
    ready().in("text_status", ["unreadable", "failed"]),
    byStatus("rejected"),
    byStatus("other"),
    // Details still to be read: every file whose text is read or still being read (a file given up on never gets there).
    base().eq("text_status", "ready").in("extract_status", ["pending", "working"]),
    ready().in("text_status", ["scan", "scanning"]),
  ]);
  if (error) fail("count the resumes", error);
  const problem = linkedQ.error ?? pendingQ.error ?? unreadableQ.error ?? rejectedQ.error ?? otherQ.error ?? extractQ.error ?? scanQ.error;
  if (problem) fail("count the resumes", problem);
  const rows = (data ?? []) as {
    device_label: string | null;
    file_count: number | string | bigint;
    total_bytes: number | string | bigint;
    oldest: string | Date | null;
    newest: string | Date | null;
  }[];
  // Phase 3: when each laptop last uploaded (one small query per laptop; there are a handful).
  const devices = await Promise.all(rows.slice(0, 50).map(async (r) => {
    const last = r.device_label === null ? ready().select("created_at").is("device_label", null) : ready().select("created_at").eq("device_label", r.device_label);
    const { data: lastRows, error: lastErr } = await last.order("created_at", { ascending: false }).limit(1);
    if (lastErr) fail("count the resumes", lastErr);
    return {
      label: r.device_label,
      count: Number(r.file_count) || 0,
      bytes: Number(r.total_bytes) || 0,
      oldest: iso(r.oldest),
      newest: iso(r.newest),
      lastUploadedAt: iso((lastRows as { created_at?: unknown }[] | null)?.[0]?.created_at),
    };
  }));
  const dates = devices.flatMap((d) => [d.oldest, d.newest]).filter((d): d is string => Boolean(d)).sort();
  const total = devices.reduce((n, d) => n + d.count, 0);
  const linked = linkedQ.count ?? 0;
  return {
    total,
    totalBytes: devices.reduce((n, d) => n + d.bytes, 0),
    devices,
    oldest: dates[0] ?? null,
    newest: dates[dates.length - 1] ?? null,
    linked,
    unlinked: Math.max(0, total - linked),
    textPending: pendingQ.count ?? 0,
    scanPending: scanQ.count ?? 0,
    unreadable: unreadableQ.count ?? 0,
    rejected: rejectedQ.count ?? 0,
    other: otherQ.count ?? 0,
    extractPending: extractQ.count ?? 0,
  };
}

/** Every matching file (id, name, size), newest first, for the ZIP download; at most RESUME_EXPORT_MAX. */
export async function resumeManifest(client: SupabaseClient, orgId: string, q: ResumeListQuery): Promise<ResumeManifestResponse> {
  const rows = await pageAll(client, orgId, q, "id, file_name, file_size, downloaded_at");
  return {
    files: rows.rows.map((r) => ({ id: r.id, fileName: r.file_name, fileSize: Number(r.file_size) || 0, downloadedAt: iso(r.downloaded_at) })),
    truncated: rows.truncated,
  };
}

async function pageAll(client: SupabaseClient, orgId: string, q: ResumeListQuery, columns: string) {
  const PAGE = 1000;
  const rows: ResumeRow[] = [];
  let truncated = false;
  for (let from = 0; ; from += PAGE) {
    const run = (select: string) => applyQuery(client.from(TABLE).select(select).eq("organization_id", orgId).eq("status", statusFor(q)), q)
      .order("downloaded_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .range(from, from + PAGE - 1);
    let { data, error } = await run(columns);
    if (error && /sourced_role/.test(error.message ?? "") && !q.sourcedRole) ({ data, error } = await run(columns.replace(", sourced_role", "")));
    if (error && sourceColumnsMissing(error) && !q.source && !q.sourcedRole) ({ data, error } = await run(columns.replace(", sourced_role", "").replace(SOURCE_COLUMNS, "")));
    if (error) fail("list the resumes", error);
    const page = (data ?? []) as unknown as ResumeRow[];
    rows.push(...page);
    if (page.length < PAGE) break;
    if (rows.length >= RESUME_EXPORT_MAX) {
      truncated = true;
      break;
    }
  }
  return { rows: rows.slice(0, RESUME_EXPORT_MAX), truncated };
}

// Links and delete -----------------------------------------------------------------------------------------------------

async function getRow(client: SupabaseClient, orgId: string, id: unknown, readyOnly = true): Promise<ResumeRow> {
  if (typeof id !== "string" || !UUID.test(id)) throw new CandidateActionError(400, "id must be a uuid.");
  const { data, error } = await client.from(TABLE).select(COLUMNS).eq("organization_id", orgId).eq("id", id).maybeSingle();
  if (error) fail("load the resume", error);
  const row = data as unknown as ResumeRow | null;
  // A kept document ('other') still has its bytes: HR opens and downloads it like a resume. A removed one does not.
  if (!row || (readyOnly && row.status !== "ready" && row.status !== "other")) throw new CandidateActionError(404, "That resume is no longer here.");
  return row;
}

/**
 * A file's text as it was read (or typed out from a scan), for the candidate's panel: HR reads the resume beside the
 * details without leaving the page. Empty when the file's text could not be read.
 */
export async function resumeFileText(client: SupabaseClient, orgId: string, id: unknown): Promise<{ fileName: string; text: string; fromScan: boolean }> {
  const row = await getRow(client, orgId, id);
  const { data, error } = await client.from(TABLE).select("resume_text").eq("organization_id", orgId).eq("id", row.id).maybeSingle();
  if (error) fail("read the resume", error);
  let fromScan = false;
  const scan = await client.from(TABLE).select("scan_model").eq("organization_id", orgId).eq("id", row.id).maybeSingle();
  if (!scan.error) fromScan = Boolean((scan.data as { scan_model?: string | null } | null)?.scan_model);
  return { fileName: row.file_name, text: ((data as { resume_text?: string | null } | null)?.resume_text ?? "").trim(), fromScan };
}

/** A download link for one file, valid for RESUME_LINK_SECONDS; the browser saves it under its original name. */
export async function resumeLink(client: SupabaseClient, storage: ResumeStorage, orgId: string, id: unknown): Promise<{ url: string; fileName: string }> {
  const row = await getRow(client, orgId, id);
  const { data, error } = await storage.createSignedUrl(row.storage_path, RESUME_LINK_SECONDS, { download: downloadName(row.file_name, row.file_type) });
  if (error || !data) fail("make the download link", error);
  return { url: data.signedUrl, fileName: row.file_name };
}

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

/**
 * Open a resume to read it (owner 2026-11-10, option C): a PDF goes to the browser's own viewer (a link with no
 * download name); a .docx is turned into a page with mammoth (formatting is approximate; the original stays
 * downloadable); anything else downloads. The page is served with a strict content security policy: nothing in a
 * resume can run.
 */
export async function resumeOpen(
  client: SupabaseClient,
  storage: ResumeStorage,
  orgId: string,
  id: unknown,
): Promise<{ kind: "redirect"; url: string } | { kind: "html"; html: string }> {
  const row = await getRow(client, orgId, id);
  const ext = fileExtension(row.file_name);
  if (ext === ".pdf") {
    const { data, error } = await storage.createSignedUrl(row.storage_path, RESUME_LINK_SECONDS);
    if (error || !data) fail("open the resume", error);
    return { kind: "redirect", url: data.signedUrl };
  }
  if (ext === ".docx") {
    const { data, error } = await storage.download(row.storage_path);
    if (error || !data) fail("open the resume", error);
    let body: string;
    try {
      ({ value: body } = await mammoth.convertToHtml({ buffer: Buffer.from(await data.arrayBuffer()) }));
    } catch (e) {
      console.error("[candidates] docx preview failed", e);
      throw new CandidateActionError(422, "This Word file could not be shown as a page. Download it instead.");
    }
    const title = escapeHtml(row.file_name);
    const html =
      `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">` +
      `<title>${title}</title><style>body{margin:0;background:#f3f4f6;font:15px/1.55 Georgia,"Times New Roman",serif;color:#111827}` +
      `main{max-width:820px;margin:24px auto;padding:48px 56px;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.12)}` +
      `h1,h2,h3{line-height:1.25}table{border-collapse:collapse;max-width:100%}td,th{border:1px solid #d1d5db;padding:4px 8px;vertical-align:top}` +
      `img{max-width:100%;height:auto}p{margin:0 0 .6em}.note{max-width:820px;margin:16px auto 0;padding:0 8px;font:13px system-ui,sans-serif;color:#6b7280}` +
      `@media(max-width:640px){main{margin:0;padding:24px 20px}}</style></head><body>` +
      `<p class="note">${title} · shown as a page; the layout of the original Word file may differ.</p><main>${body}</main></body></html>`;
    return { kind: "html", html };
  }
  const { url } = await resumeLink(client, storage, orgId, id);
  return { kind: "redirect", url };
}

/** Download links for up to RESUME_LINK_BATCH files at once (the ZIP download). Files no longer here are left out. */
export async function resumeLinks(client: SupabaseClient, storage: ResumeStorage, orgId: string, input: unknown): Promise<ResumeLinksResponse> {
  const ids = parseIds(input, RESUME_LINK_BATCH);
  const { data, error } = await client.from(TABLE).select("id, file_name, storage_path").eq("organization_id", orgId).eq("status", "ready").in("id", ids);
  if (error) fail("make the download links", error);
  const rows = (data ?? []) as unknown as Pick<ResumeRow, "id" | "file_name" | "storage_path">[];
  if (!rows.length) return { links: [] };
  const { data: signed, error: signErr } = await storage.createSignedUrls(rows.map((r) => r.storage_path), RESUME_LINK_SECONDS);
  if (signErr || !signed) fail("make the download links", signErr);
  const byPath = new Map(signed.filter((s) => s.path && s.signedUrl && !s.error).map((s) => [s.path as string, s.signedUrl as string]));
  return {
    links: rows.flatMap((r) => {
      const url = byPath.get(r.storage_path);
      return url ? [{ id: r.id, url, fileName: r.file_name }] : [];
    }),
  };
}

export const READING_CANCELLED = "Reading cancelled by recruiter";

/** Stop queued work without deleting the original file or changing the candidate. */
export async function cancelResumeReading(client: SupabaseClient, orgId: string, id: unknown): Promise<void> {
  const row = await getRow(client, orgId, id);
  const text = await client.from(TABLE).update({ text_status: "failed", text_error: READING_CANCELLED, extract_status: "skipped", extract_error: READING_CANCELLED })
    .eq("organization_id", orgId).eq("id", row.id).eq("status", "ready").in("text_status", ["pending", "working", "scan", "scanning"]);
  if (text.error) fail("cancel reading", text.error);
  const details = await client.from(TABLE).update({ extract_status: "skipped", extract_error: READING_CANCELLED })
    .eq("organization_id", orgId).eq("id", row.id).eq("status", "ready").eq("text_status", "ready").in("extract_status", ["pending", "working"]);
  if (details.error) fail("cancel reading", details.error);
}

/** Readers must discard results when HR cancelled or deleted a file during the external read. */
export async function resumeReadingStopped(client: SupabaseClient, orgId: string, id: string): Promise<boolean> {
  const { data, error } = await client.from(TABLE).select("status, extract_error").eq("organization_id", orgId).eq("id", id).maybeSingle();
  if (error) fail("check resume reading", error);
  return !data || data.status !== "ready" || data.extract_error === READING_CANCELLED;
}

/** Removes the stored file and its row (a file uploaded by mistake). Not undoable; the file can be uploaded again. */
export async function deleteResumeFile(client: SupabaseClient, storage: ResumeStorage, orgId: string, id: unknown): Promise<void> {
  const row = await getRow(client, orgId, id, false);
  const { error: rmErr } = await storage.remove([row.storage_path]);
  if (rmErr && !/not found/i.test(rmErr.message)) fail("delete the resume", rmErr);
  const { error } = await client.from(TABLE).delete().eq("id", row.id).eq("organization_id", orgId);
  if (error) fail("delete the resume", error);
}

/**
 * Removes up to RESUME_DELETE_BATCH files at once (the list's tick boxes): the stored bytes, then the rows. A row
 * already removed as not a resume has no bytes; deleting it only forgets the file, so it could be uploaded again.
 */
export async function deleteResumeFiles(client: SupabaseClient, storage: ResumeStorage, orgId: string, input: unknown): Promise<{ deleted: number }> {
  const ids = parseIds(input, RESUME_DELETE_BATCH);
  const { data, error } = await client.from(TABLE).select("id, storage_path, status").eq("organization_id", orgId).in("id", ids);
  if (error) fail("delete the resumes", error);
  const rows = (data ?? []) as unknown as Pick<ResumeRow, "id" | "storage_path" | "status">[];
  if (!rows.length) return { deleted: 0 };
  const paths = rows.filter((r) => r.status !== "rejected").map((r) => r.storage_path); // 'other' files still have bytes
  if (paths.length) {
    const { error: rmErr } = await storage.remove(paths);
    if (rmErr && !/not found/i.test(rmErr.message)) fail("delete the resumes", rmErr);
  }
  const { error: delErr } = await client.from(TABLE).delete().eq("organization_id", orgId).in("id", rows.map((r) => r.id));
  if (delErr) fail("delete the resumes", delErr);
  return { deleted: rows.length };
}

// Excel ----------------------------------------------------------------------------------------------------------------

/**
 * The resume sheet: one row per file with an "Open" link back into the portal (a signed-in HR login follows it to the
 * file), plus a summary tab per laptop. Built from the database, so it is always current.
 */
export async function resumeWorkbook(
  client: SupabaseClient,
  orgId: string,
  q: ResumeListQuery,
  linkBase: string,
): Promise<{ workbook: ExcelJS.Workbook; count: number; truncated: boolean }> {
  const [{ rows, truncated }, summary] = await Promise.all([pageAll(client, orgId, q, COLUMNS + SOURCE_COLUMNS + ", sourced_role"), resumeSummary(client, orgId)]);
  const names = await candidateNames(client, orgId, rows.map((r) => r.candidate_id));

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Candidate Search";
  const sheet = workbook.addWorksheet("Resume files", { views: [{ state: "frozen", ySplit: 1 }] });
  sheet.columns = [
    { header: "#", key: "n", width: 6 },
    { header: "File name", key: "name", width: 48 },
    { header: "Type", key: "type", width: 8 },
    { header: "Size (KB)", key: "kb", width: 10 },
    { header: "Downloaded on", key: "downloaded", width: 16, style: { numFmt: "dd-mmm-yyyy" } },
    { header: "User", key: "device", width: 20 },
    { header: "Folder", key: "folder", width: 32 },
    { header: "Uploaded by", key: "by", width: 28 },
    { header: "Uploaded on", key: "uploaded", width: 16, style: { numFmt: "dd-mmm-yyyy" } },
    { header: "Candidate", key: "candidate", width: 28 },
    { header: "Matched by", key: "match", width: 14 },
    { header: "Text", key: "text", width: 16 },
    { header: "Open", key: "link", width: 16 },
    { header: "Source", key: "source", width: 24 },
    { header: "Designation / role sourced for", key: "role", width: 30 },
  ];
  sheet.getRow(1).font = { bold: true };
  rows.forEach((r, i) => {
    const downloaded = iso(r.downloaded_at);
    const uploaded = iso(r.created_at);
    sheet.addRow({
      n: i + 1,
      source: resumeSourceLabel({ kind: r.source_kind ?? null, name: r.source_name ?? null }),
      role: r.sourced_role ?? "",
      name: r.file_name,
      type: fileExtension(r.file_name).slice(1).toUpperCase(),
      kb: Math.round((Number(r.file_size) || 0) / 1024),
      downloaded: downloaded ? new Date(downloaded) : "",
      device: r.device_label ?? "",
      folder: r.folder_path ?? "",
      by: r.uploaded_by_email ?? "",
      uploaded: uploaded ? new Date(uploaded) : "",
      candidate: (r.candidate_id && names.get(r.candidate_id)) || "",
      match: r.candidate_id && r.match_reason ? MATCH_REASON_LABELS[r.match_reason] : "",
      text: r.extract_status === "done" ? "Details read" : TEXT_STATUS_LABELS[r.text_status ?? "pending"],
      link: { text: "Open resume", hyperlink: `${linkBase}/${r.id}?orgId=${encodeURIComponent(orgId)}` },
    });
  });
  if (rows.length) sheet.autoFilter = { from: "A1", to: `O${rows.length + 1}` };

  const totals = workbook.addWorksheet("Summary");
  totals.columns = [
    { header: "User", key: "device", width: 24 },
    { header: "Files", key: "count", width: 10 },
    { header: "Size (MB)", key: "mb", width: 12 },
    { header: "Oldest download", key: "oldest", width: 18, style: { numFmt: "dd-mmm-yyyy" } },
    { header: "Newest download", key: "newest", width: 18, style: { numFmt: "dd-mmm-yyyy" } },
  ];
  totals.getRow(1).font = { bold: true };
  for (const d of summary.devices) {
    totals.addRow({
      device: d.label ?? "(not named)",
      count: d.count,
      mb: Math.round((d.bytes / 1024 / 1024) * 10) / 10,
      oldest: d.oldest ? new Date(d.oldest) : "",
      newest: d.newest ? new Date(d.newest) : "",
    });
  }
  const all = totals.addRow({ device: "All users", count: summary.total, mb: Math.round((summary.totalBytes / 1024 / 1024) * 10) / 10, oldest: summary.oldest ? new Date(summary.oldest) : "", newest: summary.newest ? new Date(summary.newest) : "" });
  all.font = { bold: true };

  return { workbook, count: rows.length, truncated };
}
