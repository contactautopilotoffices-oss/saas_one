-- Migration: 20260915000001_asset_management.sql
-- Description: Asset tagging & lifecycle module — asset register, configurable
--              categories, lifecycle events (ticket work, PPM, AMC, cost),
--              QR tokens, org-scoped RLS reads. Writes go through the API
--              (service role), following the AOP convention.
--
-- Integration points:
--   · tickets            → asset_events.ticket_id (the MST "what was fixed" note)
--   · ppm_schedules      → new nullable ppm_schedules.asset_id
--   · amc_contracts      → assets.amc_contract_id
--   · procurement_budgets→ asset cost events call decrement_procurement_budget(…,'rnm',…)
--                          from the API; the event row is the ledger either way.

-- 1. Configurable categories (organization_id NULL = global default row)
CREATE TABLE IF NOT EXISTS public.asset_categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    code TEXT NOT NULL,
    color TEXT DEFAULT '#708F96',
    default_lifecycle_years INT DEFAULT 5 CHECK (default_lifecycle_years > 0),
    amc_required_by_default BOOLEAN DEFAULT FALSE,
    sort_order INT DEFAULT 100,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- One code per org; global rows (NULL org) are unique among themselves.
CREATE UNIQUE INDEX IF NOT EXISTS uq_asset_categories_org_code
    ON public.asset_categories (COALESCE(organization_id, '00000000-0000-0000-0000-000000000000'::uuid), UPPER(code));
CREATE INDEX IF NOT EXISTS idx_asset_categories_org ON public.asset_categories(organization_id);

INSERT INTO public.asset_categories (organization_id, name, code, color, default_lifecycle_years, amc_required_by_default, sort_order)
VALUES
    (NULL, 'HVAC',              'HVAC', '#0EA5E9', 10, TRUE,  10),
    (NULL, 'Electrical',        'ELEC', '#F59E0B', 15, FALSE, 20),
    (NULL, 'DG & Power Backup', 'PWR',  '#EF4444', 15, TRUE,  30),
    (NULL, 'Fire & Safety',     'FIRE', '#DC2626', 10, TRUE,  40),
    (NULL, 'Lifts & Elevators', 'LIFT', '#7C3AED', 20, TRUE,  50),
    (NULL, 'Plumbing & Water',  'PLMB', '#2563EB', 15, FALSE, 60),
    (NULL, 'IT & Network',      'IT',   '#10B981', 4,  FALSE, 70),
    (NULL, 'Security & CCTV',   'SEC',  '#6366F1', 6,  TRUE,  80),
    (NULL, 'Furniture & Fixtures','FURN','#A16207', 8,  FALSE, 90),
    (NULL, 'Kitchen & Pantry',  'KTCH', '#EA580C', 7,  FALSE, 100),
    (NULL, 'Other',             'OTHR', '#64748B', 5,  FALSE, 999)
ON CONFLICT DO NOTHING;

-- 2. Assets
CREATE TABLE IF NOT EXISTS public.assets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
    category_id UUID REFERENCES public.asset_categories(id) ON DELETE SET NULL,
    asset_code TEXT NOT NULL,
    -- Opaque token printed inside the QR. Not the row id: a QR must stay valid
    -- if we ever re-key, and must not leak sequential ids.
    qr_token TEXT NOT NULL DEFAULT substr(md5(gen_random_uuid()::text || clock_timestamp()::text), 1, 20),
    name TEXT NOT NULL,
    asset_type TEXT,
    make TEXT,
    model TEXT,
    serial_number TEXT,
    floor TEXT,
    location TEXT,
    installation_date DATE,
    purchase_cost NUMERIC(14,2),
    vendor_name TEXT,
    lifecycle_years INT CHECK (lifecycle_years IS NULL OR lifecycle_years > 0),
    warranty_start DATE,
    warranty_end DATE,
    amc_required BOOLEAN DEFAULT FALSE,
    amc_contract_id UUID REFERENCES public.amc_contracts(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'under_repair', 'inactive', 'decommissioned', 'disposed')),
    notes TEXT,
    custom_fields JSONB DEFAULT '{}'::jsonb,
    created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    deleted_at TIMESTAMPTZ,
    CONSTRAINT assets_org_code_unique UNIQUE (organization_id, asset_code)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_assets_qr_token ON public.assets(qr_token);
CREATE INDEX IF NOT EXISTS idx_assets_org ON public.assets(organization_id);
CREATE INDEX IF NOT EXISTS idx_assets_property ON public.assets(property_id);
CREATE INDEX IF NOT EXISTS idx_assets_category ON public.assets(category_id);
CREATE INDEX IF NOT EXISTS idx_assets_floor ON public.assets(property_id, floor);
CREATE INDEX IF NOT EXISTS idx_assets_amc ON public.assets(amc_contract_id);
CREATE INDEX IF NOT EXISTS idx_assets_warranty_end ON public.assets(warranty_end);
CREATE INDEX IF NOT EXISTS idx_assets_serial ON public.assets(organization_id, serial_number);

-- 3. Asset code sequence: <PROPCODE>-<CATCODE>-<00001>, one counter per org+property+category
CREATE TABLE IF NOT EXISTS public.asset_code_sequences (
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
    category_code TEXT NOT NULL,
    last_val INT DEFAULT 0,
    PRIMARY KEY (organization_id, property_id, category_code)
);

CREATE OR REPLACE FUNCTION public.generate_asset_code(
    p_org_id UUID,
    p_property_id UUID,
    p_category_code TEXT DEFAULT 'GEN'
)
RETURNS TEXT AS $$
DECLARE
    v_prop_code TEXT;
    v_cat TEXT := UPPER(COALESCE(NULLIF(p_category_code, ''), 'GEN'));
    v_next INT;
