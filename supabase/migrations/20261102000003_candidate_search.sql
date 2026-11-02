-- =================================================================================
-- Migration: 20261102000003_candidate_search.sql
-- Description: owner 2026-11-02 — Candidate Search (Tech console tab; HR and Tech logins).
--   HR uploads candidate Excel sheets, adds / edits / deletes candidates in the portal, and searches them in plain
--   English; the app ranks the top N (max 30) with an explanation.
--   1) candidate_sheets        : one row per uploaded file. Re-uploading the same file name asks Replace or Merge.
--   2) candidates              : one row per PERSON, deduplicated by email / phone inside an organisation
--   3) candidate_applications  : one row per Excel row or hand-added entry (a "record"): the role the candidate was
--                                sourced for, experience, notice, ₹/month in hand, status; + keyword index + embedding
--   4) candidate_sheet_rows    : every uploaded row exactly as it was in the file, with the problems found (audit)
--   5) candidate_search_logs   : every search, what the AI understood, what it returned, and how long each step took
--   + view candidate_records (record + person + sheet, with "sheet_live")
--   + functions hybrid_search_candidates (filters -> structured + keyword + meaning search -> RRF),
--     candidate_set_embeddings, candidate_finish_sheet, candidate_index_stats
-- Deletes are SOFT everywhere (deleted_at) so HR can restore. Nothing in the app hard-deletes.
-- Access: RLS on, NO policies: only server code (service role) reads or writes, after it checks the caller is
--         HR / Tech / org super admin / master admin of that organisation (backend/lib/candidates/access.ts).
-- Safety: ADDITIVE ONLY. Creates new objects; does not alter or read any existing table (only references
--         public.organizations and auth.users by foreign key). Safe to re-run.
-- How to apply: run this whole file once in the Supabase SQL Editor.
-- Rollback:   DROP VIEW IF EXISTS public.candidate_records;
--             DROP FUNCTION IF EXISTS public.hybrid_search_candidates, public.candidate_set_embeddings,
--               public.candidate_finish_sheet, public.candidate_index_stats;
--             DROP TABLE IF EXISTS public.candidate_search_logs, public.candidate_sheet_rows,
--               public.candidate_applications, public.candidates, public.candidate_sheets CASCADE;
--             (the Candidate Search tab then says it is not set up; nothing else is affected).
-- =================================================================================

BEGIN;

create extension if not exists vector with schema extensions;

-- ---------------------------------------------------------------------------
-- Sheets (uploaded files)
-- ---------------------------------------------------------------------------
create table if not exists public.candidate_sheets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  -- lower-case file name without extension: "Candidates June.xlsx" and "candidates june.csv" are the same sheet
  name_key text not null check (length(name_key) > 0),
  status text not null default 'importing' check (status in ('importing', 'ready', 'failed')),
  error text,
  row_count integer not null default 0,
  flagged_count integer not null default 0,
  skipped_count integer not null default 0,
  upload_count integer not null default 1 check (upload_count > 0),
  uploaded_by uuid references auth.users (id) on delete set null,
  uploaded_by_email text,
  replaces_sheet_id uuid references public.candidate_sheets (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references auth.users (id) on delete set null
);

-- At most one live sheet per file name per organisation (an import in progress or a failed one does not count).
create unique index if not exists candidate_sheets_one_live_name
  on public.candidate_sheets (organization_id, name_key)
  where status = 'ready' and deleted_at is null;
create index if not exists candidate_sheets_org_idx on public.candidate_sheets (organization_id, created_at desc);

alter table public.candidate_sheets enable row level security;

-- ---------------------------------------------------------------------------
-- Candidates (people)
-- ---------------------------------------------------------------------------
create table if not exists public.candidates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  full_name text not null check (length(trim(full_name)) > 0),
  email text,
  -- lower-case valid email, set by the app; NULL when missing or invalid
  email_key text,
  phone text,
  -- last 10 digits of a valid Indian mobile, set by the app; NULL when missing or invalid
  phone_key text,
  current_organization text,
  current_designation text,
  location text,
  total_exp_months integer check (total_exp_months is null or total_exp_months between 0 and 720),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists candidates_org_email_idx on public.candidates (organization_id, email_key) where email_key is not null;
create index if not exists candidates_org_phone_idx on public.candidates (organization_id, phone_key) where phone_key is not null;

alter table public.candidates enable row level security;

