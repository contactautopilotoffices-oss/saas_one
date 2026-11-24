-- Stage 3: candidate correspondence and reviewed email-to-requisition drafts.
-- Apply after Stage 2. Existing grants stay read-only until HR explicitly reconnects for sending.
-- Rollback: drop recruitment_requisitions.source_mail_id before dropping recruitment_mail_messages;
-- then drop the added connection/state columns. Sent mail in Zoho is unaffected.
BEGIN;
alter table public.candidate_resume_mail_oauth add column if not exists requested_send boolean not null default false;
alter table public.candidate_resume_mail_connections add column if not exists can_send boolean not null default false;
alter table public.candidate_resume_mail_connections add column if not exists email_scan_start integer not null default 1 check (email_scan_start > 0);
create table if not exists public.recruitment_mail_messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  connection_id uuid not null references public.candidate_resume_mail_connections(id) on delete cascade,
  candidate_id uuid references public.candidates(id) on delete set null,
  message_id text,
  thread_id text,
  folder_id text,
  direction text not null check (direction in ('incoming', 'outgoing')),
  status text not null check (status in ('received', 'draft', 'sending', 'sent', 'failed', 'unknown')),
  sender text not null,
  recipient text not null,
  subject text not null,
  body text not null default '',
  body_loaded boolean not null default false,
  reply_to_id uuid references public.recruitment_mail_messages(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  received_at timestamptz not null default now(),
  attempted_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (connection_id, message_id)
);
create index if not exists recruitment_mail_messages_org on public.recruitment_mail_messages(organization_id, connection_id, received_at desc);
create index if not exists recruitment_mail_messages_candidate on public.recruitment_mail_messages(organization_id, candidate_id);
alter table public.recruitment_requisitions add column if not exists source_mail_id uuid references public.recruitment_mail_messages(id) on delete set null;
create unique index if not exists recruitment_requisitions_mail on public.recruitment_requisitions(source_mail_id) where source_mail_id is not null;
alter table public.recruitment_mail_messages enable row level security;
revoke all on public.recruitment_mail_messages from anon, authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
