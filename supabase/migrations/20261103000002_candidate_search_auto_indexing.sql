-- =================================================================================
-- Migration: 20261103000002_candidate_search_auto_indexing.sql
-- Description: owner 2026-11-03 — Candidate Search prepares uploaded records for meaning search on its own, with Jina
--   embeddings (jina-embeddings-v3, 768 dims: same column size, no re-index of the column type). HR only sees a
--   progress bar; a busy embedding service pauses and retries in the background instead of showing an error.
--   1) candidate_applications : + embed_attempts, embed_failed_at, embed_error. A record the service rejects 3 times is
--                               set aside (still found by filters and keywords). Reset automatically when its text
--                               changes (trigger).
--   2) candidate_index_state  : per organisation: a short lease (so two workers never embed the same records), the
--                               pause after a "busy" answer (1, 2, 5, 10 min), and the last error (for Tech, in logs).
--   3) candidate_pending_embeddings / candidate_orgs_to_index / candidate_index_claim / candidate_index_release /
--      candidate_mark_embed_failed / candidate_index_progress : the background worker's steps.
--   4) hybrid_search_candidates : + p_embedding_model. Meaning search compares only records embedded by the same model
--                               as the query, so records still waiting (or embedded by the old Gemini model) never
--                               produce wrong matches; they are still found by filters and keywords.
-- Safety: ADDITIVE. New columns with defaults, one new table, new functions, one trigger. hybrid_search_candidates is
--         re-created with one extra optional argument (same results when it is not passed). No row is changed or
--         deleted by this file: records embedded with Gemini are re-embedded with Jina by the background worker.
--         Run AFTER 20261102000003, 20261102000004 and 20261103000001.
--         If 20261102000003 is ever re-run, re-run this file after it (that file re-creates the old 7-argument search).
-- How to apply: run this whole file once in the Supabase SQL Editor. Then set JINA_API_KEY in the environment.
-- Rollback:   DROP FUNCTION IF EXISTS public.candidate_pending_embeddings(uuid, text, integer),
--               public.candidate_orgs_to_index(text), public.candidate_index_claim(uuid, integer),
--               public.candidate_index_release(uuid, boolean, text, integer[]),
--               public.candidate_mark_embed_failed(uuid, uuid[], text, integer),
--               public.candidate_index_progress(uuid, text);
--             DROP TRIGGER IF EXISTS candidate_applications_embed_reset ON public.candidate_applications;
--             DROP FUNCTION IF EXISTS public.candidate_applications_embed_reset();
--             DROP TABLE IF EXISTS public.candidate_index_state;
--             ALTER TABLE public.candidate_applications DROP COLUMN IF EXISTS embed_attempts,
--               DROP COLUMN IF EXISTS embed_failed_at, DROP COLUMN IF EXISTS embed_error;
--             then re-run the hybrid_search_candidates definition from 20261102000003.
-- =================================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Per-record retry state
-- ---------------------------------------------------------------------------
alter table public.candidate_applications
  add column if not exists embed_attempts integer not null default 0,
  add column if not exists embed_failed_at timestamptz,
  add column if not exists embed_error text;

-- New text = a fresh start: the record is tried again.
create or replace function public.candidate_applications_embed_reset()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.search_text is distinct from old.search_text then
    new.embed_attempts := 0;
    new.embed_failed_at := null;
    new.embed_error := null;
  end if;
  return new;
end;
$$;

drop trigger if exists candidate_applications_embed_reset on public.candidate_applications;
create trigger candidate_applications_embed_reset
  before update of search_text on public.candidate_applications
  for each row execute function public.candidate_applications_embed_reset();

-- ---------------------------------------------------------------------------
-- 2) Per-organisation worker state
-- ---------------------------------------------------------------------------
create table if not exists public.candidate_index_state (
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  lease_until timestamptz,
  paused_until timestamptz,
  failures integer not null default 0,
  last_error text,
  last_run_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.candidate_index_state enable row level security;

-- ---------------------------------------------------------------------------
-- 3) Worker steps
-- ---------------------------------------------------------------------------
-- Records of visible sheets (or hand-added) still to embed with p_model, newest change first.
create or replace function public.candidate_pending_embeddings(p_organization_id uuid, p_model text, p_limit integer)
returns table (id uuid, search_text text)
language sql
stable
set search_path = public
as $$
  select a.id, a.search_text
  from public.candidate_applications a
  left join public.candidate_sheets s on s.id = a.sheet_id
  where a.organization_id = p_organization_id
    and a.deleted_at is null
    and (a.sheet_id is null or (s.deleted_at is null and s.status = 'ready'))
    and a.search_text <> ''
    and a.embed_failed_at is null
    and (a.embedding is null or a.embedding_model is distinct from p_model)
  order by a.updated_at desc, a.id
  limit greatest(least(coalesce(p_limit, 100), 500), 1);
