-- Petty Cash events and durable delivery only. No history replay, sends, settings, memberships or bucket changes.
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
 INSERT INTO petty_cash_activity(request_id,organization_id,actor_id,action,remark,metadata) VALUES(rid,r.organization_id,actor,'expense_recorded',e.description||' ('||amount||')',jsonb_build_object('expense_id',e.id));
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
 IF e.review_status=result AND e.review_remarks IS NOT DISTINCT FROM remark THEN RETURN to_jsonb(e); END IF;
 UPDATE petty_cash_expenses SET review_status=result,review_remarks=remark,reviewed_by=actor,reviewed_at=now() WHERE id=eid RETURNING * INTO e;
 UPDATE petty_cash_requests SET version=version+1,updated_at=now() WHERE id=e.request_id;
 INSERT INTO petty_cash_activity(request_id,organization_id,actor_id,action,remark,metadata) VALUES(e.request_id,e.organization_id,actor,'expense_'||result,remark,jsonb_build_object('expense_id',eid));
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
 INSERT INTO petty_cash_activity(request_id,organization_id,actor_id,action,remark,metadata) VALUES(e.request_id,e.organization_id,actor,'proof_corrected',body->>'remark',jsonb_build_object('expense_id',eid));RETURN to_jsonb(e);
END; $$;

CREATE UNIQUE INDEX IF NOT EXISTS pc_outbox_activity_unique ON public.event_outbox(event_type,entity_id) WHERE event_type LIKE 'PETTY_CASH_%';
CREATE OR REPLACE FUNCTION public.pc_activity_outbox() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r petty_cash_requests; e petty_cash_expenses; feature text; received numeric; spent numeric; returned numeric; return_delta numeric; snapshot jsonb;
BEGIN
 SELECT * INTO r FROM petty_cash_requests WHERE id=NEW.request_id AND organization_id=NEW.organization_id;
 IF r.id IS NULL OR r.workflow_version<>2 OR r.request_type<>'advance' THEN RETURN NEW; END IF;
 feature:=CASE NEW.action WHEN 'submitted' THEN 'SUBMITTED' WHEN 'submit' THEN 'SUBMITTED' WHEN 'resubmit' THEN 'SUBMITTED' WHEN 'allocate' THEN 'ALLOCATED' WHEN 'approve' THEN 'APPROVED' WHEN 'reject' THEN 'REJECTED' WHEN 'send_back' THEN 'SENT_BACK' WHEN 'pay' THEN 'PAID' WHEN 'expense_recorded' THEN 'EXPENSE_RECORDED' WHEN 'expense_accepted' THEN 'EXPENSE_ACCEPTED' WHEN 'expense_rejected' THEN 'EXPENSE_REJECTED' WHEN 'proof_corrected' THEN 'PROOF_CORRECTED' WHEN 'return' THEN 'RETURN_CONFIRMED' WHEN 'settle' THEN 'SETTLEMENT_SUBMITTED' WHEN 'close' THEN 'CLOSED' WHEN 'cancel' THEN 'CANCELLED' WHEN 'reassign' THEN 'ROUTING_REASSIGNED' ELSE null END;
 IF feature IS NULL THEN RETURN NEW; END IF;
 SELECT coalesce(sum(amount)FILTER(WHERE kind='credit'),0),coalesce(sum(amount)FILTER(WHERE kind='debit'),0),coalesce(sum(amount)FILTER(WHERE kind='return'),0) INTO received,spent,returned FROM petty_cash_wallet_entries WHERE request_id=r.id;
 IF feature='PAID' AND (received<=0 OR received IS DISTINCT FROM r.paid_amount) THEN RAISE EXCEPTION 'Payment event requires its actual wallet credit'; END IF;
 IF feature IN ('EXPENSE_RECORDED','EXPENSE_ACCEPTED','EXPENSE_REJECTED','PROOF_CORRECTED') THEN
  SELECT * INTO e FROM petty_cash_expenses WHERE id=(NEW.metadata->>'expense_id')::uuid AND request_id=r.id AND organization_id=r.organization_id;
  IF e.id IS NULL THEN RAISE EXCEPTION 'Expense event requires exact expense identity'; END IF;
 END IF;
 IF feature='RETURN_CONFIRMED' THEN return_delta:=r.amount_returned-coalesce((NEW.metadata->'before'->>'amount_returned')::numeric,0); IF return_delta<=0 THEN RAISE EXCEPTION 'Cash return event requires a positive confirmed return'; END IF; END IF;
 snapshot:=jsonb_build_object('schema_version',1,'activity_id',NEW.id,'organization_id',r.organization_id,'property_id',r.property_id,'request_id',r.id,'request_no',r.request_no,'requester_id',r.requester_id,'assigned_allocator_id',r.assigned_allocator_id,'assigned_approver_id',r.assigned_approver_id,'actor_id',NEW.actor_id,'action',NEW.action,'from_status',NEW.from_status,'to_status',r.status,'expense_id',e.id,'occurred_at',coalesce(NEW.created_at,now()),'request_version',r.version,'payment_date',r.payment_date,'expense_date',e.expense_date,'review_status',e.review_status,'amounts',jsonb_build_object('requested',r.amount_requested::numeric(18,2)::text,'allocated',coalesce(r.allocated_amount,0)::numeric(18,2)::text,'approved',coalesce(r.approved_amount,0)::numeric(18,2)::text,'paid',received::numeric(18,2)::text,'spent',spent::numeric(18,2)::text,'returned',returned::numeric(18,2)::text,'remaining',(received-spent-returned)::numeric(18,2)::text,'expense',e.amount::numeric(18,2)::text,'return_delta',return_delta::numeric(18,2)::text));
 NEW.metadata:=coalesce(NEW.metadata,'{}'::jsonb)||jsonb_build_object('notification_snapshot',snapshot);
 INSERT INTO event_outbox(event_type,entity_id,payload) VALUES('PETTY_CASH_'||feature,NEW.id,snapshot) ON CONFLICT DO NOTHING;
 RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS pc_activity_outbox ON public.petty_cash_activity;
