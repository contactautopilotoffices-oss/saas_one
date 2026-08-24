-- ==============================================================================
-- Migration: Property Monthly Requisition Budgets & Over-Budget Flagging
-- Created: 2026-08-24
-- Description:
--   1. Create public.property_monthly_requisition_budgets table to store monthly
--      HK, Beverage, and Total budget allocations per property and floor.
--   2. Add over-budget tracking columns to public.property_monthly_requisitions.
--   3. Enable RLS and indexes for high performance.
--   4. Update outbox trigger with over-budget tracking for WhatsApp notifications.
-- ==============================================================================

-- 1. Create property_monthly_requisition_budgets table
CREATE TABLE IF NOT EXISTS public.property_monthly_requisition_budgets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
    floor_tag TEXT NOT NULL DEFAULT 'All Floors',
    site_name TEXT,
    hk_budget NUMERIC(14, 2) NOT NULL DEFAULT 0,
    beverage_budget NUMERIC(14, 2) NOT NULL DEFAULT 0,
    total_budget NUMERIC(14, 2) NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT unique_org_prop_floor_budget UNIQUE (organization_id, property_id, floor_tag)
);

-- 2. Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_pmrb_org_prop ON public.property_monthly_requisition_budgets(organization_id, property_id);
CREATE INDEX IF NOT EXISTS idx_pmrb_floor ON public.property_monthly_requisition_budgets(property_id, floor_tag);

-- 3. Row Level Security (RLS)
ALTER TABLE public.property_monthly_requisition_budgets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pmrb_select_policy ON public.property_monthly_requisition_budgets;
CREATE POLICY pmrb_select_policy ON public.property_monthly_requisition_budgets
    FOR SELECT USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS pmrb_all_policy ON public.property_monthly_requisition_budgets;
CREATE POLICY pmrb_all_policy ON public.property_monthly_requisition_budgets
    FOR ALL USING (auth.role() = 'authenticated');

-- 4. Add over-budget tracking columns to property_monthly_requisitions
ALTER TABLE public.property_monthly_requisitions
ADD COLUMN IF NOT EXISTS is_over_budget BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS budget_limit NUMERIC(14, 2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS over_budget_amount NUMERIC(14, 2) DEFAULT 0;

-- 5. Outbox Trigger with Over-Budget Payload for WhatsApp Notifications
CREATE OR REPLACE FUNCTION public.fn_monthly_requisition_outbox()
RETURNS TRIGGER AS $$
DECLARE
    v_payload JSONB;
    v_org_id UUID;
    v_notes JSONB;
    v_items_count INT := 0;
    v_total_amount NUMERIC := 0;
    v_is_over_budget BOOLEAN := false;
    v_budget_limit NUMERIC := 0;
    v_over_budget_amount NUMERIC := 0;
BEGIN
    v_org_id := NEW.organization_id;
    IF v_org_id IS NULL AND NEW.property_id IS NOT NULL THEN
        SELECT organization_id INTO v_org_id FROM public.properties WHERE id = NEW.property_id LIMIT 1;
    END IF;

    v_is_over_budget := COALESCE(NEW.is_over_budget, false);
    v_budget_limit := COALESCE(NEW.budget_limit, 0);
    v_over_budget_amount := COALESCE(NEW.over_budget_amount, 0);

    -- Try to parse notes JSON if present
    BEGIN
        IF NEW.notes IS NOT NULL AND NEW.notes ~ '^\s*\{' THEN
            v_notes := NEW.notes::JSONB;
            v_items_count := COALESCE((v_notes->>'total_items_count')::INT, jsonb_array_length(v_notes->'items'), 0);
            v_total_amount := COALESCE((v_notes->>'total_estimated_amount')::NUMERIC, 0);
            IF NOT v_is_over_budget THEN
                v_is_over_budget := COALESCE((v_notes->>'is_over_budget')::BOOLEAN, false);
            END IF;
            IF v_budget_limit = 0 THEN
                v_budget_limit := COALESCE((v_notes->>'budget_limit')::NUMERIC, 0);
            END IF;
            IF v_over_budget_amount = 0 THEN
                v_over_budget_amount := COALESCE((v_notes->>'over_budget_amount')::NUMERIC, 0);
            END IF;
        END IF;
    EXCEPTION WHEN OTHERS THEN
        v_items_count := 0;
        v_total_amount := 0;
    END;

    IF TG_OP = 'INSERT' THEN
        v_payload := jsonb_build_object(
            'requisition_id', NEW.id,
            'property_id', NEW.property_id,
            'organization_id', v_org_id,
            'floor_tag', COALESCE(NEW.floor_tag, 'All Floors'),
            'requisition_month', NEW.requisition_month,
            'requisition_year', NEW.requisition_year,
            'file_name', NEW.file_name,
            'file_url', NEW.file_url,
            'items_count', v_items_count,
            'total_amount', v_total_amount,
            'total_estimated_amount', v_total_amount,
            'is_over_budget', v_is_over_budget,
            'budget_limit', v_budget_limit,
            'over_budget_amount', v_over_budget_amount,
            'uploaded_by', NEW.uploaded_by,
            'status', NEW.status
        );

        INSERT INTO public.event_outbox (event_type, entity_id, payload)
        VALUES ('REQUISITION_UPLOADED', NEW.id, v_payload);
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_property_monthly_requisitions_outbox ON public.property_monthly_requisitions;
CREATE TRIGGER trg_property_monthly_requisitions_outbox
    AFTER INSERT ON public.property_monthly_requisitions
    FOR EACH ROW EXECUTE FUNCTION public.fn_monthly_requisition_outbox();
