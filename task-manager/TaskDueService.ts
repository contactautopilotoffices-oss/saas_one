import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { TaskDatabaseService } from './TaskDatabaseService';
import { TaskAccessService } from './TaskAccessService';
import { isMissingSchema } from './TaskLinks';
import { taskBell } from './taskBell';
import { personLabel, sendTaskDueSoon } from './taskAlerts';
import { TaskDue, addDueDays, dueInstant, dueLabel, istDateOf, reminderAt, shortTime, spanLabel } from './dueDates';

/**
 * Owner 2026-10-27: due dates on the server — saving a deadline, the open tasks still within their deadline, and the one
 * "due soon" reminder. Columns from 20261027100001_task_manager_due_dates.sql; until it is applied, reads return nothing,
 * writes are skipped (logged once) and the reminder job does nothing.
 */

let warned = false;
function warnOnce() {
    if (warned) return;
    warned = true;
    console.warn('[TaskDueService] Due dates are not in the database yet (run 20261027100001_task_manager_due_dates.sql). Skipping them for now.');
}

/** Sets (or clears, with null) the deadline of new tasks. Returns false when the columns are not in the database yet. */
export async function setTaskDue(taskIds: string[], due: TaskDue | null): Promise<boolean> {
    if (taskIds.length === 0) return true;
    const { error } = await supabaseAdmin.from('task_assignments')
        .update({ due_date: due?.date ?? null, due_time: due?.time ?? null, due_reminded_at: null }).in('id', taskIds);
    if (!error) return true;
    if (isMissingSchema(error)) { warnOnce(); return false; }
    console.error('[TaskDueService] could not save the due date:', error);
    return false;
}

/**
 * Open tasks that started before `date` and are still within their deadline (a task that takes several days). They are on
 * the board as "Day 3 of 5", never as "carried forward", whatever the department's carry-forward setting is.
 */
export async function openWithinDue(employeeIds: string[], date: string, select: string): Promise<Array<Record<string, unknown>>> {
    if (employeeIds.length === 0) return [];
    const { data, error } = await supabaseAdmin.from('task_assignments').select(select).in('employee_id', employeeIds)
        .lt('assigned_date', date).gte('due_date', date).neq('status', 'completed').limit(1000);
    if (error) {
        if (isMissingSchema(error)) { warnOnce(); return []; }
        throw error;
    }
    return (data || []) as unknown as Array<Record<string, unknown>>;
}

const MAX_PER_RUN = 50;
/** Stop starting new reminders after this long, so the rest of the 15-minute job always runs. The rest go next time. */
const TIME_BUDGET_MS = 20_000;

/**
 * Sends the one "due soon" reminder (bell + WhatsApp template) for open tasks whose reminder time has come:
 * 2 hours before a set time, or 5 pm the day before a date-only deadline. Only for people whose department has the
 * Due dates switch ON and who are unlocked. Each task is claimed (due_reminded_at) before anything is sent, so two
 * runs at once cannot both remind. A deadline already passed gets no reminder. Never throws.
 */
export async function runDueReminders(now = Date.now()): Promise<{ sent: number; skipped: number }> {
    const result = { sent: 0, skipped: 0 };
    try {
        const on = await TaskAccessService.getDueDatesDepartments();
        if (on.columnMissing || on.departments.size === 0) return result;

        // Only people in departments with the switch ON: tasks of other teams can never fill the batch
        const people = (await TaskDatabaseService.getAllEmployees()).filter(e => e.active && !!e.department_id && on.departments.has(e.department_id));
        if (people.length === 0) return result;
        const today = istDateOf(now);
        const rows: Array<Record<string, unknown>> = [];
        for (let i = 0; i < people.length && rows.length < MAX_PER_RUN; i += 150) {
            const { data, error } = await supabaseAdmin.from('task_assignments')
                .select('id, title, employee_id, assigned_by, due_date, due_time, status')
                .in('employee_id', people.slice(i, i + 150).map(e => e.id))
                .gte('due_date', today).lte('due_date', addDueDays(today, 1))
                .is('due_reminded_at', null).neq('status', 'completed')
                .order('due_date', { ascending: true }).limit(MAX_PER_RUN - rows.length);
            if (error) {
                if (isMissingSchema(error)) warnOnce();
                else console.error('[TaskDueService] could not read due tasks:', error);
                return result;
            }
            rows.push(...((data || []) as Array<Record<string, unknown>>));
        }

        const started = Date.now();
        for (const row of rows) {
            if (Date.now() - started > TIME_BUDGET_MS) break;
            const due: TaskDue = { date: row.due_date as string, time: shortTime(row.due_time as string | null) };
            if (now < reminderAt(due) || now >= dueInstant(due)) continue;

            const holder = await TaskDatabaseService.getEmployeeById(row.employee_id as string);
            if (!holder || !holder.active || !holder.department_id || !on.departments.has(holder.department_id)) { result.skipped++; continue; }
            if (!(await TaskAccessService.check({ userId: holder.id, departmentId: holder.department_id })).allowed) { result.skipped++; continue; }

            const { data: claimed, error: claimError } = await supabaseAdmin.from('task_assignments')
                .update({ due_reminded_at: new Date(now).toISOString() })
                .eq('id', row.id).is('due_reminded_at', null).neq('status', 'completed').select('id').maybeSingle();
            if (claimError || !claimed) { result.skipped++; continue; }

            const giver = row.assigned_by && row.assigned_by !== holder.id ? await TaskDatabaseService.getEmployeeById(row.assigned_by as string) : null;
            const left = spanLabel(dueInstant(due) - now);
            const dueText = due.time ? `${dueLabel(due)} (in ${left})` : `${dueLabel(due)} (end of day)`;
            void taskBell({ userId: holder.id, kind: 'TASK_REMINDER', title: 'Task due soon', message: `"${row.title}" is due ${dueText}.`, departmentName: holder.department_name });
            await sendTaskDueSoon(holder.phone_number, {
                recipientName: holder.name, title: row.title as string, dueText,
                fromLabel: giver ? personLabel(giver.name, giver.department_name) : 'You', departmentId: holder.department_id,
            });
            await TaskDatabaseService.logAudit({
                eventType: 'task_due_reminder_sent', targetEmployeeId: holder.id, taskId: row.id as string,
                details: { title: row.title, dueDate: due.date, dueTime: due.time, via: 'cron' },
            });
            result.sent++;
        }
    } catch (err) {
        console.error('[TaskDueService] reminder run failed:', err);
    }
    return result;
}
