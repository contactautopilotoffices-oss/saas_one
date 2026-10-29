import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { isMissingSchema } from '@/task-manager/TaskLinks';

/**
 * Files (owner 2026-10-29): one shared drive per organisation for the Design console and the Tech console.
 * Anyone on either team can upload, download, make folders and delete any item (owner rule).
 *
 *   upload:   uploadUrl() makes an 'uploading' row + a one-time signed upload link → the browser uploads straight to
 *             the private bucket (no file passes through our server) → complete() checks the stored object and marks
 *             the row 'ready'. Only 'ready' rows are listed.
 *   download: a 60-second signed link that saves under the item's own name.
 *   delete:   removes the stored files of the item and everything inside it, then the row (children cascade).
 *
 * Who may call is checked here from the person's active organisation memberships, never from the request.
 */

export const SHARED_FILES_BUCKET = 'shared-files';
export const MAX_FILE_BYTES = 200 * 1024 * 1024;
export type FilesTeam = 'design' | 'tech';
export const isFilesTeam = (v: unknown): v is FilesTeam => v === 'design' || v === 'tech';

const LINK_SECONDS = 60;
/** An upload that never finished (tab closed) is cleared after this long. */
const STALE_UPLOAD_MS = 24 * 60 * 60 * 1000;
const NOT_READY = 'Files is not set up yet. Please ask the admin to apply the latest database update (shared files).';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class SharedFilesError extends Error {
    constructor(public readonly status: number, message: string, public readonly code?: string) {
        super(message);
        this.name = 'SharedFilesError';
    }
}

function dbFail(error: unknown, fallback: string): never {
    if (isMissingSchema(error)) throw new SharedFilesError(503, NOT_READY, 'NOT_READY');
    console.error(`[SharedFiles] ${fallback}:`, (error as { message?: string } | null)?.message ?? error);
    throw new SharedFilesError(500, fallback);
}

interface Row {
    id: string; organization_id: string; parent_id: string | null; kind: 'folder' | 'file'; name: string;
    size_bytes: number | null; mime_type: string | null; storage_path: string | null; status: 'uploading' | 'ready';
    team: FilesTeam; created_by: string | null; created_at: string; updated_at: string;
}

export interface SharedFileItem {
    id: string; kind: 'folder' | 'file'; name: string; sizeBytes: number | null; mimeType: string | null;
    team: FilesTeam; createdByName: string; updatedAt: string; itemCount: number | null;
}

/** Same clean-up the Task Manager uses for attachment names: no slashes or control characters. */
export function cleanName(raw: unknown): string {
    return String(raw ?? '').normalize('NFC').replace(/[\\/\u0000-\u001f\u007f\p{Cf}]/gu, '_').replace(/\s+/g, ' ').trim().slice(0, 200);
}

export class SharedFilesService {
    /** The signed-in person must hold the console's role ('design' or 'tech') in this organisation. */
    static async assertAccess(userId: string, organizationId: string, team: FilesTeam) {
        if (!UUID.test(organizationId)) throw new SharedFilesError(400, 'Unknown organisation');
        const { data, error } = await supabaseAdmin.from('organization_memberships').select('role')
            .eq('user_id', userId).eq('organization_id', organizationId).eq('is_active', true);
        if (error) dbFail(error, 'Could not check access');
        if (!((data ?? []) as Array<{ role: string | null }>).some(m => m.role === team)) {
            throw new SharedFilesError(403, 'Forbidden: Files is for the Design and Tech teams only');
        }
    }

    private static async item(organizationId: string, id: unknown): Promise<Row> {
        if (typeof id !== 'string' || !UUID.test(id)) throw new SharedFilesError(400, 'Unknown item');
        const { data, error } = await supabaseAdmin.from('shared_files').select('*').eq('id', id).eq('organization_id', organizationId).maybeSingle();
        if (error) dbFail(error, 'Could not load the item');
        if (!data) throw new SharedFilesError(404, 'This item no longer exists. It may have been deleted.');
        return data as Row;
    }

    /** A folder to put things in (null = top level); it must be a ready folder of this organisation. */
    private static async folder(organizationId: string, parentId: unknown): Promise<string | null> {
        if (parentId === null || parentId === undefined || parentId === '') return null;
        const f = await this.item(organizationId, parentId);
        if (f.kind !== 'folder') throw new SharedFilesError(400, 'That is not a folder.');
        return f.id;
    }

