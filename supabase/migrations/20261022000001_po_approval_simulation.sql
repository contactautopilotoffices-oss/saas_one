-- ============================================================================
-- PO APPROVAL SIMULATION + APPROVED-PO WHATSAPP
-- ----------------------------------------------------------------------------
-- WHY
--   The MVP runs on five real POs that cannot be approved in Zoho yet. A super admin
--   can SIMULATE the approval inside this app: it is recorded here, shown as
--   SIMULATED everywhere, and treated as approved by Invoice Control and the payment
--   plan. Zoho is never written to, and a real approval from Zoho simply supersedes it.
--   Simulating also sends the approved-PO WhatsApp (template
--   po_approved_vendor_notification) with the PO PDF and starts the 48-hour invoice clock.
--
-- SAFETY
--   The WhatsApp goes ONLY to a test number a super admin sets in po_notify_settings.
--   Nothing here ever sends to a vendor's own number.
--
-- ACCESS: RLS on, no policies; reads and writes go through API routes on the service role.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.po_simulated_approvals (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id  UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    po_id            UUID NOT NULL REFERENCES public.zoho_purchase_orders(id) ON DELETE CASCADE,
    simulated_by     UUID REFERENCES public.users(id) ON DELETE SET NULL,
    simulated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- The vendor is asked to have the invoice ready within 48 hours of approval.
    invoice_due_at   TIMESTAMPTZ NOT NULL,
    UNIQUE (po_id)
);
CREATE INDEX IF NOT EXISTS idx_po_sim_approvals_org ON public.po_simulated_approvals (organization_id);

-- One row per WhatsApp attempt, so a failure is visible and a resend is a new row.
CREATE TABLE IF NOT EXISTS public.po_vendor_notifications (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id  UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    po_id            UUID NOT NULL REFERENCES public.zoho_purchase_orders(id) ON DELETE CASCADE,
    template         TEXT NOT NULL,
    status           TEXT NOT NULL CHECK (status IN ('sent','failed')),
    -- Never the full number: the last four digits are enough to tell which phone it was.
    sent_to_last4    TEXT,
    params           JSONB NOT NULL DEFAULT '[]'::jsonb,
    media_path       TEXT,
    provider_ref     TEXT,
    error            TEXT,
    sent_by          UUID REFERENCES public.users(id) ON DELETE SET NULL,
    sent_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_po_vendor_notifications_po ON public.po_vendor_notifications (po_id, sent_at DESC);

CREATE TABLE IF NOT EXISTS public.po_notify_settings (
    organization_id  UUID PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
    -- Digits only, with country code (e.g. 919812345678).
    test_phone       TEXT CHECK (test_phone IS NULL OR test_phone ~ '^[0-9]{11,15}$'),
    updated_by       UUID REFERENCES public.users(id) ON DELETE SET NULL,
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.po_simulated_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.po_vendor_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.po_notify_settings ENABLE ROW LEVEL SECURITY;
