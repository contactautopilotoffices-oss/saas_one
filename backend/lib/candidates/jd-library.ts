/**
 * The JD library (owner 2026-11-17, "go ahead with the JD library"; migration 20261117000002). Stage 3 of the
 * Recruitment Module spec: "Pick a JD from the library or create one ... version-controls the JD".
 *
 *   candidate_jds          : one job description per role (title, department), its current version number, a preview
 *                            of the current text, and when a position last used it. Soft-deleted.
 *   candidate_jd_versions  : every saved text, numbered. Never edited (a trigger refuses it): an edit whose text
 *                            differs adds the next version; renaming alone adds none.
 *   candidate_jd_uses      : the JD and version a position was opened from, one row per position, so an old position
 *                            keeps showing what it was opened with after the JD changes.
 * No model is called here: a JD picked from the library is read into the position form by the same reader as a pasted
 * one (positions/read).
 *
 * Access is the caller's job (requireCandidateAccess); everything here runs with the service role.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import type { Actor } from "./actions";
import { MAX_JD_LENGTH } from "./config";
import { CandidateActionError } from "./records";
import type { JdDetail, JdSummary, JdVersion, PositionJd } from "./types";

const JDS = "candidate_jds";
const VERSIONS = "candidate_jd_versions";
const USES = "candidate_jd_uses";
const JD_COLUMNS = "id, title, department, current_version, preview, last_used_at, updated_by_name, created_at, updated_at";
const PREVIEW_CHARS = 220;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const JD_MIGRATION_MESSAGE = "The JD library needs a database update first: run 20261117000002_jd_library.sql in Supabase.";

/** Migration 20261117000002 not applied: a library table is missing. */
export function jdTablesMissing(error: { code?: string; message?: string } | null | undefined): boolean {
  return Boolean(error) && (["42P01", "PGRST205", "42703", "PGRST204"].includes(error?.code ?? "") || /candidate_jd/.test(error?.message ?? ""));
}

function fail(what: string, error: { code?: string; message?: string }): never {
  if (jdTablesMissing(error)) throw new CandidateActionError(503, JD_MIGRATION_MESSAGE);
  console.error(`[candidates] JD library: ${what}`, error);
  throw new CandidateActionError(500, `Couldn't ${what}. Please try again.`);
}

const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : typeof v === "string" ? v : "");
const preview = (content: string) => content.replace(/\s+/g, " ").trim().slice(0, PREVIEW_CHARS);

interface JdRow {
  id: string; title: string; department: string | null; current_version: number; preview: string | null;
  last_used_at: unknown; updated_by_name: string | null; created_at: unknown; updated_at: unknown;
}

function toSummary(row: JdRow, positions: number): JdSummary {
  return {
    id: row.id,
    title: row.title,
    department: row.department ?? null,
    currentVersion: Number(row.current_version) || 1,
    preview: row.preview ?? "",
    updatedAt: iso(row.updated_at),
    updatedByName: row.updated_by_name ?? null,
    lastUsedAt: row.last_used_at ? iso(row.last_used_at) : null,
    positions,
  };
}

/** The live positions opened from these JDs: jd id -> [{ position, version }]. */
async function usesOf(client: SupabaseClient, orgId: string, jdIds: string[]): Promise<Map<string, { positionId: string; version: number; title: string; status: "open" | "closed" }[]>> {
  const out = new Map<string, { positionId: string; version: number; title: string; status: "open" | "closed" }[]>();
  if (!jdIds.length) return out;
  const { data, error } = await client.from(USES).select("jd_id, position_id, version").eq("organization_id", orgId).in("jd_id", jdIds);
  if (error) fail("load where the JDs are used", error);
  const uses = (data ?? []) as { jd_id: string; position_id: string; version: number }[];
  if (!uses.length) return out;
  const { data: positions, error: posErr } = await client
    .from("candidate_positions").select("id, title, status").eq("organization_id", orgId).in("id", uses.map((u) => u.position_id)).is("deleted_at", null);
  if (posErr) fail("load where the JDs are used", posErr);
  const live = new Map(((positions ?? []) as { id: string; title: string; status: "open" | "closed" }[]).map((p) => [p.id, p]));
  for (const u of uses) {
    const p = live.get(u.position_id);
    if (!p) continue;
    out.set(u.jd_id, [...(out.get(u.jd_id) ?? []), { positionId: p.id, version: Number(u.version) || 1, title: p.title, status: p.status }]);
  }
  return out;
}

