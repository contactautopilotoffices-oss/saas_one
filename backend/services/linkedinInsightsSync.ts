import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import {
    LinkedInConfig,
    LinkedInAuthError,
    linkedinGet,
    urnId,
} from '@/backend/services/linkedinClient';

/**
 * LinkedIn Marketing API insights sync.
 *
 * Pulls daily campaign-level spend + performance from `adAnalytics` and upserts
 * into crm_campaign_spend (source='linkedin_api') and crm_campaign_metrics.
 * Mirrors metaInsightsSync semantics:
 *   - Manual/import/other-source spend rows are protected (never clobbered).
 *   - 4-day rolling window (last 3 full days + today) for idempotent recovery.
 *   - Only campaigns with a local linkedin_campaign_id are touched.
 */

export interface LinkedInInsightsResult {
    orgId: string;
    status: 'ok' | 'failed' | 'auth_error' | 'skipped';
    campaignsProcessed: number;
    spendRowsUpserted: number;
    metricRowsUpserted: number;
    manualSpendSkipped: number;
    errors: string[];
}

function isoDate(d: Date): string {
    return d.toISOString().slice(0, 10);
}
function addDays(d: Date, n: number): Date {
    const c = new Date(d);
    c.setDate(c.getDate() + n);
    return c;
}

export async function syncLinkedInInsightsForOrg(cfg: LinkedInConfig): Promise<LinkedInInsightsResult> {
    const errors: string[] = [];
    if (!cfg.is_active || !cfg.access_token || !cfg.ad_account_urn) {
        return base(cfg, 'skipped', ['LinkedIn not connected / no ad account']);
    }

    // Local campaign map: linkedin_campaign_id -> { id, name }
    const { data: localCampaigns, error: campErr } = await supabaseAdmin
        .from('crm_campaigns')
        .select('id, linkedin_campaign_id, name')
        .eq('organization_id', cfg.organization_id)
        .not('linkedin_campaign_id', 'is', null);
    if (campErr) return base(cfg, 'failed', [`load campaigns: ${campErr.message}`]);

    const localByLiId = new Map<string, { id: string; name: string }>();
    for (const c of (localCampaigns || []) as any[]) {
        if (c.linkedin_campaign_id) localByLiId.set(String(c.linkedin_campaign_id), { id: c.id, name: c.name });
    }
    if (localByLiId.size === 0) {
        await mark(cfg, 'ok');
        return base(cfg, 'ok', ['No local campaigns have linkedin_campaign_id set']);
    }

    const today = new Date();
    const since = addDays(today, -3);

    let rows: LinkedInAnalyticsRow[];
    try {
        rows = await fetchAnalytics(cfg, Array.from(localByLiId.keys()), since, today);
    } catch (err: any) {
        if (err instanceof LinkedInAuthError) { await mark(cfg, 'auth_error'); return base(cfg, 'auth_error', [err.message]); }
        await mark(cfg, 'failed');
        return base(cfg, 'failed', [err?.message || 'analytics fetch failed']);
    }

    // Protect non-linkedin spend rows in the window.
    const localIds = Array.from(localByLiId.values()).map((v) => v.id);
    const { data: existingSpend } = await supabaseAdmin
        .from('crm_campaign_spend')
        .select('campaign_id, spend_date, source')
        .eq('organization_id', cfg.organization_id)
        .in('campaign_id', localIds)
        .gte('spend_date', isoDate(since))
        .lte('spend_date', isoDate(today))
        .neq('source', 'linkedin_api');
    const protectedSpend = new Set<string>();
    for (const r of (existingSpend || []) as any[]) protectedSpend.add(`${r.campaign_id}|${r.spend_date}`);

    let spendUpserted = 0, metricsUpserted = 0, manualSkipped = 0;
    const seen = new Set<string>();

    for (const row of rows) {
        const local = localByLiId.get(row.linkedinCampaignId);
        if (!local) continue;
        seen.add(local.id);
        const dateKey = row.date;

        // Spend upsert (protected by manual entries).
        if (protectedSpend.has(`${local.id}|${dateKey}`)) {
            manualSkipped++;
        } else {
            const { data: ex } = await supabaseAdmin
                .from('crm_campaign_spend').select('id')
                .eq('campaign_id', local.id).eq('spend_date', dateKey).maybeSingle();
            if (ex) {
                const { error } = await supabaseAdmin.from('crm_campaign_spend')
                    .update({ amount: row.spend, source: 'linkedin_api' }).eq('id', ex.id);
                if (error) errors.push(`spend ${local.id}/${dateKey}: ${error.message}`); else spendUpserted++;
            } else {
                const { error } = await supabaseAdmin.from('crm_campaign_spend').insert({
                    organization_id: cfg.organization_id, campaign_id: local.id,
                    spend_date: dateKey, amount: row.spend, source: 'linkedin_api',
                });
                if (error) errors.push(`spend ins ${local.id}/${dateKey}: ${error.message}`); else spendUpserted++;
            }
        }

        // Metrics upsert.
        const ctr = row.impressions > 0 ? (row.clicks / row.impressions) * 100 : null;
        const cpc = row.clicks > 0 ? row.spend / row.clicks : null;
        const cpm = row.impressions > 0 ? (row.spend / row.impressions) * 1000 : null;
        const { data: exM } = await supabaseAdmin
            .from('crm_campaign_metrics').select('id')
            .eq('campaign_id', local.id).eq('metric_date', dateKey).maybeSingle();
        const metricPayload = {
            organization_id: cfg.organization_id, campaign_id: local.id, metric_date: dateKey,
            impressions: row.impressions, clicks: row.clicks, ctr, cpc, cpm,
        };
        if (exM) {
            const { error } = await supabaseAdmin.from('crm_campaign_metrics').update(metricPayload).eq('id', exM.id);
            if (error) errors.push(`metric ${local.id}/${dateKey}: ${error.message}`); else metricsUpserted++;
        } else {
            const { error } = await supabaseAdmin.from('crm_campaign_metrics').insert(metricPayload);
            if (error) errors.push(`metric ins ${local.id}/${dateKey}: ${error.message}`); else metricsUpserted++;
        }
    }

    await mark(cfg, errors.length ? 'partial' : 'ok');
    return {
        orgId: cfg.organization_id,
        status: 'ok',
        campaignsProcessed: seen.size,
        spendRowsUpserted: spendUpserted,
        metricRowsUpserted: metricsUpserted,
        manualSpendSkipped: manualSkipped,
        errors,
    };
}

