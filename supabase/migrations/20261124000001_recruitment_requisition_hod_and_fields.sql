-- =================================================================================
-- Migration: 20261124000001_recruitment_requisition_hod_and_fields.sql
-- Description: owner 2026-11-24 (HR recruitment meeting, 23 Nov) — hiring requests:
--   1) The department head approves first ("Approval goes first to the hiring manager or HOD, and to HR if the HOD does
--      not act"): a new level 'hod' before the HR Head (then the Director, as before). The head is the one set per
--      department in the Tech dashboard → HR Configs. After 48 hours without a decision the request passes to the HR Head
--      on its own, recorded in the history as 'escalated'.
--   2) Three new form fields: internal_mobility (can someone already in the company fill it: yes / no), structure_note
--      (where the role sits in the current structure) and role_is_new (the role title was typed under "Others", not
--      picked from the department's designations).
--   The department → designations list itself is kept in organization_settings.recruitment_config (no new table).
-- Safety: ADDITIVE. Three nullable / defaulted columns; three CHECK constraints widened (every existing value stays
--         valid). No data changes. recruitment_requisition_approvals stays insert-only (its trigger is untouched).
--         recruitment_offers is NOT touched (offers keep HR Head → Director).
-- How to apply: run this whole file once in the Supabase SQL Editor, after 20261121000001. Safe to re-run.
-- Rollback (only once no row uses 'hod' or 'escalated'):
--   ALTER TABLE public.recruitment_requisitions DROP CONSTRAINT IF EXISTS recruitment_requisitions_current_level_check;
--   ALTER TABLE public.recruitment_requisitions ADD CONSTRAINT recruitment_requisitions_current_level_check
--     CHECK (current_level IS NULL OR current_level IN ('hr_head', 'director'));
--   ALTER TABLE public.recruitment_requisition_approvals DROP CONSTRAINT IF EXISTS recruitment_requisition_approvals_level_check;
--   ALTER TABLE public.recruitment_requisition_approvals ADD CONSTRAINT recruitment_requisition_approvals_level_check
--     CHECK (level IS NULL OR level IN ('hr_head', 'director'));
--   ALTER TABLE public.recruitment_requisition_approvals DROP CONSTRAINT IF EXISTS recruitment_requisition_approvals_action_check;
--   ALTER TABLE public.recruitment_requisition_approvals ADD CONSTRAINT recruitment_requisition_approvals_action_check
--     CHECK (action IN ('submitted', 'approved', 'rejected', 'sent_back', 'on_hold', 'resumed', 'withdrawn', 'position_opened', 'endorsed', 'still_needed'));
--   ALTER TABLE public.recruitment_requisitions DROP COLUMN IF EXISTS internal_mobility, DROP COLUMN IF EXISTS structure_note, DROP COLUMN IF EXISTS role_is_new;
-- =================================================================================

BEGIN;

alter table public.recruitment_requisitions add column if not exists internal_mobility boolean;
alter table public.recruitment_requisitions add column if not exists structure_note text;
alter table public.recruitment_requisitions add column if not exists role_is_new boolean not null default false;

alter table public.recruitment_requisitions drop constraint if exists recruitment_requisitions_current_level_check;
alter table public.recruitment_requisitions add constraint recruitment_requisitions_current_level_check
  check (current_level is null or current_level in ('hod', 'hr_head', 'director'));

alter table public.recruitment_requisition_approvals drop constraint if exists recruitment_requisition_approvals_level_check;
alter table public.recruitment_requisition_approvals add constraint recruitment_requisition_approvals_level_check
  check (level is null or level in ('hod', 'hr_head', 'director'));

alter table public.recruitment_requisition_approvals drop constraint if exists recruitment_requisition_approvals_action_check;
alter table public.recruitment_requisition_approvals add constraint recruitment_requisition_approvals_action_check
  check (action in ('submitted', 'approved', 'rejected', 'sent_back', 'on_hold', 'resumed', 'withdrawn', 'position_opened', 'endorsed', 'still_needed', 'escalated'));

NOTIFY pgrst, 'reload schema';

COMMIT;
