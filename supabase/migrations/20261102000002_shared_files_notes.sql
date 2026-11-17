-- =================================================================================
-- Migration: 20261102000002_shared_files_notes.sql
-- Description: owner 2026-11-02 — a simple note on any file or folder in the Files tab (Design and Tech consoles).
--   One editable note per item; anyone on either team can add, change or clear it (same rule as delete).
--   public.shared_files.note   plain text, up to 2000 characters, NULL = no note.
-- Safety: ADDITIVE ONLY. One new nullable column on public.shared_files. No existing row, value or behaviour changes.
--         Safe to re-run. The Files tab works before this is applied; saving a note says it is not set up yet.
-- How to apply: run once in the Supabase SQL Editor.
-- Rollback:   ALTER TABLE public.shared_files DROP COLUMN IF EXISTS note;
-- =================================================================================

BEGIN;

ALTER TABLE public.shared_files
    ADD COLUMN IF NOT EXISTS note TEXT CHECK (note IS NULL OR char_length(note) BETWEEN 1 AND 2000);

-- Tell PostgREST about the new column straight away
NOTIFY pgrst, 'reload schema';

COMMIT;
