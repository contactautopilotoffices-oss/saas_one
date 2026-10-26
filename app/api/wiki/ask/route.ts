/**
 * ORG WIKI — ask a question. SUPER ADMINS ONLY.
 * POST ?org_id= { question }  →  { status, answer, cited[], retrieved[], costUsd, latencyMs }
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireWikiAccess, isWikiAccessError } from '@/backend/lib/wiki/access';
import { askWiki } from '@/backend/lib/wiki/ask';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(request: NextRequest) {
    const body = await request.json().catch(() => null);
    const access = await requireWikiAccess(request, body);
    if (isWikiAccessError(access)) return access;
    const question = typeof body?.question === 'string' ? body.question.trim() : '';
    if (question.length < 3) return NextResponse.json({ error: 'Ask a question of at least a few words.' }, { status: 400 });
    if (question.length > 500) return NextResponse.json({ error: 'Keep the question under 500 characters.' }, { status: 400 });
    try {
        return NextResponse.json(await askWiki({ orgId: access.orgId, userId: access.userId, question }));
    } catch (e) {
        return NextResponse.json({ error: e instanceof Error ? e.message : 'The question failed.' }, { status: 500 });
    }
}
