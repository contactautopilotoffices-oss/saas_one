-- =================================================================================
-- TASK MANAGER — import tasks from Zoho Mail (read-only)
-- ---------------------------------------------------------------------------------
-- Each person clicks "Connect Zoho Tasks" in the Task Manager and consents for THEIR
-- OWN Zoho account (scope ZohoMail.tasks.READ only). Every 15 minutes the task-manager
-- cron copies their open Zoho tasks (assigned to them + personal) into their list.
--
--   task_assignments.source        'zoho' for an imported task; NULL for every task made in this app.
--   task_assignments.external_id   Zoho's task id. Together with employee_id + source it stops a task
--                                  being imported twice (also under concurrent runs).
--   task_zoho_connections          One row per person: their encrypted Zoho refresh token + sync health.
--   task_zoho_oauth_state          Single-use state for an in-flight consent (replay protection).
--
-- Safety: ADDITIVE ONLY. Two nullable columns, one partial unique index, two new tables.
--         Existing rows and behaviour are unchanged. Safe to re-run.
--         The app works before this is applied (the Connect button reports that setup is incomplete).
-- Secrets: refresh_token_enc is AES-256-GCM encrypted in the app (MAIL_TOKEN_KEY) before it is written.
--          RLS on with NO permissive policy — only the service role can read either table.
-- How to apply: run this file once in the Supabase SQL Editor.
-- Rollback:   DROP TABLE public.task_zoho_oauth_state; DROP TABLE public.task_zoho_connections;
--             DROP INDEX public.uq_task_assignments_external;
--             ALTER TABLE public.task_assignments DROP COLUMN source, DROP COLUMN external_id;
-- =================================================================================

BEGIN;

ALTER TABLE public.task_assignments
    ADD COLUMN IF NOT EXISTS source TEXT,
    ADD COLUMN IF NOT EXISTS external_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_task_assignments_external
    ON public.task_assignments(employee_id, source, external_id)
    WHERE external_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.task_zoho_connections (
    user_id           UUID PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
    zoho_email        TEXT,
    -- AES-256-GCM, base64. NEVER returned to a client, never logged.
    refresh_token_enc TEXT NOT NULL,
    -- Which Zoho data centre minted it (com, in, eu ...). A refresh token is DC-locked.
    dc                TEXT NOT NULL DEFAULT 'com',
    scopes            TEXT,
    connected_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_sync_at      TIMESTAMPTZ,
    last_imported     INTEGER,
    last_error        TEXT,
    is_active         BOOLEAN NOT NULL DEFAULT true
);

COMMENT ON TABLE public.task_zoho_connections IS
    'SECRETS. RLS on with no permissive policy: only the service role reads it. refresh_token_enc must never reach a client or a log.';

ALTER TABLE public.task_zoho_connections ENABLE ROW LEVEL SECURITY;
-- Deliberately NO permissive policy. Service role only.

CREATE TABLE IF NOT EXISTS public.task_zoho_oauth_state (
    state        TEXT PRIMARY KEY,
    user_id      UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    consumed_at  TIMESTAMPTZ
);

ALTER TABLE public.task_zoho_oauth_state ENABLE ROW LEVEL SECURITY;

COMMIT;
