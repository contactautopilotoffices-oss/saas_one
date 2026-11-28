/**
 * A candidate's history and blacklist (owner 2026-11-15, migration 20261115000002).
 *
 *   candidate_actions   : insert-only. Every status change, stage move, remark, blacklist, resume attach is one row
 *                         with who and when; the timeline on the candidate's panel reads it newest first. Writing it
 *                         never fails the action it records: before the migration the table is missing, and the
 *                         status change (say) still goes through, with a warning in the log.
 *   candidates.blacklist*: a blacklisted PERSON is hidden from every search path (filter-search.ts, the SQL function)
 *                         unless HR ticks "Show blacklisted". Any HR user may blacklist or undo it; both are history.
 *
 * Access is the caller's job (requireCandidateAccess); everything here runs with the service role.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import type { RemarkBullet } from "./remark-format";
import { CandidateActionError, getRecord, updateRecord } from "./records";
import { BLACKLIST_REASONS, REMARK_REQUIRED_STATUSES, STATUS_LABELS, type Blacklist, type BlacklistReason, type CandidateRecord, type RecordStatus } from "./types";

export const ACTION_TYPES = [
  "status_change", "stage_change", "remark", "blacklist", "unblacklist", "resume_attached", "resume_marked",
  "added_to_position", "removed_from_position", "call_logged", "field_edit",
  // Owner 2026-11-16: a WhatsApp update sent to the candidate (migration 20261116000003)
  "outreach_sent",
  // Owner 2026-11-16: a resume or sheet row brought a person already in the database (migration 20261116000004)
  "duplicate_flagged",
] as const;
export type ActionType = (typeof ACTION_TYPES)[number];

export interface CandidateAction {
  id: string;
  candidateId: string;
  applicationId: string | null;
  positionId: string | null;
  action: ActionType;
  fromValue: string | null;
  toValue: string | null;
  remark: string | null;
  meta: Record<string, unknown>;
  byName: string | null;
  at: string;
}

/** Who did it, as the history shows it. */
export interface Actor {
  id: string;
  name: string | null;
}

/** The row in the app's shape. */
function toAction(row: Record<string, unknown>): CandidateAction {
  return {
    id: row.id as string,
    candidateId: row.candidate_id as string,
    applicationId: (row.application_id as string | null) ?? null,
    positionId: (row.position_id as string | null) ?? null,
    action: row.action as ActionType,
    fromValue: (row.from_value as string | null) ?? null,
    toValue: (row.to_value as string | null) ?? null,
    remark: (row.remark as string | null) ?? null,
    meta: (row.meta as Record<string, unknown> | null) ?? {},
    byName: (row.created_by_name as string | null) ?? null,
    at: row.created_at as string,
  };
}

/** The migration is not applied: the table or a column is missing. Remembered briefly, so the log is not flooded. */
let historyMissingAt = 0;
const HISTORY_RECHECK_MS = 5 * 60 * 1000;
const historyKnownMissing = () => Date.now() - historyMissingAt < HISTORY_RECHECK_MS;
const missingRelation = (error: { code?: string; message?: string } | null | undefined) =>
  Boolean(error) && (["42P01", "42703", "PGRST205", "PGRST204"].includes(error?.code ?? "") || /does not exist|schema cache/i.test(error?.message ?? ""));

/** Tests only. */
export function resetHistoryCheck(): void {
  historyMissingAt = 0;
}

export const REMARK_MAX = 1000;
const remarkSchema = z.string().trim().max(REMARK_MAX);

/** A remark as typed, trimmed; null when empty. Throws a 400 for one too long. */
export function cleanRemark(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new CandidateActionError(400, "The remark must be text.");
  const parsed = remarkSchema.safeParse(value);
  if (!parsed.success) throw new CandidateActionError(400, `Keep the remark under ${REMARK_MAX} characters.`);
  return parsed.data || null;
}

/**
 * One history row. Never throws for a missing table (the migration not applied): the action it records has already
 * happened, and a warning is logged instead.
 */
export async function recordAction(
  client: SupabaseClient,
  orgId: string,
  by: Actor,
  entry: {
    candidateId: string;
    applicationId?: string | null;
    positionId?: string | null;
    action: ActionType;
    fromValue?: string | null;
    toValue?: string | null;
    remark?: string | null;
    meta?: Record<string, unknown>;
  },
): Promise<void> {
  if (historyKnownMissing()) return;
  const { error } = await client.from("candidate_actions").insert({
    organization_id: orgId,
    candidate_id: entry.candidateId,
    application_id: entry.applicationId ?? null,
    position_id: entry.positionId ?? null,
    action: entry.action,
    from_value: entry.fromValue ?? null,
    to_value: entry.toValue ?? null,
    remark: entry.remark ?? null,
    meta: entry.meta ?? {},
    created_by: by.id,
    created_by_name: by.name,
  });
  if (!error) return;
  if (missingRelation(error)) {
    historyMissingAt = Date.now();
    console.warn("[candidates] history not recorded: migration 20261115000002 not applied");
    return;
  }
  console.error("[candidates] history not recorded", error);
}

