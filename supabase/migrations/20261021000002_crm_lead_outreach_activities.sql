-- Migration: Add whatsapp_sent, whatsapp_received, sms_sent activity types and crm_lead_activities view
-- Date: 2026-10-21

-- 1. Drop existing activity_type check constraint and update to include messaging types
ALTER TABLE public.crm_activity_log DROP CONSTRAINT IF EXISTS crm_activity_log_activity_type_check;
ALTER TABLE public.crm_activity_log ADD CONSTRAINT crm_activity_log_activity_type_check CHECK (
  activity_type = ANY (ARRAY[
    'created'::text,
    'updated'::text,
    'call'::text,
    'meeting'::text,
    'site_visit'::text,
    'proposal_sent'::text,
    'followup_scheduled'::text,
    'status_changed'::text,
    'assigned'::text,
    'note_added'::text,
    'email_sent'::text,
    'archived'::text,
    'restored'::text,
    'whatsapp_sent'::text,
    'whatsapp_received'::text,
    'sms_sent'::text
  ])
);

-- 2. Allow user_id to be nullable for automated bot/webhook activity logs
ALTER TABLE public.crm_activity_log ALTER COLUMN user_id DROP NOT NULL;

-- 3. Create or replace crm_lead_activities view pointing to crm_activity_log
CREATE OR REPLACE VIEW public.crm_lead_activities AS
SELECT
  id,
  lead_id,
  user_id,
  activity_type,
  description,
  metadata,
  created_at
FROM public.crm_activity_log;
