-- =================================================================================
-- DROP old procurement approval routing trigger and function
-- The simplified flow no longer needs approval routing.
-- =================================================================================

DROP TRIGGER IF EXISTS trg_route_procurement ON material_requests;
DROP FUNCTION IF EXISTS route_procurement_approval();

-- Refresh PostgREST schema
NOTIFY pgrst, 'reload schema';
