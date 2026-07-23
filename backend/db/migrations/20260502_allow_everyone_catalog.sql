-- Allow all authenticated users to add items to the procurement catalog
-- The API will handle organization-level validation

ALTER TABLE procurement_catalog ADD COLUMN IF NOT EXISTS photo_data text;

DROP POLICY IF EXISTS catalog_insert ON procurement_catalog;
CREATE POLICY catalog_insert ON procurement_catalog FOR INSERT WITH CHECK (
    auth.role() = 'authenticated'
);

-- Ensure they can also update their own items if needed (optional but good)
DROP POLICY IF EXISTS catalog_update ON procurement_catalog;
CREATE POLICY catalog_update ON procurement_catalog FOR UPDATE USING (
    EXISTS (SELECT 1 FROM organization_memberships WHERE user_id = auth.uid() AND organization_id = procurement_catalog.organization_id)
);
