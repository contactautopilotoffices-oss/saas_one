-- =================================================================================
-- Migration: 20261118000001_meeting_notes_online.sql
-- Description: owner 2026-11-18 — Meeting Assistant, stage 1 of online meetings. Besides recording an in-room meeting
--   on one phone, a meeting can now be ONLINE: a video call (hosted LiveKit) with its own link, started now or at a
--   set time. LiveKit records the call's SOUND only, into the existing 'meeting-audio' bucket exactly where the phone
--   recorder puts it, so transcription, voice naming, notes and tasks work unchanged, and the sound is deleted once it
--   is text. The video is NOT recorded (owner 2026-11-18: it would take up too much space), so no new bucket.
--   1. meeting_notes.kind           'room' (recorded on a phone, as before) or 'online' (video call)
--   2. meeting_notes.scheduled_for  when an online meeting is planned (null = start now / not scheduled)
--   3. meeting_notes.online         the call: room name, when it started and ended, the recordings, any problem
--   4. two new statuses for online meetings: 'scheduled' (link made, nobody joined yet) and 'live' (in progress,
--      being recorded). After the call they move to 'uploaded' and follow the usual steps.
-- Safety: ADDITIVE ONLY on the Meeting Assistant's own table: three columns (existing rows become kind 'room') and a
--         wider status check that keeps every existing value valid. No other table, row or bucket is touched. Safe to
--         re-run. The code works before this is applied: online meetings say they are not set up, and everything else
--         works as before.
-- How to apply: run once in the Supabase SQL Editor.
-- Rollback (only after removing online meetings):
--             ALTER TABLE public.meeting_notes DROP CONSTRAINT meeting_notes_status_check;
--             ALTER TABLE public.meeting_notes ADD CONSTRAINT meeting_notes_status_check
--                 CHECK (status IN ('recording', 'uploaded', 'transcribing', 'identifying', 'extracting', 'ready', 'failed', 'discarded'));
--             ALTER TABLE public.meeting_notes DROP COLUMN online, DROP COLUMN scheduled_for, DROP COLUMN kind;
-- =================================================================================

BEGIN;

ALTER TABLE public.meeting_notes
    ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'room',
    ADD COLUMN IF NOT EXISTS scheduled_for TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS online JSONB;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'meeting_notes_kind_check') THEN
        ALTER TABLE public.meeting_notes
            ADD CONSTRAINT meeting_notes_kind_check CHECK (kind IN ('room', 'online'));
    END IF;
END $$;

ALTER TABLE public.meeting_notes DROP CONSTRAINT IF EXISTS meeting_notes_status_check;
ALTER TABLE public.meeting_notes ADD CONSTRAINT meeting_notes_status_check
    CHECK (status IN ('scheduled', 'live', 'recording', 'uploaded', 'transcribing', 'identifying', 'extracting', 'ready', 'failed', 'discarded'));

COMMENT ON COLUMN public.meeting_notes.kind IS 'Meeting Assistant: room = recorded on a phone; online = video call (LiveKit)';
COMMENT ON COLUMN public.meeting_notes.scheduled_for IS 'Meeting Assistant: when an online meeting is planned (null = not scheduled)';
COMMENT ON COLUMN public.meeting_notes.online IS 'Meeting Assistant: the online call (room, started/ended, recordings, problems)';

COMMIT;
