-- Migration: 20261016000002_payment_tracker_approval_and_parallel_workflow.sql
-- Description: Supports the Payment Tracker parallel workflow, payment sheet batching,
-- approver settings, and pre-alignment lifecycle.

-- 1. Ensure po_payments status constraint supports 'pre_aligned'
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN (
        SELECT conname
        FROM pg_constraint
        WHERE conrelid = 'public.po_payments'::regclass
          AND contype = 'c'
          AND pg_get_constraintdef(oid) LIKE '%status%'
    ) LOOP
        EXECUTE 'ALTER TABLE public.po_payments DROP CONSTRAINT ' || quote_ident(r.conname);
    END LOOP;
END $$;

ALTER TABLE public.po_payments
    ADD CONSTRAINT po_payments_status_check
    CHECK (status IN ('to_align', 'pre_aligned', 'aligned', 'completed', 'cancelled'));

-- 2. Payment Tracker Settings (Per Organization)
CREATE TABLE IF NOT EXISTS public.payment_tracker_settings (
    organization_id     UUID PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
    approver_user_ids   UUID[] NOT NULL DEFAULT '{}',
    auto_pre_align      BOOLEAN NOT NULL DEFAULT true,
    notify_via_whatsapp BOOLEAN NOT NULL DEFAULT true,
    notify_via_email    BOOLEAN NOT NULL DEFAULT true,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by          UUID REFERENCES public.users(id) ON DELETE SET NULL
);

-- 3. Payment Sheets / Batches Table
CREATE TABLE IF NOT EXISTS public.payment_sheets (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id      UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    batch_number         TEXT NOT NULL,
    title                TEXT NOT NULL,
    department           TEXT, -- Capex, Opex, or Mixed
    status               TEXT NOT NULL DEFAULT 'submitted'
                         CHECK (status IN ('draft', 'submitted', 'partially_approved', 'approved', 'rejected', 'completed')),
    total_pos            INTEGER NOT NULL DEFAULT 0,
    total_po_amount      NUMERIC(14,2) NOT NULL DEFAULT 0,
    total_request_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
    total_gst_hold       NUMERIC(14,2) NOT NULL DEFAULT 0,
    total_tds            NUMERIC(14,2) NOT NULL DEFAULT 0,
    total_payable_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
    created_by           UUID REFERENCES public.users(id) ON DELETE SET NULL,
    submitted_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    approved_by          UUID REFERENCES public.users(id) ON DELETE SET NULL,
    approved_at          TIMESTAMPTZ,
    rejection_reason     TEXT,
    notes                TEXT,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 4. Payment Sheet Items Table (Line items in the sheet)
CREATE TABLE IF NOT EXISTS public.payment_sheet_items (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sheet_id             UUID NOT NULL REFERENCES public.payment_sheets(id) ON DELETE CASCADE,
    organization_id      UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    po_id                UUID REFERENCES public.zoho_purchase_orders(id) ON DELETE SET NULL,
    po_payment_id        UUID REFERENCES public.po_payments(id) ON DELETE SET NULL,
    department           TEXT,
    vendor_name          TEXT NOT NULL,
    category             TEXT,
    site_name            TEXT,
    property_id          UUID REFERENCES public.properties(id) ON DELETE SET NULL,
    po_number            TEXT NOT NULL,
    total_po_amount      NUMERIC(14,2) NOT NULL DEFAULT 0,
    request_amount       NUMERIC(14,2) NOT NULL DEFAULT 0,
    gst_hold             NUMERIC(14,2) NOT NULL DEFAULT 0,
    tds                  NUMERIC(14,2) NOT NULL DEFAULT 0,
    net_payable_amount   NUMERIC(14,2) NOT NULL DEFAULT 0,
    payment_date         DATE,
    payment_amount       NUMERIC(14,2),
    utr_no               TEXT,
    remarks              TEXT,
    approval_status      TEXT NOT NULL DEFAULT 'pending'
                         CHECK (approval_status IN ('pending', 'approved', 'rejected')),
    alignment_status     TEXT NOT NULL DEFAULT 'pre_aligned'
                         CHECK (alignment_status IN ('pending', 'pre_aligned', 'aligned', 'completed', 'cancelled')),
    rejection_reason     TEXT,
    reviewed_by          UUID REFERENCES public.users(id) ON DELETE SET NULL,
    reviewed_at          TIMESTAMPTZ,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 5. Extend po_payments with sheet and approval linkages
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'po_payments' AND column_name = 'sheet_id'
    ) THEN
        ALTER TABLE public.po_payments ADD COLUMN sheet_id UUID REFERENCES public.payment_sheets(id) ON DELETE SET NULL;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'po_payments' AND column_name = 'sheet_item_id'
    ) THEN
        ALTER TABLE public.po_payments ADD COLUMN sheet_item_id UUID REFERENCES public.payment_sheet_items(id) ON DELETE SET NULL;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'po_payments' AND column_name = 'approval_status'
    ) THEN
        ALTER TABLE public.po_payments ADD COLUMN approval_status TEXT NOT NULL DEFAULT 'pending'
            CHECK (approval_status IN ('draft', 'pending', 'approved', 'rejected'));
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'po_payments' AND column_name = 'approved_by'
    ) THEN
        ALTER TABLE public.po_payments ADD COLUMN approved_by UUID REFERENCES public.users(id) ON DELETE SET NULL;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'po_payments' AND column_name = 'approved_at'
    ) THEN
        ALTER TABLE public.po_payments ADD COLUMN approved_at TIMESTAMPTZ;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'po_payments' AND column_name = 'rejection_reason'
    ) THEN
        ALTER TABLE public.po_payments ADD COLUMN rejection_reason TEXT;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'po_payments' AND column_name = 'department'
    ) THEN
        ALTER TABLE public.po_payments ADD COLUMN department TEXT;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'po_payments' AND column_name = 'category'
    ) THEN
        ALTER TABLE public.po_payments ADD COLUMN category TEXT;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'po_payments' AND column_name = 'site_name'
    ) THEN
        ALTER TABLE public.po_payments ADD COLUMN site_name TEXT;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'po_payments' AND column_name = 'net_payable_amount'
    ) THEN
        ALTER TABLE public.po_payments ADD COLUMN net_payable_amount NUMERIC(14,2);
    END IF;
