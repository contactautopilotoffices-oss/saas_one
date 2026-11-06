-- =================================================================================
-- Migration: 20261011000002_whatsapp_conversation_memory.sql
-- Description: Conversation memory for the WhatsApp Task Manager bot (docs/WHATSAPP_BOT_PRODUCTION_PLAN.md, Phase 2).
--   One row per phone: the last 20 messages of the chat (both sides), so the AI can follow the running thread
--   ("make it tomorrow instead", "the second one"). Approved by the owner on 2026-10-11.
--   turns       - JSON array of { "who": "person" | "bot", "text": "...", "at": "<ISO time>" }, oldest first, at most 20.
--   expires_at  - 24 hours after the last message. Expired rows are ignored on read, reset on the next message, and deleted
--                 by the watchdog cron.
--   whatsapp_memory_append() adds one turn and trims to the newest N in ONE statement, so rapid messages that arrive at
--   the same moment cannot overwrite each other.
-- Safety: ADDITIVE ONLY. One new table, one index, one new function. No existing table, row or policy is changed.
--   Service role only (RLS on, no policies, anon/authenticated revoked; function EXECUTE revoked from public).
--   While WHATSAPP_MEMORY_ENABLED is not 'true', nothing reads or writes this table.
-- How to apply: run this file once in the Supabase SQL Editor (after 20261011000001). Safe to re-run.
-- Rollback:
--   DROP FUNCTION IF EXISTS public.whatsapp_memory_append(text, jsonb, integer);
--   DROP TABLE IF EXISTS public.whatsapp_conversation_memory;
-- =================================================================================

CREATE TABLE IF NOT EXISTS public.whatsapp_conversation_memory (
    phone_key   TEXT PRIMARY KEY,                       -- last 10 digits of the phone number
    turns       JSONB NOT NULL DEFAULT '[]'::jsonb,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at  TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '24 hours')
);

CREATE INDEX IF NOT EXISTS idx_wa_conversation_memory_expires
    ON public.whatsapp_conversation_memory (expires_at);

ALTER TABLE public.whatsapp_conversation_memory ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.whatsapp_conversation_memory FROM anon, authenticated;
GRANT ALL ON public.whatsapp_conversation_memory TO service_role;

-- Add one turn, keep only the newest p_keep (by time), and push expiry to 24 hours from now. An expired row starts fresh.
CREATE OR REPLACE FUNCTION public.whatsapp_memory_append(p_phone_key text, p_turn jsonb, p_keep integer DEFAULT 20)
RETURNS void
LANGUAGE sql
SET search_path = public
AS $$
    INSERT INTO public.whatsapp_conversation_memory AS m (phone_key, turns, updated_at, expires_at)
    VALUES (p_phone_key, jsonb_build_array(p_turn), now(), now() + interval '24 hours')
    ON CONFLICT (phone_key) DO UPDATE SET
        turns = (
            SELECT COALESCE(jsonb_agg(s.t ORDER BY s.t->>'at'), '[]'::jsonb)
            FROM (
                SELECT x.t
                FROM jsonb_array_elements(
                    (CASE WHEN m.expires_at < now() THEN '[]'::jsonb ELSE m.turns END) || jsonb_build_array(p_turn)
                ) AS x(t)
                ORDER BY x.t->>'at' DESC
                LIMIT GREATEST(LEAST(p_keep, 50), 1)
            ) AS s
        ),
        updated_at = now(),
        expires_at = now() + interval '24 hours';
$$;

REVOKE ALL ON FUNCTION public.whatsapp_memory_append(text, jsonb, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.whatsapp_memory_append(text, jsonb, integer) TO service_role;
