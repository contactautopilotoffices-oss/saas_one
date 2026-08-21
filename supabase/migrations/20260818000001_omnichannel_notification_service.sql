-- ============================================================================
-- Migration: Omnichannel Notification Service (WhatsApp / AiSensy + Email + Push)
-- Description: Unifies multi-channel routing, Meta templates map, and DB triggers
-- ============================================================================

-- 1. Ensure public.organization_settings exists and has all required columns
CREATE TABLE IF NOT EXISTS public.organization_settings (
    organization_id UUID PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
    email_preferences JSONB DEFAULT '{"procurement": true, "meeting_rooms": true, "tickets": true, "visitors": true}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE public.organization_settings
ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
ADD COLUMN IF NOT EXISTS whatsapp_service_config JSONB DEFAULT '{}'::jsonb,
ADD COLUMN IF NOT EXISTS notification_matrix JSONB DEFAULT '{

  "tickets": {
    "ticket_created": {
      "channels": { "email": true, "whatsapp": true, "push": true },
      "roles": ["property_admin", "staff"],
      "user_ids": [],
      "notify_assignee": true,
      "notify_requester": true
    },
    "ticket_assigned": {
      "channels": { "email": true, "whatsapp": true, "push": true },
      "roles": [],
      "user_ids": [],
      "notify_assignee": true
    },
    "ticket_completed": {
      "channels": { "email": true, "whatsapp": true, "push": true },
      "roles": [],
      "user_ids": [],
      "notify_requester": true
    },
    "reminder_ticket_sla": {
      "channels": { "email": false, "whatsapp": true, "push": true },
      "roles": ["property_admin", "org_super_admin"],
      "user_ids": [],
      "notify_assignee": true,
      "reminder_minutes": 30
    }
  },
  "checklists": {
    "checklist_slot_reminder": {
      "channels": { "email": false, "whatsapp": true, "push": true },
      "roles": ["mst", "staff"],
      "user_ids": [],
      "reminder_minutes": 30
    },
    "checklist_overdue_alert": {
      "channels": { "email": true, "whatsapp": true, "push": true },
      "roles": ["property_admin", "org_super_admin"],
      "user_ids": []
    }
  },
  "scheduled_reports": {
    "daily_property_report": {
      "channels": { "email": true, "whatsapp": true, "push": false },
      "roles": ["org_super_admin", "owner", "admin"],
      "user_ids": [],
      "schedule_time": "20:00",
      "frequency": "daily"
    }
  },
  "procurement": {
    "material_request_created": {
      "channels": { "email": true, "whatsapp": true, "push": false },
      "roles": ["procurement", "org_super_admin"],
      "user_ids": []
    },
    "comparative_uploaded": {
      "channels": { "email": true, "whatsapp": true, "push": true },
      "roles": ["org_super_admin", "procurement"],
      "user_ids": [],
      "notify_approver": true
    },
    "comparative_approved": {
      "channels": { "email": true, "whatsapp": true, "push": true },
      "roles": ["procurement"],
      "user_ids": [],
      "notify_requester": true
    },
    "comparative_rejected": {
      "channels": { "email": true, "whatsapp": true, "push": true },
      "roles": ["procurement"],
      "user_ids": []
    },
    "material_delivered": {
      "channels": { "email": true, "whatsapp": true, "push": true },
      "roles": ["property_admin", "procurement"],
      "user_ids": [],
      "notify_requester": true
    },
    "monthly_requisition_uploaded": {
      "channels": { "email": true, "whatsapp": true, "push": false },
      "roles": ["procurement", "org_super_admin"],
      "user_ids": []
    },
    "procurement_vendor_tag": {
      "channels": { "email": true, "whatsapp": true, "push": true },
      "roles": ["procurement"],
      "user_ids": []
    },
    "procurement_vendor_aligned": {
      "channels": { "email": true, "whatsapp": true, "push": true },
      "roles": [],
      "user_ids": [],
      "notify_requester": true
    }
  },
  "meeting_rooms": {
    "meeting_room_booked": {
      "channels": { "email": true, "whatsapp": true, "push": true },
      "roles": ["property_admin"],
      "user_ids": []
    },
    "meeting_room_cancelled": {
      "channels": { "email": true, "whatsapp": true, "push": true },
      "roles": ["property_admin"],
      "user_ids": []
    }
  },
  "ppm": {
    "reminder_ppm": {
      "channels": { "email": true, "whatsapp": true, "push": true },
      "roles": ["property_admin", "org_super_admin"],
      "user_ids": [],
      "reminder_minutes": 1440
    }
  },
  "crm_leads": {
    "lead_created": {
      "channels": { "email": true, "whatsapp": true, "push": true },
      "roles": ["sales", "org_super_admin"],
      "user_ids": []
    },
    "lead_assigned": {
      "channels": { "email": true, "whatsapp": true, "push": true },
      "roles": [],
      "user_ids": [],
      "notify_assignee": true
    }
  }
}'::jsonb,
ADD COLUMN IF NOT EXISTS whatsapp_templates JSONB DEFAULT '{
  "ticket_created":               { "campaign_name": "ticket_created_v3",            "params": ["user_name", "ticket_number", "title", "property", "priority", "raised_by", "raised_by_phone", "assigned_to", "assigned_to_phone", "ticket_id"] },
  "ticket_created_media":         { "campaign_name": "ticket_created_v3_media",      "params": ["user_name", "ticket_number", "title", "property", "priority", "raised_by", "raised_by_phone", "assigned_to", "assigned_to_phone", "ticket_id"], "is_media": true },
  "ticket_assigned":              { "campaign_name": "ticket_assigned_v1",           "params": ["user_name", "ticket_number", "title", "property", "priority", "requester", "requester_phone", "target_sla", "ticket_id"] },
  "ticket_completed":             { "campaign_name": "ticket_completed_v1",          "params": ["user_name", "ticket_number", "title", "property", "resolved_by", "work_note", "ticket_id"] },
  "ticket_completed_media":       { "campaign_name": "ticket_completed_v1_media",    "params": ["user_name", "ticket_number", "title", "property", "resolved_by", "work_note", "ticket_id"], "is_media": true },

  "reminder_ticket_sla":          { "campaign_name": "reminder_ticket_sla_v1",       "params": ["user_name", "ticket_number", "title", "property", "sla_deadline", "priority", "assignee_name"] },
  "checklist_slot_reminder":      { "campaign_name": "checklist_slot_reminder_v2",   "params": ["user_name", "checklist_name", "property", "due_time"] },
  "checklist_overdue_alert":      { "campaign_name": "checklist_overdue_alert_v2",   "params": ["checklist_name", "property", "scheduled_time"] },
  "daily_property_report":        { "campaign_name": "ai_property_report_v1",        "params": ["frequency", "user_name", "org_name", "date", "critical_count", "open_count", "resolved_count", "electricity_kwh", "dg_liters", "ppm_completed", "ppm_missed", "sop_compliance", "ai_insights", "property_summary"] },
  "material_request_created":     { "campaign_name": "material_request_created_v3",  "params": ["property_name", "user_name", "ticket_number", "requester", "requester_phone", "items_summary"] },
  "comparative_uploaded":         { "campaign_name": "comparative_uploaded_v1",      "params": ["user_name", "total_cost", "uploaded_by", "ticket_number", "title", "property", "approver_name", "notes"] },
  "comparative_approved":         { "campaign_name": "comparative_approved_v1",      "params": ["user_name", "total_cost", "ticket_number", "title", "property", "approved_by", "approver_comment"] },
  "comparative_rejected":         { "campaign_name": "comparative_rejected_v1",      "params": ["user_name", "total_cost", "ticket_number", "title", "property", "action_by", "rejection_reason"] },
  "material_delivered":           { "campaign_name": "material_delivered_v1",        "params": ["user_name", "ticket_number", "title", "property", "items_summary", "verified_by"] },
  "monthly_requisition_uploaded": { "campaign_name": "monthly_requisition_uploaded_v1","params": ["user_name", "month", "year", "property", "file_name", "uploaded_by"] },
  "procurement_vendor_tag":       { "campaign_name": "procurement_vendor_tag_v1",    "params": ["user_name", "ticket_number", "title", "property", "tagged_by", "note", "assigned_procurement"] },
  "procurement_vendor_aligned":   { "campaign_name": "procurement_vendor_aligned_v1","params": ["user_name", "ticket_number", "title", "property", "vendor_details", "arranged_by"] },
  "meeting_room_booked":          { "campaign_name": "meeting_room_booked_v3",       "params": ["user_name", "room_name", "property", "date", "start_time", "end_time", "booker", "booker_phone"] },
  "meeting_room_cancelled":       { "campaign_name": "meeting_room_cancelled_v2",    "params": ["user_name", "room_name", "property", "date", "start_time", "end_time", "cancelled_by"] },
  "reminder_ppm":                 { "campaign_name": "reminder_ppm_v2",              "params": ["user_name", "system_name", "property", "due_date", "vendor_name", "location"] },
  "lead_created":                 { "campaign_name": "crm_lead_created_v1",          "params": ["user_name", "company_name", "contact_person", "phone", "source", "property_interest"] },
  "lead_assigned":                { "campaign_name": "crm_lead_assigned_v1",         "params": ["user_name", "company_name", "contact_person", "phone", "property_interest", "next_followup"] },
  "fms_welcome_onboarding":       { "campaign_name": "fms_welcome_onboarding_v1",     "params": ["user_name", "helpdesk_contact"] }


}'::jsonb;

