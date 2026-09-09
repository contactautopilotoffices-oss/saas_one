-- Migration: Add event_outbox trigger for VMS visitors table
-- Automatically generates event_outbox records when visitors check in, get approved, or get rejected.
-- Enables 4-channel dispatch (Email, Push, WhatsApp, Voice) from Web UI, Gate Kiosk, Mobile App, or direct DB operations.

CREATE OR REPLACE FUNCTION public.fn_vms_visitors_outbox()
RETURNS TRIGGER AS $$
DECLARE
    v_event_type TEXT;
    v_payload JSONB;
    v_org_id UUID;
    v_property_name TEXT;
    v_host_name TEXT;
    v_host_email TEXT;
    v_host_phone TEXT;
BEGIN
    -- Determine Event Type
    IF TG_OP = 'INSERT' THEN
        v_event_type := 'VISITOR_APPROVAL_REQUESTED';
    ELSIF TG_OP = 'UPDATE' THEN
        IF NEW.status = 'approved' AND (OLD.status IS NULL OR OLD.status != 'approved') THEN
            v_event_type := 'VISITOR_APPROVED';
        ELSIF NEW.status = 'rejected' AND (OLD.status IS NULL OR OLD.status != 'rejected') THEN
            v_event_type := 'VISITOR_REJECTED';
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

    -- Resolve host user details
    IF NEW.host_user_id IS NOT NULL THEN
        SELECT full_name, email, phone
        INTO v_host_name, v_host_email, v_host_phone
        FROM public.users
        WHERE id = NEW.host_user_id;
    END IF;

    -- Assemble payload
    v_payload := jsonb_build_object(
        'visitor_id', NEW.id,
        'id', NEW.id,
        'name', NEW.name,
        'phone', NEW.phone,
        'email', NEW.email,
        'coming_from', NEW.coming_from,
        'purpose', NEW.purpose,
        'status', NEW.status,
        'property_id', NEW.property_id,
        'property_name', COALESCE(v_property_name, 'Property'),
        'organization_id', v_org_id,
        'host_user_id', NEW.host_user_id,
        'host_name', COALESCE(v_host_name, NEW.whom_to_meet, 'Host'),
        'host_email', v_host_email,
        'host_phone', v_host_phone,
        'whom_to_meet', COALESCE(NEW.whom_to_meet, v_host_name, 'Host'),
        'checkin_time', COALESCE(NEW.checkin_time, NEW.created_at, NOW())
    );

    -- Insert into event_outbox
    INSERT INTO public.event_outbox (event_type, entity_id, payload)
    VALUES (v_event_type, NEW.id, v_payload);

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop trigger if exists
DROP TRIGGER IF EXISTS trg_vms_visitors_outbox ON public.visitors;

-- Create After Insert or Update trigger on visitors
CREATE TRIGGER trg_vms_visitors_outbox
    AFTER INSERT OR UPDATE OF status ON public.visitors
    FOR EACH ROW
    EXECUTE FUNCTION public.fn_vms_visitors_outbox();
