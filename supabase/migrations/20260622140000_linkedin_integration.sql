-- ============================================================================
-- LinkedIn Marketing integration — mirrors the Meta integration.
--   * crm_linkedin_config : per-org OAuth credentials + ad account
--   * crm_campaigns.linkedin_campaign_id : link local campaign → LinkedIn campaign
--   * crm_leads.linkedin_lead_id : dedup key for synced Lead Gen Form responses
--   * crm_campaign_spend.source : allow 'linkedin_api'
-- ============================================================================

CREATE TABLE IF NOT EXISTS crm_linkedin_config (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

    -- OAuth app (LinkedIn Developer App)
    client_id text,
    client_secret text,

    -- OAuth tokens (3-legged). access lasts ~60d, refresh ~365d.
    access_token text,
    refresh_token text,
    token_expires_at timestamptz,
    refresh_token_expires_at timestamptz,
    oauth_state text,                       -- CSRF nonce during the auth round-trip

    -- Marketing assets (URNs, e.g. 'urn:li:sponsoredAccount:123456789')
    ad_account_urn text,
    organization_urn text,                  -- the LinkedIn company page that owns the lead forms

    -- CRM routing defaults (same semantics as crm_meta_config)
    default_assignee uuid REFERENCES users(id) ON DELETE SET NULL,
    default_lead_source uuid REFERENCES crm_lead_sources(id) ON DELETE SET NULL,
    default_property uuid REFERENCES properties(id) ON DELETE SET NULL,

    -- Lifecycle / observability
    is_active boolean NOT NULL DEFAULT false,
    last_sync_at timestamptz,
    last_sync_status text,
    last_lead_sync_at timestamptz,          -- polling cursor for lead form responses

    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    UNIQUE (organization_id)
);

ALTER TABLE crm_linkedin_config ENABLE ROW LEVEL SECURITY;
-- Service-role only (accessed via supabaseAdmin); no public policies by design.

-- Campaign linkage + lead dedup key
ALTER TABLE crm_campaigns ADD COLUMN IF NOT EXISTS linkedin_campaign_id text;
ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS linkedin_lead_id text;

CREATE INDEX IF NOT EXISTS idx_crm_campaigns_linkedin_campaign_id ON crm_campaigns(linkedin_campaign_id);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_crm_leads_linkedin_lead_id ON crm_leads(linkedin_lead_id) WHERE linkedin_lead_id IS NOT NULL;

-- Allow 'linkedin_api' as a spend source. Drop the existing CHECK (if any) and
-- recreate it permissively.
DO $$
DECLARE
    con_name text;
BEGIN
    SELECT conname INTO con_name
    FROM pg_constraint
    WHERE conrelid = 'crm_campaign_spend'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%source%';
    IF con_name IS NOT NULL THEN
        EXECUTE format('ALTER TABLE crm_campaign_spend DROP CONSTRAINT %I', con_name);
    END IF;
END $$;

ALTER TABLE crm_campaign_spend
    ADD CONSTRAINT crm_campaign_spend_source_check
    CHECK (source IN ('manual', 'import', 'meta_api', 'google_api', 'linkedin_api'));
