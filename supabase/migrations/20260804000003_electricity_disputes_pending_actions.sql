-- Electricity dispute tracker + the generic pending-actions center (Phase 3 of
-- docs/ELECTRICITY_AUTOMATION_PLAN.md).
--
-- Two halves:
--
-- 1. electricity_disputes / electricity_dispute_responses — the checker (ops_super_admin)
--    flags a validated bill as wrong; the site's property admin answers free-form with
--    attachments; the checker accepts or rejects. Bill workflow_status moves
--    'disputed' -> 'validated' on accept (see backend/lib/electricity/disputes.ts).
--
-- 2. pending_actions — deliberately NOT electricity-specific. It is the HRMS-style
--    "things waiting on YOU" inbox the header badge reads from: every row names one
--    recipient, one domain, one entity, and the action verbs the UI may render
--    (["respond","view"], ["approve","reject","view"], ...). Electricity disputes are the
--    first domain; payment runs (Phase 6) and any future module reuse the same table,
--    which is why nothing here references electricity tables directly.
--
-- RLS mirrors the electricity bill tables (20260802000002_electricity_bills.sql):
-- has_aop_access() reads for the spend-data tables, service-role writes. pending_actions
-- is per-recipient instead: a user sees and acts on only their own rows.

-- ---------------------------------------------------------------------------
-- The dispute itself. One row per raised discrepancy; responses hang off it.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.electricity_disputes (
    id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id          uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    bill_id                  uuid NOT NULL REFERENCES public.electricity_bills(id) ON DELETE CASCADE,
    validation_id            uuid REFERENCES public.electricity_bill_validations(id) ON DELETE SET NULL,

    raised_by                uuid NOT NULL REFERENCES public.users(id),
    raised_at                timestamptz NOT NULL DEFAULT now(),
    reason                   text NOT NULL,

    status                   text NOT NULL DEFAULT 'open'
                             CHECK (status IN ('open', 'responded', 'accepted', 'rejected', 'withdrawn')),

    -- Resolved at open time from property_memberships (role='property_admin') on the
    -- account's property. Nullable: an account with no property link still gets a
    -- dispute, just no assignee (and therefore no pending_action).
    assigned_property_admin  uuid REFERENCES public.users(id),

    resolved_by              uuid REFERENCES public.users(id),
    resolved_at              timestamptz,
    resolution_note          text,

    created_at               timestamptz NOT NULL DEFAULT now(),
    updated_at               timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_electricity_disputes_org_status
    ON public.electricity_disputes(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_electricity_disputes_assignee
    ON public.electricity_disputes(assigned_property_admin) WHERE status IN ('open', 'responded');
CREATE INDEX IF NOT EXISTS idx_electricity_disputes_bill
    ON public.electricity_disputes(bill_id);

-- ---------------------------------------------------------------------------
-- Free-form thread on a dispute. Attachments are metadata only — the files live in the
-- `electricity-bills` storage bucket; each entry is {storage_path, file_name, mime_type}.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.electricity_dispute_responses (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    dispute_id   uuid NOT NULL REFERENCES public.electricity_disputes(id) ON DELETE CASCADE,
    author_id    uuid NOT NULL REFERENCES public.users(id),
    body         text NOT NULL,
    attachments  jsonb NOT NULL DEFAULT '[]'::jsonb,
    created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_electricity_dispute_responses_dispute
    ON public.electricity_dispute_responses(dispute_id, created_at);

-- ---------------------------------------------------------------------------
-- The generic pending-actions inbox.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.pending_actions (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    recipient_id    uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,

    domain          text NOT NULL,   -- 'electricity_dispute' first
    entity_type     text NOT NULL,   -- 'electricity_dispute', 'electricity_payment_run', ...
    entity_id       uuid NOT NULL,

    title           text NOT NULL,
    description     text,
    -- The verbs the UI may render, e.g. ["respond","view"] or ["approve","reject","view"].
    actions         jsonb NOT NULL DEFAULT '[]'::jsonb,
    deep_link       text,

    status          text NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open', 'done', 'dismissed')),
    created_at      timestamptz NOT NULL DEFAULT now(),
    resolved_at     timestamptz,
    resolved_action text
);

CREATE INDEX IF NOT EXISTS idx_pending_actions_recipient_open
    ON public.pending_actions(recipient_id, created_at DESC) WHERE status = 'open';
-- Lets a module close its own actions when the underlying entity resolves through
-- another path (e.g. dispute withdrawn from the tracker instead of the inbox).
CREATE INDEX IF NOT EXISTS idx_pending_actions_entity
    ON public.pending_actions(entity_type, entity_id) WHERE status = 'open';

-- ---------------------------------------------------------------------------
-- RLS — disputes tables mirror the electricity bills convention (has_aop_access read,
-- service-role writes). pending_actions is per-recipient, like notifications.
-- ---------------------------------------------------------------------------
ALTER TABLE public.electricity_disputes          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.electricity_dispute_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pending_actions               ENABLE ROW LEVEL SECURITY;

CREATE POLICY "aop access reads electricity disputes" ON public.electricity_disputes
    FOR SELECT USING (public.has_aop_access(organization_id));

CREATE POLICY "aop access reads electricity dispute responses" ON public.electricity_dispute_responses
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.electricity_disputes d
            WHERE d.id = dispute_id AND public.has_aop_access(d.organization_id)
        )
    );

CREATE POLICY "recipients read their own pending actions" ON public.pending_actions
    FOR SELECT USING (recipient_id = auth.uid());

CREATE POLICY "recipients act on their own pending actions" ON public.pending_actions
    FOR UPDATE USING (recipient_id = auth.uid());

-- Writes to all three tables are otherwise service-role only (API routes), matching the
-- electricity bills tables.

-- ---------------------------------------------------------------------------
-- Realtime for the header badge — same idempotent publication pattern as
-- notifications / mailbox_threads.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'pending_actions'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.pending_actions;
    END IF;
END $$;
