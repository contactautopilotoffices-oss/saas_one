/**
 * The conversation with Meera on one requirement.
 *   GET  ?organizationId=              → every message, oldest first
 *   POST { organizationId, text }      → the person's message and Meera's reply (with any proposal)
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireSatejCaller } from '@/backend/lib/satej/access';
import { converse, listMessages } from '@/backend/lib/satej/chat';
import { getRepo } from '@/backend/lib/satej/repo';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

type Ctx = { params: Promise<{ id: string }> };

async function load(id: string, organizationId: string) {
    const r = await getRepo().getRequirement(id);
    return r && r.organizationId === organizationId ? r : null;
}

export async function GET(request: NextRequest, ctx: Ctx) {
    const { id } = await ctx.params;
    const organizationId = request.nextUrl.searchParams.get('organizationId');
    const caller = await requireSatejCaller(organizationId);
    if (caller instanceof NextResponse) return caller;
    try {
        const r = await load(id, organizationId!);
        if (!r) return NextResponse.json({ error: 'Requirement not found' }, { status: 404 });
        return NextResponse.json({ messages: await listMessages(r.id) });
    } catch (e) {
        return NextResponse.json({ error: e instanceof Error ? e.message : 'Could not load the conversation' }, { status: 500 });
    }
}

export async function POST(request: NextRequest, ctx: Ctx) {
    const { id } = await ctx.params;
    const body = (await request.json().catch(() => ({}))) as { organizationId?: string; text?: string };
    const caller = await requireSatejCaller(body.organizationId);
    if (caller instanceof NextResponse) return caller;
    const text = String(body.text ?? '').trim().slice(0, 2000);
    if (!text) return NextResponse.json({ error: 'Type a message' }, { status: 400 });
    try {
        const r = await load(id, body.organizationId!);
        if (!r) return NextResponse.json({ error: 'Requirement not found' }, { status: 404 });
        return NextResponse.json({ messages: await converse(r, text, { userId: caller.userId, name: caller.name }) });
    } catch (e) {
        console.error('[satej chat] post failed', e);
        return NextResponse.json({ error: e instanceof Error ? e.message : 'Could not send the message' }, { status: 500 });
    }
}
