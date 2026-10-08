-- =================================================================================
-- Migration: 20261007000004_task_manager_task_import.sql
-- Description: Task Import - a switch per department: "people in this team can send a task list
--   (Excel file, image or text) on WhatsApp, preview it, and save it to their own Tasks tab".
-- Safety: ADDITIVE ONLY. Adds one column with a safe default (false) to the table created by
--         20261007000001. Nothing changes until you switch a department ON in the Control Center.
-- How to apply: run this file once in the Supabase SQL Editor (after 20261007000001).
-- Rollback:   ALTER TABLE public.task_manager_department_settings DROP COLUMN task_import_enabled;
-- =================================================================================

ALTER TABLE public.task_manager_department_settings
    ADD COLUMN IF NOT EXISTS task_import_enabled BOOLEAN NOT NULL DEFAULT false;
