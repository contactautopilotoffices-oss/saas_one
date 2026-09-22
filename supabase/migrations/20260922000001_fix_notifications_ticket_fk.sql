-- Migration: Drop strict FK constraint on public.notifications(ticket_id)
-- Reason: notifications.ticket_id is a polymorphic reference that can refer to Helpdesk tickets, HR tickets, or other modules.

ALTER TABLE IF EXISTS public.notifications
    DROP CONSTRAINT IF EXISTS notifications_ticket_id_fkey;

ALTER TABLE IF EXISTS public.notifications
    ALTER COLUMN ticket_id DROP NOT NULL;
