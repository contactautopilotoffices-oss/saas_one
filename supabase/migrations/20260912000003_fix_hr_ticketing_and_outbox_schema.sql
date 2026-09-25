-- Migration: 20260912000003_fix_hr_ticketing_and_outbox_schema.sql
-- Description: Add missing resolution columns to hr_tickets and fix outbox trigger function with safe json dynamic dereferencing

-- 1. Add missing resolution columns to hr_tickets table
ALTER TABLE public.hr_tickets
ADD COLUMN IF NOT EXISTS resolution_note TEXT,
ADD COLUMN IF NOT EXISTS resolved_by_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL;

-- 2. Update Outbox Event Trigger Function with safe dynamic JSON extraction
CREATE OR REPLACE FUNCTION public.fn_hr_ticket_event_outbox()
RETURNS TRIGGER AS $$
DECLARE
    v_event_type TEXT;
    v_payload JSONB;
    v_row_json JSONB;
BEGIN
    v_row_json := to_jsonb(NEW);

    IF (TG_OP = 'INSERT') THEN
        IF (NEW.is_confidential = TRUE OR NEW.is_anonymous = TRUE) THEN
            v_event_type := 'HR_CONFIDENTIAL_DIRECTOR_ALERT';
        ELSE
            v_event_type := 'HR_TICKET_CREATED';
        END IF;

        v_payload := jsonb_build_object(
            'id', NEW.id,
            'ticket_number', NEW.ticket_number,
            'organization_id', NEW.organization_id,
            'raised_by_user_id', NEW.raised_by_user_id,
            'assigned_to_user_id', NEW.assigned_to_user_id,
            'category_id', NEW.category_id,
            'ticket_type', NEW.ticket_type,
            'subject', NEW.subject,
            'description', NEW.description,
            'priority', NEW.priority,
            'status', NEW.status,
            'current_level', NEW.current_level,
            'is_confidential', NEW.is_confidential,
            'is_anonymous', NEW.is_anonymous,
            'sla_due_at', NEW.sla_due_at,
            'created_at', NEW.created_at
        );
    ELSIF (TG_OP = 'UPDATE') THEN
        IF (OLD.current_level IS DISTINCT FROM NEW.current_level AND NEW.current_level > OLD.current_level) THEN
            v_event_type := 'HR_TICKET_LEVEL_ESCALATED';
        ELSIF (OLD.status IS DISTINCT FROM NEW.status AND (NEW.status = 'resolved' OR NEW.status = 'closed')) THEN
            v_event_type := 'HR_TICKET_RESOLVED';
        ELSIF (OLD.assigned_to_user_id IS DISTINCT FROM NEW.assigned_to_user_id AND NEW.assigned_to_user_id IS NOT NULL) THEN
            v_event_type := 'HR_TICKET_ASSIGNED';
        ELSE
            v_event_type := 'HR_TICKET_UPDATED';
        END IF;

        v_payload := jsonb_build_object(
            'id', NEW.id,
            'ticket_number', NEW.ticket_number,
            'organization_id', NEW.organization_id,
            'raised_by_user_id', NEW.raised_by_user_id,
            'assigned_to_user_id', NEW.assigned_to_user_id,
            'old_assigned_to_user_id', OLD.assigned_to_user_id,
            'old_status', OLD.status,
            'status', NEW.status,
            'old_level', OLD.current_level,
            'current_level', NEW.current_level,
            'subject', NEW.subject,
            'resolution_note', v_row_json ->> 'resolution_note',
            'resolved_by_user_id', v_row_json ->> 'resolved_by_user_id',
            'is_confidential', NEW.is_confidential,
            'is_anonymous', NEW.is_anonymous,
            'updated_at', NEW.updated_at
        );
    END IF;

    -- Push event into omnichannel_events queue table if present
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'omnichannel_events') THEN
        INSERT INTO public.omnichannel_events (event_type, payload, organization_id, created_at)
        VALUES (v_event_type, v_payload, NEW.organization_id, NOW());
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
