import { NextRequest, NextResponse } from 'next/server';
import { resolveCrmAccess, isCrmAccessError, readOrgId } from '@/backend/lib/crm/access';
import { loadOrgCoachingOverview } from '@/backend/lib/coaching/longitudinal';

/**
 * GET /api/crm/coaching/overview
 * Admin-only: per-rep leaderboard + trend.
 *
 * Query params:
 *   - window=20    how many recent calls to consider per rep (default 20)
 *   - rep_id=...   restrict to a single rep
 */
export async function GET(request: NextRequest) {
    const orgIdHint = readOrgId(request);
    const access = await resolveCrmAccess(request, orgIdHint);
    if (isCrmAccessError(access)) return access;

    if (!access.isAdmin && !access.isMasterAdmin) {
        return NextResponse.json(
            { error: 'Only admins can view the coaching overview' },
            { status: 403 }
        );
    }

    const url = new URL(request.url);
    const windowSize = Math.min(
        Math.max(parseInt(url.searchParams.get('window') || '20', 10) || 20, 1),
        100
    );
    const repIdFilter = url.searchParams.get('rep_id');

    const result = await loadOrgCoachingOverview(access.organizationId, windowSize);

    const reps = repIdFilter ? result.reps.filter((r) => r.bdRepId === repIdFilter) : result.reps;

    return NextResponse.json({
        orgId: access.organizationId,
        windowSize,
        totals: result.totals,
        reps,
    });
}
