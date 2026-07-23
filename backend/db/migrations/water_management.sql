-- water_management.sql

CREATE TABLE IF NOT EXISTS water_sources (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    property_id uuid NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
    name text NOT NULL, -- e.g., "Drinking Water 20 Litre Jar", "Water Tanker 6000 Ltr"
    source_type text NOT NULL CHECK (source_type IN ('jar', 'tanker')),
    capacity_litres numeric, -- e.g., 20 or 6000
    created_by uuid REFERENCES users(id),
    updated_by uuid REFERENCES users(id),
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    is_active boolean DEFAULT true
);

CREATE TABLE IF NOT EXISTS water_tariffs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id uuid NOT NULL REFERENCES water_sources(id) ON DELETE CASCADE,
    rate_per_unit numeric NOT NULL, -- Expense per jar/tanker
    effective_from date NOT NULL,
    effective_to date,
    created_by uuid REFERENCES users(id),
    created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS water_readings (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id uuid NOT NULL REFERENCES water_sources(id) ON DELETE CASCADE,
    reading_date date NOT NULL,
    quantity numeric NOT NULL DEFAULT 0, -- Number of jars or loads
    tariff_id uuid REFERENCES water_tariffs(id),
    tariff_rate_used numeric,
    computed_cost numeric,
    created_by uuid REFERENCES users(id),
    updated_by uuid REFERENCES users(id),
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    UNIQUE(source_id, reading_date)
);

-- RLS
ALTER TABLE water_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE water_tariffs ENABLE ROW LEVEL SECURITY;
ALTER TABLE water_readings ENABLE ROW LEVEL SECURITY;

-- Property members can read
DROP POLICY IF EXISTS water_sources_read ON water_sources;
CREATE POLICY water_sources_read ON water_sources FOR SELECT USING (
  EXISTS(SELECT 1 FROM property_memberships pm WHERE pm.property_id = water_sources.property_id AND pm.user_id = auth.uid() AND pm.is_active)
);
DROP POLICY IF EXISTS water_tariffs_read ON water_tariffs;
CREATE POLICY water_tariffs_read ON water_tariffs FOR SELECT USING (
  EXISTS(SELECT 1 FROM water_sources ws JOIN property_memberships pm ON pm.property_id = ws.property_id WHERE ws.id = water_tariffs.source_id AND pm.user_id = auth.uid() AND pm.is_active)
);
DROP POLICY IF EXISTS water_readings_read ON water_readings;
CREATE POLICY water_readings_read ON water_readings FOR SELECT USING (
  EXISTS(SELECT 1 FROM water_sources ws JOIN property_memberships pm ON pm.property_id = ws.property_id WHERE ws.id = water_readings.source_id AND pm.user_id = auth.uid() AND pm.is_active)
);

-- Staff/Admins can write
DROP POLICY IF EXISTS water_sources_write ON water_sources;
CREATE POLICY water_sources_write ON water_sources FOR ALL USING (
  EXISTS(SELECT 1 FROM property_memberships pm WHERE pm.property_id = water_sources.property_id AND pm.user_id = auth.uid() AND pm.is_active)
);
DROP POLICY IF EXISTS water_tariffs_write ON water_tariffs;
CREATE POLICY water_tariffs_write ON water_tariffs FOR ALL USING (
  EXISTS(SELECT 1 FROM water_sources ws JOIN property_memberships pm ON pm.property_id = ws.property_id WHERE ws.id = water_tariffs.source_id AND pm.user_id = auth.uid() AND pm.is_active)
);
DROP POLICY IF EXISTS water_readings_write ON water_readings;
CREATE POLICY water_readings_write ON water_readings FOR ALL USING (
  EXISTS(SELECT 1 FROM water_sources ws JOIN property_memberships pm ON pm.property_id = ws.property_id WHERE ws.id = water_readings.source_id AND pm.user_id = auth.uid() AND pm.is_active)
);

-- Helper function to get active tariff
CREATE OR REPLACE FUNCTION get_active_water_tariff(
  p_source_id uuid,
  p_date date DEFAULT CURRENT_DATE
)
RETURNS TABLE(
  id uuid,
  rate_per_unit numeric,
  effective_from date
)
LANGUAGE sql STABLE
AS $$
  SELECT 
    wt.id,
    wt.rate_per_unit,
    wt.effective_from
  FROM water_tariffs wt
  WHERE wt.source_id = p_source_id
    AND wt.effective_from <= p_date
    AND (wt.effective_to IS NULL OR wt.effective_to >= p_date)
  ORDER BY wt.effective_from DESC
  LIMIT 1;
$$;
