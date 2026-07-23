-- =================================================================================
-- PROCUREMENT ESCALATION & SEQUENTIAL APPROVAL (V4)
-- Description: Adds escalation tracking and updates custom item routing to Manager 1 first.
-- =================================================================================

-- 1. Add escalation tracking columns
ALTER TABLE material_requests ADD COLUMN IF NOT EXISTS escalated_by uuid REFERENCES users(id);
ALTER TABLE material_requests ADD COLUMN IF NOT EXISTS escalated_at timestamptz;
ALTER TABLE material_requests ADD COLUMN IF NOT EXISTS approval_level int DEFAULT 1;

-- 2. Update the routing function for sequential approval
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

    -- NEW LOGIC: Custom items go to MANAGER 1 (Low Approver) FIRST
    IF NEW.has_custom_items = true THEN
        NEW.target_approver_id := v_low_app;
        NEW.target_approver_ids := ARRAY[v_low_app];
        NEW.approval_level := 1;
    ELSIF NEW.total_amount < v_threshold THEN
        -- Standard items < Threshold go to BOTH for quick approval
        NEW.target_approver_ids := ARRAY[v_low_app, v_high_app];
        NEW.target_approver_id := NULL;
        NEW.approval_level := 1;
    ELSE
        -- Standard items >= Threshold go to HIGH manager only
        NEW.target_approver_ids := ARRAY[v_high_app];
        NEW.target_approver_id := v_high_app;
        NEW.approval_level := 2; -- Higher level
    END IF;

    -- Clean up array (remove nulls)
    NEW.target_approver_ids := array_remove(NEW.target_approver_ids, NULL);

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger remains the same as it was defined in previous migration, 
-- but we ensure it's pointing to the updated function.
DROP TRIGGER IF EXISTS trg_route_procurement ON material_requests;
CREATE TRIGGER trg_route_procurement
    BEFORE INSERT ON material_requests
    FOR EACH ROW
    EXECUTE FUNCTION route_procurement_approval();

-- Refresh PostgREST schema
NOTIFY pgrst, 'reload schema';
