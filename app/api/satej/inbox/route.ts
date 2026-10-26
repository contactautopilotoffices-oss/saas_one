/**
 * Quote requests from the purchase@ inbox, for Meera.
 *   GET  ?organizationId=                         → colleagues' asks for vendor quotes, last 30 days
 *   POST { organizationId, action:'draft', threadId } → a pre-filled requirement form from that email
 * Nothing is started from here: the person reviews the draft and submits it.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireSatejCaller } from '@/backend/lib/satej/access';
import { draftFromThread, inboxQuoteRequests } from '@/backend/lib/satej/inbox';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: NextRequest) {
    const organizationId = request.nextUrl.searchParams.get('organizationId');
    const caller = await requireSatejCaller(organizationId);
    if (caller instanceof NextResponse) return caller;
    try {
        return NextResponse.json({ asks: await inboxQuoteRequests(organizationId!, 30) });
    } catch (e) {
        return NextResponse.json({ error: e instanceof Error ? e.message : 'Could not read the purchase inbox' }, { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    const body = (await request.json().catch(() => ({}))) as { organizationId?: string; action?: string; threadId?: string };
    const caller = await requireSatejCaller(body.organizationId);
    if (caller instanceof NextResponse) return caller;
    if (body.action !== 'draft' || !/^\d{6,30}$/.test(String(body.threadId ?? ''))) {
        return NextResponse.json({ error: 'action "draft" with a threadId is required' }, { status: 400 });
    }
    try {
        return NextResponse.json({ draft: await draftFromThread(body.organizationId!, String(body.threadId)) });
    } catch (e) {
        return NextResponse.json({ error: e instanceof Error ? e.message : 'Could not draft from that email' }, { status: 400 });
    }
}
