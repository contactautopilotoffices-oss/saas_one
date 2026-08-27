import { NextRequest, NextResponse } from 'next/server';
import { resolveAccountsAccess, isAccountsAccessError, readOrgId } from '@/backend/lib/accounts/access';
import { syncPurchaseOrdersForOrg } from '@/backend/services/zohoBooksSync';

// POST /api/accounts/pos/sync — manual "Sync now" trigger from the dashboard.

// Same full pull as the cron route — needs well over the default timeout.
export const maxDuration = 300;

export async function POST(request: NextRequest) {
    const body = await request.json().catch(() => ({}));
    const access = await resolveAccountsAccess(request, readOrgId(request, body));
    if (isAccountsAccessError(access)) return access;
    if (!access.canAlign && !access.isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const result = await syncPurchaseOrdersForOrg(access.organizationId);
    return NextResponse.json(result);
}
