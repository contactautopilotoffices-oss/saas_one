-- Apply before enabling AISENSY_ASSISTANT_ENABLED. All RPCs are service-role only.
BEGIN;
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;

CREATE TABLE public.whatsapp_assistant_sessions (
    phone text PRIMARY KEY,
    state jsonb,
    expires_at timestamptz,
    lease_token uuid,
    locked_until timestamptz,
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.whatsapp_assistant_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    phone text NOT NULL REFERENCES public.whatsapp_assistant_sessions(phone),
    message_id text NOT NULL,
    payload jsonb NOT NULL,
    snapshot jsonb,
    snapshotted boolean NOT NULL DEFAULT false,
    reply jsonb,
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','ready','sent','failed')),
    attempts integer NOT NULL DEFAULT 0,
    error text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (phone, message_id)
);
CREATE INDEX whatsapp_assistant_pending ON public.whatsapp_assistant_events(phone, created_at)
    WHERE status IN ('pending','processing','ready');
ALTER TABLE public.whatsapp_assistant_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_assistant_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.whatsapp_assistant_sessions, public.whatsapp_assistant_events FROM anon, authenticated;
GRANT ALL ON public.whatsapp_assistant_sessions, public.whatsapp_assistant_events TO service_role;

ALTER TABLE public.tickets ADD COLUMN wa_assistant_request_id uuid UNIQUE;
ALTER TABLE public.meeting_room_bookings ADD COLUMN wa_assistant_request_id uuid UNIQUE;
-- Protect all booking channels, including the website, from overlapping confirmed bookings.
-- Existing overlapping confirmed rows must be reconciled before applying this constraint.
ALTER TABLE public.meeting_room_bookings ADD CONSTRAINT meeting_room_no_overlap
    EXCLUDE USING gist (meeting_room_id WITH =,
        tsrange(booking_date + start_time, booking_date + end_time, '[)') WITH &&)
    WHERE (status = 'confirmed');

