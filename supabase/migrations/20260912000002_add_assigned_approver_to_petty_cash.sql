-- Migration: Add assigned_approver_id to petty_cash_requests
-- Allows requesters to select a designated approver when creating a petty cash request.

ALTER TABLE public.petty_cash_requests
    ADD COLUMN IF NOT EXISTS assigned_approver_id UUID REFERENCES public.users(id);

COMMENT ON COLUMN public.petty_cash_requests.assigned_approver_id IS
    'Designated approver selected by the requester during creation.';

CREATE INDEX IF NOT EXISTS idx_pc_requests_assigned_approver
    ON public.petty_cash_requests (assigned_approver_id, status);
