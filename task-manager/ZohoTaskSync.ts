/**
 * ZOHO TASK SYNC — copies a person's open Zoho Mail tasks into their Task Manager list, and sends completions back.
 * -----------------------------------------------------------------------------
 * The grant carries ZohoMail.tasks.READ + UPDATE. The ONLY change ever made in Zoho is a task's status, on a task
 * this person imported. Connections made before 2026-11-05 are READ only: they keep importing, and nothing is sent to
 * Zoho until the person reconnects (the Zoho Tasks menu asks them to).
 *
 * Each person connects their OWN Zoho account (Task Manager → "Connect Zoho Tasks"), so every task fetched with
 * their token belongs to them: no email matching, and nobody can import into someone else's list.
 *
 * Rules (owner 2026-10-29):
 *  · New OPEN tasks (assigned to me + personal) are added for today, with Zoho's due date as the deadline.
 *  · Tasks already completed in Zoho are never imported.
 *  · An imported task that is later completed in Zoho is marked completed here too. Nothing else is overwritten.
 *  · (employee_id, source, external_id) is unique, so a repeat run — or two runs at once — never duplicates.
 *
 * Rules (owner 2026-11-05):
 *  · A task handed over to someone here, or deleted here, is never imported again for the person it came from.
 *  · A task deleted here is marked COMPLETED in Zoho at the next sync, never deleted there: that needs no extra
 *    permission, can be undone in Zoho, and cannot remove a group task from under the rest of the group.
 *  · Completing an imported task here (app, WhatsApp, bot) completes it in Zoho at once. Reopening it here reopens it
 *    in Zoho, or the next sync would see "completed in Zoho" and close it again.
 *  · Each sync also sends any completion still open in Zoho, which retries a failed send. The exception is a task
 *    changed in Zoho AFTER it was completed here: someone reopened it there on purpose, so it is left alone.
 *
 * Never throws out of `runAll` / `syncUser` / `pushStatus`: a failure is stored on the connection as `last_error` so
 * it is visible in the UI instead of breaking the cron or the person's action.
 *
 * Needs supabase/migrations/20261029200001_task_manager_zoho_tasks.sql applied.
 */

import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { encryptToken, decryptToken } from '@/backend/lib/mail/accounts';
import { ZohoMailService } from '@/backend/services/zohoMailService';
import { TaskDatabaseService } from './TaskDatabaseService';
import type { TaskStatus } from './types';

export const ZOHO_TASK_SCOPES = 'ZohoMail.tasks.READ,ZohoMail.tasks.UPDATE';
export const ZOHO_TASK_SOURCE = 'zoho';

const PAGE_SIZE = 200;   // Zoho allows 1-499
const MAX_PAGES = 5;     // hard cap: 1,000 tasks per list per run
const PUSH_TIMEOUT_MS = 8_000; // a person's "done" waits on this, so a slow Zoho must not hold it up; the sync retries

/** The redirect Zoho sends the person back to. Must be registered on the Zoho application exactly. */
export function getZohoTaskAppCredentials(): { clientId: string; clientSecret: string } {
    const clientId = (process.env.ZOHO_TASKS_CLIENT_ID || process.env.ZOHO_CLIENT_ID || process.env.ZOHO_MAIL_APP_CLIENT_ID || '').trim();
    const clientSecret = (process.env.ZOHO_TASKS_CLIENT_SECRET || process.env.ZOHO_CLIENT_SECRET || process.env.ZOHO_MAIL_APP_CLIENT_SECRET || '').trim();
    return { clientId, clientSecret };
}

export function zohoTaskCallbackUrl(requestUrl?: string): string {
    const override = (process.env.ZOHO_TASKS_REDIRECT_URL ?? '').trim();
    if (override) return override.replace(/\/+$/, '');
    let base = '';
    if (requestUrl) { try { base = new URL(requestUrl).origin; } catch { /* fall through */ } }
    base = (base || process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || '').trim().replace(/^"|"$/g, '').replace(/\/+$/, '');
    return `${base}/api/task-manager/zoho/callback`;
}

/** The shape Zoho documents for one task (get-tasks-assigned-to-me / get-all-group-or-personal-tasks). */
interface ZohoTask {
    id?: string | number;
    title?: string;
    description?: string;
    dueDate?: string;           // "dd/mm/yyyy"
    status?: string;            // "In Progress", "Completed", "Open", or a custom status
    priority?: string;
    project?: { name?: string } | null;
    modifiedTime?: string;      // ISO 8601
    namespaceId?: string | number; // on a group task, the group's id (Zoho's samples show this; the docs do not define it)
}

