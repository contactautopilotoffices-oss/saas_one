-- Migration: WhatsApp Service (AiSensy) — per-org notification config + event triggers
--
-- Adds:
--   1. organization_settings.whatsapp_service_config  (JSONB, mirrors email_service_config)
--   2. organization_settings.whatsapp_templates       (JSONB, DB-editable AiSensy template map)
--   3. whatsapp_queue: organization_id, template_name, template_params, entity_id columns
--      + dedupe unique index for reminder events
--   4. event_outbox triggers on tickets and crm_leads (meeting_room_bookings and
--      material_requests triggers already exist from 20260721000001_event_outbox.sql)
--
-- Required env: AISENSY_API_KEY (AiSensy campaign API key).
-- AiSensy only sends pre-approved template messages. Every "campaign_name" seeded in
-- whatsapp_templates below must be created and approved in the AiSensy dashboard with
-- the same positional parameters ({{1}}, {{2}}, ... in the order listed in "params").
--
-- Pipeline: DB trigger → event_outbox → webhook /api/webhooks/process-event →
-- EventProcessor → WhatsAppRecipientResolver (whatsapp_service_config) → whatsapp_queue
-- → webhook /api/webhooks/whatsapp-queue → AiSensyService → AiSensy API.

-- ============================================================================
-- 1. Per-org WhatsApp notification config
-- ============================================================================
-- Shape per feature key:
-- {
--   "enabled": boolean,
--   "roles": string[],                 -- org roles (org_super_admin, ...) or property roles
--   "user_ids": string[],              -- explicit user ids
--   "property_overrides": { "<propertyId>": { enabled?, roles?, user_ids? } },
--   "notify_assignee": boolean,
--   "notify_requester": boolean,
--   "reminder_minutes": number|null    -- lead time for the reminder cron (null = off)
-- }
-- NOTE: disabled by default — WhatsApp messages cost money, opt-in per org.

ALTER TABLE public.organization_settings
ADD COLUMN IF NOT EXISTS whatsapp_service_config JSONB DEFAULT '{
  "tickets": {
    "enabled": false,
    "roles": [],
    "user_ids": [],
    "property_overrides": {},
    "notify_assignee": true,
    "notify_requester": true,
    "reminder_minutes": null
  },
  "material_requests": {
    "enabled": false,
    "roles": [],
    "user_ids": [],
    "property_overrides": {},
    "notify_requester": true,
    "reminder_minutes": null
  },
  "meeting_rooms": {
    "enabled": false,
    "roles": [],
    "user_ids": [],
    "property_overrides": {},
    "notify_requester": true,
    "reminder_minutes": null
  },
  "crm_leads": {
    "enabled": false,
    "roles": [],
    "user_ids": [],
    "property_overrides": {},
    "notify_assignee": true,
    "reminder_minutes": null
  },
  "ppm": {
    "enabled": false,
    "roles": [],
    "user_ids": [],
    "property_overrides": {},
    "reminder_minutes": 1440
  }
}'::jsonb;

-- ============================================================================
-- 2. DB-editable AiSensy templates (per event key)
-- ============================================================================
-- "campaign_name" = template/campaign name in the AiSensy dashboard.
-- "params" = ordered list of variables mapped to the template's {{1}}, {{2}}, ...

ALTER TABLE public.organization_settings
ADD COLUMN IF NOT EXISTS whatsapp_templates JSONB DEFAULT '{
  "ticket_created":            { "campaign_name": "ticket_created",            "params": ["ticket_number", "title", "property", "priority"] },
  "ticket_updated":            { "campaign_name": "ticket_updated",            "params": ["ticket_number", "title", "status"] },
  "material_request_created":  { "campaign_name": "material_request_created",  "params": ["ticket_number", "items_summary", "property", "requester"] },
  "meeting_room_booked":       { "campaign_name": "meeting_room_booked",       "params": ["room_name", "date", "start_time", "booker"] },
  "meeting_room_cancelled":    { "campaign_name": "meeting_room_cancelled",    "params": ["room_name", "date", "start_time"] },
  "lead_created":              { "campaign_name": "lead_created",              "params": ["company_name", "contact_person", "source"] },
  "lead_assigned":             { "campaign_name": "lead_assigned",             "params": ["company_name", "assignee_name"] },
  "reminder_meeting_room":     { "campaign_name": "reminder_meeting_room",     "params": ["room_name", "date", "start_time"] },
  "reminder_ppm":              { "campaign_name": "reminder_ppm",              "params": ["schedule_name", "property", "due_date"] },
  "reminder_ticket_sla":       { "campaign_name": "reminder_ticket_sla",       "params": ["ticket_number", "title", "sla_deadline"] },
  "reminder_lead_followup":    { "campaign_name": "reminder_lead_followup",    "params": ["company_name", "contact_person", "followup_date"] }
}'::jsonb;

