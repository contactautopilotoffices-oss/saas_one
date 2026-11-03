import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { attachmentType, safeFileName } from '@/task-manager/TaskAttachmentService';
import { isMissingSchema } from '@/task-manager/TaskLinks';
import { isUuid } from '@/task-manager/WorkspaceService';

/**
 * Owner 2026-11-03: optional files (PDF, Word, Excel, PNG / JPG / WEBP) on a request (ticket), added when it is raised
 * or later from the request page. Same design as task attachments (task-manager/TaskAttachmentService.ts): files go to
 * the private "ticket-attachments" bucket (20261104000001_ticket_attachments.sql), the real file type is read from the
 * bytes (never trusted from the browser), and files are only handed out as links that expire after 10 minutes.
 *
 * WHO may see / attach: anyone who can open the request (owner 2026-11-03). That is decided exactly like
 * GET /api/tickets/[id]: the ticket must be readable with the user's OWN session (row level security), and an internal
 * ticket is hidden from anyone who is not staff / admin. Only the person who attached a file may remove it.
 */

export const TICKET_ATTACHMENT_BUCKET = 'ticket-attachments';
export const MAX_TICKET_ATTACHMENT_BYTES = 10 * 1024 * 1024;
/** Owner 2026-11-03: at most this many files on one request. */
export const MAX_FILES_PER_TICKET = 5;
const LINK_SECONDS = 10 * 60;

const EXTENSION: Record<string, string> = {
    'application/pdf': 'pdf', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
};

export class TicketAttachmentError extends Error {
    constructor(public status: number, message: string, public code?: string) {
        super(message);
    }
}

export interface TicketAttachmentView {
    id: string;
    fileName: string;
    fileType: string;
    fileSize: number;
    uploadedByName: string;
    createdAt: string;
    /** A download link that works for 10 minutes. */
    url: string | null;
    /** Only the person who attached it may remove it. */
    canDelete: boolean;
}

/** Same staff test as GET /api/tickets/[id] (who may see INTERNAL tickets). */
async function isStaffFor(userId: string, ticket: { organization_id: string | null; assigned_to: string | null }): Promise<boolean> {
    const [orgMemsRes, propMemsRes] = await Promise.all([
        supabaseAdmin.from('organization_memberships').select('role, organization_id').eq('user_id', userId),
        supabaseAdmin.from('property_memberships').select('role, property_id').eq('user_id', userId).eq('is_active', true),
    ]);
    // Fails closed (treated as not staff), but say so instead of a silent "not found"
    if (orgMemsRes.error || propMemsRes.error) {
        console.error('[TicketAttachments] could not read memberships:', orgMemsRes.error || propMemsRes.error);
        throw new TicketAttachmentError(500, 'Could not open the request just now. Please try again.');
    }
    const orgMems = (orgMemsRes.data || []) as Array<{ role: string | null; organization_id: string | null }>;
    const orgRoles = orgMems.map(m => (m.role || '').toLowerCase().trim());
    const propRoles = ((propMemsRes.data || []) as Array<{ role: string | null }>).map(m => (m.role || '').toLowerCase().trim());
    return orgRoles.some(r => ['org_super_admin', 'master_admin', 'super_admin', 'ops_super_admin'].includes(r)) ||
        propRoles.some(r => ['property_admin', 'ops_super_admin', 'mst', 'staff', 'tech', 'soft_service_manager', 'soft_service_supervisor'].includes(r)) ||
        (orgRoles.includes('it') && ticket.assigned_to === userId) ||
        orgMems.some(m => (m.role || '').toLowerCase().trim() === 'tech' && m.organization_id === ticket.organization_id);
}

/** Throws unless the signed-in user can open this request. `userClient` must be the user's own (RLS) session. */
async function assertCanView(userClient: SupabaseClient, userId: string, ticketId: unknown): Promise<string> {
    if (!isUuid(ticketId)) throw new TicketAttachmentError(400, 'That request is not valid.');
    const { data: ticket, error } = await userClient
        .from('tickets').select('id, internal, organization_id, assigned_to').eq('id', ticketId).maybeSingle();
    if (error) {
        console.error('[TicketAttachments] could not read the request:', error);
        throw new TicketAttachmentError(500, 'Could not open the request just now. Please try again.');
    }
    if (!ticket) throw new TicketAttachmentError(404, 'Request not found.');
    if (ticket.internal && !(await isStaffFor(userId, ticket))) throw new TicketAttachmentError(404, 'Request not found.');
    return ticket.id as string;
}

/** Refuses clearly when the migration has not been applied yet (nothing is uploaded in that case). */
async function assertReady(): Promise<void> {
    const { error } = await supabaseAdmin.from('ticket_attachments').select('id').limit(1);
    if (error && isMissingSchema(error)) {
        throw new TicketAttachmentError(503, 'Attaching files is not switched on yet. Please ask the admin to apply the latest database update.', 'NOT_READY');
    }
    if (error) throw error;
}

async function logActivity(ticketId: string, userId: string, action: string, fileName: string): Promise<void> {
    const { error } = await supabaseAdmin.from('ticket_activity_log').insert({ ticket_id: ticketId, user_id: userId, action, new_value: fileName });
    if (error) console.error('[TicketAttachments] could not log activity:', error);
}

