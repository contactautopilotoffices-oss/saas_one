/**
 * Positions and their pipelines (owner 2026-11-15, migration 20261115000002).
 *
 *   candidate_positions        : a saved job description (title, where, the text, the filters HR confirmed), open or closed
 *   candidate_position_members : one row per person per position, at a stage. Owner 2026-11-19: the stages are the
 *                                list HR keeps in Recruitment -> Configurations (stages.ts); a move to a stage marked
 *                                "remark needed" needs a remark, and new people start at the list's first stage.
 * Every add, move and removal is written to candidate_actions (actions.ts). A person's record status is NOT changed
 * by a stage move: the record is the database view of the person, the stage is this position's view.
 *
 * Access is the caller's job (requireCandidateAccess); everything here runs with the service role.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { cleanRemark, namesOf, recordAction, type Actor } from "./actions";
import { MAX_JD_LENGTH } from "./config";
import { parseFilters } from "./filter-search";
import { jdLinksFor } from "./jd-library";
import type { SearchFilters } from "./filters";
import { PreferSchema, type Preferences } from "./query-spec";
import { CandidateActionError, getRecordRows, markResumes, toRecord } from "./records";
import { findStage, firstStage, stageName, type StageDef } from "./stage-list";
import { loadStages } from "./stages";
import {
  EMPLOYMENT_TYPES, POSITION_PRIORITIES,
  type CandidateRecord, type EmploymentType, type Position, type PositionMember, type PositionPriority, type Stage,
} from "./types";

// The Position / PositionMember shapes are in types.ts (pure, shared with the client).
export { type Position, type PositionMember, type Stage } from "./types";

const POSITION_COLUMNS = "id, title, department, location, jd_file_name, filters, prefer, status, target_days, recruiter_id, created_at, updated_at, closed_at";
/** The job's details (migration 20261116000005, owner 2026-11-16); read and written only once the migration is applied. */
const DETAIL_COLUMNS = ", designation, employment_type, openings, hiring_manager, priority, education, budget_min_inhand, budget_max_inhand, summary";
const DETAIL_KEYS = ["designation", "employment_type", "openings", "hiring_manager", "priority", "education", "budget_min_inhand", "budget_max_inhand", "summary"];
const MEMBER_COLUMNS = "id, position_id, candidate_id, application_id, stage, stage_changed_at, stage_changed_by, remark, added_at";

const missingRelation = (error: { code?: string; message?: string } | null | undefined) =>
  Boolean(error) && (["42P01", "42703", "PGRST205", "PGRST204"].includes(error?.code ?? "") || /does not exist|schema cache/i.test(error?.message ?? ""));
/** Migration 20261116000005 not applied: a detail column is missing. */
const detailsMissing = (error: { code?: string; message?: string } | null | undefined) =>
  Boolean(error) && ["42703", "PGRST204"].includes(error?.code ?? "") && new RegExp(DETAIL_KEYS.join("|")).test(error?.message ?? "");
/** The same row without the detail columns. */
function withoutDetails(row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(row).filter(([k]) => !DETAIL_KEYS.includes(k)));
}

function fail(what: string, error: { code?: string; message?: string }): never {
  if (missingRelation(error)) throw new CandidateActionError(409, "Positions need a database update first (migration 20261115000002).");
  console.error(`[candidates] positions: ${what}`, error);
  throw new CandidateActionError(500, `Couldn't ${what}. Please try again.`);
}

const emptyCounts = (): Record<Stage, number> => ({});

const daysBetween = (from: string, to: string | null) => Math.max(0, Math.floor((new Date(to ?? Date.now()).getTime() - new Date(from).getTime()) / 86_400_000));

