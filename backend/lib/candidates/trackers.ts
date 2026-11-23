/**
 * Connected trackers (owner 2026-11-21; HRMS meeting item 5, "standard tracker Excel sheet integration"; migration
 * 20261121000002). HR pastes the share link of a Google Sheet or an Excel file, picks the tab, matches its columns to
 * the candidate fields and its status values to the pipeline stages; the app then pulls the tab on a schedule.
 *
 * The owner's rules (2026-11-21):
 *   - one way, sheet -> app: nothing is ever written to the sheet;
 *   - the status column moves people between pipeline stages (HR says which text means which stage);
 *   - the role column puts a person in the open position with the same title;
 *   - a sheet cell only changes the app when it changed in the sheet since the last sync, so an edit made in the app
 *     to a cell the sheet did not touch stays;
 *   - the sheet is shared "Anyone with the link can view" (no Google sign-in): the server downloads it as a file.
 *
 * Rows go through the sheet upload's cleaning (parse-sheet.ts cleanRow) and its Merge import (import.ts) into one
 * candidate sheet per connection (Recruitment -> Sheets), so people are matched by email, then phone, and nothing is
 * deleted when a row leaves the sheet. Only the rows that changed are imported each time.
 */
import { createHash, randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";
import { z } from "zod";

import type { Actor } from "./actions";
import { findLiveSheetByName, groupPeople, importSheet, loadPeopleByContact, loadSheetRecords, personValues, recordKey } from "./import";
import { cleanRow, fieldForHeader, isHeaderLine, type CleanRow, type ParsedSheet, type SheetField, type SheetRow } from "./parse-sheet";
import { addMembers, listPositions, moveMember } from "./positions";
import { CandidateActionError } from "./records";
import { findStage } from "./stage-list";
import { loadStages } from "./stages";
import { TRACKER_FIELD_LABELS, TRACKER_FIELDS, TRACKER_SYNC_EVERY, type TrackerColumnTarget, type TrackerConnection, type TrackerField, type TrackerImportPreview, type TrackerImportRow, type TrackerPreview, type TrackerSyncSummary } from "./types";

const CONNECTIONS = "candidate_tracker_connections";
const SNAPSHOTS = "candidate_tracker_rows";
const SYNCS = "candidate_tracker_syncs";
export const TRACKERS_MIGRATION_MESSAGE = "Connected trackers need a database update first: run 20261121000002_candidate_tracker_connections.sql and 20261122000004_tracker_preview.sql in Supabase.";
/** A tracker file is at most this big (the sheet upload allows 4 MB; a shared tracker grows). */
export const MAX_TRACKER_BYTES = 15 * 1024 * 1024;
const MAX_TRACKER_ROWS = 10_000;
/** The stage moves of one sync stop here; the rest wait for the next sync (a function call has 60 s). */
const STAGE_BUDGET_MS = 35_000;

const missingRelation = (error: { code?: string; message?: string } | null | undefined) =>
  Boolean(error) && (["42P01", "42703", "PGRST205", "PGRST204"].includes(error?.code ?? "") || /candidate_tracker|does not exist|schema cache/i.test(error?.message ?? ""));

function fail(what: string, error: { code?: string; message?: string }): never {
  if (missingRelation(error)) throw new CandidateActionError(503, TRACKERS_MIGRATION_MESSAGE);
  console.error(`[candidates] trackers: ${what}`, error);
  throw new CandidateActionError(500, `Couldn't ${what}. Please try again.`);
}

const iso = (v: unknown): string | null => (v === null || v === undefined ? null : v instanceof Date ? v.toISOString() : String(v));
const norm = (s: unknown) => String(s ?? "").replace(/\s+/g, " ").trim().toLowerCase();
function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).replace(/\s+/g, " ").trim();
}

// The link -------------------------------------------------------------------------------------------------------------

/** Where a share link is downloaded from. Only Google Sheets and Microsoft (OneDrive / SharePoint) links are accepted. */
export function trackerSource(input: unknown): { kind: "google_sheet" | "excel_link"; url: string; downloadUrl: string } {
  const raw = String(input ?? "").trim();
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new CandidateActionError(400, "Paste the sheet's share link (it starts with https://).");
  }
  if (url.protocol !== "https:") throw new CandidateActionError(400, "The link must start with https://.");
  const host = url.hostname.toLowerCase();
  if (host === "docs.google.com") {
    const id = url.pathname.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]{20,})/)?.[1];
    if (!id) throw new CandidateActionError(400, "That Google link is not a spreadsheet. Open the sheet and copy the link from the address bar or Share.");
    return { kind: "google_sheet", url: `https://docs.google.com/spreadsheets/d/${id}/edit`, downloadUrl: `https://docs.google.com/spreadsheets/d/${id}/export?format=xlsx` };
  }
  if (host === "1drv.ms" || host === "onedrive.live.com") {
    // OneDrive's sharing API takes the share link itself, base64url-encoded.
    const encoded = Buffer.from(raw, "utf8").toString("base64").replace(/=+$/, "").replace(/\//g, "_").replace(/\+/g, "-");
    return { kind: "excel_link", url: raw, downloadUrl: `https://api.onedrive.com/v1.0/shares/u!${encoded}/root/content` };
  }
  if (host.endsWith(".sharepoint.com")) {
    const dl = new URL(raw);
    dl.searchParams.set("download", "1");
    return { kind: "excel_link", url: raw, downloadUrl: dl.toString() };
  }
  throw new CandidateActionError(400, "Only Google Sheets and Excel (OneDrive or SharePoint) share links can be connected.");
}

