/**
 * Manpower requisitions and their approval (owner 2026-11-17; migration 20261117000003). Stages 1 and 2 of the
 * Recruitment Module spec (12 Nov 2026), followed as written:
 *
 *   Stage 1, the hiring manager : the form (role, department, location, positions, new or replacement and who is
 *                                 replaced, budget band min and max CTC, required skills, minimum experience,
 *                                 qualification, target joining date, justification, reporting manager); the system
 *                                 shows the last requisition for the same role and gives the request an ID
 *                                 (REQ-2026-0001). Exit: submitted for approval. No SLA.
 *   Stage 2, the approval gate  : the HR Head, then the Director. In plan (the HR Head's tick, owner 2026-11-17: "go
 *                                 with the simple tick box"): the HR Head approves and the Director is notified. Out of
 *                                 plan: the HR Head reviews, the Director approves. Above the CTC level set in
 *                                 Settings: the Director approves regardless. Approve, reject with reason, send back
 *                                 for change, put on hold. Alerts, reminders at 24 h and 48 h, escalation at 72 h
 *                                 (requisition-notify.ts). Exit: approved (the role becomes active: a position is
 *                                 opened), rejected, or on hold. SLA 3 working days end to end.
 *   The spec's rule             : "No user can approve a step they themselves raised. If the HR Head raises a
 *                                 requisition, it goes to the Director." A level whose approver raised the request
 *                                 goes to that level's backup, else is skipped to the other level.
 *
 * Who the approvers are, the CTC level and the target days are set in the Tech dashboard (Settings -> Notifications
 * -> Recruitment; organization_settings.recruitment_config), never in code. Nothing here sends anything: every
 * change hands an event to `deps.notify` (the routes pass requisition-notify.ts; tests pass a recorder).
 *
 * Access is the caller's job (the routes' requireOrgMember); everything here runs with the service role.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { namesOf, type Actor } from "./actions";
import { CANDIDATE_ACCESS_ROLES } from "./config";
import { EMPTY_FILTERS } from "./filters";
import { createPosition } from "./positions";
import { CandidateActionError } from "./records";
import {
  APPROVAL_LEVELS, REQUEST_TYPES, REQUISITION_DECISIONS,
  type ApprovalLevel, type RecruitmentConfig, type Requisition, type RequisitionAccess, type RequisitionApproval, type RequisitionStatus,
} from "./types";

const TABLE = "recruitment_requisitions";
const APPROVALS = "recruitment_requisition_approvals";
const SETTINGS = "organization_settings";
const COLUMNS =
  "id, requisition_no, status, current_level, current_approver_id, level_entered_at, role_title, department, location, positions, request_type, replacing_name, " +
  "budget_min_ctc, budget_max_ctc, required_skills, min_experience_years, qualification, target_joining_date, justification, reporting_manager, in_plan, needs_director, " +
  "hold_since, hold_reason, decided_at, decision_reason, position_id, raised_by, raised_by_name, submitted_at, created_at, updated_at";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Stage 2: 3 working days end to end (Monday to Saturday count, as the module's sending hours do). */
export const APPROVAL_SLA_WORKING_DAYS = 3;
export const DEFAULT_TARGET_DAYS = 21;

export const REQUISITIONS_MIGRATION_MESSAGE = "Hiring requests need a database update first: run 20261117000003_recruitment_requisitions.sql in Supabase.";

const missingRelation = (error: { code?: string; message?: string } | null | undefined) =>
  Boolean(error) && (["42P01", "42703", "PGRST205", "PGRST204"].includes(error?.code ?? "") || /recruitment_requisition|recruitment_config|does not exist|schema cache/i.test(error?.message ?? ""));

function fail(what: string, error: { code?: string; message?: string }): never {
  if (missingRelation(error)) throw new CandidateActionError(503, REQUISITIONS_MIGRATION_MESSAGE);
  console.error(`[candidates] requisitions: ${what}`, error);
  throw new CandidateActionError(500, `Couldn't ${what}. Please try again.`);
}

const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : typeof v === "string" ? v : "");
const isoOrNull = (v: unknown): string | null => (v === null || v === undefined ? null : iso(v) || null);
const day = (v: unknown): string | null => { const s = isoOrNull(v); return s ? s.slice(0, 10) : null; };
const num = (v: unknown): number | null => (v === null || v === undefined || v === "" ? null : Number(v));
const daysBetween = (from: string | null, to: string | null, now: Date) => (from ? Math.max(0, Math.floor(((to ? new Date(to) : now).getTime() - new Date(from).getTime()) / 86_400_000)) : 0);

/** Working days (Monday to Saturday) between two instants, for the SLA. */
export function workingDaysBetween(from: Date, to: Date): number {
  if (to <= from) return 0;
  let days = 0;
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  const end = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()));
  while (d < end) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (d.getUTCDay() !== 0) days += 1;
  }
  return days;
}

