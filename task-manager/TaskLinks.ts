import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { TaskStatus } from './types';
import { TaskDue, shortTime } from './dueDates';

/**
 * Owner 2026-10-26: what a task card shows beyond its own row — the task it follows up, the other people given the same
 * task at the same time, and how many files are attached.
 *
 * These live in columns and a table added by 20261026000003_task_manager_upgrades.sql. Until that migration is applied,
 * every read here returns "nothing" and every link write is skipped (logged once), so the board keeps working as before.
 */

export interface TaskExtras {
    followUpOf: { id: string; title: string } | null;
    alsoWith: Array<{ name: string; status: TaskStatus }>;
    attachmentCount: number;
    /** Owner 2026-10-26: made by accepting a support request from another department. */
    supportRequest: boolean;
    /** Owner 2026-10-27: the deadline (20261027100001_task_manager_due_dates.sql); null = due on its start date, as before. */
    due: TaskDue | null;
    /** 2026-10-29: imported from Zoho Mail (20261029200001_task_manager_zoho_tasks.sql). */
    fromZoho: boolean;
}

export const NO_EXTRAS: TaskExtras = { followUpOf: null, alsoWith: [], attachmentCount: 0, supportRequest: false, due: null, fromZoho: false };

/** Postgres / PostgREST codes for "that column or table does not exist (yet)". */
const MISSING_SCHEMA = new Set(['42703', '42P01', 'PGRST204', 'PGRST205']);
export const isMissingSchema = (error: unknown) => MISSING_SCHEMA.has(String((error as { code?: string } | null)?.code ?? ''));

const warned = new Set<string>();
function warnOnce(what: string) {
    if (warned.has(what)) return;
    warned.add(what);
    console.warn(`[TaskLinks] ${what} is not in the database yet (run the 20261026000003 / 20261026000004 task manager migrations). Skipping it for now.`);
}

/** Splits long id lists so a request URL never gets too long. */
function chunks<T>(list: T[], size = 150): T[][] {
    const out: T[][] = [];
    for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
    return out;
}

async function selectIn<T>(table: string, columns: string, column: string, values: string[]): Promise<{ rows: T[]; missing: boolean }> {
    const rows: T[] = [];
    for (const part of chunks(Array.from(new Set(values)))) {
        const { data, error } = await supabaseAdmin.from(table).select(columns).in(column, part);
        if (error) {
            if (isMissingSchema(error)) return { rows: [], missing: true };
            throw error;
        }
        rows.push(...((data || []) as T[]));
    }
    return { rows, missing: false };
}

/** Extras for each task id (tasks without any are left out of the map). `nameOf` turns a user id into a name. */
export async function loadTaskExtras(taskIds: string[], nameOf: (userId: string) => string): Promise<Map<string, TaskExtras>> {
    const out = new Map<string, TaskExtras>();
    if (taskIds.length === 0) return out;
    const extrasOf = (id: string) => {
        let e = out.get(id);
        if (!e) { e = { followUpOf: null, alsoWith: [], attachmentCount: 0, supportRequest: false, due: null, fromZoho: false }; out.set(id, e); }
        return e;
    };

    try {
        const links = await selectIn<{ id: string; follow_up_of: string | null; assign_group_id: string | null }>(
            'task_assignments', 'id, follow_up_of, assign_group_id', 'id', taskIds);
        if (links.missing) warnOnce('Follow-ups and multi-assign groups');
        else {
            const parentIds = links.rows.map(r => r.follow_up_of).filter((x): x is string => !!x);
            if (parentIds.length) {
                const parents = await selectIn<{ id: string; title: string }>('task_assignments', 'id, title', 'id', parentIds);
                const titleOf = new Map(parents.rows.map(p => [p.id, p.title]));
                for (const r of links.rows) {
                    if (r.follow_up_of && titleOf.has(r.follow_up_of)) extrasOf(r.id).followUpOf = { id: r.follow_up_of, title: titleOf.get(r.follow_up_of)! };
                }
            }
            const groupIds = links.rows.map(r => r.assign_group_id).filter((x): x is string => !!x);
            if (groupIds.length) {
                const mates = await selectIn<{ id: string; employee_id: string; status: TaskStatus; assign_group_id: string }>(
                    'task_assignments', 'id, employee_id, status, assign_group_id', 'assign_group_id', groupIds);
                for (const r of links.rows) {
                    if (!r.assign_group_id) continue;
                    const others = mates.rows.filter(m => m.assign_group_id === r.assign_group_id && m.id !== r.id);
                    if (others.length) extrasOf(r.id).alsoWith = others.map(m => ({ name: nameOf(m.employee_id), status: m.status }));
                }
            }
        }

        const files = await selectIn<{ task_id: string }>('task_attachments', 'task_id', 'task_id', taskIds);
        if (files.missing) warnOnce('Task attachments');
        else for (const f of files.rows) extrasOf(f.task_id).attachmentCount++;

        const requests = await selectIn<{ task_id: string }>('task_requests', 'task_id', 'task_id', taskIds);
        if (requests.missing) warnOnce('Support requests');
        else for (const r of requests.rows) extrasOf(r.task_id).supportRequest = true;

        // Read on its own, so a missing due-date column never hides the follow-up and group links above
        const dues = await selectIn<{ id: string; due_date: string | null; due_time: string | null }>('task_assignments', 'id, due_date, due_time', 'id', taskIds);
        if (!dues.missing) {
            for (const r of dues.rows) if (r.due_date) extrasOf(r.id).due = { date: r.due_date, time: shortTime(r.due_time) };
        }

        for (const id of await zohoTaskIds(taskIds)) extrasOf(id).fromZoho = true;
    } catch (err) {
        // Extras are decoration: a failure here must never take the board down.
        console.error('[TaskLinks] could not load task extras:', err);
    }
    return out;
}

/**
 * 2026-10-29: which of these tasks were imported from Zoho Mail. Read on its own: before the Zoho SQL file is applied the
 * column is missing and the answer is simply "none". Never throws.
 */
export async function zohoTaskIds(taskIds: string[]): Promise<Set<string>> {
    const out = new Set<string>();
    if (taskIds.length === 0) return out;
    try {
        const sources = await selectIn<{ id: string; source: string | null }>('task_assignments', 'id, source', 'id', taskIds);
        for (const r of sources.rows) if (r.source === 'zoho') out.add(r.id);
    } catch (err) {
        console.error('[TaskLinks] could not read task sources:', err);
    }
    return out;
}

/**
 * Links new tasks to the task they follow up and/or to each other (one multi-assign group). Returns false when the
 * columns are not in the database yet; the tasks themselves are already saved either way.
 */
export async function linkTasks(taskIds: string[], link: { followUpOf?: string | null; groupId?: string | null }): Promise<boolean> {
    const update: Record<string, string> = {};
    if (link.followUpOf) update.follow_up_of = link.followUpOf;
    if (link.groupId) update.assign_group_id = link.groupId;
    if (taskIds.length === 0 || Object.keys(update).length === 0) return true;
    const { error } = await supabaseAdmin.from('task_assignments').update(update).in('id', taskIds);
    if (!error) return true;
    if (isMissingSchema(error)) { warnOnce('Follow-ups and multi-assign groups'); return false; }
    console.error('[TaskLinks] could not link tasks:', error);
    return false;
}
