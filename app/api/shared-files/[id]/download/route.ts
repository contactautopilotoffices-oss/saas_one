import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';
import { SharedFilesError, SharedFilesService, isFilesTeam } from '@/backend/lib/sharedFiles/SharedFilesService';

export const dynamic = 'force-dynamic';

/**
 * Streams one shared file to the signed-in person. `&inline=1` (owner 2026-11-13, preview) shows it in the browser
 * instead of saving it; the service only allows that for images, PDFs, video and audio, and sets the type itself.
 */
export async function GET(
    request: NextRequest,
    context: { params: Promise<{ id: string }> }
) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        const organizationId = request.nextUrl.searchParams.get('organization_id') || '';
        const team = request.nextUrl.searchParams.get('team');
        if (!isFilesTeam(team)) return NextResponse.json({ error: 'Unknown team' }, { status: 400 });

        await SharedFilesService.assertAccess(user.id, organizationId, team);
        const { id } = await context.params;
        const wantInline = request.nextUrl.searchParams.get('inline') === '1';

        const { buffer, name, contentType, inline } = await SharedFilesService.downloadFile(organizationId, id, wantInline);

        const headers: Record<string, string> = {
            'Content-Type': contentType,
            'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${name.replace(/[^\x20-\x7e]|["\\]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(name)}`,
            'Content-Length': buffer.byteLength.toString(),
            'Cache-Control': 'private, no-cache, no-store, must-revalidate',
            'X-Content-Type-Options': 'nosniff',
        };
        // An SVG opened in the browser is a document that could carry scripts; this stops them running against the app.
        // Only SVG gets it: a policy on a PDF can stop the browser's own PDF viewer from rendering.
        if (inline && contentType === 'image/svg+xml') headers['Content-Security-Policy'] = "default-src 'none'; style-src 'unsafe-inline'; img-src data:";
        return new NextResponse(new Uint8Array(buffer), { status: 200, headers });
    } catch (err) {
        if (err instanceof SharedFilesError) {
            return NextResponse.json({ error: err.message }, { status: err.status });
        }
        console.error('[SharedFiles Download Error]:', err);
        return NextResponse.json({ error: 'Could not download file' }, { status: 500 });
    }
}
