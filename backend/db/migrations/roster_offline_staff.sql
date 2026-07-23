-- =========================================================
-- OFFLINE ROSTER STAFF SCHEMA
-- Adds support for staff who don't have registered app accounts
-- =========================================================

-- 1. Create offline_roster_staff table
CREATE TABLE IF NOT EXISTS offline_roster_staff (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    property_id uuid NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
    full_name text NOT NULL,
    custom_designation text,
    created_at timestamptz DEFAULT now()
);

-- RLS for offline_roster_staff
ALTER TABLE offline_roster_staff ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS offline_roster_staff_select ON offline_roster_staff;
CREATE POLICY offline_roster_staff_select ON offline_roster_staff FOR SELECT USING (true);

DROP POLICY IF EXISTS offline_roster_staff_insert ON offline_roster_staff;
CREATE POLICY offline_roster_staff_insert ON offline_roster_staff FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS offline_roster_staff_update ON offline_roster_staff;
CREATE POLICY offline_roster_staff_update ON offline_roster_staff FOR UPDATE USING (true);

DROP POLICY IF EXISTS offline_roster_staff_delete ON offline_roster_staff;
CREATE POLICY offline_roster_staff_delete ON offline_roster_staff FOR DELETE USING (true);


-- 2. Modify staff_rosters to support offline staff seamlessly
-- We will store offline_roster_staff.id in the existing user_id column.
-- To do this, we just need to drop the strict foreign key to the users table.
ALTER TABLE staff_rosters DROP CONSTRAINT IF EXISTS staff_rosters_user_id_fkey;

-- We keep the existing UNIQUE(property_id, user_id, roster_date)
-- The unique constraint works perfectly for both app users and offline users!