export async function listTicketAttachments(userClient: SupabaseClient, userId: string, rawTicketId: unknown): Promise<TicketAttachmentView[]> {
    const ticketId = await assertCanView(userClient, userId, rawTicketId);
    const { data, error } = await supabaseAdmin.from('ticket_attachments')
        .select('id, storage_path, file_name, file_type, file_size, uploaded_by, created_at')
        .eq('ticket_id', ticketId).order('created_at', { ascending: true });
    if (error) {
        if (isMissingSchema(error)) return [];
        console.error('[TicketAttachments] could not list files:', error);
        throw new TicketAttachmentError(500, 'Could not load the files just now. Please try again.');
    }
    const rows = (data || []) as Array<{ id: string; storage_path: string; file_name: string; file_type: string; file_size: number; uploaded_by: string | null; created_at: string }>;
    const uploaderIds = Array.from(new Set(rows.map(r => r.uploaded_by).filter((x): x is string => !!x)));
    const names = new Map<string, string>();
    if (uploaderIds.length) {
        const { data: users } = await supabaseAdmin.from('users').select('id, full_name').in('id', uploaderIds);
        for (const u of (users || []) as Array<{ id: string; full_name: string | null }>) names.set(u.id, u.full_name || 'Someone');
    }
    return Promise.all(rows.map(async r => {
        const { data: link, error: linkError } = await supabaseAdmin.storage.from(TICKET_ATTACHMENT_BUCKET)
            .createSignedUrl(r.storage_path, LINK_SECONDS, { download: safeFileName(r.file_name, r.file_type) });
        if (linkError) console.error('[TicketAttachments] could not make a download link:', linkError);
        return {
            id: r.id, fileName: r.file_name, fileType: r.file_type, fileSize: r.file_size,
            uploadedByName: (r.uploaded_by && names.get(r.uploaded_by)) || 'Someone',
            createdAt: r.created_at, url: link?.signedUrl ?? null,
            canDelete: r.uploaded_by === userId,
        };
    }));
}

export async function uploadTicketAttachment(
    userClient: SupabaseClient, userId: string, input: { ticketId: unknown; fileName: string; bytes: Uint8Array },
): Promise<{ id: string }> {
    if (!input.bytes.length || input.bytes.length > MAX_TICKET_ATTACHMENT_BYTES) throw new TicketAttachmentError(400, 'Choose a file up to 10 MB.');
    const type = attachmentType(input.bytes, String(input.fileName || ''));
    if (!type) throw new TicketAttachmentError(400, 'Only PDF, Word, Excel or image files (PNG, JPG, WEBP) can be attached.', 'BAD_TYPE');
    const fileName = safeFileName(input.fileName, type);

    const ticketId = await assertCanView(userClient, userId, input.ticketId);
    await assertReady();
    const { count } = await supabaseAdmin.from('ticket_attachments').select('id', { count: 'exact', head: true }).eq('ticket_id', ticketId);
    if ((count ?? 0) >= MAX_FILES_PER_TICKET) {
        throw new TicketAttachmentError(409, `A request can have at most ${MAX_FILES_PER_TICKET} files.`, 'TOO_MANY_FILES');
    }

    const path = `${ticketId}/${randomUUID()}.${EXTENSION[type]}`;
    const { error: uploadError } = await supabaseAdmin.storage.from(TICKET_ATTACHMENT_BUCKET)
        .upload(path, input.bytes, { contentType: type, upsert: false });
    if (uploadError) {
        console.error('[TicketAttachments] upload failed:', uploadError);
        throw new TicketAttachmentError(500, 'Could not save the file just now. Please try again.');
    }
    const { data: row, error: rowError } = await supabaseAdmin.from('ticket_attachments').insert({
        ticket_id: ticketId, uploaded_by: userId, storage_path: path, file_name: fileName, file_type: type, file_size: input.bytes.length,
    }).select('id').single();
    if (rowError || !row) {
        console.error('[TicketAttachments] could not list the file on the request:', rowError);
        await supabaseAdmin.storage.from(TICKET_ATTACHMENT_BUCKET).remove([path]);
        throw new TicketAttachmentError(500, 'Could not attach the file just now. Please try again.');
    }
    await logActivity(ticketId, userId, 'attachment_added', fileName);
    return { id: row.id as string };
}

export async function removeTicketAttachment(userClient: SupabaseClient, userId: string, rawTicketId: unknown, attachmentId: unknown): Promise<{ id: string }> {
    if (!isUuid(attachmentId)) throw new TicketAttachmentError(400, 'That file is not valid.');
    const ticketId = await assertCanView(userClient, userId, rawTicketId);
    await assertReady();
    const { data: row, error } = await supabaseAdmin.from('ticket_attachments')
        .select('id, storage_path, file_name, uploaded_by').eq('id', attachmentId).eq('ticket_id', ticketId).maybeSingle();
    if (error) {
        console.error('[TicketAttachments] could not read the file:', error);
        throw new TicketAttachmentError(500, 'Could not remove the file just now. Please try again.');
    }
    if (!row) throw new TicketAttachmentError(404, 'That file is no longer there.');
    if (row.uploaded_by !== userId) throw new TicketAttachmentError(403, 'Only the person who attached this file can remove it.', 'NOT_UPLOADER');

    const { error: delError } = await supabaseAdmin.from('ticket_attachments').delete().eq('id', row.id);
    if (delError) {
        console.error('[TicketAttachments] could not remove the file:', delError);
        throw new TicketAttachmentError(500, 'Could not remove the file just now. Please try again.');
    }
    const { error: storageError } = await supabaseAdmin.storage.from(TICKET_ATTACHMENT_BUCKET).remove([row.storage_path as string]);
    if (storageError) console.error('[TicketAttachments] file unlisted but not removed from storage:', row.storage_path, storageError);
    await logActivity(ticketId, userId, 'attachment_removed', row.file_name as string);
    return { id: row.id as string };
}
