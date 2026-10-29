-- =================================================================================
-- Migration: 20261029100004_meeting_notes_multi_owner_and_whatsapp.sql
-- Description: owner 2026-10-29 — Meeting Notes:
--   1. A task can be for SEVERAL people: meeting_note_tasks.owner_user_ids (the people) and .task_ids (one Task Manager
--      task created for each of them when sent). Existing rows are copied over from owner_user_id / task_id, which are
--      kept (owner_user_id = the first person) so nothing that reads them breaks.
--   2. "Send notes on WhatsApp" to the people present: meeting_notes.notes_sent_at / notes_sent_count record the last send.
-- Safety: ADDITIVE ONLY. New columns with defaults on the two Meeting Notes tables, and a copy of each row's own
--         existing values into them. No other table is touched. Safe to re-run.
-- How to apply: run once in the Supabase SQL Editor (after 20261029100001).
-- Rollback:   ALTER TABLE public.meeting_note_tasks DROP COLUMN owner_user_ids, DROP COLUMN task_ids;
--             ALTER TABLE public.meeting_notes DROP COLUMN notes_sent_at, DROP COLUMN notes_sent_count;
-- =================================================================================

BEGIN;

ALTER TABLE public.meeting_note_tasks
    ADD COLUMN IF NOT EXISTS owner_user_ids UUID[] NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS task_ids UUID[] NOT NULL DEFAULT '{}';

UPDATE public.meeting_note_tasks SET owner_user_ids = ARRAY[owner_user_id]
    WHERE owner_user_id IS NOT NULL AND owner_user_ids = '{}';
UPDATE public.meeting_note_tasks SET task_ids = ARRAY[task_id]
    WHERE task_id IS NOT NULL AND task_ids = '{}';

ALTER TABLE public.meeting_notes
    ADD COLUMN IF NOT EXISTS notes_sent_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS notes_sent_count INTEGER;

COMMIT;
