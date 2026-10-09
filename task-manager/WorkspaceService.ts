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
    /** True only for the person who HOLDS the task, while it is not finished. Drives the "Give to…" button. */
    canHandOver: boolean;
    /** A personal fixed task: it comes back every working day. A locked task cannot be deleted until it is unlocked. */
    locked: boolean;
    /** The holder may lock or unlock it (not a team-wide fixed task). */
    canLock: boolean;
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
        /** Working with a superuser: shown only when this team's switch is ON. */
        superuserCollab: { enabled: boolean; superusers: Array<{ userId: string; name: string }> };
    };

/** One row of the superuser's cross-department console. `department` is the OTHER person's department. */
export interface ConsoleTask {
    id: string;
    title: string;
    description: string | null;
    status: TaskStatus;
    assignedDate: string;
    /** 'mine' = held by me, 'given' = I gave it to someone else */
    kind: 'mine' | 'given';
    /** A personal fixed task (comes back every working day). Cannot be deleted until unlocked. */
    locked: boolean;
    canLock: boolean;
    /** Who gave it (mine) or who holds it (given) */
    personId: string | null;
    personName: string;
    department: string;
}

export interface ConsoleResponse {
    actor: { userId: string; name: string };
    departments: string[];
    mine: ConsoleTask[];
    given: ConsoleTask[];
}

const CARRY_DAYS = 14;
const CONSOLE_DONE_DAYS = 7;

export function todayIST(): string {
    const ist = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
    return `${ist.getFullYear()}-${String(ist.getMonth() + 1).padStart(2, '0')}-${String(ist.getDate()).padStart(2, '0')}`;
}

const isDate = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

/** Only the person holding a task may give it away, and only while it is not finished. (Not even a superuser.) */
export function canHandOverTask(task: { employee_id: string; status: string }, actorId: string): boolean {
    return task.employee_id === actorId && task.status !== 'completed';
}

/** What a task's template says about it. A task is LOCKED when its template is a personal fixed one that belongs to the task's holder. */
interface TemplateInfo { ownerId: string | null; active: boolean; fixed: boolean }
const isLockedFor = (info: TemplateInfo | undefined, holderId: string) => !!info && info.ownerId === holderId && info.active;
const isTeamFixed = (info: TemplateInfo | undefined) => !!info && !info.ownerId && info.fixed;

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const shortDay = (d: string) => `${Number(d.slice(8, 10))} ${MONTHS_SHORT[Number(d.slice(5, 7)) - 1]}`;

const HANDOVER_NOTE_PREFIX = 'Given by ';

