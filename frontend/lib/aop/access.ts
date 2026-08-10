// Client-side AOP capability check.
//
// Mirrors backend/lib/aop/access.ts and the has_aop_access() RLS function. The API still
// enforces this independently — this exists only so the nav does not offer a link that
// would 403, and so the workspace chrome does not advertise a P&L the user cannot open.
//
// Procurement is deliberately absent. They drive spend but this module exposes every
// site's per-seat economics and landlord rent. Add them to all three places at once, or
// not at all.

const AOP_ROLES = new Set(['org_super_admin', 'master_admin', 'accounts']);

interface MembershipLike {
    org_role?: string | null;
    is_master_admin?: boolean;
    properties?: { role?: string }[];
}

export function canSeeAop(m: MembershipLike | null | undefined): boolean {
    if (m?.is_master_admin) return true;
    const roles = [m?.org_role, ...(m?.properties?.map(p => p.role) || [])].filter(Boolean) as string[];
    return roles.some(r => AOP_ROLES.has(r));
}
