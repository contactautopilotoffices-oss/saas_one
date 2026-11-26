-- =================================================================================
-- Migration: 20261125000001_recruitment_position_screening.sql
-- Description: owner 2026-11-25 ("use AI to generate screening questions based on the JD"): each position can keep
--   its own screening questions (drafted by the AI from the JD, edited and saved by HR). The standard questions that
--   fill the record (experience, city, notice, salary) still come from Recruitment → Outreach → Screening and are
--   always asked; these are the role's own questions on top. NULL = the position uses the standard list only.
-- Safety: ADDITIVE. One nullable column. No data changes.
-- How to apply: run this whole file once in the Supabase SQL Editor. Safe to re-run.
-- Rollback: ALTER TABLE public.candidate_positions DROP COLUMN IF EXISTS screening_fields;
-- =================================================================================

BEGIN;

alter table public.candidate_positions add column if not exists screening_fields jsonb;

NOTIFY pgrst, 'reload schema';

COMMIT;
