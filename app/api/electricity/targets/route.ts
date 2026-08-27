import { NextRequest, NextResponse } from 'next/server';
import { resolveElectricityAccess, readOrgId } from '@/backend/lib/electricity/access';
import { loadTargets, upsertTarget, currentFinancialYear } from '@/backend/lib/electricity/targets';

/**
 * Savings target the electricity council member runs with.
 *
 *   GET  /api/electricity/targets?org_id=…   — targets + live progress
 *   POST /api/electricity/targets            — set/replace the target for a period
 *
 * WHO MAY SET A TARGET: super admins only. A target is a commitment made of someone, so
 * procurement and accounts (who are measured by it) can read it but cannot move the number
 * on themselves. Enforced here, server-side, not by hiding the button.
 */

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
    const orgId = readOrgId(request);
    const access = await resolveElectricityAccess(request, orgId);
    if (access instanceof NextResponse) return access;

    try {
        const payload = await loadTargets(access.organizationId);
        return NextResponse.json({ ...payload, suggested_period: currentFinancialYear() });
    } catch (e) {
        const message = e instanceof Error ? e.message : 'Could not load savings targets';
        console.error('[api/electricity/targets GET]', message);
        return NextResponse.json({ error: message }, { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    const body = await request.json().catch(() => ({} as Record<string, unknown>));
    const access = await resolveElectricityAccess(request, (body.org_id as string) || readOrgId(request));
    if (access instanceof NextResponse) return access;

    if (!access.isSuperAdmin) {
        return NextResponse.json(
            { error: 'Forbidden: only org super admins set the electricity savings target' },
            { status: 403 },
        );
    }

    const amount = Number(body.target_amount);
    if (!Number.isFinite(amount) || amount <= 0) {
        return NextResponse.json({ error: 'target_amount must be a positive number' }, { status: 400 });
    }

    const fy = currentFinancialYear();
    const periodStart = (body.period_start as string) || fy.start;
    const periodEnd = (body.period_end as string) || fy.end;
    if (periodEnd <= periodStart) {
        return NextResponse.json({ error: 'period_end must be after period_start' }, { status: 400 });
    }

    try {
        const target = await upsertTarget({
            organizationId: access.organizationId,
            periodStart,
            periodEnd,
            label: (body.label as string) || fy.label,
            targetAmount: amount,
            ownerUserId: (body.owner_user_id as string) || null,
            ownerLabel: (body.owner_label as string) || 'Electricity Council Member',
            notes: (body.notes as string) || null,
            actorId: access.user.id,
        });
        return NextResponse.json({ target });
    } catch (e) {
        const message = e instanceof Error ? e.message : 'Could not save the savings target';
        console.error('[api/electricity/targets POST]', message);
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
