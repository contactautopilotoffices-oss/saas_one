-- =================================================================================
-- MEETING ROOM BUG FIXES
-- 1. Atomic credit deduction (prevents race condition / overspending)
-- 2. Atomic credit refund (supports company credits)
-- =================================================================================

-- Function: Atomically deduct meeting room credit
-- Returns true if deduction succeeded, false if insufficient credits
CREATE OR REPLACE FUNCTION deduct_meeting_room_credit(
    p_credit_id uuid,
    p_hours numeric,
    p_booking_id uuid,
    p_user_id uuid,
    p_notes text DEFAULT NULL
)
RETURNS boolean AS $$
DECLARE
    v_remaining numeric;
    v_company_id uuid;
BEGIN
    -- Lock the row and check remaining hours
    SELECT remaining_hours, company_id INTO v_remaining, v_company_id
    FROM meeting_room_credits
    WHERE id = p_credit_id
    FOR UPDATE;

    IF v_remaining IS NULL THEN
        RETURN false;
    END IF;

    IF v_remaining < p_hours THEN
        RETURN false;
    END IF;

    -- Atomic update
    UPDATE meeting_room_credits
    SET remaining_hours = remaining_hours - p_hours,
        updated_at = now()
    WHERE id = p_credit_id;

    -- Log the deduction
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

-- Function: Refund meeting room credit on cancellation
-- Looks up credit by company_id (if booking had one) or user_id
CREATE OR REPLACE FUNCTION refund_meeting_room_credit(
    p_property_id uuid,
    p_user_id uuid,
    p_company_id uuid,
    p_hours numeric,
    p_booking_id uuid,
    p_performed_by uuid,
    p_notes text DEFAULT NULL
)
RETURNS boolean AS $$
DECLARE
    v_credit_id uuid;
    v_remaining numeric;
    v_credit_company_id uuid;
BEGIN
    -- Find credit: prefer company credit if company_id was set on booking
    IF p_company_id IS NOT NULL THEN
        SELECT id, remaining_hours, company_id
        INTO v_credit_id, v_remaining, v_credit_company_id
        FROM meeting_room_credits
        WHERE property_id = p_property_id AND company_id = p_company_id
        FOR UPDATE;
    END IF;

    -- Fallback to user credit if no company credit found
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

    -- Atomic refund
    UPDATE meeting_room_credits
    SET remaining_hours = remaining_hours + p_hours,
        updated_at = now()
    WHERE id = v_credit_id;

    -- Log the refund
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

-- Function: Batch reset meeting room credits (N+1 fix)
-- Updates all credits whose next_reset_at <= now in a single query
CREATE OR REPLACE FUNCTION batch_reset_meeting_room_credits(
    p_next_reset_at timestamptz,
    p_now timestamptz
)
RETURNS void AS $$
BEGIN
    UPDATE meeting_room_credits
    SET remaining_hours = monthly_hours,
        last_reset_at = p_now,
        next_reset_at = p_next_reset_at,
        updated_at = p_now
    WHERE next_reset_at <= p_now;
END;
$$ LANGUAGE plpgsql;

-- Refresh PostgREST
NOTIFY pgrst, 'reload schema';
