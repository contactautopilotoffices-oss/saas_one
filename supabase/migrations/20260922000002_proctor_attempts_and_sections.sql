-- Migration: 20260922000002_proctor_attempts_and_sections.sql
-- Description: Proctored tests, round two.
--   · More than one chance per test (default 2). An attempt closed for leaving
--     the page uses a chance; a submitted attempt ends it — no retake to improve
--     a score.
--   · Questions carry a section (cognitive / aptitude / culture / situational)
--     inside proctor_tests.questions; the per-section score of each attempt is
--     stored at submit so results don't have to re-grade.
-- Depends on: 20260922000001_proctored_tests.sql

ALTER TABLE public.proctor_tests
    ADD COLUMN IF NOT EXISTS max_attempts INT NOT NULL DEFAULT 2;

ALTER TABLE public.proctor_tests DROP CONSTRAINT IF EXISTS proctor_tests_max_attempts_check;
ALTER TABLE public.proctor_tests
    ADD CONSTRAINT proctor_tests_max_attempts_check CHECK (max_attempts BETWEEN 1 AND 5);

ALTER TABLE public.proctor_attempts
    ADD COLUMN IF NOT EXISTS attempt_no INT NOT NULL DEFAULT 1,
    -- { "cognitive": { "score": 4, "total": 5 }, ... }
    ADD COLUMN IF NOT EXISTS section_scores JSONB NOT NULL DEFAULT '{}'::jsonb;

-- One row per person per test becomes one row per person per test per chance.
ALTER TABLE public.proctor_attempts DROP CONSTRAINT IF EXISTS proctor_attempts_test_id_user_id_key;
ALTER TABLE public.proctor_attempts DROP CONSTRAINT IF EXISTS proctor_attempts_test_user_attempt_key;
ALTER TABLE public.proctor_attempts
    ADD CONSTRAINT proctor_attempts_test_user_attempt_key UNIQUE (test_id, user_id, attempt_no);

COMMENT ON COLUMN public.proctor_tests.max_attempts IS 'Chances per person. Leaving the page uses one; submitting ends the test.';
COMMENT ON COLUMN public.proctor_attempts.section_scores IS 'Per-section score at submit: { section: { score, total } }.';
