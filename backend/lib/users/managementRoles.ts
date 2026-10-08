/** Keep action-specific role grants explicit; callers must also verify active scope. */
export function isOrganizationUserManager(role?: string | null): boolean {
    return !!role && ['org_super_admin', 'ops_super_admin', 'admin', 'owner'].includes(role);
}

export function isOrganizationUserApprover(role?: string | null): boolean {
    return isOrganizationUserManager(role) || role === 'bd_super_admin';
}

export function canAssignProperties(role?: string | null): boolean {
    return role === 'org_super_admin';
}

export function isOrganizationWideUserRole(role: string): boolean {
    return ['org_super_admin', 'ops_super_admin', 'procurement', 'accounts', 'hr', 'hr_head', 'super_tenant'].includes(role);
}
