-- =============================================================================
-- Wrapper for deduct_meeting_room_credit
-- Allows Supabase RPC calls that use the parameter order expected by the frontend
-- (p_booking_id, p_credit_id, p_hours, p_notes, p_user_id).
-- =============================================================================

-- Wrapper function – forwards to the original implementation.
CREATE OR REPLACE FUNCTION public.deduct_meeting_room_credit(
    p_booking_id uuid,
    p_credit_id   uuid,
    p_hours       numeric,
    p_notes       text DEFAULT NULL,
    p_user_id     uuid DEFAULT NULL
) RETURNS boolean AS $$
BEGIN
    -- Call the original function with the correct argument order.
    RETURN public.deduct_meeting_room_credit(
        p_credit_id,
        p_hours,
        p_booking_id,
        p_user_id,
        p_notes
    );
END;
$$ LANGUAGE plpgsql;

-- Refresh PostgREST schema cache so the new function is immediately visible.
NOTIFY pgrst, 'reload schema';
