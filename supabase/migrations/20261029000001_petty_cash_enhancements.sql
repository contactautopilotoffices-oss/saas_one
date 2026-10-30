-- Migration: Petty Cash Enhancements
-- 1. Remove zero-wallet-balance and pending-request constraints on requesting petty cash.
-- 2. Enable Ops Super Admin and Org Super Admin full org-wide property eligibility.
-- 3. Property-configurable proof limit (default ₹500.00), enforcing bills/proofs for expenses > threshold.
-- 4. Spend mode (Operation vs Client) on expenses.

BEGIN;

-- 1. Add petty_cash_proof_threshold to properties
ALTER TABLE public.properties 
ADD COLUMN IF NOT EXISTS petty_cash_proof_threshold NUMERIC(14,2) NOT NULL DEFAULT 500.00 CHECK (petty_cash_proof_threshold >= 0);

-- 2. Add spend_mode to petty_cash_expenses
ALTER TABLE public.petty_cash_expenses 
ADD COLUMN IF NOT EXISTS spend_mode TEXT NOT NULL DEFAULT 'Operation' CHECK (spend_mode IN ('Operation', 'Client'));

CREATE INDEX IF NOT EXISTS idx_pc_expenses_spend_mode ON public.petty_cash_expenses(organization_id, spend_mode);

-- 3. Update pc_gate to remove zero-wallet balance check and pending request restriction
CREATE OR REPLACE FUNCTION public.pc_gate(o uuid, u uuid, excluded uuid DEFAULT null) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(o::text||u::text,0));
 -- Unconstrained replenishment: users can raise petty cash anytime regardless of current balance or pending requests
 IF EXISTS(SELECT 1 FROM petty_cash_expenses e WHERE e.organization_id=o AND e.requester_id=u AND e.review_status='rejected') THEN
   RAISE EXCEPTION 'Resolve rejected expense proofs before requesting more cash';
 END IF;
 IF EXISTS(SELECT 1 FROM petty_cash_settlement_status s JOIN petty_cash_requests r ON r.id=s.request_id WHERE r.organization_id=o AND r.requester_id=u
 AND r.workflow_version=1 AND s.is_open_advance AND (s.unaccounted>0 OR s.bills_rejected>0)) THEN
   RAISE EXCEPTION 'Reconcile existing advance balance and proofs before requesting more cash';
 END IF;
END; $$;

-- 4. Update pc_eligible_properties to include all active org properties for Ops Super Admin & Org Super Admin
CREATE OR REPLACE FUNCTION public.pc_eligible_properties(actor uuid, org uuid) RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT CASE
   WHEN pc_super(actor, org) OR EXISTS(SELECT 1 FROM users WHERE id=actor AND is_master_admin) THEN
     (SELECT coalesce(array_agg(p.id ORDER BY p.name), '{}'::uuid[]) FROM properties p WHERE p.organization_id=org AND p.deleted_at IS NULL AND coalesce(p.is_active, true))
   ELSE
     (SELECT coalesce(array_agg(DISTINCT p.id), '{}'::uuid[]) FROM property_memberships m JOIN properties p ON p.id=m.property_id
      WHERE m.user_id=actor AND m.organization_id=org AND p.organization_id=org AND m.is_active
      AND p.deleted_at IS NULL AND coalesce(p.is_active, true)
      AND coalesce(m.role::text, '') <> '' AND m.role::text !~* '(tenant|vendor)')
 END; $$;

