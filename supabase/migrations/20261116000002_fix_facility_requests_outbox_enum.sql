-- ============================================================================
-- Fix: invalid input value for enum guest_request_status: "resolved"
--
-- Root cause:
-- In fn_facility_requests_outbox() / fn_facility_requests_event_outbox(), line:
--   IF NEW.status IN ('resolved', 'closed', 'RESOLVED', 'CLOSED')
-- caused PostgreSQL to attempt to cast the literal string 'resolved' into the
-- column's enum type `guest_request_status`. Because the enum only contains
-- ('PENDING', 'IN_PROGRESS', 'RESOLVED'), PostgreSQL aborted with code 22P02:
--   "invalid input value for enum guest_request_status: 'resolved'"
-- whenever ANY status update (including moving to 'IN_PROGRESS') was executed.
--
-- Fix:
-- Cast NEW.status to TEXT (NEW.status::text) so PostgreSQL performs a safe
-- text-to-text comparison without attempting an invalid enum cast.
-- ============================================================================

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
        -- Safely cast to text to prevent enum coercion errors with lowercase strings
        IF (NEW.status::text IN ('RESOLVED', 'resolved', 'closed', 'CLOSED')) 
           AND (OLD.status IS NULL OR OLD.status::text NOT IN ('RESOLVED', 'resolved', 'closed', 'CLOSED')) THEN
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
        'status', NEW.status::text,
        'created_at', NEW.created_at
    );

    -- Insert into event_outbox
    INSERT INTO public.event_outbox (event_type, entity_id, payload)
    VALUES (v_event_type, NEW.id, v_payload);

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Also create or replace fn_facility_requests_event_outbox in case that name is bound by the dedup migration
CREATE OR REPLACE FUNCTION public.fn_facility_requests_event_outbox()
RETURNS TRIGGER AS $$
BEGIN
    RETURN public.fn_facility_requests_outbox();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