function toPosition(row: Record<string, unknown>, counts: Record<Stage, number>, withText = false, names: Map<string, string | null> = new Map()): Position {
  return {
    recruiterId: (row.recruiter_id as string | null) ?? null,
    recruiterName: row.recruiter_id ? (names.get(row.recruiter_id as string) ?? null) : null,
    id: row.id as string,
    title: row.title as string,
    department: (row.department as string | null) ?? null,
    location: (row.location as string | null) ?? null,
    jdFileName: (row.jd_file_name as string | null) ?? null,
    ...(withText ? { jdText: (row.jd_text as string | null) ?? null } : {}),
    filters: ((row.filters as Partial<SearchFilters> | null) ?? {}),
    prefer: ((row.prefer as Preferences | null) ?? {}),
    status: row.status as "open" | "closed",
    targetDays: (row.target_days as number) ?? 21,
    designation: (row.designation as string | null) ?? null,
    employmentType: (row.employment_type as EmploymentType | null) ?? null,
    openings: Number(row.openings) || 1,
    hiringManager: (row.hiring_manager as string | null) ?? null,
    priority: (POSITION_PRIORITIES as readonly string[]).includes(String(row.priority)) ? (row.priority as PositionPriority) : "normal",
    education: (row.education as string | null) ?? null,
    budgetMinInhand: row.budget_min_inhand === null || row.budget_min_inhand === undefined ? null : Number(row.budget_min_inhand),
    budgetMaxInhand: row.budget_max_inhand === null || row.budget_max_inhand === undefined ? null : Number(row.budget_max_inhand),
    summary: (row.summary as string | null) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    closedAt: (row.closed_at as string | null) ?? null,
    daysOpen: daysBetween(row.created_at as string, (row.closed_at as string | null) ?? null),
    counts,
  };
}

/** Stage counts per position, from the live member rows. */
async function countsFor(client: SupabaseClient, orgId: string, positionIds: string[]): Promise<Map<string, Record<Stage, number>>> {
  const out = new Map<string, Record<Stage, number>>(positionIds.map((id) => [id, emptyCounts()]));
  if (!positionIds.length) return out;
  const { data, error } = await client.from("candidate_position_members").select("position_id, stage").eq("organization_id", orgId).in("position_id", positionIds).is("deleted_at", null);
  if (error) fail("count the pipeline", error);
  for (const row of (data ?? []) as { position_id: string; stage: Stage }[]) {
    const counts = out.get(row.position_id);
    if (counts) counts[row.stage] = (counts[row.stage] ?? 0) + 1;
  }
  return out;
}

/** Open positions first, newest first; `status` narrows. */
export async function listPositions(client: SupabaseClient, orgId: string, status: "open" | "closed" | "all" = "open"): Promise<Position[]> {
  const run = (columns: string) => {
    let q = client.from("candidate_positions").select(columns).eq("organization_id", orgId).is("deleted_at", null);
    if (status !== "all") q = q.eq("status", status);
    return q.order("status", { ascending: true }).order("created_at", { ascending: false }).limit(200);
  };
  let { data, error } = await run(POSITION_COLUMNS + DETAIL_COLUMNS);
  if (error && detailsMissing(error)) ({ data, error } = await run(POSITION_COLUMNS));
  if (error) fail("load the positions", error);
  const rows = (data ?? []) as unknown as Record<string, unknown>[];
  const ids = rows.map((r) => r.id as string);
  const [counts, names, jds] = await Promise.all([countsFor(client, orgId, ids), namesOf(client, rows.map((r) => r.recruiter_id as string).filter(Boolean)), jdLinksFor(client, orgId, ids)]);
  // Owner 2026-11-17: the library JD each came from (none before migration 20261117000002).
  return rows.map((row) => ({ ...toPosition(row, counts.get(row.id as string) ?? emptyCounts(), false, names), jd: jds.get(row.id as string) ?? null }));
}

export async function getPosition(client: SupabaseClient, orgId: string, id: string): Promise<Position> {
  const run = (columns: string) => client.from("candidate_positions").select(`${columns}, jd_text`).eq("organization_id", orgId).eq("id", id).is("deleted_at", null).maybeSingle();
  let { data, error } = await run(POSITION_COLUMNS + DETAIL_COLUMNS);
  if (error && detailsMissing(error)) ({ data, error } = await run(POSITION_COLUMNS));
  if (error) fail("load the position", error);
  if (!data) throw new CandidateActionError(404, "That position no longer exists.");
  const row = data as unknown as Record<string, unknown>;
  const [counts, names, jds] = await Promise.all([countsFor(client, orgId, [id]), namesOf(client, [row.recruiter_id as string].filter(Boolean)), jdLinksFor(client, orgId, [id])]);
  return { ...toPosition(row, counts.get(id) ?? emptyCounts(), true, names), jd: jds.get(id) ?? null };
}

