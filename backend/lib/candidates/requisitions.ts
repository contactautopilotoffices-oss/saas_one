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
 * Who the approvers are, the CTC level and the target days are set in the Tech dashboard's HR Configs tab (owner
 * 2026-11-20: "move this Hiring request approvals section to the tech login in HR configs tab"; the Tech team and admins
 * change them; organization_settings.recruitment_config), never in code. The HR Head is picked from the HR team, the
 * Director from the org super admins (approverPools). Nothing here sends anything: every
 * change hands an event to `deps.notify` (the routes pass requisition-notify.ts; tests pass a recorder).
 *
 * Access is the caller's job (the routes' requireOrgMember); everything here runs with the service role.
 */
import { briefDownloadUrl } from "./assignment-brief-storage";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { namesOf, type Actor } from "./actions";
import { CANDIDATE_ACCESS_ROLES } from "./config";
import { DEFAULT_REJECTION_REASONS } from "./stage-list";
import { EMPTY_FILTERS } from "./filters";
import { DEFAULT_OUTREACH, SettingsError, toOutreachSettings, validateOutreachSettings, type OutreachSettings } from "./outreach-settings";
import { createPosition } from "./positions";
import { CandidateActionError } from "./records";
import {
  APPROVAL_LEVEL_LABELS, APPROVAL_LEVELS, HOD_DECISION_HOURS, REQUEST_TYPES, REQUISITION_DECISIONS,
  type ApprovalLevel, type RecruitmentConfig, type Requisition, type RequisitionAccess, type RequisitionApproval, type RequisitionHierarchy, type RequisitionLevel, type RequisitionStatus,
} from "./types";

const TABLE = "recruitment_requisitions";
const APPROVALS = "recruitment_requisition_approvals";
const SETTINGS = "organization_settings";
const COLUMNS =
  "id, requisition_no, status, current_level, current_approver_id, level_entered_at, role_title, department, location, positions, request_type, replacing_name, " +
  "budget_min_ctc, budget_max_ctc, required_skills, min_experience_years, qualification, target_joining_date, justification, reporting_manager, internal_mobility, structure_note, role_is_new, in_plan, needs_director, " +
  "hold_since, hold_reason, decided_at, decision_reason, position_id, raised_by, raised_by_name, submitted_at, created_at, updated_at";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Stage 2: 3 working days end to end (Monday to Saturday count, as the module's sending hours do). */
export const APPROVAL_SLA_WORKING_DAYS = 3;
export const DEFAULT_TARGET_DAYS = 21;

export const REQUISITIONS_MIGRATION_MESSAGE = "Hiring requests need a database update first: run 20261117000003_recruitment_requisitions.sql in Supabase.";
/** Endorsing and "still needed" are new kinds of history entry (owner 2026-11-21). */
export const REQUISITION_FOLLOWUPS_MIGRATION_MESSAGE = "This needs a database update first: run 20261121000001_recruitment_requisition_followups.sql in Supabase.";
/** The department head's level and the three new form fields (owner 2026-11-24). */
export const REQUISITION_HOD_MIGRATION_MESSAGE = "Hiring requests need a database update first: run 20261124000001_recruitment_requisition_hod_and_fields.sql in Supabase.";

const missingRelation = (error: { code?: string; message?: string } | null | undefined) =>
  Boolean(error) && (["42P01", "42703", "PGRST205", "PGRST204"].includes(error?.code ?? "") || /recruitment_requisition|recruitment_config|does not exist|schema cache/i.test(error?.message ?? ""));

function fail(what: string, error: { code?: string; message?: string }): never {
  // Before 20261124000001: the new columns are missing, or the checks refuse the department head's level.
  if (/internal_mobility|structure_note|role_is_new/.test(error.message ?? "") || (error.code === "23514" && /current_level_check|approvals_level_check/.test(error.message ?? ""))) {
    throw new CandidateActionError(503, REQUISITION_HOD_MIGRATION_MESSAGE);
  }
  if (missingRelation(error)) throw new CandidateActionError(503, REQUISITIONS_MIGRATION_MESSAGE);
  // Before 20261121000001 the history refuses "endorsed" and "still_needed".
  if (error.code === "23514" && /approvals_action_check/.test(error.message ?? "")) throw new CandidateActionError(503, REQUISITION_FOLLOWUPS_MIGRATION_MESSAGE);
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

const EMPTY_CONFIG: RecruitmentConfig = { hrHead: { userId: null, backupUserId: null }, director: { userId: null, backupUserId: null }, directorCtcLevel: null, targetDays: DEFAULT_TARGET_DAYS, raisers: { roles: [], userIds: [] }, departmentHeads: [], rejectionReasons: [...DEFAULT_REJECTION_REASONS], offerLetter: "", hierarchy: [], outreach: DEFAULT_OUTREACH };

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
    raisers: toRaisers(r.raisers),
    departmentHeads: toDepartmentHeads(r.departmentHeads),
    rejectionReasons: toReasons(r.rejectionReasons),
    offerLetter: typeof r.offerLetter === "string" ? r.offerLetter.slice(0, 20_000) : "",
    hierarchy: toHierarchy(r.hierarchy),
    outreach: toOutreachSettings(r.outreach),
  };
}

/**
 * Owner 2026-11-24: saves the outreach settings (Recruitment → Outreach: the application form, the message templates,
 * automatic outreach), HR's to change. Recorded in the history of changes.
 */
export async function saveOutreachSettings(client: SupabaseClient, orgId: string, body: unknown, by?: Actor): Promise<OutreachSettings> {
  let outreach: OutreachSettings;
  try {
    outreach = validateOutreachSettings(body);
  } catch (error) {
    if (error instanceof SettingsError) throw new CandidateActionError(400, error.message);
    throw error;
  }
  const current = await loadRecruitmentConfig(client, orgId);
  const existingFiles = new Set(current.outreach.assignment.library.map(t => t.attachment?.key));
  for (const { attachment } of outreach.assignment.library) {
    if (attachment && !existingFiles.has(attachment.key)) {
      await briefDownloadUrl(client, orgId, attachment);
      existingFiles.add(attachment.key);
    }
  }
  const next: RecruitmentConfig = { ...current, outreach };
  const now = new Date().toISOString();
  const { data: existing, error: readErr } = await client.from(SETTINGS).select("organization_id").eq("organization_id", orgId).maybeSingle();
  if (readErr) fail("save the settings", readErr);
  const { error } = existing
    ? await client.from(SETTINGS).update({ recruitment_config: next, updated_at: now }).eq("organization_id", orgId)
    : await client.from(SETTINGS).insert({ organization_id: orgId, recruitment_config: next, created_at: now, updated_at: now });
  if (error) fail("save the settings", error);
  if (by && JSON.stringify(current.outreach) !== JSON.stringify(outreach)) {
    const parts = [
      JSON.stringify(current.outreach.applicationForm) !== JSON.stringify(outreach.applicationForm) ? `application form (${outreach.applicationForm.fields.length} questions)` : null,
      JSON.stringify(current.outreach.templates) !== JSON.stringify(outreach.templates) ? `message templates (${outreach.templates.length})` : null,
      JSON.stringify(current.outreach.auto) !== JSON.stringify(outreach.auto) ? `automatic outreach ${outreach.auto.enabled ? "on" : "off"}` : null,
      current.outreach.companyName !== outreach.companyName ? `company name "${outreach.companyName}"` : null,
    ].filter(Boolean);
    const { error: logError } = await client.from("recruitment_stage_changes").insert({
      organization_id: orgId, changed_by: by.id, changed_by_name: by.name, summary: `Outreach: ${parts.join(" · ") || "saved"}`.slice(0, 2000),
      before: { outreach: current.outreach }, after: { outreach }, created_at: now,
    });
    if (logError && !missingRelation(logError)) console.error("[candidates] outreach settings: the change was not recorded", logError);
  }
  return outreach;
}

// The company hierarchy for the request form (owner 2026-11-24) ----------------------------------------------------------

const clean = (s: unknown, max: number) => (typeof s === "string" ? s.replace(/\s+/g, " ").trim().slice(0, max) : "");
const byName = (a: string, b: string) => a.localeCompare(b, "en", { sensitivity: "base" });

/** Each department once (ignoring case), each designation once within it, both sorted. */
function toHierarchy(raw: unknown): RecruitmentConfig["hierarchy"] {
  const out = new Map<string, { department: string; designations: Map<string, string> }>();
  for (const item of Array.isArray(raw) ? raw : []) {
    const r = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    const department = clean(r.department, 80);
    if (!department) continue;
    const entry = out.get(department.toLowerCase()) ?? { department, designations: new Map<string, string>() };
    for (const d of Array.isArray(r.designations) ? r.designations : []) {
      const designation = clean(d, 120);
      if (designation && !entry.designations.has(designation.toLowerCase())) entry.designations.set(designation.toLowerCase(), designation);
    }
    out.set(department.toLowerCase(), entry);
  }
  return [...out.values()].map((e) => ({ department: e.department, designations: [...e.designations.values()].sort(byName) })).sort((a, b) => byName(a.department, b.department));
}

