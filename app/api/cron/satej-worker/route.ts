/**
 * Satej worker — every minute (vercel.json). Advances every requirement that
 * has work waiting: new requirements, answered questions, finished calls,
 * pending WhatsApp. Also the safety net for a Bolna webhook that never came.
 */

import { NextRequest, NextResponse } from 'next/server';
import { workerTick } from '@/backend/lib/satej/pipeline';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(request: NextRequest) {
    // Refuse outright when CRON_SECRET is unset: "Bearer undefined" must not pass.
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret) {
        console.error('[satej-worker] CRON_SECRET is not set; refusing to run');
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (request.headers.get('authorization') !== `Bearer ${cronSecret}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    try {
        return NextResponse.json(await workerTick());
    } catch (e) {
        console.error('[satej-worker] tick failed', e);
        return NextResponse.json({ error: e instanceof Error ? e.message : 'Worker failed' }, { status: 500 });
    }
}
