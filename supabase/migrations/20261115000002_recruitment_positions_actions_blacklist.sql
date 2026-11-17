-- =================================================================================
-- Migration: 20261115000002_recruitment_positions_actions_blacklist.sql
-- Description: owner 2026-11-15 — Recruitment (the Candidate Search tab), step 4: positions, candidate history,
--   blacklist, and the "Others" status. Plan: docs/RECRUITMENT_ATS_IMPLEMENTATION_PLAN.md.
--   1) candidate_applications.status gains 'others' (the app requires a remark for it)
--   2) candidates: blacklisted_at / blacklisted_by / blacklist_reason / blacklist_remark. A blacklisted PERSON (every
--      record of theirs) is hidden from every search path unless HR ticks "Show blacklisted": the filter view says
--      `blacklisted`, and hybrid_search_candidates leaves them out of its pool. Nothing is deleted; any HR user can undo it.
--   2b) candidate_resume_files.keep_as_resume: HR says a kept-aside or removed file IS a resume (the check is skipped)
--   3) candidate_positions        : a saved job description (an open position) with the filters HR confirmed, re-run as is
--   4) candidate_position_members : who is in a position's pipeline, at which stage (one row per person per position)
--   5) candidate_actions          : INSERT-ONLY history: every status change, stage move, remark, blacklist, resume attach.
--                                   A trigger refuses UPDATE and DELETE (so deleting an organisation needs it disabled first).
--   6) candidate_filter_records recreated: the same columns as 20261111000002, in the same order, then `blacklisted`.
--      candidate_records is NOT changed, so 20261102000003 stays safe to re-run.
--   7) hybrid_search_candidates replaced: the body of 20261103000002 with one more condition on the pool.
-- Access: RLS on, NO policies on the new tables: only server code (service role) reads or writes, after
--         backend/lib/candidates/access.ts says the caller may.
-- Safety: ADDITIVE. Columns with IF NOT EXISTS; one CHECK widened (every existing status stays valid); the view is
--         dropped and recreated with one more column at the end; the function keeps its signature. No row changes.
-- How to apply: run this whole file once in the Supabase SQL Editor, after 20261111000004. Safe to re-run.
--   NEVER re-run 20261107000001, 20261110000001 or 20261111000002 after this: each recreates the view without
--   `blacklisted`, and the app would then show blacklisted people again until this file is run once more.
-- Rollback: DROP TRIGGER IF EXISTS candidate_actions_no_change ON public.candidate_actions;
--           DROP FUNCTION IF EXISTS public.candidate_actions_refuse_change();
--           DROP TABLE IF EXISTS public.candidate_actions, public.candidate_position_members, public.candidate_positions;
--           ALTER TABLE public.candidates DROP COLUMN IF EXISTS blacklisted_at, DROP COLUMN IF EXISTS blacklisted_by,
--             DROP COLUMN IF EXISTS blacklist_reason, DROP COLUMN IF EXISTS blacklist_remark;
--           ALTER TABLE public.candidate_resume_files DROP COLUMN IF EXISTS keep_as_resume;
--           re-run the view from 20261111000002 and the function from 20261103000002;
--           UPDATE public.candidate_applications SET status = 'on_hold' WHERE status = 'others'; then restore the
--           status CHECK of 20261102000003 (without 'others').
-- =================================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) The "Others" status
-- ---------------------------------------------------------------------------
alter table public.candidate_applications
  drop constraint if exists candidate_applications_status_check,
  add constraint candidate_applications_status_check
    check (status in ('new', 'in_process', 'shortlisted', 'interview', 'on_hold', 'not_responding', 'rejected', 'joined', 'others'));

-- ---------------------------------------------------------------------------
-- 2) Blacklist, on the person
-- ---------------------------------------------------------------------------
alter table public.candidates
  add column if not exists blacklisted_at timestamptz,
  add column if not exists blacklisted_by uuid references auth.users (id) on delete set null,
  -- did_not_join: accepted an offer, did not join · misconduct · false_information: false information or documents ·
  -- asked_not_to_contact · other
  add column if not exists blacklist_reason text,
  add column if not exists blacklist_remark text;

alter table public.candidates drop constraint if exists candidates_blacklist_reason_check;
alter table public.candidates add constraint candidates_blacklist_reason_check
  check (blacklist_reason is null or blacklist_reason in ('did_not_join', 'misconduct', 'false_information', 'asked_not_to_contact', 'other'));

