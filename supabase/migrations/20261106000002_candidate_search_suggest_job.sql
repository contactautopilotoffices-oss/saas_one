-- Candidate Search: "AI suggested keywords" picks its model in the Control Center (owner 2026-11-06).
--
-- What this does: task_manager_ai_models.job may now also hold 'candidate_suggest'.
-- Needed only to SAVE a different model for this job. Without it the suggestions still run on the default (Claude Haiku 5.5).
-- Safety:   ADDITIVE. Every existing job stays allowed; no row changes.
-- Apply by hand, after 20261103000001.
-- Rollback: DELETE FROM public.task_manager_ai_models WHERE job = 'candidate_suggest';
--           then re-add the constraint from 20261103000001.

BEGIN;

ALTER TABLE IF EXISTS public.task_manager_ai_models
    DROP CONSTRAINT IF EXISTS task_manager_ai_models_job_check;

ALTER TABLE IF EXISTS public.task_manager_ai_models
    ADD CONSTRAINT task_manager_ai_models_job_check CHECK (job IN (
        'wa_understand', 'wa_reply', 'wa_tidy', 'voice_transcribe', 'voice_cleanup',
        'import_image', 'import_text', 'superuser_chat', 'learning_loop', 'duplicate_check',
        'candidate_parse', 'candidate_rank', 'candidate_fix', 'candidate_suggest'
    ));

NOTIFY pgrst, 'reload schema';

COMMIT;
