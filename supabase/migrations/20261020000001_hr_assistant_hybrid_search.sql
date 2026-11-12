-- =================================================================================
-- Migration: 20261020000001_hr_assistant_hybrid_search.sql
-- Description: HR Policy Assistant - hybrid search (meaning + exact words).
--   1) hr_policy_chunks.fts : generated full-text column (english) + GIN index, so exact
--                             terms like "CL", "LOP" or "Maternity Policy" can be matched
--   2) hybrid_match_hr_policy_chunks : runs the existing vector search and a keyword search
--      over live versions only, and merges the two rankings with Reciprocal Rank Fusion (RRF)
-- Safety: ADDITIVE ONLY. Adds one generated column + index and one new function. The existing
--         match_hr_policy_chunks is kept (the app falls back to it). Safe to re-run.
-- How to apply: run this whole file once in the Supabase SQL Editor (after 20261019000001).
-- Rollback:   DROP FUNCTION public.hybrid_match_hr_policy_chunks;
--             DROP INDEX public.hr_policy_chunks_fts_idx;
--             ALTER TABLE public.hr_policy_chunks DROP COLUMN fts;
--             (the app then falls back to vector-only search automatically).
-- =================================================================================

BEGIN;

-- Filled in by Postgres for existing and new chunks; nothing in the app writes it.
alter table public.hr_policy_chunks
  add column if not exists fts tsvector
  generated always as (to_tsvector('english', content)) stored;

create index if not exists hr_policy_chunks_fts_idx
  on public.hr_policy_chunks using gin (fts);

-- ---------------------------------------------------------------------------
-- Hybrid search over live versions only.
-- Keyword side: the question's words are OR-ed (plainto_tsquery joins them with AND,
-- which would almost never match a whole natural-language question), ranked by ts_rank_cd.
-- Merge: RRF score = sum of weight / (rrf_k + rank) over both lists, so a chunk that ranks
-- high in either list rises. "similarity" is still the cosine similarity, for display/logs.
-- SECURITY INVOKER (the default); callable only by the service role (see the revoke below).
-- ---------------------------------------------------------------------------
create or replace function public.hybrid_match_hr_policy_chunks(
  query_text text,
  query_embedding extensions.vector(768),
  match_count integer default 5,
  full_text_weight double precision default 1,
  semantic_weight double precision default 1,
  rrf_k integer default 50
)
returns table (id bigint, source text, content text, similarity double precision)
language sql
stable
set search_path = public, extensions
as $$
  with live as (
    select c.id, c.content, c.embedding, c.fts, d.name as source
    from public.hr_policy_chunks c
    join public.hr_documents d on d.id = c.document_id
    where d.status = 'ready'
  ),
  keywords as (
    select nullif(replace(plainto_tsquery('english', query_text)::text, '&', '|'), '')::tsquery as q
  ),
  full_text as (
    select live.id,
           row_number() over (order by ts_rank_cd(live.fts, keywords.q) desc) as rank_ix
    from live, keywords
    where keywords.q is not null and live.fts @@ keywords.q
    order by rank_ix
    limit least(match_count, 20) * 2
  ),
  semantic as (
    select live.id,
           row_number() over (order by live.embedding <=> query_embedding) as rank_ix
    from live
    order by rank_ix
    limit least(match_count, 20) * 2
  )
  select
    live.id,
    live.source,
    live.content,
    1 - (live.embedding <=> query_embedding) as similarity
  from full_text
  full outer join semantic on full_text.id = semantic.id
  join live on live.id = coalesce(full_text.id, semantic.id)
  order by
    coalesce(1.0 / (rrf_k + full_text.rank_ix), 0.0) * full_text_weight +
    coalesce(1.0 / (rrf_k + semantic.rank_ix), 0.0) * semantic_weight desc
  limit least(match_count, 20);
$$;

-- Only server code (service role) may search, same as match_hr_policy_chunks.
revoke execute on function public.hybrid_match_hr_policy_chunks(
  text, extensions.vector, integer, double precision, double precision, integer
) from public, anon, authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