create index if not exists candidates_blacklisted_idx
  on public.candidates (organization_id) where blacklisted_at is not null;

-- ---------------------------------------------------------------------------
-- 2b) "This is a resume": HR overrides the resume check on a file
-- ---------------------------------------------------------------------------
-- A file the check kept aside as another document, or removed as not a resume, that HR says IS a resume. With this
-- set the check is skipped when its text is read, and a removed file may be uploaded again (its hash no longer
-- blocks it) and is then kept.
alter table public.candidate_resume_files
  add column if not exists keep_as_resume boolean not null default false;

-- ---------------------------------------------------------------------------
-- 3) Positions: a saved job description
-- ---------------------------------------------------------------------------
create table if not exists public.candidate_positions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  title text not null check (length(trim(title)) > 0),
  department text,
  location text,
  -- the job description's text as read (pasted or from the file); the file itself, when uploaded, in the resume bucket
  jd_text text,
  jd_file_name text,
  jd_storage_path text,
  -- the SearchFilters HR confirmed for this JD (the app's own shape), and the preferences the ranking reads
  filters jsonb not null default '{}'::jsonb,
  prefer jsonb not null default '{}'::jsonb,
  status text not null default 'open' check (status in ('open', 'closed')),
  recruiter_id uuid references auth.users (id) on delete set null,
  -- days from opening after which the position counts as ageing (the spec's default: 21)
  target_days integer not null default 21 check (target_days between 1 and 365),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz,
  deleted_at timestamptz
);

create index if not exists candidate_positions_org_status_idx
  on public.candidate_positions (organization_id, status) where deleted_at is null;

alter table public.candidate_positions enable row level security;
revoke all on public.candidate_positions from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4) Who is in a position's pipeline
-- ---------------------------------------------------------------------------
create table if not exists public.candidate_position_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  position_id uuid not null references public.candidate_positions (id) on delete cascade,
  candidate_id uuid not null references public.candidates (id) on delete cascade,
  -- the record (sourcing row) they were added from, when there was one
  application_id uuid references public.candidate_applications (id) on delete set null,
  -- the flow: sourced -> screening -> shortlisted -> interview -> offer -> joined; out of the flow: the last four
  stage text not null default 'sourced'
    check (stage in ('sourced', 'screening', 'shortlisted', 'interview', 'offer', 'joined', 'on_hold', 'not_responding', 'rejected', 'others')),
  stage_changed_at timestamptz not null default now(),
  stage_changed_by uuid references auth.users (id) on delete set null,
  -- the latest remark on this person for this position (the full history is in candidate_actions)
  remark text,
  added_by uuid references auth.users (id) on delete set null,
  added_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- One live row per person per position.
create unique index if not exists candidate_position_members_one_per_position
  on public.candidate_position_members (position_id, candidate_id) where deleted_at is null;
create index if not exists candidate_position_members_position_stage_idx
  on public.candidate_position_members (position_id, stage) where deleted_at is null;
create index if not exists candidate_position_members_candidate_idx
  on public.candidate_position_members (candidate_id);

alter table public.candidate_position_members enable row level security;
revoke all on public.candidate_position_members from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5) History: insert-only
-- ---------------------------------------------------------------------------
create table if not exists public.candidate_actions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  candidate_id uuid not null references public.candidates (id) on delete cascade,
  application_id uuid references public.candidate_applications (id) on delete set null,
  position_id uuid references public.candidate_positions (id) on delete set null,
  action text not null check (action in (
    'status_change', 'stage_change', 'remark', 'blacklist', 'unblacklist', 'resume_attached', 'resume_marked',
    'added_to_position', 'removed_from_position', 'call_logged', 'field_edit'
  )),
  from_value text,
  to_value text,
  remark text,
  meta jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users (id) on delete set null,
  -- the name shown in the timeline, kept here so the history reads the same after someone leaves
  created_by_name text,
  created_at timestamptz not null default now()
);

create index if not exists candidate_actions_candidate_idx
  on public.candidate_actions (candidate_id, created_at desc);
create index if not exists candidate_actions_position_idx
  on public.candidate_actions (position_id, created_at desc) where position_id is not null;

alter table public.candidate_actions enable row level security;
revoke all on public.candidate_actions from anon, authenticated;

create or replace function public.candidate_actions_refuse_change() returns trigger
language plpgsql
as $$
begin
  raise exception 'candidate_actions is insert-only: history is never edited or deleted';
end;
$$;

