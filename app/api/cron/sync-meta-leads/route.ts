import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { syncMetaLeadsForOrg } from '@/backend/services/metaLeadSync';

/**
 * GET /api/cron/sync-meta-leads
 *
 * Polling backstop for Meta Lead Ads. For every active crm_meta_config, pulls
 * recent Lead Gen Form responses and inserts any new leads (deduped). This
 * guarantees leads land within minutes even when the real-time webhook misses
 * a delivery or the Meta app is still in Development mode.
 *
 * Auth: Bearer ${CRON_SECRET}. Recommended schedule: every 15 min.
 */
export async function GET(request: NextRequest) {
    if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const startedAt = Date.now();
    const { data: configs, error } = await supabaseAdmin
        .from('crm_meta_config')
        .select('organization_id')
        .eq('is_active', true);
    if (error) return NextResponse.json({ status: 'failed', error: error.message }, { status: 500 });

    const results = [];
    for (const cfg of configs || []) {
        try {
            results.push(await syncMetaLeadsForOrg(cfg.organization_id, { perFormCap: 50 }));
        } catch (e: any) {
            results.push({ orgId: cfg.organization_id, status: 'failed', error: e?.message });
        }
    }

    return NextResponse.json({
        status: 'ok',
        orgs: configs?.length || 0,
        inserted: results.reduce((s, r: any) => s + (r.inserted || 0), 0),
        results,
        duration_ms: Date.now() - startedAt,
    });
}