CREATE FUNCTION public.whatsapp_assistant_properties(p_user_id uuid)
RETURNS TABLE (id uuid, name text, organization_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT p.id, p.name, p.organization_id FROM properties p
    JOIN users u ON u.id = p_user_id
    WHERE p.is_active = true AND p.deleted_at IS NULL
      AND (u.is_master_admin OR u.is_approved OR u.approval_status = 'approved')
      AND (u.is_master_admin OR EXISTS (
          SELECT 1 FROM organization_memberships m
          WHERE m.user_id = p_user_id AND m.organization_id = p.organization_id AND m.is_active
            AND m.role::text IN ('org_super_admin','ops_super_admin','org_admin','owner')
      ) OR EXISTS (
          SELECT 1 FROM property_memberships m
          WHERE m.user_id = p_user_id AND m.property_id = p.id AND m.is_active
      )) ORDER BY p.name, p.id;
$$;

CREATE FUNCTION public.whatsapp_assistant_enqueue(p_payload jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
    IF COALESCE(p_payload->>'messageId', '') = '' OR COALESCE(p_payload->>'phone', '') = '' THEN
        RAISE EXCEPTION 'A sender and stable message ID are required';
    END IF;
    INSERT INTO whatsapp_assistant_sessions(phone) VALUES (p_payload->>'phone') ON CONFLICT DO NOTHING;
    INSERT INTO whatsapp_assistant_events(phone, message_id, payload)
        VALUES (p_payload->>'phone', p_payload->>'messageId', p_payload)
        ON CONFLICT (phone, message_id) DO NOTHING RETURNING id INTO v_id;
    RETURN v_id;
END;
$$;

CREATE FUNCTION public.whatsapp_assistant_claim(p_phone text, p_token uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_session whatsapp_assistant_sessions; v_event whatsapp_assistant_events;
BEGIN
    SELECT * INTO v_session FROM whatsapp_assistant_sessions WHERE phone = p_phone FOR UPDATE;
    IF NOT FOUND OR v_session.locked_until > now() THEN RETURN NULL; END IF;
    UPDATE whatsapp_assistant_events SET status = 'failed', error = COALESCE(error, 'Retry limit exhausted')
        WHERE phone = p_phone AND status IN ('pending','processing','ready') AND attempts >= 5;
    SELECT * INTO v_event FROM whatsapp_assistant_events
        WHERE phone = p_phone AND status IN ('pending','processing','ready') AND attempts < 5
        ORDER BY created_at, id LIMIT 1 FOR UPDATE;
    IF NOT FOUND THEN RETURN NULL; END IF;
    UPDATE whatsapp_assistant_sessions SET lease_token = p_token, locked_until = now() + interval '5 minutes'
        WHERE phone = p_phone;
    IF NOT v_event.snapshotted THEN
        v_event.snapshot := CASE WHEN v_session.expires_at > now() THEN v_session.state ELSE NULL END;
        v_event.snapshotted := true;
    END IF;
    UPDATE whatsapp_assistant_events SET snapshot = v_event.snapshot, snapshotted = true,
        status = CASE WHEN status = 'ready' THEN 'ready' ELSE 'processing' END,
        attempts = attempts + 1, updated_at = now()
        WHERE id = v_event.id RETURNING * INTO v_event;
    RETURN to_jsonb(v_event);
END;
$$;

CREATE FUNCTION public.whatsapp_assistant_save(p_id uuid, p_token uuid, p_state jsonb, p_reply jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_phone text;
BEGIN
    SELECT phone INTO v_phone FROM whatsapp_assistant_events WHERE id = p_id;
    PERFORM 1 FROM whatsapp_assistant_sessions WHERE phone = v_phone AND lease_token = p_token FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Assistant lease lost'; END IF;
    UPDATE whatsapp_assistant_sessions SET state = p_state, expires_at = now() + interval '20 minutes', updated_at = now()
        WHERE phone = v_phone;
    UPDATE whatsapp_assistant_events SET reply = p_reply, status = 'ready', updated_at = now() WHERE id = p_id;
END;
$$;

CREATE FUNCTION public.whatsapp_assistant_finish(p_id uuid, p_token uuid, p_error text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_phone text;
BEGIN
    SELECT phone INTO v_phone FROM whatsapp_assistant_events WHERE id = p_id;
    PERFORM 1 FROM whatsapp_assistant_sessions WHERE phone = v_phone AND lease_token = p_token FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Assistant lease lost'; END IF;
    UPDATE whatsapp_assistant_events SET status = CASE WHEN p_error IS NULL THEN 'sent'
        WHEN attempts >= 5 THEN 'failed' WHEN reply IS NOT NULL THEN 'ready' ELSE 'pending' END,
        error = p_error, updated_at = now() WHERE id = p_id;
    UPDATE whatsapp_assistant_sessions SET lease_token = NULL, locked_until = NULL,
        expires_at = CASE WHEN p_error IS NULL THEN now() + interval '20 minutes' ELSE expires_at END
        WHERE phone = v_phone;
END;
$$;

CREATE FUNCTION public.whatsapp_assistant_book(
    p_user_id uuid, p_property_id uuid, p_room_id uuid, p_slot_id uuid, p_date date, p_request_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_booking meeting_room_bookings;
    v_slot meeting_room_slots;
    v_credit meeting_room_credits;
    v_company_id uuid;
    v_company_count integer;
    v_org_id uuid;
    v_hours numeric;
BEGIN
    IF p_request_id IS NULL THEN RAISE EXCEPTION 'Missing booking request ID'; END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended(p_request_id::text, 0));
    IF NOT EXISTS (SELECT 1 FROM whatsapp_assistant_properties(p_user_id) WHERE id = p_property_id) THEN
        RAISE EXCEPTION 'No active access to this property';
    END IF;
    SELECT * INTO v_booking FROM meeting_room_bookings WHERE wa_assistant_request_id = p_request_id;
    IF FOUND THEN
        IF v_booking.user_id <> p_user_id OR v_booking.property_id <> p_property_id THEN
            RAISE EXCEPTION 'Booking request identity mismatch';
        END IF;
        RETURN to_jsonb(v_booking);
    END IF;
    PERFORM 1 FROM meeting_rooms
        WHERE id = p_room_id AND property_id = p_property_id AND status = 'active' FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Room is not active at this property'; END IF;
    SELECT organization_id INTO v_org_id FROM properties WHERE id = p_property_id;
    SELECT * INTO v_slot FROM meeting_room_slots WHERE id = p_slot_id FOR SHARE;
    IF p_date IS NULL OR NOT FOUND OR v_slot.end_time <= v_slot.start_time
        OR (p_date + v_slot.start_time) AT TIME ZONE 'Asia/Kolkata' <= now() THEN
        RAISE EXCEPTION 'Invalid or past slot';
    END IF;
    v_hours := extract(epoch FROM (v_slot.end_time - v_slot.start_time)) / 3600;
    IF EXISTS (SELECT 1 FROM meeting_room_bookings WHERE meeting_room_id = p_room_id
        AND booking_date = p_date AND status = 'confirmed'
        AND start_time < v_slot.end_time AND end_time > v_slot.start_time) THEN
        RAISE EXCEPTION 'SLOT_UNAVAILABLE';
    END IF;
    SELECT count(*), (array_agg(c.id))[1] INTO v_company_count, v_company_id
        FROM company_members m JOIN companies c ON c.id = m.company_id
        WHERE m.user_id = p_user_id AND c.property_id = p_property_id;
    IF v_company_count > 1 THEN RAISE EXCEPTION 'Multiple companies at this property; contact your property manager'; END IF;
    SELECT * INTO v_credit FROM meeting_room_credits
        WHERE property_id = p_property_id AND
        ((v_company_id IS NOT NULL AND company_id = v_company_id) OR
         (v_company_id IS NULL AND company_id IS NULL AND user_id = p_user_id)) FOR UPDATE;
    -- Preserve current app behavior: enforce credits only when a record exists.
    IF v_credit.id IS NOT NULL AND COALESCE(v_credit.remaining_hours, 0) < v_hours THEN
        RAISE EXCEPTION 'INSUFFICIENT_CREDITS';
    END IF;
    INSERT INTO meeting_room_bookings(meeting_room_id, property_id, organization_id, user_id, company_id,
        booking_date, start_time, end_time, status, comment, wa_assistant_request_id)
        VALUES (p_room_id, p_property_id, v_org_id, p_user_id, v_company_id, p_date,
            v_slot.start_time, v_slot.end_time, 'confirmed', 'Booked via Autopilot WhatsApp', p_request_id)
        RETURNING * INTO v_booking;
    IF v_credit.id IS NOT NULL AND NOT deduct_meeting_room_credit(v_credit.id, v_hours, v_booking.id,
        p_user_id, 'WhatsApp booking deduction') THEN RAISE EXCEPTION 'INSUFFICIENT_CREDITS'; END IF;
    RETURN to_jsonb(v_booking);
END;
$$;

REVOKE ALL ON FUNCTION public.whatsapp_assistant_properties(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.whatsapp_assistant_enqueue(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.whatsapp_assistant_claim(text,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.whatsapp_assistant_save(uuid,uuid,jsonb,jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.whatsapp_assistant_finish(uuid,uuid,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.whatsapp_assistant_book(uuid,uuid,uuid,uuid,date,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.whatsapp_assistant_properties(uuid), public.whatsapp_assistant_enqueue(jsonb),
    public.whatsapp_assistant_claim(text,uuid), public.whatsapp_assistant_save(uuid,uuid,jsonb,jsonb),
    public.whatsapp_assistant_finish(uuid,uuid,text), public.whatsapp_assistant_book(uuid,uuid,uuid,uuid,date,uuid)
    TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
