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