drop trigger if exists candidate_actions_no_change on public.candidate_actions;
create trigger candidate_actions_no_change
  before update or delete on public.candidate_actions
  for each row execute function public.candidate_actions_refuse_change();

-- ---------------------------------------------------------------------------
-- 6) The filter view: the same columns as 20261111000002, in the same order, then `blacklisted`
-- ---------------------------------------------------------------------------
drop view if exists public.candidate_filter_records;
create view public.candidate_filter_records with (security_invoker = true) as
select
  a.id,
  a.organization_id,
  a.candidate_id,
  a.sheet_id,
  s.name as sheet_name,
  a.source_row,
  c.full_name,
  c.email,
  c.phone,
  c.current_organization,
  c.current_designation,
  c.location,
  c.total_exp_months,
  a.role,
  a.candidate_source,
  a.sourcing_date,
  a.relevant_exp_months,
  a.notice_period_days,
  a.current_inhand,
  a.expected_inhand,
  a.remark,
  a.status,
  (a.embedding is not null) as indexed,
  a.created_at,
  a.updated_at,
  a.deleted_at,
  (a.sheet_id is null or (s.deleted_at is null and s.status = 'ready')) as sheet_live,
  lower(concat_ws(' ', c.full_name, c.email, c.phone, c.current_organization, c.current_designation,
                  c.location, a.role, a.candidate_source, a.remark,
                  c.industry, c.ug_qualification, c.pg_qualification, c.ppg_qualification, c.institute,
                  array_to_string(c.skills, ' '), c.resume_summary)) as lookup_text,
  c.industry,
  c.preferred_locations,
  lower(array_to_string(c.preferred_locations, ' | ')) as preferred_text,
  c.ug_qualification,
  c.pg_qualification,
  c.ppg_qualification,
  c.institute,
  c.education_type,
  c.degree_year,
  c.career_break,
  c.defence_background,
  a.serving_notice,
  exists (
    select 1 from public.candidate_resume_files r
    where r.candidate_id = c.id and r.status = 'ready'
  ) as has_resume,
  c.skills,
  c.past_companies,
  c.resume_summary,
  c.resume_fts,
  (c.blacklisted_at is not null) as blacklisted
from public.candidate_applications a
join public.candidates c on c.id = a.candidate_id
left join public.candidate_sheets s on s.id = a.sheet_id;

