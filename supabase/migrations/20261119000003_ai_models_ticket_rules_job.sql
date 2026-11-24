-- Owner 2026-11-19: ticket sorting rules add one model call (docs/AI_MODELS.md, step 3):
--   ticket_rules_draft : drafts sorting rules from the team's corrections (daily and on the button)
-- It appears on the Tech console's Brain → AI models screen. This lets a choice for it be saved.
-- NOT applied automatically: a person runs this migration.
--
-- Until this runs nothing changes for anyone: the drafting uses its default models, and the screen says the choice could
-- not be saved. Every name that was allowed before (20261116000002) is still allowed.
--
-- Safety:   one CHECK constraint is replaced by a wider one (it accepts everything the old one did). No row, column,
--           table or policy is changed.
-- Safe to re-run.
-- Rollback: delete any rows for the new job, then re-run 20261116000002_ai_models_call_jobs.sql.

BEGIN;

ALTER TABLE public.task_manager_ai_models DROP CONSTRAINT IF EXISTS task_manager_ai_models_job_check;

ALTER TABLE public.task_manager_ai_models
    ADD CONSTRAINT task_manager_ai_models_job_check CHECK (job IN (
        'wa_understand', 'wa_reply', 'wa_tidy', 'voice_transcribe', 'voice_cleanup', 'import_image', 'import_text',
        'superuser_chat', 'learning_loop', 'duplicate_check',
        'candidate_parse', 'candidate_rank', 'candidate_fix', 'candidate_suggest', 'candidate_extract',
        'brain_turn',
        'assistant_interpret', 'hr_plan', 'hr_answer', 'wiki_answer', 'document_ocr', 'invoice_text', 'ocr_vision',
        'bill_ocr', 'meter_ocr', 'electricity_explain', 'sop_photo', 'sop_layout',
        'ticket_classify', 'admin_chatbot', 'coaching_feedback', 'mailbox_digest', 'satej_fast', 'satej_smart',
        'council_default',
        'call_transcribe', 'call_analyse',
        'ticket_rules_draft'
    ));

NOTIFY pgrst, 'reload schema';

COMMIT;
