-- =================================================================================
-- Migration: 20261124000003_recruitment_screening_rsvp.sql
-- Description: owner 2026-11-24 (HR recruitment meeting, 23 Nov) — screening and interview follow-through:
--   1) recruitment_application_links.kind gains 'screening': the candidate's own link to the screening questions
--      (sent on WhatsApp when HR moves them to Screening). The same public page as the job application form.
--   2) recruitment_screenings: one per candidate and position: sent, answered, or no response; the chasers at 24 h and
--      48 h, and the answers as given.
--   3) recruitment_interviews: a public page per interview (public_token: the role, the job description, the company
--      profile, the guidelines and how to join) where the candidate confirms they will attend (rsvp yes / no), and the
--      WhatsApp reminder's stamp.
-- Safety: ADDITIVE. One new table; one CHECK widened (every existing value stays valid); four nullable columns. No data
--         changes. RLS on the new table with NO policies (server code only), as for the other recruitment tables.
-- How to apply: run this whole file once in the Supabase SQL Editor, after 20261124000002 and 20261121000003. Safe to re-run.
-- Rollback (only once no 'screening' link exists):
--   DROP TABLE IF EXISTS public.recruitment_screenings;
--   ALTER TABLE public.recruitment_application_links DROP CONSTRAINT IF EXISTS recruitment_application_links_kind_check;
--   ALTER TABLE public.recruitment_application_links ADD CONSTRAINT recruitment_application_links_kind_check CHECK (kind IN ('personal', 'open'));
--   ALTER TABLE public.recruitment_interviews DROP COLUMN IF EXISTS public_token, DROP COLUMN IF EXISTS rsvp,
--     DROP COLUMN IF EXISTS rsvp_at, DROP COLUMN IF EXISTS rsvp_note, DROP COLUMN IF EXISTS wa_reminded_at;
-- =================================================================================

BEGIN;

alter table public.recruitment_application_links drop constraint if exists recruitment_application_links_kind_check;
alter table public.recruitment_application_links add constraint recruitment_application_links_kind_check
  check (kind in ('personal', 'open', 'screening'));

create table if not exists public.recruitment_screenings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  candidate_id uuid not null references public.candidates (id) on delete cascade,
  application_id uuid references public.candidate_applications (id) on delete set null,
  position_id uuid not null references public.candidate_positions (id) on delete cascade,
  member_id uuid,
  link_id uuid references public.recruitment_application_links (id) on delete set null,
  status text not null default 'sending' check (status in ('sending', 'sent', 'failed', 'answered', 'no_response')),
  error text,
  answers jsonb,
  sent_by uuid,
  sent_by_name text,
  sent_at timestamptz,
  chased_24_at timestamptz,
  chased_48_at timestamptz,
  answered_at timestamptz,
  no_response_at timestamptz,
  created_at timestamptz not null default now()
);
-- One screening per person and position (a failed send can be tried again).
create unique index if not exists recruitment_screenings_once
  on public.recruitment_screenings (organization_id, position_id, candidate_id) where status <> 'failed';
create index if not exists recruitment_screenings_waiting_idx on public.recruitment_screenings (organization_id, status) where status = 'sent';

alter table public.recruitment_interviews add column if not exists public_token text;
create unique index if not exists recruitment_interviews_public_token on public.recruitment_interviews (public_token) where public_token is not null;
alter table public.recruitment_interviews add column if not exists rsvp text check (rsvp is null or rsvp in ('yes', 'no'));
alter table public.recruitment_interviews add column if not exists rsvp_at timestamptz;
alter table public.recruitment_interviews add column if not exists rsvp_note text;
alter table public.recruitment_interviews add column if not exists wa_reminded_at timestamptz;

alter table public.recruitment_screenings enable row level security;

NOTIFY pgrst, 'reload schema';

COMMIT;