/** The library, most recently changed first; `q` narrows by title or department. */
export async function listJds(client: SupabaseClient, orgId: string, q = ""): Promise<JdSummary[]> {
  const { data, error } = await client.from(JDS).select(JD_COLUMNS).eq("organization_id", orgId).is("deleted_at", null).order("updated_at", { ascending: false }).limit(300);
  if (error) fail("load the JD library", error);
  const needle = q.trim().toLowerCase();
  const rows = ((data ?? []) as unknown as JdRow[]).filter((r) => !needle || `${r.title} ${r.department ?? ""}`.toLowerCase().includes(needle));
  const uses = await usesOf(client, orgId, rows.map((r) => r.id));
  return rows.map((r) => toSummary(r, uses.get(r.id)?.length ?? 0));
}

async function loadJd(client: SupabaseClient, orgId: string, id: unknown): Promise<JdRow> {
  if (typeof id !== "string" || !UUID.test(id)) throw new CandidateActionError(404, "That JD is no longer in the library.");
  const { data, error } = await client.from(JDS).select(JD_COLUMNS).eq("organization_id", orgId).eq("id", id).is("deleted_at", null).maybeSingle();
  if (error) fail("load the JD", error);
  if (!data) throw new CandidateActionError(404, "That JD is no longer in the library.");
  return data as unknown as JdRow;
}

/** One JD with every version (newest first) and the positions opened from it. */
export async function getJd(client: SupabaseClient, orgId: string, id: string): Promise<JdDetail> {
  const row = await loadJd(client, orgId, id);
  const { data, error } = await client.from(VERSIONS).select("version, content, file_name, note, created_by_name, created_at").eq("organization_id", orgId).eq("jd_id", row.id).order("version", { ascending: false });
  if (error) fail("load the JD's versions", error);
  const versions: JdVersion[] = ((data ?? []) as Record<string, unknown>[]).map((v) => ({
    version: Number(v.version),
    content: (v.content as string) ?? "",
    fileName: (v.file_name as string | null) ?? null,
    note: (v.note as string | null) ?? null,
    byName: (v.created_by_name as string | null) ?? null,
    at: iso(v.created_at),
  }));
  const usedBy = (await usesOf(client, orgId, [row.id])).get(row.id) ?? [];
  return { ...toSummary(row, usedBy.length), versions, usedBy };
}

const text = (max: number) => z.string().trim().max(max);
const JdInput = z.object({
  title: text(120).min(1, "Give the JD a title (the role)."),
  department: text(80).nullable().optional(),
  content: z.string().trim().min(40, "Paste the whole job description: at least a few lines.").max(MAX_JD_LENGTH, `Keep a JD under ${MAX_JD_LENGTH.toLocaleString("en-IN")} characters.`),
  fileName: text(200).nullable().optional(),
  note: text(200).nullable().optional(),
});

async function addVersion(client: SupabaseClient, orgId: string, by: Actor, jdId: string, version: number, input: { content: string; fileName?: string | null; note?: string | null }): Promise<void> {
  const { error } = await client.from(VERSIONS).insert({
    organization_id: orgId, jd_id: jdId, version, content: input.content, file_name: input.fileName || null, note: input.note || null,
    created_by: by.id, created_by_name: by.name, created_at: new Date().toISOString(),
  });
  if (error) {
    if ((error as { code?: string }).code === "23505") throw new CandidateActionError(409, "Someone saved this JD at the same moment. Open it again and save once more.");
    fail("save the JD's text", error);
  }
}

