-- =================================================================================
-- Migration: 20261102000004_candidate_search_ai_models.sql
-- Description: owner 2026-11-02 — Candidate Search picks its AI models in the Control Center ("AI models"), like the
--   Task Manager jobs.
--   1) task_manager_ai_models.job : the allowed job list gains 'candidate_parse' (reading the search) and
--      'candidate_rank' (ranking candidates). Every existing job stays allowed; no row changes.
--   2) candidate_search_logs      : which model actually answered each step (parse_model, rank_model), for tracing.
-- Safety: widens one CHECK constraint and adds two nullable columns. No row is changed or deleted. Safe to re-run.
--         Run AFTER 20261028140001_task_manager_ai_models.sql and 20261102000003_candidate_search.sql.
--         Before this is applied, Candidate Search keeps Claude Opus 5.5 and saving its rows in the panel fails
--         with the panel's usual "run the migration first" message.
-- How to apply: run this whole file once in the Supabase SQL Editor.
-- Rollback:   DELETE FROM public.task_manager_ai_models WHERE job IN ('candidate_parse', 'candidate_rank');
--             then restore the original CHECK list from 20261028140001;
--             ALTER TABLE public.candidate_search_logs DROP COLUMN IF EXISTS parse_model, DROP COLUMN IF EXISTS rank_model;
-- =================================================================================

BEGIN;

-- The original CHECK was declared inline on the column, so Postgres named it task_manager_ai_models_job_check.
ALTER TABLE IF EXISTS public.task_manager_ai_models
    DROP CONSTRAINT IF EXISTS task_manager_ai_models_job_check;

ALTER TABLE IF EXISTS public.task_manager_ai_models
    ADD CONSTRAINT task_manager_ai_models_job_check CHECK (job IN (
        'wa_understand', 'wa_reply', 'wa_tidy', 'voice_transcribe', 'voice_cleanup',
        'import_image', 'import_text', 'superuser_chat', 'learning_loop', 'duplicate_check',
        'candidate_parse', 'candidate_rank'
    ));

ALTER TABLE IF EXISTS public.candidate_search_logs
    ADD COLUMN IF NOT EXISTS parse_model TEXT,
    ADD COLUMN IF NOT EXISTS rank_model TEXT;

NOTIFY pgrst, 'reload schema';

COMMIT;
