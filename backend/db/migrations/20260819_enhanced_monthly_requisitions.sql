-- =================================================================================
-- ENHANCED MONTHLY REQUISITION & DUAL-TABLE WORKFLOW MIGRATION
-- Safe & Idempotent SQL Migration
-- =================================================================================

-- 1. ENHANCE procurement_catalog WITH BRAND AND COLOR/SIZE DETAILS
ALTER TABLE procurement_catalog ADD COLUMN IF NOT EXISTS brand text;
ALTER TABLE procurement_catalog ADD COLUMN IF NOT EXISTS color_size_details text;
ALTER TABLE procurement_catalog ADD COLUMN IF NOT EXISTS unit_price numeric DEFAULT 0;

-- 2. ENHANCE property_monthly_requisitions
CREATE TABLE IF NOT EXISTS property_monthly_requisitions (
    id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id       uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    property_id           uuid NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
    requisition_month     integer NOT NULL CHECK (requisition_month BETWEEN 1 AND 12),
    requisition_year      integer NOT NULL,
    status                text NOT NULL DEFAULT 'draft',
    total_estimated_amount numeric DEFAULT 0,
    total_final_amount    numeric DEFAULT 0,
    file_url              text,
    file_name             text,
    file_size_bytes       bigint,
    notes                 text,
    uploaded_by           uuid REFERENCES users(id),
    submitted_by          uuid REFERENCES users(id),
    submitted_at          timestamptz,
    assigned_procurement_user_id uuid REFERENCES users(id),
    vendor_name           text,
    vendor_quotation_url  text,
    vendor_quotation_file_name text,
    vendor_notes          text,
    target_approver_id    uuid REFERENCES users(id),
    approval_requested_at timestamptz,
    approved_by           uuid REFERENCES users(id),
    approved_at           timestamptz,
    rejected_by           uuid REFERENCES users(id),
    rejected_at           timestamptz,
    rejection_reason      text,
    acknowledged_by       uuid REFERENCES users(id),
    acknowledged_at       timestamptz,
    created_at            timestamptz DEFAULT now(),
    updated_at            timestamptz DEFAULT now(),
    UNIQUE(property_id, requisition_month, requisition_year)
);

-- Ensure all columns exist if table was already created
ALTER TABLE property_monthly_requisitions ADD COLUMN IF NOT EXISTS submitted_by uuid REFERENCES users(id);
ALTER TABLE property_monthly_requisitions ADD COLUMN IF NOT EXISTS submitted_at timestamptz;
ALTER TABLE property_monthly_requisitions ADD COLUMN IF NOT EXISTS assigned_procurement_user_id uuid REFERENCES users(id);
ALTER TABLE property_monthly_requisitions ADD COLUMN IF NOT EXISTS vendor_name text;
ALTER TABLE property_monthly_requisitions ADD COLUMN IF NOT EXISTS vendor_quotation_url text;
ALTER TABLE property_monthly_requisitions ADD COLUMN IF NOT EXISTS vendor_quotation_file_name text;
ALTER TABLE property_monthly_requisitions ADD COLUMN IF NOT EXISTS vendor_notes text;
ALTER TABLE property_monthly_requisitions ADD COLUMN IF NOT EXISTS target_approver_id uuid REFERENCES users(id);
ALTER TABLE property_monthly_requisitions ADD COLUMN IF NOT EXISTS approval_requested_at timestamptz;
ALTER TABLE property_monthly_requisitions ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES users(id);
ALTER TABLE property_monthly_requisitions ADD COLUMN IF NOT EXISTS approved_at timestamptz;
ALTER TABLE property_monthly_requisitions ADD COLUMN IF NOT EXISTS rejected_by uuid REFERENCES users(id);
ALTER TABLE property_monthly_requisitions ADD COLUMN IF NOT EXISTS rejected_at timestamptz;
ALTER TABLE property_monthly_requisitions ADD COLUMN IF NOT EXISTS rejection_reason text;
ALTER TABLE property_monthly_requisitions ADD COLUMN IF NOT EXISTS total_estimated_amount numeric DEFAULT 0;
ALTER TABLE property_monthly_requisitions ADD COLUMN IF NOT EXISTS total_final_amount numeric DEFAULT 0;

-- 3. REQUISITION LINE ITEMS TABLE
CREATE TABLE IF NOT EXISTS requisition_items (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    requisition_id      uuid NOT NULL REFERENCES property_monthly_requisitions(id) ON DELETE CASCADE,
    catalog_item_id     uuid REFERENCES procurement_catalog(id) ON DELETE SET NULL,
    category            text NOT NULL DEFAULT 'HK', -- 'HK', 'Beverages', 'Technical', 'General'
    item_name           text NOT NULL,
    brand               text,
    color_size_details  text,
    unit                text NOT NULL DEFAULT 'pcs',
    unit_price          numeric DEFAULT 0,
    requested_qty       numeric NOT NULL DEFAULT 0,
    available_stock_qty numeric NOT NULL DEFAULT 0,
    total_price         numeric DEFAULT 0,
    remarks             text,
    display_order       integer DEFAULT 0,
    created_at          timestamptz DEFAULT now(),
    updated_at          timestamptz DEFAULT now()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_req_items_requisition ON requisition_items(requisition_id);
CREATE INDEX IF NOT EXISTS idx_req_items_category ON requisition_items(category);
CREATE INDEX IF NOT EXISTS idx_monthly_req_property ON property_monthly_requisitions(property_id);
CREATE INDEX IF NOT EXISTS idx_monthly_req_status ON property_monthly_requisitions(status);
CREATE INDEX IF NOT EXISTS idx_monthly_req_period ON property_monthly_requisitions(requisition_year, requisition_month);

-- 4. RLS POLICIES FOR requisition_items
ALTER TABLE requisition_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS requisition_items_select ON requisition_items;
CREATE POLICY requisition_items_select ON requisition_items FOR SELECT USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS requisition_items_modify ON requisition_items;
CREATE POLICY requisition_items_modify ON requisition_items FOR ALL USING (auth.role() = 'authenticated');

-- 5. RLS POLICIES FOR property_monthly_requisitions
ALTER TABLE property_monthly_requisitions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS property_monthly_requisitions_select ON property_monthly_requisitions;
CREATE POLICY property_monthly_requisitions_select ON property_monthly_requisitions FOR SELECT USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS property_monthly_requisitions_modify ON property_monthly_requisitions;
CREATE POLICY property_monthly_requisitions_modify ON property_monthly_requisitions FOR ALL USING (auth.role() = 'authenticated');
