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
 * Owner 2026-11-13 (Files tab upgrade): rename, move, copy, a Bin with restore (20261113000001_shared_files_bin.sql)
 * and per-person stars (20261113000002_shared_file_stars.sql). The Bin and stars switch on once their migration is
 * applied; before that, list() reports them as off and delete stays permanent.
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
/** Items stay in the Bin this long, then are removed for good on the next listing. */
const BIN_DAYS = 30;
/** Most items one copy or one move may touch (a folder and everything in it). */
const MAX_COPY_ITEMS = 300;
const MAX_BATCH = 200;
const NOT_READY = 'Files is not set up yet. Please ask the admin to apply the latest database update (shared files).';
const BIN_NOT_READY = 'The Bin is not set up yet. Please ask the admin to apply the latest database update (shared files bin).';
const STARS_NOT_READY = 'Stars are not set up yet. Please ask the admin to apply the latest database update (shared file stars).';
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

/** Postgres / PostgREST: "that column does not exist" (the table is there, a later migration is not). */
const isMissingColumn = (e: unknown) => ['42703', 'PGRST204'].includes(String((e as { code?: string } | null)?.code ?? ''));

// Whether the Bin columns / the stars table are in the database. `false` is re-checked after a minute so the
// features switch on by themselves once the migration is applied, without a redeploy.
let binReady: { ok: boolean; at: number } | null = null;
let starsReady: { ok: boolean; at: number } | null = null;
const RECHECK_MS = 60 * 1000;
const assume = (s: { ok: boolean; at: number } | null) => s === null || s.ok || Date.now() - s.at > RECHECK_MS;

interface Row {
    id: string; organization_id: string; parent_id: string | null; kind: 'folder' | 'file'; name: string;
    size_bytes: number | null; mime_type: string | null; storage_path: string | null; status: 'uploading' | 'ready';
    team: FilesTeam; created_by: string | null; created_at: string; updated_at: string;
    /** 20261102000002_shared_files_notes.sql; undefined until that migration is applied. */
    note?: string | null;
    /** 20261113000001_shared_files_bin.sql; undefined until that migration is applied. */
    deleted_at?: string | null;
    deleted_by?: string | null;
}

export interface SharedFileItem {
    id: string; kind: 'folder' | 'file'; name: string; sizeBytes: number | null; mimeType: string | null;
    team: FilesTeam; createdByName: string; createdAt: string; updatedAt: string; itemCount: number | null; note: string | null;
    /** Starred by the person asking (never by someone else). */
    starred: boolean;
    /** Bin only: when it was binned and the folder it was in ('Files' = top level). */
    deletedAt: string | null; location: string | null;
}

export const MAX_NOTE_CHARS = 2000;

/** Same clean-up the Task Manager uses for attachment names: no slashes or control characters. */
export function cleanName(raw: unknown): string {
    return String(raw ?? '').normalize('NFC').replace(/[\\/\u0000-\u001f\u007f\p{Cf}]/gu, '_').replace(/\s+/g, ' ').trim().slice(0, 200);
}

const likeSafe = (s: string) => s.replace(/[%_\\]/g, '\\$&');

