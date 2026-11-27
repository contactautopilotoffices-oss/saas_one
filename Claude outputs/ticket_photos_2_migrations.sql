-- Reading ticket photos: both database changes, in order.
-- Paste the whole file into the Supabase SQL Editor and press Run. Safe to run more than once.
-- Run the earlier script (ticket_learning_all_3_migrations.sql) first if you have not yet.
-- Only adds one new table and widens the AI models job list. Nothing existing is changed.

-- ====================================================================================
-- 20261119000004_ticket_photo_checks.sql
-- ====================================================================================
-- The AI reads a ticket's photo (owner 2026-11-19: "link the uploaded image with query raised in the ticket").
-- Code: backend/lib/ticketing/ticketPhoto.ts. NOT applied automatically: a person runs this in the Supabase SQL Editor.
--
--   ticket_photo_checks   one row per ticket whose photo was read: what the photo shows (equipment and problem only,
--                         never people), the category and priority it points to, whether it agrees with the ticket's
--                         category, and what was changed (On only: confidence lowered so it goes to Review, priority
--                         raised). In Watch only, changed stays empty: the row is a record and nothing else.
--
-- Safety:   ADDITIVE ONLY. One new table; nothing existing changes. RLS on, NO policies: only the server reads and writes
--           it. The photo itself is never copied here, only a short description.
-- Safe to re-run.
-- Rollback: DROP TABLE IF EXISTS public.ticket_photo_checks;

BEGIN;

CREATE TABLE IF NOT EXISTS public.ticket_photo_checks (
    ticket_id           uuid PRIMARY KEY REFERENCES public.tickets(id) ON DELETE CASCADE,
    organization_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    mode                text NOT NULL CHECK (mode IN ('shadow', 'live')),
    status              text NOT NULL CHECK (status IN ('read', 'unusable', 'failed')),
    description         text,
    photo_code          text,
    photo_priority      text,
    photo_risk          text,
    photo_confidence    integer,
    ticket_code         text,
    ticket_priority     text,
    ticket_confidence   integer,
    agrees              boolean,
    -- What was changed on the ticket (On only): {"confidence":[from,to],"priority":[from,to]}
    changed             jsonb NOT NULL DEFAULT '{}'::jsonb,
    model               text,
    latency_ms          integer,
    error               text,
    created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ticket_photo_checks_org ON public.ticket_photo_checks (organization_id, created_at DESC);
ALTER TABLE public.ticket_photo_checks ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- ====================================================================================
-- 20261119000005_ai_models_ticket_photo_job.sql
-- ====================================================================================
-- Owner 2026-11-19: reading ticket photos adds one model call (docs/AI_MODELS.md, step 3):
--   ticket_photo : reads the photo of a ticket (what it shows and which category it points to)
-- It appears on the Tech console's Brain → AI models screen. This lets a choice for it be saved.
-- NOT applied automatically: a person runs this migration.
--
-- Until this runs nothing changes for anyone: the photo reading uses its default models, and the screen says the choice could
-- not be saved. Every name that was allowed before (20261119000003) is still allowed.
--
-- Safety:   one CHECK constraint is replaced by a wider one (it accepts everything the old one did). No row, column,
--           table or policy is changed.
-- Safe to re-run.
-- Rollback: delete any rows for the new job, then re-run 20261119000003_ai_models_ticket_rules_job.sql.

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
        'ticket_rules_draft', 'ticket_photo'
    ));

NOTIFY pgrst, 'reload schema';

COMMIT;

