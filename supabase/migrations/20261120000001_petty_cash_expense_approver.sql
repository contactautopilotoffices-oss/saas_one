-- Petty cash: a configurable expense approver per property.
--
-- Today an uploaded expense is reviewed by anyone holding the `accounts` role for the
-- property (pc_finance). This migration adds a third routing stage, `expense_approver`,
-- configured on the same Property Routing screen as allocator and approver, so a named
-- person owns expense approval, their decision is stamped on the expense
-- (review_status / reviewed_by / reviewed_at, already present) and reconciliation can
-- show who approved each spend.
--
-- Accounts keep their existing review rights: this stage is additive, so a property with
-- no expense approver configured behaves exactly as before.
BEGIN;

-- ---------------------------------------------------------------- routing stage

ALTER TABLE public.petty_cash_property_assignments DROP CONSTRAINT IF EXISTS petty_cash_property_assignments_kind_check;
ALTER TABLE public.petty_cash_property_assignments ADD CONSTRAINT petty_cash_property_assignments_kind_check
 CHECK(kind IN ('allocator','approver','expense_approver'));

-- Routing history keeps the expense approver alongside the other two stages.
ALTER TABLE public.petty_cash_configuration_activity
 ADD COLUMN IF NOT EXISTS expense_approver_id uuid REFERENCES public.users(id),
 ADD COLUMN IF NOT EXISTS expense_approver_backups uuid[] NOT NULL DEFAULT '{}'::uuid[];

-- Who was routed this expense when it was recorded. Kept separate from reviewed_by so
-- reconciliation can tell "who should have approved" from "who actually did", even after
-- routing changes.
ALTER TABLE public.petty_cash_expenses
 ADD COLUMN IF NOT EXISTS assigned_expense_approver_id uuid REFERENCES public.users(id);

CREATE INDEX IF NOT EXISTS pc_expense_pending_for_approver
 ON public.petty_cash_expenses(organization_id,assigned_expense_approver_id,review_status)
 WHERE review_status='pending';

-- ---------------------------------------------------------------- helper

