/**
 * "Already in the database" (owner 2026-11-16; migration 20261116000004).
 *
 * The rule (owner: "a row in the excel sheet maps to a resume, so this shouldn't be flagged"): a CV and the sheet row
 * of the same person are two halves of one sourcing and link quietly. A flag means the person arrived a SECOND time:
 *   - a resume, when the person already had a CV on file (resume-text.ts sets duplicate_state = 'pending'; HR then
 *     picks "Update the CV" or deletes the copy, in the Resumes tab's "Already in the database" section);
 *   - a sheet row, when the person was already in ANOTHER sheet or was entered by hand (a person the system created
 *     from a resume is the same pairing in reverse, and is not flagged).
 * Nothing is rejected and nothing is merged away. The flag says when and how the person was first sourced; it does
 * not name where the copy came from.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { namesOf } from "./actions";
import { RESUME_SOURCE, type SourceKind, type UploadSource } from "./types";

/** The text every flag starts with (the sheet row's note, the history entry). */
export const KNOWN_NOTE = "Already in the database";
/** History entries written under the current rule carry this; earlier ones (every CV-meets-its-row link) are hidden. */
export const KNOWN_RULE = 2;

export interface FirstSourcing {
  /** YYYY-MM-DD */
  at: string | null;
  from: string | null;
  byName: string | null;
  /** The sheet the first record came from, when it came from one. */
  sheetId: string | null;
}

const day = (value: unknown): string | null => {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return typeof value === "string" && value ? value.slice(0, 10) : null;
};

/**
 * The earliest record of each of these people: when, from which sheet (or a resume, or by hand), by whom.
 * `excludeSheetIds`: records of these sheets do not count (the sheet being imported). `skipResumeRecords`: a record
 * the system created from a resume does not count (a sheet row meeting that CV is a pairing, not a second sourcing).
 */
export async function firstSourcing(
  client: SupabaseClient,
  orgId: string,
  candidateIds: string[],
  options: { excludeSheetIds?: (string | null | undefined)[]; skipResumeRecords?: boolean } = {},
): Promise<Map<string, FirstSourcing>> {
  const out = new Map<string, FirstSourcing>();
  const ids = [...new Set(candidateIds.filter(Boolean))];
  if (!ids.length) return out;
  const excluded = new Set((options.excludeSheetIds ?? []).filter((id): id is string => Boolean(id)));
  interface Row { candidate_id: string; sourcing_date: unknown; candidate_source: string | null; created_at: unknown; sheet_id: string | null; created_by: string | null }
  const first = new Map<string, Row>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await client
      .from("candidate_applications")
      .select("candidate_id, sourcing_date, candidate_source, created_at, sheet_id, created_by")
      .eq("organization_id", orgId)
      .in("candidate_id", ids.slice(i, i + 200))
      .is("deleted_at", null)
      .order("created_at");
    if (error) {
      console.error("[candidates] first sourcing lookup failed", error);
      return out;
    }
    for (const row of (data ?? []) as Row[]) {
      if (row.sheet_id && excluded.has(row.sheet_id)) continue;
      if (options.skipResumeRecords && !row.sheet_id && row.candidate_source === RESUME_SOURCE) continue;
      if (!first.has(row.candidate_id)) first.set(row.candidate_id, row);
    }
  }
  const sheetIds = [...new Set([...first.values()].map((r) => r.sheet_id).filter((id): id is string => Boolean(id)))];
  const sheets = new Map<string, string>();
  if (sheetIds.length) {
    const { data } = await client.from("candidate_sheets").select("id, name").eq("organization_id", orgId).in("id", sheetIds);
    for (const row of (data ?? []) as { id: string; name: string }[]) sheets.set(row.id, row.name);
  }
  const names = await namesOf(client, [...first.values()].map((r) => r.created_by ?? "").filter(Boolean));
  for (const [candidateId, row] of first) {
    out.set(candidateId, {
      at: day(row.sourcing_date) ?? day(row.created_at),
      from: row.sheet_id ? sheets.get(row.sheet_id) ?? null : row.candidate_source === RESUME_SOURCE ? "a resume" : "added by hand",
      byName: row.created_by ? names.get(row.created_by) ?? null : null,
      sheetId: row.sheet_id ?? null,
    });
  }
  return out;
}

