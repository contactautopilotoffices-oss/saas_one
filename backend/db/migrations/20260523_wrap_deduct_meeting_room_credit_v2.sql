-- =============================================================================
-- Wrapper for deduct_meeting_room_credit with arguments matching API call
-- =============================================================================

CREATE OR REPLACE FUNCTION public.deduct_meeting_room_credit_v2(
    p_booking_id uuid,
    p_credit_id   uuid,
    p_hours       numeric,
    p_user_id     uuid,
    p_notes       text DEFAULT NULL
) RETURNS boolean AS $$
BEGIN
    -- Forward to the original implementation (original signature)
    RETURN public.deduct_meeting_room_credit(
        p_credit_id,
        p_hours,
        p_booking_id,
        p_user_id,
        p_notes
    );
END;
$$ LANGUAGE plpgsql;

-- Notify PostgREST to reload schema cache
NOTIFY pgrst, 'reload schema';
