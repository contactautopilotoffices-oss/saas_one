import { NextRequest, NextResponse } from 'next/server';
import { resolveProctorAccess, isProctorAccessError } from '@/backend/lib/proctor/access';
import { openAttempt, loadTestById } from '@/backend/lib/proctor/start';

/**
 * POST /api/proctor/tests/[id]/start — begin an attempt as a signed-in member
 * of the organisation. The public link uses /api/public/proctor/[token]/start;
 * both share openAttempt, so the rules on chances are the same.
 */
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;

    const test = await loadTestById(id);
    if (!test || !test.is_active) return NextResponse.json({ error: 'This test is not open' }, { status: 404 });

    const access = await resolveProctorAccess(test.organization_id);
    if (isProctorAccessError(access)) return access;

    const outcome = await openAttempt(test, { kind: 'user', userId: access.userId });
    if ('error' in outcome) return NextResponse.json({ error: outcome.error }, { status: outcome.status });
    return NextResponse.json(outcome);
}
