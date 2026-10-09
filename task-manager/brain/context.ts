import type { Employee } from '../types';
import type { BrainContext, BrainPerson, PendingState } from './types';

/**
 * The language brain — builds what the brain is allowed to know about the sender, from REAL data (read-only).
 * Shared by shadow mode and live smart chat so both see the world the same way.
 *
 * People are matched with the same rule assigning uses (PermissionService.visibleAndAssignable); the brain only ever gets
 * NAMES — never ids or phone numbers — and the ids it proposes are re-checked against this very list.
 */
export async function buildBrainContext(emp: Employee, phone: string, opts: { pending: PendingState | null; recent?: string[] }): Promise<BrainContext> {
    const { TaskDatabaseService } = await import('../TaskDatabaseService');
    const { PermissionService } = await import('../PermissionService');
    const { todayInIndia } = await import('../TaskImportParser');

    const person = (e: Employee): BrainPerson => ({ id: e.id, name: e.name, department: e.department_name, role: e.role });
    const pool = await TaskDatabaseService.getAllEmployees();
    const permitted = await PermissionService.visibleAndAssignable(emp, pool);
    const isSuper = emp.role === 'superuser';

    const people = new Map<string, BrainPerson>();
    for (const e of isSuper ? pool : [emp, ...permitted, ...pool.filter(x => x.role === 'superuser')]) people.set(e.id, person(e));

    const today = todayInIndia();
    const rows = await TaskDatabaseService.getDailyAssignments({ employeeId: emp.id, date: today });
    return {
        today,
        sender: person(emp),
        people: [...people.values()],
        assignableIds: (isSuper ? pool : permitted).map(e => e.id).filter(id => id !== emp.id),
        tasks: rows.map((t, i) => ({ n: i + 1, id: t.id, title: t.title, status: t.status })),
        departments: (await TaskDatabaseService.getDepartments()).map(d => d.name),
        pending: opts.pending,
        recent: opts.recent ?? [],
    };
}
