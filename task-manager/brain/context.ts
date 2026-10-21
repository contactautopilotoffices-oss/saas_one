import type { Employee } from '../types';
import type { BrainContext, BrainPerson, PendingState } from './types';

/**
 * The language brain — builds what the brain is allowed to know about the sender, from REAL data (read-only).
 * Shared by shadow mode and live smart chat so both see the world the same way.
 *
 * People are matched with the same rule assigning uses (PermissionService.visibleAndAssignable); the brain only ever gets
 * NAMES — never ids or phone numbers — and the ids it proposes are re-checked against this very list.
 */
export async function buildBrainContext(emp: Employee, phone: string, opts: { pending: PendingState | null; recent?: string[]; conversation?: string[] }): Promise<BrainContext> {
    const { TaskDatabaseService } = await import('../TaskDatabaseService');
    const { PermissionService } = await import('../PermissionService');
    const { todayInIndia } = await import('../TaskImportParser');
    const { WorkspaceService } = await import('../WorkspaceService');

    const person = (e: Employee): BrainPerson => ({ id: e.id, name: e.name, department: e.department_name, role: e.role });
    const today = todayInIndia();
    // Group 2 "faster replies" (2026-10-13): the three reads do not depend on each other → side by side (were one by one).
    // Older open tasks first, then today's: the same numbers as the person's morning / overdue messages.
    // Owner 2026-10-20: plus the open tasks this person GAVE others (for "add note to …"); a failed read only means none.
    const [pool, rows, departments, given] = await Promise.all([
        TaskDatabaseService.getAllEmployees(),
        TaskDatabaseService.getNumberedList({ employeeId: emp.id, date: today, departmentId: emp.department_id ?? null }),
        TaskDatabaseService.getDepartments(),
        WorkspaceService.openTasksGivenBy(emp.id).catch(() => []),
    ]);
    // Owner 2026-10-19: the people this person may GIVE work to (wider than who they may see when "assign to anyone in
    // team" is ON). Reading anyone's tasks is re-checked separately (readPerson / readTeam / findTasks), so this never
    // widens what they can see.
    const permitted = await PermissionService.assignableTo(emp, pool);
    const isSuper = emp.role === 'superuser';

    const people = new Map<string, BrainPerson>();
    for (const e of isSuper ? pool : [emp, ...permitted, ...pool.filter(x => x.role === 'superuser')]) people.set(e.id, person(e));

    return {
        today,
        sender: person(emp),
        people: [...people.values()],
        assignableIds: (isSuper ? pool : permitted).map(e => e.id).filter(id => id !== emp.id),
        tasks: rows.map(t => ({ n: t.listNumber, id: t.id, title: t.title, status: t.status, ...(t.isCarriedForward ? { from: t.assigned_date } : {}),
            // Owner 2026-10-20: lock state, the same rule as the Tasks tab (own active fixed template = locked; no owner = team fixed).
            ...(t.template && t.template.owner_id === emp.id && t.template.is_active ? { locked: true } : {}),
            ...(t.template && !t.template.owner_id && t.template.task_type === 'fixed' ? { teamFixed: true } : {}) })),
        departments: departments.map(d => d.name),
        noteTargets: given.map(t => ({ id: t.id, title: t.title, ownerId: t.employee_id, ownerName: pool.find(e => e.id === t.employee_id)?.name ?? 'Unknown', date: t.assigned_date })),
        pending: opts.pending,
        recent: opts.recent ?? [],
        ...(opts.conversation?.length ? { conversation: opts.conversation } : {}),
    };
}
