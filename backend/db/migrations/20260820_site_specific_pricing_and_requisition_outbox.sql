-- =================================================================================
-- FINAL SUPABASE MIGRATION: 
-- 1. Site-Specific Item Pricing Table
-- 2. Multi-Floor Support (floor_tag)
-- 3. Trigger on property_monthly_requisitions -> public.event_outbox (Existing Table)
-- 4. WhatsApp (AiSensy) Template & Config Registration
-- 5. Non-Destructive Stock Items Link (catalog_item_id)
-- =================================================================================

-- 1. ITEM SITE PRICES TABLE
CREATE TABLE IF NOT EXISTS public.item_site_prices (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    item_id             UUID NOT NULL REFERENCES public.procurement_catalog(id) ON DELETE CASCADE,
    property_id         UUID NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
    unit_price          NUMERIC NOT NULL DEFAULT 0,
    currency            TEXT DEFAULT 'INR',
    effective_from      DATE DEFAULT CURRENT_DATE,
    effective_to        DATE,
    source              TEXT DEFAULT 'PO_HISTORICAL',
    is_active           BOOLEAN DEFAULT true,
    created_at          TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at          TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE(item_id, property_id, is_active)
);

CREATE INDEX IF NOT EXISTS idx_item_site_prices_lookup ON public.item_site_prices(property_id, item_id, is_active);
CREATE INDEX IF NOT EXISTS idx_item_site_prices_org ON public.item_site_prices(organization_id);

-- Enable RLS for item_site_prices
ALTER TABLE public.item_site_prices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS item_site_prices_select ON public.item_site_prices;
CREATE POLICY item_site_prices_select ON public.item_site_prices FOR SELECT USING (auth.role() = 'authenticated');
DROP POLICY IF EXISTS item_site_prices_all ON public.item_site_prices;
CREATE POLICY item_site_prices_all ON public.item_site_prices FOR ALL USING (auth.role() = 'authenticated');

-- 2. MULTI-FLOOR REQUISITION SUPPORT & CLEAN STATUS LIFECYCLE
ALTER TABLE public.property_monthly_requisitions ADD COLUMN IF NOT EXISTS floor_tag TEXT DEFAULT 'All Floors';

-- Migrate any legacy statuses to 'submitted'
UPDATE public.property_monthly_requisitions
SET status = 'submitted'
WHERE status IN ('uploaded', 'acknowledged');

-- Update status check constraint (Clean flow: submitted -> pending_approval -> approved / rejected -> ordered)
ALTER TABLE public.property_monthly_requisitions 
DROP CONSTRAINT IF EXISTS property_monthly_requisitions_status_check;

ALTER TABLE public.property_monthly_requisitions 
ADD CONSTRAINT property_monthly_requisitions_status_check 
CHECK (status IN ('submitted', 'pending_approval', 'approved', 'rejected', 'ordered'));

-- Drop strict single-month constraint to allow multi-floor requisitions per month
ALTER TABLE public.property_monthly_requisitions 
DROP CONSTRAINT IF EXISTS unique_property_month_year;

-- 3. TRIGGER: PUSH REQUISITION EVENTS INTO EXISTING event_outbox TABLE
CREATE OR REPLACE FUNCTION public.trg_requisition_outbox_notifier()
RETURNS TRIGGER AS $$
DECLARE
    v_event_type VARCHAR;
    v_payload JSONB;
BEGIN
    IF (TG_OP = 'INSERT') THEN
        v_event_type := 'REQUISITION_UPLOADED';
    ELSIF (TG_OP = 'UPDATE') THEN
        IF (NEW.status = 'pending_approval' AND OLD.status IS DISTINCT FROM 'pending_approval') THEN
            v_event_type := 'REQUISITION_APPROVAL_REQUESTED';
        ELSIF (NEW.status = 'approved' AND OLD.status IS DISTINCT FROM 'approved') THEN
            v_event_type := 'REQUISITION_APPROVED';
        ELSIF (NEW.status = 'rejected' AND OLD.status IS DISTINCT FROM 'rejected') THEN
            v_event_type := 'REQUISITION_REJECTED';
        ELSE
            v_event_type := 'REQUISITION_UPDATED';
        END IF;
    END IF;

    -- Build standard event payload matching existing event_outbox pattern
    v_payload := jsonb_build_object(
        'requisition_id', NEW.id,
        'organization_id', NEW.organization_id,
        'property_id', NEW.property_id,
        'floor_tag', COALESCE(NEW.floor_tag, 'All Floors'),
        'requisition_month', NEW.requisition_month,
        'requisition_year', NEW.requisition_year,
        'file_name', NEW.file_name,
        'file_url', NEW.file_url,
        'status', NEW.status,
        'uploaded_by', NEW.uploaded_by,
        'notes', NEW.notes
    );

    -- Insert into existing event_outbox table
    INSERT INTO public.event_outbox (event_type, entity_id, payload)
    VALUES (v_event_type, NEW.id, v_payload);

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Bind Trigger to property_monthly_requisitions table
DROP TRIGGER IF EXISTS trg_requisition_outbox_event ON public.property_monthly_requisitions;
CREATE TRIGGER trg_requisition_outbox_event
AFTER INSERT OR UPDATE ON public.property_monthly_requisitions
FOR EACH ROW
EXECUTE FUNCTION public.trg_requisition_outbox_notifier();

-- 4. REGISTER WHATSAPP TEMPLATES IN organization_settings
UPDATE public.organization_settings
SET whatsapp_templates = COALESCE(whatsapp_templates, '{}'::jsonb) || jsonb_build_object(
    'monthly_requisition_uploaded', jsonb_build_object(
        'campaign_name', 'requisition_submitted_v1',
        'params', jsonb_build_array('user_name', 'property', 'floor_tag', 'month', 'year', 'items_count', 'total_amount', 'uploaded_by')
    ),
    'requisition_approval_requested', jsonb_build_object(
        'campaign_name', 'requisition_approval_requested_v1',
        'params', jsonb_build_array('user_name', 'property', 'floor_tag', 'month', 'year', 'vendor_name', 'total_amount', 'notes')
    ),
    'requisition_status_updated', jsonb_build_object(
        'campaign_name', 'requisition_status_updated_v1',
        'params', jsonb_build_array('user_name', 'property', 'floor_tag', 'month', 'year', 'status', 'approver_name', 'total_amount', 'notes')
    )
)
WHERE whatsapp_templates IS NOT NULL;

-- 5. NON-DESTRUCTIVE STOCK ITEMS LINK TO MASTER CATALOG
ALTER TABLE public.stock_items 
ADD COLUMN IF NOT EXISTS catalog_item_id UUID REFERENCES public.procurement_catalog(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_stock_items_catalog_link ON public.stock_items(property_id, catalog_item_id);