-- ============================================================================
-- 3. whatsapp_queue extensions
-- ============================================================================
ALTER TABLE public.whatsapp_queue
ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
ADD COLUMN IF NOT EXISTS template_name TEXT,
ADD COLUMN IF NOT EXISTS template_params JSONB,
ADD COLUMN IF NOT EXISTS entity_id UUID;

-- Dedupe for reminder events: one reminder row per (event_type, entity, user).
-- Reminder enqueues always set entity_id; non-reminder events are unaffected.
CREATE UNIQUE INDEX IF NOT EXISTS idx_whatsapp_queue_reminder_dedupe
ON public.whatsapp_queue (event_type, entity_id, user_id)
WHERE event_type LIKE 'REMINDER_%';

-- ============================================================================
-- 4. event_outbox triggers: tickets + crm_leads
-- ============================================================================
-- Separate functions (not create_outbox_event) so existing triggers stay untouched.

CREATE OR REPLACE FUNCTION public.trg_ticket_whatsapp_outbox()
RETURNS TRIGGER AS $$
DECLARE
    v_event_type VARCHAR;
    v_payload JSONB;
BEGIN
    IF TG_OP = 'INSERT' THEN
        v_event_type := 'TICKET_CREATED';
        v_payload := jsonb_build_object(
            'ticket_id', NEW.id,
            'ticket_number', NEW.ticket_number,
            'title', NEW.title,
            'property_id', NEW.property_id,
            'organization_id', NEW.organization_id,
            'priority', NEW.priority,
            'status', NEW.status,
            'raised_by', NEW.raised_by,
            'assigned_to', NEW.assigned_to
        );
    ELSIF TG_OP = 'UPDATE'
          AND (NEW.status IS DISTINCT FROM OLD.status
               OR NEW.assigned_to IS DISTINCT FROM OLD.assigned_to) THEN
        v_event_type := 'TICKET_UPDATED';
        v_payload := jsonb_build_object(
            'ticket_id', NEW.id,
            'ticket_number', NEW.ticket_number,
            'title', NEW.title,
            'property_id', NEW.property_id,
            'organization_id', NEW.organization_id,
            'priority', NEW.priority,
            'status', NEW.status,
            'old_status', OLD.status,
            'raised_by', NEW.raised_by,
            'assigned_to', NEW.assigned_to
        );
    END IF;

    IF v_event_type IS NOT NULL THEN
        INSERT INTO public.event_outbox (event_type, entity_id, payload)
        VALUES (v_event_type, NEW.id, v_payload);
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_tickets_whatsapp_outbox ON public.tickets;
CREATE TRIGGER trg_tickets_whatsapp_outbox
    AFTER INSERT OR UPDATE ON public.tickets
    FOR EACH ROW
    EXECUTE FUNCTION public.trg_ticket_whatsapp_outbox();

-- crm_leads has no organization_id column; the processor resolves the org from
-- property_interest → properties, falling back to the creator's org membership.
CREATE OR REPLACE FUNCTION public.trg_lead_whatsapp_outbox()
RETURNS TRIGGER AS $$
DECLARE
    v_event_type VARCHAR;
    v_payload JSONB;
BEGIN
    IF TG_OP = 'INSERT' THEN
        v_event_type := 'LEAD_CREATED';
    ELSIF TG_OP = 'UPDATE' AND NEW.assigned_to IS DISTINCT FROM OLD.assigned_to THEN
        v_event_type := 'LEAD_ASSIGNED';
    END IF;

    IF v_event_type IS NOT NULL THEN
        v_payload := jsonb_build_object(
            'lead_id', NEW.id,
            'company_name', NEW.company_name,
            'contact_person', NEW.contact_person,
            'contact_number', NEW.contact_number,
            'property_interest', NEW.property_interest,
            'lead_source', NEW.lead_source,
            'created_by', NEW.created_by,
            'assigned_to', NEW.assigned_to,
            'next_followup_date', NEW.next_followup_date
        );

        INSERT INTO public.event_outbox (event_type, entity_id, payload)
        VALUES (v_event_type, NEW.id, v_payload);
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_crm_leads_whatsapp_outbox ON public.crm_leads;
CREATE TRIGGER trg_crm_leads_whatsapp_outbox
    AFTER INSERT OR UPDATE ON public.crm_leads
    FOR EACH ROW
    EXECUTE FUNCTION public.trg_lead_whatsapp_outbox();
