import { NextRequest, NextResponse } from 'next/server';
import { resolveElectricityAccess, readOrgId } from '@/backend/lib/electricity/access';
import { loadCycle } from '@/backend/lib/electricity/cycle';
import { loadTargets } from '@/backend/lib/electricity/targets';

/**
 * GET /api/electricity/cycle?org_id=…
 *
 * The race against the clock, plus the savings target it is being run against — one
 * payload because the two are read together on one screen and must agree. Serves the
 * "Cycle" view of the Electricity Tracker.
 *
 * Audience: the tracker audience (procurement, accounts, ops/org/master super admins).
 * Read-only; no side effects.
 */

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
    const orgId = readOrgId(request);
    const access = await resolveElectricityAccess(request, orgId);
    if (access instanceof NextResponse) return access;

    try {
        // Independent reads — the cycle view still renders when no target is set, and the
        // target card still renders on an org whose cycle migration is pending.
        const [cycle, targets] = await Promise.all([
            loadCycle(access.organizationId),
            loadTargets(access.organizationId),
        ]);

        return NextResponse.json({
            provisioned: cycle.provisioned,
            reason: cycle.reason,
            rows: cycle.rows,
            summary: cycle.summary,
            stalled: cycle.stalled,
            stage_dwell: cycle.stage_dwell,
            target: targets.progress,
            target_provisioned: targets.provisioned,
        });
    } catch (e) {
        const message = e instanceof Error ? e.message : 'Could not load the electricity cycle';
        console.error('[api/electricity/cycle]', message);
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
