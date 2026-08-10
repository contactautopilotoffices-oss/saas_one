import { NextRequest, NextResponse } from 'next/server';
import { resolveElectricityAccess, isElectricityAccessError, readOrgId } from '@/backend/lib/electricity/access';
import { loadMonthlyReportData, buildElectricityMonthlyReportPdf } from '@/backend/lib/electricity/monthlyReportPdf';

/**
 * GET /api/electricity/report?month=YYYY-MM
 *
 * On-demand download of the monthly electricity pack (Phase 5 of
 * docs/ELECTRICITY_AUTOMATION_PLAN.md) — the same artifact the cron emails to
 * ops_super_admins on the 5th, rendered for the month the tracker tab is looking at.
 */

export const dynamic = 'force-dynamic';
// Chromium launch + render is well past the default function timeout budget.
export const maxDuration = 120;

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export async function GET(request: NextRequest) {
    const access = await resolveElectricityAccess(request, readOrgId(request));
    if (isElectricityAccessError(access)) return access;

    const month = new URL(request.url).searchParams.get('month') || '';
    if (!MONTH_RE.test(month)) {
        return NextResponse.json({ error: 'month is required as YYYY-MM' }, { status: 400 });
    }

    const data = await loadMonthlyReportData(access.organizationId, month);
    if (!data.provisioned) {
        return NextResponse.json({ provisioned: false, error: 'Electricity module not provisioned' });
    }

    const pdf = await buildElectricityMonthlyReportPdf(data);
    return new NextResponse(new Uint8Array(pdf), {
        headers: {
            'content-type': 'application/pdf',
            'content-disposition': `attachment; filename="electricity-report-${month}.pdf"`,
            'cache-control': 'no-store',
        },
    });
}
