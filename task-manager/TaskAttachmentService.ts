import { randomUUID } from 'node:crypto';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { evidenceType } from '@/backend/lib/pettyCash/evidence';
import { TaskDatabaseService } from './TaskDatabaseService';
import { TaskAccessService } from './TaskAccessService';
import { HierarchyService } from './HierarchyService';
import { PermissionService } from './PermissionService';
import { WorkspaceError, isUuid } from './WorkspaceService';
import { isMissingSchema } from './TaskLinks';
import { Employee } from './types';

/**
 * Owner 2026-10-26: documents and screenshots attached to a task.
 * Files go to the private "task-attachments" bucket (20261026000003_task_manager_upgrades.sql) and are only handed out as
 * links that expire after 10 minutes. Anyone who may see the task may attach or open its files: the person doing it,
 * the person who gave it, anyone above the holder in the reporting chain, or a superuser. Files are never deleted here.
 */

export const ATTACHMENT_BUCKET = 'task-attachments';
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
/** Owner 2026-10-26: at most this many files on one task. */
export const MAX_FILES_PER_TASK = 20;
const LINK_SECONDS = 10 * 60;

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const EXTENSION: Record<string, string> = {
    'application/pdf': 'pdf', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', [DOCX]: 'docx', [XLSX]: 'xlsx',
};

/**
 * The real type of a file, from its first bytes (never from what the browser claims): PDF, PNG, JPEG, WEBP, or a Word /
 * Excel file (a zip whose name and contents say so). null = not allowed.
 */
export function attachmentType(bytes: Uint8Array, fileName: string): string | null {
    const known = evidenceType(bytes);
    if (known) return known;
    const isZip = bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
    if (!isZip) return null;
    // A real Word / Excel file lists its parts in [Content_Types].xml and has its main document part
    const ext = fileName.toLowerCase().split('.').pop();
    const head = Buffer.from(bytes.subarray(0, Math.min(bytes.length, 256 * 1024))).toString('latin1');
    if (!head.includes('[Content_Types].xml')) return null;
    if (ext === 'docx' && head.includes('word/document.xml')) return DOCX;
    if (ext === 'xlsx' && head.includes('xl/workbook.xml')) return XLSX;
    return null;
}

/**
 * The name a file is saved and downloaded under: no path or control characters, no right-to-left / invisible format
 * characters (which can make "invoice.exe" look like a PDF), and always ending in the extension of its REAL type.
 */
export function safeFileName(fileName: string, type: string): string {
    const ext = EXTENSION[type] || 'bin';
    const cleaned = String(fileName || '').normalize('NFC').replace(/[\\/\u0000-\u001f\u007f\p{Cf}]/gu, '_').trim();
    const base = cleaned.replace(/\.[^.]*$/, '').replace(/\.+$/, '').slice(0, 150) || 'file';
    return `${base}.${ext}`;
}

export interface TaskAttachmentView {
    id: string;
    fileName: string;
    fileType: string;
    fileSize: number;
    uploadedByName: string;
    createdAt: string;
    /** A download link that works for 10 minutes. */
    url: string | null;
    /** Owner 2026-10-27: the person who attached it (or a superuser) may remove it. */
    canDelete: boolean;
}

export class TaskAttachmentService {
    private static async actorFor(actorUserId: string): Promise<Employee> {
        const actor = await TaskDatabaseService.getEmployeeById(actorUserId);
        if (!actor || !actor.active) throw new WorkspaceError(403, 'Your account is not linked to an active employee profile.', 'NO_PROFILE');
        const access = await TaskAccessService.check({ userId: actor.id, departmentId: actor.department_id });
        if (!access.allowed) throw new WorkspaceError(403, access.message, 'LOCKED');
        return actor;
    }

