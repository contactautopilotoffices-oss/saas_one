-- Migration: Auto-migrate existing electricity meters and historical readings to the new Spreadsheet architecture.
BEGIN;

DO $$
DECLARE
    p RECORD;
    v_category_id UUID;
    v_group_id UUID;
    v_meter RECORD;
    v_new_meter_id UUID;
    v_multiplier DECIMAL;
BEGIN
    -- Loop per property to handle multi-tenant setups safely
    FOR p IN (SELECT DISTINCT property_id FROM electricity_meters WHERE deleted_at IS NULL) LOOP
        
        -- 1. Create a Default Tab (Category) for this property
        INSERT INTO facility_meter_categories (property_id, name, meter_type, order_index)
        VALUES (p.property_id, 'Legacy Electricity', 'electricity', 0)
        RETURNING id INTO v_category_id;
        
        -- 2. Create a Default Group under this Tab
        INSERT INTO facility_meter_groups (category_id, name, order_index)
        VALUES (v_category_id, 'Main Location', 0)
        RETURNING id INTO v_group_id;

        -- 3. Loop through all legacy meters for this property
        FOR v_meter IN (SELECT * FROM electricity_meters WHERE property_id = p.property_id AND deleted_at IS NULL) LOOP
            
            -- Find the most recent meter constant (multiplier)
            SELECT multiplier_value INTO v_multiplier
            FROM meter_multipliers
            WHERE meter_id = v_meter.id
            ORDER BY created_at DESC
            LIMIT 1;

            IF v_multiplier IS NULL THEN
                v_multiplier := 1.0;
            END IF;

            -- Insert the meter into the new architecture
            INSERT INTO facility_meters (group_id, name, meter_constant)
            VALUES (v_group_id, v_meter.name, v_multiplier)
            RETURNING id INTO v_new_meter_id;

            -- 4. Migrate ALL historical readings for this meter
            INSERT INTO facility_meter_readings (meter_id, reading_date, initial_reading, final_reading, consumption, meter_constant_used, is_rollover)
            SELECT 
                v_new_meter_id, 
                reading_date, 
                opening_reading, 
                closing_reading, 
                COALESCE(final_units, computed_units, 0), 
                v_multiplier, 
                false
            FROM electricity_readings
            WHERE meter_id = v_meter.id
            ON CONFLICT (meter_id, reading_date) DO NOTHING;

        END LOOP;
    END LOOP;
END $$;

COMMIT;
