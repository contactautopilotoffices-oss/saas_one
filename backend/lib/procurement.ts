import { createAdminClient } from '@/frontend/utils/supabase/admin';

/**
 * Checks if a user has permission to see procurement prices and budgets.
 * Permission is granted if:
 * 1. User has a hardcoded admin role (procurement, org_super_admin, master_admin)
 * 2. User ID is explicitly listed in the organization's price_visibility_users
 * 3. User's role is listed in the organization's price_visibility_roles
 */
/**
 * Checks if a user has permission to see procurement prices and budgets.
 * Permission is granted if:
 * 1. User has a hardcoded admin role at organization level
 * 2. User ID is explicitly listed in ANY of the organization's procurement settings
 * 3. User's organization role is listed in ANY of the organization's procurement settings
 * 4. User's property-specific role is listed in that property's settings
 */
export async function canUserSeePrices(userId: string, organizationId: string, propertyId?: string): Promise<boolean> {
    if (!userId || !organizationId) return false;

    const adminSupabase = createAdminClient();

    // 1. Get user's roles
    const [orgMembershipRes, propMembershipsRes] = await Promise.all([
        adminSupabase
            .from('organization_memberships')
            .select('role')
            .eq('user_id', userId)
            .eq('organization_id', organizationId)
            .eq('is_active', true)
            .maybeSingle(),
        adminSupabase
            .from('property_memberships')
            .select('role, property_id')
            .eq('user_id', userId)
            .eq('is_active', true)
    ]);

    const orgRole = orgMembershipRes.data?.role || '';
    const propMemberships = propMembershipsRes.data || [];
    
    // Hardcoded roles that always have access (Organization level)
    const ALWAYS_ALLOWED_ROLES = ['procurement', 'org_super_admin', 'master_admin'];
    if (ALWAYS_ALLOWED_ROLES.includes(orgRole)) {
        return true;
    }

    // 2. Fetch all procurement price visibility rules for this organization
    const { data: allSettings } = await adminSupabase
        .from('procurement_price_visibility')
        .select('property_id, roles, users')
        .eq('organization_id', organizationId);

    if (!allSettings || allSettings.length === 0) {
        return false;
    }

    // 3. Check if user is explicitly allowed in ANY property settings (for global views like catalog)
    // or in the specific property's settings if propertyId is provided.
    const relevantSettings = propertyId 
        ? allSettings.filter(s => s.property_id === propertyId)
        : allSettings;

    for (const settings of allSettings) {
        // Check explicit user allowance - This is now GLOBAL if user is in ANY list
        if (settings.users?.includes(userId)) {
            console.log(`[Visibility] User ${userId} explicitly allowed via property ${settings.property_id} (Global Access)`);
            return true;
        }

        // If a specific property was requested, only check roles for THAT property
        if (propertyId && settings.property_id !== propertyId) {
            continue;
        }

        // Check if organization role is allowed in this property
        if (orgRole && settings.roles?.includes(orgRole)) {
            console.log(`[Visibility] Org Role ${orgRole} allowed for property ${settings.property_id}`);
            return true;
        }

        // Check if user has a property-specific role that is allowed
        const myRoleInThisProperty = propMemberships.find(m => m.property_id === settings.property_id)?.role;
        if (myRoleInThisProperty && settings.roles?.includes(myRoleInThisProperty)) {
            console.log(`[Visibility] Prop Role ${myRoleInThisProperty} allowed for property ${settings.property_id}`);
            return true;
        }
    }

    console.log(`[Visibility] Access DENIED for user ${userId} on property ${propertyId || 'Global'}`);
    return false;
}