/** Hosts a download may go to, redirects included (each hop is checked: the server never fetches anywhere else). */
const ALLOWED_HOSTS = [/^docs\.google\.com$/, /\.googleusercontent\.com$/, /^1drv\.ms$/, /(^|\.)onedrive\.live\.com$/, /(^|\.)onedrive\.com$/, /\.1drv\.com$/, /\.sharepoint\.com$/, /\.live\.com$/];
const allowedHost = (host: string) => ALLOWED_HOSTS.some((re) => re.test(host.toLowerCase()));

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/** Downloads the shared file (following up to 5 redirects to allowed hosts), at most MAX_TRACKER_BYTES. */
export async function downloadTracker(downloadUrl: string, fetchImpl: FetchLike = fetch): Promise<Uint8Array> {
  let url = downloadUrl;
  for (let hop = 0; hop < 6; hop += 1) {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || !allowedHost(parsed.hostname)) throw new CandidateActionError(400, "The link points somewhere the app does not read from.");
    let res: Response;
    try {
      res = await fetchImpl(url, { redirect: "manual", signal: AbortSignal.timeout(20_000), headers: { "User-Agent": "TrackerSync/1.0" } });
    } catch {
      throw new CandidateActionError(502, "Couldn't reach the sheet. Check the link and try again.");
    }
    if (res.status >= 300 && res.status < 400) {
      const next = res.headers.get("location");
      if (!next) break;
      url = new URL(next, url).toString();
      continue;
    }
    if (res.status === 401 || res.status === 403 || res.status === 404) {
      throw new CandidateActionError(400, "Can't read this sheet. Share it as \"Anyone with the link can view\" and try again.");
    }
    if (!res.ok) throw new CandidateActionError(502, `The sheet's site answered ${res.status}. Try again in a few minutes.`);
    if (/text\/html/i.test(res.headers.get("content-type") ?? "")) {
      // A sign-in page instead of the file: the sheet is private.
      throw new CandidateActionError(400, "Can't read this sheet. Share it as \"Anyone with the link can view\" and try again.");
    }
    const declared = Number(res.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > MAX_TRACKER_BYTES) throw new CandidateActionError(413, "The sheet is too large to sync (over 15 MB).");
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.byteLength > MAX_TRACKER_BYTES) throw new CandidateActionError(413, "The sheet is too large to sync (over 15 MB).");
    return bytes;
  }
  throw new CandidateActionError(502, "The sheet's link redirected too many times.");
}

function readWorkbook(bytes: Uint8Array): XLSX.WorkBook {
  try {
    return XLSX.read(bytes, { type: "array", cellDates: false, dense: true });
  } catch {
    throw new CandidateActionError(422, "The file could not be read as a spreadsheet.");
  }
}

function gridOf(workbook: XLSX.WorkBook, tab: string): unknown[][] {
  const sheet = workbook.Sheets[tab];
  if (!sheet) throw new CandidateActionError(404, `The tab "${tab}" is not in the sheet any more. Edit the connection and pick the tab again.`);
  return XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: null, blankrows: true });
}

/** The header texts of a row, blanks named by position (as the sheet upload does). */
const headersOf = (grid: unknown[][], headerRow: number) => (grid[headerRow - 1] ?? []).map((h, i) => cellText(h) || `Column ${i + 1}`);

/** The first of the top 15 rows that names a candidate column and two more known columns (1-based); 1 when none does. */
function guessHeaderRow(grid: unknown[][]): number {
  for (let i = 0; i < Math.min(grid.length, 15); i += 1) {
    const fields = new Set((grid[i] ?? []).map(fieldForHeader).filter(Boolean));
    if (fields.has("fullName") && fields.size >= 3) return i + 1;
  }
  return 1;
}

interface Block { headers: string[]; rows: { line: unknown[]; rowNumber: number }[] }

/**
 * The tab's blocks: the header row HR picked, and every later header row. Owner's tracker (2026-11-21): the
 * "dashboard Standard Tracker" tab starts its columns again at rows 561 and 588 with a "Sourcing Date" column added,
 * so each block is read with its own columns, and a header row is never taken for a candidate.
 */
function blocksOf(grid: unknown[][], headerRow: number): Block[] {
  const blocks: Block[] = [{ headers: headersOf(grid, headerRow), rows: [] }];
  for (let r = headerRow; r < grid.length; r += 1) {
    const line = grid[r] ?? [];
    if (line.every((cell) => cellText(cell) === "")) continue;
    if (isHeaderLine(line)) { blocks.push({ headers: line.map((h, i) => cellText(h) || `Column ${i + 1}`), rows: [] }); continue; }
    blocks[blocks.length - 1].rows.push({ line, rowNumber: r + 1 });
  }
  for (const block of blocks) {
    const width = block.rows.reduce((n, r) => Math.max(n, r.line.length), block.headers.length);
    while (block.headers.length < width) block.headers.push(`Column ${block.headers.length + 1}`);
  }
  return blocks;
}

/** Each column's field in a block: HR's matching for the header, else the app's guess; a field once per block. */
function fieldsOf(headers: string[], columnMap: Record<string, TrackerColumnTarget> | null): (TrackerField | null)[] {
  const used = new Set<TrackerField>();
  return headers.map((h) => {
    const f = columnMap && h in columnMap ? columnMap[h] : (fieldForHeader(h) as TrackerField | null);
    if (!f || f === "extra" || used.has(f)) return null;
    used.add(f);
    return f;
  });
}

/** Reads a link: its tabs and, for the chosen tab (else the first that looks like a tracker), the columns and values. */
export async function previewTracker(input: { url: unknown; tab?: unknown; headerRow?: unknown }, fetchImpl: FetchLike = fetch): Promise<TrackerPreview> {
  const source = trackerSource(input.url);
  const workbook = readWorkbook(await downloadTracker(source.downloadUrl, fetchImpl));
  const tabs = workbook.SheetNames.slice();
  if (!tabs.length) throw new CandidateActionError(422, "The sheet has no tabs.");
  let tab = typeof input.tab === "string" && tabs.includes(input.tab) ? input.tab : null;
  if (!tab) tab = tabs.find((t) => { const g = gridOf(workbook, t); return guessHeaderRow(g) > 1 || new Set((g[0] ?? []).map(fieldForHeader).filter(Boolean)).has("fullName"); }) ?? tabs[0];
  const grid = gridOf(workbook, tab);
  const wanted = Number(input.headerRow);
  const headerRow = Number.isInteger(wanted) && wanted >= 1 && wanted <= 50 ? wanted : guessHeaderRow(grid);
  const blocks = blocksOf(grid, headerRow);
  // Every column name in the tab, in order of first appearance (a later block may add or rename columns).
  const headers: string[] = [];
  const guess: Record<string, TrackerField | null> = Object.create(null);
  const examples: Record<string, string> = Object.create(null);
  const values = new Map<string, Map<string, string>>();
  for (const block of blocks) {
    const fields = fieldsOf(block.headers, null);
    block.headers.forEach((h, c) => {
      if (!(h in guess)) { headers.push(h); guess[h] = fields[c]; }
      const seen = values.get(h) ?? new Map<string, string>();
      values.set(h, seen);
      for (const { line } of block.rows) {
        const v = cellText(line[c]);
        if (!v) continue;
        if (!examples[h]) examples[h] = v;
        if (seen.size <= 60 && !seen.has(norm(v))) seen.set(norm(v), v);
      }
    });
  }
  const distinct: Record<string, string[]> = Object.create(null);
  for (const [h, seen] of values) if (seen.size && seen.size <= 60) distinct[h] = [...seen.values()].sort((a, b) => a.localeCompare(b));
  const statusColumnGuess = headers.find((h) => /status|screening|stage/i.test(h) && distinct[h]) ?? null;
  return {
    sourceKind: source.kind, tabs, tab, headerRow, headers, guess, statusColumnGuess, examples,
    rowCount: blocks.reduce((n, b) => n + b.rows.length, 0), blocks: blocks.length, distinct,
  };
}

