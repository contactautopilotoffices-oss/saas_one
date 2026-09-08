-- =========================================================
-- FIX WATER LOGGER RLS POLICIES FOR ALL ROLES
-- Ensures ops_super_admin, staff, mst, security, and all authenticated roles
-- can view, log, update, and delete water entries without 500/RLS errors.
-- =========================================================

-- Drop existing restrictive water policies
DROP POLICY IF EXISTS water_sources_read ON public.water_sources;
DROP POLICY IF EXISTS water_sources_write ON public.water_sources;
DROP POLICY IF EXISTS water_tariffs_read ON public.water_tariffs;
DROP POLICY IF EXISTS water_tariffs_write ON public.water_tariffs;
DROP POLICY IF EXISTS water_readings_read ON public.water_readings;
DROP POLICY IF EXISTS water_readings_write ON public.water_readings;

DROP POLICY IF EXISTS "water_sources_allow_auth_select" ON public.water_sources;
DROP POLICY IF EXISTS "water_sources_allow_auth_all" ON public.water_sources;
DROP POLICY IF EXISTS "water_tariffs_allow_auth_select" ON public.water_tariffs;
DROP POLICY IF EXISTS "water_tariffs_allow_auth_all" ON public.water_tariffs;
DROP POLICY IF EXISTS "water_readings_allow_auth_select" ON public.water_readings;
DROP POLICY IF EXISTS "water_readings_allow_auth_all" ON public.water_readings;

-- 1. WATER SOURCES POLICIES (Authenticated Users)
CREATE POLICY "water_sources_allow_auth_select" 
  ON public.water_sources FOR SELECT 
  TO authenticated 
  USING (true);

CREATE POLICY "water_sources_allow_auth_all" 
  ON public.water_sources FOR ALL 
  TO authenticated 
  USING (true)
  WITH CHECK (true);

-- 2. WATER TARIFFS POLICIES (Authenticated Users)
CREATE POLICY "water_tariffs_allow_auth_select" 
  ON public.water_tariffs FOR SELECT 
  TO authenticated 
  USING (true);

CREATE POLICY "water_tariffs_allow_auth_all" 
  ON public.water_tariffs FOR ALL 
  TO authenticated 
  USING (true)
  WITH CHECK (true);

-- 3. WATER READINGS POLICIES (Authenticated Users)
CREATE POLICY "water_readings_allow_auth_select" 
  ON public.water_readings FOR SELECT 
  TO authenticated 
  USING (true);

CREATE POLICY "water_readings_allow_auth_all" 
  ON public.water_readings FOR ALL 
  TO authenticated 
  USING (true)
  WITH CHECK (true);
