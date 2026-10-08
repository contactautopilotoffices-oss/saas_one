-- =================================================================================
-- Migration: 20261002000001_task_manager_schema.sql
-- Description: Employee Task Manager Schema (tm_tasks, tm_task_updates, tm_daily_reports)
-- Safety: Completely additive. Does NOT alter, drop, or modify any existing tables.
-- =================================================================================

-- 1. Helper function for updated_at timestamps (namespaced to tm_*)
CREATE OR REPLACE FUNCTION public.tm_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- =================================================================================
-- 2. Core Task Table: tm_tasks
-- =================================================================================
CREATE TABLE IF NOT EXISTS public.tm_tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    employee_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    assigned_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    department TEXT,
    title TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'blocked', 'cancelled')),
    priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
    progress_percentage INT NOT NULL DEFAULT 0 CHECK (progress_percentage >= 0 AND progress_percentage <= 100),
    due_date TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Fast lookup indexes for tasks
CREATE INDEX IF NOT EXISTS idx_tm_tasks_org ON public.tm_tasks(organization_id);
CREATE INDEX IF NOT EXISTS idx_tm_tasks_employee ON public.tm_tasks(employee_id);
CREATE INDEX IF NOT EXISTS idx_tm_tasks_status ON public.tm_tasks(status);
CREATE INDEX IF NOT EXISTS idx_tm_tasks_department ON public.tm_tasks(department);
CREATE INDEX IF NOT EXISTS idx_tm_tasks_due_date ON public.tm_tasks(due_date);
CREATE INDEX IF NOT EXISTS idx_tm_tasks_assigned_by ON public.tm_tasks(assigned_by);
CREATE INDEX IF NOT EXISTS idx_tm_tasks_created_at ON public.tm_tasks(created_at DESC);

-- Trigger for tm_tasks.updated_at
DROP TRIGGER IF EXISTS trigger_tm_tasks_updated_at ON public.tm_tasks;
CREATE TRIGGER trigger_tm_tasks_updated_at
    BEFORE UPDATE ON public.tm_tasks
    FOR EACH ROW
    EXECUTE FUNCTION public.tm_set_updated_at();

-- =================================================================================
-- 3. Task Progress Updates & History Table: tm_task_updates
-- =================================================================================
CREATE TABLE IF NOT EXISTS public.tm_task_updates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id UUID NOT NULL REFERENCES public.tm_tasks(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    update_text TEXT NOT NULL,
    progress_percentage INT CHECK (progress_percentage >= 0 AND progress_percentage <= 100),
    status TEXT CHECK (status IN ('pending', 'in_progress', 'completed', 'blocked', 'cancelled')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Fast lookup indexes for task updates
CREATE INDEX IF NOT EXISTS idx_tm_task_updates_task_id ON public.tm_task_updates(task_id);
CREATE INDEX IF NOT EXISTS idx_tm_task_updates_user_id ON public.tm_task_updates(user_id);
CREATE INDEX IF NOT EXISTS idx_tm_task_updates_created_at ON public.tm_task_updates(created_at DESC);

-- =================================================================================
-- 4. Daily Work Reports Table: tm_daily_reports
-- =================================================================================
CREATE TABLE IF NOT EXISTS public.tm_daily_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    report_date DATE NOT NULL DEFAULT CURRENT_DATE,
    summary TEXT NOT NULL,
    tasks_completed JSONB DEFAULT '[]'::jsonb,
    blockers TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT tm_daily_reports_user_date_unique UNIQUE (user_id, report_date)
);

-- Fast lookup indexes for daily reports
CREATE INDEX IF NOT EXISTS idx_tm_daily_reports_org ON public.tm_daily_reports(organization_id);
CREATE INDEX IF NOT EXISTS idx_tm_daily_reports_user ON public.tm_daily_reports(user_id);
CREATE INDEX IF NOT EXISTS idx_tm_daily_reports_date ON public.tm_daily_reports(report_date DESC);

-- Trigger for tm_daily_reports.updated_at
DROP TRIGGER IF EXISTS trigger_tm_daily_reports_updated_at ON public.tm_daily_reports;
CREATE TRIGGER trigger_tm_daily_reports_updated_at
    BEFORE UPDATE ON public.tm_daily_reports
    FOR EACH ROW
    EXECUTE FUNCTION public.tm_set_updated_at();

-- =================================================================================
-- 5. Row Level Security (RLS)
-- =================================================================================
ALTER TABLE public.tm_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tm_task_updates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tm_daily_reports ENABLE ROW LEVEL SECURITY;

-- Service role full access (WhatsApp & backend API bypass)
DROP POLICY IF EXISTS "tm_tasks_service_role" ON public.tm_tasks;
CREATE POLICY "tm_tasks_service_role" ON public.tm_tasks
    FOR ALL USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "tm_task_updates_service_role" ON public.tm_task_updates;
CREATE POLICY "tm_task_updates_service_role" ON public.tm_task_updates
    FOR ALL USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "tm_daily_reports_service_role" ON public.tm_daily_reports;
CREATE POLICY "tm_daily_reports_service_role" ON public.tm_daily_reports
    FOR ALL USING (auth.role() = 'service_role');

-- Authenticated users policies
DROP POLICY IF EXISTS "tm_tasks_read_authenticated" ON public.tm_tasks;
CREATE POLICY "tm_tasks_read_authenticated" ON public.tm_tasks
    FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "tm_tasks_manage_own" ON public.tm_tasks;
CREATE POLICY "tm_tasks_manage_own" ON public.tm_tasks
    FOR ALL TO authenticated USING (auth.uid() = employee_id OR auth.uid() = assigned_by);

DROP POLICY IF EXISTS "tm_task_updates_read_authenticated" ON public.tm_task_updates;
CREATE POLICY "tm_task_updates_read_authenticated" ON public.tm_task_updates
    FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "tm_task_updates_insert_own" ON public.tm_task_updates;
CREATE POLICY "tm_task_updates_insert_own" ON public.tm_task_updates
    FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "tm_daily_reports_read_authenticated" ON public.tm_daily_reports;
CREATE POLICY "tm_daily_reports_read_authenticated" ON public.tm_daily_reports
    FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "tm_daily_reports_manage_own" ON public.tm_daily_reports;
CREATE POLICY "tm_daily_reports_manage_own" ON public.tm_daily_reports
    FOR ALL TO authenticated USING (auth.uid() = user_id);