/** A new JD in the library, as version 1. */
export async function createJd(client: SupabaseClient, orgId: string, by: Actor, body: unknown): Promise<JdDetail> {
  const parsed = JdInput.safeParse(body ?? {});
  if (!parsed.success) throw new CandidateActionError(400, parsed.error.issues[0]?.message ?? "Those details are not valid.");
  const input = parsed.data;
  const now = new Date().toISOString();
  const { data, error } = await client.from(JDS).insert({
    organization_id: orgId, title: input.title, department: input.department || null, current_version: 1, preview: preview(input.content),
    created_by: by.id, created_by_name: by.name, updated_by_name: by.name, created_at: now, updated_at: now,
  }).select("id").single();
  if (error) fail("save the JD", error);
  const id = (data as { id: string }).id;
  await addVersion(client, orgId, by, id, 1, input);
  return getJd(client, orgId, id);
}

/**
 * Edits a JD. A text that differs from the current version is saved as the next version (the old ones stay); a new
 * title or department alone changes the JD, not its versions.
 */
export async function updateJd(client: SupabaseClient, orgId: string, by: Actor, id: string, body: unknown): Promise<JdDetail> {
  const parsed = JdInput.partial().safeParse(body ?? {});
  if (!parsed.success) throw new CandidateActionError(400, parsed.error.issues[0]?.message ?? "Those details are not valid.");
  const input = parsed.data;
  const row = await loadJd(client, orgId, id);
  const now = new Date().toISOString();
  const changes: Record<string, unknown> = {};
  if (input.title !== undefined) changes.title = input.title;
  if (input.department !== undefined) changes.department = input.department || null;

  if (input.content !== undefined) {
    const { data: current, error } = await client.from(VERSIONS).select("content").eq("organization_id", orgId).eq("jd_id", row.id).eq("version", row.current_version).maybeSingle();
    if (error) fail("load the JD", error);
    if (((current as { content?: string } | null)?.content ?? "").trim() !== input.content) {
      const next = (Number(row.current_version) || 1) + 1;
      await addVersion(client, orgId, by, row.id, next, { content: input.content, fileName: input.fileName, note: input.note });
      changes.current_version = next;
      changes.preview = preview(input.content);
    }
  }
  if (Object.keys(changes).length) {
    const { error } = await client.from(JDS).update({ ...changes, updated_by_name: by.name, updated_at: now }).eq("organization_id", orgId).eq("id", row.id);
    if (error) fail("save the JD", error);
  }
  return getJd(client, orgId, row.id);
}

/** A copy of the JD's current text as a new JD (version 1), for a similar role. */
export async function duplicateJd(client: SupabaseClient, orgId: string, by: Actor, id: string, titleInput?: unknown): Promise<JdDetail> {
  const source = await getJd(client, orgId, id);
  const current = source.versions.find((v) => v.version === source.currentVersion) ?? source.versions[0];
  if (!current) throw new CandidateActionError(409, "That JD has no text to copy.");
  const title = typeof titleInput === "string" && titleInput.trim() ? titleInput.trim() : `${source.title} (copy)`;
  return createJd(client, orgId, by, { title, department: source.department, content: current.content, fileName: current.fileName, note: `Copied from ${source.title} v${source.currentVersion}` });
}

/** Takes a JD out of the library (soft). Its versions and the positions opened from it are kept. */
export async function deleteJd(client: SupabaseClient, orgId: string, id: string): Promise<void> {
  const row = await loadJd(client, orgId, id);
  const now = new Date().toISOString();
  const { error } = await client.from(JDS).update({ deleted_at: now, updated_at: now }).eq("organization_id", orgId).eq("id", row.id);
  if (error) fail("delete the JD", error);
}

const LinkInput = z.object({
  jdId: z.string().regex(UUID).nullish(),
  version: z.number().int().min(1).nullish(),
  /** Save the position's JD text to the library: a new JD, or (with jdId) the next version of that one. */
  save: z.boolean().optional(),
});

