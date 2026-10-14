-- Migration: Petty Cash Disbursement - Remove Mandatory Payment Proof
-- Allows Accounts to disburse petty cash without requiring uploaded photo/file proof
BEGIN;

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
  -- Payment proof is optional upon disbursal
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

COMMIT;
