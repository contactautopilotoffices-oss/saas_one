import { randomUUID } from 'node:crypto';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { TaskDatabaseService } from './TaskDatabaseService';
import { TaskAccessService } from './TaskAccessService';
import { WorkspaceError, WorkspaceService, completionRemarkOf, duplicateHits, isUuid, todayIST, withoutHandoverNotes } from './WorkspaceService';
import { isMissingSchema, linkTasks, loadTaskExtras } from './TaskLinks';
import { personLabel, sendSupportRequest, sendTaskAssigned } from './taskAlerts';
import { taskBell } from './taskBell';
import { TaskAttachmentService } from './TaskAttachmentService';
import { Employee, TaskStatus } from './types';
import { TaskDue, checkDue, dueLabel } from './dueDates';
import { setTaskDue } from './TaskDueService';

/**
 * Owner 2026-10-26 — cross-department collaboration (the "Other departments" side of the Send tab).
 * Anyone who uses the Task Manager may, with anyone in ANOTHER department (never a superuser — they stay under
 * "Your manager"):
 *   task      give them a task: it goes straight onto their list (they are told like any new task);
 *   support   ask for support: a request waits for them to Accept (→ a normal task, given by the sender) or say they
 *             can't (a reason is optional, owner 2026-10-27; sent back to the sender). Nothing shows on lists or reports until accepted;
 *   together  work on it together: both get a linked copy and each finishes their own.
 * The receiver's manager is not told (owner decision). The acting person always comes from the login session.
 */

export type CollabKind = 'task' | 'support' | 'together';

export interface CollabPerson { userId: string; name: string; department: string }

/** Something I sent to another department: a task (with its live status) or a support request still waiting / declined. */
export interface CollabSent {
    kind: 'task' | 'request';
    id: string;
    title: string;
    toName: string;
    department: string;
    status: 'awaiting' | 'declined' | TaskStatus;
    since: string;
    reason: string | null;
    /** Only open tasks can be reminded about. */
    canRemind: boolean;
    supportRequest: boolean;
    /** Owner 2026-10-28: for the details window. */
    description: string | null;
    createdAt: string;
    /** A task's start date (null for a request still waiting). */
    startDate: string | null;
    /** A task's deadline, or a request's "needed by" day (time null). */
    due: TaskDue | null;
    attachmentCount: number;
    /** What they wrote when they marked it done. */
    completionRemark: string | null;
}

/** Owner 2026-10-28: "Delete" on Waiting on other teams only clears it from MY list (the task stays with them). */
const CLEARED_EVENT = 'collab_sent_cleared';

/** A support request someone in another department sent me, waiting for my answer. */
export interface CollabIncoming { id: string; title: string; description: string | null; fromName: string; fromDepartment: string; neededBy: string | null; createdAt: string }