$$;

-- Organisations with something to embed that are not paused.
create or replace function public.candidate_orgs_to_index(p_model text)
returns setof uuid
language sql
stable
set search_path = public
as $$
  select distinct a.organization_id
  from public.candidate_applications a
  left join public.candidate_sheets s on s.id = a.sheet_id
  left join public.candidate_index_state st on st.organization_id = a.organization_id
  where a.deleted_at is null
    and (a.sheet_id is null or (s.deleted_at is null and s.status = 'ready'))
    and a.search_text <> ''
    and a.embed_failed_at is null
    and (a.embedding is null or a.embedding_model is distinct from p_model)
    and (st.paused_until is null or st.paused_until <= now());
$$;

-- Take the organisation's lease for p_seconds. False when another worker holds it or the organisation is paused.
create or replace function public.candidate_index_claim(p_organization_id uuid, p_seconds integer)
returns boolean
language plpgsql
set search_path = public
as $$
declare
  v_ok boolean;
begin
  insert into public.candidate_index_state (organization_id) values (p_organization_id)
  on conflict (organization_id) do nothing;

  update public.candidate_index_state
  set lease_until = now() + make_interval(secs => greatest(p_seconds, 1)), last_run_at = now(), updated_at = now()
  where organization_id = p_organization_id
    and (lease_until is null or lease_until <= now())
    and (paused_until is null or paused_until <= now())
  returning true into v_ok;
  return coalesce(v_ok, false);
end;
$$;

-- Give the lease back. p_ok: clear the pause and the failure count. Otherwise count a failure and pause for
-- p_backoff_seconds[failures] (the last entry repeats), e.g. {60,120,300,600} = 1, 2, 5, then 10 minutes.
create or replace function public.candidate_index_release(p_organization_id uuid, p_ok boolean, p_error text, p_backoff_seconds integer[])
returns void
language sql
set search_path = public
as $$
  update public.candidate_index_state
  set lease_until = null,
      failures = case when p_ok then 0 else failures + 1 end,
      paused_until = case when p_ok then null else now() + make_interval(secs => coalesce(
        p_backoff_seconds[least(failures + 1, coalesce(array_length(p_backoff_seconds, 1), 1))], 60)) end,
      last_error = case when p_ok then null else left(p_error, 500) end,
      updated_at = now()
  where organization_id = p_organization_id;
$$;

-- The service rejected these records' text: count a try; after p_max_attempts the record is set aside.
create or replace function public.candidate_mark_embed_failed(p_organization_id uuid, p_ids uuid[], p_error text, p_max_attempts integer)
returns integer
language plpgsql
set search_path = public
as $$
declare
  v_count integer;
begin
  update public.candidate_applications
  set embed_attempts = embed_attempts + 1,
      embed_error = left(p_error, 500),
      embed_failed_at = case when embed_attempts + 1 >= p_max_attempts then now() else null end
  where organization_id = p_organization_id and id = any(p_ids);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Per sheet (NULL = hand-added): records not deleted, and how many are still waiting for p_model (set-aside records
-- count as done). Deleted sheets are included, as in candidate_index_stats.
create or replace function public.candidate_index_progress(p_organization_id uuid, p_model text)
returns table (sheet_id uuid, live_count integer, pending_count integer)
language sql
stable
set search_path = public
as $$
  select a.sheet_id,
         count(*)::int as live_count,
         count(*) filter (
           where a.search_text <> '' and a.embed_failed_at is null
             and (a.embedding is null or a.embedding_model is distinct from p_model)
         )::int as pending_count
  from public.candidate_applications a
  where a.organization_id = p_organization_id
    and a.deleted_at is null
  group by a.sheet_id;
$$;

-- ---------------------------------------------------------------------------
-- 4) Hybrid search: meaning search only between vectors of the same model
-- ---------------------------------------------------------------------------
drop function if exists public.hybrid_search_candidates(uuid, jsonb, jsonb, text, extensions.vector, integer, integer);

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

-- Only server code (service role) may call these.
revoke execute on function public.hybrid_search_candidates(uuid, jsonb, jsonb, text, extensions.vector, integer, integer, text)
  from public, anon, authenticated;
revoke execute on function public.candidate_pending_embeddings(uuid, text, integer) from public, anon, authenticated;
revoke execute on function public.candidate_orgs_to_index(text) from public, anon, authenticated;
revoke execute on function public.candidate_index_claim(uuid, integer) from public, anon, authenticated;
revoke execute on function public.candidate_index_release(uuid, boolean, text, integer[]) from public, anon, authenticated;
revoke execute on function public.candidate_mark_embed_failed(uuid, uuid[], text, integer) from public, anon, authenticated;
revoke execute on function public.candidate_index_progress(uuid, text) from public, anon, authenticated;
revoke execute on function public.candidate_applications_embed_reset() from public, anon, authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
