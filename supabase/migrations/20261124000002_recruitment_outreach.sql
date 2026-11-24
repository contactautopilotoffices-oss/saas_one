-- =================================================================================
-- Migration: 20261124000002_recruitment_outreach.sql
-- Description: owner 2026-11-24 (HR recruitment meeting, 23 Nov) — getting candidates in:
--   1) recruitment_application_links : the job application form's links. "personal" (one per candidate and position,
--      sent in outreach) or "open" (one per position, for postings). The token in the URL is the only key; it lets
--      someone submit an application and nothing else.
--   2) recruitment_applications      : each submitted form (the answers as given, the resume file's path, consent).
--      The answers also update the candidate's record (backend/lib/candidates/applications.ts).
--   3) recruitment_outreach_campaigns: one bulk send (WhatsApp and/or email) to many candidates, picked by HR from a
--      search ("manual") or matched when a hiring request is approved ("auto", at most one per request).
--   4) recruitment_outreach_sends    : one row per candidate and channel in a campaign; the unique key makes a send
--      happen at most once, however many times the batch runs.
--   The form's questions and the message templates are kept in organization_settings.recruitment_config (no new column).
-- Safety: ADDITIVE. Four new tables; no existing table or row is changed. RLS on with NO policies: only server code
--         (service role) reads or writes, after the route's own check, as for the other recruitment tables.
-- How to apply: run this whole file once in the Supabase SQL Editor, after 20261124000001. Safe to re-run.
-- Rollback: DROP TABLE IF EXISTS public.recruitment_outreach_sends, public.recruitment_outreach_campaigns,
--           public.recruitment_applications, public.recruitment_application_links;
-- =================================================================================

BEGIN;

create table if not exists public.recruitment_application_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  token text not null unique check (char_length(token) between 32 and 64),
  kind text not null check (kind in ('personal', 'open')),
  candidate_id uuid references public.candidates (id) on delete set null,
  application_id uuid references public.candidate_applications (id) on delete set null,
  position_id uuid references public.candidate_positions (id) on delete set null,
  created_by uuid,
  created_at timestamptz not null default now(),
  opened_at timestamptz,
  submitted_at timestamptz,
  submissions integer not null default 0,
  disabled_at timestamptz
);
-- One personal link per candidate and position (a send for the same role reuses it); one open link per position.
create unique index if not exists recruitment_application_links_personal
  on public.recruitment_application_links (organization_id, candidate_id, coalesce(position_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where kind = 'personal';
create unique index if not exists recruitment_application_links_open
  on public.recruitment_application_links (organization_id, coalesce(position_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where kind = 'open' and disabled_at is null;

create table if not exists public.recruitment_applications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  link_id uuid references public.recruitment_application_links (id) on delete set null,
  position_id uuid references public.candidate_positions (id) on delete set null,
  candidate_id uuid references public.candidates (id) on delete set null,
  application_id uuid references public.candidate_applications (id) on delete set null,
  answers jsonb not null default '{}'::jsonb,
  resume_path text,
  resume_name text,
  consent boolean not null default false,
  created_at timestamptz not null default now(),
  ip text,
  user_agent text
);
create index if not exists recruitment_applications_org_idx on public.recruitment_applications (organization_id, created_at desc);
create index if not exists recruitment_applications_candidate_idx on public.recruitment_applications (candidate_id);

create table if not exists public.recruitment_outreach_campaigns (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  source text not null check (source in ('manual', 'auto')),
  channels text[] not null check (channels <@ array['whatsapp', 'email']::text[] and cardinality(channels) >= 1),
  position_id uuid references public.candidate_positions (id) on delete set null,
  requisition_id uuid references public.recruitment_requisitions (id) on delete set null,
  whatsapp_template jsonb,
  email_template jsonb,
  mail_connection_id uuid,
  status text not null default 'queued' check (status in ('queued', 'sending', 'done', 'cancelled')),
  total integer not null default 0,
  created_by uuid,
  created_by_name text,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create unique index if not exists recruitment_outreach_campaigns_auto
  on public.recruitment_outreach_campaigns (requisition_id) where source = 'auto' and requisition_id is not null;
create index if not exists recruitment_outreach_campaigns_open_idx
  on public.recruitment_outreach_campaigns (organization_id, status) where status in ('queued', 'sending');

create table if not exists public.recruitment_outreach_sends (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  campaign_id uuid not null references public.recruitment_outreach_campaigns (id) on delete cascade,
  candidate_id uuid not null references public.candidates (id) on delete cascade,
  application_id uuid references public.candidate_applications (id) on delete set null,
  channel text not null check (channel in ('whatsapp', 'email')),
  recipient text,
  status text not null default 'queued' check (status in ('queued', 'sending', 'sent', 'failed', 'skipped', 'unknown')),
  skip_reason text,
  error text,
  link_id uuid references public.recruitment_application_links (id) on delete set null,
  provider_ref text,
  attempted_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  unique (campaign_id, candidate_id, channel)
);
create index if not exists recruitment_outreach_sends_queue_idx on public.recruitment_outreach_sends (campaign_id, status);
create index if not exists recruitment_outreach_sends_candidate_idx on public.recruitment_outreach_sends (organization_id, candidate_id, sent_at desc);

alter table public.recruitment_application_links enable row level security;
alter table public.recruitment_applications enable row level security;
alter table public.recruitment_outreach_campaigns enable row level security;
alter table public.recruitment_outreach_sends enable row level security;

NOTIFY pgrst, 'reload schema';

COMMIT;
