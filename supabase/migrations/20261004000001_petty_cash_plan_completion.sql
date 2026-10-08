-- Complete the agreed routing/draft/payment behavior without replaying existing payments.
ALTER TABLE public.petty_cash_requests ADD COLUMN IF NOT EXISTS payment_date date;
ALTER TABLE public.petty_cash_configuration_activity
 ADD COLUMN IF NOT EXISTS allocator_backups uuid[] NOT NULL DEFAULT '{}',
 ADD COLUMN IF NOT EXISTS approver_backups uuid[] NOT NULL DEFAULT '{}';
ALTER TABLE public.petty_cash_activity ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE public.petty_cash_support_access_activity (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor_id uuid NOT NULL REFERENCES public.users(id),
 organization_id uuid NOT NULL REFERENCES public.organizations(id), created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.petty_cash_support_access_activity ENABLE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION public.pc_audit_support(actor uuid,org uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM users WHERE id=actor AND is_master_admin) OR NOT EXISTS(SELECT 1 FROM organizations WHERE id=org) THEN RAISE EXCEPTION 'Forbidden'; END IF;
 INSERT INTO petty_cash_support_access_activity(actor_id,organization_id) VALUES(actor,org);
END; $$;
REVOKE ALL ON FUNCTION public.pc_audit_support(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pc_audit_support(uuid,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.pc_eligible_properties(actor uuid,org uuid) RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT coalesce(array_agg(DISTINCT p.id),'{}'::uuid[]) FROM property_memberships m JOIN properties p ON p.id=m.property_id
 WHERE m.user_id=actor AND m.organization_id=org AND p.organization_id=org AND m.is_active
 AND p.deleted_at IS NULL AND coalesce(p.is_active,true)
 AND coalesce(m.role::text,'')<>'' AND m.role::text !~* '(tenant|vendor)'; $$;

CREATE OR REPLACE FUNCTION public.pc_can_read(u uuid,rid uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT coalesce((SELECT
  EXISTS(SELECT 1 FROM users WHERE id=u AND is_master_admin)
  OR (pc_internal(u,r.organization_id) AND (
   r.requester_id=u OR pc_super(u,r.organization_id)
   OR (r.status<>'draft' AND (r.assigned_allocator_id=u OR r.assigned_approver_id=u) AND pc_internal(u,r.organization_id,r.property_id))
   OR (r.status IN ('approved','paid','settlement_submitted','closed') AND pc_finance(u,r.organization_id,r.property_id))))
 FROM petty_cash_requests r WHERE r.id=rid),false); $$;

-- Backups are explicit configuration, never a grant to primary actors' records.
CREATE OR REPLACE FUNCTION public.pc_set_routing(actor uuid,prop uuid,allocator uuid,approver uuid,allocator_backups uuid[],approver_backups uuid[]) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE org uuid; member uuid; kind_name text; primary_id uuid; backups uuid[];
BEGIN
 SELECT organization_id INTO org FROM properties WHERE id=prop AND deleted_at IS NULL AND coalesce(is_active,true);
 IF org IS NULL OR NOT pc_super(actor,org) THEN RAISE EXCEPTION 'Forbidden'; END IF;
 IF allocator IS NULL OR approver IS NULL OR allocator=approver THEN RAISE EXCEPTION 'Choose distinct eligible internal users'; END IF;
 allocator_backups:=coalesce(allocator_backups,'{}'::uuid[]);approver_backups:=coalesce(approver_backups,'{}'::uuid[]);
 IF cardinality(allocator_backups)>25 OR cardinality(approver_backups)>25 THEN RAISE EXCEPTION 'At most 25 backups per stage'; END IF;
 FOR kind_name,primary_id,backups IN SELECT 'allocator',allocator,allocator_backups UNION ALL SELECT 'approver',approver,approver_backups LOOP
  IF primary_id=ANY(backups) OR cardinality(backups)<>(SELECT count(DISTINCT x) FROM unnest(backups)x) THEN RAISE EXCEPTION 'Choose distinct eligible primary and backup users'; END IF;
  FOREACH member IN ARRAY array_prepend(primary_id,backups) LOOP
   IF member IS NULL OR NOT pc_internal(member,org,prop) THEN RAISE EXCEPTION 'Choose eligible internal users for this property'; END IF;
  END LOOP;
 END LOOP;
 PERFORM pg_advisory_xact_lock(hashtextextended(prop::text,0));
 UPDATE petty_cash_property_assignments SET is_active=false,is_primary=false,updated_by=actor,updated_at=now() WHERE property_id=prop;
 FOR kind_name,primary_id,backups IN SELECT 'allocator',allocator,allocator_backups UNION ALL SELECT 'approver',approver,approver_backups LOOP
  FOREACH member IN ARRAY array_prepend(primary_id,backups) LOOP
   INSERT INTO petty_cash_property_assignments(organization_id,property_id,user_id,kind,is_active,is_primary,updated_by)
   VALUES(org,prop,member,kind_name,true,member=primary_id,actor)
   ON CONFLICT(property_id,user_id,kind) DO UPDATE SET is_active=true,is_primary=EXCLUDED.is_primary,updated_by=actor,updated_at=now();
  END LOOP;
 END LOOP;
 INSERT INTO petty_cash_configuration_activity(organization_id,property_id,actor_id,allocator_id,approver_id,allocator_backups,approver_backups)
 VALUES(org,prop,actor,allocator,approver,allocator_backups,approver_backups);
 RETURN jsonb_build_object('property_id',prop,'allocator_id',allocator,'approver_id',approver,'allocator_backups',allocator_backups,'approver_backups',approver_backups);
END; $$;

-- Keep the existing four-argument interface, preserving backups on a primary-only update.
CREATE OR REPLACE FUNCTION public.pc_configure(actor uuid,prop uuid,allocator uuid,approver uuid) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
 SELECT pc_set_routing(actor,prop,allocator,approver,
  ARRAY(SELECT user_id FROM petty_cash_property_assignments WHERE property_id=prop AND kind='allocator' AND is_active AND NOT is_primary AND user_id<>allocator),
  ARRAY(SELECT user_id FROM petty_cash_property_assignments WHERE property_id=prop AND kind='approver' AND is_active AND NOT is_primary AND user_id<>approver)); $$;

CREATE OR REPLACE FUNCTION public.pc_create_request(actor uuid,org uuid,body jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE prop uuid; allocator uuid; approver uuid; r petty_cash_requests; amount numeric; eligible uuid[]; draft boolean;
BEGIN
 IF NOT pc_internal(actor,org) THEN RAISE EXCEPTION 'Forbidden'; END IF;
 IF body ? 'assigned_allocator_id' OR body ? 'assigned_approver_id' THEN RAISE EXCEPTION 'Actors are system configured'; END IF;
 eligible:=pc_eligible_properties(actor,org);draft:=coalesce((body->>'save_draft')::boolean,false);
 prop:=nullif(body->>'property_id','')::uuid;
 IF prop IS NULL AND cardinality(eligible)=1 THEN prop:=eligible[1]; END IF;
 IF prop IS NULL THEN RAISE EXCEPTION 'Select an assigned property'; END IF;
 IF NOT (coalesce(prop=ANY(eligible),false)) OR NOT EXISTS(SELECT 1 FROM properties WHERE id=prop AND organization_id=org) THEN RAISE EXCEPTION 'Forbidden property'; END IF;
 amount:=(body->>'amount_requested')::numeric;
 IF amount IS NULL OR amount<=0 OR amount>999999999999.99 OR amount<>round(amount,2) OR amount::text IN ('NaN','Infinity','-Infinity') THEN RAISE EXCEPTION 'Invalid amount'; END IF;
 IF length(trim(coalesce(body->>'purpose','')))=0 THEN RAISE EXCEPTION 'Purpose is required'; END IF;
 IF coalesce(body->>'request_type','advance')<>'advance' THEN RAISE EXCEPTION 'New requests must be advances'; END IF;
 IF NOT draft THEN
 PERFORM pc_gate(org,actor);
 SELECT user_id INTO allocator FROM petty_cash_property_assignments WHERE property_id=prop AND kind='allocator' AND is_active AND is_primary;
 SELECT user_id INTO approver FROM petty_cash_property_assignments WHERE property_id=prop AND kind='approver' AND is_active AND is_primary;
 IF allocator IS NULL OR approver IS NULL OR NOT pc_internal(allocator,org,prop) OR NOT pc_internal(approver,org,prop) THEN RAISE EXCEPTION 'Property routing is not configured or inactive'; END IF;
 IF actor IN (allocator,approver) OR allocator=approver THEN RAISE EXCEPTION 'Self allocation or approval is not allowed; ask a super admin to configure another user'; END IF;
 END IF;
 INSERT INTO petty_cash_requests(organization_id,property_id,requester_id,workflow_version,assigned_allocator_id,assigned_approver_id,amount_requested,purpose,category,department,payment_mode,expected_date,status)
 VALUES(org,prop,actor,2,allocator,approver,amount,trim(body->>'purpose'),body->>'category',body->>'department',body->>'payment_mode',nullif(body->>'expected_date','')::date,CASE WHEN draft THEN 'draft' ELSE 'submitted' END) RETURNING * INTO r;
 PERFORM pc_attach(actor,r.id,coalesce(body->'documents','[]'::jsonb),'request');
 INSERT INTO petty_cash_activity(request_id,organization_id,actor_id,action,to_status) VALUES(r.id,org,actor,CASE WHEN draft THEN 'draft_saved' ELSE 'submitted' END,r.status);
 RETURN to_jsonb(r);
END; $$;

CREATE OR REPLACE FUNCTION public.pc_action(actor uuid,rid uuid,action text,body jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r petty_cash_requests; before_status text; amount numeric; remark text; allocator uuid; approver uuid; prop uuid; eligible uuid[]; before_record jsonb;
BEGIN
 -- Consistent lock order: requester gate before request row.
 SELECT * INTO r FROM petty_cash_requests WHERE id=rid;
 IF r.id IS NULL OR NOT pc_can_read(actor,rid) THEN RAISE EXCEPTION 'Forbidden'; END IF;
 IF body ? 'organization_id' AND (body->>'organization_id')::uuid IS DISTINCT FROM r.organization_id THEN RAISE EXCEPTION 'Forbidden organization'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(r.organization_id::text||r.requester_id::text,0));
 SELECT * INTO r FROM petty_cash_requests WHERE id=rid FOR UPDATE;
 IF r.request_type='reimbursement' THEN RAISE EXCEPTION 'Historical reimbursements are read-only'; END IF;
 IF body->>'expected_version' IS NULL OR (body->>'expected_version')::integer<>r.version THEN RAISE EXCEPTION 'Request changed; refresh before acting'; END IF;
 IF body ? 'assigned_allocator_id' OR body ? 'assigned_approver_id' THEN RAISE EXCEPTION 'Actors are system configured'; END IF;
 before_record:=to_jsonb(r);before_status:=r.status; remark:=nullif(trim(body->>'remark'),'');
 IF action IN ('allocate','approve','reject','send_back') THEN
  IF r.status NOT IN ('submitted','pending_approval') THEN RAISE EXCEPTION 'Invalid stage'; END IF;
  IF r.requester_id=actor THEN RAISE EXCEPTION 'Forbidden self action'; END IF;
  IF r.workflow_version=2 THEN
   IF (r.status='submitted' AND actor IS DISTINCT FROM r.assigned_allocator_id) OR (r.status='pending_approval' AND actor IS DISTINCT FROM r.assigned_approver_id)
   OR NOT pc_internal(actor,r.organization_id,r.property_id) THEN RAISE EXCEPTION 'Forbidden'; END IF;
  ELSE
   RAISE EXCEPTION 'Legacy pending request needs super admin reassignment before allocation';
  END IF;
 END IF;
 CASE action
 WHEN 'allocate' THEN
  IF r.workflow_version<>2 OR r.status<>'submitted' THEN RAISE EXCEPTION 'Invalid stage'; END IF;
  amount:=(body->>'allocated_amount')::numeric;
  IF amount IS NULL OR amount<=0 OR amount>r.amount_requested OR amount<>round(amount,2) OR amount::text IN ('NaN','Infinity','-Infinity') THEN RAISE EXCEPTION 'Invalid allocated amount'; END IF;
  IF NOT pc_internal(r.assigned_approver_id,r.organization_id,r.property_id) OR r.assigned_approver_id=r.requester_id THEN RAISE EXCEPTION 'Approver is inactive; ask a super admin to reassign'; END IF;
  r.status:='pending_approval';r.allocated_amount:=amount;r.allocated_by:=actor;r.allocated_at:=now();r.allocation_remarks:=remark;
 WHEN 'approve' THEN
  IF (r.workflow_version=2 AND r.status<>'pending_approval') OR (r.workflow_version=1 AND r.status<>'submitted') THEN RAISE EXCEPTION 'Invalid stage'; END IF;
  amount:=CASE WHEN r.workflow_version=2 THEN r.allocated_amount ELSE r.amount_requested END;
  IF body ? 'approved_amount' AND (body->>'approved_amount')::numeric<>amount THEN RAISE EXCEPTION 'Send back to change amount'; END IF;
  r.status:='approved';r.approved_amount:=amount;r.approver_id:=actor;r.approved_at:=now();r.approval_remarks:=remark;
 WHEN 'reject' THEN
  IF remark IS NULL THEN RAISE EXCEPTION 'Reason is required'; END IF;
  r.status:='rejected';r.approval_remarks:=remark;
 WHEN 'send_back' THEN
  IF remark IS NULL THEN RAISE EXCEPTION 'Reason is required'; END IF;
  r.sent_back_stage:=CASE WHEN r.status='submitted' THEN 'allocation' ELSE 'approval' END;r.status:='sent_back';r.approval_remarks:=remark;
 WHEN 'save_draft','submit','resubmit' THEN
  IF actor<>r.requester_id OR NOT pc_internal(actor,r.organization_id) THEN RAISE EXCEPTION 'Forbidden'; END IF;
  IF (action IN ('save_draft','submit') AND r.status<>'draft') OR (action='resubmit' AND r.status<>'sent_back') THEN RAISE EXCEPTION 'Invalid stage'; END IF;
  IF r.workflow_version<>2 THEN RAISE EXCEPTION 'Legacy request needs super admin reassignment'; END IF;
  eligible:=pc_eligible_properties(actor,r.organization_id);
  prop:=coalesce(nullif(body->>'property_id','')::uuid,r.property_id);
  IF NOT coalesce(prop=ANY(eligible),false) THEN RAISE EXCEPTION 'Forbidden property; an active assigned property is required'; END IF;
  amount:=coalesce((body->>'amount_requested')::numeric,r.amount_requested);
  IF amount IS NULL OR amount<=0 OR amount>999999999999.99 OR amount<>round(amount,2) OR amount::text IN ('NaN','Infinity','-Infinity') THEN RAISE EXCEPTION 'Invalid amount'; END IF;
  IF body ? 'purpose' THEN r.purpose:=trim(body->>'purpose'); END IF;
  IF length(trim(coalesce(r.purpose,'')))=0 THEN RAISE EXCEPTION 'Purpose required'; END IF;
  IF action<>'save_draft' THEN
   PERFORM pc_gate(r.organization_id,actor,rid);
   IF r.status='draft' OR prop<>r.property_id THEN
    SELECT user_id INTO r.assigned_allocator_id FROM petty_cash_property_assignments WHERE property_id=prop AND kind='allocator' AND is_active AND is_primary;
    SELECT user_id INTO r.assigned_approver_id FROM petty_cash_property_assignments WHERE property_id=prop AND kind='approver' AND is_active AND is_primary;
   END IF;
   IF r.assigned_allocator_id IS NULL OR r.assigned_approver_id IS NULL OR NOT pc_internal(r.assigned_allocator_id,r.organization_id,prop) OR NOT pc_internal(r.assigned_approver_id,r.organization_id,prop) THEN RAISE EXCEPTION 'Inactive or missing routing; ask a super admin to reassign'; END IF;
   IF r.assigned_allocator_id=r.assigned_approver_id OR actor IN (r.assigned_allocator_id,r.assigned_approver_id) THEN RAISE EXCEPTION 'Forbidden self action'; END IF;
   r.status:='submitted';
  END IF;
  r.property_id:=prop;r.amount_requested:=amount;
  r.allocated_amount:=null;r.allocated_by:=null;r.approved_amount:=null;r.approver_id:=null;r.approved_at:=null;r.allocated_at:=null;
  r.allocation_remarks:=null;r.approval_remarks:=null;r.sent_back_stage:=null;
  PERFORM pc_attach(actor,rid,coalesce(body->'documents','[]'::jsonb),'request');
 WHEN 'pay' THEN
  IF r.status<>'approved' THEN RAISE EXCEPTION 'Invalid stage'; END IF;
  IF NOT pc_finance(actor,r.organization_id,r.property_id) OR actor=r.requester_id THEN RAISE EXCEPTION 'Forbidden'; END IF;
  IF r.workflow_version=2 THEN PERFORM pc_gate(r.organization_id,r.requester_id,rid); END IF;
  amount:=coalesce(r.approved_amount,r.amount_requested);
  IF body ? 'paid_amount' AND (body->>'paid_amount')::numeric<>amount THEN RAISE EXCEPTION 'Paid amount must equal approved amount'; END IF;
  IF amount IS NULL OR amount<=0 THEN RAISE EXCEPTION 'Invalid payment amount'; END IF;
  IF coalesce(body->>'paid_mode','') NOT IN ('Cash','UPI','Bank Transfer','Company Card','Other') THEN RAISE EXCEPTION 'Payment mode required'; END IF;
  IF body->>'paid_mode'<>'Cash' AND length(trim(coalesce(body->>'payment_ref','')))=0 THEN RAISE EXCEPTION 'Payment reference required'; END IF;
  IF r.workflow_version=2 AND jsonb_array_length(coalesce(body->'documents','[]'::jsonb))=0 THEN RAISE EXCEPTION 'Payment proof required'; END IF;
  PERFORM pc_attach(actor,rid,coalesce(body->'documents','[]'::jsonb),'payment_proof');
  r.payment_date:=coalesce(nullif(body->>'payment_date','')::date,(now() AT TIME ZONE 'Asia/Kolkata')::date);
  IF r.payment_date>(now() AT TIME ZONE 'Asia/Kolkata')::date THEN RAISE EXCEPTION 'Payment date cannot be in the future'; END IF;
  r.status:='paid';r.paid_by:=actor;r.paid_at:=now();r.paid_mode:=body->>'paid_mode';r.payment_ref:=body->>'payment_ref';r.paid_amount:=amount;
  IF r.workflow_version=2 THEN INSERT INTO petty_cash_wallet_entries(organization_id,requester_id,request_id,kind,amount,actor_id) VALUES(r.organization_id,r.requester_id,rid,'credit',amount,actor); END IF;
 WHEN 'settle' THEN
  IF r.status NOT IN ('paid','settlement_submitted') OR actor<>r.requester_id THEN RAISE EXCEPTION 'Invalid stage or Forbidden'; END IF;
  IF r.workflow_version=2 THEN
   IF pc_balance(r.organization_id,actor,rid)<>0 THEN RAISE EXCEPTION 'Wallet balance must be zero'; END IF;
   IF EXISTS(SELECT 1 FROM petty_cash_expenses WHERE request_id=rid AND review_status='rejected') THEN RAISE EXCEPTION 'Correct rejected proof'; END IF;
   SELECT coalesce(sum(ex.amount),0) INTO r.actual_spent FROM petty_cash_expenses ex WHERE ex.request_id=rid;
  ELSE
   PERFORM pc_attach(actor,rid,coalesce(body->'documents','[]'::jsonb),'settlement');
   SELECT coalesce(sum(d.amount),0) INTO r.actual_spent FROM petty_cash_documents d WHERE d.request_id=rid AND d.stage='settlement' AND d.review_status<>'rejected' AND d.superseded_by IS NULL;
   IF coalesce((body->>'actual_spent')::numeric,r.actual_spent)<>r.actual_spent OR r.actual_spent+coalesce(r.amount_returned,0)>coalesce(r.paid_amount,r.approved_amount,r.amount_requested) THEN RAISE EXCEPTION 'Actual spent must match bill proofs and available advance'; END IF;
   IF body ? 'amount_returned' AND coalesce((body->>'amount_returned')::numeric,0)<>coalesce(r.amount_returned,0) THEN RAISE EXCEPTION 'Accounts must confirm cash returns'; END IF;
  END IF;
  r.status:='settlement_submitted';r.settled_at:=now();r.settlement_remarks:=remark;
 WHEN 'close' THEN
  IF r.status<>'settlement_submitted' THEN RAISE EXCEPTION 'Invalid stage'; END IF;
  IF NOT pc_finance(actor,r.organization_id,r.property_id) OR actor=r.requester_id THEN RAISE EXCEPTION 'Forbidden'; END IF;
  IF r.workflow_version=2 THEN
   IF pc_balance(r.organization_id,r.requester_id,rid)<>0 OR EXISTS(SELECT 1 FROM petty_cash_expenses WHERE request_id=rid AND review_status<>'accepted') THEN RAISE EXCEPTION 'Accept all proofs and reconcile balance before closing'; END IF;
  ELSE
   IF EXISTS(SELECT 1 FROM petty_cash_settlement_status WHERE request_id=rid AND (unaccounted>0 OR bills_pending_review>0 OR bills_rejected>0)) THEN RAISE EXCEPTION 'Reconcile legacy proofs before closing'; END IF;
  END IF;
  r.status:='closed';r.closed_by:=actor;r.closed_at:=now();r.close_remarks:=remark;
 WHEN 'cancel' THEN
  IF r.status NOT IN ('draft','submitted','pending_approval','sent_back','approved') THEN RAISE EXCEPTION 'Cannot cancel funded request or invalid stage'; END IF;
  IF actor<>r.requester_id THEN RAISE EXCEPTION 'Forbidden'; END IF;r.status:='cancelled';
 WHEN 'reassign' THEN
  IF NOT pc_super(actor,r.organization_id) OR r.status NOT IN ('submitted','pending_approval','sent_back') THEN RAISE EXCEPTION 'Forbidden reassignment or invalid stage'; END IF;
  SELECT user_id INTO allocator FROM petty_cash_property_assignments WHERE property_id=r.property_id AND kind='allocator' AND is_active
   AND (CASE WHEN nullif(body->>'reassign_allocator_id','') IS NOT NULL THEN user_id=(body->>'reassign_allocator_id')::uuid ELSE is_primary END);
  SELECT user_id INTO approver FROM petty_cash_property_assignments WHERE property_id=r.property_id AND kind='approver' AND is_active
   AND (CASE WHEN nullif(body->>'reassign_approver_id','') IS NOT NULL THEN user_id=(body->>'reassign_approver_id')::uuid ELSE is_primary END);
  IF allocator IS NULL OR approver IS NULL OR allocator=approver OR r.requester_id IN (allocator,approver) OR NOT pc_internal(allocator,r.organization_id,r.property_id) OR NOT pc_internal(approver,r.organization_id,r.property_id) THEN RAISE EXCEPTION 'Invalid routing'; END IF;
  r.assigned_allocator_id:=allocator;r.assigned_approver_id:=approver;r.workflow_version:=2;r.status:='submitted';r.allocated_amount:=null;r.approved_amount:=null;
  r.allocated_by:=null;r.allocated_at:=null;r.allocation_remarks:=null;r.approver_id:=null;r.approved_at:=null;r.approval_remarks:=null;r.sent_back_stage:=null;
 WHEN 'return' THEN
  IF r.status NOT IN ('paid','settlement_submitted') OR NOT pc_finance(actor,r.organization_id,r.property_id) OR actor=r.requester_id THEN RAISE EXCEPTION 'Forbidden or invalid stage'; END IF;
  amount:=(body->>'amount_returned')::numeric;
  IF amount IS NULL OR amount<=0 OR amount<>round(amount,2) OR amount>(CASE WHEN r.workflow_version=2 THEN pc_balance(r.organization_id,r.requester_id,rid) ELSE (SELECT unaccounted FROM petty_cash_settlement_status WHERE request_id=rid) END) OR amount::text IN ('NaN','Infinity','-Infinity') OR remark IS NULL THEN RAISE EXCEPTION 'Valid returned amount and confirmation remarks required'; END IF;
  IF r.workflow_version=2 THEN INSERT INTO petty_cash_wallet_entries(organization_id,requester_id,request_id,kind,amount,actor_id) VALUES(r.organization_id,r.requester_id,rid,'return',amount,actor); END IF;r.amount_returned:=coalesce(r.amount_returned,0)+amount;
 ELSE RAISE EXCEPTION 'Unknown action';
 END CASE;
 r.version:=r.version+1;r.updated_at:=now();
 UPDATE petty_cash_requests SET property_id=r.property_id,payment_date=r.payment_date,status=r.status,version=r.version,workflow_version=r.workflow_version,updated_at=r.updated_at,
 assigned_allocator_id=r.assigned_allocator_id,assigned_approver_id=r.assigned_approver_id,allocated_amount=r.allocated_amount,allocated_by=r.allocated_by,allocated_at=r.allocated_at,allocation_remarks=r.allocation_remarks,
 approved_amount=r.approved_amount,approver_id=r.approver_id,approved_at=r.approved_at,approval_remarks=r.approval_remarks,sent_back_stage=r.sent_back_stage,amount_requested=r.amount_requested,purpose=r.purpose,
 paid_amount=r.paid_amount,paid_by=r.paid_by,paid_at=r.paid_at,paid_mode=r.paid_mode,payment_ref=r.payment_ref,
 actual_spent=r.actual_spent,amount_returned=r.amount_returned,settled_at=r.settled_at,settlement_remarks=r.settlement_remarks,closed_by=r.closed_by,closed_at=r.closed_at,close_remarks=r.close_remarks WHERE id=rid;
 INSERT INTO petty_cash_activity(request_id,organization_id,actor_id,action,from_status,to_status,remark,metadata) VALUES(rid,r.organization_id,actor,action,before_status,r.status,CASE WHEN action='reassign' THEN concat_ws(' ',remark,'Allocator: '||(SELECT coalesce(full_name,email,'Assigned user') FROM users WHERE id=allocator)||'; approver: '||(SELECT coalesce(full_name,email,'Assigned user') FROM users WHERE id=approver)) ELSE remark END,jsonb_build_object('before',before_record,'after',to_jsonb(r)));
 RETURN to_jsonb(r);
END; $$;

-- Supabase default grants must never expose caller-supplied actor IDs.
REVOKE ALL ON FUNCTION public.pc_set_routing(uuid,uuid,uuid,uuid,uuid[],uuid[]),public.pc_eligible_properties(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pc_set_routing(uuid,uuid,uuid,uuid,uuid[],uuid[]),public.pc_eligible_properties(uuid,uuid) TO service_role;

-- Report labels preserve actor IDs; expense dates use the application calendar.
CREATE OR REPLACE FUNCTION public.pc_report(actor uuid,org uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 WITH scoped AS (SELECT r.*,u.full_name requester_name,p.name property_name,
 CASE WHEN r.workflow_version=2 THEN coalesce((SELECT sum(e.amount) FROM petty_cash_expenses e WHERE e.request_id=r.id),0) ELSE coalesce((SELECT bills_total FROM petty_cash_settlement_status WHERE request_id=r.id),0) END spent,
 coalesce((SELECT count(*) FROM petty_cash_expenses e WHERE e.request_id=r.id AND e.review_status='rejected'),0) unresolved_proofs,
 CASE WHEN r.workflow_version=2 THEN pc_balance(org,r.requester_id,r.id) WHEN r.request_type='reimbursement' THEN 0 ELSE coalesce((SELECT unaccounted FROM petty_cash_settlement_status WHERE request_id=r.id AND is_open_advance),0) END balance
 , (SELECT full_name FROM users WHERE id=r.assigned_allocator_id) assigned_allocator_name, (SELECT full_name FROM users WHERE id=r.assigned_approver_id) assigned_approver_name
 FROM pc_requests(actor,org) r JOIN users u ON u.id=r.requester_id JOIN properties p ON p.id=r.property_id)
 SELECT jsonb_build_object('totals',jsonb_build_object('requested',coalesce(sum(amount_requested),0),'allocated',coalesce(sum(allocated_amount),0),'approved',coalesce(sum(approved_amount),0),'paid',coalesce(sum(paid_amount),0),'spent',coalesce(sum(spent),0),'balance',coalesce(sum(balance),0),'unresolved_proofs',coalesce(sum(unresolved_proofs),0),'requests',count(*)),
 'rows',coalesce(jsonb_agg(jsonb_build_object('id',id,'request_no',request_no,'requester_id',requester_id,'requester_name',requester_name,'property_id',property_id,'property_name',property_name,'status',status,'request_type',request_type,'workflow_version',workflow_version,'created_at',created_at,'requested',amount_requested,'allocated',coalesce(allocated_amount,0),'approved',coalesce(approved_amount,0),'assigned_allocator_id',assigned_allocator_id,'assigned_allocator_name',assigned_allocator_name,'assigned_approver_name',assigned_approver_name,'assigned_approver_id',assigned_approver_id,'paid',coalesce(paid_amount,0),'spent',spent,'balance',balance,'unresolved_proofs',unresolved_proofs) ORDER BY created_at DESC),'[]'::jsonb)) FROM scoped; $$;

CREATE OR REPLACE FUNCTION public.pc_expense(actor uuid,rid uuid,body jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r petty_cash_requests;e petty_cash_expenses;amount numeric;key uuid;
BEGIN
 SELECT * INTO r FROM petty_cash_requests WHERE id=rid;
 IF r.requester_id IS DISTINCT FROM actor OR NOT pc_internal(actor,r.organization_id,r.property_id) THEN RAISE EXCEPTION 'Forbidden'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(r.organization_id::text||actor::text,0));
 SELECT * INTO r FROM petty_cash_requests WHERE id=rid FOR UPDATE;
 key:=(body->>'idempotency_key')::uuid;
 IF key IS NULL THEN RAISE EXCEPTION 'Idempotency key required'; END IF;
 SELECT * INTO e FROM petty_cash_expenses WHERE requester_id=actor AND idempotency_key=key;
 IF e.id IS NOT NULL THEN
  IF e.request_id<>rid OR e.amount IS DISTINCT FROM (body->>'amount')::numeric OR e.description IS DISTINCT FROM trim(body->>'description') OR e.category IS DISTINCT FROM body->>'category' OR e.vendor IS DISTINCT FROM body->>'vendor' OR e.expense_date IS DISTINCT FROM (body->>'expense_date')::date OR e.payment_mode IS DISTINCT FROM body->>'payment_mode' OR e.payment_ref IS DISTINCT FROM body->>'payment_ref' OR EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(body->'documents','[]'::jsonb)) doc WHERE NOT EXISTS(SELECT 1 FROM petty_cash_documents d WHERE d.expense_id=e.id AND d.upload_id=(doc->>'upload_id')::uuid)) THEN RAISE EXCEPTION 'Idempotency key belongs to another expense'; END IF;RETURN to_jsonb(e);
 END IF;
 IF r.workflow_version<>2 OR r.status NOT IN ('paid','settlement_submitted') THEN RAISE EXCEPTION 'Invalid expense stage'; END IF;
 amount:=(body->>'amount')::numeric;
 IF amount IS NULL OR amount<=0 OR amount<>round(amount,2) OR amount::text IN ('NaN','Infinity','-Infinity') OR amount>pc_balance(r.organization_id,actor,rid) THEN RAISE EXCEPTION 'Invalid expense amount or insufficient balance'; END IF;
 IF jsonb_array_length(coalesce(body->'documents','[]'::jsonb))=0 THEN RAISE EXCEPTION 'At least one proof is required'; END IF;
 IF length(trim(coalesce(body->>'description','')))=0 OR length(trim(coalesce(body->>'category','')))=0 OR length(trim(coalesce(body->>'vendor','')))=0 OR nullif(body->>'expense_date','') IS NULL OR (body->>'expense_date')::date>(now() AT TIME ZONE 'Asia/Kolkata')::date THEN RAISE EXCEPTION 'Complete expense details and valid date are required'; END IF;
 IF coalesce(body->>'payment_mode','') NOT IN ('Cash','UPI','Bank Transfer','Company Card','Other') OR (body->>'payment_mode'<>'Cash' AND length(trim(coalesce(body->>'payment_ref','')))=0) THEN RAISE EXCEPTION 'Payment details required'; END IF;
 INSERT INTO petty_cash_expenses(request_id,organization_id,property_id,requester_id,amount,description,category,vendor,expense_date,payment_mode,payment_ref,idempotency_key)
 VALUES(rid,r.organization_id,r.property_id,actor,amount,trim(body->>'description'),body->>'category',body->>'vendor',(body->>'expense_date')::date,body->>'payment_mode',body->>'payment_ref',key) RETURNING * INTO e;
 PERFORM pc_attach(actor,rid,body->'documents','settlement',e.id);
 INSERT INTO petty_cash_wallet_entries(organization_id,requester_id,request_id,expense_id,kind,amount,actor_id) VALUES(r.organization_id,actor,rid,e.id,'debit',amount,actor);
 UPDATE petty_cash_requests SET actual_spent=(SELECT sum(ex.amount) FROM petty_cash_expenses ex WHERE ex.request_id=rid),version=version+1,updated_at=now() WHERE id=rid;
 INSERT INTO petty_cash_activity(request_id,organization_id,actor_id,action,remark) VALUES(rid,r.organization_id,actor,'expense_recorded',e.description||' ('||amount||')');
 RETURN to_jsonb(e);
END; $$;

-- Read-only reimbursements are history, never an outstanding advance obligation.
CREATE OR REPLACE FUNCTION public.pc_gate(o uuid,u uuid,excluded uuid DEFAULT null) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(o::text||u::text,0));
 IF pc_balance(o,u)<>0 THEN RAISE EXCEPTION 'Wallet balance must be zero before requesting more cash'; END IF;
 IF EXISTS(SELECT 1 FROM petty_cash_expenses e WHERE e.organization_id=o AND e.requester_id=u AND
 (e.review_status='rejected' OR NOT EXISTS(SELECT 1 FROM petty_cash_documents d WHERE d.expense_id=e.id AND d.upload_id IS NOT NULL))) THEN RAISE EXCEPTION 'Complete all expense proofs before requesting more cash'; END IF;
 IF EXISTS(SELECT 1 FROM petty_cash_requests WHERE organization_id=o AND requester_id=u AND request_type='advance' AND status IN ('submitted','pending_approval','sent_back','approved') AND (excluded IS NULL OR id<>excluded)) THEN RAISE EXCEPTION 'A pending request already exists'; END IF;
 IF EXISTS(SELECT 1 FROM petty_cash_settlement_status s JOIN petty_cash_requests r ON r.id=s.request_id WHERE r.organization_id=o AND r.requester_id=u
 AND r.request_type='advance' AND r.workflow_version=1 AND s.is_open_advance AND (s.unaccounted>0 OR s.bills_rejected>0)) THEN RAISE EXCEPTION 'Reconcile existing advance balance and proofs before requesting more cash'; END IF;
END; $$;

CREATE OR REPLACE FUNCTION public.pc_review_bill(actor uuid,did uuid,result text,remark text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE d petty_cash_documents;r petty_cash_requests;
BEGIN
 SELECT * INTO d FROM petty_cash_documents WHERE id=did;
 SELECT * INTO r FROM petty_cash_requests WHERE id=d.request_id;
 IF r.id IS NULL OR r.workflow_version<>1 OR r.request_type<>'advance' OR r.status NOT IN ('paid','settlement_submitted') OR NOT pc_finance(actor,r.organization_id,r.property_id) OR d.stage<>'settlement' OR d.superseded_by IS NOT NULL OR r.requester_id=actor THEN RAISE EXCEPTION 'Forbidden'; END IF;
 IF result NOT IN ('accepted','rejected') OR (result='rejected' AND length(trim(coalesce(remark,'')))=0) THEN RAISE EXCEPTION 'Valid review and reason required'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(r.organization_id::text||r.requester_id::text,0));
 SELECT * INTO r FROM petty_cash_requests WHERE id=r.id FOR UPDATE;
 IF r.status NOT IN ('paid','settlement_submitted') THEN RAISE EXCEPTION 'Invalid review stage'; END IF;
 SELECT * INTO d FROM petty_cash_documents WHERE id=did FOR UPDATE;
 IF d.superseded_by IS NOT NULL THEN RAISE EXCEPTION 'Bill has been superseded'; END IF;
 UPDATE petty_cash_documents SET review_status=result,review_remarks=remark,reviewed_by=actor,reviewed_at=now() WHERE id=did RETURNING * INTO d;
 UPDATE petty_cash_requests SET version=version+1 WHERE id=r.id;
 INSERT INTO petty_cash_activity(request_id,organization_id,actor_id,action,remark) VALUES(r.id,r.organization_id,actor,'bill_'||result,remark);RETURN to_jsonb(d);
END; $$;
