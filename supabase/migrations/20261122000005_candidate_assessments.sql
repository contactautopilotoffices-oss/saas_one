-- Delivery receipts for existing public assessments; assessment content and access stay unchanged.
create table if not exists public.candidate_assessment_invites (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  candidate_id uuid not null references public.candidates(id) on delete cascade,
  application_id uuid references public.candidate_applications(id) on delete set null,
  test_id uuid not null references public.proctor_tests(id) on delete cascade,
  channel text not null check (channel in ('email', 'whatsapp')),
  recipient text not null,
  status text not null check (status in ('sending', 'sent', 'failed', 'unknown')),
  error text,
  mail_id uuid,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (candidate_id, test_id, channel)
);
alter table public.candidate_assessment_invites enable row level security;
revoke all on public.candidate_assessment_invites from anon, authenticated;
notify pgrst, 'reload schema';
