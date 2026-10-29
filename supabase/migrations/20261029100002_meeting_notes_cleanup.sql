-- =================================================================================
-- Migration: 20261029100002_meeting_notes_cleanup.sql
-- Description: owner 2026-10-29 — undoes what the FIRST draft of 20261029100001_meeting_notes.sql did by mistake.
--   That draft named its tables "meetings" and "meeting_tasks". public.meetings already exists (the Ira meeting room,
--   20261006000003), so CREATE TABLE IF NOT EXISTS skipped it, and the draft:
--     • added two indexes to the Ira table: meetings_created_at_idx, meetings_status_idx
--     • created an empty public.meeting_tasks whose meeting_id points at the Ira table
--   The Meeting Notes feature now uses public.meeting_notes / public.meeting_note_tasks instead.
-- Safety: removes ONLY those two indexes (the Ira migration's own index is idx_meetings_org, untouched) and the
--         meeting_tasks table — and the table only if it is EMPTY; otherwise it stops with an error and changes
--         nothing. No Ira data, column, policy or row-level-security setting is touched. Safe to re-run.
-- How to apply: run once in the Supabase SQL Editor, then run 20261029100001_meeting_notes.sql again.
-- Rollback:   not needed (it only removes things nothing uses).
-- =================================================================================

BEGIN;

DO $$
BEGIN
    IF to_regclass('public.meeting_tasks') IS NOT NULL THEN
        IF EXISTS (SELECT 1 FROM public.meeting_tasks LIMIT 1) THEN
            RAISE EXCEPTION 'public.meeting_tasks has rows — not dropping it. Check what is using it first.';
        END IF;
        DROP TABLE public.meeting_tasks;
    END IF;
END $$;

DROP INDEX IF EXISTS public.meetings_created_at_idx;
DROP INDEX IF EXISTS public.meetings_status_idx;

COMMIT;
