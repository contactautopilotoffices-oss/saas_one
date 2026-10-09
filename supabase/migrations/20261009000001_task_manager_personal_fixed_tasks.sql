-- =================================================================================
-- Migration: 20261009000001_task_manager_personal_fixed_tasks.sql
-- Description: "Lock" a task so it comes back every working day (a personal fixed task).
--   1. owner_id     - who the fixed task belongs to. NULL (every existing row) = the original department-wide fixed task,
--                     which still goes to everyone in its department exactly as before. A value = a PERSONAL fixed task:
--                     it is only ever created for that one person.
--   2. days_of_week - the days it comes back (0 = Sunday ... 6 = Saturday). Default Monday to Saturday.
--                     The screen can let people change this later; the column is here now so no second migration is needed.
--   A task is "locked" when its template (task_assignments.task_template_id) has owner_id = the person and is_active = true.
--   Unlocking sets is_active = false on the template; nothing is deleted.
-- Safety: ADDITIVE ONLY. Two new columns with safe defaults and one index. No new table. No existing row is changed or removed.
-- How to apply: run this file once in the Supabase SQL Editor (after 20261007000006).
-- Rollback:
--   DROP INDEX IF EXISTS public.idx_task_templates_owner;
--   ALTER TABLE public.task_templates DROP COLUMN IF EXISTS days_of_week, DROP COLUMN IF EXISTS owner_id;
-- =================================================================================

ALTER TABLE public.task_templates
    ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
    ADD COLUMN IF NOT EXISTS days_of_week SMALLINT[] NOT NULL DEFAULT '{1,2,3,4,5,6}';

-- Only valid weekday numbers
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'task_templates_days_of_week_valid') THEN
        ALTER TABLE public.task_templates
            ADD CONSTRAINT task_templates_days_of_week_valid
            CHECK (days_of_week <@ ARRAY[0,1,2,3,4,5,6]::smallint[]);
    END IF;
END $$;

-- Finding one person's active fixed tasks (partial: most rows have no owner)
CREATE INDEX IF NOT EXISTS idx_task_templates_owner
    ON public.task_templates(owner_id)
    WHERE owner_id IS NOT NULL AND is_active = true;
