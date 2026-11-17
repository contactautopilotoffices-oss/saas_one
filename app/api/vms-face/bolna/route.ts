/**
 * Bolna → VMS Face host-approval webhook.
 * URL: {origin}/api/vms-face/bolna?token={VMS_FACE_BOLNA_WEBHOOK_TOKEN}, set on the agent by
 * scripts/vms-face-create-bolna-agent.ts. Bolna signs nothing, so the token is the only proof a
 * POST came from our account; with no token configured every request is refused.
 * Only the visit whose current call id matches the execution is ever updated.
 */
import { timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { handleExecution, type BolnaExecution } from '@/backend/lib/vms-face/hostCall';

export const dynamic = 'force-dynamic';

function tokenOk(given: string | null): boolean {
    const expected = process.env.VMS_FACE_BOLNA_WEBHOOK_TOKEN;
    if (!expected || !given) return false;
    const a = Buffer.from(given);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: NextRequest) {
    if (!process.env.VMS_FACE_BOLNA_WEBHOOK_TOKEN) {
        console.error('[VMS Face webhook] VMS_FACE_BOLNA_WEBHOOK_TOKEN is not set; refusing Bolna posts');
        return NextResponse.json({ error: 'Webhook not configured' }, { status: 503 });
    }
    if (!tokenOk(request.nextUrl.searchParams.get('token'))) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const payload = await request.json().catch(() => null);
    if (!payload || typeof payload !== 'object') return NextResponse.json({ error: 'Bad JSON' }, { status: 400 });

    const items = (Array.isArray(payload) ? payload : [payload]) as BolnaExecution[];
    try {
        const results = [];
        for (const item of items) results.push(await handleExecution(item));
        return NextResponse.json({ ok: true, results });
    } catch (e) {
        console.error('[VMS Face webhook] failed:', e);
        // 500 so Bolna retries.
        return NextResponse.json({ error: 'Processing failed' }, { status: 500 });
    }
}
