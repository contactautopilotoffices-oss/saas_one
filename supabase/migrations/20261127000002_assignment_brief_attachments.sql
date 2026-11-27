-- Snapshot the HR brief independently of the candidate's submitted work.
alter table public.recruitment_assignments add column if not exists brief_attachment jsonb;

notify pgrst, 'reload schema';
