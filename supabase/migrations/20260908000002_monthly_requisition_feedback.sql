-- Create monthly_requisition_feedback table for Property Admin feedback collection & Procurement tracking
CREATE TABLE IF NOT EXISTS public.monthly_requisition_feedback (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
    month INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
    year INTEGER NOT NULL CHECK (year >= 2020),
    submitted_by UUID NOT NULL REFERENCES public.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Category 1: Housekeeping, Beverages & Tissue
    hk_received_as_approved TEXT NOT NULL CHECK (hk_received_as_approved IN ('Yes', 'No')),
    hk_material_quality TEXT NOT NULL CHECK (hk_material_quality IN ('High', 'Medium', 'Low')),
    
    -- Category 2: Manpower
    manpower_quality_satisfaction TEXT NOT NULL CHECK (manpower_quality_satisfaction IN ('Good', 'Average', 'Poor')),
    manpower_reliever_on_time TEXT NOT NULL CHECK (manpower_reliever_on_time IN ('Yes', 'No')),
    
    -- Category 3: AMC (Annual Maintenance Contract)
    amc_service_report_on_time TEXT NOT NULL CHECK (amc_service_report_on_time IN ('Yes', 'No')),
    amc_services_on_schedule TEXT NOT NULL CHECK (amc_services_on_schedule IN ('Yes', 'No')),
    
    -- Status & Audit
    has_negative_issues BOOLEAN NOT NULL DEFAULT FALSE,
    remarks TEXT,
    
    CONSTRAINT unique_monthly_property_feedback UNIQUE (property_id, month, year)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_mrf_prop_month_year ON public.monthly_requisition_feedback (property_id, year DESC, month DESC);
CREATE INDEX IF NOT EXISTS idx_mrf_org_created ON public.monthly_requisition_feedback (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mrf_negative_flag ON public.monthly_requisition_feedback (has_negative_issues) WHERE has_negative_issues = TRUE;

-- Enable RLS
ALTER TABLE public.monthly_requisition_feedback ENABLE ROW LEVEL SECURITY;

-- Drop previous restricted policies if present
DROP POLICY IF EXISTS "View monthly requisition feedback" ON public.monthly_requisition_feedback;
DROP POLICY IF EXISTS "Insert monthly requisition feedback" ON public.monthly_requisition_feedback;
DROP POLICY IF EXISTS "Update monthly requisition feedback" ON public.monthly_requisition_feedback;
DROP POLICY IF EXISTS "Allow authenticated all on monthly_requisition_feedback" ON public.monthly_requisition_feedback;

-- Permissive RLS policy: Allow authenticated users full access to view, create, update, and manage feedback
CREATE POLICY "Allow authenticated all on monthly_requisition_feedback"
    ON public.monthly_requisition_feedback
    FOR ALL
    TO authenticated
    USING (true)
    WITH CHECK (true);
