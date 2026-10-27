-- =================================================================================
-- Migration: 20261027000001_task_manager_due_dates.sql
-- Description: Task Manager due dates (owner 2026-10-27).
--   task_assignments.due_date         Optional deadline. The existing assigned_date stays the START date.
--   task_assignments.due_time         Optional time on the due date (IST). Empty = end of that day.
--   task_assignments.due_reminded_at  When the one "due soon" reminder went out (never sent twice).
--   task_manager_department_settings.due_dates
--                                     Control Center switch, per department, OFF by default.
--   A task without a due date counts as due on its start date and behaves exactly as today.
-- Safety: ADDITIVE ONLY. Four nullable / default-false columns and one partial index. Existing rows and behaviour are
--         unchanged. Safe to re-run. The app works before this is applied (the switch just cannot be turned on).
-- How to apply: run this file once in the Supabase SQL Editor.
-- Rollback:   ALTER TABLE public.task_assignments DROP COLUMN due_date, DROP COLUMN due_time, DROP COLUMN due_reminded_at;
--             ALTER TABLE public.task_manager_department_settings DROP COLUMN due_dates;
-- =================================================================================

BEGIN;

ALTER TABLE public.task_assignments
    ADD COLUMN IF NOT EXISTS due_date DATE,
    ADD COLUMN IF NOT EXISTS due_time TIME,
    ADD COLUMN IF NOT EXISTS due_reminded_at TIMESTAMPTZ;

-- The reminder job only looks at open tasks that have a deadline and no reminder yet.
CREATE INDEX IF NOT EXISTS idx_task_assignments_due_open
    ON public.task_assignments(due_date)
    WHERE due_date IS NOT NULL AND due_reminded_at IS NULL AND status <> 'completed';

ALTER TABLE public.task_manager_department_settings
    ADD COLUMN IF NOT EXISTS due_dates BOOLEAN NOT NULL DEFAULT false;

COMMIT;
