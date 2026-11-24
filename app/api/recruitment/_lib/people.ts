import type { SupabaseClient } from "@supabase/supabase-js";

import { activeRoles, approverPools, type PickablePerson } from "@/backend/lib/candidates/requisitions";

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
