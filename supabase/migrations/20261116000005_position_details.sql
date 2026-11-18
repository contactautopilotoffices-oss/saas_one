-- =================================================================================
-- Migration: 20261116000005_position_details.sql
-- Description: owner 2026-11-16 — Recruitment: a position is a job record, not only a saved search ("go ahead with the
--   create position form, no approvals for now"). The Create / Edit position form (PositionForm.tsx) fills these from
--   the JD with AI and HR checks each one. The requirements (experience, notice, must-have and nice-to-have skills,
--   budget) keep living in `filters`, which the search runs as is; these columns are the job's own details.
--   candidate_positions gains: designation, employment_type, openings, hiring_manager, priority, education,
--   budget_min_inhand / budget_max_inhand (rupees per month in hand), summary (the role in 2–3 sentences).
-- Safety: ADDITIVE. Nine nullable or defaulted columns with CHECKs; no row changes. Before it is applied the app reads
--         and writes positions without these columns.
-- How to apply: run this whole file once in the Supabase SQL Editor, after 20261116000004. Safe to re-run.
-- Rollback: ALTER TABLE public.candidate_positions DROP COLUMN IF EXISTS designation, DROP COLUMN IF EXISTS employment_type,
--             DROP COLUMN IF EXISTS openings, DROP COLUMN IF EXISTS hiring_manager, DROP COLUMN IF EXISTS priority,
--             DROP COLUMN IF EXISTS education, DROP COLUMN IF EXISTS budget_min_inhand, DROP COLUMN IF EXISTS budget_max_inhand,
--             DROP COLUMN IF EXISTS summary;
-- =================================================================================

BEGIN;

alter table public.candidate_positions
  add column if not exists designation text,
  add column if not exists employment_type text,
  add column if not exists openings integer not null default 1,
  add column if not exists hiring_manager text,
  add column if not exists priority text not null default 'normal',
  add column if not exists education text,
  add column if not exists budget_min_inhand integer,
  add column if not exists budget_max_inhand integer,
  add column if not exists summary text;

alter table public.candidate_positions drop constraint if exists candidate_positions_employment_type_check;
alter table public.candidate_positions add constraint candidate_positions_employment_type_check
  check (employment_type is null or employment_type in ('full_time', 'part_time', 'contract', 'internship'));

alter table public.candidate_positions drop constraint if exists candidate_positions_priority_check;
alter table public.candidate_positions add constraint candidate_positions_priority_check
  check (priority in ('low', 'normal', 'high', 'urgent'));

alter table public.candidate_positions drop constraint if exists candidate_positions_openings_check;
alter table public.candidate_positions add constraint candidate_positions_openings_check
  check (openings between 1 and 500);

alter table public.candidate_positions drop constraint if exists candidate_positions_budget_check;
alter table public.candidate_positions add constraint candidate_positions_budget_check
  check (budget_min_inhand is null or budget_max_inhand is null or budget_min_inhand <= budget_max_inhand);

NOTIFY pgrst, 'reload schema';

COMMIT;
