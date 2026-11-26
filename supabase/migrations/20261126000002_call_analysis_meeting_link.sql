-- =================================================================================
-- Migration: 20261126000002_call_analysis_meeting_link.sql
-- Description: Links automatic Recruitment interview call_analyses rows back to their
--   video/in-person meeting_notes row so each interview is analysed at most once and
--   surfaces sentiment, answer evaluations, concerns, red flags, and extracted facts
--   directly on the candidate's Interviews tab as well as the Calls tab.
-- Safety: ADDITIVE. One nullable column and one partial unique index. Safe to re-run.
-- Rollback: DROP INDEX IF EXISTS public.call_analyses_meeting_once;
--           ALTER TABLE public.call_analyses DROP COLUMN IF EXISTS meeting_id;
-- =================================================================================

BEGIN;

alter table public.call_analyses add column if not exists meeting_id uuid;

create unique index if not exists call_analyses_meeting_once
  on public.call_analyses (meeting_id)
  where meeting_id is not null and deleted_at is null;

NOTIFY pgrst, 'reload schema';

COMMIT;
