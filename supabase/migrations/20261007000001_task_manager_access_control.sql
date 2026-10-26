-- =================================================================================
-- Migration: 20261007000001_task_manager_access_control.sql
-- Description: Step 3 - Task Manager access control.
--   1) task_manager_department_settings : a master ON/OFF switch per department
--   2) task_manager_onboarding          : which people have had their kickoff sent
--      (a person is unlocked only when their department is ON *and* their kickoff is recorded)
-- Safety: ADDITIVE ONLY. Creates two new tables and seeds the Tech team (already onboarded).
--         Does not alter or read-modify any existing table. Safe to re-run.
-- How to apply: run this whole file once in the Supabase SQL Editor.
-- Rollback:   DROP TABLE public.task_manager_onboarding; DROP TABLE public.task_manager_department_settings;
--             (the app then falls back to "only the Tech team is unlocked").
-- =================================================================================

-- 1. Department master switch (a missing row means OFF)
CREATE TABLE IF NOT EXISTS public.task_manager_department_settings (
    department_id UUID PRIMARY KEY REFERENCES public.departments(id) ON DELETE CASCADE,
    enabled BOOLEAN NOT NULL DEFAULT false,
    updated_by TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Onboarding record (a missing row means "not invited yet")
CREATE TABLE IF NOT EXISTS public.task_manager_onboarding (
    user_id UUID PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
    department_id UUID REFERENCES public.departments(id) ON DELETE SET NULL,
    kickoff_type TEXT CHECK (kickoff_type IN ('employee', 'manager')),
    source TEXT NOT NULL CHECK (source IN ('whatsapp', 'manual', 'backfill')),
    kickoff_sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    recorded_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_task_manager_onboarding_dept ON public.task_manager_onboarding(department_id);

-- 3. Row Level Security: no policies on purpose. Only the server (service role) reads or writes these tables.
ALTER TABLE public.task_manager_department_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_manager_onboarding ENABLE ROW LEVEL SECURITY;

-- 4. Seed: the Tech team is already onboarded, so nothing changes for them.
INSERT INTO public.task_manager_department_settings (department_id, enabled, updated_by)
SELECT d.id, true, 'migration: Tech already onboarded'
FROM public.departments d
WHERE LOWER(d.name) = 'tech'
ON CONFLICT (department_id) DO NOTHING;

INSERT INTO public.task_manager_onboarding (user_id, department_id, kickoff_type, source, recorded_by)
SELECT ep.user_id,
       ep.department_id,
       CASE WHEN ep.task_role = 'reporting_manager' THEN 'manager' ELSE 'employee' END,
       'backfill',
       'migration: Tech already onboarded'
FROM public.employee_profiles ep
JOIN public.departments d ON d.id = ep.department_id
WHERE LOWER(d.name) = 'tech'
  AND ep.is_active = true
  AND ep.user_id IS NOT NULL
ON CONFLICT (user_id) DO NOTHING;
