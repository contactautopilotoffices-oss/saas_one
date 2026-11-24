import type { SupabaseClient } from "@supabase/supabase-js";

import { activeRoles, approverPools, hierarchyFromEmployees, resolveHierarchy, type PickablePerson } from "@/backend/lib/candidates/requisitions";
import type { RecruitmentConfig, RequisitionHierarchy } from "@/backend/lib/candidates/types";

/** Owner 2026-11-24: the employee master's departments and designations (the active employee profiles of the organisation). */
export async function employeeMasterHierarchy(client: SupabaseClient, orgId: string): Promise<RecruitmentConfig["hierarchy"]> {
  const { data, error } = await client.from("employee_profiles").select("department, designation")
    .eq("is_active", true).or(`organization_id.eq.${orgId},organization_id.is.null`).limit(10_000);
  if (error) throw error;
  return hierarchyFromEmployees((data ?? []) as { department: string | null; designation: string | null }[]);
}

/** The request form's dropdowns: HR's list from HR Configs when set, else the employee master (never fails: empty on error). */
export async function formHierarchy(client: SupabaseClient, orgId: string, config: RecruitmentConfig): Promise<RequisitionHierarchy> {
  if (config.hierarchy.length) return resolveHierarchy(config, []);
  try {
    return resolveHierarchy(config, await employeeMasterHierarchy(client, orgId));
  } catch (error) {
    console.error("[recruitment] employee master hierarchy failed", error);
    return { departments: [], source: "employee_master" };
  }
}

/**
 * Owner 2026-11-20: "You need to have the same data like the one in the task manager" — the people to pick from are the
 * Task Manager's list (active employee profiles: the same names and departments), not only the organisation's members.
 */
export async function taskManagerPeople(): Promise<{ id: string; name: string; department: string | null }[]> {
  const { TaskDatabaseService } = await import("@/task-manager/TaskDatabaseService");
  const all = await TaskDatabaseService.getAllEmployees();
  return all.filter((e) => e.active && e.id).map((e) => ({ id: e.id, name: e.name, department: e.department_name ?? null }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** The HR Head and Director pools (approverPools), from the Task Manager's people and the organisation's roles. */
export async function loadApproverPools(client: SupabaseClient, orgId: string): Promise<{ hr: PickablePerson[]; directors: PickablePerson[] }> {
  const [people, { roles, names }] = await Promise.all([taskManagerPeople(), activeRoles(client, orgId)]);
  return approverPools(people, roles, names);
}
