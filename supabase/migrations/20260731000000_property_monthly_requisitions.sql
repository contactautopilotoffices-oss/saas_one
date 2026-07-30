-- Migration for Monthly Property Requisitions
CREATE TABLE IF NOT EXISTS public.property_monthly_requisitions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
    requisition_month INTEGER NOT NULL CHECK (requisition_month BETWEEN 1 AND 12),
    requisition_year INTEGER NOT NULL CHECK (requisition_year >= 2020),
    file_url TEXT NOT NULL,
    file_name TEXT NOT NULL,
    file_size_bytes BIGINT,
    notes TEXT,
    status VARCHAR(50) NOT NULL DEFAULT 'uploaded' CHECK (status IN ('uploaded', 'acknowledged')),
    uploaded_by UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    acknowledged_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    acknowledged_at TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT unique_property_month_year UNIQUE (property_id, requisition_month, requisition_year)
);

-- Indexing for fast lookups
CREATE INDEX IF NOT EXISTS idx_pmr_org_prop ON public.property_monthly_requisitions(organization_id, property_id);
CREATE INDEX IF NOT EXISTS idx_pmr_status ON public.property_monthly_requisitions(status);
CREATE INDEX IF NOT EXISTS idx_pmr_month_year ON public.property_monthly_requisitions(requisition_year, requisition_month);

-- RLS
ALTER TABLE public.property_monthly_requisitions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Enable read access for authenticated users"
    ON public.property_monthly_requisitions FOR SELECT
    USING (auth.role() = 'authenticated');

CREATE POLICY "Enable insert access for authenticated users"
    ON public.property_monthly_requisitions FOR INSERT
    WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Enable update access for authenticated users"
    ON public.property_monthly_requisitions FOR UPDATE
    USING (auth.role() = 'authenticated');

-- Outbox Event Trigger Function
CREATE OR REPLACE FUNCTION public.fn_requisition_uploaded_outbox()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.event_outbox (event_type, entity_id, payload)
    VALUES (
        'REQUISITION_UPLOADED',
        NEW.id,
        jsonb_build_object(
            'requisition_id', NEW.id,
            'organization_id', NEW.organization_id,
            'property_id', NEW.property_id,
            'requisition_month', NEW.requisition_month,
            'requisition_year', NEW.requisition_year,
            'file_name', NEW.file_name,
            'uploaded_by', NEW.uploaded_by
        )
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_requisition_uploaded ON public.property_monthly_requisitions;
CREATE TRIGGER trigger_requisition_uploaded
AFTER INSERT ON public.property_monthly_requisitions
FOR EACH ROW EXECUTE FUNCTION public.fn_requisition_uploaded_outbox();
