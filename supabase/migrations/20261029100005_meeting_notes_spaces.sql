-- =================================================================================
-- Migration: 20261029100005_meeting_notes_spaces.sql
-- Description: owner 2026-10-29 — the Meeting Assistant is now in three dashboards, each with its OWN meetings:
--   'tech'  (Tech console), 'hr' (HR console), 'admin' (Super Admin console).
--   meeting_notes.workspace says which one a meeting belongs to. Every existing meeting was made in the Tech console,
--   so the default (and the value of all existing rows) is 'tech'.
-- Safety: ADDITIVE ONLY. One column with a default on the Meeting Assistant's own table, plus an index. No other
--         table is touched. Safe to re-run.
-- How to apply: run once in the Supabase SQL Editor (after 20261029100004).
-- Rollback:   DROP INDEX public.meeting_notes_workspace_idx; ALTER TABLE public.meeting_notes DROP COLUMN workspace;
-- =================================================================================

BEGIN;

ALTER TABLE public.meeting_notes
    ADD COLUMN IF NOT EXISTS workspace TEXT NOT NULL DEFAULT 'tech';

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'meeting_notes_workspace_check') THEN
        ALTER TABLE public.meeting_notes
            ADD CONSTRAINT meeting_notes_workspace_check CHECK (workspace IN ('tech', 'hr', 'admin'));
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS meeting_notes_workspace_idx ON public.meeting_notes (workspace, created_at DESC);

COMMIT;
