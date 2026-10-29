import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';
import { SharedFilesError, SharedFilesService, isFilesTeam } from '@/backend/lib/sharedFiles/SharedFilesService';

export const dynamic = 'force-dynamic';

/**
 * Owner 2026-10-29: the "Files" tab of the Design and Tech consoles — one shared drive per organisation.
 * `?organization_id=...&team=design|tech`: the signed-in person must hold that role in that organisation.
 *   GET  &parent_id=...                          what is in a folder (none = top level) + the path to it
 *   POST { action, ... }
 *     create_folder { name, parentId }           new folder
 *     upload_url    { name, size, mimeType, parentId }   one-time signed upload link (≤ 200 MB) → { id, signedUrl }
 *     complete      { id }                       the browser finished uploading → the file is shown
 *     download_url  { id }                       60-second download link → { url }
 *     delete        { id }                       a file, or a folder and everything in it
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
        const result = await SharedFilesService.list(g.organizationId, request.nextUrl.searchParams.get('parent_id'));
        return NextResponse.json({ success: true, ...result });
    } catch (err) {
        return fail(err);
    }
}

export async function POST(request: NextRequest) {
    try {
        const g = await guard(request);
        const body = (await request.json().catch(() => null)) ?? {};
        switch (body.action) {
            case 'create_folder':
                return NextResponse.json({ success: true, ...(await SharedFilesService.createFolder(g.userId, g.organizationId, g.team, { name: body.name, parentId: body.parentId })) });
            case 'upload_url':
                return NextResponse.json({ success: true, ...(await SharedFilesService.uploadUrl(g.userId, g.organizationId, g.team, { name: body.name, size: body.size, mimeType: body.mimeType, parentId: body.parentId })) });
            case 'complete':
                return NextResponse.json({ success: true, ...(await SharedFilesService.complete(g.organizationId, body.id)) });
            case 'download_url':
                return NextResponse.json({ success: true, ...(await SharedFilesService.downloadUrl(g.organizationId, body.id)) });
            case 'delete':
                return NextResponse.json({ success: true, ...(await SharedFilesService.remove(g.organizationId, body.id)) });
            default:
                return NextResponse.json({ success: false, error: 'Unknown action' }, { status: 400 });
        }
    } catch (err) {
        return fail(err);
    }
}
