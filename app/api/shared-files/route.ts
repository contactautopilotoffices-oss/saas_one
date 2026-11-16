import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';
import { SharedFilesError, SharedFilesService, isFilesTeam } from '@/backend/lib/sharedFiles/SharedFilesService';

export const dynamic = 'force-dynamic';

/**
 * Owner 2026-10-29: the "Files" tab of the Design and Tech consoles — one shared drive per organisation.
 * `?organization_id=...&team=design|tech`: the signed-in person must hold that role in that organisation.
 *   GET  &parent_id=...                          what is in a folder (none = top level) + the path to it
 *        &view=bin                               what is in the Bin instead (owner 2026-11-13)
 *        &folders=1                              only the folders in that folder (the "Move to" picker)
 *   POST { action, ... }
 *     create_folder { name, parentId }           new folder
 *     upload_url    { name, size, mimeType, parentId }   one-time signed upload link (≤ 200 MB) → { id, signedUrl }
 *     complete      { id }                       the browser finished uploading → the file is shown
 *     download_url  { id, inline? }              download link → { url }; inline = open in the browser (preview)
 *     rename        { id, name }                 new name → { name }                              (owner 2026-11-13)
 *     move          { ids, targetId }            into another folder (null = top level) → { moved }
 *     copy          { id }                       a copy next to the original → { id, name }
 *     trash         { ids }                      into the Bin → { trashed }
 *     restore       { ids }                      out of the Bin → { restored, toTop }
 *     delete        { id } | { ids }             for good: a file, or a folder and everything in it
 *     set_note      { id, note }                 the item's note (empty clears it) → { note }
 *     set_star      { id, starred }              a personal star → { starred }
 * WHO is acting always comes from the signed-in session.
 */

async function guard(request: NextRequest) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new SharedFilesError(401, 'Unauthorized');
    const organizationId = request.nextUrl.searchParams.get('organization_id') || '';
    const team = request.nextUrl.searchParams.get('team');
    if (!isFilesTeam(team)) throw new SharedFilesError(400, 'Unknown team');
    await SharedFilesService.assertAccess(user.id, organizationId, team);
    return { userId: user.id, organizationId, team };
}

function fail(err: unknown) {
    if (err instanceof SharedFilesError) return NextResponse.json({ success: false, error: err.message, code: err.code }, { status: err.status });
    console.error('[SharedFilesAPI] error:', err instanceof Error ? err.message : err);
    return NextResponse.json({ success: false, error: 'Something went wrong' }, { status: 500 });
}

export async function GET(request: NextRequest) {
    try {
        const g = await guard(request);
        const p = request.nextUrl.searchParams;
        const result = await SharedFilesService.list(g.organizationId, p.get('parent_id'), {
            userId: g.userId, view: p.get('view') === 'bin' ? 'bin' : 'files', foldersOnly: p.get('folders') === '1',
        });
        return NextResponse.json({ success: true, ...result });
    } catch (err) {
        return fail(err);
    }
}

export async function POST(request: NextRequest) {
    try {
        const g = await guard(request);
        const body = (await request.json().catch(() => null)) ?? {};
        const ok = (data: object) => NextResponse.json({ success: true, ...data });
        switch (body.action) {
            case 'create_folder':
                return ok(await SharedFilesService.createFolder(g.userId, g.organizationId, g.team, { name: body.name, parentId: body.parentId }));
            case 'upload_url':
                return ok(await SharedFilesService.uploadUrl(g.userId, g.organizationId, g.team, { name: body.name, size: body.size, mimeType: body.mimeType, parentId: body.parentId }));
            case 'complete':
                return ok(await SharedFilesService.complete(g.organizationId, body.id));
            case 'download_url':
                return ok(await SharedFilesService.downloadUrl(g.organizationId, body.id, g.team, body.inline === true));
            case 'rename':
                return ok(await SharedFilesService.rename(g.organizationId, body.id, body.name));
            case 'move':
                if (!('targetId' in body)) return NextResponse.json({ success: false, error: 'Where to? targetId is required (null = top level).' }, { status: 400 });
                return ok(await SharedFilesService.move(g.organizationId, body.ids ?? body.id, body.targetId));
            case 'copy':
                return ok(await SharedFilesService.copy(g.userId, g.organizationId, g.team, body.id));
            case 'trash':
                return ok(await SharedFilesService.trash(g.userId, g.organizationId, body.ids ?? body.id));
            case 'restore':
                return ok(await SharedFilesService.restore(g.organizationId, body.ids ?? body.id));
            case 'delete':
                return ok(Array.isArray(body.ids)
                    ? await SharedFilesService.removeMany(g.organizationId, body.ids)
                    : await SharedFilesService.remove(g.organizationId, body.id));
            case 'set_note':
                return ok(await SharedFilesService.setNote(g.organizationId, body.id, body.note));
            case 'set_star':
                return ok(await SharedFilesService.setStar(g.userId, g.organizationId, body.id, body.starred === true));
            default:
                return NextResponse.json({ success: false, error: 'Unknown action' }, { status: 400 });
        }
    } catch (err) {
        return fail(err);
    }
}
