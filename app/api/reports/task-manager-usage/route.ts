import { NextRequest, NextResponse } from 'next/server';
import { readOrgId } from '@/backend/lib/commandCenter/access';
import { buildUsageReport } from '@/backend/lib/reports/taskManagerUsage/load';
import { readRange, requireReportViewer } from './_shared';

/**
 * GET /api/reports/task-manager-usage?orgId=<uuid>&from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * The numbers behind the Task Manager Usage Report, for the preview in the Report tab. Org super admins only.
 */

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
    const access = await requireReportViewer(request, readOrgId(request));
    if (access instanceof NextResponse) return access;

    const sp = request.nextUrl.searchParams;
    const range = readRange(sp.get('from'), sp.get('to'));
    if (!range.ok) return NextResponse.json({ error: range.error }, { status: 400 });

    try {
        const report = await buildUsageReport(access.organizationId, range.from, range.to, new Date().toISOString());
        return NextResponse.json({ report });
    } catch (e) {
        console.error('[task-manager-usage] preview failed:', e instanceof Error ? e.message : e);
        return NextResponse.json({ error: 'Could not work out the report. Please try again.' }, { status: 500 });
    }
}
