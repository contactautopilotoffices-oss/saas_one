-- =================================================================================
-- Migration: 20261103000001_voice_id.sql
-- Description: owner 2026-11-02 — LiveVoice ID: name who spoke in Meeting Assistant meetings from voices people set up.
--   Plan: docs/LIVEVOICE_ID_PLAN.md
--   1. public.voice_profiles        one voiceprint (192 numbers) per person who set up their voice. NEVER audio.
--   2. task_manager_department_settings.voice_id   "Recognise speakers by voice" switch per department (OFF everywhere).
--   3. meeting_notes.status         one more processing step, 'identifying' (between 'transcribing' and 'extracting').
--   4. meeting_note_tasks.asked_by_user_id   who asked for the task (filled only when voices were recognised).
-- Safety: ADDITIVE. One new empty table (row level security on, no policies: only server code with the service role reads
--         or writes it), two new columns with safe defaults, and the status list widened by one value (every existing
--         status stays allowed). No existing row is changed. Safe to re-run. Until this runs, voice setup says it is not
--         ready and meetings work exactly as before.
-- After applying: switch "Recognise speakers by voice" ON for Tech in Task Manager → Control Center.
-- How to apply: run this file once in the Supabase SQL Editor.
-- Rollback:   ALTER TABLE public.meeting_note_tasks DROP COLUMN asked_by_user_id;
--             ALTER TABLE public.task_manager_department_settings DROP COLUMN voice_id;
--             DROP TABLE public.voice_profiles;
--             (status: first move any 'identifying' meeting to 'extracting', then restore the old check without it)
-- =================================================================================

BEGIN;

-- 1. Voiceprints ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.voice_profiles (
    user_id UUID PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
    -- ECAPA-TDNN speaker embedding, unit length. Numbers only: the voice cannot be played back from it.
    voiceprint REAL[] NOT NULL CHECK (cardinality(voiceprint) = 192),
    model TEXT NOT NULL,
    model_revision TEXT,
    -- How alike the setup clips were (cosine, 0 to 1). Low = noisy room or a different person on one clip.
    clip_agreement REAL NOT NULL,
    -- Which consent text the person agreed to, and when
    consent_version TEXT NOT NULL,
    consented_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.voice_profiles ENABLE ROW LEVEL SECURITY;

-- 2. Department switch ----------------------------------------------------------------
ALTER TABLE public.task_manager_department_settings
    ADD COLUMN IF NOT EXISTS voice_id BOOLEAN NOT NULL DEFAULT false;

-- 3. Processing step 'identifying' ------------------------------------------------
ALTER TABLE public.meeting_notes DROP CONSTRAINT IF EXISTS meeting_notes_status_check;
ALTER TABLE public.meeting_notes ADD CONSTRAINT meeting_notes_status_check
    CHECK (status IN ('recording', 'uploaded', 'transcribing', 'identifying', 'extracting', 'ready', 'failed', 'discarded'));

-- 4. Who asked for a task -------------------------------------------------------------
ALTER TABLE public.meeting_note_tasks
    ADD COLUMN IF NOT EXISTS asked_by_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL;

COMMIT;
