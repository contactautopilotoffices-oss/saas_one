-- Expense bills are optional. Supplied files still require private, owned uploads.
-- Apply after the petty-cash allocation-wallet and plan-completion migrations.
-- Changes only petty-cash function definitions; does not update records or buckets.
BEGIN;

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
 IF length(trim(coalesce(body->>'description','')))=0 OR length(trim(coalesce(body->>'category','')))=0 OR length(trim(coalesce(body->>'vendor','')))=0 OR nullif(body->>'expense_date','') IS NULL OR (body->>'expense_date')::date>(now() AT TIME ZONE 'Asia/Kolkata')::date THEN RAISE EXCEPTION 'Complete expense details and valid date are required'; END IF;
 IF coalesce(body->>'payment_mode','') NOT IN ('Cash','UPI','Bank Transfer','Company Card','Other') OR (body->>'payment_mode'<>'Cash' AND length(trim(coalesce(body->>'payment_ref','')))=0) THEN RAISE EXCEPTION 'Payment details required'; END IF;
 INSERT INTO petty_cash_expenses(request_id,organization_id,property_id,requester_id,amount,description,category,vendor,expense_date,payment_mode,payment_ref,idempotency_key)
 VALUES(rid,r.organization_id,r.property_id,actor,amount,trim(body->>'description'),body->>'category',body->>'vendor',(body->>'expense_date')::date,body->>'payment_mode',body->>'payment_ref',key) RETURNING * INTO e;
 PERFORM pc_attach(actor,rid,coalesce(body->'documents','[]'::jsonb),'settlement',e.id);
 INSERT INTO petty_cash_wallet_entries(organization_id,requester_id,request_id,expense_id,kind,amount,actor_id) VALUES(r.organization_id,actor,rid,e.id,'debit',amount,actor);
 UPDATE petty_cash_requests SET actual_spent=(SELECT sum(ex.amount) FROM petty_cash_expenses ex WHERE ex.request_id=rid),version=version+1,updated_at=now() WHERE id=rid;
 INSERT INTO petty_cash_activity(request_id,organization_id,actor_id,action,remark) VALUES(rid,r.organization_id,actor,'expense_recorded',e.description||' ('||amount||')');
 RETURN to_jsonb(e);
END; $$;


-- Missing bills do not block replenishment; rejected expenses and other gates remain.
CREATE OR REPLACE FUNCTION public.pc_gate(o uuid,u uuid,excluded uuid DEFAULT null) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(o::text||u::text,0));
 IF pc_balance(o,u)<>0 THEN RAISE EXCEPTION 'Wallet balance must be zero before requesting more cash'; END IF;
 IF EXISTS(SELECT 1 FROM petty_cash_expenses e WHERE e.organization_id=o AND e.requester_id=u AND e.review_status='rejected') THEN RAISE EXCEPTION 'Resolve rejected expense proofs before requesting more cash'; END IF;
 IF EXISTS(SELECT 1 FROM petty_cash_requests WHERE organization_id=o AND requester_id=u AND request_type='advance' AND status IN ('submitted','pending_approval','sent_back','approved') AND (excluded IS NULL OR id<>excluded)) THEN RAISE EXCEPTION 'A pending request already exists'; END IF;
 IF EXISTS(SELECT 1 FROM petty_cash_settlement_status s JOIN petty_cash_requests r ON r.id=s.request_id WHERE r.organization_id=o AND r.requester_id=u
 AND r.request_type='advance' AND r.workflow_version=1 AND s.is_open_advance AND (s.unaccounted>0 OR s.bills_rejected>0)) THEN RAISE EXCEPTION 'Reconcile existing advance balance and proofs before requesting more cash'; END IF;
END; $$;

REVOKE ALL ON FUNCTION public.pc_expense(uuid,uuid,jsonb),public.pc_gate(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pc_expense(uuid,uuid,jsonb),public.pc_gate(uuid,uuid,uuid) TO service_role;

COMMIT;
