-- =================================================================================
-- Migration: 20261029100001_meeting_notes.sql
-- Description: owner 2026-10-29 — Meeting Notes → Tasks (the Tech dashboard's "Meetings" tab).
--   An in-room meeting is recorded on one phone, turned into a transcript, and an AI writes a summary, notes,
--   decisions and a list of draft tasks. A Tech user reviews the list and presses Send; each task is created in the
--   person's Task Manager list "from Autopilot" (no human sender). Plan + spec: docs/MEETING_TASKS_SPEC.md
--   1. public.meeting_notes       one row per meeting: who was present, status, transcript, summary.
--   2. public.meeting_note_tasks  one row per draft task; `status` 'sent' + `task_id` once it was sent.
--   3. storage bucket 'meeting-audio' (private) — TEMPORARY audio pieces. The app deletes them as soon as the
--      transcript is saved (owner: keep the transcript only, never the audio).
-- Safety: ADDITIVE ONLY. Two new empty tables (row level security on, no policies: only server code with the service
--         role reads or writes them) and one new private bucket. No existing table, row or behaviour changes.
--         Safe to re-run. The rest of the app works before this is applied; the Meetings tab says it is not set up.
-- Names: NOT "meetings" / "meeting_tasks" — public.meetings already belongs to the Ira meeting room (20261006000003).
-- How to apply: run this file once in the Supabase SQL Editor (if an earlier draft of it was run, also run
--               20261029100002_meeting_notes_cleanup.sql).
-- Rollback:   DROP TABLE public.meeting_note_tasks; DROP TABLE public.meeting_notes;
--             DELETE FROM storage.buckets WHERE id = 'meeting-audio';  (empty the bucket first)
-- =================================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.meeting_notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 150),
    meeting_date DATE NOT NULL DEFAULT ((now() AT TIME ZONE 'Asia/Kolkata')::date),
    created_by UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    -- People present: Task Manager users (ids) and names typed in by hand (not in the system)
    attendee_ids UUID[] NOT NULL DEFAULT '{}',
    extra_names TEXT[] NOT NULL DEFAULT '{}',
    -- Confidential = only the person who created it can open it
    confidential BOOLEAN NOT NULL DEFAULT false,
    status TEXT NOT NULL DEFAULT 'recording'
        CHECK (status IN ('recording', 'uploaded', 'transcribing', 'extracting', 'ready', 'failed', 'discarded')),
    error TEXT,
    duration_seconds NUMERIC,
    -- Speech-to-text job: provider, job id, files, models tried
    stt JSONB,
    -- [{ "speaker": "Speaker 1" | null, "start": 12.3, "end": 15.1, "text": "..." }]
    transcript JSONB,
    -- { "summary": "...", "notes": [{ "topic", "points": [] }], "decisions": [], "openQuestions": [] }
    summary JSONB,
    -- Model used for the summary/tasks, tokens, fallbacks
    llm JSONB,
    -- Short lock so two browser polls never run the same processing step twice
    lease_until TIMESTAMPTZ,
    -- How many times the current step was started; a step that keeps getting cut off is given up after a few tries
    attempts INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS meeting_notes_created_at_idx ON public.meeting_notes (created_at DESC);
CREATE INDEX IF NOT EXISTS meeting_notes_status_idx ON public.meeting_notes (status);

CREATE TABLE IF NOT EXISTS public.meeting_note_tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    meeting_id UUID NOT NULL REFERENCES public.meeting_notes(id) ON DELETE CASCADE,
    position INTEGER NOT NULL DEFAULT 0,
    title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
    note TEXT,
    -- The name as it was heard in the meeting, and the person it was matched to (null = choose someone)
    owner_name TEXT,
    owner_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
    due_date DATE,
    due_time TEXT CHECK (due_time IS NULL OR due_time ~ '^\d{2}:\d{2}$'),
    -- The sentence the task came from, where it was said, and whether it was found word for word in the transcript
    quote TEXT,
    quote_at_seconds NUMERIC,
    quote_found BOOLEAN,
    source TEXT NOT NULL DEFAULT 'ai' CHECK (source IN ('ai', 'manual')),
    -- What the AI first wrote, so edits can be measured
    original JSONB,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sending', 'sent', 'deleted')),
    task_id UUID REFERENCES public.task_assignments(id) ON DELETE SET NULL,
    sent_at TIMESTAMPTZ,
    sent_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS meeting_note_tasks_meeting_idx ON public.meeting_note_tasks (meeting_id, position);

ALTER TABLE public.meeting_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_note_tasks ENABLE ROW LEVEL SECURITY;

-- Private bucket for the temporary audio pieces: 100 MB per file (a whole uploaded recording), audio only.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'meeting-audio', 'meeting-audio', false, 104857600,
    ARRAY[
        'audio/webm', 'audio/ogg', 'audio/mp4', 'audio/m4a', 'audio/x-m4a', 'audio/aac', 'audio/mpeg', 'audio/mp3',
        'audio/wav', 'audio/x-wav', 'audio/wave', 'audio/flac', 'video/webm', 'video/mp4'
    ]
)
ON CONFLICT (id) DO NOTHING;

COMMIT;
