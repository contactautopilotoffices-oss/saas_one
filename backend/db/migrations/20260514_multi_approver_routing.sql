-- Add new columns for multi-approver routing and custom item tracking
ALTER TABLE material_requests ADD COLUMN IF NOT EXISTS target_approver_ids uuid[] DEFAULT '{}'::uuid[];
ALTER TABLE material_requests ADD COLUMN IF NOT EXISTS has_custom_items boolean DEFAULT false;

-- Drop existing trigger
DROP TRIGGER IF EXISTS trg_route_procurement ON material_requests;

-- Update the routing function
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

    -- Route based on custom items and total_amount
    IF NEW.has_custom_items = true THEN
        -- Custom items go to BOTH
        NEW.target_approver_ids := ARRAY[v_low_app, v_high_app];
        NEW.target_approver_id := NULL; -- Clear single approver when multi-approver is used
    ELSIF NEW.total_amount < v_threshold THEN
        -- Price < Threshold goes to BOTH
        NEW.target_approver_ids := ARRAY[v_low_app, v_high_app];
        NEW.target_approver_id := NULL;
    ELSE
        -- Price >= Threshold goes to HIGH manager only
        NEW.target_approver_ids := ARRAY[v_high_app];
        NEW.target_approver_id := v_high_app; -- Keep for backward compatibility
    END IF;

    -- Clean up array (remove nulls)
    NEW.target_approver_ids := array_remove(NEW.target_approver_ids, NULL);

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Recreate trigger
CREATE TRIGGER trg_route_procurement
    BEFORE INSERT ON material_requests
    FOR EACH ROW
    EXECUTE FUNCTION route_procurement_approval();

-- Refresh PostgREST schema
NOTIFY pgrst, 'reload schema';
