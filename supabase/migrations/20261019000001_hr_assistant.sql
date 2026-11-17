-- =================================================================================
-- Migration: 20261019000001_hr_assistant.sql
-- Description: HR Policy Assistant (floating bot) - versioned policy documents, their
--   chunks (pgvector), similarity search, Q&A logs, and a private storage bucket.
--   1) hr_policies       : one row per policy ("Leave Policy")
--   2) hr_documents      : one row per uploaded file = a version (v1, v2, ...). At most one
--                          version per policy is 'ready' (live); older ones are 'archived'
--                          with their chunks kept, so restoring one is instant.
--   3) hr_policy_chunks  : searchable text chunks + 768-dim embeddings
--   4) hr_assistant_logs : every question asked and the answer given
--   + functions match_hr_policy_chunks, hr_create_policy_version, hr_set_live_version
--   + private storage bucket 'hr-policies'
-- Safety: ADDITIVE ONLY. Enables the pgvector extension and creates new objects; does not
--         alter or read any existing table. Safe to re-run.
-- How to apply: run this whole file once in the Supabase SQL Editor (or supabase db push).
-- Rollback:   DROP TABLE public.hr_assistant_logs, public.hr_policy_chunks,
--               public.hr_documents, public.hr_policies CASCADE;
--             DROP FUNCTION public.match_hr_policy_chunks, public.hr_create_policy_version,
--               public.hr_set_live_version;
--             DELETE FROM storage.buckets WHERE id = 'hr-policies';  (empty the bucket first)
--             (the floating bot then shows "unavailable" answers; nothing else is affected).
-- =================================================================================

BEGIN;

create extension if not exists vector with schema extensions;

