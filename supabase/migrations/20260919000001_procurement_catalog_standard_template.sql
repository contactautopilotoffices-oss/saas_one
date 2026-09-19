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
