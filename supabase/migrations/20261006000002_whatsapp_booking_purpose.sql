-- Optional source-provided booking notes, stored at insertion with one outbox event.
-- Requires the assistant, range-booking and tenant-credit-policy migrations.
BEGIN;

CREATE OR REPLACE FUNCTION public.whatsapp_assistant_book_range(
    p_user_id uuid, p_property_id uuid, p_room_id uuid, p_date date, p_start_time time, p_end_time time, p_request_id uuid, p_purpose text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_booking meeting_room_bookings;
    v_credit meeting_room_credits;
    v_company_id uuid;
    v_company_count integer;
    v_org_id uuid;
    v_hours numeric;
    v_purpose text := NULLIF(btrim(p_purpose), '');
BEGIN
    IF char_length(v_purpose) > 500 THEN RAISE EXCEPTION 'Invalid booking purpose'; END IF;
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
        IF v_booking.meeting_room_id IS DISTINCT FROM p_room_id
            OR v_booking.booking_date IS DISTINCT FROM p_date
            OR v_booking.start_time IS DISTINCT FROM p_start_time
            OR v_booking.end_time IS DISTINCT FROM p_end_time
            OR v_booking.comment IS DISTINCT FROM v_purpose THEN
            RAISE EXCEPTION 'OPERATION_ALREADY_CREATED';
        END IF;
        RETURN to_jsonb(v_booking);
    END IF;
    PERFORM 1 FROM meeting_rooms
        WHERE id = p_room_id AND property_id = p_property_id AND status = 'active' FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Room is not active at this property'; END IF;
    SELECT organization_id INTO v_org_id FROM properties WHERE id = p_property_id;
    IF p_date IS NULL OR p_start_time IS NULL OR p_end_time IS NULL OR p_end_time <= p_start_time
        OR (p_date + p_start_time) AT TIME ZONE 'Asia/Kolkata' <= now() THEN
        RAISE EXCEPTION 'Invalid or past interval';
    END IF;
    PERFORM 1 FROM meeting_room_slots FOR SHARE;
    IF NOT COALESCE((SELECT range_agg(tsrange(p_date + start_time, p_date + end_time, '[)'))
        @> tsrange(p_date + p_start_time, p_date + p_end_time, '[)')
        FROM meeting_room_slots WHERE end_time > start_time), false) THEN
        RAISE EXCEPTION 'Outside configured booking slots';
    END IF;
    v_hours := extract(epoch FROM (p_end_time - p_start_time)) / 3600;
    IF EXISTS (SELECT 1 FROM meeting_room_bookings WHERE meeting_room_id = p_room_id
        AND booking_date = p_date AND status = 'confirmed'
        AND start_time < p_end_time AND end_time > p_start_time) THEN
        RAISE EXCEPTION 'SLOT_UNAVAILABLE';
    END IF;
    -- Only tenants pay from an individual or company allocation at this property.
    IF public.whatsapp_assistant_requires_credits(p_user_id, p_property_id) THEN
        SELECT count(*), (array_agg(c.id))[1] INTO v_company_count, v_company_id
            FROM company_members m JOIN companies c ON c.id = m.company_id
            WHERE m.user_id = p_user_id AND c.property_id = p_property_id;
        IF v_company_count > 1 THEN RAISE EXCEPTION 'Multiple companies at this property; contact your property manager'; END IF;
        SELECT * INTO v_credit FROM meeting_room_credits
            WHERE property_id = p_property_id AND
            ((v_company_id IS NOT NULL AND company_id = v_company_id) OR
             (v_company_id IS NULL AND company_id IS NULL AND user_id = p_user_id)) FOR UPDATE;
        IF v_credit.id IS NULL OR COALESCE(v_credit.remaining_hours, 0) < v_hours THEN
            RAISE EXCEPTION 'INSUFFICIENT_CREDITS';
        END IF;
    END IF;
    INSERT INTO meeting_room_bookings(meeting_room_id, property_id, organization_id, user_id, company_id,
        booking_date, start_time, end_time, status, comment, wa_assistant_request_id)
        VALUES (p_room_id, p_property_id, v_org_id, p_user_id, v_company_id, p_date,
            p_start_time, p_end_time, 'confirmed', v_purpose, p_request_id)
        RETURNING * INTO v_booking;
    IF v_credit.id IS NOT NULL AND NOT deduct_meeting_room_credit(v_credit.id, v_hours, v_booking.id,
        p_user_id, 'WhatsApp booking deduction') THEN RAISE EXCEPTION 'INSUFFICIENT_CREDITS'; END IF;
    RETURN to_jsonb(v_booking);
END;
$$;

-- Preserve the existing seven-argument RPC. New bookings without supplied notes
-- have NULL comments. Existing rows are never rewritten by this migration.
CREATE OR REPLACE FUNCTION public.whatsapp_assistant_book_range(
    p_user_id uuid, p_property_id uuid, p_room_id uuid, p_date date, p_start_time time, p_end_time time, p_request_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_purpose text;
BEGIN
    IF p_request_id IS NULL THEN RAISE EXCEPTION 'Missing booking request ID'; END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended(p_request_id::text, 0));
    -- A caller without a notes parameter is not changing stored notes. Preserve
    -- even the old source label on an existing booking; the new RPC still checks
    -- access, identity and the immutable room/date/time tuple before returning it.
    SELECT comment INTO v_purpose FROM meeting_room_bookings
        WHERE wa_assistant_request_id = p_request_id AND user_id = p_user_id AND property_id = p_property_id;
    RETURN public.whatsapp_assistant_book_range(p_user_id,p_property_id,p_room_id,p_date,p_start_time,p_end_time,p_request_id,v_purpose);
END;
$$;

REVOKE ALL ON FUNCTION public.whatsapp_assistant_book_range(uuid,uuid,uuid,date,time,time,uuid,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.whatsapp_assistant_book_range(uuid,uuid,uuid,date,time,time,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.whatsapp_assistant_book_range(uuid,uuid,uuid,date,time,time,uuid,text),
    public.whatsapp_assistant_book_range(uuid,uuid,uuid,date,time,time,uuid) TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
