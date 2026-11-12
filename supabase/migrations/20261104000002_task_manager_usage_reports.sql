-- =================================================================================
-- Migration: 20261104000002_task_manager_usage_reports.sql
-- Description: owner 2026-11-04 — Task Manager Usage Report (Task Manager > Report tab, org super admins only).
--   task_manager_report_settings  one row per organisation: the report schedule chosen in the Report tab.
--   task_manager_reports          one row per generated report (manual or scheduled). The PDF lives in the new
--                                 PRIVATE storage bucket "task-manager-reports"; only server code (service role)
--                                 reads or writes it and hands out download links that expire after 10 minutes.
-- Safety: ADDITIVE ONLY. Two new tables, one new private bucket. Existing tables, rows and policies are unchanged.
--         The app works before this is applied: the Report tab still generates and downloads a PDF, and says that
--         scheduling and saved reports are not switched on yet.
--         Safe to re-run.
-- How to apply: run this file once in the Supabase SQL Editor.
-- Rollback:   DROP TABLE public.task_manager_reports;
--             DROP TABLE public.task_manager_report_settings;
--             DELETE FROM storage.buckets WHERE id = 'task-manager-reports';  (empty the bucket first)
-- =================================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.task_manager_report_settings (
    organization_id UUID PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
    enabled BOOLEAN NOT NULL DEFAULT false,
    frequency TEXT NOT NULL DEFAULT 'weekly' CHECK (frequency IN ('weekly', 'fortnightly', 'monthly')),
    day_of_week SMALLINT NOT NULL DEFAULT 1 CHECK (day_of_week BETWEEN 0 AND 6),      -- 0 = Sunday ... 6 = Saturday
    day_of_month SMALLINT NOT NULL DEFAULT 1 CHECK (day_of_month BETWEEN 1 AND 28),
    time_ist TEXT NOT NULL DEFAULT '09:00' CHECK (time_ist ~ '^([01][0-9]|2[0-3]):(00|15|30|45)$'),
    coverage_days SMALLINT NOT NULL DEFAULT 7 CHECK (coverage_days BETWEEN 1 AND 366),
    next_run_at TIMESTAMPTZ,
    updated_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The scheduler only looks at schedules that are switched on and due.
CREATE INDEX IF NOT EXISTS idx_task_manager_report_settings_due
    ON public.task_manager_report_settings(next_run_at) WHERE enabled;

CREATE TABLE IF NOT EXISTS public.task_manager_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    period_from DATE NOT NULL,
    period_to DATE NOT NULL,
    trigger TEXT NOT NULL CHECK (trigger IN ('manual', 'scheduled')),
    status TEXT NOT NULL CHECK (status IN ('ready', 'failed')),
    storage_path TEXT,
    file_size INTEGER CHECK (file_size > 0),
    error TEXT,
    generated_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (period_from <= period_to),
    CHECK (status <> 'ready' OR storage_path IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_task_manager_reports_org_created
    ON public.task_manager_reports(organization_id, created_at DESC);

-- Server code only (service role bypasses RLS); no policies, so browsers cannot read these tables directly.
ALTER TABLE public.task_manager_report_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_manager_reports ENABLE ROW LEVEL SECURITY;

-- Private bucket: PDFs only, 20 MB per file.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('task-manager-reports', 'task-manager-reports', false, 20971520, ARRAY['application/pdf'])
ON CONFLICT (id) DO NOTHING;

NOTIFY pgrst, 'reload schema';
COMMIT;
