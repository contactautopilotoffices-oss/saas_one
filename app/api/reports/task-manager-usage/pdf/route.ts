import { NextRequest, NextResponse } from 'next/server';
import { readOrgId } from '@/backend/lib/commandCenter/access';
import { generateUsageReport } from '@/backend/lib/reports/taskManagerUsage/generate';
import { readRange, requireReportViewer } from '../_shared';

/**
 * POST /api/reports/task-manager-usage/pdf  { organization_id, from, to }
 *
 * Generates the PDF, keeps a copy under Saved reports when that is switched on, and returns the file.
 * `X-Report-Saved` says whether the copy was kept. Org super admins only.
 */

export const dynamic = 'force-dynamic';
// One Chromium render, well past the default function timeout.
export const maxDuration = 120;

export async function POST(request: NextRequest) {
    const body = await request.json().catch(() => ({}));
    const access = await requireReportViewer(request, readOrgId(request, body));
    if (access instanceof NextResponse) return access;

    const range = readRange(body.from, body.to);
    if (!range.ok) return NextResponse.json({ error: range.error }, { status: 400 });

    try {
        const { pdf, fileName, savedId } = await generateUsageReport({
            organizationId: access.organizationId,
            from: range.from,
            to: range.to,
            trigger: 'manual',
            userId: access.user.id,
        });
        return new NextResponse(new Uint8Array(pdf), {
            headers: {
                'Content-Type': 'application/pdf',
                'Content-Disposition': `attachment; filename="${fileName}"`,
                'Cache-Control': 'no-store',
                'X-Report-Saved': savedId ? 'true' : 'false',
            },
        });
    } catch (e) {
        console.error('[task-manager-usage] PDF failed:', e instanceof Error ? e.message : e);
        return NextResponse.json({ error: 'Could not generate the PDF. Please try again.' }, { status: 500 });
    }
}
