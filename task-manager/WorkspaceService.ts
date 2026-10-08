import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { TaskDatabaseService } from './TaskDatabaseService';
import { TaskAccessService } from './TaskAccessService';
import { PermissionService } from './PermissionService';
import { HierarchyService } from './HierarchyService';
import { TaskMessagingService } from './TaskMessagingService';
import { Employee, TaskAssignment, TaskStatus } from './types';

/**
 * Step 5 — backend for the Procurement "Tasks" tab (board + team + assign).
 *
 * The acting person is ALWAYS passed in by the route from the login session. Nothing here trusts an id
 * sent by the browser. Every permission goes through PermissionService, the same rules WhatsApp uses.
 */

export class WorkspaceError extends Error {
    constructor(public readonly status: number, message: string, public readonly code?: string) {
        super(message);
        this.name = 'WorkspaceError';
    }
}

export interface WorkspaceTask {
    id: string;
    title: string;
    description: string | null;
    ownerId: string;
    ownerName: string;
    status: TaskStatus;
    assignedDate: string;
    isCarriedForward: boolean;
    canChange: boolean;
}

export interface WorkspaceMember {
    userId: string;
    name: string;
    isMe: boolean;
    openCount: number;
    completedCount: number;
}

export type WorkspaceResponse =
    | { state: 'no_profile'; message: string }
    | { state: 'locked'; reason: string; message: string }
    | {
        state: 'ok';
        actor: { userId: string; name: string; role: string; departmentName: string | null };
        teamSharing: boolean;
        date: string;
        members: WorkspaceMember[];
        tasks: WorkspaceTask[];
        assignable: Array<{ userId: string; name: string; isMe: boolean }>;
    };

const CARRY_DAYS = 14;

export function todayIST(): string {
    const ist = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
    return `${ist.getFullYear()}-${String(ist.getMonth() + 1).padStart(2, '0')}-${String(ist.getDate()).padStart(2, '0')}`;
}

const isDate = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

