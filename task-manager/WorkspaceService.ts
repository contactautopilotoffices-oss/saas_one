import { randomUUID } from 'node:crypto';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { MAX_CARRY_DAYS, TaskDatabaseService, carryDaysOf } from './TaskDatabaseService';
import { ALL_TIME_FROM } from './dateRange';
import { TaskAccessService } from './TaskAccessService';
import { PermissionDeniedError, PermissionService } from './PermissionService';
import { HierarchyService } from './HierarchyService';
import { personLabel, sendTaskAssigned, sendTaskDependency, sendTaskHandover, sendTaskReminder } from './taskAlerts';
import { shortList, taskBell } from './taskBell';
import { notifyGiversOfCompletion } from './completionNotice';
import { Employee, TaskAssignment, TaskStatus } from './types';
import { NO_EXTRAS, linkTasks, loadTaskExtras } from './TaskLinks';
import { similarOpenTasks } from './taskSimilarity';
import { aiDuplicateEnabled, aiSameTask, liveDuplicateLlm } from './aiDuplicate';
import { TaskDue, checkDue, dueLabel, shortTime } from './dueDates';
import { openWithinDue, setTaskDue } from './TaskDueService';

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
    /** Owner 2026-10-19: who gave this task, when someone other than the holder created it. */
    assignedByName: string | null;
    /** Owner 2026-10-19: who handed this task over, read from its "Given by …" trail. */
    handedOverByName: string | null;
    /** When the task was created (assigned), and when it was finished (null while open). ISO timestamps. */
    createdAt: string;
    completedAt: string | null;
    /** A task given by someone else can only be deleted by the person who gave it (or a superuser). */
    canDelete: boolean;
    /** Owner 2026-10-26: the person who gave it (or a superuser) may edit its name, details, date and person. */
    canEdit: boolean;
    /** Owner 2026-10-26: the task this one follows up ("Create follow-up"). */
    followUpOf: { id: string; title: string } | null;
    /** Owner 2026-10-26: the other people given the same task at once (each finishes their own copy). */
    alsoWith: Array<{ name: string; status: TaskStatus }>;
    /** Owner 2026-10-26: how many documents or screenshots are attached. */
    attachmentCount: number;
    /** Owner 2026-10-26: made by accepting a support request from another department. */
    supportRequest: boolean;
    /** Owner 2026-10-27: the deadline; null = due on its start date (as before), no countdown. */
    due: TaskDue | null;
    /** Owner 2026-10-27: my own personal task (I hold it and nobody else gave it) — I may edit or delete its notes. */
    canEditNotes: boolean;
}

/** Owner 2026-10-26: an open task that looks like the one about to be given (the "Duplicate task alert"). */
export interface DuplicateMatch {
    userId: string;
    name: string;
    /** Only shown when the actor may see that person's tasks (or gave the task); otherwise null. */
    title: string | null;
    assignedDate: string;
    status: TaskStatus;
}

/** One row of the "Assigned by me" tab: a task I gave, or (view only) one given by someone below me. */
export interface AssignedTask {
    id: string;
    title: string;
    description: string | null;
    status: TaskStatus;
    assignedDate: string;
    createdAt: string;
    completedAt: string | null;
    holderId: string;
    holderName: string;
    assignerId: string;
    assignerName: string;
    /** True when I gave it (or I am a superuser): I may edit and delete it. Seniors only view. */
    mine: boolean;
    isCarriedForward: boolean;
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
        /** Last day shown (owner 2026-10-15: a range). Same as `date` for one day. */
        to: string;
        members: WorkspaceMember[];
        tasks: WorkspaceTask[];
        assignable: Array<{ userId: string; name: string; isMe: boolean }>;
        /** Working with a superuser: shown only when this team's switch is ON. */
        superuserCollab: { enabled: boolean; superusers: Array<{ userId: string; name: string }> };
        /** Owner 2026-10-19: colleagues I can tell "this task of mine is pending on you" (they still cannot see my tasks).
         *  Empty when the "Pending on…" switch is OFF for my department. */
        dependencyPeople: Array<{ userId: string; name: string }>;
        /** Owner 2026-10-19: per-team switches the screen needs (from the Control Center). */
        features: { assignedTab: boolean; pendingOn: boolean; dueDates: boolean };
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
    /** Owner 2026-10-15: still open from before the chosen dates. */
    isCarriedForward?: boolean;
    personName: string;
    department: string;
}

export interface ConsoleResponse {
    actor: { userId: string; name: string };
    departments: string[];
    mine: ConsoleTask[];
    given: ConsoleTask[];
}

