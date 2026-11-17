-- =================================================================================
-- Migration: 20261117000003_recruitment_requisitions.sql
-- Description: owner 2026-11-17 — Recruitment: manpower requisitions and their approval (Stages 1 and 2 of the
--   Recruitment Module spec, 12 Nov 2026). A hiring manager raises a request inside the app (Stage 1: the form, the
--   last requisition for the same role shown, a requisition ID). The HR Head reviews it and ticks whether the role is
--   in the approved plan (Stage 2). In plan: the HR Head approves and the Director is notified. Out of plan, or above
--   the CTC level set in Settings: the Director approves. Approve, reject with reason, send back for change, put on
--   hold; alerts, reminders at 24 h and 48 h, escalation at 72 h. Approved, the role becomes active: a position in the
--   Positions tab. Nobody approves a request they raised.
--   1) organization_settings.recruitment_config : the approvers (HR Head, Director, each with a backup), the CTC level
--                                                 above which the Director approves, the target days. Set in the Tech
--                                                 dashboard (Settings -> Notifications -> Recruitment).
--   2) recruitment_requisitions                  : one row per request, with its status and where it waits.
--   3) recruitment_requisition_approvals         : every submit, decision, hold, withdrawal; insert-only (a trigger
--                                                 refuses UPDATE and DELETE), as the spec's audit log asks.
--   4) recruitment_requisition_notices           : every alert, reminder and escalation sent, so each goes once.
--   5) recruitment_requisition_counters          : REQ-2026-0001 numbering, one counter per organisation and year.
-- Access: RLS on, NO policies: only server code (service role) reads or writes, after the route's own check (any
--         active member of the organisation may raise; HR roles see all; only the configured approvers decide).
-- Safety: ADDITIVE. One nullable column on organization_settings, four new tables, two functions, one trigger.
-- How to apply: run this whole file once in the Supabase SQL Editor, after 20261117000002. Safe to re-run.
-- Rollback: DROP TABLE IF EXISTS public.recruitment_requisition_notices, public.recruitment_requisition_approvals,
--           public.recruitment_requisitions, public.recruitment_requisition_counters;
--           DROP FUNCTION IF EXISTS public.recruitment_next_requisition_no(uuid), public.recruitment_approvals_refuse_change();
--           ALTER TABLE public.organization_settings DROP COLUMN IF EXISTS recruitment_config;
-- =================================================================================

BEGIN;

alter table public.organization_settings add column if not exists recruitment_config jsonb;

create table if not exists public.recruitment_requisitions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  requisition_no text,
  status text not null default 'draft'
    check (status in ('draft', 'submitted', 'on_hold', 'sent_back', 'approved', 'rejected', 'withdrawn')),
  -- Where it waits while submitted: the HR Head, then (out of plan or above the CTC level) the Director.
  current_level text check (current_level is null or current_level in ('hr_head', 'director')),
  current_approver_id uuid references auth.users (id) on delete set null,
  level_entered_at timestamptz,
  -- The form (Stage 1).
  role_title text not null,
  department text,
  location text,
  positions integer not null default 1 check (positions >= 1),
  request_type text not null default 'new' check (request_type in ('new', 'replacement')),
  replacing_name text,
  budget_min_ctc numeric,
  budget_max_ctc numeric,
  required_skills text[] not null default '{}',
  min_experience_years numeric,
  qualification text,
  target_joining_date date,
  justification text,
  reporting_manager text,
  -- The HR Head's tick (owner 2026-11-17: the simple tick box, no headcount list yet). null until reviewed.
  in_plan boolean,
  needs_director boolean not null default false,
  hold_since timestamptz,
  hold_reason text,
  decided_at timestamptz,
  decision_reason text,
  -- The position opened from it on approval.
  position_id uuid references public.candidate_positions (id) on delete set null,
  raised_by uuid references auth.users (id) on delete set null,
  raised_by_name text,
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists recruitment_requisitions_org_idx on public.recruitment_requisitions (organization_id, created_at desc) where deleted_at is null;
create index if not exists recruitment_requisitions_waiting_idx on public.recruitment_requisitions (organization_id, status) where deleted_at is null and status in ('submitted', 'on_hold');

create table if not exists public.recruitment_requisition_approvals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  requisition_id uuid not null references public.recruitment_requisitions (id) on delete cascade,
  level text check (level is null or level in ('hr_head', 'director')),
  action text not null check (action in ('submitted', 'approved', 'rejected', 'sent_back', 'on_hold', 'resumed', 'withdrawn', 'position_opened')),
  in_plan boolean,
  reason text,
  by_user uuid references auth.users (id) on delete set null,
  by_name text,
  via text not null default 'app' check (via in ('app', 'link')),
  created_at timestamptz not null default now()
);
create index if not exists recruitment_requisition_approvals_req_idx on public.recruitment_requisition_approvals (requisition_id, created_at);

-- The audit trail is never edited: a row goes only when its requisition is purged with its organisation.
create or replace function public.recruitment_approvals_refuse_change() returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' and not exists (select 1 from public.recruitment_requisitions r where r.id = old.requisition_id) then
    return old;
  end if;
  raise exception 'recruitment_requisition_approvals is insert-only: an approval record is never edited or deleted';
end;
$$;
drop trigger if exists recruitment_approvals_refuse_change on public.recruitment_requisition_approvals;
create trigger recruitment_approvals_refuse_change
  before update or delete on public.recruitment_requisition_approvals
  for each row execute function public.recruitment_approvals_refuse_change();

create table if not exists public.recruitment_requisition_notices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  requisition_id uuid not null references public.recruitment_requisitions (id) on delete cascade,
  -- awaiting | decided | director_informed | reminder_24 | reminder_48 | escalation_72
  kind text not null,
  -- The level the notice was for (reminders start again at each level).
  level text,
  channel text not null check (channel in ('email', 'whatsapp')),
  recipient text not null,
  ok boolean not null default true,
  error text,
  created_at timestamptz not null default now()
);
create index if not exists recruitment_requisition_notices_req_idx on public.recruitment_requisition_notices (requisition_id, kind, level);

create table if not exists public.recruitment_requisition_counters (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  year integer not null,
  n integer not null default 0,
  primary key (organization_id, year)
);

-- REQ-2026-0001: the next number for the organisation this year, safe under two submissions at once.
create or replace function public.recruitment_next_requisition_no(p_organization_id uuid) returns text
language plpgsql
as $$
declare
  v_year integer := extract(year from now())::integer;
  v_n integer;
begin
  insert into public.recruitment_requisition_counters (organization_id, year, n) values (p_organization_id, v_year, 1)
  on conflict (organization_id, year) do update set n = public.recruitment_requisition_counters.n + 1
  returning n into v_n;
  return 'REQ-' || v_year || '-' || lpad(v_n::text, 4, '0');
end;
$$;

alter table public.recruitment_requisitions enable row level security;
alter table public.recruitment_requisition_approvals enable row level security;
alter table public.recruitment_requisition_notices enable row level security;
alter table public.recruitment_requisition_counters enable row level security;
revoke all on public.recruitment_requisitions from anon, authenticated;
revoke all on public.recruitment_requisition_approvals from anon, authenticated;
revoke all on public.recruitment_requisition_notices from anon, authenticated;
revoke all on public.recruitment_requisition_counters from anon, authenticated;
revoke all on function public.recruitment_next_requisition_no(uuid) from anon, authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
