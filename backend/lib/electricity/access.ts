import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';

/**
 * Access guard for the electricity bill tracker (register, deadlines, discount
 * performance, reconciliation, AI explain).
 *
 * Deliberately WIDER than backend/lib/aop/access.ts. The AOP MIS excludes procurement on
 * purpose (it is site-level P&L: landlord rent, per-seat economics, every cost category),
 * but this module lives inside the Procurement workspace tab set and procurement is the
 * team that actually chases these bills day to day. Audience: org super admins, master
 * admins, accounts, and procurement.
 *
 * isMissingRelation is re-exported from the AOP guard rather than duplicated — same
 * PostgREST error codes, same meaning ("migration not applied yet"), one definition.
 */

export { isMissingRelation, readOrgId } from '@/backend/lib/aop/access';

const SUPER_ADMIN_ROLES = ['org_super_admin', 'master_admin'];
// ops_super_admin joins the tracker audience but deliberately NOT SUPER_ADMIN_ROLES:
// it is the checker (validation sign-off, dispute response review) and must not
// inherit the accepter authority of org_super_admin (checker below accepter, plan §3).
export const ELECTRICITY_ROLES = [...SUPER_ADMIN_ROLES, 'accounts', 'procurement', 'ops_super_admin'];

// Who may sign off validations (workflow_status -> 'verified') and review dispute
// responses. Enforced in route handlers, not just the UI.
export const CHECKER_ROLES = ['ops_super_admin', ...SUPER_ADMIN_ROLES];

export interface ElectricityAccess {
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

export async function resolveElectricityAccess(
    request: NextRequest,
    requestedOrgId?: string | null,
): Promise<ElectricityAccess | NextResponse> {
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
    const permitted = memberships.filter(m => m.role && ELECTRICITY_ROLES.includes(m.role));
    const orgIds = [...new Set(permitted.map(m => m.organization_id).filter(Boolean))] as string[];

    let organizationId = requestedOrgId || null;
    if (organizationId) {
        if (!(isMasterAdmin || orgIds.includes(organizationId))) {
            return NextResponse.json(
                { error: 'Forbidden: no electricity tracker access to this organization' }, { status: 403 });
        }
    } else if (orgIds.length === 1) {
        organizationId = orgIds[0];
    } else if (orgIds.length > 1) {
        return NextResponse.json(
            { error: 'organization_id is required (multiple organizations)' }, { status: 400 });
    } else {
        return NextResponse.json(
            { error: 'Forbidden: the electricity tracker is restricted to super admins, accounts and procurement' },
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

export function isChecker(access: ElectricityAccess): boolean {
    return access.isSuperAdmin || access.roles.some(r => CHECKER_ROLES.includes(r));
}

export function isElectricityAccessError(x: ElectricityAccess | NextResponse): x is NextResponse {
    return x instanceof NextResponse;
}
