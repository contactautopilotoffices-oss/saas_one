-- =================================================================================
-- Migration: 20261011000001_whatsapp_inbound_ledger.sql
-- Description: "Never silent" (docs/WHATSAPP_BOT_PRODUCTION_PLAN.md, Phase 1).
--   One row per incoming WhatsApp message that a Task Manager route takes (task import, Smart chat, the task router).
--   replied_at       - stamped when the bot sends anything to that phone after the message arrived.
--   apology_sent_at  - stamped when the watchdog sent "Sorry, I couldn't finish that…" because no reply came.
--   NO message text is stored — only the provider message id, the phone number and times.
--   Rows older than 14 days are deleted by the watchdog.
-- Safety: ADDITIVE ONLY. One new table and two indexes. No existing table, row or policy is changed.
--   Service role only (RLS on, no policies, anon/authenticated revoked) — no app screen can read it.
--   While WHATSAPP_NEVER_SILENT_ENABLED is not 'true', nothing writes to this table.
-- How to apply: run this file once in the Supabase SQL Editor (after 20261009000001). Safe to re-run.
-- Rollback:
--   DROP TABLE IF EXISTS public.whatsapp_inbound_ledger;
-- =================================================================================

CREATE TABLE IF NOT EXISTS public.whatsapp_inbound_ledger (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id       TEXT NOT NULL UNIQUE,
    phone            TEXT NOT NULL,
    phone_key        TEXT NOT NULL,             -- last 10 digits, so "+91 98…" and "9198…" match
    route            TEXT,                      -- task_import | smart_chat | task_router | NULL (not a Task Manager message)
    received_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    replied_at       TIMESTAMPTZ,
    apology_sent_at  TIMESTAMPTZ
);

-- "Anything still waiting for a reply from this phone?" (stamping a reply)
CREATE INDEX IF NOT EXISTS idx_wa_inbound_ledger_waiting
    ON public.whatsapp_inbound_ledger (phone_key, received_at)
    WHERE replied_at IS NULL;

-- "Which messages got no reply and no apology?" (the watchdog)
CREATE INDEX IF NOT EXISTS idx_wa_inbound_ledger_overdue
    ON public.whatsapp_inbound_ledger (received_at)
    WHERE replied_at IS NULL AND apology_sent_at IS NULL AND route IS NOT NULL;

ALTER TABLE public.whatsapp_inbound_ledger ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.whatsapp_inbound_ledger FROM anon, authenticated;
GRANT ALL ON public.whatsapp_inbound_ledger TO service_role;
