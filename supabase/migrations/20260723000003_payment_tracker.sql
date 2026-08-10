-- Payment Tracker — PO payment lifecycle for the Accounts team.
--
-- Flow: Zoho Books PO (synced or added manually) -> procurement ALIGNS a payment
-- (full or split tranche, with term/GST/TDS) -> Accounts marks it COMPLETED with
-- a UTR -> UTR emailed to the team.
--
-- The 3 dashboard toggles map to:
--   To Align   = POs with pending (un-aligned) amount   (PO-derived)
--   Aligned    = po_payments.status = 'aligned'         (with Accounts)
--   Completed  = po_payments.status = 'completed'       (paid + UTR)

-- ---------------------------------------------------------------------------
-- Purchase Orders (mirror of Zoho Books; also holds manual / CSV-imported POs)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.zoho_purchase_orders (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    po_number           TEXT NOT NULL,
    vendor_name         TEXT,
    vendor_id           TEXT,                       -- Zoho contact id (nullable)
    zoho_po_id          TEXT,                       -- Zoho purchaseorder_id (nullable)
    po_amount           NUMERIC(14,2) NOT NULL DEFAULT 0,
    status              TEXT,                       -- raw PO status (approved / open / billed / …)
    department          TEXT,                       -- Capex / Opex
    project_name        TEXT,                       -- site / project
    property_id         UUID REFERENCES properties(id) ON DELETE SET NULL,
    category            TEXT,
    currency            TEXT NOT NULL DEFAULT 'INR',
    po_date             DATE,
    delivery_date       DATE,
    source              TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','zoho','csv')),
    raw                 JSONB,
    synced_at           TIMESTAMPTZ,
    created_by          UUID REFERENCES users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (organization_id, po_number)
);
CREATE INDEX IF NOT EXISTS idx_zpo_org        ON public.zoho_purchase_orders (organization_id, status);
CREATE INDEX IF NOT EXISTS idx_zpo_vendor     ON public.zoho_purchase_orders (organization_id, vendor_name);
CREATE INDEX IF NOT EXISTS idx_zpo_zoho_id    ON public.zoho_purchase_orders (organization_id, zoho_po_id);

-- ---------------------------------------------------------------------------
-- Payments against a PO (one row per tranche; split = multiple rows)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.po_payments (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    po_id               UUID NOT NULL REFERENCES public.zoho_purchase_orders(id) ON DELETE CASCADE,
    po_number           TEXT,                       -- denormalised for quick display
    vendor_name         TEXT,
    tranche_no          INTEGER NOT NULL DEFAULT 1,
    requested_amount    NUMERIC(14,2) NOT NULL CHECK (requested_amount > 0),
    gst_hold            NUMERIC(14,2) NOT NULL DEFAULT 0,
    tds                 NUMERIC(14,2) NOT NULL DEFAULT 0,
    payment_term        TEXT,                       -- e.g. "50% Advance", "Balance + GST"
    status              TEXT NOT NULL DEFAULT 'aligned'
                        CHECK (status IN ('to_align','aligned','completed','cancelled')),

    aligned_by          UUID REFERENCES users(id),
    aligned_at          TIMESTAMPTZ,

    completed_by        UUID REFERENCES users(id),
    completed_at        TIMESTAMPTZ,
    payment_date        DATE,
    paid_amount         NUMERIC(14,2),
    utr_no              TEXT,
    payment_proof_url   TEXT,

    remarks             TEXT,
    created_by          UUID REFERENCES users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pop_org      ON public.po_payments (organization_id, status);
CREATE INDEX IF NOT EXISTS idx_pop_po       ON public.po_payments (po_id);

-- ---------------------------------------------------------------------------
-- Per-org Zoho Books config (only the org id is per-tenant; OAuth creds are env)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.accounts_zoho_config (
    organization_id     UUID PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
    zoho_organization_id TEXT,
    is_active           BOOLEAN NOT NULL DEFAULT true,
    last_synced_at      TIMESTAMPTZ,
    last_sync_status    TEXT,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- RLS (writes via service-role API; SELECT policies so realtime reaches members)
-- ---------------------------------------------------------------------------
ALTER TABLE public.zoho_purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.po_payments          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accounts_zoho_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "acct members read pos" ON public.zoho_purchase_orders;
CREATE POLICY "acct members read pos" ON public.zoho_purchase_orders FOR SELECT USING (
    EXISTS (SELECT 1 FROM organization_memberships om
            WHERE om.user_id = auth.uid() AND om.organization_id = zoho_purchase_orders.organization_id AND om.is_active)
);

DROP POLICY IF EXISTS "acct members read payments" ON public.po_payments;
CREATE POLICY "acct members read payments" ON public.po_payments FOR SELECT USING (
    EXISTS (SELECT 1 FROM organization_memberships om
            WHERE om.user_id = auth.uid() AND om.organization_id = po_payments.organization_id AND om.is_active)
);

-- ---------------------------------------------------------------------------
-- Realtime for the live payment tracker
-- ---------------------------------------------------------------------------
ALTER TABLE public.po_payments          REPLICA IDENTITY FULL;
ALTER TABLE public.zoho_purchase_orders REPLICA IDENTITY FULL;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='po_payments') THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.po_payments;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='zoho_purchase_orders') THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.zoho_purchase_orders;
    END IF;
END $$;
