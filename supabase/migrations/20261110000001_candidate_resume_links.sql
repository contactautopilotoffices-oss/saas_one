-- Candidate Search: resumes linked to candidates (owner 2026-11-10, phase 2).
--
-- Each stored resume's text is read in the background (no AI); the email addresses and phone numbers in it are kept
-- on the row and matched against the candidates (same keys the sheet import de-duplicates by). A match links the
-- file to the person; HR can also attach or detach by hand. The filter panel gets "Has resume".
--
--   candidate_resume_files   + text_status / text_error / text_attempts (reading), resume_text, emails, phones,
--                              candidate_id (the link), match_reason (email | phone | both | manual | detached), matched_at
--   candidate_filter_records  recreated with has_resume (true when a stored file is linked to the candidate)
--
-- Safety:   ADDITIVE for the table (nullable / defaulted columns, no row changes). The view is dropped and recreated
--           with one more column at the end; nothing reads it except the filter panel (filter-search.ts).
--           Do NOT re-run 20261107000001 after this: its CREATE OR REPLACE would try to drop has_resume and fail.
-- Apply by hand in the Supabase SQL Editor, after 20261107000001 and 20261107000002. Until it is applied the Resumes
-- tab answers "needs a database update first" and the resume filters stay greyed out.
-- Rollback: ALTER TABLE public.candidate_resume_files DROP COLUMN IF EXISTS text_status, DROP COLUMN IF EXISTS text_error,
--             DROP COLUMN IF EXISTS text_attempts, DROP COLUMN IF EXISTS resume_text, DROP COLUMN IF EXISTS emails,
--             DROP COLUMN IF EXISTS phones, DROP COLUMN IF EXISTS candidate_id, DROP COLUMN IF EXISTS match_reason,
--             DROP COLUMN IF EXISTS matched_at;
--           then re-run the view part of 20261107000001 (drop the view first).

BEGIN;

alter table public.candidate_resume_files
  add column if not exists text_status text not null default 'pending'
    check (text_status in ('pending', 'working', 'ready', 'unreadable', 'failed')),
  add column if not exists text_error text,
  add column if not exists text_attempts integer not null default 0,
  add column if not exists resume_text text,
  add column if not exists emails text[] not null default '{}',
  add column if not exists phones text[] not null default '{}',
  add column if not exists candidate_id uuid references public.candidates (id) on delete set null,
  add column if not exists match_reason text
    check (match_reason is null or match_reason in ('email', 'phone', 'both', 'manual', 'detached')),
  add column if not exists matched_at timestamptz;

create index if not exists candidate_resume_files_text_status_idx
  on public.candidate_resume_files (organization_id, text_status) where status = 'ready';
create index if not exists candidate_resume_files_candidate_idx
  on public.candidate_resume_files (organization_id, candidate_id) where candidate_id is not null;
create index if not exists candidate_resume_files_emails_idx on public.candidate_resume_files using gin (emails);
create index if not exists candidate_resume_files_phones_idx on public.candidate_resume_files using gin (phones);

-- Same columns as 20261107000001, in the same order, then has_resume.
drop view if exists public.candidate_filter_records;
create view public.candidate_filter_records with (security_invoker = true) as
select
  a.id,
  a.organization_id,
  a.candidate_id,
  a.sheet_id,
  s.name as sheet_name,
  a.source_row,
  c.full_name,
  c.email,
  c.phone,
  c.current_organization,
  c.current_designation,
  c.location,
  c.total_exp_months,
  a.role,
  a.candidate_source,
  a.sourcing_date,
  a.relevant_exp_months,
  a.notice_period_days,
  a.current_inhand,
  a.expected_inhand,
  a.remark,
  a.status,
  (a.embedding is not null) as indexed,
  a.created_at,
  a.updated_at,
  a.deleted_at,
  (a.sheet_id is null or (s.deleted_at is null and s.status = 'ready')) as sheet_live,
  lower(concat_ws(' ', c.full_name, c.email, c.phone, c.current_organization, c.current_designation,
                  c.location, a.role, a.candidate_source, a.remark,
                  c.industry, c.ug_qualification, c.pg_qualification, c.ppg_qualification, c.institute)) as lookup_text,
  c.industry,
  c.preferred_locations,
  lower(array_to_string(c.preferred_locations, ' | ')) as preferred_text,
  c.ug_qualification,
  c.pg_qualification,
  c.ppg_qualification,
  c.institute,
  c.education_type,
  c.degree_year,
  c.career_break,
  c.defence_background,
  a.serving_notice,
  exists (
    select 1 from public.candidate_resume_files r
    where r.candidate_id = c.id and r.status = 'ready'
  ) as has_resume
from public.candidate_applications a
join public.candidates c on c.id = a.candidate_id
left join public.candidate_sheets s on s.id = a.sheet_id;

revoke all on public.candidate_filter_records from anon, authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