-- 5. Update pc_expense to enforce property proof threshold and persist spend_mode
CREATE OR REPLACE FUNCTION public.pc_expense(actor uuid, rid uuid, body jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
 r petty_cash_requests;
 e petty_cash_expenses;
 amount numeric;
 key uuid;
 threshold numeric;
 mode text;
 docs_count int;
BEGIN
 SELECT * INTO r FROM petty_cash_requests WHERE id=rid;
 IF r.requester_id IS DISTINCT FROM actor OR NOT pc_internal(actor, r.organization_id, r.property_id) THEN
   RAISE EXCEPTION 'Forbidden';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(r.organization_id::text||actor::text, 0));
 SELECT * INTO r FROM petty_cash_requests WHERE id=rid FOR UPDATE;
 key := (body->>'idempotency_key')::uuid;
 IF key IS NULL THEN RAISE EXCEPTION 'Idempotency key required'; END IF;
 SELECT * INTO e FROM petty_cash_expenses WHERE requester_id=actor AND idempotency_key=key;
 IF e.id IS NOT NULL THEN
  IF e.request_id<>rid OR e.amount IS DISTINCT FROM (body->>'amount')::numeric OR e.description IS DISTINCT FROM trim(body->>'description') OR e.category IS DISTINCT FROM body->>'category' OR e.vendor IS DISTINCT FROM body->>'vendor' OR e.expense_date IS DISTINCT FROM (body->>'expense_date')::date OR e.payment_mode IS DISTINCT FROM body->>'payment_mode' OR e.payment_ref IS DISTINCT FROM body->>'payment_ref' OR EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(body->'documents','[]'::jsonb)) doc WHERE NOT EXISTS(SELECT 1 FROM petty_cash_documents d WHERE d.expense_id=e.id AND d.upload_id=(doc->>'upload_id')::uuid)) THEN
    RAISE EXCEPTION 'Idempotency key belongs to another expense';
  END IF;
  RETURN to_jsonb(e);
 END IF;
 IF r.workflow_version<>2 OR r.status NOT IN ('paid','settlement_submitted') THEN RAISE EXCEPTION 'Invalid expense stage'; END IF;
 amount := (body->>'amount')::numeric;
 IF amount IS NULL OR amount<=0 OR amount<>round(amount,2) OR amount::text IN ('NaN','Infinity','-Infinity') OR amount>pc_balance(r.organization_id,actor,rid) THEN
   RAISE EXCEPTION 'Invalid expense amount or insufficient balance';
 END IF;
 IF length(trim(coalesce(body->>'description','')))=0 OR length(trim(coalesce(body->>'category','')))=0 OR length(trim(coalesce(body->>'vendor','')))=0 OR nullif(body->>'expense_date','') IS NULL OR (body->>'expense_date')::date>(now() AT TIME ZONE 'Asia/Kolkata')::date THEN
   RAISE EXCEPTION 'Complete expense details and valid date are required';
 END IF;
 IF coalesce(body->>'payment_mode','') NOT IN ('Cash','UPI','Bank Transfer','Company Card','Other') OR (body->>'payment_mode'<>'Cash' AND length(trim(coalesce(body->>'payment_ref','')))=0) THEN
   RAISE EXCEPTION 'Payment details required';
 END IF;

 -- Validate spend mode
 mode := coalesce(body->>'spend_mode', 'Operation');
 IF mode NOT IN ('Operation', 'Client') THEN
   RAISE EXCEPTION 'Invalid spend mode; must be Operation or Client';
 END IF;

 -- Retrieve property threshold (default 500.00)
 SELECT coalesce(p.petty_cash_proof_threshold, 500.00) INTO threshold FROM properties p WHERE p.id=r.property_id;
 IF threshold IS NULL THEN threshold := 500.00; END IF;

 docs_count := jsonb_array_length(coalesce(body->'documents', '[]'::jsonb));
 IF amount > threshold AND docs_count = 0 THEN
   RAISE EXCEPTION 'Proof / bill is required for expenses exceeding ₹%', threshold;
 END IF;

 INSERT INTO petty_cash_expenses(request_id,organization_id,property_id,requester_id,amount,description,category,vendor,expense_date,payment_mode,payment_ref,spend_mode,idempotency_key)
 VALUES(rid,r.organization_id,r.property_id,actor,amount,trim(body->>'description'),body->>'category',body->>'vendor',(body->>'expense_date')::date,body->>'payment_mode',body->>'payment_ref',mode,key) RETURNING * INTO e;
 PERFORM pc_attach(actor,rid,coalesce(body->'documents','[]'::jsonb),'settlement',e.id);
 INSERT INTO petty_cash_wallet_entries(organization_id,requester_id,request_id,expense_id,kind,amount,actor_id) VALUES(r.organization_id,actor,rid,e.id,'debit',amount,actor);
 UPDATE petty_cash_requests SET actual_spent=(SELECT sum(ex.amount) FROM petty_cash_expenses ex WHERE ex.request_id=rid),version=version+1,updated_at=now() WHERE id=rid;
 INSERT INTO petty_cash_activity(request_id,organization_id,actor_id,action,remark) VALUES(rid,r.organization_id,actor,'expense_recorded',e.description||' ('||amount||' - '||mode||')');
 RETURN to_jsonb(e);