/** The employee master's hierarchy: the departments of the active employees, and the designations seen in each. */
export function hierarchyFromEmployees(employees: { department: string | null; designation: string | null }[]): RecruitmentConfig["hierarchy"] {
  const grouped = new Map<string, { department: string; designations: string[] }>();
  for (const e of employees) {
    const department = clean(e.department, 80);
    if (!department) continue;
    const entry = grouped.get(department.toLowerCase()) ?? { department, designations: [] };
    const designation = clean(e.designation, 120);
    if (designation) entry.designations.push(designation);
    grouped.set(department.toLowerCase(), entry);
  }
  return toHierarchy([...grouped.values()]);
}

/** What the form offers: HR's list when set, else the employee master. */
export function resolveHierarchy(config: RecruitmentConfig, employeeMaster: RecruitmentConfig["hierarchy"]): RequisitionHierarchy {
  return config.hierarchy.length ? { departments: config.hierarchy, source: "configured" } : { departments: employeeMaster, source: "employee_master" };
}

/**
 * The form's rule (owner 2026-11-24, from the 23 Nov meeting: "he cannot invent anything; if he wants to, it goes to
 * Others"): the department is one of the list's, and the role title one of that department's designations, unless the
 * role was raised under "Others". Nothing is checked when the list is empty.
 */
export function checkAgainstHierarchy(hierarchy: RequisitionHierarchy | undefined, row: Record<string, unknown>): string | null {
  if (!hierarchy?.departments.length) return null;
  const dept = hierarchy.departments.find((d) => d.department.toLowerCase() === clean(row.department, 80).toLowerCase());
  if (!dept) return "Pick the department from the list.";
  if (row.role_is_new === true || !dept.designations.length) return null;
  const role = clean(row.role_title, 120).toLowerCase();
  if (!dept.designations.some((d) => d.toLowerCase() === role)) return `Pick the role from ${dept.department}'s designations, or choose "Others" to raise a new one.`;
  return null;
}

const HierarchyInput = z.object({
  departments: z.array(z.object({
    department: z.string().trim().min(1, "Name the department.").max(80, "A department name is at most 80 characters."),
    designations: z.array(z.string().trim().min(1).max(120, "A designation is at most 120 characters.")).max(200),
  })).max(100),
});

/**
 * Saves the department → designations list (the Tech dashboard's HR Configs tab), recorded in the history of changes.
 * An empty list puts the form back on the employee master.
 */
export async function saveHierarchy(client: SupabaseClient, orgId: string, body: unknown, by?: Actor): Promise<RecruitmentConfig["hierarchy"]> {
  const parsed = HierarchyInput.safeParse(body ?? {});
  if (!parsed.success) throw new CandidateActionError(400, parsed.error.issues[0]?.message ?? "Give each department a name.");
  const keys = parsed.data.departments.map((d) => d.department.toLowerCase());
  const twice = keys.find((k, i) => keys.indexOf(k) !== i);
  if (twice) throw new CandidateActionError(400, `"${parsed.data.departments[keys.indexOf(twice)].department}" is listed twice.`);
  const hierarchy = toHierarchy(parsed.data.departments);
  const current = await loadRecruitmentConfig(client, orgId);
  const next: RecruitmentConfig = { ...current, hierarchy };
  const now = new Date().toISOString();
  const { data: existing, error: readErr } = await client.from(SETTINGS).select("organization_id").eq("organization_id", orgId).maybeSingle();
  if (readErr) fail("save the settings", readErr);
  const { error } = existing
    ? await client.from(SETTINGS).update({ recruitment_config: next, updated_at: now }).eq("organization_id", orgId)
    : await client.from(SETTINGS).insert({ organization_id: orgId, recruitment_config: next, created_at: now, updated_at: now });
  if (error) fail("save the settings", error);
  if (by && JSON.stringify(current.hierarchy) !== JSON.stringify(hierarchy)) {
    const summary = hierarchy.length
      ? `Departments and designations: ${hierarchy.map((d) => `${d.department} (${d.designations.length})`).join(", ")}`
      : "Departments and designations: cleared (the form uses the employee master)";
    const { error: logError } = await client.from("recruitment_stage_changes").insert({
      organization_id: orgId, changed_by: by.id, changed_by_name: by.name, summary: summary.slice(0, 2000), before: { hierarchy: current.hierarchy }, after: { hierarchy }, created_at: now,
    });
    if (logError && !missingRelation(logError)) console.error("[candidates] hierarchy: the change was not recorded", logError);
  }
  return hierarchy;
}

/** Owner 2026-11-21: saves HR's offer letter template (Recruitment -> Configurations). Empty restores the default. */
export async function saveOfferLetter(client: SupabaseClient, orgId: string, body: unknown, by?: Actor): Promise<string> {
  const text = (body as { letter?: unknown } | null)?.letter;
  if (typeof text !== "string" || text.length > 20_000) throw new CandidateActionError(400, "The letter is at most 20,000 characters.");
  const current = await loadRecruitmentConfig(client, orgId);
  const next: RecruitmentConfig = { ...current, offerLetter: text.trim() };
  const now = new Date().toISOString();
  const { data: existing, error: readErr } = await client.from(SETTINGS).select("organization_id").eq("organization_id", orgId).maybeSingle();
  if (readErr) fail("save the settings", readErr);
  const { error } = existing
    ? await client.from(SETTINGS).update({ recruitment_config: next, updated_at: now }).eq("organization_id", orgId)
    : await client.from(SETTINGS).insert({ organization_id: orgId, recruitment_config: next, created_at: now, updated_at: now });
  if (error) fail("save the settings", error);
  if (by && current.offerLetter !== next.offerLetter) {
    const { error: logError } = await client.from("recruitment_stage_changes").insert({ organization_id: orgId, changed_by: by.id, changed_by_name: by.name, summary: "Offer letter template changed", before: { offerLetter: current.offerLetter }, after: { offerLetter: next.offerLetter }, created_at: now });
    if (logError && !missingRelation(logError)) console.error("[candidates] offer letter: the change was not recorded", logError);
  }
  return next.offerLetter;
}

/** The saved reasons (trimmed, each once), or the defaults when none were saved. */
function toReasons(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [...DEFAULT_REJECTION_REASONS];
  const out: string[] = [];
  for (const x of raw) {
    const v = typeof x === "string" ? x.replace(/\s+/g, " ").trim().slice(0, 60) : "";
    if (v && !out.some((o) => o.toLowerCase() === v.toLowerCase())) out.push(v);
  }
  return out.length ? out : [...DEFAULT_REJECTION_REASONS];
}

/** Owner 2026-11-21: saves the rejection reasons (HR, in Recruitment -> Configurations), recorded in the history of changes. */
export async function saveRejectionReasons(client: SupabaseClient, orgId: string, body: unknown, by?: Actor): Promise<string[]> {
  const list = (body as { reasons?: unknown } | null)?.reasons;
  if (!Array.isArray(list) || !list.length) throw new CandidateActionError(400, "Keep at least one reason.");
  if (list.length > 30) throw new CandidateActionError(400, "At most 30 reasons.");
  if (list.some((x) => typeof x !== "string" || !x.trim() || x.trim().length > 60)) throw new CandidateActionError(400, "Each reason is 1 to 60 characters.");
  const reasons = toReasons(list);
  const current = await loadRecruitmentConfig(client, orgId);
  const next: RecruitmentConfig = { ...current, rejectionReasons: reasons };
  const now = new Date().toISOString();
  const { data: existing, error: readErr } = await client.from(SETTINGS).select("organization_id").eq("organization_id", orgId).maybeSingle();
  if (readErr) fail("save the settings", readErr);
  const { error } = existing
    ? await client.from(SETTINGS).update({ recruitment_config: next, updated_at: now }).eq("organization_id", orgId)
    : await client.from(SETTINGS).insert({ organization_id: orgId, recruitment_config: next, created_at: now, updated_at: now });
  if (error) fail("save the settings", error);
  if (by && JSON.stringify(current.rejectionReasons) !== JSON.stringify(reasons)) {
    const { error: logError } = await client.from("recruitment_stage_changes").insert({
      organization_id: orgId, changed_by: by.id, changed_by_name: by.name, summary: `Rejection reasons: ${reasons.join(", ")}`.slice(0, 2000),
      before: { rejectionReasons: current.rejectionReasons }, after: { rejectionReasons: reasons }, created_at: now,
    });
    if (logError && !missingRelation(logError)) console.error("[candidates] rejection reasons: the change was not recorded", logError);
  }
  return reasons;
}

/** One head per department (the first kept when a department is listed twice, ignoring case). */
function toDepartmentHeads(raw: unknown): RecruitmentConfig["departmentHeads"] {
  const out: RecruitmentConfig["departmentHeads"] = [];
  const seen = new Set<string>();
  for (const item of Array.isArray(raw) ? raw : []) {
    const r = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    const department = typeof r.department === "string" ? r.department.replace(/\s+/g, " ").trim().slice(0, 80) : "";
    const userId = typeof r.userId === "string" && UUID.test(r.userId) ? r.userId : null;
    if (!department || !userId || seen.has(department.toLowerCase())) continue;
    seen.add(department.toLowerCase());
    out.push({ department, userId });
  }
  return out;
}