/**
 * Records which library JD (and version) a position was opened from, after the position is saved. With `save`, the
 * position's JD text goes into the library first: as a new JD named after the position, or as the next version of
 * the picked one when its text was changed. Returns what was recorded, or a sentence for HR when it could not be
 * (the position itself is already saved either way).
 */
export async function linkPositionJd(
  client: SupabaseClient,
  orgId: string,
  by: Actor,
  position: { id: string; title: string; department: string | null; jdText: string | null; jdFileName: string | null },
  body: unknown,
): Promise<{ jd: PositionJd | null; notice: string | null }> {
  const parsed = LinkInput.safeParse(body ?? {});
  if (!parsed.success) return { jd: null, notice: "The JD library link was not understood, so it was not saved." };
  const { jdId, save } = parsed.data;
  if (jdId === null && !save) {
    // "Unlink" on an edit: the position no longer says it came from a library JD.
    const { error } = await client.from(USES).delete().eq("organization_id", orgId).eq("position_id", position.id);
    if (error && !jdTablesMissing(error)) console.error("[candidates] JD unlink failed", error);
    return { jd: null, notice: null };
  }
  if (!jdId && !save) return { jd: null, notice: null };
  try {
    let jd: JdDetail;
    let version: number;
    const content = (position.jdText ?? "").trim();
    if (!jdId) {
      if (!content) return { jd: null, notice: "The position has no JD text, so nothing was added to the library." };
      jd = await createJd(client, orgId, by, { title: position.title, department: position.department, content, fileName: position.jdFileName });
      version = jd.currentVersion;
    } else if (save && content) {
      jd = await updateJd(client, orgId, by, jdId, { content, fileName: position.jdFileName, note: `Saved from the position ${position.title}` });
      version = jd.currentVersion;
    } else {
      jd = await getJd(client, orgId, jdId);
      const asked = parsed.data.version ?? jd.currentVersion;
      if (!jd.versions.some((v) => v.version === asked)) return { jd: null, notice: `${jd.title} has no version ${asked}.` };
      version = asked;
    }
    const now = new Date().toISOString();
    // One link per position: an edit that picks another JD replaces it.
    const { error: delErr } = await client.from(USES).delete().eq("organization_id", orgId).eq("position_id", position.id);
    if (delErr) fail("link the JD", delErr);
    const { error } = await client.from(USES).insert({ organization_id: orgId, jd_id: jd.id, version, position_id: position.id, created_by: by.id, created_at: now });
    if (error) fail("link the JD", error);
    await client.from(JDS).update({ last_used_at: now }).eq("organization_id", orgId).eq("id", jd.id);
    return { jd: { id: jd.id, title: jd.title, version, currentVersion: jd.currentVersion }, notice: null };
  } catch (error) {
    if (error instanceof CandidateActionError) return { jd: null, notice: `The position is saved; the JD library was not updated: ${error.message}` };
    throw error;
  }
}

/** The library JD each of these positions came from. Quiet before the migration (an empty map). */
export async function jdLinksFor(client: SupabaseClient, orgId: string, positionIds: string[]): Promise<Map<string, PositionJd>> {
  const out = new Map<string, PositionJd>();
  if (!positionIds.length) return out;
  const { data, error } = await client.from(USES).select("position_id, jd_id, version").eq("organization_id", orgId).in("position_id", positionIds);
  if (error) {
    if (!jdTablesMissing(error)) console.error("[candidates] JD links failed", error);
    return out;
  }
  const uses = (data ?? []) as { position_id: string; jd_id: string; version: number }[];
  if (!uses.length) return out;
  const { data: jds } = await client.from(JDS).select("id, title, current_version").eq("organization_id", orgId).in("id", [...new Set(uses.map((u) => u.jd_id))]);
  const byId = new Map(((jds ?? []) as { id: string; title: string; current_version: number }[]).map((j) => [j.id, j]));
  for (const u of uses) {
    const j = byId.get(u.jd_id);
    if (j) out.set(u.position_id, { id: j.id, title: j.title, version: Number(u.version) || 1, currentVersion: Number(j.current_version) || 1 });
  }
  return out;
}
