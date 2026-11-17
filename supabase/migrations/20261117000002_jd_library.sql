-- =================================================================================
-- Migration: 20261117000002_jd_library.sql
-- Description: owner 2026-11-17 — Recruitment: a JD library with versions (Stage 3 of the Recruitment Module spec,
--   "Pick a JD from the library or create one ... version-controls the JD").
--   1) candidate_jds          : one row per job description, by role (title, department), with the number of its
--                               current version and when a position last used it. Soft-deleted (deleted_at).
--   2) candidate_jd_versions  : every saved text of a JD, numbered 1, 2, 3 ... Never edited and never deleted: an edit
--                               adds the next version (a trigger refuses UPDATE and DELETE, as for candidate_actions).
--   3) candidate_jd_uses      : which JD, and which version of it, a position was opened from (one row per position),
--                               so an old position still shows the text it was opened with after the JD changes.
-- Access: RLS on, NO policies: only server code (service role) reads or writes, after backend/lib/candidates/access.ts
--         says the caller may (the same HR roles as the rest of Recruitment).
-- Safety: ADDITIVE. Three new tables, their indexes and one trigger. No existing row, column or function is touched.
-- How to apply: run this whole file once in the Supabase SQL Editor, after 20261117000001. Safe to re-run.
-- Rollback: DROP TABLE IF EXISTS public.candidate_jd_uses; DROP TABLE IF EXISTS public.candidate_jd_versions;
--           DROP TABLE IF EXISTS public.candidate_jds; DROP FUNCTION IF EXISTS public.candidate_jd_versions_refuse_change();
-- =================================================================================

BEGIN;

create table if not exists public.candidate_jds (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  title text not null,
  department text,
  current_version integer not null default 1 check (current_version >= 1),
  -- The first lines of the current version, so the list does not load every text.
  preview text,
  last_used_at timestamptz,
  updated_by_name text,
  created_by uuid references auth.users (id) on delete set null,
  created_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists candidate_jds_org_live_idx on public.candidate_jds (organization_id, updated_at desc) where deleted_at is null;

create table if not exists public.candidate_jd_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  jd_id uuid not null references public.candidate_jds (id) on delete cascade,
  version integer not null check (version >= 1),
  content text not null,
  file_name text,
  note text,
  created_by uuid references auth.users (id) on delete set null,
  created_by_name text,
  created_at timestamptz not null default now(),
  unique (jd_id, version)
);

-- A saved version is history: it is never edited, and only goes when its JD is purged with its organisation.
create or replace function public.candidate_jd_versions_refuse_change() returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' and not exists (select 1 from public.candidate_jds j where j.id = old.jd_id) then
    return old; -- the JD itself is gone (cascade), so its versions go with it
  end if;
  raise exception 'candidate_jd_versions is insert-only: a JD version is never edited or deleted';
end;
$$;
drop trigger if exists candidate_jd_versions_refuse_change on public.candidate_jd_versions;
create trigger candidate_jd_versions_refuse_change
  before update or delete on public.candidate_jd_versions
  for each row execute function public.candidate_jd_versions_refuse_change();

create table if not exists public.candidate_jd_uses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  jd_id uuid not null references public.candidate_jds (id) on delete cascade,
  version integer not null check (version >= 1),
  position_id uuid not null references public.candidate_positions (id) on delete cascade,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (position_id)
);
create index if not exists candidate_jd_uses_jd_idx on public.candidate_jd_uses (jd_id);

alter table public.candidate_jds enable row level security;
alter table public.candidate_jd_versions enable row level security;
alter table public.candidate_jd_uses enable row level security;
revoke all on public.candidate_jds from anon, authenticated;
revoke all on public.candidate_jd_versions from anon, authenticated;
revoke all on public.candidate_jd_uses from anon, authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