const deptKey = (d: string | null | undefined) => (d ?? "").replace(/\s+/g, " ").trim().toLowerCase();
/** The departments this person heads (lower case). */
export const departmentsHeadedBy = (config: RecruitmentConfig, userId: string): string[] => config.departmentHeads.filter((h) => h.userId === userId).map((h) => deptKey(h.department));
/** Who heads this department, if anyone. */
export const headOfDepartment = (config: RecruitmentConfig, department: string | null | undefined): string | null =>
  deptKey(department) ? config.departmentHeads.find((h) => deptKey(h.department) === deptKey(department))?.userId ?? null : null;

function toRaisers(raw: unknown): RecruitmentConfig["raisers"] {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const list = (v: unknown, ok: (x: string) => boolean) => [...new Set((Array.isArray(v) ? v : []).filter((x): x is string => typeof x === "string" && ok(x)))];
  return { roles: list(r.roles, (x) => /^[a-z0-9_]{1,64}$/.test(x)), userIds: list(r.userIds, (x) => UUID.test(x)) };
}

/** The approvers and limits set in Recruitment -> Configurations. Empty (nobody set) before the migration or when never saved. */
export async function loadRecruitmentConfig(client: SupabaseClient, orgId: string): Promise<RecruitmentConfig> {
  const { data, error } = await client.from(SETTINGS).select("recruitment_config").eq("organization_id", orgId).maybeSingle();
  if (error) {
    if (!missingRelation(error)) console.error("[candidates] recruitment config read failed", error);
    return EMPTY_CONFIG;
  }
  return toConfig((data as { recruitment_config?: unknown } | null)?.recruitment_config);
}

/**
 * May this person change the approvers. Owner 2026-11-20: the section moved to the Tech dashboard's HR Configs tab, so
 * the people who set the rest of it (the Tech team and admins, RAISER_SETTINGS_ROLES) set this too.
 */
export async function mayConfigureApprovals(client: SupabaseClient, userId: string, orgId: string): Promise<boolean> {
  return mayConfigureRaisers(client, userId, orgId);
}

/** Someone to pick (the Task Manager's people list: name and department). */
export interface PickablePerson { id: string; name: string; department: string | null; role: string | null }

export const HR_ROLES: readonly string[] = ["hr", "hr_head", "hr_manager", "hr_ops"];
export const DIRECTOR_ROLES: readonly string[] = ["org_super_admin"];
const isHrDepartment = (d: string | null | undefined) => /^(hr|human\s*resources?)\b/i.test((d ?? "").trim());

/**
 * Owner 2026-11-20: "these dropdowns … must only have hr team members, and directors must have org super admins".
 * HR Head (and backup): the Task Manager's Human Resources department, and anyone with an HR role. Director (and
 * backup): the org super admins. `people` is the Task Manager's list; `roles` the organisation's active roles by person;
 * `names` fills in someone with the role who is not on the Task Manager's list.
 */
export function approverPools(
  people: { id: string; name: string; department: string | null }[],
  roles: { userId: string; role: string }[],
  names: Map<string, string | null> = new Map(),
): { hr: PickablePerson[]; directors: PickablePerson[] } {
  const byId = new Map(people.map((p) => [p.id, p]));
  const roleOf = new Map<string, string[]>();
  for (const r of roles) roleOf.set(r.userId, [...(roleOf.get(r.userId) ?? []), r.role.toLowerCase()]);
  const person = (id: string): PickablePerson => {
    const p = byId.get(id);
    const role = (roleOf.get(id) ?? [])[0] ?? null;
    return { id, name: p?.name ?? names.get(id) ?? "Unnamed", department: p?.department ?? null, role };
  };
  const has = (id: string, list: readonly string[]) => (roleOf.get(id) ?? []).some((r) => list.includes(r));
  const ids = new Set([...people.map((p) => p.id), ...roles.map((r) => r.userId)]);
  const sort = (list: PickablePerson[]) => list.sort((a, b) => a.name.localeCompare(b.name));
  return {
    hr: sort([...ids].filter((id) => isHrDepartment(byId.get(id)?.department) || has(id, HR_ROLES)).map(person)),
    directors: sort([...ids].filter((id) => has(id, DIRECTOR_ROLES)).map(person)),
  };
}

/** The organisation's active roles by person, and the names of those people (for approverPools). */
export async function activeRoles(client: SupabaseClient, orgId: string): Promise<{ roles: { userId: string; role: string }[]; names: Map<string, string | null> }> {
  const { data, error } = await client.from("organization_memberships").select("user_id, role, is_active").eq("organization_id", orgId).limit(5000);
  if (error) fail("load the people", error);
  const roles = ((data ?? []) as { user_id: string | null; role: string | null; is_active: boolean | null }[])
    .filter((r) => r.user_id && r.role && r.is_active !== false).map((r) => ({ userId: r.user_id as string, role: r.role as string }));
  return { roles, names: await namesOf(client, [...new Set(roles.map((r) => r.userId))]) };
}

// Who may raise a hiring request (owner 2026-11-20: "make it configurable somewhere in the tech login on who can have
// that option in their sidebars"; "it must be only for the logins": HR no longer raises on their behalf) ---------------

/** The Tech team and admins set who may raise requests (the roles that set the Omnichannel matrix). */
export const RAISER_SETTINGS_ROLES: readonly string[] = ["tech", "org_super_admin", "org_admin", "owner", "admin", "master_admin", "super_admin"];

export async function mayConfigureRaisers(client: SupabaseClient, userId: string, orgId: string): Promise<boolean> {
  const [{ data: user }, { data: rows }] = await Promise.all([
    client.from("users").select("is_master_admin").eq("id", userId).maybeSingle(),
    client.from("organization_memberships").select("role, is_active").eq("user_id", userId).eq("organization_id", orgId),
  ]);
  if ((user as { is_master_admin?: boolean } | null)?.is_master_admin) return true;
  return ((rows ?? []) as { role: string | null; is_active: boolean | null }[])
    .some((r) => r.is_active !== false && RAISER_SETTINGS_ROLES.includes((r.role ?? "").toLowerCase()));
}

/** The person's active roles here: their organisation roles, and their roles on its properties. */
async function rolesOf(client: SupabaseClient, userId: string, orgId: string): Promise<string[]> {
  const [orgRows, propRows] = await Promise.all([
    client.from("organization_memberships").select("role, is_active").eq("user_id", userId).eq("organization_id", orgId),
    client.from("property_memberships").select("role, is_active").eq("user_id", userId).eq("organization_id", orgId),
  ]);
  const rows = [...((orgRows.data ?? []) as { role: string | null; is_active: boolean | null }[]), ...(propRows.error ? [] : ((propRows.data ?? []) as { role: string | null; is_active: boolean | null }[]))];
  return [...new Set(rows.filter((r) => r.is_active !== false && r.role).map((r) => (r.role as string).toLowerCase()))];
}

/** May this person raise a hiring request: picked by name, or holding one of the roles picked. */
export async function canRaiseRequisitions(client: SupabaseClient, userId: string, orgId: string, config?: RecruitmentConfig): Promise<boolean> {
  const { raisers } = config ?? (await loadRecruitmentConfig(client, orgId));
  if (raisers.userIds.includes(userId)) return true;
  if (!raisers.roles.length) return false;
  return (await rolesOf(client, userId, orgId)).some((r) => raisers.roles.includes(r));
}

const RaisersInput = z.object({
  roles: z.array(z.string().regex(/^[a-z0-9_]{1,64}$/, "Unknown role.")).max(60),
  userIds: z.array(z.string().regex(UUID, "Unknown person.")).max(500),
});

/** Saves who may raise requests (the Tech dashboard), recorded in the history of changes when it changed. */
export async function saveRaisers(client: SupabaseClient, orgId: string, body: unknown, by?: Actor): Promise<RecruitmentConfig["raisers"]> {
  const parsed = RaisersInput.safeParse(body ?? {});
  if (!parsed.success) throw new CandidateActionError(400, parsed.error.issues[0]?.message ?? "Pick the roles and people.");
  const current = await loadRecruitmentConfig(client, orgId);
  const raisers = { roles: [...new Set(parsed.data.roles)].sort(), userIds: [...new Set(parsed.data.userIds)] };
  const next: RecruitmentConfig = { ...current, raisers };
  const now = new Date().toISOString();
  const { data: existing, error: readErr } = await client.from(SETTINGS).select("organization_id").eq("organization_id", orgId).maybeSingle();
  if (readErr) fail("save the settings", readErr);
  const { error } = existing
    ? await client.from(SETTINGS).update({ recruitment_config: next, updated_at: now }).eq("organization_id", orgId)
    : await client.from(SETTINGS).insert({ organization_id: orgId, recruitment_config: next, created_at: now, updated_at: now });
  if (error) fail("save the settings", error);
  const before = current.raisers;
  if (by && JSON.stringify({ r: [...before.roles].sort(), u: [...before.userIds].sort() }) !== JSON.stringify({ r: raisers.roles, u: [...raisers.userIds].sort() })) {
    const names = await namesOf(client, raisers.userIds);
    const summary = `Who can raise hiring requests: ${raisers.roles.length ? `roles ${raisers.roles.map((r) => r.replace(/_/g, " ")).join(", ")}` : "no roles"}${raisers.userIds.length ? `; people ${raisers.userIds.map((id) => names.get(id) ?? "someone").join(", ")}` : ""}`;
    const { error: logError } = await client.from("recruitment_stage_changes").insert({
      organization_id: orgId, changed_by: by.id, changed_by_name: by.name, summary: summary.slice(0, 2000), before: { raisers: before }, after: { raisers }, created_at: now,
    });
    if (logError && !missingRelation(logError)) console.error("[candidates] raisers: the change was not recorded", logError);
  }
  return raisers;
}

