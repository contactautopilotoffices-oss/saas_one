/**
 * Daily (vercel.json, 03:30 UTC = 09:00 IST): refresh each organisation's bounties for the month,
 * ask the owners whose expected date has passed, escalate what is overdue. Cheap: a few reads per
 * org, an email per open bounty at most every 48 h.
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { runBountyDay } from '@/backend/lib/aop/bounty';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(request: NextRequest) {
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret) { console.error('[aop-bounty] CRON_SECRET is not set; refusing to run'); return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }); }
    if (request.headers.get('authorization') !== `Bearer ${cronSecret}`) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    // Only organisations that have an AOP set up.
    const { data: orgs, error } = await supabaseAdmin.from('aop_sites').select('organization_id');
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const results: Record<string, unknown> = {};
    for (const id of [...new Set((orgs ?? []).map((o) => o.organization_id))]) {
        try { results[id] = await runBountyDay(id); } catch (e) { results[id] = { error: e instanceof Error ? e.message : String(e) }; }
    }
    return NextResponse.json({ ok: true, results });
}