const text = (max: number) => z.string().trim().max(max);
const nullableText = (max: number) => text(max).nullable().optional();
const rupees = z.number().int().min(0).max(10_000_000).nullable().optional();
const PositionInput = z.object({
  title: text(120).min(1, "Give the position a title."),
  department: text(80).nullable().optional(),
  location: text(80).nullable().optional(),
  jdText: z.string().max(MAX_JD_LENGTH).optional(),
  jdFileName: text(200).nullable().optional(),
  filters: z.unknown().optional(),
  prefer: PreferSchema.optional(),
  targetDays: z.number().int().min(1).max(365).optional(),
  // Owner 2026-11-16: the job's details (migration 20261116000005).
  designation: nullableText(120),
  employmentType: z.enum(EMPLOYMENT_TYPES, { message: "Employment type must be full-time, part-time, contract or internship." }).nullable().optional(),
  openings: z.number().int().min(1, "At least one opening.").max(500).optional(),
  hiringManager: nullableText(120),
  priority: z.enum(POSITION_PRIORITIES, { message: "Priority must be low, normal, high or urgent." }).optional(),
  education: nullableText(200),
  budgetMinInhand: rupees,
  budgetMaxInhand: rupees,
  summary: nullableText(2000),
  // Owner 2026-11-21: who recruits for it (null: nobody yet). The route checks the person is in the HR team.
  recruiterId: z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "Pick the recruiter from the list.").nullable().optional(),
});

function positionColumns(input: z.infer<typeof PositionInput>, partial: boolean): Record<string, unknown> {
  // Checked here, not with a zod refinement: an edit parses the schema with .partial(), which refinements forbid.
  if (input.budgetMinInhand !== null && input.budgetMinInhand !== undefined && input.budgetMaxInhand !== null && input.budgetMaxInhand !== undefined && input.budgetMinInhand > input.budgetMaxInhand) {
    throw new CandidateActionError(400, "The budget's minimum is above its maximum.");
  }
  const out: Record<string, unknown> = {};
  const set = (key: string, value: unknown) => { if (value !== undefined || !partial) out[key] = value ?? null; };
  set("title", input.title);
  set("department", input.department || null);
  set("location", input.location || null);
  if (input.jdText !== undefined) out.jd_text = input.jdText.trim() || null;
  if (input.jdFileName !== undefined) out.jd_file_name = input.jdFileName || null;
  if (input.filters !== undefined) out.filters = parseFilters(input.filters);
  if (input.prefer !== undefined) out.prefer = input.prefer;
  if (input.targetDays !== undefined) out.target_days = input.targetDays;
  // The details: only the keys given (an edit leaves the rest alone; a create stores what the form sent).
  if (input.designation !== undefined) out.designation = input.designation || null;
  if (input.employmentType !== undefined) out.employment_type = input.employmentType;
  if (input.openings !== undefined) out.openings = input.openings;
  if (input.hiringManager !== undefined) out.hiring_manager = input.hiringManager || null;
  if (input.priority !== undefined) out.priority = input.priority;
  if (input.education !== undefined) out.education = input.education || null;
  if (input.budgetMinInhand !== undefined) out.budget_min_inhand = input.budgetMinInhand;
  if (input.budgetMaxInhand !== undefined) out.budget_max_inhand = input.budgetMaxInhand;
  if (input.summary !== undefined) out.summary = input.summary || null;
  if (input.recruiterId !== undefined) out.recruiter_id = input.recruiterId;
  return out;
}

