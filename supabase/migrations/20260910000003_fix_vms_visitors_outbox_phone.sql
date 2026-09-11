-- Migration: Fix invalid column references in fn_vms_visitors_outbox trigger function
-- Fixes 'record "new" has no field "phone"' error when creating visitor entries in visitor_logs

CREATE OR REPLACE FUNCTION public.fn_vms_visitors_outbox()
RETURNS TRIGGER AS $$
DECLARE
    v_event_type TEXT;
    v_payload JSONB;
    v_org_id UUID;
    v_property_name TEXT;
    v_host_id UUID;
    v_host_name TEXT;
    v_host_email TEXT;
    v_host_phone TEXT;
    v_app_status TEXT;
    v_old_app_status TEXT;
BEGIN
    v_app_status := COALESCE(NEW.approval_status, 'approved');
    v_old_app_status := CASE WHEN TG_OP = 'UPDATE' THEN OLD.approval_status ELSE NULL END;
    v_host_id := COALESCE(NEW.host_id, NEW.whom_to_meet_uid);

    -- Determine Event Type
    IF TG_OP = 'INSERT' THEN
        v_event_type := 'VISITOR_APPROVAL_REQUESTED';
    ELSIF TG_OP = 'UPDATE' THEN
        IF v_app_status = 'approved' AND (v_old_app_status IS NULL OR v_old_app_status != 'approved') THEN
            v_event_type := 'VISITOR_APPROVED';
        ELSIF v_app_status = 'rejected' AND (v_old_app_status IS NULL OR v_old_app_status != 'rejected') THEN
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

    IF v_org_id IS NULL AND NEW.organization_id IS NOT NULL THEN
        v_org_id := NEW.organization_id;
    END IF;

    -- Resolve host user details
    IF v_host_id IS NOT NULL THEN
        SELECT full_name, email, phone
        INTO v_host_name, v_host_email, v_host_phone
        FROM public.users
        WHERE id = v_host_id;
    END IF;

    -- Assemble payload
    v_payload := jsonb_build_object(
        'visitor_id', NEW.id,
        'id', NEW.id,
        'name', NEW.name,
        'phone', NEW.mobile,
        'email', NULL,
        'coming_from', NEW.coming_from,
        'purpose', NEW.category,
        'status', NEW.status,
        'approval_status', v_app_status,
        'property_id', NEW.property_id,
        'property_name', COALESCE(v_property_name, 'Property'),
        'organization_id', v_org_id,
        'host_user_id', v_host_id,
        'host_id', v_host_id,
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

-- Re-create trigger to ensure function binding is updated
DROP TRIGGER IF EXISTS trg_vms_visitors_outbox ON public.visitor_logs;

CREATE TRIGGER trg_vms_visitors_outbox
    AFTER INSERT OR UPDATE ON public.visitor_logs
    FOR EACH ROW
    EXECUTE FUNCTION public.fn_vms_visitors_outbox();
