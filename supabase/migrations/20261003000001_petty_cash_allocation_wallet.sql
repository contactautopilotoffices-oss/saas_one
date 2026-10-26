-- Additive petty-cash v2. Existing requests/evidence remain intact.
ALTER TABLE public.petty_cash_requests ADD COLUMN IF NOT EXISTS workflow_version integer NOT NULL DEFAULT 1,
 ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 0,
 ADD COLUMN IF NOT EXISTS assigned_allocator_id uuid REFERENCES public.users(id),
 ADD COLUMN IF NOT EXISTS allocated_by uuid REFERENCES public.users(id),
 ADD COLUMN IF NOT EXISTS allocated_amount numeric(14,2), ADD COLUMN IF NOT EXISTS allocated_at timestamptz,
 ADD COLUMN IF NOT EXISTS allocation_remarks text, ADD COLUMN IF NOT EXISTS sent_back_stage text;
ALTER TABLE public.petty_cash_requests DROP CONSTRAINT IF EXISTS petty_cash_requests_status_check;
ALTER TABLE public.petty_cash_requests ADD CONSTRAINT petty_cash_requests_status_check CHECK(status IN
 ('draft','submitted','pending_approval','approved','rejected','sent_back','paid','settlement_submitted','closed','cancelled'));
CREATE TABLE public.petty_cash_property_assignments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id),
 property_id uuid NOT NULL REFERENCES public.properties(id), user_id uuid NOT NULL REFERENCES public.users(id),
 kind text NOT NULL CHECK(kind IN ('allocator','approver')), is_active boolean NOT NULL DEFAULT true,
 is_primary boolean NOT NULL DEFAULT false, updated_by uuid REFERENCES public.users(id), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(property_id,user_id,kind));
CREATE UNIQUE INDEX pc_primary_assignment ON public.petty_cash_property_assignments(property_id,kind) WHERE is_primary AND is_active;
CREATE TABLE public.petty_cash_uploads (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id),
 uploaded_by uuid NOT NULL REFERENCES public.users(id), storage_path text UNIQUE NOT NULL,
 file_name text NOT NULL, file_type text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.petty_cash_expenses (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), request_id uuid NOT NULL REFERENCES public.petty_cash_requests(id),
 organization_id uuid NOT NULL REFERENCES public.organizations(id), property_id uuid NOT NULL REFERENCES public.properties(id),
 requester_id uuid NOT NULL REFERENCES public.users(id), amount numeric(14,2) NOT NULL CHECK(amount>0),
 description text NOT NULL, category text NOT NULL, vendor text NOT NULL, expense_date date NOT NULL,
 payment_mode text NOT NULL, payment_ref text, review_status text NOT NULL DEFAULT 'pending' CHECK(review_status IN ('pending','accepted','rejected')),
 review_remarks text, reviewed_by uuid REFERENCES public.users(id), reviewed_at timestamptz,
 idempotency_key uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(requester_id,idempotency_key));
CREATE TABLE public.petty_cash_wallet_entries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id),
 requester_id uuid NOT NULL REFERENCES public.users(id), request_id uuid NOT NULL REFERENCES public.petty_cash_requests(id),
 expense_id uuid UNIQUE REFERENCES public.petty_cash_expenses(id), kind text NOT NULL CHECK(kind IN ('credit','debit','return')),
 amount numeric(14,2) NOT NULL CHECK(amount>0), actor_id uuid NOT NULL REFERENCES public.users(id), created_at timestamptz NOT NULL DEFAULT now());
CREATE UNIQUE INDEX pc_one_credit ON public.petty_cash_wallet_entries(request_id) WHERE kind='credit';
CREATE INDEX pc_wallet_owner ON public.petty_cash_wallet_entries(organization_id,requester_id);
ALTER TABLE public.petty_cash_documents ADD COLUMN IF NOT EXISTS expense_id uuid REFERENCES public.petty_cash_expenses(id),
 ADD COLUMN IF NOT EXISTS upload_id uuid UNIQUE REFERENCES public.petty_cash_uploads(id), ADD COLUMN IF NOT EXISTS storage_path text, ADD COLUMN IF NOT EXISTS superseded_by uuid REFERENCES public.petty_cash_documents(id);