-- ---------------------------------------------------------------------------
-- Records (one per Excel row or hand-added entry)
-- ---------------------------------------------------------------------------
create table if not exists public.candidate_applications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  candidate_id uuid not null references public.candidates (id) on delete cascade,
  -- NULL = added by hand in the portal
  sheet_id uuid references public.candidate_sheets (id) on delete cascade,
  source_row integer,
  -- the role the candidate was sourced FOR (owner 2026-11-02), not their own job title
  role text,
  candidate_source text,
  sourcing_date date,
  relevant_exp_months integer check (relevant_exp_months is null or relevant_exp_months between 0 and 720),
  notice_period_days integer check (notice_period_days is null or notice_period_days between 0 and 365),
  -- rupees per month, in hand (owner 2026-11-02)
  current_inhand integer check (current_inhand is null or current_inhand >= 0),
  expected_inhand integer check (expected_inhand is null or expected_inhand >= 0),
  remark text,
  status text not null default 'new'
    check (status in ('new', 'in_process', 'shortlisted', 'interview', 'on_hold', 'not_responding', 'rejected', 'joined')),
  -- the profile text used for keyword and meaning search; built by the app, never contains email or phone
  search_text text not null default '',
  fts tsvector generated always as (to_tsvector('english', search_text)) stored,
  -- NULL until indexed (and reset by the app whenever search_text changes)
  embedding extensions.vector(768),
  embedding_model text,
  created_by uuid references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references auth.users (id) on delete set null
);

create index if not exists candidate_applications_org_idx on public.candidate_applications (organization_id) where deleted_at is null;
create index if not exists candidate_applications_candidate_idx on public.candidate_applications (candidate_id);
create index if not exists candidate_applications_sheet_idx on public.candidate_applications (sheet_id);
create index if not exists candidate_applications_fts_idx on public.candidate_applications using gin (fts);
create index if not exists candidate_applications_relevant_exp_idx on public.candidate_applications (organization_id, relevant_exp_months);
create index if not exists candidate_applications_notice_idx on public.candidate_applications (organization_id, notice_period_days);
create index if not exists candidate_applications_expected_idx on public.candidate_applications (organization_id, expected_inhand);
-- No vector index on purpose: a few thousand rows are searched exactly (perfect recall). Add HNSW when the table grows.

alter table public.candidate_applications enable row level security;

-- ---------------------------------------------------------------------------
-- Raw uploaded rows (audit + data-quality report)
-- ---------------------------------------------------------------------------
create table if not exists public.candidate_sheet_rows (
  id bigint generated always as identity primary key,
  sheet_id uuid not null references public.candidate_sheets (id) on delete cascade,
  upload_no integer not null default 1,
  row_number integer not null,
  raw jsonb not null default '{}'::jsonb,
  issues text[] not null default '{}',
  skipped boolean not null default false,
  application_id uuid references public.candidate_applications (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists candidate_sheet_rows_sheet_idx on public.candidate_sheet_rows (sheet_id, upload_no, row_number);

alter table public.candidate_sheet_rows enable row level security;

-- ---------------------------------------------------------------------------
-- Search log (traceability: what was asked, understood, returned, and how long each step took)
-- ---------------------------------------------------------------------------
create table if not exists public.candidate_search_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid references auth.users (id) on delete set null,
  query text not null,
  top_n integer not null,
  spec jsonb,
  matching_count integer,
  compared_count integer,
  result_ids uuid[] not null default '{}',
  ai_parsed boolean not null default false,
  ai_ranked boolean not null default false,
  notices text[] not null default '{}',
  parse_ms integer,
  retrieve_ms integer,
  rerank_ms integer,
  total_ms integer,
  error text,
  created_at timestamptz not null default now()
);

create index if not exists candidate_search_logs_org_idx on public.candidate_search_logs (organization_id, created_at desc);

alter table public.candidate_search_logs enable row level security;

-- ---------------------------------------------------------------------------
-- Records joined with their person and sheet. sheet_live = hand-added, or the sheet is ready and not deleted.
-- A record is visible when deleted_at IS NULL AND sheet_live.
-- ---------------------------------------------------------------------------
create or replace view public.candidate_records with (security_invoker = true) as
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
                  c.location, a.role, a.candidate_source, a.remark)) as lookup_text
from public.candidate_applications a
join public.candidates c on c.id = a.candidate_id
left join public.candidate_sheets s on s.id = a.sheet_id;

