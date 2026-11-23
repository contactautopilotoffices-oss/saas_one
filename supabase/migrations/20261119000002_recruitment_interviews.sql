-- =================================================================================
-- Migration: 20261119000002_recruitment_interviews.sql
-- Description: owner 2026-11-19 — Recruitment: "Schedule interview" on a candidate makes the interview's video meeting
--   (the Meeting Assistant's online meeting, one link for everyone) or an in-person interview, and sends the invite.
--   The interview itself is a history entry (candidate_actions, `remark` with meta.kind = 'interview', as since
--   2026-11-17), so no new table. This migration records the WhatsApp invite and marks the interview meetings:
--   1) candidate_outreach.kind gains 'interview_invite';
--   2) candidate_outreach.interview_id: which interview an invite was for;
--   3) the double-send guard becomes one successful send per person, kind, position, stage AND interview, so a second
--      interview (the next round, or a new time) gets its own invite.
--   4) meeting_notes.purpose: 'interview' for the video calls and recordings made from Recruitment. Owner 2026-11-19:
--      they live in Recruitment only and are left out of the Meeting Assistant's list ("hide it"). Null for every other
--      meeting, so nothing else changes.
-- Access: unchanged (RLS on, no policies; server code only).
-- Safety: ADDITIVE. Two columns, one CHECK widened, one unique index re-made (every existing row stays valid).
-- How to apply: run this whole file once in the Supabase SQL Editor, AFTER 20261119000001. Safe to re-run.
-- Rollback: restore the kind CHECK and the unique index of 20261119000001; ALTER TABLE public.candidate_outreach DROP COLUMN interview_id;
--           ALTER TABLE public.meeting_notes DROP COLUMN purpose;
-- =================================================================================

BEGIN;

alter table public.candidate_outreach add column if not exists interview_id uuid;

alter table public.candidate_outreach drop constraint if exists candidate_outreach_kind_check;
alter table public.candidate_outreach add constraint candidate_outreach_kind_check
  check (kind in ('shortlisted', 'not_shortlisted', 'stage_update', 'interview_invite'));

drop index if exists public.candidate_outreach_once;
create unique index if not exists candidate_outreach_once
  on public.candidate_outreach (
    candidate_id, kind,
    coalesce(position_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(stage_key, ''),
    coalesce(interview_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  where status = 'sent';

-- The Meeting Assistant's table (skipped where it does not exist, e.g. a test database)
do $$
begin
  if to_regclass('public.meeting_notes') is not null then
    alter table public.meeting_notes add column if not exists purpose text check (purpose is null or purpose in ('interview'));
  end if;
end $$;

NOTIFY pgrst, 'reload schema';

COMMIT;
