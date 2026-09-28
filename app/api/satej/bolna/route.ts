/**
 * Bolna → Satej webhook. Receives two kinds of POST:
 *   · per call, from the voice agent's webhook_url — every status change and,
 *     at the end, the transcript, recording and extraction (the execution object);
 *   · per batch, from the batch's webhook_url — once, when the whole batch ends.
 *
 * URL: {origin}/api/satej/bolna?token={SATEJ_BOLNA_WEBHOOK_TOKEN}, set on the
 * agent by scripts/satej-sync-bolna.ts. Bolna signs nothing, so the token is
 * the only proof a POST came from our Bolna account; with no token configured
 * every request is refused rather than accepted.
 *
 * The work (checking whether the batch is done, analysing, WhatsApp) runs after
 * the response, so Bolna gets its 200 at once. A webhook that never arrives is
 * covered by the worker, which re-reads each running batch every 5 minutes.
 */

import { timingSafeEqual } from 'node:crypto';
import { after, NextRequest, NextResponse } from 'next/server';
import { satejConfig } from '@/backend/lib/satej/config';
import { advance, ingestExecution } from '@/backend/lib/satej/pipeline';
import { getRepo } from '@/backend/lib/satej/repo';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function tokenOk(given: string | null): boolean {
    const expected = satejConfig.webhookToken;
    if (!expected || !given) return false;
    const a = Buffer.from(given);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: NextRequest) {
    if (!satejConfig.webhookToken) {
        console.error('[satej webhook] SATEJ_BOLNA_WEBHOOK_TOKEN is not set; refusing Bolna posts');
        return NextResponse.json({ error: 'Webhook not configured' }, { status: 503 });
    }
    if (!tokenOk(request.nextUrl.searchParams.get('token'))) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const payload = await request.json().catch(() => null);
    if (!payload || typeof payload !== 'object') return NextResponse.json({ error: 'Bad JSON' }, { status: 400 });

    const items = (Array.isArray(payload) ? payload : [payload]) as Record<string, unknown>[];
    const touched = new Set<string>();
    try {
        for (const item of items) {
            const r = await ingestExecution(item);
            if (r) {
                touched.add(r.id);
                continue;
            }
            // Not a call of ours: it may be the batch-finished notice, which carries only the batch id.
            if (item.batch_id && !item.transcript && !item.telephony_data) {
                const byBatch = await getRepo().getRequirementByBatch(String(item.batch_id));
                if (byBatch) touched.add(byBatch.id);
            }
        }
    } catch (e) {
        // A storage failure must be retried by Bolna, not acknowledged and lost.
        console.error('[satej webhook] could not store the execution', e);
        return NextResponse.json({ error: 'Could not store the call' }, { status: 500 });
    }

    after(async () => {
        for (const id of touched) {
            await advance(id, { trigger: 'webhook' }).catch((e) => console.error('[satej webhook] advance failed', id, e));
        }
    });
    return NextResponse.json({ ok: true, matched: touched.size });
}
