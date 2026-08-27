import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';

/**
 * Access guard for the AOP MIS and the electricity bill tracker.
 *
 * Audience: org super admins, master admins, and accounts. This is site-level P&L —
 * per-seat economics, landlord rent, every cost category — so it is deliberately narrower
 * than general FMS data and matches the RLS policy in 20260802000001_aop_tracker.sql
 * (has_aop_access). Keep the two in step: the policy and this guard are one rule expressed
 * twice, and the API reads through the service role, so this file is what actually holds
 * the line for these routes.
 *
 * Procurement is excluded on purpose. Revisit only with an explicit decision.
 */

const SUPER_ADMIN_ROLES = ['org_super_admin', 'master_admin'];
const AOP_ROLES = [...SUPER_ADMIN_ROLES, 'accounts'];

export interface AopAccess {
    user: { id: string; email?: string };
    organizationId: string;
    isSuperAdmin: boolean;
    roles: string[];
}

type Membership = { organization_id: string | null; role: string | null };

async function authenticate(request: NextRequest): Promise<{ id: string; email?: string } | null> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (user) return { id: user.id, email: user.email ?? undefined };

    const authHeader = request.headers.get('authorization') || '';
    const token = authHeader.toLowerCase().startsWith('bearer ') ? authHeader.slice(7) : null;
    if (token) {
        const { data: { user: tokenUser } } = await supabaseAdmin.auth.getUser(token);
        if (tokenUser) return { id: tokenUser.id, email: tokenUser.email ?? undefined };
    }
    return null;
}

export function readOrgId(request: NextRequest, body?: any): string | null {
    const sp = new URL(request.url).searchParams;
    return (
        sp.get('org_id') || sp.get('organization_id') || sp.get('orgId') ||
        body?.organization_id || body?.org_id || null
    );
}

export async function resolveAopAccess(
    request: NextRequest,
    requestedOrgId?: string | null,
): Promise<AopAccess | NextResponse> {
    const user = await authenticate(request);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data: profile } = await supabaseAdmin
        .from('users').select('is_master_admin').eq('id', user.id).maybeSingle();
    const isMasterAdmin = !!profile?.is_master_admin;

    const [propRes, orgRes] = await Promise.all([
        supabaseAdmin.from('property_memberships')
            .select('organization_id, role').eq('user_id', user.id).eq('is_active', true),
        supabaseAdmin.from('organization_memberships')
            .select('organization_id, role').eq('user_id', user.id).eq('is_active', true),
    ]);

    const memberships: Membership[] = [...(propRes.data || []), ...(orgRes.data || [])];
    const permitted = memberships.filter(m => m.role && AOP_ROLES.includes(m.role));
    const orgIds = [...new Set(permitted.map(m => m.organization_id).filter(Boolean))] as string[];

    let organizationId = requestedOrgId || null;
    if (organizationId) {
        if (!(isMasterAdmin || orgIds.includes(organizationId))) {
            return NextResponse.json(
                { error: 'Forbidden: no MIS access to this organization' }, { status: 403 });
        }
    } else if (orgIds.length === 1) {
        organizationId = orgIds[0];
    } else if (orgIds.length > 1) {
        return NextResponse.json(
            { error: 'organization_id is required (multiple organizations)' }, { status: 400 });
    } else {
        return NextResponse.json(
            { error: 'Forbidden: the spend tracker is restricted to super admins and accounts' },
            { status: 403 });
    }

    const roles = [...new Set(
        memberships.filter(m => m.organization_id === organizationId && m.role).map(m => m.role as string),
    )];

    return {
        user,
        organizationId,
        isSuperAdmin: isMasterAdmin || roles.some(r => SUPER_ADMIN_ROLES.includes(r)),
        roles,
    };
}

export function isAopAccessError(x: AopAccess | NextResponse): x is NextResponse {
    return x instanceof NextResponse;
}

/** Table/view missing = migration not applied yet. Report as unprovisioned, not a 500. */
export function isMissingRelation(error: { code?: string } | null): boolean {
    return error?.code === '42P01' || error?.code === 'PGRST205';
}
