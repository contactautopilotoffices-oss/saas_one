-- =============================================================================
-- STANDARDISED MONTHLY REQUISITION ITEMS - full database upgrade
--
-- Run this once, top to bottom, in the Supabase SQL editor.
-- Every statement is idempotent, so re-running it is safe.
--
-- Same content as supabase/migrations/20260919*.sql, concatenated in dependency
-- order. If you deploy with "supabase db push" instead, you do NOT need this file.
--
-- AFTER RUNNING, EXPECT:
--   Manage Items -> Standard 0, Legacy 90. That is STEP 5 doing its job: nothing
--                   has come off a standard template yet.
--   Requisition  -> empty, showing "No standard items yet".
--   Upload your template from Manage Items > Upload Excel and both fill in.
--
-- A verification query is at the bottom, after the COMMIT.
-- =============================================================================

BEGIN;


-- =============================================================================
-- STEP 1 of 5 - Columns the feature needs that this database never got (brand / rate)
-- source: supabase/migrations/20260919000005_procurement_catalog_required_columns.sql
-- =============================================================================

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


-- =============================================================================
-- STEP 2 of 5 - Template import support + import batch table
-- source: supabase/migrations/20260919000001_procurement_catalog_standard_template.sql
-- =============================================================================

-- Migration: 20260919000001_procurement_catalog_standard_template.sql
-- Description: Standardised monthly-requisition item master.
--              Adds a stable item_code upsert key, display sort order and import
--              provenance to procurement_catalog, plus a catalog_import_batches
--              table so every Excel template upload is previewable and auditable.

-- =================================================================
-- 1. PROCUREMENT CATALOG — TEMPLATE IMPORT SUPPORT
-- =================================================================
ALTER TABLE IF EXISTS public.procurement_catalog
ADD COLUMN IF NOT EXISTS item_code       TEXT,
ADD COLUMN IF NOT EXISTS sort_order      INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS import_batch_id UUID,
ADD COLUMN IF NOT EXISTS deactivated_at  TIMESTAMPTZ;

-- item_code is the stable upsert key: renaming an item must update the existing
-- row, not create a duplicate. Unique per organization, case-insensitive.
CREATE UNIQUE INDEX IF NOT EXISTS uq_procurement_catalog_org_item_code
    ON public.procurement_catalog (organization_id, lower(item_code))
    WHERE item_code IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_procurement_catalog_org_active
    ON public.procurement_catalog (organization_id, is_active, sort_order);

