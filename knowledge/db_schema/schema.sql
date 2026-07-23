-- ===========================================
-- CRM Module Database Tables
-- Run this migration once to create all CRM tables
-- ===========================================

-- Clean up existing CRM objects first (if re-running)
-- IMPORTANT: Drop tables BEFORE functions. The RLS policies on these tables
-- depend on is_bd_admin()/is_bd_user()/is_super_admin(), so the functions can
-- only be dropped once the tables (and their policies) are gone.

-- 1. Drop tables (CASCADE removes their RLS policies, triggers, and FKs)
DROP TABLE IF EXISTS crm_meta_leads CASCADE;
DROP TABLE IF EXISTS crm_targets CASCADE;
DROP TABLE IF EXISTS crm_notes CASCADE;
DROP TABLE IF EXISTS crm_events CASCADE;
DROP TABLE IF EXISTS crm_activity_log CASCADE;
DROP TABLE IF EXISTS crm_leads CASCADE;
DROP TABLE IF EXISTS crm_territories CASCADE;
DROP TABLE IF EXISTS crm_property_mapping CASCADE;
DROP TABLE IF EXISTS crm_lead_sources CASCADE;
DROP TABLE IF EXISTS crm_lead_statuses CASCADE;

-- 2. Now drop functions (no policies depend on them anymore).
--    CASCADE is a safety net in case any stray dependent object remains.
DROP FUNCTION IF EXISTS crm_auto_activity() CASCADE;
DROP FUNCTION IF EXISTS is_bd_user() CASCADE;
DROP FUNCTION IF EXISTS is_bd_admin() CASCADE;
DROP FUNCTION IF EXISTS is_super_admin() CASCADE;
-- Note: Not dropping update_updated_at() as it's used by other tables

-- ===========================================
-- Lead Status Pipeline (Configurable)
-- ===========================================
CREATE TABLE crm_lead_statuses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL UNIQUE,
    color TEXT NOT NULL DEFAULT '#6B7280',
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Insert default statuses
INSERT INTO crm_lead_statuses (name, color, sort_order) VALUES
    ('New Lead', '#3B82F6', 1),
    ('Contacted', '#EAB308', 2),
    ('Meeting Scheduled', '#F97316', 3),
    ('Site Visit Scheduled', '#F97316', 4),
    ('Proposal Shared', '#A855F7', 5),
    ('Negotiation', '#14B8A6', 6),
    ('Won', '#22C55E', 7),
    ('Lost', '#EF4444', 8),
    ('Dropped', '#6B7280', 9),
    ('On Hold', '#374151', 10);

-- ===========================================
-- Lead Sources
-- ===========================================
CREATE TABLE crm_lead_sources (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL UNIQUE,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO crm_lead_sources (name) VALUES
    ('Website'),
    ('Referral'),
    ('Meta Lead Ads'),
    ('Google Ads'),
    ('Walk-in'),
    ('Exhibition'),
    ('Partner'),
    ('Cold Call'),
    ('Email Campaign'),
    ('Other');

-- ===========================================
-- CRM Properties Mapping
-- ===========================================
CREATE TABLE crm_property_mapping (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
    crm_property_name TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(property_id)
);

-- ===========================================
-- Territories
-- ===========================================
CREATE TABLE crm_territories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    city TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, city)
);

-- ===========================================
-- CRM Leads
-- ===========================================
CREATE TABLE crm_leads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by UUID NOT NULL REFERENCES auth.users(id),
    assigned_to UUID REFERENCES auth.users(id),
    company_name TEXT,
    contact_person TEXT,
    contact_number TEXT,
    email TEXT,
    location TEXT,
    requirement TEXT,
    property_interest UUID REFERENCES properties(id),
    lead_source UUID REFERENCES crm_lead_sources(id),
    deal_value DECIMAL(15, 2) DEFAULT 0,
    status UUID NOT NULL REFERENCES crm_lead_statuses(id),
    priority TEXT CHECK (priority IN ('Low', 'Medium', 'High', 'Urgent')) DEFAULT 'Medium',
    next_followup_date TIMESTAMPTZ,
    last_contacted TIMESTAMPTZ,
    remarks TEXT,
    meta_lead_id TEXT,
    meta_campaign_id TEXT,
    meta_adset_id TEXT,
    meta_ad_id TEXT,
    meta_form_name TEXT,
    is_archived BOOLEAN NOT NULL DEFAULT false,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ===========================================
-- Activity Log
-- ===========================================
CREATE TABLE crm_activity_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lead_id UUID NOT NULL REFERENCES crm_leads(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id),
    activity_type TEXT NOT NULL CHECK (activity_type IN (
        'created', 'updated', 'call', 'meeting', 'site_visit',
        'proposal_sent', 'followup_scheduled', 'status_changed',
        'assigned', 'note_added', 'email_sent', 'archived', 'restored'
    )),
    description TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ===========================================
-- Events (Calls, Meetings, Site Visits, Follow-ups)
-- ===========================================
CREATE TABLE crm_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lead_id UUID REFERENCES crm_leads(id) ON DELETE SET NULL,
    user_id UUID NOT NULL REFERENCES auth.users(id),
    title TEXT NOT NULL,
    description TEXT,
    start_datetime TIMESTAMPTZ NOT NULL,
    end_datetime TIMESTAMPTZ,
    event_type TEXT NOT NULL CHECK (event_type IN ('call', 'meeting', 'site_visit', 'followup')),
    status TEXT CHECK (status IN ('scheduled', 'completed', 'cancelled', 'rescheduled')) DEFAULT 'scheduled',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ===========================================
-- Notes
-- ===========================================
CREATE TABLE crm_notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lead_id UUID NOT NULL REFERENCES crm_leads(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id),
    note TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ===========================================
-- Targets
-- ===========================================
CREATE TABLE crm_targets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id),
    month INTEGER NOT NULL CHECK (month >= 1 AND month <= 12),
    year INTEGER NOT NULL,
    target_value DECIMAL(15, 2) NOT NULL DEFAULT 0,
    target_leads INTEGER NOT NULL DEFAULT 0,
    target_closures INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, month, year)
);

-- ===========================================
-- Meta Leads (Webhook tracking)
-- ===========================================
CREATE TABLE crm_meta_leads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    meta_lead_id TEXT NOT NULL UNIQUE,
    payload JSONB NOT NULL DEFAULT '{}',
    campaign_id TEXT,
    campaign_name TEXT,
    adset_id TEXT,
    adset_name TEXT,
    ad_id TEXT,
    ad_name TEXT,
    form_id TEXT,
    form_name TEXT,
    status TEXT CHECK (status IN ('pending', 'processed', 'failed', 'duplicate')) DEFAULT 'pending',
    processed_lead_id UUID REFERENCES crm_leads(id),
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    processed_at TIMESTAMPTZ
);

-- ===========================================
-- Indexes
-- ===========================================
CREATE INDEX idx_crm_leads_assigned_to ON crm_leads(assigned_to);
CREATE INDEX idx_crm_leads_status ON crm_leads(status);
CREATE INDEX idx_crm_leads_created_by ON crm_leads(created_by);
CREATE INDEX idx_crm_leads_property ON crm_leads(property_interest);
CREATE INDEX idx_crm_leads_archived ON crm_leads(is_archived);
CREATE INDEX idx_crm_leads_next_followup ON crm_leads(next_followup_date) WHERE next_followup_date IS NOT NULL;

CREATE INDEX idx_crm_activity_lead ON crm_activity_log(lead_id);
CREATE INDEX idx_crm_activity_user ON crm_activity_log(user_id);
CREATE INDEX idx_crm_activity_created ON crm_activity_log(created_at DESC);

CREATE INDEX idx_crm_events_user ON crm_events(user_id);
CREATE INDEX idx_crm_events_lead ON crm_events(lead_id);
CREATE INDEX idx_crm_events_start ON crm_events(start_datetime);
CREATE INDEX idx_crm_events_type ON crm_events(event_type);

