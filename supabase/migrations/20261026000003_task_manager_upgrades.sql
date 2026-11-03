-- =================================================================================
-- Migration: 20261026000003_task_manager_upgrades.sql
-- Description: Task Manager upgrades (owner 2026-10-26).
--   follow_up_of      A task made with "Create follow-up" points at the task it follows up.
--   assign_group_id   A task given to several people at once: each person gets their own copy (and finishes it
--                     separately); the copies share this id so each card can show who else has it.
--   task_attachments  Documents and screenshots attached to a task. The files live in the private storage bucket
--                     "task-attachments"; only server code (service role) reads or writes them and hands out
--                     short-lived download links.
--   Remarks on finished tasks need no change: they are saved as "Remark:" lines, like notes today.
-- Safety: ADDITIVE ONLY. Two nullable columns, one new table, one new private bucket. Existing rows and behaviour are
--         unchanged. Safe to re-run. The app works before this is applied (the new features just stay empty).
-- How to apply: run this file once in the Supabase SQL Editor.
-- Rollback:   DROP TABLE public.task_attachments;
--             ALTER TABLE public.task_assignments DROP COLUMN follow_up_of, DROP COLUMN assign_group_id;
--             DELETE FROM storage.buckets WHERE id = 'task-attachments';  (empty the bucket first)
-- =================================================================================

BEGIN;

ALTER TABLE public.task_assignments
    ADD COLUMN IF NOT EXISTS follow_up_of UUID REFERENCES public.task_assignments(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS assign_group_id UUID;

CREATE INDEX IF NOT EXISTS idx_task_assignments_follow_up_of
    ON public.task_assignments(follow_up_of) WHERE follow_up_of IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_task_assignments_assign_group
    ON public.task_assignments(assign_group_id) WHERE assign_group_id IS NOT NULL;

-- One row per task a file is attached to (a file attached while giving a task to several people is stored once and
-- listed on each copy, so storage_path is not unique).
CREATE TABLE IF NOT EXISTS public.task_attachments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id UUID NOT NULL REFERENCES public.task_assignments(id) ON DELETE CASCADE,
    uploaded_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    storage_path TEXT NOT NULL,
    file_name TEXT NOT NULL,
    file_type TEXT NOT NULL,
    file_size INTEGER NOT NULL CHECK (file_size > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_task_attachments_task ON public.task_attachments(task_id);

-- Server code only (service role bypasses RLS); no policies, so browsers cannot read the table directly.
ALTER TABLE public.task_attachments ENABLE ROW LEVEL SECURITY;

-- Private bucket: 10 MB per file, documents and images only.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'task-attachments', 'task-attachments', false, 10485760,
    ARRAY[
        'application/pdf', 'image/png', 'image/jpeg', 'image/webp',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    ]
)
ON CONFLICT (id) DO NOTHING;

NOTIFY pgrst, 'reload schema';
COMMIT;
