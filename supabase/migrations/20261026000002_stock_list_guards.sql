-- Migration: 20261026000002_stock_list_guards.sql
-- Description: Follow-up to 20261026000001_stock_from_requisition.sql. Run after it.
--
--   1. confirm_requisition_delivery() could still be called by signed-in users:
--      Supabase grants EXECUTE on new public functions to anon and authenticated by
--      default, and 000001 only revoked it from PUBLIC. Only the API (service role)
--      may post a challan.
--   2. The stock list rules were enforced only in the API routes, but stock_items RLS
--      lets property members write rows straight from the browser. This trigger
--      applies the same rules to every browser (anon / authenticated) write:
--        - requisition-list rows are created by the system only, and cannot be
--          renamed, re-united, re-categorised or deleted;
--        - a row on the list the property is NOT using is frozen;
--        - no row can be moved between lists, properties or catalog items.
--      Server-side writes (service role, SQL editor, the challan function) are not
--      restricted, so the API keeps working exactly as before.
--
-- Additive and safe to run more than once.
BEGIN;

-- 1. CHALLAN FUNCTION: SERVICE ROLE ONLY
REVOKE ALL ON FUNCTION public.confirm_requisition_delivery(UUID, UUID, TEXT, DATE, TEXT, TEXT, UUID, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_requisition_delivery(UUID, UUID, TEXT, DATE, TEXT, TEXT, UUID, JSONB) TO service_role;

-- 2. STOCK LIST GUARD
CREATE OR REPLACE FUNCTION public.stock_items_list_guard()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    r        stock_items;
    v_source TEXT;
BEGIN
    -- Only requests made with a user's or the anonymous key are checked. auth.role()
    -- reads the request's JWT, so it is unaffected by SECURITY DEFINER.
    IF coalesce(auth.role(), '') NOT IN ('authenticated', 'anon') THEN
        RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
    END IF;

    r := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
    SELECT s.item_source INTO v_source FROM property_stock_settings s WHERE s.property_id = r.property_id;
    v_source := coalesce(v_source, 'legacy');

    IF TG_OP = 'INSERT' THEN
        IF NEW.item_source <> 'legacy' THEN
            RAISE EXCEPTION 'Requisition stock items are added automatically from the monthly requisition list.';
        END IF;
        IF v_source = 'catalog' THEN
            RAISE EXCEPTION 'This property counts stock against its monthly requisition items, so items cannot be added here.';
        END IF;
        RETURN NEW;
    END IF;

    IF OLD.item_source <> v_source THEN
        RAISE EXCEPTION 'This item is on the stock list the property no longer uses and cannot be changed.';
    END IF;

    IF TG_OP = 'DELETE' THEN
        IF OLD.item_source = 'catalog' THEN
            RAISE EXCEPTION 'Requisition stock items cannot be deleted.';
        END IF;
        RETURN OLD;
    END IF;

    IF NEW.item_source IS DISTINCT FROM OLD.item_source
       OR NEW.catalog_item_id IS DISTINCT FROM OLD.catalog_item_id
       OR NEW.property_id IS DISTINCT FROM OLD.property_id
       OR NEW.organization_id IS DISTINCT FROM OLD.organization_id THEN
        RAISE EXCEPTION 'A stock item cannot be moved to another list, property or catalog item.';
    END IF;

    IF OLD.item_source = 'catalog' AND (
           NEW.name IS DISTINCT FROM OLD.name
        OR NEW.unit IS DISTINCT FROM OLD.unit
        OR NEW.category IS DISTINCT FROM OLD.category
        OR NEW.item_code IS DISTINCT FROM OLD.item_code) THEN
        RAISE EXCEPTION 'Name, unit and category of requisition stock items come from Manage Items and cannot be changed here.';
    END IF;

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.stock_items_list_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_stock_items_list_guard ON public.stock_items;
CREATE TRIGGER trg_stock_items_list_guard
    BEFORE INSERT OR UPDATE OR DELETE ON public.stock_items
    FOR EACH ROW EXECUTE FUNCTION public.stock_items_list_guard();

COMMIT;