// Connections ----------------------------------------------------------------------------------------------------------

const COLUMNS = "id, name, source_url, source_kind, tab_name, header_row, column_map, status_column, status_map, sync_every, active, sheet_id, syncing_since, last_synced_at, last_ok, last_error, last_summary, created_by, created_at, updated_at, reviewed_at, skipped_keys";

function toConnection(row: Record<string, unknown>): TrackerConnection {
  const since = iso(row.syncing_since);
  return {
    id: row.id as string,
    name: row.name as string,
    sourceUrl: row.source_url as string,
    sourceKind: row.source_kind as TrackerConnection["sourceKind"],
    tabName: row.tab_name as string,
    headerRow: Number(row.header_row) || 1,
    columnMap: (row.column_map as TrackerConnection["columnMap"]) ?? {},
    statusColumn: (row.status_column as string | null) ?? null,
    statusMap: (row.status_map as Record<string, string>) ?? {},
    syncEvery: row.sync_every as TrackerConnection["syncEvery"],
    active: row.active !== false,
    sheetId: (row.sheet_id as string | null) ?? null,
    syncing: Boolean(since && Date.now() - new Date(since).getTime() < 15 * 60_000),
    lastSyncedAt: iso(row.last_synced_at),
    lastOk: (row.last_ok as boolean | null) ?? null,
    lastError: (row.last_error as string | null) ?? null,
    lastSummary: (row.last_summary as TrackerSyncSummary | null) ?? null,
    createdAt: iso(row.created_at) ?? "",
    reviewedAt: iso(row.reviewed_at),
    skippedKeys: (row.skipped_keys as string[]) ?? [],
  };
}

export async function listTrackers(client: SupabaseClient, orgId: string): Promise<TrackerConnection[]> {
  const { data, error } = await client.from(CONNECTIONS).select(COLUMNS).eq("organization_id", orgId).is("deleted_at", null).order("created_at");
  if (error) fail("load the connected trackers", error);
  return ((data ?? []) as Record<string, unknown>[]).map(toConnection);
}

async function loadRow(client: SupabaseClient, orgId: string, id: unknown): Promise<Record<string, unknown>> {
  if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id)) throw new CandidateActionError(404, "That connection no longer exists.");
  const { data, error } = await client.from(CONNECTIONS).select(COLUMNS).eq("organization_id", orgId).eq("id", id).is("deleted_at", null).maybeSingle();
  if (error) fail("load the connection", error);
  if (!data) throw new CandidateActionError(404, "That connection no longer exists.");
  return data as Record<string, unknown>;
}

const ConfigInput = z.object({
  name: z.string().trim().min(1, "Name the connection.").max(120),
  url: z.string().trim().min(1, "Paste the sheet's share link."),
  tab: z.string().min(1, "Pick the tab.").max(200),
  headerRow: z.number().int().min(1).max(50),
  columnMap: z.record(z.string().max(300), z.union([z.enum(TRACKER_FIELDS), z.literal("extra")]).nullable()),
  statusColumn: z.string().max(300).nullable().optional(),
  statusMap: z.record(z.string().max(300), z.string().max(40)).optional(),
  syncEvery: z.enum(TRACKER_SYNC_EVERY).default("manual"),
});

/** Checks a connection's settings: a name column, each field once, the status values onto stages that exist. */
async function checkConfig(client: SupabaseClient, orgId: string, body: unknown) {
  const parsed = ConfigInput.safeParse(body ?? {});
  if (!parsed.success) throw new CandidateActionError(400, parsed.error.issues[0]?.message ?? "Those settings are not valid.");
  const c = parsed.data;
  const source = trackerSource(c.url);
  // The same field may be matched by two column names (a later block may spell it differently); within one block the
  // first column wins.
  const fields = Object.values(c.columnMap);
  if (!fields.includes("fullName")) throw new CandidateActionError(400, "Match one column to \"Candidate name\".");
  const { stages } = await loadStages(client, orgId);
  const statusMap: Record<string, string> = {};
  for (const [text, key] of Object.entries(c.statusMap ?? {})) {
    if (!key) continue;
    if (!findStage(stages, key)) throw new CandidateActionError(400, `"${text}" is matched to a stage that no longer exists. Pick another.`);
    statusMap[norm(text)] = key;
  }
  const statusColumn = c.statusColumn?.trim() || null;
  if (Object.keys(statusMap).length && !statusColumn) throw new CandidateActionError(400, "Pick the column that holds the status.");
  return {
    name: c.name, source_url: source.url, source_kind: source.kind, tab_name: c.tab, header_row: c.headerRow,
    column_map: c.columnMap, status_column: statusColumn, status_map: statusMap, sync_every: c.syncEvery,
  };
}

export async function createTracker(client: SupabaseClient, orgId: string, by: Actor, body: unknown): Promise<TrackerConnection> {
  const values = await checkConfig(client, orgId, body);
  const now = new Date().toISOString();
  const { data, error } = await client.from(CONNECTIONS).insert({ organization_id: orgId, ...values, active: true, created_by: by.id, created_at: now, updated_at: now }).select(COLUMNS).single();
  if (error) fail("save the connection", error);
  return toConnection(data as Record<string, unknown>);
}

