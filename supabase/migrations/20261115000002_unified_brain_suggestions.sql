-- Unified Brain: the rest of the learning loop (owner 2026-11-15). Plan: docs/WHATSAPP_UNIFIED_BRAIN_IMPLEMENTATION_PLAN.md.
-- NOT applied automatically: a person runs this migration, after 20261114000004.
--
--   ai_brain_guidance_runs.kind   what was started: 'test' (a draft note played against the test set, as before) or
--                                 'suggest' (the brain was asked to propose words for a note from the answers the Tech
--                                 team judged wrong). Both spend model credit, so both are counted here, each against
--                                 its own daily limit.
--
-- Until this runs nothing changes for anyone: tests of a note are counted exactly as before, and the console says that
-- suggestions are not available yet.
--
-- Safety:   ADDITIVE ONLY. One new column with a default, so every existing row reads as 'test', which is what it is.
--           No row is rewritten by hand, no table or policy is changed.
-- Safe to re-run.
-- Rollback: ALTER TABLE public.ai_brain_guidance_runs DROP COLUMN kind;

BEGIN;

ALTER TABLE public.ai_brain_guidance_runs
    ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'test';

ALTER TABLE public.ai_brain_guidance_runs DROP CONSTRAINT IF EXISTS ai_brain_guidance_runs_kind_check;
ALTER TABLE public.ai_brain_guidance_runs
    ADD CONSTRAINT ai_brain_guidance_runs_kind_check CHECK (kind IN ('test', 'suggest'));

NOTIFY pgrst, 'reload schema';

COMMIT;
