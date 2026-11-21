-- =================================================================================
-- Migration: 20261121000001_recruitment_requisition_followups.sql
-- Description: owner 2026-11-21 ("go ahead with all") — hiring requests: two more kinds of history entry.
--   1) 'endorsed'     : a department head endorses a request raised for their department (the spec's "Department
--                       head: endorse requisitions"). It does not approve anything and does not change who decides.
--   2) 'still_needed' : the person who raised a request on hold confirms the role is still needed (spec rule A24:
--                       "Requisition on hold over 15 days: ask the manager to confirm or withdraw").
--   Who heads which department is kept in organization_settings.recruitment_config (no new column).
-- Safety: ADDITIVE. Widens one CHECK constraint on recruitment_requisition_approvals; no data changes. The table stays
--         insert-only (its trigger is untouched).
-- How to apply: run this whole file once in the Supabase SQL Editor, after 20261117000003. Safe to re-run.
-- Rollback: ALTER TABLE public.recruitment_requisition_approvals DROP CONSTRAINT IF EXISTS recruitment_requisition_approvals_action_check;
--           ALTER TABLE public.recruitment_requisition_approvals ADD CONSTRAINT recruitment_requisition_approvals_action_check
--             CHECK (action IN ('submitted', 'approved', 'rejected', 'sent_back', 'on_hold', 'resumed', 'withdrawn', 'position_opened'));
--           (only once no 'endorsed' or 'still_needed' rows exist)
-- =================================================================================

BEGIN;

alter table public.recruitment_requisition_approvals drop constraint if exists recruitment_requisition_approvals_action_check;
alter table public.recruitment_requisition_approvals add constraint recruitment_requisition_approvals_action_check
  check (action in ('submitted', 'approved', 'rejected', 'sent_back', 'on_hold', 'resumed', 'withdrawn', 'position_opened', 'endorsed', 'still_needed'));

NOTIFY pgrst, 'reload schema';

COMMIT;
