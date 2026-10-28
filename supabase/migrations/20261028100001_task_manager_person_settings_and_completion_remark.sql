-- =================================================================================
-- Migration: 20261028100001_task_manager_person_settings_and_completion_remark.sql
-- Description: owner 2026-10-28.
--   1. task_manager_department_settings.completion_remark — "Remark on completion" for a team:
--        'off'       no comment box when a task is marked done
--        'ask'       (default) the box opens, the person may skip it
--        'required'  a task can only be marked done with a remark
--   2. task_manager_person_settings — personal exceptions to the team switches (Control Center → click a person).
--        One row per (person, setting). No row = the person follows their team.
--        value 'on' / 'off' for the on/off switches; 'off' / 'ask' / 'required' for completion_remark.
--        A personal value wins over the team either way (team OFF + person ON, or team ON + person OFF).
-- Safety: ADDITIVE ONLY. One column with a default and one new empty table (row level security on, no policies: only
--         server code with the service role reads or writes it). Existing rows and behaviour are unchanged. Safe to re-run.
--         The app works before this is applied: every team counts as 'ask' and nobody has personal exceptions.
-- How to apply: run this file once in the Supabase SQL Editor (after 20261027100003).
-- Rollback:   DROP TABLE public.task_manager_person_settings;
--             ALTER TABLE public.task_manager_department_settings DROP COLUMN completion_remark;
-- =================================================================================

BEGIN;

ALTER TABLE public.task_manager_department_settings
    ADD COLUMN IF NOT EXISTS completion_remark TEXT NOT NULL DEFAULT 'ask';

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'task_manager_department_settings_completion_remark_check') THEN
        ALTER TABLE public.task_manager_department_settings
            ADD CONSTRAINT task_manager_department_settings_completion_remark_check CHECK (completion_remark IN ('off', 'ask', 'required'));
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.task_manager_person_settings (
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    setting TEXT NOT NULL CHECK (setting IN (
        'smart_chat', 'task_import', 'peer_assign', 'team_assign', 'cross_dept_collab', 'superuser_collab',
        'pending_on', 'protect_given', 'assigned_tab', 'due_dates', 'completion_remark'
    )),
    value TEXT NOT NULL CHECK (value IN ('on', 'off', 'ask', 'required')),
    updated_by TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, setting)
);

ALTER TABLE public.task_manager_person_settings ENABLE ROW LEVEL SECURITY;

COMMIT;
