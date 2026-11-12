-- Candidate Search: the fields resumes will fill (owner 2026-11-07, filter panel option A).
--
-- What this does:
--   1) candidates            + industry, preferred_locations, ug/pg/ppg_qualification, institute, education_type,
--                              degree_year, career_break, defence_background (all empty until resumes or HR fill them)
--   2) candidate_applications + serving_notice
--   3) view candidate_filter_records: what candidate_records shows, plus the new columns, preferred_text (preferred
--                              locations as searchable text), and a lookup_text that also covers industry,
--                              qualifications and institute, so keywords find them. Read by the filter panel only.
--   candidate_records is NOT changed: 20261102000003 stays safe to re-run (redefining that view with more columns
--   would make its own re-run fail with "cannot drop columns from view").
--
-- A qualification of exactly 'none' means "the CV shows none" (the filter's "None"); NULL means not known.
-- Not added on purpose: gender, age and disability. They need HR / legal sign-off before this data is stored.
--
-- Safety:   ADDITIVE. Nullable columns (preferred_locations defaults to an empty list); no row changes, no data loss.
--           A new view; no existing view, function or policy is changed.
-- Apply by hand, after 20261102000003. Until it is applied the filter panel works and shows these filters greyed out.
-- Rollback: DROP VIEW IF EXISTS public.candidate_filter_records;
--           ALTER TABLE public.candidate_applications DROP COLUMN IF EXISTS serving_notice;
--           ALTER TABLE public.candidates DROP COLUMN IF EXISTS industry, DROP COLUMN IF EXISTS preferred_locations,
--             DROP COLUMN IF EXISTS ug_qualification, DROP COLUMN IF EXISTS pg_qualification,
--             DROP COLUMN IF EXISTS ppg_qualification, DROP COLUMN IF EXISTS institute, DROP COLUMN IF EXISTS education_type,
--             DROP COLUMN IF EXISTS degree_year, DROP COLUMN IF EXISTS career_break, DROP COLUMN IF EXISTS defence_background;

BEGIN;

alter table public.candidates
  add column if not exists industry text,
  add column if not exists preferred_locations text[] not null default '{}',
  add column if not exists ug_qualification text,
  add column if not exists pg_qualification text,
  add column if not exists ppg_qualification text,
  add column if not exists institute text,
  add column if not exists education_type text
    check (education_type is null or education_type in ('full_time', 'part_time', 'correspondence')),
  add column if not exists degree_year integer
    check (degree_year is null or degree_year between 1950 and 2100),
  add column if not exists career_break boolean,
  add column if not exists defence_background text
    check (defence_background is null or defence_background in ('army', 'navy', 'air_force', 'paramilitary'));

alter table public.candidate_applications
  add column if not exists serving_notice boolean;

-- Same columns as candidate_records (20261102000003), in the same order, then the resume fields.
create or replace view public.candidate_filter_records with (security_invoker = true) as
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
  a.serving_notice
from public.candidate_applications a
join public.candidates c on c.id = a.candidate_id
left join public.candidate_sheets s on s.id = a.sheet_id;

revoke all on public.candidate_filter_records from anon, authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
