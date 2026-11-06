import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';

/**
 * Who is calling, and which organisations and properties they belong to.
 *
 * For API routes that read with the service role (which bypasses RLS) and therefore must
 * check the caller themselves. Same pattern as backend/lib/crm/access.ts and
 * backend/lib/aop/access.ts: the browser session cookie first, then a mobile-app Bearer token.
 * Roles always come from the database, never from the request.
 */

/** Roles for people outside the company: clients, tenants and vendors. */
export const EXTERNAL_ROLES = [
    'tenant', 'tenant_user', 'tenant_admin', 'super_tenant', 'client', 'resident',
    'vendor', 'maintenance_vendor',
];
/** Organisation admins: the roles that get the org admin dashboard (UnifiedDashboard). */
export const ORG_ADMIN_ROLES = ['org_super_admin', 'org_admin', 'super_admin', 'master_admin'];

export type CallerAccess = {
    userId: string;
    email: string | null;
    isMasterAdmin: boolean;
    /** Active organisation-level memberships. */
    orgMemberships: { organization_id: string; role: string }[];
    /** Active property-level memberships (organization_id may be null on older rows). */
    propertyMemberships: { property_id: string; organization_id: string | null; role: string }[];
};

async function authenticate(request: Request): Promise<{ id: string; email: string | null } | null> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (user) return { id: user.id, email: user.email ?? null };

    const header = request.headers.get('authorization') || '';
    const token = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
    if (token) {
        const { data: { user: tokenUser } } = await supabaseAdmin.auth.getUser(token);
        if (tokenUser) return { id: tokenUser.id, email: tokenUser.email ?? null };
    }
    return null;
}

/** The signed-in caller with their memberships, or a 401 response. */
export async function resolveCaller(request: Request | NextRequest): Promise<CallerAccess | NextResponse> {
    const user = await authenticate(request);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const [profileRes, orgRes, propRes] = await Promise.all([
        supabaseAdmin.from('users').select('is_master_admin').eq('id', user.id).maybeSingle(),
        supabaseAdmin.from('organization_memberships').select('organization_id, role, is_active').eq('user_id', user.id),
        supabaseAdmin.from('property_memberships').select('property_id, organization_id, role, is_active').eq('user_id', user.id),
    ]);
    if (orgRes.error || propRes.error) {
        console.error('[callerAccess] membership lookup failed:', orgRes.error?.message || propRes.error?.message);
        return NextResponse.json({ error: 'Could not check your access' }, { status: 500 });
    }

    return {
        userId: user.id,
        email: user.email,
        isMasterAdmin: !!profileRes.data?.is_master_admin,
        orgMemberships: (orgRes.data || [])
            .filter(m => m.is_active !== false && m.organization_id)
            .map(m => ({ organization_id: m.organization_id as string, role: String(m.role || '').toLowerCase().trim() })),
        propertyMemberships: (propRes.data || [])
            .filter(m => m.is_active !== false && m.property_id)
            .map(m => ({
                property_id: m.property_id as string,
                organization_id: (m.organization_id as string | null) ?? null,
                role: String(m.role || '').toLowerCase().trim(),
            })),
    };
}

export function isCallerError(x: CallerAccess | NextResponse): x is NextResponse {
    return x instanceof NextResponse;
}

export function forbidden(message = 'Forbidden') {
    return NextResponse.json({ error: message }, { status: 403 });
}

const isInternal = (role: string) => !EXTERNAL_ROLES.includes(role);

/** Roles the caller holds in this organisation at organisation level. */
export function orgRolesIn(c: CallerAccess, orgId: string): string[] {
    return c.orgMemberships.filter(m => m.organization_id === orgId).map(m => m.role);
}

/** Organisations where the caller is an internal (not client/tenant/vendor) organisation-level member. */
export function internalOrgIds(c: CallerAccess): string[] {
    return [...new Set(c.orgMemberships.filter(m => isInternal(m.role)).map(m => m.organization_id))];
}

/** Properties where the caller is an internal property-level member. */
export function internalPropertyIds(c: CallerAccess): string[] {
    return [...new Set(c.propertyMemberships.filter(m => isInternal(m.role)).map(m => m.property_id))];
}

/** Every property the caller holds a membership in, any role. */
export function allPropertyIds(c: CallerAccess): string[] {
    return [...new Set(c.propertyMemberships.map(m => m.property_id))];
}

export function isOrgAdmin(c: CallerAccess, orgId: string): boolean {
    return c.isMasterAdmin || orgRolesIn(c, orgId).some(r => ORG_ADMIN_ROLES.includes(r));
}

/**
 * Does the caller belong to this organisation at all (any role, either level)? Older property
 * memberships may lack organization_id, so those are checked through the property.
 */
export async function belongsToOrg(c: CallerAccess, orgId: string): Promise<boolean> {
    if (c.isMasterAdmin) return true;
    if (c.orgMemberships.some(m => m.organization_id === orgId)) return true;
    if (c.propertyMemberships.some(m => m.organization_id === orgId)) return true;
    const legacyIds = c.propertyMemberships.filter(m => !m.organization_id).map(m => m.property_id);
    if (!legacyIds.length) return false;
    const { data } = await supabaseAdmin.from('properties').select('id').in('id', legacyIds).eq('organization_id', orgId).limit(1);
    return !!data?.length;
}

/** The organisation a property belongs to, or null when the property does not exist. */
export async function propertyOrgId(propertyId: string): Promise<string | null> {
    const { data } = await supabaseAdmin.from('properties').select('organization_id').eq('id', propertyId).maybeSingle();
    return (data?.organization_id as string | undefined) ?? null;
}

/**
 * May this caller work with this property's internal data? Master admin, an internal member of
 * the property's organisation, or an internal member of the property itself.
 */
export function canUseProperty(c: CallerAccess, propertyId: string, orgId: string | null): boolean {
    if (c.isMasterAdmin) return true;
    if (orgId && internalOrgIds(c).includes(orgId)) return true;
    return internalPropertyIds(c).includes(propertyId);
}
