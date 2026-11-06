-- =================================================================================
-- Migration: 20261007000005_task_manager_smart_chat.sql
-- Description: Smart chat - a switch per department: "people in this team can talk to the Task Manager in
--   plain language on WhatsApp (view, finish, add, hand over tasks); every change is confirmed first".
-- Safety: ADDITIVE ONLY. Adds one column with a safe default (false) to the table created by
--         20261007000001. Nothing changes until you switch a department ON in the Control Center.
-- How to apply: run this file once in the Supabase SQL Editor (after 20261007000001).
-- Rollback:   ALTER TABLE public.task_manager_department_settings DROP COLUMN smart_chat_enabled;
-- =================================================================================

ALTER TABLE public.task_manager_department_settings
    ADD COLUMN IF NOT EXISTS smart_chat_enabled BOOLEAN NOT NULL DEFAULT false;