// Settings ------------------------------------------------------------------------------------------------------------

const EMPTY_CONFIG: RecruitmentConfig = { hrHead: { userId: null, backupUserId: null }, director: { userId: null, backupUserId: null }, directorCtcLevel: null, targetDays: DEFAULT_TARGET_DAYS };

const uuidOrNull = z.string().regex(UUID).nullable().optional();
const ConfigInput = z.object({
  hrHead: z.object({ userId: uuidOrNull, backupUserId: uuidOrNull }).optional(),
  director: z.object({ userId: uuidOrNull, backupUserId: uuidOrNull }).optional(),
  directorCtcLevel: z.number().min(0).max(100_000_000).nullable().optional(),
  targetDays: z.number().int().min(1).max(365).optional(),
});

function toConfig(raw: unknown): RecruitmentConfig {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const slot = (v: unknown) => {
    const s = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
    const id = (x: unknown) => (typeof x === "string" && UUID.test(x) ? x : null);
    return { userId: id(s.userId), backupUserId: id(s.backupUserId) };
  };
  return {
    hrHead: slot(r.hrHead),
    director: slot(r.director),
    directorCtcLevel: typeof r.directorCtcLevel === "number" && r.directorCtcLevel >= 0 ? r.directorCtcLevel : null,
    targetDays: typeof r.targetDays === "number" && r.targetDays >= 1 ? Math.round(r.targetDays) : DEFAULT_TARGET_DAYS,
  };
}

/** The approvers and limits set in the Tech dashboard. Empty (nobody set) before the migration or when never saved. */
export async function loadRecruitmentConfig(client: SupabaseClient, orgId: string): Promise<RecruitmentConfig> {
  const { data, error } = await client.from(SETTINGS).select("recruitment_config").eq("organization_id", orgId).maybeSingle();
  if (error) {
    if (!missingRelation(error)) console.error("[candidates] recruitment config read failed", error);
    return EMPTY_CONFIG;
  }
  return toConfig((data as { recruitment_config?: unknown } | null)?.recruitment_config);
}

/** Saves the settings (the Tech dashboard). Only the keys given change. */
export async function saveRecruitmentConfig(client: SupabaseClient, orgId: string, body: unknown): Promise<RecruitmentConfig> {
  const parsed = ConfigInput.safeParse(body ?? {});
  if (!parsed.success) throw new CandidateActionError(400, parsed.error.issues[0]?.message ?? "Those settings are not valid.");
  const current = await loadRecruitmentConfig(client, orgId);
  const next: RecruitmentConfig = {
    hrHead: { userId: parsed.data.hrHead?.userId === undefined ? current.hrHead.userId : parsed.data.hrHead.userId, backupUserId: parsed.data.hrHead?.backupUserId === undefined ? current.hrHead.backupUserId : parsed.data.hrHead.backupUserId },
    director: { userId: parsed.data.director?.userId === undefined ? current.director.userId : parsed.data.director.userId, backupUserId: parsed.data.director?.backupUserId === undefined ? current.director.backupUserId : parsed.data.director.backupUserId },
    directorCtcLevel: parsed.data.directorCtcLevel === undefined ? current.directorCtcLevel : parsed.data.directorCtcLevel,
    targetDays: parsed.data.targetDays ?? current.targetDays,
  };
  for (const level of APPROVAL_LEVELS) {
    const s = next[level === "hr_head" ? "hrHead" : "director"];
    if (s.backupUserId && s.backupUserId === s.userId) throw new CandidateActionError(400, "The backup must be a different person from the approver.");
  }
  const now = new Date().toISOString();
  const { data: existing, error: readErr } = await client.from(SETTINGS).select("organization_id").eq("organization_id", orgId).maybeSingle();
  if (readErr) fail("save the settings", readErr);
  const { error } = existing
    ? await client.from(SETTINGS).update({ recruitment_config: next, updated_at: now }).eq("organization_id", orgId)
    : await client.from(SETTINGS).insert({ organization_id: orgId, recruitment_config: next, created_at: now, updated_at: now });
  if (error) fail("save the settings", error);
  return next;
}

const configured = (c: RecruitmentConfig) => Boolean(c.hrHead.userId || c.director.userId);
const slotOf = (c: RecruitmentConfig, level: ApprovalLevel) => (level === "hr_head" ? c.hrHead : c.director);
/** Everyone who may act at this level. */
const approversAt = (c: RecruitmentConfig, level: ApprovalLevel): string[] => [slotOf(c, level).userId, slotOf(c, level).backupUserId].filter((id): id is string => Boolean(id));

// Access ---------------------------------------------------------------------------------------------------------------

/**
 * What this person may do: HR roles, org admins and the master admin see every request; the configured approvers decide
 * at their level; anyone else (an active member) raises and follows their own.
 */
