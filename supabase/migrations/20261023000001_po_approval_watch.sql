-- ============================================================================
-- PO APPROVAL WATCH — notice when the founder approves a PO in Zoho, and WhatsApp the
-- vendor the approved PO. Replaces the simulate button for real approvals.
-- ----------------------------------------------------------------------------
-- HOW IT WORKS
--   A 10-minute job (app/api/cron/po-approval-watch) asks Zoho which POs are waiting for
--   approval and records them here as "watching". When one turns approved, it is sent
--   the template once, and the 48-hour invoice clock starts.
--
-- WHY A WATCH LIST AND NOT "EVERY APPROVED PO"
--   3,455 POs are already approved. Messaging every approved PO would WhatsApp thousands
--   of vendors about old orders. Only a PO the job SAW waiting for approval (or one created
--   after the switch was turned on) is ever eligible.
--
-- THE SWITCH: po_notify_settings.auto_mode
--   off  (default) the job does nothing
--   test           sends to the test number only
--   live           sends to the vendor's own number
--   Turning it on records auto_since; POs created before then are eligible only if the job
--   saw them waiting.
--
-- ACCESS: RLS on, no policies; API routes and the cron use the service role.
-- ============================================================================

ALTER TABLE public.po_notify_settings
    ADD COLUMN IF NOT EXISTS auto_mode        TEXT NOT NULL DEFAULT 'off' CHECK (auto_mode IN ('off','test','live')),
    ADD COLUMN IF NOT EXISTS auto_since       TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS last_run_at      TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS last_run_summary JSONB;

CREATE TABLE IF NOT EXISTS public.po_approval_watch (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id       UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    -- Keyed on Zoho's id: a PO can be approved before our own 2-hourly sync has copied it.
    zoho_po_id            TEXT NOT NULL,
    po_number             TEXT,
    seen_pending_at       TIMESTAMPTZ,
    approved_detected_at  TIMESTAMPTZ,
    -- The vendor is asked for the invoice within 48 hours of approval.
    invoice_due_at        TIMESTAMPTZ,
    -- pending = waiting for approval | sending = a run has claimed it | notified | no_phone | failed | skipped (cancelled / rejected)
    state                 TEXT NOT NULL DEFAULT 'pending'
                          CHECK (state IN ('pending','sending','notified','no_phone','failed','skipped')),
    attempts              INTEGER NOT NULL DEFAULT 0,
    note                  TEXT,
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (organization_id, zoho_po_id)
);
CREATE INDEX IF NOT EXISTS idx_po_watch_state ON public.po_approval_watch (organization_id, state);

-- The notification log now also covers "no number to send to", and the PO may not be in our
-- own tables yet when its approval is noticed.
ALTER TABLE public.po_vendor_notifications DROP CONSTRAINT IF EXISTS po_vendor_notifications_status_check;
ALTER TABLE public.po_vendor_notifications
    ADD CONSTRAINT po_vendor_notifications_status_check CHECK (status IN ('sent','failed','no_phone')),
    ALTER COLUMN po_id DROP NOT NULL,
    ADD COLUMN IF NOT EXISTS zoho_po_id TEXT,
    ADD COLUMN IF NOT EXISTS trigger    TEXT NOT NULL DEFAULT 'manual' CHECK (trigger IN ('auto','manual','simulation')),
    ADD COLUMN IF NOT EXISTS mode       TEXT CHECK (mode IS NULL OR mode IN ('test','live'));
CREATE INDEX IF NOT EXISTS idx_po_vendor_notifications_zoho ON public.po_vendor_notifications (zoho_po_id, sent_at DESC);
-- One automatic send per PO, ever. A second run, an overlap or a retry cannot message the vendor twice.
CREATE UNIQUE INDEX IF NOT EXISTS uq_po_vendor_notifications_auto_sent
    ON public.po_vendor_notifications (zoho_po_id) WHERE status = 'sent' AND trigger = 'auto';

ALTER TABLE public.po_approval_watch ENABLE ROW LEVEL SECURITY;
