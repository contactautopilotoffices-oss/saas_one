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
