-- 20260603_create_decrement_procurement_budget_function.sql
-- Adds a server-side function to decrement (i.e., spend) a procurement budget safely
CREATE OR REPLACE FUNCTION decrement_procurement_budget(
    p_property_id uuid,
    p_budget_type text,
    p_amount numeric
) RETURNS void AS $$
DECLARE
    current_spent numeric;
    total_amount numeric;
BEGIN
    -- Lock the budget row to prevent race conditions
    SELECT spent_amount, total_amount
    INTO current_spent, total_amount
    FROM procurement_budgets
    WHERE property_id = p_property_id
      AND budget_type = p_budget_type
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Budget not found for property % and type %', p_property_id, p_budget_type;
    END IF;

    -- Ensure we do not overspend
    IF current_spent + p_amount > total_amount THEN
        RAISE EXCEPTION 'Insufficient budget: attempted to spend % (available %)', p_amount, total_amount - current_spent;
    END IF;

    UPDATE procurement_budgets
    SET spent_amount = spent_amount + p_amount,
        updated_at = now()
    WHERE property_id = p_property_id
      AND budget_type = p_budget_type;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Refresh PostgREST schema after function change
NOTIFY pgrst, 'reload schema';
