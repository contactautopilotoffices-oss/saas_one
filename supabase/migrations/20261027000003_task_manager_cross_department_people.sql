-- =================================================================================
-- Migration: 20261027000003_task_manager_cross_department_people.sql
-- Description: who in a department may SEND work to other departments (owner 2026-10-27).
--   task_manager_department_settings.cross_dept_scope
--     'everyone' (default)  everyone in the department, exactly as today
--     'selected'            only the people listed in task_manager_cross_dept_people (nobody until someone is ticked)
--   task_manager_cross_dept_people   one row per ticked person.
--   Receiving is NOT limited: anyone in a department with "Work with other departments" ON can still be given tasks and
--   support requests by other departments. The department switch (cross_dept_collab) stays the master switch.
-- Safety: ADDITIVE ONLY. One column with a default and one new empty table (row level security on, no policies: only
--         server code with the service role reads or writes it). Existing rows and behaviour are unchanged. Safe to re-run.
--         The app works before this is applied (everyone counts as "everyone", and the choice cannot be changed yet).
-- How to apply: run this file once in the Supabase SQL Editor (after 20261027000002).
-- Rollback:   DROP TABLE public.task_manager_cross_dept_people;
--             ALTER TABLE public.task_manager_department_settings DROP COLUMN cross_dept_scope;
-- =================================================================================

BEGIN;

ALTER TABLE public.task_manager_department_settings
    ADD COLUMN IF NOT EXISTS cross_dept_scope TEXT NOT NULL DEFAULT 'everyone';

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'task_manager_department_settings_cross_dept_scope_check') THEN
        ALTER TABLE public.task_manager_department_settings
            ADD CONSTRAINT task_manager_department_settings_cross_dept_scope_check CHECK (cross_dept_scope IN ('everyone', 'selected'));
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.task_manager_cross_dept_people (
    user_id UUID PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
    added_by TEXT,
    added_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.task_manager_cross_dept_people ENABLE ROW LEVEL SECURITY;

COMMIT;
