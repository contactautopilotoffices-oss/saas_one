-- =================================================================================
-- Migration: 20261026000004_task_manager_collaboration.sql
-- Description: Cross-department collaboration in the Task Manager "Send" tab (owner 2026-10-26).
--   task_requests   A SUPPORT REQUEST from one person to someone in another department. It waits for the receiver:
--                   "accepted" creates a normal task on their list (task_id points at it); "declined" keeps their
--                   reason for the sender. Nothing about it shows on task lists, reminders or reports until accepted.
--   task_attachments.request_id
--                   Files sent with a support request are kept against the request and move onto the task when it is
--                   accepted. (Tasks given directly to another department use the existing task_id, unchanged.)
-- Requires: 20261026000003_task_manager_upgrades.sql (task_attachments) to be applied first.
-- Safety: ADDITIVE ONLY. One new table; one new nullable column and one relaxed NOT NULL on the table created by
--         20261026000003 (still new; a CHECK keeps every row tied to a task or a request). Existing rows unchanged.
--         Safe to re-run.
-- How to apply: run this file once in the Supabase SQL Editor (after 20261026000003).
-- Rollback:   ALTER TABLE public.task_attachments DROP CONSTRAINT task_attachments_owner_check, DROP COLUMN request_id;
--             (only if every row has a task_id:) ALTER TABLE public.task_attachments ALTER COLUMN task_id SET NOT NULL;
--             DROP TABLE public.task_requests;
-- =================================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.task_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    from_user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    to_user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
    description TEXT CHECK (description IS NULL OR char_length(description) <= 1000),
    needed_by DATE,
    state TEXT NOT NULL DEFAULT 'awaiting' CHECK (state IN ('awaiting', 'accepted', 'declined')),
    decline_reason TEXT CHECK (decline_reason IS NULL OR char_length(decline_reason) <= 300),
    task_id UUID REFERENCES public.task_assignments(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    responded_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_task_requests_to_state ON public.task_requests(to_user_id, state);
CREATE INDEX IF NOT EXISTS idx_task_requests_from ON public.task_requests(from_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_task_requests_task ON public.task_requests(task_id) WHERE task_id IS NOT NULL;
-- One waiting request per sender, receiver and title (a double click or a retry cannot send it twice)
CREATE UNIQUE INDEX IF NOT EXISTS uq_task_requests_awaiting
    ON public.task_requests(from_user_id, to_user_id, lower(title)) WHERE state = 'awaiting';

-- Server code only (service role bypasses RLS); no policies, so browsers cannot read the table directly.
ALTER TABLE public.task_requests ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.task_attachments
    ADD COLUMN IF NOT EXISTS request_id UUID REFERENCES public.task_requests(id) ON DELETE CASCADE;
ALTER TABLE public.task_attachments ALTER COLUMN task_id DROP NOT NULL;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'task_attachments_owner_check') THEN
        ALTER TABLE public.task_attachments
            ADD CONSTRAINT task_attachments_owner_check CHECK (task_id IS NOT NULL OR request_id IS NOT NULL);
    END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_task_attachments_request ON public.task_attachments(request_id) WHERE request_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
COMMIT;
