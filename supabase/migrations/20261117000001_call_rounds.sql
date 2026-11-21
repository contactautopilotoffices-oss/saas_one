-- =================================================================================
-- Migration: 20261117000001_call_rounds.sql
-- Description: owner 2026-11-17 — Recruitment, the Calls tab: which round each call was for.
--   call_analyses.call_round : 'screening' (the first call: pay, notice, location), 'round_1' / 'round_2' / 'round_3'
--   (interview rounds: the model also reads how each answer covered the position's must-haves, and suggests questions
--   for the next round), or 'hr_offer' (the HR or offer discussion, read like a screening call). Chosen when the call
--   is added (filled in from the candidate's stage in the position) and changeable on the call afterwards. null = a
--   call added before this migration; the app shows it as Screening.
-- Safety: ADDITIVE. One nullable column and its CHECK. No row changes.
-- How to apply: run this whole file once in the Supabase SQL Editor, after 20261116000001. Safe to re-run.
-- Rollback: ALTER TABLE public.call_analyses DROP COLUMN IF EXISTS call_round;
-- =================================================================================

BEGIN;

alter table public.call_analyses add column if not exists call_round text;
alter table public.call_analyses drop constraint if exists call_analyses_call_round_check;
alter table public.call_analyses add constraint call_analyses_call_round_check
  check (call_round is null or call_round in ('screening', 'round_1', 'round_2', 'round_3', 'hr_offer'));

NOTIFY pgrst, 'reload schema';

COMMIT;
