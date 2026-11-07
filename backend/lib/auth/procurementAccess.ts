import { isOrgAdmin, orgRolesIn, type CallerAccess } from '@/backend/lib/auth/callerAccess';

/** The procurement roles the requisitions route already accepts for changes (PATCH /api/procurement/requisitions/[id]). */
const PROCUREMENT_ROLES = ['procurement', 'purchase_manager', 'purchase_executive', 'org_super_admin', 'ops_super_admin', 'master_admin'];

/** May change procurement settings (prices, aliases, budgets) for this organisation. */
export function isProcurementAdmin(caller: CallerAccess, orgId: string): boolean {
    return caller.isMasterAdmin || isOrgAdmin(caller, orgId) || orgRolesIn(caller, orgId).some(r => PROCUREMENT_ROLES.includes(r));
}
