// Workspace silos — the single source of truth for "this user never sees the FMS".
//
// A siloed user has a role that belongs to a standalone workspace (CRM, Accounts) and
// NO genuine FMS role. Such a user must always land in their workspace and never fall
// through to an FMS dashboard. This logic previously lived duplicated in both
// app/page.tsx and app/(auth)/login/page.tsx, each commented "single source of truth";
// adding Accounts would have made a third copy.

export const CRM_ONLY_ROLES = ['bd_rep', 'bd_admin', 'bd_super_admin'];

// Accounts/Finance is siloed exactly like CRM: the finance team works the Payment
// Tracker and petty cash, and has no business in the FMS dashboards.
export const ACCOUNTS_ONLY_ROLES = ['accounts'];

// A "genuine FMS role" outranks a silo — a user holding both works in the FMS and
// reaches the workspace through the sidebar instead of being locked into it.
export const FMS_ROLES = [
    'property_admin', 'tenant', 'security', 'staff', 'mst', 'vendor', 'org_admin',
    'owner', 'admin', 'procurement', 'org_super_admin', 'ops_super_admin', 'super_tenant', 'maintenance_vendor',
];

/** A membership flattened to just what silo resolution needs. */
export interface SiloMembership {
    role: string | null | undefined;
    orgId: string | null | undefined;
}

export type SiloKind = 'crm' | 'accounts';

/**
 * Decide whether a user is locked into a standalone workspace.
 *
 * Returns the destination path, or null when the user has an FMS role (or no siloed
 * role at all) and should continue through normal FMS routing.
 *
 * CRM is evaluated before Accounts to preserve the pre-existing precedence.
 */
export function resolveSilo(
    memberships: SiloMembership[],
    fallbackOrgId?: string | null,
): { kind: SiloKind; orgId: string; path: string } | null {
    const roles = memberships.map(m => m.role).filter(Boolean) as string[];
    if (roles.some(r => FMS_ROLES.includes(r))) return null;

    const silos: { kind: SiloKind; list: string[]; segment: string }[] = [
        { kind: 'crm', list: CRM_ONLY_ROLES, segment: 'crm' },
        { kind: 'accounts', list: ACCOUNTS_ONLY_ROLES, segment: 'accounts' },
    ];

    for (const silo of silos) {
        if (!roles.some(r => silo.list.includes(r))) continue;
        // Prefer the org that actually carries the siloed role.
        const orgId =
            memberships.find(m => m.role && silo.list.includes(m.role) && m.orgId)?.orgId ||
            fallbackOrgId;
        if (orgId) return { kind: silo.kind, orgId, path: `/${orgId}/${silo.segment}` };
    }
    return null;
}
