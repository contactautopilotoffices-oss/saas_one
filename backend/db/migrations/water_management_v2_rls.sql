-- Drop existing restrictive policies
DROP POLICY IF EXISTS water_sources_read ON water_sources;
DROP POLICY IF EXISTS water_tariffs_read ON water_tariffs;
DROP POLICY IF EXISTS water_readings_read ON water_readings;

DROP POLICY IF EXISTS water_sources_write ON water_sources;
DROP POLICY IF EXISTS water_tariffs_write ON water_tariffs;
DROP POLICY IF EXISTS water_readings_write ON water_readings;

-- Water Sources Policies
CREATE POLICY water_sources_read ON water_sources FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM properties p
    WHERE p.id = water_sources.property_id
    AND (
      public.is_master_admin_v2() OR 
      public.is_org_admin_v2(p.organization_id) OR 
      public.is_property_member_v2(p.id)
    )
  )
);

CREATE POLICY water_sources_write ON water_sources FOR ALL USING (
  EXISTS (
    SELECT 1 FROM properties p
    WHERE p.id = water_sources.property_id
    AND (
      public.is_master_admin_v2() OR 
      public.is_org_admin_v2(p.organization_id) OR 
      public.is_property_member_v2(p.id)
    )
  )
);

-- Water Tariffs Policies
CREATE POLICY water_tariffs_read ON water_tariffs FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM water_sources ws
    JOIN properties p ON p.id = ws.property_id
    WHERE ws.id = water_tariffs.source_id
    AND (
      public.is_master_admin_v2() OR 
      public.is_org_admin_v2(p.organization_id) OR 
      public.is_property_member_v2(p.id)
    )
  )
);

CREATE POLICY water_tariffs_write ON water_tariffs FOR ALL USING (
  EXISTS (
    SELECT 1 FROM water_sources ws
    JOIN properties p ON p.id = ws.property_id
    WHERE ws.id = water_tariffs.source_id
    AND (
      public.is_master_admin_v2() OR 
      public.is_org_admin_v2(p.organization_id) OR 
      public.is_property_member_v2(p.id)
    )
  )
);

-- Water Readings Policies
CREATE POLICY water_readings_read ON water_readings FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM water_sources ws
    JOIN properties p ON p.id = ws.property_id
    WHERE ws.id = water_readings.source_id
    AND (
      public.is_master_admin_v2() OR 
      public.is_org_admin_v2(p.organization_id) OR 
      public.is_property_member_v2(p.id)
    )
  )
);

CREATE POLICY water_readings_write ON water_readings FOR ALL USING (
  EXISTS (
    SELECT 1 FROM water_sources ws
    JOIN properties p ON p.id = ws.property_id
    WHERE ws.id = water_readings.source_id
    AND (
      public.is_master_admin_v2() OR 
      public.is_org_admin_v2(p.organization_id) OR 
      public.is_property_member_v2(p.id)
    )
  )
);
