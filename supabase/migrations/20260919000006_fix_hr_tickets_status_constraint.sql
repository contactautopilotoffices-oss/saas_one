-- Migration: Add pending_acknowledgement to hr_tickets_status_check constraint

ALTER TABLE public.hr_tickets 
DROP CONSTRAINT IF EXISTS hr_tickets_status_check;

ALTER TABLE public.hr_tickets 
ADD CONSTRAINT hr_tickets_status_check 
CHECK (status IN (
    'new', 
    'assigned', 
    'in_progress', 
    'awaiting_employee_response', 
    'awaiting_manager_response', 
    'awaiting_hr_response', 
    'awaiting_internal_approval',
    'awaiting_external_party', 
    'escalated', 
    'pending_acknowledgement',
    'resolved', 
    'closed', 
    'reopened', 
    'cancelled'
));
