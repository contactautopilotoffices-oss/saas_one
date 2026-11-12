import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { TaskDatabaseService } from './TaskDatabaseService';
import { sendTaskCompleted } from './taskAlerts';

/**
 * "A task you assigned has been completed" (approved template task_completed_notice_v1) — owner decision 2026-10-12:
 * sent for EVERY completion of a task someone else gave you, from every place a task can be marked done (Tasks tab,
 * WhatsApp AI / "done 2", the old keyword bot, the older dashboard API).
 *
 *   • Not for your own tasks (nobody else gave them) and not to inactive people or people without a phone.
 *   • Several tasks finished together for the same giver → ONE message listing them.
 *   • Told at most once an hour per task (dragging a card out of Done and back must not repeat it).
 *   • Never throws: a failed notice must never undo or fail the status change.
 */

export interface CompletedTaskRow { id: string; title: string; employee_id: string; assigned_by: string | null }

export interface CompletionIO {
    recentlyNotified(taskIds: string[], since: string): Promise<Set<string>>;
    person(id: string): Promise<{ id: string; name: string; phone_number: string; department_name: string | null; department_id: string | null; active: boolean } | null>;
    audit(row: CompletedTaskRow, giverId: string): Promise<void>;
    send(phone: string, input: Parameters<typeof sendTaskCompleted>[1]): Promise<boolean>;
    /** Owner 2026-10-20: the dashboard bell (+ push) for the giver. Optional (tests can leave it out). */
    bell?(giverId: string, giverDepartment: string | null, titles: string[], completedByName: string): Promise<void>;
}

export async function notifyGiversOfCompletion(rows: CompletedTaskRow[], io: CompletionIO = defaultCompletionIO(), at = new Date()): Promise<number> {
    try {
        const given = rows.filter(r => r && r.assigned_by && r.assigned_by !== r.employee_id);
        if (!given.length) return 0;
        const already = await io.recentlyNotified(given.map(r => r.id), new Date(at.getTime() - 60 * 60_000).toISOString());
        const fresh = given.filter(r => !already.has(r.id));

        // One message per (giver, holder): "Completed By" names one person.
        const groups = new Map<string, CompletedTaskRow[]>();
        for (const r of fresh) { const k = `${r.assigned_by}|${r.employee_id}`; groups.set(k, [...(groups.get(k) || []), r]); }

        let sent = 0;
        for (const list of groups.values()) {
            const [giver, holder] = await Promise.all([io.person(list[0].assigned_by!), io.person(list[0].employee_id)]);
            if (!giver || !giver.active || !holder || !giver.phone_number || giver.phone_number.trim().length < 10) continue;
            for (const r of list) await io.audit(r, giver.id);
            if (io.bell) await io.bell(giver.id, giver.department_name, list.map(r => r.title), holder.name);
            const ok = await io.send(giver.phone_number, {
                giverName: giver.name, titles: list.map(r => r.title), completedByName: holder.name,
                department: holder.department_name, at, departmentId: giver.department_id || undefined,
            });
            if (ok) sent++;
        }
        return sent;
    } catch (err) {
        console.error('[completionNotice] skipped:', err instanceof Error ? err.message : err);
        return 0;
    }
}

export function defaultCompletionIO(): CompletionIO {
    return {
        async recentlyNotified(taskIds, since) {
            const { data } = await supabaseAdmin.from('task_audit_logs').select('task_id')
                .eq('event_type', 'task_completion_notified').in('task_id', taskIds).gte('created_at', since);
            return new Set((data || []).map(r => r.task_id as string));
        },
        async person(id) {
            const e = await TaskDatabaseService.getEmployeeById(id);
            return e ? { id: e.id, name: e.name, phone_number: e.phone_number, department_name: e.department_name ?? null, department_id: e.department_id ?? null, active: e.active } : null;
        },
        async audit(row, giverId) {
            await TaskDatabaseService.logAudit({ eventType: 'task_completion_notified', actorId: row.employee_id, targetEmployeeId: giverId, taskId: row.id, details: { title: row.title } });
        },
        send: (phone, input) => sendTaskCompleted(phone, input),
        async bell(giverId, giverDepartment, titles, completedByName) {
            const { shortList, taskBell } = await import('./taskBell');
            void taskBell({ userId: giverId, kind: 'TASK_COMPLETED', title: `${completedByName} finished ${titles.length === 1 ? 'a task' : `${titles.length} tasks`}`, message: `${completedByName} finished: ${shortList(titles)}`, departmentName: giverDepartment });
        },
    };
}
