-- =================================================================================
-- Migration: 20261113000002_shared_file_stars.sql
-- Description: owner 2026-11-13 — personal stars in the Files tab (Design and Tech consoles), like Google Drive's.
--   Each person stars items for themselves; a star is never seen by anyone else.
--   public.shared_file_stars   one row per (item, person). Deleting the item deletes its stars.
-- Safety: ADDITIVE ONLY. One new empty table (row level security on, no policies: only server code with the service
--         role reads or writes it). No existing table, row or behaviour changes. Safe to re-run.
--         The Files tab works before this is applied; starring says it is not set up yet.
-- How to apply: run once in the Supabase SQL Editor.
-- Rollback:   DROP TABLE public.shared_file_stars;
-- =================================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.shared_file_stars (
    file_id UUID NOT NULL REFERENCES public.shared_files(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (file_id, user_id)
);

CREATE INDEX IF NOT EXISTS shared_file_stars_user_idx ON public.shared_file_stars (user_id);

ALTER TABLE public.shared_file_stars ENABLE ROW LEVEL SECURITY;

-- Tell PostgREST about the new table straight away
NOTIFY pgrst, 'reload schema';

COMMIT;