END; $$;

-- 6. Update pc_set_routing to support proof_threshold
CREATE OR REPLACE FUNCTION public.pc_set_routing(actor uuid, prop uuid, allocator uuid, approver uuid, allocator_backups uuid[], approver_backups uuid[], proof_threshold numeric DEFAULT null) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE org uuid; member uuid;
BEGIN
 SELECT organization_id INTO org FROM properties WHERE id=prop AND deleted_at IS NULL AND coalesce(is_active,true);
 IF org IS NULL OR NOT pc_super(actor,org) THEN RAISE EXCEPTION 'Forbidden'; END IF;
 IF allocator IS NULL OR approver IS NULL OR allocator=approver THEN RAISE EXCEPTION 'Choose distinct eligible internal users'; END IF;
 allocator_backups:=coalesce(allocator_backups,'{}'::uuid[]);approver_backups:=coalesce(approver_backups,'{}'::uuid[]);
 IF NOT pc_internal(allocator,org,prop) OR NOT pc_internal(approver,org,prop) THEN RAISE EXCEPTION 'Configured primary users are inactive or unassigned'; END IF;
 IF proof_threshold IS NOT NULL AND (proof_threshold < 0 OR proof_threshold > 999999999999.99) THEN RAISE EXCEPTION 'Invalid proof threshold'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(prop::text,0));
 IF proof_threshold IS NOT NULL THEN
   UPDATE properties SET petty_cash_proof_threshold = round(proof_threshold, 2) WHERE id = prop;
 END IF;
 UPDATE petty_cash_property_assignments SET is_active=false,is_primary=false,updated_by=actor,updated_at=now() WHERE property_id=prop;
 INSERT INTO petty_cash_property_assignments(organization_id,property_id,user_id,kind,is_primary,is_active,updated_by)
 VALUES(org,prop,allocator,'allocator',true,true,actor),(org,prop,approver,'approver',true,true,actor)
 ON CONFLICT(property_id,user_id,kind) DO UPDATE SET is_active=true,is_primary=true,updated_by=actor,updated_at=now();
 FOREACH member IN ARRAY allocator_backups LOOP
  IF NOT pc_internal(member,org,prop) THEN RAISE EXCEPTION 'Inactive or unassigned allocator backup'; END IF;
  INSERT INTO petty_cash_property_assignments(organization_id,property_id,user_id,kind,is_primary,is_active,updated_by)
  VALUES(org,prop,member,'allocator',false,true,actor)
  ON CONFLICT(property_id,user_id,kind) DO UPDATE SET is_active=true,is_primary=false,updated_by=actor,updated_at=now();
 END LOOP;
 FOREACH member IN ARRAY approver_backups LOOP
  IF NOT pc_internal(member,org,prop) THEN RAISE EXCEPTION 'Inactive or unassigned approver backup'; END IF;
  INSERT INTO petty_cash_property_assignments(organization_id,property_id,user_id,kind,is_primary,is_active,updated_by)
  VALUES(org,prop,member,'approver',false,true,actor)
  ON CONFLICT(property_id,user_id,kind) DO UPDATE SET is_active=true,is_primary=false,updated_by=actor,updated_at=now();
 END LOOP;
 INSERT INTO petty_cash_configuration_activity(organization_id,property_id,actor_id,allocator_id,approver_id) VALUES(org,prop,actor,allocator,approver);
 RETURN jsonb_build_object('property_id',prop,'allocator_id',allocator,'approver_id',approver,'proof_threshold',proof_threshold);
END; $$;

-- 7. Ensure permissions
REVOKE ALL ON FUNCTION public.pc_expense(uuid,uuid,jsonb), public.pc_gate(uuid,uuid,uuid), public.pc_eligible_properties(uuid,uuid), public.pc_set_routing(uuid,uuid,uuid,uuid,uuid[],uuid[],numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pc_expense(uuid,uuid,jsonb), public.pc_gate(uuid,uuid,uuid), public.pc_eligible_properties(uuid,uuid), public.pc_set_routing(uuid,uuid,uuid,uuid,uuid[],uuid[],numeric) TO service_role;

COMMIT;
