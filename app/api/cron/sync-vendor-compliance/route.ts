import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { syncVendorList } from '@/backend/services/zohoVendorSync';
import type { VendorZohoSyncResult } from '@/backend/lib/accounts/trackerTypes';

/**
 * PHASE 1, daily: the Zoho Books vendor LIST into vendor_profiles.
 *
 * Four paginated calls per org — GSTIN, PAN, GST treatment, state code, vendor code, email,
 * phone — so daily is cheap and keeps a newly-onboarded supplier from waiting on the slow
 * detail drain. Bearer-guarded like the other cron routes.
 *
 * vercel.json:  0 3 * * *  ->  /api/cron/sync-vendor-compliance
 * The per-vendor detail pass is a separate, throttled route: /api/cron/enrich-vendor-compliance
 */

export const maxDuration = 300;

export async function GET(request: NextRequest) {
    if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: configs } = await supabaseAdmin
        .from('accounts_zoho_config').select('organization_id').eq('is_active', true);

    const results: VendorZohoSyncResult[] = [];
    for (const c of configs || []) {
        try {
            results.push(await syncVendorList(c.organization_id, { actorChannel: 'cron' }));
        } catch (e) {
            // One org's missing migration or dead credentials must not stop the others.
            console.error('[cron] vendor list sync failed:', e);
            results.push({
                phase: 'list', organization_id: c.organization_id, zoho_organization_id: null,
                fetched: 0, created: 0, updated: 0, skipped: 0, remaining: 0, failed: 0,
                degraded: false, duration_ms: 0,
                error: e instanceof Error ? e.message : 'sync failed',
            });
        }
    }

    // A run where every org errored must not read as healthy in Vercel's cron log.
    const ok = results.every((r) => !r.error);
    return NextResponse.json({ ok, count: results.length, results }, { status: ok ? 200 : 500 });
}
