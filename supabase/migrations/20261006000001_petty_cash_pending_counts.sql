BEGIN;
CREATE INDEX IF NOT EXISTS pc_pending_requests_by_org ON public.petty_cash_requests(organization_id,status) WHERE request_type='advance' AND status IN('draft','submitted','pending_approval','sent_back','approved','paid','settlement_submitted');
CREATE INDEX IF NOT EXISTS pc_pending_expenses_by_requester ON public.petty_cash_expenses(organization_id,requester_id,review_status) WHERE review_status IN('pending','rejected');
CREATE OR REPLACE FUNCTION public.pc_pending_counts(actor uuid,org uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE counts jsonb;
BEGIN
 IF NOT pc_internal(actor,org) AND NOT EXISTS(SELECT 1 FROM users WHERE id=actor AND is_master_admin) THEN RAISE EXCEPTION 'Forbidden'; END IF;
 WITH accessible AS(SELECT r.* FROM petty_cash_requests r WHERE r.organization_id=org AND r.request_type='advance' AND r.status IN('draft','submitted','pending_approval','sent_back','approved','paid','settlement_submitted') AND pc_can_read(actor,r.id))
 SELECT jsonb_build_object('mine',count(*)FILTER(WHERE requester_id=actor),'allocations',count(*)FILTER(WHERE workflow_version=2 AND status='submitted' AND assigned_allocator_id=actor AND requester_id<>actor),'approvals',count(*)FILTER(WHERE workflow_version=2 AND status='pending_approval' AND assigned_approver_id=actor AND requester_id<>actor),'assigned',count(*)FILTER(WHERE actor IN(assigned_allocator_id,assigned_approver_id)),'disbursements',count(*)FILTER(WHERE status='approved' AND requester_id<>actor AND pc_finance(actor,org,property_id)),'reconciliation',count(*)FILTER(WHERE status='settlement_submitted' AND requester_id<>actor AND pc_finance(actor,org,property_id)),'all',count(*),'expenses',(SELECT count(*) FROM petty_cash_expenses e WHERE e.organization_id=org AND e.requester_id=actor AND e.review_status IN('pending','rejected') AND pc_can_read(actor,e.request_id))) INTO counts FROM accessible;
 RETURN counts;
END; $$;
REVOKE ALL ON FUNCTION public.pc_pending_counts(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pc_pending_counts(uuid,uuid) TO service_role;
COMMIT;