/** Saves a job description as an open position, with the filters HR confirmed. */
export async function createPosition(client: SupabaseClient, orgId: string, by: Actor, body: unknown): Promise<Position> {
  const parsed = PositionInput.safeParse(body ?? {});
  if (!parsed.success) throw new CandidateActionError(400, parsed.error.issues[0]?.message ?? "Those details are not valid.");
  const now = new Date().toISOString();
  // The person who saves it recruits for it, unless the body names someone (or nobody: a role opened from a hiring request).
  const row = { organization_id: orgId, recruiter_id: by.id, ...positionColumns(parsed.data, false), created_by: by.id, created_at: now, updated_at: now };
  // Before migration 20261116000005 the detail columns are missing: the position is saved without them.
  let { data, error } = await client.from("candidate_positions").insert(row).select(POSITION_COLUMNS + DETAIL_COLUMNS).single();
  if (error && detailsMissing(error)) ({ data, error } = await client.from("candidate_positions").insert(withoutDetails(row)).select(POSITION_COLUMNS).single());
  if (error) fail("save the position", error);
  return toPosition(data as unknown as Record<string, unknown>, emptyCounts(), false, new Map([[by.id, by.name]]));
}

/** Edits a position; `status: "closed"` closes it (and "open" reopens it). */
export async function updatePosition(client: SupabaseClient, orgId: string, id: string, body: unknown): Promise<Position> {
  const b = (body ?? {}) as Record<string, unknown>;
  const parsed = PositionInput.partial().safeParse(b);
  if (!parsed.success) throw new CandidateActionError(400, parsed.error.issues[0]?.message ?? "Those details are not valid.");
  const columns = positionColumns(parsed.data as z.infer<typeof PositionInput>, true);
  const now = new Date().toISOString();
  if (b.status === "closed") { columns.status = "closed"; columns.closed_at = now; }
  else if (b.status === "open") { columns.status = "open"; columns.closed_at = null; }
  else if (b.status !== undefined) throw new CandidateActionError(400, "A position is open or closed.");
  const run = (values: Record<string, unknown>, select: string) =>
    client.from("candidate_positions").update({ ...values, updated_at: now }).eq("organization_id", orgId).eq("id", id).is("deleted_at", null).select(select).maybeSingle();
  let { data, error } = await run(columns, POSITION_COLUMNS + DETAIL_COLUMNS);
  if (error && detailsMissing(error)) ({ data, error } = await run(withoutDetails(columns), POSITION_COLUMNS));
  if (error) fail("save the position", error);
  if (!data) throw new CandidateActionError(404, "That position no longer exists.");
  const row = data as unknown as Record<string, unknown>;
  const [counts, names] = await Promise.all([countsFor(client, orgId, [id]), namesOf(client, [row.recruiter_id as string].filter(Boolean))]);
  return toPosition(row, counts.get(id) ?? emptyCounts(), false, names);
}

/**
 * Deletes a position (owner 2026-11-16). Soft: the position leaves every list and dropdown, and the people in its
 * pipeline are taken out of it, each with a "removed from position" entry in their history. Nothing is erased: old
 * calls and WhatsApp messages still name the position. Returns how many people were taken out.
 */
export async function deletePosition(client: SupabaseClient, orgId: string, by: Actor, id: string): Promise<{ removed: number }> {
  const position = await getPosition(client, orgId, id);
  const { stages } = await loadStages(client, orgId);
  const now = new Date().toISOString();
  const { data: gone, error } = await client
    .from("candidate_positions")
    .update({ deleted_at: now, updated_at: now })
    .eq("organization_id", orgId)
    .eq("id", id)
    .is("deleted_at", null)
    .select("id");
  if (error) fail("delete the position", error);
  if (!gone?.length) throw new CandidateActionError(404, "That position no longer exists.");

  const { data: members, error: membersErr } = await client
    .from("candidate_position_members")
    .update({ deleted_at: now, updated_at: now })
    .eq("organization_id", orgId)
    .eq("position_id", id)
    .is("deleted_at", null)
    .select(MEMBER_COLUMNS);
  if (membersErr) fail("take the people out of the position", membersErr);
  const rows = (members ?? []) as unknown as Record<string, unknown>[];
  for (const row of rows) {
    await recordAction(client, orgId, by, {
      candidateId: row.candidate_id as string,
      applicationId: (row.application_id as string | null) ?? null,
      positionId: id,
      action: "removed_from_position",
      fromValue: stageName(stages, row.stage as Stage),
      remark: `Position "${position.title}" was deleted.`,
    });
  }
  return { removed: rows.length };
}