// Owner 2026-10-15: carry-forward follows each person's DEPARTMENT setting (Notifications tab, 1–7 days or off), the same
// window the bot and the messages use — no longer a fixed 14 days here.
const CONSOLE_DONE_DAYS = 7;
const MAX_RANGE = 31;
const spanOk = (from: string, to: string) => from <= to && (from === ALL_TIME_FROM || (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 < MAX_RANGE);

export function todayIST(): string {
    const ist = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
    return `${ist.getFullYear()}-${String(ist.getMonth() + 1).padStart(2, '0')}-${String(ist.getDate()).padStart(2, '0')}`;
}

const isDate = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
/** Owner 2026-10-26: ids sent by the browser must look like ids before they reach a query. */
export const isUuid = (s: unknown): s is string => typeof s === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
/** Only messages written for people are passed on; anything else (a database error) becomes a plain sentence. */
const userMessage = (err: unknown, fallback: string) => (err instanceof WorkspaceError || err instanceof PermissionDeniedError ? err.message : fallback);

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

/** Owner 2026-10-21: an optional note given with a task (Give to / assign). One line, at most 300 characters. */
function cleanNote(note: unknown): string {
    const n = String(note ?? '').replace(/\s+/g, ' ').trim();
    if (n.length > 300) throw new WorkspaceError(400, 'The note is too long (300 characters at most).');
    return n;
}
/** How a task reads in the WhatsApp alert and the bell when it carries a note (the approved templates have no Note line). */
export const withNoteLabel = (title: string, note: string | null | undefined) => (note ? `${title} (Note: ${note})` : title);

/** The person named in the LAST "Given by <name> on <day>" line, or null. */
export function handedOverByOf(description: string | null | undefined): string | null {
    const lines = String(description || '').split('\n').map(l => l.trim()).filter(l => l.startsWith(HANDOVER_NOTE_PREFIX));
    if (!lines.length) return null;
    const rest = lines[lines.length - 1].slice(HANDOVER_NOTE_PREFIX.length);
    const at = rest.lastIndexOf(' on ');
    return (at > 0 ? rest.slice(0, at) : rest).trim() || null;
}

/** The description without the "Given by …" trail (that is shown as a badge on the card instead). */
/** Owner 2026-10-27: a personal task = I hold it and nobody else gave it. Only then may I edit or delete its notes. */
export function isPersonalTask(row: { employee_id: string; assigned_by?: string | null }, actorId: string): boolean {
    return row.employee_id === actorId && (!row.assigned_by || row.assigned_by === actorId);
}

/**
 * Owner 2026-10-27: the note lines of a description, as the task window lists them (the "Given by …" trail is not a note),
 * each with its line number in the stored text and its text without the "Remark:" prefix.
 */
export function noteLines(description: string | null | undefined): Array<{ line: number; text: string; prefixed: boolean }> {
    return String(description || '').split('\n')
        .map((raw, line) => ({ raw: raw.trim(), line }))
        .filter(x => x.raw && !x.raw.startsWith(HANDOVER_NOTE_PREFIX))
        .map(x => ({ line: x.line, text: x.raw.replace(/^Remark:\s*/i, ''), prefixed: /^Remark:/i.test(x.raw) }));
}

export function withoutHandoverNotes(description: string | null | undefined): string | null {
    const kept = String(description || '').split('\n').filter(l => !l.trim().startsWith(HANDOVER_NOTE_PREFIX)).join('\n').trim();
    return kept || null;
}

/** True when someone other than the holder created the task (a task you made for yourself is not "given"). */
export const isGivenByOther = (task: { assigned_by?: string | null; employee_id: string }) => !!task.assigned_by && task.assigned_by !== task.employee_id;

/**
 * Owner 2026-10-19: a task given by someone else can be deleted (or renamed) ONLY by the person who gave it, a superuser,
 * or someone ABOVE the giver in the reporting chain (a manager may remove a task their junior gave them), so nobody can
 * quietly remove work their senior or colleague gave them. Other tasks keep the old rule (checked separately).
 * `actorIsAboveGiver`: true when the actor is the giver's manager, direct or indirect.
 */
export function mayRemoveGivenTask(task: { assigned_by?: string | null; employee_id: string }, actor: { id: string; role: string }, actorIsAboveGiver = false): boolean {
    return !isGivenByOther(task) || task.assigned_by === actor.id || actor.role === 'superuser' || actorIsAboveGiver;
}

/**
 * Owner 2026-10-26, "Duplicate task alert": for each person, the open task that looks like `title`. First the strict word
 * check; then, only for people without a word match (at most 5, side by side), the cheap AI check for the same work in
 * other words (aiDuplicate.ts). The AI part never throws and gives up after a few seconds.
 */
export async function duplicateHits<T extends { title: string }>(title: string, people: Array<{ id: string; open: T[] }>): Promise<Map<string, T>> {
    const hits = new Map<string, T>();
    const rest: Array<{ id: string; open: T[] }> = [];
    for (const p of people) {
        const hit = similarOpenTasks(title, p.open)[0];
        if (hit) hits.set(p.id, hit);
        else if (p.open.length) rest.push(p);
    }
    if (rest.length && aiDuplicateEnabled()) {
        try {
            const llm = await liveDuplicateLlm();
            const found = await Promise.all(rest.slice(0, 5).map(async p => ({ p, i: await aiSameTask(llm, title, p.open.map(t => t.title)) })));
            for (const { p, i } of found) if (i !== null && p.open[i]) hits.set(p.id, p.open[i]);
        } catch (err) {
            console.warn('[WorkspaceService] AI duplicate check skipped:', err instanceof Error ? err.message : err);
        }
    }
    return hits;
}

/** Start of a day in India time, as an ISO timestamp. */
const istDayStart = (date: string) => new Date(`${date}T00:00:00+05:30`).toISOString();

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

    static async load(actorUserId: string, options: { date?: string; to?: string; departmentName?: string } = {}): Promise<WorkspaceResponse> {
        const date = isDate(options.date) ? options.date : todayIST();
        // Owner 2026-10-15: a date range (date … to, at most 31 days). Without `to`: one day, as before.
        const to = isDate(options.to) && spanOk(date, options.to) ? options.to : date;

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
            const select = 'id, title, description, employee_id, assigned_by, assigned_date, status, created_at, completed_at, task_template_id';
            const [today, carried, carriedDone] = await Promise.all([
                supabaseAdmin.from('task_assignments').select(select).in('employee_id', ids).gte('assigned_date', date).lte('assigned_date', to)
                    .order('assigned_date', { ascending: false }).limit(1000),   // "All time": the newest 1,000
                supabaseAdmin.from('task_assignments').select(select).in('employee_id', ids)
                    .lt('assigned_date', date).gte('assigned_date', addDays(date, -MAX_CARRY_DAYS)).neq('status', 'completed'),
                // Owner 2026-10-19: a carried-forward task finished during the days shown stays on the board (in Done),
                // instead of jumping back to the day it was first given (same rule as the WhatsApp list, isCompletedOn).
                supabaseAdmin.from('task_assignments').select(select).in('employee_id', ids)
                    .lt('assigned_date', date).gte('assigned_date', addDays(date, -MAX_CARRY_DAYS)).eq('status', 'completed')
                    .gte('completed_at', istDayStart(date)).lt('completed_at', istDayStart(addDays(to, 1))),
            ]);
            if (today.error) throw today.error;
            if (carried.error) throw carried.error;
            if (carriedDone.error) throw carriedDone.error;
            // Each person's department decides how far back their unfinished tasks are carried (or not at all).
            const daysByDept = new Map<string | null, number>();
            for (const m of members) {
                const dept = m.department_id ?? null;
                if (!daysByDept.has(dept)) daysByDept.set(dept, carryDaysOf(await TaskDatabaseService.getCarryForward(dept)));
            }
            const keepCarried = (r: { employee_id: string; assigned_date: string }) => {
                const days = daysByDept.get(byId.get(r.employee_id)?.department_id ?? null) ?? 0;
                return days > 0 && r.assigned_date >= addDays(date, -days);
            };
            // Owner 2026-10-27: a task that takes several days stays on the board until its due date (empty until the
            // due-date SQL file is applied). Listed once even when it is also a carried-forward task.
            const withinDue = await openWithinDue(ids, date, select);
            const seen = new Set<string>();
            rows = [...(today.data || []), ...(carried.data || []).filter(keepCarried), ...(carriedDone.data || []), ...withinDue]
                .filter(r => (seen.has(r.id) ? false : (seen.add(r.id), true)));
        }

        const templates = await this.templateInfo(rows.map(r => r.task_template_id));
        const { hierarchy } = await HierarchyService.load();
        const below = new Set(hierarchy.allReports(actor.id).map(p => p.userId));
        // Owner 2026-10-26: follow-up link, others on the same task, attachment count (empty until the migration runs)
        const extras = await loadTaskExtras(rows.map(r => r.id as string), id => pool.find(e => e.id === id)?.name || 'Someone');
        // Owner 2026-10-19: per-team switches. "Protect given tasks" follows the HOLDER's department.
        const feats = await TaskAccessService.getTeamFeatures();
        const protectedFor = (holderId: string) => feats.protectGiven.has(byId.get(holderId)?.department_id ?? '');
        const myFeatures = {
            assignedTab: actor.role === 'superuser' || (!!actor.department_id && feats.assignedTab.has(actor.department_id)),
            pendingOn: !!actor.department_id && feats.pendingOn.has(actor.department_id),
            dueDates: await this.mayUseDueDates(actor),
        };
        const canChange = (ownerId: string) => actor.role === 'superuser' || ownerId === actor.id || below.has(ownerId);
        const nameOf = (id: string | null | undefined) => (id ? pool.find(e => e.id === id)?.name || 'Someone' : null);

        const tasks: WorkspaceTask[] = rows
            .map(r => ({
                id: r.id as string,
                title: r.title as string,
                description: withoutHandoverNotes(r.description as string),
                ownerId: r.employee_id as string,
                ownerName: byId.get(r.employee_id)?.name || 'Unknown',
                status: r.status as TaskStatus,
                assignedDate: r.assigned_date as string,
                // Not "carried forward" while it is still within its deadline (it shows "Day 3 of 5" instead)
                isCarriedForward: (r.assigned_date as string) < date && !((extras.get(r.id as string)?.due?.date ?? '') >= date),
                canChange: canChange(r.employee_id),
                canHandOver: canHandOverTask(r, actor.id),
                locked: isLockedFor(templates.get(r.task_template_id), r.employee_id as string),
                canLock: r.employee_id === actor.id && !isTeamFixed(templates.get(r.task_template_id)),
                assignedByName: isGivenByOther(r) ? nameOf(r.assigned_by) : null,
                handedOverByName: handedOverByOf(r.description as string),
                createdAt: r.created_at as string,
                completedAt: (r.completed_at as string) || null,
                canDelete: canChange(r.employee_id) && (!protectedFor(r.employee_id) || mayRemoveGivenTask(r, actor, !!r.assigned_by && below.has(r.assigned_by))),
                canEdit: (r.assigned_by === actor.id || actor.role === 'superuser') && !isLockedFor(templates.get(r.task_template_id), r.employee_id as string),
                canEditNotes: isPersonalTask(r, actor.id),
                ...(extras.get(r.id as string) ?? NO_EXTRAS),
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
        // Owner 2026-10-19: who I may GIVE work to can be wider than who I see ("assign to anyone in team").
        const permitted = await PermissionService.assignableTo(actor, candidates);
        const unlocked = (await TaskAccessService.partition(permitted, snapshot)).allowed;
        const assignable = unlocked
            .map(e => ({ userId: e.id, name: e.name, isMe: e.id === actor.id }))
            .sort((a, b) => (a.isMe === b.isMe ? a.name.localeCompare(b.name) : a.isMe ? -1 : 1));

        // Working with a superuser: when this team has it ON, tell the screen who they can work with — a superuser who is
        // unlocked AND above them in the reporting chain (owner 2026-10-15: same rule as assertCanAssignTask).
        const collabOn = actor.role !== 'superuser' && await TaskAccessService.isSuperuserCollabEnabled(actor.department_id);
        const superusers = collabOn
            ? (await TaskAccessService.partition(await PermissionService.superusersAbove(actor, pool), snapshot)).allowed
                .map(e => ({ userId: e.id, name: e.name }))
            : [];

        // "Pending on you" (owner 2026-10-19): any unlocked colleague in my department. Only a name list; it never lets me
        // see their tasks.
        const dependencyPeople = !myFeatures.pendingOn ? [] : (await TaskAccessService.partition(
            pool.filter(e => e.id !== actor.id && e.active && !!actor.department_id && e.department_id === actor.department_id), snapshot,
        )).allowed
            .map(e => ({ userId: e.id, name: e.name }))
            .sort((a, b) => a.name.localeCompare(b.name));

        return {
            state: 'ok',
            actor: { userId: actor.id, name: actor.name, role: actor.role, departmentName: actor.department_name },
            teamSharing: await TaskAccessService.isPeerAssignEnabled(actor.department_id),
            date,
            to,
            members: memberViews,
            tasks,
            assignable,
            superuserCollab: { enabled: collabOn, superusers },
            dependencyPeople,
            features: myFeatures,
        };
    }

    /**
     * The superuser's own view across ALL departments: tasks held by them, and tasks they gave to others.
     * Open tasks of any age, plus finished ones from the last week. Superusers only.
     */
    /** With `range` (owner 2026-10-15): tasks given in that range, plus anything still open from before it (carry forward). */
    static async loadConsole(actorUserId: string, range?: { from: string; to: string }): Promise<ConsoleResponse> {
        const actor = await TaskDatabaseService.getEmployeeById(actorUserId);
        if (!actor || !actor.active) throw new WorkspaceError(403, 'Your account is not linked to an active employee profile.', 'NO_PROFILE');
        if (actor.role !== 'superuser') throw new WorkspaceError(403, 'This view is only for superusers.', 'NOT_SUPERUSER');

        const pool = await TaskDatabaseService.getAllEmployees();
        const byId = new Map(pool.map(e => [e.id, e]));
        const since = addDays(todayIST(), -CONSOLE_DONE_DAYS);
        const select = 'id, title, description, employee_id, assigned_by, assigned_date, status, task_template_id';

        const fetchSide = async (column: 'employee_id' | 'assigned_by') => {
            const r = range && isDate(range.from) && isDate(range.to) && spanOk(range.from, range.to) ? range : null;
            let open = supabaseAdmin.from('task_assignments').select(select).eq(column, actor.id).neq('status', 'completed');
            if (r) open = open.lte('assigned_date', r.to);
            let done = supabaseAdmin.from('task_assignments').select(select).eq(column, actor.id).eq('status', 'completed');
            done = r ? done.gte('assigned_date', r.from).lte('assigned_date', r.to) : done.gte('assigned_date', since);
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
                ...(range && r.status !== 'completed' && (r.assigned_date as string) < range.from ? { isCarriedForward: true } : {}),
            };
        };
        const newestFirst = (a: ConsoleTask, b: ConsoleTask) => b.assignedDate.localeCompare(a.assignedDate);
        const mine = mineRows.map(r => view(r, 'mine')).sort(newestFirst);
        const given = givenRows.map(r => view(r, 'given')).sort(newestFirst);

        // Owner 2026-10-22: the department filter lists only departments with the Task Manager switched ON (Control Center)
        const active = await TaskAccessService.activeDepartmentIds();
        const departments = Array.from(new Set(pool.filter(e => e.department_id && active.has(e.department_id)).map(e => e.department_name)
            .filter((n): n is string => !!n))).sort((a, b) => a.localeCompare(b));
        return { actor: { userId: actor.id, name: actor.name }, departments, mine, given };
    }

    /**
     * One "new task" alert for one or more tasks given to the same person (approved template, never your own list).
     * Used after `assign(..., { notify: false })` when several tasks are created together, so the person gets ONE message.
     */
    static async alertAssigned(actorUserId: string, targetUserId: string, titles: string[], date: string): Promise<void> {
        if (actorUserId === targetUserId || titles.length === 0) return;
        const [actor, target] = await Promise.all([TaskDatabaseService.getEmployeeById(actorUserId), TaskDatabaseService.getEmployeeById(targetUserId)]);
        if (!actor || !target) return;
        void taskBell({ userId: target.id, kind: 'TASK_ASSIGNED', title: `New task${titles.length === 1 ? '' : 's'} from ${actor.name}`, message: `${actor.name} gave you: ${shortList(titles)}`, departmentName: target.department_name });
        await sendTaskAssigned(target.phone_number, { titles, fromLabel: personLabel(actor.name, actor.department_name), date, departmentId: target.department_id || undefined });
    }

    /** Owner 2026-10-27: may this person set due dates? Their department's "Due dates" switch; superusers always. */
    private static async mayUseDueDates(actor: Employee): Promise<boolean> {
        return actor.role === 'superuser' || await TaskAccessService.isDueDatesEnabled(actor.department_id);
    }

    /** A deadline sent by the browser: checked against the start date and the actor's switch. null = none. */
    private static async dueFor(actor: Employee, startDate: string, dueDate: unknown, dueTime: unknown): Promise<TaskDue | null> {
        const checked = checkDue(startDate, dueDate, dueTime);
        if (!checked.ok) throw new WorkspaceError(400, checked.error);
        if (checked.due && !(await this.mayUseDueDates(actor))) throw new WorkspaceError(403, 'Due dates are switched off for your team.', 'DUE_OFF');
        // e.g. a superuser before the due-date SQL file is applied: say so before anything is saved
        if (checked.due && (await TaskAccessService.getDueDatesDepartments()).columnMissing) throw new WorkspaceError(503, 'Due dates are not set up yet. Please ask the admin to apply the latest database update.', 'NOT_READY');
        return checked.due;
    }

    static async assign(actorUserId: string, input: { targetUserId?: string; title?: string; description?: string; date?: string; notify?: boolean; note?: string; dueDate?: unknown; dueTime?: unknown }): Promise<TaskAssignment> {
        const title = (input.title || '').trim();
        if (title.length < 1 || title.length > 200) throw new WorkspaceError(400, 'Task title must be 1 to 200 characters.');
        // Owner 2026-10-21: an optional note is saved as a "Remark:" line and shown in the alert.
        const note = cleanNote(input.note);
        const description = [(input.description || '').trim(), note ? `Remark: ${note}` : ''].filter(Boolean).join('\n');
        if (description.length > 1000) throw new WorkspaceError(400, 'Details can be at most 1000 characters.');
        if (!input.targetUserId) throw new WorkspaceError(400, 'Choose who the task is for.');
        const date = isDate(input.date) ? input.date : todayIST();

        const actor = await this.requireUnlockedActor(actorUserId);
        const due = await this.dueFor(actor, date, input.dueDate, input.dueTime);

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
        // The task is saved either way; the deadline is only announced when it was really stored
        const dueSaved = due && (await setTaskDue([task.id], due)) ? due : null;
        if (due && !dueSaved) console.warn('[WorkspaceService] task saved without its due date:', task.id);

        await TaskDatabaseService.logAudit({
            eventType: 'task_assigned',
            actorId: actor.id,
            targetEmployeeId: target.id,
            taskId: task.id,
            details: { title: task.title, assignedDate: task.assigned_date, ...(dueSaved ? { dueDate: dueSaved.date, dueTime: dueSaved.time } : {}), ...(due && !dueSaved ? { dueNotSaved: true } : {}), via: 'web_tasks_tab' },
        });

        // Tell the assignee (never for your own list) with the approved template. Goes through the safety gate, so nothing is
        // sent in Pretend Mode. notify:false = the caller sends ONE grouped alert for several tasks (alertAssigned).
        if (input.notify !== false && target.id !== actor.id) {
            void taskBell({ userId: target.id, kind: 'TASK_ASSIGNED', title: `New task from ${actor.name}`, message: `${actor.name} gave you: ${withNoteLabel(task.title, note)}${dueSaved ? ` (due ${dueLabel(dueSaved)})` : ''}`, departmentName: target.department_name });
            void sendTaskAssigned(target.phone_number, { titles: [withNoteLabel(task.title, note)], fromLabel: personLabel(actor.name, actor.department_name), date: task.assigned_date, departmentId: target.department_id || undefined });
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
    static async handOver(actorUserId: string, input: { taskId?: string; targetUserId?: string; note?: string; dueDate?: unknown; dueTime?: unknown }): Promise<{ task: TaskAssignment; toName: string }> {
        if (!input.taskId) throw new WorkspaceError(400, 'Missing task.');
        if (!input.targetUserId) throw new WorkspaceError(400, 'Choose who to give the task to.');
        const giveNote = cleanNote(input.note);       // owner 2026-10-21: optional note for the new holder

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

        // Owner 2026-10-27: an optional deadline set while giving it (Due dates switch); not sent = the deadline stays as it is
        const dueSent = input.dueDate !== undefined && input.dueDate !== null && input.dueDate !== '';
        const due = dueSent ? await this.dueFor(actor, row.assigned_date as string, input.dueDate, input.dueTime) : null;

        // The new holder has not started it, so "in progress" goes back to "to do". Keep a short trail on the card.
        const newStatus: TaskStatus = row.status === 'in_progress' ? 'pending' : (row.status as TaskStatus);
        const note = `${HANDOVER_NOTE_PREFIX}${actor.name} on ${shortDay(todayIST())}`;
        const base = [((row.description as string) || '').trim(), giveNote ? `Remark: ${giveNote}` : ''].filter(Boolean).join('\n');
        const joined = base ? `${base}\n${note}` : note;
        const description = joined.length <= 1000 ? joined : base || null;

        const { data: moved, error: moveError } = await supabaseAdmin
            .from('task_assignments')
            .update({ employee_id: target.id, status: newStatus, description, updated_at: new Date().toISOString(),
                ...(due ? { due_date: due.date, due_time: due.time, due_reminded_at: null } : {}) })
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
            details: { title: row.title, assignedDate: row.assigned_date, fromUserId: actor.id, toUserId: target.id, fromStatus: row.status, toStatus: newStatus, via: 'web_tasks_tab', ...(giveNote ? { note: giveNote } : {}), ...(due ? { dueDate: due.date, dueTime: due.time } : {}) },
        });

        // Tell the receiver who gave it (names only; gated, so nothing is sent in Pretend Mode). Never blocks the hand-over.
        // Approved template, so it reaches people outside WhatsApp's 24-hour window too.
        void taskBell({ userId: target.id, kind: 'TASK_HANDOVER', title: `Task handed over by ${actor.name}`, message: `${actor.name} handed over: ${withNoteLabel(row.title, giveNote)}${due ? ` (due ${dueLabel(due)})` : ''}`, departmentName: target.department_name });
        void sendTaskHandover(target.phone_number, {
            recipientName: target.name, fromLabel: personLabel(actor.name, actor.department_name), titles: [withNoteLabel(row.title as string, giveNote)], date: row.assigned_date,
            departmentId: target.department_id || undefined,
        });

        return { task: moved as TaskAssignment, toName: target.name };
    }

    /**
     * Deletes a task for good. Allowed for whoever may change it (holder, someone above them, a superuser)
     * and for the person who assigned it. Not reversible, by request.
     */
    /** Read-only, for WhatsApp "undo": a task's current status (null when it no longer exists). */
    static async taskStatus(taskId: string): Promise<TaskStatus | null> {
        const { data } = await supabaseAdmin.from('task_assignments').select('status').eq('id', taskId).maybeSingle();
        return (data?.status as TaskStatus | undefined) ?? null;
    }

    /**
     * Read-only, for WhatsApp "undo": the newest task this person created for `assigneeId` with this title and date since
     * `since` (minus 10 s for clock differences) that has NOT been started. null when there is none.
     */
    static async findRecentlyCreated(actorUserId: string, assigneeId: string, title: string, date: string, since: string): Promise<string | null> {
        const from = new Date(new Date(since).getTime() - 10_000).toISOString();
        const { data } = await supabaseAdmin.from('task_assignments').select('id')
            .eq('assigned_by', actorUserId).eq('employee_id', assigneeId).eq('title', title).eq('assigned_date', date)
            .eq('status', 'pending').gte('created_at', from).order('created_at', { ascending: false }).limit(1);
        return (data?.[0]?.id as string | undefined) ?? null;
    }

    /**
     * Renames a task (WhatsApp "rename task 2 to …", owner request 2026-10-13). The SAME rule as deleting: your own task, a
     * task of someone below you, a superuser, or a task you gave. A task that repeats every working day is refused (its
     * name comes from the repeating task; unlock it first), exactly like delete.
     */
    static async renameTask(actorUserId: string, input: { taskId?: string; title?: string; via?: string }): Promise<{ id: string; from: string; to: string }> {
        if (!input.taskId) throw new WorkspaceError(400, 'Missing task.');
        const title = String(input.title ?? '').replace(/\s+/g, ' ').trim();
        if (!title) throw new WorkspaceError(400, 'The new name is empty.');
        if (title.length > 200) throw new WorkspaceError(400, 'The new name is too long (200 characters at most).');
        const actor = await this.requireUnlockedActor(actorUserId);

        const { data: row, error } = await supabaseAdmin.from('task_assignments').select('*').eq('id', input.taskId).maybeSingle();
        if (error || !row) throw new WorkspaceError(404, 'Task not found.');
        if (row.assigned_by !== actor.id) await PermissionService.assertCanCompleteTask(actor.id, row as TaskAssignment);
        await this.assertMayRemoveGiven(row, actor, 'rename');
        if (row.task_template_id) {
            const info = (await this.templateInfo([row.task_template_id])).get(row.task_template_id as string);
            if (isLockedFor(info, row.employee_id as string)) {
                throw new WorkspaceError(409, 'This task repeats every working day. Unlock it first, then rename it.', 'LOCKED');
            }
        }
        if (row.title === title) return { id: row.id as string, from: row.title as string, to: title };

        const { error: upError } = await supabaseAdmin.from('task_assignments').update({ title, updated_at: new Date().toISOString() }).eq('id', row.id);
        if (upError) {
            console.error('[WorkspaceService] rename failed:', upError);
            throw new WorkspaceError(500, 'Could not rename the task just now. Please try again.');
        }
        await TaskDatabaseService.logAudit({
            eventType: 'task_renamed',
            actorId: actor.id,
            targetEmployeeId: row.employee_id,
            taskId: row.id,
            details: { from: row.title, to: title, assignedDate: row.assigned_date, via: input.via ?? 'web_tasks_tab' },
        });
        await this.bellHolderOfChange(actor, row, `${actor.name} renamed your task "${row.title}" to "${title}".`);
        return { id: row.id as string, from: row.title as string, to: title };
    }

    /**
     * Owner 2026-10-20 (WhatsApp "add note to onboarding: documents pending"): adds a "Remark: …" line to a task's details.
     * Allowed for the person who holds the task, the person who gave it, anyone above the holder, or a superuser. A note
     * removes nothing, so "Protect given tasks" does not block it. The "Given by …" trail is kept as it is.
     */
    /**
     * Owner 2026-10-27: edit (text) or delete (text null) one note of MY personal task. `index` is the note's place in the task
     * window's list and `expected` its text there, so a note that changed meanwhile is never overwritten. The update only goes
     * through if the stored text is still the one just read.
     */
    static async changeNote(actorUserId: string, input: { taskId?: unknown; index?: unknown; expected?: unknown; text?: unknown }): Promise<{ id: string }> {
        if (!isUuid(input.taskId)) throw new WorkspaceError(400, 'That task is not valid.');
        if (typeof input.index !== 'number' || !Number.isInteger(input.index) || input.index < 0 || typeof input.expected !== 'string') throw new WorkspaceError(400, 'That note is not valid.');
        const remove = input.text === null;
        const text = remove ? '' : String(input.text ?? '').replace(/\s+/g, ' ').trim();
        if (!remove && !text) throw new WorkspaceError(400, 'The note is empty. Delete it instead.');
        if (text.length > 300) throw new WorkspaceError(400, 'The note is too long (300 characters at most).');
        const actor = await this.requireUnlockedActor(actorUserId);

        const { data: row, error } = await supabaseAdmin.from('task_assignments').select('*').eq('id', input.taskId).maybeSingle();
        if (error || !row) throw new WorkspaceError(404, 'Task not found.');
        if (!isPersonalTask(row as { employee_id: string; assigned_by: string | null }, actor.id)) {
            throw new WorkspaceError(403, 'Notes can only be changed on your own personal tasks.', 'NOT_PERSONAL');
        }
        const notes = noteLines(row.description as string | null);
        const target = notes[input.index];
        if (!target || target.text !== input.expected.trim()) throw new WorkspaceError(409, 'This note changed just now. Please refresh and try again.', 'CHANGED');

        const lines = String(row.description).split('\n');
        if (remove) lines.splice(target.line, 1);
        else lines[target.line] = target.prefixed ? `Remark: ${text}` : text;
        const description = lines.join('\n').trim() || null;

        const { data: saved, error: upError } = await supabaseAdmin.from('task_assignments')
            .update({ description, updated_at: new Date().toISOString() })
            .eq('id', row.id).eq('employee_id', actor.id).eq('description', row.description as string).select('id').maybeSingle();
        if (upError) {
            console.error('[WorkspaceService] note change failed:', upError);
            throw new WorkspaceError(500, 'Could not save the note just now. Please try again.');
        }
        if (!saved) throw new WorkspaceError(409, 'This task changed just now. Please refresh and try again.', 'CHANGED');
        await TaskDatabaseService.logAudit({
            eventType: remove ? 'task_note_deleted' : 'task_note_edited',
            actorId: actor.id, targetEmployeeId: row.employee_id, taskId: row.id,
            details: { title: row.title, from: target.text, ...(remove ? {} : { to: text }), via: 'web_tasks_tab' },
        });
        return { id: row.id as string };
    }

    static async addNote(actorUserId: string, input: { taskId?: string; note?: string; via?: string; tellGiver?: boolean }): Promise<{ id: string }> {
        if (!input.taskId) throw new WorkspaceError(400, 'Missing task.');
        const note = String(input.note ?? '').replace(/\s+/g, ' ').trim();
        if (!note) throw new WorkspaceError(400, 'The note is empty.');
        if (note.length > 300) throw new WorkspaceError(400, 'The note is too long (300 characters at most).');
        const actor = await this.requireUnlockedActor(actorUserId);

        const { data: row, error } = await supabaseAdmin.from('task_assignments').select('*').eq('id', input.taskId).maybeSingle();
        if (error || !row) throw new WorkspaceError(404, 'Task not found.');
        if (row.assigned_by !== actor.id) await PermissionService.assertCanCompleteTask(actor.id, row as TaskAssignment);

        const before = String(row.description || '').trim();
        const description = before ? `${before}\nRemark: ${note}` : `Remark: ${note}`;
        if (description.length > 1000) throw new WorkspaceError(400, 'This task already has a lot of notes. Please edit it in the Tasks tab.');

        const { error: upError } = await supabaseAdmin.from('task_assignments').update({ description, updated_at: new Date().toISOString() }).eq('id', row.id);
        if (upError) {
            console.error('[WorkspaceService] add note failed:', upError);
            throw new WorkspaceError(500, 'Could not add the note just now. Please try again.');
        }
        await TaskDatabaseService.logAudit({
            eventType: 'task_note_added',
            actorId: actor.id,
            targetEmployeeId: row.employee_id,
            taskId: row.id,
            details: { title: row.title, note, assignedDate: row.assigned_date, via: input.via ?? 'web_tasks_tab' },
        });
        await this.bellHolderOfChange(actor, row, `${actor.name} added a note to "${row.title}": ${note}`);
        // Owner 2026-10-26: a remark the holder adds (e.g. after finishing) also reaches the person who gave the task, in the
        // app. Not on WhatsApp: the approved "task done" template has no place for it.
        if (input.tellGiver && row.employee_id === actor.id && row.assigned_by && row.assigned_by !== actor.id) {
            const giver = await TaskDatabaseService.getEmployeeById(row.assigned_by as string).catch(() => null);
            if (giver?.active) void taskBell({ userId: giver.id, kind: 'TASK_UPDATE', title: `Remark from ${actor.name}`, message: `${actor.name} on "${row.title}": ${note}`, departmentName: giver.department_name });
        }
        return { id: row.id as string };
    }

    /** Owner 2026-10-20: open tasks this person gave other people in the last `days` days (for WhatsApp "add note to …"). */
    static async openTasksGivenBy(giverId: string, days = 30): Promise<Array<{ id: string; title: string; employee_id: string; assigned_date: string }>> {
        const since = addDays(todayIST(), -days);
        const { data, error } = await supabaseAdmin.from('task_assignments').select('id, title, employee_id, assigned_by, assigned_date')
            .eq('assigned_by', giverId).neq('employee_id', giverId).neq('status', 'completed').gte('assigned_date', since)
            .order('assigned_date', { ascending: false }).limit(200);
        if (error) { console.error('[WorkspaceService] could not read tasks given:', error); return []; }
        return (data || []) as Array<{ id: string; title: string; employee_id: string; assigned_date: string }>;
    }

    static async deleteTask(actorUserId: string, input: { taskId?: string; via?: string }): Promise<{ id: string }> {
        if (!input.taskId) throw new WorkspaceError(400, 'Missing task.');
        const actor = await this.requireUnlockedActor(actorUserId);

        const { data: row, error } = await supabaseAdmin.from('task_assignments').select('*').eq('id', input.taskId).maybeSingle();
        if (error || !row) throw new WorkspaceError(404, 'Task not found.');

        // Throws PermissionDeniedError unless: own task, a task of someone below you, you are a superuser, or you assigned it
        if (row.assigned_by !== actor.id) await PermissionService.assertCanCompleteTask(actor.id, row as TaskAssignment);
        // Owner 2026-10-19: a task someone else gave can only be deleted by them (or a superuser).
        await this.assertMayRemoveGiven(row, actor, 'delete');

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
            details: { title: row.title, assignedDate: row.assigned_date, status: row.status, via: input.via ?? 'web_tasks_tab' },
        });

        const { error: delError } = await supabaseAdmin.from('task_assignments').delete().eq('id', row.id);
        if (delError) {
            console.error('[WorkspaceService] delete failed:', delError);
            throw new WorkspaceError(500, 'Could not delete the task just now. Please try again.');
        }
        await this.bellHolderOfChange(actor, row, `${actor.name} deleted your task "${row.title}".`);
        return { id: row.id as string };
    }

    /** Owner 2026-10-20: tell the person holding a task (bell + push) when SOMEONE ELSE changed it. Never throws. */
    private static async bellHolderOfChange(actor: Employee, row: { employee_id: string }, message: string): Promise<void> {
        if (row.employee_id === actor.id) return;
        const holder = await TaskDatabaseService.getEmployeeById(row.employee_id).catch(() => null);
        if (!holder || !holder.active) return;
        void taskBell({ userId: holder.id, kind: 'TASK_CHANGED', title: `${actor.name} changed your task`, message, departmentName: holder.department_name });
    }

    /** Refuses when the task was given by someone else and the actor is neither that person nor a superuser. */
    private static async assertMayRemoveGiven(row: { assigned_by?: string | null; employee_id: string }, actor: Employee, verb: 'delete' | 'rename' | 'edit'): Promise<void> {
        if (mayRemoveGivenTask(row, actor)) return;
        // Owner 2026-10-19: only for teams where "Protect given tasks" is switched ON (the holder's department).
        const holder = await TaskDatabaseService.getEmployeeById(row.employee_id);
        if (!(await TaskAccessService.teamFeaturesFor(holder?.department_id)).protectGiven) return;
        if (row.assigned_by) {
            const { hierarchy } = await HierarchyService.load();
            if (mayRemoveGivenTask(row, actor, hierarchy.isAbove(actor.id, row.assigned_by))) return;
        }
        const giver = row.assigned_by ? await TaskDatabaseService.getEmployeeById(row.assigned_by) : null;
        const who = giver?.name || 'the person who gave it';
        throw new WorkspaceError(403, `This task was given by ${who}, so only ${who} can ${verb} it.`, 'GIVEN_BY_OTHER');
    }

    /**
     * Owner 2026-10-19, "Assigned by me": tasks I gave to other people (I may edit and delete them), plus tasks given by
     * anyone below me in the reporting chain (view only). Open tasks given up to `to`, and tasks finished in the range.
     */
    static async loadAssigned(actorUserId: string, range?: { from?: string; to?: string }): Promise<{ tasks: AssignedTask[] }> {
        const actor = await this.requireUnlockedActor(actorUserId);
        if (actor.role !== 'superuser' && !(await TaskAccessService.teamFeaturesFor(actor.department_id)).assignedTab) {
            throw new WorkspaceError(403, 'The "Assigned by me" tab is not switched on for your team.', 'FEATURE_OFF');
        }
        const to = isDate(range?.to) ? range!.to : todayIST();
        const from = isDate(range?.from) && spanOk(range!.from, to) ? range!.from : to;

        const { hierarchy } = await HierarchyService.load();
        const below = hierarchy.allReports(actor.id).map(p => p.userId);
        const givers = [actor.id, ...below];
        const select = 'id, title, description, employee_id, assigned_by, assigned_date, status, created_at, completed_at';
        const lookback = addDays(from, -MAX_CARRY_DAYS);

        const [open, done] = await Promise.all([
            supabaseAdmin.from('task_assignments').select(select).in('assigned_by', givers).neq('status', 'completed')
                .lte('assigned_date', to).gte('assigned_date', from === ALL_TIME_FROM ? from : lookback).limit(1000),
            supabaseAdmin.from('task_assignments').select(select).in('assigned_by', givers).eq('status', 'completed')
                .gte('assigned_date', from === ALL_TIME_FROM ? from : lookback).lte('assigned_date', to)
                .or(`assigned_date.gte.${from},completed_at.gte.${istDayStart(from)}`).limit(1000),
        ]);
        if (open.error) throw open.error;
        if (done.error) throw done.error;

        const pool = await TaskDatabaseService.getAllEmployees();
        const nameOf = (id: string) => pool.find(e => e.id === id)?.name || 'Unknown';
        const tasks: AssignedTask[] = [...(open.data || []), ...(done.data || [])]
            .filter(r => isGivenByOther(r))
            .map(r => ({
                id: r.id as string,
                title: r.title as string,
                description: withoutHandoverNotes(r.description as string),
                status: r.status as TaskStatus,
                assignedDate: r.assigned_date as string,
                createdAt: r.created_at as string,
                completedAt: (r.completed_at as string) || null,
                holderId: r.employee_id as string,
                holderName: nameOf(r.employee_id as string),
                assignerId: r.assigned_by as string,
                assignerName: r.assigned_by === actor.id ? 'You' : nameOf(r.assigned_by as string),
                mine: r.assigned_by === actor.id || actor.role === 'superuser',
                isCarriedForward: (r.assigned_date as string) < from && from !== ALL_TIME_FROM,
            }))
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        return { tasks };
    }

    /**
     * Owner 2026-10-19: the person who gave a task (or a superuser) changes its name and details ("Assigned by me").
     * Owner 2026-10-26: also its date and the person doing it (the task window's Edit). A new person must be someone the
     * giver may assign to and who can use the Task Manager; they are told like any new task, and the old holder gets a bell.
     */
    /** Owner 2026-10-27: `dueDate` undefined = keep the deadline; null or '' = remove it; `dueTime` goes with it. */
    static async editTask(actorUserId: string, input: { taskId?: string; title?: string; description?: string; date?: string; targetUserId?: string; via?: string; dueDate?: unknown; dueTime?: unknown }): Promise<{ id: string }> {
        if (!input.taskId) throw new WorkspaceError(400, 'Missing task.');
        // Owner 2026-10-26: a name or details not sent stay as they are (WhatsApp changes only the date or the person)
        const keepTitle = input.title === undefined, keepDetails = input.description === undefined;
        const newTitle = String(input.title ?? '').replace(/\s+/g, ' ').trim();
        if (!keepTitle && !newTitle) throw new WorkspaceError(400, 'The task name is empty.');
        if (newTitle.length > 200) throw new WorkspaceError(400, 'The task name is too long (200 characters at most).');
        const details = String(input.description ?? '').trim();
        if (details.length > 900) throw new WorkspaceError(400, 'Details can be at most 900 characters.');
        if (input.date && !isDate(input.date)) throw new WorkspaceError(400, 'That date is not valid.');
        if (!isUuid(input.taskId) || (input.targetUserId && !isUuid(input.targetUserId))) throw new WorkspaceError(400, 'That task or person is not valid.');
        const actor = await this.requireUnlockedActor(actorUserId);

        const { data: row, error } = await supabaseAdmin.from('task_assignments').select('*').eq('id', input.taskId).maybeSingle();
        if (error || !row) throw new WorkspaceError(404, 'Task not found.');
        const title = keepTitle ? (row.title as string) : newTitle;
        if (row.assigned_by !== actor.id && actor.role !== 'superuser') {
            throw new WorkspaceError(403, 'Only the person who gave this task can edit it.', 'NOT_GIVER');
        }
        // Owner 2026-10-22: superusers keep their tasks private from each other, so one never edits or moves the other's
        if (row.assigned_by !== actor.id) {
            const holder = await TaskDatabaseService.getEmployeeById(row.employee_id as string);
            if (holder && PermissionService.hiddenFrom(actor, holder)) throw new WorkspaceError(403, 'Only the person who gave this task can edit it.', 'NOT_GIVER');
        }
        if (row.task_template_id) {
            const info = (await this.templateInfo([row.task_template_id])).get(row.task_template_id as string);
            if (isLockedFor(info, row.employee_id as string)) {
                throw new WorkspaceError(409, 'This task repeats every working day. It has to be unlocked before it can be edited.', 'LOCKED');
            }
        }

        // A different person: the same checks as giving them a new task
        let target: Employee | null = null;
        if (input.targetUserId && input.targetUserId !== row.employee_id) {
            if (row.status === 'completed') throw new WorkspaceError(409, 'This task is already done, so it cannot move to someone else.', 'ALREADY_DONE');
            ({ target } = await PermissionService.assertCanAssignTask(actor.id, input.targetUserId));
            const targetAccess = await TaskAccessService.check({ userId: target.id, departmentId: target.department_id });
            if (!targetAccess.allowed) throw new WorkspaceError(409, `Cannot give a task to ${target.name}: ${targetAccess.message}`, 'TARGET_LOCKED');
        }
        const date = isDate(input.date) ? input.date : (row.assigned_date as string);

        // The deadline: changed only when sent; never before the (new) start date
        const oldDue: TaskDue | null = row.due_date ? { date: row.due_date as string, time: shortTime(row.due_time as string | null) } : null;
        const dueSent = input.dueDate !== undefined;
        const newDue = dueSent ? await this.dueFor(actor, date, input.dueDate, input.dueTime) : oldDue;
        if (!dueSent && oldDue && oldDue.date < date) throw new WorkspaceError(400, 'The due date cannot be before the start date. Change the due date too.');
        const dueChanged = (oldDue?.date ?? null) !== (newDue?.date ?? null) || (oldDue?.time ?? null) !== (newDue?.time ?? null);

        // Keep the "Given by …" trail, so the holder's card still shows who handed it over.
        const trail = String(row.description || '').split('\n').filter(l => l.trim().startsWith(HANDOVER_NOTE_PREFIX));
        const description = keepDetails ? ((row.description as string | null) ?? null) : ([details, ...trail].filter(Boolean).join('\n').slice(0, 1000) || null);

        const update: Record<string, unknown> = { title, description, assigned_date: date, updated_at: new Date().toISOString() };
        if (dueChanged) Object.assign(update, { due_date: newDue?.date ?? null, due_time: newDue?.time ?? null, due_reminded_at: null });
        // The new person has not started it, so "in progress" goes back to "to do" (same as a hand-over)
        if (target) Object.assign(update, { employee_id: target.id, status: row.status === 'in_progress' ? 'pending' : row.status });

        // Only if nobody changed the task meanwhile (e.g. the holder just finished it): never undo their change
        const { data: saved, error: upError } = await supabaseAdmin.from('task_assignments').update(update)
            .eq('id', row.id).eq('employee_id', row.employee_id).eq('status', row.status).select('id').maybeSingle();
        if (upError) {
            if ((upError as { code?: string }).code === '23505') throw new WorkspaceError(409, 'That person already has a task with this name for that day.', 'ALREADY_THERE');
            console.error('[WorkspaceService] edit failed:', upError);
            throw new WorkspaceError(500, 'Could not save the task just now. Please try again.');
        }
        if (!saved) throw new WorkspaceError(409, 'This task changed just now. Please refresh and try again.', 'CHANGED');
        await TaskDatabaseService.logAudit({
            eventType: 'task_edited',
            actorId: actor.id,
            targetEmployeeId: target?.id ?? row.employee_id,
            taskId: row.id,
            details: {
                fromTitle: row.title, toTitle: title, assignedDate: row.assigned_date,
                ...(date !== row.assigned_date ? { toDate: date } : {}),
                ...(dueChanged ? { fromDue: oldDue, toDue: newDue } : {}),
                ...(target ? { fromUserId: row.employee_id, toUserId: target.id } : {}),
                via: input.via ?? 'web_tasks_tab',
            },
        });

        if (target) {
            // The new person is told like any new task (approved template; gated, so nothing is sent in Pretend Mode)
            if (target.id !== actor.id) {
                void taskBell({ userId: target.id, kind: 'TASK_ASSIGNED', title: `New task from ${actor.name}`, message: `${actor.name} gave you: ${title}`, departmentName: target.department_name });
                void sendTaskAssigned(target.phone_number, { titles: [title], fromLabel: personLabel(actor.name, actor.department_name), date, departmentId: target.department_id || undefined });
            }
            await this.bellHolderOfChange(actor, row, `${actor.name} moved your task "${row.title}" to ${target.name}.`);
        } else {
            const changes = [
                title !== row.title ? `now "${title}"` : '', date !== row.assigned_date ? `date ${shortDay(date)}` : '',
                dueChanged ? (newDue ? `due ${dueLabel(newDue)}` : 'no due date') : '',
            ].filter(Boolean).join(', ');
            await this.bellHolderOfChange(actor, row, `${actor.name} edited your task "${row.title}"${changes ? ` (${changes})` : ''}.`);
        }
        return { id: row.id as string };
    }

    /**
     * Owner 2026-10-26, "Duplicate task alert": for each person, their open tasks that look like this title. The title of
     * the matching task is only returned when the actor may see that person's tasks (themself, someone below them, a
     * superuser) or gave that task; otherwise only the fact that one exists.
     */
    static async findDuplicates(actorUserId: string, input: { targetUserIds?: unknown; title?: string }): Promise<{ matches: DuplicateMatch[] }> {
        const title = String(input.title ?? '').trim().slice(0, 200);
        const ids = Array.isArray(input.targetUserIds) ? [...new Set(input.targetUserIds.filter(isUuid))] : [];
        if (!title || ids.length === 0) return { matches: [] };
        if (ids.length > 50) throw new WorkspaceError(400, 'At most 50 people at a time.');
        const actor = await this.requireUnlockedActor(actorUserId);

        // Only people this actor may give work to (the same rule as assigning); never another superuser's private tasks
        const pool = await TaskDatabaseService.getAllEmployees();
        const allowed = new Set((await PermissionService.assignableTo(actor, pool.filter(e => ids.includes(e.id)))).map(e => e.id));
        const people = pool.filter(e => allowed.has(e.id) && !PermissionService.hiddenFrom(actor, e));
        if (people.length === 0) return { matches: [] };

        const { data, error } = await supabaseAdmin.from('task_assignments').select('id, title, employee_id, assigned_by, assigned_date, status')
            .in('employee_id', people.map(p => p.id)).neq('status', 'completed').gte('assigned_date', addDays(todayIST(), -30))
            .order('assigned_date', { ascending: false }).limit(1000);
        if (error) {
            console.error('[WorkspaceService] duplicate check failed:', error);
            throw new WorkspaceError(500, 'Could not check for similar tasks just now.');
        }

        const { hierarchy } = await HierarchyService.load();
        const below = new Set(hierarchy.allReports(actor.id).map(p => p.userId));
        type OpenRow = { title: string; assigned_by: string | null; assigned_date: string; status: TaskStatus };
        const openOf = (id: string) => (data || []).filter(r => r.employee_id === id) as OpenRow[];
        const hits = await duplicateHits(title, people.map(p => ({ id: p.id, open: openOf(p.id) })));
        const matches: DuplicateMatch[] = [];
        for (const person of people) {
            const hit = hits.get(person.id);
            if (!hit) continue;
            const mayRead = person.id === actor.id || actor.role === 'superuser' || below.has(person.id) || hit.assigned_by === actor.id;
            matches.push({ userId: person.id, name: person.name, title: mayRead ? hit.title : null, assignedDate: hit.assigned_date, status: hit.status });
        }
        return { matches };
    }

    /**
     * Owner 2026-10-26: one task for several people (each gets their own copy and finishes it separately), optionally as a
     * follow-up of an earlier task. Each copy goes through `assign` (same permission checks and alerts as one task). One
     * person failing does not stop the others; the caller is told who got it and who did not.
     */
    static async assignMany(actorUserId: string, input: { targetUserIds?: unknown; title?: string; description?: string; date?: string; followUpOf?: string | null; via?: string; dueDate?: unknown; dueTime?: unknown }): Promise<{
        created: Array<{ id: string; userId: string; name: string }>;
        failed: Array<{ userId: string; name: string; error: string }>;
        linked: boolean;
    }> {
        const ids = Array.isArray(input.targetUserIds) ? [...new Set(input.targetUserIds.filter(isUuid))] : [];
        if (ids.length === 0) throw new WorkspaceError(400, 'Choose who the task is for.');
        if (input.followUpOf && !isUuid(input.followUpOf)) throw new WorkspaceError(400, 'The task this follows up is not valid.');
        if (ids.length > 50) throw new WorkspaceError(400, 'At most 50 people at a time.');
        const actor = await this.requireUnlockedActor(actorUserId);

        // A follow-up must point at a task this person may see: theirs, one they gave, or one they may change.
        let followUpOf: string | null = null;
        if (input.followUpOf) {
            const { data: parent, error: parentError } = await supabaseAdmin.from('task_assignments').select('*').eq('id', input.followUpOf).maybeSingle();
            if (parentError) throw new WorkspaceError(500, 'Could not read the task this follows up just now. Please try again.');
            if (!parent) throw new WorkspaceError(404, 'The task this follows up no longer exists.');
            if (parent.assigned_by !== actor.id) await PermissionService.assertCanCompleteTask(actor.id, parent as TaskAssignment);
            followUpOf = parent.id as string;
        }

        const created: Array<{ id: string; userId: string; name: string }> = [];
        const failed: Array<{ userId: string; name: string; error: string }> = [];
        for (const userId of ids) {
            try {
                const task = await this.assign(actor.id, { targetUserId: userId, title: input.title, description: input.description, date: input.date, dueDate: input.dueDate, dueTime: input.dueTime });
                const who = await TaskDatabaseService.getEmployeeById(userId);
                created.push({ id: task.id, userId, name: who?.name || 'Someone' });
            } catch (err) {
                // Bad input fails the same way for everyone: stop at once instead of repeating it per person
                if (err instanceof WorkspaceError && err.status === 400) throw err;
                const who = await TaskDatabaseService.getEmployeeById(userId).catch(() => null);
                if (!(err instanceof WorkspaceError || err instanceof PermissionDeniedError)) console.error('[WorkspaceService] assign failed:', err);
                failed.push({ userId, name: who?.name || 'Someone', error: userMessage(err, 'Could not give the task just now.') });
            }
        }

        const groupId = created.length > 1 ? randomUUID() : null;
        const linked = await linkTasks(created.map(c => c.id), { followUpOf, groupId });
        if (created.length && (followUpOf || groupId)) {
            await TaskDatabaseService.logAudit({
                eventType: 'task_assigned_group',
                actorId: actor.id,
                details: { title: input.title, taskIds: created.map(c => c.id), followUpOf, groupId, linked, via: input.via ?? 'web_tasks_tab' },
            });
        }
        return { created, failed, linked };
    }

    /**
     * Owner 2026-10-19, "Pending on you": I tell a colleague that one of MY open tasks is waiting on them. They get an
     * in-app notification and a WhatsApp alert (approved template; kill switches and Pretend Mode apply). It does NOT
     * give them my task or let them see my board. At most once an hour for the same task and person.
     */
    static async flagDependency(actorUserId: string, input: { taskId?: string; targetUserId?: string }): Promise<{ toName: string }> {
        if (!input.taskId) throw new WorkspaceError(400, 'Missing task.');
        if (!input.targetUserId) throw new WorkspaceError(400, 'Choose who the task is pending on.');
        const actor = await this.requireUnlockedActor(actorUserId);
        if (!(await TaskAccessService.teamFeaturesFor(actor.department_id)).pendingOn) {
            throw new WorkspaceError(403, '"Pending on" is not switched on for your team.', 'FEATURE_OFF');
        }
        if (input.targetUserId === actor.id) throw new WorkspaceError(400, 'Choose a colleague, not yourself.', 'SAME_PERSON');

        const { data: row, error } = await supabaseAdmin.from('task_assignments').select('*').eq('id', input.taskId).maybeSingle();
        if (error || !row) throw new WorkspaceError(404, 'Task not found.');
        if (row.employee_id !== actor.id) throw new WorkspaceError(403, 'You can only flag your own tasks.', 'NOT_HOLDER');
        if (row.status === 'completed') throw new WorkspaceError(409, 'This task is already done.', 'ALREADY_DONE');

        const target = await TaskDatabaseService.getEmployeeById(input.targetUserId);
        if (!target || !target.active || !actor.department_id || target.department_id !== actor.department_id) {
            throw new WorkspaceError(403, 'You can only flag a colleague from your own team.', 'NOT_ALLOWED');
        }
        const targetAccess = await TaskAccessService.check({ userId: target.id, departmentId: target.department_id });
        if (!targetAccess.allowed) throw new WorkspaceError(409, `${target.name} cannot use the Task Manager yet: ${targetAccess.message}`, 'TARGET_LOCKED');

        const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
        const { data: recent } = await supabaseAdmin.from('task_audit_logs').select('id')
            .eq('event_type', 'task_dependency_flagged').eq('task_id', row.id).eq('target_employee_id', target.id).gte('created_at', hourAgo).limit(1);
        if (recent && recent.length) throw new WorkspaceError(429, `${target.name} was already told about this task in the last hour.`, 'TOO_SOON');

        await TaskDatabaseService.logAudit({
            eventType: 'task_dependency_flagged',
            actorId: actor.id,
            targetEmployeeId: target.id,
            taskId: row.id,
            details: { title: row.title, assignedDate: row.assigned_date, via: 'web_tasks_tab' },
        });

        // In the app (bell + push). Never blocks the request.
        void taskBell({ userId: target.id, kind: 'TASK_DEPENDENCY', title: 'A task is pending on you', message: `${actor.name}'s task "${row.title}" is pending on you.`, departmentName: target.department_name });

        // WhatsApp (gated: nothing is sent while Pretend Mode is ON).
        void sendTaskDependency(target.phone_number, {
            recipientName: target.name, fromLabel: personLabel(actor.name, actor.department_name), titles: [row.title as string],
            departmentId: target.department_id || undefined,
        });

        return { toName: target.name };
    }

    /**
     * Owner 2026-10-20 — "Remind": the person who GAVE tasks reminds the people doing them that they are still pending.
     * Works where the "Assigned by me" switch is ON (superusers always). Only open tasks this person gave someone else
     * (a superuser: any open task given to someone). Each task at most once an hour. ONE in-app notice and ONE WhatsApp
     * message per person, listing their tasks ("Onboarding (given 19 Oct, 1 day overdue)"). Nothing about the tasks changes.
     */
    static async remindTasks(actorUserId: string, input: { taskIds?: unknown; via?: string; /** Owner 2026-10-26: server-only, set by CollaborationService after it checked that every task was given by the actor to someone in another department. */ crossDepartment?: boolean }): Promise<{ reminded: Array<{ name: string; count: number }>; skipped: Array<{ title: string; why: string }> }> {
        const ids = Array.isArray(input.taskIds) ? [...new Set(input.taskIds.filter((x): x is string => typeof x === 'string' && x.length > 0))] : [];
        if (!ids.length) throw new WorkspaceError(400, 'Choose at least one task to remind about.');
        if (ids.length > 50) throw new WorkspaceError(400, 'At most 50 tasks at a time.');
        const actor = await this.requireUnlockedActor(actorUserId);
        const isSuper = actor.role === 'superuser';
        if (!isSuper && !input.crossDepartment && !(await TaskAccessService.teamFeaturesFor(actor.department_id)).assignedTab) {
            throw new WorkspaceError(403, 'Reminders come with the "Assigned by me" tab, which is not switched on for your team.', 'FEATURE_OFF');
        }

        const { data: rows, error } = await supabaseAdmin.from('task_assignments').select('id, title, employee_id, assigned_by, assigned_date, status').in('id', ids);
        if (error) throw error;
        const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
        const { data: recent } = await supabaseAdmin.from('task_audit_logs').select('task_id').eq('event_type', 'task_reminded').in('task_id', ids).gte('created_at', hourAgo);
        const recentIds = new Set((recent || []).map(r => r.task_id as string));

        const today = todayIST();
        const skipped: Array<{ title: string; why: string }> = [];
        const byHolder = new Map<string, Array<{ id: string; title: string; assigned_date: string }>>();
        for (const id of ids) {
            const r = (rows || []).find(x => x.id === id);
            if (!r) { skipped.push({ title: 'A task', why: 'not found' }); continue; }
            const title = r.title as string;
            if (r.employee_id === actor.id || !(r.assigned_by === actor.id || (isSuper && isGivenByOther(r)))) { skipped.push({ title, why: 'you did not give this task' }); continue; }
            if (r.status === 'completed') { skipped.push({ title, why: 'already done' }); continue; }
            if (recentIds.has(id)) { skipped.push({ title, why: 'already reminded in the last hour' }); continue; }
            const list = byHolder.get(r.employee_id as string) ?? [];
            list.push({ id, title, assigned_date: r.assigned_date as string });
            byHolder.set(r.employee_id as string, list);
        }

        const line = (t: { title: string; assigned_date: string }) => {
            const late = Math.round((Date.parse(`${today}T12:00:00Z`) - Date.parse(`${t.assigned_date}T12:00:00Z`)) / 86400000);
            return late > 0 ? `${t.title} (given ${shortDay(t.assigned_date)}, ${late} day${late === 1 ? '' : 's'} overdue)` : t.title;
        };
        const reminded: Array<{ name: string; count: number }> = [];
        for (const [holderId, tasks] of byHolder) {
            const holder = await TaskDatabaseService.getEmployeeById(holderId);
            if (!holder || !holder.active) { tasks.forEach(t => skipped.push({ title: t.title, why: 'that person is no longer active' })); continue; }
            for (const t of tasks) {
                await TaskDatabaseService.logAudit({
                    eventType: 'task_reminded', actorId: actor.id, targetEmployeeId: holder.id, taskId: t.id,
                    details: { title: t.title, assignedDate: t.assigned_date, via: input.via ?? 'web_tasks_tab' },
                });
            }
            const lines = tasks.map(line);
            // In the app (bell + push). Never blocks the request.
            void taskBell({ userId: holder.id, kind: 'TASK_REMINDER', title: `Reminder from ${actor.name}`, message: `${actor.name} is waiting on: ${lines.join('; ')}`, departmentName: holder.department_name });
            // WhatsApp (gated: nothing is sent while Pretend Mode is ON).
            void sendTaskReminder(holder.phone_number, {
                recipientName: holder.name, fromLabel: personLabel(actor.name, actor.department_name), titles: lines,
                departmentId: holder.department_id || undefined,
            });
            reminded.push({ name: holder.name, count: tasks.length });
        }
        return { reminded, skipped };
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
     * Someone finished a task another person gave them: tell the giver (approved template task_completed_notice_v1, every
     * completion — owner decision 2026-10-12). Rules (once an hour per task, grouping, never throws) live in completionNotice.ts.
     */
    private static async notifyAssignerOfCompletion(row: any): Promise<void> {
        await notifyGiversOfCompletion([row]);
    }

    /** One grouped completion notice for tasks that were completed quietly (`notifyGiver: false`), e.g. "done all". */
    static async notifyCompleted(taskIds: string[]): Promise<number> {
        if (!taskIds.length) return 0;
        const { data } = await supabaseAdmin.from('task_assignments').select('id, title, employee_id, assigned_by, status').in('id', taskIds);
        return notifyGiversOfCompletion((data || []).filter(r => r.status === 'completed') as any[]);
    }

    static async setStatus(actorUserId: string, input: { taskId?: string; status?: string; notifyGiver?: boolean }): Promise<TaskAssignment> {
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

        // notifyGiver:false → the caller sends ONE grouped notice (or a superuser's reply is relayed instead).
        if (input.status === 'completed' && row.status !== 'completed' && input.notifyGiver !== false) await this.notifyAssignerOfCompletion(row);

        return updated;
    }
}
