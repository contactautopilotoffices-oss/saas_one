-- 20260604_update_budget_rls_policy.sql
-- Update RLS policy on procurement_budgets to restrict visibility to authorized users
-- Drop the previous open policy and create a stricter one

DROP POLICY IF EXISTS budget_select ON procurement_budgets;

-- Allow SELECT only for users who are members of the organization and have a role that can view budgets
CREATE POLICY budget_select ON procurement_budgets FOR SELECT USING (
    EXISTS (
        SELECT 1 FROM organization_memberships om
        WHERE om.user_id = auth.uid()
          AND om.organization_id = procurement_budgets.organization_id
          AND om.role IN ('org_super_admin', 'master_admin', 'budget_viewer', 'procurement')
    )
);

-- Refresh PostgREST schema after policy change
NOTIFY pgrst, 'reload schema';