CREATE TRIGGER pc_activity_outbox BEFORE INSERT ON public.petty_cash_activity FOR EACH ROW EXECUTE FUNCTION public.pc_activity_outbox();

CREATE OR REPLACE FUNCTION public.pc_notification_recipients(rid uuid,feature text,rule jsonb) RETURNS TABLE(id uuid,full_name text,email text,phone text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 WITH r AS(SELECT * FROM petty_cash_requests WHERE id=rid AND workflow_version=2 AND request_type='advance'),
 memberships AS(SELECT m.user_id,m.role::text role FROM organization_memberships m,r WHERE m.organization_id=r.organization_id AND m.is_active AND coalesce(m.role::text,'')<>'' AND m.role::text !~* '(tenant|vendor)' UNION SELECT m.user_id,m.role::text FROM property_memberships m,r WHERE m.organization_id=r.organization_id AND m.property_id=r.property_id AND m.is_active AND coalesce(m.role::text,'')<>'' AND m.role::text !~* '(tenant|vendor)'),
 selected AS(SELECT user_id FROM memberships WHERE role IN(SELECT jsonb_array_elements_text(coalesce(rule->'roles','[]'::jsonb))) UNION SELECT u.id FROM users u WHERE u.id::text IN(SELECT jsonb_array_elements_text(coalesce(rule->'user_ids','[]'::jsonb))) UNION SELECT assigned_allocator_id FROM r WHERE rule->'notify_assignee'='true'::jsonb UNION SELECT assigned_approver_id FROM r WHERE rule->'notify_approver'='true'::jsonb UNION SELECT requester_id FROM r WHERE rule->'notify_requester'='true'::jsonb)
 SELECT DISTINCT u.id,u.full_name,u.email,u.phone FROM users u,r,selected s WHERE u.id=s.user_id AND EXISTS(SELECT 1 FROM memberships WHERE user_id=u.id) AND pc_internal(u.id,r.organization_id,r.property_id) AND pc_can_read(u.id,r.id)
 AND CASE WHEN feature IN('petty_cash_submitted','petty_cash_routing_reassigned') THEN r.status='submitted' AND u.id=r.assigned_allocator_id AND u.id<>r.requester_id
 WHEN feature='petty_cash_allocated' THEN r.status='pending_approval' AND u.id=r.assigned_approver_id AND u.id<>r.requester_id
 WHEN feature='petty_cash_approved' THEN r.status='approved' AND pc_finance(u.id,r.organization_id,r.property_id) AND u.id<>r.requester_id
 WHEN feature IN('petty_cash_expense_recorded','petty_cash_proof_corrected') THEN r.status IN('paid','settlement_submitted') AND pc_finance(u.id,r.organization_id,r.property_id) AND u.id<>r.requester_id
 WHEN feature='petty_cash_settlement_submitted' THEN r.status='settlement_submitted' AND pc_finance(u.id,r.organization_id,r.property_id) AND u.id<>r.requester_id
 WHEN feature IN('petty_cash_rejected','petty_cash_sent_back','petty_cash_paid','petty_cash_expense_accepted','petty_cash_expense_rejected','petty_cash_return_confirmed','petty_cash_closed','petty_cash_cancelled') THEN true ELSE false END;
$$;

CREATE TABLE IF NOT EXISTS public.petty_cash_notification_deliveries(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),event_id uuid NOT NULL REFERENCES event_outbox(id),organization_id uuid NOT NULL REFERENCES organizations(id),request_id uuid NOT NULL REFERENCES petty_cash_requests(id),recipient_id uuid NOT NULL REFERENCES users(id),channel text NOT NULL CHECK(channel IN('email','whatsapp')),destination text NOT NULL,
 status text NOT NULL DEFAULT 'queued' CHECK(status IN('queued','processing','sending','sent','failed','skipped','ambiguous')),
 attempt_count int NOT NULL DEFAULT 0,next_attempt_at timestamptz NOT NULL DEFAULT now(),lease_until timestamptz,lease_token uuid,provider_reference text,last_error text,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(event_id,channel,destination));
