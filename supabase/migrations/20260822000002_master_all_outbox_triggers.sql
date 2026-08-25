-- ============================================================================
-- MASTER OUTBOX TRIGGERS FOR OMNICHANNEL NOTIFICATION SYSTEM
-- Safely drops any duplicate/conflicting legacy triggers and creates clean,
-- unified database outbox triggers for all modules.
-- ============================================================================

-- 1. TICKETS TRIGGER
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
            'sla_deadline', NEW.sla_deadline,
            'photo_before_url', NEW.photo_before_url
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
                'resolution_notes', NEW.resolution_notes,
                'photo_after_url', NEW.photo_after_url
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

DROP TRIGGER IF EXISTS trg_tickets_whatsapp_outbox ON public.tickets;
DROP TRIGGER IF EXISTS trg_tickets_outbox ON public.tickets;

CREATE TRIGGER trg_tickets_outbox
    AFTER INSERT OR UPDATE ON public.tickets
    FOR EACH ROW EXECUTE FUNCTION public.fn_tickets_outbox();


-- 2. CRM LEADS TRIGGER
CREATE OR REPLACE FUNCTION public.fn_crm_leads_outbox()
RETURNS TRIGGER AS $$
DECLARE
    v_payload JSONB;
BEGIN
    v_payload := to_jsonb(NEW) || jsonb_build_object('lead_id', NEW.id);

    IF TG_OP = 'INSERT' THEN
        INSERT INTO public.event_outbox (event_type, entity_id, payload)
        VALUES ('LEAD_CREATED', NEW.id, v_payload);

        IF NEW.assigned_to IS NOT NULL THEN
            INSERT INTO public.event_outbox (event_type, entity_id, payload)
            VALUES ('LEAD_ASSIGNED', NEW.id, v_payload);
        END IF;

    ELSIF TG_OP = 'UPDATE' AND (NEW.assigned_to IS DISTINCT FROM OLD.assigned_to AND NEW.assigned_to IS NOT NULL) THEN
        INSERT INTO public.event_outbox (event_type, entity_id, payload)
        VALUES ('LEAD_ASSIGNED', NEW.id, v_payload);
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_crm_leads_outbox ON public.crm_leads;
DROP TRIGGER IF EXISTS trg_leads_whatsapp_outbox ON public.crm_leads;

CREATE TRIGGER trg_crm_leads_outbox
    AFTER INSERT OR UPDATE ON public.crm_leads
    FOR EACH ROW EXECUTE FUNCTION public.fn_crm_leads_outbox();


-- 3. MEETING ROOM BOOKINGS TRIGGER
CREATE OR REPLACE FUNCTION public.fn_meeting_room_bookings_outbox()
RETURNS TRIGGER AS $$
DECLARE
    v_event_type VARCHAR;
    v_payload JSONB;
BEGIN
    IF TG_OP = 'INSERT' THEN
        v_event_type := 'MEETING_ROOM_BOOKED';
        v_payload := row_to_json(NEW)::jsonb;
        
        INSERT INTO public.event_outbox (event_type, entity_id, payload)
        VALUES (v_event_type, NEW.id, v_payload);
        
        RETURN NEW;
    ELSIF TG_OP = 'UPDATE' AND NEW.status = 'cancelled' AND OLD.status != 'cancelled' THEN
        v_event_type := 'MEETING_ROOM_CANCELLED';
        v_payload := row_to_json(NEW)::jsonb;
        
        INSERT INTO public.event_outbox (event_type, entity_id, payload)
        VALUES (v_event_type, NEW.id, v_payload);
        
        RETURN NEW;
    ELSIF TG_OP = 'DELETE' THEN
        v_event_type := 'MEETING_ROOM_CANCELLED';
        v_payload := row_to_json(OLD)::jsonb;
        
        INSERT INTO public.event_outbox (event_type, entity_id, payload)
        VALUES (v_event_type, OLD.id, v_payload);
        
        RETURN OLD;
    ELSE
        RETURN COALESCE(NEW, OLD);
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS tr_meeting_room_outbox_insert ON public.meeting_room_bookings;
DROP TRIGGER IF EXISTS tr_meeting_room_booking_outbox_insert_update ON public.meeting_room_bookings;
DROP TRIGGER IF EXISTS tr_meeting_room_booking_outbox_insert_update_delete ON public.meeting_room_bookings;
DROP TRIGGER IF EXISTS trg_meeting_room_bookings_outbox ON public.meeting_room_bookings;

