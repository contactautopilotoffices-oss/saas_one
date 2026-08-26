-- Migration: add transcript columns to omnichannel_call_logs
-- Date: 2026-08-26
--
-- WHY: app/api/voice/webhook/route.ts writes a `summary` column on every
-- Bolna post-call event, but 20260825_omnichannel_voice_calling.sql never
-- created it. That UPDATE has been failing silently, so no Bolna call has
-- ever written its transcript back. `spoken_script` is not a substitute —
-- that is what WE said, not what the other party said.
--
-- Adds:
--   summary          — Bolna's conversation summary (what the webhook already writes)
--   transcript       — full turn-by-turn transcript
--   provider         — which stack placed the call, so the aggregator can tell
--                      plivo_direct from bolna_plivo from whatsapp
--   agent_id         — which agent spoke (Ira, Radhika, ...)

ALTER TABLE omnichannel_call_logs
    ADD COLUMN IF NOT EXISTS summary    TEXT,
    ADD COLUMN IF NOT EXISTS transcript TEXT,
    ADD COLUMN IF NOT EXISTS provider   TEXT,
    ADD COLUMN IF NOT EXISTS agent_id   TEXT;

-- Existing rows predate the provider split; they were all Plivo direct.
UPDATE omnichannel_call_logs
   SET provider = 'plivo_direct'
 WHERE provider IS NULL;

CREATE INDEX IF NOT EXISTS idx_call_logs_provider
    ON omnichannel_call_logs (provider, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_call_logs_bolna
    ON omnichannel_call_logs (bolna_call_id)
    WHERE bolna_call_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
