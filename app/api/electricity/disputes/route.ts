import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { resolveElectricityAccess, isElectricityAccessError } from '@/backend/lib/electricity/access';
import { isMissingRelation } from '@/backend/lib/aop/access';
import { openDispute, resolveDispute } from '@/backend/lib/electricity/disputes';

/**
 * GET /api/electricity/disputes
 *
 * Two audiences, one route (per the Phase 3 plan):
 *   - ELECTRICITY_ROLES (super admins, ops_super_admin, accounts, procurement) see every
 *     dispute in their org.
 *   - A property admin — deliberately NOT in ELECTRICITY_ROLES — sees only disputes
 *     assigned to them, so their response form can load its thread without exposing the
 *     rest of the spend data. Scoped branch, resolved after the main guard rejects.
 *
 * POST opens a dispute against a bill. Checker-only: ops_super_admin or a super admin —
 * the checker/accepter split is enforced here, not just in the UI.
 */

export const dynamic = 'force-dynamic';

const DISPUTE_SELECT = '*, electricity_dispute_responses(*)';

async function authenticate(request: NextRequest): Promise<{ id: string } | null> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (user) return { id: user.id };

    const authHeader = request.headers.get('authorization') || '';
    const token = authHeader.toLowerCase().startsWith('bearer ') ? authHeader.slice(7) : null;
    if (token) {
        const { data: { user: tokenUser } } = await supabaseAdmin.auth.getUser(token);
        if (tokenUser) return { id: tokenUser.id };
    }
    return null;
}

export async function GET(request: NextRequest) {
    const orgId = request.nextUrl.searchParams.get('organization_id');
    const access = await resolveElectricityAccess(request, orgId);

    if (!isElectricityAccessError(access)) {
        const { data, error } = await supabaseAdmin
            .from('electricity_disputes')
            .select(DISPUTE_SELECT)
            .eq('organization_id', access.organizationId)
            .order('raised_at', { ascending: false })
            .range(0, 4999);

        if (error) {
            if (isMissingRelation(error)) return NextResponse.json({ provisioned: false, disputes: [] });
            console.error('[electricity disputes]', error.message);
            return NextResponse.json({ error: 'Could not load disputes' }, { status: 500 });
        }
        return NextResponse.json({ provisioned: true, scope: 'org', disputes: data || [] });
    }

    // Scoped branch: property admins answering their own assigned disputes. They are not
    // in ELECTRICITY_ROLES, so the guard above always rejects them — check the
    // property_admin membership directly instead of widening the guard.
    const user = await authenticate(request);
    if (!user) return access;

    const { data: paMemberships } = await supabaseAdmin
        .from('property_memberships')
        .select('role')
        .eq('user_id', user.id)
        .eq('role', 'property_admin')
        .eq('is_active', true)
        .limit(1);
    if (!paMemberships || paMemberships.length === 0) return access;

    const { data, error } = await supabaseAdmin
        .from('electricity_disputes')
        .select(DISPUTE_SELECT)
        .eq('assigned_property_admin', user.id)
        .order('raised_at', { ascending: false })
        .range(0, 4999);

    if (error) {
        if (isMissingRelation(error)) return NextResponse.json({ provisioned: false, disputes: [] });
        console.error('[electricity disputes scoped]', error.message);
        return NextResponse.json({ error: 'Could not load disputes' }, { status: 500 });
    }
    return NextResponse.json({ provisioned: true, scope: 'assigned', disputes: data || [] });
}

export async function POST(request: NextRequest) {
    const access = await resolveElectricityAccess(request, null);
    if (isElectricityAccessError(access)) return access;

    // Checker roles only: ops_super_admin, or a super admin acting as checker.
    const isChecker = access.isSuperAdmin || access.roles.includes('ops_super_admin');
    if (!isChecker) {
        return NextResponse.json(
            { error: 'Forbidden: only checkers (ops_super_admin or super admins) can open disputes' },
            { status: 403 });
    }

    let body: { bill_id?: string; validation_id?: string | null; reason?: string };
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const reason = (body.reason || '').trim();
    if (!body.bill_id || !reason) {
        return NextResponse.json({ error: 'bill_id and reason are required' }, { status: 400 });
    }

    const result = await openDispute({
        organizationId: access.organizationId,
        billId: body.bill_id,
        validationId: body.validation_id ?? null,
        raisedBy: access.user.id,
        reason,
    });

    if (!result.ok) {
        if (result.provisioned === false) return NextResponse.json({ provisioned: false });
        console.error('[electricity disputes open]', result.error);
        return NextResponse.json({ error: 'Could not open dispute' }, { status: 500 });
    }
    return NextResponse.json({ dispute: result.data }, { status: 201 });
}

/**
 * PATCH — checker resolves a dispute: 'accepted' returns the bill to workflow_status
 * 'validated', 'rejected' leaves it disputed. Body: { id, resolution, note? }.
 */
export async function PATCH(request: NextRequest) {
    const access = await resolveElectricityAccess(request, null);
    if (isElectricityAccessError(access)) return access;

    const isChecker = access.isSuperAdmin || access.roles.includes('ops_super_admin');
    if (!isChecker) {
        return NextResponse.json(
            { error: 'Forbidden: only checkers (ops_super_admin or super admins) can resolve disputes' },
            { status: 403 });
    }

    let body: { id?: string; resolution?: string; note?: string | null };
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    if (!body.id || (body.resolution !== 'accepted' && body.resolution !== 'rejected')) {
        return NextResponse.json({ error: 'id and resolution (accepted|rejected) are required' }, { status: 400 });
    }

    const result = await resolveDispute({
        disputeId: body.id,
        organizationId: access.organizationId,
        resolvedBy: access.user.id,
        resolution: body.resolution,
        note: body.note ?? null,
    });

    if (!result.ok) {
        if (result.provisioned === false) return NextResponse.json({ provisioned: false });
        if (result.error.includes('not found')) return NextResponse.json({ error: result.error }, { status: 404 });
        console.error('[electricity disputes resolve]', result.error);
        return NextResponse.json({ error: 'Could not resolve dispute' }, { status: 500 });
    }
    return NextResponse.json({ dispute: result.data });
}