interface LinkedInAnalyticsRow {
    linkedinCampaignId: string;
    date: string; // YYYY-MM-DD
    spend: number;
    impressions: number;
    clicks: number;
}

/**
 * adAnalytics finder, pivoted by CAMPAIGN with DAILY granularity.
 * LinkedIn returns costInLocalCurrency, impressions, clicks and a dateRange.
 */
async function fetchAnalytics(
    cfg: LinkedInConfig,
    campaignIds: string[],
    since: Date,
    until: Date,
): Promise<LinkedInAnalyticsRow[]> {
    const campaignUrns = campaignIds.map((id) =>
        id.startsWith('urn:') ? id : `urn:li:sponsoredCampaign:${id}`
    );
    const campaignsParam = `List(${campaignUrns.map((u) => encodeURIComponent(u)).join(',')})`;

    const dr =
        `(start:(year:${since.getUTCFullYear()},month:${since.getUTCMonth() + 1},day:${since.getUTCDate()}),` +
        `end:(year:${until.getUTCFullYear()},month:${until.getUTCMonth() + 1},day:${until.getUTCDate()}))`;

    const path =
        `/adAnalytics?q=analytics` +
        `&pivot=CAMPAIGN&timeGranularity=DAILY` +
        `&dateRange=${dr}` +
        `&campaigns=${campaignsParam}` +
        `&fields=costInLocalCurrency,impressions,clicks,pivotValues,dateRange`;

    const json = await linkedinGet(cfg, path);
    const out: LinkedInAnalyticsRow[] = [];
    for (const el of json.elements || []) {
        const campaignUrn = (el.pivotValues || [])[0] || '';
        const liId = urnId(campaignUrn);
        if (!liId) continue;
        const d = el.dateRange?.start;
        const date = d ? `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}` : isoDate(since);
        out.push({
            linkedinCampaignId: liId,
            date,
            spend: Number(el.costInLocalCurrency || 0),
            impressions: Number(el.impressions || 0),
            clicks: Number(el.clicks || 0),
        });
    }
    return out;
}

function base(cfg: LinkedInConfig, status: LinkedInInsightsResult['status'], errors: string[]): LinkedInInsightsResult {
    return { orgId: cfg.organization_id, status, campaignsProcessed: 0, spendRowsUpserted: 0, metricRowsUpserted: 0, manualSpendSkipped: 0, errors };
}

async function mark(cfg: LinkedInConfig, status: string) {
    await supabaseAdmin.from('crm_linkedin_config').update({
        last_sync_at: new Date().toISOString(),
        last_sync_status: status,
        updated_at: new Date().toISOString(),
    }).eq('id', cfg.id);
}
