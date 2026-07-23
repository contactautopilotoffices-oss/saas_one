-- Create enum for outbox status
CREATE TYPE outbox_status AS ENUM ('pending', 'processing', 'completed', 'failed', 'dead', 'retry');

-- Create event_outbox table
CREATE TABLE IF NOT EXISTS public.event_outbox (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type VARCHAR(255) NOT NULL,
    entity_id UUID,
    payload JSONB NOT NULL,
    status outbox_status DEFAULT 'pending',
    retry_count INTEGER DEFAULT 0,
    error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Index to quickly find pending/failed events for the sweeper
CREATE INDEX IF NOT EXISTS idx_event_outbox_status_created_at ON public.event_outbox(status, created_at);

-- Set up updated_at trigger
CREATE OR REPLACE FUNCTION public.handle_updated_at_outbox()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS outbox_updated_at ON public.event_outbox;
CREATE TRIGGER outbox_updated_at
    BEFORE UPDATE ON public.event_outbox
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_updated_at_outbox();

-- Generic function to insert outbox event
CREATE OR REPLACE FUNCTION public.create_outbox_event()
RETURNS TRIGGER AS $$
DECLARE
    v_event_type VARCHAR;
    v_payload JSONB;
BEGIN
    IF TG_TABLE_NAME = 'meeting_room_bookings' THEN
        IF TG_OP = 'INSERT' THEN
            v_event_type := 'MEETING_ROOM_BOOKED';
            v_payload := row_to_json(NEW)::jsonb;
            
            INSERT INTO public.event_outbox (event_type, entity_id, payload)
            VALUES (v_event_type, NEW.id, v_payload);
            
            RETURN NEW;
            
        ELSIF TG_OP = 'UPDATE' AND NEW.status = 'cancelled' AND OLD.status != 'cancelled' THEN
            v_event_type := 'MEETING_ROOM_CANCELLED';
            v_payload := row_to_json(NEW)::jsonb;
            
            INSERT INTO public.event_outbox (event_type, entity_id, payload)
            VALUES (v_event_type, NEW.id, v_payload);
            
            RETURN NEW;
            
        ELSIF TG_OP = 'DELETE' THEN
            v_event_type := 'MEETING_ROOM_CANCELLED';
            v_payload := row_to_json(OLD)::jsonb;
            
            INSERT INTO public.event_outbox (event_type, entity_id, payload)
            VALUES (v_event_type, OLD.id, v_payload);
            
            RETURN OLD;
            
        ELSE
            RETURN COALESCE(NEW, OLD);
        END IF;
    ELSIF TG_TABLE_NAME = 'material_requests' THEN
        IF TG_OP = 'INSERT' THEN
            v_event_type := 'MATERIAL_REQUEST_CREATED';
        END IF;
    END IF;

    IF v_event_type IS NOT NULL AND TG_OP = 'INSERT' THEN
        INSERT INTO public.event_outbox (event_type, entity_id, payload)
        VALUES (v_event_type, NEW.id, row_to_json(NEW)::jsonb);
    END IF;

    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Apply triggers to meeting_room_bookings
DROP TRIGGER IF EXISTS tr_meeting_room_outbox_insert ON public.meeting_room_bookings;
DROP TRIGGER IF EXISTS tr_meeting_room_booking_outbox_insert_update ON public.meeting_room_bookings;

CREATE TRIGGER tr_meeting_room_booking_outbox_insert_update_delete
    AFTER INSERT OR UPDATE OR DELETE ON public.meeting_room_bookings
    FOR EACH ROW
    EXECUTE FUNCTION public.create_outbox_event();

-- Apply triggers to material_requests
DROP TRIGGER IF EXISTS tr_material_request_outbox_insert ON public.material_requests;
CREATE TRIGGER tr_material_request_outbox_insert
    AFTER INSERT ON public.material_requests
    FOR EACH ROW
    EXECUTE FUNCTION public.create_outbox_event();

-- Enable RLS and lock it down (only service role / webhooks should access this table directly)
ALTER TABLE public.event_outbox ENABLE ROW LEVEL SECURITY;
-- By default, if no policies are defined and RLS is enabled, all normal user access is denied.
-- The service_role key (used by Next.js API / webhook) will bypass RLS.
