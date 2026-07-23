-- ============================================================================
-- Unified multi-channel reporting: one `channel` dimension + speed indexes.
-- Lets existing dashboards filter Meta / LinkedIn / Google via ?channel= without
-- separate UIs, and indexes the hot report-query paths (data is mostly static).
-- ============================================================================

-- 1. Channel on lead sources → every lead resolves to a channel via its source.
ALTER TABLE crm_lead_sources ADD COLUMN IF NOT EXISTS channel text;

UPDATE crm_lead_sources SET channel = 'meta_ads'     WHERE channel IS NULL AND name ILIKE '%meta%';
UPDATE crm_lead_sources SET channel = 'linkedin_ads' WHERE channel IS NULL AND name ILIKE '%linkedin%';
UPDATE crm_lead_sources SET channel = 'google_ads'   WHERE channel IS NULL AND name ILIKE '%google%';
-- everything else stays NULL (organic / referral / walk-in / etc.)

CREATE INDEX IF NOT EXISTS idx_crm_lead_sources_channel ON crm_lead_sources(channel);

-- 2. Speed indexes for the report/dashboard scans (org + time-window + source).
CREATE INDEX IF NOT EXISTS idx_crm_leads_org_created      ON crm_leads(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_crm_leads_lead_source      ON crm_leads(lead_source);
CREATE INDEX IF NOT EXISTS idx_crm_leads_org_status       ON crm_leads(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_crm_leads_org_active_created
    ON crm_leads(organization_id, created_at DESC) WHERE is_archived = false;

CREATE INDEX IF NOT EXISTS idx_crm_campaigns_org_channel  ON crm_campaigns(organization_id, channel);
CREATE INDEX IF NOT EXISTS idx_crm_campaign_spend_camp_date   ON crm_campaign_spend(campaign_id, spend_date);
CREATE INDEX IF NOT EXISTS idx_crm_campaign_metrics_camp_date ON crm_campaign_metrics(campaign_id, metric_date);
