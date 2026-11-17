-- Candidate Search: resume files (owner 2026-11-07, phase 1: get every resume into one place).
--
-- HR's resumes sit in the Downloads folders of four laptops. The Resumes tab lets someone on each laptop pick that
-- folder; the browser hashes every PDF / Word file, asks for upload links and sends the bytes straight to the new
-- PRIVATE bucket "candidate-resumes". One row here per stored file; the same file from another laptop (same SHA-256)
-- is skipped. The date the file was downloaded (its modified date on the laptop) is kept so HR can keep to this
-- year's resumes. No parsing and no AI yet (phase 2).
--
--   candidate_resume_files      one row per stored file: hash, name, type, size, where it came from, when downloaded
--   candidate_resume_summary()  files, bytes and dates per laptop, for the page header and the Excel's summary tab
--   bucket candidate-resumes    private; 15 MB per file; PDF, .doc and .docx only. Server code (service role) hands
--                               out upload links and download links that expire (same design as ticket-attachments,
--                               20261104000001_ticket_attachments.sql)
--
-- Safety:   ADDITIVE ONLY. One new table, one function, one private bucket. Nothing existing changes. Safe to re-run.
--           Before it is applied the Resumes tab answers "needs a database update first".
-- Apply by hand in the Supabase SQL Editor, after 20261102000003.
-- Rollback: DROP FUNCTION public.candidate_resume_summary(uuid); DROP TABLE public.candidate_resume_files;
--           DELETE FROM storage.buckets WHERE id = 'candidate-resumes';  (empty the bucket first)

BEGIN;

create table if not exists public.candidate_resume_files (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  -- SHA-256 of the bytes, computed in the browser; the same file uploaded twice (any laptop) is skipped.
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  file_name text not null check (length(trim(file_name)) > 0),
  file_type text not null,
  file_size integer not null check (file_size > 0),
  storage_path text not null,
  -- 'uploading' while the browser sends the bytes; 'ready' once the server has seen the object in storage.
  status text not null default 'uploading' check (status in ('uploading', 'ready')),
  -- The file's modified date on the laptop: for a file in Downloads, the day it was downloaded.
  downloaded_at timestamptz,
  -- Typed once per laptop ("Roohi's laptop"); a browser cannot read the machine's name.
  device_label text,
  folder_path text,
  uploaded_by uuid references auth.users (id) on delete set null,
  uploaded_by_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists candidate_resume_files_org_sha_idx
  on public.candidate_resume_files (organization_id, sha256);
create index if not exists candidate_resume_files_org_downloaded_idx
  on public.candidate_resume_files (organization_id, status, downloaded_at desc);

-- Server code only (service role bypasses RLS); no policies, so browsers cannot read the table directly.
alter table public.candidate_resume_files enable row level security;

create or replace function public.candidate_resume_summary(p_organization_id uuid)
returns table (device_label text, file_count bigint, total_bytes bigint, oldest timestamptz, newest timestamptz)
language sql
stable
set search_path = public
as $$
  select f.device_label, count(*), coalesce(sum(f.file_size), 0)::bigint, min(f.downloaded_at), max(f.downloaded_at)
  from public.candidate_resume_files f
  where f.organization_id = p_organization_id and f.status = 'ready'
  group by f.device_label
  order by f.device_label nulls last;
$$;

revoke all on function public.candidate_resume_summary(uuid) from public, anon, authenticated;

-- Private bucket: 15 MB per file, resumes only.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'candidate-resumes', 'candidate-resumes', false, 15728640,
  array['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']
)
on conflict (id) do nothing;

NOTIFY pgrst, 'reload schema';

COMMIT;
