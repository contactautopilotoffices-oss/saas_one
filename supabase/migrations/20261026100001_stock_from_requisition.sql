-- Migration: 20261026100001_stock_from_requisition.sql
-- Description: Stock management driven by the monthly requisition item list.
--
--   1. stock_items.item_source: 'legacy' (a property's own old list) or 'catalog'
--      (one row per requisition item). Every existing row becomes 'legacy' through
--      the default, so nothing changes for anyone until a property is switched.
--   2. property_stock_settings: the per-property switch between the two lists.
--   3. requisition_deliveries / requisition_delivery_items: delivery challans
--      uploaded against approved monthly requisitions.
--   4. confirm_requisition_delivery(): posts a confirmed challan into stock in one
--      transaction (stock quantity + stock_movements row per item).
--
-- Additive only. No column is dropped and no existing row is rewritten.
BEGIN;

-- 1. WHERE EACH STOCK ROW CAME FROM
ALTER TABLE public.stock_items
    ADD COLUMN IF NOT EXISTS item_source TEXT NOT NULL DEFAULT 'legacy';

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stock_items_item_source_check') THEN
        ALTER TABLE public.stock_items
            ADD CONSTRAINT stock_items_item_source_check CHECK (item_source IN ('legacy', 'catalog'));
    END IF;
END $$;

-- One requisition-list row per catalog item per property, so adding missing
-- items can be re-run safely.
CREATE UNIQUE INDEX IF NOT EXISTS uq_stock_items_catalog_per_property
    ON public.stock_items (property_id, catalog_item_id)
    WHERE item_source = 'catalog';

-- 2. PER-PROPERTY SWITCH
CREATE TABLE IF NOT EXISTS public.property_stock_settings (
    property_id      UUID PRIMARY KEY REFERENCES public.properties(id) ON DELETE CASCADE,
    organization_id  UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    item_source      TEXT NOT NULL DEFAULT 'legacy' CHECK (item_source IN ('legacy', 'catalog')),
    switched_at      TIMESTAMPTZ,
    switched_by      UUID REFERENCES public.users(id),
    updated_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_property_stock_settings_org
    ON public.property_stock_settings (organization_id);

ALTER TABLE public.property_stock_settings ENABLE ROW LEVEL SECURITY;

-- Read only for the property's people. Writes go through the API (service role).
DROP POLICY IF EXISTS property_stock_settings_read ON public.property_stock_settings;
CREATE POLICY property_stock_settings_read ON public.property_stock_settings FOR SELECT USING (
    public.is_master_admin_v2()
    OR public.is_org_admin_v2(organization_id)
    OR public.is_property_member_v2(property_id)
);

-- 3. DELIVERY CHALLANS
CREATE TABLE IF NOT EXISTS public.requisition_deliveries (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id  UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    property_id      UUID NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
    requisition_id   UUID NOT NULL REFERENCES public.property_monthly_requisitions(id) ON DELETE CASCADE,
    challan_number   TEXT,
    challan_date     DATE,
    file_url         TEXT NOT NULL,
    file_name        TEXT,
    status           TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'cancelled')),
    total_items      INTEGER NOT NULL DEFAULT 0,
    total_qty        NUMERIC NOT NULL DEFAULT 0,
    idempotency_key  UUID NOT NULL,
    confirmed_by     UUID REFERENCES public.users(id),
    confirmed_at     TIMESTAMPTZ DEFAULT NOW(),
    created_at       TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (requisition_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_requisition_deliveries_requisition
    ON public.requisition_deliveries (requisition_id);

CREATE TABLE IF NOT EXISTS public.requisition_delivery_items (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    delivery_id      UUID NOT NULL REFERENCES public.requisition_deliveries(id) ON DELETE CASCADE,
    catalog_item_id  UUID REFERENCES public.procurement_catalog(id) ON DELETE SET NULL,
    stock_item_id    UUID REFERENCES public.stock_items(id) ON DELETE SET NULL,
    item_name        TEXT NOT NULL,
    unit             TEXT,
    ordered_qty      NUMERIC NOT NULL DEFAULT 0,
    received_qty     NUMERIC NOT NULL DEFAULT 0,
    remarks          TEXT,
    movement_id      UUID REFERENCES public.stock_movements(id) ON DELETE SET NULL,
    created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_requisition_delivery_items_delivery
    ON public.requisition_delivery_items (delivery_id);

ALTER TABLE public.stock_movements
    ADD COLUMN IF NOT EXISTS delivery_id UUID REFERENCES public.requisition_deliveries(id) ON DELETE SET NULL;

ALTER TABLE public.requisition_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.requisition_delivery_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS requisition_deliveries_read ON public.requisition_deliveries;
CREATE POLICY requisition_deliveries_read ON public.requisition_deliveries FOR SELECT USING (
    public.is_master_admin_v2()
    OR public.is_org_admin_v2(organization_id)
    OR public.is_property_member_v2(property_id)
);

DROP POLICY IF EXISTS requisition_delivery_items_read ON public.requisition_delivery_items;
CREATE POLICY requisition_delivery_items_read ON public.requisition_delivery_items FOR SELECT USING (
    EXISTS (
        SELECT 1 FROM public.requisition_deliveries d
        WHERE d.id = requisition_delivery_items.delivery_id
          AND (public.is_master_admin_v2()
               OR public.is_org_admin_v2(d.organization_id)
               OR public.is_property_member_v2(d.property_id))
    )
);

-- 4. CONFIRM A CHALLAN INTO STOCK
-- Called only by the API (service role) after it has checked that the caller is
-- a property admin of the requisition's property and worked out each line's
-- ordered quantity from the requisition itself.
--
-- p_lines: [{ catalog_item_id, item_name, unit, ordered_qty, received_qty, remarks }]
CREATE OR REPLACE FUNCTION public.confirm_requisition_delivery(
    p_actor           UUID,
    p_requisition_id  UUID,
    p_challan_number  TEXT,
    p_challan_date    DATE,
    p_file_url        TEXT,
    p_file_name       TEXT,
    p_idempotency_key UUID,
    p_lines           JSONB
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    r          property_monthly_requisitions;
    d          requisition_deliveries;
    s          stock_items;
    line       JSONB;
    v_catalog  UUID;
    v_qty      NUMERIC;
    v_ordered  NUMERIC;
    v_already  NUMERIC;
    v_movement UUID;
    v_count    INTEGER := 0;
    v_total    NUMERIC := 0;
BEGIN
    IF p_idempotency_key IS NULL THEN RAISE EXCEPTION 'Idempotency key required'; END IF;

    -- Lock the requisition so two challans for it cannot be posted at once.
    SELECT * INTO r FROM property_monthly_requisitions WHERE id = p_requisition_id FOR UPDATE;
    IF r.id IS NULL THEN RAISE EXCEPTION 'Requisition not found'; END IF;

    -- Same submit sent twice (double click, retry): return the first result.
    SELECT * INTO d FROM requisition_deliveries
    WHERE requisition_id = r.id AND idempotency_key = p_idempotency_key;
    IF d.id IS NOT NULL THEN RETURN to_jsonb(d); END IF;

    IF r.status NOT IN ('approved', 'ordered') THEN
        RAISE EXCEPTION 'This requisition is not approved yet';
    END IF;
    IF coalesce(trim(p_file_url), '') = '' THEN RAISE EXCEPTION 'Challan file is required'; END IF;
    IF jsonb_typeof(p_lines) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'No items received'; END IF;

    INSERT INTO requisition_deliveries (
        organization_id, property_id, requisition_id, challan_number, challan_date,
        file_url, file_name, idempotency_key, confirmed_by
    ) VALUES (
        r.organization_id, r.property_id, r.id, nullif(trim(p_challan_number), ''), p_challan_date,
        p_file_url, p_file_name, p_idempotency_key, p_actor
    ) RETURNING * INTO d;

    FOR line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
        v_catalog := nullif(line->>'catalog_item_id', '')::uuid;
        v_qty     := (line->>'received_qty')::numeric;
        v_ordered := coalesce((line->>'ordered_qty')::numeric, 0);

        IF v_catalog IS NULL THEN RAISE EXCEPTION 'Item % is not on the requisition list', line->>'item_name'; END IF;
        IF v_qty IS NULL OR v_qty < 0 OR v_qty::text = 'NaN' THEN
            RAISE EXCEPTION 'Invalid received quantity for %', line->>'item_name';
        END IF;
        CONTINUE WHEN v_qty = 0;

        -- Everything already received for this item on this requisition,
        -- including earlier lines of this same challan.
        SELECT coalesce(sum(i.received_qty), 0) INTO v_already
        FROM requisition_delivery_items i
        JOIN requisition_deliveries dd ON dd.id = i.delivery_id
        WHERE dd.requisition_id = r.id AND dd.status = 'confirmed' AND i.catalog_item_id = v_catalog;

        IF v_already + v_qty > v_ordered THEN
            RAISE EXCEPTION 'Received quantity for % is more than what is pending (%)',
                line->>'item_name', greatest(v_ordered - v_already, 0);
        END IF;

        SELECT * INTO s FROM stock_items
        WHERE property_id = r.property_id AND catalog_item_id = v_catalog AND item_source = 'catalog'
        FOR UPDATE;
        IF s.id IS NULL THEN RAISE EXCEPTION 'Stock item missing for %', line->>'item_name'; END IF;

        UPDATE stock_items SET quantity = s.quantity + v_qty, updated_at = NOW() WHERE id = s.id;

        INSERT INTO stock_movements (
            item_id, property_id, organization_id, action, quantity_change,
            quantity_before, quantity_after, user_id, notes, delivery_id
        ) VALUES (
            s.id, r.property_id, r.organization_id, 'add', v_qty,
            s.quantity, s.quantity + v_qty, p_actor,
            'Delivery challan' || coalesce(' ' || nullif(trim(p_challan_number), ''), ''), d.id
        ) RETURNING id INTO v_movement;

        INSERT INTO requisition_delivery_items (
            delivery_id, catalog_item_id, stock_item_id, item_name, unit,
            ordered_qty, received_qty, remarks, movement_id
        ) VALUES (
            d.id, v_catalog, s.id, coalesce(line->>'item_name', s.name), line->>'unit',
            v_ordered, v_qty, nullif(trim(line->>'remarks'), ''), v_movement
        );

        v_count := v_count + 1;
        v_total := v_total + v_qty;
    END LOOP;

    IF v_count = 0 THEN RAISE EXCEPTION 'Enter the received quantity for at least one item'; END IF;

    UPDATE requisition_deliveries SET total_items = v_count, total_qty = v_total
    WHERE id = d.id RETURNING * INTO d;

    RETURN to_jsonb(d);
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_requisition_delivery(UUID, UUID, TEXT, DATE, TEXT, TEXT, UUID, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_requisition_delivery(UUID, UUID, TEXT, DATE, TEXT, TEXT, UUID, JSONB) TO service_role;

COMMIT;
