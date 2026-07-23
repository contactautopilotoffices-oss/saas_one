import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { LinkedInConfig } from '@/backend/services/linkedinClient';
import { syncLinkedInLeadsForOrg } from '@/backend/services/linkedinLeadSync';
import { syncLinkedInInsightsForOrg } from '@/backend/services/linkedinInsightsSync';

/**
 * GET /api/cron/sync-linkedin
 *
 * For every active crm_linkedin_config: poll Lead Gen Form responses → crm_leads,
 * and pull adAnalytics → spend/metrics. Per-org isolation; one bad token does
 * not affect others.
 *
 * Auth: Bearer ${CRON_SECRET}. Recommended schedule: every 30 min.
 */

const CONFIG_SELECT =
    'id, organization_id, client_id, client_secret, access_token, refresh_token, token_expires_at, refresh_token_expires_at, ad_account_urn, organization_urn, default_assignee, default_lead_source, default_property, is_active, last_lead_sync_at';

export async function GET(request: NextRequest) {
    const authHeader = request.headers.get('authorization');
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const startedAt = Date.now();
    const { data: configs, error } = await supabaseAdmin
        .from('crm_linkedin_config')
        .select(CONFIG_SELECT)
        .eq('is_active', true);
    if (error) {
        return NextResponse.json({ status: 'failed', error: error.message }, { status: 500 });
    }

    const leadResults: any[] = [];
    const insightResults: any[] = [];
    for (const cfg of (configs || []) as LinkedInConfig[]) {
        try { leadResults.push(await syncLinkedInLeadsForOrg(cfg)); }
        catch (e: any) { leadResults.push({ orgId: cfg.organization_id, status: 'failed', errors: [e?.message] }); }
        try { insightResults.push(await syncLinkedInInsightsForOrg(cfg)); }
        catch (e: any) { insightResults.push({ orgId: cfg.organization_id, status: 'failed', errors: [e?.message] }); }
    }

    return NextResponse.json({
        status: 'ok',
        orgs: configs?.length || 0,
        leads: {
            inserted: leadResults.reduce((s, r) => s + (r.inserted || 0), 0),
            skipped: leadResults.reduce((s, r) => s + (r.skipped || 0), 0),
            results: leadResults,
        },
        insights: {
            spend_rows: insightResults.reduce((s, r) => s + (r.spendRowsUpserted || 0), 0),
            metric_rows: insightResults.reduce((s, r) => s + (r.metricRowsUpserted || 0), 0),
            results: insightResults,
        },
        duration_ms: Date.now() - startedAt,
    });
}
