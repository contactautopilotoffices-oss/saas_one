-- Migration: 20261030000003_proctor_grants_resume_shuffle.sql
-- Description: Proctored assessments, round four (HR Phase 1).
--   · HR can give a candidate another chance, or reset their attempts, with an
--     optional note. Chances are counted from attempts after the last reset,
--     plus any extra chances granted since.
--   · Shuffle: each attempt stores the order its questions (within each
--     section) and options were shown in, so answers map back to the key.
--   · Autosave and resume: answers are saved as they are picked, and a
--     heartbeat records when the page was last seen. An attempt whose page went
--     silent (crash, power, network) can be resumed within 5 minutes.
-- Depends on: 20260922000001, 20260922000002, 20260923000001

-- 1. Tests ------------------------------------------------------------------
ALTER TABLE public.proctor_tests
    ADD COLUMN IF NOT EXISTS shuffle BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;

-- 2. HR grants: another chance, or a reset ----------------------------------
CREATE TABLE IF NOT EXISTS public.proctor_grants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    test_id UUID NOT NULL REFERENCES public.proctor_tests(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    -- Who it is for: a signed-in member, or a candidate known by email.
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    candidate_email TEXT,
    kind TEXT NOT NULL CHECK (kind IN ('extra_chance', 'reset')),
    note TEXT,
    created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (user_id IS NOT NULL OR candidate_email IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_proctor_grants_test ON public.proctor_grants(test_id, created_at);

-- 3. Attempts: shuffle order, autosave/resume -------------------------------
ALTER TABLE public.proctor_attempts
    -- [{ "id": "q3", "options": [2, 0, 1, 3] }, ...] in the order shown
    ADD COLUMN IF NOT EXISTS question_order JSONB,
    ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS resume_count INT NOT NULL DEFAULT 0;

ALTER TABLE public.proctor_grants ENABLE ROW LEVEL SECURITY;
-- No policies on purpose: the API (service role) is the only reader and writer.

COMMENT ON COLUMN public.proctor_tests.shuffle IS 'Shuffle question order within each section, and option order, per attempt.';
COMMENT ON TABLE public.proctor_grants IS 'HR actions: extra_chance adds one chance; reset discounts every earlier attempt.';
COMMENT ON COLUMN public.proctor_attempts.question_order IS 'Order questions and options were shown in; answers are stored against the original option index.';
COMMENT ON COLUMN public.proctor_attempts.last_seen_at IS 'Last autosave/heartbeat from the test page; an attempt silent for under 5 minutes can be resumed.';
