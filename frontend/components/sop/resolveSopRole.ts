export interface SopMembershipLike {
    org_id?: string | null;
    org_role?: string | null;
    is_master_admin?: boolean;
    all_org_memberships?: { org_id: string; role: string }[];
    properties?: { id: string; role?: string; organization_id?: string | null }[];
}

export const ELEVATED_ORG_ROLES = ['org_super_admin', 'ops_super_admin', 'master_admin', 'org_admin', 'owner', 'admin'] as const;
const SUPER_ADMIN_ROLES = ['org_super_admin', 'master_admin', 'ops_super_admin'] as const;
const PROPERTY_ADMIN_ROLES = ['property_admin', 'org_admin', 'org_super_admin', 'master_admin', 'ops_super_admin', 'owner', 'admin'] as const;

export function normalizeSopRole(role?: string | null): string {
    return (role || '').toLowerCase().replace(/\s+/g, '_');
}

export function resolveSopUserRole({
    membership,
    propertyId,
    propertyIds,
    organizationId,
    routeOrgId,
}: {
    membership: SopMembershipLike | null | undefined;
    propertyId?: string;
    propertyIds?: string[];
    organizationId?: string;
    routeOrgId?: string;
}): { userRole: string; normalizedOrgRole: string; isAdmin: boolean; isOrgSuperAdmin: boolean } {
    const matchedPropOrgId = membership?.properties?.find(
        p => (propertyId && p.id === propertyId) || (propertyIds && propertyIds.includes(p.id))
    )?.organization_id || undefined;
    const routeMatchedOrgId = routeOrgId && (
        membership?.org_id === routeOrgId ||
        membership?.all_org_memberships?.some(m => m.org_id === routeOrgId)
    ) ? routeOrgId : undefined;
    const targetOrgId = organizationId || matchedPropOrgId || routeMatchedOrgId;

    const rawOrgRoles = targetOrgId
        ? [
            ...(membership?.all_org_memberships?.filter(m => m.org_id === targetOrgId).map(m => m.role) || []),
            ...(membership?.org_id === targetOrgId ? [membership?.org_role] : []),
        ]
        : [
            membership?.org_role,
            // Infer from all_org_memberships without org scope only when user has one org membership
            ...(membership?.all_org_memberships?.length === 1 ? [membership.all_org_memberships[0].role] : []),
        ];

    const normalizedOrgRoles = rawOrgRoles.map(normalizeSopRole).filter(Boolean);
    const elevatedOrgRole = ELEVATED_ORG_ROLES.find(role => normalizedOrgRoles.includes(role)) || '';
    const normalizedOrgRole = elevatedOrgRole || (membership?.is_master_admin ? 'master_admin' : '') || normalizedOrgRoles[0] || '';

    let userRole = 'staff';
    if (ELEVATED_ORG_ROLES.includes(normalizedOrgRole as any)) {
        userRole = normalizedOrgRole;
    } else if (propertyId) {
        const property = membership?.properties?.find(p => p.id === propertyId);
        userRole = normalizeSopRole(property?.role) || normalizedOrgRole || 'staff';
    } else if (propertyIds && propertyIds.length > 0) {
        const hasAdminRole = membership?.properties?.some(p =>
            propertyIds.includes(p.id) &&
            PROPERTY_ADMIN_ROLES.includes(normalizeSopRole(p.role) as any)
        );
        userRole = hasAdminRole ? 'property_admin' : (normalizedOrgRole || 'staff');
    } else {
        userRole = normalizedOrgRole || 'staff';
    }

    const isAdmin = PROPERTY_ADMIN_ROLES.includes(userRole as any) ||
        ELEVATED_ORG_ROLES.includes(normalizedOrgRole as any) ||
        Boolean(membership?.is_master_admin);
    const isOrgSuperAdmin = Boolean(
        membership?.is_master_admin ||
        SUPER_ADMIN_ROLES.includes(normalizedOrgRole as any) ||
        SUPER_ADMIN_ROLES.includes(userRole as any)
    );

    return { userRole, normalizedOrgRole, isAdmin, isOrgSuperAdmin };
}
