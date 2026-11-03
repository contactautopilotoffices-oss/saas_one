-- ============================================================================
-- INVOICE CONTROL — vendor invoice collection, PO matching, fast-track payment
-- exceptions.  Additive only: nothing here alters an existing table.
-- ----------------------------------------------------------------------------
-- WHY
--   Invoices reach purchase over mail and WhatsApp, are chased by hand, and are
--   never compared to the PO line by line. Payment is then aligned on trust.
--   This gives each PO one secure vendor upload link, stores the original
--   document, reads it, checks it against the PO and its lines, and routes the
--   result. Urgent payments with no invoice go through an explicit approval
--   instead of a quiet bypass.
--
-- THREE STATE MACHINES, DELIBERATELY SEPARATE (never one status column)
--   1. invoice:        extraction_status / match_status / review_status
--   2. fast-track:     invoice_fast_track_requests.status   (the payment exception)
--   3. documentation:  invoice_fast_track_requests.documentation_state
--   A request can be 'aligned' while documentation is still 'pending'. That is
--   the point of the design.
--
-- WHAT IT REUSES (no parallel masters)
--   zoho_purchase_orders  — the PO              (po_id)
--   zoho_po_line_items    — the PO lines        (po_line_item_id)
--   vendor_profiles       — vendor GSTIN        (looked up by the API)
--   po_payments           — the actual payment  (po_payment_id on a fast-track)
--   There is no vendors FK: POs carry vendor_id (Zoho contact id) and
--   vendor_name as text, so invoices carry a derived vendor_key instead.
--
-- ACCESS MODEL
--   RLS is ON for every table and NO policy is created: the browser, signed in
--   or anonymous, can read nothing. All reads and writes go through API routes
--   on the service role, which check the caller's role first. Same stance as
--   wiki_pages. The vendor upload page never touches these tables directly.
--
-- DELETING A PO: a PO that has invoice or approval history cannot be hard-deleted for the
-- same reason: the cascade would have to erase append-only audit rows, and the trigger
-- refuses. That is deliberate. The Zoho sync upserts POs and never deletes them.
--
-- NOT APPLIED. Run once, by a person.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- Per-org policy. One row; defaults apply when no row exists (the API merges).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.invoice_control_settings (
    organization_id         UUID PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
    link_expiry_hours       INTEGER       NOT NULL DEFAULT 72   CHECK (link_expiry_hours BETWEEN 1 AND 720),
    max_file_mb             INTEGER       NOT NULL DEFAULT 10   CHECK (max_file_mb BETWEEN 1 AND 25),
    -- Matching tolerances. Amount tolerance absorbs rounding only.
    amount_tolerance        NUMERIC(14,2) NOT NULL DEFAULT 1.00 CHECK (amount_tolerance >= 0),
    rate_tolerance_pct      NUMERIC(6,3)  NOT NULL DEFAULT 0    CHECK (rate_tolerance_pct >= 0),
    qty_tolerance_pct       NUMERIC(6,3)  NOT NULL DEFAULT 0    CHECK (qty_tolerance_pct >= 0),
    min_confidence          INTEGER       NOT NULL DEFAULT 70   CHECK (min_confidence BETWEEN 0 AND 100),
    -- Fast-track approval policy.
    approver_roles          TEXT[]        NOT NULL DEFAULT ARRAY['org_super_admin','master_admin','accounts'],
    approval_limit          NUMERIC(14,2) NOT NULL DEFAULT 100000 CHECK (approval_limit >= 0),
    escalation_roles        TEXT[]        NOT NULL DEFAULT ARRAY['org_super_admin','master_admin'],
    evidence_required       BOOLEAN       NOT NULL DEFAULT true,
    doc_deadline_days       INTEGER       NOT NULL DEFAULT 7    CHECK (doc_deadline_days BETWEEN 1 AND 90),
    policy_version          INTEGER       NOT NULL DEFAULT 1,
    updated_by              UUID REFERENCES public.users(id) ON DELETE SET NULL,
    updated_at              TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- Upload links: one PO, one submission. Only the SHA-256 of the token is kept.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.invoice_intake_links (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id   UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    po_id             UUID NOT NULL REFERENCES public.zoho_purchase_orders(id) ON DELETE CASCADE,
    token_hash        TEXT NOT NULL UNIQUE,
    created_by        UUID NOT NULL REFERENCES public.users(id),
    status            TEXT NOT NULL DEFAULT 'active'
                      CHECK (status IN ('active','used','expired','revoked')),
    expires_at        TIMESTAMPTZ NOT NULL,
    submission_count  INTEGER NOT NULL DEFAULT 0 CHECK (submission_count BETWEEN 0 AND 1),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    used_at           TIMESTAMPTZ,
    revoked_at        TIMESTAMPTZ,
    revoked_by        UUID REFERENCES public.users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_invoice_links_po ON public.invoice_intake_links (po_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_invoice_links_org_status ON public.invoice_intake_links (organization_id, status);

-- ---------------------------------------------------------------------------
-- Invoices. Header columns hold the WORKING values (what OCR read, as later
-- corrected); `extracted` keeps what the reader returned, untouched, so the two
-- can always be compared. A corrected submission is a NEW row — the original
-- document and its mismatch history are never overwritten.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.invoices (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id       UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    po_id                 UUID NOT NULL REFERENCES public.zoho_purchase_orders(id) ON DELETE CASCADE,
    intake_link_id        UUID REFERENCES public.invoice_intake_links(id) ON DELETE SET NULL,
    -- Zoho contact id when the PO has one, else the lower-cased vendor name.
    vendor_key            TEXT,
    submission_reference  TEXT NOT NULL UNIQUE,
    idempotency_key       TEXT,
    submitted_via         TEXT NOT NULL DEFAULT 'vendor_link'
                          CHECK (submitted_via IN ('vendor_link','internal_upload')),
    submitted_by          UUID REFERENCES public.users(id) ON DELETE SET NULL,
    submitted_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    invoice_number        TEXT,
    -- Upper-cased, alphanumerics only: "inv/2026-0081" and "INV20260081" collide.
    invoice_number_norm   TEXT,
    invoice_date          DATE,
    vendor_name_read      TEXT,
    vendor_gstin_read     TEXT,
    currency              CHAR(3) NOT NULL DEFAULT 'INR',
    taxable_amount        NUMERIC(18,2),
    tax_amount            NUMERIC(18,2),
    other_charges         NUMERIC(18,2),
    discount_amount       NUMERIC(18,2),
    invoice_total         NUMERIC(18,2),

    extracted             JSONB,
    extraction_provider   TEXT,
    extraction_model      TEXT,
    extraction_status     TEXT NOT NULL DEFAULT 'pending'
                          CHECK (extraction_status IN ('pending','processing','completed','failed')),
    extraction_error      TEXT,
    match_status          TEXT NOT NULL DEFAULT 'pending'
                          CHECK (match_status IN ('pending','matched','mismatched','needs_review','duplicate_suspected')),
    review_status         TEXT NOT NULL DEFAULT 'pending'
                          CHECK (review_status IN ('pending','in_review','accepted','rejected','resubmission_required')),
    reviewed_by           UUID REFERENCES public.users(id) ON DELETE SET NULL,
    reviewed_at           TIMESTAMPTZ,
    review_note           TEXT,
    -- Set when an employee has edited the working values.
    corrected_by          UUID REFERENCES public.users(id) ON DELETE SET NULL,
    corrected_at          TIMESTAMPTZ,
    duplicate_of          UUID REFERENCES public.invoices(id) ON DELETE SET NULL,
    policy_version        INTEGER,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_invoices_po ON public.invoices (po_id, submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_invoices_queue ON public.invoices (organization_id, match_status, review_status, submitted_at);
-- Duplicate lookup is by normalised number within one vendor. Deliberately NOT a
-- unique index: a suspected duplicate must be held for a person, not bounced.
CREATE INDEX IF NOT EXISTS idx_invoices_dupe ON public.invoices (organization_id, vendor_key, invoice_number_norm);
CREATE UNIQUE INDEX IF NOT EXISTS uq_invoices_idempotency
    ON public.invoices (organization_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Original files. Private bucket 'invoice-docs'; storage_path is a reference,
-- never a URL.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.invoice_documents (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id   UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    invoice_id        UUID NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
    storage_path      TEXT NOT NULL UNIQUE,
    original_filename TEXT NOT NULL,
    content_type      TEXT NOT NULL,
    file_size_bytes   BIGINT NOT NULL CHECK (file_size_bytes > 0),
    sha256_hash       TEXT NOT NULL,
    source_channel    TEXT NOT NULL DEFAULT 'vendor_link'
                      CHECK (source_channel IN ('vendor_link','internal_upload')),
    uploaded_by       UUID REFERENCES public.users(id) ON DELETE SET NULL,
    uploaded_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_invoice_documents_invoice ON public.invoice_documents (invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoice_documents_hash ON public.invoice_documents (organization_id, sha256_hash);

CREATE TABLE IF NOT EXISTS public.invoice_line_items (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id       UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    invoice_id            UUID NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
    line_no               INTEGER NOT NULL,
    -- The PO line this invoice line was matched to; NULL = could not be mapped.
    po_line_item_id       UUID REFERENCES public.zoho_po_line_items(id) ON DELETE SET NULL,
    description           TEXT NOT NULL,
    item_code             TEXT,
    hsn_or_sac            TEXT,
    quantity              NUMERIC(18,4),
    unit                  TEXT,
    unit_rate             NUMERIC(18,4),
    taxable_amount        NUMERIC(18,2),
    tax_rate              NUMERIC(7,4),
    tax_amount            NUMERIC(18,2),
    line_total            NUMERIC(18,2),
    extraction_confidence NUMERIC(5,4),
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (invoice_id, line_no)
);
CREATE INDEX IF NOT EXISTS idx_invoice_lines_invoice ON public.invoice_line_items (invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoice_lines_po_line ON public.invoice_line_items (po_line_item_id);

-- ---------------------------------------------------------------------------
-- Rule outcomes. Every run writes a fresh set under a new run_id and flips the
-- old set to is_current = false, so the first mismatch is never erased. A
-- reviewer's override keeps the ORIGINAL outcome in original_outcome.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.invoice_validation_results (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id   UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    invoice_id        UUID NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
    run_id            UUID NOT NULL,
    is_current        BOOLEAN NOT NULL DEFAULT true,
    rule_code         TEXT NOT NULL,
    severity          TEXT NOT NULL CHECK (severity IN ('info','warning','blocking')),
    outcome           TEXT NOT NULL CHECK (outcome IN ('pass','fail','unknown')),
    invoice_line_no   INTEGER,
    po_line_item_id   UUID REFERENCES public.zoho_po_line_items(id) ON DELETE SET NULL,
    expected_value    JSONB,
    actual_value      JSONB,
    difference_amount NUMERIC(18,2),
    explanation       TEXT NOT NULL,
    original_outcome  TEXT,
    resolved_by       UUID REFERENCES public.users(id) ON DELETE SET NULL,
    resolution_note   TEXT,
    resolved_at       TIMESTAMPTZ,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_invoice_validation_invoice ON public.invoice_validation_results (invoice_id, is_current, severity, outcome);

-- ---------------------------------------------------------------------------
-- Fast-track payment exceptions: "pay now, invoice to follow".
-- `status` is the payment exception; `documentation_state` is the invoice
-- chase. They move independently.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.invoice_fast_track_requests (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id      UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    po_id                UUID NOT NULL REFERENCES public.zoho_purchase_orders(id) ON DELETE CASCADE,
    -- NULL while no invoice exists; set when one is received for this PO.
    invoice_id           UUID REFERENCES public.invoices(id) ON DELETE SET NULL,
    requested_by         UUID NOT NULL REFERENCES public.users(id),
    requested_amount     NUMERIC(18,2) NOT NULL CHECK (requested_amount > 0),
    currency             CHAR(3) NOT NULL DEFAULT 'INR',
    urgency_reason       TEXT NOT NULL,
    -- [{storage_path, filename, purpose}] — references to private objects, never URLs.
    evidence             JSONB NOT NULL DEFAULT '[]'::jsonb,
    status               TEXT NOT NULL DEFAULT 'pending_approval'
                         CHECK (status IN ('pending_approval','approved','rejected','needs_information',
                                           'alignment_in_progress','aligned','cancelled')),
    approved_amount      NUMERIC(18,2) CHECK (approved_amount IS NULL OR approved_amount > 0),
    invoice_pending      BOOLEAN NOT NULL DEFAULT true,
    documentation_state  TEXT NOT NULL DEFAULT 'pending'
                         CHECK (documentation_state IN ('pending','link_sent','invoice_received','matched',
                                                        'reconciled','closed','disputed','waived_by_policy')),
    doc_due_at           TIMESTAMPTZ NOT NULL,
    doc_closed_by        UUID REFERENCES public.users(id) ON DELETE SET NULL,
    doc_closed_at        TIMESTAMPTZ,
    doc_close_reason     TEXT,
    -- The tracker row Accounts created on alignment. 'Payment recorded' is read
    -- from this row's own status (completed + UTR), not copied here.
    po_payment_id        UUID REFERENCES public.po_payments(id) ON DELETE SET NULL,
    idempotency_key      TEXT,
    policy_version       INTEGER,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_fast_track_org_status ON public.invoice_fast_track_requests (organization_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_fast_track_po ON public.invoice_fast_track_requests (po_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_fast_track_idempotency
    ON public.invoice_fast_track_requests (organization_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.invoice_fast_track_decisions (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id  UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    request_id       UUID NOT NULL REFERENCES public.invoice_fast_track_requests(id) ON DELETE CASCADE,
    decision         TEXT NOT NULL CHECK (decision IN ('approved','rejected','needs_information')),
    approver_id      UUID NOT NULL REFERENCES public.users(id),
    approved_amount  NUMERIC(18,2),
    reason           TEXT NOT NULL,
    policy_version   INTEGER NOT NULL,
    decided_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_fast_track_decisions_request ON public.invoice_fast_track_decisions (request_id, decided_at DESC);

-- ---------------------------------------------------------------------------
-- Audit trail: append-only. Corrections are new events, never edits.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.invoice_audit_events (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id   UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    invoice_id        UUID REFERENCES public.invoices(id) ON DELETE CASCADE,
    request_id        UUID REFERENCES public.invoice_fast_track_requests(id) ON DELETE CASCADE,
    link_id           UUID REFERENCES public.invoice_intake_links(id) ON DELETE SET NULL,
    po_id             UUID REFERENCES public.zoho_purchase_orders(id) ON DELETE CASCADE,
    actor_user_id     UUID REFERENCES public.users(id) ON DELETE SET NULL,
    actor_type        TEXT NOT NULL CHECK (actor_type IN ('user','vendor_link','system')),
    -- Denormalised at write time so the trail still reads after a role change.
    actor_name        TEXT,
    actor_role        TEXT,
    event_type        TEXT NOT NULL,
    correlation_id    UUID,
    details           JSONB NOT NULL DEFAULT '{}'::jsonb,
    -- Policy changes belong to the organisation, not to one invoice, so no subject is required.
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_invoice_audit_invoice ON public.invoice_audit_events (invoice_id, created_at);
CREATE INDEX IF NOT EXISTS idx_invoice_audit_request ON public.invoice_audit_events (request_id, created_at);
CREATE INDEX IF NOT EXISTS idx_invoice_audit_po ON public.invoice_audit_events (po_id, created_at);

CREATE OR REPLACE FUNCTION public.invoice_block_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = '42501';
END $$;

DROP TRIGGER IF EXISTS trg_invoice_audit_append_only ON public.invoice_audit_events;
CREATE TRIGGER trg_invoice_audit_append_only
    BEFORE UPDATE OR DELETE ON public.invoice_audit_events
    FOR EACH ROW EXECUTE FUNCTION public.invoice_block_mutation();

DROP TRIGGER IF EXISTS trg_invoice_decisions_append_only ON public.invoice_fast_track_decisions;
CREATE TRIGGER trg_invoice_decisions_append_only
    BEFORE UPDATE OR DELETE ON public.invoice_fast_track_decisions
    FOR EACH ROW EXECUTE FUNCTION public.invoice_block_mutation();

-- ---------------------------------------------------------------------------
-- RLS: on, no policies. Service role only.
-- ---------------------------------------------------------------------------
ALTER TABLE public.invoice_control_settings    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_intake_links        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoices                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_documents           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_line_items          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_validation_results  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_fast_track_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_fast_track_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_audit_events        ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- Atomic submission. In ONE transaction: lock the link row, refuse if it is not
-- active, create the invoice, its document and the audit event, then burn the
-- link. Two simultaneous submissions on one link serialise on the row lock and
-- exactly one wins. Also used for internal uploads (p_token_hash NULL), which
-- carry no link.
--
-- Returns jsonb { outcome: 'created' | 'unavailable' | 'duplicate_request', ... }.
-- 'unavailable' is deliberately the same answer for unknown, used, expired and
-- revoked, so a caller cannot tell them apart.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.invoice_register_submission(
    p_token_hash      TEXT,
    p_org             UUID,
    p_po              UUID,
    p_user            UUID,
    p_storage_path    TEXT,
    p_filename        TEXT,
    p_content_type    TEXT,
    p_size            BIGINT,
    p_sha256          TEXT,
    p_invoice_number  TEXT,
    p_invoice_date    DATE,
    p_submission_ref  TEXT,
    p_idempotency_key TEXT
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_link   public.invoice_intake_links%ROWTYPE;
    v_org    UUID := p_org;
    v_po     UUID := p_po;
    v_vendor TEXT;
    v_inv    UUID;
    v_existing public.invoices%ROWTYPE;
    v_via    TEXT;
BEGIN
    IF p_token_hash IS NOT NULL THEN
        SELECT * INTO v_link FROM public.invoice_intake_links WHERE token_hash = p_token_hash FOR UPDATE;
        IF NOT FOUND THEN RETURN jsonb_build_object('outcome', 'unavailable'); END IF;
        IF v_link.status = 'active' AND v_link.expires_at <= NOW() THEN
            UPDATE public.invoice_intake_links SET status = 'expired' WHERE id = v_link.id;
            RETURN jsonb_build_object('outcome', 'unavailable');
        END IF;
        IF v_link.status <> 'active' OR v_link.submission_count >= 1 THEN
            RETURN jsonb_build_object('outcome', 'unavailable');
        END IF;
        v_org := v_link.organization_id;
        v_po  := v_link.po_id;
        v_via := 'vendor_link';
    ELSE
        IF p_user IS NULL OR p_org IS NULL OR p_po IS NULL THEN
            RAISE EXCEPTION 'internal submission needs org, po and user';
        END IF;
        v_via := 'internal_upload';
    END IF;

    IF p_idempotency_key IS NOT NULL THEN
        SELECT * INTO v_existing FROM public.invoices
         WHERE organization_id = v_org AND idempotency_key = p_idempotency_key;
        IF FOUND THEN
            RETURN jsonb_build_object('outcome', 'duplicate_request', 'invoice_id', v_existing.id,
                                      'submission_reference', v_existing.submission_reference);
        END IF;
    END IF;

    SELECT COALESCE(NULLIF(vendor_id, ''), LOWER(BTRIM(vendor_name))) INTO v_vendor
      FROM public.zoho_purchase_orders WHERE id = v_po AND organization_id = v_org;
    IF NOT FOUND THEN RETURN jsonb_build_object('outcome', 'unavailable'); END IF;

    INSERT INTO public.invoices (
        organization_id, po_id, intake_link_id, vendor_key, submission_reference, idempotency_key,
        submitted_via, submitted_by, invoice_number, invoice_number_norm, invoice_date
    ) VALUES (
        v_org, v_po, v_link.id, v_vendor, p_submission_ref, p_idempotency_key,
        v_via, p_user, NULLIF(BTRIM(p_invoice_number), ''),
        NULLIF(UPPER(REGEXP_REPLACE(COALESCE(p_invoice_number, ''), '[^A-Za-z0-9]', '', 'g')), ''),
        p_invoice_date
    ) RETURNING id INTO v_inv;

    INSERT INTO public.invoice_documents (
        organization_id, invoice_id, storage_path, original_filename, content_type,
        file_size_bytes, sha256_hash, source_channel, uploaded_by
    ) VALUES (v_org, v_inv, p_storage_path, p_filename, p_content_type, p_size, p_sha256, v_via, p_user);

    INSERT INTO public.invoice_audit_events (organization_id, invoice_id, link_id, po_id, actor_user_id, actor_type, event_type, details)
    VALUES (v_org, v_inv, v_link.id, v_po, p_user,
            CASE WHEN v_via = 'vendor_link' THEN 'vendor_link' ELSE 'user' END,
            'invoice_submitted',
            jsonb_build_object('channel', v_via, 'filename', p_filename, 'size_bytes', p_size, 'sha256', p_sha256));

    IF v_link.id IS NOT NULL THEN
        UPDATE public.invoice_intake_links
           SET status = 'used', submission_count = 1, used_at = NOW() WHERE id = v_link.id;
    END IF;

    RETURN jsonb_build_object('outcome', 'created', 'invoice_id', v_inv,
                              'organization_id', v_org, 'po_id', v_po,
                              'submission_reference', p_submission_ref);
END $$;

-- ---------------------------------------------------------------------------
-- Fast-track decision, atomic: the decision row, the request's new status and
-- the audit event commit together or not at all. The API has already checked
-- the approver's ROLE and LIMIT; the rules that must hold under a race live
-- here: right state, not the requester, amount within what was asked.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.invoice_fast_track_decide(
    p_org            UUID,
    p_request        UUID,
    p_approver       UUID,
    p_decision       TEXT,
    p_amount         NUMERIC,
    p_reason         TEXT,
    p_policy_version INTEGER
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_req public.invoice_fast_track_requests%ROWTYPE;
    v_status TEXT;
BEGIN
    IF p_decision NOT IN ('approved','rejected','needs_information') THEN
        RETURN jsonb_build_object('outcome', 'invalid_decision');
    END IF;
    IF p_reason IS NULL OR LENGTH(BTRIM(p_reason)) < 3 THEN
        RETURN jsonb_build_object('outcome', 'reason_required');
    END IF;

    SELECT * INTO v_req FROM public.invoice_fast_track_requests
     WHERE id = p_request AND organization_id = p_org FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('outcome', 'not_found'); END IF;
    IF v_req.status <> 'pending_approval' THEN RETURN jsonb_build_object('outcome', 'invalid_state', 'status', v_req.status); END IF;
    IF v_req.requested_by = p_approver THEN RETURN jsonb_build_object('outcome', 'self_approval'); END IF;

    IF p_decision = 'approved' THEN
        IF p_amount IS NULL OR p_amount <= 0 OR p_amount > v_req.requested_amount THEN
            RETURN jsonb_build_object('outcome', 'invalid_amount');
        END IF;
    END IF;

    v_status := CASE p_decision WHEN 'approved' THEN 'approved' ELSE p_decision END;

    INSERT INTO public.invoice_fast_track_decisions (organization_id, request_id, decision, approver_id, approved_amount, reason, policy_version)
    VALUES (p_org, p_request, p_decision, p_approver,
            CASE WHEN p_decision = 'approved' THEN p_amount END, BTRIM(p_reason), p_policy_version);

    UPDATE public.invoice_fast_track_requests
       SET status = v_status,
           approved_amount = CASE WHEN p_decision = 'approved' THEN p_amount ELSE approved_amount END,
           updated_at = NOW()
     WHERE id = p_request;

    INSERT INTO public.invoice_audit_events (organization_id, request_id, po_id, actor_user_id, actor_type, event_type, details)
    VALUES (p_org, p_request, v_req.po_id, p_approver, 'user', 'fast_track_' || p_decision,
            jsonb_build_object('approved_amount', p_amount, 'reason', BTRIM(p_reason), 'policy_version', p_policy_version));

    RETURN jsonb_build_object('outcome', 'ok', 'status', v_status);
END $$;

-- The service role is the only caller. Never expose these to the browser.
REVOKE ALL ON FUNCTION public.invoice_register_submission(TEXT,UUID,UUID,UUID,TEXT,TEXT,TEXT,BIGINT,TEXT,TEXT,DATE,TEXT,TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.invoice_fast_track_decide(UUID,UUID,UUID,TEXT,NUMERIC,TEXT,INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.invoice_register_submission(TEXT,UUID,UUID,UUID,TEXT,TEXT,TEXT,BIGINT,TEXT,TEXT,DATE,TEXT,TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.invoice_fast_track_decide(UUID,UUID,UUID,TEXT,NUMERIC,TEXT,INTEGER) TO service_role;
