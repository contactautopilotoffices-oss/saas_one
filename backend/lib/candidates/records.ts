/**
 * Records (one per Excel row or hand-added entry): list, read, add, edit, soft-delete, restore.
 * Every function takes the organisation id and scopes every query to it.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { parseEmail, parsePhone } from "./normalize";
import { buildSearchText } from "./profile";
import { RECORD_STATUSES, type CandidateListResponse, type CandidateRecord } from "./types";

export class CandidateActionError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** A row of the candidate_records view. */
export interface RecordRow {
  id: string;
  organization_id: string;
  candidate_id: string;
  sheet_id: string | null;
  sheet_name: string | null;
  source_row: number | null;
  full_name: string;
  email: string | null;
  phone: string | null;
  current_organization: string | null;
  current_designation: string | null;
  location: string | null;
  total_exp_months: number | null;
  role: string | null;
  candidate_source: string | null;
  sourcing_date: string | null;
  relevant_exp_months: number | null;
  notice_period_days: number | null;
  current_inhand: number | null;
  expected_inhand: number | null;
  remark: string | null;
  status: CandidateRecord["status"];
  indexed: boolean;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  sheet_live: boolean;
}

export const RECORD_COLUMNS =
  "id, organization_id, candidate_id, sheet_id, sheet_name, source_row, full_name, email, phone, current_organization, " +
  "current_designation, location, total_exp_months, role, candidate_source, sourcing_date, relevant_exp_months, " +
  "notice_period_days, current_inhand, expected_inhand, remark, status, indexed, created_at, updated_at, deleted_at, sheet_live";

