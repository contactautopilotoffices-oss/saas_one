-- Fix: the Zoho Books sync was silently dropping genuinely distinct purchase orders.
--
-- zoho_purchase_orders was UNIQUE (organization_id, po_number) and the sync upserted
-- on that key. Zoho Books does NOT guarantee purchaseorder_number is unique — a live
-- pull of org 807372318 returned 5264 records with only 5248 distinct numbers: 16 pairs
-- of separate POs (different purchaseorder_id, different vendors, different amounts,
-- e.g. PO-26/27-0011 at 14,03,374 and 51,000) collide on number. The upsert's last-wins
-- de-dupe discarded one of each pair, understating the tracker by ~42 lakh.
--
-- purchaseorder_id IS unique (5264 distinct ids for 5264 records), so it becomes the
-- conflict key for Zoho-sourced rows.
--
-- Note on NULLs: manual / CSV POs carry zoho_po_id = NULL. Postgres treats NULLs as
-- distinct in a UNIQUE index, so many manual rows coexist under the new index without
-- colliding. Their old po_number guard is preserved by a partial unique index below.

-- 1. Drop the constraint that caused the loss.
ALTER TABLE public.zoho_purchase_orders
    DROP CONSTRAINT IF EXISTS zoho_purchase_orders_organization_id_po_number_key;

-- 2. Zoho rows are keyed by purchaseorder_id. This must be a FULL (not partial) unique
--    index: PostgREST's on_conflict cannot supply a WHERE predicate, so a partial index
--    would not be inferrable by the upsert.
CREATE UNIQUE INDEX IF NOT EXISTS uq_zpo_org_zoho_po_id
    ON public.zoho_purchase_orders (organization_id, zoho_po_id);

-- 3. Keep manual / CSV entry from duplicating a PO number by hand. Partial index is fine
--    here because those inserts do not use ON CONFLICT inference.
CREATE UNIQUE INDEX IF NOT EXISTS uq_zpo_org_po_number_manual
    ON public.zoho_purchase_orders (organization_id, po_number)
    WHERE zoho_po_id IS NULL;

-- 4. po_number is still queried and displayed; it just is not unique any more.
CREATE INDEX IF NOT EXISTS idx_zpo_po_number
    ON public.zoho_purchase_orders (organization_id, po_number);

-- 5. The old idx_zpo_zoho_id is now redundant with uq_zpo_org_zoho_po_id.
DROP INDEX IF EXISTS public.idx_zpo_zoho_id;
