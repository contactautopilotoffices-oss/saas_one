-- Migration: 20260924000001_outbox_dedup_and_trigger_guards.sql
-- Description: Enforce conditional guards on outbox DB triggers to prevent duplicate outbox insertions on minor updates, and add deduplication index.

-- 1. Index for fast outbox deduplication lookups
CREATE INDEX IF NOT EXISTS idx_event_outbox_entity_type_created 
ON public.event_outbox(entity_id, event_type, status, created_at DESC);

-- 2. Update Tickets outbox trigger to fire ONLY on INSERT or meaningful state changes (status/assigned_to)
DROP TRIGGER IF EXISTS trg_tickets_outbox ON public.tickets;
CREATE TRIGGER trg_tickets_outbox
AFTER INSERT OR UPDATE ON public.tickets
FOR EACH ROW
WHEN (
    TG_OP = 'INSERT' OR 
    (OLD.status IS DISTINCT FROM NEW.status) OR 
    (OLD.assigned_to IS DISTINCT FROM NEW.assigned_to) OR
    (OLD.priority IS DISTINCT FROM NEW.priority)
)
EXECUTE FUNCTION public.fn_tickets_outbox();

-- 3. Update HR Tickets outbox trigger to fire ONLY on INSERT or meaningful status/level changes
DROP TRIGGER IF EXISTS trg_hr_tickets_outbox ON public.hr_tickets;
CREATE TRIGGER trg_hr_tickets_outbox
AFTER INSERT OR UPDATE ON public.hr_tickets
FOR EACH ROW
WHEN (
    TG_OP = 'INSERT' OR 
    (OLD.status IS DISTINCT FROM NEW.status) OR 
    (OLD.current_level IS DISTINCT FROM NEW.current_level) OR
    (OLD.assigned_user_id IS DISTINCT FROM NEW.assigned_user_id)
)
EXECUTE FUNCTION public.fn_hr_ticket_event_outbox();

-- 4. Update VMS Visitors outbox trigger to fire ONLY on INSERT or approval_status/status changes
DROP TRIGGER IF EXISTS trg_vms_visitors_outbox ON public.visitor_logs;
CREATE TRIGGER trg_vms_visitors_outbox
AFTER INSERT OR UPDATE ON public.visitor_logs
FOR EACH ROW
WHEN (
    TG_OP = 'INSERT' OR 
    (OLD.status IS DISTINCT FROM NEW.status) OR 
    (OLD.approval_status IS DISTINCT FROM NEW.approval_status)
)
EXECUTE FUNCTION public.fn_vms_visitors_event_outbox();

-- 5. Update Facility Requests (Guest QR Requests) outbox trigger
DROP TRIGGER IF EXISTS trg_facility_requests_outbox ON public.guest_requests;
CREATE TRIGGER trg_facility_requests_outbox
AFTER INSERT OR UPDATE ON public.guest_requests
FOR EACH ROW
WHEN (
    TG_OP = 'INSERT' OR 
    (OLD.status IS DISTINCT FROM NEW.status) OR
    (OLD.assigned_to IS DISTINCT FROM NEW.assigned_to)
)
EXECUTE FUNCTION public.fn_facility_requests_event_outbox();

-- 6. Update Requisitions outbox trigger
DROP TRIGGER IF EXISTS trg_requisition_workflow_outbox ON public.property_monthly_requisitions;
CREATE TRIGGER trg_requisition_workflow_outbox
AFTER INSERT OR UPDATE ON public.property_monthly_requisitions
FOR EACH ROW
WHEN (
    TG_OP = 'INSERT' OR 
    (OLD.status IS DISTINCT FROM NEW.status) OR
    (OLD.approval_stage IS DISTINCT FROM NEW.approval_stage)
)
EXECUTE FUNCTION public.fn_requisition_workflow_event_outbox();