END $$;

-- 6. Indexes for Performance
CREATE INDEX IF NOT EXISTS idx_payment_sheets_org_status ON public.payment_sheets (organization_id, status);
CREATE INDEX IF NOT EXISTS idx_payment_sheets_created_at ON public.payment_sheets (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sheet_items_sheet ON public.payment_sheet_items (sheet_id);
CREATE INDEX IF NOT EXISTS idx_sheet_items_org ON public.payment_sheet_items (organization_id, approval_status);
CREATE INDEX IF NOT EXISTS idx_sheet_items_po_number ON public.payment_sheet_items (organization_id, po_number);
CREATE INDEX IF NOT EXISTS idx_pop_sheet_id ON public.po_payments (sheet_id);
CREATE INDEX IF NOT EXISTS idx_pop_approval_status ON public.po_payments (organization_id, approval_status);

-- 7. Row Level Security
ALTER TABLE public.payment_tracker_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_sheets           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_sheet_items      ENABLE ROW LEVEL SECURITY;

-- Read policies for org members
DROP POLICY IF EXISTS "org members read payment settings" ON public.payment_tracker_settings;
CREATE POLICY "org members read payment settings" ON public.payment_tracker_settings FOR SELECT USING (
    EXISTS (
        SELECT 1 FROM public.organization_memberships om
        WHERE om.user_id = auth.uid() AND om.organization_id = payment_tracker_settings.organization_id AND om.is_active
    )
);

DROP POLICY IF EXISTS "org members read payment sheets" ON public.payment_sheets;
CREATE POLICY "org members read payment sheets" ON public.payment_sheets FOR SELECT USING (
    EXISTS (
        SELECT 1 FROM public.organization_memberships om
        WHERE om.user_id = auth.uid() AND om.organization_id = payment_sheets.organization_id AND om.is_active
    )
);

DROP POLICY IF EXISTS "org members read payment sheet items" ON public.payment_sheet_items;
CREATE POLICY "org members read payment sheet items" ON public.payment_sheet_items FOR SELECT USING (
    EXISTS (
        SELECT 1 FROM public.organization_memberships om
        WHERE om.user_id = auth.uid() AND om.organization_id = payment_sheet_items.organization_id AND om.is_active
    )
);

-- Write policies (Authenticated users belonging to org)
DROP POLICY IF EXISTS "org members manage payment settings" ON public.payment_tracker_settings;
CREATE POLICY "org members manage payment settings" ON public.payment_tracker_settings FOR ALL USING (
    EXISTS (
        SELECT 1 FROM public.organization_memberships om
        WHERE om.user_id = auth.uid() AND om.organization_id = payment_tracker_settings.organization_id AND om.is_active
    )
);

DROP POLICY IF EXISTS "org members manage payment sheets" ON public.payment_sheets;
CREATE POLICY "org members manage payment sheets" ON public.payment_sheets FOR ALL USING (
    EXISTS (
        SELECT 1 FROM public.organization_memberships om
        WHERE om.user_id = auth.uid() AND om.organization_id = payment_sheets.organization_id AND om.is_active
    )
);

DROP POLICY IF EXISTS "org members manage payment sheet items" ON public.payment_sheet_items;
CREATE POLICY "org members manage payment sheet items" ON public.payment_sheet_items FOR ALL USING (
    EXISTS (
        SELECT 1 FROM public.organization_memberships om
        WHERE om.user_id = auth.uid() AND om.organization_id = payment_sheet_items.organization_id AND om.is_active
    )
);

-- 8. Enable Realtime Publications
ALTER TABLE public.payment_tracker_settings REPLICA IDENTITY FULL;
ALTER TABLE public.payment_sheets           REPLICA IDENTITY FULL;
ALTER TABLE public.payment_sheet_items      REPLICA IDENTITY FULL;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='payment_tracker_settings') THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.payment_tracker_settings;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='payment_sheets') THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.payment_sheets;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='payment_sheet_items') THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.payment_sheet_items;
    END IF;
END $$;
