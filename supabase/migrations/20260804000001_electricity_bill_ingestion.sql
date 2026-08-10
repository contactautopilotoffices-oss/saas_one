-- Electricity bill MAILBOX INGESTION — the automated front door of the tracker.
--
-- Boards mail bills to one shared mailbox; a cron pulls the PDF, Groq parses it, and
-- the bill lands in electricity_bills with source='ocr'. This migration adds the
-- document ledger for that pipeline and the workflow side of the bill state machine.
-- See docs/ELECTRICITY_AUTOMATION_PLAN.md Phase 1.
--
-- Runs BEFORE 20260804000002 (validation engine), which reads the columns added here.
--
-- WHY workflow_status AND payment_status
-- payment_status ('pending','paid','disputed') is the MONEY side — the register edits
-- it via PATCH and the alerts view reads it. workflow_status is the PIPELINE side —
-- where the bill sits between the mailbox and Accounts. Keeping them separate means
-- the existing dashboard maths never has to understand the automation, and a stuck
-- pipeline step never corrupts the money record.
--
-- GRAIN of electricity_bill_documents: one row per ATTACHMENT per message, not per
-- message. One mail from a board can carry several bills (separate connections), and
-- each PDF is matched and parsed independently.

-- ---------------------------------------------------------------------------
-- The ingested document
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.electricity_bill_documents (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id    uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    -- Nullable until matched: the parser may fail to attribute a PDF to a billing
    -- account, in which case the row waits for a human to link it (the Inbox view).
    account_id         uuid REFERENCES public.electricity_billing_accounts(id) ON DELETE SET NULL,
    bill_id            uuid REFERENCES public.electricity_bills(id) ON DELETE SET NULL,

    -- Provenance of the mail it arrived on. mailbox_message_id is Zoho's message id.
    mailbox_message_id text NOT NULL,
    from_address       text,
    subject            text,
    received_at        timestamptz,

    -- Private storage location of the original PDF (bucket 'electricity-bills').
    storage_path       text,
    file_name          text NOT NULL,
    mime_type          text,

    ocr_status         text NOT NULL DEFAULT 'pending'
                       CHECK (ocr_status IN ('pending', 'parsed', 'failed', 'manual')),
    ocr_payload        jsonb,          -- the raw model output, for audit and re-parsing
    ocr_confidence   numeric(5,2),   -- model-reported, 0-100

    -- Which site SPOCs the PDF copy was forwarded to (property admin resolution).
    forwarded_to       text[],
    forwarded_at       timestamptz,

    created_at         timestamptz NOT NULL DEFAULT now(),

    -- Idempotency: re-running the sync must never double-ingest the same attachment.
    CONSTRAINT elec_bill_documents_unique
        UNIQUE (organization_id, mailbox_message_id, file_name)
);

CREATE INDEX IF NOT EXISTS idx_elec_bill_documents_org_status
    ON public.electricity_bill_documents(organization_id, ocr_status);

CREATE INDEX IF NOT EXISTS idx_elec_bill_documents_account
    ON public.electricity_bill_documents(account_id) WHERE account_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- The bill gains a pipeline status and the parser's unit figures
-- ---------------------------------------------------------------------------
ALTER TABLE public.electricity_bills
    ADD COLUMN IF NOT EXISTS workflow_status text NOT NULL DEFAULT 'ingested'
    CHECK (workflow_status IN (
        'ingested', 'needs_manual_entry', 'parsed', 'validating', 'validated',
        'chasing', 'disputed', 'verified', 'scenario_selected',
        'sent_to_accounts', 'paid', 'aop_linked'
    )),
    ADD COLUMN IF NOT EXISTS billed_units numeric(14,3),   -- kWh the board invoiced
    ADD COLUMN IF NOT EXISTS billed_units_unit text,       -- 'kWh' | 'kVAh' | … as printed
    ADD COLUMN IF NOT EXISTS document_id uuid REFERENCES public.electricity_bill_documents(id) ON DELETE SET NULL;

-- Backfill the rows imported before this column existed: their pipeline is done, so
-- stamp them with the terminal state their money status implies. 'paid' wins over
-- 'disputed' — a bill recorded as paid has clearly completed every upstream step.
UPDATE public.electricity_bills
SET workflow_status = CASE WHEN payment_status = 'paid' THEN 'paid' ELSE 'validated' END
WHERE workflow_status = 'ingested';

-- ---------------------------------------------------------------------------
-- Matching hints + SPOC override on the billing account
--
-- inbound_email_hints: strings the matcher looks for in the mail (sender address,
-- consumer number as printed on the bill, site alias) when consumer_ref alone is
-- not enough to attribute a PDF.
-- spoc_user_id: explicit "email this bill's PDF to THIS person" override; when set it
-- beats the property_memberships role='property_admin' resolution.
-- ---------------------------------------------------------------------------
ALTER TABLE public.electricity_billing_accounts
    ADD COLUMN IF NOT EXISTS inbound_email_hints text[],
    ADD COLUMN IF NOT EXISTS spoc_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- RLS — same audience as the bills tables (has_aop_access read; service-role writes).
-- ---------------------------------------------------------------------------
ALTER TABLE public.electricity_bill_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "aop access reads bill documents" ON public.electricity_bill_documents
    FOR SELECT USING (public.has_aop_access(organization_id));

-- Writes are service-role only (ingest cron + admin link API), matching the bills tables.

-- NOTE: the private storage bucket 'electricity-bills' is created from the Supabase
-- dashboard, like the other buckets in this repo — never from a migration.
