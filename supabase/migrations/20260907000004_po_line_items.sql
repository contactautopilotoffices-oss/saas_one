-- ============================================================================
-- PURCHASE ORDER LINE ITEMS — what was actually ordered, not just the total.
-- ----------------------------------------------------------------------------
-- WHY THIS EXISTS
--
-- The Zoho sync calls the purchase-order LIST endpoint. That payload carries
-- the header only: vendor, total, status, dates, branch, reference number,
-- billed flag. It carries no line items at all, so everything the business
-- actually argues about was invisible to us:
--
--   · "Period - 01.04.2026 to 31.06.2026" — a quarterly AMC already ordered,
--     then re-ordered annually from the same start date. The overlap is in the
--     line DESCRIPTION.
--   · 2nd Floor 14 machines → 30 — a quantity.
--   · "scaffolding Ns032, 10 @ ₹3,520 = ₹35,200" — the one duplicate in this
--     org where cash actually left. The recoverable figure IS the item_total.
--   · A vendor change repricing the same work: only comparable per unit, and
--     the unit is on the line.
--
-- Ira could see that Keywest appeared twice on one proforma. It could not see
-- what was on it, so it said "if more than one has been paid" where a person
-- said "₹35,200, raise a debit note".
--
-- WHAT IS STORED
--   · one row per Zoho line item, with the fields findings are built on
--     promoted to columns and the whole line kept in `raw` for the rest;
--   · on the PO, everything ELSE the detail endpoint adds (notes, terms,
--     approver, submitted_by, attachment metadata, custom fields) as `detail`,
--     with line_items stripped out so it is not stored twice.
--
-- WHAT IS NOT
--   Bills and vendor payments. "Billed" we now know; "paid twice" still needs
--   a separate sync, and until it exists no finding may claim cash is out.
--
-- COST OF THE BACKFILL
--   One API call per PO. 5,493 held for this org, against a daily Zoho quota
--   the account reports as ~10,000 — so the backfill is budgeted per run and
--   resumable off detail_synced_at rather than done in one pass.
-- ============================================================================

-- --- the PO gains the rest of its own record --------------------------------
ALTER TABLE public.zoho_purchase_orders
    ADD COLUMN IF NOT EXISTS detail            JSONB,
    ADD COLUMN IF NOT EXISTS detail_synced_at  TIMESTAMPTZ;

COMMENT ON COLUMN public.zoho_purchase_orders.detail IS
    'Zoho purchaseorders/{id} payload MINUS line_items (those are rows in zoho_po_line_items). Notes, terms, approver_id, submitted_by, documents, custom_fields.';
COMMENT ON COLUMN public.zoho_purchase_orders.detail_synced_at IS
    'When the detail endpoint was last read for this PO. NULL = header only; the line-item sync picks these up first, then anything modified since.';

-- Resumability: the sync asks for "not yet fetched, or fetched before the PO
-- last changed", newest first.
CREATE INDEX IF NOT EXISTS idx_zpo_detail_pending
    ON public.zoho_purchase_orders (organization_id, detail_synced_at NULLS FIRST, po_date DESC);

-- --- the lines themselves ----------------------------------------------------
CREATE TABLE IF NOT EXISTS public.zoho_po_line_items (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    po_id               UUID NOT NULL REFERENCES public.zoho_purchase_orders(id) ON DELETE CASCADE,
    -- Kept alongside po_id because Zoho's own id is what an API re-read matches
    -- on, and because purchaseorder_number is NOT unique in this org.
    zoho_po_id          TEXT NOT NULL,
    line_item_id        TEXT NOT NULL,
    item_id             TEXT,                       -- the catalogue item, when there is one
    item_order          INTEGER,
    name                TEXT,
    description         TEXT,                       -- where contract periods and floors are written
    hsn_or_sac          TEXT,
    unit                TEXT,                       -- nos / month / service — the divisor arguments live here
    quantity            NUMERIC(16,4),
    quantity_billed     NUMERIC(16,4),
    quantity_received   NUMERIC(16,4),
    rate                NUMERIC(16,4),
    item_total          NUMERIC(16,2),
    tax_percentage      NUMERIC(6,2),
    account_name        TEXT,
    raw                 JSONB,
    synced_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (organization_id, zoho_po_id, line_item_id)
);

COMMENT ON TABLE public.zoho_po_line_items IS
    'One row per Zoho purchase-order line. Written only by the line-item sync; never edited by hand.';

-- The three shapes every planned check reads:
--   same item across vendors/sites (rate change on a handover),
--   same vendor across time (rate creep),
--   the lines of one order (rendering a finding).
CREATE INDEX IF NOT EXISTS idx_zpoli_item   ON public.zoho_po_line_items (organization_id, item_id);
CREATE INDEX IF NOT EXISTS idx_zpoli_po     ON public.zoho_po_line_items (po_id, item_order);
CREATE INDEX IF NOT EXISTS idx_zpoli_name   ON public.zoho_po_line_items (organization_id, lower(name));

-- --- RLS: read for members of the org, same model as the PO table -----------
ALTER TABLE public.zoho_po_line_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "acct members read po lines" ON public.zoho_po_line_items;
CREATE POLICY "acct members read po lines" ON public.zoho_po_line_items FOR SELECT USING (
    EXISTS (SELECT 1 FROM organization_memberships om
            WHERE om.user_id = auth.uid() AND om.organization_id = zoho_po_line_items.organization_id AND om.is_active)
);
