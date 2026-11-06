-- =================================================================================
-- Migration: 20261029100003_meeting_audio_100mb.sql
-- Description: owner 2026-10-29 — Meeting Notes: an uploaded recording may be up to 100 MB (was 50 MB).
--   Raises the per-file limit of the private 'meeting-audio' bucket. The project's GLOBAL upload limit
--   (Supabase dashboard → Storage → Settings) must also be at least 100 MB, or Supabase still refuses larger files.
-- Safety: changes one setting on the meeting-audio bucket only. No table, row or other bucket is touched. Safe to re-run.
-- How to apply: run once in the Supabase SQL Editor.
-- Rollback:   UPDATE storage.buckets SET file_size_limit = 52428800 WHERE id = 'meeting-audio';
-- =================================================================================

BEGIN;

UPDATE storage.buckets SET file_size_limit = 104857600 WHERE id = 'meeting-audio';

COMMIT;