CREATE OR REPLACE VIEW public.petty_cash_settlement_status WITH (security_invoker=true) AS
SELECT
    r.id                AS request_id,
    r.organization_id,
    r.property_id,
    r.requester_id,
    r.request_no,
    r.status,
    r.recipient_name,
    r.recipient_phone,
    r.paid_at,
    COALESCE(r.paid_amount, r.approved_amount, r.amount_requested)      AS disbursed,
    COALESCE(b.bills_total, 0)                                          AS bills_total,
    COALESCE(b.bills_count, 0)                                          AS bills_count,
    COALESCE(b.bills_pending_review, 0)                                 AS bills_pending_review,
    COALESCE(b.bills_rejected, 0)                                       AS bills_rejected,
    COALESCE(r.amount_returned, 0)                                      AS amount_returned,
    COALESCE(b.bills_total, 0) + COALESCE(r.amount_returned, 0)         AS accounted,
    GREATEST(
        COALESCE(r.paid_amount, r.approved_amount, r.amount_requested)
            - (COALESCE(b.bills_total, 0) + COALESCE(r.amount_returned, 0)),
        0
    )                                                                   AS unaccounted,
    CASE
        WHEN COALESCE(r.paid_amount, r.approved_amount, r.amount_requested) > 0
        THEN ROUND(
            ((COALESCE(b.bills_total, 0) + COALESCE(r.amount_returned, 0))
                / COALESCE(r.paid_amount, r.approved_amount, r.amount_requested)) * 100,
            1)
        ELSE NULL
    END                                                                 AS accounted_pct,
    -- An advance is "open" from the moment cash leaves until finance closes it. This is
    -- what gates the next cycle.
    (r.status IN ('paid', 'settlement_submitted'))                      AS is_open_advance,
    CASE
        WHEN r.status IN ('paid', 'settlement_submitted') AND r.paid_at IS NOT NULL
        THEN GREATEST(EXTRACT(DAY FROM (NOW() - r.paid_at))::INT, 0)
        ELSE NULL
    END                                                                 AS days_outstanding
FROM public.petty_cash_requests r
LEFT JOIN LATERAL (
    SELECT
        SUM(d.amount) FILTER (WHERE d.review_status <> 'rejected')      AS bills_total,
        COUNT(*)      FILTER (WHERE d.review_status <> 'rejected')      AS bills_count,
        COUNT(*)      FILTER (WHERE d.review_status = 'pending')        AS bills_pending_review,
        COUNT(*)      FILTER (WHERE d.review_status = 'rejected')       AS bills_rejected
    FROM public.petty_cash_documents d
    WHERE d.request_id = r.id
      AND d.stage = 'settlement'
      AND d.amount IS NOT NULL
      AND d.superseded_by IS NULL
) b ON TRUE;


CREATE OR REPLACE FUNCTION public.pc_internal(u uuid,o uuid,p uuid DEFAULT null) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT EXISTS(SELECT 1 FROM organization_memberships m WHERE m.user_id=u AND m.organization_id=o AND m.is_active
 AND coalesce(m.role::text,'')<>'' AND m.role::text !~* '(tenant|vendor)')
 OR EXISTS(SELECT 1 FROM property_memberships m JOIN properties x ON x.id=m.property_id WHERE m.user_id=u
 AND x.organization_id=o AND m.is_active AND (p IS NULL OR m.property_id=p) AND coalesce(m.role::text,'')<>'' AND m.role::text !~* '(tenant|vendor)'); $$;
