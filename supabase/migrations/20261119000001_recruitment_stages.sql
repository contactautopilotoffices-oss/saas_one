-- =================================================================================
-- Migration: 20261119000001_recruitment_stages.sql
-- Description: owner 2026-11-19 — Recruitment: the pipeline's stages become a list HR edits (Recruitment ->
--   Configurations; one list for every position, anyone in HR may change it), with the HR team's standard-tracker
--   statuses as the built-in list, and an editable WhatsApp update per stage.
--   1) recruitment_stages        : the organisation's saved list. Until a list is saved, the app uses its built-in
--                                  list (backend/lib/candidates/stage-list.ts, DEFAULT_STAGES). A stage's KEY never
--                                  changes and is never reused, so a rename never moves anyone.
--   2) recruitment_stage_changes : INSERT-ONLY record of every change to the list (who, when, what).
--   3) candidate_position_members.stage: the fixed list of ten values is replaced by "a stage key".
--   4) DATA: people at the old stages that the new list renames are moved (stage_changed_at is kept, so "days in this
--      stage" is unchanged):  screening -> screening_pending,  shortlisted -> l1_pending,  interview -> l1_pending.
--      People at Rejected or Others stay there; the app shows those two as "out of the flow" until they are moved.
--   5) candidate_outreach: the editable "stage_update" message — the stage it was for and the text sent; one
--      successful send per person, position and stage (the double-click guard), instead of per position.
-- Access: RLS on, NO policies: only server code (service role), after backend/lib/candidates/access.ts says the caller may.
-- Safety: ADDITIVE except step 4, which updates rows (stage values only) and step 3, which widens a CHECK.
-- How to apply: run this whole file once in the Supabase SQL Editor, after 20261117000003. Safe to re-run.
-- Rollback: DROP TABLE public.recruitment_stage_changes, public.recruitment_stages;
--           move people back (l1_pending -> shortlisted, screening_pending -> screening, anything else not in the old
--           ten -> others) and restore the stage CHECK of 20261115000002;
--           ALTER TABLE public.candidate_outreach DROP COLUMN stage_key, DROP COLUMN message; restore its kind CHECK
--           and the unique index of 20261116000003.
-- =================================================================================

BEGIN;

-- 1) The saved list -------------------------------------------------------------------------------------------------
create table if not exists public.recruitment_stages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  key text not null check (key ~ '^[a-z0-9_]{1,40}$'),
  name text not null check (char_length(btrim(name)) between 1 and 60),
  -- the board column (round) it sits under; null when out of the flow
  column_name text check (column_name is null or char_length(column_name) <= 40),
  kind text not null check (kind in ('progress', 'selected', 'rejected', 'out')),
  tone text not null default 'grey' check (tone in ('amber', 'green', 'red', 'blue', 'violet', 'teal', 'grey')),
  -- moving someone here offers to send a WhatsApp update; `message` is its default middle text
  whatsapp boolean not null default false,
  message text check (message is null or char_length(message) <= 400),
  needs_remark boolean not null default false,
  sort_order integer not null default 0,
  hidden boolean not null default false,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);

-- A key is never reused, even after its stage is deleted.
create unique index if not exists recruitment_stages_key
  on public.recruitment_stages (organization_id, key);
create index if not exists recruitment_stages_org_order
  on public.recruitment_stages (organization_id, sort_order) where deleted_at is null;

alter table public.recruitment_stages enable row level security;
revoke all on public.recruitment_stages from anon, authenticated;

-- 2) Who changed the list, and what ---------------------------------------------------------------------------------
create table if not exists public.recruitment_stage_changes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  changed_by uuid references auth.users (id) on delete set null,
  changed_by_name text,
  summary text not null,
  before jsonb,
  after jsonb,
  created_at timestamptz not null default now()
);
create index if not exists recruitment_stage_changes_org
  on public.recruitment_stage_changes (organization_id, created_at desc);

alter table public.recruitment_stage_changes enable row level security;
revoke all on public.recruitment_stage_changes from anon, authenticated;

create or replace function public.recruitment_stage_changes_insert_only()
returns trigger language plpgsql as $$
begin
  raise exception 'recruitment_stage_changes is insert-only';
end;
$$;
drop trigger if exists recruitment_stage_changes_insert_only on public.recruitment_stage_changes;
create trigger recruitment_stage_changes_insert_only
  before update or delete on public.recruitment_stage_changes
  for each row execute function public.recruitment_stage_changes_insert_only();

-- 3) A pipeline row holds a stage key -------------------------------------------------------------------------------
alter table public.candidate_position_members drop constraint if exists candidate_position_members_stage_check;
alter table public.candidate_position_members drop constraint if exists candidate_position_members_stage_key_check;
alter table public.candidate_position_members add constraint candidate_position_members_stage_key_check
  check (stage ~ '^[a-z0-9_]{1,40}$');

-- 4) The stages the new list renames ---------------------------------------------------------------------------------
update public.candidate_position_members set stage = 'screening_pending', updated_at = now() where stage = 'screening';
update public.candidate_position_members set stage = 'l1_pending', updated_at = now() where stage in ('shortlisted', 'interview');

-- 5) The editable WhatsApp update ------------------------------------------------------------------------------------
alter table public.candidate_outreach add column if not exists stage_key text;
alter table public.candidate_outreach add column if not exists message text;
alter table public.candidate_outreach drop constraint if exists candidate_outreach_kind_check;
alter table public.candidate_outreach add constraint candidate_outreach_kind_check
  check (kind in ('shortlisted', 'not_shortlisted', 'stage_update'));

drop index if exists public.candidate_outreach_once;
create unique index if not exists candidate_outreach_once
  on public.candidate_outreach (candidate_id, kind, coalesce(position_id, '00000000-0000-0000-0000-000000000000'::uuid), coalesce(stage_key, ''))
  where status = 'sent';

NOTIFY pgrst, 'reload schema';

COMMIT;
