-- ============================================================================
-- CAFETERIA FOOD VENDOR DAILY REVENUE & COMMISSION OUTBOX TRIGGER
-- Automatically generates event_outbox records when vendors record or update
-- their daily revenue and calculates their commission.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_vendor_daily_revenue_outbox()
RETURNS TRIGGER AS $$
DECLARE
    v_event_type TEXT := 'VENDOR_REVENUE_RECORDED';
    v_payload JSONB;
    v_org_id UUID;
    v_property_name TEXT;
    v_shop_name TEXT;
    v_owner_name TEXT;
    v_commission_rate NUMERIC := 10;
    v_commission_due NUMERIC := 0;
    v_vendor_user_id UUID;
    v_vendor_phone TEXT;
    v_vendor_full_name TEXT;
BEGIN
    -- 1. Resolve vendor details & commission rate
    SELECT 
        v.shop_name,
        v.owner_name,
        COALESCE(v.commission_rate, 10),
        v.user_id,
        v.property_id
    INTO 
        v_shop_name,
        v_owner_name,
        v_commission_rate,
        v_vendor_user_id,
        v_org_id -- temporary
    FROM public.vendors v
    WHERE v.id = NEW.vendor_id;

    -- 2. Resolve property name & organization_id
    SELECT 
        p.name,
        p.organization_id
    INTO 
        v_property_name,
        v_org_id
    FROM public.properties p
    WHERE p.id = NEW.property_id;

    IF v_org_id IS NULL AND NEW.organization_id IS NOT NULL THEN
        v_org_id := NEW.organization_id;
    END IF;

    -- 3. Resolve vendor user phone and full name
    IF v_vendor_user_id IS NOT NULL THEN
        SELECT 
            u.phone,
            COALESCE(u.full_name, v_owner_name)
        INTO 
            v_vendor_phone,
            v_vendor_full_name
        FROM public.users u
        WHERE u.id = v_vendor_user_id;
    END IF;

    -- 4. Calculate commission due for this daily revenue entry
    v_commission_due := ROUND((COALESCE(NEW.revenue_amount, 0) * (v_commission_rate / 100.0)), 2);

    -- 5. Construct payload for Omnichannel / WhatsApp / Email processors
    v_payload := jsonb_build_object(
        'revenue_id', NEW.id,
        'vendor_id', NEW.vendor_id,
        'property_id', NEW.property_id,
        'organization_id', v_org_id,
        'property_name', COALESCE(v_property_name, 'Property'),
        'shop_name', COALESCE(v_shop_name, 'Food Vendor Stall'),
        'owner_name', COALESCE(v_owner_name, v_vendor_full_name, 'Vendor Owner'),
        'vendor_user_id', v_vendor_user_id,
        'vendor_phone', v_vendor_phone,
        'vendor_name', COALESCE(v_vendor_full_name, v_owner_name, 'Vendor Partner'),
        'revenue_amount', NEW.revenue_amount,
        'commission_rate', v_commission_rate,
        'commission_due', v_commission_due,
        'revenue_date', COALESCE(NEW.revenue_date, NEW.entry_date, CURRENT_DATE),
        'entry_date', COALESCE(NEW.entry_date, NEW.revenue_date, CURRENT_DATE),
        'created_at', NEW.created_at
    );

    -- 6. Insert event into event_outbox for asynchronous notification processing
    INSERT INTO public.event_outbox (event_type, entity_id, payload)
    VALUES (v_event_type, NEW.id, v_payload);

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop prior trigger if exists
DROP TRIGGER IF EXISTS trg_vendor_daily_revenue_outbox ON public.vendor_daily_revenue;

-- Create After Insert or Update trigger on vendor_daily_revenue
CREATE TRIGGER trg_vendor_daily_revenue_outbox
    AFTER INSERT OR UPDATE OF revenue_amount ON public.vendor_daily_revenue
    FOR EACH ROW EXECUTE FUNCTION public.fn_vendor_daily_revenue_outbox();