/** Edits the settings ({ ...the form }), or pauses / resumes ({ active }). A changed column matching re-reads every row next sync. */
export async function updateTracker(client: SupabaseClient, orgId: string, id: string, body: unknown): Promise<TrackerConnection> {
  const row = await loadRow(client, orgId, id);
  if (toConnection(row).syncing) throw new CandidateActionError(409, "Wait for this tracker to finish syncing before editing it.");
  const b = (body ?? {}) as Record<string, unknown>;
  const now = new Date().toISOString();
  let values: Record<string, unknown>;
  if (Object.keys(b).length === 1 && typeof b.active === "boolean") values = { active: b.active };
  else {
    values = await checkConfig(client, orgId, body);
    const changed = ["name", "source_url", "tab_name", "header_row", "column_map", "status_column", "status_map"].some(k => digest(values[k]) !== digest(row[k]));
    if (changed) values.reviewed_at = null;
  }
  let save = client.from(CONNECTIONS).update({ ...values, updated_at: now }).eq("organization_id", orgId).eq("id", row.id as string).eq("updated_at", row.updated_at);
  save = row.syncing_since ? save.eq("syncing_since", row.syncing_since) : save.is("syncing_since", null);
  const { data, error } = await save.select(COLUMNS).maybeSingle();
  if (error) fail("save the connection", error);
  if (!data) throw new CandidateActionError(409, "This tracker changed or started syncing. Refresh and try again.");
  return toConnection(data as Record<string, unknown>);
}

/** Disconnects (soft): it stops syncing. Everything it brought in stays, in its sheet under Recruitment -> Sheets. */
export async function deleteTracker(client: SupabaseClient, orgId: string, id: string): Promise<void> {
  const row = await loadRow(client, orgId, id);
  if (toConnection(row).syncing) throw new CandidateActionError(409, "Wait for this tracker to finish syncing before disconnecting it.");
  let remove = client.from(CONNECTIONS).update({ deleted_at: new Date().toISOString(), active: false }).eq("organization_id", orgId).eq("id", row.id as string).eq("updated_at", row.updated_at);
  remove = row.syncing_since ? remove.eq("syncing_since", row.syncing_since) : remove.is("syncing_since", null);
  const { data, error } = await remove.select("id").maybeSingle();
  if (error) fail("disconnect the tracker", error);
  if (!data) throw new CandidateActionError(409, "This tracker changed or started syncing. Refresh and try again.");
}

// The sync -------------------------------------------------------------------------------------------------------------

/** One sheet row as read: its cells by field, its status text, and its cleaned values. */
interface TrackerRow { row: SheetRow; raw: Record<string, string>; cells: Record<string, string>; status: string | null; key: string | null }

/** The row's identity across syncs: email, else phone, else name; with the role (one person may be tracked for two roles). */
const rowKey = (c: CleanRow) => `${c.emailKey ?? c.phoneKey ?? `name:${norm(c.fullName)}`}|${norm(c.role)}`;

/** Reads the tab with the connection's matching (the sheet upload's cleaning, per row). */
export function readTrackerRows(grid: unknown[][], headerRow: number, columnMap: Record<string, TrackerColumnTarget>, statusColumn: string | null): TrackerRow[] {
  const out: TrackerRow[] = [];
  for (const block of blocksOf(grid, headerRow)) {
    const headers = block.headers;
    const fieldAt = fieldsOf(headers, columnMap);
    const statusAt = statusColumn ? headers.indexOf(statusColumn) : -1;
    for (const { line, rowNumber } of block.rows) {
      if (out.length >= MAX_TRACKER_ROWS) throw new CandidateActionError(413, `The tab has more than ${MAX_TRACKER_ROWS.toLocaleString("en-IN")} rows.`);
      const raw: Record<string, string> = Object.create(null);
      const kept: Record<string, string> = Object.create(null);
      const extra: Record<string, string> = Object.create(null);
      const fieldCells: Partial<Record<SheetField, unknown>> = {};
      const cells: Record<string, string> = {};
      line.forEach((cell, c) => {
        const text = cellText(cell);
        if (text) raw[headers[c] ?? `Column ${c + 1}`] = text;
        if (columnMap[headers[c]] || headers[c] === statusColumn) kept[headers[c]] = text;
        if (columnMap[headers[c]] === "extra") extra[headers[c]] = text;
        const field = fieldAt[c];
        if (field && !(field in fieldCells)) { fieldCells[field] = cell; cells[field] = text; }
      });
      const status = statusAt >= 0 ? cellText(line[statusAt]) || null : null;
      cells.__status = status ?? "";
      cells.__extra = JSON.stringify(extra);
      const { clean, issues } = cleanRow(fieldCells);
      out.push({ row: { rowNumber, raw: kept, clean, issues }, raw, cells, status, key: clean ? rowKey(clean) : null });
    }
  }
  return out;
}

/** Cells that changed since the snapshot (all of them for a new row). */
const changedCells = (now: Record<string, string>, before: Record<string, string> | undefined) =>
  new Set([...new Set([...Object.keys(now), ...Object.keys(before ?? {})])].filter((k) => !before || (now[k] ?? "") !== (before[k] ?? "")));

/** The record columns a tracker cell fills, for keeping the app's value when the cell did not change. */
const RECORD_FIELDS: { field: TrackerField; clean: keyof CleanRow; column: string }[] = [
  { field: "candidateSource", clean: "candidateSource", column: "candidate_source" },
  { field: "sourcingDate", clean: "sourcingDate", column: "sourcing_date" },
  { field: "relevantExp", clean: "relevantExpMonths", column: "relevant_exp_months" },
  { field: "notice", clean: "noticePeriodDays", column: "notice_period_days" },
  { field: "currentInhand", clean: "currentInhand", column: "current_inhand" },
  { field: "expectedInhand", clean: "expectedInhand", column: "expected_inhand" },
  { field: "remark", clean: "remark", column: "remark" },
];