/** The roles people hold in the organisation (on it, or on its properties), to pick who may raise requests. */
export async function roleChoices(client: SupabaseClient, orgId: string): Promise<string[]> {
  const [orgRows, propRows] = await Promise.all([
    client.from("organization_memberships").select("role, is_active").eq("organization_id", orgId).limit(5000),
    client.from("property_memberships").select("role, is_active").eq("organization_id", orgId).limit(5000),
  ]);
  const rows = [...((orgRows.data ?? []) as { role: string | null; is_active: boolean | null }[]), ...(propRows.error ? [] : ((propRows.data ?? []) as { role: string | null; is_active: boolean | null }[]))];
  return [...new Set(rows.filter((r) => r.is_active !== false && r.role).map((r) => (r.role as string).toLowerCase()))].sort();
}

const DepartmentHeadsInput = z.object({
  heads: z.array(z.object({
    department: z.string().trim().min(1, "Name the department.").max(80, "A department name is at most 80 characters."),
    userId: z.string().regex(UUID, "Pick the head from the list."),
  })).max(100),
});

/**
 * Owner 2026-11-21: saves the department heads (the Tech dashboard's HR Configs tab), recorded in the history of changes
 * when they changed. `allowed`: the people who may be picked (the Task Manager's list); someone already set may stay.
 */
export async function saveDepartmentHeads(client: SupabaseClient, orgId: string, body: unknown, by?: Actor, allowed?: Set<string>): Promise<RecruitmentConfig["departmentHeads"]> {
  const parsed = DepartmentHeadsInput.safeParse(body ?? {});
  if (!parsed.success) throw new CandidateActionError(400, parsed.error.issues[0]?.message ?? "Pick a department and a person for each row.");
  const keys = parsed.data.heads.map((h) => deptKey(h.department));
  const twice = keys.find((k, i) => keys.indexOf(k) !== i);
  if (twice) throw new CandidateActionError(400, `"${parsed.data.heads[keys.indexOf(twice)].department}" is listed twice. Give each department one head.`);
  const current = await loadRecruitmentConfig(client, orgId);
  if (allowed) {
    const before = new Set(current.departmentHeads.map((h) => h.userId));
    const stranger = parsed.data.heads.find((h) => !allowed.has(h.userId) && !before.has(h.userId));
    if (stranger) throw new CandidateActionError(400, `The head of ${stranger.department} must be someone in the Task Manager's people list.`);
  }
  const heads = toDepartmentHeads(parsed.data.heads);
  const next: RecruitmentConfig = { ...current, departmentHeads: heads };
  const now = new Date().toISOString();
  const { data: existing, error: readErr } = await client.from(SETTINGS).select("organization_id").eq("organization_id", orgId).maybeSingle();
  if (readErr) fail("save the settings", readErr);
  const { error } = existing
    ? await client.from(SETTINGS).update({ recruitment_config: next, updated_at: now }).eq("organization_id", orgId)
    : await client.from(SETTINGS).insert({ organization_id: orgId, recruitment_config: next, created_at: now, updated_at: now });
  if (error) fail("save the settings", error);
  const sig = (list: RecruitmentConfig["departmentHeads"]) => JSON.stringify(list.map((h) => [deptKey(h.department), h.userId]).sort());
  if (by && sig(current.departmentHeads) !== sig(heads)) {
    const names = await namesOf(client, heads.map((h) => h.userId));
    const summary = `Department heads: ${heads.length ? heads.map((h) => `${h.department} — ${names.get(h.userId) ?? "someone"}`).join(", ") : "none"}`;
    const { error: logError } = await client.from("recruitment_stage_changes").insert({
      organization_id: orgId, changed_by: by.id, changed_by_name: by.name, summary: summary.slice(0, 2000), before: { departmentHeads: current.departmentHeads }, after: { departmentHeads: heads }, created_at: now,
    });
    if (logError && !missingRelation(logError)) console.error("[candidates] department heads: the change was not recorded", logError);
  }
  return heads;
}

/** "HR Head: Priya Shah (was nobody) · CTC level: 15 LPA (was 12 LPA)": what a save changed, for the history. */
async function describeConfigChange(client: SupabaseClient, before: RecruitmentConfig, after: RecruitmentConfig): Promise<string> {
  const ids = [before.hrHead, before.director, after.hrHead, after.director].flatMap((s) => [s.userId, s.backupUserId]).filter((id): id is string => Boolean(id));
  const names = await namesOf(client, ids);
  const who = (id: string | null) => (id ? names.get(id) ?? "someone" : "nobody");
  const lpa = (v: number | null) => (v === null ? "none" : `${(v / 100_000).toLocaleString("en-IN", { maximumFractionDigits: 1 })} LPA`);
  const parts: string[] = [];
  const pairs: [string, string | null, string | null][] = [
    ["HR Head", before.hrHead.userId, after.hrHead.userId], ["HR Head backup", before.hrHead.backupUserId, after.hrHead.backupUserId],
    ["Director", before.director.userId, after.director.userId], ["Director backup", before.director.backupUserId, after.director.backupUserId],
  ];
  for (const [label, was, now] of pairs) if (was !== now) parts.push(`${label}: ${who(now)} (was ${who(was)})`);
  if (before.directorCtcLevel !== after.directorCtcLevel) parts.push(`Director above: ${lpa(after.directorCtcLevel)} (was ${lpa(before.directorCtcLevel)})`);
  if (before.targetDays !== after.targetDays) parts.push(`target days: ${after.targetDays} (was ${before.targetDays})`);
  return parts.length ? `Hiring approvals: ${parts.join(" · ")}` : "";
}

/**
 * Saves the settings (Recruitment -> Configurations). Only the keys given change. `by`: who saved, for the history of
 * changes (recruitment_stage_changes, migration 20261119000001; skipped before it).
 */
