import { NextRequest, NextResponse } from 'next/server';
import { resolveProctorAccess, isProctorAccessError } from '@/backend/lib/proctor/access';
import { buildAttemptReport } from '@/backend/lib/proctor/report';

/**
 * GET /api/proctor/attempts/[id]/report — the reviewer's report for one attempt,
 * with the flagged camera frames embedded so a saved or printed copy keeps them.
 * Authors only: this carries the answer key and images of a person.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;

    const report = await buildAttemptReport(id);
    if (!report) return NextResponse.json({ error: 'Attempt not found' }, { status: 404 });

    const access = await resolveProctorAccess(report.test.organization_id);
    if (isProctorAccessError(access)) return access;
    if (!access.canAuthor) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    return NextResponse.json(report);
}