    /** Throws unless the actor may see every one of these tasks. */
    private static async assertMaySee(actor: Employee, taskIds: string[]): Promise<Array<{ id: string; title: string; employee_id: string }>> {
        if (!taskIds.every(isUuid)) throw new WorkspaceError(400, 'That task is not valid.');
        const { data, error } = await supabaseAdmin.from('task_assignments').select('id, title, employee_id, assigned_by').in('id', taskIds);
        if (error) {
            console.error('[TaskAttachmentService] could not read the tasks:', error);
            throw new WorkspaceError(500, 'Could not open the task just now. Please try again.');
        }
        const rows = (data || []) as Array<{ id: string; title: string; employee_id: string; assigned_by: string | null }>;
        if (rows.length !== taskIds.length) throw new WorkspaceError(404, 'Task not found.');
        const { hierarchy } = await HierarchyService.load();
        for (const r of rows) {
            if (r.employee_id === actor.id || r.assigned_by === actor.id) continue;
            if (actor.role === 'superuser') {
                // Owner 2026-10-22: superusers keep their tasks private from each other
                const holder = await TaskDatabaseService.getEmployeeById(r.employee_id);
                if (holder && PermissionService.hiddenFrom(actor, holder)) throw new WorkspaceError(403, 'You cannot open files on that task.', 'NOT_ALLOWED');
                continue;
            }
            if (!hierarchy.isAbove(actor.id, r.employee_id)) throw new WorkspaceError(403, 'You cannot open files on that task.', 'NOT_ALLOWED');
        }
        return rows;
    }

    /** Refuses clearly when the migration has not been applied yet (nothing is uploaded in that case). */
    private static async assertReady(): Promise<void> {
        const { error } = await supabaseAdmin.from('task_attachments').select('id').limit(1);
        if (error && isMissingSchema(error)) throw new WorkspaceError(503, 'Attaching files is not switched on yet. Please ask the admin to apply the latest database update.', 'NOT_READY');
        if (error) throw error;
    }

    static async list(actorUserId: string, taskId?: string): Promise<TaskAttachmentView[]> {
        if (!taskId) throw new WorkspaceError(400, 'Missing task.');
        const actor = await this.actorFor(actorUserId);
        await this.assertMaySee(actor, [taskId]);
        return this.views('task_id', taskId, actor);
    }

    /** Owner 2026-10-26: the files sent with a support request (the sender and the receiver may open them). */
    static async listForRequest(actorUserId: string, requestId?: string): Promise<TaskAttachmentView[]> {
        const actor = await this.actorFor(actorUserId);
        await this.requestFor(actor, requestId, 'either');
        return this.views('request_id', requestId!, actor);
    }

    /**
     * Owner 2026-10-26: one file sent with a support request, by its sender. If the receiver already accepted it, the file
     * goes straight onto the new task (so a quick "Accept" never loses the sender's files).
     */
    static async uploadToRequest(actorUserId: string, input: { requestId?: string; fileName: string; bytes: Uint8Array }): Promise<{ count: number }> {
        const { type, fileName } = this.checkFile(input.fileName, input.bytes);
        const actor = await this.actorFor(actorUserId);
        const request = await this.requestFor(actor, input.requestId, 'sender');
        if (request.state === 'declined') throw new WorkspaceError(409, 'This request was declined, so no more files can be added.', 'ANSWERED');
        await this.assertReady();
        const { count: existing } = await supabaseAdmin.from('task_attachments').select('id', { count: 'exact', head: true }).eq('request_id', request.id);
        if ((existing ?? 0) >= MAX_FILES_PER_TASK) throw new WorkspaceError(409, `A request can have at most ${MAX_FILES_PER_TASK} files.`, 'TOO_MANY_FILES');
        const path = await this.store(`requests/${request.id}`, type, input.bytes);
        const { error } = await supabaseAdmin.from('task_attachments').insert({
            request_id: request.id, task_id: request.taskId, uploaded_by: actor.id, storage_path: path, file_name: fileName, file_type: type, file_size: input.bytes.length,
        });
        if (error) {
            console.error('[TaskAttachmentService] could not list the file on the request:', error);
            throw new WorkspaceError(500, 'Could not attach the file just now. Please try again.');
        }
        // Accepted between the check above and now: move the file onto the task as well
        if (!request.taskId) {
            const { data: again } = await supabaseAdmin.from('task_requests').select('task_id').eq('id', request.id).maybeSingle();
            if (again?.task_id) await this.moveRequestFiles(request.id, again.task_id as string);
        }
        return { count: 1 };
    }

    /** Owner 2026-10-26: when a support request is accepted, its files move onto the new task. Never throws. */
    static async moveRequestFiles(requestId: string, taskId: string): Promise<void> {
        const { error } = await supabaseAdmin.from('task_attachments').update({ task_id: taskId }).eq('request_id', requestId).is('task_id', null);
        if (error && !isMissingSchema(error)) console.error('[TaskAttachmentService] could not move request files onto the task:', error);
    }

