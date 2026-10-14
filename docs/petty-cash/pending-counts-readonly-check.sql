-- READ ONLY. Run in the SQL Editor of the Supabase project used by the app.
-- This checks installation and execution grants, not a particular user's counts.
WITH expected(signature) AS (VALUES
 ('public.pc_pending_counts(uuid,uuid)'),
 ('public.pc_internal(uuid,uuid,uuid)'),
 ('public.pc_can_read(uuid,uuid)'),
 ('public.pc_finance(uuid,uuid,uuid)'),
 ('public.pc_report(uuid,uuid)')
)
SELECT signature,
 to_regprocedure(signature) IS NOT NULL AS function_exists,
 CASE WHEN to_regprocedure(signature) IS NOT NULL
 THEN has_function_privilege('service_role',to_regprocedure(signature),'EXECUTE')
 ELSE false END AS service_role_can_execute
FROM expected;

WITH expected(table_name,column_name) AS (VALUES
 ('petty_cash_requests','workflow_version'),
 ('petty_cash_requests','assigned_allocator_id'),
 ('petty_cash_requests','assigned_approver_id'),
 ('petty_cash_requests','request_type'),
 ('petty_cash_expenses','review_status'),
 ('organization_memberships','approval_status'),
 ('organization_memberships','updated_at'),
 ('organization_memberships','updated_by'),
 ('property_memberships','approval_status'),
 ('property_memberships','updated_at'),
 ('property_memberships','updated_by')
)
SELECT e.table_name,e.column_name,c.column_name IS NOT NULL AS column_exists
FROM expected e LEFT JOIN information_schema.columns c
 ON c.table_schema='public' AND c.table_name=e.table_name AND c.column_name=e.column_name
ORDER BY e.table_name,e.column_name;
