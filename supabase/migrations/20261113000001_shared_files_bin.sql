-- =================================================================================
-- Migration: 20261113000001_shared_files_bin.sql
-- Description: owner 2026-11-13 — a Bin for the Files tab (Design and Tech consoles), like Google Drive's.
--   "Delete" now puts an item in the Bin instead of removing it; anyone on either team can restore it or delete it
--   for good. Items left in the Bin for 30 days are removed for good the next time the Bin is opened.
--   public.shared_files.deleted_at   when it was put in the Bin, NULL = shown in Files.
--   public.shared_files.deleted_by   who put it there.
--   What is inside a binned folder keeps deleted_at NULL: it is reached only through its folder, so it disappears
--   and comes back together with the folder.
-- Safety: ADDITIVE ONLY. Two new nullable columns and one partial index. No existing row, value or behaviour changes.
--         Safe to re-run. The Files tab works before this is applied: delete stays permanent until it is.
-- How to apply: run once in the Supabase SQL Editor.
-- Rollback:   DROP INDEX IF EXISTS public.shared_files_bin_idx;
--             ALTER TABLE public.shared_files DROP COLUMN IF EXISTS deleted_at, DROP COLUMN IF EXISTS deleted_by;
-- =================================================================================

BEGIN;

ALTER TABLE public.shared_files
    ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES public.users(id) ON DELETE SET NULL;

-- The Bin listing and the 30-day purge only ever look at binned rows
CREATE INDEX IF NOT EXISTS shared_files_bin_idx
    ON public.shared_files (organization_id, deleted_at)
    WHERE deleted_at IS NOT NULL;

-- Tell PostgREST about the new columns straight away
NOTIFY pgrst, 'reload schema';

COMMIT;
