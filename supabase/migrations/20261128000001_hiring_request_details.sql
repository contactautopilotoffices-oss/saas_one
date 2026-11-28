-- Rollback: ALTER TABLE public.recruitment_requisitions DROP COLUMN requested_in_plan,
--   DROP COLUMN max_experience_years, DROP COLUMN jd_file_name, DROP COLUMN jd_text, DROP COLUMN jd_pdf_base64;
alter table public.recruitment_requisitions
  add column if not exists requested_in_plan boolean,
  add column if not exists max_experience_years numeric constraint recruitment_requisitions_experience_range check (
    max_experience_years between 0 and 50 and (min_experience_years is null or max_experience_years >= min_experience_years)
  ),
  add column if not exists jd_file_name text,
  add column if not exists jd_text text,
  add column if not exists jd_pdf_base64 text;
