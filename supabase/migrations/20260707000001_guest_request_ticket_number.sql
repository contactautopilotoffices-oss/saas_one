-- Migration: Add Ticket Number Sequence to Guest Requests
-- 20260707000001_guest_request_ticket_number.sql

-- 1. Add Columns
ALTER TABLE public.guest_requests 
ADD COLUMN IF NOT EXISTS property_sequence_number INT,
ADD COLUMN IF NOT EXISTS ticket_number TEXT;

-- 2. Create helper to get initials
CREATE OR REPLACE FUNCTION public.get_initials(input_text TEXT)
RETURNS TEXT AS $$
DECLARE
    initials TEXT := '';
    word TEXT;
BEGIN
    IF input_text IS NULL OR trim(input_text) = '' THEN
        RETURN 'XX';
    END IF;
    -- Remove non-alphanumeric, split by spaces/hyphens
    FOR word IN SELECT unnest(regexp_split_to_array(trim(input_text), '[\s-]+')) LOOP
        IF length(word) > 0 THEN
            initials := initials || upper(left(regexp_replace(word, '[^a-zA-Z0-9]', '', 'g'), 1));
        END IF;
    END LOOP;
    
    -- Ensure at least something is returned
    IF length(initials) = 0 THEN
        RETURN 'XX';
    END IF;
    
    RETURN initials;
END;
$$ LANGUAGE plpgsql;

-- 3. Create Trigger Function
CREATE OR REPLACE FUNCTION public.generate_guest_request_ticket_number()
RETURNS TRIGGER AS $$
DECLARE
    next_seq INT;
    org_name TEXT;
    prop_name TEXT;
    zone_name TEXT;
    t_number TEXT;
BEGIN
    -- Get next sequence for property
    SELECT COALESCE(MAX(property_sequence_number), 0) + 1 INTO next_seq
    FROM public.guest_requests
    WHERE property_id = NEW.property_id;

    NEW.property_sequence_number := next_seq;

    -- Fetch Property and Organization Name
    SELECT p.name, o.name INTO prop_name, org_name
    FROM public.properties p
    LEFT JOIN public.organizations o ON p.organization_id = o.id
    WHERE p.id = NEW.property_id;

    -- Fetch Zone Name
    SELECT qz.zone_name INTO zone_name
    FROM public.qr_facility_zones qz
    WHERE qz.id = NEW.qr_zone_id;

    -- Generate ticket number
    t_number := public.get_initials(org_name) || '-' ||
                public.get_initials(prop_name) || '-' ||
                public.get_initials(zone_name) || '-' ||
                lpad(next_seq::text, 3, '0');
                
    NEW.ticket_number := t_number;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 4. Create Trigger
DROP TRIGGER IF EXISTS trg_generate_guest_request_ticket_number ON public.guest_requests;
CREATE TRIGGER trg_generate_guest_request_ticket_number
BEFORE INSERT ON public.guest_requests
FOR EACH ROW
EXECUTE FUNCTION public.generate_guest_request_ticket_number();

-- 5. Backfill existing data
DO $$
DECLARE
    req RECORD;
    next_seq INT;
    org_name TEXT;
    prop_name TEXT;
    z_name TEXT;
    t_number TEXT;
BEGIN
    FOR req IN 
        SELECT id, property_id, qr_zone_id 
        FROM public.guest_requests 
        WHERE ticket_number IS NULL
        ORDER BY created_at ASC
    LOOP
        -- Get next sequence for property
        SELECT COALESCE(MAX(property_sequence_number), 0) + 1 INTO next_seq
        FROM public.guest_requests
        WHERE property_id = req.property_id;

        -- Fetch Property and Organization Name
        SELECT p.name, o.name INTO prop_name, org_name
        FROM public.properties p
        LEFT JOIN public.organizations o ON p.organization_id = o.id
        WHERE p.id = req.property_id;

        -- Fetch Zone Name
        SELECT qz.zone_name INTO z_name
        FROM public.qr_facility_zones qz
        WHERE qz.id = req.qr_zone_id;

        -- Generate ticket number
        t_number := public.get_initials(org_name) || '-' ||
                    public.get_initials(prop_name) || '-' ||
                    public.get_initials(z_name) || '-' ||
                    lpad(next_seq::text, 3, '0');
                    
        UPDATE public.guest_requests
        SET property_sequence_number = next_seq,
            ticket_number = t_number
        WHERE id = req.id;
    END LOOP;
END $$;
