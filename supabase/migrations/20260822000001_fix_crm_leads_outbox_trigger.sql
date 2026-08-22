-- Fix CRM leads trigger to include all columns in payload (including organization_id, requirement, assigned_to, email, campaign)
-- and properly dispatch LEAD_ASSIGNED both on creation (if assigned) and on assignment update.

CREATE OR REPLACE FUNCTION public.fn_crm_leads_outbox()
RETURNS TRIGGER AS $$
DECLARE
    v_payload JSONB;
BEGIN
    -- Build comprehensive payload containing all row fields plus lead_id alias
    v_payload := to_jsonb(NEW) || jsonb_build_object('lead_id', NEW.id);

    IF TG_OP = 'INSERT' THEN
        -- 1. Always queue LEAD_CREATED for general sales intake & admin notifications
        INSERT INTO public.event_outbox (event_type, entity_id, payload)
        VALUES ('LEAD_CREATED', NEW.id, v_payload);

        -- 2. If lead is created with an assigned agent (e.g. from Meta Lead webhook, auto-distribution, or API), also queue LEAD_ASSIGNED
        IF NEW.assigned_to IS NOT NULL THEN
            INSERT INTO public.event_outbox (event_type, entity_id, payload)
            VALUES ('LEAD_ASSIGNED', NEW.id, v_payload);
        END IF;

    ELSIF TG_OP = 'UPDATE' AND (NEW.assigned_to IS DISTINCT FROM OLD.assigned_to AND NEW.assigned_to IS NOT NULL) THEN
        -- When assigned agent changes on update
        INSERT INTO public.event_outbox (event_type, entity_id, payload)
        VALUES ('LEAD_ASSIGNED', NEW.id, v_payload);
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_crm_leads_outbox ON public.crm_leads;
CREATE TRIGGER trg_crm_leads_outbox
    AFTER INSERT OR UPDATE ON public.crm_leads
    FOR EACH ROW
    EXECUTE FUNCTION public.fn_crm_leads_outbox();