export async function requisitionAccess(client: SupabaseClient, userId: string, orgId: string): Promise<RequisitionAccess & { config: RecruitmentConfig; member: boolean }> {
  const [userRow, orgRows, config] = await Promise.all([
    client.from("users").select("is_master_admin").eq("id", userId).maybeSingle(),
    client.from("organization_memberships").select("role, is_active").eq("user_id", userId).eq("organization_id", orgId),
    loadRecruitmentConfig(client, orgId),
  ]);
  const isMaster = Boolean((userRow.data as { is_master_admin?: boolean } | null)?.is_master_admin);
  const roles = ((orgRows.data ?? []) as { role: string | null; is_active: boolean | null }[]).filter((r) => r.is_active !== false).map((r) => (r.role ?? "").toLowerCase());
  const seesAll = isMaster || roles.some((r) => (CANDIDATE_ACCESS_ROLES as readonly string[]).includes(r) || ["director", "org_admin", "owner", "master_admin", "super_admin"].includes(r));
  const approverLevels = APPROVAL_LEVELS.filter((level) => approversAt(config, level).includes(userId));
  return { seesAll, approverLevels, configured: configured(config), config, member: isMaster || roles.length > 0 };
}

// Rows -----------------------------------------------------------------------------------------------------------------

function toRequisition(row: Record<string, unknown>, names: Map<string, string | null>, now: Date): Requisition {
  const submittedAt = isoOrNull(row.submitted_at);
  return {
    id: row.id as string,
    requisitionNo: (row.requisition_no as string | null) ?? null,
    status: row.status as RequisitionStatus,
    currentLevel: (row.current_level as ApprovalLevel | null) ?? null,
    currentApproverId: (row.current_approver_id as string | null) ?? null,
    currentApproverName: row.current_approver_id ? names.get(row.current_approver_id as string) ?? null : null,
    levelEnteredAt: isoOrNull(row.level_entered_at),
    roleTitle: row.role_title as string,
    department: (row.department as string | null) ?? null,
    location: (row.location as string | null) ?? null,
    positions: Number(row.positions) || 1,
    requestType: (row.request_type as "new" | "replacement") ?? "new",
    replacingName: (row.replacing_name as string | null) ?? null,
    budgetMinCtc: num(row.budget_min_ctc),
    budgetMaxCtc: num(row.budget_max_ctc),
    requiredSkills: Array.isArray(row.required_skills) ? (row.required_skills as string[]) : [],
    minExperienceYears: num(row.min_experience_years),
    qualification: (row.qualification as string | null) ?? null,
    targetJoiningDate: day(row.target_joining_date),
    justification: (row.justification as string | null) ?? null,
    reportingManager: (row.reporting_manager as string | null) ?? null,
    inPlan: (row.in_plan as boolean | null) ?? null,
    needsDirector: Boolean(row.needs_director),
    holdSince: isoOrNull(row.hold_since),
    holdReason: (row.hold_reason as string | null) ?? null,
    decidedAt: isoOrNull(row.decided_at),
    decisionReason: (row.decision_reason as string | null) ?? null,
    positionId: (row.position_id as string | null) ?? null,
    raisedBy: (row.raised_by as string | null) ?? null,
    raisedByName: (row.raised_by_name as string | null) ?? null,
    submittedAt,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    ageDays: daysBetween(submittedAt, isoOrNull(row.decided_at), now),
  };
}

async function loadRow(client: SupabaseClient, orgId: string, id: unknown): Promise<Record<string, unknown>> {
  if (typeof id !== "string" || !UUID.test(id)) throw new CandidateActionError(404, "That request no longer exists.");
  const { data, error } = await client.from(TABLE).select(COLUMNS).eq("organization_id", orgId).eq("id", id).is("deleted_at", null).maybeSingle();
  if (error) fail("load the request", error);
  if (!data) throw new CandidateActionError(404, "That request no longer exists.");
  return data as unknown as Record<string, unknown>;
}

/** Stage 1: "shows the last requisition for the same role, if any". */
async function previousFor(client: SupabaseClient, orgId: string, roleTitle: string, exceptId: string | null): Promise<Requisition["previous"]> {
  const q = client.from(TABLE).select("id, requisition_no, status, created_at").eq("organization_id", orgId).is("deleted_at", null).ilike("role_title", roleTitle.trim()).neq("status", "draft").order("created_at", { ascending: false }).limit(2);
  const { data } = await q;
  const rows = ((data ?? []) as Record<string, unknown>[]).filter((r) => r.id !== exceptId);
  const r = rows[0];
  return r ? { id: r.id as string, requisitionNo: (r.requisition_no as string | null) ?? null, status: r.status as RequisitionStatus, createdAt: iso(r.created_at) } : null;
}

