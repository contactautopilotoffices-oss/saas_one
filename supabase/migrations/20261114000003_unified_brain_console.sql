-- Unified Brain console: what the Review screen needs. Plan: docs/WHATSAPP_UNIFIED_BRAIN_IMPLEMENTATION_PLAN.md.
-- NOT applied automatically: a person runs this migration, after 20261114000002.
--
--   ai_brain_turns.role_class   the kind of login that sent the message (staff / client / vendor), so the console can
--                               judge an answer without ever showing who the person is
--   ai_brain_eval_cases         a turn a Tech reviewer judged right or wrong, kept as a test case for the brain.
--                               It holds the message with phone numbers, emails and ids masked, and NO column that says
--                               who sent it (owner 2026-11-14: the console shows messages, never the person)
--
-- Until this runs the brain works as before: the turn record is written without role_class, and the Review screen
-- says that judging is not available yet.
--
-- Safety:   ADDITIVE ONLY. One new nullable column, one new table; no existing row or policy is changed.
--           The new table has RLS on and NO policies: only the server (service role) reads and writes it, after the
--           Tech-team check. Logged-in users cannot read or write it directly.
-- Safe to re-run.
-- Rollback: DROP TABLE public.ai_brain_eval_cases;  ALTER TABLE public.ai_brain_turns DROP COLUMN role_class;

BEGIN;

ALTER TABLE public.ai_brain_turns ADD COLUMN IF NOT EXISTS role_class text;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_brain_turns_role_class_check') THEN
        ALTER TABLE public.ai_brain_turns
            ADD CONSTRAINT ai_brain_turns_role_class_check CHECK (role_class IS NULL OR role_class IN ('staff', 'client', 'vendor'));
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.ai_brain_eval_cases (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id  uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    -- The judged turn, so a second judgement replaces the first. Set to NULL when the turn's words are cleared after the
    -- organisation's retention period (and if the turn row is ever removed): from then on nothing ties this case to
    -- the person who wrote the message. The masked message itself is kept: it is what the brain is tested on.
    source_turn_id   uuid REFERENCES public.ai_brain_turns(id) ON DELETE SET NULL,
    message_text     text NOT NULL,
    role_class       text NOT NULL CHECK (role_class IN ('staff', 'client', 'vendor')),
    channel          text NOT NULL CHECK (channel IN ('whatsapp', 'app_chat')),
    verdict          text NOT NULL CHECK (verdict IN ('right', 'wrong')),
    got_outcome      text,
    got_skill        text,
    expected_outcome text NOT NULL,
    expected_skill   text,
    note             text,
    active           boolean NOT NULL DEFAULT true,
    -- The Tech reviewer, for the record of who judged. Never the person who sent the message.
    created_by       uuid REFERENCES public.users(id) ON DELETE SET NULL,
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now()
);
-- One judgement per turn: judging again replaces the earlier one. (Rows whose turn is gone have NULL here; NULLs never
-- collide in a unique index.)
CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_brain_eval_cases_turn ON public.ai_brain_eval_cases (source_turn_id);
CREATE INDEX IF NOT EXISTS idx_ai_brain_eval_cases_org ON public.ai_brain_eval_cases (organization_id, created_at DESC);
ALTER TABLE public.ai_brain_eval_cases ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';

COMMIT;