/**
 * Owner 2026-11-21: "the sheet's change only applies if that cell changed in the sheet since the last sync". For a row
 * seen before, a cell the sheet did not change keeps the app's value: the person's details are left empty (the import
 * keeps a person's value when the row's is empty), and the record's are taken from the record as it is now.
 */
function keepAppValues(clean: CleanRow, changed: Set<string>, record: Record<string, unknown> | undefined, person?: Awaited<ReturnType<typeof loadPeopleByContact>>[number]): CleanRow {
  const out: CleanRow = { ...clean };
  if (person) {
    if (!changed.has("fullName")) out.fullName = person.full_name;
    if (!changed.has("email")) { out.email = person.email; out.emailKey = person.email_key; }
    if (!changed.has("phone")) { out.phone = person.phone; out.phoneKey = person.phone_key; }
  }
  if (!changed.has("currentOrganization")) out.currentOrganization = null;
  if (!changed.has("currentDesignation")) out.currentDesignation = null;
  if (!changed.has("location")) out.location = null;
  if (!changed.has("totalExp")) out.totalExpMonths = null;
  if (record) {
    for (const f of RECORD_FIELDS) {
      if (!changed.has(f.field)) (out as unknown as Record<string, unknown>)[f.clean] = (record[f.column] ?? null) as never;
    }
    if (!changed.has("remark") && typeof record.status === "string") out.status = record.status as CleanRow["status"];
  }
  return out;
}

const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value, (_key, v) =>
  v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v)).digest("hex");
const profileLabels: Record<string, string> = {
  full_name: "Candidate name", email: "Email", phone: "Phone", current_organization: "Current organisation",
  current_designation: "Current designation", location: "Location", total_exp_months: "Total experience (months)",
};

