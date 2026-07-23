-- =====================================================================
-- CRM: campaign as a first-class slicing dimension on leads
--
-- BD does NOT archive old leads — data is data. Cohorts are separated by
-- TIME (created_at -> month/quarter/year) and by CAMPAIGN + CITY + CHANNEL.
-- city already exists (migration 3); lead_source FK already captures the
-- CHANNEL (Meta / LinkedIn). This adds `campaign` (Lower Parel, Andheri,
-- Bangalore, Kalyan, F1 Skymark, ...) plus the import cohort tag so reports
-- can slice "Andheri – Meta – May 2026" without hiding any rows.
-- Idempotent & additive.
-- =====================================================================

ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS campaign TEXT;
ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS cohort   TEXT;   -- e.g. 'New' / 'Old' (just a label, not active/inactive)

CREATE INDEX IF NOT EXISTS idx_crm_leads_campaign ON crm_leads(lower(campaign));
-- composite for the common report cut: campaign + city + created_at
CREATE INDEX IF NOT EXISTS idx_crm_leads_campaign_city_created
    ON crm_leads(campaign, city, created_at);
