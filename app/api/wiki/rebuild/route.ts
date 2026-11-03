/**
 * ORG WIKI — rebuild every compiled page now. SUPER ADMINS ONLY. No model call.
 * POST ?org_id=  →  { pages, byKind, pruned, compiledAt, journal, ms }
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireWikiAccess, isWikiAccessError } from '@/backend/lib/wiki/access';
import { rebuildWiki } from '@/backend/lib/wiki/store';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(request: NextRequest) {
    const body = await request.json().catch(() => null);
    const access = await requireWikiAccess(request, body);
    if (isWikiAccessError(access)) return access;
    try {
        return NextResponse.json(await rebuildWiki(access.orgId, 'manual'));
    } catch (e) {
        return NextResponse.json({ error: e instanceof Error ? e.message : 'Rebuild failed.' }, { status: 500 });
    }
}
