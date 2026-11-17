import { NextRequest, NextResponse } from 'next/server';
import { readOrgId } from '@/backend/lib/commandCenter/access';
import { signedReportUrl } from '@/backend/lib/reports/taskManagerUsage/store';
import { requireReportViewer } from '../../_shared';

/**
 * GET /api/reports/task-manager-usage/saved/<id>?orgId=<uuid>
 *
 * A 10-minute download link for a saved report in the caller's organisation. Org super admins only.
 */

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const access = await requireReportViewer(request, readOrgId(request));
    if (access instanceof NextResponse) return access;

    const { id } = await params;
    if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'Report not found.' }, { status: 404 });

    try {
        const link = await signedReportUrl(access.organizationId, id);
        if (!link) return NextResponse.json({ error: 'Report not found.' }, { status: 404 });
        return NextResponse.json(link);
    } catch (e) {
        console.error('[task-manager-usage] download link failed:', e instanceof Error ? e.message : e);
        return NextResponse.json({ error: 'Could not create the download link.' }, { status: 500 });
    }
}