    /** What is in one folder, plus the path to it (for the breadcrumbs). */
    static async list(organizationId: string, parentId: unknown) {
        const folderId = await this.folder(organizationId, parentId);
        let q = supabaseAdmin.from('shared_files').select('*').eq('organization_id', organizationId).eq('status', 'ready');
        q = folderId ? q.eq('parent_id', folderId) : q.is('parent_id', null);
        const { data, error } = await q;
        if (error) dbFail(error, 'Could not load the files');
        const rows = (data ?? []) as Row[];

        const folderIds = rows.filter(r => r.kind === 'folder').map(r => r.id);
        const userIds = [...new Set(rows.map(r => r.created_by).filter((v): v is string => !!v))];
        const [countRes, namesRes] = await Promise.all([
            folderIds.length
                ? supabaseAdmin.from('shared_files').select('parent_id').in('parent_id', folderIds).eq('status', 'ready')
                : Promise.resolve({ data: [], error: null }),
            userIds.length
                ? supabaseAdmin.from('users').select('id, full_name').in('id', userIds)
                : Promise.resolve({ data: [], error: null }),
        ]);
        const counts = new Map<string, number>();
        for (const r of (countRes.data ?? []) as Array<{ parent_id: string }>) counts.set(r.parent_id, (counts.get(r.parent_id) ?? 0) + 1);
        const nameOf = new Map(((namesRes.data ?? []) as Array<{ id: string; full_name: string | null }>).map(u => [u.id, u.full_name || 'Someone']));

        const items: SharedFileItem[] = rows.map(r => ({
            id: r.id, kind: r.kind, name: r.name, sizeBytes: r.size_bytes, mimeType: r.mime_type, team: r.team,
            createdByName: (r.created_by && nameOf.get(r.created_by)) || 'Someone', updatedAt: r.updated_at,
            itemCount: r.kind === 'folder' ? counts.get(r.id) ?? 0 : null,
        }));

        const path: Array<{ id: string; name: string }> = [];
        let at = folderId;
        while (at && path.length < 50) {
            const { data: f } = await supabaseAdmin.from('shared_files').select('id, name, parent_id').eq('id', at).maybeSingle();
            if (!f) break;
            path.unshift({ id: f.id, name: f.name });
            at = f.parent_id;
        }
        return { items, path, maxFileBytes: MAX_FILE_BYTES };
    }

    static async createFolder(userId: string, organizationId: string, team: FilesTeam, input: { name?: unknown; parentId?: unknown }) {
        const name = cleanName(input.name);
        if (!name) throw new SharedFilesError(400, 'Please give the folder a name.');
        const parentId = await this.folder(organizationId, input.parentId);
        let dup = supabaseAdmin.from('shared_files').select('id').eq('organization_id', organizationId).eq('kind', 'folder').eq('status', 'ready').ilike('name', name.replace(/[%_\\]/g, '\\$&'));
        dup = parentId ? dup.eq('parent_id', parentId) : dup.is('parent_id', null);
        const { data: existing, error: dupErr } = await dup.limit(1);
        if (dupErr) dbFail(dupErr, 'Could not create the folder');
        if (existing?.length) throw new SharedFilesError(409, `A folder called "${name}" is already here. Pick another name.`);
        const { data, error } = await supabaseAdmin.from('shared_files')
            .insert({ organization_id: organizationId, parent_id: parentId, kind: 'folder', name, team, created_by: userId })
            .select('id').single();
        if (error) dbFail(error, 'Could not create the folder');
        return { id: data.id as string };
    }

    /** A one-time upload link for one file; the browser uploads straight to storage. */
    static async uploadUrl(userId: string, organizationId: string, team: FilesTeam, input: { name?: unknown; size?: unknown; mimeType?: unknown; parentId?: unknown }) {
        const name = cleanName(input.name);
        if (!name) throw new SharedFilesError(400, 'This file has no name.');
        const size = Number(input.size);
        if (!Number.isFinite(size) || size < 0) throw new SharedFilesError(400, 'Unknown file size.');
        if (size > MAX_FILE_BYTES) throw new SharedFilesError(413, `"${name}" is larger than 200 MB. Files can be up to 200 MB.`);
        const parentId = await this.folder(organizationId, input.parentId);
        await this.clearStaleUploads(organizationId);

        const mimeType = typeof input.mimeType === 'string' && input.mimeType.length <= 200 ? input.mimeType : null;
        const { data: row, error } = await supabaseAdmin.from('shared_files')
            .insert({ organization_id: organizationId, parent_id: parentId, kind: 'file', name, size_bytes: size, mime_type: mimeType, status: 'uploading', team, created_by: userId })
            .select('id').single();
        if (error) dbFail(error, 'Could not prepare the upload');

        const path = `${organizationId}/${row.id}`;
        const { data: link, error: linkErr } = await supabaseAdmin.storage.from(SHARED_FILES_BUCKET).createSignedUploadUrl(path);
        if (linkErr || !link) {
            await supabaseAdmin.from('shared_files').delete().eq('id', row.id);
            console.error('[SharedFiles] upload link failed:', linkErr?.message);
            const missing = /not found/i.test(linkErr?.message || '');
            throw new SharedFilesError(missing ? 503 : 500, missing ? NOT_READY : 'Could not prepare the upload.', missing ? 'NOT_READY' : undefined);
        }
        await supabaseAdmin.from('shared_files').update({ storage_path: path }).eq('id', row.id);
        return { id: row.id as string, signedUrl: link.signedUrl };
    }

