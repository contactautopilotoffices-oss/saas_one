-- ============================================================
-- INTERNAL AUDIT SYSTEM MIGRATION
-- Supports the 35-point Master Audit Checklist
-- ============================================================

-- 1. MASTER AUDIT ITEMS (The Template)
CREATE TABLE IF NOT EXISTS audit_master_items (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    organization_id uuid NOT NULL,
    si_no int,
    category text NOT NULL, -- e.g., 'Fire Safety', 'Statutory', 'Canteen'
    requirement text NOT NULL, -- The "Data Required" column
    spoc_name text, -- Friendly name from Excel
    assigned_spoc_id uuid REFERENCES auth.users(id), -- Linked user ID
    period text, -- e.g., 'as on date', 'Apr-25 to Mar-26'
    is_required_by_default boolean DEFAULT true,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

-- 2. PROPERTY AUDIT SUBMISSIONS (The Actual Data)
-- This stores the documents and remarks for a specific property
CREATE TABLE IF NOT EXISTS property_audit_submissions (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    master_item_id uuid NOT NULL REFERENCES audit_master_items(id) ON DELETE CASCADE,
    property_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    status text DEFAULT 'missing' CHECK (status IN ('missing', 'pending_review', 'compliant', 'not_applicable')),
    remark text, -- The "Remarks" column from your sheet
    proof_url text, -- URL to the uploaded document (PDF/Photo)
    submitted_by uuid REFERENCES auth.users(id),
    submitted_at timestamptz,
    verified_by uuid REFERENCES auth.users(id),
    verified_at timestamptz,
    audit_period_year text DEFAULT '2025-26', -- For filtering yearly audits
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    
    -- Ensure one submission per master item per property per period
    UNIQUE(master_item_id, property_id, audit_period_year)
);

-- 3. ENABLE RLS
ALTER TABLE audit_master_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE property_audit_submissions ENABLE ROW LEVEL SECURITY;

-- 4. RLS POLICIES
-- Master items viewable by authenticated users
CREATE POLICY "authenticated_view_audit_master" ON audit_master_items
    FOR SELECT USING (auth.role() = 'authenticated');

-- Submissions viewable and manageable by authenticated users
CREATE POLICY "authenticated_view_audit_submissions" ON property_audit_submissions
    FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "authenticated_update_submissions" ON property_audit_submissions
    FOR UPDATE USING (auth.role() = 'authenticated');

CREATE POLICY "authenticated_insert_submissions" ON property_audit_submissions
    FOR INSERT WITH CHECK (auth.role() = 'authenticated');

-- 5. INDEXES
CREATE INDEX idx_audit_master_org ON audit_master_items(organization_id);
CREATE INDEX idx_audit_sub_property ON property_audit_submissions(property_id);
CREATE INDEX idx_audit_sub_master ON property_audit_submissions(master_item_id);
CREATE INDEX idx_audit_sub_status ON property_audit_submissions(status);

-- 6. INITIAL DATA SEEDING (Optional helper for common categories)
-- You can add common categories here, but the 35 points will be added via Excel upload.
