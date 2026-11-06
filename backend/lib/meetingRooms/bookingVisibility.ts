import { supabaseAdmin } from '@/backend/lib/supabase/admin';

// Only these roles see every booking at a property. Everyone else (tenants, security,
// staff, HR, CRM) sees only the bookings they made themselves.
export const VIEW_ALL_BOOKINGS_ROLES = ['property_admin', 'ops_super_admin', 'org_super_admin'];

/**
 * True when the user may see all bookings for the property: a master admin, or a holder of
 * one of VIEW_ALL_BOOKINGS_ROLES on the property or on the organization that owns it.
 * Without a propertyId only a master admin qualifies, so a bare list never leaks across orgs.
 */
export async function canViewAllBookings(userId: string, propertyId: string | null | undefined): Promise<boolean> {
    const { data: profile } = await supabaseAdmin
        .from('users')
        .select('is_master_admin')
        .eq('id', userId)
        .maybeSingle();
    if (profile?.is_master_admin) return true;

    if (!propertyId) return false;

    const [propMemberRes, propertyRes] = await Promise.all([
        supabaseAdmin
            .from('property_memberships')
            .select('role')
            .eq('user_id', userId)
            .eq('property_id', propertyId)
            .eq('is_active', true),
        supabaseAdmin
            .from('properties')
            .select('organization_id')
            .eq('id', propertyId)
            .maybeSingle(),
    ]);

    if ((propMemberRes.data || []).some(m => VIEW_ALL_BOOKINGS_ROLES.includes(String(m.role).toLowerCase()))) {
        return true;
    }

    const orgId = propertyRes.data?.organization_id;
    if (!orgId) return false;

    const { data: orgMembers } = await supabaseAdmin
        .from('organization_memberships')
        .select('role')
        .eq('user_id', userId)
        .eq('organization_id', orgId)
        .eq('is_active', true);

    return (orgMembers || []).some(m => VIEW_ALL_BOOKINGS_ROLES.includes(String(m.role).toLowerCase()));
}
