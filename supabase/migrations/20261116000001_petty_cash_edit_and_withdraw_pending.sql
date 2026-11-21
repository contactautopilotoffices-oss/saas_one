-- Migration: Support editing expense category & description, withdrawing pending expenses, and super admin expense review
BEGIN;

-- Allow withdrawing both pending and rejected expenses (before request is closed)
CREATE OR REPLACE FUNCTION public.pc_withdraw_expense(actor uuid,eid uuid,remark text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE e petty_cash_expenses; r petty_cash_requests;
BEGIN
 SELECT * INTO e FROM petty_cash_expenses WHERE id=eid;
 IF e.id IS NULL THEN RAISE EXCEPTION 'Forbidden'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(e.organization_id::text||e.requester_id::text,0));
 SELECT * INTO r FROM petty_cash_requests WHERE id=e.request_id FOR UPDATE;
 IF r.status='closed' THEN RAISE EXCEPTION 'Closed expense cannot be changed'; END IF;
 SELECT * INTO e FROM petty_cash_expenses WHERE id=eid FOR UPDATE;
 IF NOT ((e.requester_id=actor AND pc_internal(actor,e.organization_id,e.property_id))
   OR (r.requester_id=actor AND pc_internal(actor,e.organization_id,e.property_id))
   OR (pc_finance(actor,e.organization_id,e.property_id) OR pc_super(actor,e.organization_id))) THEN RAISE EXCEPTION 'Forbidden'; END IF;
 IF e.review_status NOT IN ('pending','rejected') THEN RAISE EXCEPTION 'Only a pending or rejected expense can be withdrawn'; END IF;
 IF length(trim(coalesce(remark,'')))=0 THEN RAISE EXCEPTION 'A reason is required to withdraw an expense'; END IF;
 UPDATE petty_cash_expenses SET review_status='withdrawn' WHERE id=eid RETURNING * INTO e;
 INSERT INTO petty_cash_wallet_entries(organization_id,requester_id,request_id,expense_id,kind,amount,actor_id) VALUES(e.organization_id,e.requester_id,e.request_id,eid,'reversal',e.amount,actor);
 UPDATE petty_cash_requests SET actual_spent=(SELECT coalesce(sum(ex.amount),0) FROM petty_cash_expenses ex WHERE ex.request_id=e.request_id AND ex.review_status<>'withdrawn'),version=version+1,updated_at=now() WHERE id=e.request_id;
 INSERT INTO petty_cash_activity(request_id,organization_id,actor_id,action,remark,metadata) VALUES(e.request_id,e.organization_id,actor,'expense_withdrawn',remark,jsonb_build_object('expense_id',eid,'amount',e.amount));
 RETURN to_jsonb(e);
END; $$;

-- Allow super admins and finance to review expenses
CREATE OR REPLACE FUNCTION public.pc_review_expense(actor uuid,eid uuid,result text,remark text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE e petty_cash_expenses; r petty_cash_requests;
BEGIN
 SELECT * INTO e FROM petty_cash_expenses WHERE id=eid;
 IF e.id IS NULL THEN RAISE EXCEPTION 'Forbidden'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(e.organization_id::text||e.requester_id::text,0));
 SELECT * INTO r FROM petty_cash_requests WHERE id=e.request_id FOR UPDATE;
 IF r.status='closed' THEN RAISE EXCEPTION 'Closed expense cannot be changed'; END IF;
 SELECT * INTO e FROM petty_cash_expenses WHERE id=eid FOR UPDATE;
 IF e.id IS NULL OR NOT (pc_finance(actor,e.organization_id,e.property_id) OR pc_super(actor,e.organization_id)) OR e.requester_id=actor THEN RAISE EXCEPTION 'Forbidden'; END IF;
 IF e.review_status='withdrawn' THEN RAISE EXCEPTION 'A withdrawn expense cannot be reviewed'; END IF;
 IF result NOT IN ('accepted','rejected') OR (result='rejected' AND length(trim(coalesce(remark,'')))=0) THEN RAISE EXCEPTION 'Valid review and rejection reason required'; END IF;
 IF e.review_status=result AND e.review_remarks IS NOT DISTINCT FROM remark THEN RETURN to_jsonb(e); END IF;
 UPDATE petty_cash_expenses SET review_status=result,review_remarks=remark,reviewed_by=actor,reviewed_at=now() WHERE id=eid RETURNING * INTO e;
 UPDATE petty_cash_requests SET version=version+1,updated_at=now() WHERE id=e.request_id;
 INSERT INTO petty_cash_activity(request_id,organization_id,actor_id,action,remark,metadata) VALUES(e.request_id,e.organization_id,actor,'expense_'||result,remark,jsonb_build_object('expense_id',eid));
 RETURN to_jsonb(e);
END; $$;

-- Update expense description, category, and vendor
CREATE OR REPLACE FUNCTION public.pc_update_expense(actor uuid,eid uuid,body jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE e petty_cash_expenses; r petty_cash_requests; new_desc text; new_cat text;
BEGIN
 SELECT * INTO e FROM petty_cash_expenses WHERE id=eid;
 IF e.id IS NULL THEN RAISE EXCEPTION 'Forbidden'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(e.organization_id::text||e.requester_id::text,0));
 SELECT * INTO r FROM petty_cash_requests WHERE id=e.request_id FOR UPDATE;
 IF r.status='closed' THEN RAISE EXCEPTION 'Closed expense cannot be changed'; END IF;
 SELECT * INTO e FROM petty_cash_expenses WHERE id=eid FOR UPDATE;
 IF NOT ((e.requester_id=actor AND pc_internal(actor,e.organization_id,e.property_id))
   OR (r.requester_id=actor AND pc_internal(actor,e.organization_id,e.property_id))
   OR (pc_finance(actor,e.organization_id,e.property_id) OR pc_super(actor,e.organization_id))) THEN RAISE EXCEPTION 'Forbidden'; END IF;
 IF e.review_status='withdrawn' THEN RAISE EXCEPTION 'Withdrawn expense cannot be modified'; END IF;

 new_desc := coalesce(nullif(trim(body->>'description'), ''), e.description);
 new_cat := coalesce(nullif(trim(body->>'category'), ''), e.category);

 UPDATE petty_cash_expenses
 SET description = new_desc,
     category = new_cat,
     vendor = coalesce(nullif(trim(body->>'vendor'), ''), vendor)
 WHERE id=eid RETURNING * INTO e;

 UPDATE petty_cash_requests SET version=version+1, updated_at=now() WHERE id=e.request_id;
 INSERT INTO petty_cash_activity(request_id,organization_id,actor_id,action,remark,metadata)
 VALUES(e.request_id,e.organization_id,actor,'expense_updated','Updated description / category',jsonb_build_object('expense_id',eid,'category',new_cat,'description',new_desc));

 RETURN to_jsonb(e);
END; $$;

REVOKE ALL ON FUNCTION public.pc_update_expense(uuid,uuid,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pc_update_expense(uuid,uuid,jsonb) TO service_role;

COMMIT;

