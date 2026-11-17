/**
 * The rate checker: what we have paid, from Zoho PO lines.
 *   GET  ?organizationId=&q=&unit=          → pooled benchmark, the matching rows, and when it was last rebuilt
 *   GET  ?organizationId=&q=&unit=&rate=    → also where that rate sits (good / fair / slightly high / high)
 *   POST { organizationId, action:'refresh' } → rebuild this organisation's benchmark now (~3 s)
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireSatejCaller } from '@/backend/lib/satej/access';
import { BenchmarkMissingError, benchmarkStatus, lookupRates, ratePool, refreshBenchmark } from '@/backend/lib/satej/benchmark';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function failure(e: unknown) {
    const missing = e instanceof BenchmarkMissingError;
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Rate lookup failed', setupNeeded: missing }, { status: missing ? 503 : 500 });
}

export async function GET(request: NextRequest) {
    const p = request.nextUrl.searchParams;
    const organizationId = p.get('organizationId');
    const caller = await requireSatejCaller(organizationId);
    if (caller instanceof NextResponse) return caller;
    const q = (p.get('q') ?? '').trim().slice(0, 200);
    const unit = (p.get('unit') ?? '').trim().slice(0, 30) || null;
    const rate = Number(p.get('rate'));
    try {
        const status = await benchmarkStatus(organizationId!);
        if (!q) return NextResponse.json({ status, pool: null, rows: [], verdict: null });
        const [pool, rows, verdict] = await Promise.all([
            ratePool(organizationId!, q, unit),
            lookupRates(organizationId!, q, unit, 15),
            rate > 0
                ? supabaseAdmin.rpc('satej_quote_verdict', { p_org: organizationId, p_query: q, p_unit: unit, p_rate: rate }).then(({ data, error }) => {
                    if (error) throw new Error(error.message);
                    const j = (data ?? {}) as Record<string, unknown>;
                    return { verdict: j.verdict, confidence: j.confidence, deltaPct: j.delta_pct ?? null };
                })
                : Promise.resolve(null),
        ]);
        return NextResponse.json({ status, pool, rows, verdict });
    } catch (e) {
        return failure(e);
    }
}

export async function POST(request: NextRequest) {
    const body = (await request.json().catch(() => ({}))) as { organizationId?: string; action?: string };
    const caller = await requireSatejCaller(body.organizationId);
    if (caller instanceof NextResponse) return caller;
    if (body.action !== 'refresh') return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    try {
        const products = await refreshBenchmark(body.organizationId!);
        return NextResponse.json({ ok: true, products, status: await benchmarkStatus(body.organizationId!) });
    } catch (e) {
        return failure(e);
    }
}
