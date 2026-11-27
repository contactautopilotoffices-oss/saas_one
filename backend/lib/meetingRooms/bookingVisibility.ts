import { supabaseAdmin } from '@/backend/lib/supabase/admin';

// Only these roles see every booking at a property. Everyone else (tenants, security,
// staff, HR, CRM) sees only the bookings they made themselves.
export const VIEW_ALL_BOOKINGS_ROLES = ['property_admin', 'ops_super_admin', 'org_super_admin'];

/**
 * True when the user is master_admin (or holds one of orgRoles on users.role /
 * organization_memberships of propertyId's org, or one of propRoles on property_memberships).
 */
export async function hasPropertyOrOrgRole(
    userId: string,
    propertyId: string | null | undefined,
    propRoles: readonly string[],
    orgRoles: readonly string[],
): Promise<boolean> {
    const { data: profile } = await supabaseAdmin
        .from('users')
        .select('is_master_admin, role')
        .eq('id', userId)
        .maybeSingle();
    if (profile?.is_master_admin) return true;
    const globalRole = String(profile?.role || '').toLowerCase();
    if (globalRole && orgRoles.includes(globalRole)) return true;

    if (!propertyId) return false;

    const [propMemberRes, propertyRes] = await Promise.all([
        supabaseAdmin
            .from('property_memberships')
            .select('role')
            .eq('user_id', userId)
            .eq('property_id', propertyId)
            .or('is_active.is.null,is_active.eq.true'),
        supabaseAdmin
            .from('properties')
            .select('organization_id')
            .eq('id', propertyId)
            .maybeSingle(),
    ]);

    if ((propMemberRes.data || []).some(m => propRoles.includes(String(m.role || '').toLowerCase()))) {
        return true;
    }

    const orgId = propertyRes.data?.organization_id;
    if (!orgId) return false;

    const { data: orgMembers } = await supabaseAdmin
        .from('organization_memberships')
        .select('role')
        .eq('user_id', userId)
        .eq('organization_id', orgId)
        .or('is_active.is.null,is_active.eq.true');

    return (orgMembers || []).some(m => orgRoles.includes(String(m.role || '').toLowerCase()));
}

/**
 * True when the user holds any active global role for non-property-scoped resources
 * such as meeting room slot definitions.
 */
export async function hasAnyOrgOrPropRole(
    userId: string,
    propRoles: readonly string[],
    orgRoles: readonly string[],
): Promise<boolean> {
    const [profileRes, orgRes, propRes] = await Promise.all([
        supabaseAdmin.from('users').select('is_master_admin, role').eq('id', userId).maybeSingle(),
        supabaseAdmin.from('organization_memberships').select('role').eq('user_id', userId).or('is_active.is.null,is_active.eq.true'),
        supabaseAdmin.from('property_memberships').select('role').eq('user_id', userId).or('is_active.is.null,is_active.eq.true'),
    ]);
    if (profileRes.data?.is_master_admin) return true;
    const globalRole = String(profileRes.data?.role || '').toLowerCase();
    if (globalRole && orgRoles.includes(globalRole)) return true;
    if ((orgRes.data || []).some(m => orgRoles.includes(String(m.role || '').toLowerCase()))) return true;
    return (propRes.data || []).some(m => propRoles.includes(String(m.role || '').toLowerCase()));
}

/**
 * True when the user may see all bookings for the property: a master admin, or a holder of
 * one of VIEW_ALL_BOOKINGS_ROLES on the property or on the organization that owns it.
 * Without a propertyId only a master admin qualifies, so a bare list never leaks across orgs.
 */
export async function canViewAllBookings(userId: string, propertyId: string | null | undefined): Promise<boolean> {
    return hasPropertyOrOrgRole(userId, propertyId, VIEW_ALL_BOOKINGS_ROLES, VIEW_ALL_BOOKINGS_ROLES);
}
