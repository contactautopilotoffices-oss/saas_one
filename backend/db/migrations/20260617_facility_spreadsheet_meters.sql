-- =========================================================
-- UNIVERSAL FACILITY SPREADSHEET METERS
-- Architecture for complex, multi-level meter tracking
-- =========================================================

-- 1. CATEGORIES (The Spreadsheet Tabs)
-- e.g., "Floor Panel", "Transformer"
CREATE TABLE IF NOT EXISTS facility_meter_categories (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    property_id uuid NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
    name text NOT NULL,
    meter_type text NOT NULL DEFAULT 'electricity', -- 'electricity', 'water', 'diesel'
    order_index integer DEFAULT 0,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fac_meter_cat_property ON facility_meter_categories(property_id);

-- 2. GROUPS (The Column Groupings)
-- e.g., "Ground Floor", "First Floor"
CREATE TABLE IF NOT EXISTS facility_meter_groups (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    category_id uuid NOT NULL REFERENCES facility_meter_categories(id) ON DELETE CASCADE,
    name text NOT NULL,
    order_index integer DEFAULT 0,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fac_meter_grp_category ON facility_meter_groups(category_id);

-- 3. METERS (The Individual Columns)
-- e.g., "AC Panel", "LTP Panel"
CREATE TABLE IF NOT EXISTS facility_meters (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id uuid NOT NULL REFERENCES facility_meter_groups(id) ON DELETE CASCADE,
    name text NOT NULL,
    unit text NOT NULL DEFAULT 'kWh',
    meter_constant numeric NOT NULL DEFAULT 1.0,
    order_index integer DEFAULT 0,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fac_meters_group ON facility_meters(group_id);

-- 4. METER READINGS (The Daily Data)
CREATE TABLE IF NOT EXISTS facility_meter_readings (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    meter_id uuid NOT NULL REFERENCES facility_meters(id) ON DELETE CASCADE,
    reading_date date NOT NULL,
    
    -- Values
    initial_reading numeric,
    final_reading numeric,
    
    -- Edge Case Handlers
    meter_constant_used numeric NOT NULL DEFAULT 1.0, -- Locks in the multiplier historically
    is_rollover boolean DEFAULT false,                -- True if meter hit max and reset
    consumption numeric,                              -- Stored directly to allow overrides
    
    created_by uuid REFERENCES users(id),
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    
    -- Prevent duplicate entries for the same meter on the same day
    CONSTRAINT unique_daily_reading UNIQUE(meter_id, reading_date)
);

CREATE INDEX IF NOT EXISTS idx_fac_meter_read_meter_date ON facility_meter_readings(meter_id, reading_date DESC);

-- =========================================================
-- ROW LEVEL SECURITY (RLS)
-- =========================================================
ALTER TABLE facility_meter_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE facility_meter_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE facility_meters ENABLE ROW LEVEL SECURITY;
ALTER TABLE facility_meter_readings ENABLE ROW LEVEL SECURITY;

-- Any authenticated user can perform CRUD operations on these tables
DROP POLICY IF EXISTS fac_meter_cat_crud ON facility_meter_categories;
CREATE POLICY fac_meter_cat_crud ON facility_meter_categories FOR ALL USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS fac_meter_grp_crud ON facility_meter_groups;
CREATE POLICY fac_meter_grp_crud ON facility_meter_groups FOR ALL USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS fac_meters_crud ON facility_meters;
CREATE POLICY fac_meters_crud ON facility_meters FOR ALL USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS fac_meter_readings_crud ON facility_meter_readings;
CREATE POLICY fac_meter_readings_crud ON facility_meter_readings FOR ALL USING (auth.role() = 'authenticated');
