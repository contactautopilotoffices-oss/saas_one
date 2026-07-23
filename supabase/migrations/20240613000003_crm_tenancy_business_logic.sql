-- =====================================================================
-- CRM Module: Multi-tenancy + Business-logic hardening + Integrations
-- Idempotent & additive. Safe to run on top of 20240613000001/2.
--
-- Adds:
--   * organization_id scoping to leads / events / meta leads
--   * city (market) scoping on leads
--   * closed_at + status semantic flags (is_won/is_lost/is_terminal/is_default)
--     so reporting no longer depends on hard-coded status NAMES
--   * org-scoping for configurable statuses & sources (NULL org = global default)
--   * crm_meta_config  (per-org Meta Lead Ads integration credentials)
--   * crm_campaigns + crm_campaign_recipients (WhatsApp broadcast / drip)
--   * hardened auto-activity trigger (no NULL auth.uid crash, sets closed_at)
--   * backfill of organization_id for existing rows
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Tenancy + market columns on leads
-- ---------------------------------------------------------------------
ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS city TEXT;
ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;

ALTER TABLE crm_events ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE crm_meta_leads ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_crm_leads_org ON crm_leads(organization_id);
CREATE INDEX IF NOT EXISTS idx_crm_leads_city ON crm_leads(lower(city));
CREATE INDEX IF NOT EXISTS idx_crm_events_org ON crm_events(organization_id);

-- ---------------------------------------------------------------------
-- 2. Status semantic flags + org scoping  (replaces name-matching)
-- ---------------------------------------------------------------------
ALTER TABLE crm_lead_statuses ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE crm_lead_statuses ADD COLUMN IF NOT EXISTS is_won     BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE crm_lead_statuses ADD COLUMN IF NOT EXISTS is_lost    BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE crm_lead_statuses ADD COLUMN IF NOT EXISTS is_terminal BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE crm_lead_statuses ADD COLUMN IF NOT EXISTS is_default BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE crm_lead_sources ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;

-- Seed flags on the default (global, org IS NULL) statuses created in migration 1.
UPDATE crm_lead_statuses SET is_default  = true  WHERE name = 'New Lead'  AND organization_id IS NULL;
UPDATE crm_lead_statuses SET is_won = true, is_terminal = true WHERE name = 'Won' AND organization_id IS NULL;
UPDATE crm_lead_statuses SET is_lost = true, is_terminal = true WHERE name IN ('Lost','Dropped') AND organization_id IS NULL;

-- Replace the global UNIQUE(name) with a per-org unique so each tenant can
-- have its own pipeline without colliding with the shared defaults.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'crm_lead_statuses_name_key') THEN
        ALTER TABLE crm_lead_statuses DROP CONSTRAINT crm_lead_statuses_name_key;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'crm_lead_sources_name_key') THEN
        ALTER TABLE crm_lead_sources DROP CONSTRAINT crm_lead_sources_name_key;
    END IF;
END $$;

-- Uniqueness now scoped per-org. COALESCE so global rows (NULL org) stay unique too.
CREATE UNIQUE INDEX IF NOT EXISTS uq_crm_lead_statuses_org_name
    ON crm_lead_statuses (COALESCE(organization_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name));
CREATE UNIQUE INDEX IF NOT EXISTS uq_crm_lead_sources_org_name
    ON crm_lead_sources (COALESCE(organization_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name));

