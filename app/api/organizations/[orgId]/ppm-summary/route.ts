import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import {
    resolveCommandCenterAccess, isCommandCenterAccessError,
    isMissingRelation, ROW_CEILING,
} from '@/backend/lib/commandCenter/access';

/**
 * GET /api/organizations/[orgId]/ppm-summary
 *
 * Org-level preventive-maintenance compliance for the Command Center "PPM Compliance"
 * card. Reads ppm_schedules directly through the Command Center access guard (cookie
 * session or bearer token, then org/property admin membership — same pattern as
 * /api/command-center/portfolio, which is the guard this dashboard standardised on).
 *
 * deliberately NOT /api/ppm/audit: that route is unauthenticated and writes on GET.
 *
 * Definitions (kept simple so the card and the route cannot drift):
 *   completed  — done_date is set
 *   due today  — planned today, not done
 *   overdue    — planned before today, not done (all history, not just this month)
 *   next 7     — planned within the coming 7 days, not done
 */

export const dynamic = 'force-dynamic';

interface ScheduleRow {
    id: string;
    planned_date: string | null;
    done_date: string | null;
    system_name: string | null;
}

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ orgId: string }> }
) {
    const { orgId } = await params;
    const access = await resolveCommandCenterAccess(request, orgId);
    if (isCommandCenterAccessError(access)) return access;

    const { data, error } = await supabaseAdmin
        .from('ppm_schedules')
        .select('id, planned_date, done_date, system_name')
        .eq('organization_id', access.organizationId)
        .range(0, ROW_CEILING - 1);

    if (error) {
        if (isMissingRelation(error)) {
            return NextResponse.json({ provisioned: false, reason: 'No PPM schedules table.' });
        }
        console.error('[org ppm-summary]', error.message);
        return NextResponse.json({ error: 'Could not load PPM schedules' }, { status: 500 });
    }

    const rows = (data || []) as ScheduleRow[];
    if (!rows.length) {
        return NextResponse.json({ provisioned: false, reason: 'No PPM schedules for this organization.' });
    }

    const today = new Date().toISOString().slice(0, 10);
    const plus7 = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);

    let completed = 0, dueToday = 0, overdue = 0, next7 = 0;
    let lastDone: string | null = null;
    const overdueBySystem = new Map<string, number>();

    for (const r of rows) {
        const done = !!r.done_date;
        if (done) {
            completed += 1;
            if (!lastDone || (r.done_date as string) > lastDone) lastDone = r.done_date;
            continue;
        }
        if (!r.planned_date) continue;
        if (r.planned_date === today) dueToday += 1;
        else if (r.planned_date < today) {
            overdue += 1;
            const sys = r.system_name || 'Other';
            overdueBySystem.set(sys, (overdueBySystem.get(sys) || 0) + 1);
        } else if (r.planned_date <= plus7) next7 += 1;
    }

    const topSystem = [...overdueBySystem.entries()].sort((a, b) => b[1] - a[1])[0] || null;
    const lastServicedDays = lastDone
        ? Math.max(0, Math.round((Date.now() - new Date(lastDone + 'T00:00:00Z').getTime()) / 86_400_000))
        : null;

    return NextResponse.json({
        provisioned: true,
        as_of: today,
        total: rows.length,
        completed,
        completed_pct: Math.round((completed / rows.length) * 1000) / 10,
        due_today: dueToday,
        overdue,
        next_7_days: next7,
        /** Fixed portfolio target — a policy number, not a measurement. */
        target_pct: 95,
        most_overdue_system: topSystem ? { name: topSystem[0], count: topSystem[1] } : null,
        last_serviced_days_ago: lastServicedDays,
    });
}