-- True when the user is an active expense approver (primary or backup) for the property.
CREATE OR REPLACE FUNCTION public.pc_expense_approver(u uuid,o uuid,p uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT u IS NOT NULL AND p IS NOT NULL AND EXISTS(
  SELECT 1 FROM petty_cash_property_assignments a
  WHERE a.user_id=u AND a.organization_id=o AND a.property_id=p AND a.kind='expense_approver' AND a.is_active)
 AND pc_internal(u,o,p); $$;

-- ---------------------------------------------------------------- routing on each expense

-- Stamps the property's primary expense approver on a new expense. A self-approval is never
-- routed: pc_review_expense already blocks the requester from reviewing their own spend.
CREATE OR REPLACE FUNCTION public.pc_stamp_expense_approver() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NEW.assigned_expense_approver_id IS NULL THEN
  SELECT a.user_id INTO NEW.assigned_expense_approver_id FROM petty_cash_property_assignments a
  WHERE a.property_id=NEW.property_id AND a.kind='expense_approver' AND a.is_active AND a.is_primary LIMIT 1;
 END IF;
 IF NEW.assigned_expense_approver_id=NEW.requester_id THEN NEW.assigned_expense_approver_id:=null; END IF;
 RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS pc_stamp_expense_approver ON public.petty_cash_expenses;
CREATE TRIGGER pc_stamp_expense_approver BEFORE INSERT ON public.petty_cash_expenses
 FOR EACH ROW EXECUTE FUNCTION public.pc_stamp_expense_approver();

-- Expenses still awaiting a decision are routed to whoever is configured now, so the new
-- queue is not empty on day one. Already-reviewed expenses are left untouched.
UPDATE public.petty_cash_expenses e SET assigned_expense_approver_id=a.user_id
FROM public.petty_cash_property_assignments a
WHERE a.property_id=e.property_id AND a.kind='expense_approver' AND a.is_active AND a.is_primary
 AND e.review_status='pending' AND e.assigned_expense_approver_id IS NULL AND a.user_id<>e.requester_id;

-- ---------------------------------------------------------------- read access

-- Same as 2026-10-30 (cancel after payout) except the property's expense approver can read a
-- funded request, which is what they must open to judge its expenses.
CREATE OR REPLACE FUNCTION public.pc_can_read(u uuid,rid uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT coalesce((SELECT
  EXISTS(SELECT 1 FROM users WHERE id=u AND is_master_admin)
  OR (pc_internal(u,r.organization_id) AND (
   r.requester_id=u OR pc_super(u,r.organization_id)
   OR (r.status<>'draft' AND (r.assigned_allocator_id=u OR r.assigned_approver_id=u) AND pc_internal(u,r.organization_id,r.property_id))
   OR ((r.status IN ('approved','paid','settlement_submitted','closed') OR (r.status='cancelled' AND r.paid_at IS NOT NULL)) AND pc_finance(u,r.organization_id,r.property_id))
   OR (r.status IN ('paid','settlement_submitted','closed','cancelled') AND pc_expense_approver(u,r.organization_id,r.property_id))))
 FROM petty_cash_requests r WHERE r.id=rid),false); $$;

-- ---------------------------------------------------------------- review

-- Same as 2026-11-16 (edit and withdraw pending) except the configured expense approver may
-- also decide, and the activity row records which hat the actor wore for reconciliation.
-- That migration's super-admin reviewer is kept: this file is applied after it, so dropping
-- it here would silently revoke it.
CREATE OR REPLACE FUNCTION public.pc_review_expense(actor uuid,eid uuid,result text,remark text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE e petty_cash_expenses; r petty_cash_requests; routed boolean; finance boolean; super boolean;
BEGIN
 SELECT * INTO e FROM petty_cash_expenses WHERE id=eid;
 IF e.id IS NULL THEN RAISE EXCEPTION 'Forbidden'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(e.organization_id::text||e.requester_id::text,0));
 SELECT * INTO r FROM petty_cash_requests WHERE id=e.request_id FOR UPDATE;
 IF r.status='closed' THEN RAISE EXCEPTION 'Closed expense cannot be changed'; END IF;
 SELECT * INTO e FROM petty_cash_expenses WHERE id=eid FOR UPDATE;
 IF e.id IS NULL THEN RAISE EXCEPTION 'Forbidden'; END IF;
 finance:=pc_finance(actor,e.organization_id,e.property_id);
 super:=pc_super(actor,e.organization_id);
 routed:=pc_expense_approver(actor,e.organization_id,e.property_id);
 IF e.requester_id=actor OR NOT (finance OR super OR routed) THEN RAISE EXCEPTION 'Forbidden'; END IF;
 IF e.review_status='withdrawn' THEN RAISE EXCEPTION 'A withdrawn expense cannot be reviewed'; END IF;
 IF result NOT IN ('accepted','rejected') OR (result='rejected' AND length(trim(coalesce(remark,'')))=0) THEN RAISE EXCEPTION 'Valid review and rejection reason required'; END IF;
 IF e.review_status=result AND e.review_remarks IS NOT DISTINCT FROM remark THEN RETURN to_jsonb(e); END IF;
 UPDATE petty_cash_expenses SET review_status=result,review_remarks=remark,reviewed_by=actor,reviewed_at=now() WHERE id=eid RETURNING * INTO e;
 UPDATE petty_cash_requests SET version=version+1,updated_at=now() WHERE id=e.request_id;
 INSERT INTO petty_cash_activity(request_id,organization_id,actor_id,action,remark,metadata)
 VALUES(e.request_id,e.organization_id,actor,'expense_'||result,remark,
  jsonb_build_object('expense_id',eid,'reviewer_role',CASE WHEN routed THEN 'expense_approver' WHEN finance THEN 'accounts' ELSE 'super_admin' END));
 RETURN to_jsonb(e);
END; $$;

-- ---------------------------------------------------------------- queues

-- Expenses this user is asked to decide on: the ones routed to them, plus — for accounts —
-- the ones no expense approver is configured for, which is who reviews them today.
CREATE OR REPLACE FUNCTION public.pc_expenses_to_review(actor uuid,org uuid) RETURNS SETOF public.petty_cash_expenses
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT e.* FROM petty_cash_expenses e
 WHERE e.organization_id=org AND e.review_status='pending' AND e.requester_id<>actor
  AND (e.assigned_expense_approver_id=actor
   OR (e.assigned_expense_approver_id IS NULL AND pc_finance(actor,org,e.property_id)))
  AND pc_can_read(actor,e.request_id); $$;

-- Same as 2026-10-06 plus the expense_approvals queue for the new routing stage.
CREATE OR REPLACE FUNCTION public.pc_pending_counts(actor uuid,org uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE counts jsonb;
BEGIN
 IF NOT pc_internal(actor,org) AND NOT EXISTS(SELECT 1 FROM users WHERE id=actor AND is_master_admin) THEN RAISE EXCEPTION 'Forbidden'; END IF;
 WITH accessible AS(SELECT r.* FROM petty_cash_requests r WHERE r.organization_id=org AND r.request_type='advance' AND r.status IN('draft','submitted','pending_approval','sent_back','approved','paid','settlement_submitted') AND pc_can_read(actor,r.id))
 SELECT jsonb_build_object('mine',count(*)FILTER(WHERE requester_id=actor),'allocations',count(*)FILTER(WHERE workflow_version=2 AND status='submitted' AND assigned_allocator_id=actor AND requester_id<>actor),'approvals',count(*)FILTER(WHERE workflow_version=2 AND status='pending_approval' AND assigned_approver_id=actor AND requester_id<>actor),'assigned',count(*)FILTER(WHERE actor IN(assigned_allocator_id,assigned_approver_id)),'disbursements',count(*)FILTER(WHERE status='approved' AND requester_id<>actor AND pc_finance(actor,org,property_id)),'reconciliation',count(*)FILTER(WHERE status='settlement_submitted' AND requester_id<>actor AND pc_finance(actor,org,property_id)),'all',count(*),'expenses',(SELECT count(*) FROM petty_cash_expenses e WHERE e.organization_id=org AND e.requester_id=actor AND e.review_status IN('pending','rejected') AND pc_can_read(actor,e.request_id)),'expense_approvals',(SELECT count(*) FROM pc_expenses_to_review(actor,org))) INTO counts FROM accessible;
 RETURN counts;
END; $$;

-- ---------------------------------------------------------------- configuration

-- Same as 2026-10-30 (audit fixes) plus the optional expense approver stage. A null
-- expense_approver clears the stage, which leaves accounts reviewing expenses as before.
DROP FUNCTION IF EXISTS public.pc_set_routing(uuid,uuid,uuid,uuid,uuid[],uuid[],numeric);
CREATE OR REPLACE FUNCTION public.pc_set_routing(actor uuid, prop uuid, allocator uuid, approver uuid, allocator_backups uuid[], approver_backups uuid[], proof_threshold numeric DEFAULT null, expense_approver uuid DEFAULT null, expense_approver_backups uuid[] DEFAULT '{}'::uuid[]) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE org uuid; member uuid; kind_name text; primary_id uuid; backups uuid[];
BEGIN
 SELECT organization_id INTO org FROM properties WHERE id=prop AND deleted_at IS NULL AND coalesce(is_active,true);
 IF org IS NULL OR NOT pc_super(actor,org) THEN RAISE EXCEPTION 'Forbidden'; END IF;
 IF allocator IS NULL OR approver IS NULL OR allocator=approver THEN RAISE EXCEPTION 'Choose distinct eligible internal users'; END IF;
 allocator_backups:=coalesce(allocator_backups,'{}'::uuid[]);approver_backups:=coalesce(approver_backups,'{}'::uuid[]);expense_approver_backups:=coalesce(expense_approver_backups,'{}'::uuid[]);
 IF expense_approver IS NULL AND cardinality(expense_approver_backups)>0 THEN RAISE EXCEPTION 'Choose an expense approver before adding its backups'; END IF;
 IF cardinality(allocator_backups)>25 OR cardinality(approver_backups)>25 OR cardinality(expense_approver_backups)>25 THEN RAISE EXCEPTION 'At most 25 backups per stage'; END IF;
 IF proof_threshold IS NOT NULL AND (proof_threshold < 0 OR proof_threshold > 999999999999.99) THEN RAISE EXCEPTION 'Invalid proof threshold'; END IF;
 FOR kind_name,primary_id,backups IN SELECT 'allocator',allocator,allocator_backups UNION ALL SELECT 'approver',approver,approver_backups UNION ALL SELECT 'expense_approver',expense_approver,expense_approver_backups LOOP
  CONTINUE WHEN primary_id IS NULL;
  IF primary_id=ANY(backups) OR cardinality(backups)<>(SELECT count(DISTINCT x) FROM unnest(backups)x) THEN RAISE EXCEPTION 'Choose distinct eligible primary and backup users'; END IF;
  FOREACH member IN ARRAY array_prepend(primary_id,backups) LOOP
   IF member IS NULL OR NOT pc_internal(member,org,prop) THEN RAISE EXCEPTION 'Choose eligible internal users for this property'; END IF;
  END LOOP;
 END LOOP;
 PERFORM pg_advisory_xact_lock(hashtextextended(prop::text,0));
 IF proof_threshold IS NOT NULL THEN
   UPDATE properties SET petty_cash_proof_threshold = round(proof_threshold, 2) WHERE id = prop;
 END IF;
 UPDATE petty_cash_property_assignments SET is_active=false,is_primary=false,updated_by=actor,updated_at=now() WHERE property_id=prop;
 FOR kind_name,primary_id,backups IN SELECT 'allocator',allocator,allocator_backups UNION ALL SELECT 'approver',approver,approver_backups UNION ALL SELECT 'expense_approver',expense_approver,expense_approver_backups LOOP
  CONTINUE WHEN primary_id IS NULL;
  FOREACH member IN ARRAY array_prepend(primary_id,backups) LOOP
   INSERT INTO petty_cash_property_assignments(organization_id,property_id,user_id,kind,is_active,is_primary,updated_by)
   VALUES(org,prop,member,kind_name,true,member=primary_id,actor)
   ON CONFLICT(property_id,user_id,kind) DO UPDATE SET is_active=true,is_primary=EXCLUDED.is_primary,updated_by=actor,updated_at=now();
  END LOOP;
 END LOOP;
 INSERT INTO petty_cash_configuration_activity(organization_id,property_id,actor_id,allocator_id,approver_id,allocator_backups,approver_backups,expense_approver_id,expense_approver_backups)
 VALUES(org,prop,actor,allocator,approver,allocator_backups,approver_backups,expense_approver,expense_approver_backups);
 -- Pending expenses follow the routing that is current now, so a re-route does not leave
 -- spends stuck in the previous approver's queue.
 UPDATE petty_cash_expenses SET assigned_expense_approver_id=CASE WHEN expense_approver=requester_id THEN null ELSE expense_approver END
 WHERE property_id=prop AND review_status='pending';
 RETURN jsonb_build_object('property_id',prop,'allocator_id',allocator,'approver_id',approver,'allocator_backups',allocator_backups,'approver_backups',approver_backups,'expense_approver_id',expense_approver,'expense_approver_backups',expense_approver_backups,'proof_threshold',proof_threshold);
END; $$;

-- ---------------------------------------------------------------- grants

REVOKE ALL ON FUNCTION public.pc_expense_approver(uuid,uuid,uuid), public.pc_expenses_to_review(uuid,uuid),
 public.pc_can_read(uuid,uuid), public.pc_review_expense(uuid,uuid,text,text), public.pc_pending_counts(uuid,uuid),
 public.pc_set_routing(uuid,uuid,uuid,uuid,uuid[],uuid[],numeric,uuid,uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pc_expense_approver(uuid,uuid,uuid), public.pc_expenses_to_review(uuid,uuid),
 public.pc_can_read(uuid,uuid), public.pc_review_expense(uuid,uuid,text,text), public.pc_pending_counts(uuid,uuid),
 public.pc_set_routing(uuid,uuid,uuid,uuid,uuid[],uuid[],numeric,uuid,uuid[]) TO service_role;

COMMIT;
