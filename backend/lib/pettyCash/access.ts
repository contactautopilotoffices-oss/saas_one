import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';

/**
 * Petty Cash access resolution (service-role, enforced in the API layer — same
 * pattern as CRM; we do not rely on RLS here).
 *
 * Who can do what:
 *   - Create a request:  any active member whose role is not tenant-like.
 *   - Approve / send back: property_admin / managers / org admins for their property(ies).
 *   - Disburse + validate settlement + close: finance = the `accounts` role
 *     (plus org super admin / master admin).
 *   - Org admins & master admins: full-org visibility.
 *
 * Property scoping: approvers/finance see requests for the properties they belong
 * to; org admins/master see the whole org; everyone always sees their own requests.
 */

const TENANT_LIKE_ROLES = ['tenant', 'tenant_user', 'super_tenant', 'vendor'];
const ORG_ADMIN_ROLES = ['org_super_admin', 'org_admin', 'master_admin'];
const APPROVER_ROLES = [
    'org_super_admin', 'org_admin', 'master_admin',
    'property_admin', 'manager_executive', 'soft_service_manager', 'soft_service_supervisor',
];
const FINANCE_ROLES = ['accounts', 'org_super_admin', 'master_admin'];

export interface PettyCashAccess {
    user: { id: string; email?: string };
    isMasterAdmin: boolean;
    organizationId: string;
    /** full-org visibility (org admin / super admin / master) */
    isAdmin: boolean;
    /** may approve / reject / send back requests for their properties */
    canApprove: boolean;
    /** finance: may disburse, validate settlement, and close (the `accounts` role) */
    canDisburse: boolean;
    /** properties the user belongs to (for approver / finance scoping) */
    propertyIds: string[];
    /** roles the user holds in this org (deduped) */
    roles: string[];
}

type Membership = { organization_id: string | null; property_id?: string | null; role: string | null };

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

/** Read the desired org id from query (?org_id= / ?organization_id=) or JSON body. */
export function readOrgId(request: NextRequest, body?: any): string | null {
    const sp = new URL(request.url).searchParams;
    return (
        sp.get('org_id') || sp.get('organization_id') || sp.get('orgId') ||
        body?.organization_id || body?.org_id || null
    );
}

export async function resolvePettyCashAccess(
    request: NextRequest,
    requestedOrgId?: string | null,
): Promise<PettyCashAccess | NextResponse> {
    const user = await authenticate(request);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return resolvePettyCashAccessForUser(user, requestedOrgId);
}

/**
 * Same rules as resolvePettyCashAccess, for an already-established identity.
 *
 * Used by the one-click email actions, where the actor comes from a single-use
 * token rather than a session — the permission model must stay identical, so both
 * paths share this function.
 */
export async function resolvePettyCashAccessForUser(
    user: { id: string; email?: string },
    requestedOrgId?: string | null,
): Promise<PettyCashAccess | NextResponse> {
    const { data: profile } = await supabaseAdmin
        .from('users').select('is_master_admin').eq('id', user.id).maybeSingle();
    const isMasterAdmin = !!profile?.is_master_admin;

    const [propRes, orgRes] = await Promise.all([
        supabaseAdmin
            .from('property_memberships')
            .select('organization_id, property_id, role')
            .eq('user_id', user.id).eq('is_active', true),
        supabaseAdmin
            .from('organization_memberships')
            .select('organization_id, role')
            .eq('user_id', user.id).eq('is_active', true),
    ]);

    const propMemberships: Membership[] = propRes.data || [];
    const memberships: Membership[] = [...propMemberships, ...(orgRes.data || [])];
    // A user is a petty-cash participant if they hold any non-tenant role.
    const participantMemberships = memberships.filter(
        (m) => m.role && !TENANT_LIKE_ROLES.includes(m.role),
    );

    const orgIds = [...new Set(participantMemberships.map((m) => m.organization_id).filter(Boolean))] as string[];
    let organizationId: string | null = requestedOrgId || null;

    if (organizationId) {
        if (!(isMasterAdmin || orgIds.includes(organizationId)))
            return NextResponse.json({ error: 'Forbidden: no access to this organization' }, { status: 403 });
    } else if (orgIds.length === 1) {
        organizationId = orgIds[0];
    } else if (orgIds.length > 1) {
        return NextResponse.json({ error: 'organization_id is required (multiple organizations)' }, { status: 400 });
    } else if (isMasterAdmin) {
        return NextResponse.json({ error: 'organization_id is required' }, { status: 400 });
    } else {
        return NextResponse.json({ error: 'Forbidden: no petty cash access' }, { status: 403 });
    }

    const roles = [...new Set(
        participantMemberships.filter((m) => m.organization_id === organizationId).map((m) => m.role as string),
    )];
    // Properties the user belongs to within this org (for approver/finance scoping).
    const propertyIds = [...new Set(
        propMemberships
            .filter((m) => m.organization_id === organizationId && m.property_id)
            .map((m) => m.property_id as string),
    )];

    const isAdmin = isMasterAdmin || roles.some((r) => ORG_ADMIN_ROLES.includes(r));
    const canApprove = isAdmin || roles.some((r) => APPROVER_ROLES.includes(r));
    const canDisburse = isMasterAdmin || roles.some((r) => FINANCE_ROLES.includes(r));

    return { user, isMasterAdmin, organizationId, isAdmin, canApprove, canDisburse, propertyIds, roles };
}

export function isPettyCashAccessError(x: PettyCashAccess | NextResponse): x is NextResponse {
    return x instanceof NextResponse;
}
