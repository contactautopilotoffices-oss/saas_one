import { supabaseAdmin } from '@/backend/lib/supabase/admin';

/**
 * Meta Marketing API insights sync.
 *
 * Pulls daily campaign-level spend + performance metrics from the Meta
 * Marketing API and upserts them into `crm_campaign_spend` and
 * `crm_campaign_metrics`.
 *
 *  - Hourly cron drives `syncAllOrgs()`.
 *  - Each org's run is isolated — one bad config doesn't poison the others.
 *  - Manual spend entries always win: if a row already exists for a
 *    (campaign_id, spend_date) with source != 'meta_api', we leave it alone.
 *  - Sync window is the LAST 3 FULL DAYS + TODAY. 4-day window keeps us well
 *    inside Meta's 95-day sync-window, recovers from any missed run, and
 *    keeps overwrites of partial-day data idempotent.
 */

const GRAPH_VERSION = 'v19.0';
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

export interface SyncResult {
    orgId: string;
    status: 'ok' | 'failed' | 'auth_error' | 'partial' | 'skipped';
    campaignsProcessed: number;
    spendRowsUpserted: number;
    metricRowsUpserted: number;
    manualSpendSkipped: number;
    errors: string[];
    durationMs: number;
}

interface MetaInsightsRow {
    campaign_id: string;
    campaign_name?: string;
    date_start: string;       // 'YYYY-MM-DD'
    date_stop: string;        // usually == date_start with time_increment=1
    spend: string;            // Meta returns numbers as strings
    impressions: string;
    clicks: string;
    reach?: string;
    ctr?: string;             // percent (e.g. "2.3456")
    cpc?: string;
    cpm?: string;
    frequency?: string;
}

interface MetaConfig {
    id: string;
    organization_id: string;
    meta_ad_account_id: string | null;
    meta_user_access_token: string | null;
    is_active: boolean;
}

/**
 * Iterate all active org configs and run the sync.
 * Called by the cron route.
 */
export async function syncAllOrgs(): Promise<{
    orgs: number;
    results: SyncResult[];
}> {
    const { data: configs, error } = await supabaseAdmin
        .from('crm_meta_config')
        .select('id, organization_id, meta_ad_account_id, meta_user_access_token, is_active')
        .eq('is_active', true);

    if (error) throw new Error(`Failed to list meta configs: ${error.message}`);

    const results: SyncResult[] = [];
    for (const cfg of (configs || []) as MetaConfig[]) {
        try {
            results.push(await syncMetaInsightsForOrg(cfg));
        } catch (err: any) {
            results.push({
                orgId: cfg.organization_id,
                status: 'failed',
                campaignsProcessed: 0,
                spendRowsUpserted: 0,
                metricRowsUpserted: 0,
                manualSpendSkipped: 0,
                errors: [err?.message || 'unknown'],
                durationMs: 0,
            });
        }
    }
    return { orgs: configs?.length || 0, results };
}

/**
 * Sync one org. Caller may pass either a partial config or the full row.
 */