-- 2. Ensure public.whatsapp_queue exists and has organization_id column added
CREATE TABLE IF NOT EXISTS public.whatsapp_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    phone TEXT NOT NULL,
    user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    ticket_id UUID REFERENCES public.tickets(id) ON DELETE SET NULL,
    entity_id TEXT,
    event_type VARCHAR(100) NOT NULL,
    message TEXT,
    template_name TEXT,
    template_params JSONB,
    media_url TEXT,
    media_type TEXT,
    status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'sent', 'failed')),
    retry_count INTEGER DEFAULT 0,
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
    processed_at TIMESTAMPTZ
);

ALTER TABLE public.whatsapp_queue
ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
ADD COLUMN IF NOT EXISTS entity_id TEXT,
ADD COLUMN IF NOT EXISTS template_name TEXT,
ADD COLUMN IF NOT EXISTS template_params JSONB,
ADD COLUMN IF NOT EXISTS ticket_id UUID REFERENCES public.tickets(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS media_url TEXT,
ADD COLUMN IF NOT EXISTS media_type TEXT,
ADD COLUMN IF NOT EXISTS retry_count INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS error_message TEXT,
ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_whatsapp_queue_status_created ON public.whatsapp_queue(status, created_at);
CREATE INDEX IF NOT EXISTS idx_whatsapp_queue_org_id ON public.whatsapp_queue(organization_id);

-- Deduplication index for time-based reminders
CREATE UNIQUE INDEX IF NOT EXISTS idx_whatsapp_queue_reminder_dedup
ON public.whatsapp_queue (event_type, entity_id, user_id)
WHERE event_type LIKE 'REMINDER_%' AND entity_id IS NOT NULL;

-- 3. Ensure public.tickets has organization_id column
ALTER TABLE public.tickets
ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE;

-- 4. Ensure public.property_monthly_requisitions has organization_id column
ALTER TABLE public.property_monthly_requisitions
ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE;

-- 5. DB Triggers for Tickets (Created, Assigned, Completed)
CREATE OR REPLACE FUNCTION public.fn_tickets_outbox()
RETURNS TRIGGER AS $$
DECLARE
    v_event_type TEXT;
    v_payload JSONB;
    v_org_id UUID;
BEGIN
    v_org_id := NEW.organization_id;
    IF v_org_id IS NULL AND NEW.property_id IS NOT NULL THEN
        SELECT organization_id INTO v_org_id FROM public.properties WHERE id = NEW.property_id LIMIT 1;
    END IF;

    IF TG_OP = 'INSERT' THEN
        v_event_type := 'TICKET_CREATED';
        v_payload := jsonb_build_object(
            'ticket_id', NEW.id,
            'ticket_number', NEW.ticket_number,
            'title', NEW.title,
            'description', NEW.description,
            'status', NEW.status,
            'priority', NEW.priority,
            'property_id', NEW.property_id,
            'organization_id', v_org_id,
            'raised_by', NEW.raised_by,
            'assigned_to', NEW.assigned_to,
            'sla_deadline', NEW.sla_deadline
        );
    ELSIF TG_OP = 'UPDATE' THEN
        IF NEW.status IS DISTINCT FROM OLD.status OR NEW.assigned_to IS DISTINCT FROM OLD.assigned_to THEN
            v_event_type := 'TICKET_UPDATED';
            v_payload := jsonb_build_object(
                'ticket_id', NEW.id,
                'ticket_number', NEW.ticket_number,
                'title', NEW.title,
                'status', NEW.status,
                'old_status', OLD.status,
                'priority', NEW.priority,
                'property_id', NEW.property_id,
                'organization_id', v_org_id,
                'raised_by', NEW.raised_by,
                'assigned_to', NEW.assigned_to,
                'old_assigned_to', OLD.assigned_to,
                'sla_deadline', NEW.sla_deadline,
                'resolution_notes', NEW.resolution_notes
            );
        END IF;
    END IF;

    IF v_event_type IS NOT NULL THEN
        INSERT INTO public.event_outbox (event_type, entity_id, payload)
        VALUES (v_event_type, NEW.id, v_payload);
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_tickets_outbox ON public.tickets;
CREATE TRIGGER trg_tickets_outbox
    AFTER INSERT OR UPDATE ON public.tickets
    FOR EACH ROW EXECUTE FUNCTION public.fn_tickets_outbox();

-- 6. DB Triggers for SOP Completions (SOP_COMPLETED)
CREATE OR REPLACE FUNCTION public.trg_sop_completion_outbox()
RETURNS TRIGGER AS $$
DECLARE
    v_event_type VARCHAR;
    v_payload JSONB;
    v_template_title TEXT;
    v_property_id UUID;
    v_org_id UUID;
BEGIN
    -- Join with properties to safely fetch organization_id
    SELECT st.title, st.property_id, p.organization_id 
    INTO v_template_title, v_property_id, v_org_id
    FROM public.sop_templates st
    LEFT JOIN public.properties p ON p.id = st.property_id
    WHERE st.id = NEW.template_id 
    LIMIT 1;

    IF v_org_id IS NULL THEN
        v_org_id := NEW.organization_id;
    END IF;
    IF v_property_id IS NULL THEN
        v_property_id := NEW.property_id;
    END IF;

    IF (TG_OP = 'INSERT' AND NEW.status = 'completed') OR 
       (TG_OP = 'UPDATE' AND NEW.status = 'completed' AND (OLD.status IS DISTINCT FROM 'completed')) THEN
        v_event_type := 'SOP_COMPLETED';
        v_payload := jsonb_build_object(
            'completion_id', NEW.id,
            'template_id', NEW.template_id,
            'template_title', v_template_title,
            'property_id', v_property_id,
            'organization_id', v_org_id,
            'completed_by', NEW.completed_by,
            'completed_at', NEW.completed_at
        );
    END IF;

    IF v_event_type IS NOT NULL THEN
        INSERT INTO public.event_outbox (event_type, entity_id, payload)
        VALUES (v_event_type, NEW.id, v_payload);
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


DROP TRIGGER IF EXISTS trg_sop_completions_outbox ON public.sop_completions;
CREATE TRIGGER trg_sop_completions_outbox
    AFTER INSERT OR UPDATE ON public.sop_completions
    FOR EACH ROW
    EXECUTE FUNCTION public.trg_sop_completion_outbox();

-- 7. DB Trigger for Property Monthly Requisitions (REQUISITION_UPLOADED)
CREATE OR REPLACE FUNCTION public.trg_monthly_requisition_outbox()
RETURNS TRIGGER AS $$
DECLARE
    v_event_type VARCHAR := 'REQUISITION_UPLOADED';
    v_payload JSONB;
    v_org_id UUID;
BEGIN
    v_org_id := NEW.organization_id;
    IF v_org_id IS NULL AND NEW.property_id IS NOT NULL THEN
        SELECT organization_id INTO v_org_id FROM public.properties WHERE id = NEW.property_id LIMIT 1;
    END IF;

    IF TG_OP = 'INSERT' THEN
        v_payload := jsonb_build_object(
            'requisition_id', NEW.id,
            'property_id', NEW.property_id,
            'organization_id', v_org_id,
            'requisition_month', NEW.requisition_month,
            'requisition_year', NEW.requisition_year,
            'file_name', NEW.file_name,
            'uploaded_by', NEW.uploaded_by
        );

        INSERT INTO public.event_outbox (event_type, entity_id, payload)
        VALUES (v_event_type, NEW.id, v_payload);
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_property_monthly_requisitions_outbox ON public.property_monthly_requisitions;
CREATE TRIGGER trg_property_monthly_requisitions_outbox
    AFTER INSERT ON public.property_monthly_requisitions
    FOR EACH ROW
    EXECUTE FUNCTION public.trg_monthly_requisition_outbox();

-- 8. DB Trigger for CRM Leads (LEAD_CREATED & LEAD_ASSIGNED)
CREATE OR REPLACE FUNCTION public.fn_crm_leads_outbox()
RETURNS TRIGGER AS $$
DECLARE
    v_event_type TEXT;
    v_payload JSONB;
BEGIN
    IF TG_OP = 'INSERT' THEN
        v_event_type := 'LEAD_CREATED';
        v_payload := jsonb_build_object(
            'lead_id', NEW.id,
            'company_name', NEW.company_name,
            'contact_person', NEW.contact_person,
            'contact_number', NEW.contact_number,
            'lead_source', NEW.lead_source,
            'property_interest', NEW.property_interest,
            'created_by', NEW.created_by
        );
    ELSIF TG_OP = 'UPDATE' AND (NEW.assigned_to IS DISTINCT FROM OLD.assigned_to AND NEW.assigned_to IS NOT NULL) THEN
        v_event_type := 'LEAD_ASSIGNED';
        v_payload := jsonb_build_object(
            'lead_id', NEW.id,
            'company_name', NEW.company_name,
            'contact_person', NEW.contact_person,
            'contact_number', NEW.contact_number,
            'property_interest', NEW.property_interest,
            'assigned_to', NEW.assigned_to,
            'next_followup_date', NEW.next_followup_date
        );
    END IF;

    IF v_event_type IS NOT NULL THEN
        INSERT INTO public.event_outbox (event_type, entity_id, payload)
        VALUES (v_event_type, NEW.id, v_payload);
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_crm_leads_outbox ON public.crm_leads;
CREATE TRIGGER trg_crm_leads_outbox
    AFTER INSERT OR UPDATE ON public.crm_leads
    FOR EACH ROW EXECUTE FUNCTION public.fn_crm_leads_outbox();
