-- =================================================================================
-- PROCUREMENT MODULE ENHANCEMENT (V3)
-- Description: Budgets, Thresholds, Individual Approvers, and Catalog Integration
-- =================================================================================

-- 1. PROCUREMENT SETTINGS (Thresholds & Individual Approvers per Property)
CREATE TABLE IF NOT EXISTS procurement_settings (
    property_id         uuid PRIMARY KEY REFERENCES properties(id) ON DELETE CASCADE,
    organization_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    threshold_amount    numeric NOT NULL DEFAULT 5000,
    low_approver_id     uuid REFERENCES users(id),  -- For requests < threshold
    high_approver_id    uuid REFERENCES users(id), -- For requests >= threshold
    created_at          timestamptz DEFAULT now(),
    updated_at          timestamptz DEFAULT now()
);

-- 2. PROCUREMENT BUDGETS (Per Property)
CREATE TABLE IF NOT EXISTS procurement_budgets (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    property_id         uuid NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
    organization_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    budget_type         text NOT NULL CHECK (budget_type IN ('rnm', 'general')),
    total_amount        numeric NOT NULL DEFAULT 0,
    spent_amount        numeric NOT NULL DEFAULT 0,
    period_start        date NOT NULL DEFAULT CURRENT_DATE,
    period_end          date,
    created_at          timestamptz DEFAULT now(),
    updated_at          timestamptz DEFAULT now(),
    UNIQUE(property_id, budget_type, period_start)
);

-- 3. PROCUREMENT CATALOG (Amazon-like items)
CREATE TABLE IF NOT EXISTS procurement_catalog (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name                text NOT NULL,
    description         text,
    photo_url           text,
    category            text,
    unit                text DEFAULT 'pcs',
    estimated_price     numeric DEFAULT 0,
    stock_item_id       uuid REFERENCES stock_items(id) ON DELETE SET NULL, -- Link to existing inventory
    is_active           boolean DEFAULT true,
    created_at          timestamptz DEFAULT now(),
    updated_at          timestamptz DEFAULT now()
);

-- 4. UPDATE MATERIAL REQUESTS
ALTER TABLE material_requests ADD COLUMN IF NOT EXISTS budget_type text CHECK (budget_type IN ('rnm', 'general'));
ALTER TABLE material_requests ADD COLUMN IF NOT EXISTS target_approver_id uuid REFERENCES users(id);
ALTER TABLE material_requests ADD COLUMN IF NOT EXISTS total_amount numeric DEFAULT 0;

-- 5. MATERIAL REQUEST LINE ITEMS
CREATE TABLE IF NOT EXISTS material_request_items (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id          uuid NOT NULL REFERENCES material_requests(id) ON DELETE CASCADE,
    organization_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    catalog_item_id     uuid REFERENCES procurement_catalog(id),
    name                text NOT NULL,
    quantity            numeric NOT NULL DEFAULT 1,
    unit_price          numeric NOT NULL DEFAULT 0,
    total_price         numeric NOT NULL DEFAULT 0,
    photo_url           text,
    created_at          timestamptz DEFAULT now()
);

-- 6. INDEXES
CREATE INDEX IF NOT EXISTS idx_proc_catalog_org ON procurement_catalog(organization_id);
CREATE INDEX IF NOT EXISTS idx_proc_budgets_prop ON procurement_budgets(property_id);
CREATE INDEX IF NOT EXISTS idx_proc_budgets_org ON procurement_budgets(organization_id);
CREATE INDEX IF NOT EXISTS idx_mr_items_request ON material_request_items(request_id);

-- 7. RLS POLICIES

-- procurement_settings
ALTER TABLE procurement_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS settings_select ON procurement_settings;
CREATE POLICY settings_select ON procurement_settings FOR SELECT USING (auth.role() = 'authenticated');
DROP POLICY IF EXISTS settings_all_admin ON procurement_settings;
CREATE POLICY settings_all_admin ON procurement_settings FOR ALL USING (
    EXISTS (SELECT 1 FROM organization_memberships WHERE user_id = auth.uid() AND organization_id = procurement_settings.organization_id AND role IN ('org_super_admin', 'master_admin'))
);

-- procurement_budgets
ALTER TABLE procurement_budgets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS budget_select ON procurement_budgets;
CREATE POLICY budget_select ON procurement_budgets FOR SELECT USING (auth.role() = 'authenticated');
DROP POLICY IF EXISTS budget_admin ON procurement_budgets;
CREATE POLICY budget_admin ON procurement_budgets FOR ALL USING (
    EXISTS (SELECT 1 FROM organization_memberships WHERE user_id = auth.uid() AND organization_id = procurement_budgets.organization_id AND role IN ('org_super_admin', 'master_admin'))
);

-- procurement_catalog
ALTER TABLE procurement_catalog ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS catalog_select ON procurement_catalog;
CREATE POLICY catalog_select ON procurement_catalog FOR SELECT USING (auth.role() = 'authenticated');
DROP POLICY IF EXISTS catalog_admin ON procurement_catalog;
CREATE POLICY catalog_admin ON procurement_catalog FOR ALL USING (
    EXISTS (SELECT 1 FROM organization_memberships WHERE user_id = auth.uid() AND organization_id = procurement_catalog.organization_id AND role IN ('org_super_admin', 'master_admin'))
);

-- material_request_items
ALTER TABLE material_request_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mr_items_select ON material_request_items;
CREATE POLICY mr_items_select ON material_request_items FOR SELECT USING (auth.role() = 'authenticated');
DROP POLICY IF EXISTS mr_items_insert ON material_request_items;
CREATE POLICY mr_items_insert ON material_request_items FOR INSERT WITH CHECK (auth.role() = 'authenticated');

-- 8. AUTO-ROUTING TRIGGER (Sets target_approver_id on insert)
CREATE OR REPLACE FUNCTION route_procurement_approval()
RETURNS TRIGGER AS $$
DECLARE
    v_threshold numeric;
    v_low_app uuid;
    v_high_app uuid;
BEGIN
    -- Get settings for the property
    SELECT threshold_amount, low_approver_id, high_approver_id 
    INTO v_threshold, v_low_app, v_high_app
    FROM procurement_settings
    WHERE property_id = NEW.property_id;

    -- Default threshold if not set
    IF v_threshold IS NULL THEN v_threshold := 5000; END IF;

    -- Route based on total_amount
    IF NEW.total_amount < v_threshold THEN
        NEW.target_approver_id := v_low_app;
    ELSE
        NEW.target_approver_id := v_high_app;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_route_procurement ON material_requests;
CREATE TRIGGER trg_route_procurement
    BEFORE INSERT ON material_requests
    FOR EACH ROW
    EXECUTE FUNCTION route_procurement_approval();

-- 10. STORAGE BUCKET FOR PROCUREMENT PHOTOS
INSERT INTO storage.buckets (id, name, public)
VALUES ('procurement-items', 'procurement-items', true)
ON CONFLICT (id) DO NOTHING;

-- Allow authenticated users to upload
DROP POLICY IF EXISTS "Allow authenticated uploads to procurement-items" ON storage.objects;
CREATE POLICY "Allow authenticated uploads to procurement-items" ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'procurement-items');

-- Allow public viewing
DROP POLICY IF EXISTS "Allow public viewing of procurement-items" ON storage.objects;
CREATE POLICY "Allow public viewing of procurement-items" ON storage.objects
FOR SELECT TO public
USING (bucket_id = 'procurement-items');

-- Refresh PostgREST
NOTIFY pgrst, 'reload schema';

