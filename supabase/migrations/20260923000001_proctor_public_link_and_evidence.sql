-- Migration: 20260923000001_proctor_public_link_and_evidence.sql
-- Description: Proctored assessments, round three.
--   · A public test link (/t/<token>) that needs no sign-in. The person types
--     their name and email, and the attempt is identified by a secret token
--     issued at start, not by a login.
--   · Sections with their own title and description, like a form.
--   · Strikes: after N flagged "not looking at the screen" checks (default 3)
--     the attempt closes.
--   · Evidence: a private bucket holding the webcam frames that were flagged
--     for a phone or a second person, for the reviewer to look at.
-- Depends on: 20260922000001, 20260922000002

-- 1. Tests: sections, strikes, public link ---------------------------------
ALTER TABLE public.proctor_tests
    -- [{ "key": "cognitive", "title": "Cognitive ability", "description": "..." }]
    ADD COLUMN IF NOT EXISTS sections JSONB NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS look_away_strikes INT NOT NULL DEFAULT 3,
    ADD COLUMN IF NOT EXISTS public_token TEXT;

ALTER TABLE public.proctor_tests DROP CONSTRAINT IF EXISTS proctor_tests_look_away_strikes_check;
ALTER TABLE public.proctor_tests
    ADD CONSTRAINT proctor_tests_look_away_strikes_check CHECK (look_away_strikes BETWEEN 1 AND 20);

UPDATE public.proctor_tests SET public_token = encode(gen_random_bytes(12), 'hex') WHERE public_token IS NULL;
ALTER TABLE public.proctor_tests ALTER COLUMN public_token SET DEFAULT encode(gen_random_bytes(12), 'hex');
ALTER TABLE public.proctor_tests ALTER COLUMN public_token SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_proctor_tests_public_token ON public.proctor_tests(public_token);

-- 2. Attempts: a candidate without an account -------------------------------
ALTER TABLE public.proctor_attempts ALTER COLUMN user_id DROP NOT NULL;

ALTER TABLE public.proctor_attempts
    ADD COLUMN IF NOT EXISTS candidate_name TEXT,
    ADD COLUMN IF NOT EXISTS candidate_email TEXT,
    -- Secret handed to the browser at start; how a signed-out taker's own page
    -- proves the attempt is theirs on every later call.
    ADD COLUMN IF NOT EXISTS attempt_token TEXT NOT NULL DEFAULT encode(gen_random_bytes(16), 'hex');

CREATE UNIQUE INDEX IF NOT EXISTS uq_proctor_attempts_token ON public.proctor_attempts(attempt_token);

ALTER TABLE public.proctor_attempts DROP CONSTRAINT IF EXISTS proctor_attempts_identity_check;
ALTER TABLE public.proctor_attempts
    ADD CONSTRAINT proctor_attempts_identity_check
    CHECK (user_id IS NOT NULL OR candidate_email IS NOT NULL);

-- Chances for a signed-out candidate are counted per email address on the test.
-- (Someone can still type a different email; that is the cost of no sign-in.)
CREATE UNIQUE INDEX IF NOT EXISTS uq_proctor_attempts_email_attempt
    ON public.proctor_attempts (test_id, lower(candidate_email), attempt_no)
    WHERE candidate_email IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_proctor_attempts_email ON public.proctor_attempts (test_id, lower(candidate_email));

-- 3. Evidence bucket --------------------------------------------------------
-- Private: webcam frames of a person. Reviewers see them through short-lived
-- signed URLs issued by the results API; there are no storage policies, so the
-- service role is the only way in.
INSERT INTO storage.buckets (id, name, public)
VALUES ('proctor-evidence', 'proctor-evidence', false)
ON CONFLICT (id) DO NOTHING;

COMMENT ON COLUMN public.proctor_tests.sections IS 'Ordered sections with title and description; questions reference a section key.';
COMMENT ON COLUMN public.proctor_tests.look_away_strikes IS 'Flagged "not looking at screen" checks allowed before the attempt closes.';
COMMENT ON COLUMN public.proctor_tests.public_token IS 'Secret in the no-sign-in link: /t/<public_token>.';
COMMENT ON COLUMN public.proctor_attempts.attempt_token IS 'Secret issued at start; authenticates a signed-out taker on later calls.';