/** The requests this person may see, newest first: all of them for HR and admins, else their own and those waiting on them. */
export async function listRequisitions(client: SupabaseClient, orgId: string, viewer: { userId: string; seesAll: boolean }, now = new Date()): Promise<Requisition[]> {
  let q = client.from(TABLE).select(COLUMNS).eq("organization_id", orgId).is("deleted_at", null).order("created_at", { ascending: false }).limit(300);
  if (!viewer.seesAll) q = q.or(`raised_by.eq.${viewer.userId},current_approver_id.eq.${viewer.userId}`);
  const { data, error } = await q;
  if (error) fail("load the requests", error);
  const rows = (data ?? []) as unknown as Record<string, unknown>[];
  const names = await namesOf(client, rows.map((r) => r.current_approver_id as string).filter(Boolean));
  return rows.map((r) => toRequisition(r, names, now));
}

export async function getRequisition(client: SupabaseClient, orgId: string, id: string, now = new Date()): Promise<{ requisition: Requisition; approvals: RequisitionApproval[] }> {
  const row = await loadRow(client, orgId, id);
  const [names, { data, error }] = await Promise.all([
    namesOf(client, [row.current_approver_id as string].filter(Boolean)),
    client.from(APPROVALS).select("id, level, action, in_plan, reason, by_name, via, created_at").eq("organization_id", orgId).eq("requisition_id", row.id as string).order("created_at", { ascending: false }),
  ]);
  if (error) fail("load the request's history", error);
  const requisition = toRequisition(row, names, now);
  requisition.previous = await previousFor(client, orgId, requisition.roleTitle, requisition.id);
  const approvals = ((data ?? []) as Record<string, unknown>[]).map((a) => ({
    id: a.id as string,
    level: (a.level as ApprovalLevel | null) ?? null,
    action: a.action as RequisitionApproval["action"],
    inPlan: (a.in_plan as boolean | null) ?? null,
    reason: (a.reason as string | null) ?? null,
    byName: (a.by_name as string | null) ?? null,
    via: (a.via as "app" | "link") ?? "app",
    at: iso(a.created_at),
  }));
  return { requisition, approvals };
}

// The form (Stage 1) ---------------------------------------------------------------------------------------------------

const text = (max: number) => z.string().trim().max(max);
const rupeesYear = z.number().min(0).max(1_000_000_000).nullable().optional();
const FormInput = z.object({
  roleTitle: text(120).min(1, "Give the role a title."),
  department: text(80).nullable().optional(),
  location: text(80).nullable().optional(),
  positions: z.number().int().min(1, "At least one position.").max(500).optional(),
  requestType: z.enum(REQUEST_TYPES).optional(),
  replacingName: text(120).nullable().optional(),
  budgetMinCtc: rupeesYear,
  budgetMaxCtc: rupeesYear,
  requiredSkills: z.array(text(80)).max(30).optional(),
  minExperienceYears: z.number().min(0).max(50).nullable().optional(),
  qualification: text(200).nullable().optional(),
  targetJoiningDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick the target joining date.").nullable().optional(),
  justification: text(4000).nullable().optional(),
  reportingManager: text(120).nullable().optional(),
});
export type RequisitionFormInput = z.infer<typeof FormInput>;

function formColumns(input: RequisitionFormInput, partial: boolean): Record<string, unknown> {
  if (input.budgetMinCtc != null && input.budgetMaxCtc != null && input.budgetMinCtc > input.budgetMaxCtc) throw new CandidateActionError(400, "The budget band's minimum is above its maximum.");
  if ((input.requestType === "replacement" || (!partial && input.requestType === undefined)) && input.requestType === "replacement" && !input.replacingName?.trim()) {
    throw new CandidateActionError(400, "Say who is being replaced.");
  }
  const out: Record<string, unknown> = {};
  // An edit (partial) leaves every field it did not send alone; a create stores what the form sent, blanks and all.
  const set = (key: string, value: unknown) => { if (value !== undefined || !partial) out[key] = value ?? null; };
  const blankToNull = (v: string | null | undefined) => (v === undefined ? undefined : v || null);
  set("role_title", input.roleTitle);
  set("department", blankToNull(input.department));
  set("location", blankToNull(input.location));
  if (input.positions !== undefined || !partial) out.positions = input.positions ?? 1;
  if (input.requestType !== undefined || !partial) out.request_type = input.requestType ?? "new";
  set("replacing_name", blankToNull(input.replacingName));
  set("budget_min_ctc", input.budgetMinCtc);
  set("budget_max_ctc", input.budgetMaxCtc);
  if (input.requiredSkills !== undefined || !partial) out.required_skills = (input.requiredSkills ?? []).map((s) => s.trim()).filter(Boolean);
  set("min_experience_years", input.minExperienceYears);
  set("qualification", blankToNull(input.qualification));
  set("target_joining_date", blankToNull(input.targetJoiningDate));
  set("justification", blankToNull(input.justification));
  set("reporting_manager", blankToNull(input.reportingManager));
  return out;
}

