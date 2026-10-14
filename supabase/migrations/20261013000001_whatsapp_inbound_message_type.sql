-- =================================================================================
-- Migration: 20261013000001_whatsapp_inbound_message_type.sql
-- Description: the KIND of each incoming WhatsApp message in the "never silent" ledger — "text", "audio", "button",
--   "image", … plus "+reply" when it quotes an earlier message. Lets us check odd cases (a reply to something nobody
--   remembers sending) in seconds. NO message text or content is stored, only the kind.
-- Safety: ADDITIVE ONLY. One nullable column on public.whatsapp_inbound_ledger. No row, index or policy is changed.
--   The app works before and after this runs (until it is applied, rows are written without the kind).
-- How to apply: run this file once in the Supabase SQL Editor (after 20261011000001). Safe to re-run.
-- Rollback:
--   ALTER TABLE public.whatsapp_inbound_ledger DROP COLUMN IF EXISTS message_type;
-- =================================================================================

ALTER TABLE public.whatsapp_inbound_ledger
    ADD COLUMN IF NOT EXISTS message_type TEXT;
