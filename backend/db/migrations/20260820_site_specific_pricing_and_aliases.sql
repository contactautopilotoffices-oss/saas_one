-- =================================================================================
-- COMPLETE MIGRATION: SITE-SPECIFIC ITEM PRICING, PROPERTY ALIASES SEEDING,
-- MULTI-FLOOR REQUISITIONS & OMNICHANNEL OUTBOX WEBHOOK TRIGGERS
-- =================================================================================

-- 1. ENSURE EVENT OUTBOX TABLE EXISTS
CREATE TABLE IF NOT EXISTS event_outbox (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     uuid REFERENCES organizations(id) ON DELETE CASCADE,
    property_id         uuid REFERENCES properties(id) ON DELETE CASCADE,
    event_type          text NOT NULL,
    payload             jsonb NOT NULL DEFAULT '{}'::jsonb,
    status              text NOT NULL DEFAULT 'pending', -- 'pending', 'processing', 'completed', 'failed'
    retry_count         int DEFAULT 0,
    max_retries         int DEFAULT 3,
    error_message       text,
    processed_at        timestamptz,
    created_at          timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_event_outbox_status ON event_outbox(status, created_at);
CREATE INDEX IF NOT EXISTS idx_event_outbox_event_type ON event_outbox(event_type);

-- 2. PROPERTY ALIASES TABLE
CREATE TABLE IF NOT EXISTS property_aliases (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    property_id         uuid NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
    alias_name          text NOT NULL,
    normalized_alias    text NOT NULL,
    floor_tag           text DEFAULT 'All Floors',
    source              text DEFAULT 'PO_MAPPING',
    is_active           boolean DEFAULT true,
    created_at          timestamptz DEFAULT now(),
    UNIQUE(organization_id, normalized_alias)
);

CREATE INDEX IF NOT EXISTS idx_property_aliases_org ON property_aliases(organization_id);
CREATE INDEX IF NOT EXISTS idx_property_aliases_norm ON property_aliases(normalized_alias);

-- 3. ITEM SITE PRICES TABLE
CREATE TABLE IF NOT EXISTS item_site_prices (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    item_id             uuid NOT NULL REFERENCES procurement_catalog(id) ON DELETE CASCADE,
    property_id         uuid NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
    unit_price          numeric NOT NULL DEFAULT 0,
    currency            text DEFAULT 'INR',
    effective_from      date DEFAULT CURRENT_DATE,
    effective_to        date,
    source              text DEFAULT 'PO_HISTORICAL',
    is_active           boolean DEFAULT true,
    created_at          timestamptz DEFAULT now(),
    updated_at          timestamptz DEFAULT now(),
    UNIQUE(item_id, property_id, is_active)
);

CREATE INDEX IF NOT EXISTS idx_item_site_prices_lookup ON item_site_prices(property_id, item_id, is_active);
CREATE INDEX IF NOT EXISTS idx_item_site_prices_org ON item_site_prices(organization_id);

-- 4. MULTI-FLOOR REQUISITION SUPPORT
ALTER TABLE property_monthly_requisitions ADD COLUMN IF NOT EXISTS floor_tag text DEFAULT 'All Floors';

-- 5. SEED CANONICAL PROPERTY ALIASES AUTOMATICALLY
-- Matches canonical property names in the properties table
DO $$
DECLARE
    prop_record RECORD;
BEGIN
    -- Sigma 2nd Floor -> Rabale (Floor: 2nd Floor)
    FOR prop_record IN SELECT id, organization_id FROM properties WHERE LOWER(TRIM(name)) = 'rabale' LOOP
        INSERT INTO property_aliases (organization_id, property_id, alias_name, normalized_alias, floor_tag, source)
        VALUES (prop_record.organization_id, prop_record.id, 'Sigma 2nd Floor', 'sigma 2nd floor', '2nd Floor', 'PO_MAPPING')
        ON CONFLICT (organization_id, normalized_alias) DO UPDATE 
        SET property_id = EXCLUDED.property_id, floor_tag = EXCLUDED.floor_tag;
    END LOOP;

    -- Sigma 7th Floor -> Rabale (Floor: 7th Floor)
    FOR prop_record IN SELECT id, organization_id FROM properties WHERE LOWER(TRIM(name)) = 'rabale' LOOP
        INSERT INTO property_aliases (organization_id, property_id, alias_name, normalized_alias, floor_tag, source)
        VALUES (prop_record.organization_id, prop_record.id, 'Sigma 7th Floor', 'sigma 7th floor', '7th Floor', 'PO_MAPPING')
        ON CONFLICT (organization_id, normalized_alias) DO UPDATE 
        SET property_id = EXCLUDED.property_id, floor_tag = EXCLUDED.floor_tag;
    END LOOP;

    -- 3i - Crescent Solitaire -> 3i Cresent
    FOR prop_record IN SELECT id, organization_id FROM properties WHERE LOWER(TRIM(name)) IN ('3i cresent', '3i crescent') LOOP
        INSERT INTO property_aliases (organization_id, property_id, alias_name, normalized_alias, floor_tag, source)
        VALUES (prop_record.organization_id, prop_record.id, '3i - Crescent Solitaire', '3i crescent solitaire', 'All Floors', 'PO_MAPPING')
        ON CONFLICT (organization_id, normalized_alias) DO UPDATE 
        SET property_id = EXCLUDED.property_id, floor_tag = EXCLUDED.floor_tag;
    END LOOP;

    -- NRK Star - Indore -> Indore
    FOR prop_record IN SELECT id, organization_id FROM properties WHERE LOWER(TRIM(name)) = 'indore' LOOP
        INSERT INTO property_aliases (organization_id, property_id, alias_name, normalized_alias, floor_tag, source)
        VALUES (prop_record.organization_id, prop_record.id, 'NRK Star - Indore', 'nrk star indore', 'All Floors', 'PO_MAPPING')
        ON CONFLICT (organization_id, normalized_alias) DO UPDATE 
        SET property_id = EXCLUDED.property_id, floor_tag = EXCLUDED.floor_tag;
    END LOOP;

    -- Sky mark - Noida -> Noida
    FOR prop_record IN SELECT id, organization_id FROM properties WHERE LOWER(TRIM(name)) = 'noida' LOOP
        INSERT INTO property_aliases (organization_id, property_id, alias_name, normalized_alias, floor_tag, source)
        VALUES (prop_record.organization_id, prop_record.id, 'Sky mark - Noida', 'sky mark noida', 'All Floors', 'PO_MAPPING')
        ON CONFLICT (organization_id, normalized_alias) DO UPDATE 
        SET property_id = EXCLUDED.property_id, floor_tag = EXCLUDED.floor_tag;
    END LOOP;

    -- Mafatlal Chember - A -> Mafatlal Chambers , A wing
    FOR prop_record IN SELECT id, organization_id FROM properties WHERE LOWER(TRIM(name)) LIKE '%mafatlal%a%' LOOP
        INSERT INTO property_aliases (organization_id, property_id, alias_name, normalized_alias, floor_tag, source)
        VALUES (prop_record.organization_id, prop_record.id, 'Mafatlal Chember - A', 'mafatlal chember a', 'A Wing', 'PO_MAPPING')
        ON CONFLICT (organization_id, normalized_alias) DO UPDATE 
        SET property_id = EXCLUDED.property_id, floor_tag = EXCLUDED.floor_tag;
    END LOOP;

    -- B wing - Mafatlal -> Mafatlal Chambers , B wing
    FOR prop_record IN SELECT id, organization_id FROM properties WHERE LOWER(TRIM(name)) LIKE '%mafatlal%b%' LOOP
        INSERT INTO property_aliases (organization_id, property_id, alias_name, normalized_alias, floor_tag, source)
        VALUES (prop_record.organization_id, prop_record.id, 'B wing - Mafatlal', 'b wing mafatlal', 'B Wing', 'PO_MAPPING')
        ON CONFLICT (organization_id, normalized_alias) DO UPDATE 
        SET property_id = EXCLUDED.property_id, floor_tag = EXCLUDED.floor_tag;
    END LOOP;

    -- C WING -> Mafatlal Chambers , C wing
    FOR prop_record IN SELECT id, organization_id FROM properties WHERE LOWER(TRIM(name)) LIKE '%mafatlal%c%' LOOP
        INSERT INTO property_aliases (organization_id, property_id, alias_name, normalized_alias, floor_tag, source)
        VALUES (prop_record.organization_id, prop_record.id, 'C WING', 'c wing', 'C Wing', 'PO_MAPPING')
        ON CONFLICT (organization_id, normalized_alias) DO UPDATE 
        SET property_id = EXCLUDED.property_id, floor_tag = EXCLUDED.floor_tag;
    END LOOP;

    -- D WING -> Mafatlal Chambers , D wing
    FOR prop_record IN SELECT id, organization_id FROM properties WHERE LOWER(TRIM(name)) LIKE '%mafatlal%d%' LOOP
        INSERT INTO property_aliases (organization_id, property_id, alias_name, normalized_alias, floor_tag, source)
        VALUES (prop_record.organization_id, prop_record.id, 'D WING', 'd wing', 'D Wing', 'PO_MAPPING')
        ON CONFLICT (organization_id, normalized_alias) DO UPDATE 
        SET property_id = EXCLUDED.property_id, floor_tag = EXCLUDED.floor_tag;
    END LOOP;

    -- Mahindra Finance - Delhi -> Mahindra Finance - Delhi
    FOR prop_record IN SELECT id, organization_id FROM properties WHERE LOWER(TRIM(name)) LIKE '%mahindra%finance%delhi%' LOOP
        INSERT INTO property_aliases (organization_id, property_id, alias_name, normalized_alias, floor_tag, source)
        VALUES (prop_record.organization_id, prop_record.id, 'Mahindra Finance - Delhi', 'mahindra finance delhi', 'All Floors', 'PO_MAPPING')
        ON CONFLICT (organization_id, normalized_alias) DO UPDATE 
        SET property_id = EXCLUDED.property_id, floor_tag = EXCLUDED.floor_tag;
    END LOOP;
END $$;

-- 6. OMNICHANNEL OUTBOX DATABASE TRIGGER & FUNCTION
-- Guarantees that any requisition creation or status update anywhere triggers an event_outbox row
CREATE OR REPLACE FUNCTION trg_fn_requisition_outbox_notifier()
RETURNS TRIGGER AS $$
DECLARE
    v_event_type text;
    v_payload jsonb;
BEGIN
    IF (TG_OP = 'INSERT') THEN
        v_event_type := 'REQUISITION_UPLOADED';
    ELSIF (TG_OP = 'UPDATE') THEN
        IF (NEW.status = 'pending_approval' AND OLD.status != 'pending_approval') THEN
            v_event_type := 'REQUISITION_APPROVAL_REQUESTED';
        ELSIF (NEW.status = 'approved' AND OLD.status != 'approved') THEN
            v_event_type := 'REQUISITION_APPROVED';
        ELSIF (NEW.status = 'rejected' AND OLD.status != 'rejected') THEN
            v_event_type := 'REQUISITION_REJECTED';
        ELSE
            v_event_type := 'REQUISITION_UPDATED';
        END IF;
    END IF;

    -- Construct outbox event payload
    v_payload := jsonb_build_object(
        'requisition_id', NEW.id,
        'organization_id', NEW.organization_id,
        'property_id', NEW.property_id,
        'floor_tag', COALESCE(NEW.floor_tag, 'All Floors'),
        'requisition_month', NEW.requisition_month,
        'requisition_year', NEW.requisition_year,
        'file_name', NEW.file_name,
        'file_url', NEW.file_url,
        'status', NEW.status,
        'uploaded_by', NEW.uploaded_by,
        'notes', NEW.notes,
        'timestamp', now()
    );

    -- Insert outbox event for async queue / webhook processor
    INSERT INTO event_outbox (
        organization_id,
        property_id,
        event_type,
        payload,
        status
    ) VALUES (
        NEW.organization_id,
        NEW.property_id,
        v_event_type,
        v_payload,
        'pending'
    );

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Bind Trigger to property_monthly_requisitions
DROP TRIGGER IF EXISTS trg_requisition_outbox_event ON property_monthly_requisitions;
CREATE TRIGGER trg_requisition_outbox_event
AFTER INSERT OR UPDATE ON property_monthly_requisitions
FOR EACH ROW
EXECUTE FUNCTION trg_fn_requisition_outbox_notifier();

-- 7. RLS POLICIES
ALTER TABLE property_aliases ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS property_aliases_select ON property_aliases;
CREATE POLICY property_aliases_select ON property_aliases FOR SELECT USING (auth.role() = 'authenticated');
DROP POLICY IF EXISTS property_aliases_all ON property_aliases;
CREATE POLICY property_aliases_all ON property_aliases FOR ALL USING (auth.role() = 'authenticated');

ALTER TABLE item_site_prices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS item_site_prices_select ON item_site_prices;
CREATE POLICY item_site_prices_select ON item_site_prices FOR SELECT USING (auth.role() = 'authenticated');
DROP POLICY IF EXISTS item_site_prices_all ON item_site_prices;
CREATE POLICY item_site_prices_all ON item_site_prices FOR ALL USING (auth.role() = 'authenticated');
