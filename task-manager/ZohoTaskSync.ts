/**
 * ZOHO TASK IMPORT — copies a person's open Zoho Mail tasks into their Task Manager list.
 * -----------------------------------------------------------------------------
 * Read-only towards Zoho: the grant carries ZohoMail.tasks.READ and nothing else, and this file only issues GETs.
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
 * Never throws out of `runAll` / `syncUser`: a failure is stored on the connection as `last_error` so it is visible
 * in the UI instead of breaking the cron.
 *
 * Needs supabase/migrations/20261029200001_task_manager_zoho_tasks.sql applied.
 */

import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { encryptToken, decryptToken } from '@/backend/lib/mail/accounts';
import { ZohoMailService } from '@/backend/services/zohoMailService';
import { TaskDatabaseService } from './TaskDatabaseService';
import type { TaskStatus } from './types';

export const ZOHO_TASK_SCOPES = 'ZohoMail.tasks.READ';
export const ZOHO_TASK_SOURCE = 'zoho';

const PAGE_SIZE = 200;   // Zoho allows 1-499
const MAX_PAGES = 5;     // hard cap: 1,000 tasks per list per run

/** The redirect Zoho sends the person back to. Must be registered on the Zoho application exactly. */
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
}

export interface ZohoConnectionStatus {
    connected: boolean;
    zohoEmail: string | null;
    connectedAt: string | null;
    lastSyncAt: string | null;
    lastImported: number | null;
    lastError: string | null;
    /** False when the SQL file has not been applied yet. */
    ready: boolean;
}

export interface ZohoSyncResult { ok: boolean; imported: number; completed: number; skipped: number; error?: string }

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

export class ZohoTaskSync {
    // ── Connections ──────────────────────────────────────────────────────────

    static async getStatus(userId: string): Promise<ZohoConnectionStatus> {
        const { data, error } = await supabaseAdmin
            .from('task_zoho_connections')
            .select('zoho_email, connected_at, last_sync_at, last_imported, last_error, is_active')
            .eq('user_id', userId)
            .maybeSingle();
        if (error) {
            return { connected: false, zohoEmail: null, connectedAt: null, lastSyncAt: null, lastImported: null, lastError: null, ready: false };
        }
        return {
            connected: Boolean(data?.is_active),
            zohoEmail: data?.zoho_email ?? null,
            connectedAt: data?.connected_at ?? null,
            lastSyncAt: data?.last_sync_at ?? null,
            lastImported: data?.last_imported ?? null,
            lastError: data?.last_error ?? null,
            ready: true,
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
        const result: ZohoSyncResult = { ok: false, imported: 0, completed: 0, skipped: 0 };
        try {
            const { data: conn, error: connErr } = await supabaseAdmin
                .from('task_zoho_connections')
                .select('refresh_token_enc, dc, is_active')
                .eq('user_id', userId)
                .maybeSingle();
            if (connErr) return { ...result, error: connErr.message };
            if (!conn?.is_active) return { ...result, error: 'Zoho Tasks is not connected.' };

            const grant = { refreshToken: decryptToken(String(conn.refresh_token_enc)), dc: String(conn.dc || 'com') };

            // Assigned to me + my personal tasks. The same task can appear in both; the Map keeps one.
            const tasks = new Map<string, ZohoTask>();
            for (const t of await this.fetchAll(grant, '/api/tasks/?view=assignedtome&action=view')) if (t.id != null) tasks.set(String(t.id), t);
            for (const t of await this.fetchAll(grant, '/api/tasks/me?')) if (t.id != null) tasks.set(String(t.id), t);

            // What is already imported for this person.
            const { data: existing, error: exErr } = await supabaseAdmin
                .from('task_assignments')
                .select('id, external_id, status')
                .eq('employee_id', userId)
                .eq('source', ZOHO_TASK_SOURCE);
            if (exErr) throw exErr;
            const known = new Map((existing ?? []).map(r => [String(r.external_id), { id: String(r.id), status: r.status as TaskStatus }]));

            const today = todayIST();
            for (const [externalId, t] of tasks) {
                const status = mapZohoStatus(t.status);
                const mine = known.get(externalId);

                if (mine) {
                    // Only ever move an imported task forward to completed — never reopen or rewrite it.
                    if (status === 'completed' && mine.status !== 'completed') {
                        await TaskDatabaseService.updateAssignmentStatus({ assignmentId: mine.id, status: 'completed' });
                        result.completed++;
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
                .update({ last_sync_at: new Date().toISOString(), last_imported: result.imported, last_error: null })
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

    /** Page through one Zoho task list. `base` already ends in `?` or carries its own query. */
    private static async fetchAll(grant: { refreshToken: string; dc: string }, base: string): Promise<ZohoTask[]> {
        const sep = base.endsWith('?') ? '' : '&';
        const all: ZohoTask[] = [];
        for (let page = 0; page < MAX_PAGES; page++) {
            const data = await ZohoMailService.getJsonWithGrant(grant, `${base}${sep}from=${page * PAGE_SIZE}&limit=${PAGE_SIZE}`) as { data?: { tasks?: ZohoTask[] } } | null;
            const tasks = data?.data?.tasks ?? [];
            all.push(...tasks);
            if (tasks.length < PAGE_SIZE) break;
        }
        return all;
    }
}
