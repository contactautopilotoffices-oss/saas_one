-- =================================================================================
-- Migration: 20261007000002_task_manager_team_sharing.sql
-- Description: Step 5 - per-department "team sharing" switch for the Task Manager.
--   When ON for a department, its members can SEE each other's tasks and ASSIGN tasks to each other
--   (web Tasks tab and WhatsApp). When OFF (the default) only the reporting chain applies.
-- Safety: ADDITIVE ONLY. Adds one column with a safe default (false) to the table created by
--         20261007000001. Existing rows and behaviour are unchanged. Safe to re-run.
-- How to apply: run this file once in the Supabase SQL Editor (after 20261007000001).
-- Rollback:   ALTER TABLE public.task_manager_department_settings DROP COLUMN peer_assign;
-- =================================================================================

ALTER TABLE public.task_manager_department_settings
    ADD COLUMN IF NOT EXISTS peer_assign BOOLEAN NOT NULL DEFAULT false;
