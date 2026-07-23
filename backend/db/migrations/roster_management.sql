-- =========================================================
-- ROSTER MANAGEMENT SCHEMA
-- Adds tables for Custom Shift Configurations and Monthly Staff Rosters
-- =========================================================

-- 1. SHIFT CONFIGURATIONS
-- Defines the customized shift legend per property (e.g., A, B, W/O, Leave)
CREATE TABLE IF NOT EXISTS shift_configurations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    property_id uuid NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
    code text NOT NULL, -- e.g., 'A', 'W/O', 'Leave'
    name text NOT NULL, -- e.g., 'Morning Shift', 'Weekly Off'
    start_time time without time zone, -- Nullable for W/O or Leave
    end_time time without time zone,
    is_working_day boolean DEFAULT true, -- False for 'W/O' and 'Leave'
    color text DEFAULT '#f1f5f9', -- HEX color for UI
    created_at timestamptz DEFAULT now(),
    UNIQUE(property_id, code)
);

-- RLS for shift_configurations
ALTER TABLE shift_configurations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS shift_configurations_select ON shift_configurations;
CREATE POLICY shift_configurations_select ON shift_configurations FOR SELECT USING (true);

DROP POLICY IF EXISTS shift_configurations_insert ON shift_configurations;
CREATE POLICY shift_configurations_insert ON shift_configurations FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS shift_configurations_update ON shift_configurations;
CREATE POLICY shift_configurations_update ON shift_configurations FOR UPDATE USING (true);

DROP POLICY IF EXISTS shift_configurations_delete ON shift_configurations;
CREATE POLICY shift_configurations_delete ON shift_configurations FOR DELETE USING (true);


-- 2. STAFF ROSTERS
-- Stores the actual planned shift assignments for staff per date
CREATE TABLE IF NOT EXISTS staff_rosters (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    property_id uuid NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    roster_date date NOT NULL,
    shift_id uuid REFERENCES shift_configurations(id) ON DELETE SET NULL,
    is_reliever boolean DEFAULT false,
    relieving_user_id uuid REFERENCES users(id) ON DELETE SET NULL, -- Who they are substituting for
    updated_by uuid REFERENCES users(id) ON DELETE SET NULL, -- Audit trail: who made the edit
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    UNIQUE(property_id, user_id, roster_date) -- One shift per user per day
);

-- RLS for staff_rosters
ALTER TABLE staff_rosters ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS staff_rosters_select ON staff_rosters;
CREATE POLICY staff_rosters_select ON staff_rosters FOR SELECT USING (true);

DROP POLICY IF EXISTS staff_rosters_insert ON staff_rosters;
CREATE POLICY staff_rosters_insert ON staff_rosters FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS staff_rosters_update ON staff_rosters;
CREATE POLICY staff_rosters_update ON staff_rosters FOR UPDATE USING (true);

DROP POLICY IF EXISTS staff_rosters_delete ON staff_rosters;
CREATE POLICY staff_rosters_delete ON staff_rosters FOR DELETE USING (true);