CREATE INDEX idx_crm_notes_lead ON crm_notes(lead_id);
CREATE INDEX idx_crm_territories_user ON crm_territories(user_id);
CREATE INDEX idx_crm_meta_leads_meta_id ON crm_meta_leads(meta_lead_id);
CREATE INDEX idx_crm_meta_leads_status ON crm_meta_leads(status);

-- ===========================================
-- Row Level Security
-- ===========================================
ALTER TABLE crm_leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_activity_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_territories ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_lead_statuses ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_lead_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_property_mapping ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_meta_leads ENABLE ROW LEVEL SECURITY;

-- ===========================================
-- Helper Functions
-- ===========================================

-- Check if user is Super Admin
CREATE OR REPLACE FUNCTION is_super_admin()
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM users u
        WHERE u.id = auth.uid()
        AND u.is_master_admin = true
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Check if user is BD Admin (checks both memberships)
CREATE OR REPLACE FUNCTION is_bd_admin()
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM property_memberships pm
        WHERE pm.user_id = auth.uid()
        AND pm.role IN ('bd_admin', 'org_super_admin')
        AND pm.is_active = true
    )
    OR EXISTS (
        SELECT 1 FROM organization_memberships om
        WHERE om.user_id = auth.uid()
        AND om.role IN ('bd_admin', 'org_super_admin')
        AND om.is_active = true
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Check if user is any CRM role
CREATE OR REPLACE FUNCTION is_bd_user()
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM property_memberships pm
        WHERE pm.user_id = auth.uid()
        AND pm.role IN ('bd_rep', 'bd_admin', 'org_super_admin')
        AND pm.is_active = true
    )
    OR EXISTS (
        SELECT 1 FROM organization_memberships om
        WHERE om.user_id = auth.uid()
        AND om.role IN ('bd_rep', 'bd_admin', 'org_super_admin')
        AND om.is_active = true
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ===========================================
-- RLS Policies
-- ===========================================

-- CRM Leads
CREATE POLICY "CRM users can view leads" ON crm_leads
    FOR SELECT USING (is_bd_user() OR is_super_admin() OR created_by = auth.uid() OR assigned_to = auth.uid());

CREATE POLICY "CRM users can create leads" ON crm_leads
    FOR INSERT WITH CHECK (is_bd_user() OR is_super_admin() OR created_by = auth.uid());

CREATE POLICY "CRM users can update leads" ON crm_leads
    FOR UPDATE USING (is_bd_user() OR is_super_admin() OR created_by = auth.uid() OR assigned_to = auth.uid());

CREATE POLICY "Admins can delete leads" ON crm_leads
    FOR DELETE USING (is_bd_admin() OR is_super_admin());

-- Activity Log
CREATE POLICY "CRM users can view activity" ON crm_activity_log
    FOR SELECT USING (is_bd_user() OR is_super_admin() OR user_id = auth.uid());

CREATE POLICY "CRM users can create activity" ON crm_activity_log
    FOR INSERT WITH CHECK (user_id = auth.uid() OR is_bd_user());

-- Events
CREATE POLICY "CRM users can view events" ON crm_events
    FOR SELECT USING (is_bd_user() OR is_super_admin() OR user_id = auth.uid());

CREATE POLICY "CRM users can create events" ON crm_events
    FOR INSERT WITH CHECK (user_id = auth.uid() OR is_bd_user());

CREATE POLICY "CRM users can update events" ON crm_events
    FOR UPDATE USING (user_id = auth.uid() OR is_bd_user() OR is_super_admin());

CREATE POLICY "CRM users can delete events" ON crm_events
    FOR DELETE USING (user_id = auth.uid() OR is_bd_admin() OR is_super_admin());

-- Notes
CREATE POLICY "CRM users can view notes" ON crm_notes
    FOR SELECT USING (is_bd_user() OR is_super_admin() OR user_id = auth.uid());

CREATE POLICY "CRM users can create notes" ON crm_notes
    FOR INSERT WITH CHECK (user_id = auth.uid() OR is_bd_user());

CREATE POLICY "Users can update own notes" ON crm_notes
    FOR UPDATE USING (user_id = auth.uid() OR is_bd_user());

CREATE POLICY "Users can delete own notes" ON crm_notes
    FOR DELETE USING (user_id = auth.uid() OR is_bd_admin());

-- Targets
CREATE POLICY "CRM users can view targets" ON crm_targets
    FOR SELECT USING (user_id = auth.uid() OR is_bd_user() OR is_super_admin());

CREATE POLICY "Admins can manage targets" ON crm_targets
    FOR ALL USING (is_bd_admin() OR is_super_admin());

-- Territories
CREATE POLICY "CRM users can view territories" ON crm_territories
    FOR SELECT USING (user_id = auth.uid() OR is_bd_user() OR is_super_admin());

CREATE POLICY "CRM users can manage territories" ON crm_territories
    FOR ALL USING (user_id = auth.uid() OR is_bd_user() OR is_super_admin());

-- Config Tables
CREATE POLICY "All can view statuses" ON crm_lead_statuses FOR SELECT USING (true);
CREATE POLICY "Admins can manage statuses" ON crm_lead_statuses FOR ALL USING (is_bd_admin() OR is_super_admin());

CREATE POLICY "All can view sources" ON crm_lead_sources FOR SELECT USING (true);
CREATE POLICY "Admins can manage sources" ON crm_lead_sources FOR ALL USING (is_bd_admin() OR is_super_admin());

CREATE POLICY "All can view property mapping" ON crm_property_mapping FOR SELECT USING (true);
CREATE POLICY "Admins can manage property mapping" ON crm_property_mapping FOR ALL USING (is_bd_admin() OR is_super_admin());

-- Meta Leads
CREATE POLICY "Service role can manage meta leads" ON crm_meta_leads
    FOR ALL USING (is_super_admin());

-- ===========================================
-- Triggers
-- ===========================================

-- Auto-create activity on lead changes
CREATE OR REPLACE FUNCTION crm_auto_activity()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        INSERT INTO crm_activity_log (lead_id, user_id, activity_type, description)
        VALUES (NEW.id, NEW.created_by, 'created',
            'Lead created: ' || COALESCE(NEW.company_name, NEW.contact_person, 'Unknown'));
        RETURN NEW;
    ELSIF TG_OP = 'UPDATE' THEN
        IF OLD.status IS DISTINCT FROM NEW.status THEN
            INSERT INTO crm_activity_log (lead_id, user_id, activity_type, description, metadata)
            VALUES (NEW.id, auth.uid(), 'status_changed',
                'Status changed from ' || COALESCE((SELECT name FROM crm_lead_statuses WHERE id = OLD.status), 'Unknown') ||
                ' to ' || COALESCE((SELECT name FROM crm_lead_statuses WHERE id = NEW.status), 'Unknown'),
                jsonb_build_object('old_status', OLD.status, 'new_status', NEW.status));
        END IF;

        IF OLD.assigned_to IS DISTINCT FROM NEW.assigned_to THEN
            INSERT INTO crm_activity_log (lead_id, user_id, activity_type, description, metadata)
            VALUES (NEW.id, auth.uid(), 'assigned',
                'Lead assigned to ' || COALESCE(NEW.assigned_to::text, 'unassigned'),
                jsonb_build_object('old_assigned', OLD.assigned_to, 'new_assigned', NEW.assigned_to));
        END IF;
        RETURN NEW;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER crm_leads_auto_activity
    AFTER INSERT OR UPDATE ON crm_leads
    FOR EACH ROW EXECUTE FUNCTION crm_auto_activity();

-- CRM-specific updated_at triggers (conditional)
DO $trigger_block$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'crm_leads_updated_at') THEN
        CREATE TRIGGER crm_leads_updated_at BEFORE UPDATE ON crm_leads
        FOR EACH ROW EXECUTE FUNCTION update_updated_at();
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'crm_events_updated_at') THEN
        CREATE TRIGGER crm_events_updated_at BEFORE UPDATE ON crm_events
        FOR EACH ROW EXECUTE FUNCTION update_updated_at();
    END IF;
END;
$trigger_block$;
-- ===========================================
-- CRM Roles Migration
-- Adds bd_rep and bd_admin roles
-- ===========================================

