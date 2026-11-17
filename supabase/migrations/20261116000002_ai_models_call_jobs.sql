-- Owner 2026-11-16: the Recruitment Calls tab adds two model calls (docs/AI_MODELS.md, step 3):
--   call_transcribe : the recording to text (Groq Whisper)
--   call_analyse    : the transcript to sentiment, interest, concerns and the facts heard (Claude)
-- Both appear on the Tech console's Brain → AI models screen. This lets a choice for them be saved.
-- NOT applied automatically: a person runs this migration.
--
-- Until this runs nothing changes for anyone: both jobs call today's models, and the screen says the choice could
-- not be saved. Every name that was allowed before (20261115000001) is still allowed.
--
-- Safety:   one CHECK constraint is replaced by a wider one (it accepts everything the old one did). No row, column,
--           table or policy is changed.
-- Safe to re-run.
-- Rollback: delete any rows for the two new jobs, then re-run 20261115000001_ai_models_all_jobs.sql.

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
        'call_transcribe', 'call_analyse'
    ));

NOTIFY pgrst, 'reload schema';

COMMIT;
