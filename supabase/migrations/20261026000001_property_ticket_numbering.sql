-- Migration: Property-scoped Sequential Ticket Numbering
-- File: supabase/migrations/20261026000001_property_ticket_numbering.sql

-- 1. Add columns to public.tickets
ALTER TABLE public.tickets
ADD COLUMN IF NOT EXISTS property_sequence_number INT,
ADD COLUMN IF NOT EXISTS legacy_ticket_number TEXT;

-- Index for searching legacy ticket numbers and property sequence
CREATE INDEX IF NOT EXISTS idx_tickets_legacy_ticket_number ON public.tickets (legacy_ticket_number);
CREATE INDEX IF NOT EXISTS idx_tickets_property_sequence ON public.tickets (property_id, property_sequence_number);

-- 2. Create Sequence Table for Atomic Per-Property Counters
CREATE TABLE IF NOT EXISTS public.ticket_property_sequences (
    property_id UUID PRIMARY KEY REFERENCES public.properties(id) ON DELETE CASCADE,
    last_sequence INT NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.ticket_property_sequences ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow authenticated read ticket_property_sequences"
ON public.ticket_property_sequences FOR SELECT
TO authenticated USING (true);

-- 3. Function to get Org initials (defaults to 'AP' for Autopilot Offices)
CREATE OR REPLACE FUNCTION public.get_ticket_org_initials(p_org_id UUID)
RETURNS TEXT AS $$
DECLARE
    v_name TEXT;
    v_clean TEXT;
    v_words TEXT[];
    v_word TEXT;
    v_initials TEXT := '';
BEGIN
    SELECT name INTO v_name FROM public.organizations WHERE id = p_org_id;
    IF v_name IS NULL OR TRIM(v_name) = '' THEN
        RETURN 'AP';
    END IF;
    
    IF LOWER(v_name) LIKE '%autopilot%' THEN
        RETURN 'AP';
    END IF;
    IF LOWER(TRIM(v_name)) = 'tcs' THEN
        RETURN 'TCS';
    END IF;

    v_clean := regexp_replace(TRIM(v_name), '[^a-zA-Z0-9\s]', '', 'g');
    v_words := regexp_split_to_array(v_clean, '\s+');
    
    IF array_length(v_words, 1) = 1 THEN
        RETURN UPPER(SUBSTRING(v_words[1] FROM 1 FOR 3));
    END IF;

    FOREACH v_word IN ARRAY v_words LOOP
        IF LENGTH(v_word) > 0 THEN
            v_initials := v_initials || UPPER(SUBSTRING(v_word FROM 1 FOR 1));
        END IF;
    END LOOP;

    IF v_initials = '' THEN
        RETURN 'AP';
    END IF;

    RETURN v_initials;
END;
$$ LANGUAGE plpgsql STABLE;

-- 4. Function to derive Property initials algorithmically
CREATE OR REPLACE FUNCTION public.get_ticket_property_initials(p_property_id UUID)
RETURNS TEXT AS $$
DECLARE
    v_name TEXT;
    v_clean TEXT;
    v_words TEXT[];
    v_word TEXT;
    v_res TEXT := '';
    i INT;
BEGIN
    SELECT name INTO v_name FROM public.properties WHERE id = p_property_id;
    IF v_name IS NULL OR TRIM(v_name) = '' THEN
        RETURN 'PRP';
    END IF;

    -- Clean punctuation like commas, normalize whitespace
    v_clean := TRIM(regexp_replace(v_name, '[,]', '', 'g'));
    -- Split camelCase into words (e.g. MyGate -> My Gate)
    v_clean := regexp_replace(v_clean, '([a-z])([A-Z])', '\1 \2', 'g');
    -- Split by spaces or hyphens
    v_words := regexp_split_to_array(v_clean, '[\s-]+');
    
    IF array_length(v_words, 1) = 1 THEN
        -- Single word: first 3 letters
        RETURN UPPER(SUBSTRING(v_words[1] FROM 1 FOR 3));
    END IF;

    -- Multi-word:
    FOR i IN 1..array_length(v_words, 1) LOOP
        v_word := v_words[i];
        IF UPPER(v_word) = 'SS' THEN
            v_res := v_res || 'SS';
        ELSIF LOWER(v_word) = '3i' THEN
            v_res := v_res || '3I';
        ELSIF LENGTH(v_word) > 0 THEN
            v_res := v_res || UPPER(SUBSTRING(v_word FROM 1 FOR 1));
        END IF;
    END LOOP;

    IF v_res = '' THEN
        RETURN 'PRP';
    END IF;

    RETURN v_res;
END;
$$ LANGUAGE plpgsql STABLE;

-- 5. Trigger Function to automatically assign sequential ticket_number
CREATE OR REPLACE FUNCTION public.generate_ticket_number()
RETURNS TRIGGER AS $$
DECLARE
    v_next_seq INT;
    v_org_init TEXT;
    v_prop_init TEXT;
    v_pad_len INT;
    v_seq_str TEXT;
BEGIN
    -- Only generate if ticket_number is not set or starts with legacy prefix TKT-
    IF NEW.ticket_number IS NULL OR NEW.ticket_number = '' OR NEW.ticket_number LIKE 'TKT-%' THEN
        IF NEW.property_id IS NOT NULL THEN
            -- Atomically increment sequence for this property
            INSERT INTO public.ticket_property_sequences (property_id, last_sequence, updated_at)
            VALUES (NEW.property_id, 1, NOW())
            ON CONFLICT (property_id) DO UPDATE
            SET last_sequence = ticket_property_sequences.last_sequence + 1,
                updated_at = NOW()
            RETURNING last_sequence INTO v_next_seq;

            NEW.property_sequence_number := v_next_seq;

            -- Derive initials
            v_org_init := public.get_ticket_org_initials(NEW.organization_id);
            v_prop_init := public.get_ticket_property_initials(NEW.property_id);

            -- Format with dynamic padding: minimum 3 digits, expands to 4, 5 digits as needed
            v_seq_str := v_next_seq::TEXT;
            v_pad_len := GREATEST(3, LENGTH(v_seq_str));

            -- If there was an incoming legacy number like TKT-..., store it in legacy_ticket_number
            IF NEW.ticket_number IS NOT NULL AND NEW.ticket_number LIKE 'TKT-%' AND NEW.legacy_ticket_number IS NULL THEN
                NEW.legacy_ticket_number := NEW.ticket_number;
            END IF;

            NEW.ticket_number := v_org_init || '-' || v_prop_init || '-' || LPAD(v_seq_str, v_pad_len, '0');
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 6. Attach Trigger BEFORE INSERT
DROP TRIGGER IF EXISTS trg_generate_ticket_number ON public.tickets;
CREATE TRIGGER trg_generate_ticket_number
BEFORE INSERT ON public.tickets
FOR EACH ROW
EXECUTE FUNCTION public.generate_ticket_number();