/** What the form must have before it can be submitted (Stage 1's fields; the budget band is required because Stage 2 routes on it). */
function readyToSubmit(row: Record<string, unknown>): string | null {
  if (!String(row.role_title ?? "").trim()) return "Give the role a title.";
  if (row.budget_max_ctc === null || row.budget_max_ctc === undefined) return "Give the budget band (maximum CTC per year).";
  if (!String(row.justification ?? "").trim()) return "Say why the role is needed (the justification).";
  if (row.request_type === "replacement" && !String(row.replacing_name ?? "").trim()) return "Say who is being replaced.";
  return null;
}

// Events (what the routes send) ---------------------------------------------------------------------------------------

export type RequisitionEvent =
  | { kind: "awaiting"; requisition: Requisition; approverId: string; level: ApprovalLevel }
  | { kind: "decided"; requisition: Requisition; decision: "approved" | "rejected" | "sent_back" | "on_hold" | "resumed"; reason: string | null; byName: string | null }
  | { kind: "director_informed"; requisition: Requisition; directorId: string };
export type RequisitionNotifier = (event: RequisitionEvent) => Promise<void>;
export interface RequisitionDeps { notify?: RequisitionNotifier; now?: () => Date }

async function emit(deps: RequisitionDeps, event: RequisitionEvent): Promise<void> {
  if (!deps.notify) return;
  try {
    await deps.notify(event);
  } catch (error) {
    console.error("[candidates] requisition notice failed", error);
  }
}

async function record(client: SupabaseClient, orgId: string, requisitionId: string, by: Actor | null, entry: { level?: ApprovalLevel | null; action: RequisitionApproval["action"]; inPlan?: boolean | null; reason?: string | null; via?: "app" | "link" }): Promise<void> {
  const { error } = await client.from(APPROVALS).insert({
    organization_id: orgId, requisition_id: requisitionId, level: entry.level ?? null, action: entry.action, in_plan: entry.inPlan ?? null,
    reason: entry.reason ?? null, by_user: by?.id ?? null, by_name: by?.name ?? null, via: entry.via ?? "app", created_at: new Date().toISOString(),
  });
  if (error) fail("record the step", error);
}

// Raising (Stage 1) -----------------------------------------------------------------------------------------------------

/** A new request as a draft; with `submit`, submitted straight away. */
export async function createRequisition(client: SupabaseClient, orgId: string, by: Actor, body: unknown, deps: RequisitionDeps = {}): Promise<Requisition> {
  const b = (body ?? {}) as Record<string, unknown>;
  const parsed = FormInput.safeParse(b);
  if (!parsed.success) throw new CandidateActionError(400, parsed.error.issues[0]?.message ?? "Those details are not valid.");
  const now = (deps.now ?? (() => new Date()))().toISOString();
  const { data, error } = await client.from(TABLE).insert({ organization_id: orgId, ...formColumns(parsed.data, false), status: "draft", raised_by: by.id, raised_by_name: by.name, created_at: now, updated_at: now }).select("id").single();
  if (error) fail("save the request", error);
  const id = (data as { id: string }).id;
  if (b.submit === true) return submitRequisition(client, orgId, by, id, deps);
  const { requisition } = await getRequisition(client, orgId, id);
  return requisition;
}

/** Edits a draft or a request sent back for changes; the person who raised it only. */
export async function updateRequisition(client: SupabaseClient, orgId: string, by: Actor, id: string, body: unknown, deps: RequisitionDeps = {}): Promise<Requisition> {
  const b = (body ?? {}) as Record<string, unknown>;
  const row = await loadRow(client, orgId, id);
  if (row.raised_by !== by.id) throw new CandidateActionError(403, "Only the person who raised the request can change it.");
  if (row.status !== "draft" && row.status !== "sent_back") throw new CandidateActionError(409, "This request is with the approvers and cannot be changed now. Withdraw it, or wait for the decision.");
  const parsed = FormInput.partial().safeParse(b);
  if (!parsed.success) throw new CandidateActionError(400, parsed.error.issues[0]?.message ?? "Those details are not valid.");
  const columns = formColumns(parsed.data as RequisitionFormInput, true);
  if (Object.keys(columns).length) {
    const { error } = await client.from(TABLE).update({ ...columns, updated_at: new Date().toISOString() }).eq("organization_id", orgId).eq("id", row.id as string);
    if (error) fail("save the request", error);
  }
  if (b.submit === true) return submitRequisition(client, orgId, by, row.id as string, deps);
  const { requisition } = await getRequisition(client, orgId, row.id as string);
  return requisition;
}

/**
 * The first level a request goes to, honouring "no user can approve a step they themselves raised": the HR Head, or
 * their backup when the HR Head raised it; the Director when neither can; a clear message when nobody is set.
 */