CREATE INDEX IF NOT EXISTS pc_delivery_due ON public.petty_cash_notification_deliveries(status,next_attempt_at);
ALTER TABLE public.petty_cash_notification_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.petty_cash_notification_deliveries FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.petty_cash_notification_deliveries TO service_role;

CREATE OR REPLACE FUNCTION public.pc_claim_notification_deliveries(batch_limit int DEFAULT 20,target_event uuid DEFAULT null,target_channel text DEFAULT null)
RETURNS SETOF public.petty_cash_notification_deliveries LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 -- A worker lost after starting a provider request must not automatically resend.
 UPDATE petty_cash_notification_deliveries SET status='ambiguous',last_error='Provider send lease expired; reconcile before resending',updated_at=now() WHERE status='sending' AND lease_until<now();
 UPDATE petty_cash_notification_deliveries SET status='queued',lease_token=null,lease_until=null,updated_at=now() WHERE status='processing' AND lease_until<now();
 RETURN QUERY WITH due AS(SELECT d.id FROM petty_cash_notification_deliveries d WHERE d.status IN('queued','failed') AND d.attempt_count<3 AND d.next_attempt_at<=now() AND (target_event IS NULL OR d.event_id=target_event) AND (target_channel IS NULL OR d.channel=target_channel) ORDER BY d.next_attempt_at,d.created_at LIMIT least(greatest(batch_limit,1),50) FOR UPDATE SKIP LOCKED)
 UPDATE petty_cash_notification_deliveries d SET status='processing',attempt_count=d.attempt_count+1,lease_until=now()+interval '2 minutes',lease_token=gen_random_uuid(),updated_at=now() FROM due WHERE d.id=due.id RETURNING d.*;
END; $$;

REVOKE ALL ON FUNCTION public.pc_expense(uuid,uuid,jsonb),public.pc_review_expense(uuid,uuid,text,text),public.pc_correct_expense(uuid,uuid,jsonb),public.pc_activity_outbox(),public.pc_notification_recipients(uuid,text,jsonb),public.pc_claim_notification_deliveries(int,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pc_expense(uuid,uuid,jsonb),public.pc_review_expense(uuid,uuid,text,text),public.pc_correct_expense(uuid,uuid,jsonb),public.pc_notification_recipients(uuid,text,jsonb),public.pc_claim_notification_deliveries(int,uuid,text) TO service_role;
COMMIT;
