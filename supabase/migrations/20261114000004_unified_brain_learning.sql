-- Unified Brain, stage 4: learning. Plan: docs/WHATSAPP_UNIFIED_BRAIN_IMPLEMENTATION_PLAN.md.
-- NOT applied automatically: a person runs this migration, after 20261114000003.
--
--   ai_brain_turns.learning   what the brain had been taught when it answered a message: the ids of the lessons it was
--                             shown and the guidance version in force. So a wrong answer can be traced to a lesson.
--   ai_brain_guidance         a short note the Tech team writes for the brain, kept in versions. A version becomes
--                             'live' only after the console has played the whole test set with and without it on the
--                             real model (with fake data) and found nothing unsafe and no fewer passes; the result is
--                             kept in `test`. At most one live version and one draft per organisation.
--                             `rev` and `busy_until` let only one request at a time work on a draft's test, so two
--                             tabs can never overwrite each other's result or spend twice.
--   ai_brain_guidance_runs    one row per test STARTED, never changed or removed by editing or discarding a draft.
--                             The daily limit on tests (they spend model credit) is counted here.
--
-- Lessons need no table of their own: a lesson is an active row of ai_brain_eval_cases (migration 20261114000003).
--
-- Until this runs the brain works as before: no guidance exists, the turn record is written without `learning`, and
-- the console says that guidance is not available yet. Lessons still work once switched on.
--
-- Safety:   ADDITIVE ONLY. One new nullable column, two new tables; no existing row or policy is changed.
--           The new tables have RLS on and NO policies: only the server (service role) reads and writes them, after
--           the Tech-team check. Logged-in users cannot read or write them directly.
-- Safe to re-run.
-- Rollback: DROP TABLE public.ai_brain_guidance_runs, public.ai_brain_guidance;
--           ALTER TABLE public.ai_brain_turns DROP COLUMN learning;

BEGIN;

ALTER TABLE public.ai_brain_turns ADD COLUMN IF NOT EXISTS learning jsonb;

CREATE TABLE IF NOT EXISTS public.ai_brain_guidance (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    version         integer NOT NULL CHECK (version >= 1),
    body            text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 1200),
    status          text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'live', 'retired')),
    -- The result of the test this version was (or is being) put through. Written by the server only.
    test            jsonb,
    -- Moves on with every change to the row. A write that started from an older revision changes nothing.
    rev             integer NOT NULL DEFAULT 0,
    -- Set while a request is playing a step of this draft's test; another request waits until it is cleared or has passed.
    busy_until      timestamptz,
    created_by      uuid REFERENCES public.users(id) ON DELETE SET NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    activated_by    uuid REFERENCES public.users(id) ON DELETE SET NULL,
    activated_at    timestamptz,
    UNIQUE (organization_id, version)
);
-- The database itself refuses a second live version or a second draft, whatever the code does.
CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_brain_guidance_live ON public.ai_brain_guidance (organization_id) WHERE status = 'live';
CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_brain_guidance_draft ON public.ai_brain_guidance (organization_id) WHERE status = 'draft';
ALTER TABLE public.ai_brain_guidance ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.ai_brain_guidance_runs (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    -- Kept when the draft is discarded: the test was still started and still counts.
    version_id      uuid REFERENCES public.ai_brain_guidance(id) ON DELETE SET NULL,
    version         integer,
    model           text NOT NULL,
    started_by      uuid REFERENCES public.users(id) ON DELETE SET NULL,
    started_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ai_brain_guidance_runs_org_time ON public.ai_brain_guidance_runs (organization_id, started_at DESC);
ALTER TABLE public.ai_brain_guidance_runs ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';

COMMIT;