export function firstLevelFor(config: RecruitmentConfig, raisedBy: string): { level: ApprovalLevel; approverId: string } {
  const pick = (level: ApprovalLevel) => approversAt(config, level).find((id) => id !== raisedBy) ?? null;
  const hrHead = pick("hr_head");
  if (hrHead) return { level: "hr_head", approverId: hrHead };
  const director = pick("director");
  if (director) return { level: "director", approverId: director };
  if (!configured(config)) throw new CandidateActionError(409, "The approvers are not set yet. Ask the Tech team to set the HR Head and Director in Settings → Notifications → Recruitment.");
  throw new CandidateActionError(409, "You are the only approver set, and a request cannot be approved by the person who raised it. Ask the Tech team to add a backup approver in Settings.");
}

/** Stage 1's exit: submitted for approval. Gets its number on first submission; a request sent back is resubmitted. */
export async function submitRequisition(client: SupabaseClient, orgId: string, by: Actor, id: string, deps: RequisitionDeps = {}): Promise<Requisition> {
  const row = await loadRow(client, orgId, id);
  if (row.raised_by !== by.id) throw new CandidateActionError(403, "Only the person who raised the request can submit it.");
  if (row.status !== "draft" && row.status !== "sent_back") throw new CandidateActionError(409, "This request has already been submitted.");
  const problem = readyToSubmit(row);
  if (problem) throw new CandidateActionError(400, problem);
  const config = await loadRecruitmentConfig(client, orgId);
  const first = firstLevelFor(config, by.id);
  const now = (deps.now ?? (() => new Date()))().toISOString();

  let requisitionNo = (row.requisition_no as string | null) ?? null;
  if (!requisitionNo) {
    const { data, error } = await client.rpc("recruitment_next_requisition_no", { p_organization_id: orgId });
    if (error) fail("number the request", error);
    requisitionNo = String(data);
  }
  const { error } = await client.from(TABLE).update({
    requisition_no: requisitionNo, status: "submitted", current_level: first.level, current_approver_id: first.approverId, level_entered_at: now,
    in_plan: null, needs_director: false, hold_since: null, hold_reason: null, decided_at: null, decision_reason: null,
    submitted_at: now, updated_at: now,
  }).eq("organization_id", orgId).eq("id", row.id as string);
  if (error) fail("submit the request", error);
  await record(client, orgId, row.id as string, by, { action: "submitted", level: first.level, reason: row.status === "sent_back" ? "Resubmitted after changes" : null });
  const { requisition } = await getRequisition(client, orgId, row.id as string);
  await emit(deps, { kind: "awaiting", requisition, approverId: first.approverId, level: first.level });
  return requisition;
}

/** The person who raised it takes it back, at any point before a decision. */
export async function withdrawRequisition(client: SupabaseClient, orgId: string, by: Actor, id: string, reasonInput: unknown): Promise<Requisition> {
  const row = await loadRow(client, orgId, id);
  if (row.raised_by !== by.id) throw new CandidateActionError(403, "Only the person who raised the request can withdraw it.");
  if (!["draft", "submitted", "sent_back", "on_hold"].includes(row.status as string)) throw new CandidateActionError(409, "This request has already been decided.");
  const reason = typeof reasonInput === "string" ? reasonInput.trim().slice(0, 1000) || null : null;
  const now = new Date().toISOString();
  const { error } = await client.from(TABLE).update({ status: "withdrawn", current_level: null, current_approver_id: null, decided_at: now, decision_reason: reason, updated_at: now }).eq("organization_id", orgId).eq("id", row.id as string);
  if (error) fail("withdraw the request", error);
  await record(client, orgId, row.id as string, by, { action: "withdrawn", reason });
  const { requisition } = await getRequisition(client, orgId, row.id as string);
  return requisition;
}

// The approval gate (Stage 2) -------------------------------------------------------------------------------------------

const DecisionInput = z.object({
  decision: z.enum(REQUISITION_DECISIONS, { message: "The decision must be approve, reject, send back, hold or resume." }),
  reason: z.string().trim().max(2000).optional(),
  /** The HR Head's tick: the role is in the approved headcount plan. */
  inPlan: z.boolean().optional(),
});

/** Stage 2's rule: above the agreed CTC level, the Director approves regardless. */
export const aboveCtcLevel = (config: RecruitmentConfig, budgetMaxCtc: number | null) => config.directorCtcLevel !== null && budgetMaxCtc !== null && budgetMaxCtc > config.directorCtcLevel;

/**
 * One decision at the level the request waits at, by one of that level's approvers (never the person who raised it):
 *   approve   : at the HR Head, with the in-plan tick. In plan and within the CTC level -> approved, the Director is
 *               notified. Out of plan or above the level -> on to the Director. At the Director -> approved.
 *   reject    : with a reason. Final.
 *   send_back : with a reason; the manager changes and resubmits.
 *   hold      : waits; `resume` (by an approver at that level) puts it back in the queue, the clock restarted.
 * Approved means the role becomes active: a position is opened in the Positions tab.
 */
