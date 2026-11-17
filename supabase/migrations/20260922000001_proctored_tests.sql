-- Migration: 20260922000001_proctored_tests.sql
-- Description: AI proctored tests (MVP). An admin writes a short multiple-choice
--              test; an employee takes it on a locked page (fullscreen + camera).
--              Leaving the page — tab switch, window switch, exiting fullscreen,
--              closing/refreshing, camera off — ends the attempt. A webcam frame
--              is checked by a vision model every ~20s; those checks only FLAG
--              for a human reviewer, they never end the attempt.
--
-- All writes go through the API with the service role (same convention as the
-- asset and AOP modules). RLS is enabled with no policies, so the browser
-- cannot read answer keys or other people's attempts directly.

-- 1. Tests
CREATE TABLE IF NOT EXISTS public.proctor_tests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    instructions TEXT,
    -- [{ "id": "q1", "text": "...", "options": ["a","b","c","d"], "answer_index": 2 }]
    questions JSONB NOT NULL DEFAULT '[]'::jsonb,
    duration_minutes INT NOT NULL DEFAULT 15 CHECK (duration_minutes BETWEEN 1 AND 180),
    ai_monitoring BOOLEAN NOT NULL DEFAULT TRUE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_proctor_tests_org ON public.proctor_tests(organization_id, created_at DESC);

-- 2. Attempts — one per person per test. Leaving the page is final; a retake
--    means an admin deletes the attempt row.
CREATE TABLE IF NOT EXISTS public.proctor_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    test_id UUID NOT NULL REFERENCES public.proctor_tests(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'in_progress'
        CHECK (status IN ('in_progress', 'submitted', 'terminated', 'expired')),
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ended_at TIMESTAMPTZ,
    -- tab_hidden | window_blur | fullscreen_exit | page_unload | camera_lost
    termination_reason TEXT,
    answers JSONB NOT NULL DEFAULT '{}'::jsonb,
    score INT,
    total INT,
    ai_checks INT NOT NULL DEFAULT 0,
    ai_flags INT NOT NULL DEFAULT 0,
    UNIQUE (test_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_proctor_attempts_test ON public.proctor_attempts(test_id, started_at DESC);

-- 3. Event log — every lock violation and every AI verdict, append-only.
CREATE TABLE IF NOT EXISTS public.proctor_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    attempt_id UUID NOT NULL REFERENCES public.proctor_attempts(id) ON DELETE CASCADE,
    -- violation kinds above, plus ai_ok | ai_flag | ai_error
    kind TEXT NOT NULL,
    detail JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_proctor_events_attempt ON public.proctor_events(attempt_id, created_at);

-- Counter bump used by the snapshot route, so two in-flight checks can't
-- overwrite each other's count.
CREATE OR REPLACE FUNCTION public.proctor_bump_ai_counts(p_attempt_id UUID, p_flagged BOOLEAN)
RETURNS VOID
LANGUAGE sql
AS $$
    UPDATE public.proctor_attempts
       SET ai_checks = ai_checks + 1,
           ai_flags  = ai_flags + CASE WHEN p_flagged THEN 1 ELSE 0 END
     WHERE id = p_attempt_id;
$$;

ALTER TABLE public.proctor_tests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.proctor_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.proctor_events ENABLE ROW LEVEL SECURITY;

-- No policies on purpose: the API (service role) is the only reader and writer.

COMMENT ON TABLE public.proctor_tests IS 'AI proctored tests. questions[].answer_index is the answer key — never sent to the test taker.';
COMMENT ON TABLE public.proctor_attempts IS 'One attempt per user per test. terminated = the taker left the locked page.';
COMMENT ON TABLE public.proctor_events IS 'Proctoring log: lock violations and per-snapshot AI verdicts.';
