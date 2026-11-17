-- Candidate Search: an index for meaning search (owner 2026-11-11, step 1 of the production plan).
--
-- Without it, a meaning search compares the query vector with every record of the organisation: fine at 3,000 records,
-- about a second at 50,000. HNSW is pgvector's approximate-nearest-neighbour index. The search functions order by
-- `embedding <=> query` (cosine distance), hence vector_cosine_ops. Results stay the same in practice; only the time
-- changes. Nothing in the app changes.
--
-- Safety:   ADDITIVE, one index. Building it takes a moment on today's table sizes. Safe to re-run.
-- Apply by hand in the Supabase SQL Editor, after 20261103000002. (No BEGIN/COMMIT on purpose: an index on a large
-- table is best built outside a transaction; on this table either works.)
-- Rollback: DROP INDEX IF EXISTS public.candidate_applications_embedding_hnsw;

create index if not exists candidate_applications_embedding_hnsw
  on public.candidate_applications using hnsw (embedding extensions.vector_cosine_ops);
