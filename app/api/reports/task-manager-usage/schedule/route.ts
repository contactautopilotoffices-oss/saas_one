import { NextRequest, NextResponse } from 'next/server';
import { readOrgId } from '@/backend/lib/commandCenter/access';
import { validateSchedule } from '@/backend/lib/reports/taskManagerUsage/schedule';
import { getScheduleState, saveSchedule } from '@/backend/lib/reports/taskManagerUsage/store';
import { requireReportViewer } from '../_shared';

/**
 * GET /api/reports/task-manager-usage/schedule?orgId=<uuid>
 * PUT /api/reports/task-manager-usage/schedule  { organization_id, schedule }
 *
 * The report schedule set in the Report tab. Org super admins only. `provisioned: false` means the migration has not been
 * run yet.
 */

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
    const access = await requireReportViewer(request, readOrgId(request));
    if (access instanceof NextResponse) return access;
    try {
        return NextResponse.json(await getScheduleState(access.organizationId));
    } catch (e) {
        console.error('[task-manager-usage] schedule read failed:', e instanceof Error ? e.message : e);
        return NextResponse.json({ error: 'Could not read the schedule.' }, { status: 500 });
    }
}

export async function PUT(request: NextRequest) {
    const body = await request.json().catch(() => ({}));
    const access = await requireReportViewer(request, readOrgId(request, body));
    if (access instanceof NextResponse) return access;

    const parsed = validateSchedule(body.schedule);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

    try {
        const current = await getScheduleState(access.organizationId);
        if (!current.provisioned) {
            return NextResponse.json({ error: 'Scheduling is not switched on yet: the database update has not been run.' }, { status: 409 });
        }
        return NextResponse.json(await saveSchedule(access.organizationId, parsed.schedule, access.user.id));
    } catch (e) {
        console.error('[task-manager-usage] schedule save failed:', e instanceof Error ? e.message : e);
        return NextResponse.json({ error: 'Could not save the schedule.' }, { status: 500 });
    }
}