/** A real calendar day (2026-02-31 is refused), as YYYY-MM-DD. */
const isDate = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(`${s}T12:00:00Z`).toISOString().slice(0, 10) === s;
/** Owner 2026-10-26: at most this many tasks / requests one person may send to other departments in an hour. */
export const SEND_LIMIT_PER_HOUR = 30;
const addDays = (date: string, days: number) => { const d = new Date(`${date}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };
const NOT_READY = 'Support requests are not switched on yet. Please ask the admin to apply the latest database update.';

export class CollaborationService {
    private static async actorFor(actorUserId: string): Promise<Employee> {
        const actor = await TaskDatabaseService.getEmployeeById(actorUserId);
        if (!actor || !actor.active) throw new WorkspaceError(403, 'Your account is not linked to an active employee profile.', 'NO_PROFILE');
        const access = await TaskAccessService.check({ userId: actor.id, departmentId: actor.department_id });
        if (!access.allowed) throw new WorkspaceError(403, access.message, 'LOCKED');
        return actor;
    }

    /**
     * People in OTHER departments who use the Task Manager (unlocked), never superusers, never me.
     * Owner 2026-10-27: nobody when I may not send to other departments (my department's switch OFF, or "only selected
     * people" and I am not ticked), and never someone whose department has the switch OFF. Receiving is not limited by the
     * ticks: anyone in a department with the switch ON can be sent to.
     */
    private static async candidates(actor: Employee): Promise<Employee[]> {
        const [pool, snapshot, cross, personal] = await Promise.all([TaskDatabaseService.getAllEmployees(), TaskAccessService.getSnapshot(), TaskAccessService.getCrossDeptOff(), TaskAccessService.getPersonOverrides()]);
        const on = (deptId: string | null) => !cross.allOff && !!deptId && !cross.off.has(deptId);
        // Owner 2026-10-28: a receiver's own exception wins over their department's switch
        const receives = (e: Employee) => TaskAccessService.switchFrom(personal, e.id, 'cross_dept_collab') ?? on(e.department_id);
        if (!(await this.enabledFor(actor))) return [];
        const others = pool.filter(e => e.active && e.id !== actor.id && e.role !== 'superuser' && !!e.department_id && e.department_id !== actor.department_id && receives(e));
        return (await TaskAccessService.partition(others, snapshot)).allowed;
    }

    /** Owner 2026-10-27: the actor may send to other departments (department switch, and the "who" choice). */
    static async enabledFor(actor: Employee): Promise<boolean> {
        return TaskAccessService.maySendCrossDept(actor);
    }

    private static async target(actor: Employee, targetUserId: unknown): Promise<Employee> {
        if (!isUuid(targetUserId)) throw new WorkspaceError(400, 'Choose who to send it to.');
        if (!(await this.enabledFor(actor))) throw new WorkspaceError(403, 'You cannot send work to other departments. Ask your admin if you need to.', 'CROSS_DEPT_OFF');
        const person = (await this.candidates(actor)).find(e => e.id === targetUserId);
        if (!person) throw new WorkspaceError(403, 'You can only send this to someone in another department who uses the Task Manager.', 'NOT_ALLOWED');
        return person;
    }

    static async people(actorUserId: string): Promise<CollabPerson[]> {
        const actor = await this.actorFor(actorUserId);
        return (await this.candidates(actor))
            .map(e => ({ userId: e.id, name: e.name, department: e.department_name || 'Other' }))
            .sort((a, b) => a.department.localeCompare(b.department) || a.name.localeCompare(b.name));
    }

    /** "Duplicate task alert" for someone in another department. Their task titles stay private (only date and status). */
    static async checkDuplicate(actorUserId: string, input: { targetUserId?: unknown; title?: string }): Promise<{ match: { assignedDate: string; status: TaskStatus } | null }> {
        const title = String(input.title ?? '').trim().slice(0, 200);
        if (!title) return { match: null };
        const actor = await this.actorFor(actorUserId);
        const person = await this.target(actor, input.targetUserId);
        const { data, error } = await supabaseAdmin.from('task_assignments').select('title, assigned_date, status')
            .eq('employee_id', person.id).neq('status', 'completed').gte('assigned_date', addDays(todayIST(), -30))
            .order('assigned_date', { ascending: false }).limit(200);
        if (error) throw new WorkspaceError(500, 'Could not check for similar tasks just now.');
        const open = (data || []) as Array<{ title: string; assigned_date: string; status: TaskStatus }>;
        const hit = (await duplicateHits(title, [{ id: person.id, open }])).get(person.id);
        return { match: hit ? { assignedDate: hit.assigned_date, status: hit.status } : null };
    }

    /**
     * Owner 2026-10-28: a task (or work-together) has a Start date (when it shows on their list) and, with the Due dates
     * switch ON, an optional Deadline (`dueDate` + `dueTime`). A support request keeps one "needed by" date. Callers that
     * still send only `neededBy` for a task get the old meaning (deadline when the switch is ON, start date when OFF).
     */
    static async send(actorUserId: string, input: { targetUserId?: unknown; kind?: unknown; title?: unknown; description?: unknown; neededBy?: unknown; startDate?: unknown; dueDate?: unknown; dueTime?: unknown }): Promise<{ taskIds: string[]; requestId: string | null }> {
        const kind = input.kind === 'task' || input.kind === 'support' || input.kind === 'together' ? input.kind : null;
        if (!kind) throw new WorkspaceError(400, 'Choose what kind of request this is.');
        if (typeof input.title !== 'string' || (input.description != null && typeof input.description !== 'string')) throw new WorkspaceError(400, 'That request is not valid.');
        const title = input.title.trim();
        if (title.length < 1 || title.length > 200) throw new WorkspaceError(400, 'Task title must be 1 to 200 characters.');
        const description = String(input.description ?? '').trim();
        if (description.length > 1000) throw new WorkspaceError(400, 'Details can be at most 1000 characters.');
        const today = todayIST();
        if (input.neededBy && (!isDate(input.neededBy) || input.neededBy < today || input.neededBy > addDays(today, 366))) throw new WorkspaceError(400, 'Choose a date from today up to a year ahead.');
        const neededBy = isDate(input.neededBy) ? input.neededBy : null;

        const actor = await this.actorFor(actorUserId);
        const person = await this.target(actor, input.targetUserId);
        const from = personLabel(actor.name, actor.department_name);

        // Owner 2026-10-26 (review): no flooding another department — a cap per hour, and no second identical request
        const hourAgo = new Date(Date.now() - 3_600_000).toISOString();
        const { count: recent } = await supabaseAdmin.from('task_audit_logs').select('id', { count: 'exact', head: true })
            .eq('actor_id', actor.id).in('event_type', ['task_support_requested', 'task_assigned_cross_department']).gte('created_at', hourAgo);
        if ((recent ?? 0) >= SEND_LIMIT_PER_HOUR) throw new WorkspaceError(429, `You have sent ${SEND_LIMIT_PER_HOUR} items to other departments in the last hour. Please try again later.`, 'TOO_MANY');

        if (kind === 'support') {
            const { data: same } = await supabaseAdmin.from('task_requests').select('id')
                .eq('from_user_id', actor.id).eq('to_user_id', person.id).eq('state', 'awaiting').ilike('title', title.replace(/[%_\\]/g, m => `\\${m}`)).limit(1);
            if (same?.length) throw new WorkspaceError(409, `${person.name} already has this request from you, still waiting for an answer.`, 'ALREADY_SENT');
            const { data, error } = await supabaseAdmin.from('task_requests').insert({
                from_user_id: actor.id, to_user_id: person.id, title, description: description || null, needed_by: neededBy,
            }).select('id').single();
            if (error || !data) {
                if (isMissingSchema(error)) throw new WorkspaceError(503, NOT_READY, 'NOT_READY');
                console.error('[CollaborationService] could not save the request:', error);
                throw new WorkspaceError(500, 'Could not send the request just now. Please try again.');
            }
            await TaskDatabaseService.logAudit({
                eventType: 'task_support_requested', actorId: actor.id, targetEmployeeId: person.id,
                details: { requestId: data.id, title, neededBy, toDepartment: person.department_name, via: 'send_tab' },
            });
            void taskBell({ userId: person.id, kind: 'TASK_ASSIGNED', title: `Request from ${actor.name}`, message: `${from} needs your help with: ${title}`, departmentName: person.department_name });
            void sendSupportRequest(person.phone_number, { recipientName: person.name, fromLabel: from, title, neededBy, departmentId: person.department_id || undefined });
            return { taskIds: [], requestId: data.id as string };
        }

        // A task straight onto their list (and, working together, one onto mine too, linked).
        // Owner 2026-10-28: Start date and Deadline are separate. The start puts the task on their list that day; the
        // deadline (Due dates switch ON only) counts down to it. Old callers: "needed by" alone keeps its 2026-10-27 meaning.
        const switchOn = actor.role === 'superuser' || await TaskAccessService.isDueDatesEnabled(actor.department_id, actor.id);
        const legacy = input.startDate === undefined && input.dueDate === undefined;
        if (input.startDate && (!isDate(input.startDate) || input.startDate < today || input.startDate > addDays(today, 366))) throw new WorkspaceError(400, 'Choose a start date from today up to a year ahead.');
        const date = legacy ? (neededBy && !switchOn ? neededBy : today) : (isDate(input.startDate) ? input.startDate : today);
        const dueDate = legacy ? (switchOn ? neededBy : null) : input.dueDate;
        const checked = checkDue(date, dueDate, input.dueTime);
        if (!checked.ok) throw new WorkspaceError(400, checked.error);
        if (checked.due && !switchOn) throw new WorkspaceError(400, 'Due dates are switched off for your team.');
        if (checked.due && (await TaskAccessService.getDueDatesDepartments()).columnMissing) throw new WorkspaceError(503, 'Due dates are not set up yet. Please ask the admin to apply the latest database update.', 'NOT_READY');
        const due: TaskDue | null = checked.due;
        const theirs = await TaskDatabaseService.createTaskAssignment({ employeeId: person.id, title, description: description || undefined, assignedDate: date, assignedBy: actor.id });
        const taskIds = [theirs.id];
        if (kind === 'together') {
            // Their copy already exists: if mine cannot be made, say so in the log and carry on (they still got the task)
            try {
                const mine = await TaskDatabaseService.createTaskAssignment({ employeeId: actor.id, title, description: description || undefined, assignedDate: date, assignedBy: actor.id });
                taskIds.push(mine.id);
                if (!(await linkTasks(taskIds, { groupId: randomUUID() }))) console.warn('[CollaborationService] the two copies could not be linked');
            } catch (err) {
                console.error('[CollaborationService] could not create the sender\'s own copy:', err);
            }
        }
        // Announced only when it was really stored
        const dueSaved = due && (await setTaskDue(taskIds, due)) ? due : null;
        if (due && !dueSaved) console.warn('[CollaborationService] task saved without its due date:', theirs.id);
        await TaskDatabaseService.logAudit({
            eventType: 'task_assigned_cross_department', actorId: actor.id, targetEmployeeId: person.id, taskId: theirs.id,
            details: { title, assignedDate: date, ...(dueSaved ? { dueDate: dueSaved.date, dueTime: dueSaved.time } : {}), ...(due && !dueSaved ? { dueNotSaved: true } : {}), crossDepartment: true, kind, toDepartment: person.department_name, via: 'send_tab' },
        });
        void taskBell({ userId: person.id, kind: 'TASK_ASSIGNED', title: `New task from ${actor.name}`, message: `${from} ${kind === 'together' ? 'wants to work with you on' : 'gave you'}: ${title}${dueSaved ? ` (due ${dueLabel(dueSaved)})` : ''}`, departmentName: person.department_name });
        void sendTaskAssigned(person.phone_number, { titles: [title], fromLabel: from, date, departmentId: person.department_id || undefined });
        return { taskIds, requestId: null };
    }

    static async overview(actorUserId: string): Promise<{ sent: CollabSent[]; incoming: CollabIncoming[]; requestsReady: boolean; enabled: boolean }> {
        const actor = await this.actorFor(actorUserId);
        const enabled = await this.enabledFor(actor);
        const pool = await TaskDatabaseService.getAllEmployees();
        const byId = new Map(pool.map(e => [e.id, e]));
        const otherDept = (id: string) => { const e = byId.get(id); return !!e && !!e.department_id && e.department_id !== actor.department_id; };
        const today = todayIST();

        // Tasks I gave to people in other departments: open ones, and ones finished in the last week
        const { data: tasks, error: taskError } = await supabaseAdmin.from('task_assignments')
            .select('id, title, description, employee_id, status, assigned_date, created_at, completed_at')
            .eq('assigned_by', actor.id).neq('employee_id', actor.id).gte('assigned_date', addDays(today, -60))
            .order('created_at', { ascending: false }).limit(300);
        if (taskError) throw new WorkspaceError(500, 'Could not load what you sent just now. Please try again.');
        const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
        const cleared = await this.clearedBy(actor.id);
        const given = (tasks || []).filter(t => otherDept(t.employee_id as string) && (t.status !== 'completed' || (t.completed_at && t.completed_at >= weekAgo))
            && !cleared.has(`task:${t.id}`));

        let requestsReady = true;
        let mineReq: Array<Record<string, unknown>> = [];
        let incomingReq: Array<Record<string, unknown>> = [];
        const [out, inc] = await Promise.all([
            supabaseAdmin.from('task_requests').select('id, title, description, to_user_id, state, decline_reason, needed_by, task_id, created_at, responded_at')
                .eq('from_user_id', actor.id).in('state', ['awaiting', 'declined']).gte('created_at', new Date(Date.now() - 30 * 86_400_000).toISOString())
                .order('created_at', { ascending: false }).limit(100),
            supabaseAdmin.from('task_requests').select('id, title, description, from_user_id, needed_by, created_at')
                .eq('to_user_id', actor.id).eq('state', 'awaiting').order('created_at', { ascending: true }).limit(100),
        ]);
        if (out.error || inc.error) {
            if (isMissingSchema(out.error) || isMissingSchema(inc.error)) requestsReady = false;
            else throw new WorkspaceError(500, 'Could not load requests just now. Please try again.');
        } else {
            mineReq = (out.data || []).filter(r => !cleared.has(`request:${r.id}`));
            incomingReq = inc.data || [];
        }
        // Which of my given tasks came from an accepted support request (shown with that label)
        const fromRequest = new Set<string>();
        if (requestsReady && given.length) {
            const ids = given.map(t => t.id as string);
            for (let i = 0; i < ids.length; i += 150) {
                const { data: acc, error: accError } = await supabaseAdmin.from('task_requests').select('task_id').in('task_id', ids.slice(i, i + 150));
                if (accError) { console.error('[CollaborationService] could not read request labels:', accError); break; }
                for (const r of acc || []) if (r.task_id) fromRequest.add(r.task_id as string);
            }
        }

        const nameOf = (id: string) => byId.get(id)?.name || 'Someone';
        const deptOf = (id: string) => byId.get(id)?.department_name || 'Other';
        // Owner 2026-10-28: deadline and file count for the details window (empty until those migrations run)
        const extras = await loadTaskExtras(given.map(t => t.id as string), nameOf).catch(err => {
            console.error('[CollaborationService] could not read task extras:', err);
            return new Map<string, { due: TaskDue | null; attachmentCount: number }>();
        });
        const sent: CollabSent[] = [
            ...mineReq.map(r => ({
                kind: 'request' as const, id: r.id as string, title: r.title as string, toName: nameOf(r.to_user_id as string), department: deptOf(r.to_user_id as string),
                status: r.state as 'awaiting' | 'declined', since: (r.responded_at as string) || (r.created_at as string), reason: (r.decline_reason as string) || null, canRemind: false, supportRequest: true,
                description: (r.description as string) || null, createdAt: r.created_at as string, startDate: null,
                due: r.needed_by ? { date: r.needed_by as string, time: null } : null, attachmentCount: 0, completionRemark: null,
            })),
            ...given.map(t => ({
                kind: 'task' as const, id: t.id as string, title: t.title as string, toName: nameOf(t.employee_id as string), department: deptOf(t.employee_id as string),
                status: t.status as TaskStatus, since: (t.completed_at as string) || (t.created_at as string), reason: null,
                canRemind: t.status !== 'completed', supportRequest: fromRequest.has(t.id as string),
                description: withoutHandoverNotes(t.description as string), createdAt: t.created_at as string, startDate: t.assigned_date as string,
                due: extras.get(t.id as string)?.due ?? null, attachmentCount: extras.get(t.id as string)?.attachmentCount ?? 0,
                completionRemark: completionRemarkOf(t.description as string),
            })),
        ].sort((a, b) => Number(a.status === 'completed') - Number(b.status === 'completed') || b.since.localeCompare(a.since));

        const incoming: CollabIncoming[] = incomingReq.map(r => ({
            id: r.id as string, title: r.title as string, description: (r.description as string) || null, fromName: nameOf(r.from_user_id as string),
            fromDepartment: deptOf(r.from_user_id as string), neededBy: (r.needed_by as string) || null, createdAt: r.created_at as string,
        }));
        return { sent, incoming, requestsReady, enabled };
    }

    /** Owner 2026-10-28: what this person cleared from "Waiting on other teams" (last 60 days, like the list itself). */
    private static async clearedBy(actorId: string): Promise<Set<string>> {
        const { data, error } = await supabaseAdmin.from('task_audit_logs').select('details')
            .eq('actor_id', actorId).eq('event_type', CLEARED_EVENT).gte('created_at', new Date(Date.now() - 61 * 86_400_000).toISOString()).limit(2000);
        if (error) {
            console.error('[CollaborationService] could not read cleared items:', error);
            return new Set();
        }
        return new Set((data || []).map(r => { const d = r.details as { kind?: string; id?: string } | null; return `${d?.kind}:${d?.id}`; }));
    }

    /**
     * Owner 2026-10-28: "Delete" / "Delete all" on Waiting on other teams. Only hides them from MY list: the task stays on
     * the other person's list and a request stays as it is. Only items I sent can be cleared.
     */
    static async clearSent(actorUserId: string, items: unknown): Promise<{ cleared: number }> {
        const list = Array.isArray(items) ? items as Array<{ kind?: unknown; id?: unknown }> : [];
        const wanted = list.filter(i => (i?.kind === 'task' || i?.kind === 'request') && isUuid(i.id)) as Array<{ kind: 'task' | 'request'; id: string }>;
        if (wanted.length === 0) throw new WorkspaceError(400, 'Choose what to clear.');
        if (wanted.length > 500) throw new WorkspaceError(400, 'At most 500 at a time.');
        const actor = await this.actorFor(actorUserId);

        const taskIds = wanted.filter(i => i.kind === 'task').map(i => i.id);
        const requestIds = wanted.filter(i => i.kind === 'request').map(i => i.id);
        const mine = new Set<string>();
        if (taskIds.length) {
            const { data, error } = await supabaseAdmin.from('task_assignments').select('id').in('id', taskIds).eq('assigned_by', actor.id);
            if (error) throw new WorkspaceError(500, 'Could not clear the list just now. Please try again.');
            for (const r of data || []) mine.add(`task:${r.id}`);
        }
        if (requestIds.length) {
            const { data, error } = await supabaseAdmin.from('task_requests').select('id').in('id', requestIds).eq('from_user_id', actor.id);
            if (error) throw new WorkspaceError(500, 'Could not clear the list just now. Please try again.');
            for (const r of data || []) mine.add(`request:${r.id}`);
        }
        const rows = wanted.filter(i => mine.has(`${i.kind}:${i.id}`))
            .map(i => ({ event_type: CLEARED_EVENT, actor_id: actor.id, task_id: i.kind === 'task' ? i.id : null, details: { kind: i.kind, id: i.id, via: 'send_tab' } }));
        if (rows.length === 0) throw new WorkspaceError(403, 'You can only clear things you sent.');
        const { error } = await supabaseAdmin.from('task_audit_logs').insert(rows);
        if (error) {
            console.error('[CollaborationService] could not clear sent items:', error);
            throw new WorkspaceError(500, 'Could not clear the list just now. Please try again.');
        }
        return { cleared: rows.length };
    }

    /**
     * The receiver answers a support request. Accept → a normal task on their list, given by the sender (files move onto
     * it). Can't take it → a short reason goes back to the sender. Only the receiver, and only while it is waiting; the
     * state change is conditional, so two answers at the same moment cannot both win.
     */
    static async respond(actorUserId: string, input: { requestId?: unknown; accept?: unknown; reason?: unknown; via?: string }): Promise<{ taskId: string | null }> {
        if (!isUuid(input.requestId)) throw new WorkspaceError(400, 'That request is not valid.');
        if (typeof input.accept !== 'boolean') throw new WorkspaceError(400, 'Say whether you accept the request.');
        const reason = String(input.reason ?? '').replace(/\s+/g, ' ').trim();
        // Owner 2026-10-27: the reason for "can't do it" is optional (at most 300 characters when given)
        if (!input.accept && reason.length > 300) throw new WorkspaceError(400, 'Please keep the reason short (up to 300 characters).');
        const actor = await this.actorFor(actorUserId);

        const { data: req, error } = await supabaseAdmin.from('task_requests').select('*').eq('id', input.requestId).maybeSingle();
        if (error) {
            if (isMissingSchema(error)) throw new WorkspaceError(503, NOT_READY, 'NOT_READY');
            throw new WorkspaceError(500, 'Could not open the request just now. Please try again.');
        }
        if (!req || req.to_user_id !== actor.id) throw new WorkspaceError(404, 'Request not found.');
        if (req.state !== 'awaiting') throw new WorkspaceError(409, 'This request has already been answered.', 'ANSWERED');
        const sender = await TaskDatabaseService.getEmployeeById(req.from_user_id as string);
        const now = new Date().toISOString();

        // Claim it first, so a second answer at the same moment finds nothing to change
        const { data: claimed, error: claimError } = await supabaseAdmin.from('task_requests')
            .update(input.accept ? { state: 'accepted', responded_at: now } : { state: 'declined', decline_reason: reason || null, responded_at: now })
            .eq('id', req.id).eq('state', 'awaiting').select('id').maybeSingle();
        if (claimError) throw new WorkspaceError(500, 'Could not save your answer just now. Please try again.');
        if (!claimed) throw new WorkspaceError(409, 'This request has already been answered.', 'ANSWERED');

        let taskId: string | null = null;
        if (input.accept) {
            // Owner 2026-10-27: with the Due dates switch ON for the person who asked, "needed by" becomes the deadline and
            // the task starts today. OFF: as before.
            const neededBy = req.needed_by && (req.needed_by as string) > todayIST() ? (req.needed_by as string) : null;
            const due: TaskDue | null = neededBy && sender && (sender.role === 'superuser' || await TaskAccessService.isDueDatesEnabled(sender.department_id, sender.id))
                ? { date: neededBy, time: null } : null;
            try {
                const task = await TaskDatabaseService.createTaskAssignment({
                    employeeId: actor.id, title: req.title as string, description: (req.description as string) || undefined,
                    // never a date already gone (it would show as overdue the moment it is accepted)
                    assignedDate: due ? todayIST() : neededBy ?? todayIST(), assignedBy: req.from_user_id as string,
                });
                taskId = task.id;
                if (due && !(await setTaskDue([task.id], due))) console.warn('[CollaborationService] accepted task saved without its due date:', task.id);
            } catch (err) {
                // Put it back as waiting, so nothing is lost
                const { error: revertError } = await supabaseAdmin.from('task_requests').update({ state: 'awaiting', responded_at: null }).eq('id', req.id);
                if (revertError) console.error('[CollaborationService] could not put the request back to waiting:', req.id, revertError);
                console.error('[CollaborationService] could not create the accepted task:', err);
                throw new WorkspaceError(500, 'Could not add the task just now. Please try again.');
            }
            const { error: linkError } = await supabaseAdmin.from('task_requests').update({ task_id: taskId }).eq('id', req.id);
            if (linkError) console.error('[CollaborationService] could not link the request to its task:', req.id, linkError);
            await TaskAttachmentService.moveRequestFiles(req.id as string, taskId);
        }

        await TaskDatabaseService.logAudit({
            eventType: input.accept ? 'task_support_accepted' : 'task_support_declined', actorId: actor.id, targetEmployeeId: req.from_user_id as string, taskId: taskId ?? undefined,
            details: { requestId: req.id, title: req.title, ...(input.accept || !reason ? {} : { reason }), via: input.via ?? 'send_tab' },
        });
        if (sender?.active) {
            const who = personLabel(actor.name, actor.department_name);
            void taskBell({
                userId: sender.id, kind: 'TASK_UPDATE', departmentName: sender.department_name,
                title: input.accept ? `${actor.name} accepted your request` : `${actor.name} can't take your request`,
                message: input.accept ? `${who} accepted: ${req.title}` : reason ? `${who} on "${req.title}": ${reason}` : `${who} can't take: ${req.title}`,
            });
        }
        return { taskId };
    }

    /**
     * Read-only, for the WhatsApp bot (owner 2026-10-26): support requests waiting for this person's answer. Empty when
     * there are none or the table is not there yet.
     */
    static async waitingFor(userId: string): Promise<Array<{ id: string; title: string; fromName: string; fromDepartment: string }>> {
        const { data, error } = await supabaseAdmin.from('task_requests').select('id, title, from_user_id')
            .eq('to_user_id', userId).eq('state', 'awaiting').order('created_at', { ascending: true }).limit(20);
        if (error || !data?.length) return [];
        const pool = await TaskDatabaseService.getAllEmployees();
        return data.map(r => {
            const from = pool.find(e => e.id === r.from_user_id);
            return { id: r.id as string, title: String(r.title).replace(/\s+/g, ' ').trim(), fromName: from?.name || 'Someone', fromDepartment: from?.department_name || 'another team' };
        });
    }

    /** Remind people in other departments about open tasks I gave them (the same reminder as "Assigned by me"). */
    static async remind(actorUserId: string, taskIds: unknown) {
        const ids = Array.isArray(taskIds) ? [...new Set(taskIds.filter(isUuid))] : [];
        if (!ids.length) throw new WorkspaceError(400, 'Choose at least one task to remind about.');
        if (ids.length > 50) throw new WorkspaceError(400, 'At most 50 tasks at a time.');
        const actor = await this.actorFor(actorUserId);
        const { data, error } = await supabaseAdmin.from('task_assignments').select('id, employee_id, assigned_by').in('id', ids);
        if (error) throw new WorkspaceError(500, 'Could not read the tasks just now. Please try again.');
        const pool = await TaskDatabaseService.getAllEmployees();
        const ok = (data || []).length === ids.length && (data || []).every(t => {
            const holder = pool.find(e => e.id === t.employee_id);
            return t.assigned_by === actor.id && !!holder?.department_id && holder.department_id !== actor.department_id;
        });
        if (!ok) throw new WorkspaceError(403, 'You can only remind people in other departments about tasks you gave them.', 'NOT_ALLOWED');
        return WorkspaceService.remindTasks(actor.id, { taskIds: ids, via: 'send_tab', crossDepartment: true });
    }
}
