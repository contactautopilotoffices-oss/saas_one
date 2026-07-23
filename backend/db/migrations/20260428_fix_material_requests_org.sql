-- Migration: Add organization_id to material_requests
-- Description: Ensures procurement requests are correctly partitioned by organization.
-- Date: 2026-04-28

ALTER TABLE material_requests ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE;

-- Update existing rows if any (optional, but good for data integrity if you know the org)
-- UPDATE material_requests SET organization_id = (SELECT organization_id FROM properties WHERE properties.id = material_requests.property_id) WHERE organization_id IS NULL;
