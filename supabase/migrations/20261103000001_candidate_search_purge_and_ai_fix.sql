-- =================================================================================
-- Migration: 20261103000001_candidate_search_purge_and_ai_fix.sql
-- Description: owner 2026-11-03 — Candidate Search: permanent delete, "clear all data", and the AI fix for flagged rows.
--   (Owner approved permanent delete on 2026-11-03, replacing "soft delete everywhere"; every HR login may use it.)
--   1) candidate_purge_sheet(org, sheet)   : delete a sheet for good: its records, its uploaded rows, its AI fix logs,
--                                            and every person left with no record anywhere. One transaction.
--   2) candidate_purge_records(org, ids)   : delete already-deleted records for good (+ people left with no record).
--   3) candidate_purge_org(org)            : delete ALL Candidate Search data of one organisation (sheets, records,
--                                            people, uploaded rows, AI fix logs). Search history is kept: it holds
--                                            the questions asked, not candidate details.
--   4) candidate_resolve_row_issues(...)   : mark a sheet row's "needs review" issues as resolved (after HR applied an
--                                            AI suggestion or reviewed it) and recount the sheet's flagged rows.
--   5) candidate_fix_logs                  : every AI fix call (rows, model, suggestions, time) and what HR accepted.
--   6) task_manager_ai_models.job          : the allowed job list gains 'candidate_fix' (Control Center: "Fixing
--                                            flagged rows"). Every existing job stays allowed; no row changes.
-- Safety: ADDITIVE. New functions + one new table + one widened CHECK. No existing row is changed or deleted by this
--         file. The purge functions delete only when the app calls them after the user confirms. Safe to re-run.
--         Run AFTER 20261102000003_candidate_search.sql and 20261102000004_candidate_search_ai_models.sql.
--         Before this is applied, permanent delete / clear all / AI fix answer "not set up yet"; everything else works.
-- How to apply: run this whole file once in the Supabase SQL Editor.
-- Rollback:   DROP FUNCTION IF EXISTS public.candidate_purge_sheet(uuid, uuid), public.candidate_purge_records(uuid, uuid[]),
--               public.candidate_purge_org(uuid), public.candidate_resolve_row_issues(uuid, integer[], text);
--             DROP TABLE IF EXISTS public.candidate_fix_logs;
--             DELETE FROM public.task_manager_ai_models WHERE job = 'candidate_fix';
--             then restore the CHECK list from 20261102000004.
-- =================================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- AI fix log (traceability: which rows, which model, what it suggested, what HR accepted)
-- ---------------------------------------------------------------------------
create table if not exists public.candidate_fix_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  sheet_id uuid references public.candidate_sheets (id) on delete cascade,
  user_id uuid references auth.users (id) on delete set null,
  row_numbers integer[] not null default '{}',
  model text,
  -- suggested changes / issues the model said it could not fix / rows it answered
  proposed_count integer not null default 0,
  cannot_fix_count integer not null default 0,
  answered_rows integer not null default 0,
  proposals jsonb,
  fix_ms integer,
  error text,
  -- filled when HR applies: changes saved, changes left out, rows marked reviewed
  accepted_count integer,
  rejected_count integer,
  applied_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists candidate_fix_logs_org_idx on public.candidate_fix_logs (organization_id, created_at desc);

alter table public.candidate_fix_logs enable row level security;

-- ---------------------------------------------------------------------------
-- Permanent delete of one sheet
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- Permanent delete of records that are already deleted (from "Show deleted")
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- Clear ALL Candidate Search data of one organisation (search history is kept)
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- Mark rows' "needs review" issues as resolved, then recount the sheet's flagged rows (latest upload only).
-- An issue is resolved by rewriting it as 'Fixed: <issue> (<p_note>)'; issues already starting with 'Fixed: ' stay.
-- Returns the new flagged count.
-- ---------------------------------------------------------------------------
create or replace function public.candidate_resolve_row_issues(p_sheet_id uuid, p_row_numbers integer[], p_note text)
returns integer
language plpgsql
set search_path = public
as $$
declare
  v_upload integer;
  v_flagged integer;
begin
  select upload_count into v_upload from public.candidate_sheets where id = p_sheet_id for update;
  if v_upload is null then
    raise exception 'Candidate sheet % not found', p_sheet_id using errcode = 'P0002';
  end if;

  update public.candidate_sheet_rows r
  set issues = (
    select coalesce(array_agg(
      case when i like 'Fixed: %' then i else 'Fixed: ' || i || ' (' || p_note || ')' end
      order by n), '{}')
    from unnest(r.issues) with ordinality as t(i, n)
  )
  where r.sheet_id = p_sheet_id and r.upload_no = v_upload and r.row_number = any(p_row_numbers) and not r.skipped;

  select count(*)::int into v_flagged
  from public.candidate_sheet_rows r
  where r.sheet_id = p_sheet_id and r.upload_no = v_upload and not r.skipped
    and exists (select 1 from unnest(r.issues) i where i not like 'Fixed: %');

  update public.candidate_sheets set flagged_count = v_flagged, updated_at = now() where id = p_sheet_id;
  return v_flagged;
end;
$$;

-- Only server code (service role) may call these.
revoke execute on function public.candidate_purge_sheet(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.candidate_purge_records(uuid, uuid[]) from public, anon, authenticated;
revoke execute on function public.candidate_purge_org(uuid) from public, anon, authenticated;
revoke execute on function public.candidate_resolve_row_issues(uuid, integer[], text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Control Center: the AI fix picks its model like the other Candidate Search jobs.
-- ---------------------------------------------------------------------------
ALTER TABLE IF EXISTS public.task_manager_ai_models
    DROP CONSTRAINT IF EXISTS task_manager_ai_models_job_check;

ALTER TABLE IF EXISTS public.task_manager_ai_models
    ADD CONSTRAINT task_manager_ai_models_job_check CHECK (job IN (
        'wa_understand', 'wa_reply', 'wa_tidy', 'voice_transcribe', 'voice_cleanup',
        'import_image', 'import_text', 'superuser_chat', 'learning_loop', 'duplicate_check',
        'candidate_parse', 'candidate_rank', 'candidate_fix'
    ));

NOTIFY pgrst, 'reload schema';

COMMIT;
