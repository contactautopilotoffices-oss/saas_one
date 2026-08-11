-- Migration: 20260810_procurement_vendor_tagging.sql
-- Add vendor procurement columns to tickets table

ALTER TABLE public.tickets
ADD COLUMN IF NOT EXISTS needs_vendor_procurement BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS vendor_procurement_status VARCHAR(50) DEFAULT 'none',
ADD COLUMN IF NOT EXISTS vendor_procurement_note TEXT,
ADD COLUMN IF NOT EXISTS vendor_arranged_details TEXT,
ADD COLUMN IF NOT EXISTS vendor_tagged_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS vendor_arranged_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS vendor_tagged_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS vendor_arranged_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS assigned_procurement_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_tickets_needs_vendor_procurement ON public.tickets(needs_vendor_procurement);
CREATE INDEX IF NOT EXISTS idx_tickets_vendor_procurement_status ON public.tickets(vendor_procurement_status);
CREATE INDEX IF NOT EXISTS idx_tickets_assigned_procurement_user_id ON public.tickets(assigned_procurement_user_id);

-- Function to push tickets vendor procurement events into event_outbox
CREATE OR REPLACE FUNCTION public.trg_ticket_vendor_procurement_outbox()
RETURNS TRIGGER AS $$
DECLARE
    v_event_type VARCHAR;
    v_payload JSONB;
BEGIN
    -- Detect when vendor procurement is tagged or updated
    IF (NEW.needs_vendor_procurement = TRUE AND (OLD.needs_vendor_procurement = FALSE OR OLD.needs_vendor_procurement IS NULL OR NEW.vendor_procurement_note IS DISTINCT FROM OLD.vendor_procurement_note)) THEN
        v_event_type := 'VENDOR_PROCUREMENT_REQUESTED';
        v_payload := jsonb_build_object(
            'ticket_id', NEW.id,
            'ticket_number', NEW.ticket_number,
            'title', NEW.title,
            'property_id', NEW.property_id,
            'organization_id', NEW.organization_id,
            'note', NEW.vendor_procurement_note,
            'tagged_by', NEW.vendor_tagged_by,
            'tagged_at', NEW.vendor_tagged_at,
            'assigned_procurement_user_id', NEW.assigned_procurement_user_id
        );

        INSERT INTO public.event_outbox (event_type, entity_id, payload)
        VALUES (v_event_type, NEW.id, v_payload);

    -- Detect when vendor procurement is marked as arranged or details updated
    ELSIF (NEW.vendor_procurement_status = 'vendor_arranged' AND (OLD.vendor_procurement_status IS DISTINCT FROM 'vendor_arranged' OR NEW.vendor_arranged_details IS DISTINCT FROM OLD.vendor_arranged_details)) THEN
        v_event_type := 'VENDOR_PROCUREMENT_ARRANGED';
        v_payload := jsonb_build_object(
            'ticket_id', NEW.id,
            'ticket_number', NEW.ticket_number,
            'title', NEW.title,
            'property_id', NEW.property_id,
            'organization_id', NEW.organization_id,
            'details', NEW.vendor_arranged_details,
            'arranged_by', NEW.vendor_arranged_by,
            'arranged_at', NEW.vendor_arranged_at,
            'raised_by', NEW.raised_by,
            'assigned_to', NEW.assigned_to,
            'tagged_by', NEW.vendor_tagged_by
        );

        INSERT INTO public.event_outbox (event_type, entity_id, payload)
        VALUES (v_event_type, NEW.id, v_payload);
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_tickets_vendor_procurement_outbox ON public.tickets;
CREATE TRIGGER trg_tickets_vendor_procurement_outbox
    AFTER UPDATE ON public.tickets
    FOR EACH ROW
    EXECUTE FUNCTION public.trg_ticket_vendor_procurement_outbox();
