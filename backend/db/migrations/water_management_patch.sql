-- water_management_patch.sql

-- 1. Add missing updated_by columns to existing tables
ALTER TABLE water_sources ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES users(id);
ALTER TABLE water_readings ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES users(id);

-- 2. Drop the old restrictive write policies
DROP POLICY IF EXISTS water_sources_write ON water_sources;
DROP POLICY IF EXISTS water_tariffs_write ON water_tariffs;
DROP POLICY IF EXISTS water_readings_write ON water_readings;

-- 3. Create the new open write policies allowing any active property member
CREATE POLICY water_sources_write ON water_sources FOR ALL USING (
  EXISTS(SELECT 1 FROM property_memberships pm WHERE pm.property_id = water_sources.property_id AND pm.user_id = auth.uid() AND pm.is_active)
);

CREATE POLICY water_tariffs_write ON water_tariffs FOR ALL USING (
  EXISTS(SELECT 1 FROM water_sources ws JOIN property_memberships pm ON pm.property_id = ws.property_id WHERE ws.id = water_tariffs.source_id AND pm.user_id = auth.uid() AND pm.is_active)
);

CREATE POLICY water_readings_write ON water_readings FOR ALL USING (
  EXISTS(SELECT 1 FROM water_sources ws JOIN property_memberships pm ON pm.property_id = ws.property_id WHERE ws.id = water_readings.source_id AND pm.user_id = auth.uid() AND pm.is_active)
);