/** "Already in the database: sourced 2026-11-09 from June.xlsx by Shwetha" (what is known of it). */
export function knownNote(first: FirstSourcing | undefined): string {
  if (!first) return KNOWN_NOTE;
  const parts = [
    first.at ? `sourced ${first.at}` : "sourced earlier",
    first.from ? `from ${first.from}` : null,
    first.byName ? `by ${first.byName}` : null,
  ].filter(Boolean);
  return `${KNOWN_NOTE}: ${parts.join(" ")}`;
}

/** "from vendor Talent Hub", "from Naukri", "from a job portal (LinkedIn)", "from our own search", or "" (a sheet card's own source line). */
export function sourceLabel(source: UploadSource | { kind: SourceKind | null; name: string | null } | null | undefined): string {
  if (!source?.kind) return "";
  if (source.kind === "vendor") return source.name ? `from vendor ${source.name}` : "from a vendor";
  if (source.kind === "portal") return source.name ? `from a job portal (${source.name})` : "from a job portal";
  if (source.kind === "naukri") return "from Naukri";
  return "from our own search";
}

/** The two columns an upload row carries, when the upload said where it came from. */
export function sourceColumns(source: UploadSource | null | undefined): { source_kind: SourceKind | null; source_name: string | null } | Record<string, never> {
  if (!source || (!source.kind && !source.name)) return {};
  return { source_kind: source.kind, source_name: source.name?.trim().slice(0, 120) || null };
}

/** Migration 20261116000004 not applied: a column it adds is missing (42703 / PGRST204 name the column). */
export function sourceColumnsMissing(error: { code?: string; message?: string } | null | undefined): boolean {
  return Boolean(error) && (["42703", "PGRST204"].includes(error?.code ?? "") || /source_kind|source_name|duplicate_state|duplicate_resolved/.test(error?.message ?? ""));
}

let flagMissingAt = 0;
const FLAG_RECHECK_MS = 5 * 60 * 1000;

export interface KnownFlag {
  candidateId: string;
  applicationId?: string | null;
  /** Who brought this copy in (the uploader); null when the system did. */
  by: { id: string | null; name: string | null };
  /** What was flagged: { source: "resume" | "sheet", ... } plus `first`. `rule` is added here. */
  meta: Record<string, unknown>;
}

/**
 * One `duplicate_flagged` history entry per person. Never throws and never fails the import or the link that called
 * it: before migration 20261116000004 the action is refused (or the table is missing), which is logged once.
 */
export async function flagKnownPeople(client: SupabaseClient, orgId: string, flags: KnownFlag[]): Promise<void> {
  if (!flags.length || Date.now() - flagMissingAt < FLAG_RECHECK_MS) return;
  const rows = flags.map((f) => ({
    organization_id: orgId,
    candidate_id: f.candidateId,
    application_id: f.applicationId ?? null,
    action: "duplicate_flagged",
    to_value: KNOWN_NOTE,
    meta: { ...f.meta, rule: KNOWN_RULE },
    created_by: f.by.id,
    created_by_name: f.by.name,
  }));
  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await client.from("candidate_actions").insert(rows.slice(i, i + 200));
    if (!error) continue;
    const code = (error as { code?: string }).code ?? "";
    if (["42P01", "42703", "PGRST204", "PGRST205", "23514"].includes(code) || /does not exist|schema cache|action_check/i.test(error.message ?? "")) {
      flagMissingAt = Date.now();
      console.warn("[candidates] 'already in the database' not written to history: migration 20261116000004 not applied");
      return;
    }
    console.error("[candidates] 'already in the database' history failed", error);
    return;
  }
}

/** Tests only. */
export function resetKnownFlagCheck(): void {
  flagMissingAt = 0;
}
