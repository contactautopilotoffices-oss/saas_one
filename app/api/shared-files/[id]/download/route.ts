import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';
import { SharedFilesError, SharedFilesService, isFilesTeam } from '@/backend/lib/sharedFiles/SharedFilesService';

export const dynamic = 'force-dynamic';

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

        const { buffer, name, contentType } = await SharedFilesService.downloadFile(organizationId, id);

        return new NextResponse(new Uint8Array(buffer), {
            status: 200,
            headers: {
                'Content-Type': contentType,
                'Content-Disposition': `attachment; filename="${encodeURIComponent(name)}"`,
                'Content-Length': buffer.byteLength.toString(),
                'Cache-Control': 'private, no-cache, no-store, must-revalidate',
            },
        });
    } catch (err) {
        if (err instanceof SharedFilesError) {
            return NextResponse.json({ error: err.message }, { status: err.status });
        }
        console.error('[SharedFiles Download Error]:', err);
        return NextResponse.json({ error: 'Could not download file' }, { status: 500 });
    }
}
