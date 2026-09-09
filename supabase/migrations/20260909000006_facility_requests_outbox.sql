-- Migration: Add event_outbox trigger for guest_requests (QR Service Desk Requests)
-- Automatically generates event_outbox records when QR requests are created or resolved.
-- Enables 4-channel dispatch (Email, Push, WhatsApp) from QR Kiosks, Mobile App, Web UI, or SQL.

CREATE OR REPLACE FUNCTION public.fn_facility_requests_outbox()
RETURNS TRIGGER AS $$
DECLARE
    v_event_type TEXT;
    v_payload JSONB;
    v_org_id UUID;
    v_property_name TEXT;
    v_requester_name TEXT;
BEGIN
    IF TG_OP = 'INSERT' THEN
        v_event_type := 'FACILITY_REQUEST_CREATED';
    ELSIF TG_OP = 'UPDATE' THEN
        IF NEW.status IN ('resolved', 'closed', 'RESOLVED', 'CLOSED') AND (OLD.status IS NULL OR OLD.status NOT IN ('resolved', 'closed', 'RESOLVED', 'CLOSED')) THEN
            v_event_type := 'FACILITY_REQUEST_RESOLVED';
        END IF;
    END IF;

    IF v_event_type IS NULL THEN
        RETURN NEW;
    END IF;

    -- Resolve property & organization_id
    IF NEW.property_id IS NOT NULL THEN
        SELECT organization_id, name
        INTO v_org_id, v_property_name
        FROM public.properties
        WHERE id = NEW.property_id;
    END IF;

    -- Assemble payload
    v_payload := jsonb_build_object(
        'request_id', NEW.id,
        'id', NEW.id,
        'title', COALESCE(NEW.ai_category, 'Guest Facility Request'),
        'category', NEW.ai_category,
        'description', NEW.description,
        'property_id', NEW.property_id,
        'property_name', COALESCE(v_property_name, 'Property'),
        'organization_id', v_org_id,
        'guest_name', NEW.guest_name,
        'guest_phone', NEW.guest_phone,
        'guest_email', NEW.guest_email,
        'requester_name', COALESCE(NEW.guest_name, 'Guest User'),
        'status', NEW.status,
        'created_at', NEW.created_at
    );

    -- Insert into event_outbox
    INSERT INTO public.event_outbox (event_type, entity_id, payload)
    VALUES (v_event_type, NEW.id, v_payload);

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop trigger if exists
DROP TRIGGER IF EXISTS trg_facility_requests_outbox ON public.guest_requests;
DROP TRIGGER IF EXISTS trg_facility_requests_outbox ON public.facility_requests;

-- Create After Insert or Update trigger on guest_requests
CREATE TRIGGER trg_facility_requests_outbox
    AFTER INSERT OR UPDATE OF status ON public.guest_requests
    FOR EACH ROW
    EXECUTE FUNCTION public.fn_facility_requests_outbox();
