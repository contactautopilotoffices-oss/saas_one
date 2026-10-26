/**
 * ORG WIKI — who may read and ask it: SUPER ADMINS ONLY (org_super_admin, master_admin).
 *
 * The journal pages record security findings and the mail pages carry purchase@
 * snippets, so this is narrower than the purchase digest. Reuses the purchase-mailbox
 * resolver (same membership lookup, same super-admin rule the mail archive uses).
 */

import { NextRequest, NextResponse } from 'next/server';
import { resolveMailboxAccess, isMailboxAccessError, readOrgId } from '@/backend/lib/mailbox/access';

export interface WikiAccess {
    userId: string;
    orgId: string;
}

const FORBIDDEN = 'The wiki is limited to super admins.';

export async function requireWikiAccess(request: NextRequest, body?: unknown): Promise<WikiAccess | NextResponse> {
    const access = await resolveMailboxAccess(request, readOrgId(request, body));
    if (isMailboxAccessError(access)) {
        return access.status === 403 ? NextResponse.json({ error: FORBIDDEN }, { status: 403 }) : access;
    }
    if (!access.isSuperAdmin) return NextResponse.json({ error: FORBIDDEN }, { status: 403 });
    return { userId: access.user.id, orgId: access.organizationId };
}

export const isWikiAccessError = (x: WikiAccess | NextResponse): x is NextResponse => x instanceof NextResponse;
