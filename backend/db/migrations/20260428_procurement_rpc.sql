-- RPC to update budget spent amount atomically
CREATE OR REPLACE FUNCTION update_procurement_budget_spent(
    p_property_id uuid,
    p_budget_type text,
    p_amount numeric
)
RETURNS void AS $$
BEGIN
    UPDATE procurement_budgets
    SET spent_amount = spent_amount + p_amount,
        updated_at = now()
    WHERE property_id = p_property_id
      AND budget_type = p_budget_type
      AND period_start <= CURRENT_DATE
      AND (period_end IS NULL OR period_end >= CURRENT_DATE);
END;
$$ LANGUAGE plpgsql;
