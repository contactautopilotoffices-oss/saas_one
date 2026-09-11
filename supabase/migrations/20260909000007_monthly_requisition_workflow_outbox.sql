-- Migration: Add event_outbox trigger for property_monthly_requisitions status transitions
-- Automatically generates event_outbox records when requisitions require approval, update status, or issue PO.
-- Enables 4-channel dispatch (Email, Push, WhatsApp) from Mobile App, Web UI, or SQL.

CREATE OR REPLACE FUNCTION public.fn_monthly_requisition_workflow_outbox()
RETURNS TRIGGER AS $$
DECLARE
    v_event_type TEXT;
    v_payload JSONB;
    v_org_id UUID;
    v_property_name TEXT;
    v_requested_by_name TEXT;
BEGIN
    IF TG_OP = 'UPDATE' AND NEW.status != OLD.status THEN
        IF NEW.status = 'pending_approval' THEN
            v_event_type := 'REQUISITION_APPROVAL_REQUESTED';
        ELSIF NEW.status = 'po_issued' THEN
            v_event_type := 'REQUISITION_PO_ISSUED';
        ELSE
            v_event_type := 'REQUISITION_STATUS_UPDATED';
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

    -- Resolve requester user name if uploaded_by exists
    IF NEW.uploaded_by IS NOT NULL THEN
        SELECT full_name
        INTO v_requested_by_name
        FROM public.users
        WHERE id = NEW.uploaded_by;
    END IF;

    -- Assemble payload
    v_payload := jsonb_build_object(
        'requisition_id', NEW.id,
        'id', NEW.id,
        'property_id', NEW.property_id,
        'property_name', COALESCE(v_property_name, 'Property'),
        'organization_id', COALESCE(v_org_id, NEW.organization_id),
        'month', NEW.requisition_month,
        'year', NEW.requisition_year,
        'requisition_month', NEW.requisition_month,
        'requisition_year', NEW.requisition_year,
        'status', NEW.status,
        'old_status', OLD.status,
        'created_by', NEW.uploaded_by,
        'uploaded_by', NEW.uploaded_by,
        'requested_by_name', COALESCE(v_requested_by_name, 'Site Admin'),
        'file_name', NEW.file_name,
        'file_url', NEW.file_url,
        'updated_at', NEW.updated_at
    );

    -- Insert into event_outbox
    INSERT INTO public.event_outbox (event_type, entity_id, payload)
    VALUES (v_event_type, NEW.id, v_payload);

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop trigger if exists
DROP TRIGGER IF EXISTS trg_monthly_requisition_workflow_outbox ON public.property_monthly_requisitions;

-- Create After Update trigger on property_monthly_requisitions
CREATE TRIGGER trg_monthly_requisition_workflow_outbox
    AFTER UPDATE OF status ON public.property_monthly_requisitions
    FOR EACH ROW
    EXECUTE FUNCTION public.fn_monthly_requisition_workflow_outbox();
