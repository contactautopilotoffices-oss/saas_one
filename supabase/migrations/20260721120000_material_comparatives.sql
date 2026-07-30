-- 1. Add read receipt column to material_requests
ALTER TABLE public.material_requests
ADD COLUMN IF NOT EXISTS procurement_viewed_at TIMESTAMP WITH TIME ZONE;

-- 2. Create the comparatives tracking table
CREATE TABLE IF NOT EXISTS public.material_request_comparatives (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id UUID NOT NULL REFERENCES public.material_requests(id) ON DELETE CASCADE,
    file_url TEXT,
    total_cost NUMERIC(15, 2),
    vendor_details JSONB,
    notes TEXT,
    status VARCHAR(50) DEFAULT 'pending_approval' CHECK (status IN ('pending_approval', 'approved', 'rejected', 'negotiating')),
    created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    action_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    action_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Index for fast lookup by request
CREATE INDEX IF NOT EXISTS idx_mat_req_comparatives_request_id ON public.material_request_comparatives(request_id);

-- Updated_at trigger for comparatives
DROP TRIGGER IF EXISTS comparatives_updated_at ON public.material_request_comparatives;
CREATE TRIGGER comparatives_updated_at
    BEFORE UPDATE ON public.material_request_comparatives
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_updated_at_outbox(); -- Reuse existing updated_at function

-- 3. Row Level Security for comparatives
ALTER TABLE public.material_request_comparatives ENABLE ROW LEVEL SECURITY;

-- Allow read access to users related to the request (requester, assignee, or admins)
-- (In a real scenario, this would join with memberships. For simplicity and performance, 
-- we allow authenticated users to view, relying on the API layer for strict access control).
CREATE POLICY "Enable read access for all authenticated users"
    ON public.material_request_comparatives FOR SELECT
    USING (auth.role() = 'authenticated');

-- Service role bypasses RLS automatically. 

-- 4. Update the outbox event trigger function to handle the new procurement events
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
            INSERT INTO public.event_outbox (event_type, entity_id, payload) VALUES (v_event_type, NEW.id, v_payload);
            RETURN NEW;
        ELSIF TG_OP = 'UPDATE' AND NEW.status = 'cancelled' AND OLD.status != 'cancelled' THEN
            v_event_type := 'MEETING_ROOM_CANCELLED';
            v_payload := row_to_json(NEW)::jsonb;
            INSERT INTO public.event_outbox (event_type, entity_id, payload) VALUES (v_event_type, NEW.id, v_payload);
            RETURN NEW;
        ELSIF TG_OP = 'DELETE' THEN
            v_event_type := 'MEETING_ROOM_CANCELLED';
            v_payload := row_to_json(OLD)::jsonb;
            INSERT INTO public.event_outbox (event_type, entity_id, payload) VALUES (v_event_type, OLD.id, v_payload);
            RETURN OLD;
        ELSE
            RETURN COALESCE(NEW, OLD);
        END IF;

    ELSIF TG_TABLE_NAME = 'material_requests' THEN
        IF TG_OP = 'INSERT' THEN
            v_event_type := 'MATERIAL_REQUEST_CREATED';
            v_payload := row_to_json(NEW)::jsonb;
            INSERT INTO public.event_outbox (event_type, entity_id, payload) VALUES (v_event_type, NEW.id, v_payload);
            RETURN NEW;
        ELSIF TG_OP = 'UPDATE' AND NEW.status = 'delivered' AND OLD.status != 'delivered' THEN
            v_event_type := 'MATERIAL_DELIVERED';
            v_payload := row_to_json(NEW)::jsonb;
            INSERT INTO public.event_outbox (event_type, entity_id, payload) VALUES (v_event_type, NEW.id, v_payload);
            RETURN NEW;
        ELSE
            RETURN COALESCE(NEW, OLD);
        END IF;

    ELSIF TG_TABLE_NAME = 'material_request_comparatives' THEN
        IF TG_OP = 'INSERT' THEN
            v_event_type := 'COMPARATIVE_UPLOADED';
            v_payload := row_to_json(NEW)::jsonb;
            INSERT INTO public.event_outbox (event_type, entity_id, payload) VALUES (v_event_type, NEW.id, v_payload);
            RETURN NEW;
        ELSIF TG_OP = 'UPDATE' AND NEW.status = 'approved' AND OLD.status != 'approved' THEN
            v_event_type := 'COMPARATIVE_APPROVED';
            v_payload := row_to_json(NEW)::jsonb;
            INSERT INTO public.event_outbox (event_type, entity_id, payload) VALUES (v_event_type, NEW.id, v_payload);
            RETURN NEW;
        ELSIF TG_OP = 'UPDATE' AND NEW.status IN ('rejected', 'negotiating') AND OLD.status NOT IN ('rejected', 'negotiating') THEN
            v_event_type := 'COMPARATIVE_REJECTED';
            v_payload := row_to_json(NEW)::jsonb;
            INSERT INTO public.event_outbox (event_type, entity_id, payload) VALUES (v_event_type, NEW.id, v_payload);
            RETURN NEW;
        ELSE
            RETURN COALESCE(NEW, OLD);
        END IF;
    END IF;

    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. Attach triggers
DROP TRIGGER IF EXISTS tr_material_request_outbox_insert ON public.material_requests;
DROP TRIGGER IF EXISTS tr_material_request_outbox_insert_update ON public.material_requests;

CREATE TRIGGER tr_material_request_outbox_insert_update
    AFTER INSERT OR UPDATE ON public.material_requests
    FOR EACH ROW
    EXECUTE FUNCTION public.create_outbox_event();

DROP TRIGGER IF EXISTS tr_material_comparatives_outbox ON public.material_request_comparatives;
CREATE TRIGGER tr_material_comparatives_outbox
    AFTER INSERT OR UPDATE ON public.material_request_comparatives
    FOR EACH ROW
    EXECUTE FUNCTION public.create_outbox_event();