-- IMPORTANT: membership roles are stored as the `app_role` ENUM
-- (property_memberships.role / organization_memberships.role), NOT plain text.
-- The new BD roles must be added as enum values or inserts will fail with
-- "invalid input value for enum app_role". ADD VALUE IF NOT EXISTS is idempotent.
ALTER TYPE app_role ADD VALUE IF NOT EXISTS 'bd_rep';
ALTER TYPE app_role ADD VALUE IF NOT EXISTS 'bd_admin';

-- ===========================================
-- Role Definitions:
--
-- bd_rep (BD Representative)
-- - Standard CRM user
-- - Can view assigned leads, create leads, edit own leads
-- - Can update lead stages, add notes, meetings, calls, follow-ups
-- - Can view personal dashboard
--
-- bd_admin (BD Admin)
-- - Everything in bd_rep plus:
-- - View all leads
-- - Reassign leads
-- - Configure territories, dashboard tiles, lead stages, status colors
-- - View team performance, property-wise performance
-- - Configure integrations
-- ===========================================

-- Create a roles reference table (optional - for documentation/admin UI)
CREATE TABLE IF NOT EXISTS crm_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    role_key TEXT NOT NULL UNIQUE,
    role_name TEXT NOT NULL,
    description TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Insert CRM roles
INSERT INTO crm_roles (role_key, role_name, description) VALUES
    ('bd_rep', 'BD Representative', 'Standard CRM user with access to assigned leads'),
    ('bd_admin', 'BD Admin', 'CRM administrator with full access to all leads and settings')
ON CONFLICT (role_key) DO NOTHING;
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
-- =====================================================================
-- CRM: campaign-level territories
--
-- The brief scopes BD reps to a CAMPAIGN (Lower Parel, Andheri, Bangalore,
-- F1 Skymark…), but Lower Parel and Andheri are BOTH Mumbai — so a city-only
-- territory can't separate them. This makes crm_territories able to grant
-- EITHER a whole city (campaign NULL) OR a single campaign (campaign set).
-- Idempotent & additive.
-- =====================================================================

ALTER TABLE crm_territories ALTER COLUMN city DROP NOT NULL;
ALTER TABLE crm_territories ADD COLUMN IF NOT EXISTS campaign TEXT;

-- Old unique was UNIQUE(user_id, city); a campaign-scoped row may have NULL city,
-- so replace it with a coalesced composite unique that tolerates either grant type.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'crm_territories_user_id_city_key') THEN
        ALTER TABLE crm_territories DROP CONSTRAINT crm_territories_user_id_city_key;
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_crm_territories_user_scope
    ON crm_territories (user_id, COALESCE(city, ''), COALESCE(campaign, ''));

CREATE INDEX IF NOT EXISTS idx_crm_territories_campaign ON crm_territories(lower(campaign));
-- ===========================================
-- CRM Lead Status: add icon column
-- Lets each lifecycle stage carry a named icon key (rendered by
-- frontend/lib/crm/stages.ts). Schema-only, additive, safe to re-run.
-- ===========================================

ALTER TABLE crm_lead_statuses ADD COLUMN IF NOT EXISTS icon TEXT;
-- Track which onboarding tours each user has completed
CREATE TABLE IF NOT EXISTS crm_tour_completions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    tour_id TEXT NOT NULL,
    completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, tour_id)
);

ALTER TABLE crm_tour_completions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own tour completions"
    ON crm_tour_completions FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own tour completions"
    ON crm_tour_completions FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own tour completions"
    ON crm_tour_completions FOR DELETE
    USING (auth.uid() = user_id);
-- Lead distribution rules: assign campaigns to reps (exclusive or round-robin).
CREATE TABLE crm_lead_distribution_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    campaign TEXT NOT NULL,
    mode TEXT NOT NULL DEFAULT 'round_robin' CHECK (mode IN ('exclusive', 'round_robin')),
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(organization_id, campaign)
);

-- Which reps participate in a distribution rule.
CREATE TABLE crm_lead_distribution_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rule_id UUID NOT NULL REFERENCES crm_lead_distribution_rules(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    is_active BOOLEAN NOT NULL DEFAULT true,
    last_assigned_at TIMESTAMPTZ,
    assigned_count INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(rule_id, user_id)
);

CREATE INDEX idx_crm_dist_rules_org ON crm_lead_distribution_rules(organization_id);
CREATE INDEX idx_crm_dist_members_rule ON crm_lead_distribution_members(rule_id);
CREATE INDEX idx_crm_dist_members_user ON crm_lead_distribution_members(user_id);
-- Rename "Warm" status to "MQL" across all organizations.
UPDATE crm_lead_statuses SET name = 'MQL' WHERE lower(name) = 'warm';
-- Migration: AI Call Coach — recordings + coaching reports
-- Description: crm_calls table for uploaded MP3s + AI-generated 5-layer coaching
--              reports, plus a private Supabase Storage bucket for the audio.

