import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';

/**
 * Asset Management access resolution — service-role, enforced in the API layer
 * (same pattern as petty cash and CRM; RLS only covers browser reads).
 *
 * Who can do what:
 *   - See assets / lifecycle / reports:  any active member whose role is not
 *     tenant-like (tenant, super_tenant, vendor). MST and staff included.
 *   - Log work / notes against an asset: same set (the MST flow from a ticket).
 *   - Create, edit, import, print, categories, costs, AMC linking: org admins,
 *     property admins and managers ("canManage").
 *
 * Property scoping: org admins and master admins see the whole org; everyone
 * else sees only the properties they belong to.
 */

const TENANT_LIKE_ROLES = ['tenant', 'tenant_user', 'super_tenant', 'vendor'];
const ORG_ADMIN_ROLES = ['org_super_admin', 'org_admin', 'master_admin', 'ops_super_admin', 'owner'];
const MANAGER_ROLES = [
    ...ORG_ADMIN_ROLES,
    'property_admin', 'manager_executive', 'soft_service_manager', 'soft_service_supervisor', 'accounts',
];

export interface AssetAccess {
    user: { id: string; email?: string };
    isMasterAdmin: boolean;
    organizationId: string;
    /** whole-org visibility */
    isAdmin: boolean;
    /** may create / edit / import / configure */
    canManage: boolean;
    /** properties the user belongs to in this org (scope for non-admins) */
    propertyIds: string[];
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

export async function resolveAssetAccess(
    request: NextRequest,
    requestedOrgId?: string | null,
): Promise<AssetAccess | NextResponse> {
    const user = await authenticate(request);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return resolveAssetAccessForUser(user, requestedOrgId);
}

/**
 * Same rules as resolveAssetAccess, for an already-established identity (e.g.
 * the QR scan route, which authenticates via the cookie session itself).
 */
export async function resolveAssetAccessForUser(
    user: { id: string; email?: string },
    requestedOrgId?: string | null,
): Promise<AssetAccess | NextResponse> {
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
    const participant = memberships.filter((m) => m.role && !TENANT_LIKE_ROLES.includes(m.role));

    const orgIds = [...new Set(participant.map((m) => m.organization_id).filter(Boolean))] as string[];
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
        return NextResponse.json({ error: 'Forbidden: asset management is not available for this account' }, { status: 403 });
    }

    const roles = [...new Set(
        participant.filter((m) => m.organization_id === organizationId).map((m) => m.role as string),
    )];
    const propertyIds = [...new Set(
        propMemberships
            .filter((m) => m.organization_id === organizationId && m.property_id && m.role && !TENANT_LIKE_ROLES.includes(m.role))
            .map((m) => m.property_id as string),
    )];

    const isAdmin = isMasterAdmin || roles.some((r) => ORG_ADMIN_ROLES.includes(r));
    const canManage = isAdmin || roles.some((r) => MANAGER_ROLES.includes(r));

    return { user, isMasterAdmin, organizationId, isAdmin, canManage, propertyIds, roles };
}

export function isAssetAccessError(x: AssetAccess | NextResponse): x is NextResponse {
    return x instanceof NextResponse;
}

/** True if the caller may see / act on this property. */
export function canAccessProperty(access: AssetAccess, propertyId: string | null | undefined): boolean {
    if (!propertyId) return access.isAdmin;
    return access.isAdmin || access.propertyIds.includes(propertyId);
}

/** Properties to filter by for the caller: null means "no filter" (org-wide). */
export function scopedPropertyIds(access: AssetAccess, requested?: string | null): string[] | null {
    if (requested) return canAccessProperty(access, requested) ? [requested] : [];
    return access.isAdmin ? null : access.propertyIds;
}
