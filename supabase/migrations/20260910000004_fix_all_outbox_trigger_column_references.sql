-- Migration: Comprehensive Fix for Invalid Column References in Outbox Trigger Functions
-- Resolves PostgreSQL runtime errors ("record 'new' has no field...") when executing database triggers across modules:
-- 1. fn_vms_visitors_outbox (visitor_logs): NEW.mobile instead of NEW.phone
-- 2. fn_monthly_requisition_workflow_outbox (property_monthly_requisitions): NEW.requisition_month/year & NEW.uploaded_by
-- 3. fn_sop_runs_outbox (sop_completions): Removes NEW.template_title & NEW.assigned_to
-- 4. fn_vendor_daily_revenue_outbox (vendor_daily_revenue): NEW.revenue_date instead of NEW.entry_date

-- ============================================================================
-- 1. VMS VISITORS OUTBOX TRIGGER FIX
-- ============================================================================
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

DROP TRIGGER IF EXISTS trg_vms_visitors_outbox ON public.visitor_logs;
CREATE TRIGGER trg_vms_visitors_outbox
    AFTER INSERT OR UPDATE ON public.visitor_logs
    FOR EACH ROW EXECUTE FUNCTION public.fn_vms_visitors_outbox();


-- ============================================================================
-- 2. MONTHLY REQUISITION WORKFLOW OUTBOX TRIGGER FIX
-- ============================================================================
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
        ELSIF NEW.status IN ('po_issued', 'ordered') THEN
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

DROP TRIGGER IF EXISTS trg_monthly_requisition_workflow_outbox ON public.property_monthly_requisitions;
CREATE TRIGGER trg_monthly_requisition_workflow_outbox
    AFTER UPDATE OF status ON public.property_monthly_requisitions
    FOR EACH ROW EXECUTE FUNCTION public.fn_monthly_requisition_workflow_outbox();


-- ============================================================================
-- 3. SOP CHECKLIST RUNS OUTBOX TRIGGER FIX
-- ============================================================================
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
        'template_title', COALESCE(v_template_title, 'Checklist Inspection'),
        'property_id', NEW.property_id,
        'property_name', COALESCE(v_property_name, 'Property'),
        'organization_id', COALESCE(v_org_id, NEW.organization_id),
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

DROP TRIGGER IF EXISTS trg_sop_runs_outbox ON public.sop_completions;
CREATE TRIGGER trg_sop_runs_outbox
    AFTER INSERT OR UPDATE OF status ON public.sop_completions
    FOR EACH ROW EXECUTE FUNCTION public.fn_sop_runs_outbox();


-- ============================================================================
-- 4. VENDOR DAILY REVENUE OUTBOX TRIGGER FIX
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fn_vendor_daily_revenue_outbox()
RETURNS TRIGGER AS $$
DECLARE
    v_event_type TEXT := 'VENDOR_REVENUE_RECORDED';
    v_payload JSONB;
    v_org_id UUID;
    v_property_name TEXT;
    v_shop_name TEXT;
    v_owner_name TEXT;
    v_commission_rate NUMERIC := 10;
    v_commission_due NUMERIC := 0;
    v_vendor_user_id UUID;
    v_vendor_phone TEXT;
    v_vendor_full_name TEXT;
BEGIN
    SELECT 
        v.shop_name,
        v.owner_name,
        COALESCE(v.commission_rate, 10),
        v.user_id,
        v.property_id
    INTO 
        v_shop_name,
        v_owner_name,
        v_commission_rate,
        v_vendor_user_id,
        v_org_id
    FROM public.vendors v
    WHERE v.id = NEW.vendor_id;

    SELECT 
        p.name,
        p.organization_id
    INTO 
        v_property_name,
        v_org_id
    FROM public.properties p
    WHERE p.id = NEW.property_id;

    IF v_org_id IS NULL AND NEW.organization_id IS NOT NULL THEN
        v_org_id := NEW.organization_id;
    END IF;

    IF v_vendor_user_id IS NOT NULL THEN
        SELECT 
            u.phone,
            COALESCE(u.full_name, v_owner_name)
        INTO 
            v_vendor_phone,
            v_vendor_full_name
        FROM public.users u
        WHERE u.id = v_vendor_user_id;
    END IF;

    v_commission_due := ROUND((COALESCE(NEW.revenue_amount, 0) * (v_commission_rate / 100.0)), 2);

    v_payload := jsonb_build_object(
        'revenue_id', NEW.id,
        'vendor_id', NEW.vendor_id,
        'property_id', NEW.property_id,
        'organization_id', v_org_id,
        'property_name', COALESCE(v_property_name, 'Property'),
        'shop_name', COALESCE(v_shop_name, 'Food Vendor Stall'),
        'owner_name', COALESCE(v_owner_name, v_vendor_full_name, 'Vendor Owner'),
        'vendor_user_id', v_vendor_user_id,
        'vendor_phone', v_vendor_phone,
        'vendor_name', COALESCE(v_vendor_full_name, v_owner_name, 'Vendor Partner'),
        'revenue_amount', NEW.revenue_amount,
        'commission_rate', v_commission_rate,
        'commission_due', v_commission_due,
        'revenue_date', COALESCE(NEW.revenue_date, CURRENT_DATE),
        'entry_date', COALESCE(NEW.revenue_date, CURRENT_DATE),
        'created_at', NEW.created_at
    );

    INSERT INTO public.event_outbox (event_type, entity_id, payload)
    VALUES (v_event_type, NEW.id, v_payload);

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_vendor_daily_revenue_outbox ON public.vendor_daily_revenue;
CREATE TRIGGER trg_vendor_daily_revenue_outbox
    AFTER INSERT OR UPDATE OF revenue_amount ON public.vendor_daily_revenue
    FOR EACH ROW EXECUTE FUNCTION public.fn_vendor_daily_revenue_outbox();