export async function saveRecruitmentConfig(client: SupabaseClient, orgId: string, body: unknown, by?: Actor, pools?: { hr: PickablePerson[]; directors: PickablePerson[] }): Promise<RecruitmentConfig> {
  const parsed = ConfigInput.safeParse(body ?? {});
  if (!parsed.success) throw new CandidateActionError(400, parsed.error.issues[0]?.message ?? "Those settings are not valid.");
  const current = await loadRecruitmentConfig(client, orgId);
  // Owner 2026-11-20: the HR Head from the HR team, the Director from the org super admins (a person already set may stay).
  if (pools) {
    const check = (label: string, wanted: string | null | undefined, was: string | null, pool: PickablePerson[], who: string) => {
      if (wanted && wanted !== was && !pool.some((p) => p.id === wanted)) throw new CandidateActionError(400, `The ${label} must be ${who}.`);
    };
    check("HR Head", parsed.data.hrHead?.userId, current.hrHead.userId, pools.hr, "someone in the HR team");
    check("HR Head's backup", parsed.data.hrHead?.backupUserId, current.hrHead.backupUserId, pools.hr, "someone in the HR team");
    check("Director", parsed.data.director?.userId, current.director.userId, pools.directors, "an org super admin");
    check("Director's backup", parsed.data.director?.backupUserId, current.director.backupUserId, pools.directors, "an org super admin");
  }
  const next: RecruitmentConfig = {
    hrHead: { userId: parsed.data.hrHead?.userId === undefined ? current.hrHead.userId : parsed.data.hrHead.userId, backupUserId: parsed.data.hrHead?.backupUserId === undefined ? current.hrHead.backupUserId : parsed.data.hrHead.backupUserId },
    director: { userId: parsed.data.director?.userId === undefined ? current.director.userId : parsed.data.director.userId, backupUserId: parsed.data.director?.backupUserId === undefined ? current.director.backupUserId : parsed.data.director.backupUserId },
    directorCtcLevel: parsed.data.directorCtcLevel === undefined ? current.directorCtcLevel : parsed.data.directorCtcLevel,
    targetDays: parsed.data.targetDays ?? current.targetDays,
    // Who may raise requests and the department heads are set separately (saveRaisers, saveDepartmentHeads); kept here.
    raisers: current.raisers,
    departmentHeads: current.departmentHeads,
    rejectionReasons: current.rejectionReasons,
    offerLetter: current.offerLetter,
    hierarchy: current.hierarchy,
    outreach: current.outreach,
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
  if (by) {
    const summary = await describeConfigChange(client, current, next);
    if (summary) {
      const { error: logError } = await client.from("recruitment_stage_changes").insert({
        organization_id: orgId, changed_by: by.id, changed_by_name: by.name, summary, before: { approvals: current }, after: { approvals: next }, created_at: now,
      });
      if (logError && !missingRelation(logError)) console.error("[candidates] recruitment config: the change was not recorded", logError);
    }
  }
  return next;
}

const configured = (c: RecruitmentConfig) => Boolean(c.hrHead.userId || c.director.userId);
const slotOf = (c: RecruitmentConfig, level: ApprovalLevel) => (level === "hr_head" ? c.hrHead : c.director);
/** Everyone who may act at this level. */
const approversAt = (c: RecruitmentConfig, level: ApprovalLevel): string[] => [slotOf(c, level).userId, slotOf(c, level).backupUserId].filter((id): id is string => Boolean(id));

/** Hours a request has waited at its current level (0 when unknown). */
const hoursAtLevel = (levelEnteredAt: unknown, now: Date) => {
  const at = isoOrNull(levelEnteredAt);
  return at ? Math.max(0, (now.getTime() - new Date(at).getTime()) / 3_600_000) : 0;
};

/**
 * Who may decide a request at its level now. At the department head's level (owner 2026-11-24): the head it waits on;
 * once it has waited HOD_DECISION_HOURS, the HR Head (or backup) may decide in their place ("HR approves if the HOD does
 * not"). Every other level: that level's approver and backup.
 */
function approversFor(c: RecruitmentConfig, row: Record<string, unknown>, level: RequisitionLevel, now: Date): string[] {
  if (level !== "hod") return approversAt(c, level);
  const head = (row.current_approver_id as string | null) ?? null;
  const late = hoursAtLevel(row.level_entered_at, now) >= HOD_DECISION_HOURS;
  return [...new Set([head, ...(late ? approversAt(c, "hr_head") : [])].filter((id): id is string => Boolean(id)))];
}

/** After the department head: the HR Head (or backup), never the person who raised it or the head who just approved; else the Director. */
function levelAfterHod(c: RecruitmentConfig, raisedBy: unknown, headId: string | null): { level: ApprovalLevel; approverId: string } {
  const hr = approversAt(c, "hr_head").find((id) => id !== raisedBy && id !== headId);
  if (hr) return { level: "hr_head", approverId: hr };
  const director = approversAt(c, "director").find((id) => id !== raisedBy && id !== headId);
  if (director) return { level: "director", approverId: director };
  throw new CandidateActionError(409, "No HR Head or Director is free to take this request next. Ask the Tech team to add a backup approver in HR Configs.");
}

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
  const headOf = departmentsHeadedBy(config, userId);
  // Owner 2026-11-24: a department head decides first on their departments' requests.
  const approverLevels: RequisitionLevel[] = [...(headOf.length ? ["hod" as const] : []), ...APPROVAL_LEVELS.filter((level) => approversAt(config, level).includes(userId))];
  const canRaise = await canRaiseRequisitions(client, userId, orgId, config);
  // Someone picked to raise requests, or a department head, counts as a member even with only property roles.
  return { seesAll, approverLevels, configured: configured(config), canRaise, headOf, userId, config, member: isMaster || roles.length > 0 || canRaise || headOf.length > 0 };
}

// Rows -----------------------------------------------------------------------------------------------------------------

