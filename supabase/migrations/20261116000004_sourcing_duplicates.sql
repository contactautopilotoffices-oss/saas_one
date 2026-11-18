-- =================================================================================
-- Migration: 20261116000004_sourcing_duplicates.sql
-- Description: owner 2026-11-16 — Recruitment: "already in the database". A CV and the sheet row of the same person are
--   one sourcing and link quietly; the app flags a person who comes a SECOND time, keeps the copy, and lets HR decide.
--   1) candidate_resume_files.source_kind / source_name : where this upload came from (own search, Naukri, job portal,
--      vendor + name). Optional: an upload that does not say stays null.
--   2) candidate_sheets.source_kind / source_name        : the same, for a sourcing sheet.
--   2b) candidate_resume_files.duplicate_state           : a second, different CV for a person who already had one.
--   2c) candidate_resume_repeats                         : the SAME file uploaded again by someone else (it is not
--      stored twice), listed for HR with who uploaded it first and who again, until dismissed.
--   3) candidate_actions.action gains 'duplicate_flagged', the history entry on the person.
--   4) FIX: the permanent deletes (candidate_purge_sheet / _records / _org, from 20261103000001) delete people, and
--      since 20261115000002 a person's history rows go with them (on delete cascade), which the insert-only trigger
--      on candidate_actions refuses. So "Clear all candidate data" and the permanent delete failed as soon as a
--      person had any history. The trigger now lets a DELETE through only inside those functions (a
--      transaction-local setting they switch on); every other UPDATE or DELETE is still refused. The three functions
--      are re-created with that one line added; their bodies are otherwise those of 20261103000001.
-- Safety: ADDITIVE. Nullable columns, one new table, one CHECK widened (every existing value stays valid), one trigger
--         function and three purge functions replaced (same signatures). No row changes.
-- How to apply: run this whole file once in the Supabase SQL Editor, after 20261116000003. Safe to re-run.
-- Rollback: ALTER TABLE public.candidate_resume_files DROP COLUMN IF EXISTS source_kind, DROP COLUMN IF EXISTS source_name,
--             DROP COLUMN IF EXISTS duplicate_state, DROP COLUMN IF EXISTS duplicate_resolved_by, DROP COLUMN IF EXISTS duplicate_resolved_at;
--           ALTER TABLE public.candidate_sheets DROP COLUMN IF EXISTS source_kind, DROP COLUMN IF EXISTS source_name;
--           DROP TABLE IF EXISTS public.candidate_resume_repeats;
--           then restore the action CHECK of 20261116000003 (without 'duplicate_flagged'); re-run the trigger function
--           of 20261115000002 and the purge functions of 20261103000001 (the deletes then fail again on any history).
-- =================================================================================

BEGIN;

alter table public.candidate_resume_files
  add column if not exists source_kind text,
  add column if not exists source_name text;
alter table public.candidate_resume_files drop constraint if exists candidate_resume_files_source_kind_check;
alter table public.candidate_resume_files add constraint candidate_resume_files_source_kind_check
  check (source_kind is null or source_kind in ('own', 'naukri', 'portal', 'vendor'));

alter table public.candidate_sheets
  add column if not exists source_kind text,
  add column if not exists source_name text;
alter table public.candidate_sheets drop constraint if exists candidate_sheets_source_kind_check;
alter table public.candidate_sheets add constraint candidate_sheets_source_kind_check
  check (source_kind is null or source_kind in ('own', 'naukri', 'portal', 'vendor'));

-- 2b) A second CV for a person who already has one (owner 2026-11-16: "a row in the excel maps to a resume, that is not
--     a duplicate"). Only such a file is flagged: 'pending' until HR picks "Update the CV" ('updated': this file is the
--     CV from now on, the earlier one is kept as an older version) or deletes the copy (the row is then gone).
alter table public.candidate_resume_files
  add column if not exists duplicate_state text,
  add column if not exists duplicate_resolved_by uuid references auth.users (id) on delete set null,
  add column if not exists duplicate_resolved_at timestamptz;
alter table public.candidate_resume_files drop constraint if exists candidate_resume_files_duplicate_state_check;
alter table public.candidate_resume_files add constraint candidate_resume_files_duplicate_state_check
  check (duplicate_state is null or duplicate_state in ('pending', 'updated'));
create index if not exists candidate_resume_files_duplicate_pending_idx
  on public.candidate_resume_files (organization_id) where duplicate_state = 'pending';

-- 2c) The same file uploaded again by someone else (owner 2026-11-16): it is not stored twice, but HR sees it, with who
--     uploaded it first and who again, until dismissed. One open entry per file and per person who uploaded it again.
create table if not exists public.candidate_resume_repeats (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  file_id uuid not null references public.candidate_resume_files (id) on delete cascade,
  candidate_id uuid references public.candidates (id) on delete set null,
  uploaded_by uuid references auth.users (id) on delete set null,
  uploaded_by_name text,
  created_at timestamptz not null default now(),
  dismissed_at timestamptz,
  dismissed_by uuid references auth.users (id) on delete set null
);
create unique index if not exists candidate_resume_repeats_open_once
  on public.candidate_resume_repeats (file_id, uploaded_by) where dismissed_at is null;
