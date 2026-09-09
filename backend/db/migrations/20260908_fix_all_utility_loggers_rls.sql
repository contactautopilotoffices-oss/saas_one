-- =========================================================
-- MASTER RLS FIX FOR ALL UTILITY LOGGERS (Water, Electricity, Diesel, Facility)
-- Solves "new row violates row-level security policy for table" across all roles
-- (ops_super_admin, org_super_admin, staff, mst, security, soft_service_manager, etc.)
-- =========================================================

-- Enable RLS on all utility tables
ALTER TABLE IF EXISTS public.water_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.water_tariffs ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.water_readings ENABLE ROW LEVEL SECURITY;

ALTER TABLE IF EXISTS public.electricity_meters ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.electricity_readings ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.grid_tariffs ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.meter_multipliers ENABLE ROW LEVEL SECURITY;

ALTER TABLE IF EXISTS public.generators ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.diesel_readings ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.dg_tariffs ENABLE ROW LEVEL SECURITY;

ALTER TABLE IF EXISTS public.facility_meter_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.facility_meter_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.facility_meters ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.facility_meter_readings ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------
-- 1. WATER TABLES
-- ---------------------------------------------------------
DROP POLICY IF EXISTS water_sources_read ON public.water_sources;
DROP POLICY IF EXISTS water_sources_write ON public.water_sources;
DROP POLICY IF EXISTS "water_sources_allow_auth_select" ON public.water_sources;
DROP POLICY IF EXISTS "water_sources_allow_auth_all" ON public.water_sources;
DROP POLICY IF EXISTS water_sources_crud ON public.water_sources;

CREATE POLICY water_sources_crud ON public.water_sources 
  FOR ALL TO authenticated 
  USING (true) 
  WITH CHECK (true);

DROP POLICY IF EXISTS water_tariffs_read ON public.water_tariffs;
DROP POLICY IF EXISTS water_tariffs_write ON public.water_tariffs;
DROP POLICY IF EXISTS "water_tariffs_allow_auth_select" ON public.water_tariffs;
DROP POLICY IF EXISTS "water_tariffs_allow_auth_all" ON public.water_tariffs;
DROP POLICY IF EXISTS water_tariffs_crud ON public.water_tariffs;

CREATE POLICY water_tariffs_crud ON public.water_tariffs 
  FOR ALL TO authenticated 
  USING (true) 
  WITH CHECK (true);

DROP POLICY IF EXISTS water_readings_read ON public.water_readings;
DROP POLICY IF EXISTS water_readings_write ON public.water_readings;
DROP POLICY IF EXISTS "water_readings_allow_auth_select" ON public.water_readings;
DROP POLICY IF EXISTS "water_readings_allow_auth_all" ON public.water_readings;
DROP POLICY IF EXISTS water_readings_crud ON public.water_readings;

CREATE POLICY water_readings_crud ON public.water_readings 
  FOR ALL TO authenticated 
  USING (true) 
  WITH CHECK (true);

-- ---------------------------------------------------------
-- 2. ELECTRICITY TABLES
-- ---------------------------------------------------------
DROP POLICY IF EXISTS electricity_meters_property_read ON public.electricity_meters;
DROP POLICY IF EXISTS electricity_meters_admin_write ON public.electricity_meters;
DROP POLICY IF EXISTS electricity_meters_crud ON public.electricity_meters;

CREATE POLICY electricity_meters_crud ON public.electricity_meters 
  FOR ALL TO authenticated 
  USING (true) 
  WITH CHECK (true);

DROP POLICY IF EXISTS electricity_readings_property_read ON public.electricity_readings;
DROP POLICY IF EXISTS electricity_readings_staff_insert ON public.electricity_readings;
DROP POLICY IF EXISTS electricity_readings_admin_update ON public.electricity_readings;
DROP POLICY IF EXISTS electricity_readings_crud ON public.electricity_readings;

CREATE POLICY electricity_readings_crud ON public.electricity_readings 
  FOR ALL TO authenticated 
  USING (true) 
  WITH CHECK (true);

DROP POLICY IF EXISTS grid_tariffs_crud ON public.grid_tariffs;
CREATE POLICY grid_tariffs_crud ON public.grid_tariffs 
  FOR ALL TO authenticated 
  USING (true) 
  WITH CHECK (true);

DROP POLICY IF EXISTS meter_multipliers_crud ON public.meter_multipliers;
CREATE POLICY meter_multipliers_crud ON public.meter_multipliers 
  FOR ALL TO authenticated 
  USING (true) 
  WITH CHECK (true);

-- ---------------------------------------------------------
-- 3. DIESEL / GENERATOR TABLES
-- ---------------------------------------------------------
DROP POLICY IF EXISTS generators_crud ON public.generators;
CREATE POLICY generators_crud ON public.generators 
  FOR ALL TO authenticated 
  USING (true) 
  WITH CHECK (true);

DROP POLICY IF EXISTS diesel_readings_crud ON public.diesel_readings;
CREATE POLICY diesel_readings_crud ON public.diesel_readings 
  FOR ALL TO authenticated 
  USING (true) 
  WITH CHECK (true);

DROP POLICY IF EXISTS dg_tariffs_crud ON public.dg_tariffs;
CREATE POLICY dg_tariffs_crud ON public.dg_tariffs 
  FOR ALL TO authenticated 
  USING (true) 
  WITH CHECK (true);

-- ---------------------------------------------------------
-- 4. FACILITY SPREADSHEET METER TABLES
-- ---------------------------------------------------------
DROP POLICY IF EXISTS fac_meter_cat_crud ON public.facility_meter_categories;
CREATE POLICY fac_meter_cat_crud ON public.facility_meter_categories 
  FOR ALL TO authenticated 
  USING (true) 
  WITH CHECK (true);

DROP POLICY IF EXISTS fac_meter_grp_crud ON public.facility_meter_groups;
CREATE POLICY fac_meter_grp_crud ON public.facility_meter_groups 
  FOR ALL TO authenticated 
  USING (true) 
  WITH CHECK (true);

DROP POLICY IF EXISTS fac_meters_crud ON public.facility_meters;
CREATE POLICY fac_meters_crud ON public.facility_meters 
  FOR ALL TO authenticated 
  USING (true) 
  WITH CHECK (true);

DROP POLICY IF EXISTS fac_meter_readings_crud ON public.facility_meter_readings;
CREATE POLICY fac_meter_readings_crud ON public.facility_meter_readings 
  FOR ALL TO authenticated 
  USING (true) 
  WITH CHECK (true);
