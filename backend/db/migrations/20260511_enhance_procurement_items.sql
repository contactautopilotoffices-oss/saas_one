-- Migration: Enhance Procurement Line Items
-- Description: Add description and links to material_request_items

ALTER TABLE material_request_items 
ADD COLUMN IF NOT EXISTS description text,
ADD COLUMN IF NOT EXISTS links text[];

-- Refresh PostgREST
NOTIFY pgrst, 'reload schema';