export async function decideRequisition(client: SupabaseClient, orgId: string, by: Actor, id: string, body: unknown, deps: RequisitionDeps & { via?: "app" | "link" } = {}): Promise<Requisition> {
  const parsed = DecisionInput.safeParse(body ?? {});
  if (!parsed.success) throw new CandidateActionError(400, parsed.error.issues[0]?.message ?? "That decision is not valid.");
  const { decision } = parsed.data;
  const reason = parsed.data.reason?.trim() || null;
  const row = await loadRow(client, orgId, id);
  const config = await loadRecruitmentConfig(client, orgId);
  const level = (row.current_level as ApprovalLevel | null) ?? null;
  if (row.status !== "submitted" && row.status !== "on_hold") throw new CandidateActionError(409, `This request is ${String(row.status).replace("_", " ")}; there is nothing to decide.`);
  if (!level) throw new CandidateActionError(409, "This request is not waiting at any level.");
  if (row.raised_by === by.id) throw new CandidateActionError(403, "A request cannot be approved by the person who raised it.");
  if (!approversAt(config, level).includes(by.id)) throw new CandidateActionError(403, `Only the ${level === "hr_head" ? "HR Head" : "Director"} (or their backup) can decide on this request now.`);
  if ((decision === "reject" || decision === "send_back") && !reason) throw new CandidateActionError(400, decision === "reject" ? "Give the reason for rejecting." : "Say what needs to change.");
  if (row.status === "on_hold" && decision !== "resume") throw new CandidateActionError(409, "This request is on hold. Resume it first.");
  if (row.status === "submitted" && decision === "resume") throw new CandidateActionError(409, "This request is not on hold.");

  const now = (deps.now ?? (() => new Date()))().toISOString();
  const via = deps.via ?? "app";
  const update = (values: Record<string, unknown>) => client.from(TABLE).update({ ...values, updated_at: now }).eq("organization_id", orgId).eq("id", row.id as string);
  const done = async (): Promise<Requisition> => (await getRequisition(client, orgId, row.id as string)).requisition;

  if (decision === "hold") {
    const { error } = await update({ status: "on_hold", hold_since: now, hold_reason: reason });
    if (error) fail("put the request on hold", error);
    await record(client, orgId, row.id as string, by, { level, action: "on_hold", reason, via });
    const requisition = await done();
    await emit(deps, { kind: "decided", requisition, decision: "on_hold", reason, byName: by.name });
    return requisition;
  }
  if (decision === "resume") {
    const { error } = await update({ status: "submitted", hold_since: null, hold_reason: null, level_entered_at: now });
    if (error) fail("resume the request", error);
    await record(client, orgId, row.id as string, by, { level, action: "resumed", reason, via });
    const requisition = await done();
    await emit(deps, { kind: "decided", requisition, decision: "resumed", reason, byName: by.name });
    return requisition;
  }
  if (decision === "reject" || decision === "send_back") {
    const status = decision === "reject" ? "rejected" : "sent_back";
    const { error } = await update({ status, current_level: null, current_approver_id: null, decided_at: decision === "reject" ? now : null, decision_reason: reason });
    if (error) fail("record the decision", error);
    await record(client, orgId, row.id as string, by, { level, action: status, reason, via });
    const requisition = await done();
    await emit(deps, { kind: "decided", requisition, decision: status, reason, byName: by.name });
    return requisition;
  }

  // approve
  if (level === "hr_head") {
    if (parsed.data.inPlan === undefined) throw new CandidateActionError(400, "Tick whether the role is in the approved plan before approving.");
    const inPlan = parsed.data.inPlan;
    const needsDirector = !inPlan || aboveCtcLevel(config, num(row.budget_max_ctc));
    if (needsDirector) {
      const director = approversAt(config, "director").find((uid) => uid !== row.raised_by) ?? null;
      if (!director) throw new CandidateActionError(409, "This request needs the Director's approval, and no Director is set in Settings → Notifications → Recruitment.");
      const { error } = await update({ in_plan: inPlan, needs_director: true, current_level: "director", current_approver_id: director, level_entered_at: now });
      if (error) fail("pass the request to the Director", error);
      await record(client, orgId, row.id as string, by, { level, action: "approved", inPlan, reason: reason ?? (inPlan ? "Above the CTC level: the Director approves" : "Out of plan: the Director approves"), via });
      const requisition = await done();
      await emit(deps, { kind: "awaiting", requisition, approverId: director, level: "director" });
      return requisition;
    }
    await record(client, orgId, row.id as string, by, { level, action: "approved", inPlan, reason, via });
    const { error } = await update({ in_plan: inPlan, needs_director: false });
    if (error) fail("record the decision", error);
  } else {
    await record(client, orgId, row.id as string, by, { level, action: "approved", reason, via });
  }
  return approveFinal(client, orgId, by, row, config, reason, now, deps, level);
}

