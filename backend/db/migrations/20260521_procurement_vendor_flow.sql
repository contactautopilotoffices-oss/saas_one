-- =================================================================================
-- PROCUREMENT VENDOR & QUOTATION FLOW (V5)
-- Description: Simplified flow: Site team requests → Procurement quotes → Ordered → Delivered
-- Changes:
--   1. Add vendor/quotation fields to material_requests
--   2. Drop old approval routing trigger
--   3. Budget deduction now happens on 'quoted' status
-- =================================================================================

-- 1. Add vendor and service fields
ALTER TABLE material_requests ADD COLUMN IF NOT EXISTS service_description text;
ALTER TABLE material_requests ADD COLUMN IF NOT EXISTS vendor_name text;
ALTER TABLE material_requests ADD COLUMN IF NOT EXISTS vendor_contact text;
ALTER TABLE material_requests ADD COLUMN IF NOT EXISTS vendor_email text;
ALTER TABLE material_requests ADD COLUMN IF NOT EXISTS vendor_address text;
ALTER TABLE material_requests ADD COLUMN IF NOT EXISTS quotation_date timestamptz;

-- 2. Drop old routing trigger — no longer needed in simplified flow
DROP TRIGGER IF EXISTS trg_route_procurement ON material_requests;

-- 3. Budget deduction RPC (unchanged logic, just called at different status)
-- Ensure the RPC exists for the new flow
CREATE OR REPLACE FUNCTION update_procurement_budget_spent(
    p_property_id uuid,
    p_budget_type text,
    p_amount numeric
)
RETURNS void AS $$
BEGIN
    UPDATE procurement_budgets
    SET spent_amount = spent_amount + p_amount,
        updated_at = now()
    WHERE property_id = p_property_id
      AND budget_type = p_budget_type
      AND period_start <= CURRENT_DATE
      AND (period_end IS NULL OR period_end >= CURRENT_DATE);
END;
$$ LANGUAGE plpgsql;

-- 4. Refresh PostgREST schema
NOTIFY pgrst, 'reload schema';
