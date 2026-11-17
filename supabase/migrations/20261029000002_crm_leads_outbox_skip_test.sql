-- Migration: Skip test campaigns and sandbox leads from event_outbox to avoid blasting emails and WhatsApp to production team during testing

CREATE OR REPLACE FUNCTION public.fn_crm_leads_outbox()
RETURNS TRIGGER AS $$
DECLARE
    v_payload JSONB;
BEGIN
    -- 1. Skip test sandbox leads & test campaigns completely from event_outbox
    IF (
        COALESCE(NEW.campaign, '') ILIKE '%test%' OR 
        COALESCE(NEW.company_name, '') ILIKE '%test sandbox%' OR 
        COALESCE(NEW.company_name, '') ILIKE '%testing%' OR 
        COALESCE(NEW.email, '') = 'test@autopilotoffices.com' OR 
        COALESCE(NEW.contact_number, '') ILIKE '%7028232515%'
    ) THEN
        RETURN NEW;
    END IF;

    -- 2. Build comprehensive payload containing all row fields plus lead_id alias
    v_payload := to_jsonb(NEW) || jsonb_build_object('lead_id', NEW.id);

    IF TG_OP = 'INSERT' THEN
        -- Always queue LEAD_CREATED for general sales intake & admin notifications
        INSERT INTO public.event_outbox (event_type, entity_id, payload)
        VALUES ('LEAD_CREATED', NEW.id, v_payload);

        -- If lead is created with an assigned agent, also queue LEAD_ASSIGNED
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
