import { NextRequest, NextResponse } from 'next/server';
import { HierarchyService } from '@/task-manager/HierarchyService';
import { requireTaskManagerAdmin } from '../_shared/adminGuard';

export const dynamic = 'force-dynamic';

/**
 * GET /api/task-manager/hierarchy?orgId=<uuid>
 * READ-ONLY (Step 2). Returns the reporting chain computed from employee_profiles.reporting_manager_id,
 * compared with the old task_role label. Changes no data and no permission. Contains no phone numbers or emails.
 *
 * Requires a signed-in organisation admin (or master admin).
 */
export async function GET(request: NextRequest) {
    try {
        const orgId = request.nextUrl.searchParams.get('orgId') || '';
        const guard = await requireTaskManagerAdmin(orgId);
        if (!guard.ok) return guard.response;

        const report = await HierarchyService.getReport();
        return NextResponse.json({ success: true, report });
    } catch (err) {
        console.error('[HierarchyAPI] GET error:', err);
        return NextResponse.json({ success: false, error: err instanceof Error ? err.message : 'Failed to load hierarchy' }, { status: 500 });
    }
}