create index if not exists candidate_resume_repeats_open_idx
  on public.candidate_resume_repeats (organization_id, created_at desc) where dismissed_at is null;
alter table public.candidate_resume_repeats enable row level security;
revoke all on public.candidate_resume_repeats from anon, authenticated;

alter table public.candidate_actions drop constraint if exists candidate_actions_action_check;
alter table public.candidate_actions add constraint candidate_actions_action_check
  check (action in (
    'status_change', 'stage_change', 'remark', 'blacklist', 'unblacklist', 'resume_attached', 'resume_marked',
    'added_to_position', 'removed_from_position', 'call_logged', 'field_edit', 'outreach_sent', 'duplicate_flagged'
  ));

-- ---------------------------------------------------------------------------
-- 4) The insert-only trigger lets a permanent delete take the deleted people's history with it
-- ---------------------------------------------------------------------------
create or replace function public.candidate_actions_refuse_change() returns trigger
language plpgsql
as $$
begin
  -- Only the permanent deletes below switch this on, for their own transaction: a deleted person's history goes
  -- with them. Everything else that tries to change or delete history is still refused.
  if tg_op = 'DELETE' and current_setting('candidates.purge', true) = 'on' then
    return old;
  end if;
  raise exception 'candidate_actions is insert-only: history is never edited or deleted';
end;
$$;

-- The three permanent deletes of 20261103000001, each with the one line `perform set_config('candidates.purge', 'on', true);`.

create or replace function public.candidate_purge_sheet(p_organization_id uuid, p_sheet_id uuid)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_status text;
  v_people uuid[];
  v_records integer;
  v_removed integer;
begin
  perform set_config('candidates.purge', 'on', true);

  select status into v_status
  from public.candidate_sheets
  where id = p_sheet_id and organization_id = p_organization_id
  for update;
  if v_status is null then
    raise exception 'Candidate sheet % not found', p_sheet_id using errcode = 'P0002';
  end if;
  if v_status = 'importing' then
    raise exception 'Candidate sheet % is still importing', p_sheet_id using errcode = '55006';
  end if;

  select coalesce(array_agg(distinct candidate_id), '{}'), count(*)
  into v_people, v_records
  from public.candidate_applications
  where sheet_id = p_sheet_id and organization_id = p_organization_id;

  -- Records, uploaded rows and fix logs go with the sheet (on delete cascade).
  delete from public.candidate_applications where sheet_id = p_sheet_id and organization_id = p_organization_id;
  delete from public.candidate_sheets where id = p_sheet_id and organization_id = p_organization_id;

  delete from public.candidates c
  where c.organization_id = p_organization_id
    and c.id = any(v_people)
    and not exists (select 1 from public.candidate_applications a where a.candidate_id = c.id);
  get diagnostics v_removed = row_count;

  return jsonb_build_object('sheets', 1, 'records', v_records, 'people', v_removed);
end;
$$;

create or replace function public.candidate_purge_records(p_organization_id uuid, p_ids uuid[])
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_people uuid[];
  v_records integer;
  v_removed integer;
begin
  perform set_config('candidates.purge', 'on', true);

  with gone as (
    delete from public.candidate_applications
    where organization_id = p_organization_id
      and id = any(p_ids)
      and deleted_at is not null
    returning candidate_id
  )
  select coalesce(array_agg(distinct candidate_id), '{}'), count(*) into v_people, v_records from gone;

  delete from public.candidates c
  where c.organization_id = p_organization_id
    and c.id = any(v_people)
    and not exists (select 1 from public.candidate_applications a where a.candidate_id = c.id);
  get diagnostics v_removed = row_count;

  return jsonb_build_object('sheets', 0, 'records', v_records, 'people', v_removed);
end;
$$;

create or replace function public.candidate_purge_org(p_organization_id uuid)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_sheets integer;
  v_records integer;
  v_people integer;
begin
  perform set_config('candidates.purge', 'on', true);

  -- An upload that started in the last 10 minutes may still be writing; a stuck one older than that is cleared too.
  if exists (
    select 1 from public.candidate_sheets
    where organization_id = p_organization_id and status = 'importing' and updated_at > now() - interval '10 minutes'
  ) then
    raise exception 'A sheet is still importing' using errcode = '55006';
  end if;

  delete from public.candidate_applications where organization_id = p_organization_id;
  get diagnostics v_records = row_count;
  delete from public.candidates where organization_id = p_organization_id;
  get diagnostics v_people = row_count;
  -- Uploaded rows and fix logs of these sheets go with them (on delete cascade).
  delete from public.candidate_sheets where organization_id = p_organization_id;
  get diagnostics v_sheets = row_count;
  delete from public.candidate_fix_logs where organization_id = p_organization_id;

  return jsonb_build_object('sheets', v_sheets, 'records', v_records, 'people', v_people);
end;
$$;

NOTIFY pgrst, 'reload schema';

COMMIT;