/** Read-only plan shared by preview and sync; its fingerprint also covers the current app values. */
async function prepareTrackerImport(client: SupabaseClient, orgId: string, conn: TrackerConnection, fetchImpl?: FetchLike) {
  const source = trackerSource(conn.sourceUrl);
  const workbook = readWorkbook(await downloadTracker(source.downloadUrl, fetchImpl));
  const grid = gridOf(workbook, conn.tabName);
  const blocks = blocksOf(grid, conn.headerRow);
  const headers = [...new Set(blocks.flatMap(b => b.headers))];
  if (blocks.some(b => new Set(b.headers).size !== b.headers.length)) throw new CandidateActionError(422, "Two columns have the same name. Give each column its own name in the sheet, then read it again.");
  const unknown = headers.filter(h => !Object.hasOwn(conn.columnMap, h));
  if (unknown.length) throw new CandidateActionError(409, `New or unmatched columns need review: ${unknown.join(", ")}. Edit the connection and choose a field, Keep as extra column, or Don't import for each.`);
  const rows = readTrackerRows(grid, conn.headerRow, conn.columnMap, conn.statusColumn);
  const config = digest([conn.sourceUrl, conn.name, conn.tabName, conn.headerRow, conn.columnMap, conn.statusColumn, conn.statusMap]);
  for (const r of rows) r.cells.__config = config;
  const snapshots = new Map<string, { id: string; row_key: string; cells: Record<string, string> }>();
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await client.from(SNAPSHOTS).select("id, row_key, cells").eq("connection_id", conn.id).order("id").range(offset, offset + 999);
    if (error) fail("read the last sync", error);
    for (const s of (data ?? []) as { id: string; row_key: string; cells: Record<string, string> }[]) snapshots.set(s.row_key, s);
    if (!data || data.length < 1000) break;
  }
  const beforeCells = (r: TrackerRow) => {
    const cells = snapshots.get(r.key!)?.cells;
    return cells?.__config === config || (cells && !cells.__config && conn.reviewedAt) ? cells : undefined;
  };
  const valid = rows.filter((r): r is TrackerRow & { row: SheetRow & { clean: CleanRow } } => !!r.row.clean);
  const people = await loadPeopleByContact(client, orgId, valid.flatMap(r => r.row.clean.emailKey ? [r.row.clean.emailKey] : []), valid.flatMap(r => r.row.clean.phoneKey ? [r.row.clean.phoneKey] : []));
  const byEmail = new Map<string, typeof people>();
  const byPhone = new Map<string, typeof people>();
  for (const p of people) {
    if (p.email_key) byEmail.set(p.email_key, [...(byEmail.get(p.email_key) ?? []), p]);
    if (p.phone_key) byPhone.set(p.phone_key, [...(byPhone.get(p.phone_key) ?? []), p]);
  }
  const groups = groupPeople(valid.map(r => ({ clean: r.row.clean })));
  const groupMatch = new Map<number, string | null>();
  const matches = new Map<number, (typeof people)[number]>();
  const blocked = new Set<number>();
  valid.forEach((r, i) => {
    const c = r.row.clean;
    const found = [...new Map([...(byEmail.get(c.emailKey ?? "") ?? []), ...(byPhone.get(c.phoneKey ?? "") ?? [])].map(p => [p.id, p])).values()];
    const matchId = found[0]?.id ?? null;
    const inconsistent = groupMatch.has(groups[i]) && groupMatch.get(groups[i]) !== matchId;
    groupMatch.set(groups[i], matchId);
    if (!c.emailKey && !c.phoneKey) {
      r.row.issues.push("Add a valid email or phone in the tracker so later syncs can identify this person.");
      blocked.add(r.row.rowNumber);
    } else if (found.length > 1 || inconsistent) {
      blocked.add(r.row.rowNumber);
      r.row.issues.push("These contact details match different people. Correct them in the sheet before importing.");
    } else if (found[0]) matches.set(groups[i], found[0]);
  });
  // Ambiguous contacts cannot influence another row in the same person group.
  const blockedGroups = new Set(valid.flatMap((r, i) => blocked.has(r.row.rowNumber) ? [groups[i]] : []));
  const byIdentity = new Map<string, TrackerRow[]>();
  const personFor = new Map<number, (typeof people)[number]>();
  valid.forEach((r, i) => {
    const person = matches.get(groups[i]);
    if (person) personFor.set(r.row.rowNumber, person);
    if (blockedGroups.has(groups[i])) { blocked.add(r.row.rowNumber); return; }
    const identity = `${person?.id ?? groups[i]}|${norm(r.row.clean.role)}`;
    byIdentity.set(identity, [...(byIdentity.get(identity) ?? []), r]);
  });
  const byKey = new Map<string, TrackerRow>();
  const duplicates: string[] = [];
  let duplicateRows = 0;
  for (const group of byIdentity.values()) {
    const kept = group[group.length - 1];
    byKey.set(kept.key!, kept);
    if (group.length > 1) {
      const others = group.slice(0, -1).map(r => r.row.rowNumber);
      duplicateRows += others.length;
      kept.row.issues.push(`Duplicate in the tracker: the same person and role is also in row${others.length === 1 ? "" : "s"} ${others.join(", ")}. This row's values were used.`);
      if (duplicates.length < 10) duplicates.push(`${kept.row.clean?.fullName ?? "Someone"}${kept.row.clean?.role ? ` (${kept.row.clean.role})` : ""}: rows ${group.map(r => r.row.rowNumber).join(", ")}`);
    }
  }
  const live = await findLiveSheetByName(client, orgId, conn.name);
  const existing = live ? await appRecords(client, orgId, live.id) : new Map<string, Record<string, unknown>>();
  const changed = [...byKey.values()].filter(r => changedCells(r.cells, beforeCells(r)).size > 0);
  const parsedRows = changed.map(r => {
    const c = r.row.clean!;
    const person = personFor.get(r.row.rowNumber);
    const record = person ? existing.get(recordKey(person.id, c.role)) : undefined;
    return { ...r.row, clean: beforeCells(r) ? keepAppValues(c, changedCells(r.cells, beforeCells(r)), record, person) : c };
  });
  const parsedByNumber = new Map(parsedRows.map(r => [r.rowNumber, r]));
  const reviewRows: TrackerImportRow[] = rows.map(r => {
    const c = r.row.clean;
    const person = personFor.get(r.row.rowNumber);
    const record = c && person ? existing.get(recordKey(person.id, c.role)) : undefined;
    const clean = parsedByNumber.get(r.row.rowNumber)?.clean;
    const outcome = !c || blocked.has(r.row.rowNumber) ? "invalid" : byKey.get(r.key!) !== r ? "duplicate" : !clean ? "unchanged" : person ? "existing" : "new";
    const changes: TrackerImportRow["changes"] = [];
    const add = (field: string, before: unknown, after: unknown) => {
      const a = (after ?? null) as string | number | null;
      const b = (before ?? null) as string | number | null;
      if (a !== b) changes.push({ field, before: b, after: a });
    };
    if (clean && outcome !== "invalid" && outcome !== "duplicate") {
      for (const [k, value] of Object.entries(personValues(clean))) if (profileLabels[k]) add(profileLabels[k], person?.[k as keyof typeof person], value);
      add("Role", record?.role, clean.role);
      for (const f of RECORD_FIELDS) add(`${TRACKER_FIELD_LABELS[f.field]}${f.field === "relevantExp" ? " (months)" : ""}`, record?.[f.column], clean[f.clean]);
      add("Status from remark", record?.status, clean.status);
      const oldExtras = JSON.parse(beforeCells(r)?.__extra ?? "{}") as Record<string, string>;
      const extras = JSON.parse(r.cells.__extra) as Record<string, string>;
      for (const h of new Set([...Object.keys(oldExtras), ...Object.keys(extras)])) add(`Extra: ${h}`, oldExtras[h], extras[h]);
    }
    const statusChanged = !beforeCells(r) || beforeCells(r)?.__status !== r.cells.__status || beforeCells(r)?.__pendingStage === "true";
    return {
      rowNumber: r.row.rowNumber, key: r.key, name: c?.fullName ?? "Missing name", role: c?.role ?? null, raw: r.raw,
      outcome, issues: r.row.issues, changes, selected: (outcome === "new" || outcome === "existing") && !conn.skippedKeys.includes(r.key!),
      stage: clean && statusChanged && r.status ? conn.statusMap[norm(r.status)] ?? null : null,
    };
  });
  const newRows = new Set(reviewRows.filter(r => r.outcome === "new").map(r => r.rowNumber));
  const preview: TrackerImportPreview = {
    token: digest([orgId, conn.id, config, conn.skippedKeys, conn.reviewedAt, conn.syncEvery, conn.active, reviewRows, people.slice().sort((a, b) => a.id.localeCompare(b.id)), [...snapshots].sort(), [...existing].sort(), live?.id]),
    headers, rows: reviewRows,
    newCandidates: new Set(valid.flatMap((r, i) => newRows.has(r.row.rowNumber) ? [groups[i]] : [])).size,
    existingCandidates: new Set(reviewRows.filter(r => r.outcome === "existing" || r.outcome === "unchanged").map(r => personFor.get(r.rowNumber)?.id).filter(Boolean)).size,
    changedRows: changed.length, duplicateRows, invalidRows: reviewRows.filter(r => r.outcome === "invalid").length,
  };
  return { rows, snapshots, beforeCells, byKey, changed, parsedRows, duplicates, duplicateRows, live, preview };
}

export async function previewTrackerImport(client: SupabaseClient, orgId: string, id: string, fetchImpl?: FetchLike): Promise<TrackerImportPreview> {
  const conn = toConnection(await loadRow(client, orgId, id));
  if (conn.syncing) throw new CandidateActionError(409, "This tracker is syncing. Try again in a minute.");
  return (await prepareTrackerImport(client, orgId, conn, fetchImpl)).preview;
}

export async function savedTrackerValues(client: SupabaseClient, orgId: string, recordId: string, sheetId: string | null): Promise<Record<string, string> | null> {
  if (!sheetId) return null;
  const { data: connections, error } = await client.from(CONNECTIONS).select("id").eq("organization_id", orgId).eq("sheet_id", sheetId).limit(1);
  if (error) { if (missingRelation(error)) return null; fail("read the tracker", error); }
  if (!connections?.length) return null;
  const { data: rows, error: rowsError } = await client.from("candidate_sheet_rows").select("raw").eq("sheet_id", sheetId).eq("application_id", recordId).order("upload_no", { ascending: false }).order("row_number", { ascending: false }).limit(1);
  if (rowsError) fail("read the saved tracker values", rowsError);
  return (rows?.[0]?.raw as Record<string, string>) ?? null;
}