CREATE TRIGGER trg_meeting_room_bookings_outbox
    AFTER INSERT OR UPDATE OR DELETE ON public.meeting_room_bookings
    FOR EACH ROW EXECUTE FUNCTION public.fn_meeting_room_bookings_outbox();


-- 4. MATERIAL REQUESTS TRIGGER
CREATE OR REPLACE FUNCTION public.fn_material_requests_outbox()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        INSERT INTO public.event_outbox (event_type, entity_id, payload)
        VALUES ('MATERIAL_REQUEST_CREATED', NEW.id, row_to_json(NEW)::jsonb);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS tr_material_request_outbox_insert ON public.material_requests;
DROP TRIGGER IF EXISTS trg_material_requests_outbox ON public.material_requests;

CREATE TRIGGER trg_material_requests_outbox
    AFTER INSERT ON public.material_requests
    FOR EACH ROW EXECUTE FUNCTION public.fn_material_requests_outbox();


-- 5. SOP CHECKLIST COMPLETIONS TRIGGER
CREATE OR REPLACE FUNCTION public.fn_sop_completion_outbox()
RETURNS TRIGGER AS $$
DECLARE
    v_payload JSONB;
    v_template_title TEXT;
    v_property_id UUID;
    v_org_id UUID;
BEGIN
    SELECT t.title, t.property_id, p.organization_id
    INTO v_template_title, v_property_id, v_org_id
    FROM public.sop_templates t
    LEFT JOIN public.properties p ON p.id = t.property_id
    WHERE t.id = NEW.template_id;

    v_payload := jsonb_build_object(
        'completion_id', NEW.id,
        'template_id', NEW.template_id,
        'template_title', COALESCE(v_template_title, 'SOP Checklist'),
        'property_id', v_property_id,
        'organization_id', v_org_id,
        'completed_by', NEW.completed_by,
        'completed_at', NEW.completed_at
    );

    INSERT INTO public.event_outbox (event_type, entity_id, payload)
    VALUES ('SOP_COMPLETED', NEW.id, v_payload);

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_sop_completion_outbox ON public.sop_completions;
CREATE TRIGGER trg_sop_completion_outbox
    AFTER INSERT ON public.sop_completions
    FOR EACH ROW EXECUTE FUNCTION public.fn_sop_completion_outbox();


-- 6. MONTHLY REQUISITIONS TRIGGER
CREATE OR REPLACE FUNCTION public.fn_monthly_requisition_outbox()
RETURNS TRIGGER AS $$
DECLARE
    v_payload JSONB;
    v_org_id UUID;
    v_notes JSONB;
    v_items_count INT := 0;
    v_total_amount NUMERIC := 0;
