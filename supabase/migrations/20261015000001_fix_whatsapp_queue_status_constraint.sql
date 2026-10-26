-- Fix whatsapp_queue_status_check to include 'processing' status
-- This allows atomic claiming and background dispatch without check constraint violation
ALTER TABLE public.whatsapp_queue DROP CONSTRAINT IF EXISTS whatsapp_queue_status_check;

ALTER TABLE public.whatsapp_queue ADD CONSTRAINT whatsapp_queue_status_check 
    CHECK (status = ANY (ARRAY['pending'::text, 'processing'::text, 'sent'::text, 'failed'::text, 'skipped'::text]));
