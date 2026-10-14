-- Migration: Duplicate UTR & Fraud Prevention for Petty Cash
-- Ensures no payment reference / UTR can be claimed multiple times across the organization
BEGIN;

-- 1. Create unique partial index on non-empty, non-rejected payment references per organization
CREATE UNIQUE INDEX IF NOT EXISTS uq_petty_cash_expenses_org_payment_ref 
ON public.petty_cash_expenses (organization_id, lower(trim(payment_ref))) 
WHERE payment_ref IS NOT NULL AND trim(payment_ref) <> '' AND review_status <> 'rejected';

-- 2. Update pc_expense function to validate and reject duplicate UTRs before insertion
CREATE OR REPLACE FUNCTION public.pc_expense(actor uuid,rid uuid,body jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r petty_cash_requests;e petty_cash_expenses;amount numeric;key uuid;ref text;
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

 -- Duplicate UTR / reference validation
 ref := trim(coalesce(body->>'payment_ref', ''));
 IF length(ref) > 0 AND EXISTS (
   SELECT 1 FROM petty_cash_expenses ex 
   WHERE ex.organization_id = r.organization_id 
     AND lower(trim(ex.payment_ref)) = lower(ref) 
     AND ex.review_status <> 'rejected'
 ) THEN
   RAISE EXCEPTION 'Duplicate payment reference: % was already claimed in this organization', ref;
 END IF;

 INSERT INTO petty_cash_expenses(request_id,organization_id,property_id,requester_id,amount,description,category,vendor,expense_date,payment_mode,payment_ref,idempotency_key)
 VALUES(rid,r.organization_id,r.property_id,actor,amount,trim(body->>'description'),body->>'category',body->>'vendor',(body->>'expense_date')::date,body->>'payment_mode',body->>'payment_ref',key) RETURNING * INTO e;
 PERFORM pc_attach(actor,rid,coalesce(body->'documents','[]'::jsonb),'settlement',e.id);
 INSERT INTO petty_cash_wallet_entries(organization_id,requester_id,request_id,expense_id,kind,amount,actor_id) VALUES(r.organization_id,actor,rid,e.id,'debit',amount,actor);
 UPDATE petty_cash_requests SET actual_spent=(SELECT sum(ex.amount) FROM petty_cash_expenses ex WHERE ex.request_id=rid),version=version+1,updated_at=now() WHERE id=rid;
 INSERT INTO petty_cash_activity(request_id,organization_id,actor_id,action,remark,metadata) VALUES(rid,r.organization_id,actor,'expense_recorded',e.description||' ('||amount||')',jsonb_build_object('expense_id',e.id));
 RETURN to_jsonb(e);
END; $$;

COMMIT;