export interface SyncOptions { trigger: "schedule" | "manual"; by?: Actor; fetchImpl?: FetchLike; now?: () => Date; reviewToken?: unknown; selectedRows?: unknown }

/** Pulls one connection: the changed rows into its candidate sheet, the changed statuses onto the pipeline. */
export async function syncTracker(client: SupabaseClient, orgId: string, id: string, options: SyncOptions): Promise<TrackerSyncSummary> {
  const started = (options.now ?? (() => new Date()))();
  const row = await loadRow(client, orgId, id);
  const conn = toConnection(row);
  if (conn.syncing) throw new CandidateActionError(409, "This tracker is already syncing. Try again in a minute.");
  if (options.trigger === "schedule" && (!conn.active || conn.syncEvery === "manual" || !conn.reviewedAt)) throw new CandidateActionError(409, "Preview and import this tracker manually before automatic syncing.");
  const actorId = options.by?.id ?? (row.created_by as string | null);
  if (!actorId) throw new CandidateActionError(409, "The person who connected this tracker no longer has a login. Edit and save the connection to take it over.");
  const by: Actor = options.by ?? { id: actorId, name: "Tracker sync" };
  let claim = client.from(CONNECTIONS).update({ syncing_since: started.toISOString() }).eq("id", conn.id).eq("updated_at", row.updated_at);
  claim = row.syncing_since ? claim.eq("syncing_since", row.syncing_since) : claim.is("syncing_since", null);
  const { data: claimed, error: claimError } = await claim.select("id").maybeSingle();
  if (claimError) fail("start the sync", claimError);
  if (!claimed) throw new CandidateActionError(409, "This connection changed or is already syncing. Preview again.");

  const finish = async (ok: boolean, summary: TrackerSyncSummary | null, error: string | null) => {
    const at = new Date().toISOString();
    const { error: saveError } = await client.from(CONNECTIONS).update({ syncing_since: null, last_synced_at: at, last_ok: ok, last_error: error, ...(summary ? { last_summary: summary } : {}), updated_at: at }).eq("id", conn.id).eq("syncing_since", started.toISOString());
    if (saveError) fail("save the sync result", saveError);
    const { error: logError } = await client.from(SYNCS).insert({ organization_id: orgId, connection_id: conn.id, trigger: options.trigger, ok, summary, error, started_at: started.toISOString(), finished_at: at });
    if (logError) fail("save the sync history", logError);
  };

  try {
    const plan = await prepareTrackerImport(client, orgId, conn, options.fetchImpl);
    const { rows, snapshots, beforeCells, byKey, duplicates, duplicateRows, live, preview } = plan;
    let selected: Set<number>;
    if (options.trigger === "manual") {
      const selection = z.array(z.number().int().positive()).max(MAX_TRACKER_ROWS).safeParse(options.selectedRows);
      if (!selection.success || options.reviewToken !== preview.token) throw new CandidateActionError(409, "The sheet, settings or app records changed, or this import has not been reviewed. Preview again before importing.");
      selected = new Set(selection.data);
      const eligible = new Set(preview.rows.filter(r => r.outcome === "new" || r.outcome === "existing").map(r => r.rowNumber));
      if ([...selected].some(n => !eligible.has(n))) throw new CandidateActionError(400, "Select only valid, changed rows from this preview.");
      const skipped = new Set(conn.skippedKeys);
      for (const r of preview.rows) {
        if (!eligible.has(r.rowNumber)) continue;
        if (selected.has(r.rowNumber)) skipped.delete(r.key!); else skipped.add(r.key!);
      }
      const { error } = await client.from(CONNECTIONS).update({ skipped_keys: [...skipped] }).eq("id", conn.id);
      if (error) fail("save the rows to skip", error);
    } else {
      selected = new Set(preview.rows.filter(r => r.selected).map(r => r.rowNumber));
    }
    const changed = plan.changed.filter(r => selected.has(r.row.rowNumber));
    const parsedRows = plan.parsedRows.filter(r => selected.has(r.rowNumber));

    const summary: TrackerSyncSummary = {
      rowsRead: rows.length, rowsChanged: changed.length, rowsUnchanged: byKey.size - plan.changed.length, rowsSkipped: preview.invalidRows + plan.changed.length - changed.length,
      recordsAdded: 0, recordsUpdated: 0, stageMoves: 0, stagePending: 0, rolesWithoutPosition: [], notes: [],
      duplicateRows, duplicates, alreadyInDatabase: 0,
    };
    let sheetId = conn.sheetId;
    if (parsedRows.length) {
      const fields = [...new Set(Object.values(conn.columnMap).filter(f => f && f !== "extra"))] as SheetField[];
      const parsed: ParsedSheet = { worksheet: conn.tabName, rows: parsedRows, fields, warnings: [] };
      const result = await importSheet(client, {
        orgId, userId: by.id, userEmail: null, userName: by.name, fileName: conn.name, parsed, mode: live ? "merge" : "new", existing: live,
      });
      sheetId = result.sheetId;
      summary.recordsAdded = result.recordsAdded;
      summary.recordsUpdated = result.recordsUpdated;
      // The import flags a person the app already had from another sheet or by hand ("already in the database").
      summary.alreadyInDatabase = result.alreadyKnownRows;
      if (sheetId !== conn.sheetId) await client.from(CONNECTIONS).update({ sheet_id: sheetId }).eq("id", conn.id);
    }

    // Statuses onto the pipeline: rows whose status changed (or are new), when the status is matched to a stage.
    const pending = new Set<string>();
    const moves = changed.filter((r) => {
      const before = beforeCells(r);
      return r.status && conn.statusMap[norm(r.status)] && (!before || before.__pendingStage === "true" || (before.__status ?? "") !== (r.cells.__status ?? ""));
    });
    if (moves.length && sheetId) await applyStages(client, orgId, by, sheetId, moves, conn.statusMap, summary, pending, started);

    // Remember imported cells even when a stage move waits, so retrying does not overwrite later app edits.
    const toSave = changed.map((r) => ({ id: snapshots.get(r.key!)?.id ?? randomUUID(), connection_id: conn.id, row_key: r.key!, cells: { ...r.cells, ...(pending.has(r.key!) ? { __pendingStage: "true" } : {}) }, updated_at: new Date().toISOString() }));
    for (let i = 0; i < toSave.length; i += 500) {
      const { error } = await client.from(SNAPSHOTS).upsert(toSave.slice(i, i + 500));
      if (error) fail("remember the sync", error);
    }
    if (summary.rowsSkipped) summary.notes.push(`${summary.rowsSkipped} row${summary.rowsSkipped === 1 ? "" : "s"} were skipped (invalid or not selected).`);
    if (options.trigger === "manual") {
      const { error } = await client.from(CONNECTIONS).update({ reviewed_at: new Date().toISOString() }).eq("id", conn.id);
      if (error) fail("save the review", error);
    }
    await finish(true, summary, null);
    return summary;
  } catch (error) {
    const message = error instanceof CandidateActionError ? error.message : error instanceof Error ? error.message : "The sync failed.";
    await finish(false, null, message.slice(0, 1000));
    throw error;
  }
}

