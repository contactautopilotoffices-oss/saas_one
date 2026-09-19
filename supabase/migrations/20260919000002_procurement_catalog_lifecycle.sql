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
