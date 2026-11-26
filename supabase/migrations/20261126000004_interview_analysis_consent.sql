begin;
create table if not exists public.interview_analysis_consents (
  meeting_id uuid primary key references public.meeting_notes(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  candidate_id uuid not null references public.candidates(id) on delete cascade,
  source text not null check (source in ('candidate_invite', 'in_person_verbal')),
  witnessed_by uuid references auth.users(id),
  confirmed_at timestamptz not null default now(),
  check (source <> 'in_person_verbal' or witnessed_by is not null)
);
alter table public.interview_analysis_consents enable row level security;
revoke all on public.interview_analysis_consents from anon, authenticated;

-- Older automatic analyses set this flag without capturing candidate consent.
update public.call_analyses c set consent_confirmed = false
where c.meeting_id is not null and c.consent_confirmed
and not exists (select 1 from public.interview_analysis_consents consent
  where consent.meeting_id = c.meeting_id and consent.organization_id = c.organization_id and consent.candidate_id = c.candidate_id);
commit;
