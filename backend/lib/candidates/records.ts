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

export async function listRecords(client: SupabaseClient, orgId: string, options: ListOptions): Promise<CandidateListResponse> {
  const whole = (value: number | undefined, fallback: number) => (Number.isFinite(value) ? Math.floor(value as number) : fallback);
  const page = Math.min(100_000, Math.max(1, whole(options.page, 1)));
  const pageSize = Math.min(100, Math.max(1, whole(options.pageSize, 50)));
  let query = client
    .from("candidate_records")
    .select(RECORD_COLUMNS, { count: "exact" })
    .eq("organization_id", orgId)
    .eq("sheet_live", true);
  query = options.deleted ? query.not("deleted_at", "is", null) : query.is("deleted_at", null);
  if (options.status && (RECORD_STATUSES as readonly string[]).includes(options.status)) query = query.eq("status", options.status);
  if (options.sheetId === "manual") query = query.is("sheet_id", null);
  else if (options.sheetId) query = query.eq("sheet_id", options.sheetId);
  const q = options.q?.trim().toLowerCase().slice(0, 100);
  if (q) query = query.ilike("lookup_text", `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);

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