    private static async requestFor(actor: Employee, requestId: string | undefined, who: 'sender' | 'either'): Promise<{ id: string; state: string; taskId: string | null }> {
        if (!isUuid(requestId)) throw new WorkspaceError(400, 'That request is not valid.');
        const { data, error } = await supabaseAdmin.from('task_requests').select('id, from_user_id, to_user_id, state, task_id').eq('id', requestId).maybeSingle();
        if (error) {
            if (isMissingSchema(error)) throw new WorkspaceError(503, 'Support requests are not switched on yet. Please ask the admin to apply the latest database update.', 'NOT_READY');
            throw new WorkspaceError(500, 'Could not open the request just now. Please try again.');
        }
        if (!data) throw new WorkspaceError(404, 'Request not found.');
        const ok = data.from_user_id === actor.id || (who === 'either' && data.to_user_id === actor.id);
        if (!ok) throw new WorkspaceError(403, 'You cannot open files on that request.', 'NOT_ALLOWED');
        return { id: data.id as string, state: data.state as string, taskId: (data.task_id as string) || null };
    }

    private static checkFile(name: string, bytes: Uint8Array): { type: string; fileName: string } {
        if (!bytes.length || bytes.length > MAX_ATTACHMENT_BYTES) throw new WorkspaceError(400, 'Choose a file up to 10 MB.');
        const type = attachmentType(bytes, String(name || ''));
        if (!type) throw new WorkspaceError(400, 'Only PDF, Word, Excel or image files (PNG, JPG, WEBP) can be attached.', 'BAD_TYPE');
        return { type, fileName: safeFileName(name, type) };
    }

    private static async store(folder: string, type: string, bytes: Uint8Array): Promise<string> {
        const path = `${folder}/${randomUUID()}.${EXTENSION[type]}`;
        const { error } = await supabaseAdmin.storage.from(ATTACHMENT_BUCKET).upload(path, bytes, { contentType: type, upsert: false });
        if (error) {
            console.error('[TaskAttachmentService] upload failed:', error);
            throw new WorkspaceError(500, 'Could not save the file just now. Please try again.');
        }
        return path;
    }

    private static async views(column: 'task_id' | 'request_id', value: string, actor: Employee): Promise<TaskAttachmentView[]> {
        const { data, error } = await supabaseAdmin.from('task_attachments')
            .select('id, storage_path, file_name, file_type, file_size, uploaded_by, created_at').eq(column, value).order('created_at', { ascending: true });
        if (error) {
            if (isMissingSchema(error)) return [];
            console.error('[TaskAttachmentService] could not list files:', error);
            throw new WorkspaceError(500, 'Could not load the files just now. Please try again.');
        }
        const rows = (data || []) as Array<{ id: string; storage_path: string; file_name: string; file_type: string; file_size: number; uploaded_by: string | null; created_at: string }>;
        const pool = rows.length ? await TaskDatabaseService.getAllEmployees() : [];
        return Promise.all(rows.map(async r => {
            const { data: link, error: linkError } = await supabaseAdmin.storage.from(ATTACHMENT_BUCKET).createSignedUrl(r.storage_path, LINK_SECONDS, { download: safeFileName(r.file_name, r.file_type) });
            if (linkError) console.error('[TaskAttachmentService] could not make a download link:', linkError);
            return {
                id: r.id, fileName: r.file_name, fileType: r.file_type, fileSize: r.file_size,
                uploadedByName: pool.find(e => e.id === r.uploaded_by)?.name || 'Someone',
                createdAt: r.created_at, url: link?.signedUrl ?? null,
                canDelete: r.uploaded_by === actor.id || actor.role === 'superuser',
            };
        }));
    }

