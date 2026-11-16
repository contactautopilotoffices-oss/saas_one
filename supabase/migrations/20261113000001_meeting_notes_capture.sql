-- =================================================================================
-- Migration: 20261113000001_meeting_notes_capture.sql
-- Description: owner 2026-11-13 — Meeting Assistant, robust recording. The phone now tells the server, every half
--   minute while recording, how many audio pieces it has recorded per continuous recording ("heartbeat"). That record
--   lives in meeting_notes.capture, so "Finish" can compare what the phone recorded with what actually reached storage
--   and refuse to make notes from a recording with holes (code PIECES_MISSING) until the pieces arrive, or the person
--   says to finish anyway.
--   capture = { "segments": { "0": { "recorded": 120 } }, "elapsedSeconds": 1800, "pieceSeconds": 15,
--               "at": "2026-11-13T07:00:00Z", "finishedWith": { "missing": 0, "forced": false }, "autoFinished": true }
-- Safety: ADDITIVE ONLY — one nullable JSONB column on the Meeting Assistant's own table. No row or other table
--         changes. Safe to re-run. The code works before this is applied (the heartbeat is simply not stored and
--         Finish does not check for missing pieces).
-- How to apply: run once in the Supabase SQL Editor.
-- Rollback:   ALTER TABLE public.meeting_notes DROP COLUMN capture;
-- =================================================================================

BEGIN;

ALTER TABLE public.meeting_notes ADD COLUMN IF NOT EXISTS capture JSONB;

COMMENT ON COLUMN public.meeting_notes.capture IS 'Meeting Assistant: what the recording phone reported (pieces recorded per segment, elapsed time), used by Finish to detect missing audio';

COMMIT;
