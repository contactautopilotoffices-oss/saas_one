-- =========================================================
-- SYSTEM ISSUE TRACKING
-- Automatic bug/error tracking for SaaS product
-- Run this SQL in your Supabase SQL Editor
-- =========================================================

-- 1. Create issue_logs table
CREATE TABLE IF NOT EXISTS public.issue_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Classification
    category TEXT NOT NULL CHECK (category IN (
        'ui_error', 'api_error', 'db_error', 'performance', 'ux_friction', 'user_feedback'
    )),
    severity TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),

    -- Source Info
    source TEXT NOT NULL CHECK (source IN ('frontend', 'backend', 'database')),
    user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
    property_id UUID REFERENCES public.properties(id) ON DELETE SET NULL,
    organization_id UUID REFERENCES public.organizations(id) ON DELETE SET NULL,

    -- Error Details
    error_code TEXT,
    error_message TEXT NOT NULL,
    stack_trace TEXT,
    request_url TEXT,
    request_method TEXT,
    request_body JSONB,

    -- Context
    user_agent TEXT,
    browser TEXT,
    os TEXT,
    device TEXT,
    screen_size TEXT,

    -- Page/Component Context
    page_url TEXT,
    page_route TEXT,
    component_name TEXT,

    -- User Feedback (for manual reports)
    user_description TEXT,
    user_screenshot_url TEXT,

    -- Resolution
    status TEXT DEFAULT 'open' CHECK (status IN ('open', 'investigating', 'resolved', 'ignored')),
    assigned_to UUID REFERENCES public.users(id) ON DELETE SET NULL,
    resolution_notes TEXT,
    resolved_by UUID REFERENCES public.users(id) ON DELETE SET NULL,

    -- Metadata
    occurred_at TIMESTAMPTZ DEFAULT now(),
    first_seen_at TIMESTAMPTZ DEFAULT now(),
    last_seen_at TIMESTAMPTZ DEFAULT now(),
    occurrence_count INT DEFAULT 1,
    is_resolved BOOLEAN DEFAULT false,
    resolved_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Create indexes for fast queries
CREATE INDEX IF NOT EXISTS idx_issue_logs_status ON public.issue_logs(status);
CREATE INDEX IF NOT EXISTS idx_issue_logs_category ON public.issue_logs(category);
CREATE INDEX IF NOT EXISTS idx_issue_logs_severity ON public.issue_logs(severity);
CREATE INDEX IF NOT EXISTS idx_issue_logs_occurred_at ON public.issue_logs(occurred_at);
CREATE INDEX IF NOT EXISTS idx_issue_logs_property ON public.issue_logs(property_id);
CREATE INDEX IF NOT EXISTS idx_issue_logs_org ON public.issue_logs(organization_id);
CREATE INDEX IF NOT EXISTS idx_issue_logs_user ON public.issue_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_issue_logs_source ON public.issue_logs(source);

-- 3. Create updated_at trigger
CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_issue_logs_updated_at ON public.issue_logs;
CREATE TRIGGER update_issue_logs_updated_at
    BEFORE UPDATE ON public.issue_logs
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at();

-- 4. Disable RLS for now (easier for development)
ALTER TABLE public.issue_logs DISABLE ROW LEVEL SECURITY;

-- 5. Comments
COMMENT ON TABLE public.issue_logs IS 'Centralized issue/bug tracking for SaaS product';
COMMENT ON COLUMN public.issue_logs.category IS 'ui_error, api_error, db_error, performance, ux_friction, user_feedback';
COMMENT ON COLUMN public.issue_logs.severity IS 'low, medium, high, critical';
COMMENT ON COLUMN public.issue_logs.source IS 'frontend, backend, database';
COMMENT ON COLUMN public.issue_logs.occurrence_count IS 'Number of times this exact error occurred';

NOTIFY pgrst, 'reload schema';
