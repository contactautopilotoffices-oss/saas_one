-- =================================================================================
-- Migration: 20261027000002_task_manager_cross_department_switch.sql
-- Description: Control Center switch "Work with other departments" (owner 2026-10-27), per department.
--   task_manager_department_settings.cross_dept_collab
--     ON  (default)  the Send tab's "Other departments" side: give a task, ask for support, work together.
--     OFF            that department's people can neither send to nor receive from other departments.
--                    Support requests already waiting can still be answered.
--   Default TRUE, so every department keeps working exactly as today until someone switches it off.
-- Safety: ADDITIVE ONLY. One column with a default; existing rows and behaviour are unchanged. Safe to re-run.
--         The app works before this is applied (everyone counts as ON, and the switch cannot be turned off yet).
-- How to apply: run this file once in the Supabase SQL Editor.
-- Rollback:   ALTER TABLE public.task_manager_department_settings DROP COLUMN cross_dept_collab;
-- =================================================================================

BEGIN;

ALTER TABLE public.task_manager_department_settings
    ADD COLUMN IF NOT EXISTS cross_dept_collab BOOLEAN NOT NULL DEFAULT true;

COMMIT;