revoke all on public.candidate_filter_records from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7) The free-text search: the body of 20261103000002, plus "and c.blacklisted_at is null" on the pool
-- ---------------------------------------------------------------------------
create or replace function public.hybrid_search_candidates(
  p_organization_id uuid,
  p_filters jsonb default '{}'::jsonb,
  p_preferences jsonb default '{}'::jsonb,
  p_query_text text default '',
  p_query_embedding extensions.vector(768) default null,
  p_match_count integer default 30,
  p_rrf_k integer default 50,
  p_embedding_model text default null
)
returns table (
  application_id uuid,
  rrf_score double precision,
  structured_rank integer,
  keyword_rank integer,
  semantic_rank integer,
  matching_count integer
)
language sql
stable
set search_path = public, extensions
as $$
  with f as (
    select coalesce(p_filters, '{}'::jsonb) as j, coalesce(p_preferences, '{}'::jsonb) as p
  ),
  pool as (
    select a.id, a.role, a.relevant_exp_months, a.notice_period_days, a.expected_inhand, a.sourcing_date,
           a.fts, a.embedding, a.embedding_model, c.location, c.current_designation
    from public.candidate_applications a
    join public.candidates c on c.id = a.candidate_id
    left join public.candidate_sheets s on s.id = a.sheet_id
    cross join f
    where a.organization_id = p_organization_id
      and a.deleted_at is null
      and c.blacklisted_at is null
      and (a.sheet_id is null or (s.deleted_at is null and s.status = 'ready'))
      and (not (f.j ? 'roles') or exists (
            select 1 from jsonb_array_elements_text(f.j -> 'roles') r(v)
            where a.role ilike '%' || replace(replace(replace(r.v, '\', '\\'), '%', '\%'), '_', '\_') || '%'
               or c.current_designation ilike '%' || replace(replace(replace(r.v, '\', '\\'), '%', '\%'), '_', '\_') || '%'))
      and (not (f.j ? 'locations') or exists (
            select 1 from jsonb_array_elements_text(f.j -> 'locations') l(v)
            where c.location ilike '%' || replace(replace(replace(l.v, '\', '\\'), '%', '\%'), '_', '\_') || '%'))
      and (not (f.j ? 'min_relevant_exp_months') or a.relevant_exp_months >= (f.j ->> 'min_relevant_exp_months')::int)
      and (not (f.j ? 'max_relevant_exp_months') or a.relevant_exp_months <= (f.j ->> 'max_relevant_exp_months')::int)
      and (not (f.j ? 'min_total_exp_months') or c.total_exp_months >= (f.j ->> 'min_total_exp_months')::int)
      and (not (f.j ? 'max_notice_days') or a.notice_period_days <= (f.j ->> 'max_notice_days')::int)
      and (not (f.j ? 'max_expected_inhand') or a.expected_inhand <= (f.j ->> 'max_expected_inhand')::int)
      and (not (f.j ? 'statuses') or a.status in (select jsonb_array_elements_text(f.j -> 'statuses')))
      and (not (f.j ? 'exclude_statuses') or a.status not in (select jsonb_array_elements_text(f.j -> 'exclude_statuses')))
      and (not (f.j ? 'sourced_after') or a.sourcing_date >= (f.j ->> 'sourced_after')::date)
      and (not (f.j ? 'sourced_before') or a.sourcing_date <= (f.j ->> 'sourced_before')::date)
  ),
  leg_size as (
    select greatest(least(coalesce(p_match_count, 30), 100) * 2, 50) as n
  ),
  structured as (
    select pool.id,
           row_number() over (
             order by
               (case when f.p ? 'roles' and exists (
                     select 1 from jsonb_array_elements_text(f.p -> 'roles') r(v)
                     where pool.role ilike '%' || r.v || '%' or pool.current_designation ilike '%' || r.v || '%')
                   then 1 else 0 end
                + case when f.p ? 'locations' and exists (
                     select 1 from jsonb_array_elements_text(f.p -> 'locations') l(v)
                     where pool.location ilike '%' || l.v || '%')
                   then 1 else 0 end
                + case when f.p ? 'min_relevant_exp_months'
                        and pool.relevant_exp_months >= (f.p ->> 'min_relevant_exp_months')::int then 1 else 0 end
                + case when f.p ? 'max_notice_days'
                        and pool.notice_period_days <= (f.p ->> 'max_notice_days')::int then 1 else 0 end
                + case when f.p ? 'max_expected_inhand'
                        and pool.expected_inhand <= (f.p ->> 'max_expected_inhand')::int then 1 else 0 end) desc,
               pool.relevant_exp_months desc nulls last,
               pool.sourcing_date desc nulls last,
               pool.id
           ) as rank_ix
    from pool cross join f
  ),
  keywords as (
    select nullif(replace(plainto_tsquery('english', coalesce(p_query_text, ''))::text, '&', '|'), '')::tsquery as q
  ),
  keyword as (
    select pool.id, row_number() over (order by ts_rank_cd(pool.fts, keywords.q) desc, pool.id) as rank_ix
    from pool, keywords
    where keywords.q is not null and pool.fts @@ keywords.q
  ),
  semantic as (
    select pool.id, row_number() over (order by pool.embedding <=> p_query_embedding, pool.id) as rank_ix
    from pool
    where p_query_embedding is not null and pool.embedding is not null
      and (p_embedding_model is null or pool.embedding_model = p_embedding_model)
  ),
  legs as (
    select id, rank_ix, 's' as leg from structured where rank_ix <= (select n from leg_size)
    union all
    select id, rank_ix, 'k' from keyword where rank_ix <= (select n from leg_size)
    union all
    select id, rank_ix, 'v' from semantic where rank_ix <= (select n from leg_size)
  ),
  fused as (
    select id,
           sum(1.0 / (coalesce(p_rrf_k, 50) + rank_ix))::double precision as score,
           max(case when leg = 's' then rank_ix end)::int as s_rank,
           max(case when leg = 'k' then rank_ix end)::int as k_rank,
           max(case when leg = 'v' then rank_ix end)::int as v_rank
    from legs
    group by id
  )
  select fused.id, fused.score, fused.s_rank, fused.k_rank, fused.v_rank,
         (select count(*) from pool)::int
  from fused
  order by fused.score desc, fused.id
  limit least(greatest(coalesce(p_match_count, 30), 1), 100);
$$;

revoke execute on function public.hybrid_search_candidates(uuid, jsonb, jsonb, text, extensions.vector, integer, integer, text)
  from public, anon, authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