BEGIN
    v_org_id := NEW.organization_id;
    IF v_org_id IS NULL AND NEW.property_id IS NOT NULL THEN
        SELECT organization_id INTO v_org_id FROM public.properties WHERE id = NEW.property_id LIMIT 1;
    END IF;

    -- Try to parse notes JSON if present
    BEGIN
        IF NEW.notes IS NOT NULL AND NEW.notes ~ '^\s*\{' THEN
            v_notes := NEW.notes::JSONB;
            v_items_count := COALESCE((v_notes->>'total_items_count')::INT, jsonb_array_length(v_notes->'items'), 0);
            v_total_amount := COALESCE((v_notes->>'total_estimated_amount')::NUMERIC, 0);
        END IF;
    EXCEPTION WHEN OTHERS THEN
        v_items_count := 0;
        v_total_amount := 0;
    END;

    IF TG_OP = 'INSERT' THEN
        v_payload := jsonb_build_object(
            'requisition_id', NEW.id,
            'property_id', NEW.property_id,
            'organization_id', v_org_id,
            'floor_tag', COALESCE(NEW.floor_tag, 'All Floors'),
            'requisition_month', NEW.requisition_month,
            'requisition_year', NEW.requisition_year,
            'file_name', NEW.file_name,
            'file_url', NEW.file_url,
            'items_count', v_items_count,
            'total_amount', v_total_amount,
            'total_estimated_amount', v_total_amount,
            'uploaded_by', NEW.uploaded_by,
            'status', NEW.status
        );

        INSERT INTO public.event_outbox (event_type, entity_id, payload)
        VALUES ('REQUISITION_UPLOADED', NEW.id, v_payload);
    END IF;

    RETURN NEW;[
  {
    "table_name": "crm_calls",
    "trigger_name": "trg_crm_calls_touch",
    "event": "UPDATE",
    "timing": "BEFORE",
    "action": "EXECUTE FUNCTION crm_calls_touch_updated_at()"
  },
  {
    "table_name": "crm_campaign_metrics",
    "trigger_name": "crm_campaign_metrics_updated_at",
    "event": "UPDATE",
    "timing": "BEFORE",
    "action": "EXECUTE FUNCTION update_updated_at()"
  },
  {
    "table_name": "crm_campaign_spend",
    "trigger_name": "trg_crm_campaign_spend_touch",
    "event": "UPDATE",
    "timing": "BEFORE",
    "action": "EXECUTE FUNCTION crm_campaign_spend_touch_updated_at()"
  },
  {
    "table_name": "crm_campaigns",
    "trigger_name": "crm_campaigns_updated_at",
    "event": "UPDATE",
    "timing": "BEFORE",
    "action": "EXECUTE FUNCTION update_updated_at()"
  },
  {
    "table_name": "crm_events",
    "trigger_name": "crm_events_updated_at",
    "event": "UPDATE",
    "timing": "BEFORE",
    "action": "EXECUTE FUNCTION update_updated_at()"
  },
  {
    "table_name": "crm_leads",
    "trigger_name": "crm_leads_auto_activity",
    "event": "INSERT",
    "timing": "AFTER",
    "action": "EXECUTE FUNCTION crm_auto_activity()"
  },
  {
    "table_name": "crm_leads",
    "trigger_name": "crm_leads_auto_activity",
    "event": "UPDATE",
    "timing": "AFTER",
    "action": "EXECUTE FUNCTION crm_auto_activity()"
  },
  {
    "table_name": "crm_leads",
    "trigger_name": "crm_leads_closed_at",
    "event": "UPDATE",
    "timing": "BEFORE",
    "action": "EXECUTE FUNCTION crm_maintain_closed_at()"
  },
  {
    "table_name": "crm_leads",
    "trigger_name": "crm_leads_updated_at",
    "event": "UPDATE",
    "timing": "BEFORE",
    "action": "EXECUTE FUNCTION update_updated_at()"
  },
  {
    "table_name": "crm_leads",
    "trigger_name": "trg_crm_leads_outbox",
    "event": "UPDATE",
    "timing": "AFTER",
    "action": "EXECUTE FUNCTION fn_crm_leads_outbox()"
  },
  {
    "table_name": "crm_leads",
    "trigger_name": "trg_crm_leads_outbox",
    "event": "INSERT",
    "timing": "AFTER",
    "action": "EXECUTE FUNCTION fn_crm_leads_outbox()"
  },
  {
    "table_name": "crm_meta_config",
    "trigger_name": "crm_meta_config_updated_at",
    "event": "UPDATE",
    "timing": "BEFORE",
    "action": "EXECUTE FUNCTION update_updated_at()"
  },
  {
    "table_name": "dg_tariffs",
    "trigger_name": "trg_check_dg_tariff_overlap",
    "event": "UPDATE",
    "timing": "BEFORE",
    "action": "EXECUTE FUNCTION check_dg_tariff_overlap()"
  },
  {
    "table_name": "dg_tariffs",
    "trigger_name": "trg_check_dg_tariff_overlap",
    "event": "INSERT",
    "timing": "BEFORE",
    "action": "EXECUTE FUNCTION check_dg_tariff_overlap()"
  },
  {
    "table_name": "electricity_bill_events",
    "trigger_name": "trg_elec_bill_events_no_update",
    "event": "DELETE",
    "timing": "BEFORE",
    "action": "EXECUTE FUNCTION electricity_bill_events_immutable()"
  },
  {
    "table_name": "electricity_bill_events",
    "trigger_name": "trg_elec_bill_events_no_update",
    "event": "UPDATE",
    "timing": "BEFORE",
    "action": "EXECUTE FUNCTION electricity_bill_events_immutable()"
  },
  {
    "table_name": "electricity_bills",
    "trigger_name": "trg_elec_bills_record_event",
    "event": "INSERT",
    "timing": "AFTER",
    "action": "EXECUTE FUNCTION electricity_bills_record_event()"
  },
  {
    "table_name": "electricity_bills",
    "trigger_name": "trg_elec_bills_record_event",
    "event": "UPDATE",
    "timing": "AFTER",
    "action": "EXECUTE FUNCTION electricity_bills_record_event()"
  },
  {
    "table_name": "event_outbox",
    "trigger_name": "Event Outbox Processor",
    "event": "INSERT",
    "timing": "AFTER",
    "action": "EXECUTE FUNCTION supabase_functions.http_request('https://fms-dev-saas-one.vercel.app/api/webhooks/process-event', 'POST', '{\"Content-type\":\"application/json\",\"x-webhook-secret\":\"whsec_f8934ae837190cbb41de7a9c8f18d7f2\"}', '{}', '5000')"
  },
  {
    "table_name": "event_outbox",
    "trigger_name": "outbox_updated_at",
    "event": "UPDATE",
    "timing": "BEFORE",
    "action": "EXECUTE FUNCTION handle_updated_at_outbox()"
  },
  {
    "table_name": "grid_tariffs",
    "trigger_name": "trg_check_grid_tariff_overlap",
    "event": "UPDATE",
    "timing": "BEFORE",
    "action": "EXECUTE FUNCTION check_grid_tariff_overlap()"
  },
  {
    "table_name": "grid_tariffs",
    "trigger_name": "trg_check_grid_tariff_overlap",
    "event": "INSERT",
    "timing": "BEFORE",
    "action": "EXECUTE FUNCTION check_grid_tariff_overlap()"
  },
  {
    "table_name": "guest_requests",
    "trigger_name": "trg_generate_guest_request_ticket_number",
    "event": "INSERT",
    "timing": "BEFORE",
    "action": "EXECUTE FUNCTION generate_guest_request_ticket_number()"
  },
  {
    "table_name": "issue_logs",
    "trigger_name": "update_issue_logs_updated_at",
    "event": "UPDATE",
    "timing": "BEFORE",
    "action": "EXECUTE FUNCTION update_updated_at()"
  },
  {
    "table_name": "material_request_comparatives",
    "trigger_name": "comparatives_updated_at",
    "event": "UPDATE",
    "timing": "BEFORE",
    "action": "EXECUTE FUNCTION handle_updated_at_outbox()"
  },
  {
    "table_name": "material_request_comparatives",
    "trigger_name": "tr_material_comparatives_outbox",
    "event": "UPDATE",
    "timing": "AFTER",
    "action": "EXECUTE FUNCTION create_outbox_event()"
  },
  {
    "table_name": "material_request_comparatives",
    "trigger_name": "tr_material_comparatives_outbox",
    "event": "INSERT",
    "timing": "AFTER",
    "action": "EXECUTE FUNCTION create_outbox_event()"
  },
  {
    "table_name": "material_requests",
    "trigger_name": "tr_material_request_outbox_insert_update",
    "event": "UPDATE",
    "timing": "AFTER",
    "action": "EXECUTE FUNCTION create_outbox_event()"
  },
  {
    "table_name": "material_requests",
    "trigger_name": "tr_material_request_outbox_insert_update",
    "event": "INSERT",
    "timing": "AFTER",
    "action": "EXECUTE FUNCTION create_outbox_event()"
  },
  {
    "table_name": "material_requests",
    "trigger_name": "trg_material_requests_outbox",
    "event": "INSERT",
    "timing": "AFTER",
    "action": "EXECUTE FUNCTION fn_material_requests_outbox()"
  },
  {
    "table_name": "meeting_room_bookings",
    "trigger_name": "trg_meeting_room_bookings_outbox",
    "event": "INSERT",
    "timing": "AFTER",
    "action": "EXECUTE FUNCTION fn_meeting_room_bookings_outbox()"
  },
  {
    "table_name": "meeting_room_bookings",
    "trigger_name": "trg_meeting_room_bookings_outbox",
    "event": "DELETE",
    "timing": "AFTER",
    "action": "EXECUTE FUNCTION fn_meeting_room_bookings_outbox()"
  },
  {
    "table_name": "meeting_room_bookings",
    "trigger_name": "trg_meeting_room_bookings_outbox",
    "event": "UPDATE",
    "timing": "AFTER",
    "action": "EXECUTE FUNCTION fn_meeting_room_bookings_outbox()"
  },
  {
    "table_name": "meeting_rooms",
    "trigger_name": "set_meeting_room_org_id",
    "event": "INSERT",
    "timing": "BEFORE",
    "action": "EXECUTE FUNCTION trg_set_meeting_room_org_id()"
  },
  {
    "table_name": "meeting_rooms",
    "trigger_name": "set_meeting_room_org_id",
    "event": "UPDATE",
    "timing": "BEFORE",
    "action": "EXECUTE FUNCTION trg_set_meeting_room_org_id()"
  },
  {
    "table_name": "organizations",
    "trigger_name": "on_organization_created",
    "event": "INSERT",
    "timing": "AFTER",
    "action": "EXECUTE FUNCTION handle_new_organization()"
  },
  {
    "table_name": "organizations",
    "trigger_name": "on_organization_soft_delete",
    "event": "UPDATE",
    "timing": "BEFORE",
    "action": "EXECUTE FUNCTION handle_organization_soft_delete()"
  },
  {
    "table_name": "organizations",
    "trigger_name": "on_organization_updated",
    "event": "UPDATE",
    "timing": "BEFORE",
    "action": "EXECUTE FUNCTION handle_organization_update()"
  },
  {
    "table_name": "petty_cash_requests",
    "trigger_name": "trg_pc_request_no",
    "event": "INSERT",
    "timing": "BEFORE",
    "action": "EXECUTE FUNCTION set_petty_cash_request_no()"
  },
  {
    "table_name": "properties",
    "trigger_name": "on_property_create_ticket_sequence",
    "event": "INSERT",
    "timing": "AFTER",
    "action": "EXECUTE FUNCTION ensure_ticket_sequence()"
  },
  {
    "table_name": "properties",
    "trigger_name": "trim_properties_before_save",
    "event": "UPDATE",
    "timing": "BEFORE",
    "action": "EXECUTE FUNCTION trim_text_fields()"
  },
  {
    "table_name": "properties",
    "trigger_name": "trim_properties_before_save",
    "event": "INSERT",
    "timing": "BEFORE",
    "action": "EXECUTE FUNCTION trim_text_fields()"
  },
  {
    "table_name": "property_features",
    "trigger_name": "trigger_update_property_features_updated_at",
    "event": "UPDATE",
    "timing": "BEFORE",
    "action": "EXECUTE FUNCTION update_property_features_updated_at()"
  },
  {
    "table_name": "property_monthly_requisitions",
    "trigger_name": "trg_requisition_outbox_event",
    "event": "UPDATE",
    "timing": "AFTER",
    "action": "EXECUTE FUNCTION trg_requisition_outbox_notifier()"
  },
  {
    "table_name": "property_monthly_requisitions",
    "trigger_name": "trg_requisition_outbox_event",
    "event": "INSERT",
    "timing": "AFTER",
    "action": "EXECUTE FUNCTION trg_requisition_outbox_notifier()"
  },
  {
    "table_name": "sop_completion_items",
    "trigger_name": "trig_sop_completion_items_updated_at",
    "event": "UPDATE",
    "timing": "BEFORE",
    "action": "EXECUTE FUNCTION handle_updated_at()"
  },
  {
    "table_name": "sop_completions",
    "trigger_name": "trg_sop_completion_outbox",
    "event": "INSERT",
    "timing": "AFTER",
    "action": "EXECUTE FUNCTION fn_sop_completion_outbox()"
  },
  {
    "table_name": "sop_completions",
    "trigger_name": "trg_sop_completions_outbox",
    "event": "UPDATE",
    "timing": "AFTER",
    "action": "EXECUTE FUNCTION trg_sop_completion_outbox()"
  },
  {
    "table_name": "sop_completions",
    "trigger_name": "trg_sop_completions_outbox",
    "event": "INSERT",
    "timing": "AFTER",
    "action": "EXECUTE FUNCTION trg_sop_completion_outbox()"
  },
  {
    "table_name": "sop_completions",
    "trigger_name": "trig_clone_sop_checklist_items",
    "event": "INSERT",
    "timing": "AFTER",
    "action": "EXECUTE FUNCTION fn_clone_sop_checklist_items()"
  },
  {
    "table_name": "sop_completions",
    "trigger_name": "trig_sop_completions_updated_at",
    "event": "UPDATE",
    "timing": "BEFORE",
    "action": "EXECUTE FUNCTION handle_updated_at()"
  },
  {
    "table_name": "stock_items",
    "trigger_name": "trigger_generate_stock_barcode",
    "event": "INSERT",
    "timing": "BEFORE",
    "action": "EXECUTE FUNCTION generate_stock_barcode()"
  },
  {
    "table_name": "ticket_comments",
    "trigger_name": "ticket_comments_update_timestamp",
    "event": "UPDATE",
    "timing": "AFTER",
    "action": "EXECUTE FUNCTION update_ticket_timestamp()"
  },
  {
    "table_name": "ticket_comments",
    "trigger_name": "ticket_comments_update_timestamp",
    "event": "INSERT",
    "timing": "AFTER",
    "action": "EXECUTE FUNCTION update_ticket_timestamp()"
  },
  {
    "table_name": "tickets",
    "trigger_name": "ticket_auto_classify",
    "event": "INSERT",
    "timing": "BEFORE",
    "action": "EXECUTE FUNCTION auto_classify_ticket_department()"
  },
  {
    "table_name": "tickets",
    "trigger_name": "trg_award_ticket_resolution_points",
    "event": "UPDATE",
    "timing": "AFTER",
    "action": "EXECUTE FUNCTION award_ticket_resolution_points()"
  },
  {
    "table_name": "tickets",
    "trigger_name": "trg_set_ticket_accepted_at",
    "event": "UPDATE",
    "timing": "BEFORE",
    "action": "EXECUTE FUNCTION set_ticket_accepted_at()"
  },
  {
    "table_name": "tickets",
    "trigger_name": "trg_set_ticket_assigned_at",
    "event": "UPDATE",
    "timing": "BEFORE",
    "action": "EXECUTE FUNCTION set_ticket_assigned_at()"
  },
  {
    "table_name": "tickets",
    "trigger_name": "trg_tickets_outbox",
    "event": "UPDATE",
    "timing": "AFTER",
    "action": "EXECUTE FUNCTION fn_tickets_outbox()"
  },
  {
    "table_name": "tickets",
    "trigger_name": "trg_tickets_outbox",
    "event": "INSERT",
    "timing": "AFTER",
    "action": "EXECUTE FUNCTION fn_tickets_outbox()"
  },
  {
    "table_name": "tickets",
    "trigger_name": "trg_tickets_vendor_procurement_outbox",
    "event": "UPDATE",
    "timing": "AFTER",
    "action": "EXECUTE FUNCTION trg_ticket_vendor_procurement_outbox()"
  },
  {
    "table_name": "tickets",
    "trigger_name": "trigger_auto_assign_ticket",
    "event": "INSERT",
    "timing": "BEFORE",
    "action": "EXECUTE FUNCTION auto_assign_ticket()"
  },
  {
    "table_name": "users",
    "trigger_name": "trigger_update_user_activity",
    "event": "UPDATE",
    "timing": "BEFORE",
    "action": "EXECUTE FUNCTION update_user_activity()"
  },
  {
    "table_name": "whatsapp_queue",
    "trigger_name": "whatsapp insert ",
    "event": "INSERT",
    "timing": "AFTER",
    "action": "EXECUTE FUNCTION supabase_functions.http_request('https://fms-dev-saas-one.vercel.app/api/webhooks/whatsapp-queue', 'POST', '{\"Content-type\":\"application/json\",\"Authorization\":\"Bearer escalation_secret_2026\"}', '{}', '5000')"
  },
  {
    "table_name": "zoho_po_entity_master",
    "trigger_name": "update_zoho_po_entity_master_updated_at",
    "event": "UPDATE",
    "timing": "BEFORE",
    "action": "EXECUTE FUNCTION update_updated_at_column()"
  },
  {
    "table_name": "zoho_po_settings",
    "trigger_name": "update_zoho_po_settings_updated_at",
    "event": "UPDATE",
    "timing": "BEFORE",
    "action": "EXECUTE FUNCTION update_updated_at_column()"
  },
  {
    "table_name": "zoho_po_tokens",
    "trigger_name": "update_zoho_po_tokens_updated_at",
    "event": "UPDATE",
    "timing": "BEFORE",
    "action": "EXECUTE FUNCTION update_updated_at_column()"
  },
  {
    "table_name": "zoho_po_vendor_cache",
    "trigger_name": "update_zoho_po_vendor_cache_updated_at",
    "event": "UPDATE",
    "timing": "BEFORE",
    "action": "EXECUTE FUNCTION update_updated_at_column()"
  }
]
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_requisition_outbox_event ON public.property_monthly_requisitions;
DROP TRIGGER IF EXISTS trg_fn_requisition_outbox_notifier ON public.property_monthly_requisitions;
DROP TRIGGER IF EXISTS tr_requisition_outbox_update ON public.property_monthly_requisitions;
DROP TRIGGER IF EXISTS trg_requisition_outbox_notifier ON public.property_monthly_requisitions;
DROP TRIGGER IF EXISTS trg_property_monthly_requisitions_outbox ON public.property_monthly_requisitions;
DROP TRIGGER IF EXISTS tr_property_monthly_requisitions_outbox ON public.property_monthly_requisitions;
DROP TRIGGER IF EXISTS trigger_requisition_uploaded ON public.property_monthly_requisitions;

CREATE TRIGGER trg_property_monthly_requisitions_outbox
    AFTER INSERT ON public.property_monthly_requisitions
    FOR EACH ROW EXECUTE FUNCTION public.fn_monthly_requisition_outbox();
