-- =================================================================================
-- Migration: 20261007000006_task_manager_superuser_pings.sql
-- Description: Working with a superuser (e.g. Saniel).
--   1. superuser_collab_enabled - a switch per department: "this team may give tasks to a superuser and send them
--      "these are pending for you" reminders". OFF by default; nothing changes until you switch a team ON.
--   2. superuser_reminder - the team's ONE shared schedule of regular reminders to the superuser
--      ({ "enabled": true, "time": "09:30", "days": [1,2,3,4,5], "recipientId": "<user id>", "lastRunDate": "2026-10-08" }).
--   3. task_pings - every reminder that was sent or is scheduled to be sent (sent now, or later).
-- Safety: ADDITIVE ONLY. Two new columns with safe defaults and one new table. No existing row is changed or removed.
-- How to apply: run this file once in the Supabase SQL Editor (after 20261007000001).
-- Rollback:
--   DROP TABLE IF EXISTS public.task_pings;
--   ALTER TABLE public.task_manager_department_settings DROP COLUMN superuser_collab_enabled, DROP COLUMN superuser_reminder;
-- =================================================================================

ALTER TABLE public.task_manager_department_settings
    ADD COLUMN IF NOT EXISTS superuser_collab_enabled BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS superuser_reminder JSONB;

CREATE TABLE IF NOT EXISTS public.task_pings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    department_id UUID NOT NULL REFERENCES public.departments(id) ON DELETE CASCADE,
    created_by UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    recipient_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    from_label TEXT NOT NULL,
    note TEXT,
    task_ids UUID[] NOT NULL,
    send_at TIMESTAMPTZ NOT NULL,
    status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'sending', 'sent', 'failed', 'cancelled')),
    sent_at TIMESTAMPTZ,
    error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_task_pings_due ON public.task_pings(status, send_at);
CREATE INDEX IF NOT EXISTS idx_task_pings_recipient ON public.task_pings(recipient_id, status, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_task_pings_department ON public.task_pings(department_id, created_at DESC);

ALTER TABLE public.task_pings ENABLE ROW LEVEL SECURITY;