    /** The browser says the upload finished: check the stored object, then show the file. */
    static async complete(organizationId: string, id: unknown) {
        const r = await this.item(organizationId, id);
        if (r.kind !== 'file' || !r.storage_path) throw new SharedFilesError(400, 'Unknown upload.');
        if (r.status === 'ready') return { ok: true };
        const { data, error } = await supabaseAdmin.storage.from(SHARED_FILES_BUCKET).list(organizationId, { search: r.id, limit: 5 });
        const stored = (data ?? []).find(o => o.name === r.id);
        if (error || !stored) throw new SharedFilesError(409, 'The upload did not reach storage. Please try again.');
        const size = Number((stored.metadata as { size?: number } | null)?.size ?? r.size_bytes ?? 0);
        const { error: upErr } = await supabaseAdmin.from('shared_files')
            .update({ status: 'ready', size_bytes: size, updated_at: new Date().toISOString() }).eq('id', r.id);
        if (upErr) dbFail(upErr, 'Could not finish the upload');
        await this.touch(r.parent_id);
        return { ok: true };
    }

    /** A short link that downloads the file under its own name. */
    static async downloadUrl(organizationId: string, id: unknown) {
        const r = await this.item(organizationId, id);
        if (r.kind !== 'file' || r.status !== 'ready' || !r.storage_path) throw new SharedFilesError(400, 'Only files can be downloaded.');
        const { data, error } = await supabaseAdmin.storage.from(SHARED_FILES_BUCKET).createSignedUrl(r.storage_path, LINK_SECONDS, { download: r.name });
        if (error || !data) {
            console.error('[SharedFiles] download link failed:', error?.message);
            throw new SharedFilesError(500, 'Could not prepare the download.');
        }
        return { url: data.signedUrl };
    }

    /** Deletes a file, or a folder and everything inside it. */
    static async remove(organizationId: string, id: unknown) {
        const root = await this.item(organizationId, id);
        const paths: string[] = root.storage_path ? [root.storage_path] : [];
        let level = root.kind === 'folder' ? [root.id] : [];
        while (level.length) {
            const { data, error } = await supabaseAdmin.from('shared_files').select('id, kind, storage_path').in('parent_id', level);
            if (error) dbFail(error, 'Could not delete');
            const kids = (data ?? []) as Array<Pick<Row, 'id' | 'kind' | 'storage_path'>>;
            for (const k of kids) if (k.storage_path) paths.push(k.storage_path);
            level = kids.filter(k => k.kind === 'folder').map(k => k.id);
        }
        await this.removeObjects(paths);
        const { error } = await supabaseAdmin.from('shared_files').delete().eq('id', root.id);
        if (error) dbFail(error, 'Could not delete');
        await this.touch(root.parent_id);
        return { ok: true };
    }

    private static async removeObjects(paths: string[]) {
        for (let i = 0; i < paths.length; i += 500) {
            const { error } = await supabaseAdmin.storage.from(SHARED_FILES_BUCKET).remove(paths.slice(i, i + 500));
            if (error) {
                console.error('[SharedFiles] storage delete failed:', error.message);
                throw new SharedFilesError(500, 'Could not delete the stored files. Please try again.');
            }
        }
    }

    /** A folder shows as modified when something inside it changes. */
    private static async touch(folderId: string | null) {
        if (folderId) await supabaseAdmin.from('shared_files').update({ updated_at: new Date().toISOString() }).eq('id', folderId);
    }

    private static async clearStaleUploads(organizationId: string) {
        const before = new Date(Date.now() - STALE_UPLOAD_MS).toISOString();
        const { data } = await supabaseAdmin.from('shared_files').select('id, storage_path')
            .eq('organization_id', organizationId).eq('status', 'uploading').lt('created_at', before).limit(100);
        const stale = (data ?? []) as Array<{ id: string; storage_path: string | null }>;
        if (!stale.length) return;
        await supabaseAdmin.storage.from(SHARED_FILES_BUCKET).remove(stale.map(s => s.storage_path).filter((p): p is string => !!p));
        await supabaseAdmin.from('shared_files').delete().in('id', stale.map(s => s.id));
    }
}