/** The records of the connection's sheet as they are now, keyed by the person's email / phone and the role. */
async function appRecords(client: SupabaseClient, orgId: string, sheetId: string): Promise<Map<string, Record<string, unknown>>> {
  const out = new Map<string, Record<string, unknown>>();
  for (const r of await loadSheetRecords(client, orgId, sheetId)) {
    const key = recordKey(r.candidate_id as string, r.role as string | null);
    if (!out.has(key)) out.set(key, r);
  }
  return out;
}

/**
 * Puts each moved row's person in the open position with the row's role title (added at the first stage if new) and
 * moves them to the stage the status is matched to. Stops at the time budget; the rest wait for the next sync.
 */
async function applyStages(client: SupabaseClient, orgId: string, by: Actor, sheetId: string, moves: TrackerRow[], statusMap: Record<string, string>, summary: TrackerSyncSummary, pending: Set<string>, started: Date): Promise<void> {
  const positions = await listPositions(client, orgId, "open");
  const positionFor = new Map(positions.map((p) => [norm(p.title), p]));
  const appByRow = new Map<number, { id: string; candidate_id: string; source_row: number }>();
  for (let i = 0; i < moves.length; i += 200) {
    const { data, error } = await client.from("candidate_applications").select("id, candidate_id, source_row").eq("organization_id", orgId).eq("sheet_id", sheetId).is("deleted_at", null).in("source_row", moves.slice(i, i + 200).map(m => m.row.rowNumber));
    if (error) fail("read the imported records", error);
    for (const a of (data ?? []) as { id: string; candidate_id: string; source_row: number }[]) appByRow.set(a.source_row, a);
  }
  const missingRoles = new Set<string>();

  // Per position: add the people not in it yet, then move each.
  const groups = new Map<string, { position: (typeof positions)[number]; items: { move: TrackerRow; app: { id: string; candidate_id: string } }[] }>();
  for (const move of moves) {
    const role = move.row.clean?.role ?? null;
    const position = role ? positionFor.get(norm(role)) : undefined;
    if (!position) { if (role) missingRoles.add(role); continue; }
    const app = appByRow.get(move.row.rowNumber);
    if (!app) { pending.add(move.key!); continue; }
    const g = groups.get(position.id) ?? { position, items: [] };
    g.items.push({ move, app });
    groups.set(position.id, g);
  }
  for (const { position, items } of groups.values()) {
    const memberOf = new Map<string, { id: string; candidate_id: string; stage: string }>();
    for (let i = 0; i < items.length; i += 200) {
      const batch = items.slice(i, i + 200);
      await addMembers(client, orgId, by, position.id, [...new Set(batch.map(x => x.app.id))]).catch(error => {
        for (const { move } of batch) pending.add(move.key!);
        summary.notes.push(`Adding people to ${position.title}: ${error instanceof Error ? error.message : "failed"}`);
      });
      const { data: members, error } = await client.from("candidate_position_members").select("id, candidate_id, stage").eq("organization_id", orgId).eq("position_id", position.id).is("deleted_at", null).in("candidate_id", [...new Set(batch.map(x => x.app.candidate_id))]);
      if (error) fail("read the pipeline members", error);
      for (const m of (members ?? []) as { id: string; candidate_id: string; stage: string }[]) memberOf.set(m.candidate_id, m);
    }
    for (const { move, app } of items) {
      if (Date.now() - started.getTime() > STAGE_BUDGET_MS) { pending.add(move.key!); continue; }
      const member = memberOf.get(app.candidate_id);
      const stage = statusMap[norm(move.status)];
      if (!member || !stage) { pending.add(move.key!); continue; }
      if (member.stage === stage) continue;
      try {
        await moveMember(client, orgId, by, position.id, member.id, stage, `From the tracker: ${move.status}`);
        member.stage = stage;
        summary.stageMoves += 1;
      } catch (error) {
        pending.add(move.key!);
        if (summary.notes.length < 10) summary.notes.push(`${move.row.clean?.fullName ?? "A row"} (row ${move.row.rowNumber}): ${error instanceof Error ? error.message : "could not be moved"}`);
      }
    }
  }
  summary.stagePending = pending.size;
  summary.rolesWithoutPosition = [...missingRoles].slice(0, 20);
}

/** For the hourly job: the connections due (active, not manual, last synced over an hour / a day ago), every organisation. */
export async function dueTrackers(client: SupabaseClient, now = new Date()): Promise<{ orgId: string; id: string }[]> {
  const { data, error } = await client.from(CONNECTIONS).select("id, organization_id, sync_every, last_synced_at").eq("active", true).is("deleted_at", null).neq("sync_every", "manual").not("reviewed_at", "is", null);
  if (error) return [];
  return ((data ?? []) as { id: string; organization_id: string; sync_every: string; last_synced_at: unknown }[])
    .filter((c) => {
      const last = iso(c.last_synced_at);
      if (!last) return true;
      const age = now.getTime() - new Date(last).getTime();
      return age >= (c.sync_every === "daily" ? 23 * 3_600_000 : 55 * 60_000);
    })
    .map((c) => ({ orgId: c.organization_id, id: c.id }));
}