    /**
     * Stores one file and lists it on each of the given tasks (several when a task was just given to several people).
     */
    static async upload(actorUserId: string, input: { taskIds: string[]; fileName: string; bytes: Uint8Array }): Promise<{ count: number }> {
        const taskIds = Array.from(new Set(input.taskIds.filter(id => typeof id === 'string' && id.length > 0)));
        if (taskIds.length === 0) throw new WorkspaceError(400, 'Missing task.');
        if (taskIds.length > 50) throw new WorkspaceError(400, 'At most 50 tasks at a time.');
        const { type, fileName } = this.checkFile(input.fileName, input.bytes);

        const actor = await this.actorFor(actorUserId);
        const tasks = await this.assertMaySee(actor, taskIds);
        await this.assertReady();
        // At most MAX_FILES_PER_TASK files on any one task
        const { data: existing } = await supabaseAdmin.from('task_attachments').select('task_id').in('task_id', taskIds);
        const count = new Map<string, number>();
        for (const e of (existing || []) as Array<{ task_id: string }>) count.set(e.task_id, (count.get(e.task_id) ?? 0) + 1);
        if (taskIds.some(id => (count.get(id) ?? 0) >= MAX_FILES_PER_TASK)) throw new WorkspaceError(409, `A task can have at most ${MAX_FILES_PER_TASK} files.`, 'TOO_MANY_FILES');

        const path = await this.store(taskIds[0], type, input.bytes);
        const { error: rowError } = await supabaseAdmin.from('task_attachments').insert(taskIds.map(taskId => ({
            task_id: taskId, uploaded_by: actor.id, storage_path: path, file_name: fileName, file_type: type, file_size: input.bytes.length,
        })));
        if (rowError) {
            // The file stays in storage (nothing is deleted); it is just not listed.
            console.error('[TaskAttachmentService] could not list the file on the task:', rowError);
            throw new WorkspaceError(500, 'Could not attach the file just now. Please try again.');
        }
        for (const t of tasks) {
            await TaskDatabaseService.logAudit({
                eventType: 'task_attachment_added', actorId: actor.id, targetEmployeeId: t.employee_id, taskId: t.id,
                details: { title: t.title, fileName, fileType: type, fileSize: input.bytes.length, via: 'web_tasks_tab' },
            });
        }
        return { count: taskIds.length };
    }

    /**
     * Owner 2026-10-27: removes a file attached by mistake. Only the person who attached it, or a superuser, and only on a
     * task (or support request) they may see. A file given with a task to several people is stored once and listed on each
     * copy: removing it here takes it off THIS task only, and the stored file is deleted once no task lists it any more.
     */
    static async remove(actorUserId: string, attachmentId?: unknown): Promise<{ id: string }> {
        if (!isUuid(attachmentId)) throw new WorkspaceError(400, 'That file is not valid.');
        const actor = await this.actorFor(actorUserId);
        await this.assertReady();
        const { data: row, error } = await supabaseAdmin.from('task_attachments')
            .select('id, task_id, request_id, storage_path, file_name, uploaded_by').eq('id', attachmentId).maybeSingle();
        if (error) {
            console.error('[TaskAttachmentService] could not read the file:', error);
            throw new WorkspaceError(500, 'Could not remove the file just now. Please try again.');
        }
        if (!row) throw new WorkspaceError(404, 'That file is no longer there.');
        // Same visibility as listing it, then: only whoever attached it (or a superuser) may take it off
        const task = row.task_id ? (await this.assertMaySee(actor, [row.task_id as string]))[0] : null;
        if (!task) await this.requestFor(actor, (row.request_id as string | null) ?? undefined, 'either');
        if (row.uploaded_by !== actor.id && actor.role !== 'superuser') throw new WorkspaceError(403, 'Only the person who attached this file can remove it.', 'NOT_UPLOADER');

        const { data: gone, error: delError } = await supabaseAdmin.from('task_attachments').delete().eq('id', row.id).select('id').maybeSingle();
        if (delError) {
            console.error('[TaskAttachmentService] could not remove the file:', delError);
            throw new WorkspaceError(500, 'Could not remove the file just now. Please try again.');
        }
        if (!gone) throw new WorkspaceError(404, 'That file is no longer there.');

        // The stored file goes only when nothing lists it any more (other copies of a multi-person task may still use it)
        const { count, error: countError } = await supabaseAdmin.from('task_attachments')
            .select('id', { count: 'exact', head: true }).eq('storage_path', row.storage_path);
        if (!countError && (count ?? 0) === 0) {
            const { error: storageError } = await supabaseAdmin.storage.from(ATTACHMENT_BUCKET).remove([row.storage_path as string]);
            if (storageError) console.error('[TaskAttachmentService] file unlisted but not removed from storage:', row.storage_path, storageError);
        }

        await TaskDatabaseService.logAudit({
            eventType: 'task_attachment_removed', actorId: actor.id, targetEmployeeId: task?.employee_id ?? null, taskId: task?.id ?? null,
            details: { title: task?.title ?? null, fileName: row.file_name, requestId: row.request_id ?? null, uploadedBy: row.uploaded_by, via: 'web_tasks_tab' },
        });
        return { id: row.id as string };
    }
}