/** Stage 2's exit, approved: the role becomes active. A position is opened from the request. */
async function approveFinal(client: SupabaseClient, orgId: string, by: Actor, row: Record<string, unknown>, config: RecruitmentConfig, reason: string | null, now: string, deps: RequisitionDeps, level: ApprovalLevel): Promise<Requisition> {
  const id = row.id as string;
  const { error } = await client.from(TABLE).update({ status: "approved", current_level: null, current_approver_id: null, decided_at: now, decision_reason: reason, updated_at: now }).eq("organization_id", orgId).eq("id", id);
  if (error) fail("approve the request", error);

  let positionId: string | null = null;
  try {
    const skills = Array.isArray(row.required_skills) ? (row.required_skills as string[]) : [];
    const band = [num(row.budget_min_ctc), num(row.budget_max_ctc)].map((v) => (v === null ? null : `₹${(v / 100_000).toLocaleString("en-IN", { maximumFractionDigits: 1 })} LPA`));
    const summary = [
      `Opened from requisition ${row.requisition_no ?? ""} raised by ${row.raised_by_name ?? "a manager"}.`,
      band[0] || band[1] ? `Budget band ${band[0] ?? "—"} to ${band[1] ?? "—"} (CTC).` : null,
      row.target_joining_date ? `Target joining ${day(row.target_joining_date)}.` : null,
      row.request_type === "replacement" ? `Replacement for ${row.replacing_name ?? "an employee"}.` : "New position.",
      row.justification ? `Justification: ${String(row.justification).slice(0, 1200)}` : null,
    ].filter(Boolean).join(" ");
    const position = await createPosition(client, orgId, by, {
      title: row.role_title, department: row.department ?? null, location: row.location ?? null, openings: Number(row.positions) || 1,
      education: row.qualification ?? null, hiringManager: row.raised_by_name ?? null, targetDays: config.targetDays, summary,
      filters: { ...EMPTY_FILTERS, keywords: skills.map((text) => ({ text, required: false })), ...(num(row.min_experience_years) !== null ? { expMin: num(row.min_experience_years) } : {}) },
    });
    positionId = position.id;
    await client.from(TABLE).update({ position_id: position.id }).eq("organization_id", orgId).eq("id", id);
    await record(client, orgId, id, by, { action: "position_opened", reason: position.title });
  } catch (error) {
    // The approval stands; the position can be opened by hand from the request.
    console.error("[candidates] position from requisition failed", error);
  }

  const requisition = (await getRequisition(client, orgId, id)).requisition;
  requisition.positionId = positionId ?? requisition.positionId;
  await emit(deps, { kind: "decided", requisition, decision: "approved", reason, byName: by.name });
  // Stage 2: in plan, the HR Head approves and the Director is notified.
  if (level === "hr_head") {
    const director = approversAt(config, "director")[0] ?? null;
    if (director && director !== by.id) await emit(deps, { kind: "director_informed", requisition, directorId: director });
  }
  return requisition;
}

/** Who may decide now: it waits at a level this person approves at, and they did not raise it. */
export function canDecide(requisition: Requisition, userId: string, access: RequisitionAccess): boolean {
  return (requisition.status === "submitted" || requisition.status === "on_hold") && requisition.currentLevel !== null && access.approverLevels.includes(requisition.currentLevel) && requisition.raisedBy !== userId;
}

/** For the reminders job: the requests waiting at a level, with how long they have waited there. */
export async function waitingRequisitions(client: SupabaseClient, orgId: string, now = new Date()): Promise<{ requisition: Requisition; hoursAtLevel: number }[]> {
  const { data, error } = await client.from(TABLE).select(COLUMNS).eq("organization_id", orgId).eq("status", "submitted").is("deleted_at", null).not("current_level", "is", null);
  if (error) {
    if (missingRelation(error)) return [];
    fail("load the waiting requests", error);
  }
  const rows = (data ?? []) as unknown as Record<string, unknown>[];
  const names = await namesOf(client, rows.map((r) => r.current_approver_id as string).filter(Boolean));
  return rows.map((r) => {
    const requisition = toRequisition(r, names, now);
    const since = requisition.levelEnteredAt ? new Date(requisition.levelEnteredAt).getTime() : now.getTime();
    return { requisition, hoursAtLevel: Math.max(0, (now.getTime() - since) / 3_600_000) };
  });
}

/** Every organisation with a request waiting (the reminders job runs per organisation). */
export async function organisationsWithWaiting(client: SupabaseClient): Promise<string[]> {
  const { data, error } = await client.from(TABLE).select("organization_id").eq("status", "submitted").is("deleted_at", null).limit(2000);
  if (error) return [];
  return [...new Set(((data ?? []) as { organization_id: string }[]).map((r) => r.organization_id))];
}