type ZohoGrant = { refreshToken: string; dc: string };

export interface ZohoConnectionStatus {
    connected: boolean;
    zohoEmail: string | null;
    connectedAt: string | null;
    lastSyncAt: string | null;
    lastImported: number | null;
    lastError: string | null;
    /** False when the SQL file has not been applied yet. */
    ready: boolean;
    /** False on a READ-only connection: the person must reconnect before completions reach Zoho. */
    canUpdate: boolean;
}

export interface ZohoSyncResult { ok: boolean; imported: number; completed: number; pushed: number; skipped: number; error?: string }

function todayIST(): string {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
}

/** "30/10/2018" -> "2018-10-30". Anything else -> null (the task simply has no deadline). */
export function parseZohoDueDate(raw: string | undefined | null): string | null {
    const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(raw ?? '').trim());
    if (!m) return null;
    const [, d, mo, y] = m;
    const iso = `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
    return Number.isNaN(Date.parse(iso)) ? null : iso;
}

export function mapZohoStatus(raw: string | undefined | null): TaskStatus {
    const s = String(raw ?? '').toLowerCase().replace(/[\s_-]/g, '');
    if (s === 'completed' || s === 'done' || s === 'closed') return 'completed';
    if (s === 'inprogress') return 'in_progress';
    return 'pending';
}

/** Did this connection consent to changing tasks? An unknown (null) scope is treated as no. */
export function canUpdateZoho(scopes: string | null | undefined): boolean {
    return /ZohoMail\.tasks\.(UPDATE|ALL)\b/.test(String(scopes ?? ''));
}

/**
 * What one sync does with a task that exists on both sides. Pure, so the rules can be tested without Zoho.
 *  · complete_here — done in Zoho, open here.
 *  · push_completed — done here, open in Zoho, and Zoho has not changed since it was done here.
 *  · none — already the same, or reopened in Zoho on purpose, or the connection cannot update Zoho.
 */
export function decideSyncAction(
    here: { status: TaskStatus; completedAt?: string | null },
    zoho: { status: TaskStatus; modifiedTime?: string | null },
    canUpdate: boolean,
): 'complete_here' | 'push_completed' | 'none' {
    if (zoho.status === 'completed') return here.status === 'completed' ? 'none' : 'complete_here';
    if (here.status !== 'completed' || !canUpdate) return 'none';
    const changedInZohoAfter = Date.parse(String(zoho.modifiedTime)) > Date.parse(String(here.completedAt));
    return changedInZohoAfter ? 'none' : 'push_completed';
}

export class ZohoTaskSync {
    // ── Connections ──────────────────────────────────────────────────────────

    static async getStatus(userId: string): Promise<ZohoConnectionStatus> {
        const { data, error } = await supabaseAdmin
            .from('task_zoho_connections')
            .select('zoho_email, connected_at, last_sync_at, last_imported, last_error, is_active, scopes')
            .eq('user_id', userId)
            .maybeSingle();
        if (error) {
            return { connected: false, zohoEmail: null, connectedAt: null, lastSyncAt: null, lastImported: null, lastError: null, ready: false, canUpdate: false };
        }
        return {
            connected: Boolean(data?.is_active),
            zohoEmail: data?.zoho_email ?? null,
            connectedAt: data?.connected_at ?? null,
            lastSyncAt: data?.last_sync_at ?? null,
            lastImported: data?.last_imported ?? null,
            lastError: data?.last_error ?? null,
            ready: true,
            canUpdate: canUpdateZoho(data?.scopes),
        };
    }

    static async saveConnection(input: { userId: string; zohoEmail: string | null; refreshToken: string; dc: string; scopes: string | null }): Promise<{ ok: boolean; error?: string }> {
        try {
            const { error } = await supabaseAdmin.from('task_zoho_connections').upsert({
                user_id: input.userId,
                zoho_email: input.zohoEmail,
                refresh_token_enc: encryptToken(input.refreshToken),
                dc: input.dc,
                scopes: input.scopes,
                connected_at: new Date().toISOString(),
                last_error: null,
                is_active: true,
            }, { onConflict: 'user_id' });
            return error ? { ok: false, error: error.message } : { ok: true };
        } catch (e) {
            return { ok: false, error: e instanceof Error ? e.message : String(e) };
        }
    }

    /** Forget the person's token. Tasks already imported stay in their list. */
    static async disconnect(userId: string): Promise<{ ok: boolean; error?: string }> {
        const { error } = await supabaseAdmin.from('task_zoho_connections').delete().eq('user_id', userId);
        return error ? { ok: false, error: error.message } : { ok: true };
    }

    // ── Sync ─────────────────────────────────────────────────────────────────

    /** Every active connection, one after another. Called from the task-manager cron. Never throws. */
    static async runAll(): Promise<{ users: number; imported: number; failed: number }> {
        const out = { users: 0, imported: 0, failed: 0 };
        try {
            const { data, error } = await supabaseAdmin.from('task_zoho_connections').select('user_id').eq('is_active', true);
            if (error) return out; // table not created yet — nothing to do
            for (const row of data ?? []) {
                out.users++;
                const r = await this.syncUser(String(row.user_id));
                if (r.ok) out.imported += r.imported; else out.failed++;
            }
        } catch (e) {
            console.error('[ZohoTaskSync] runAll failed:', e instanceof Error ? e.message : e);
        }
        return out;
    }

    /** Import one person's open Zoho tasks. Never throws. */
    static async syncUser(userId: string): Promise<ZohoSyncResult> {
        const result: ZohoSyncResult = { ok: false, imported: 0, completed: 0, pushed: 0, skipped: 0 };
        try {
            const { data: conn, error: connErr } = await supabaseAdmin
                .from('task_zoho_connections')
                .select('refresh_token_enc, dc, is_active, scopes')
                .eq('user_id', userId)
                .maybeSingle();
            if (connErr) return { ...result, error: connErr.message };
            if (!conn?.is_active) return { ...result, error: 'Zoho Tasks is not connected.' };

            const grant = { refreshToken: decryptToken(String(conn.refresh_token_enc)), dc: String(conn.dc || 'com') };
            const canUpdate = canUpdateZoho(conn.scopes);

            // Assigned to me + my personal tasks. The same task can appear in both; the Map keeps one.
            const tasks = new Map<string, ZohoTask>();
            for (const t of await this.fetchAll(grant, '/api/tasks/?view=assignedtome&action=view')) if (t.id != null) tasks.set(String(t.id), t);
            for (const t of await this.fetchAll(grant, '/api/tasks/me?')) if (t.id != null) tasks.set(String(t.id), t);

            // What is already imported for this person.
            const { data: existing, error: exErr } = await supabaseAdmin
                .from('task_assignments')
                .select('id, external_id, status, completed_at')
                .eq('employee_id', userId)
                .eq('source', ZOHO_TASK_SOURCE);
            if (exErr) throw exErr;
            const known = new Map((existing ?? []).map(r => [String(r.external_id), { id: String(r.id), status: r.status as TaskStatus, completedAt: r.completed_at as string | null }]));

            // Tasks still open in Zoho that this person gave to someone here: not new, so they must not be imported again.
            const moved = await this.movedAway(userId, [...tasks]
                .filter(([id, t]) => !known.has(id) && mapZohoStatus(t.status) !== 'completed')
                .map(([id]) => id));
            // ...and tasks deleted here, which are just as easy to mistake for new. They count as done here, so a delete
            // is sent to Zoho as a completion, with the same retry and the same respect for a reopen in Zoho.
            const deleted = await this.deletedHere(userId, [...tasks]
                .filter(([id, t]) => !known.has(id) && !moved.has(id) && mapZohoStatus(t.status) !== 'completed')
                .map(([id]) => id));

            const today = todayIST();
            let pushError: string | null = null;
            for (const [externalId, t] of tasks) {
                const status = mapZohoStatus(t.status);
                const mine = known.get(externalId) ?? moved.get(externalId) ?? deleted.get(externalId);

                if (mine) {
                    // Only ever move an imported task forward to completed — never reopen or rewrite it.
                    const action = decideSyncAction(mine, { status, modifiedTime: t.modifiedTime }, canUpdate);
                    if (action === 'complete_here') {
                        await TaskDatabaseService.updateAssignmentStatus({ assignmentId: mine.id, status: 'completed', skipZohoPush: true });
                        result.completed++;
                    } else if (action === 'push_completed') {
                        // One task Zoho refuses must not stop this person's imports; it is retried next sync.
                        try {
                            await this.putStatus(grant, externalId, true, t.namespaceId);
                            result.pushed++;
                        } catch (e) {
                            pushError = `Could not update Zoho: ${e instanceof Error ? e.message : String(e)}`;
                            result.skipped++;
                        }
                    } else {
                        result.skipped++;
                    }
                    continue;
                }
                if (status === 'completed') { result.skipped++; continue; } // no history import

                const title = String(t.title ?? '').trim();
                if (!title) { result.skipped++; continue; }

                const project = t.project?.name && t.project.name !== 'General' ? `Zoho project: ${t.project.name}` : '';
                const description = [String(t.description ?? '').trim(), project].filter(Boolean).join('\n') || undefined;

                try {
                    await TaskDatabaseService.createTaskAssignment({
                        employeeId: userId,
                        title: title.slice(0, 500),
                        description,
                        assignedDate: today,
                        status,
                        dueDate: parseZohoDueDate(t.dueDate),
                        source: ZOHO_TASK_SOURCE,
                        externalId,
                    });
                    result.imported++;
                } catch (e) {
                    // 23505: another run imported it a moment ago. Anything else is a real failure.
                    if ((e as { code?: string })?.code === '23505') { result.skipped++; continue; }
                    throw e;
                }
            }

            result.ok = true;
            await supabaseAdmin.from('task_zoho_connections')
                .update({ last_sync_at: new Date().toISOString(), last_imported: result.imported, last_error: pushError?.slice(0, 400) ?? null })
                .eq('user_id', userId);
            return result;
        } catch (e) {
            const msg = e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e);
            console.error('[ZohoTaskSync] sync failed for a user:', msg);
            try {
                await supabaseAdmin.from('task_zoho_connections')
                    .update({ last_sync_at: new Date().toISOString(), last_error: msg.slice(0, 400) })
                    .eq('user_id', userId);
            } catch { /* health is advisory */ }
            return { ...result, ok: false, error: msg };
        }
    }

    /**
     * Of these Zoho ids, the imported tasks this person moved to someone else (hand-over, or an edit that changed the
     * person). Moving a task moves its row, so only the audit log still says it was theirs. A same id held by someone
     * else with no such entry stays unknown: that task was reassigned in Zoho, and this person really should import it.
     * The sync also uses this person's grant to send the new holder's completion, since that grant can see the task.
     */
    private static async movedAway(userId: string, externalIds: string[]): Promise<Map<string, { id: string; status: TaskStatus; completedAt: string | null }>> {
        const out = new Map<string, { id: string; status: TaskStatus; completedAt: string | null }>();
        for (let i = 0; i < externalIds.length; i += PAGE_SIZE) {
            const { data: rows, error } = await supabaseAdmin
                .from('task_assignments')
                .select('id, external_id, status, completed_at')
                .eq('source', ZOHO_TASK_SOURCE)
                .neq('employee_id', userId)
                .in('external_id', externalIds.slice(i, i + PAGE_SIZE));
            if (error) throw error;
            if (!rows?.length) continue;

            const mine = await this.tasksMovedBy(userId, rows.map(r => String(r.id)));
            for (const r of rows) {
                if (mine.has(String(r.id))) out.set(String(r.external_id), { id: String(r.id), status: r.status as TaskStatus, completedAt: r.completed_at as string | null });
            }
        }
        return out;
    }

    /**
     * Of these Zoho ids, the tasks deleted here that were this person's: they held the task, or gave it to the person
     * who held it. The row is gone, so only the delete's audit entry remembers it. A delete from someone else's list
     * does not count, so a task reassigned to this person in Zoho still arrives. Each comes back shaped like a completed
     * task, finished at the moment it was deleted.
     */
    private static async deletedHere(userId: string, externalIds: string[]): Promise<Map<string, { id: string; status: TaskStatus; completedAt: string | null }>> {
        const out = new Map<string, { id: string; status: TaskStatus; completedAt: string | null }>();
        for (let i = 0; i < externalIds.length; i += PAGE_SIZE) {
            const { data: rows, error } = await supabaseAdmin
                .from('task_audit_logs')
                .select('task_id, target_employee_id, details, created_at')
                .eq('event_type', 'task_deleted')
                .in('details->>zohoTaskId', externalIds.slice(i, i + PAGE_SIZE));
            if (error) throw error;
            if (!rows?.length) continue;

            const mine = await this.tasksMovedBy(userId, rows.map(r => String(r.task_id)));
            for (const r of rows) {
                if (r.target_employee_id === userId || mine.has(String(r.task_id))) {
                    out.set(String(r.details?.zohoTaskId), { id: String(r.task_id), status: 'completed', completedAt: r.created_at as string });
                }
            }
        }
        return out;
    }

    /** Of these task rows, the ones this person moved to someone else, according to the audit log. */
    private static async tasksMovedBy(userId: string, taskIds: string[]): Promise<Set<string>> {
        const { data, error } = await supabaseAdmin
            .from('task_audit_logs')
            .select('task_id')
            .in('event_type', ['task_handed_over', 'task_edited'])
            .eq('details->>fromUserId', userId)
            .in('task_id', taskIds);
        if (error) throw error;
        return new Set((data ?? []).map(m => String(m.task_id)));
    }

    /**
     * Send one status change to Zoho right now, using the task holder's own connection. Never throws and never takes
     * longer than PUSH_TIMEOUT_MS. A failure lands in `last_error`; a missed completion is retried by the next sync.
     */
    static async pushStatus(input: { userId: string; externalId: string; done: boolean }): Promise<void> {
        const send = async () => {
            const { data: conn, error } = await supabaseAdmin
                .from('task_zoho_connections')
                .select('refresh_token_enc, dc, is_active, scopes')
                .eq('user_id', input.userId)
                .maybeSingle();
            if (error) throw error;
            if (!conn?.is_active || !canUpdateZoho(conn.scopes)) return; // not connected, or must reconnect first
            const grant = { refreshToken: decryptToken(String(conn.refresh_token_enc)), dc: String(conn.dc || 'com') };
            await this.putStatus(grant, input.externalId, input.done);
        };

        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
            await Promise.race([
                send(),
                new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Zoho did not answer in time')), PUSH_TIMEOUT_MS); }),
            ]);
        } catch (e) {
            const msg = e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e);
            console.error('[ZohoTaskSync] push failed for a task:', msg);
            try {
                await supabaseAdmin.from('task_zoho_connections')
                    .update({ last_error: `Could not update Zoho: ${msg}`.slice(0, 400) })
                    .eq('user_id', input.userId);
            } catch { /* health is advisory */ }
        } finally {
            clearTimeout(timer);
        }
    }

    /**
     * Change a task's status in Zoho. The personal address is tried first; a task that is not personal is a group task,
     * sent to its group. Throws if neither accepts it. `namespaceId` is looked up when the caller does not have it.
     */
    private static async putStatus(grant: ZohoGrant, taskId: string, done: boolean, namespaceId?: string | number): Promise<void> {
        const creds = getZohoTaskAppCredentials();
        const body = { status: done ? 'completed' : 'inprogress' }; // the only two values Zoho accepts
        const id = encodeURIComponent(taskId);
        try {
            await ZohoMailService.putJsonWithGrant({ ...grant, ...creds }, `/api/tasks/me/${id}`, body);
        } catch (personalError) {
            const assigned = namespaceId ?? (await this.fetchAll(grant, '/api/tasks/?view=assignedtome&action=view'))
                .find(t => String(t.id) === taskId)?.namespaceId;
            if (assigned == null) throw personalError;
            await ZohoMailService.putJsonWithGrant({ ...grant, ...creds }, `/api/tasks/groups/${encodeURIComponent(String(assigned))}/${id}`, body);
        }
    }

    /** Page through one Zoho task list. `base` already ends in `?` or carries its own query. */
    private static async fetchAll(grant: ZohoGrant, base: string): Promise<ZohoTask[]> {
        const sep = base.endsWith('?') ? '' : '&';
        const all: ZohoTask[] = [];
        for (let page = 0; page < MAX_PAGES; page++) {
            const creds = getZohoTaskAppCredentials();
            const data = await ZohoMailService.getJsonWithGrant({ ...grant, ...creds }, `${base}${sep}from=${page * PAGE_SIZE}&limit=${PAGE_SIZE}`) as { data?: { tasks?: ZohoTask[] } } | null;
            const tasks = data?.data?.tasks ?? [];
            all.push(...tasks);
            if (tasks.length < PAGE_SIZE) break;
        }
        return all;
    }
}
