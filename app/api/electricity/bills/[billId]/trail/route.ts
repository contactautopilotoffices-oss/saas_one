import { NextRequest, NextResponse } from 'next/server';
import { resolveElectricityAccess, readOrgId } from '@/backend/lib/electricity/access';
import { loadBillTrail } from '@/backend/lib/electricity/audit';

/**
 * GET /api/electricity/bills/<billId>/trail?org_id=…
 *
 * The immutable audit trail for one bill (SPEC-ELECTRICITY.md REQ-E-11): every workflow
 * and payment transition, who made it, and when. Answers "six months from now, can I prove
 * who checked and who approved?"
 *
 * Read-only by construction — electricity_bill_events revokes UPDATE/DELETE and raises on
 * any attempt, so there is deliberately no write verb on this route.
 */

export const dynamic = 'force-dynamic';

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ billId: string }> },
) {
    const { billId } = await params;
    const orgId = readOrgId(request);
    const access = await resolveElectricityAccess(request, orgId);
    if (access instanceof NextResponse) return access;

    try {
        // Scope the bill to the caller's org before reading its trail: a bill id from
        // another tenant must 404, not leak its history.
        const trail = await loadBillTrail(access.organizationId, billId);
        return NextResponse.json(trail);
    } catch (e) {
        const message = e instanceof Error ? e.message : 'Could not load the bill trail';
        console.error('[api/electricity/bills/trail]', message);
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