CREATE OR REPLACE FUNCTION public.pc_super(u uuid,o uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT EXISTS(SELECT 1 FROM organization_memberships WHERE user_id=u AND organization_id=o AND is_active AND role IN ('org_super_admin','ops_super_admin'))
 OR EXISTS(SELECT 1 FROM property_memberships m JOIN properties p ON p.id=m.property_id WHERE m.user_id=u AND p.organization_id=o AND m.is_active AND m.role IN ('org_super_admin','ops_super_admin')); $$;
CREATE OR REPLACE FUNCTION public.pc_finance(u uuid,o uuid,p uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT EXISTS(SELECT 1 FROM organization_memberships WHERE user_id=u AND organization_id=o AND is_active AND role='accounts')
 OR EXISTS(SELECT 1 FROM property_memberships WHERE user_id=u AND property_id=p AND is_active AND role='accounts'); $$;
CREATE OR REPLACE FUNCTION public.pc_can_read(u uuid,rid uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT coalesce((SELECT (pc_internal(u,r.organization_id) OR EXISTS(SELECT 1 FROM users WHERE id=u AND is_master_admin)) AND
 (r.requester_id=u OR r.assigned_allocator_id=u OR r.assigned_approver_id=u OR pc_super(u,r.organization_id)
 OR EXISTS(SELECT 1 FROM users WHERE id=u AND is_master_admin)
 OR (r.status IN ('approved','paid','settlement_submitted','closed') AND pc_finance(u,r.organization_id,r.property_id)))
 FROM petty_cash_requests r WHERE r.id=rid),false); $$;
CREATE OR REPLACE FUNCTION public.pc_configure(actor uuid,prop uuid,allocator uuid,approver uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE org uuid;
BEGIN
 SELECT organization_id INTO org FROM properties WHERE id=prop;
 IF org IS NULL OR NOT pc_super(actor,org) THEN RAISE EXCEPTION 'Forbidden'; END IF;
 IF allocator=approver OR NOT pc_internal(allocator,org,prop) OR NOT pc_internal(approver,org,prop) THEN RAISE EXCEPTION 'Choose distinct eligible internal users'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(prop::text,0));
 UPDATE petty_cash_property_assignments SET is_primary=false,updated_by=actor,updated_at=now() WHERE property_id=prop;
 INSERT INTO petty_cash_property_assignments(organization_id,property_id,user_id,kind,is_primary,updated_by)
 VALUES(org,prop,allocator,'allocator',true,actor),(org,prop,approver,'approver',true,actor)
 ON CONFLICT(property_id,user_id,kind) DO UPDATE SET is_active=true,is_primary=true,updated_by=actor,updated_at=now();
 INSERT INTO petty_cash_configuration_activity(organization_id,property_id,actor_id,allocator_id,approver_id) VALUES(org,prop,actor,allocator,approver);
 RETURN jsonb_build_object('property_id',prop,'allocator_id',allocator,'approver_id',approver);
END; $$;
CREATE OR REPLACE FUNCTION public.pc_balance(o uuid,u uuid,rid uuid DEFAULT null) RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT coalesce(sum(CASE WHEN kind='credit' THEN amount ELSE -amount END),0) FROM petty_cash_wallet_entries
 WHERE organization_id=o AND requester_id=u AND (rid IS NULL OR request_id=rid); $$;
CREATE OR REPLACE FUNCTION public.pc_gate(o uuid,u uuid,excluded uuid DEFAULT null) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(o::text||u::text,0));
 IF pc_balance(o,u)<>0 THEN RAISE EXCEPTION 'Wallet balance must be zero before requesting more cash'; END IF;
 IF EXISTS(SELECT 1 FROM petty_cash_expenses e WHERE e.organization_id=o AND e.requester_id=u AND
 (e.review_status='rejected' OR NOT EXISTS(SELECT 1 FROM petty_cash_documents d WHERE d.expense_id=e.id AND d.upload_id IS NOT NULL))) THEN RAISE EXCEPTION 'Complete all expense proofs before requesting more cash'; END IF;
 IF EXISTS(SELECT 1 FROM petty_cash_requests WHERE organization_id=o AND requester_id=u AND status IN ('submitted','pending_approval','sent_back','approved') AND (excluded IS NULL OR id<>excluded)) THEN RAISE EXCEPTION 'A pending request already exists'; END IF;
 IF EXISTS(SELECT 1 FROM petty_cash_settlement_status s JOIN petty_cash_requests r ON r.id=s.request_id WHERE r.organization_id=o AND r.requester_id=u
 AND r.workflow_version=1 AND s.is_open_advance AND (s.unaccounted>0 OR s.bills_rejected>0)) THEN RAISE EXCEPTION 'Reconcile existing advance balance and proofs before requesting more cash'; END IF;
END; $$;
CREATE OR REPLACE FUNCTION public.pc_attach(actor uuid,rid uuid,docs jsonb,stage_name text,eid uuid DEFAULT null) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE doc jsonb; up petty_cash_uploads; req petty_cash_requests; replacement_id uuid; old_document uuid;
BEGIN
 SELECT * INTO STRICT req FROM petty_cash_requests WHERE id=rid;
 IF jsonb_typeof(docs)<>'array' THEN RAISE EXCEPTION 'Invalid proof list'; END IF;
 FOR doc IN SELECT value FROM jsonb_array_elements(docs) LOOP
  SELECT * INTO up FROM petty_cash_uploads WHERE id=(doc->>'upload_id')::uuid AND uploaded_by=actor AND organization_id=req.organization_id FOR UPDATE;
  IF up.id IS NULL THEN RAISE EXCEPTION 'Proof must be an owned uploaded file'; END IF;
  IF stage_name='settlement' AND eid IS NULL AND (coalesce((doc->>'amount')::numeric,0)<=0 OR length(trim(coalesce(doc->>'vendor','')))=0 OR nullif(doc->>'bill_date','') IS NULL) THEN RAISE EXCEPTION 'Legacy bill amount, vendor and date required'; END IF;
  INSERT INTO petty_cash_documents(request_id,organization_id,stage,file_url,file_name,file_type,uploaded_by,storage_path,upload_id,expense_id,amount,bill_date,vendor)
  VALUES(rid,req.organization_id,stage_name,'private:'||up.storage_path,up.file_name,up.file_type,actor,up.storage_path,up.id,eid,CASE WHEN stage_name='settlement' AND eid IS NULL THEN (doc->>'amount')::numeric ELSE null END,CASE WHEN eid IS NULL THEN nullif(doc->>'bill_date','')::date ELSE null END,CASE WHEN eid IS NULL THEN doc->>'vendor' ELSE null END) RETURNING id INTO replacement_id;
  old_document:=nullif(doc->>'replaces_document_id','')::uuid;
  IF old_document IS NOT NULL THEN
   IF req.workflow_version<>1 OR stage_name<>'settlement' OR eid IS NOT NULL OR actor<>req.requester_id THEN RAISE EXCEPTION 'Invalid legacy proof replacement'; END IF;
   UPDATE petty_cash_documents SET superseded_by=replacement_id WHERE id=old_document AND request_id=rid AND stage='settlement' AND review_status='rejected' AND superseded_by IS NULL;
   IF NOT FOUND THEN RAISE EXCEPTION 'Only a current rejected bill on this request can be replaced'; END IF;
   INSERT INTO petty_cash_activity(request_id,organization_id,actor_id,action,remark) VALUES(rid,req.organization_id,actor,'bill_proof_replaced',old_document::text||' -> '||replacement_id::text);
  END IF;
 END LOOP;
END; $$;
CREATE OR REPLACE FUNCTION public.pc_create_request(actor uuid,org uuid,body jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE prop uuid; allocator uuid; approver uuid; r petty_cash_requests; amount numeric; eligible uuid[];
BEGIN
 IF NOT pc_internal(actor,org) THEN RAISE EXCEPTION 'Forbidden'; END IF;
 IF body ? 'assigned_allocator_id' OR body ? 'assigned_approver_id' THEN RAISE EXCEPTION 'Actors are system configured'; END IF;
 SELECT array_agg(DISTINCT m.property_id) INTO eligible FROM property_memberships m JOIN properties p ON p.id=m.property_id
 WHERE m.user_id=actor AND m.is_active AND p.organization_id=org AND coalesce(m.role::text,'')<>'' AND m.role::text !~* '(tenant|vendor)';
 prop:=nullif(body->>'property_id','')::uuid;
 IF prop IS NULL AND cardinality(eligible)=1 THEN prop:=eligible[1]; END IF;
 IF prop IS NULL THEN RAISE EXCEPTION 'Select an assigned property'; END IF;
 IF NOT (coalesce(prop=ANY(eligible),false) OR pc_super(actor,org)) OR NOT EXISTS(SELECT 1 FROM properties WHERE id=prop AND organization_id=org) THEN RAISE EXCEPTION 'Forbidden property'; END IF;
 amount:=(body->>'amount_requested')::numeric;
 IF amount IS NULL OR amount<=0 OR amount>999999999999.99 OR amount<>round(amount,2) OR amount::text IN ('NaN','Infinity','-Infinity') THEN RAISE EXCEPTION 'Invalid amount'; END IF;
 IF length(trim(coalesce(body->>'purpose','')))=0 THEN RAISE EXCEPTION 'Purpose is required'; END IF;
 IF coalesce(body->>'request_type','advance')<>'advance' THEN RAISE EXCEPTION 'New requests must be advances'; END IF;
 PERFORM pc_gate(org,actor);
 SELECT user_id INTO allocator FROM petty_cash_property_assignments WHERE property_id=prop AND kind='allocator' AND is_active AND is_primary;
 SELECT user_id INTO approver FROM petty_cash_property_assignments WHERE property_id=prop AND kind='approver' AND is_active AND is_primary;
 IF allocator IS NULL OR approver IS NULL OR NOT pc_internal(allocator,org,prop) OR NOT pc_internal(approver,org,prop) THEN RAISE EXCEPTION 'Property routing is not configured or inactive'; END IF;
 IF actor IN (allocator,approver) OR allocator=approver THEN RAISE EXCEPTION 'Self allocation or approval is not allowed; ask a super admin to configure another user'; END IF;
 INSERT INTO petty_cash_requests(organization_id,property_id,requester_id,workflow_version,assigned_allocator_id,assigned_approver_id,amount_requested,purpose,category,department,payment_mode,expected_date,status)
 VALUES(org,prop,actor,2,allocator,approver,amount,trim(body->>'purpose'),body->>'category',body->>'department',body->>'payment_mode',nullif(body->>'expected_date','')::date,'submitted') RETURNING * INTO r;
 PERFORM pc_attach(actor,r.id,coalesce(body->'documents','[]'::jsonb),'request');
 INSERT INTO petty_cash_activity(request_id,organization_id,actor_id,action,to_status) VALUES(r.id,org,actor,'submitted','submitted');
 RETURN to_jsonb(r);
END; $$;
CREATE OR REPLACE FUNCTION public.pc_action(actor uuid,rid uuid,action text,body jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r petty_cash_requests; before_status text; amount numeric; remark text; allocator uuid; approver uuid;
BEGIN
 -- Consistent lock order: requester gate before request row.
 SELECT * INTO r FROM petty_cash_requests WHERE id=rid;
 IF r.id IS NULL OR NOT pc_can_read(actor,rid) THEN RAISE EXCEPTION 'Forbidden'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(r.organization_id::text||r.requester_id::text,0));
 SELECT * INTO r FROM petty_cash_requests WHERE id=rid FOR UPDATE;
 IF body->>'expected_version' IS NULL OR (body->>'expected_version')::integer<>r.version THEN RAISE EXCEPTION 'Request changed; refresh before acting'; END IF;
 IF body ? 'assigned_allocator_id' OR body ? 'assigned_approver_id' THEN RAISE EXCEPTION 'Actors are system configured'; END IF;
 before_status:=r.status; remark:=nullif(trim(body->>'remark'),'');
 IF action IN ('allocate','approve','reject','send_back') THEN
  IF r.status NOT IN ('submitted','pending_approval') THEN RAISE EXCEPTION 'Invalid stage'; END IF;
  IF r.requester_id=actor THEN RAISE EXCEPTION 'Forbidden self action'; END IF;
  IF r.workflow_version=2 THEN
   IF (r.status='submitted' AND actor IS DISTINCT FROM r.assigned_allocator_id) OR (r.status='pending_approval' AND actor IS DISTINCT FROM r.assigned_approver_id)
   OR NOT pc_internal(actor,r.organization_id,r.property_id) THEN RAISE EXCEPTION 'Forbidden'; END IF;
  ELSE
   IF actor IS DISTINCT FROM r.assigned_approver_id THEN RAISE EXCEPTION 'Legacy request needs assigned approver or reassignment'; END IF;
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
 WHEN 'resubmit' THEN
  IF r.status<>'sent_back' OR actor<>r.requester_id THEN RAISE EXCEPTION 'Invalid stage or Forbidden'; END IF;
  PERFORM pc_gate(r.organization_id,actor,rid);
  IF body ? 'amount_requested' THEN
   amount:=(body->>'amount_requested')::numeric;
   IF amount IS NULL OR amount<=0 OR amount<>round(amount,2) OR amount::text IN ('NaN','Infinity','-Infinity') THEN RAISE EXCEPTION 'Invalid amount'; END IF;
   r.amount_requested:=amount;
  END IF;
  IF body ? 'purpose' THEN IF length(trim(body->>'purpose'))=0 THEN RAISE EXCEPTION 'Purpose required'; END IF;r.purpose:=trim(body->>'purpose'); END IF;
  IF r.workflow_version=2 AND (NOT pc_internal(r.assigned_allocator_id,r.organization_id,r.property_id) OR NOT pc_internal(r.assigned_approver_id,r.organization_id,r.property_id)) THEN RAISE EXCEPTION 'Inactive routing; ask super admin to reassign'; END IF;
  r.status:='submitted';r.allocated_amount:=null;r.allocated_by:=null;r.approved_amount:=null;r.approver_id:=null;r.approved_at:=null;r.allocated_at:=null;
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
  IF NOT pc_finance(actor,r.organization_id,r.property_id) THEN RAISE EXCEPTION 'Forbidden'; END IF;
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
  SELECT user_id INTO allocator FROM petty_cash_property_assignments WHERE property_id=r.property_id AND kind='allocator' AND is_active AND is_primary;
  SELECT user_id INTO approver FROM petty_cash_property_assignments WHERE property_id=r.property_id AND kind='approver' AND is_active AND is_primary;
  IF allocator IS NULL OR approver IS NULL OR allocator=approver OR r.requester_id IN (allocator,approver) OR NOT pc_internal(allocator,r.organization_id,r.property_id) OR NOT pc_internal(approver,r.organization_id,r.property_id) THEN RAISE EXCEPTION 'Invalid routing'; END IF;
  r.assigned_allocator_id:=allocator;r.assigned_approver_id:=approver;r.workflow_version:=2;r.status:='submitted';r.allocated_amount:=null;r.approved_amount:=null;
  r.allocated_by:=null;r.allocated_at:=null;r.allocation_remarks:=null;r.approver_id:=null;r.approved_at:=null;r.approval_remarks:=null;r.sent_back_stage:=null;
 WHEN 'return' THEN
  IF r.status NOT IN ('paid','settlement_submitted') OR NOT pc_finance(actor,r.organization_id,r.property_id) THEN RAISE EXCEPTION 'Forbidden or invalid stage'; END IF;
  amount:=(body->>'amount_returned')::numeric;
  IF amount IS NULL OR amount<=0 OR amount<>round(amount,2) OR amount>(CASE WHEN r.workflow_version=2 THEN pc_balance(r.organization_id,r.requester_id,rid) ELSE (SELECT unaccounted FROM petty_cash_settlement_status WHERE request_id=rid) END) OR amount::text IN ('NaN','Infinity','-Infinity') OR remark IS NULL THEN RAISE EXCEPTION 'Valid returned amount and confirmation remarks required'; END IF;
  IF r.workflow_version=2 THEN INSERT INTO petty_cash_wallet_entries(organization_id,requester_id,request_id,kind,amount,actor_id) VALUES(r.organization_id,r.requester_id,rid,'return',amount,actor); END IF;r.amount_returned:=coalesce(r.amount_returned,0)+amount;
 ELSE RAISE EXCEPTION 'Unknown action';
 END CASE;
 r.version:=r.version+1;r.updated_at:=now();
 UPDATE petty_cash_requests SET status=r.status,version=r.version,workflow_version=r.workflow_version,updated_at=r.updated_at,
 assigned_allocator_id=r.assigned_allocator_id,assigned_approver_id=r.assigned_approver_id,allocated_amount=r.allocated_amount,allocated_by=r.allocated_by,allocated_at=r.allocated_at,allocation_remarks=r.allocation_remarks,
 approved_amount=r.approved_amount,approver_id=r.approver_id,approved_at=r.approved_at,approval_remarks=r.approval_remarks,sent_back_stage=r.sent_back_stage,amount_requested=r.amount_requested,purpose=r.purpose,
 paid_amount=r.paid_amount,paid_by=r.paid_by,paid_at=r.paid_at,paid_mode=r.paid_mode,payment_ref=r.payment_ref,
 actual_spent=r.actual_spent,amount_returned=r.amount_returned,settled_at=r.settled_at,settlement_remarks=r.settlement_remarks,closed_by=r.closed_by,closed_at=r.closed_at,close_remarks=r.close_remarks WHERE id=rid;
 INSERT INTO petty_cash_activity(request_id,organization_id,actor_id,action,from_status,to_status,remark) VALUES(rid,r.organization_id,actor,action,before_status,r.status,remark);
 RETURN to_jsonb(r);
END; $$;
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
 IF length(trim(coalesce(body->>'description','')))=0 OR length(trim(coalesce(body->>'category','')))=0 OR length(trim(coalesce(body->>'vendor','')))=0 OR nullif(body->>'expense_date','') IS NULL OR (body->>'expense_date')::date>current_date THEN RAISE EXCEPTION 'Complete expense details and valid date are required'; END IF;
 IF coalesce(body->>'payment_mode','') NOT IN ('Cash','UPI','Bank Transfer','Company Card','Other') OR (body->>'payment_mode'<>'Cash' AND length(trim(coalesce(body->>'payment_ref','')))=0) THEN RAISE EXCEPTION 'Payment details required'; END IF;
 INSERT INTO petty_cash_expenses(request_id,organization_id,property_id,requester_id,amount,description,category,vendor,expense_date,payment_mode,payment_ref,idempotency_key)
 VALUES(rid,r.organization_id,r.property_id,actor,amount,trim(body->>'description'),body->>'category',body->>'vendor',(body->>'expense_date')::date,body->>'payment_mode',body->>'payment_ref',key) RETURNING * INTO e;
 PERFORM pc_attach(actor,rid,body->'documents','settlement',e.id);
 INSERT INTO petty_cash_wallet_entries(organization_id,requester_id,request_id,expense_id,kind,amount,actor_id) VALUES(r.organization_id,actor,rid,e.id,'debit',amount,actor);
 UPDATE petty_cash_requests SET actual_spent=(SELECT sum(ex.amount) FROM petty_cash_expenses ex WHERE ex.request_id=rid),version=version+1,updated_at=now() WHERE id=rid;
 INSERT INTO petty_cash_activity(request_id,organization_id,actor_id,action,remark) VALUES(rid,r.organization_id,actor,'expense_recorded',e.description||' ('||amount||')');
 RETURN to_jsonb(e);
END; $$;
CREATE OR REPLACE FUNCTION public.pc_review_expense(actor uuid,eid uuid,result text,remark text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE e petty_cash_expenses; r petty_cash_requests;
BEGIN
 SELECT * INTO e FROM petty_cash_expenses WHERE id=eid;
 IF e.id IS NULL THEN RAISE EXCEPTION 'Forbidden'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(e.organization_id::text||e.requester_id::text,0));
 SELECT * INTO r FROM petty_cash_requests WHERE id=e.request_id FOR UPDATE;
 IF r.status='closed' THEN RAISE EXCEPTION 'Closed expense cannot be changed'; END IF;
 SELECT * INTO e FROM petty_cash_expenses WHERE id=eid FOR UPDATE;
 IF e.id IS NULL OR NOT pc_finance(actor,e.organization_id,e.property_id) OR e.requester_id=actor THEN RAISE EXCEPTION 'Forbidden'; END IF;
 IF result NOT IN ('accepted','rejected') OR (result='rejected' AND length(trim(coalesce(remark,'')))=0) THEN RAISE EXCEPTION 'Valid review and rejection reason required'; END IF;
 UPDATE petty_cash_expenses SET review_status=result,review_remarks=remark,reviewed_by=actor,reviewed_at=now() WHERE id=eid RETURNING * INTO e;
 UPDATE petty_cash_requests SET version=version+1,updated_at=now() WHERE id=e.request_id;
 INSERT INTO petty_cash_activity(request_id,organization_id,actor_id,action,remark) VALUES(e.request_id,e.organization_id,actor,'expense_'||result,remark);
 RETURN to_jsonb(e);
END; $$;
CREATE OR REPLACE FUNCTION public.pc_correct_expense(actor uuid,eid uuid,body jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE e petty_cash_expenses; r petty_cash_requests;
BEGIN
 SELECT * INTO e FROM petty_cash_expenses WHERE id=eid;
 IF e.id IS NULL THEN RAISE EXCEPTION 'Forbidden'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(e.organization_id::text||e.requester_id::text,0));
 SELECT * INTO r FROM petty_cash_requests WHERE id=e.request_id FOR UPDATE;
 IF r.status='closed' THEN RAISE EXCEPTION 'Closed expense cannot be changed'; END IF;
 SELECT * INTO e FROM petty_cash_expenses WHERE id=eid FOR UPDATE;
 IF e.id IS NULL OR e.requester_id<>actor OR NOT pc_internal(actor,e.organization_id,e.property_id) THEN RAISE EXCEPTION 'Forbidden'; END IF;
 IF e.review_status<>'rejected' OR jsonb_array_length(coalesce(body->'documents','[]'::jsonb))=0 THEN RAISE EXCEPTION 'Rejected expense needs replacement proof'; END IF;
 PERFORM pc_attach(actor,e.request_id,body->'documents','settlement',eid);
 UPDATE petty_cash_expenses SET review_status='pending',review_remarks=null,reviewed_by=null,reviewed_at=null WHERE id=eid RETURNING * INTO e;
 UPDATE petty_cash_requests SET version=version+1,updated_at=now() WHERE id=e.request_id;
 INSERT INTO petty_cash_activity(request_id,organization_id,actor_id,action,remark) VALUES(e.request_id,e.organization_id,actor,'proof_corrected',body->>'remark');RETURN to_jsonb(e);
END; $$;
CREATE OR REPLACE FUNCTION public.pc_wallet(actor uuid,org uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE reason text;
BEGIN
 IF NOT pc_internal(actor,org) THEN RAISE EXCEPTION 'Forbidden'; END IF;
 BEGIN PERFORM pc_gate(org,actor);EXCEPTION WHEN others THEN reason:=SQLERRM;END;
 RETURN jsonb_build_object('balance',pc_balance(org,actor),'can_request',reason IS NULL,'blocker',reason,
 'received',(SELECT coalesce(sum(amount),0) FROM petty_cash_wallet_entries WHERE organization_id=org AND requester_id=actor AND kind='credit'),
 'spent',(SELECT coalesce(sum(amount),0) FROM petty_cash_wallet_entries WHERE organization_id=org AND requester_id=actor AND kind='debit'),
 'returned',(SELECT coalesce(sum(amount),0) FROM petty_cash_wallet_entries WHERE organization_id=org AND requester_id=actor AND kind='return'));
END; $$;
CREATE OR REPLACE FUNCTION public.pc_current_can_read(rid uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$ SELECT pc_can_read(auth.uid(),rid); $$;
CREATE OR REPLACE FUNCTION public.pc_current_super(org uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$ SELECT pc_super(auth.uid(),org); $$;
-- Browser/realtime access is read-only and uses exactly the request visibility rule.
ALTER TABLE public.petty_cash_property_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.petty_cash_uploads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.petty_cash_expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.petty_cash_wallet_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY pc_assignments_read ON public.petty_cash_property_assignments FOR SELECT TO authenticated USING(pc_current_super(organization_id));
CREATE POLICY pc_expenses_read ON public.petty_cash_expenses FOR SELECT TO authenticated USING(pc_current_can_read(request_id));
CREATE POLICY pc_ledger_read ON public.petty_cash_wallet_entries FOR SELECT TO authenticated USING(pc_current_can_read(request_id));
-- Replace only petty-cash policies; preserve all records and unrelated modules.
DO $$ DECLARE p record;BEGIN FOR p IN SELECT tablename,policyname FROM pg_policies WHERE schemaname='public' AND tablename IN ('petty_cash_requests','petty_cash_documents','petty_cash_activity') LOOP
 EXECUTE format('DROP POLICY %I ON public.%I',p.policyname,p.tablename);END LOOP;END $$;
CREATE POLICY pc_requests_read ON public.petty_cash_requests FOR SELECT TO authenticated USING(pc_current_can_read(id));
CREATE POLICY pc_documents_read ON public.petty_cash_documents FOR SELECT TO authenticated USING(pc_current_can_read(request_id));
CREATE POLICY pc_activity_read ON public.petty_cash_activity FOR SELECT TO authenticated USING(pc_current_can_read(request_id));
-- Backend RPCs accept authenticated actor IDs from the server only, never the browser.
DO $$ DECLARE f record;BEGIN FOR f IN SELECT oid::regprocedure signature FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname LIKE 'pc\_%' ESCAPE '\' LOOP
 EXECUTE 'REVOKE ALL ON FUNCTION '||f.signature||' FROM PUBLIC';EXECUTE 'GRANT EXECUTE ON FUNCTION '||f.signature||' TO service_role';END LOOP;END $$;
GRANT EXECUTE ON FUNCTION public.pc_current_can_read(uuid),public.pc_current_super(uuid) TO authenticated;
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types) VALUES('petty_cash_evidence','petty_cash_evidence',false,15728640,ARRAY['application/pdf','image/png','image/jpeg','image/webp']) ON CONFLICT(id) DO NOTHING;
-- Legacy documents remain stored; authorized download now uses signed URLs.
UPDATE storage.buckets SET public=false WHERE id='petty_cash_documents';
CREATE OR REPLACE FUNCTION public.pc_requests(actor uuid,org uuid) RETURNS SETOF public.petty_cash_requests
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$ SELECT r.* FROM petty_cash_requests r WHERE r.organization_id=org AND pc_can_read(actor,r.id); $$;
REVOKE ALL ON FUNCTION public.pc_requests(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pc_requests(uuid,uuid) TO service_role;
CREATE OR REPLACE FUNCTION public.pc_report(actor uuid,org uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 WITH scoped AS (SELECT r.*,u.full_name requester_name,p.name property_name,
 CASE WHEN r.workflow_version=2 THEN coalesce((SELECT sum(e.amount) FROM petty_cash_expenses e WHERE e.request_id=r.id),0) ELSE coalesce((SELECT bills_total FROM petty_cash_settlement_status WHERE request_id=r.id),0) END spent,
 coalesce((SELECT count(*) FROM petty_cash_expenses e WHERE e.request_id=r.id AND e.review_status='rejected'),0) unresolved_proofs,
 CASE WHEN r.workflow_version=2 THEN pc_balance(org,r.requester_id,r.id) ELSE coalesce((SELECT unaccounted FROM petty_cash_settlement_status WHERE request_id=r.id AND is_open_advance),0) END balance
 FROM pc_requests(actor,org) r JOIN users u ON u.id=r.requester_id JOIN properties p ON p.id=r.property_id)
 SELECT jsonb_build_object('totals',jsonb_build_object('requested',coalesce(sum(amount_requested),0),'allocated',coalesce(sum(allocated_amount),0),'approved',coalesce(sum(approved_amount),0),'paid',coalesce(sum(paid_amount),0),'spent',coalesce(sum(spent),0),'balance',coalesce(sum(balance),0),'unresolved_proofs',coalesce(sum(unresolved_proofs),0),'requests',count(*)),
 'rows',coalesce(jsonb_agg(jsonb_build_object('id',id,'request_no',request_no,'requester_id',requester_id,'requester_name',requester_name,'property_id',property_id,'property_name',property_name,'status',status,'created_at',created_at,'requested',amount_requested,'allocated',coalesce(allocated_amount,0),'approved',coalesce(approved_amount,0),'assigned_allocator_id',assigned_allocator_id,'assigned_approver_id',assigned_approver_id,'paid',coalesce(paid_amount,0),'spent',spent,'balance',balance,'unresolved_proofs',unresolved_proofs) ORDER BY created_at DESC),'[]'::jsonb)) FROM scoped; $$;
REVOKE ALL ON FUNCTION public.pc_report(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pc_report(uuid,uuid) TO service_role;
CREATE TABLE public.petty_cash_configuration_activity(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id), property_id uuid NOT NULL REFERENCES public.properties(id), actor_id uuid NOT NULL REFERENCES public.users(id), allocator_id uuid NOT NULL REFERENCES public.users(id), approver_id uuid NOT NULL REFERENCES public.users(id), created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.petty_cash_configuration_activity ENABLE ROW LEVEL SECURITY;
CREATE POLICY pc_configuration_read ON public.petty_cash_configuration_activity FOR SELECT TO authenticated USING(pc_current_super(organization_id));
CREATE OR REPLACE FUNCTION public.pc_review_bill(actor uuid,did uuid,result text,remark text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE d petty_cash_documents;r petty_cash_requests;
BEGIN
 SELECT * INTO d FROM petty_cash_documents WHERE id=did;
 SELECT * INTO r FROM petty_cash_requests WHERE id=d.request_id;
 IF r.id IS NULL OR r.workflow_version<>1 OR r.status NOT IN ('paid','settlement_submitted') OR NOT pc_finance(actor,r.organization_id,r.property_id) OR d.stage<>'settlement' OR d.superseded_by IS NOT NULL OR r.requester_id=actor THEN RAISE EXCEPTION 'Forbidden'; END IF;
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
REVOKE ALL ON FUNCTION public.pc_review_bill(uuid,uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pc_review_bill(uuid,uuid,text,text) TO service_role;
CREATE OR REPLACE FUNCTION public.pc_my_expenses(actor uuid,org uuid) RETURNS SETOF public.petty_cash_expenses LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT e.* FROM petty_cash_expenses e WHERE e.organization_id=org AND e.requester_id=actor AND pc_can_read(actor,e.request_id); $$;
REVOKE ALL ON FUNCTION public.pc_my_expenses(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pc_my_expenses(uuid,uuid) TO service_role;

-- Restrictive policy changes only petty-cash buckets. Unrelated storage access is unchanged.
CREATE POLICY pc_private_evidence ON storage.objects AS RESTRICTIVE FOR ALL TO public
 USING(bucket_id NOT IN ('petty_cash_evidence','petty_cash_documents'))
 WITH CHECK(bucket_id NOT IN ('petty_cash_evidence','petty_cash_documents'));

-- Supabase may grant client roles explicitly through default privileges. PUBLIC revocation alone is insufficient.
DO $$ DECLARE f record; BEGIN FOR f IN SELECT oid::regprocedure signature FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname LIKE 'pc\_%' ESCAPE '\' LOOP
 EXECUTE 'REVOKE ALL ON FUNCTION '||f.signature||' FROM PUBLIC,anon,authenticated';
 EXECUTE 'GRANT EXECUTE ON FUNCTION '||f.signature||' TO service_role';
END LOOP; END $$;
GRANT EXECUTE ON FUNCTION public.pc_current_can_read(uuid),public.pc_current_super(uuid) TO authenticated;