/**
 * Edits a record and writes the history (owner 2026-11-15). `actionRemark` in the body is the reason for this change
 * (never saved on the record); it is REQUIRED when the status becomes one of REMARK_REQUIRED_STATUSES ("Others"),
 * and the record's own remark counts when it was changed in the same edit. What is recorded: a status_change (with
 * the remark), a remark on its own, and a field_edit naming the fields that changed.
 */
export async function changeRecordWithHistory(client: SupabaseClient, orgId: string, by: Actor, id: string, body: Record<string, unknown>): Promise<CandidateRecord> {
  const { actionRemark, ...fields } = body;
  const given = cleanRemark(actionRemark);
  const before = await getRecord(client, orgId, id);
  const nextStatus = typeof fields.status === "string" && fields.status !== before.status ? (fields.status as RecordStatus) : null;
  const remarkChanged = typeof fields.remark === "string" && fields.remark.trim() && fields.remark.trim() !== (before.remark ?? "").trim() ? fields.remark.trim() : null;
  const reason = given ?? remarkChanged;
  if (nextStatus && REMARK_REQUIRED_STATUSES.includes(nextStatus) && !reason) {
    throw new CandidateActionError(400, `Say what "${STATUS_LABELS[nextStatus]}" means for this candidate: a remark is required.`);
  }

  const saved = await updateRecord(client, orgId, by.id, id, fields);

  const changed = Object.keys(fields).filter((k) => k !== "status" && k !== "orgId");
  const common = { candidateId: before.candidateId, applicationId: before.id };
  // The field edit first, so the status change (the one with the remark) is the newest entry in the timeline.
  if (changed.length) {
    await recordAction(client, orgId, by, { ...common, action: "field_edit", meta: { fields: changed } });
  }
  if (nextStatus) {
    await recordAction(client, orgId, by, { ...common, action: "status_change", fromValue: before.status, toValue: nextStatus, remark: reason });
  } else if (given) {
    await recordAction(client, orgId, by, { ...common, action: "remark", remark: given });
  }
  return saved;
}

/**
 * The person is in this position now (a live row in the pipeline). A note filed under a position must belong to it.
 * Throws a 400 for a malformed id and a 404 when they are not (or no longer) in it.
 */
export async function assertInPosition(client: SupabaseClient, orgId: string, candidateId: string, positionId: unknown): Promise<string> {
  if (typeof positionId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(positionId)) {
    throw new CandidateActionError(400, "positionId must be a uuid.");
  }
  const { data, error } = await client
    .from("candidate_position_members")
    .select("id")
    .eq("organization_id", orgId)
    .eq("position_id", positionId)
    .eq("candidate_id", candidateId)
    .is("deleted_at", null)
    .limit(1);
  if (error) {
    console.error("[candidates] position check failed", error);
    throw new CandidateActionError(500, "Couldn't check the position. Please try again.");
  }
  if (!data?.length) throw new CandidateActionError(404, "This person is no longer in that position.");
  return positionId;
}

/**
 * A remark on its own, from the panel's "Add remark". From the pipeline (owner 2026-11-17) it may be filed under the
 * position the panel was opened from (`positionId`), so it shows in that position's history.
 */
export async function addRemark(client: SupabaseClient, orgId: string, by: Actor, id: string, remarkInput: unknown, positionIdInput?: unknown, format?: (remark: string) => Promise<RemarkBullet[]>): Promise<void> {
  const remark = cleanRemark(remarkInput);
  if (!remark) throw new CandidateActionError(400, "Type the remark first.");
  const record = await getRecord(client, orgId, id);
  const positionId = positionIdInput === undefined || positionIdInput === null ? null : await assertInPosition(client, orgId, record.candidateId, positionIdInput);
  if (historyKnownMissing()) throw new CandidateActionError(409, "Remarks need a database update first (migration 20261115000002).");
  const bullets = format ? await format(remark) : [];
  await recordAction(client, orgId, by, { candidateId: record.candidateId, applicationId: record.id, positionId, action: "remark", remark, meta: bullets.length ? { bullets } : {} });
  if (historyKnownMissing()) throw new CandidateActionError(409, "Remarks need a database update first (migration 20261115000002).");
}

// Interviews and feedback (owner 2026-11-17) --------------------------------------------------------------------------