-- ---------------------------------------------------------------------------
-- Policies. Written only by server code using the service role (bypasses RLS).
-- ---------------------------------------------------------------------------
create table if not exists public.hr_policies (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(trim(title)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One policy per title, ignoring case: re-uploading "leave_policy.pdf" adds a
-- version to "Leave_Policy" instead of creating a duplicate policy.
create unique index if not exists hr_policies_title_key on public.hr_policies (lower(title));

alter table public.hr_policies enable row level security;

-- ---------------------------------------------------------------------------
-- Policy versions (one row per uploaded file).
-- ---------------------------------------------------------------------------
create table if not exists public.hr_documents (
  id uuid primary key default gen_random_uuid(),
  policy_id uuid not null references public.hr_policies (id) on delete cascade,
  version integer not null check (version > 0),
  name text not null,
  storage_path text,
  mime_type text,
  size_bytes integer,
  status text not null default 'processing'
    check (status in ('processing', 'ready', 'archived', 'failed')),
  error text,
  chunk_count integer not null default 0,
  uploaded_by uuid references auth.users (id) on delete set null,
  uploaded_by_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (policy_id, version)
);

-- The database itself guarantees a policy never has two live versions.
create unique index if not exists hr_documents_one_live_per_policy
  on public.hr_documents (policy_id)
  where status = 'ready';

-- No policies: only server code (service role) reads versions. Signed-in users would
-- otherwise see storage paths, uploader emails and drafts.
alter table public.hr_documents enable row level security;

-- ---------------------------------------------------------------------------
-- Chunks. Deleting a version (or its policy) deletes its chunks.
-- ---------------------------------------------------------------------------
create table if not exists public.hr_policy_chunks (
  id bigint generated always as identity primary key,
  document_id uuid not null references public.hr_documents (id) on delete cascade,
  chunk_index integer not null,
  content text not null,
  embedding extensions.vector(768) not null,
  created_at timestamptz not null default now(),
  unique (document_id, chunk_index)
);

create index if not exists hr_policy_chunks_embedding_idx
  on public.hr_policy_chunks
  using hnsw (embedding extensions.vector_cosine_ops);

-- No policies: the policy text is only served through /api/hr-assistant, after the
-- server checks the caller is staff (tenants and vendors must not read it directly).
alter table public.hr_policy_chunks enable row level security;

-- ---------------------------------------------------------------------------
-- Similarity search over live versions only. SECURITY INVOKER (the default);
-- callable only by the service role (see the revokes below).
-- ---------------------------------------------------------------------------
create or replace function public.match_hr_policy_chunks(
  query_embedding extensions.vector(768),
  match_count integer default 3
)
returns table (id bigint, source text, content text, similarity double precision)
language sql
stable
set search_path = public, extensions
as $$
  select
    c.id,
    d.name as source,
    c.content,
    1 - (c.embedding <=> query_embedding) as similarity
  from public.hr_policy_chunks c
  join public.hr_documents d on d.id = c.document_id
  where d.status = 'ready'
  order by c.embedding <=> query_embedding
  limit least(match_count, 20);
$$;

-- ---------------------------------------------------------------------------
-- Create the next version of a policy, as 'processing'.
-- p_policy_id given -> new version of that policy ("Replace").
-- p_policy_id null  -> the policy titled p_title (case-insensitive), created if new.
-- Locks the policy row so concurrent uploads get distinct version numbers.
-- ---------------------------------------------------------------------------
create or replace function public.hr_create_policy_version(
  p_name text,
  p_title text default null,
  p_policy_id uuid default null,
  p_storage_path text default null,
  p_mime_type text default null,
  p_size_bytes integer default null,
  p_uploaded_by uuid default null,
  p_uploaded_by_email text default null
)
returns public.hr_documents
language plpgsql
set search_path = public
as $$
declare
  v_policy_id uuid := p_policy_id;
  v_title text := trim(coalesce(p_title, p_name));
  v_version integer;
  v_row public.hr_documents;
begin
  if v_policy_id is null then
    insert into public.hr_policies (title)
    values (v_title)
    on conflict ((lower(title))) do nothing
    returning id into v_policy_id;

    if v_policy_id is null then
      select id into v_policy_id from public.hr_policies where lower(title) = lower(v_title);
    end if;
  end if;

  perform 1 from public.hr_policies where id = v_policy_id for update;
  if not found then
    raise exception 'HR policy % not found', v_policy_id using errcode = 'P0002';
  end if;

  select coalesce(max(version), 0) + 1 into v_version
  from public.hr_documents
  where policy_id = v_policy_id;

  insert into public.hr_documents (
    policy_id, version, name, storage_path, mime_type, size_bytes,
    uploaded_by, uploaded_by_email, status
  )
  values (
    v_policy_id, v_version, p_name, p_storage_path, p_mime_type, p_size_bytes,
    p_uploaded_by, p_uploaded_by_email, 'processing'
  )
  returning * into v_row;

  update public.hr_policies set updated_at = now() where id = v_policy_id;
  return v_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- Make a version the live one, archiving the previous live version, in one
-- transaction. Used when indexing finishes (p_only_if_newer = true, so a slow
-- older upload cannot override a newer live version) and by "Restore".
-- ---------------------------------------------------------------------------
create or replace function public.hr_set_live_version(
  p_document_id uuid,
  p_chunk_count integer default null,
  p_only_if_newer boolean default false
)
returns public.hr_documents
language plpgsql
set search_path = public
as $$
declare
  v_doc public.hr_documents;
  v_live public.hr_documents;
begin
  select * into v_doc from public.hr_documents where id = p_document_id;
  if not found then
    raise exception 'HR policy version % not found', p_document_id using errcode = 'P0002';
  end if;

  -- Serialize all version changes for this policy, then re-read.
  perform 1 from public.hr_policies where id = v_doc.policy_id for update;
  select * into v_doc from public.hr_documents where id = p_document_id;

  if v_doc.status = 'ready' then
    return v_doc;
  end if;
  if v_doc.status = 'failed' then
    raise exception 'A failed version cannot be made live' using errcode = '22023';
  end if;

  select * into v_live
  from public.hr_documents
  where policy_id = v_doc.policy_id and status = 'ready';

  if p_only_if_newer and v_live.id is not null and v_live.version > v_doc.version then
    update public.hr_documents
    set status = 'archived',
        chunk_count = coalesce(p_chunk_count, chunk_count),
        updated_at = now()
    where id = v_doc.id
    returning * into v_doc;
    return v_doc;
  end if;

  if v_live.id is not null then
    update public.hr_documents
    set status = 'archived', updated_at = now()
    where id = v_live.id;
  end if;

  update public.hr_documents
  set status = 'ready',
      error = null,
      chunk_count = coalesce(p_chunk_count, chunk_count),
      updated_at = now()
  where id = v_doc.id
  returning * into v_doc;

  update public.hr_policies set updated_at = now() where id = v_doc.policy_id;
  return v_doc;
end;
$$;

-- Only server code (service role) may search or change versions.
revoke execute on function public.match_hr_policy_chunks(extensions.vector, integer)
  from public, anon, authenticated;
revoke execute on function public.hr_create_policy_version(text, text, uuid, text, text, integer, uuid, text)
  from public, anon, authenticated;
revoke execute on function public.hr_set_live_version(uuid, integer, boolean)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Q&A logs. Users see only their own.
-- ---------------------------------------------------------------------------
create table if not exists public.hr_assistant_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete set null,
  question text not null,
  answer text not null,
  blocked_stage text check (blocked_stage in ('input', 'output')),
  block_reason text,
  latency_ms integer,
  created_at timestamptz not null default now()
);

create index if not exists hr_assistant_logs_user_created_idx
  on public.hr_assistant_logs (user_id, created_at desc);

alter table public.hr_assistant_logs enable row level security;

drop policy if exists "Users can insert their own HR assistant logs" on public.hr_assistant_logs;
create policy "Users can insert their own HR assistant logs"
  on public.hr_assistant_logs for insert
  to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists "Users can read their own HR assistant logs" on public.hr_assistant_logs;
create policy "Users can read their own HR assistant logs"
  on public.hr_assistant_logs for select
  to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Private bucket for the original uploaded files. No storage.objects policies:
-- only the service role (server routes) can touch it.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('hr-policies', 'hr-policies', false)
on conflict (id) do nothing;

NOTIFY pgrst, 'reload schema';
COMMIT;
