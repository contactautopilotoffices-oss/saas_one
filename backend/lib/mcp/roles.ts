/**
 * Which roles may hold an MCP connection.
 *
 * This is a CODE constant, deliberately — not a database toggle. Enabling a
 * role requires a commit and a review, because enabling a narrower role than
 * org_super_admin is only safe once row-level security is scoped by membership
 * (see docs/MCP_ENDPOINT_V2_DESIGN.md section 2). A UI switch would let that
 * precondition be skipped by accident.
 */

export type McpRoleStatus = 'available' | 'coming_soon';

export interface McpRoleEntry {
    role: string;
    label: string;
    status: McpRoleStatus;
    /** What this role would be able to read once enabled. */
    scopeNote: string;
    /** What must be true before it can move to 'available'. */
    blockedBy?: string;
}

export const MCP_ROLE_REGISTRY: McpRoleEntry[] = [
    {
        role: 'org_super_admin',
        label: 'Organization Super Admin',
        status: 'available',
        scopeNote: 'Read access across the whole organization — the same data this role already sees in the app.',
    },
    {
        role: 'property_admin',
        label: 'Property Admin',
        status: 'coming_soon',
        scopeNote: 'Would be limited to the properties this admin is a member of.',
        blockedBy: 'Row-level security must be scoped by property membership first.',
    },
    {
        role: 'procurement',
        label: 'Procurement',
        status: 'coming_soon',
        scopeNote: 'Would be limited to procurement data for assigned properties.',
        blockedBy: 'Row-level security must be scoped by property membership first.',
    },
    {
        role: 'mst',
        label: 'MST / Technician',
        status: 'coming_soon',
        scopeNote: 'Would be limited to assigned tickets and checklists.',
        blockedBy: 'Row-level security must be scoped by assignment first.',
    },
    {
        role: 'staff',
        label: 'Staff',
        status: 'coming_soon',
        scopeNote: 'Would be limited to their own tasks and goals.',
        blockedBy: 'Row-level security must be scoped by owner first.',
    },
];

export function isRoleEnabledForMcp(role: string | null | undefined): boolean {
    if (!role) return false;
    return MCP_ROLE_REGISTRY.some((r) => r.role === role && r.status === 'available');
}