export const NOTE_KINDS = ["interview", "feedback"] as const;
export type NoteKind = (typeof NOTE_KINDS)[number];
export const NOTE_LABELS: Record<NoteKind, string> = { interview: "Interview scheduled", feedback: "Interview feedback" };

const PositionNoteInput = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("interview"),
    positionId: z.string(),
    /** Local date and time as the form gives it, "2026-11-20T15:30". */
    at: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "Pick the date and time of the interview."),
    interviewer: z.string().trim().max(120).optional(),
    mode: z.enum(["in_person", "video", "phone"]).optional(),
    note: z.string().trim().max(REMARK_MAX).optional(),
  }),
  z.object({
    kind: z.literal("feedback"),
    positionId: z.string(),
    round: z.string().trim().min(1, "Say which round.").max(60),
    rating: z.number().int().min(1).max(5),
    recommendation: z.enum(["move_ahead", "hold", "reject"]),
    note: z.string().trim().min(1, "Write the feedback.").max(REMARK_MAX),
  }),
]);

/**
 * An interview scheduled, or one round's feedback, filed under the position (owner 2026-11-17). Both are history
 * entries (`remark` with `meta.kind`), so nothing new is needed in the database: insert-only, with who and when, like
 * every other entry. Moving the stage is a separate, explicit step (the panel does it when HR ticks the box).
 */
export async function addPositionNote(client: SupabaseClient, orgId: string, by: Actor, id: string, body: unknown): Promise<void> {
  const parsed = PositionNoteInput.safeParse(body ?? {});
  if (!parsed.success) throw new CandidateActionError(400, parsed.error.issues[0]?.message ?? "Check the form.");
  const input = parsed.data;
  const record = await getRecord(client, orgId, id);
  const positionId = await assertInPosition(client, orgId, record.candidateId, input.positionId);
  if (historyKnownMissing()) throw new CandidateActionError(409, "This needs a database update first (migration 20261115000002).");
  const meta: Record<string, unknown> = input.kind === "interview"
    ? { kind: "interview", at: input.at, interviewer: input.interviewer || null, mode: input.mode ?? null }
    : { kind: "feedback", round: input.round, rating: input.rating, recommendation: input.recommendation };
  await recordAction(client, orgId, by, {
    candidateId: record.candidateId, applicationId: record.id, positionId, action: "remark",
    toValue: NOTE_LABELS[input.kind], remark: input.note || null, meta,
  });
  if (historyKnownMissing()) throw new CandidateActionError(409, "This needs a database update first (migration 20261115000002).");
}

/** The candidate's history, newest first (every record of the person, every position). */
export async function listActions(client: SupabaseClient, orgId: string, candidateId: string, limit = 200): Promise<CandidateAction[]> {
  if (historyKnownMissing()) return [];
  const { data, error } = await client
    .from("candidate_actions")
    .select("id, candidate_id, application_id, position_id, action, from_value, to_value, remark, meta, created_by_name, created_at")
    .eq("organization_id", orgId)
    .eq("candidate_id", candidateId)
    .order("created_at", { ascending: false })
    .order("id")
    .limit(Math.min(500, Math.max(1, limit)));
  if (error) {
    if (missingRelation(error)) { historyMissingAt = Date.now(); return []; }
    console.error("[candidates] history failed", error);
    throw new CandidateActionError(500, "Couldn't load the history. Please try again.");
  }
  return ((data ?? []) as Record<string, unknown>[])
    .map(toAction)
    // Owner 2026-11-16: "already in the database" notes written under the first rule (every CV meeting its own sheet
    // row) are hidden; the current rule's notes carry rule 2 (known.ts, KNOWN_RULE). Nothing is deleted.
    .filter((a) => a.action !== "duplicate_flagged" || a.meta.rule === 2);
}

// Blacklist ---------------------------------------------------------------------------------------------------------

interface BlacklistRow {
  id: string;
  blacklisted_at: string | null;
  blacklisted_by: string | null;
  blacklist_reason: string | null;
  blacklist_remark: string | null;
}

const BLACKLIST_COLUMNS = "id, blacklisted_at, blacklisted_by, blacklist_reason, blacklist_remark";

function toBlacklist(row: BlacklistRow, names: Map<string, string | null>): Blacklist | null {
  if (!row.blacklisted_at) return null;
  return {
    at: row.blacklisted_at,
    byName: row.blacklisted_by ? (names.get(row.blacklisted_by) ?? null) : null,
    reason: (BLACKLIST_REASONS as readonly string[]).includes(row.blacklist_reason ?? "") ? (row.blacklist_reason as BlacklistReason) : "other",
    remark: row.blacklist_remark ?? null,
  };
}