-- ---------------------------------------------------------------------
-- 3. Per-org Meta Lead Ads integration config
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS crm_meta_config (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    verify_token TEXT,                 -- echoed back during Meta webhook subscription
    app_secret TEXT,                   -- used to validate X-Hub-Signature-256
    page_access_token TEXT,            -- used to fetch leadgen field data via Graph API
    page_id TEXT,
    default_assignee UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    default_property UUID REFERENCES properties(id) ON DELETE SET NULL,
    default_lead_source UUID REFERENCES crm_lead_sources(id) ON DELETE SET NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(organization_id)
);
CREATE INDEX IF NOT EXISTS idx_crm_meta_config_org ON crm_meta_config(organization_id);
ALTER TABLE crm_meta_config ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------
-- 4. WhatsApp campaigns (broadcast + drip).  Actual send reuses the
--    existing WasenderAPI WhatsAppService; recipients are leads (raw phone),
--    so this does NOT use whatsapp_queue (which requires a users.id).
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS crm_campaigns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    created_by UUID NOT NULL REFERENCES auth.users(id),
    name TEXT NOT NULL,
    -- 'broadcast' = single message to all recipients now/at scheduled_at
    -- 'drip'      = ordered sequence of steps with day offsets
    campaign_type TEXT NOT NULL DEFAULT 'broadcast' CHECK (campaign_type IN ('broadcast','drip')),
    -- message body for broadcast; for drip the steps[] hold the bodies
    message TEXT,
    steps JSONB NOT NULL DEFAULT '[]',          -- drip: [{ day_offset, message }]
    audience_filter JSONB NOT NULL DEFAULT '{}',-- snapshot of lead filter used to build the audience
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','scheduled','running','completed','cancelled')),
    scheduled_at TIMESTAMPTZ,
    total_recipients INTEGER NOT NULL DEFAULT 0,
    sent_count INTEGER NOT NULL DEFAULT 0,
    failed_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS crm_campaign_recipients (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID NOT NULL REFERENCES crm_campaigns(id) ON DELETE CASCADE,
    lead_id UUID REFERENCES crm_leads(id) ON DELETE SET NULL,
    phone TEXT NOT NULL,
    step_index INTEGER NOT NULL DEFAULT 0,        -- which drip step this row represents
    message TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed','skipped')),
    scheduled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    sent_at TIMESTAMPTZ,
    error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_crm_campaigns_org ON crm_campaigns(organization_id);
CREATE INDEX IF NOT EXISTS idx_crm_campaign_recipients_campaign ON crm_campaign_recipients(campaign_id);
-- the dispatch worker polls this: pending rows whose scheduled_at has passed
CREATE INDEX IF NOT EXISTS idx_crm_campaign_recipients_due
    ON crm_campaign_recipients(status, scheduled_at) WHERE status = 'pending';

ALTER TABLE crm_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_campaign_recipients ENABLE ROW LEVEL SECURITY;

-- updated_at triggers (reuse the shared helper that other tables use)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'crm_meta_config_updated_at') THEN
        CREATE TRIGGER crm_meta_config_updated_at BEFORE UPDATE ON crm_meta_config
        FOR EACH ROW EXECUTE FUNCTION update_updated_at();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'crm_campaigns_updated_at') THEN
        CREATE TRIGGER crm_campaigns_updated_at BEFORE UPDATE ON crm_campaigns
        FOR EACH ROW EXECUTE FUNCTION update_updated_at();
    END IF;
END $$;

-- ---------------------------------------------------------------------
-- 5. Hardened auto-activity trigger
--    * never crashes when auth.uid() is NULL (webhook / service-role / cron)
--    * maintains closed_at from the status' is_won flag
--    * remains the SINGLE source of created/status_changed/assigned activity
--      (API routes no longer insert these manually -> no duplicates)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION crm_auto_activity()
RETURNS TRIGGER AS $$
DECLARE
    actor UUID;
BEGIN
    IF TG_OP = 'INSERT' THEN
        INSERT INTO crm_activity_log (lead_id, user_id, activity_type, description)
        VALUES (NEW.id, NEW.created_by, 'created',
            'Lead created: ' || COALESCE(NEW.company_name, NEW.contact_person, 'Unknown'));
        RETURN NEW;
    ELSIF TG_OP = 'UPDATE' THEN
        -- Fall back to created_by / assigned_to when there's no JWT context.
        actor := COALESCE(auth.uid(), NEW.created_by, NEW.assigned_to);

        IF OLD.status IS DISTINCT FROM NEW.status THEN
            INSERT INTO crm_activity_log (lead_id, user_id, activity_type, description, metadata)
            VALUES (NEW.id, actor, 'status_changed',
                'Status changed from ' || COALESCE((SELECT name FROM crm_lead_statuses WHERE id = OLD.status), 'Unknown') ||
                ' to ' || COALESCE((SELECT name FROM crm_lead_statuses WHERE id = NEW.status), 'Unknown'),
                jsonb_build_object('old_status', OLD.status, 'new_status', NEW.status));

            -- Maintain closed_at based on whether the NEW status is a "won" status.
            IF EXISTS (SELECT 1 FROM crm_lead_statuses WHERE id = NEW.status AND is_won) THEN
                NEW.closed_at := COALESCE(NEW.closed_at, NOW());
            ELSE
                NEW.closed_at := NULL;
            END IF;
        END IF;

        IF OLD.assigned_to IS DISTINCT FROM NEW.assigned_to THEN
            INSERT INTO crm_activity_log (lead_id, user_id, activity_type, description, metadata)
            VALUES (NEW.id, actor, 'assigned',
                'Lead assignment changed',
                jsonb_build_object('old_assigned', OLD.assigned_to, 'new_assigned', NEW.assigned_to));
        END IF;
        RETURN NEW;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- closed_at maintenance needs to run BEFORE the row is written, but the original
