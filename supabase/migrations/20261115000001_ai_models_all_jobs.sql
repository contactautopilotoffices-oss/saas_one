-- Owner 2026-11-15: "every AI model configurable" (Tech console: Brain → AI models).
-- NOT applied automatically: a person runs this migration.
--
-- task_manager_ai_models holds, per job, the models chosen on that screen. Its `job` column only accepts names it
-- knows. This adds the names of the jobs outside the Task Manager (the WhatsApp assistant, HR, documents, finance,
-- facilities, tickets, CRM, procurement, the shared model), so a choice for them can be saved.
--
-- Until this runs nothing changes for anyone: every one of those jobs keeps calling the model it calls today, and the
-- screen says the choice could not be saved. The 16 names that were allowed before are all still allowed.
--
-- Safety:   one CHECK constraint is replaced by a wider one (it accepts everything the old one did). No row, column,
--           table or policy is changed.
-- Safe to re-run.
-- Rollback: delete any rows for the new jobs, then re-run 20261114000001_unified_brain_ai_model_job.sql.

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
        'council_default'
    ));

NOTIFY pgrst, 'reload schema';

COMMIT;
