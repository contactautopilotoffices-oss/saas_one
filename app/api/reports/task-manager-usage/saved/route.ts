import { NextRequest, NextResponse } from 'next/server';
import { readOrgId } from '@/backend/lib/commandCenter/access';
import { listSavedReports } from '@/backend/lib/reports/taskManagerUsage/store';
import { requireReportViewer } from '../_shared';

/**
 * GET /api/reports/task-manager-usage/saved?orgId=<uuid>
 *
 * Past reports for the Saved reports list, newest first. Org super admins only.
 */

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
    const access = await requireReportViewer(request, readOrgId(request));
    if (access instanceof NextResponse) return access;
    try {
        return NextResponse.json(await listSavedReports(access.organizationId));
    } catch (e) {
        console.error('[task-manager-usage] saved list failed:', e instanceof Error ? e.message : e);
        return NextResponse.json({ error: 'Could not read saved reports.' }, { status: 500 });
    }
}