-- ============================================================================
-- 1. crm_calls table
-- ============================================================================
create table if not exists public.crm_calls (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,
    lead_id uuid not null references public.crm_leads(id) on delete cascade,
    bd_rep_id uuid not null references public.users(id),

    -- Lifecycle
    status text not null default 'uploaded'
        check (status in ('uploaded','transcribing','scoring','completed','failed')),
    error_message text,

    -- Audio
    recording_url text,                     -- Supabase Storage path inside crm-call-recordings
    duration_seconds integer,
    file_size_bytes bigint,
    mime_type text,

    -- Transcript (array of {speaker, start, end, text} segments)
    transcript jsonb,
    summary text,

    -- Coaching report (the 5-layer score card from Groq)
    coaching jsonb,

    -- Rollups for fast list views
    overall_score numeric(4,2),
    rep_talk_ratio numeric(4,2),
    duration_seconds_cached integer,

    -- Context snapshot (so analytics survive lead archival / edits)
    lead_company_name_snapshot text,
    lead_contact_person_snapshot text,

    -- Soft-delete
    is_archived boolean not null default false,

    uploaded_at timestamptz not null default now(),
    analyzed_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists crm_calls_lead_idx        on public.crm_calls (lead_id, uploaded_at desc);
create index if not exists crm_calls_rep_idx         on public.crm_calls (bd_rep_id, uploaded_at desc);
create index if not exists crm_calls_org_idx         on public.crm_calls (organization_id, uploaded_at desc);
create index if not exists crm_calls_status_idx      on public.crm_calls (organization_id, status);
create index if not exists crm_calls_overall_idx     on public.crm_calls (organization_id, overall_score desc);

-- updated_at trigger (matches the rest of the CRM)
create or replace function public.crm_calls_touch_updated_at()
returns trigger language plpgsql as $$
begin
    new.updated_at = now();
    return new;
end $$;

drop trigger if exists trg_crm_calls_touch on public.crm_calls;
create trigger trg_crm_calls_touch
    before update on public.crm_calls
    for each row execute function public.crm_calls_touch_updated_at();

-- ============================================================================
-- 2. RLS — mirror the rest of the CRM posture. We keep API-layer enforcement
--    (supabaseAdmin + resolveCrmAccess) as the source of truth, but enable RLS
--    defensively so direct PostgREST reads don't leak across orgs.
-- ============================================================================
alter table public.crm_calls enable row level security;

-- Members of the org can see calls in their org
drop policy if exists crm_calls_select_org on public.crm_calls;
create policy crm_calls_select_org on public.crm_calls
    for select to authenticated
    using (organization_id in (
        select organization_id from public.organization_memberships
        where user_id = auth.uid() and is_active = true
        union
        select organization_id from public.property_memberships
        where user_id = auth.uid() and is_active = true
    ));

-- Reps can insert their own calls; admins can insert anyone's
drop policy if exists crm_calls_insert_self on public.crm_calls;
create policy crm_calls_insert_self on public.crm_calls
    for insert to authenticated
    with check (
        bd_rep_id = auth.uid()
        or exists (
            select 1 from public.organization_memberships
            where user_id = auth.uid() and is_active = true
              and role in ('bd_admin','org_admin','org_super_admin')
              and organization_id = crm_calls.organization_id
        )
    );

-- Reps can update their own calls (for status flips during analysis)
drop policy if exists crm_calls_update_self on public.crm_calls;
create policy crm_calls_update_self on public.crm_calls
    for update to authenticated
    using (bd_rep_id = auth.uid() or exists (
        select 1 from public.organization_memberships
        where user_id = auth.uid() and is_active = true
          and role in ('bd_admin','org_admin','org_super_admin')
          and organization_id = crm_calls.organization_id
    ));

-- ============================================================================
-- 3. Storage bucket — private, 50MB limit (matches sop-videos)
-- ============================================================================
insert into storage.buckets (id, name, public, file_size_limit)
values ('crm-call-recordings', 'crm-call-recordings', false, 52428800)
on conflict (id) do nothing;

-- Authenticated users can upload into the bucket (path is namespaced by org/lead)
drop policy if exists "crm_call_recordings_insert" on storage.objects;
create policy "crm_call_recordings_insert" on storage.objects
    for insert to authenticated
    with check (bucket_id = 'crm-call-recordings');

-- Owners can read their own uploads; admins (via signed URLs from the server)
-- can read any. For now, keep it owner-only — the API layer hands out signed URLs.
drop policy if exists "crm_call_recordings_select_owner" on storage.objects;
create policy "crm_call_recordings_select_owner" on storage.objects
    for select to authenticated
    using (bucket_id = 'crm-call-recordings' and owner = auth.uid());

drop policy if exists "crm_call_recordings_delete_owner" on storage.objects;
create policy "crm_call_recordings_delete_owner" on storage.objects
    for delete to authenticated
    using (bucket_id = 'crm-call-recordings' and owner = auth.uid());
-- Migration: CRM Reports — spend tracking + lost-reason analytics
-- Description:
--   1. Add spend-related columns to crm_campaigns (channel, budget, period, dates).
--   2. New table crm_campaign_spend — granular daily spend log per campaign.
--   3. Add lost_reason / lost_reason_notes to crm_leads for funnel analytics.

-- ============================================================================
-- 1. crm_campaigns — spend metadata
-- ============================================================================
alter table public.crm_campaigns
    add column if not exists channel text
        check (channel in ('meta_ads','google_ads','whatsapp','email','referral','organic','manual','other')),
    add column if not exists budget_total numeric(14,2) default 0 check (budget_total >= 0),
    add column if not exists budget_period text default 'monthly'
        check (budget_period in ('monthly','quarterly','one_time')),
    add column if not exists start_date date,
    add column if not exists end_date date;

create index if not exists crm_campaigns_channel_idx
    on public.crm_campaigns (organization_id, channel);

-- ============================================================================
-- 2. crm_campaign_spend — granular spend log
-- ============================================================================
create table if not exists public.crm_campaign_spend (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,
    campaign_id uuid not null references public.crm_campaigns(id) on delete cascade,
    spend_date date not null,
    amount numeric(14,2) not null check (amount >= 0),
    source text not null default 'manual'
        check (source in ('manual','meta_api','google_api','import')),
    notes text,
    created_by uuid references public.users(id),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists crm_campaign_spend_campaign_idx
    on public.crm_campaign_spend (campaign_id, spend_date desc);
create index if not exists crm_campaign_spend_org_idx
    on public.crm_campaign_spend (organization_id, spend_date desc);
create index if not exists crm_campaign_spend_date_idx
    on public.crm_campaign_spend (organization_id, spend_date);

create or replace function public.crm_campaign_spend_touch_updated_at()
returns trigger language plpgsql as $$
begin
    new.updated_at = now();
    return new;
end $$;

drop trigger if exists trg_crm_campaign_spend_touch on public.crm_campaign_spend;
create trigger trg_crm_campaign_spend_touch
    before update on public.crm_campaign_spend
    for each row execute function public.crm_campaign_spend_touch_updated_at();

alter table public.crm_campaign_spend enable row level security;

-- Org members can read; admins can write
drop policy if exists crm_campaign_spend_select_org on public.crm_campaign_spend;
create policy crm_campaign_spend_select_org on public.crm_campaign_spend
    for select to authenticated
    using (organization_id in (
        select organization_id from public.organization_memberships
        where user_id = auth.uid() and is_active = true
        union
        select organization_id from public.property_memberships
        where user_id = auth.uid() and is_active = true
    ));

drop policy if exists crm_campaign_spend_admin_write on public.crm_campaign_spend;
create policy crm_campaign_spend_admin_write on public.crm_campaign_spend
    for all to authenticated
    using (exists (
        select 1 from public.organization_memberships
        where user_id = auth.uid() and is_active = true
          and role in ('bd_admin','org_admin','org_super_admin')
          and organization_id = crm_campaign_spend.organization_id
    ))
    with check (exists (
        select 1 from public.organization_memberships
        where user_id = auth.uid() and is_active = true
          and role in ('bd_admin','org_admin','org_super_admin')
          and organization_id = crm_campaign_spend.organization_id
    ));

-- ============================================================================
-- 3. crm_leads — lost-reason analytics
-- ============================================================================
alter table public.crm_leads
    add column if not exists lost_reason text,
    add column if not exists lost_reason_notes text;

create index if not exists crm_leads_lost_reason_idx
    on public.crm_leads (organization_id, lost_reason)
    where lost_reason is not null;
-- Migration: Add missing values to app_role enum
-- Description: The OrgAdminDashboard role dropdown includes 'org_admin'
--              (org-level admin) and 'security' (property-level security) but
--              neither was ever added to the app_role enum. Any save that
--              writes those values fails with 22P02.
--
--              57+ files reference 'org_admin' across CRM access checks, RLS
--              policies, and admin UI. Adding it is required for the
--              OrgAdminDashboard role editor to work.
--
-- Idempotent: ADD VALUE IF NOT EXISTS prevents re-runs from erroring.

ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'org_admin';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'security';
-- Migration: Meta Ads — Marketing API sync support
-- Adds:
--   * Marketing API credentials to crm_meta_config (ad account, long-lived user
--     token, app id, token expiry, last-sync telemetry)
--   * meta_campaign_id on crm_campaigns (joins local campaigns to Meta insights)
--   * crm_campaign_metrics — daily impressions / clicks / CTR / CPC / CPM /
--     reach / frequency pulled from Meta. Kept separate from spend so we can
--     upsert spend without touching metrics and vice-versa.
--
-- Manual spend entries always take precedence over Meta-API spend for the
-- same (campaign, date). The sync service enforces this in application code
-- (see backend/services/metaInsightsSync.ts).

-- ============================================================================
-- 1. crm_meta_config — Marketing API fields
-- ============================================================================
alter table public.crm_meta_config
    add column if not exists meta_ad_account_id text,
    add column if not exists meta_user_access_token text,
    add column if not exists meta_app_id text,
    add column if not exists meta_token_expires_at timestamptz,
    add column if not exists last_sync_at timestamptz,
    add column if not exists last_sync_status text
        check (last_sync_status in ('ok', 'failed', 'auth_error', 'partial'));

-- ============================================================================
-- 2. crm_campaigns — meta_campaign_id (FK target from insights)
-- ============================================================================
alter table public.crm_campaigns
    add column if not exists meta_campaign_id text;

-- Per-org unique so two orgs can independently link to the same Meta campaign.
create unique index if not exists uq_crm_campaigns_meta_id
    on public.crm_campaigns (organization_id, meta_campaign_id)
    where meta_campaign_id is not null;

create index if not exists idx_crm_campaigns_meta_id
    on public.crm_campaigns (meta_campaign_id)
    where meta_campaign_id is not null;

-- ============================================================================
-- 3. crm_campaign_metrics — daily Meta performance metrics
-- ============================================================================
create table if not exists public.crm_campaign_metrics (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,
    campaign_id uuid not null references public.crm_campaigns(id) on delete cascade,
    metric_date date not null,
    impressions bigint not null default 0 check (impressions >= 0),
    clicks bigint not null default 0 check (clicks >= 0),
    reach bigint check (reach is null or reach >= 0),
    ctr numeric(8,4) check (ctr is null or (ctr >= 0 and ctr <= 100)),
    cpc numeric(14,4) check (cpc is null or cpc >= 0),
    cpm numeric(14,4) check (cpm is null or cpm >= 0),
    frequency numeric(8,3) check (frequency is null or frequency >= 0),
    source text not null default 'meta_api'
        check (source in ('meta_api', 'google_api', 'import', 'manual')),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (campaign_id, metric_date)
);

create index if not exists idx_crm_campaign_metrics_org_date
    on public.crm_campaign_metrics (organization_id, metric_date desc);

create index if not exists idx_crm_campaign_metrics_campaign_date
    on public.crm_campaign_metrics (campaign_id, metric_date desc);

-- updated_at trigger (re-uses shared helper if present)
do $$
begin
    if exists (select 1 from pg_proc where proname = 'update_updated_at')
       and not exists (select 1 from pg_trigger where tgname = 'crm_campaign_metrics_updated_at') then
        create trigger crm_campaign_metrics_updated_at
            before update on public.crm_campaign_metrics
            for each row execute function public.update_updated_at();
    end if;
end $$;

alter table public.crm_campaign_metrics enable row level security;

-- Read: org members (matches crm_campaign_spend policy shape)
drop policy if exists crm_campaign_metrics_select_org on public.crm_campaign_metrics;
create policy crm_campaign_metrics_select_org on public.crm_campaign_metrics
    for select to authenticated
    using (organization_id in (
        select organization_id from public.organization_memberships
        where user_id = auth.uid() and is_active = true
        union
        select organization_id from public.property_memberships
        where user_id = auth.uid() and is_active = true
    ));

-- Write: admins (manual entry) — sync writes via service role, bypasses RLS.
drop policy if exists crm_campaign_metrics_admin_write on public.crm_campaign_metrics;
create policy crm_campaign_metrics_admin_write on public.crm_campaign_metrics
    for all to authenticated
    using (exists (
        select 1 from public.organization_memberships
        where user_id = auth.uid() and is_active = true
          and role in ('bd_admin', 'org_admin', 'org_super_admin')
          and organization_id = crm_campaign_metrics.organization_id
    ))
    with check (exists (
        select 1 from public.organization_memberships
        where user_id = auth.uid() and is_active = true
          and role in ('bd_admin', 'org_admin', 'org_super_admin')
          and organization_id = crm_campaign_metrics.organization_id
    ));
-- ===========================================
-- CRM Stage Restructure
-- New flow: MQL → Active (Ring 1-10) → Warm → Hot → Future → Cold → Lost → Disqualified → Won
-- Remove: Visit Pending, Visit Done, Layout Shared, LOI, Close, Loss
-- Add: Active, Lost, Disqualified, Won
-- Rename: Close → Won, Loss → Lost (if they exist)
-- ===========================================

-- Rename existing terminal stages
UPDATE crm_lead_statuses SET name = 'Won', color = '#22C55E' WHERE lower(name) = 'close';
UPDATE crm_lead_statuses SET name = 'Lost', color = '#64748B' WHERE lower(name) = 'loss';

-- Remove stages that are now timeline activities (only if no leads reference them)
-- If leads reference them, just mark inactive so data is not lost
UPDATE crm_lead_statuses SET is_active = false WHERE lower(name) IN ('visit pending', 'visit done', 'layout shared', 'loi');

-- Remove old statuses that don't fit new flow (mark inactive)
UPDATE crm_lead_statuses SET is_active = false WHERE lower(name) IN ('contacted', 'meeting scheduled', 'site visit scheduled', 'proposal shared', 'negotiation', 'dropped', 'on hold', 'new lead');

-- Insert new stages if they don't exist (org-scoped statuses may vary)
-- These are global defaults (organization_id IS NULL)
INSERT INTO crm_lead_statuses (name, color, sort_order, is_terminal)
SELECT 'Active', '#3B82F6', 2, false
WHERE NOT EXISTS (SELECT 1 FROM crm_lead_statuses WHERE lower(name) = 'active' AND organization_id IS NULL);

INSERT INTO crm_lead_statuses (name, color, sort_order, is_terminal)
SELECT 'Disqualified', '#EF4444', 18, true
WHERE NOT EXISTS (SELECT 1 FROM crm_lead_statuses WHERE lower(name) = 'disqualified' AND organization_id IS NULL);

-- Ensure Won and Lost exist as terminal
INSERT INTO crm_lead_statuses (name, color, sort_order, is_terminal)
SELECT 'Won', '#22C55E', 19, true
WHERE NOT EXISTS (SELECT 1 FROM crm_lead_statuses WHERE lower(name) = 'won' AND organization_id IS NULL);

INSERT INTO crm_lead_statuses (name, color, sort_order, is_terminal)
SELECT 'Lost', '#64748B', 17, true
WHERE NOT EXISTS (SELECT 1 FROM crm_lead_statuses WHERE lower(name) = 'lost' AND organization_id IS NULL);

-- Ensure Warm exists
INSERT INTO crm_lead_statuses (name, color, sort_order)
SELECT 'Warm', '#F59E0B', 13
WHERE NOT EXISTS (SELECT 1 FROM crm_lead_statuses WHERE lower(name) = 'warm' AND organization_id IS NULL);

-- Update sort orders for the new flow
UPDATE crm_lead_statuses SET sort_order = 1  WHERE lower(name) = 'mql' AND organization_id IS NULL;
UPDATE crm_lead_statuses SET sort_order = 2  WHERE lower(name) = 'active' AND organization_id IS NULL;
UPDATE crm_lead_statuses SET sort_order = 3  WHERE lower(name) = 'ring 1' AND organization_id IS NULL;
UPDATE crm_lead_statuses SET sort_order = 4  WHERE lower(name) = 'ring 2' AND organization_id IS NULL;
UPDATE crm_lead_statuses SET sort_order = 5  WHERE lower(name) = 'ring 3' AND organization_id IS NULL;
UPDATE crm_lead_statuses SET sort_order = 6  WHERE lower(name) = 'ring 4' AND organization_id IS NULL;
UPDATE crm_lead_statuses SET sort_order = 7  WHERE lower(name) = 'ring 5' AND organization_id IS NULL;
UPDATE crm_lead_statuses SET sort_order = 8  WHERE lower(name) = 'ring 6' AND organization_id IS NULL;
UPDATE crm_lead_statuses SET sort_order = 9  WHERE lower(name) = 'ring 7' AND organization_id IS NULL;
UPDATE crm_lead_statuses SET sort_order = 10 WHERE lower(name) = 'ring 8' AND organization_id IS NULL;
UPDATE crm_lead_statuses SET sort_order = 11 WHERE lower(name) = 'ring 9' AND organization_id IS NULL;
UPDATE crm_lead_statuses SET sort_order = 12 WHERE lower(name) = 'ring 10' AND organization_id IS NULL;
UPDATE crm_lead_statuses SET sort_order = 13 WHERE lower(name) = 'warm' AND organization_id IS NULL;
UPDATE crm_lead_statuses SET sort_order = 14 WHERE lower(name) = 'hot' AND organization_id IS NULL;
UPDATE crm_lead_statuses SET sort_order = 15 WHERE lower(name) = 'future' AND organization_id IS NULL;
UPDATE crm_lead_statuses SET sort_order = 16 WHERE lower(name) = 'cold' AND organization_id IS NULL;
UPDATE crm_lead_statuses SET sort_order = 17, is_terminal = true WHERE lower(name) = 'lost' AND organization_id IS NULL;
UPDATE crm_lead_statuses SET sort_order = 18, is_terminal = true WHERE lower(name) = 'disqualified' AND organization_id IS NULL;
UPDATE crm_lead_statuses SET sort_order = 19, is_terminal = true WHERE lower(name) = 'won' AND organization_id IS NULL;

-- Set MQL as default entry stage
UPDATE crm_lead_statuses SET is_default = true WHERE lower(name) = 'mql' AND organization_id IS NULL;
UPDATE crm_lead_statuses SET is_default = false WHERE lower(name) != 'mql' AND organization_id IS NULL;
-- Insert Ring 1-10 as global statuses if they don't already exist globally.
-- Ring 1-3 may exist as org-specific rows; these global rows ensure every org
-- has the full Ring 1-10 ladder available in the stage pipeline.
DO $$
DECLARE
  n INT;
  sort INT;
BEGIN
  FOR n IN 1..10 LOOP
    sort := n + 2; -- sort_order: Ring 1 = 3, Ring 2 = 4 ... Ring 10 = 12
    INSERT INTO crm_lead_statuses (name, color, sort_order, is_terminal, is_won, is_lost)
    SELECT
      'Ring ' || n,
      '#FB923C',  -- orange
      sort,
      false,
      false,
      false
    WHERE NOT EXISTS (
      SELECT 1 FROM crm_lead_statuses
      WHERE lower(name) = lower('Ring ' || n)
      AND organization_id IS NULL
    );
  END LOOP;
END $$;

-- Also add Visit Pending, Visit Done, Layout Shared, LOI as global activity statuses
-- if they don't exist (used by the stage pipeline activity buttons)
INSERT INTO crm_lead_statuses (name, color, sort_order, is_terminal)
SELECT 'Visit Pending', '#F59E0B', 20, false
WHERE NOT EXISTS (SELECT 1 FROM crm_lead_statuses WHERE lower(name) = 'visit pending' AND organization_id IS NULL);

INSERT INTO crm_lead_statuses (name, color, sort_order, is_terminal)
SELECT 'Visit Done', '#10B981', 21, false
WHERE NOT EXISTS (SELECT 1 FROM crm_lead_statuses WHERE lower(name) = 'visit done' AND organization_id IS NULL);

INSERT INTO crm_lead_statuses (name, color, sort_order, is_terminal)
SELECT 'Layout Shared', '#8B5CF6', 22, false
WHERE NOT EXISTS (SELECT 1 FROM crm_lead_statuses WHERE lower(name) = 'layout shared' AND organization_id IS NULL);

INSERT INTO crm_lead_statuses (name, color, sort_order, is_terminal)
SELECT 'LOI', '#3B82F6', 23, false
WHERE NOT EXISTS (SELECT 1 FROM crm_lead_statuses WHERE lower(name) = 'loi' AND organization_id IS NULL);
-- Add structured seat-count + move-in capture to CRM leads
ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS seats integer;
ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS move_in_timeline text;

-- Backfill seats from the [seats=N] token embedded in requirement by the Meta sync
UPDATE crm_leads
SET seats = (substring(requirement from '\[seats=(\d+)'))::int
WHERE requirement LIKE '[seats=%' AND seats IS NULL;

-- Backfill move_in_timeline from the requirement text
UPDATE crm_leads
SET move_in_timeline = trim(substring(requirement from 'Move-in:\s*([^|]+)'))
WHERE requirement LIKE '%Move-in:%' AND move_in_timeline IS NULL;

-- Strip the machine token out of requirement now that seats is a real column
UPDATE crm_leads
SET requirement = NULLIF(trim(regexp_replace(requirement, '^\[seats=\d+;bucket=[^\]]*\]\s*', '')), '')
WHERE requirement LIKE '[seats=%';

-- Index for fast range filtering
CREATE INDEX IF NOT EXISTS idx_crm_leads_seats ON crm_leads(seats);
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
-- Allow 'linkedin_ads' as a campaign channel (Advertising API spend).
ALTER TABLE crm_campaigns DROP CONSTRAINT IF EXISTS crm_campaigns_channel_check;
ALTER TABLE crm_campaigns
    ADD CONSTRAINT crm_campaigns_channel_check
    CHECK (channel IN ('meta_ads','google_ads','linkedin_ads','whatsapp','email','referral','organic','manual','other'));
-- Enable RLS on mst_daily_scores
ALTER TABLE "public"."mst_daily_scores" ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to view scores
CREATE POLICY "Authenticated users can select mst_daily_scores"
ON "public"."mst_daily_scores"
FOR SELECT
TO authenticated
USING (true);

-- Allow authenticated users to insert scores
CREATE POLICY "Authenticated users can insert mst_daily_scores"
ON "public"."mst_daily_scores"
FOR INSERT
TO authenticated
WITH CHECK (true);

-- Allow authenticated users to update scores
CREATE POLICY "Authenticated users can update mst_daily_scores"
ON "public"."mst_daily_scores"
FOR UPDATE
TO authenticated
USING (true);

-- Allow authenticated users to delete scores
CREATE POLICY "Authenticated users can delete mst_daily_scores"
ON "public"."mst_daily_scores"
FOR DELETE
TO authenticated
USING (true);
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
-- ============================================================================
-- Lead distribution tables (were never applied) + micro-market routing rules.
-- Routes incoming Meta/LinkedIn leads to the right BD rep by city / micro-market.
-- ============================================================================

CREATE TABLE IF NOT EXISTS crm_lead_distribution_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    campaign TEXT NOT NULL,                 -- used as a keyword (e.g. 'andheri')
    mode TEXT NOT NULL DEFAULT 'round_robin' CHECK (mode IN ('exclusive', 'round_robin')),
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(organization_id, campaign)
);

CREATE TABLE IF NOT EXISTS crm_lead_distribution_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rule_id UUID NOT NULL REFERENCES crm_lead_distribution_rules(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    is_active BOOLEAN NOT NULL DEFAULT true,
    last_assigned_at TIMESTAMPTZ,
    assigned_count INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(rule_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_crm_dist_rules_org ON crm_lead_distribution_rules(organization_id);
CREATE INDEX IF NOT EXISTS idx_crm_dist_members_rule ON crm_lead_distribution_members(rule_id);
CREATE INDEX IF NOT EXISTS idx_crm_dist_members_user ON crm_lead_distribution_members(user_id);

-- Micro-market routing rules (exclusive — one rep per market).
DO $$
DECLARE
    org UUID := '211e1330-ad83-446d-941f-dcea48396798';
    rule UUID;
    pairs TEXT[][] := ARRAY[
        ['andheri',     '3e793a4c-ba0c-4d33-8b16-f8dd416dc542'],  -- Shubham (Mumbai · Andheri)
        ['lower parel', 'fd1ea5b3-95d8-4975-8347-2a2b5221ca6d'],  -- Shravani (Mumbai · LP)
        ['mafatlal',    'fd1ea5b3-95d8-4975-8347-2a2b5221ca6d'],  -- Shravani (LP form variant)
        ['bengaluru',   'ecdf62fa-e141-4de3-942c-e9c069740410'],  -- Manjunath (BLR)
        ['bangalore',   'ecdf62fa-e141-4de3-942c-e9c069740410'],  -- Manjunath (BLR)
        ['noida',       'fbe0668a-d6b8-4dc8-89c8-32b472e07d3c'],  -- Madhvi (Noida)
        ['skymark',     'fbe0668a-d6b8-4dc8-89c8-32b472e07d3c']   -- Madhvi (F1 Skymark · Noida)
    ];
    p TEXT[];
BEGIN
    FOREACH p SLICE 1 IN ARRAY pairs LOOP
        INSERT INTO crm_lead_distribution_rules (organization_id, campaign, mode, is_active)
        VALUES (org, p[1], 'exclusive', true)
        ON CONFLICT (organization_id, campaign) DO UPDATE SET is_active = true, mode = 'exclusive'
        RETURNING id INTO rule;

        INSERT INTO crm_lead_distribution_members (rule_id, user_id, is_active)
        VALUES (rule, p[2]::uuid, true)
        ON CONFLICT (rule_id, user_id) DO UPDATE SET is_active = true;
    END LOOP;
END $$;
-- Drop the unique constraint on (user_id, property_id) to allow vendors to have multiple shops per property
ALTER TABLE vendors DROP CONSTRAINT IF EXISTS vendors_user_id_property_id_key;
-- Migration: Add missing super_tenant value to app_role enum
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'super_tenant';
-- Create qr_facility_zones table
CREATE TABLE IF NOT EXISTS public.qr_facility_zones (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
    floor TEXT,
    zone_name TEXT NOT NULL,
    qr_signature TEXT NOT NULL UNIQUE,
    created_by UUID REFERENCES auth.users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- RLS for qr_facility_zones
ALTER TABLE public.qr_facility_zones ENABLE ROW LEVEL SECURITY;

-- Allow property admins/super admins to view/manage their zones
CREATE POLICY "Users can view qr_facility_zones in their properties"
ON public.qr_facility_zones FOR SELECT
USING (
    EXISTS (
        SELECT 1 FROM property_memberships
        WHERE property_memberships.property_id = qr_facility_zones.property_id
        AND property_memberships.user_id = auth.uid()
        AND property_memberships.is_active = true
    )
    OR EXISTS (
        SELECT 1 FROM properties p
        JOIN organization_memberships om ON p.organization_id = om.organization_id
        WHERE p.id = qr_facility_zones.property_id
        AND om.user_id = auth.uid()
        AND om.is_active = true
    )
);

CREATE POLICY "Property admins can manage qr_facility_zones"
ON public.qr_facility_zones FOR ALL
USING (
    EXISTS (
        SELECT 1 FROM property_memberships
        WHERE property_memberships.property_id = qr_facility_zones.property_id
        AND property_memberships.user_id = auth.uid()
        AND property_memberships.role::text IN ('PROPERTY_ADMIN', 'property_admin', 'SUPER_ADMIN', 'super_admin')
        AND property_memberships.is_active = true
    )
    OR EXISTS (
        SELECT 1 FROM properties p
        JOIN organization_memberships om ON p.organization_id = om.organization_id
        WHERE p.id = qr_facility_zones.property_id
        AND om.user_id = auth.uid()
        AND om.role::text IN ('ORG_SUPER_ADMIN', 'org_super_admin', 'ORG_ADMIN', 'org_admin')
        AND om.is_active = true
    )
);


-- Create guest_requests table
DO $$ BEGIN
    CREATE TYPE guest_request_status AS ENUM ('PENDING', 'IN_PROGRESS', 'RESOLVED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS public.guest_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
    qr_zone_id UUID NOT NULL REFERENCES public.qr_facility_zones(id) ON DELETE CASCADE,
    guest_name TEXT NOT NULL,
    guest_email TEXT,
    guest_phone TEXT,
    description TEXT NOT NULL,
    photo_urls TEXT[] DEFAULT '{}',
    status guest_request_status DEFAULT 'PENDING',
    ai_category TEXT,
    sla_deadline TIMESTAMP WITH TIME ZONE,
    device_info JSONB,
    location_data JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- RLS for guest_requests
ALTER TABLE public.guest_requests ENABLE ROW LEVEL SECURITY;

-- Property members can view requests in their property
CREATE POLICY "Property members can view guest_requests"
ON public.guest_requests FOR SELECT
USING (
    EXISTS (
        SELECT 1 FROM property_memberships
        WHERE property_memberships.property_id = guest_requests.property_id
        AND property_memberships.user_id = auth.uid()
        AND property_memberships.is_active = true
    )
    OR EXISTS (
        SELECT 1 FROM properties p
        JOIN organization_memberships om ON p.organization_id = om.organization_id
        WHERE p.id = guest_requests.property_id
        AND om.user_id = auth.uid()
        AND om.is_active = true
    )
);

-- Property members can update requests in their property
CREATE POLICY "Property members can update guest_requests"
ON public.guest_requests FOR UPDATE
USING (
    EXISTS (
        SELECT 1 FROM property_memberships
        WHERE property_memberships.property_id = guest_requests.property_id
        AND property_memberships.user_id = auth.uid()
        AND property_memberships.is_active = true
    )
    OR EXISTS (
        SELECT 1 FROM properties p
        JOIN organization_memberships om ON p.organization_id = om.organization_id
        WHERE p.id = guest_requests.property_id
        AND om.user_id = auth.uid()
        AND om.is_active = true
    )
);
-- Ensure guest-photos bucket exists (if not already created)
INSERT INTO storage.buckets (id, name, public)
VALUES ('guest-photos', 'guest-photos', true)
ON CONFLICT (id) DO NOTHING;

-- Drop existing policies if any to prevent conflicts
DROP POLICY IF EXISTS "Restrict MIME types on guest-photos" ON storage.objects;
DROP POLICY IF EXISTS "Public Access for guest-photos" ON storage.objects;
DROP POLICY IF EXISTS "Allow public uploads to guest-photos" ON storage.objects;

-- Create policy to allow uploads but strictly enforce MIME types matching images
CREATE POLICY "Restrict MIME types on guest-photos"
ON storage.objects FOR INSERT
TO public
WITH CHECK (
    bucket_id = 'guest-photos' 
    AND (
        -- Enforce allowed MIME types
        (storage.extension(name) = 'jpg' AND (mimetype = 'image/jpeg' OR mimetype = 'image/jpg')) OR
        (storage.extension(name) = 'jpeg' AND mimetype = 'image/jpeg') OR
        (storage.extension(name) = 'png' AND mimetype = 'image/png') OR
        (storage.extension(name) = 'webp' AND mimetype = 'image/webp') OR
        (storage.extension(name) = 'gif' AND mimetype = 'image/gif')
    )
);

-- Ensure public read access (so dashboard can load images)
CREATE POLICY "Public Access for guest-photos"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'guest-photos');
-- Create user_management_audit_logs table
CREATE TABLE IF NOT EXISTS public.user_management_audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    action TEXT NOT NULL, -- e.g., 'delete_user', 'update_role', 'assign_property', 'remove_staff'
    target_user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE SET NULL,
    admin_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
    details JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Enable RLS
ALTER TABLE public.user_management_audit_logs ENABLE ROW LEVEL SECURITY;

-- Policies for user_management_audit_logs
CREATE POLICY "Enable CRUD for authenticated users" ON public.user_management_audit_logs
    FOR ALL
    TO authenticated
    USING (true)
    WITH CHECK (true);

-- Add updated_by and updated_at to property_memberships
ALTER TABLE public.property_memberships 
ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE;

-- Add updated_by and updated_at to organization_memberships
ALTER TABLE public.organization_memberships 
ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE;

-- Add updated_by and updated_at to users (if not exists)
ALTER TABLE public.users 
ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE;
-- Migration: Add Ticket Number Sequence to Guest Requests
-- 20260707000001_guest_request_ticket_number.sql

-- 1. Add Columns
ALTER TABLE public.guest_requests 
ADD COLUMN IF NOT EXISTS property_sequence_number INT,
ADD COLUMN IF NOT EXISTS ticket_number TEXT;

-- 2. Create helper to get initials
CREATE OR REPLACE FUNCTION public.get_initials(input_text TEXT)
RETURNS TEXT AS $$
DECLARE
    initials TEXT := '';
    word TEXT;
BEGIN
    IF input_text IS NULL OR trim(input_text) = '' THEN
        RETURN 'XX';
    END IF;
    -- Remove non-alphanumeric, split by spaces/hyphens
    FOR word IN SELECT unnest(regexp_split_to_array(trim(input_text), '[\s-]+')) LOOP
        IF length(word) > 0 THEN
            initials := initials || upper(left(regexp_replace(word, '[^a-zA-Z0-9]', '', 'g'), 1));
        END IF;
    END LOOP;
    
    -- Ensure at least something is returned
    IF length(initials) = 0 THEN
        RETURN 'XX';
    END IF;
    
    RETURN initials;
END;
$$ LANGUAGE plpgsql;

-- 3. Create Trigger Function
CREATE OR REPLACE FUNCTION public.generate_guest_request_ticket_number()
RETURNS TRIGGER AS $$
DECLARE
    next_seq INT;
    org_name TEXT;
    prop_name TEXT;
    zone_name TEXT;
    t_number TEXT;
BEGIN
    -- Get next sequence for property
    SELECT COALESCE(MAX(property_sequence_number), 0) + 1 INTO next_seq
    FROM public.guest_requests
    WHERE property_id = NEW.property_id;

    NEW.property_sequence_number := next_seq;

    -- Fetch Property and Organization Name
    SELECT p.name, o.name INTO prop_name, org_name
    FROM public.properties p
    LEFT JOIN public.organizations o ON p.organization_id = o.id
    WHERE p.id = NEW.property_id;

    -- Fetch Zone Name
    SELECT qz.zone_name INTO zone_name
    FROM public.qr_facility_zones qz
    WHERE qz.id = NEW.qr_zone_id;

    -- Generate ticket number
    t_number := public.get_initials(org_name) || '-' ||
                public.get_initials(prop_name) || '-' ||
                public.get_initials(zone_name) || '-' ||
                lpad(next_seq::text, 3, '0');
                
    NEW.ticket_number := t_number;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 4. Create Trigger
DROP TRIGGER IF EXISTS trg_generate_guest_request_ticket_number ON public.guest_requests;
CREATE TRIGGER trg_generate_guest_request_ticket_number
BEFORE INSERT ON public.guest_requests
FOR EACH ROW
EXECUTE FUNCTION public.generate_guest_request_ticket_number();

-- 5. Backfill existing data
DO $$
DECLARE
    req RECORD;
    next_seq INT;
    org_name TEXT;
    prop_name TEXT;
    z_name TEXT;
    t_number TEXT;
BEGIN
    FOR req IN 
        SELECT id, property_id, qr_zone_id 
        FROM public.guest_requests 
        WHERE ticket_number IS NULL
        ORDER BY created_at ASC
    LOOP
        -- Get next sequence for property
        SELECT COALESCE(MAX(property_sequence_number), 0) + 1 INTO next_seq
        FROM public.guest_requests
        WHERE property_id = req.property_id;

        -- Fetch Property and Organization Name
        SELECT p.name, o.name INTO prop_name, org_name
        FROM public.properties p
        LEFT JOIN public.organizations o ON p.organization_id = o.id
        WHERE p.id = req.property_id;

        -- Fetch Zone Name
        SELECT qz.zone_name INTO z_name
        FROM public.qr_facility_zones qz
        WHERE qz.id = req.qr_zone_id;

        -- Generate ticket number
        t_number := public.get_initials(org_name) || '-' ||
                    public.get_initials(prop_name) || '-' ||
                    public.get_initials(z_name) || '-' ||
                    lpad(next_seq::text, 3, '0');
                    
        UPDATE public.guest_requests
        SET property_sequence_number = next_seq,
            ticket_number = t_number
        WHERE id = req.id;
    END LOOP;
END $$;
-- Create guest_request_events table for timeline
CREATE TABLE IF NOT EXISTS public.guest_request_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    guest_request_id UUID NOT NULL REFERENCES public.guest_requests(id) ON DELETE CASCADE,
    user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    from_status TEXT,
    to_status TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Enable RLS
ALTER TABLE public.guest_request_events ENABLE ROW LEVEL SECURITY;

-- Policies for guest_request_events
CREATE POLICY "Enable CRUD for authenticated users" ON public.guest_request_events
    FOR ALL
    TO authenticated
    USING (true)
    WITH CHECK (true);
-- =========================================================
-- FEEDBACK TICKETS TABLE (AI Auto-Dev Pipeline)
-- Supports both bug reports and feature requests
-- Any authenticated user can submit feedback
-- =========================================================

-- 1. Create feedback_tickets table
CREATE TABLE IF NOT EXISTS feedback_tickets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type TEXT NOT NULL CHECK (type IN ('bug', 'feature')),
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN (
            'pending', 'analyzing', 'planning', 'coding', 'validating',
            'fixing_errors', 'pr_created', 'approved', 'deployed',
            'failed', 'rejected'
        )),

    -- Submitter info
    submitted_by UUID REFERENCES users(id) ON DELETE SET NULL,
    submitted_by_name TEXT,
    submitted_by_role TEXT,
    property_id UUID REFERENCES properties(id) ON DELETE SET NULL,
    organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL,

    -- Bug-specific fields
    error_text TEXT,
    error_page_url TEXT,
    error_category TEXT CHECK (error_category IN (
        'data_not_loading', 'ui_broken', 'permission_error',
        'upload_failed', 'wrong_data', 'performance', 'crash', 'other'
    )),
    severity TEXT DEFAULT 'medium' CHECK (severity IN ('low', 'medium', 'high', 'critical')),

    -- Feature-specific fields
    feature_description TEXT,
    target_module TEXT,
    acceptance_criteria TEXT,
    priority TEXT DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),

    -- Attachments (stored in Supabase Storage)
    attachments TEXT[] DEFAULT '{}',

    -- AI processing fields
    ai_analysis JSONB,
    ai_solution_plan JSONB,
    ai_changes_made JSONB,
    ai_validation_results JSONB,
    ai_attempts INTEGER DEFAULT 0,
    max_attempts INTEGER DEFAULT 3,
    failure_reason TEXT,

    -- Live tracking fields
    live_step TEXT,
    live_progress INTEGER DEFAULT 0,
    processing_started_at TIMESTAMPTZ,

    -- Git integration
    github_pr_url TEXT,
    github_branch TEXT,

    -- Meta
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    resolved_at TIMESTAMPTZ
);

-- 2. Performance Indexes
CREATE INDEX IF NOT EXISTS idx_feedback_tickets_status ON feedback_tickets(status);
CREATE INDEX IF NOT EXISTS idx_feedback_tickets_type ON feedback_tickets(type);
CREATE INDEX IF NOT EXISTS idx_feedback_tickets_org ON feedback_tickets(organization_id);
CREATE INDEX IF NOT EXISTS idx_feedback_tickets_submitted_by ON feedback_tickets(submitted_by);
CREATE INDEX IF NOT EXISTS idx_feedback_tickets_created_at ON feedback_tickets(created_at DESC);

-- 3. RLS Policies
ALTER TABLE feedback_tickets ENABLE ROW LEVEL SECURITY;

-- Anyone authenticated can INSERT feedback
DROP POLICY IF EXISTS feedback_tickets_insert ON feedback_tickets;
CREATE POLICY feedback_tickets_insert ON feedback_tickets FOR INSERT
WITH CHECK (auth.uid() IS NOT NULL);

-- Users can see their own feedback; admins can see all in their org
DROP POLICY IF EXISTS feedback_tickets_select ON feedback_tickets;
CREATE POLICY feedback_tickets_select ON feedback_tickets FOR SELECT USING (
    -- Own submissions
    submitted_by = auth.uid()
    -- Org admins can see all in their org
    OR EXISTS(
        SELECT 1 FROM organization_memberships om
        WHERE om.user_id = auth.uid()
        AND om.organization_id = feedback_tickets.organization_id
        AND om.role IN ('master_admin', 'org_super_admin')
    )
    -- Property admins can see for their property
    OR EXISTS(
        SELECT 1 FROM property_memberships pm
        WHERE pm.user_id = auth.uid()
        AND pm.property_id = feedback_tickets.property_id
        AND pm.role = 'property_admin'
        AND pm.is_active = true
    )
    -- Master admin bypass
    OR (SELECT email FROM auth.users WHERE id = auth.uid()) = 'ranganathanlohitaksha@gmail.com'
);

-- Only admins can update (status changes, AI processing)
DROP POLICY IF EXISTS feedback_tickets_update ON feedback_tickets;
CREATE POLICY feedback_tickets_update ON feedback_tickets FOR UPDATE USING (
    EXISTS(
        SELECT 1 FROM organization_memberships om
        WHERE om.user_id = auth.uid()
        AND om.organization_id = feedback_tickets.organization_id
        AND om.role IN ('master_admin', 'org_super_admin')
    )
    OR (SELECT email FROM auth.users WHERE id = auth.uid()) = 'ranganathanlohitaksha@gmail.com'
);

-- 4. Storage bucket for feedback screenshots
-- Note: Run this in Supabase dashboard SQL editor since it requires storage admin
-- INSERT INTO storage.buckets (id, name, public)
-- VALUES ('feedback-attachments', 'feedback-attachments', true)
-- ON CONFLICT (id) DO NOTHING;

-- =========================================================
-- END — SAFE TO RE-RUN
-- =========================================================
