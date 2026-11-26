-- =================================================================================
-- Migration: 20261124000004_recruitment_assignment_loi_audit.sql
-- Description: owner 2026-11-24 ("complete all the remaining phases"; HR recruitment meeting, 23 Nov):
--   1) recruitment_assignments : the assignment stage — HR sends details, guidelines and a Drive link with a deadline;
--      the candidate submits through their own link; an AI score against the JD that HR sees (never the hiring manager).
--   2) recruitment_documents   : documents the candidate uploads after selection (salary slips and the like).
--   3) recruitment_application_links.kind gains 'assignment' and 'documents' (the same public page).
--   4) recruitment_offers: the hiring manager approves the annexure first (current_level 'hiring_manager'); the letter of
--      intent page (public_token) where the candidate accepts or declines; responded_via.
--   5) recruitment_handovers    : an accepted LOI handed to onboarding (HRMS), with everything collected.
--   6) recruitment_audit_log    : append-only (exports, CTC and offer edits, removals, permission-sensitive actions).
--   7) candidates: consent (when, on what basis), removal (when the person's data was removed on request), and when they
--      were last contacted.
--   8) recruitment_saved_searches: a recruiter's named searches.
--   9) recruitment_message_log  : every candidate email sent by the app that no other table keeps.
-- Safety: ADDITIVE. New tables; two CHECKs widened (every existing value stays valid); nullable columns. No data changes.
--         RLS on every new table with NO policies (server code only), as for the other recruitment tables.
-- How to apply: run this whole file once in the Supabase SQL Editor, after 20261124000003. Safe to re-run.
-- Rollback: DROP TABLE IF EXISTS public.recruitment_message_log, public.recruitment_saved_searches,
--             public.recruitment_audit_log, public.recruitment_handovers, public.recruitment_documents, public.recruitment_assignments;
--           DROP FUNCTION IF EXISTS public.recruitment_audit_log_insert_only();
--           ALTER TABLE public.candidates DROP COLUMN IF EXISTS consent_at, DROP COLUMN IF EXISTS consent_basis,
--             DROP COLUMN IF EXISTS removed_at, DROP COLUMN IF EXISTS last_contacted_at;
--           ALTER TABLE public.recruitment_offers DROP COLUMN IF EXISTS public_token, DROP COLUMN IF EXISTS responded_via;
--           and restore the two CHECKs (links: personal, open, screening; offers.current_level: hr_head, director) once
--           no row uses the new values.
-- =================================================================================

BEGIN;

-- 3) the public page's new kinds
alter table public.recruitment_application_links drop constraint if exists recruitment_application_links_kind_check;
alter table public.recruitment_application_links add constraint recruitment_application_links_kind_check
  check (kind in ('personal', 'open', 'screening', 'assignment', 'documents'));

-- 1) assignments
create table if not exists public.recruitment_assignments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  candidate_id uuid not null references public.candidates (id) on delete cascade,
  application_id uuid references public.candidate_applications (id) on delete set null,
  position_id uuid not null references public.candidate_positions (id) on delete cascade,
  link_id uuid references public.recruitment_application_links (id) on delete set null,
  title text not null,
  brief text not null,
  guidelines text,
  drive_link text,
  due_at timestamptz,
  status text not null default 'sent' check (status in ('sent', 'submitted', 'cancelled')),
  send_error text,
  sent_by uuid,
  sent_by_name text,
  sent_at timestamptz not null default now(),
  submitted_at timestamptz,
  submission_note text,
  submission_link text,
  file_path text,
  file_name text,
  -- HR only: never shown to the hiring manager (the meeting: "so the hiring manager's opinion stays unbiased")
  ai_status text check (ai_status is null or ai_status in ('pending', 'scored', 'failed', 'skipped')),
  ai_score integer check (ai_score is null or ai_score between 0 and 100),
  ai_summary text,
  ai_strengths text[],
  ai_gaps text[],
  ai_model text,
  ai_scored_at timestamptz,
  ai_error text,
  created_at timestamptz not null default now()
);
create index if not exists recruitment_assignments_candidate_idx on public.recruitment_assignments (organization_id, candidate_id, created_at desc);
create index if not exists recruitment_assignments_position_idx on public.recruitment_assignments (organization_id, position_id);

