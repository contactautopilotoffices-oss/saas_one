-- =================================================================================
-- Migration: 20261116000003_candidate_outreach.sql
-- Description: owner 2026-11-16 — Recruitment, candidate outreach on WhatsApp (mockup board 7). When a person moves a
--   candidate to Shortlisted or Rejected on a position's pipeline, the app offers to tell the candidate on WhatsApp
--   with a Meta-approved AiSensy template (candidate_shortlisted_v1 / candidate_not_shortlisted_v1). A person clicks
--   Send every time; nothing goes out on the stage change alone.
--   1) candidate_outreach : one row per attempt (sent or failed), with the number it went to and the provider's id.
--      A partial unique index refuses a second successful send of the same kind to the same person for the same
--      position, so a double click or two people cannot message a candidate twice.
--   2) candidate_actions.action gains 'outreach_sent', so the send shows in the candidate's history.
-- Access: RLS on, NO policies: only server code (service role), after backend/lib/candidates/access.ts says the caller may.
-- Safety: ADDITIVE. One new table, two indexes, one CHECK widened (every existing value stays valid). No row changes.
-- How to apply: run this whole file once in the Supabase SQL Editor, after 20261116000001. Safe to re-run.
-- Rollback: DROP TABLE IF EXISTS public.candidate_outreach;
--           then restore the action CHECK of 20261115000002 (without 'outreach_sent').
-- =================================================================================

BEGIN;

create table if not exists public.candidate_outreach (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  candidate_id uuid not null references public.candidates (id) on delete cascade,
  application_id uuid references public.candidate_applications (id) on delete set null,
  position_id uuid references public.candidate_positions (id) on delete set null,
  -- which message: 'shortlisted' | 'not_shortlisted'
  kind text not null check (kind in ('shortlisted', 'not_shortlisted')),
  channel text not null default 'whatsapp' check (channel in ('whatsapp')),
  -- the number it was sent to, as sent (digits, with the country code)
  phone text not null,
  -- the AiSensy campaign (= the Meta template name) and the role named in the message
  campaign text not null,
  role_title text,
  status text not null check (status in ('sent', 'failed')),
  error text,
  provider_message_id text,
  created_by uuid references auth.users (id) on delete set null,
  created_by_name text,
  created_at timestamptz not null default now()
);

-- One successful send per person, kind and position (a send not tied to a position counts as its own position).
create unique index if not exists candidate_outreach_once
  on public.candidate_outreach (candidate_id, kind, coalesce(position_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where status = 'sent';
create index if not exists candidate_outreach_candidate_idx
  on public.candidate_outreach (candidate_id, created_at desc);

alter table public.candidate_outreach enable row level security;
revoke all on public.candidate_outreach from anon, authenticated;

alter table public.candidate_actions drop constraint if exists candidate_actions_action_check;
alter table public.candidate_actions add constraint candidate_actions_action_check
  check (action in (
    'status_change', 'stage_change', 'remark', 'blacklist', 'unblacklist', 'resume_attached', 'resume_marked',
    'added_to_position', 'removed_from_position', 'call_logged', 'field_edit', 'outreach_sent'
  ));

NOTIFY pgrst, 'reload schema';

COMMIT;
