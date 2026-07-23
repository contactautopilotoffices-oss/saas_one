-- 20260602_add_budget_status_view.sql
-- View to show budget usage per property and type
CREATE OR REPLACE VIEW procurement_budget_status AS
SELECT
  property_id,
  budget_type,
  total_amount,
  spent_amount,
  (total_amount - spent_amount) AS remaining_amount
FROM procurement_budgets;

-- Refresh PostgREST schema
NOTIFY pgrst, 'reload schema';