function addDays(date: string, days: number): string {
    const d = new Date(`${date}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
}

export class WorkspaceService {
    private static async templateInfo(ids: Array<string | null | undefined>): Promise<Map<string, TemplateInfo>> {
        const out = new Map<string, TemplateInfo>();
        const unique = Array.from(new Set(ids.filter((i): i is string => !!i)));
        if (unique.length === 0) return out;
        const { data, error } = await supabaseAdmin.from('task_templates').select('id, owner_id, is_active, task_type').in('id', unique);
        if (error) { console.error('[WorkspaceService] could not read templates:', error); return out; }
        for (const t of (data || []) as any[]) {
            if (t?.id) out.set(t.id as string, { ownerId: (t.owner_id as string) || null, active: t.is_active !== false, fixed: t.task_type === 'fixed' });
        }
        return out;
    }
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
            const select = 'id, title, description, employee_id, assigned_date, status, created_at, task_template_id';
            const [today, carried] = await Promise.all([
                supabaseAdmin.from('task_assignments').select(select).in('employee_id', ids).eq('assigned_date', date),
                supabaseAdmin.from('task_assignments').select(select).in('employee_id', ids)
                    .lt('assigned_date', date).gte('assigned_date', addDays(date, -CARRY_DAYS)).neq('status', 'completed'),
            ]);
            if (today.error) throw today.error;
            if (carried.error) throw carried.error;
            rows = [...(today.data || []), ...(carried.data || [])];
        }

        const templates = await this.templateInfo(rows.map(r => r.task_template_id));
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
                canHandOver: canHandOverTask(r, actor.id),
                locked: isLockedFor(templates.get(r.task_template_id), r.employee_id as string),
                canLock: r.employee_id === actor.id && !isTeamFixed(templates.get(r.task_template_id)),
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

        // Working with a superuser: when this team has it ON, tell the screen who they can work with (a superuser who is unlocked).
        const collabOn = actor.role !== 'superuser' && await TaskAccessService.isSuperuserCollabEnabled(actor.department_id);
        const superusers = collabOn
            ? (await TaskAccessService.partition(pool.filter(e => e.role === 'superuser' && e.id !== actor.id), snapshot)).allowed
                .map(e => ({ userId: e.id, name: e.name }))
            : [];

        return {
            state: 'ok',
            actor: { userId: actor.id, name: actor.name, role: actor.role, departmentName: actor.department_name },
            teamSharing: await TaskAccessService.isPeerAssignEnabled(actor.department_id),
            date,
            members: memberViews,
            tasks,
            assignable,
            superuserCollab: { enabled: collabOn, superusers },
        };
    }

    /**
     * The superuser's own view across ALL departments: tasks held by them, and tasks they gave to others.
     * Open tasks of any age, plus finished ones from the last week. Superusers only.
     */
    static async loadConsole(actorUserId: string): Promise<ConsoleResponse> {
        const actor = await TaskDatabaseService.getEmployeeById(actorUserId);
        if (!actor || !actor.active) throw new WorkspaceError(403, 'Your account is not linked to an active employee profile.', 'NO_PROFILE');
        if (actor.role !== 'superuser') throw new WorkspaceError(403, 'This view is only for superusers.', 'NOT_SUPERUSER');

        const pool = await TaskDatabaseService.getAllEmployees();
        const byId = new Map(pool.map(e => [e.id, e]));
        const since = addDays(todayIST(), -CONSOLE_DONE_DAYS);
        const select = 'id, title, description, employee_id, assigned_by, assigned_date, status, task_template_id';

        const fetchSide = async (column: 'employee_id' | 'assigned_by') => {
            let open = supabaseAdmin.from('task_assignments').select(select).eq(column, actor.id).neq('status', 'completed');
            let done = supabaseAdmin.from('task_assignments').select(select).eq(column, actor.id).eq('status', 'completed').gte('assigned_date', since);
            if (column === 'assigned_by') { open = open.neq('employee_id', actor.id); done = done.neq('employee_id', actor.id); }
            const [o, d] = await Promise.all([open, done]);
            if (o.error) throw o.error;
            if (d.error) throw d.error;
            return [...(o.data || []), ...(d.data || [])];
        };
        const [mineRows, givenRows] = await Promise.all([fetchSide('employee_id'), fetchSide('assigned_by')]);
        const templates = await this.templateInfo([...mineRows, ...givenRows].map(r => r.task_template_id));

        const view = (r: any, kind: 'mine' | 'given'): ConsoleTask => {
            const personId = (kind === 'mine' ? r.assigned_by : r.employee_id) as string | null;
            const person = personId ? byId.get(personId) : undefined;
            return {
                id: r.id as string,
                title: r.title as string,
                description: (r.description as string) || null,
                status: r.status as TaskStatus,
                assignedDate: r.assigned_date as string,
                locked: isLockedFor(templates.get(r.task_template_id), r.employee_id as string),
                canLock: r.employee_id === actor.id && !isTeamFixed(templates.get(r.task_template_id)),
                kind,
                personId,
                personName: kind === 'mine' && (!personId || personId === actor.id) ? 'Yourself' : person?.name || 'Unknown',
                department: person?.department_name || (kind === 'mine' ? actor.department_name : null) || 'No department',
            };
        };
        const newestFirst = (a: ConsoleTask, b: ConsoleTask) => b.assignedDate.localeCompare(a.assignedDate);
        const mine = mineRows.map(r => view(r, 'mine')).sort(newestFirst);
        const given = givenRows.map(r => view(r, 'given')).sort(newestFirst);

        const departments = Array.from(new Set(pool.map(e => e.department_name).filter((n): n is string => !!n))).sort((a, b) => a.localeCompare(b));
        return { actor: { userId: actor.id, name: actor.name }, departments, mine, given };
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

    /**
     * Gives one of MY tasks to a teammate. The same task row MOVES (it is not copied): it leaves my list at once
     * and lands on theirs, who is told on WhatsApp who gave it.
     *
     * Rules: only the current holder · not a finished task · the receiver must be someone I may assign to
     * (the shared PermissionService rule) and be unlocked for the Task Manager · the move is one conditional
     * update, so two clicks at the same moment cannot both win.
     */
    static async handOver(actorUserId: string, input: { taskId?: string; targetUserId?: string }): Promise<{ task: TaskAssignment; toName: string }> {
        if (!input.taskId) throw new WorkspaceError(400, 'Missing task.');
        if (!input.targetUserId) throw new WorkspaceError(400, 'Choose who to give the task to.');

        const actor = await this.requireUnlockedActor(actorUserId);
        if (input.targetUserId === actor.id) throw new WorkspaceError(400, 'That task is already yours. Choose a teammate.', 'SAME_PERSON');

        const { data: row, error } = await supabaseAdmin.from('task_assignments').select('*').eq('id', input.taskId).maybeSingle();
        if (error || !row) throw new WorkspaceError(404, 'Task not found.');

        if (row.employee_id !== actor.id) {
            throw new WorkspaceError(403, 'Only the person who holds a task can give it to someone else.', 'NOT_HOLDER');
        }
        if (row.status === 'completed') {
            throw new WorkspaceError(409, 'This task is already done, so it cannot be given to someone else.', 'ALREADY_DONE');
        }

        // The same rule as assigning: throws PermissionDeniedError when this person may not give work to that person
        const { target } = await PermissionService.assertCanAssignTask(actor.id, input.targetUserId);

        const targetAccess = await TaskAccessService.check({ userId: target.id, departmentId: target.department_id });
        if (!targetAccess.allowed) {
            throw new WorkspaceError(409, `Cannot give a task to ${target.name}: ${targetAccess.message}`, 'TARGET_LOCKED');
        }

        // The new holder has not started it, so "in progress" goes back to "to do". Keep a short trail on the card.
        const newStatus: TaskStatus = row.status === 'in_progress' ? 'pending' : (row.status as TaskStatus);
        const note = `${HANDOVER_NOTE_PREFIX}${actor.name} on ${shortDay(todayIST())}`;
        const base = ((row.description as string) || '').trim();
        const joined = base ? `${base}\n${note}` : note;
        const description = joined.length <= 1000 ? joined : base || null;

        const { data: moved, error: moveError } = await supabaseAdmin
            .from('task_assignments')
            .update({ employee_id: target.id, status: newStatus, description, updated_at: new Date().toISOString() })
            .eq('id', row.id)
            .eq('employee_id', actor.id)      // still mine…
            .neq('status', 'completed')       // …and still not finished
            .select('*')
            .maybeSingle();

        if (moveError) {
            if ((moveError as any).code === '23505') {
                throw new WorkspaceError(409, `${target.name} already has this same task for that day.`, 'ALREADY_THERE');
            }
            console.error('[WorkspaceService] hand-over failed:', moveError);
            throw new WorkspaceError(500, 'Could not give the task just now. Please try again.');
        }
        if (!moved) {
            throw new WorkspaceError(409, 'This task changed just now. Please refresh and try again.', 'CHANGED');
        }

        await TaskDatabaseService.logAudit({
            eventType: 'task_handed_over',
            actorId: actor.id,
            targetEmployeeId: target.id,
            taskId: row.id,
            details: { title: row.title, assignedDate: row.assigned_date, fromUserId: actor.id, toUserId: target.id, fromStatus: row.status, toStatus: newStatus, via: 'web_tasks_tab' },
        });

        // Tell the receiver who gave it (names only; gated, so nothing is sent in Pretend Mode). Never blocks the hand-over.
        if (target.phone_number && target.phone_number.trim().length >= 10) {
            const from = actor.department_name ? `${actor.name} (${actor.department_name})` : actor.name;
            const lines = [`🔁 *A task was given to you*`, ``, `*Task:* ${row.title}`];
            if (base) lines.push(`*Details:* ${base}`);
            lines.push(`*Given by:* ${from}`, `*Date:* ${row.assigned_date}`, ``, `Reply *tasks* to see your full list.`);
            TaskMessagingService.sendMessage(target.phone_number, lines.join('\n'), {
                messageType: 'task_handover',
                freeformOnly: true, // no template: only reaches people inside WhatsApp's 24-hour window
            }).catch(err => {
                console.error('[WorkspaceService] Failed to send hand-over alert:', err?.message);
            });
        }

        return { task: moved as TaskAssignment, toName: target.name };
    }

    /**
     * Deletes a task for good. Allowed for whoever may change it (holder, someone above them, a superuser)
     * and for the person who assigned it. Not reversible, by request.
     */
    static async deleteTask(actorUserId: string, input: { taskId?: string }): Promise<{ id: string }> {
        if (!input.taskId) throw new WorkspaceError(400, 'Missing task.');
        const actor = await this.requireUnlockedActor(actorUserId);

        const { data: row, error } = await supabaseAdmin.from('task_assignments').select('*').eq('id', input.taskId).maybeSingle();
        if (error || !row) throw new WorkspaceError(404, 'Task not found.');

        // Throws PermissionDeniedError unless: own task, a task of someone below you, you are a superuser, or you assigned it
        if (row.assigned_by !== actor.id) await PermissionService.assertCanCompleteTask(actor.id, row as TaskAssignment);

        // A locked task repeats every working day: unlock it first, then delete it.
        if (row.task_template_id) {
            const info = (await this.templateInfo([row.task_template_id])).get(row.task_template_id as string);
            if (isLockedFor(info, row.employee_id as string)) {
                throw new WorkspaceError(409, 'This task repeats every working day. Unlock it first, then delete it.', 'LOCKED');
            }
        }

        await TaskDatabaseService.logAudit({
            eventType: 'task_deleted',
            actorId: actor.id,
            targetEmployeeId: row.employee_id,
            taskId: row.id,
            details: { title: row.title, assignedDate: row.assigned_date, status: row.status, via: 'web_tasks_tab' },
        });

        const { error: delError } = await supabaseAdmin.from('task_assignments').delete().eq('id', row.id);
        if (delError) {
            console.error('[WorkspaceService] delete failed:', delError);
            throw new WorkspaceError(500, 'Could not delete the task just now. Please try again.');
        }
        return { id: row.id as string };
    }

    /**
     * Locks a task so it comes back every working day (Monday to Saturday by default), or unlocks it.
     * Locking makes a PERSONAL fixed template for the holder and links the task to it; unlocking switches that template off
     * (nothing is deleted). Only the person who holds the task may do this.
     */
    static async setLocked(actorUserId: string, input: { taskId?: string; locked?: unknown }): Promise<{ locked: boolean }> {
        if (!input.taskId) throw new WorkspaceError(400, 'Missing task.');
        if (typeof input.locked !== 'boolean') throw new WorkspaceError(400, 'Say whether to lock or unlock the task.');
        const actor = await this.requireUnlockedActor(actorUserId);

        const { data: row, error } = await supabaseAdmin.from('task_assignments').select('*').eq('id', input.taskId).maybeSingle();
        if (error || !row) throw new WorkspaceError(404, 'Task not found.');
        if (row.employee_id !== actor.id) throw new WorkspaceError(403, 'Only the person who holds a task can lock or unlock it.', 'NOT_HOLDER');

        const info = row.task_template_id ? (await this.templateInfo([row.task_template_id])).get(row.task_template_id as string) : undefined;
        if (isTeamFixed(info)) throw new WorkspaceError(409, 'This is a team fixed task, so it already repeats on its own.', 'TEAM_FIXED');
        const mine = !!info && info.ownerId === actor.id;

        if (input.locked) {
            if (mine) {
                if (!info!.active) await supabaseAdmin.from('task_templates').update({ is_active: true }).eq('id', row.task_template_id);
            } else {
                const description = ((row.description as string) || '').split('\n').filter(l => !l.startsWith(HANDOVER_NOTE_PREFIX)).join('\n').trim();
                const { data: tpl, error: tplError } = await supabaseAdmin.from('task_templates').insert({
                    title: row.title, description: description || null, department_id: actor.department_id, created_by: actor.id,
                    task_type: 'fixed', is_active: true, owner_id: actor.id,
                }).select('id').single();
                if (tplError || !tpl) {
                    console.error('[WorkspaceService] lock failed:', tplError);
                    throw new WorkspaceError(500, 'Could not lock the task just now. Please try again.');
                }
                const { error: linkError } = await supabaseAdmin.from('task_assignments')
                    .update({ task_template_id: tpl.id, updated_at: new Date().toISOString() }).eq('id', row.id).eq('employee_id', actor.id);
                if (linkError) {
                    await supabaseAdmin.from('task_templates').update({ is_active: false }).eq('id', tpl.id);
                    console.error('[WorkspaceService] lock link failed:', linkError);
                    throw new WorkspaceError(500, 'Could not lock the task just now. Please try again.');
                }
            }
        } else if (mine && info!.active) {
            const { error: offError } = await supabaseAdmin.from('task_templates').update({ is_active: false }).eq('id', row.task_template_id);
            if (offError) throw new WorkspaceError(500, 'Could not unlock the task just now. Please try again.');
        }

        await TaskDatabaseService.logAudit({
            eventType: input.locked ? 'task_locked' : 'task_unlocked',
            actorId: actor.id,
            targetEmployeeId: actor.id,
            taskId: row.id,
            details: { title: row.title, via: 'web_tasks_tab' },
        });
        return { locked: input.locked };
    }

    /**
     * A superuser finished a task someone else gave him: tell that person, in plain words.
     * Goes through the same safety gate as every other message (kill switches, Pretend Mode, sandbox) and only reaches people
     * inside WhatsApp's 24-hour window. Told at most once an hour per task (dragging it out of Done and back must not repeat it).
     * Never throws: a failed notice must not undo or fail the status change.
     */
    private static async notifyAssignerOfCompletion(row: any): Promise<void> {
        try {
            if (!row.assigned_by || row.assigned_by === row.employee_id) return;
            const [holder, assigner] = await Promise.all([TaskDatabaseService.getEmployeeById(row.employee_id), TaskDatabaseService.getEmployeeById(row.assigned_by)]);
            if (!holder || holder.role !== 'superuser' || !assigner || !assigner.active) return;
            if (!assigner.phone_number || assigner.phone_number.trim().length < 10) return;

            const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
            const { data: recent } = await supabaseAdmin.from('task_audit_logs').select('id')
                .eq('event_type', 'task_completion_notified').eq('task_id', row.id).gte('created_at', since).limit(1);
            if (recent && recent.length > 0) return;

            await TaskDatabaseService.logAudit({
                eventType: 'task_completion_notified',
                actorId: holder.id,
                targetEmployeeId: assigner.id,
                taskId: row.id,
                details: { title: row.title, via: 'web_tasks_tab' },
            });
            TaskMessagingService.sendMessage(assigner.phone_number, [`✅ *Task completed*`, ``, `${holder.name} has finished:`, `• ${row.title}`].join('\n'), {
                messageType: 'task_completed_relay',
                freeformOnly: true, // no template: only reaches people inside WhatsApp's 24-hour window
            }).catch(err => {
                console.error('[WorkspaceService] Failed to send completion notice:', err?.message);
            });
        } catch (err: any) {
            console.error('[WorkspaceService] completion notice failed:', err?.message || err);
        }
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

        if (input.status === 'completed' && row.status !== 'completed') await this.notifyAssignerOfCompletion(row);

        return updated;
    }
}