function addDays(date: string, days: number): string {
    const d = new Date(`${date}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
}

export class WorkspaceService {
    private static async requireUnlockedActor(actorUserId: string): Promise<Employee> {
        const actor = await TaskDatabaseService.getEmployeeById(actorUserId);
        if (!actor || !actor.active) {
            throw new WorkspaceError(403, 'Your account is not linked to an active employee profile.', 'NO_PROFILE');
        }
        const access = await TaskAccessService.check({ userId: actor.id, departmentId: actor.department_id });
        if (!access.allowed) throw new WorkspaceError(403, access.message, 'LOCKED');
        return actor;
    }

    static async load(actorUserId: string, options: { date?: string; departmentName?: string } = {}): Promise<WorkspaceResponse> {
        const date = isDate(options.date) ? options.date : todayIST();

        const actor = await TaskDatabaseService.getEmployeeById(actorUserId);
        if (!actor || !actor.active) {
            return { state: 'no_profile', message: 'Your account is not linked to an active employee profile, so the Task Manager is not available to you.' };
        }

        const snapshot = await TaskAccessService.getSnapshot();
        const access = TaskAccessService.decide(snapshot, { userId: actor.id, departmentId: actor.department_id });
        if (!access.allowed) return { state: 'locked', reason: access.reason, message: access.message };

        const pool = await TaskDatabaseService.getAllEmployees();

        // Who is on the board: a superuser sees a whole department (the tab's own department when given);
        // everyone else sees only the people the shared permission rule allows.
        let members: Employee[];
        if (actor.role === 'superuser') {
            let deptId = actor.department_id;
            if (options.departmentName) {
                const dept = await TaskDatabaseService.getDepartmentByName(options.departmentName);
                if (dept) deptId = dept.id;
            }
            members = pool.filter(e => e.department_id === deptId);
        } else {
            members = await PermissionService.visibleAndAssignable(actor, pool);
        }

        const ids = members.map(m => m.id);
        const byId = new Map(members.map(m => [m.id, m]));

        let rows: any[] = [];
        if (ids.length > 0) {
            const select = 'id, title, description, employee_id, assigned_date, status, created_at';
            const [today, carried] = await Promise.all([
                supabaseAdmin.from('task_assignments').select(select).in('employee_id', ids).eq('assigned_date', date),
                supabaseAdmin.from('task_assignments').select(select).in('employee_id', ids)
                    .lt('assigned_date', date).gte('assigned_date', addDays(date, -CARRY_DAYS)).neq('status', 'completed'),
            ]);
            if (today.error) throw today.error;
            if (carried.error) throw carried.error;
            rows = [...(today.data || []), ...(carried.data || [])];
        }

        const { hierarchy } = await HierarchyService.load();
        const below = new Set(hierarchy.allReports(actor.id).map(p => p.userId));
        const canChange = (ownerId: string) => actor.role === 'superuser' || ownerId === actor.id || below.has(ownerId);

        const tasks: WorkspaceTask[] = rows
            .map(r => ({
                id: r.id as string,
                title: r.title as string,
                description: (r.description as string) || null,
                ownerId: r.employee_id as string,
                ownerName: byId.get(r.employee_id)?.name || 'Unknown',
                status: r.status as TaskStatus,
                assignedDate: r.assigned_date as string,
                isCarriedForward: (r.assigned_date as string) < date,
                canChange: canChange(r.employee_id),
                _created: r.created_at as string,
            }))
            .sort((a, b) => (a.isCarriedForward === b.isCarriedForward ? a._created.localeCompare(b._created) : a.isCarriedForward ? -1 : 1))
            .map(({ _created, ...t }) => t);

        const memberViews: WorkspaceMember[] = members
            .map(m => {
                const mine = tasks.filter(t => t.ownerId === m.id);
                return {
                    userId: m.id,
                    name: m.name,
                    isMe: m.id === actor.id,
                    openCount: mine.filter(t => t.status !== 'completed').length,
                    completedCount: mine.filter(t => t.status === 'completed').length,
                };
            })
            .sort((a, b) => (a.isMe === b.isMe ? a.name.localeCompare(b.name) : a.isMe ? -1 : 1));

        // Who can receive a task from this person: allowed by the shared rule AND unlocked
        const candidates = actor.role === 'superuser' ? members : pool;
        const permitted = await PermissionService.visibleAndAssignable(actor, candidates);
        const unlocked = (await TaskAccessService.partition(permitted, snapshot)).allowed;
        const assignable = unlocked
            .map(e => ({ userId: e.id, name: e.name, isMe: e.id === actor.id }))
            .sort((a, b) => (a.isMe === b.isMe ? a.name.localeCompare(b.name) : a.isMe ? -1 : 1));

        return {
            state: 'ok',
            actor: { userId: actor.id, name: actor.name, role: actor.role, departmentName: actor.department_name },
            teamSharing: await TaskAccessService.isPeerAssignEnabled(actor.department_id),
            date,
            members: memberViews,
            tasks,
            assignable,
        };
    }

    static async assign(actorUserId: string, input: { targetUserId?: string; title?: string; description?: string; date?: string }): Promise<TaskAssignment> {
        const title = (input.title || '').trim();
        if (title.length < 1 || title.length > 200) throw new WorkspaceError(400, 'Task title must be 1 to 200 characters.');
        const description = (input.description || '').trim();
        if (description.length > 1000) throw new WorkspaceError(400, 'Details can be at most 1000 characters.');
        if (!input.targetUserId) throw new WorkspaceError(400, 'Choose who the task is for.');
        const date = isDate(input.date) ? input.date : todayIST();

        const actor = await this.requireUnlockedActor(actorUserId);

        // Throws PermissionDeniedError when this person may not assign to that person
        const { target } = await PermissionService.assertCanAssignTask(actor.id, input.targetUserId);

        const targetAccess = await TaskAccessService.check({ userId: target.id, departmentId: target.department_id });
        if (!targetAccess.allowed) {
            throw new WorkspaceError(409, `Cannot assign a task to ${target.name}: ${targetAccess.message}`, 'TARGET_LOCKED');
        }

        const task = await TaskDatabaseService.createTaskAssignment({
            employeeId: target.id,
            title,
            description: description || undefined,
            assignedDate: date,
            assignedBy: actor.id,
        });

        await TaskDatabaseService.logAudit({
            eventType: 'task_assigned',
            actorId: actor.id,
            targetEmployeeId: target.id,
            taskId: task.id,
            details: { title: task.title, assignedDate: task.assigned_date, via: 'web_tasks_tab' },
        });

        // Tell the assignee (never for your own list). Goes through the safety gate, so nothing is sent in Pretend Mode.
        if (target.id !== actor.id && target.phone_number && target.phone_number.trim().length >= 10) {
            const lines = [`🔔 *New Task Assigned!*`, ``, `*Task:* ${task.title}`];
            if (task.description) lines.push(`*Details:* ${task.description}`);
            lines.push(`*Assigned By:* ${actor.name}`, `*Date:* ${task.assigned_date}`, ``, `Reply *tasks* to view your full list, or *done <number>* once completed!`);
            TaskMessagingService.sendMessage(target.phone_number, lines.join('\n')).catch(err => {
                console.error('[WorkspaceService] Failed to send assignment alert:', err?.message);
            });
        }

        return task;
    }

    static async setStatus(actorUserId: string, input: { taskId?: string; status?: string }): Promise<TaskAssignment> {
        if (!input.taskId) throw new WorkspaceError(400, 'Missing task.');
        if (!['pending', 'in_progress', 'completed'].includes(input.status || '')) {
            throw new WorkspaceError(400, 'Status must be pending, in_progress or completed.');
        }

        const actor = await this.requireUnlockedActor(actorUserId);

        const { data: row, error } = await supabaseAdmin.from('task_assignments').select('*').eq('id', input.taskId).maybeSingle();
        if (error || !row) throw new WorkspaceError(404, 'Task not found.');

        // Throws PermissionDeniedError unless: own task, a task of someone below you, or you are a superuser
        await PermissionService.assertCanCompleteTask(actor.id, row as TaskAssignment);

        const updated = await TaskDatabaseService.updateAssignmentStatus({
            assignmentId: row.id,
            status: input.status as TaskStatus,
        });

        await TaskDatabaseService.logAudit({
            eventType: input.status === 'completed' ? 'task_completed' : 'task_status_changed',
            actorId: actor.id,
            targetEmployeeId: row.employee_id,
            taskId: row.id,
            details: { title: row.title, from: row.status, to: input.status, via: 'web_tasks_tab' },
        });

        return updated;
    }
}
