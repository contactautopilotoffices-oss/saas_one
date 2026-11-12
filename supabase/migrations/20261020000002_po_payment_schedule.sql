-- ============================================================================
-- PO PAYMENT SCHEDULE — the payment terms of a PO as milestones Purchase can see,
-- confirm, and click when each one falls due.
-- ----------------------------------------------------------------------------
-- WHY
--   Zoho's own "payment terms" field is wrong where it matters (a PO labelled
--   "100% Advance" can carry 30 / 20 / 20 / 30 in its terms text; 676 of the first
--   1,000 POs are just "Custom"). The real terms are free text. A parser proposes
--   the milestones, a person confirms them, and when the work reaches a stage
--   (25%, 90%, 100%, delivered) Purchase marks that milestone due and Accounts is
--   told. Where the PO says nothing, Purchase sets the schedule here.
--
-- WHAT IT DOES NOT DO
--   It never creates a payment. A due milestone is a signal to Accounts; the
--   tranche is still raised, aligned and paid in the existing Payment Tracker.
--
-- DELETING A PO: a PO that has progress history cannot be hard-deleted, because the
-- cascade would have to erase the append-only log and the trigger refuses. That is
-- deliberate. The Zoho sync upserts POs and never deletes them.
--
-- ACCESS: RLS on, no policies. All reads and writes go through API routes on the
-- service role, which check the caller's role. Same stance as the invoice tables.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.po_payment_schedules (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id  UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    po_id            UUID NOT NULL REFERENCES public.zoho_purchase_orders(id) ON DELETE CASCADE,
    -- draft = proposed or saved but not yet vouched for; confirmed = Purchase has confirmed it.
    status           TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','confirmed')),
    source           TEXT NOT NULL DEFAULT 'parsed' CHECK (source IN ('parsed','manual')),
    -- How sure the reader was when it proposed this: ok | check | none.
    parse_status     TEXT CHECK (parse_status IN ('ok','check','none')),
    warnings         JSONB NOT NULL DEFAULT '[]'::jsonb,
    notes            JSONB NOT NULL DEFAULT '[]'::jsonb,
    basic_value      NUMERIC(18,2),
    total_value      NUMERIC(18,2),
    confirmed_by     UUID REFERENCES public.users(id) ON DELETE SET NULL,
    confirmed_at     TIMESTAMPTZ,
    created_by       UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (po_id)
);
CREATE INDEX IF NOT EXISTS idx_po_schedules_org ON public.po_payment_schedules (organization_id, status);

CREATE TABLE IF NOT EXISTS public.po_payment_milestones (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id  UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    schedule_id      UUID NOT NULL REFERENCES public.po_payment_schedules(id) ON DELETE CASCADE,
    po_id            UUID NOT NULL REFERENCES public.zoho_purchase_orders(id) ON DELETE CASCADE,
    seq              INTEGER NOT NULL CHECK (seq > 0),
    label            TEXT NOT NULL,
    -- basic = before GST, gst = the tax part, total = share of the whole PO (terms silent on GST).
    basis            TEXT NOT NULL DEFAULT 'basic' CHECK (basis IN ('basic','gst','total')),
    percent          NUMERIC(7,3) NOT NULL CHECK (percent > 0 AND percent <= 100),
    amount           NUMERIC(18,2) NOT NULL CHECK (amount >= 0),
    trigger          TEXT NOT NULL DEFAULT 'other'
                     CHECK (trigger IN ('on_po','on_delivery','on_progress','on_completion','on_invoice','gst_on_portal','other')),
    -- For on_progress: the completion % that releases it (25, 50, 90...).
    progress_pct     INTEGER CHECK (progress_pct IS NULL OR (progress_pct > 0 AND progress_pct <= 100)),
    due_within_days  INTEGER CHECK (due_within_days IS NULL OR due_within_days >= 0),
    -- pending -> due (Purchase clicked it; Accounts was told) -> back to pending if reopened.
    state            TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','due')),
    due_marked_by    UUID REFERENCES public.users(id) ON DELETE SET NULL,
    due_marked_at    TIMESTAMPTZ,
    due_note         TEXT,
    -- True when Purchase marked it due BEFORE the trigger had been recorded as reached.
    due_early        BOOLEAN NOT NULL DEFAULT false,
    UNIQUE (schedule_id, seq)
);
CREATE INDEX IF NOT EXISTS idx_po_milestones_po ON public.po_payment_milestones (po_id, seq);
CREATE INDEX IF NOT EXISTS idx_po_milestones_due ON public.po_payment_milestones (organization_id, state) WHERE state = 'due';

-- What has actually happened on site: "25% done on 12 Oct", "material delivered 3 Oct".
-- Append-only: a correction is a new row.
CREATE TABLE IF NOT EXISTS public.po_progress_log (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id  UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    po_id            UUID NOT NULL REFERENCES public.zoho_purchase_orders(id) ON DELETE CASCADE,
    kind             TEXT NOT NULL DEFAULT 'progress' CHECK (kind IN ('progress','delivery')),
    progress_pct     INTEGER CHECK (progress_pct IS NULL OR (progress_pct >= 0 AND progress_pct <= 100)),
    recorded_on      DATE NOT NULL,
    note             TEXT,
    recorded_by      UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (kind = 'delivery' OR progress_pct IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_po_progress_po ON public.po_progress_log (po_id, recorded_on);

CREATE OR REPLACE FUNCTION public.po_progress_block_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'po_progress_log is append-only' USING ERRCODE = '42501';
END $$;

DROP TRIGGER IF EXISTS trg_po_progress_append_only ON public.po_progress_log;
CREATE TRIGGER trg_po_progress_append_only
    BEFORE UPDATE OR DELETE ON public.po_progress_log
    FOR EACH ROW EXECUTE FUNCTION public.po_progress_block_mutation();

ALTER TABLE public.po_payment_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.po_payment_milestones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.po_progress_log ENABLE ROW LEVEL SECURITY;
