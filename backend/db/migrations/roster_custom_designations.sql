-- =========================================================
-- ADD CUSTOM DESIGNATION FOR ROSTER
-- =========================================================

-- Add custom_designation to property_memberships
ALTER TABLE property_memberships
ADD COLUMN IF NOT EXISTS custom_designation text;