/** Names of these users (who blacklisted, who moved a card, the recruiter). A missing users table or row leaves the name null. */
export async function namesOf(client: SupabaseClient, ids: string[]): Promise<Map<string, string | null>> {
  const names = new Map<string, string | null>();
  const wanted = [...new Set(ids.filter(Boolean))];
  if (!wanted.length) return names;
  const { data, error } = await client.from("users").select("id, full_name").in("id", wanted);
  if (error) return names;
  for (const row of (data ?? []) as { id: string; full_name: string | null }[]) names.set(row.id, row.full_name ?? null);
  return names;
}

/** The person's blacklist entry; null when not blacklisted; undefined before the migration (nothing to show). */
export async function loadBlacklist(client: SupabaseClient, orgId: string, candidateId: string): Promise<Blacklist | null | undefined> {
  if (historyKnownMissing()) return undefined;
  const { data, error } = await client.from("candidates").select(BLACKLIST_COLUMNS).eq("organization_id", orgId).eq("id", candidateId).maybeSingle();
  if (error) {
    if (missingRelation(error)) { historyMissingAt = Date.now(); return undefined; }
    console.error("[candidates] blacklist read failed", error);
    return undefined;
  }
  const row = data as BlacklistRow | null;
  if (!row) return null;
  return toBlacklist(row, await namesOf(client, [row.blacklisted_by ?? ""]));
}

/** Sets `blacklisted` on these records (lists that show blacklisted people). Quiet before the migration. */
export async function markBlacklisted(client: SupabaseClient, orgId: string, records: CandidateRecord[]): Promise<void> {
  if (historyKnownMissing()) return;
  const ids = [...new Set(records.map((r) => r.candidateId))];
  if (!ids.length) return;
  const { data, error } = await client.from("candidates").select("id, blacklisted_at").eq("organization_id", orgId).in("id", ids).not("blacklisted_at", "is", null);
  if (error) {
    if (missingRelation(error)) historyMissingAt = Date.now();
    return;
  }
  const listed = new Set((data ?? []).map((row) => row.id as string));
  for (const record of records) record.blacklisted = listed.has(record.candidateId);
}

const BlacklistInput = z.object({
  reason: z.enum(BLACKLIST_REASONS),
  remark: z.string().trim().max(REMARK_MAX).optional(),
});

/**
 * Blacklists the person (every record of theirs). Idempotent: blacklisting again changes the reason and remark, and
 * is recorded again. The row written to history says the reason; the remark is kept factual by the person writing it.
 */
export async function setBlacklist(client: SupabaseClient, orgId: string, by: Actor, candidateId: string, body: unknown): Promise<Blacklist> {
  const parsed = BlacklistInput.safeParse(body ?? {});
  if (!parsed.success) throw new CandidateActionError(400, "Pick a reason from the list; the remark is optional.");
  const remark = parsed.data.remark || null;
  const now = new Date().toISOString();
  const { data, error } = await client
    .from("candidates")
    .update({ blacklisted_at: now, blacklisted_by: by.id, blacklist_reason: parsed.data.reason, blacklist_remark: remark, updated_at: now })
    .eq("organization_id", orgId)
    .eq("id", candidateId)
    .select(BLACKLIST_COLUMNS)
    .maybeSingle();
  if (error) {
    if (missingRelation(error)) throw new CandidateActionError(409, "Blacklisting needs a database update first (migration 20261115000002).");
    console.error("[candidates] blacklist failed", error);
    throw new CandidateActionError(500, "Couldn't blacklist this candidate. Please try again.");
  }
  if (!data) throw new CandidateActionError(404, "That candidate no longer exists.");
  await recordAction(client, orgId, by, { candidateId, action: "blacklist", toValue: parsed.data.reason, remark });
  return toBlacklist(data as BlacklistRow, new Map([[by.id, by.name]])) as Blacklist;
}

/** Takes the person off the blacklist. The remark says why, when given; the entry stays in history. */
export async function clearBlacklist(client: SupabaseClient, orgId: string, by: Actor, candidateId: string, remarkInput: unknown): Promise<void> {
  const remark = cleanRemark(remarkInput);
  const before = await loadBlacklist(client, orgId, candidateId);
  if (before === undefined) throw new CandidateActionError(409, "This needs a database update first (migration 20261115000002).");
  if (before === null) return;
  const now = new Date().toISOString();
  const { error } = await client
    .from("candidates")
    .update({ blacklisted_at: null, blacklisted_by: null, blacklist_reason: null, blacklist_remark: null, updated_at: now })
    .eq("organization_id", orgId)
    .eq("id", candidateId);
  if (error) {
    console.error("[candidates] unblacklist failed", error);
    throw new CandidateActionError(500, "Couldn't remove the blacklist. Please try again.");
  }
  await recordAction(client, orgId, by, { candidateId, action: "unblacklist", fromValue: before.reason, remark });
}