/** Preview (owner 2026-11-13): only these open in the browser; everything else downloads. */
export function previewType(name: string, mime: string | null): string | null {
    const m = (mime || '').toLowerCase();
    if (/^image\/(png|jpeg|gif|webp|svg\+xml|bmp|avif)$/.test(m) || m === 'application/pdf' || /^video\/(mp4|webm|quicktime)$/.test(m) || /^audio\/(mpeg|wav|mp4|aac|ogg|flac)$/.test(m)) return m;
    const e = name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';
    const byExt: Record<string, string> = {
        png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp', avif: 'image/avif',
        pdf: 'application/pdf', mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', m4v: 'video/mp4',
        mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', aac: 'audio/aac', ogg: 'audio/ogg', flac: 'audio/flac',
    };
    return byExt[e] ?? null;
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

    /** An item that is shown in Files: ready, not in the Bin, and not inside a folder that is in the Bin. */
    private static async live(organizationId: string, id: unknown): Promise<Row> {
        const r = await this.item(organizationId, id);
        if (r.status !== 'ready') throw new SharedFilesError(404, 'This file has not finished uploading.');
        if (r.deleted_at) throw new SharedFilesError(404, 'This item is in the Bin. Restore it first.');
        if (r.parent_id && (await this.ancestors(r.parent_id)).some(a => a.deleted_at)) {
            throw new SharedFilesError(404, 'The folder this is in has been moved to the Bin. Restore that folder first.');
        }
        return r;
    }

    private static ids(raw: unknown): string[] {
        const list = Array.isArray(raw) ? raw : [raw];
        const ids = [...new Set(list.filter((v): v is string => typeof v === 'string' && UUID.test(v)))];
        if (!ids.length) throw new SharedFilesError(400, 'Nothing selected.');
        if (ids.length > MAX_BATCH) throw new SharedFilesError(400, `Please select up to ${MAX_BATCH} items at a time.`);
        return ids;
    }

    private static async liveMany(organizationId: string, raw: unknown): Promise<Row[]> {
        const ids = this.ids(raw);
        const { data, error } = await supabaseAdmin.from('shared_files').select('*').eq('organization_id', organizationId).in('id', ids);
        if (error) dbFail(error, 'Could not load the items');
        const rows = ((data ?? []) as Row[]).filter(r => r.status === 'ready' && !r.deleted_at);
        if (!rows.length) throw new SharedFilesError(404, 'Those items no longer exist. They may have been deleted.');
        return rows;
    }

    /** A folder to put things in (null = top level); it must be a ready folder of this organisation, not in the Bin. */
    private static async folder(organizationId: string, parentId: unknown): Promise<string | null> {
        if (parentId === null || parentId === undefined || parentId === '') return null;
        const f = await this.live(organizationId, parentId);
        if (f.kind !== 'folder') throw new SharedFilesError(400, 'That is not a folder.');
        return f.id;
    }

    /** The folder and all its parents, nearest first (empty for top level). Walks the whole way up, however deep. */
    private static async ancestors(folderId: string | null): Promise<Array<{ id: string; name: string; deleted_at?: string | null }>> {
        const out: Array<{ id: string; name: string; deleted_at?: string | null }> = [];
        const seen = new Set<string>();
        let at = folderId;
        while (at && !seen.has(at)) {
            seen.add(at);
            const { data: f } = await supabaseAdmin.from('shared_files').select('*').eq('id', at).maybeSingle();
            if (!f) break;
            const row = f as Row;
            out.push({ id: row.id, name: row.name, deleted_at: row.deleted_at });
            at = row.parent_id;
        }
        return out;
    }

    /** Every row under these folders, level by level (the folders themselves are not included). */
    private static async subtree(rootIds: string[]): Promise<Row[]> {
        const all: Row[] = [];
        let level = rootIds;
        while (level.length) {
            const { data, error } = await supabaseAdmin.from('shared_files').select('*').in('parent_id', level);
            if (error) dbFail(error, 'Could not read the folder');
            const kids = (data ?? []) as Row[];
            all.push(...kids);
            level = kids.filter(k => k.kind === 'folder').map(k => k.id);
        }
        return all;
    }

    private static async folderNameTaken(organizationId: string, parentId: string | null, name: string, exceptId?: string) {
        let dup = supabaseAdmin.from('shared_files').select('*').eq('organization_id', organizationId).eq('kind', 'folder').eq('status', 'ready').ilike('name', likeSafe(name));
        dup = parentId ? dup.eq('parent_id', parentId) : dup.is('parent_id', null);
        if (exceptId) dup = dup.neq('id', exceptId);
        const { data, error } = await dup.limit(20);
        if (error) dbFail(error, 'Could not check the name');
        return ((data ?? []) as Array<{ deleted_at?: string | null }>).some(r => !r.deleted_at);
    }

    /** What is in one folder (or the Bin), plus the path to it (for the breadcrumbs). */
    static async list(organizationId: string, parentId: unknown, opts: { userId: string; view?: 'files' | 'bin'; foldersOnly?: boolean }) {
        const bin = opts.view === 'bin';
        let folderId: string | null = null;
        let rows: Row[] = [];
        let binOn = false;

        if (bin) {
            await this.purgeBin(organizationId);
            const { data, error } = await supabaseAdmin.from('shared_files').select('*').eq('organization_id', organizationId).eq('status', 'ready').not('deleted_at', 'is', null);
            if (error) {
                if (isMissingColumn(error)) { binReady = { ok: false, at: Date.now() }; throw new SharedFilesError(503, BIN_NOT_READY, 'NOT_READY'); }
                dbFail(error, 'Could not load the Bin');
            }
            binReady = { ok: true, at: Date.now() };
            binOn = true;
            rows = (data ?? []) as Row[];
        } else {
            folderId = await this.folder(organizationId, parentId);
            const run = (withBin: boolean) => {
                let q = supabaseAdmin.from('shared_files').select('*').eq('organization_id', organizationId).eq('status', 'ready');
                q = folderId ? q.eq('parent_id', folderId) : q.is('parent_id', null);
                if (opts.foldersOnly) q = q.eq('kind', 'folder');
                if (withBin) q = q.is('deleted_at', null);
                return q;
            };
            let res = assume(binReady) ? await run(true) : null;
            if (res && res.error && isMissingColumn(res.error)) { binReady = { ok: false, at: Date.now() }; res = null; }
            else if (res && !res.error) { binReady = { ok: true, at: Date.now() }; binOn = true; }
            if (!res) res = await run(false);
            if (res.error) dbFail(res.error, 'Could not load the files');
            rows = (res.data ?? []) as Row[];
        }

        const folderIds = rows.filter(r => r.kind === 'folder').map(r => r.id);
        const userIds = [...new Set(rows.map(r => r.created_by).filter((v): v is string => !!v))];
        const parentIds = bin ? [...new Set(rows.map(r => r.parent_id).filter((v): v is string => !!v))] : [];
        const [countRes, namesRes, starRes, parentRes] = await Promise.all([
            folderIds.length
                ? (binOn
                    ? supabaseAdmin.from('shared_files').select('parent_id').in('parent_id', folderIds).eq('status', 'ready').is('deleted_at', null)
                    : supabaseAdmin.from('shared_files').select('parent_id').in('parent_id', folderIds).eq('status', 'ready'))
                : Promise.resolve({ data: [], error: null }),
            userIds.length
                ? supabaseAdmin.from('users').select('id, full_name').in('id', userIds)
                : Promise.resolve({ data: [], error: null }),
            rows.length && assume(starsReady)
                ? supabaseAdmin.from('shared_file_stars').select('file_id').eq('user_id', opts.userId).in('file_id', rows.map(r => r.id))
                : Promise.resolve({ data: [], error: null }),
            parentIds.length
                ? supabaseAdmin.from('shared_files').select('id, name').in('id', parentIds)
                : Promise.resolve({ data: [], error: null }),
        ]);
        const counts = new Map<string, number>();
        for (const r of (countRes.data ?? []) as Array<{ parent_id: string }>) counts.set(r.parent_id, (counts.get(r.parent_id) ?? 0) + 1);
        const nameOf = new Map(((namesRes.data ?? []) as Array<{ id: string; full_name: string | null }>).map(u => [u.id, u.full_name || 'Someone']));
        const parentName = new Map(((parentRes.data ?? []) as Array<{ id: string; name: string }>).map(p => [p.id, p.name]));

        let starsOn = false;
        const starred = new Set<string>();
        if (rows.length && assume(starsReady)) {
            if (starRes.error) {
                if (isMissingSchema(starRes.error)) starsReady = { ok: false, at: Date.now() };
                else console.error('[SharedFiles] stars failed:', starRes.error.message);
            } else {
                starsReady = { ok: true, at: Date.now() };
                starsOn = true;
                for (const s of (starRes.data ?? []) as Array<{ file_id: string }>) starred.add(s.file_id);
            }
        } else if (starsReady?.ok) starsOn = true;

        const items: SharedFileItem[] = rows.map(r => ({
            id: r.id, kind: r.kind, name: r.name, sizeBytes: r.size_bytes, mimeType: r.mime_type, team: r.team,
            createdByName: (r.created_by && nameOf.get(r.created_by)) || 'Someone', createdAt: r.created_at, updatedAt: r.updated_at,
            itemCount: r.kind === 'folder' ? counts.get(r.id) ?? 0 : null, note: r.note ?? null, starred: starred.has(r.id),
            deletedAt: r.deleted_at ?? null,
            location: bin ? (r.parent_id ? parentName.get(r.parent_id) ?? 'Files' : 'Files') : null,
        }));

        const path = bin ? [] : (await this.ancestors(folderId)).reverse().map(a => ({ id: a.id, name: a.name }));
        return { items, path, maxFileBytes: MAX_FILE_BYTES, features: { bin: binOn || binReady?.ok === true, stars: starsOn, binDays: BIN_DAYS } };
    }

    static async createFolder(userId: string, organizationId: string, team: FilesTeam, input: { name?: unknown; parentId?: unknown }) {
        const name = cleanName(input.name);
        if (!name) throw new SharedFilesError(400, 'Please give the folder a name.');
        const parentId = await this.folder(organizationId, input.parentId);
        if (await this.folderNameTaken(organizationId, parentId, name)) throw new SharedFilesError(409, `A folder called "${name}" is already here. Pick another name.`);
        const { data, error } = await supabaseAdmin.from('shared_files')
            .insert({ organization_id: organizationId, parent_id: parentId, kind: 'folder', name, team, created_by: userId })
            .select('id').single();
        if (error) dbFail(error, 'Could not create the folder');
        await this.touch(parentId);
        return { id: data.id as string };
    }

    /** Owner 2026-11-13: a new name for a file or folder. Folder names stay unique within their folder. */
    static async rename(organizationId: string, id: unknown, rawName: unknown) {
        const r = await this.live(organizationId, id);
        const name = cleanName(rawName);
        if (!name) throw new SharedFilesError(400, 'Please give it a name.');
        if (name === r.name) return { name };
        if (r.kind === 'folder' && await this.folderNameTaken(organizationId, r.parent_id, name, r.id)) {
            throw new SharedFilesError(409, `A folder called "${name}" is already here. Pick another name.`);
        }
        const { error } = await supabaseAdmin.from('shared_files').update({ name, updated_at: new Date().toISOString() }).eq('id', r.id);
        if (error) dbFail(error, 'Could not rename');
        await this.touch(r.parent_id);
        return { name };
    }

    /**
     * Owner 2026-11-13: puts one or more items into another folder (null = top level). A folder can't go into itself
     * or into one of its own folders. Items already there are left alone.
     */
    static async move(organizationId: string, rawIds: unknown, targetId: unknown) {
        const target = await this.folder(organizationId, targetId);
        const rows = await this.liveMany(organizationId, rawIds);
        const moving = new Set(rows.map(r => r.id));
        if (target) {
            const up = await this.ancestors(target);
            if (up.some(a => moving.has(a.id))) throw new SharedFilesError(400, "A folder can't be moved into itself or into one of its own folders.");
        }
        const todo = rows.filter(r => r.parent_id !== target);
        const names = new Set<string>();
        for (const r of todo) {
            if (r.kind !== 'folder') continue;
            const key = r.name.toLowerCase();
            if (names.has(key) || await this.folderNameTaken(organizationId, target, r.name)) {
                throw new SharedFilesError(409, `A folder called "${r.name}" is already in the destination. Rename one of them first.`);
            }
            names.add(key);
        }
        if (todo.length) {
            const { error } = await supabaseAdmin.from('shared_files').update({ parent_id: target, updated_at: new Date().toISOString() }).in('id', todo.map(r => r.id));
            if (error) dbFail(error, 'Could not move');
        }
        await Promise.all([...new Set([target, ...todo.map(r => r.parent_id)])].map(p => this.touch(p)));
        return { moved: todo.length };
    }

    /** "Copy of X", or "Copy of X (2)" and so on when that name is already used by the same kind of item here. */
    private static async copyName(organizationId: string, parentId: string | null, kind: 'folder' | 'file', original: string) {
        const base = `Copy of ${original}`.slice(0, 190);
        let q = supabaseAdmin.from('shared_files').select('*').eq('organization_id', organizationId).eq('kind', kind).eq('status', 'ready').ilike('name', `${likeSafe(base)}%`);
        q = parentId ? q.eq('parent_id', parentId) : q.is('parent_id', null);
        const { data } = await q.limit(200);
        const used = new Set(((data ?? []) as Array<{ name: string; deleted_at?: string | null }>).filter(r => !r.deleted_at).map(r => r.name.toLowerCase()));
        if (!used.has(base.toLowerCase())) return base;
        for (let n = 2; n < 1000; n++) { const c = `${base} (${n})`; if (!used.has(c.toLowerCase())) return c; }
        return `${base} (${Date.now()})`;
    }

    /**
     * Owner 2026-11-13: a copy of a file, or of a folder and everything in it, next to the original. Stored files are
     * copied inside the bucket (nothing passes through the server). Half-made copies are removed again on failure.
     */
    static async copy(userId: string, organizationId: string, team: FilesTeam, id: unknown) {
        const root = await this.live(organizationId, id);
        const kids = root.kind === 'folder' ? (await this.subtree([root.id])).filter(k => k.status === 'ready' && !k.deleted_at) : [];
        if (kids.length > MAX_COPY_ITEMS) throw new SharedFilesError(400, `This folder holds more than ${MAX_COPY_ITEMS} items. Please copy its folders one at a time.`);

        const name = await this.copyName(organizationId, root.parent_id, root.kind, root.name);
        const newId = new Map<string, string>();
        const made = await this.copyRow(userId, organizationId, team, root, root.parent_id, name);
        newId.set(root.id, made);
        try {
            // Parents are always copied before their children: subtree() returns rows level by level
            for (const k of kids) {
                const parent = newId.get(k.parent_id!);
                if (!parent) continue;
                newId.set(k.id, await this.copyRow(userId, organizationId, team, k, parent, k.name));
            }
        } catch (e) {
            await this.remove(organizationId, made).catch(() => undefined);
            throw e;
        }
        await this.touch(root.parent_id);
        return { id: made, name };
    }

    private static async copyRow(userId: string, organizationId: string, team: FilesTeam, src: Row, parentId: string | null, name: string): Promise<string> {
        if (src.kind === 'folder') {
            const { data, error } = await supabaseAdmin.from('shared_files')
                .insert({ organization_id: organizationId, parent_id: parentId, kind: 'folder', name, team, created_by: userId, ...(src.note ? { note: src.note } : {}) })
                .select('id').single();
            if (error) dbFail(error, 'Could not copy the folder');
            return data.id as string;
        }
        if (!src.storage_path) throw new SharedFilesError(400, `"${src.name}" has no stored file to copy.`);
        const { data, error } = await supabaseAdmin.from('shared_files')
            .insert({ organization_id: organizationId, parent_id: parentId, kind: 'file', name, size_bytes: src.size_bytes, mime_type: src.mime_type, status: 'uploading', team, created_by: userId, ...(src.note ? { note: src.note } : {}) })
            .select('id').single();
        if (error) dbFail(error, 'Could not copy the file');
        const path = `${organizationId}/${data.id}`;
        const { error: cpErr } = await supabaseAdmin.storage.from(SHARED_FILES_BUCKET).copy(src.storage_path, path);
        if (cpErr) {
            await supabaseAdmin.from('shared_files').delete().eq('id', data.id);
            console.error('[SharedFiles] storage copy failed:', cpErr.message);
            throw new SharedFilesError(500, `Could not copy "${src.name}". Please try again.`);
        }
        const { error: upErr } = await supabaseAdmin.from('shared_files').update({ storage_path: path, status: 'ready' }).eq('id', data.id);
        if (upErr) { await this.removeObjects([path]).catch(() => undefined); await supabaseAdmin.from('shared_files').delete().eq('id', data.id); dbFail(upErr, 'Could not copy the file'); }
        return data.id as string;
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

    /** Internal streaming download URL that avoids exposing Supabase storage URLs. */
    static async downloadUrl(organizationId: string, id: unknown, team?: string, inline = false) {
        const r = await this.live(organizationId, id);
        if (r.kind !== 'file' || r.status !== 'ready' || !r.storage_path) throw new SharedFilesError(400, 'Only files can be downloaded.');
        if (inline && !previewType(r.name, r.mime_type)) throw new SharedFilesError(400, 'This type of file has no preview. Download it instead.');
        const teamParam = team ? `&team=${encodeURIComponent(team)}` : (r.team ? `&team=${encodeURIComponent(r.team)}` : '');
        return { url: `/api/shared-files/${r.id}/download?organization_id=${encodeURIComponent(organizationId)}${teamParam}${inline ? '&inline=1' : ''}` };
    }

    /** Download file directly as a buffer for authenticated streaming. */
    static async downloadFile(organizationId: string, id: unknown, inline = false): Promise<{ buffer: Buffer; name: string; contentType: string; inline: boolean }> {
        const r = await this.live(organizationId, id);
        if (r.kind !== 'file' || r.status !== 'ready' || !r.storage_path) throw new SharedFilesError(400, 'Only files can be downloaded.');
        const preview = inline ? previewType(r.name, r.mime_type) : null;
        const { data: fileBlob, error } = await supabaseAdmin.storage.from(SHARED_FILES_BUCKET).download(r.storage_path);
        if (error || !fileBlob) {
            console.error('[SharedFiles] download failed:', error?.message);
            throw new SharedFilesError(500, 'Could not retrieve file.');
        }
        const buffer = Buffer.from(await fileBlob.arrayBuffer());
        return {
            buffer,
            name: r.name,
            // A preview only ever serves the whitelisted type, never whatever the upload claimed
            contentType: preview ?? r.mime_type ?? fileBlob.type ?? 'application/octet-stream',
            inline: !!preview,
        };
    }

    /**
     * Owner 2026-11-02: sets the one note on a file or folder; empty clears it. Anyone on either team may edit any
     * note (same rule as delete). Editing a note does not change the item's "Last modified".
     */
    static async setNote(organizationId: string, id: unknown, rawNote: unknown) {
        const r = await this.item(organizationId, id);
        const note = String(rawNote ?? '').normalize('NFC').replace(/\r\n?/g, '\n').trim();
        if (note.length > MAX_NOTE_CHARS) throw new SharedFilesError(400, `Notes can be up to ${MAX_NOTE_CHARS} characters.`);
        const { error } = await supabaseAdmin.from('shared_files').update({ note: note || null }).eq('id', r.id);
        if (error) dbFail(error, 'Could not save the note');
        return { note: note || null };
    }

    /** Owner 2026-11-13: a personal star on a file or folder. */
    static async setStar(userId: string, organizationId: string, id: unknown, starred: unknown) {
        const r = await this.live(organizationId, id);
        const { error } = starred
            ? await supabaseAdmin.from('shared_file_stars').upsert({ file_id: r.id, user_id: userId }, { onConflict: 'file_id,user_id', ignoreDuplicates: true })
            : await supabaseAdmin.from('shared_file_stars').delete().eq('file_id', r.id).eq('user_id', userId);
        if (error) {
            if (isMissingSchema(error)) { starsReady = { ok: false, at: Date.now() }; throw new SharedFilesError(503, STARS_NOT_READY, 'NOT_READY'); }
            dbFail(error, 'Could not update the star');
        }
        starsReady = { ok: true, at: Date.now() };
        return { starred: !!starred };
    }

    /** Owner 2026-11-13: puts items in the Bin. What is inside a binned folder stays with it and comes back with it. */
    static async trash(userId: string, organizationId: string, rawIds: unknown) {
        const rows = await this.liveMany(organizationId, rawIds);
        const { error } = await supabaseAdmin.from('shared_files')
            .update({ deleted_at: new Date().toISOString(), deleted_by: userId }).in('id', rows.map(r => r.id));
        if (error) {
            if (isMissingColumn(error)) { binReady = { ok: false, at: Date.now() }; throw new SharedFilesError(503, BIN_NOT_READY, 'NOT_READY'); }
            dbFail(error, 'Could not move to the Bin');
        }
        binReady = { ok: true, at: Date.now() };
        await Promise.all([...new Set(rows.map(r => r.parent_id))].map(p => this.touch(p)));
        return { trashed: rows.length };
    }

    /** Owner 2026-11-13: takes items out of the Bin, back where they were; to the top level if that folder is gone. */
    static async restore(organizationId: string, rawIds: unknown) {
        const ids = this.ids(rawIds);
        const { data, error } = await supabaseAdmin.from('shared_files').select('*').eq('organization_id', organizationId).in('id', ids).not('deleted_at', 'is', null);
        if (error) {
            if (isMissingColumn(error)) throw new SharedFilesError(503, BIN_NOT_READY, 'NOT_READY');
            dbFail(error, 'Could not restore');
        }
        const rows = (data ?? []) as Row[];
        if (!rows.length) throw new SharedFilesError(404, 'Those items are no longer in the Bin.');
        const batch = new Set(rows.map(r => r.id));
        let toTop = 0;
        for (const r of rows) {
            let parent = r.parent_id;
            if (parent) {
                const up = await this.ancestors(parent);
                // A parent being restored in this same call counts as restored
                if (!up.length || up.some(a => a.deleted_at && !batch.has(a.id))) { parent = null; toTop++; }
            }
            // Folder names stay unique: if the name was reused while this was in the Bin, this one comes back marked
            let name = r.name;
            if (r.kind === 'folder' && await this.folderNameTaken(organizationId, parent, name, r.id)) {
                name = `${r.name.slice(0, 185)} (restored)`;
                for (let n = 2; n < 100 && await this.folderNameTaken(organizationId, parent, name, r.id); n++) name = `${r.name.slice(0, 180)} (restored ${n})`;
            }
            const { error: upErr } = await supabaseAdmin.from('shared_files')
                .update({ deleted_at: null, deleted_by: null, parent_id: parent, name, updated_at: new Date().toISOString() }).eq('id', r.id);
            if (upErr) dbFail(upErr, 'Could not restore');
            await this.touch(parent);
        }
        return { restored: rows.length, toTop };
    }

    /** Deletes a file, or a folder and everything inside it, for good. */
    static async remove(organizationId: string, id: unknown) {
        const root = await this.item(organizationId, id);
        const kids = root.kind === 'folder' ? await this.subtree([root.id]) : [];
        const paths = [root, ...kids].map(r => r.storage_path).filter((p): p is string => !!p);
        await this.removeObjects(paths);
        const { error } = await supabaseAdmin.from('shared_files').delete().eq('id', root.id);
        if (error) dbFail(error, 'Could not delete');
        await this.touch(root.parent_id);
        return { ok: true };
    }

    /** Several items for good (the Bin's "Delete forever" with a selection). */
    static async removeMany(organizationId: string, rawIds: unknown) {
        const ids = this.ids(rawIds);
        let deleted = 0;
        for (const id of ids) {
            try { await this.remove(organizationId, id); deleted++; }
            catch (e) { if (!(e instanceof SharedFilesError && e.status === 404)) throw e; }
        }
        return { deleted };
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

    /** Items binned more than BIN_DAYS ago are removed for good, a few at a time, whenever the Bin is opened. */
    private static async purgeBin(organizationId: string) {
        const before = new Date(Date.now() - BIN_DAYS * 864e5).toISOString();
        const { data, error } = await supabaseAdmin.from('shared_files').select('id')
            .eq('organization_id', organizationId).lt('deleted_at', before).limit(25);
        if (error || !data?.length) return;
        for (const r of data as Array<{ id: string }>) await this.remove(organizationId, r.id).catch(e => console.error('[SharedFiles] purge failed:', (e as Error).message));
    }
}
