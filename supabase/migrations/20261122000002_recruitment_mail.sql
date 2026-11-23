-- Recruitment-only, read-only Zoho grants and resume attachment provenance.
-- Apply after 20261122000001_resume_sourcing.sql. No existing data is changed.
-- Rollback: drop candidate_resume_mail_items, candidate_resume_mail_connections,
-- candidate_resume_mail_oauth. Imported resume files remain in the library.
BEGIN;
create table if not exists public.candidate_resume_mail_oauth (
  state text primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  redirect_uri text not null,
  dc text not null,
  expires_at timestamptz not null,
  consumed_at timestamptz
);
create table if not exists public.candidate_resume_mail_connections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  address text not null,
  addresses text[] not null,
  refresh_token_enc text,
  dc text not null,
  connected_by uuid references auth.users(id) on delete set null,
  connected_email text,
  folder_id text,
  folder_name text,
  since_date date,
  sourced_role text check (sourced_role is null or length(sourced_role) between 1 and 200),
  sync_every text not null default 'manual' check (sync_every in ('manual', 'hourly')),
  active boolean not null default true,
  scan_start integer not null default 1 check (scan_start > 0),
  scan_complete boolean not null default false,
  lock_token uuid,
  lock_until timestamptz,
  last_synced_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  unique (organization_id, address)
);
create table if not exists public.candidate_resume_mail_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  connection_id uuid not null references public.candidate_resume_mail_connections(id) on delete cascade,
  message_id text not null,
  attachment_id text not null,
  folder_id text not null,
  mailbox text not null,
  sender text not null,
  subject text not null,
  received_at timestamptz not null,
  file_name text not null,
  file_size bigint not null,
  status text not null default 'pending' check (status in ('pending', 'imported', 'duplicate', 'skipped')),
  file_id uuid references public.candidate_resume_files(id) on delete set null,
  last_error text,
  last_attempt_at timestamptz,
  created_at timestamptz not null default now(),
  unique (connection_id, message_id, attachment_id)
);
create index if not exists candidate_resume_mail_pending on public.candidate_resume_mail_items(connection_id, status, received_at);
create index if not exists candidate_resume_mail_file on public.candidate_resume_mail_items(file_id) where file_id is not null;
alter table public.candidate_resume_mail_oauth enable row level security;
alter table public.candidate_resume_mail_connections enable row level security;
alter table public.candidate_resume_mail_items enable row level security;
revoke all on public.candidate_resume_mail_oauth, public.candidate_resume_mail_connections, public.candidate_resume_mail_items from anon, authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
