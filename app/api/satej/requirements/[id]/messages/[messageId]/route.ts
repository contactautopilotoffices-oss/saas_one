/**
 * POST { organizationId, decision: 'apply' | 'dismiss' } — a person's answer to
 * a change Satej proposed in chat. Apply runs the same pipeline function the
 * page's own buttons use; nothing is applied any other way.
 */

import { after, NextRequest, NextResponse } from 'next/server';
import { requireSatejCaller } from '@/backend/lib/satej/access';
import { decide } from '@/backend/lib/satej/chat';
import { advance } from '@/backend/lib/satej/pipeline';
import { getRepo } from '@/backend/lib/satej/repo';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

type Ctx = { params: Promise<{ id: string; messageId: string }> };

export async function POST(request: NextRequest, ctx: Ctx) {
    const { id, messageId } = await ctx.params;
    const body = (await request.json().catch(() => ({}))) as { organizationId?: string; decision?: string };
    const caller = await requireSatejCaller(body.organizationId);
    if (caller instanceof NextResponse) return caller;
    if (body.decision !== 'apply' && body.decision !== 'dismiss') {
        return NextResponse.json({ error: "decision must be 'apply' or 'dismiss'" }, { status: 400 });
    }
    try {
        const r = await getRepo().getRequirement(id);
        if (!r || r.organizationId !== body.organizationId) return NextResponse.json({ error: 'Requirement not found' }, { status: 404 });
        const message = await decide(r, messageId, body.decision, caller.name);
        if (message.actionStatus === 'applied') after(() => advance(r.id, { trigger: 'manual' }).then(() => undefined));
        return NextResponse.json({ message });
    } catch (e) {
        return NextResponse.json({ error: e instanceof Error ? e.message : 'Could not apply the proposal' }, { status: 400 });
    }
}