-- trigger is AFTER. Split: keep AFTER trigger for activity, add BEFORE trigger for closed_at.
DROP TRIGGER IF EXISTS crm_leads_auto_activity ON crm_leads;
CREATE TRIGGER crm_leads_auto_activity
    AFTER INSERT OR UPDATE ON crm_leads
    FOR EACH ROW EXECUTE FUNCTION crm_auto_activity();

CREATE OR REPLACE FUNCTION crm_maintain_closed_at()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.status IS DISTINCT FROM NEW.status THEN
        IF EXISTS (SELECT 1 FROM crm_lead_statuses WHERE id = NEW.status AND is_won) THEN
            NEW.closed_at := COALESCE(NEW.closed_at, NOW());
        ELSE
            NEW.closed_at := NULL;
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS crm_leads_closed_at ON crm_leads;
CREATE TRIGGER crm_leads_closed_at
    BEFORE UPDATE ON crm_leads
    FOR EACH ROW EXECUTE FUNCTION crm_maintain_closed_at();

-- ---------------------------------------------------------------------
-- 6. Backfill organization_id for rows created before this migration
-- ---------------------------------------------------------------------
UPDATE crm_leads l
SET organization_id = p.organization_id
FROM properties p
WHERE l.property_interest = p.id
  AND l.organization_id IS NULL;

-- Events inherit org from their lead where possible.
UPDATE crm_events e
SET organization_id = l.organization_id
FROM crm_leads l
WHERE e.lead_id = l.id
  AND e.organization_id IS NULL;

-- Seed closed_at for already-won leads (approx: use updated_at).
UPDATE crm_leads l
SET closed_at = l.updated_at
FROM crm_lead_statuses s
WHERE l.status = s.id AND s.is_won AND l.closed_at IS NULL;

-- ---------------------------------------------------------------------
-- 7. Re-point user FKs from auth.users -> public.users
--    The rest of this application references public.users(id), which is what
--    lets PostgREST resolve `users` embeds (creator:, assigned_user:,
--    user_info:). The original CRM tables referenced auth.users(id), so those
--    embeds would not resolve. public.users.id mirrors auth.users.id, so this
--    is a safe re-point. Constraint names are preserved (the route SELECTs
--    reference e.g. crm_leads_assigned_to_fkey by name).
-- ---------------------------------------------------------------------
DO $$
BEGIN
    -- crm_leads.created_by / assigned_to
    ALTER TABLE crm_leads DROP CONSTRAINT IF EXISTS crm_leads_created_by_fkey;
    ALTER TABLE crm_leads ADD CONSTRAINT crm_leads_created_by_fkey
        FOREIGN KEY (created_by) REFERENCES users(id) NOT VALID;
    ALTER TABLE crm_leads DROP CONSTRAINT IF EXISTS crm_leads_assigned_to_fkey;
    ALTER TABLE crm_leads ADD CONSTRAINT crm_leads_assigned_to_fkey
        FOREIGN KEY (assigned_to) REFERENCES users(id) NOT VALID;

    -- crm_activity_log.user_id
    ALTER TABLE crm_activity_log DROP CONSTRAINT IF EXISTS crm_activity_log_user_id_fkey;
    ALTER TABLE crm_activity_log ADD CONSTRAINT crm_activity_log_user_id_fkey
        FOREIGN KEY (user_id) REFERENCES users(id) NOT VALID;

    -- crm_notes.user_id
    ALTER TABLE crm_notes DROP CONSTRAINT IF EXISTS crm_notes_user_id_fkey;
    ALTER TABLE crm_notes ADD CONSTRAINT crm_notes_user_id_fkey
        FOREIGN KEY (user_id) REFERENCES users(id) NOT VALID;

    -- crm_events.user_id
    ALTER TABLE crm_events DROP CONSTRAINT IF EXISTS crm_events_user_id_fkey;
    ALTER TABLE crm_events ADD CONSTRAINT crm_events_user_id_fkey
        FOREIGN KEY (user_id) REFERENCES users(id) NOT VALID;

    -- crm_targets.user_id
    ALTER TABLE crm_targets DROP CONSTRAINT IF EXISTS crm_targets_user_id_fkey;
    ALTER TABLE crm_targets ADD CONSTRAINT crm_targets_user_id_fkey
        FOREIGN KEY (user_id) REFERENCES users(id) NOT VALID;

    -- crm_territories.user_id (keep cascade)
    ALTER TABLE crm_territories DROP CONSTRAINT IF EXISTS crm_territories_user_id_fkey;
    ALTER TABLE crm_territories ADD CONSTRAINT crm_territories_user_id_fkey
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE NOT VALID;
END $$;
