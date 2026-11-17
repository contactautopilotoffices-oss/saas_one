-- =================================================================================
-- Migration: 20261102000001_whatsapp_smart_chat_inbox.sql
-- Description: Smart chat message batching (task-manager/SmartChatInbox.ts).
--   When a person sends several WhatsApp messages back to back, the bot waits until they stop typing, reads them all
--   together and sends ONE reply (like PharmEasy's Swasth.AI). Each Smart chat text message is written here while it waits.
--   claimed_by / claimed_at - set (once, by one webhook) when a reply for that batch starts.
--   done_at                 - set when that reply is finished; the text (body) is blanked at the same moment.
--   Until this migration is applied the bot answers every message on its own, exactly as before.
-- Safety: ADDITIVE ONLY. One new table and two indexes. No existing table, row or policy is changed.
--   Service role only (RLS on, no policies, anon/authenticated revoked) — no app screen can read it.
-- How to apply: run this file once in the Supabase SQL Editor. Safe to re-run.
-- Rollback:
--   DROP TABLE IF EXISTS public.whatsapp_smart_chat_inbox;
-- =================================================================================

CREATE TABLE IF NOT EXISTS public.whatsapp_smart_chat_inbox (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id   TEXT NOT NULL UNIQUE,           -- the provider's message id (a re-delivery is ignored)
    phone        TEXT NOT NULL,                  -- digits only
    body         TEXT NOT NULL DEFAULT '',       -- the message text while it waits; blanked when the reply is finished
    received_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    claimed_by   TEXT,                           -- the webhook answering this batch (one random token per batch)
    claimed_at   TIMESTAMPTZ,
    done_at      TIMESTAMPTZ
);

-- "Which messages from this person are still waiting?"
CREATE INDEX IF NOT EXISTS idx_wa_smart_chat_inbox_waiting
    ON public.whatsapp_smart_chat_inbox (phone, received_at)
    WHERE claimed_by IS NULL;

-- "Is an earlier reply to this person still being written?" / finishing a batch
CREATE INDEX IF NOT EXISTS idx_wa_smart_chat_inbox_claimed
    ON public.whatsapp_smart_chat_inbox (claimed_by)
    WHERE claimed_by IS NOT NULL;

ALTER TABLE public.whatsapp_smart_chat_inbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.whatsapp_smart_chat_inbox FROM anon, authenticated;
GRANT ALL ON public.whatsapp_smart_chat_inbox TO service_role;
