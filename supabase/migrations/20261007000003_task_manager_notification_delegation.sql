-- =================================================================================
-- Migration: 20261007000003_task_manager_notification_delegation.sql
-- Description: Step 6 - a master switch per department: "this team may manage its own Task Manager
--   notification schedule and wording" (the Notifications view inside the Procurement Tasks tab).
-- Safety: ADDITIVE ONLY. Adds one column with a safe default (false) to the table created by
--         20261007000001. Nothing changes until you switch a department ON in the Control Center.
-- How to apply: run this file once in the Supabase SQL Editor (after 20261007000001).
-- Rollback:   ALTER TABLE public.task_manager_department_settings DROP COLUMN notifications_delegated;
-- =================================================================================

ALTER TABLE public.task_manager_department_settings
    ADD COLUMN IF NOT EXISTS notifications_delegated BOOLEAN NOT NULL DEFAULT false;