export function toRecord(row: RecordRow): CandidateRecord {
  return {
    id: row.id,
    candidateId: row.candidate_id,
    sheetId: row.sheet_id,
    sheetName: row.sheet_name,
    sourceRow: row.source_row,
    fullName: row.full_name,
    email: row.email,
    phone: row.phone,
    currentOrganization: row.current_organization,
    currentDesignation: row.current_designation,
    location: row.location,
    totalExpMonths: row.total_exp_months,
    role: row.role,
    candidateSource: row.candidate_source,
    sourcingDate: row.sourcing_date,
    relevantExpMonths: row.relevant_exp_months,
    noticePeriodDays: row.notice_period_days,
    currentInhand: row.current_inhand,
    expectedInhand: row.expected_inhand,
    remark: row.remark,
    status: row.status,
    indexed: row.indexed,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

// ---------------------------------------------------------------------------
// Input validation (POST / PATCH bodies)
// ---------------------------------------------------------------------------
const text = (max: number) =>
  z
    .string()
    .max(max, `Must be ${max} characters or fewer`)
    .transform((value) => value.replace(/\s+/g, " ").trim() || null)
    .nullable()
    .optional();
const months = z.number().int().min(0).max(720).nullable().optional();
const rupees = z.number().int().min(0).max(10_000_000).nullable().optional();

const InputSchema = z.object({
  fullName: z.string().max(120).transform((value) => value.replace(/\s+/g, " ").trim()),
  email: text(200),
  phone: text(40),
  currentOrganization: text(200),
  currentDesignation: text(200),
  location: text(120),
  totalExpMonths: months,
  role: text(200),
  candidateSource: text(200),
  sourcingDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use the date format YYYY-MM-DD")
    .nullable()
    .optional()
    .or(z.literal("").transform(() => null)),
  relevantExpMonths: months,
  noticePeriodDays: z.number().int().min(0).max(365).nullable().optional(),
  currentInhand: rupees,
  expectedInhand: rupees,
  remark: text(1000),
  status: z.enum(RECORD_STATUSES).optional(),
});

export type ValidInput = z.infer<typeof InputSchema>;

/** Validate a body; `partial` for PATCH. Throws CandidateActionError(400) with the first problem. */
export function validateInput(body: unknown, partial: boolean): Partial<ValidInput> {
  const schema = partial ? InputSchema.partial() : InputSchema;
  const result = schema.safeParse(body);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new CandidateActionError(400, `${issue.path.join(".") || "Input"}: ${issue.message}`);
  }
  const input = result.data as Partial<ValidInput>;
  if (!partial || input.fullName !== undefined) {
    if (!input.fullName) throw new CandidateActionError(400, "Full name is required");
  }
  return input;
}

function personColumns(input: Partial<ValidInput>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (input.fullName !== undefined) out.full_name = input.fullName;
  if (input.email !== undefined) {
    const email = parseEmail(input.email);
    out.email = email.value;
    out.email_key = email.key;
  }
  if (input.phone !== undefined) {
    const phone = parsePhone(input.phone);
    out.phone = phone.value;
    out.phone_key = phone.key;
  }
  if (input.currentOrganization !== undefined) out.current_organization = input.currentOrganization;
  if (input.currentDesignation !== undefined) out.current_designation = input.currentDesignation;
  if (input.location !== undefined) out.location = input.location;
  if (input.totalExpMonths !== undefined) out.total_exp_months = input.totalExpMonths;
  return out;
}

function recordColumns(input: Partial<ValidInput>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (input.role !== undefined) out.role = input.role;
  if (input.candidateSource !== undefined) out.candidate_source = input.candidateSource;
  if (input.sourcingDate !== undefined) out.sourcing_date = input.sourcingDate;
  if (input.relevantExpMonths !== undefined) out.relevant_exp_months = input.relevantExpMonths;
  if (input.noticePeriodDays !== undefined) out.notice_period_days = input.noticePeriodDays;
  if (input.currentInhand !== undefined) out.current_inhand = input.currentInhand;
  if (input.expectedInhand !== undefined) out.expected_inhand = input.expectedInhand;
  if (input.remark !== undefined) out.remark = input.remark;
  if (input.status !== undefined) out.status = input.status;
  return out;
}

function fail(context: string, error: unknown): never {
  console.error(`[candidates] ${context}`, error);
  throw new CandidateActionError(500, `Couldn't ${context}. Please try again.`);
}

/**
 * Errors from the functions added by 20261103000001: "busy importing" -> 409, "not found" -> 404, function missing
 * (migration not applied yet) -> 503 with what to do. Anything else -> 500.
 */
export function rpcFail(context: string, error: { code?: string; message?: string } | null): never {
  if (error?.code === "55006") throw new CandidateActionError(409, "A sheet is still importing. Try again in a moment.");
  if (error?.code === "P0002") throw new CandidateActionError(404, "That sheet no longer exists.");
  if (error?.code === "PGRST202" || error?.code === "PGRST205" || error?.code === "42883" || error?.code === "42P01") {
    console.error(`[candidates] ${context}: migration 20261103000001 not applied`, error);
    throw new CandidateActionError(503, "This needs a database update first: run 20261103000001_candidate_search_purge_and_ai_fix.sql in Supabase.");
  }
  fail(context, error);
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------
export interface ListOptions {
  q?: string | null;
  status?: string | null;
  /** a sheet id, or "manual" for hand-added records */
  sheetId?: string | null;
  deleted?: boolean;
  page?: number;
  pageSize?: number;
}

/** The subset of a supabase-js filter builder that the table's filters use. */
interface Filterable<T> {
  eq(column: string, value: string | boolean): T;
  is(column: string, value: null): T;
  not(column: string, operator: "is", value: null): T;
  ilike(column: string, pattern: string): T;
}

/** The table's filters (visible records only), shared by the list and "Delete all matching". */
function applyFilters<T extends Filterable<T>>(query: T, options: ListOptions): T {
  let q = query.eq("sheet_live", true);
  q = options.deleted ? q.not("deleted_at", "is", null) : q.is("deleted_at", null);
  if (options.status && (RECORD_STATUSES as readonly string[]).includes(options.status)) q = q.eq("status", options.status);
  if (options.sheetId === "manual") q = q.is("sheet_id", null);
  else if (options.sheetId) q = q.eq("sheet_id", options.sheetId);
  const text = options.q?.trim().toLowerCase().slice(0, 100);
  if (text) q = q.ilike("lookup_text", `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
  return q;
}

export async function listRecords(client: SupabaseClient, orgId: string, options: ListOptions): Promise<CandidateListResponse> {
  const whole = (value: number | undefined, fallback: number) => (Number.isFinite(value) ? Math.floor(value as number) : fallback);
  const page = Math.min(100_000, Math.max(1, whole(options.page, 1)));
  const pageSize = Math.min(100, Math.max(1, whole(options.pageSize, 50)));
  const query = applyFilters(
    client.from("candidate_records").select(RECORD_COLUMNS, { count: "exact" }).eq("organization_id", orgId),
    options,
  );

  const from = (page - 1) * pageSize;
  const { data, error, count } = await query
    .order("updated_at", { ascending: false })
    .order("id")
    .range(from, from + pageSize - 1);
  if (error) fail("load candidates", error);
  return { records: ((data ?? []) as unknown as RecordRow[]).map(toRecord), total: count ?? 0, page, pageSize };
}

export async function getRecordRows(client: SupabaseClient, orgId: string, ids: string[]): Promise<RecordRow[]> {
  if (!ids.length) return [];
  const { data, error } = await client.from("candidate_records").select(RECORD_COLUMNS).eq("organization_id", orgId).in("id", ids);
  if (error) fail("load candidates", error);
  return (data ?? []) as unknown as RecordRow[];
}

export async function getRecord(client: SupabaseClient, orgId: string, id: string): Promise<CandidateRecord> {
  const [row] = await getRecordRows(client, orgId, [id]);
  if (!row) throw new CandidateActionError(404, "That candidate record no longer exists.");
  return toRecord(row);
}

// ---------------------------------------------------------------------------
// Search text upkeep
// ---------------------------------------------------------------------------
/**
 * Rebuild the search text of every record of these candidates; records whose text changed lose their embedding
 * (re-indexed in the background). Returns how many records changed.
 */
export async function refreshSearchText(client: SupabaseClient, orgId: string, candidateIds: string[]): Promise<number> {
  let changed = 0;
  // In chunks: a long id list would not fit in the request URL.
  for (let i = 0; i < candidateIds.length; i += 200) {
    changed += await refreshSearchTextChunk(client, orgId, candidateIds.slice(i, i + 200));
  }
  return changed;
}

async function refreshSearchTextChunk(client: SupabaseClient, orgId: string, candidateIds: string[]): Promise<number> {
  const [people, apps] = await Promise.all([
    client
      .from("candidates")
      .select("id, current_organization, current_designation, location, total_exp_months")
      .eq("organization_id", orgId)
      .in("id", candidateIds),
    client
      .from("candidate_applications")
      .select("id, candidate_id, role, candidate_source, relevant_exp_months, notice_period_days, remark, search_text")
      .eq("organization_id", orgId)
      .in("candidate_id", candidateIds),
  ]);
  if (people.error || apps.error) fail("update the search index", people.error ?? apps.error);
  const byId = new Map((people.data ?? []).map((p) => [p.id as string, p]));
  let changed = 0;
  for (const app of apps.data ?? []) {
    const person = byId.get(app.candidate_id as string);
    if (!person) continue;
    const next = buildSearchText({
      role: app.role,
      currentDesignation: person.current_designation,
      currentOrganization: person.current_organization,
      location: person.location,
      totalExpMonths: person.total_exp_months,
      relevantExpMonths: app.relevant_exp_months,
      noticePeriodDays: app.notice_period_days,
      candidateSource: app.candidate_source,
      remark: app.remark,
    });
    if (next === app.search_text) continue;
    const { error } = await client
      .from("candidate_applications")
      .update({ search_text: next, embedding: null, embedding_model: null })
      .eq("id", app.id)
      .eq("organization_id", orgId);
    if (error) fail("update the search index", error);
    changed += 1;
  }
  return changed;
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------
/** Live candidate in this organisation with the same valid email, else the same valid phone. */
export async function findCandidateByContact(
  client: SupabaseClient,
  orgId: string,
  emailKey: string | null,
  phoneKey: string | null,
): Promise<string | null> {
  for (const [column, value] of [
    ["email_key", emailKey],
    ["phone_key", phoneKey],
  ] as const) {
    if (!value) continue;
    const { data, error } = await client
      .from("candidates")
      .select("id")
      .eq("organization_id", orgId)
      .eq(column, value)
      .order("created_at")
      .limit(1);
    if (error) fail("check for duplicates", error);
    if (data?.[0]) return data[0].id as string;
  }
  return null;
}

/**
 * Add a record by hand. If a candidate with the same email or phone exists, the record is added to that person
 * (and the person's details are updated with what was typed); otherwise a new candidate is created.
 */
export async function createRecord(
  client: SupabaseClient,
  orgId: string,
  userId: string,
  body: unknown,
): Promise<{ record: CandidateRecord; matchedExisting: boolean }> {
  const input = validateInput(body, false);
  const person = personColumns(input);
  const existingId = await findCandidateByContact(
    client,
    orgId,
    (person.email_key as string | null) ?? null,
    (person.phone_key as string | null) ?? null,
  );

  let candidateId = existingId;
  if (existingId) {
    // Only overwrite with values that were actually typed.
    const update = Object.fromEntries(Object.entries(person).filter(([, value]) => value !== null && value !== undefined));
    const { error } = await client
      .from("candidates")
      .update({ ...update, updated_at: new Date().toISOString() })
      .eq("id", existingId)
      .eq("organization_id", orgId);
    if (error) fail("save the candidate", error);
  } else {
    const { data, error } = await client
      .from("candidates")
      .insert({ ...person, organization_id: orgId, created_by: userId })
      .select("id")
      .single();
    if (error || !data) fail("save the candidate", error);
    candidateId = data.id as string;
  }

  const { data: app, error: appError } = await client
    .from("candidate_applications")
    .insert({ ...recordColumns(input), organization_id: orgId, candidate_id: candidateId, created_by: userId, updated_by: userId })
    .select("id")
    .single();
  if (appError || !app) fail("save the candidate", appError);

  await refreshSearchText(client, orgId, [candidateId as string]);
  return { record: await getRecord(client, orgId, app.id as string), matchedExisting: Boolean(existingId) };
}

/** Edit a record. Person fields (name, contact, company, designation, location, total experience) apply to every record of that person. */
export async function updateRecord(
  client: SupabaseClient,
  orgId: string,
  userId: string,
  id: string,
  body: unknown,
): Promise<CandidateRecord> {
  const input = validateInput(body, true);
  const current = await getRecord(client, orgId, id);
  const now = new Date().toISOString();

  const person = personColumns(input);
  if (Object.keys(person).length) {
    const { error } = await client
      .from("candidates")
      .update({ ...person, updated_at: now })
      .eq("id", current.candidateId)
      .eq("organization_id", orgId);
    if (error) fail("save the changes", error);
  }
  const record = recordColumns(input);
  const { error } = await client
    .from("candidate_applications")
    .update({ ...record, updated_by: userId, updated_at: now })
    .eq("id", id)
    .eq("organization_id", orgId);
  if (error) fail("save the changes", error);

  await refreshSearchText(client, orgId, [current.candidateId]);
  return getRecord(client, orgId, id);
}

export async function deleteRecord(client: SupabaseClient, orgId: string, userId: string, id: string): Promise<void> {
  const current = await getRecord(client, orgId, id);
  if (current.deletedAt) return;
  const { error } = await client
    .from("candidate_applications")
    .update({ deleted_at: new Date().toISOString(), deleted_by: userId })
    .eq("id", id)
    .eq("organization_id", orgId)
    .is("deleted_at", null);
  if (error) fail("delete the record", error);
}

const ID_CHUNK = 200;

/** Soft-delete these records (restorable). Ids from another organisation or already deleted are ignored. */
export async function deleteRecords(client: SupabaseClient, orgId: string, userId: string, ids: string[]): Promise<number> {
  let deleted = 0;
  const now = new Date().toISOString();
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const { data, error } = await client
      .from("candidate_applications")
      .update({ deleted_at: now, deleted_by: userId })
      .eq("organization_id", orgId)
      .in("id", ids.slice(i, i + ID_CHUNK))
      .is("deleted_at", null)
      .select("id");
    if (error) fail("delete the records", error);
    deleted += data?.length ?? 0;
  }
  return deleted;
}

/** Ids of every visible record matching the table's filters (for "Delete all matching"), at most `max`. */
export async function matchingRecordIds(client: SupabaseClient, orgId: string, options: ListOptions, max: number): Promise<string[]> {
  const ids: string[] = [];
  const page = 1000; // PostgREST's default row cap
  // Typed as string (like RECORD_COLUMNS) so supabase-js does not parse the column list into a deep type.
  const columns: string = "id";
  for (let from = 0; from < max; from += page) {
    const { data, error } = await applyFilters(client.from("candidate_records").select(columns).eq("organization_id", orgId), {
      ...options,
      deleted: false,
    })
      .order("id")
      .range(from, Math.min(from + page, max) - 1);
    if (error) fail("find the matching records", error);
    const rows = (data ?? []) as unknown as { id: string }[];
    ids.push(...rows.map((row) => row.id));
    if (rows.length < page) break;
  }
  return ids;
}

/**
 * Delete records for good. Only records already deleted (from "Show deleted") are removed; people left with no record
 * anywhere go too. Needs migration 20261103000001.
 */
export async function purgeRecords(client: SupabaseClient, orgId: string, ids: string[]): Promise<{ records: number; people: number }> {
  let records = 0;
  let people = 0;
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const { data, error } = await client.rpc("candidate_purge_records", { p_organization_id: orgId, p_ids: ids.slice(i, i + ID_CHUNK) });
    if (error) rpcFail("delete the records permanently", error);
    const d = (data ?? {}) as { records?: number; people?: number };
    records += Number(d.records) || 0;
    people += Number(d.people) || 0;
  }
  return { records, people };
}

export async function restoreRecord(client: SupabaseClient, orgId: string, userId: string, id: string): Promise<CandidateRecord> {
  const [row] = await getRecordRows(client, orgId, [id]);
  if (!row) throw new CandidateActionError(404, "That candidate record no longer exists.");
  if (!row.sheet_live) {
    throw new CandidateActionError(409, `This record belongs to the deleted sheet "${row.sheet_name}". Restore the sheet instead.`);
  }
  const { error } = await client
    .from("candidate_applications")
    .update({ deleted_at: null, deleted_by: null, updated_by: userId, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("organization_id", orgId);
  if (error) fail("restore the record", error);
  return getRecord(client, orgId, id);
}

