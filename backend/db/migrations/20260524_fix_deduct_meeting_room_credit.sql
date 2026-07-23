-- =============================================================================
-- Fix: both overloads must be dropped by their EXACT type signatures
-- =============================================================================

-- 1. Inspect what exists (run this first if you want to verify)
-- SELECT proname, proargnames, proargtypes::regtype[]
-- FROM pg_proc WHERE proname IN ('deduct_meeting_room_credit', 'refund_meeting_room_credit');

-- 2. Drop the OLD function signature (p_booking_id first)
DROP FUNCTION IF EXISTS public.deduct_meeting_room_credit(uuid, uuid, numeric, text, uuid) CASCADE;

-- 3. Drop the NEW/CORRECT function signature (p_credit_id first)
DROP FUNCTION IF EXISTS public.deduct_meeting_room_credit(uuid, numeric, uuid, uuid, text) CASCADE;

-- 4. Drop refund function if any duplicates exist
DROP FUNCTION IF EXISTS public.refund_meeting_room_credit(uuid, uuid, uuid, numeric, uuid, uuid, text) CASCADE;

-- 5. Recreate deduct with correct parameter order matching API
CREATE OR REPLACE FUNCTION public.deduct_meeting_room_credit(
    p_credit_id  uuid,
    p_hours      numeric,
    p_booking_id uuid,
    p_user_id    uuid,
    p_notes      text DEFAULT NULL
)
RETURNS boolean AS $$
DECLARE
    v_remaining  numeric;
    v_company_id uuid;
BEGIN
    SELECT remaining_hours, company_id INTO v_remaining, v_company_id
    FROM meeting_room_credits
    WHERE id = p_credit_id
    FOR UPDATE;

    IF v_remaining IS NULL OR v_remaining < p_hours THEN
        RETURN false;
    END IF;

    UPDATE meeting_room_credits
    SET remaining_hours = remaining_hours - p_hours,
        updated_at = now()
    WHERE id = p_credit_id;

    INSERT INTO meeting_room_credit_log (
        credit_id, user_id, company_id, action,
        hours_changed, hours_after, booking_id, performed_by, notes, created_at
    ) VALUES (
        p_credit_id, p_user_id, v_company_id, 'deducted',
        -p_hours, v_remaining - p_hours, p_booking_id, p_user_id,
        COALESCE(p_notes, 'Booking deduction'), now()
    );

    RETURN true;
END;
$$ LANGUAGE plpgsql;

-- 6. Recreate refund with correct parameter order matching API
CREATE OR REPLACE FUNCTION public.refund_meeting_room_credit(
    p_property_id  uuid,
    p_user_id      uuid,
    p_company_id   uuid,
    p_hours        numeric,
    p_booking_id   uuid,
    p_performed_by uuid,
    p_notes        text DEFAULT NULL
)
RETURNS boolean AS $$
DECLARE
    v_credit_id         uuid;
    v_remaining         numeric;
    v_credit_company_id uuid;
BEGIN
    IF p_company_id IS NOT NULL THEN
        SELECT id, remaining_hours, company_id
        INTO v_credit_id, v_remaining, v_credit_company_id
        FROM meeting_room_credits
        WHERE property_id = p_property_id AND company_id = p_company_id
        FOR UPDATE;
    END IF;

    IF v_credit_id IS NULL THEN
        SELECT id, remaining_hours, company_id
        INTO v_credit_id, v_remaining, v_credit_company_id
        FROM meeting_room_credits
        WHERE property_id = p_property_id AND user_id = p_user_id
        FOR UPDATE;
    END IF;

    IF v_credit_id IS NULL THEN
        RETURN false;
    END IF;

    UPDATE meeting_room_credits
    SET remaining_hours = remaining_hours + p_hours,
        updated_at = now()
    WHERE id = v_credit_id;

    INSERT INTO meeting_room_credit_log (
        credit_id, user_id, company_id, action,
        hours_changed, hours_after, booking_id, performed_by, notes, created_at
    ) VALUES (
        v_credit_id, p_user_id, v_credit_company_id, 'refunded',
        p_hours, v_remaining + p_hours, p_booking_id, p_performed_by,
        COALESCE(p_notes, 'Credit refund on booking cancellation'), now()
    );

    RETURN true;
END;
$$ LANGUAGE plpgsql;

NOTIFY pgrst, 'reload schema';
