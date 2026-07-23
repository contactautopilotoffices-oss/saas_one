import { NextRequest, NextResponse } from 'next/server';
import { syncAllOrgs } from '@/backend/services/metaInsightsSync';

/**
 * GET /api/cron/sync-meta-insights
 *
 * Hourly (recommended). For every active crm_meta_config that has a
 * Marketing API token + ad account configured, pulls the last 4 days of
 * campaign-level insights from the Meta Marketing API and upserts them
 * into crm_campaign_spend and crm_campaign_metrics.
 *
 * Auth: Bearer ${CRON_SECRET}. Per-org failures are isolated — one org's
 * bad token does not affect the others.
 *
 * Recommended schedule: hourly between 02:00–23:00 IST. A typical run
 * takes <30s per active org.
 */
export async function GET(request: NextRequest) {
    const authHeader = request.headers.get('authorization');
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const startedAt = Date.now();
    try {
        const { orgs, results } = await syncAllOrgs();
        const summary = {
            ok: results.filter((r) => r.status === 'ok').length,
            partial: results.filter((r) => r.status === 'partial').length,
            failed: results.filter((r) => r.status === 'failed').length,
            auth_error: results.filter((r) => r.status === 'auth_error').length,
            skipped: results.filter((r) => r.status === 'skipped').length,
            spend_rows: results.reduce((s, r) => s + r.spendRowsUpserted, 0),
            metric_rows: results.reduce((s, r) => s + r.metricRowsUpserted, 0),
            manual_skipped: results.reduce((s, r) => s + r.manualSpendSkipped, 0),
        };
        return NextResponse.json({
            status: 'ok',
            orgs,
            summary,
            duration_ms: Date.now() - startedAt,
        });
    } catch (err: any) {
        console.error('[cron/sync-meta-insights] fatal:', err);
        return NextResponse.json(
            { status: 'failed', error: err?.message || 'unknown' },
            { status: 500 }
        );
    }
}