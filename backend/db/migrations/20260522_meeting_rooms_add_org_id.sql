-- =================================================================================
-- Add organization_id to meeting_rooms
-- Fixes: meeting_rooms was only property-scoped, but bookings/credits store org_id.
-- This allows org-level queries and enforces data consistency.
-- =================================================================================

-- 1. Add nullable column first (safe for existing data)
ALTER TABLE meeting_rooms
    ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;

-- 2. Backfill existing rows from properties table
UPDATE meeting_rooms
SET organization_id = properties.organization_id
FROM properties
WHERE meeting_rooms.property_id = properties.id
  AND meeting_rooms.organization_id IS NULL;

-- 3. Make column NOT NULL after backfill (all rows should now have a value)
-- If this fails, some rooms have property_ids pointing to deleted properties.
-- In that case, investigate those orphaned rows before re-running.
ALTER TABLE meeting_rooms
    ALTER COLUMN organization_id SET NOT NULL;

-- 4. Add index for org-level queries
CREATE INDEX IF NOT EXISTS idx_meeting_rooms_org_id ON meeting_rooms(organization_id);

-- 5. Add composite index for common org + status filters
CREATE INDEX IF NOT EXISTS idx_meeting_rooms_org_status ON meeting_rooms(organization_id, status);

-- 6. Optional: Create trigger to auto-populate organization_id on insert/update
-- This ensures API routes that forget to set it still get correct data.
CREATE OR REPLACE FUNCTION trg_set_meeting_room_org_id()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.property_id IS NOT NULL AND (NEW.organization_id IS NULL OR TG_OP = 'UPDATE' AND NEW.property_id <> OLD.property_id) THEN
        SELECT organization_id INTO NEW.organization_id
        FROM properties WHERE id = NEW.property_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_meeting_room_org_id ON meeting_rooms;
CREATE TRIGGER set_meeting_room_org_id
    BEFORE INSERT OR UPDATE ON meeting_rooms
    FOR EACH ROW
    EXECUTE FUNCTION trg_set_meeting_room_org_id();

-- Refresh PostgREST
NOTIFY pgrst, 'reload schema';