-- 2) documents
create table if not exists public.recruitment_documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  candidate_id uuid not null references public.candidates (id) on delete cascade,
  position_id uuid references public.candidate_positions (id) on delete set null,
  offer_id uuid references public.recruitment_offers (id) on delete set null,
  link_id uuid references public.recruitment_application_links (id) on delete set null,
  item text not null,
  file_path text not null,
  file_name text,
  status text not null default 'uploaded' check (status in ('uploaded', 'verified', 'rejected')),
  review_note text,
  reviewed_by_name text,
  reviewed_at timestamptz,
  uploaded_at timestamptz not null default now()
);
create index if not exists recruitment_documents_candidate_idx on public.recruitment_documents (organization_id, candidate_id, uploaded_at desc);

-- 4) offers: the hiring manager's approval, and the LOI page
alter table public.recruitment_offers drop constraint if exists recruitment_offers_current_level_check;
alter table public.recruitment_offers add constraint recruitment_offers_current_level_check
  check (current_level is null or current_level in ('hiring_manager', 'hr_head', 'director'));
alter table public.recruitment_offers add column if not exists public_token text;
create unique index if not exists recruitment_offers_public_token on public.recruitment_offers (public_token) where public_token is not null;
alter table public.recruitment_offers add column if not exists responded_via text check (responded_via is null or responded_via in ('hr', 'candidate'));

-- 5) handovers
create table if not exists public.recruitment_handovers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  offer_id uuid not null references public.recruitment_offers (id) on delete cascade,
  candidate_id uuid not null references public.candidates (id) on delete cascade,
  position_id uuid references public.candidate_positions (id) on delete set null,
  joining_date date,
  snapshot jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'taken')),
  taken_by_name text,
  taken_at timestamptz,
  created_at timestamptz not null default now(),
  unique (offer_id)
);

-- 6) audit log (append-only)
create table if not exists public.recruitment_audit_log (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid,
  user_name text,
  entity_type text not null,
  entity_id text,
  action text not null,
  before_value jsonb,
  after_value jsonb,
  detail text,
  created_at timestamptz not null default now()
);
create index if not exists recruitment_audit_log_org_idx on public.recruitment_audit_log (organization_id, created_at desc);
create or replace function public.recruitment_audit_log_insert_only() returns trigger language plpgsql as $$
begin
  raise exception 'recruitment_audit_log is insert-only';
end;
$$;
drop trigger if exists recruitment_audit_log_no_change on public.recruitment_audit_log;
create trigger recruitment_audit_log_no_change before update or delete on public.recruitment_audit_log
  for each row execute function public.recruitment_audit_log_insert_only();

-- 7) consent, removal, last contacted
alter table public.candidates add column if not exists consent_at timestamptz;
alter table public.candidates add column if not exists consent_basis text;
alter table public.candidates add column if not exists removed_at timestamptz;
alter table public.candidates add column if not exists last_contacted_at timestamptz;

-- 8) saved searches
create table if not exists public.recruitment_saved_searches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null,
  name text not null check (char_length(name) between 1 and 80),
  filters jsonb not null,
  created_at timestamptz not null default now(),
  unique (organization_id, user_id, name)
);

-- 9) the message log
create table if not exists public.recruitment_message_log (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  candidate_id uuid references public.candidates (id) on delete cascade,
  channel text not null check (channel in ('email', 'whatsapp')),
  kind text not null,
  recipient text,
  subject text,
  status text not null check (status in ('sent', 'failed')),
  error text,
  sent_by_name text,
  created_at timestamptz not null default now()
);
create index if not exists recruitment_message_log_candidate_idx on public.recruitment_message_log (organization_id, candidate_id, created_at desc);

alter table public.recruitment_assignments enable row level security;
alter table public.recruitment_documents enable row level security;
alter table public.recruitment_handovers enable row level security;
alter table public.recruitment_audit_log enable row level security;
alter table public.recruitment_saved_searches enable row level security;
alter table public.recruitment_message_log enable row level security;

NOTIFY pgrst, 'reload schema';

COMMIT;
