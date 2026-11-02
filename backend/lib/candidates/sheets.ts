/** Uploaded sheets: list, soft-delete, restore, data-quality report. */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { SheetRowDb } from "./import";
import { CandidateActionError } from "./records";
import type { CandidateSheet, SheetIssueRow, SheetsResponse } from "./types";

function fail(context: string, error: unknown): never {
  console.error(`[candidates] ${context}`, error);
  throw new CandidateActionError(500, `Couldn't ${context}. Please try again.`);
}

function toSheet(row: SheetRowDb, stats: Map<string | null, { live: number; pending: number }>): CandidateSheet {
  const s = stats.get(row.id);
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    error: row.error,
    rowCount: row.row_count,
    flaggedCount: row.flagged_count,
    skippedCount: row.skipped_count,
    uploadCount: row.upload_count,
    liveRecordCount: s?.live ?? 0,
    pendingIndexCount: s?.pending ?? 0,
    uploadedByEmail: row.uploaded_by_email,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

async function loadStats(client: SupabaseClient, orgId: string) {
  const { data, error } = await client.rpc("candidate_index_stats", { p_organization_id: orgId });
  if (error) fail("count the records", error);
  const stats = new Map<string | null, { live: number; pending: number }>();
  for (const row of (data ?? []) as { sheet_id: string | null; live_count: number; pending_count: number }[]) {
    stats.set(row.sheet_id, { live: row.live_count, pending: row.pending_count });
  }
  return stats;
}

export async function listSheets(client: SupabaseClient, orgId: string, deleted: boolean): Promise<SheetsResponse> {
  let query = client.from("candidate_sheets").select("*").eq("organization_id", orgId);
  query = deleted ? query.not("deleted_at", "is", null) : query.is("deleted_at", null);
  const [{ data, error }, stats, liveSheets] = await Promise.all([
    query.order("created_at", { ascending: false }).limit(500),
    loadStats(client, orgId),
    client.from("candidate_sheets").select("id").eq("organization_id", orgId).eq("status", "ready").is("deleted_at", null),
  ]);
  if (error || liveSheets.error) fail("load the sheets", error ?? liveSheets.error);

  // Waiting for an embedding, counting only records HR can see (hand-added + live sheets).
  const visible = new Set<string | null>([null, ...(liveSheets.data ?? []).map((s) => s.id as string)]);
  let pendingIndexTotal = 0;
  for (const [sheetId, s] of stats) if (visible.has(sheetId)) pendingIndexTotal += s.pending;

  return { sheets: ((data ?? []) as SheetRowDb[]).map((row) => toSheet(row, stats)), pendingIndexTotal };
}

export async function getSheet(client: SupabaseClient, orgId: string, id: string): Promise<SheetRowDb> {
  const { data, error } = await client.from("candidate_sheets").select("*").eq("organization_id", orgId).eq("id", id).maybeSingle();
  if (error) fail("load the sheet", error);
  if (!data) throw new CandidateActionError(404, "That sheet no longer exists.");
  return data as SheetRowDb;
}

export async function getSheetSummary(client: SupabaseClient, orgId: string, id: string): Promise<CandidateSheet> {
  const [row, stats] = await Promise.all([getSheet(client, orgId, id), loadStats(client, orgId)]);
  return toSheet(row, stats);
}

/**
 * Soft-delete a sheet: its records disappear from the table and from search. People who also have records in
 * another sheet, or added by hand, keep those records.
 */
export async function deleteSheet(client: SupabaseClient, orgId: string, userId: string, id: string): Promise<void> {
  const sheet = await getSheet(client, orgId, id);
  if (sheet.deleted_at) return;
  if (sheet.status === "importing") throw new CandidateActionError(409, "This sheet is still importing. Try again in a moment.");
  const now = new Date().toISOString();
  const { error } = await client
    .from("candidate_sheets")
    .update({ deleted_at: now, deleted_by: userId, updated_at: now })
    .eq("id", id)
    .eq("organization_id", orgId)
    .is("deleted_at", null);
  if (error) fail("delete the sheet", error);
}

export async function restoreSheet(client: SupabaseClient, orgId: string, id: string): Promise<CandidateSheet> {
  const sheet = await getSheet(client, orgId, id);
  if (!sheet.deleted_at) return getSheetSummary(client, orgId, id);
  if (sheet.status === "ready") {
    const { data: clash, error: clashError } = await client
      .from("candidate_sheets")
      .select("id, name")
      .eq("organization_id", orgId)
      .eq("name_key", sheet.name_key)
      .eq("status", "ready")
      .is("deleted_at", null)
      .maybeSingle();
    if (clashError) fail("restore the sheet", clashError);
    if (clash) {
      throw new CandidateActionError(
        409,
        `A newer sheet named "${clash.name}" is live. Delete it first, then restore this one.`,
      );
    }
  }
  const { error } = await client
    .from("candidate_sheets")
    .update({ deleted_at: null, deleted_by: null, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("organization_id", orgId);
  if (error) {
    if (error.code === "23505") throw new CandidateActionError(409, "A sheet with this name is live. Delete it first, then restore this one.");
    fail("restore the sheet", error);
  }
  return getSheetSummary(client, orgId, id);
}

/** Rows with problems from the sheet's latest upload. */
export async function sheetIssues(client: SupabaseClient, orgId: string, id: string): Promise<SheetIssueRow[]> {
  const sheet = await getSheet(client, orgId, id);
  const { data, error } = await client
    .from("candidate_sheet_rows")
    .select("row_number, issues, raw")
    .eq("sheet_id", sheet.id)
    .eq("upload_no", sheet.upload_count)
    .neq("issues", "{}")
    .order("row_number")
    .limit(2000);
  if (error) fail("load the issues", error);
  return (data ?? []).map((row) => ({
    rowNumber: row.row_number as number,
    issues: row.issues as string[],
    raw: row.raw as Record<string, string>,
  }));
}
