-- Remove the overlap prevention trigger from meter_multipliers
-- Overlap prevention is now handled in the application layer (API)
-- This gives more flexibility for retroactive updates and bulk changes

DROP TRIGGER IF EXISTS trg_check_multiplier_overlap ON meter_multipliers;
DROP FUNCTION IF EXISTS check_multiplier_overlap();

-- Note: The unique constraint on (meter_id, effective_from) remains
-- This prevents exact duplicate date entries but allows overlapping ranges
-- Application logic in the API handles merging/splitting of overlapping periods

-- Optional: Add a comment for documentation
COMMENT ON TABLE meter_multipliers IS 'Meter multipliers with CT/PT ratios. Overlap prevention handled by application layer API.';