BEGIN
    SELECT COALESCE(UPPER(SUBSTRING(code FROM 1 FOR 4)), UPPER(SUBSTRING(name FROM 1 FOR 3)))
    INTO v_prop_code
    FROM public.properties WHERE id = p_property_id;

    IF v_prop_code IS NULL OR v_prop_code = '' THEN
        v_prop_code := 'PRP';
    END IF;

    INSERT INTO public.asset_code_sequences (organization_id, property_id, category_code, last_val)
    VALUES (p_org_id, p_property_id, v_cat, 1)
    ON CONFLICT (organization_id, property_id, category_code) DO UPDATE
    SET last_val = asset_code_sequences.last_val + 1
    RETURNING last_val INTO v_next;

    RETURN v_prop_code || '-' || v_cat || '-' || LPAD(v_next::text, 5, '0');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 4. Lifecycle events — the single ledger every screen reads
CREATE TABLE IF NOT EXISTS public.asset_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    asset_id UUID NOT NULL REFERENCES public.assets(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL CHECK (event_type IN (
        'created', 'imported', 'updated', 'ticket_work', 'ppm', 'amc', 'warranty',
        'cost', 'status_change', 'note', 'scan'
    )),
    title TEXT NOT NULL,
    description TEXT,
    ticket_id UUID REFERENCES public.tickets(id) ON DELETE SET NULL,
    ppm_schedule_id UUID,
    amc_contract_id UUID REFERENCES public.amc_contracts(id) ON DELETE SET NULL,
    -- Cost incurred on the asset (INR). cost_head 'rnm' rolls into the R&M
    -- procurement budget via decrement_procurement_budget from the API.
    amount NUMERIC(14,2),
    cost_head TEXT CHECK (cost_head IS NULL OR cost_head IN ('rnm', 'capex', 'general')),
    budget_synced BOOLEAN DEFAULT FALSE,
    budget_sync_error TEXT,
    photo_urls TEXT[] DEFAULT '{}',
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_asset_events_asset ON public.asset_events(asset_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_asset_events_ticket ON public.asset_events(ticket_id);
CREATE INDEX IF NOT EXISTS idx_asset_events_org_time ON public.asset_events(organization_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_asset_events_cost ON public.asset_events(organization_id, occurred_at)
    WHERE amount IS NOT NULL;

-- 5. PPM link. ON DELETE SET NULL because the PPM Excel re-import deletes and
--    re-creates every schedule row for a property.
ALTER TABLE public.ppm_schedules ADD COLUMN IF NOT EXISTS asset_id UUID REFERENCES public.assets(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_ppm_schedules_asset ON public.ppm_schedules(asset_id);

-- 6. updated_at maintenance
CREATE OR REPLACE FUNCTION public.fn_assets_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_assets_touch ON public.assets;
CREATE TRIGGER trg_assets_touch BEFORE UPDATE ON public.assets
    FOR EACH ROW EXECUTE FUNCTION public.fn_assets_touch_updated_at();
DROP TRIGGER IF EXISTS trg_asset_categories_touch ON public.asset_categories;
CREATE TRIGGER trg_asset_categories_touch BEFORE UPDATE ON public.asset_categories
    FOR EACH ROW EXECUTE FUNCTION public.fn_assets_touch_updated_at();

-- 7. Access: any active, non-tenant member of the org (org-level or property-level)
--    or a master admin. Tenants, super tenants and vendors are excluded by design.
CREATE OR REPLACE FUNCTION public.has_asset_access(target_org UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.is_master_admin = TRUE
    )
    OR EXISTS (
        SELECT 1 FROM public.organization_memberships om
        WHERE om.user_id = auth.uid() AND om.organization_id = target_org
          AND om.is_active = TRUE
          AND om.role::text NOT IN ('tenant', 'super_tenant', 'vendor')
    )
    OR EXISTS (
        SELECT 1 FROM public.property_memberships pm
        WHERE pm.user_id = auth.uid() AND pm.organization_id = target_org
          AND pm.is_active = TRUE
          AND pm.role::text NOT IN ('tenant', 'super_tenant', 'vendor')
    );
$$;

ALTER TABLE public.assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.asset_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.asset_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.asset_code_sequences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "asset access reads assets" ON public.assets;
CREATE POLICY "asset access reads assets" ON public.assets
    FOR SELECT USING (public.has_asset_access(organization_id));

DROP POLICY IF EXISTS "asset access reads events" ON public.asset_events;
CREATE POLICY "asset access reads events" ON public.asset_events
    FOR SELECT USING (public.has_asset_access(organization_id));

DROP POLICY IF EXISTS "asset access reads categories" ON public.asset_categories;
CREATE POLICY "asset access reads categories" ON public.asset_categories
    FOR SELECT USING (organization_id IS NULL OR public.has_asset_access(organization_id));

-- No INSERT/UPDATE/DELETE policies on purpose: every write goes through the API
-- with the service role, where property scope and role are checked explicitly.

COMMENT ON TABLE public.assets IS 'Asset register. One row per tagged physical asset; qr_token is what the printed QR encodes (/a/<token>).';
COMMENT ON TABLE public.asset_events IS 'Asset lifecycle ledger: ticket work notes, PPM, AMC/warranty changes, costs, status changes.';
COMMENT ON COLUMN public.asset_events.cost_head IS 'rnm = Repair & Maintenance budget (procurement_budgets.budget_type = rnm).';

NOTIFY pgrst, 'reload schema';
