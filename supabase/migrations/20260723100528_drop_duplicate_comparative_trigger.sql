-- Drop the duplicate trigger added in 20260722130247_trigger_comparative_status_change.sql
-- The table already has tr_material_comparatives_outbox from 20260721120000_material_comparatives.sql
-- which automatically inserts events into event_outbox by calling create_outbox_event()
DROP TRIGGER IF EXISTS comparative_status_change_trigger ON material_request_comparatives;
DROP FUNCTION IF EXISTS trigger_comparative_status_change();
