-- Candidate Search: details read from resumes (owner 2026-11-11, phase 4).
--
-- A model (Control Center job 'candidate_extract', default Claude Haiku 5.5) reads each stored resume's text and fills
-- the candidate's EMPTY fields: company, designation, location, experience, industry, education (20261107000001's
-- columns), and the new skills, past companies and a two-sentence summary. A resume that matches no one becomes a
-- new candidate (source "Resume"). The resume's text joins keyword search (resume_fts) and, through the summary and
-- skills in search_text, meaning search.
--
--   candidates               + skills, past_companies, resume_summary, resume_text (+ resume_fts, indexed)
--   candidate_resume_files   + extract_status / extract_error / extract_attempts, extracted (the model's answer),
--                              extract_model, extracted_at, tokens_in / tokens_out (doctrine L14: cost per call)
--                              match_reason gains 'resume' (a candidate created from this file)
--                              status gains 'other' (a portfolio or similar: kept, never matched, out of the Excel)
--   task_manager_ai_models   job may hold 'candidate_extract'
--   candidate_filter_records recreated with skills, resume_summary and resume_fts; lookup_text covers skills too
--
-- Safety:   ADDITIVE for the tables (nullable / defaulted columns; constraints widened, never narrowed). The view is
--           dropped and recreated with more columns; only filter-search.ts reads it.
--           Do NOT re-run 20261107000001 or 20261110000001 after this (their view definitions have fewer columns).
-- Apply by hand after 20261110000002. Safe to re-run.
-- Rollback: DROP VIEW public.candidate_filter_records; re-create it from 20261110000001; drop the columns above;
--           restore the three CHECK constraints without the new values.

BEGIN;

alter table public.candidates
  add column if not exists skills text[] not null default '{}',
  add column if not exists past_companies jsonb not null default '[]'::jsonb,
  add column if not exists resume_summary text,
  add column if not exists resume_text text,
  add column if not exists resume_fts tsvector generated always as (to_tsvector('english', coalesce(resume_text, ''))) stored;

create index if not exists candidates_resume_fts_idx on public.candidates using gin (resume_fts);

alter table public.candidate_resume_files
  add column if not exists extract_status text not null default 'pending'
    check (extract_status in ('pending', 'working', 'done', 'failed', 'skipped')),
  add column if not exists extract_error text,
  add column if not exists extract_attempts integer not null default 0,
  add column if not exists extracted jsonb,
  add column if not exists extract_model text,
  add column if not exists extracted_at timestamptz,
  add column if not exists tokens_in integer,
  add column if not exists tokens_out integer;

create index if not exists candidate_resume_files_extract_idx
  on public.candidate_resume_files (organization_id, extract_status) where status = 'ready';

alter table public.candidate_resume_files
  drop constraint if exists candidate_resume_files_match_reason_check,
  add constraint candidate_resume_files_match_reason_check
    check (match_reason is null or match_reason in ('email', 'phone', 'both', 'manual', 'detached', 'resume'));

alter table public.candidate_resume_files
  drop constraint if exists candidate_resume_files_status_check,
  add constraint candidate_resume_files_status_check check (status in ('uploading', 'ready', 'rejected', 'other'));

ALTER TABLE IF EXISTS public.task_manager_ai_models
    DROP CONSTRAINT IF EXISTS task_manager_ai_models_job_check;
ALTER TABLE IF EXISTS public.task_manager_ai_models
    ADD CONSTRAINT task_manager_ai_models_job_check CHECK (job IN (
        'wa_understand', 'wa_reply', 'wa_tidy', 'voice_transcribe', 'voice_cleanup',
        'import_image', 'import_text', 'superuser_chat', 'learning_loop', 'duplicate_check',
        'candidate_parse', 'candidate_rank', 'candidate_fix', 'candidate_suggest', 'candidate_extract'
    ));

-- Same columns as 20261110000001, in the same order, then the new ones.
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
                  c.industry, c.ug_qualification, c.pg_qualification, c.ppg_qualification, c.institute,
                  array_to_string(c.skills, ' '), c.resume_summary)) as lookup_text,
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
  ) as has_resume,
  c.skills,
  c.past_companies,
  c.resume_summary,
  c.resume_fts
from public.candidate_applications a
join public.candidates c on c.id = a.candidate_id
left join public.candidate_sheets s on s.id = a.sheet_id;

revoke all on public.candidate_filter_records from anon, authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
