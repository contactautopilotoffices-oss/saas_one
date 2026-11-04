-- =================================================================================
-- Migration: 20261104000004_meeting_notes_more_spaces.sql
-- Description: owner 2026-11-04 — the Meeting Assistant is now also in the Procurement dashboard, the Design console
--   and the Ops Super Admin dashboard, each with its OWN meetings. meeting_notes.workspace may now also be
--   'procurement', 'design' or 'operations'.
-- Safety: widens one CHECK constraint on the Meeting Assistant's own table. Every existing row stays valid, and no row
--         or other table is changed. Safe to re-run.
-- How to apply: run once in the Supabase SQL Editor (after 20261029100005), BEFORE deploying the code. Until then,
--         starting a meeting in the new tabs fails.
-- Rollback:   only after removing rows in the new spaces —
--             ALTER TABLE public.meeting_notes DROP CONSTRAINT meeting_notes_workspace_check;
--             ALTER TABLE public.meeting_notes ADD CONSTRAINT meeting_notes_workspace_check CHECK (workspace IN ('tech', 'hr', 'admin'));
-- =================================================================================

BEGIN;

ALTER TABLE public.meeting_notes DROP CONSTRAINT IF EXISTS meeting_notes_workspace_check;

ALTER TABLE public.meeting_notes
    ADD CONSTRAINT meeting_notes_workspace_check
    CHECK (workspace IN ('tech', 'hr', 'admin', 'procurement', 'design', 'operations'));

COMMIT;