revoke all on public.candidate_records from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Hybrid search. p_filters are MUST-HAVES (a record failing one, or with that value missing, is excluded).
-- p_preferences only order the structured list. Three ranked lists over the filtered pool:
--   structured : preferences met (desc), then relevant experience (desc), then newest sourcing date
--   keyword    : the query's words OR-ed, ranked by ts_rank_cd
--   meaning    : cosine distance to the query embedding (skipped when it is NULL)
-- merged with Reciprocal Rank Fusion: score = sum of 1 / (rrf_k + rank) over the lists a record appears in.
-- Filter keys (all optional): roles text[] (matches role sourced for OR current designation, substring, any),
--   locations text[] (substring, any), min_relevant_exp_months, max_relevant_exp_months, min_total_exp_months,
--   max_notice_days, max_expected_inhand, statuses text[], exclude_statuses text[], sourced_after, sourced_before.
-- Preference keys (all optional): roles, locations, min_relevant_exp_months, max_notice_days, max_expected_inhand.
-- ---------------------------------------------------------------------------
create or replace function public.hybrid_search_candidates(
  p_organization_id uuid,
  p_filters jsonb default '{}'::jsonb,
  p_preferences jsonb default '{}'::jsonb,
  p_query_text text default '',
  p_query_embedding extensions.vector(768) default null,
  p_match_count integer default 30,
  p_rrf_k integer default 50
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
           a.fts, a.embedding, c.location, c.current_designation
    from public.candidate_applications a
    join public.candidates c on c.id = a.candidate_id
    left join public.candidate_sheets s on s.id = a.sheet_id
    cross join f
    where a.organization_id = p_organization_id
      and a.deleted_at is null
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

-- ---------------------------------------------------------------------------
-- Store embeddings for a batch: [{ "id": uuid, "embedding": "[...]", "search_text": "..." }].
-- A row is only updated if its search_text is still the text that was embedded (an edit in between wins).
-- Returns how many rows were updated.
-- ---------------------------------------------------------------------------
create or replace function public.candidate_set_embeddings(p_items jsonb, p_model text)
returns integer
language plpgsql
set search_path = public, extensions
as $$
declare
  v_count integer;
begin
  update public.candidate_applications a
  set embedding = x.embedding::extensions.vector,
      embedding_model = p_model
  from jsonb_to_recordset(p_items) as x(id uuid, embedding text, search_text text)
  where a.id = x.id
    and a.search_text = x.search_text;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- Finish an import in one transaction: on Replace, soft-delete the old sheet; then make the new one live.
-- ---------------------------------------------------------------------------
create or replace function public.candidate_finish_sheet(
  p_sheet_id uuid,
  p_replace_sheet_id uuid default null,
  p_user_id uuid default null
)
returns public.candidate_sheets
language plpgsql
set search_path = public
as $$
declare
  v_row public.candidate_sheets;
begin
  if p_replace_sheet_id is not null then
    update public.candidate_sheets
    set deleted_at = now(), deleted_by = p_user_id, updated_at = now()
    where id = p_replace_sheet_id and deleted_at is null;
  end if;

  update public.candidate_sheets
  set status = 'ready', error = null, updated_at = now()
  where id = p_sheet_id
  returning * into v_row;

  if v_row.id is null then
    raise exception 'Candidate sheet % not found', p_sheet_id using errcode = 'P0002';
  end if;
  return v_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- Per-sheet counts of visible records and of visible records still waiting for an embedding.
-- sheet_id NULL = hand-added records. Deleted sheets are included (their records are not "visible" but are counted
-- as live_count = records not individually deleted), so the Sheets list can show what a restore brings back.
-- ---------------------------------------------------------------------------
create or replace function public.candidate_index_stats(p_organization_id uuid)
returns table (sheet_id uuid, live_count integer, pending_count integer)
language sql
stable
set search_path = public
as $$
  select a.sheet_id,
         count(*)::int as live_count,
         count(*) filter (where a.embedding is null)::int as pending_count
  from public.candidate_applications a
  where a.organization_id = p_organization_id
    and a.deleted_at is null
  group by a.sheet_id;
$$;

-- Only server code (service role) may call these.
revoke execute on function public.hybrid_search_candidates(uuid, jsonb, jsonb, text, extensions.vector, integer, integer)
  from public, anon, authenticated;
revoke execute on function public.candidate_set_embeddings(jsonb, text) from public, anon, authenticated;
revoke execute on function public.candidate_finish_sheet(uuid, uuid, uuid) from public, anon, authenticated;
revoke execute on function public.candidate_index_stats(uuid) from public, anon, authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
