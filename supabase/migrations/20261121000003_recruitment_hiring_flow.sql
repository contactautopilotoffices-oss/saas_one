-- =================================================================================
-- Migration: 20261121000003_recruitment_hiring_flow.sql
-- Description: owner 2026-11-21 ("go on with all the steps"): the Recruitment Module spec's Stages 6 to 9 after the
--   interview is booked: its follow-up, the panel's scorecards, selection and the offer, and joining.
--   1) recruitment_interviews       : one row per interview booked (the same id as its history entry), with its time,
--                                     status (scheduled, done, no_show, cancelled) and which reminders went (A10, A12).
--   2) recruitment_scorecards       : one per interviewer per interview: ratings per skill (1-5), overall, proceed /
--                                     hold / reject, comments (required to reject). Filled from a one-time link; a panel
--                                     member sees the others' ratings only after submitting (spec rule). Chasers (A11).
--   3) recruitment_offers           : the offer: proposed CTC against the request's band, the breakup, the approvals
--                                     (HR Head; Director above the band), the letter, release, the answer, joining.
--   4) recruitment_offer_events     : every step of an offer (insert-only, the spec's audit trail).
-- Access: RLS on, NO policies: only server code (service role), after the route's own check.
-- Safety: ADDITIVE. Four new tables, one trigger. Nothing existing changes.
-- How to apply: run this whole file once in the Supabase SQL Editor. Safe to re-run.
-- Rollback: DROP TABLE IF EXISTS public.recruitment_offer_events, public.recruitment_offers, public.recruitment_scorecards, public.recruitment_interviews;
--           DROP FUNCTION IF EXISTS public.recruitment_offer_events_refuse_change();
-- =================================================================================

BEGIN;

create table if not exists public.recruitment_interviews (
  id uuid primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  candidate_id uuid not null references public.candidates (id) on delete cascade,
  application_id uuid references public.candidate_applications (id) on delete set null,
  position_id uuid references public.candidate_positions (id) on delete set null,
  round text,
  -- The instant, and India time as the form gave it ("2026-11-21T11:00").
  at timestamptz not null,
  at_local text not null,
  mode text,
  venue text,
  interviewer_ids uuid[] not null default '{}',
  join_path text,
  status text not null default 'scheduled' check (status in ('scheduled', 'done', 'no_show', 'cancelled')),
  status_reason text,
  status_at timestamptz,
  status_by_name text,
  reminded_24_at timestamptz,
  reminded_2_at timestamptz,
  nudged_at timestamptz,
  escalated_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists recruitment_interviews_org_at on public.recruitment_interviews (organization_id, at);
create index if not exists recruitment_interviews_candidate on public.recruitment_interviews (candidate_id);

create table if not exists public.recruitment_scorecards (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  interview_id uuid not null references public.recruitment_interviews (id) on delete cascade,
  panel_user_id uuid references auth.users (id) on delete set null,
  panel_name text,
  ratings jsonb not null default '{}'::jsonb,
  overall integer check (overall is null or overall between 1 and 5),
  recommendation text check (recommendation is null or recommendation in ('proceed', 'hold', 'reject')),
  comments text,
  submitted_at timestamptz,
  chased_24_at timestamptz,
  chased_48_at timestamptz,
  escalated_at timestamptz,
  created_at timestamptz not null default now(),
  check (recommendation is distinct from 'reject' or length(trim(coalesce(comments, ''))) > 0)
);
create unique index if not exists recruitment_scorecards_one on public.recruitment_scorecards (interview_id, panel_user_id);

create table if not exists public.recruitment_offers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  candidate_id uuid not null references public.candidates (id) on delete cascade,
  application_id uuid references public.candidate_applications (id) on delete set null,
  position_id uuid references public.candidate_positions (id) on delete set null,
  requisition_id uuid references public.recruitment_requisitions (id) on delete set null,
  -- Rupees per year (CTC), as the request's budget band.
  proposed_ctc numeric not null check (proposed_ctc > 0),
  band_min numeric,
  band_max numeric,
  breakup jsonb not null default '{}'::jsonb,
  joining_date date,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'released', 'accepted', 'declined', 'joined', 'dropped', 'withdrawn')),
  -- While pending: who it waits on (hr_head, then director when above the band).
  current_level text check (current_level is null or current_level in ('hr_head', 'director')),
  current_approver_id uuid references auth.users (id) on delete set null,
  level_entered_at timestamptz,
  needs_director boolean not null default false,
  letter text,
  released_at timestamptz,
  response_at timestamptz,
  response_reason text,
  joined_at timestamptz,
  dropped_reason text,
  last_contact_at timestamptz,
  notices jsonb not null default '{}'::jsonb,
  selected_note text,
  created_by uuid references auth.users (id) on delete set null,
  created_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists recruitment_offers_org on public.recruitment_offers (organization_id, status);
-- One live offer per person per position.
create unique index if not exists recruitment_offers_one_live on public.recruitment_offers (candidate_id, position_id)
  where status in ('pending', 'approved', 'released', 'accepted');

create table if not exists public.recruitment_offer_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  offer_id uuid not null references public.recruitment_offers (id) on delete cascade,
  action text not null,
  level text,
  reason text,
  by_user uuid references auth.users (id) on delete set null,
  by_name text,
  created_at timestamptz not null default now()
);
create index if not exists recruitment_offer_events_offer on public.recruitment_offer_events (offer_id, created_at);

create or replace function public.recruitment_offer_events_refuse_change() returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' and not exists (select 1 from public.recruitment_offers o where o.id = old.offer_id) then
    return old;
  end if;
  raise exception 'recruitment_offer_events is insert-only: an offer''s history is never edited or deleted';
end;
$$;
drop trigger if exists recruitment_offer_events_refuse_change on public.recruitment_offer_events;
create trigger recruitment_offer_events_refuse_change
  before update or delete on public.recruitment_offer_events
  for each row execute function public.recruitment_offer_events_refuse_change();

alter table public.recruitment_interviews enable row level security;
alter table public.recruitment_scorecards enable row level security;
alter table public.recruitment_offers enable row level security;
alter table public.recruitment_offer_events enable row level security;
revoke all on public.recruitment_interviews from anon, authenticated;
revoke all on public.recruitment_scorecards from anon, authenticated;
revoke all on public.recruitment_offers from anon, authenticated;
revoke all on public.recruitment_offer_events from anon, authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