function toMember(row: Record<string, unknown>, record: CandidateRecord | null, names: Map<string, string | null> = new Map()): PositionMember {
  return {
    id: row.id as string,
    positionId: row.position_id as string,
    candidateId: row.candidate_id as string,
    applicationId: (row.application_id as string | null) ?? null,
    stage: row.stage as Stage,
    stageChangedAt: row.stage_changed_at as string,
    stageChangedByName: row.stage_changed_by ? (names.get(row.stage_changed_by as string) ?? null) : null,
    remark: (row.remark as string | null) ?? null,
    addedAt: row.added_at as string,
    record,
  };
}

/** Everyone in the position's pipeline, latest move first, each with their record. */
export async function listMembers(client: SupabaseClient, orgId: string, positionId: string): Promise<PositionMember[]> {
  const { data, error } = await client
    .from("candidate_position_members")
    .select(MEMBER_COLUMNS)
    .eq("organization_id", orgId)
    .eq("position_id", positionId)
    .is("deleted_at", null)
    .order("stage_changed_at", { ascending: false })
    .order("id")
    .limit(1000);
  if (error) fail("load the pipeline", error);
  const rows = (data ?? []) as Record<string, unknown>[];
  const ids = rows.map((r) => r.application_id as string | null).filter((id): id is string => !!id);
  const [recordRows, names] = await Promise.all([getRecordRows(client, orgId, ids), namesOf(client, rows.map((r) => r.stage_changed_by as string).filter(Boolean))]);
  const records = new Map(recordRows.map((row) => [row.id, toRecord(row)]));
  await markResumes(client, orgId, [...records.values()]);
  return rows.map((row) => toMember(row, row.application_id ? (records.get(row.application_id as string) ?? null) : null, names));
}

const idList = z.array(z.string().uuid()).min(1).max(200);

/**
 * Adds the people behind these records to the position, at the list's first stage ("Sourced"). A person already in it
 * is skipped (one row per person per position). Returns how many were added and how many were already there.
 */
export async function addMembers(client: SupabaseClient, orgId: string, by: Actor, positionId: string, applicationIds: unknown): Promise<{ added: number; skipped: number }> {
  const ids = idList.safeParse(applicationIds);
  if (!ids.success) throw new CandidateActionError(400, "Pick at least one candidate (up to 200 at a time).");
  const position = await getPosition(client, orgId, positionId);
  const start = firstStage((await loadStages(client, orgId)).stages).key;
  const records = await getRecordRows(client, orgId, [...new Set(ids.data)]);
  const byCandidate = new Map<string, string>();
  for (const row of records) if (!byCandidate.has(row.candidate_id)) byCandidate.set(row.candidate_id, row.id);
  let added = 0;
  let skipped = 0;
  const now = new Date().toISOString();
  for (const [candidateId, applicationId] of byCandidate) {
    const { error } = await client.from("candidate_position_members").insert({
      organization_id: orgId, position_id: positionId, candidate_id: candidateId, application_id: applicationId, stage: start,
      added_by: by.id, stage_changed_by: by.id, added_at: now, stage_changed_at: now, updated_at: now,
    });
    if (error) {
      if (error.code === "23505") { skipped += 1; continue; }
      fail("add to the position", error);
    }
    added += 1;
    await recordAction(client, orgId, by, { candidateId, applicationId, positionId, action: "added_to_position", toValue: position.title });
  }
  return { added, skipped };
}

/** The positions this person is in (the drawer's Positions tab): each with its stage, latest first. */
export async function listMemberships(client: SupabaseClient, orgId: string, candidateId: string): Promise<{ member: Omit<PositionMember, "record">; position: Pick<Position, "id" | "title" | "location" | "status"> }[]> {
  const { data, error } = await client
    .from("candidate_position_members")
    .select(MEMBER_COLUMNS)
    .eq("organization_id", orgId)
    .eq("candidate_id", candidateId)
    .is("deleted_at", null)
    .order("stage_changed_at", { ascending: false })
    .limit(100);
  if (error) fail("load the positions", error);
  const rows = (data ?? []) as Record<string, unknown>[];
  if (!rows.length) return [];
  const ids = [...new Set(rows.map((r) => r.position_id as string))];
  // A deleted position no longer shows on the person (owner 2026-11-16).
  const positions = await client.from("candidate_positions").select("id, title, location, status").eq("organization_id", orgId).in("id", ids).is("deleted_at", null);
  if (positions.error) fail("load the positions", positions.error);
  const byId = new Map((positions.data ?? []).map((p) => [p.id as string, p as { id: string; title: string; location: string | null; status: "open" | "closed" }]));
  return rows.flatMap((row) => {
    const position = byId.get(row.position_id as string);
    if (!position) return [];
    const { record: _record, ...member } = toMember(row, null);
    void _record;
    return [{ member, position }];
  });
}

