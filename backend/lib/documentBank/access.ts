import { supabaseAdmin } from '@/backend/lib/supabase/admin';

const ORG_ADMIN_ROLES = ['org_super_admin', 'org_admin', 'master_admin'];
const PROPERTY_ADMIN_ROLES = ['property_admin', 'PROPERTY_ADMIN', 'super_admin', 'SUPER_ADMIN'];

export interface AccessResult {
    allowed: boolean;
    isAdmin: boolean;
}

/**
 * API routes use supabaseAdmin (service role) for the actual query, which bypasses the RLS
 * policies in supabase/migrations/20260827000001_document_bank.sql — so this mirrors those
 * same policies in application code, the way app/api/vendors/maintenance/[vendorId]/kyc
 * checks vendor-self-or-admin before touching supabaseAdmin.
 */
export async function checkDocumentBankAccess(
    userId: string,
    organizationId: string,
    propertyId: string | null,
): Promise<AccessResult> {
    const orgMembershipQuery = supabaseAdmin
        .from('organization_memberships')
        .select('role, is_active')
        .eq('user_id', userId)
        .eq('organization_id', organizationId)
        .eq('is_active', true)
        .maybeSingle();

    const propMembershipQuery = propertyId
        ? supabaseAdmin
            .from('property_memberships')
            .select('role, is_active')
            .eq('user_id', userId)
            .eq('property_id', propertyId)
            .eq('is_active', true)
            .maybeSingle()
        : null;

    const [orgMembership, propMembership] = await Promise.all([
        orgMembershipQuery,
        propMembershipQuery ?? Promise.resolve(null),
    ]);

    const orgRole = orgMembership.data?.role as string | undefined;
    const propRole = propMembership?.data?.role as string | undefined;

    const allowed = Boolean(orgMembership.data || propMembership?.data);
    const isAdmin = Boolean(
        (orgRole && ORG_ADMIN_ROLES.includes(orgRole)) ||
        (propRole && PROPERTY_ADMIN_ROLES.includes(propRole)),
    );

    return { allowed, isAdmin };
}
