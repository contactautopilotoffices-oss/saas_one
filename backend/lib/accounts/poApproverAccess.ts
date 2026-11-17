import { NextRequest, NextResponse } from 'next/server';
import { resolveAccountsAccess, isAccountsAccessError, readOrgId, type AccountsAccess } from './access';
import { APPROVER_ROLES } from './poApprover';

/** Only an org super admin reaches anything under /api/po-approver. Everyone else gets 403. */
export async function requireApprover(request: NextRequest, body?: unknown): Promise<AccountsAccess | NextResponse> {
    const a = await resolveAccountsAccess(request, readOrgId(request, body));
    if (isAccountsAccessError(a)) return a;
    if (!a.roles.some((r) => APPROVER_ROLES.includes(r))) return NextResponse.json({ error: 'Only an org super admin can approve purchase orders.' }, { status: 403 });
    return a;
}
export const isApproverError = (a: AccountsAccess | NextResponse): a is NextResponse => a instanceof NextResponse;
