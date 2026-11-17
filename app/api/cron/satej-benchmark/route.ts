/**
 * Rebuild Meera's rate benchmark from the Zoho PO lines — days 1, 11, 21 and 31
 * of each month at 08:00 IST (vercel.json), i.e. about every 10 days. The PO
 * lines themselves sync every 15 minutes. ~3 s for 25k lines.
 */

import { NextRequest, NextResponse } from 'next/server';
import { refreshBenchmark } from '@/backend/lib/satej/benchmark';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function GET(request: NextRequest) {
    // Refuse outright when CRON_SECRET is unset: "Bearer undefined" must not pass.
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret) {
        console.error('[satej-benchmark] CRON_SECRET is not set; refusing to run');
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (request.headers.get('authorization') !== `Bearer ${cronSecret}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    try {
        const products = await refreshBenchmark();
        return NextResponse.json({ ok: true, products });
    } catch (e) {
        console.error('[satej-benchmark] refresh failed', e);
        return NextResponse.json({ error: e instanceof Error ? e.message : 'Refresh failed' }, { status: 500 });
    }
}