export async function syncMetaInsightsForOrg(cfg: MetaConfig): Promise<SyncResult> {
    const start = Date.now();
    const errors: string[] = [];

    // Guard: must have Marketing API access configured.
    if (!cfg.meta_ad_account_id || !cfg.meta_user_access_token) {
        await markSync(cfg.organization_id, 'skipped', null);
        return {
            orgId: cfg.organization_id,
            status: 'skipped',
            campaignsProcessed: 0,
            spendRowsUpserted: 0,
            metricRowsUpserted: 0,
            manualSpendSkipped: 0,
            errors: ['Marketing API not configured (missing meta_ad_account_id or meta_user_access_token)'],
            durationMs: Date.now() - start,
        };
    }

    // Compute the 4-day sync window in account-local timezone. The Marketing
    // API accepts YYYY-MM-DD inclusive; we'll use UTC since spend data is
    // already aggregated to a date.
    const today = new Date();
    const todayStr = isoDate(today);
    const since = isoDate(addDays(today, -3));
    const until = todayStr;

    // Load the org's campaign map: meta_campaign_id -> local campaign row.
    // Campaigns without meta_campaign_id won't be touched.
    const { data: localCampaigns, error: campErr } = await supabaseAdmin
        .from('crm_campaigns')
        .select('id, meta_campaign_id, name, organization_id')
        .eq('organization_id', cfg.organization_id)
        .not('meta_campaign_id', 'is', null);
    if (campErr) throw new Error(`Failed to load local campaigns: ${campErr.message}`);

    const localByMetaId = new Map<string, { id: string; name: string }>();
    for (const c of (localCampaigns || []) as any[]) {
        if (c.meta_campaign_id) localByMetaId.set(c.meta_campaign_id, { id: c.id, name: c.name });
    }

    if (localByMetaId.size === 0) {
        await markSync(cfg.organization_id, 'ok', start);
        return {
            orgId: cfg.organization_id,
            status: 'ok',
            campaignsProcessed: 0,
            spendRowsUpserted: 0,
            metricRowsUpserted: 0,
            manualSpendSkipped: 0,
            errors: ['No local campaigns have meta_campaign_id set'],
            durationMs: Date.now() - start,
        };
    }

    // Fetch insights (paginated).
    const rows = await fetchInsights(cfg.meta_ad_account_id, cfg.meta_user_access_token, since, until);

    // Filter to only rows whose campaign we know about locally.
    let spendUpserted = 0;
    let metricsUpserted = 0;
    let manualSkipped = 0;
    let campaignsTouched = 0;

    // Pre-fetch any manual spend rows for the window so we can skip-clobber.
    const localCampaignIds = Array.from(localByMetaId.values()).map((v) => v.id);
    const { data: existingSpend } = await supabaseAdmin
        .from('crm_campaign_spend')
        .select('campaign_id, spend_date, source')
        .eq('organization_id', cfg.organization_id)
        .in('campaign_id', localCampaignIds)
        .gte('spend_date', since)
        .lte('spend_date', until)
        .neq('source', 'meta_api'); // only manual / import / google_api are "protected"
    const protectedSpend = new Set<string>();
    for (const r of (existingSpend || []) as any[]) {
        protectedSpend.add(`${r.campaign_id}|${r.spend_date}`);
    }

    const seenCampaigns = new Set<string>();

    for (const row of rows) {
        const local = localByMetaId.get(row.campaign_id);
        if (!local) continue;
        seenCampaigns.add(local.id);

        const spendAmount = Number(row.spend || 0);
        const dateKey = row.date_start; // with time_increment=1, == date_stop

        // --- Spend upsert (unless protected by manual entry) ---
        const protectKey = `${local.id}|${dateKey}`;
        if (protectedSpend.has(protectKey)) {
            manualSkipped++;
        } else if (spendAmount > 0 || true) {
            // Upsert by (campaign_id, spend_date). The crm_campaign_spend
            // table has no explicit unique index on (campaign_id, spend_date),
            // so we do a read-then-insert/update dance against the service role.
            const { data: existing } = await supabaseAdmin
                .from('crm_campaign_spend')
                .select('id')
                .eq('campaign_id', local.id)
                .eq('spend_date', dateKey)
                .maybeSingle();

            if (existing) {
                const { error } = await supabaseAdmin
                    .from('crm_campaign_spend')
                    .update({ amount: spendAmount, source: 'meta_api' })
                    .eq('id', existing.id);
                if (error) errors.push(`spend update ${local.id}/${dateKey}: ${error.message}`);
                else spendUpserted++;
            } else {
                const { error } = await supabaseAdmin
                    .from('crm_campaign_spend')
                    .insert({
                        organization_id: cfg.organization_id,
                        campaign_id: local.id,
                        spend_date: dateKey,
                        amount: spendAmount,
                        source: 'meta_api',
                        notes: 'Auto-synced from Meta Marketing API',
                        created_by: null,
                    });
                if (error) errors.push(`spend insert ${local.id}/${dateKey}: ${error.message}`);
                else spendUpserted++;
            }
        }

        // --- Metrics upsert ---
        const impressions = Number(row.impressions || 0);
        const clicks = Number(row.clicks || 0);
        const reach = row.reach != null ? Number(row.reach) : null;
        const ctr = row.ctr != null ? Number(row.ctr) : null;
        const cpc = row.cpc != null ? Number(row.cpc) : null;
        const cpm = row.cpm != null ? Number(row.cpm) : null;
        const frequency = row.frequency != null ? Number(row.frequency) : null;

        const { error: metricErr } = await supabaseAdmin
            .from('crm_campaign_metrics')
            .upsert({
                organization_id: cfg.organization_id,
                campaign_id: local.id,
                metric_date: dateKey,
                impressions,
                clicks,
                reach,
                ctr,
                cpc,
                cpm,
                frequency,
                source: 'meta_api',
                updated_at: new Date().toISOString(),
            }, { onConflict: 'campaign_id,metric_date' });
        if (metricErr) errors.push(`metrics upsert ${local.id}/${dateKey}: ${metricErr.message}`);
        else metricsUpserted++;
    }

    campaignsTouched = seenCampaigns.size;
    const finalStatus: SyncResult['status'] = errors.length === 0 ? 'ok'
        : errors.length < 3 ? 'partial'
        : 'failed';
    await markSync(cfg.organization_id, finalStatus, start);

    return {
        orgId: cfg.organization_id,
        status: finalStatus,
        campaignsProcessed: campaignsTouched,
        spendRowsUpserted: spendUpserted,
        metricRowsUpserted: metricsUpserted,
        manualSpendSkipped: manualSkipped,
        errors,
        durationMs: Date.now() - start,
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// Internals
// ─────────────────────────────────────────────────────────────────────────────

async function fetchInsights(
    adAccountId: string,
    accessToken: string,
    since: string,
    until: string
): Promise<MetaInsightsRow[]> {
    // Meta requires `act_` prefix on the ad account id.
    const aid = adAccountId.startsWith('act_') ? adAccountId : `act_${adAccountId}`;
    const all: MetaInsightsRow[] = [];
    let url: string | null =
        `${GRAPH_BASE}/${aid}/insights?` +
        new URLSearchParams({
            fields: 'campaign_id,campaign_name,spend,impressions,clicks,reach,ctr,cpc,cpm,frequency',
            time_increment: '1',
            level: 'campaign',
            time_range: JSON.stringify({ since, until }),
            limit: '500',
            access_token: accessToken,
        }).toString();

    let pageCount = 0;
    while (url && pageCount < 20) { // safety: never chase more than 20 pages
        pageCount++;
        const res = await fetch(url);
        const json: any = await res.json();
        if (!res.ok) {
            const errMsg = json?.error?.message || `HTTP ${res.status}`;
            const isAuth = res.status === 401 || json?.error?.code === 190;
            if (isAuth) {
                const e: any = new Error(`Meta auth error: ${errMsg}`);
                e.code = 'AUTH_ERROR';
                throw e;
            }
            throw new Error(`Meta insights fetch failed: ${errMsg}`);
        }
        const data: MetaInsightsRow[] = json?.data || [];
        all.push(...data);
        url = json?.paging?.next || null;
    }
    return all;
}

async function markSync(
    orgId: string,
    status: SyncResult['status'] | 'skipped',
    startedAtMs: number | null
): Promise<void> {
    const now = new Date().toISOString();
    // Update via service role (bypasses RLS).
    const { error } = await supabaseAdmin
        .from('crm_meta_config')
        .update({
            last_sync_at: now,
            last_sync_status: status,
        })
        .eq('organization_id', orgId);
    if (error) {
        console.error('[metaInsightsSync] failed to update last_sync_at', { orgId, error: error.message });
    }
    if (startedAtMs != null) {
        void startedAtMs; // duration tracked in the returned SyncResult
    }
}

function isoDate(d: Date): string {
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function addDays(d: Date, days: number): Date {
    const x = new Date(d);
    x.setUTCDate(x.getUTCDate() + days);
    return x;
}