function toRequisition(row: Record<string, unknown>, names: Map<string, string | null>, now: Date): Requisition {
  const submittedAt = isoOrNull(row.submitted_at);
  return {
    id: row.id as string,
    requisitionNo: (row.requisition_no as string | null) ?? null,
    status: row.status as RequisitionStatus,
    currentLevel: (row.current_level as RequisitionLevel | null) ?? null,
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
    internalMobility: (row.internal_mobility as boolean | null | undefined) ?? null,
    structureNote: (row.structure_note as string | null | undefined) ?? null,
    roleIsNew: row.role_is_new === true,
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

/** May this viewer see the request: HR and admins all; else their own, those waiting on them, and (department heads) their departments' submitted ones. */
export function maySee(r: Pick<Requisition, "raisedBy" | "currentApproverId" | "department" | "status">, viewer: { userId: string; seesAll: boolean; headOf?: string[] }): boolean {
  if (viewer.seesAll || r.raisedBy === viewer.userId || r.currentApproverId === viewer.userId) return true;
  return r.status !== "draft" && Boolean(viewer.headOf?.includes(deptKey(r.department)));
}

/**
 * The tracker's extras for these requests: "candidates in pipeline" (the people in the position opened from each) and
 * who endorsed it. Neither stops the list loading when it cannot be read.
 */
async function withExtras(client: SupabaseClient, orgId: string, list: Requisition[]): Promise<Requisition[]> {
  if (!list.length) return list;
  const positionIds = [...new Set(list.map((r) => r.positionId).filter((id): id is string => Boolean(id)))];
  const [members, endorsements] = await Promise.all([
    positionIds.length ? client.from("candidate_position_members").select("position_id").eq("organization_id", orgId).in("position_id", positionIds).is("deleted_at", null) : Promise.resolve({ data: [], error: null }),
    client.from(APPROVALS).select("requisition_id, by_name, created_at").eq("organization_id", orgId).eq("action", "endorsed").in("requisition_id", list.map((r) => r.id)).order("created_at", { ascending: false }),
  ]);
  const counts = new Map<string, number>();
  for (const m of ((members.error ? [] : members.data) ?? []) as { position_id: string }[]) counts.set(m.position_id, (counts.get(m.position_id) ?? 0) + 1);
  const endorsed = new Map<string, string[]>();
  for (const e of ((endorsements.error ? [] : endorsements.data) ?? []) as { requisition_id: string; by_name: string | null }[]) {
    endorsed.set(e.requisition_id, [...(endorsed.get(e.requisition_id) ?? []), e.by_name ?? "A department head"]);
  }
  return list.map((r) => ({ ...r, pipelineCount: r.positionId ? counts.get(r.positionId) ?? 0 : null, endorsedBy: endorsed.get(r.id) ?? [] }));
}

/** The requests this person may see (maySee), newest first. */
export async function listRequisitions(client: SupabaseClient, orgId: string, viewer: { userId: string; seesAll: boolean; headOf?: string[] }, now = new Date()): Promise<Requisition[]> {
  let q = client.from(TABLE).select(COLUMNS).eq("organization_id", orgId).is("deleted_at", null).order("created_at", { ascending: false }).limit(300);
  // A department head also sees their departments' requests: filtered below (department names may hold any character).
  if (!viewer.seesAll && !viewer.headOf?.length) q = q.or(`raised_by.eq.${viewer.userId},current_approver_id.eq.${viewer.userId}`);
  const { data, error } = await q;
  if (error) fail("load the requests", error);
  const rows = (data ?? []) as unknown as Record<string, unknown>[];
  const names = await namesOf(client, rows.map((r) => r.current_approver_id as string).filter(Boolean));
  return withExtras(client, orgId, rows.map((r) => toRequisition(r, names, now)).filter((r) => maySee(r, viewer)));
}

export async function getRequisition(client: SupabaseClient, orgId: string, id: string, now = new Date()): Promise<{ requisition: Requisition; approvals: RequisitionApproval[] }> {
  const row = await loadRow(client, orgId, id);
  const [names, { data, error }] = await Promise.all([
    namesOf(client, [row.current_approver_id as string].filter(Boolean)),
    client.from(APPROVALS).select("id, level, action, in_plan, reason, by_name, via, created_at").eq("organization_id", orgId).eq("requisition_id", row.id as string).order("created_at", { ascending: false }),
  ]);
  if (error) fail("load the request's history", error);
  const [requisition] = await withExtras(client, orgId, [toRequisition(row, names, now)]);
  requisition.previous = await previousFor(client, orgId, requisition.roleTitle, requisition.id);
  const approvals = ((data ?? []) as Record<string, unknown>[]).map((a) => ({
    id: a.id as string,
    level: (a.level as RequisitionLevel | null) ?? null,
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
  /** Owner 2026-11-24: can someone already in the company fill it. */
  internalMobility: z.boolean().nullable().optional(),
  /** Owner 2026-11-24: where the role sits in the current structure. */
  structureNote: text(2000).nullable().optional(),
  /** Owner 2026-11-24: the role was typed under "Others" (a new designation). */
  roleIsNew: z.boolean().optional(),
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
  set("internal_mobility", input.internalMobility);
  set("structure_note", blankToNull(input.structureNote));
  if (input.roleIsNew !== undefined || !partial) out.role_is_new = input.roleIsNew ?? false;
  return out;
}

/**
 * What the form must have before it can be submitted (Stage 1's fields; the budget band is required because Stage 2
 * routes on it). Owner 2026-11-24 (23 Nov meeting): the justification and where the role sits in the structure are both
 * required, and so is the internal mobility answer.
 */
function readyToSubmit(row: Record<string, unknown>): string | null {
  if (!String(row.role_title ?? "").trim()) return "Give the role a title.";
  if (row.budget_max_ctc === null || row.budget_max_ctc === undefined) return "Give the budget band (maximum CTC per year).";
  if (!String(row.justification ?? "").trim()) return "Say why the role is needed (the justification).";
  if (!String(row.structure_note ?? "").trim()) return "Say where the role sits in the current structure.";
  if (row.internal_mobility !== true && row.internal_mobility !== false) return "Answer whether someone already in the company could fill it (internal mobility).";
  if (row.request_type === "replacement" && !String(row.replacing_name ?? "").trim()) return "Say who is being replaced.";
  return null;
}

// Events (what the routes send) ---------------------------------------------------------------------------------------

export type RequisitionEvent =
  | { kind: "awaiting"; requisition: Requisition; approverId: string; level: RequisitionLevel }
  /** Owner 2026-11-24: a request was submitted; the department head, HR and the Director hear of it (not the approver it waits on). */
  | { kind: "raised"; requisition: Requisition; approverId: string }
  | { kind: "decided"; requisition: Requisition; decision: "approved" | "rejected" | "sent_back" | "on_hold" | "resumed"; reason: string | null; byName: string | null; byId?: string | null }
  | { kind: "director_informed"; requisition: Requisition; directorId: string }
  /** Owner 2026-11-21: a request for a department went in; its head may endorse it. */
  | { kind: "department_head"; requisition: Requisition; headId: string }
  /** Spec A03: approved, the role is open; HR assigns a recruiter. */
  | { kind: "role_opened"; requisition: Requisition }
  /** Spec A24: the raiser confirmed a request on hold is still needed; the approver it waits on is told. */
  | { kind: "still_needed"; requisition: Requisition; approverId: string | null; note: string | null };
export type RequisitionNotifier = (event: RequisitionEvent) => Promise<void>;
export interface RequisitionDeps {
  notify?: RequisitionNotifier;
  now?: () => Date;
  sourceMailId?: string;
  /** Owner 2026-11-24: the form's department → designations list; given, a submitted role must come from it (or "Others"). */
  hierarchy?: RequisitionHierarchy;
}

async function emit(deps: RequisitionDeps, event: RequisitionEvent): Promise<void> {
  if (!deps.notify) return;
  try {
    await deps.notify(event);
  } catch (error) {
    console.error("[candidates] requisition notice failed", error);
  }
}

async function record(client: SupabaseClient, orgId: string, requisitionId: string, by: Actor | null, entry: { level?: RequisitionLevel | null; action: RequisitionApproval["action"]; inPlan?: boolean | null; reason?: string | null; via?: "app" | "link" }): Promise<void> {
  const { error } = await client.from(APPROVALS).insert({
    organization_id: orgId, requisition_id: requisitionId, level: entry.level ?? null, action: entry.action, in_plan: entry.inPlan ?? null,
    reason: entry.reason ?? null, by_user: by?.id ?? null, by_name: by?.name ?? null, via: entry.via ?? "app", created_at: new Date().toISOString(),
  });
  if (error) fail("record the step", error);
}

/**
 * Updates the request only if it is still in the status (and at the level) it was read in. When another person or
 * another click changed it in between, nothing is written and the caller is told to refresh, so the same step can
 * never be taken twice.
 */
async function guardedUpdate(client: SupabaseClient, orgId: string, row: Record<string, unknown>, level: RequisitionLevel | null | undefined, values: Record<string, unknown>, what: string): Promise<void> {
  let q = client.from(TABLE).update(values).eq("organization_id", orgId).eq("id", row.id as string).eq("status", row.status as string);
  if (level !== undefined) q = level === null ? q.is("current_level", null) : q.eq("current_level", level);
  const { data, error } = await q.select("id");
  if (error) fail(what, error);
  if (!((data as unknown[] | null) ?? []).length) throw new CandidateActionError(409, "This request changed a moment ago, perhaps by someone else. Refresh to see where it stands now.");
}

// Raising (Stage 1) -----------------------------------------------------------------------------------------------------

/** A new request as a draft; with `submit`, submitted straight away. */
export async function createRequisition(client: SupabaseClient, orgId: string, by: Actor, body: unknown, deps: RequisitionDeps = {}): Promise<Requisition> {
  const b = (body ?? {}) as Record<string, unknown>;
  const parsed = FormInput.safeParse(b);
  if (!parsed.success) throw new CandidateActionError(400, parsed.error.issues[0]?.message ?? "Those details are not valid.");
  const now = (deps.now ?? (() => new Date()))().toISOString();
  const { data, error } = await client.from(TABLE).insert({ organization_id: orgId, ...formColumns(parsed.data, false), status: "draft", raised_by: by.id, raised_by_name: by.name, created_at: now, updated_at: now, ...(deps.sourceMailId ? { source_mail_id: deps.sourceMailId } : {}) }).select("id").single();
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
export function firstLevelFor(config: RecruitmentConfig, raisedBy: string, department?: string | null): { level: RequisitionLevel; approverId: string } {
  // Owner 2026-11-24: the department head first, when the department has one who did not raise it and is not also the
  // HR Head (who then decides once, as the HR Head). The HR Head and Director still need to be set.
  const head = headOfDepartment(config, department);
  if (head && head !== raisedBy && configured(config) && !approversAt(config, "hr_head").includes(head)) return { level: "hod", approverId: head };
  const pick = (level: ApprovalLevel) => approversAt(config, level).find((id) => id !== raisedBy) ?? null;
  const hrHead = pick("hr_head");
  if (hrHead) return { level: "hr_head", approverId: hrHead };
  const director = pick("director");
  if (director) return { level: "director", approverId: director };
  if (!configured(config)) throw new CandidateActionError(409, "The approvers are not set yet. Ask the Tech team to set them in the Tech dashboard → HR Configs.");
  throw new CandidateActionError(409, "You are the only approver set, and a request cannot be approved by the person who raised it. Ask the Tech team to add a backup approver in Settings.");
}

/** Stage 1's exit: submitted for approval. Gets its number on first submission; a request sent back is resubmitted. */
export async function submitRequisition(client: SupabaseClient, orgId: string, by: Actor, id: string, deps: RequisitionDeps = {}): Promise<Requisition> {
  const row = await loadRow(client, orgId, id);
  if (row.raised_by !== by.id) throw new CandidateActionError(403, "Only the person who raised the request can submit it.");
  if (row.status !== "draft" && row.status !== "sent_back") throw new CandidateActionError(409, "This request has already been submitted.");
  const problem = readyToSubmit(row) ?? checkAgainstHierarchy(deps.hierarchy, row);
  if (problem) throw new CandidateActionError(400, problem);
  const config = await loadRecruitmentConfig(client, orgId);
  const first = firstLevelFor(config, by.id, row.department as string | null);
  const now = (deps.now ?? (() => new Date()))().toISOString();

  // Guarded on the status it was read in, so a double click submits once (and uses up one request number).
  await guardedUpdate(client, orgId, row, undefined, {
    status: "submitted", current_level: first.level, current_approver_id: first.approverId, level_entered_at: now,
    in_plan: null, needs_director: false, hold_since: null, hold_reason: null, decided_at: null, decision_reason: null,
    submitted_at: now, updated_at: now,
  }, "submit the request");
  if (!row.requisition_no) {
    const { data, error } = await client.rpc("recruitment_next_requisition_no", { p_organization_id: orgId });
    if (error) fail("number the request", error);
    const { error: numberError } = await client.from(TABLE).update({ requisition_no: String(data) }).eq("organization_id", orgId).eq("id", row.id as string).is("requisition_no", null);
    if (numberError) fail("number the request", numberError);
  }
  await record(client, orgId, row.id as string, by, { action: "submitted", level: first.level, reason: row.status === "sent_back" ? "Resubmitted after changes" : null });
  const { requisition } = await getRequisition(client, orgId, row.id as string);
  await emit(deps, { kind: "awaiting", requisition, approverId: first.approverId, level: first.level });
  // Owner 2026-11-21: the department's head hears of it and may endorse it (not when they raised it, or approve it).
  const head = headOfDepartment(config, requisition.department);
  if (head && head !== by.id && head !== first.approverId) await emit(deps, { kind: "department_head", requisition, headId: head });
  // Owner 2026-11-24 (23 Nov meeting): the HR Head and the Director hear of every new request too.
  await emit(deps, { kind: "raised", requisition, approverId: first.approverId });
  return requisition;
}

/** The person who raised it takes it back, at any point before a decision. */
export async function withdrawRequisition(client: SupabaseClient, orgId: string, by: Actor, id: string, reasonInput: unknown): Promise<Requisition> {
  const row = await loadRow(client, orgId, id);
  if (row.raised_by !== by.id) throw new CandidateActionError(403, "Only the person who raised the request can withdraw it.");
  if (!["draft", "submitted", "sent_back", "on_hold"].includes(row.status as string)) throw new CandidateActionError(409, "This request has already been decided.");
  const reason = typeof reasonInput === "string" ? reasonInput.trim().slice(0, 1000) || null : null;
  const now = new Date().toISOString();
  await guardedUpdate(client, orgId, row, undefined, { status: "withdrawn", current_level: null, current_approver_id: null, decided_at: now, decision_reason: reason, updated_at: now }, "withdraw the request");
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
 *   approve   : at the department head (owner 2026-11-24) -> on to the HR Head. At the HR Head, with the in-plan tick:
 *               in plan and within the CTC level -> approved, the Director is notified; out of plan or above the level
 *               -> on to the Director. At the Director -> approved.
 *   reject    : with a reason. Final.
 *   send_back : with a reason; the manager changes and resubmits.
 *   hold      : with a reason (owner 2026-11-24); waits; `resume` (by an approver at that level) puts it back in the
 *               queue, the clock restarted.
 * After 48 hours at the department head, the HR Head (or backup) may decide in the head's place; their decision is the
 * HR Head's (the in-plan tick included). Approved means the role becomes active: a position is opened in Positions.
 */
export async function decideRequisition(client: SupabaseClient, orgId: string, by: Actor, id: string, body: unknown, deps: RequisitionDeps & { via?: "app" | "link" } = {}): Promise<Requisition> {
  const parsed = DecisionInput.safeParse(body ?? {});
  if (!parsed.success) throw new CandidateActionError(400, parsed.error.issues[0]?.message ?? "That decision is not valid.");
  const { decision } = parsed.data;
  const reason = parsed.data.reason?.trim() || null;
  const row = await loadRow(client, orgId, id);
  const config = await loadRecruitmentConfig(client, orgId);
  const level = (row.current_level as RequisitionLevel | null) ?? null;
  const nowDate = (deps.now ?? (() => new Date()))();
  if (row.status !== "submitted" && row.status !== "on_hold") throw new CandidateActionError(409, `This request is ${String(row.status).replace("_", " ")}; there is nothing to decide.`);
  if (!level) throw new CandidateActionError(409, "This request is not waiting at any level.");
  if (row.raised_by === by.id) throw new CandidateActionError(403, "A request cannot be approved by the person who raised it.");
  if (!approversFor(config, row, level, nowDate).includes(by.id)) {
    throw new CandidateActionError(403, level === "hod"
      ? `Only the department head can decide on this request now. The HR Head can decide in their place after ${HOD_DECISION_HOURS} hours.`
      : `Only the ${APPROVAL_LEVEL_LABELS[level]} (or their backup) can decide on this request now.`);
  }
  if ((decision === "reject" || decision === "send_back" || decision === "hold") && !reason) {
    throw new CandidateActionError(400, decision === "reject" ? "Give the reason for rejecting." : decision === "hold" ? "Give the reason for putting it on hold." : "Say what needs to change.");
  }
  if (row.status === "on_hold" && decision !== "resume") throw new CandidateActionError(409, "This request is on hold. Resume it first.");
  if (row.status === "submitted" && decision === "resume") throw new CandidateActionError(409, "This request is not on hold.");

  // The HR Head deciding at the department head's level (after 48 h) decides as the HR Head.
  const steppingIn = level === "hod" && by.id !== row.current_approver_id;
  const acting: RequisitionLevel = steppingIn ? "hr_head" : level;
  const noted = (text: string | null) => (steppingIn ? [text, `Decided in place of the department head (no decision in ${HOD_DECISION_HOURS} hours).`].filter(Boolean).join(" ") : text);

  const now = nowDate.toISOString();
  const via = deps.via ?? "app";
  // Only moves the request if it still stands where it was read (same status, same level): two approvers deciding at
  // the same moment cannot both win, so a request is never approved twice or opens two positions.
  const update = (values: Record<string, unknown>, what: string) => guardedUpdate(client, orgId, row, level, { ...values, updated_at: now }, what);
  const done = async (): Promise<Requisition> => (await getRequisition(client, orgId, row.id as string)).requisition;

  if (decision === "hold") {
    await update({ status: "on_hold", hold_since: now, hold_reason: reason }, "put the request on hold");
    await record(client, orgId, row.id as string, by, { level: acting, action: "on_hold", reason: noted(reason), via });
    const requisition = await done();
    await emit(deps, { kind: "decided", requisition, decision: "on_hold", reason, byName: by.name, byId: by.id });
    return requisition;
  }
  if (decision === "resume") {
    await update({ status: "submitted", hold_since: null, hold_reason: null, level_entered_at: now }, "resume the request");
    await record(client, orgId, row.id as string, by, { level: acting, action: "resumed", reason: noted(reason), via });
    const requisition = await done();
    await emit(deps, { kind: "decided", requisition, decision: "resumed", reason, byName: by.name, byId: by.id });
    return requisition;
  }
  if (decision === "reject" || decision === "send_back") {
    const status = decision === "reject" ? "rejected" : "sent_back";
    await update({ status, current_level: null, current_approver_id: null, decided_at: decision === "reject" ? now : null, decision_reason: reason }, "record the decision");
    await record(client, orgId, row.id as string, by, { level: acting, action: status, reason: noted(reason), via });
    const requisition = await done();
    await emit(deps, { kind: "decided", requisition, decision: status, reason, byName: by.name, byId: by.id });
    return requisition;
  }

  // approve
  if (acting === "hod") {
    // Owner 2026-11-24: the department head's approval passes it to the HR Head (then the Director, as before).
    const next = levelAfterHod(config, row.raised_by, by.id);
    await update({ current_level: next.level, current_approver_id: next.approverId, level_entered_at: now }, `pass the request to the ${APPROVAL_LEVEL_LABELS[next.level]}`);
    await record(client, orgId, row.id as string, by, { level: "hod", action: "approved", reason, via });
    const requisition = await done();
    await emit(deps, { kind: "awaiting", requisition, approverId: next.approverId, level: next.level });
    return requisition;
  }
  if (acting === "hr_head") {
    if (parsed.data.inPlan === undefined) throw new CandidateActionError(400, "Tick whether the role is in the approved plan before approving.");
    const inPlan = parsed.data.inPlan;
    const needsDirector = !inPlan || aboveCtcLevel(config, num(row.budget_max_ctc));
    if (needsDirector) {
      const director = approversAt(config, "director").find((uid) => uid !== row.raised_by) ?? null;
      if (!director) throw new CandidateActionError(409, "This request needs the Director's approval, and no Director is set in the Tech dashboard → HR Configs.");
      await update({ in_plan: inPlan, needs_director: true, current_level: "director", current_approver_id: director, level_entered_at: now }, "pass the request to the Director");
      await record(client, orgId, row.id as string, by, { level: acting, action: "approved", inPlan, reason: noted(reason ?? (inPlan ? "Above the CTC level: the Director approves" : "Out of plan: the Director approves")), via });
      const requisition = await done();
      await emit(deps, { kind: "awaiting", requisition, approverId: director, level: "director" });
      return requisition;
    }
    return approveFinal(client, orgId, by, row, config, reason, now, deps, level, { inPlan, via, recordAs: "hr_head", note: noted(reason) });
  }
  return approveFinal(client, orgId, by, row, config, reason, now, deps, level, { via, recordAs: acting, note: reason });
}

/**
 * Owner 2026-11-24: a request has waited HOD_DECISION_HOURS at its department head; it passes to the HR Head on its own
 * (the reminders job). Recorded in the history as "escalated". Nothing happens if it moved on in the meantime.
 */
export async function passFromDepartmentHead(client: SupabaseClient, orgId: string, id: string, deps: RequisitionDeps = {}): Promise<Requisition | null> {
  const row = await loadRow(client, orgId, id);
  if (row.status !== "submitted" || row.current_level !== "hod") return null;
  const config = await loadRecruitmentConfig(client, orgId);
  const next = levelAfterHod(config, row.raised_by, (row.current_approver_id as string | null) ?? null);
  const now = (deps.now ?? (() => new Date()))().toISOString();
  try {
    await guardedUpdate(client, orgId, row, "hod", { current_level: next.level, current_approver_id: next.approverId, level_entered_at: now, updated_at: now }, "pass the request on");
  } catch (error) {
    if (error instanceof CandidateActionError && error.status === 409) return null;
    throw error;
  }
  await record(client, orgId, row.id as string, null, { level: "hod", action: "escalated", reason: `The department head did not decide within ${HOD_DECISION_HOURS} hours, so it passed to the ${APPROVAL_LEVEL_LABELS[next.level]}.` });
  const { requisition } = await getRequisition(client, orgId, row.id as string);
  await emit(deps, { kind: "awaiting", requisition, approverId: next.approverId, level: next.level });
  return requisition;
}

/** Stage 2's exit, approved: the role becomes active. A position is opened from the request. */
async function approveFinal(client: SupabaseClient, orgId: string, by: Actor, row: Record<string, unknown>, config: RecruitmentConfig, reason: string | null, now: string, deps: RequisitionDeps, level: RequisitionLevel, step: { inPlan?: boolean; via: "app" | "link"; recordAs: RequisitionLevel; note: string | null }): Promise<Requisition> {
  const id = row.id as string;
  // Guarded on the level it waits at: only the first of two approvers clicking at once gets here; the other is told it was already decided.
  await guardedUpdate(client, orgId, row, level, {
    status: "approved", current_level: null, current_approver_id: null, decided_at: now, decision_reason: reason, updated_at: now,
    ...(step.inPlan !== undefined ? { in_plan: step.inPlan, needs_director: false } : {}),
  }, "approve the request");
  await record(client, orgId, id, by, { level: step.recordAs, action: "approved", ...(step.inPlan !== undefined ? { inPlan: step.inPlan } : {}), reason: step.note, via: step.via });

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
      // Spec A03: nobody recruits for it until HR assigns someone (the approver is not the recruiter).
      recruiterId: null,
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
  await emit(deps, { kind: "decided", requisition, decision: "approved", reason, byName: by.name, byId: by.id });
  // Spec A03: "notify the recruiter … open the role": HR is told to assign a recruiter.
  if (positionId) await emit(deps, { kind: "role_opened", requisition });
  // Stage 2: in plan, the HR Head approves and the Director is notified.
  if (step.recordAs === "hr_head") {
    const director = approversAt(config, "director")[0] ?? null;
    if (director && director !== by.id) await emit(deps, { kind: "director_informed", requisition, directorId: director });
  }
  return requisition;
}

// Department heads and the on-hold chaser (owner 2026-11-21) -------------------------------------------------------------

/** Can this person endorse it now: they head its department, it waits on the approvers, they did not raise it or endorse it already. */
export function canEndorse(requisition: Requisition, userId: string, access: RequisitionAccess, alreadyEndorsed: boolean): boolean {
  // Owner 2026-11-24: while it waits on the head at their own level, the head approves rather than endorses.
  return (requisition.status === "submitted" || requisition.status === "on_hold") && requisition.raisedBy !== userId && !alreadyEndorsed
    && requisition.currentLevel !== "hod" && Boolean(access.headOf?.includes(deptKey(requisition.department)));
}

/**
 * A department head endorses a request raised for their department, with an optional note. It is recorded in the
 * history and shown to the approvers; it approves nothing and does not change who decides.
 */
export async function endorseRequisition(client: SupabaseClient, orgId: string, by: Actor, id: string, noteInput: unknown): Promise<Requisition> {
  const row = await loadRow(client, orgId, id);
  const config = await loadRecruitmentConfig(client, orgId);
  if (!departmentsHeadedBy(config, by.id).includes(deptKey(row.department as string | null))) throw new CandidateActionError(403, "Only the head of this request's department can endorse it.");
  if (row.raised_by === by.id) throw new CandidateActionError(403, "You raised this request, so it cannot be endorsed by you.");
  if (row.status !== "submitted" && row.status !== "on_hold") throw new CandidateActionError(409, "Only a request waiting on the approvers can be endorsed.");
  if (await hasEndorsed(client, orgId, row.id as string, by.id)) throw new CandidateActionError(409, "You have already endorsed this request.");
  const note = typeof noteInput === "string" ? noteInput.trim().slice(0, 1000) || null : null;
  await record(client, orgId, row.id as string, by, { action: "endorsed", reason: note });
  return (await getRequisition(client, orgId, row.id as string)).requisition;
}

/** Has this person endorsed the request (for the drawer's button). */
export async function hasEndorsed(client: SupabaseClient, orgId: string, requisitionId: string, userId: string): Promise<boolean> {
  // Owner 2026-11-24: a head who already approved it at their level has nothing left to endorse.
  const { data } = await client.from(APPROVALS).select("id, action, level").eq("organization_id", orgId).eq("requisition_id", requisitionId).eq("by_user", userId).in("action", ["endorsed", "approved"]);
  return ((data ?? []) as { action: string; level: string | null }[]).some((a) => a.action === "endorsed" || a.level === "hod");
}

/** Spec A24: the person who raised a request on hold confirms the role is still needed; the approver it waits on is told. */
export async function confirmStillNeeded(client: SupabaseClient, orgId: string, by: Actor, id: string, noteInput: unknown, deps: RequisitionDeps = {}): Promise<Requisition> {
  const row = await loadRow(client, orgId, id);
  if (row.raised_by !== by.id) throw new CandidateActionError(403, "Only the person who raised the request can confirm it is still needed.");
  if (row.status !== "on_hold") throw new CandidateActionError(409, "This request is not on hold.");
  const note = typeof noteInput === "string" ? noteInput.trim().slice(0, 1000) || null : null;
  await record(client, orgId, row.id as string, by, { action: "still_needed", level: (row.current_level as ApprovalLevel | null) ?? null, reason: note });
  const requisition = (await getRequisition(client, orgId, row.id as string)).requisition;
  await emit(deps, { kind: "still_needed", requisition, approverId: requisition.currentApproverId, note });
  return requisition;
}

/** For the hourly job: requests on hold, with the days on hold and when (if) the raiser last confirmed it is still needed. */
export async function heldRequisitions(client: SupabaseClient, orgId: string, now = new Date()): Promise<{ requisition: Requisition; daysOnHold: number; confirmedAt: string | null }[]> {
  const { data, error } = await client.from(TABLE).select(COLUMNS).eq("organization_id", orgId).eq("status", "on_hold").is("deleted_at", null);
  if (error) {
    if (missingRelation(error)) return [];
    fail("load the requests on hold", error);
  }
  const rows = (data ?? []) as unknown as Record<string, unknown>[];
  if (!rows.length) return [];
  const names = await namesOf(client, rows.map((r) => r.current_approver_id as string).filter(Boolean));
  const { data: confirms } = await client.from(APPROVALS).select("requisition_id, created_at").eq("organization_id", orgId).eq("action", "still_needed").in("requisition_id", rows.map((r) => r.id as string));
  return rows.map((r) => {
    const requisition = toRequisition(r, names, now);
    const since = requisition.holdSince ?? requisition.updatedAt;
    const confirmedAt = ((confirms ?? []) as { requisition_id: string; created_at: unknown }[])
      .filter((c) => c.requisition_id === requisition.id && new Date(iso(c.created_at)).getTime() >= new Date(since).getTime()).map((c) => iso(c.created_at)).sort().pop() ?? null;
    return { requisition, daysOnHold: daysBetween(since, null, now), confirmedAt };
  });
}

/** Spec A03's escalation: approved requests whose position still has no recruiter, approved at least `hours` ago (within 30 days). */
export async function unassignedRoles(client: SupabaseClient, orgId: string, now = new Date(), hours = 48): Promise<Requisition[]> {
  const from = new Date(now.getTime() - 30 * 86_400_000).toISOString();
  const to = new Date(now.getTime() - hours * 3_600_000).toISOString();
  const { data, error } = await client.from(TABLE).select(COLUMNS).eq("organization_id", orgId).eq("status", "approved").is("deleted_at", null).not("position_id", "is", null).gte("decided_at", from).lte("decided_at", to);
  if (error) {
    if (missingRelation(error)) return [];
    fail("load the approved requests", error);
  }
  const rows = (data ?? []) as unknown as Record<string, unknown>[];
  if (!rows.length) return [];
  const { data: positions } = await client.from("candidate_positions").select("id, recruiter_id, status").eq("organization_id", orgId).in("id", rows.map((r) => r.position_id as string)).is("deleted_at", null);
  const open = new Set(((positions ?? []) as { id: string; recruiter_id: string | null; status: string }[]).filter((p) => !p.recruiter_id && p.status === "open").map((p) => p.id));
  return rows.filter((r) => open.has(r.position_id as string)).map((r) => toRequisition(r, new Map(), now));
}

/** Who may decide now: it waits at a level this person approves at, and they did not raise it. */
export function canDecide(requisition: Requisition, userId: string, access: RequisitionAccess, now = new Date()): boolean {
  if (!(requisition.status === "submitted" || requisition.status === "on_hold") || requisition.currentLevel === null || requisition.raisedBy === userId) return false;
  // Owner 2026-11-24: at the department head's level, the head it waits on; after 48 h, the HR Head too.
  if (requisition.currentLevel === "hod") {
    return requisition.currentApproverId === userId || (access.approverLevels.includes("hr_head") && hoursAtLevel(requisition.levelEnteredAt, now) >= HOD_DECISION_HOURS);
  }
  return access.approverLevels.includes(requisition.currentLevel);
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

/**
 * Every organisation the hourly job has work in: a request waiting or on hold, or one approved in the last 30 days (its
 * role may still have no recruiter).
 */
export async function organisationsWithWaiting(client: SupabaseClient, now = new Date()): Promise<string[]> {
  const since = new Date(now.getTime() - 30 * 86_400_000).toISOString();
  const [waiting, approved] = await Promise.all([
    client.from(TABLE).select("organization_id").in("status", ["submitted", "on_hold"]).is("deleted_at", null).limit(2000),
    client.from(TABLE).select("organization_id").eq("status", "approved").gte("decided_at", since).is("deleted_at", null).limit(2000),
  ]);
  const rows = [...((waiting.error ? [] : waiting.data) ?? []), ...((approved.error ? [] : approved.data) ?? [])] as { organization_id: string }[];
  return [...new Set(rows.map((r) => r.organization_id))];
}
