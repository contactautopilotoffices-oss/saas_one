-- Migration: Consolidate Procurement Schema and fix missing columns/tables
-- This ensures the PATCH API for material requests has all necessary fields and tables.

-- 1. Ensure columns exist in material_requests
ALTER TABLE material_requests ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES users(id);
ALTER TABLE material_requests ADD COLUMN IF NOT EXISTS approved_at timestamptz;
ALTER TABLE material_requests ADD COLUMN IF NOT EXISTS ordered_at timestamptz;
ALTER TABLE material_requests ADD COLUMN IF NOT EXISTS delivered_at timestamptz;
ALTER TABLE material_requests ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;
ALTER TABLE material_requests ADD COLUMN IF NOT EXISTS rejected_at timestamptz;
ALTER TABLE material_requests ADD COLUMN IF NOT EXISTS cancellation_reason text;
ALTER TABLE material_requests ADD COLUMN IF NOT EXISTS rejection_reason text;

-- 2. Create procurement_orders table if not exists
CREATE TABLE IF NOT EXISTS procurement_orders (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    material_request_id uuid NOT NULL REFERENCES material_requests(id) ON DELETE CASCADE,
    property_id         uuid NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
    organization_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    ordered_by          uuid NOT NULL REFERENCES users(id),
    vendor_name         text,
    vendor_contact      text,
    items               jsonb NOT NULL DEFAULT '[]'::jsonb,
    total_amount        numeric DEFAULT 0,
    invoice_number      text,
    invoice_url         text,
    payment_status      text DEFAULT 'unpaid',
    delivery_status     text DEFAULT 'pending',
    expected_delivery   date,
    actual_delivery     date,
    notes               text,
    created_at          timestamptz DEFAULT now(),
    updated_at          timestamptz DEFAULT now()
);

-- 3. Create procurement_activity_log table if not exists
CREATE TABLE IF NOT EXISTS procurement_activity_log (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    material_request_id uuid REFERENCES material_requests(id) ON DELETE CASCADE,
    procurement_order_id uuid REFERENCES procurement_orders(id) ON DELETE CASCADE,
    user_id             uuid REFERENCES users(id) ON DELETE SET NULL,
    action              text NOT NULL,
    old_value           text,
    new_value           text,
    metadata            jsonb DEFAULT '{}'::jsonb,
    created_at          timestamptz DEFAULT now()
);

-- 4. RLS for new tables
ALTER TABLE procurement_orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated users can select orders" ON procurement_orders;
CREATE POLICY "Authenticated users can select orders" ON procurement_orders FOR SELECT USING (auth.role() = 'authenticated');
DROP POLICY IF EXISTS "Admins can manage orders" ON procurement_orders;
CREATE POLICY "Admins can manage orders" ON procurement_orders FOR ALL USING (
    EXISTS (SELECT 1 FROM organization_memberships WHERE user_id = auth.uid() AND role IN ('org_super_admin', 'master_admin', 'procurement'))
);

ALTER TABLE procurement_activity_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated users can select logs" ON procurement_activity_log;
CREATE POLICY "Authenticated users can select logs" ON procurement_activity_log FOR SELECT USING (auth.role() = 'authenticated');
DROP POLICY IF EXISTS "System can insert logs" ON procurement_activity_log;
CREATE POLICY "System can insert logs" ON procurement_activity_log FOR INSERT WITH CHECK (auth.role() = 'authenticated');

NOTIFY pgrst, 'reload schema';
