-- Petty Cash — request → approve → pay → settle → close (simple MVP).
-- Scoped by organization + property + requester. Finance = the `accounts` role.
--
-- Deferred to a later phase (kept out of this MVP): GST/ITC engine, float/cash-box
-- reconciliation, multi-tier (CFO) approval matrix, OCR.

-- Human-friendly request numbers: PC-YYYY-00001
CREATE SEQUENCE IF NOT EXISTS petty_cash_request_seq;

CREATE TABLE IF NOT EXISTS public.petty_cash_requests (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    property_id         UUID NOT NULL REFERENCES properties(id)    ON DELETE CASCADE,
    requester_id        UUID NOT NULL REFERENCES users(id),
    request_no          TEXT UNIQUE,

    -- Request details
    request_type        TEXT NOT NULL DEFAULT 'advance' CHECK (request_type IN ('advance', 'reimbursement')),
    department          TEXT,
    category            TEXT,
    amount_requested    NUMERIC(14,2) NOT NULL CHECK (amount_requested > 0),
    purpose             TEXT NOT NULL,
    payment_mode        TEXT,                       -- Cash / UPI / Bank Transfer / Company Card / Other
    expected_date       DATE,
    vendor_name         TEXT,

    -- Lifecycle
    status              TEXT NOT NULL DEFAULT 'submitted'
                        CHECK (status IN ('draft','submitted','approved','rejected','sent_back',
                                          'paid','settlement_submitted','closed','cancelled')),

    -- Approval
    approver_id         UUID REFERENCES users(id),
    approved_amount     NUMERIC(14,2),
    approved_at         TIMESTAMPTZ,
    approval_remarks    TEXT,

    -- Disbursement (finance)
    paid_by             UUID REFERENCES users(id),
    paid_amount         NUMERIC(14,2),
    paid_mode           TEXT,
    payment_ref         TEXT,                       -- UPI / bank / card reference
    paid_at             TIMESTAMPTZ,

    -- Settlement
    actual_spent        NUMERIC(14,2),
    amount_returned     NUMERIC(14,2),
    extra_claimed       NUMERIC(14,2),
    settlement_remarks  TEXT,
    settled_at          TIMESTAMPTZ,

    -- Closure
    closed_by           UUID REFERENCES users(id),
    closed_at           TIMESTAMPTZ,
    close_remarks       TEXT,

    remarks             TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pc_requests_org        ON public.petty_cash_requests (organization_id, status);
CREATE INDEX IF NOT EXISTS idx_pc_requests_property   ON public.petty_cash_requests (property_id, status);
CREATE INDEX IF NOT EXISTS idx_pc_requests_requester  ON public.petty_cash_requests (requester_id, created_at DESC);

-- Assign a readable request number on insert if not provided.
CREATE OR REPLACE FUNCTION public.set_petty_cash_request_no()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.request_no IS NULL THEN
        NEW.request_no := 'PC-' || to_char(NOW(), 'YYYY') || '-' ||
                          lpad(nextval('petty_cash_request_seq')::text, 5, '0');
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_pc_request_no ON public.petty_cash_requests;
CREATE TRIGGER trg_pc_request_no
    BEFORE INSERT ON public.petty_cash_requests
    FOR EACH ROW EXECUTE FUNCTION public.set_petty_cash_request_no();

-- Supporting documents (uploaded at request / settlement / payment-proof stages)
CREATE TABLE IF NOT EXISTS public.petty_cash_documents (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id      UUID NOT NULL REFERENCES public.petty_cash_requests(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    stage           TEXT NOT NULL DEFAULT 'request' CHECK (stage IN ('request','settlement','payment_proof')),
    file_url        TEXT NOT NULL,
    file_name       TEXT,
    file_type       TEXT,
    uploaded_by     UUID REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pc_docs_request ON public.petty_cash_documents (request_id);

-- Immutable audit trail of every status change / action
CREATE TABLE IF NOT EXISTS public.petty_cash_activity (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id      UUID NOT NULL REFERENCES public.petty_cash_requests(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    actor_id        UUID REFERENCES users(id),
    action          TEXT NOT NULL,
    from_status     TEXT,
    to_status       TEXT,
    remark          TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pc_activity_request ON public.petty_cash_activity (request_id, created_at);

-- RLS: writes happen via the service-role API; these SELECT policies exist so the
-- browser realtime subscription delivers to the people who should see a request
-- (its requester, and members of its org/property). Service role bypasses RLS.
ALTER TABLE public.petty_cash_requests  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.petty_cash_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.petty_cash_activity  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pc members read requests" ON public.petty_cash_requests;
CREATE POLICY "pc members read requests" ON public.petty_cash_requests FOR SELECT USING (
    requester_id = auth.uid()
    OR EXISTS (SELECT 1 FROM organization_memberships om
               WHERE om.user_id = auth.uid() AND om.organization_id = petty_cash_requests.organization_id AND om.is_active)
    OR EXISTS (SELECT 1 FROM property_memberships pm
               WHERE pm.user_id = auth.uid() AND pm.property_id = petty_cash_requests.property_id AND pm.is_active)
);

DROP POLICY IF EXISTS "pc members read documents" ON public.petty_cash_documents;
CREATE POLICY "pc members read documents" ON public.petty_cash_documents FOR SELECT USING (
    EXISTS (SELECT 1 FROM organization_memberships om
            WHERE om.user_id = auth.uid() AND om.organization_id = petty_cash_documents.organization_id AND om.is_active)
);

DROP POLICY IF EXISTS "pc members read activity" ON public.petty_cash_activity;
CREATE POLICY "pc members read activity" ON public.petty_cash_activity FOR SELECT USING (
    EXISTS (SELECT 1 FROM organization_memberships om
            WHERE om.user_id = auth.uid() AND om.organization_id = petty_cash_activity.organization_id AND om.is_active)
);

-- Realtime for live dashboard updates (mirror crm_leads enablement).
ALTER TABLE public.petty_cash_requests REPLICA IDENTITY FULL;
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='petty_cash_requests'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.petty_cash_requests;
    END IF;
END $$;