-- =================================================================
-- 2. CATALOG IMPORT BATCHES
--    One row per uploaded template. Rows are staged on preview and only
--    written into procurement_catalog when the batch is committed.
-- =================================================================
CREATE TABLE IF NOT EXISTS public.catalog_import_batches (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id   UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    uploaded_by       UUID REFERENCES public.users(id) ON DELETE SET NULL,
    file_name         TEXT,
    file_url          TEXT,
    row_count         INTEGER DEFAULT 0,
    created_count     INTEGER DEFAULT 0,
    updated_count     INTEGER DEFAULT 0,
    unchanged_count   INTEGER DEFAULT 0,
    deactivated_count INTEGER DEFAULT 0,
    error_count       INTEGER DEFAULT 0,
    photo_count       INTEGER DEFAULT 0,
    status            TEXT NOT NULL DEFAULT 'previewed',
    staged_rows       JSONB NOT NULL DEFAULT '[]'::jsonb,
    errors            JSONB NOT NULL DEFAULT '[]'::jsonb,
    committed_at      TIMESTAMPTZ,
    expires_at        TIMESTAMPTZ DEFAULT (timezone('utc'::text, now()) + interval '24 hours'),
    created_at        TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.catalog_import_batches
DROP CONSTRAINT IF EXISTS catalog_import_batches_status_check;

ALTER TABLE public.catalog_import_batches
ADD CONSTRAINT catalog_import_batches_status_check
CHECK (status IN ('previewed', 'committed', 'expired', 'cancelled'));

CREATE INDEX IF NOT EXISTS idx_catalog_import_batches_org
    ON public.catalog_import_batches (organization_id, created_at DESC);

-- =================================================================
-- 3. ROW LEVEL SECURITY
--    Reads/writes go through the service-role API routes, which enforce the
--    procurement role gate. Authenticated read access mirrors the existing
--    procurement tables (item_site_prices, requisition_items).
-- =================================================================
ALTER TABLE public.catalog_import_batches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS catalog_import_batches_select ON public.catalog_import_batches;
CREATE POLICY catalog_import_batches_select ON public.catalog_import_batches
    FOR SELECT USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS catalog_import_batches_modify ON public.catalog_import_batches;
CREATE POLICY catalog_import_batches_modify ON public.catalog_import_batches
    FOR ALL USING (auth.role() = 'authenticated');

-- =================================================================
-- 4. BACKFILL item_code FOR EXISTING CATALOG ROWS
--    Existing items have no code. Generate a deterministic one so the very
--    first template export round-trips without creating duplicates.
-- =================================================================
UPDATE public.procurement_catalog
SET item_code = 'ITM-' || upper(substring(replace(id::text, '-', '') from 1 for 8))
WHERE item_code IS NULL;


-- =============================================================================
-- STEP 3 of 5 - Item lifecycle + import rollback support
-- source: supabase/migrations/20260919000002_procurement_catalog_lifecycle.sql
-- =============================================================================

-- Migration: 20260919000002_procurement_catalog_lifecycle.sql
-- Description: Safe production migration path to the standardised item master.
--
--              Adds a three-state lifecycle to procurement_catalog so that
--              adopting the standard list never has to remove an item a site is
--              still using. `is_active` stays the hard visibility gate that the
--              rest of the app already reads; `lifecycle` only adds the
--              standard-vs-legacy distinction on top of it.
--
--                standard  → on the standard template, shown as the standard list
--                legacy    → pre-standardisation item, STILL fully usable and
--                            requestable, grouped separately and marked as being
--                            phased out (is_active stays true)
--                retired   → hidden from new requisitions (is_active = false),
--                            never deleted, so past requisitions and stock rows
--                            keep resolving
--
--              Existing rows default to 'standard', i.e. this migration changes
--              nothing that users can see.

ALTER TABLE IF EXISTS public.procurement_catalog
ADD COLUMN IF NOT EXISTS lifecycle TEXT NOT NULL DEFAULT 'standard';

ALTER TABLE public.procurement_catalog
DROP CONSTRAINT IF EXISTS procurement_catalog_lifecycle_check;

ALTER TABLE public.procurement_catalog
ADD CONSTRAINT procurement_catalog_lifecycle_check
CHECK (lifecycle IN ('standard', 'legacy', 'retired'));

-- Keep the two columns consistent for any row that is already deactivated.
UPDATE public.procurement_catalog
SET lifecycle = 'retired'
WHERE is_active = false AND lifecycle <> 'retired';

CREATE INDEX IF NOT EXISTS idx_procurement_catalog_lifecycle
    ON public.procurement_catalog (organization_id, lifecycle)
    WHERE is_active = true;

-- =================================================================
-- IMPORT BATCH ROLLBACK SUPPORT
--   A committed import can be undone: staged_rows already records the
--   before/after of every field it changed, and lifecycle_changes records
--   what the commit did to items that were absent from the file.
-- =================================================================
ALTER TABLE IF EXISTS public.catalog_import_batches
ADD COLUMN IF NOT EXISTS legacy_count       INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS lifecycle_changes  JSONB NOT NULL DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS rolled_back_at     TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS rolled_back_by     UUID REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE public.catalog_import_batches
DROP CONSTRAINT IF EXISTS catalog_import_batches_status_check;

ALTER TABLE public.catalog_import_batches
ADD CONSTRAINT catalog_import_batches_status_check
CHECK (status IN ('previewed', 'committed', 'expired', 'cancelled', 'rolled_back'));


-- =============================================================================
-- STEP 4 of 5 - Retire per-property rate overrides - one rate everywhere
-- source: supabase/migrations/20260919000003_supersede_item_site_price_overrides.sql
-- =============================================================================

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


-- =============================================================================
-- STEP 5 of 5 - Pre-standardisation items become legacy (off the requisition sheet)
-- source: supabase/migrations/20260919000004_requisition_shows_standard_items_only.sql
-- =============================================================================

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


COMMIT;

-- =============================================================================
-- VERIFY - run these after the COMMIT above
-- =============================================================================

-- 1. Every column the feature needs should be present (expect 8 rows).
SELECT column_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'procurement_catalog'
  AND column_name IN ('brand', 'color_size_details', 'unit_price',
                      'item_code', 'sort_order', 'import_batch_id',
                      'deactivated_at', 'lifecycle')
ORDER BY column_name;

-- 2. Where the catalog landed. Before any template upload every item should be
--    'legacy' - that is correct, not a fault.
SELECT lifecycle, count(*) AS items
FROM public.procurement_catalog
WHERE is_active = true
GROUP BY lifecycle
ORDER BY lifecycle;

-- 3. Per-property rate overrides should now all be superseded (still_active = 0).
SELECT count(*) FILTER (WHERE is_superseded)     AS superseded,
       count(*) FILTER (WHERE NOT is_superseded) AS still_active
FROM public.item_site_prices
WHERE is_active = true;
