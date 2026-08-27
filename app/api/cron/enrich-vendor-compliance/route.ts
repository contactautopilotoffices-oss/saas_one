import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { enrichVendorDetails } from '@/backend/services/zohoVendorSync';
import type { VendorZohoSyncResult } from '@/backend/lib/accounts/trackerTypes';

/**
 * PHASE 2, every two hours: the per-vendor DETAIL fetch — Udyam, MSME class, billing
 * address, bank, TDS. One Zoho call per vendor, and this org has 767 of them.
 *
 * WHY THIS IS A SLOW DRAIN AND NOT A JOB
 * Zoho Books rate-limits at roughly 100 requests/minute. A full pass is therefore ~8 minutes
 * of continuous calling, which no single serverless invocation should attempt and no vendor
 * roster needs urgently. So each run takes BATCH vendors, oldest-first, at ~600ms apart:
 *
 *      25 vendors × 12 runs/day = 300/day  ->  767 vendors drained in about three days,
 *      then it idles, re-fetching each vendor only once a month (REFRESH_AFTER_DAYS).
 *
 * Resumable by construction: only vendors that were actually fetched get stamped, so a
 * rate-limited or timed-out run costs nothing but time. `remaining` in the response is the
 * honest backlog.
 *
 * BEFORE 20260806000001 IS APPLIED this route still works — it fills Udyam, MSME class and
 * addresses, which are pre-existing columns — but it reports degraded:true and cannot idle,
 * because zoho_synced_at is the column that remembers a vendor is done. It falls back to
 * cycling on updated_at: ~300 calls/day against a 144,000/day allowance, harmless but
 * pointless. Applying the migration is what makes it settle into a monthly refresh.
 *
 * vercel.json:  0 star-slash-2 * * *  ->  /api/cron/enrich-vendor-compliance
 */

export const maxDuration = 300;

/** Per org, per run. Deliberately small: 25 × 600ms = 15s of Zoho time. */
const BATCH = 25;

export async function GET(request: NextRequest) {
    if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // ?limit= lets an operator hand-drive a drain (a smoke test, or catching up after an
    // outage) without editing the schedule. Behind the same bearer as the cron itself, and
    // clamped by the service to MAX_DETAIL_LIMIT — this is a throttle knob, not a bypass.
    const requested = Number(new URL(request.url).searchParams.get('limit'));
    const batch = Number.isFinite(requested) && requested >= 1 ? Math.floor(requested) : BATCH;

    const { data: configs } = await supabaseAdmin
        .from('accounts_zoho_config').select('organization_id').eq('is_active', true);

    const results: VendorZohoSyncResult[] = [];
    for (const c of configs || []) {
        try {
            results.push(await enrichVendorDetails(c.organization_id, { limit: batch, actorChannel: 'cron' }));
        } catch (e) {
            console.error('[cron] vendor detail enrichment failed:', e);
            results.push({
                phase: 'detail', organization_id: c.organization_id, zoho_organization_id: null,
                fetched: 0, created: 0, updated: 0, skipped: 0, remaining: 0, failed: 0,
                degraded: false, duration_ms: 0,
                error: e instanceof Error ? e.message : 'enrichment failed',
            });
        }
    }

    const ok = results.every((r) => !r.error);
    return NextResponse.json({
        ok,
        count: results.length,
        // Surfaced at the top level so the cron log answers "is it still draining?" without
        // anyone reading the per-org detail.
        remaining: results.reduce((n, r) => n + r.remaining, 0),
        results,
    }, { status: ok ? 200 : 500 });
}
