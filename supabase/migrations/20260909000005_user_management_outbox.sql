-- Migration: Add event_outbox trigger for user onboarding & approvals
-- Automatically generates event_outbox records when users register, request approval, or get approved.
-- Enables 4-channel dispatch (Email, Push, WhatsApp) from Web UI, Mobile App, Auth Triggers, or SQL.

CREATE OR REPLACE FUNCTION public.fn_organization_memberships_outbox()
RETURNS TRIGGER AS $$
DECLARE
    v_event_type TEXT;
    v_payload JSONB;
    v_user_name TEXT;
    v_user_email TEXT;
    v_user_phone TEXT;
    v_org_name TEXT;
    v_is_active BOOLEAN;
    v_old_is_active BOOLEAN;
BEGIN
    v_is_active := COALESCE(NEW.is_active, false);
    v_old_is_active := CASE WHEN TG_OP = 'UPDATE' THEN COALESCE(OLD.is_active, false) ELSE false END;

    IF TG_OP = 'INSERT' THEN
        IF v_is_active = false THEN
            v_event_type := 'USER_PENDING_APPROVAL';
        ELSE
            v_event_type := 'USER_APPROVED';
        END IF;
    ELSIF TG_OP = 'UPDATE' THEN
        IF v_is_active = true AND v_old_is_active = false THEN
            v_event_type := 'USER_APPROVED';
        ELSIF v_is_active = false AND v_old_is_active = true THEN
            v_event_type := 'USER_PENDING_APPROVAL';
        END IF;
    END IF;

    IF v_event_type IS NULL THEN
        RETURN NEW;
    END IF;

    -- Resolve user details
    SELECT full_name, email, phone
    INTO v_user_name, v_user_email, v_user_phone
    FROM public.users
    WHERE id = NEW.user_id;

    -- Resolve organization name
    SELECT name
    INTO v_org_name
    FROM public.organizations
    WHERE id = NEW.organization_id;

    -- Assemble payload
    v_payload := jsonb_build_object(
        'membership_id', NEW.user_id,
        'id', NEW.user_id,
        'user_id', NEW.user_id,
        'full_name', COALESCE(v_user_name, 'New User'),
        'email', v_user_email,
        'phone', v_user_phone,
        'role', NEW.role,
        'requested_role', NEW.role,
        'organization_id', NEW.organization_id,
        'organization_name', COALESCE(v_org_name, 'Organization'),
        'is_active', v_is_active,
        'status', CASE WHEN v_is_active THEN 'approved' ELSE 'pending_approval' END,
        'created_at', COALESCE(NEW.created_at, NOW())
    );

    -- Insert into event_outbox
    INSERT INTO public.event_outbox (event_type, entity_id, payload)
    VALUES (v_event_type, NEW.user_id, v_payload);

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop trigger if exists
DROP TRIGGER IF EXISTS trg_organization_memberships_outbox ON public.organization_memberships;

-- Create After Insert or Update trigger on organization_memberships
CREATE TRIGGER trg_organization_memberships_outbox
    AFTER INSERT OR UPDATE OF is_active ON public.organization_memberships
    FOR EACH ROW
    EXECUTE FUNCTION public.fn_organization_memberships_outbox();
