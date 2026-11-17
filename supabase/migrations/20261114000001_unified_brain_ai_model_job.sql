-- Unified Brain: its model is picked in the Control Center, like every other AI job (owner 2026-11-14).
--
-- What this does: task_manager_ai_models.job may now also hold 'brain_turn' (the brain's one model step).
-- Needed only to SAVE a different model for this job. Without it the brain still runs on its default chain
-- (Claude Opus 5.5, then Sonnet 5.5, then Haiku 5.5, then GLM 5.3 Flash).
-- Safety:   ADDITIVE. Every existing job stays allowed; no row changes.
-- Apply by hand, after 20261111000002.
-- Rollback: DELETE FROM public.task_manager_ai_models WHERE job = 'brain_turn';
--           then re-add the constraint from 20261111000002.

BEGIN;

ALTER TABLE IF EXISTS public.task_manager_ai_models
    DROP CONSTRAINT IF EXISTS task_manager_ai_models_job_check;

ALTER TABLE IF EXISTS public.task_manager_ai_models
    ADD CONSTRAINT task_manager_ai_models_job_check CHECK (job IN (
        'wa_understand', 'wa_reply', 'wa_tidy', 'voice_transcribe', 'voice_cleanup',
        'import_image', 'import_text', 'superuser_chat', 'learning_loop', 'duplicate_check',
        'candidate_parse', 'candidate_rank', 'candidate_fix', 'candidate_suggest', 'candidate_extract',
        'brain_turn'
    ));

NOTIFY pgrst, 'reload schema';

COMMIT;
