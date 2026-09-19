-- Migration: 20260919000005_procurement_catalog_required_columns.sql
-- Description: Guarantee every procurement_catalog column the standard-items
--              feature depends on, regardless of which historical migration
--              directory was applied to a given database.
--
-- WHY THIS EXISTS:
--   brand, color_size_details and unit_price were introduced by
--   backend/db/migrations/20260819_enhanced_monthly_requisitions.sql. That
--   directory is not what `supabase db push` applies, and on the live database
--   it never ran — procurement_catalog there is still:
--
--     id, organization_id, name, description, category, unit, estimated_price,
--     photo_url, photo_data, stock_item_id, is_active, created_at, updated_at
--
--   The standard template maps its "brands" column to brand and its "final rate"
--   column to unit_price, so without these the import and the Manage Items editor
--   both fail. Adding them here makes the feature self-contained instead of
--   dependent on a migration that may or may not have been run.
--
--   Every statement is idempotent, so this is a no-op on a database that already
--   had 20260819 applied.

ALTER TABLE IF EXISTS public.procurement_catalog
ADD COLUMN IF NOT EXISTS brand              TEXT,
ADD COLUMN IF NOT EXISTS color_size_details TEXT,
ADD COLUMN IF NOT EXISTS unit_price         NUMERIC DEFAULT 0;

-- Carry the existing price across, so nothing loses its rate the moment the
-- requisition sheet starts preferring unit_price over estimated_price.
UPDATE public.procurement_catalog
SET unit_price = COALESCE(estimated_price, 0)
WHERE COALESCE(unit_price, 0) = 0
  AND COALESCE(estimated_price, 0) <> 0;
