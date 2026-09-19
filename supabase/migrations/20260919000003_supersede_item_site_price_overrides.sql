-- Migration: 20260919000003_supersede_item_site_price_overrides.sql
-- Description: Standardisation means one rate everywhere. This retires the existing
--              per-property rate overrides so the rate on the uploaded standard
--              template is the only rate a property sees.
--
-- WHY NOT is_active = false:
--   item_site_prices carries UNIQUE(item_id, property_id, is_active), so at most one
--   INACTIVE row may exist per item/property. Flipping the active rows would collide
--   with any historical row already sitting there, and clearing the way would mean
--   deleting price history on a production database. It would also break
--   POST /api/procurement/pricing, whose upsert targets that exact constraint.
--
--   So the rows are marked superseded instead. Nothing is deleted, nothing is
--   flipped, the constraint is untouched, and the reversal is one statement:
--
--     UPDATE public.item_site_prices
--     SET is_superseded = false, superseded_at = NULL, superseded_reason = NULL
--     WHERE superseded_reason = 'STANDARD_CATALOG_ADOPTION';
--
-- READ PATH: PricingAndAliasService.getCatalogWithSitePrices skips superseded rows.
--   It reads them with select('*') and filters in JS, so it keeps working whether or
--   not this migration has been applied.

ALTER TABLE IF EXISTS public.item_site_prices
ADD COLUMN IF NOT EXISTS is_superseded     BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS superseded_at     TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS superseded_reason TEXT;

-- Retire every override currently in force. effective_to records the end of the
-- rate for anyone reading this table as a price history later on.
UPDATE public.item_site_prices
SET is_superseded     = true,
    superseded_at     = timezone('utc'::text, now()),
    superseded_reason = 'STANDARD_CATALOG_ADOPTION',
    effective_to      = COALESCE(effective_to, CURRENT_DATE),
    updated_at        = timezone('utc'::text, now())
WHERE is_active = true
  AND is_superseded = false;

-- Lookups now care about the superseded flag as well.
CREATE INDEX IF NOT EXISTS idx_item_site_prices_active_lookup
    ON public.item_site_prices (property_id, item_id)
    WHERE is_active = true AND is_superseded = false;
