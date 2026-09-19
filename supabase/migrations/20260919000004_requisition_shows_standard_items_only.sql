-- Migration: 20260919000004_requisition_shows_standard_items_only.sql
-- Description: The monthly requisition offers ONLY items that came from the
--              standard Excel template. Everything already in procurement_catalog
--              predates standardisation — it was seeded from PO history and ad-hoc
--              entry — and no monthly requisition has ever been raised against it,
--              so there is nothing to protect by keeping it on the sheet.
--
-- 20260919000002 backfilled every existing row to lifecycle = 'standard', which was
-- right while 'legacy' still meant "requestable". It does not mean that any more:
--
--   standard — on the current standard template. The only thing a property is
--              offered on a new monthly requisition.
--   legacy   — predates the standard list, or was dropped from it. Stays in the
--              catalog and in Manage Items, stays resolvable by anything that
--              already references it, but is NOT offered on new requisitions.
--   retired  — deactivated (is_active = false). Gone from Manage Items too.
--
-- 'standard' is earned by appearing in an uploaded template, which is exactly what
-- import_batch_id records. Anything without one is by definition not on the
-- standard list.
--
-- Reversal (puts the pre-standardisation items back on every property's sheet):
--
--   UPDATE public.procurement_catalog
--   SET lifecycle = 'standard'
--   WHERE import_batch_id IS NULL AND lifecycle = 'legacy';

-- Guarded so re-running is a no-op once an organisation has actually adopted the
-- standard list. Without the guard, running this again later would sweep up every
-- item procurement had since added by hand (those have no import_batch_id either)
-- and quietly drop them off every property's sheet.
UPDATE public.procurement_catalog pc
SET lifecycle  = 'legacy',
    updated_at = timezone('utc'::text, now())
WHERE pc.import_batch_id IS NULL
  AND pc.lifecycle = 'standard'
  AND NOT EXISTS (
      SELECT 1
      FROM public.catalog_import_batches b
      WHERE b.organization_id = pc.organization_id
        AND b.status = 'committed'
  );

-- The requisition sheet's hot path: active standard items for an organisation.
CREATE INDEX IF NOT EXISTS idx_procurement_catalog_standard_only
    ON public.procurement_catalog (organization_id, sort_order, name)
    WHERE is_active = true AND lifecycle = 'standard';
