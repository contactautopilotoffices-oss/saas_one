-- Create qr_facility_zones table
CREATE TABLE IF NOT EXISTS public.qr_facility_zones (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
    floor TEXT,
    zone_name TEXT NOT NULL,
    qr_signature TEXT NOT NULL UNIQUE,
    created_by UUID REFERENCES auth.users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- RLS for qr_facility_zones
ALTER TABLE public.qr_facility_zones ENABLE ROW LEVEL SECURITY;

-- Allow property admins/super admins to view/manage their zones
CREATE POLICY "Users can view qr_facility_zones in their properties"
ON public.qr_facility_zones FOR SELECT
USING (
    EXISTS (
        SELECT 1 FROM property_memberships
        WHERE property_memberships.property_id = qr_facility_zones.property_id
        AND property_memberships.user_id = auth.uid()
        AND property_memberships.is_active = true
    )
    OR EXISTS (
        SELECT 1 FROM properties p
        JOIN organization_memberships om ON p.organization_id = om.organization_id
        WHERE p.id = qr_facility_zones.property_id
        AND om.user_id = auth.uid()
        AND om.is_active = true
    )
);

CREATE POLICY "Property admins can manage qr_facility_zones"
ON public.qr_facility_zones FOR ALL
USING (
    EXISTS (
        SELECT 1 FROM property_memberships
        WHERE property_memberships.property_id = qr_facility_zones.property_id
        AND property_memberships.user_id = auth.uid()
        AND property_memberships.role::text IN ('PROPERTY_ADMIN', 'property_admin', 'SUPER_ADMIN', 'super_admin')
        AND property_memberships.is_active = true
    )
    OR EXISTS (
        SELECT 1 FROM properties p
        JOIN organization_memberships om ON p.organization_id = om.organization_id
        WHERE p.id = qr_facility_zones.property_id
        AND om.user_id = auth.uid()
        AND om.role::text IN ('ORG_SUPER_ADMIN', 'org_super_admin', 'ORG_ADMIN', 'org_admin')
        AND om.is_active = true
    )
);


-- Create guest_requests table
DO $$ BEGIN
    CREATE TYPE guest_request_status AS ENUM ('PENDING', 'IN_PROGRESS', 'RESOLVED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS public.guest_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
    qr_zone_id UUID NOT NULL REFERENCES public.qr_facility_zones(id) ON DELETE CASCADE,
    guest_name TEXT NOT NULL,
    guest_email TEXT,
    guest_phone TEXT,
    description TEXT NOT NULL,
    photo_urls TEXT[] DEFAULT '{}',
    status guest_request_status DEFAULT 'PENDING',
    ai_category TEXT,
    sla_deadline TIMESTAMP WITH TIME ZONE,
    device_info JSONB,
    location_data JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- RLS for guest_requests
ALTER TABLE public.guest_requests ENABLE ROW LEVEL SECURITY;

-- Property members can view requests in their property
CREATE POLICY "Property members can view guest_requests"
ON public.guest_requests FOR SELECT
USING (
    EXISTS (
        SELECT 1 FROM property_memberships
        WHERE property_memberships.property_id = guest_requests.property_id
        AND property_memberships.user_id = auth.uid()
        AND property_memberships.is_active = true
    )
    OR EXISTS (
        SELECT 1 FROM properties p
        JOIN organization_memberships om ON p.organization_id = om.organization_id
        WHERE p.id = guest_requests.property_id
        AND om.user_id = auth.uid()
        AND om.is_active = true
    )
);

-- Property members can update requests in their property
CREATE POLICY "Property members can update guest_requests"
ON public.guest_requests FOR UPDATE
USING (
    EXISTS (
        SELECT 1 FROM property_memberships
        WHERE property_memberships.property_id = guest_requests.property_id
        AND property_memberships.user_id = auth.uid()
        AND property_memberships.is_active = true
    )
    OR EXISTS (
        SELECT 1 FROM properties p
        JOIN organization_memberships om ON p.organization_id = om.organization_id
        WHERE p.id = guest_requests.property_id
        AND om.user_id = auth.uid()
        AND om.is_active = true
    )
);
