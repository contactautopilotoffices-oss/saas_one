-- Add hide_from_roster flag to property_memberships
-- Default to false so existing & newly added users remain visible in roster until explicitly hidden from roster view
ALTER TABLE public.property_memberships 
ADD COLUMN IF NOT EXISTS hide_from_roster BOOLEAN DEFAULT FALSE;
