-- Migration: Add event_outbox trigger for SOP runs & checklist execution
-- Automatically generates event_outbox records when SOP checklists start or complete.
-- Enables multi-channel dispatch (Email, Push, WhatsApp, Voice) from Mobile App, Web UI, or SQL.

CREATE OR REPLACE FUNCTION public.fn_sop_runs_outbox()
RETURNS TRIGGER AS $$
DECLARE
    v_event_type TEXT;
    v_payload JSONB;
    v_org_id UUID;
    v_property_name TEXT;
    v_template_title TEXT;
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.status IN ('in_progress', 'started', 'assigned') THEN
            v_event_type := 'SOP_STARTED';
        ELSIF NEW.status = 'completed' THEN
            v_event_type := 'SOP_COMPLETED';
        END IF;
    ELSIF TG_OP = 'UPDATE' THEN
        IF NEW.status IN ('in_progress', 'started') AND (OLD.status IS NULL OR OLD.status NOT IN ('in_progress', 'started')) THEN
            v_event_type := 'SOP_STARTED';
        ELSIF NEW.status = 'completed' AND (OLD.status IS NULL OR OLD.status != 'completed') THEN
            v_event_type := 'SOP_COMPLETED';
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

    -- Resolve template title if template_id exists
    IF NEW.template_id IS NOT NULL THEN
        SELECT COALESCE(title, name)
        INTO v_template_title
        FROM public.sop_templates
        WHERE id = NEW.template_id;
    END IF;

    -- Assemble payload
    v_payload := jsonb_build_object(
        'run_id', NEW.id,
        'completion_id', NEW.id,
        'id', NEW.id,
        'template_id', NEW.template_id,
        'template_title', COALESCE(v_template_title, NEW.template_title, 'Checklist Inspection'),
        'property_id', NEW.property_id,
        'property_name', COALESCE(v_property_name, 'Property'),
        'organization_id', COALESCE(v_org_id, NEW.organization_id),
        'assigned_to', NEW.assigned_to,
        'completed_by', NEW.completed_by,
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
DROP TRIGGER IF EXISTS trg_sop_runs_outbox ON public.sop_completions;

-- Create After Insert or Update trigger on sop_completions
CREATE TRIGGER trg_sop_runs_outbox
    AFTER INSERT OR UPDATE OF status ON public.sop_completions
    FOR EACH ROW
    EXECUTE FUNCTION public.fn_sop_runs_outbox();