async function getMember(client: SupabaseClient, orgId: string, positionId: string, memberId: string): Promise<Record<string, unknown>> {
  const { data, error } = await client.from("candidate_position_members").select(MEMBER_COLUMNS).eq("organization_id", orgId).eq("position_id", positionId).eq("id", memberId).is("deleted_at", null).maybeSingle();
  if (error) fail("load the pipeline", error);
  if (!data) throw new CandidateActionError(404, "That person is no longer in this position.");
  return data as Record<string, unknown>;
}

/**
 * Moves one person to a stage of the list (not a hidden one). A stage marked "remark needed" needs a remark; any
 * remark given is kept as the latest on the row.
 */
export async function moveMember(client: SupabaseClient, orgId: string, by: Actor, positionId: string, memberId: string, stageInput: unknown, remarkInput: unknown): Promise<PositionMember> {
  const { stages } = await loadStages(client, orgId);
  const target: StageDef | undefined = typeof stageInput === "string" ? findStage(stages, stageInput) : undefined;
  if (!target) throw new CandidateActionError(400, "That stage does not exist. Reload the page to see the current stages.");
  const stage = target.key;
  const remark = cleanRemark(remarkInput);
  const before = await getMember(client, orgId, positionId, memberId);
  if (target.hidden && before.stage !== stage) throw new CandidateActionError(400, `"${target.name}" is hidden in Configurations, so nobody can be moved there.`);
  if (target.needsRemark && !remark && before.stage !== stage) throw new CandidateActionError(400, `Say what "${target.name}" means for this candidate: a remark is required.`);
  const now = new Date().toISOString();
  const changed = before.stage !== stage;
  const { data, error } = await client
    .from("candidate_position_members")
    .update({ stage, ...(changed ? { stage_changed_at: now, stage_changed_by: by.id } : {}), ...(remark ? { remark } : {}), updated_at: now })
    .eq("organization_id", orgId)
    .eq("id", memberId)
    .select(MEMBER_COLUMNS)
    .single();
  if (error) fail("move the candidate", error);
  const candidateId = before.candidate_id as string;
  const applicationId = (before.application_id as string | null) ?? null;
  if (changed) {
    await recordAction(client, orgId, by, { candidateId, applicationId, positionId, action: "stage_change", fromValue: stageName(stages, before.stage as Stage), toValue: target.name, remark });
  } else if (remark) {
    await recordAction(client, orgId, by, { candidateId, applicationId, positionId, action: "remark", remark });
  }
  const [row] = applicationId ? await getRecordRows(client, orgId, [applicationId]) : [];
  return toMember(data as Record<string, unknown>, row ? toRecord(row) : null, new Map([[by.id, by.name]]));
}

/** Takes one person out of the position (the row is kept, marked deleted; the history says why). */
export async function removeMember(client: SupabaseClient, orgId: string, by: Actor, positionId: string, memberId: string, remarkInput: unknown): Promise<void> {
  const remark = cleanRemark(remarkInput);
  const before = await getMember(client, orgId, positionId, memberId);
  const { stages } = await loadStages(client, orgId);
  const now = new Date().toISOString();
  const { error } = await client.from("candidate_position_members").update({ deleted_at: now, updated_at: now }).eq("organization_id", orgId).eq("id", memberId);
  if (error) fail("remove from the position", error);
  await recordAction(client, orgId, by, { candidateId: before.candidate_id as string, applicationId: (before.application_id as string | null) ?? null, positionId, action: "removed_from_position", fromValue: stageName(stages, before.stage as Stage), remark });
}
