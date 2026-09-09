-- Migration: Add event_outbox trigger for monthly_requisition_feedback
-- Ensures monthly feedback submissions from any client (Mobile App, Web, SQL, External API)
-- automatically generate an event_outbox record for 4-channel notification processing (Email, Push, WhatsApp, Voice).

CREATE OR REPLACE FUNCTION public.fn_monthly_requisition_feedback_outbox()
RETURNS TRIGGER AS $$
DECLARE
    v_event_type TEXT := 'MONTHLY_REQUISITION_FEEDBACK_SUBMITTED';
    v_payload JSONB;
    v_org_id UUID;
    v_property_name TEXT;
    v_submitter_name TEXT;
BEGIN
    -- 1. Resolve property & organization_id
    SELECT organization_id, name
    INTO v_org_id, v_property_name
    FROM public.properties
    WHERE id = NEW.property_id;

    IF v_org_id IS NULL AND NEW.organization_id IS NOT NULL THEN
        v_org_id := NEW.organization_id;
    END IF;

    -- 2. Resolve submitter name
    SELECT full_name
    INTO v_submitter_name
    FROM public.users
    WHERE id = NEW.submitted_by;

    -- 3. Build payload
    v_payload := jsonb_build_object(
        'feedback_id', NEW.id,
        'id', NEW.id,
        'property_id', NEW.property_id,
        'organization_id', v_org_id,
        'property_name', COALESCE(v_property_name, 'Property'),
        'month', NEW.month,
        'year', NEW.year,
        'submitted_by', NEW.submitted_by,
        'submitter_name', COALESCE(v_submitter_name, 'Property Admin'),
        'hk_received_as_approved', NEW.hk_received_as_approved,
        'hk_material_quality', NEW.hk_material_quality,
        'manpower_quality_satisfaction', NEW.manpower_quality_satisfaction,
        'manpower_reliever_on_time', NEW.manpower_reliever_on_time,
        'amc_service_report_on_time', NEW.amc_service_report_on_time,
        'amc_services_on_schedule', NEW.amc_services_on_schedule,
        'remarks', NEW.remarks,
        'created_at', NEW.created_at
    );

    -- 4. Insert into event_outbox
    INSERT INTO public.event_outbox (event_type, entity_id, payload)
    VALUES (v_event_type, NEW.id, v_payload);

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop trigger if exists
DROP TRIGGER IF EXISTS trg_monthly_requisition_feedback_outbox ON public.monthly_requisition_feedback;

-- Create After Insert trigger on monthly_requisition_feedback
CREATE TRIGGER trg_monthly_requisition_feedback_outbox
    AFTER INSERT ON public.monthly_requisition_feedback
    FOR EACH ROW
    EXECUTE FUNCTION public.fn_monthly_requisition_feedback_outbox();
